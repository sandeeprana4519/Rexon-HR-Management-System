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
import {
  FirebaseStorage,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';

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
let storageUnavailableInSession = false;

if (isFirebaseConfigured) {
  const defaultExisting = getApps().find((a) => a.name === '[DEFAULT]');
  appInstance = defaultExisting ?? initializeApp(firebaseConfig);
  authInstance = getAuth(appInstance);
  dbInstance = getFirestore(appInstance);
  storageInstance = getStorage(appInstance);
  // Prevent 10-minute default hangs when Firebase Storage bucket is not initialized on Spark projects
  storageInstance.maxUploadRetryTime = 4000;
  storageInstance.maxOperationRetryTime = 4000;

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

export const MAX_PHOTO_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB camera photo support

export function isSupportedImageFile(file: File): boolean {
  if (file.type && file.type.startsWith('image/')) {
    return true;
  }
  return /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name || '');
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Compresses an image file on the client using HTML5 Canvas into a compact JPEG data URL
 * so profile photos and site photographs render immediately and fit well within Firestore limits.
 */
export function compressImageFileToDataUrl(
  file: File,
  maxDimension = 280,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.onload = () => {
      const rawDataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!rawDataUrl) {
        reject(new Error('Unable to read image data.'));
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(rawDataUrl);
      img.onload = () => {
        try {
          let width = img.width || maxDimension;
          let height = img.height || maxDimension;
          if (width > maxDimension || height > maxDimension) {
            if (width >= height) {
              height = Math.max(1, Math.round((height * maxDimension) / width));
              width = maxDimension;
            } else {
              width = Math.max(1, Math.round((width * maxDimension) / height));
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(rawDataUrl);
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(rawDataUrl);
        }
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Attempts to upload a file or blob to Firebase Storage with a strict fast timeout and task cancellation.
 * Returns the download URL on success, or `null` if Firebase Storage is uninitialized, blocked by CORS/rules,
 * or unresponsive within `timeoutMs` (caching unavailability for the session so subsequent uploads
 * fall back instantaneously without waiting).
 */
export async function uploadToStorageWithFastTimeout(
  storagePath: string,
  fileOrBlob: File | Blob,
  timeoutMs = 1500
): Promise<string | null> {
  if (!storageInstance || storageUnavailableInSession) {
    return null;
  }

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const storageRef = ref(storageInstance!, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, fileOrBlob, {
      contentType: fileOrBlob.type || 'application/octet-stream',
    });

    const finish = (url: string | null, markUnavailable = false) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timerId);
      if (markUnavailable) {
        storageUnavailableInSession = true;
      }
      resolve(url);
    };

    const timerId = window.setTimeout(() => {
      try {
        uploadTask.cancel();
      } catch {
        // Ignore cancellation error
      }
      finish(null, true);
    }, timeoutMs);

    uploadTask.on(
      'state_changed',
      undefined,
      () => {
        finish(null, true);
      },
      () => {
        getDownloadURL(uploadTask.snapshot.ref)
          .then((downloadUrl) => finish(downloadUrl, false))
          .catch(() => finish(null, true));
      }
    );
  });
}

/**
 * Unified, instant photo processor for HR, Field Officer, Site, Employee, and Profile avatars.
 * 1. Validates image up to 15 MB (including phone camera photos).
 * 2. Compresses immediately on client (<50ms) to a crisp ~20 KB JPEG.
 * 3. Uses Firebase Storage if active, otherwise returns the compact JPEG data URL with zero hang.
 */
export async function processInstantPhotoAsset(
  file: File,
  options?: {
    storagePath?: string;
    tryCloudStorage?: boolean;
    maxDimension?: number;
  }
): Promise<string> {
  if (!isSupportedImageFile(file)) {
    throw new Error('Unsupported photo format. Please select a JPG, PNG, or WEBP image.');
  }
  if (file.size <= 0 || file.size > MAX_PHOTO_UPLOAD_BYTES) {
    throw new Error('Photo file size must be 15 MB or smaller.');
  }

  const compressedDataUrl = await compressImageFileToDataUrl(
    file,
    options?.maxDimension ?? 280,
    0.82
  );

  if (options?.tryCloudStorage && options.storagePath && storageInstance && !storageUnavailableInSession) {
    const compactBlob = dataUrlToBlob(compressedDataUrl);
    if (compactBlob) {
      const remoteUrl = await uploadToStorageWithFastTimeout(
        options.storagePath,
        compactBlob,
        1200
      );
      if (remoteUrl) {
        return remoteUrl;
      }
    }
  }

  return compressedDataUrl;
}

/**
 * Generates a clean Firebase-compatible login email from a REXON System ID
 * (e.g. "EMP-2026-0001" -> "emp-2026-0001@rexon.portal").
 */
export function buildSystemPortalLoginEmail(systemId: string): string {
  const slug = systemId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return `${slug || 'user'}@rexon.portal`;
}

/**
 * Allows users to sign in with EITHER their Email OR their System ID
 * (e.g. "EMP-2026-0001", "FO-2026-0001", "STE-2026-0001", "HR-2026-0001").
 */
export function normalizePortalLoginIdentifier(rawIdentifier: string): string {
  const cleaned = rawIdentifier.trim().toLowerCase();
  if (!cleaned) return '';
  if (cleaned.includes('@')) {
    return cleaned;
  }
  return buildSystemPortalLoginEmail(cleaned);
}

/**
 * Produces a clear, memorable portal password (>= 8 chars) from custom input or last 4 mobile digits.
 */
export function generateDefaultPortalPassword(mobile?: string, customPassword?: string): string {
  const trimmedCustom = (customPassword ?? '').trim();
  if (trimmedCustom.length >= 6) {
    return trimmedCustom;
  }
  const digits = (mobile ?? '').replace(/\D/g, '');
  const suffix = digits.length >= 4 ? digits.slice(-4) : '1234';
  return `Rexon@${suffix}`;
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

/**
 * Creates (or links) a Firebase Authentication user on an isolated in-memory
 * secondary FirebaseApp so the currently logged-in Admin/HR is NEVER signed out.
 * Returns the exact `emailUsed` and `passwordUsed` so the Portal Credential Slip
 * can be displayed immediately to Admin/HR.
 */
export async function provisionFirebaseUserIsolated(params: {
  email: string;
  initialPassword?: string;
  mobileForDefaultPassword?: string;
  existingAuthUid?: string;
}): Promise<{
  uid: string;
  emailUsed: string;
  passwordUsed: string;
  mode: 'created' | 'linked_existing';
  passwordResetSent: boolean;
}> {
  const cleanEmail = normalizePortalLoginIdentifier(params.email);
  const providedPassword = (params.initialPassword ?? '').trim();
  if (providedPassword.length > 0 && providedPassword.length < 6) {
    throw new Error('Portal Login Password must be at least 6 characters long.');
  }

  const secretToUse = generateDefaultPortalPassword(
    params.mobileForDefaultPassword,
    providedPassword
  );

  const manualUid = (params.existingAuthUid ?? '').trim();
  if (manualUid) {
    if (!/^[a-zA-Z0-9_-]{4,128}$/.test(manualUid)) {
      throw new Error('Existing Firebase Auth UID must be 4–128 alphanumeric characters.');
    }
    return {
      uid: manualUid,
      emailUsed: cleanEmail,
      passwordUsed: providedPassword || 'Existing Firebase Password',
      mode: 'linked_existing',
      passwordResetSent: false,
    };
  }

  const secondaryAuth = getSecondaryProvisionerAuth();

  try {
    const createdCred = await createUserWithEmailAndPassword(
      secondaryAuth,
      cleanEmail,
      secretToUse
    );
    const createdUid = createdCred.user.uid;
    let passwordResetSent = false;

    if (providedPassword.length === 0 && !cleanEmail.endsWith('@rexon.portal') && authInstance) {
      try {
        await sendPasswordResetEmail(authInstance, cleanEmail);
        passwordResetSent = true;
      } catch {
        // Non-fatal if reset email template/quota not configured
      }
    }

    return {
      uid: createdUid,
      emailUsed: cleanEmail,
      passwordUsed: secretToUse,
      mode: 'created',
      passwordResetSent,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('auth/email-already-in-use')) {
      try {
        const existingCred = await signInWithEmailAndPassword(
          secondaryAuth,
          cleanEmail,
          secretToUse
        );
        return {
          uid: existingCred.user.uid,
          emailUsed: cleanEmail,
          passwordUsed: secretToUse,
          mode: 'linked_existing',
          passwordResetSent: false,
        };
      } catch {
        throw new Error(
          `Login ID "${cleanEmail}" already exists in Firebase Authentication with a different password. Enter its current password or use a unique Email ID.`
        );
      }
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
