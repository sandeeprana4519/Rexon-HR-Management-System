import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { OperationType, RexonUser, UserRole } from '../../types';
import { isValidUserRole, normalizePermissionList } from '../../utils/portalConfig';
import { sanitizeInput } from '../../utils/validation';
import { firebaseAuth, firestoreDb, isFirebaseConfigured } from '../firebase/config';
import { handleFirestoreError } from './errorHandler';

const BOOTSTRAPPED_ADMIN_UID = 'Z8PuegekpDQiPzGIzleDYUVkjqI3';

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

  const branchId =
    typeof raw.branchId === 'string' && raw.branchId.trim().length > 0
      ? raw.branchId.trim()
      : 'UNASSIGNED';

  const parsedAssignedBranches = Array.isArray(raw.assignedBranches)
    ? Array.from(
        new Set(
          raw.assignedBranches
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((item) => item.trim())
        )
      ).slice(0, 25)
    : [];

  const assignedBranches =
    parsedAssignedBranches.length > 0
      ? parsedAssignedBranches
      : branchId !== 'UNASSIGNED'
        ? [branchId]
        : [];

  const rawPermissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter((item): item is string => typeof item === 'string').slice(0, 40)
    : [];

  return {
    uid,
    fullName: typeof raw.fullName === 'string' ? raw.fullName : 'Unnamed User',
    email: typeof raw.email === 'string' ? raw.email : '',
    phone: typeof raw.phone === 'string' ? raw.phone : '',
    role: raw.role as UserRole,
    branchId,
    assignedBranches,
    assignedSiteIds: Array.isArray(raw.assignedSiteIds)
      ? raw.assignedSiteIds.filter((item): item is string => typeof item === 'string').slice(0, 50)
      : [],
    permissions: normalizePermissionList(rawPermissions),
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
  let existingData: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(doc(firestoreDb, 'users', uid));
    if (snap.exists()) {
      existingData = snap.data() as Record<string, unknown>;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!existingData) {
    if (uid === BOOTSTRAPPED_ADMIN_UID) {
      const nowIso = new Date().toISOString();
      const bootstrapDoc: Record<string, unknown> = {
        uid: BOOTSTRAPPED_ADMIN_UID,
        fullName: 'Admin',
        email: sanitizeInput(firebaseAuth?.currentUser?.email || 'admin@rexon.com', 160),
        phone: '+919876543210',
        role: 'admin',
        branchId: 'HQ',
        assignedBranches: [],
        assignedSiteIds: [],
        permissions: [],
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      try {
        await setDoc(doc(firestoreDb, 'users', uid), bootstrapDoc);
      } catch (writeErr) {
        handleFirestoreError(writeErr, OperationType.CREATE, path);
      }
      return parseFirestoreUserDocument(uid, bootstrapDoc);
    }
    return null;
  }

  return parseFirestoreUserDocument(uid, existingData);
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
