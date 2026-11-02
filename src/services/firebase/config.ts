import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';

const REQUIRED_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

type FirebaseEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

function readEnvValue(key: FirebaseEnvKey): string {
  const envObj = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const raw = envObj ? envObj[key] : undefined;
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  // Reject placeholder values so fake credentials are never treated as valid
  if (
    !trimmed ||
    trimmed.startsWith('YOUR_') ||
    trimmed.startsWith('MY_') ||
    trimmed === 'undefined' ||
    trimmed === 'null'
  ) {
    return '';
  }
  return trimmed;
}

export const missingFirebaseEnvKeys: FirebaseEnvKey[] = REQUIRED_ENV_KEYS.filter(
  (key) => readEnvValue(key).length === 0
);

export const isFirebaseConfigured: boolean = missingFirebaseEnvKeys.length === 0;

const firebaseConfig = {
  apiKey: readEnvValue('VITE_FIREBASE_API_KEY'),
  authDomain: readEnvValue('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: readEnvValue('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: readEnvValue('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readEnvValue('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: readEnvValue('VITE_FIREBASE_APP_ID'),
};

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

if (isFirebaseConfigured) {
  appInstance = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  authInstance = getAuth(appInstance);
  dbInstance = getFirestore(appInstance);
  storageInstance = getStorage(appInstance);

  // Validate connectivity against Firestore server when configured
  void (async () => {
    if (!dbInstance) return;
    try {
      await getDocFromServer(doc(dbInstance, 'test', 'connection'));
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error(
          'Please check your Firebase configuration. Firestore client reported offline.'
        );
      }
    }
  })();
}

export const firebaseApp = appInstance;
export const firebaseAuth = authInstance;
export const firestoreDb = dbInstance;
export const firebaseStorage = storageInstance;
export const configuredProjectId = firebaseConfig.projectId || null;
