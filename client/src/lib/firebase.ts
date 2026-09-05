import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getDatabase, type Database } from 'firebase/database';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  ...(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    ? { measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID }
    : {}),
  ...(import.meta.env.VITE_FIREBASE_DATABASE_URL
    ? { databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL }
    : {}),
};

export const firebaseApp: FirebaseApp = initializeApp(config);
export const auth: Auth = getAuth(firebaseApp);
export const firestore: Firestore = getFirestore(firebaseApp);

/** Realtime Database. Only configured when VITE_FIREBASE_DATABASE_URL is set. */
export const realtimeDb: Database | null = import.meta.env.VITE_FIREBASE_DATABASE_URL
  ? getDatabase(firebaseApp)
  : null;

/**
 * Analytics needs a measurementId and a browser that supports it — server-side
 * rendering, some privacy modes and unsupported environments all fail the check,
 * so it resolves to null instead of throwing.
 */
export const analyticsReady: Promise<Analytics | null> = import.meta.env
  .VITE_FIREBASE_MEASUREMENT_ID
  ? isSupported().then((supported) => (supported ? getAnalytics(firebaseApp) : null))
  : Promise.resolve(null);
