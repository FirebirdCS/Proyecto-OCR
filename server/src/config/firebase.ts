import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import { env } from './env.js';

function createApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const hasInlineCredentials =
    env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY;

  const credential = hasInlineCredentials
    ? cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        // Env files store the key on a single line with escaped newlines.
        privateKey: env.FIREBASE_PRIVATE_KEY!.replace(/\n/g, '\n'),
      })
    : applicationDefault();

  return initializeApp({
    credential,
    ...(env.FIREBASE_DATABASE_URL ? { databaseURL: env.FIREBASE_DATABASE_URL } : {}),
    ...(env.FIREBASE_STORAGE_BUCKET ? { storageBucket: env.FIREBASE_STORAGE_BUCKET } : {}),
  });
}

export const firebaseApp = createApp();
export const auth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);

/** Realtime Database. Only usable when FIREBASE_DATABASE_URL is configured. */
export const realtimeDb = env.FIREBASE_DATABASE_URL ? getDatabase(firebaseApp) : null;

/** Cloud Storage for receipt files. Only usable when FIREBASE_STORAGE_BUCKET is configured. */
export const bucket = env.FIREBASE_STORAGE_BUCKET ? getStorage(firebaseApp).bucket() : null;
