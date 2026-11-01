const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const AppError = require('../../utils/AppError');

function getFirebaseAuth() {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new AppError(
      'Firebase Admin credentials are not configured.',
      503,
      'FIREBASE_AUTH_NOT_CONFIGURED'
    );
  }

  const app = getApps().find((entry) => entry.name === 'cakezee-auth') ||
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      projectId: FIREBASE_PROJECT_ID,
    }, 'cakezee-auth');

  return getAuth(app);
}

async function verifyIdToken(token) {
  try {
    return await getFirebaseAuth().verifyIdToken(token, true);
  } catch (error) {
    if (error.code === 'FIREBASE_AUTH_NOT_CONFIGURED') throw error;
    if (error.statusCode === 503) throw error;
    throw new AppError('Firebase authentication failed.', 401, 'FIREBASE_TOKEN_INVALID');
  }
}

module.exports = { verifyIdToken };
