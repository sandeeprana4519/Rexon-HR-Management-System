import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { OperationType, RexonUser, UserRole } from '../../types';
import { isValidUserRole } from '../../utils/portalConfig';
import { sanitizeInput } from '../../utils/validation';
import { firestoreDb, isFirebaseConfigured } from '../firebase/config';
import { handleFirestoreError } from './errorHandler';

function formatTimestampField(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val.length > 0) {
    return val;
  }
  return new Date().toISOString();
}

function parseFirestoreUserDocument(uid: string, raw: Record<string, unknown>): RexonUser {
  if (!isValidUserRole(raw.role)) {
    throw new Error(
      `User profile "users/${uid}" has an unrecognized or missing role attribute.`
    );
  }

  return {
    uid,
    fullName: typeof raw.fullName === 'string' ? raw.fullName : 'Unnamed User',
    email: typeof raw.email === 'string' ? raw.email : '',
    phone: typeof raw.phone === 'string' ? raw.phone : '',
    role: raw.role as UserRole,
    branchId: typeof raw.branchId === 'string' ? raw.branchId : 'UNASSIGNED',
    assignedSiteIds: Array.isArray(raw.assignedSiteIds)
      ? raw.assignedSiteIds.filter((item): item is string => typeof item === 'string').slice(0, 50)
      : [],
    permissions: Array.isArray(raw.permissions)
      ? raw.permissions.filter((item): item is string => typeof item === 'string').slice(0, 40)
      : [],
    isActive: Boolean(raw.isActive),
    createdAt: formatTimestampField(raw.createdAt),
    updatedAt: formatTimestampField(raw.updatedAt),
  };
}

/**
 * Verifies the authenticated user's actual role and status from Firestore `users/{uid}`.
 * Never trusts role claims passed from client routes or forms.
 */
export async function fetchVerifiedUserProfile(uid: string): Promise<RexonUser | null> {
  if (!isFirebaseConfigured || !firestoreDb) {
    throw new Error('Firebase Firestore is not configured. Missing VITE_FIREBASE_* credentials.');
  }

  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(firestoreDb, 'users', uid));
    if (!snap.exists()) {
      return null;
    }
    return parseFirestoreUserDocument(uid, snap.data() as Record<string, unknown>);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Updates only permitted self-profile fields (`fullName` and `phone`) in `users/{uid}`.
 * RBAC attributes (`role`, `branchId`, `assignedSiteIds`, `permissions`, `isActive`) are
 * never modified by self-profile updates and are enforced by Firestore Security Rules.
 */
export async function updateOwnUserProfile(
  uid: string,
  updates: { fullName: string; phone: string }
): Promise<void> {
  if (!isFirebaseConfigured || !firestoreDb) {
    throw new Error(
      'Cannot write profile updates in Development Preview Mode because Firebase is not configured.'
    );
  }

  const sanitizedName = sanitizeInput(updates.fullName, 120);
  const sanitizedPhone = sanitizeInput(updates.phone, 20);
  const path = `users/${uid}`;

  try {
    await updateDoc(doc(firestoreDb, 'users', uid), {
      fullName: sanitizedName,
      phone: sanitizedPhone,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Writes an immutable append-only audit log entry when live Firestore is active.
 */
export async function recordAuditEvent(params: {
  actorUid: string;
  actorRole: UserRole;
  action: string;
  targetPath: string;
  branchId?: string;
}): Promise<void> {
  if (!isFirebaseConfigured || !firestoreDb) {
    return;
  }

  const path = 'auditLogs';
  try {
    await addDoc(collection(firestoreDb, path), {
      actorUid: params.actorUid,
      actorRole: params.actorRole,
      action: sanitizeInput(params.action, 120),
      targetPath: sanitizeInput(params.targetPath, 200),
      ...(params.branchId ? { branchId: sanitizeInput(params.branchId, 64) } : {}),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}
