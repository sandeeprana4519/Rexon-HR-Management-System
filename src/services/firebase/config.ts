import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
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
  const defaultExisting = getApps().find((a) => a.name === '[DEFAULT]');
  appInstance = defaultExisting ?? initializeApp(firebaseConfig);
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

const SECONDARY_PROVISIONER_APP_NAME = 'RexonSecondaryAuthProvisioner';
let secondaryAuthInstance: Auth | null = null;

function getSecondaryProvisionerAuth(): Auth {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase is not configured.');
  }
  if (secondaryAuthInstance) {
    return secondaryAuthInstance;
  }
  const existingSecondary = getApps().find((a) => a.name === SECONDARY_PROVISIONER_APP_NAME);
  const secondaryApp = existingSecondary
    ? getApp(SECONDARY_PROVISIONER_APP_NAME)
    : initializeApp(firebaseConfig, SECONDARY_PROVISIONER_APP_NAME);

  try {
    secondaryAuthInstance = initializeAuth(secondaryApp, {
      persistence: inMemoryPersistence,
    });
  } catch {
    secondaryAuthInstance = getAuth(secondaryApp);
  }
  return secondaryAuthInstance;
}

function generateStrongTemporarySecret(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `Rx#${hex.slice(0, 12)}!9A`;
}

/**
 * Creates (or links) a Firebase Authentication user on an isolated in-memory
 * secondary FirebaseApp so the currently logged-in Admin is NEVER signed out,
 * and plain-text passwords are NEVER stored in Firestore or logs.
 */
export async function provisionFirebaseUserIsolated(params: {
  email: string;
  initialPassword?: string;
  existingAuthUid?: string;
}): Promise<{
  uid: string;
  mode: 'created' | 'linked_existing';
  passwordResetSent: boolean;
}> {
  const cleanEmail = params.email.trim().toLowerCase();
  const manualUid = (params.existingAuthUid ?? '').trim();
  if (manualUid) {
    if (!/^[a-zA-Z0-9_-]{4,128}$/.test(manualUid)) {
      throw new Error('Existing Firebase Auth UID must be 4–128 alphanumeric characters.');
    }
    return {
      uid: manualUid,
      mode: 'linked_existing',
      passwordResetSent: false,
    };
  }

  const providedPassword = (params.initialPassword ?? '').trim();
  if (providedPassword.length > 0 && providedPassword.length < 6) {
    throw new Error('Initial login password must be at least 6 characters long.');
  }

  const secondaryAuth = getSecondaryProvisionerAuth();
  const secretToUse =
    providedPassword.length >= 6 ? providedPassword : generateStrongTemporarySecret();

  try {
    const createdCred = await createUserWithEmailAndPassword(
      secondaryAuth,
      cleanEmail,
      secretToUse
    );
    const createdUid = createdCred.user.uid;
    let passwordResetSent = false;

    if (providedPassword.length === 0 && authInstance) {
      try {
        await sendPasswordResetEmail(authInstance, cleanEmail);
        passwordResetSent = true;
      } catch {
        // Non-fatal if reset email template/quota not configured
      }
    }

    return {
      uid: createdUid,
      mode: 'created',
      passwordResetSent,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('auth/email-already-in-use')) {
      if (providedPassword.length >= 6) {
        try {
          const existingCred = await signInWithEmailAndPassword(
            secondaryAuth,
            cleanEmail,
            providedPassword
          );
          return {
            uid: existingCred.user.uid,
            mode: 'linked_existing',
            passwordResetSent: false,
          };
        } catch {
          throw new Error(
            `Email "${cleanEmail}" already exists in Firebase Authentication with a different password. Enter its current password or paste its User UID in "Existing Firebase Auth UID".`
          );
        }
      }
      throw new Error(
        `Email "${cleanEmail}" already exists in Firebase Authentication. Enter its password to verify & link it, or paste its User UID in "Existing Firebase Auth UID".`
      );
    }
    throw err;
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
  }
}

export const firebaseApp = appInstance;
export const firebaseAuth = authInstance;
export const firestoreDb = dbInstance;
export const firebaseStorage = storageInstance;
export const configuredProjectId = firebaseConfig.projectId || null;
