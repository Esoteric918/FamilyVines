const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();

exports.redeemToken = onCall(async (request) => {
  const {token} = request.data;

  if (!token || typeof token !== "string") {
    throw new HttpsError("invalid-argument", "A token is required.");
  }

  const tokenRef = db.collection("inviteTokens").doc(token);
  const tokenSnap = await tokenRef.get();

  if (!tokenSnap.exists) {
    throw new HttpsError("not-found", "Invalid token.");
  }

  const tokenData = tokenSnap.data();

  if (!tokenData.active) {
    throw new HttpsError(
        "failed-precondition",
        "This token is no longer active.",
    );
  }

  if (typeof tokenData.usesLeft === "number" && tokenData.usesLeft <= 0) {
    throw new HttpsError("failed-precondition", "This token has no uses left.");
  }

  // Create a new anonymous-style user identity for this device/person
  const auth = getAuth();
  const userRecord = await auth.createUser({});
  const uid = userRecord.uid;

  // Set custom claims for treeId/branchId
  await auth.setCustomUserClaims(uid, {
    treeId: tokenData.treeId,
    branchId: tokenData.branchId,
  });

  // Write the user doc + membership doc, matching our data model
  await db.collection("users").doc(uid).set({
    createdAt: FieldValue.serverTimestamp(),
  });

  await db
      .collection("users")
      .doc(uid)
      .collection("treeMemberships")
      .doc(tokenData.treeId)
      .set({
        branchId: tokenData.branchId,
        role: "member",
        joinedAt: FieldValue.serverTimestamp(),
      });

  // Decrement token uses if it's a limited-use token
  if (typeof tokenData.usesLeft === "number") {
    await tokenRef.update({usesLeft: FieldValue.increment(-1)});
  }

  const customToken = await auth.createCustomToken(uid);

  return {customToken};
});
