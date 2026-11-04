import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { OperationType, RexonUser, UserRole } from '../../types';
import { isValidUserRole, normalizePermissionList } from '../../utils/portalConfig';
import { sanitizeInput } from '../../utils/validation';
import {
  firebaseAuth,
  firestoreDb,
  isFirebaseConfigured,
  normalizePortalLoginIdentifier,
} from '../firebase/config';
import { handleFirestoreError } from './errorHandler';

const BOOTSTRAPPED_ADMIN_UID = 'Z8PuegekpDQiPzGIzleDYUVkjqI3';
const LOCAL_AVATAR_CACHE_KEY = 'rexon_user_avatar_cache_v1';
const PREVIEW_PORTAL_USERS_KEY = 'rexon_preview_portal_users_v1';
const ACTIVE_PREVIEW_CUSTOM_UID_KEY = 'rexon_active_preview_custom_uid_v1';

function readAvatarCacheMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LOCAL_AVATAR_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

export function readLocalAvatarFallback(uid: string): string {
  const map = readAvatarCacheMap();
  return typeof map[uid] === 'string' ? map[uid] : '';
}

export function saveLocalAvatarFallback(uid: string, photoDataUrl: string): void {
  try {
    const map = readAvatarCacheMap();
    if (photoDataUrl) {
      map[uid] = photoDataUrl;
    } else {
      delete map[uid];
    }
    localStorage.setItem(LOCAL_AVATAR_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Ignore localStorage quota restrictions
  }
}

export function listPreviewProvisionedUsers(): RexonUser[] {
  try {
    const raw = localStorage.getItem(PREVIEW_PORTAL_USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RexonUser =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as RexonUser).uid === 'string' &&
        isValidUserRole((item as RexonUser).role)
    );
  } catch {
    return [];
  }
}

export function upsertPreviewProvisionedUser(userRecord: RexonUser): void {
  try {
    const existing = listPreviewProvisionedUsers();
    const idx = existing.findIndex(
      (u) =>
        u.uid === userRecord.uid ||
        (userRecord.email && u.email.toLowerCase() === userRecord.email.toLowerCase())
    );
    const next = [...existing];
    if (idx >= 0) {
      next[idx] = { ...next[idx], ...userRecord };
    } else {
      next.unshift(userRecord);
    }
    localStorage.setItem(PREVIEW_PORTAL_USERS_KEY, JSON.stringify(next));
  } catch {
    // Ignore localStorage write errors
  }
}

export function saveActivePreviewCustomUserUid(uid: string | null): void {
  try {
    if (!uid) {
      sessionStorage.removeItem(ACTIVE_PREVIEW_CUSTOM_UID_KEY);
      return;
    }
    sessionStorage.setItem(ACTIVE_PREVIEW_CUSTOM_UID_KEY, uid);
  } catch {
    // Ignore sessionStorage restrictions
  }
}

export function loadActivePreviewCustomUser(): RexonUser | null {
  try {
    const uid = sessionStorage.getItem(ACTIVE_PREVIEW_CUSTOM_UID_KEY);
    if (!uid) return null;
    const found = listPreviewProvisionedUsers().find((u) => u.uid === uid);
    return found ?? null;
  } catch {
    return null;
  }
}

export function authenticatePreviewProvisionedUser(
  rawIdentifier: string,
  password: string
): RexonUser | null {
  const normalizedEmail = normalizePortalLoginIdentifier(rawIdentifier);
  const rawLower = rawIdentifier.trim().toLowerCase();
  const candidates = listPreviewProvisionedUsers();

  const match = candidates.find(
    (u) =>
      u.email.trim().toLowerCase() === normalizedEmail ||
      u.email.trim().toLowerCase() === rawLower ||
      (u.systemId && u.systemId.trim().toLowerCase() === rawLower)
  );
  if (!match) return null;
  if (match.initialAccessKey && match.initialAccessKey !== password) {
    return null;
  }
  return match;
}

export function updatePreviewProvisionedUserPassword(
  uid: string,
  currentPassword: string,
  newPassword: string
): void {
  const all = listPreviewProvisionedUsers();
  const target = all.find((u) => u.uid === uid);
  if (!target) {
    throw new Error(
      'Built-in static Demo accounts use the shared testing password. Create a new HR, Field Officer, Site, or Employee account to test custom password changes in Preview Mode, or connect Firebase Auth.'
    );
  }
  if (target.initialAccessKey && target.initialAccessKey !== currentPassword) {
    throw new Error('Current password does not match your active portal password.');
  }
  upsertPreviewProvisionedUser({
    ...target,
    initialAccessKey: newPassword,
    updatedAt: new Date().toISOString(),
  });
}

function formatTimestampField(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val.length > 0) {
    return val;
  }
  return new Date().toISOString();
}

export function parseFirestoreUserDocument(uid: string, raw: Record<string, unknown>): RexonUser {
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

  const storedPhoto = typeof raw.profilePhoto === 'string' ? raw.profilePhoto : '';
  const resolvedPhoto = storedPhoto || readLocalAvatarFallback(uid);

  return {
    uid,
    ...(typeof raw.systemId === 'string' && raw.systemId.trim()
      ? { systemId: raw.systemId.trim() }
      : {}),
    fullName: typeof raw.fullName === 'string' ? raw.fullName : 'Unnamed User',
    email: typeof raw.email === 'string' ? raw.email : '',
    phone: typeof raw.phone === 'string' ? raw.phone : '',
    ...(resolvedPhoto ? { profilePhoto: resolvedPhoto } : {}),
    ...(typeof raw.designationLabel === 'string' && raw.designationLabel.trim()
      ? { designationLabel: raw.designationLabel.trim() }
      : {}),
    ...(typeof raw.initialAccessKey === 'string' && raw.initialAccessKey.trim()
      ? { initialAccessKey: raw.initialAccessKey.trim() }
      : {}),
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
        systemId: 'ADM-0001',
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
 * Updates permitted self-profile fields (`fullName`, `phone`, and `profilePhoto`) in `users/{uid}`.
 * RBAC attributes (`role`, `branchId`, `assignedSiteIds`, `permissions`, `isActive`) are
 * never modified by self-profile updates and are enforced by Firestore Security Rules.
 */
export async function updateOwnUserProfile(
  uid: string,
  updates: { fullName: string; phone: string; profilePhoto?: string }
): Promise<void> {
  if (updates.profilePhoto !== undefined) {
    saveLocalAvatarFallback(uid, updates.profilePhoto);
  }

  if (!isFirebaseConfigured || !firestoreDb) {
    const previewMatch = listPreviewProvisionedUsers().find((u) => u.uid === uid);
    if (previewMatch) {
      upsertPreviewProvisionedUser({
        ...previewMatch,
        fullName: sanitizeInput(updates.fullName, 120),
        phone: sanitizeInput(updates.phone, 20),
        ...(updates.profilePhoto !== undefined ? { profilePhoto: updates.profilePhoto } : {}),
        updatedAt: new Date().toISOString(),
      });
    }
    return;
  }

  const sanitizedName = sanitizeInput(updates.fullName, 120);
  const sanitizedPhone = sanitizeInput(updates.phone, 20);
  const path = `users/${uid}`;

  try {
    await updateDoc(doc(firestoreDb, 'users', uid), {
      fullName: sanitizedName,
      phone: sanitizedPhone,
      ...(updates.profilePhoto !== undefined ? { profilePhoto: updates.profilePhoto } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (firstErr) {
    // Graceful compatibility fallback if live deployed rules restrict non-admin affectedKeys to fullName/phone/updatedAt
    if (updates.profilePhoto !== undefined) {
      try {
        await updateDoc(doc(firestoreDb, 'users', uid), {
          fullName: sanitizedName,
          phone: sanitizedPhone,
          updatedAt: serverTimestamp(),
        });
        return;
      } catch (retryErr) {
        handleFirestoreError(retryErr, OperationType.UPDATE, path);
      }
    }
    handleFirestoreError(firstErr, OperationType.UPDATE, path);
  }
}

/**
 * Best-effort sync of changed password metadata so Admin Credential Directory reflects latest user-updated password.
 */
export async function syncOwnChangedPasswordHint(
  uid: string,
  newPassword: string,
  isPreviewSession: boolean
): Promise<void> {
  if (isPreviewSession || !isFirebaseConfigured || !firestoreDb) {
    const match = listPreviewProvisionedUsers().find((u) => u.uid === uid);
    if (match) {
      upsertPreviewProvisionedUser({
        ...match,
        initialAccessKey: newPassword,
        updatedAt: new Date().toISOString(),
      });
    }
    return;
  }

  try {
    await updateDoc(doc(firestoreDb, 'users', uid), {
      initialAccessKey: newPassword,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking if non-admin rules restrict initialAccessKey self-updates
  }
}

/**
 * Fetches a single provisioned portal user document (`users/{uid}`) for Admin / authorized HR credential inspection.
 */
export async function getPortalUserByUid(
  caller: RexonUser,
  uid: string,
  isPreviewSession: boolean
): Promise<RexonUser | null> {
  if (!uid) return null;
  if (caller.role !== 'admin' && caller.role !== 'hr' && caller.uid !== uid) {
    throw new Error('Unauthorized: Only Admin or authorized HR can inspect portal user records.');
  }

  if (isPreviewSession || !isFirebaseConfigured || !firestoreDb) {
    return listPreviewProvisionedUsers().find((u) => u.uid === uid) ?? null;
  }

  try {
    const snap = await getDoc(doc(firestoreDb, 'users', uid));
    if (!snap.exists()) return null;
    return parseFirestoreUserDocument(snap.id, snap.data() as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Lists all provisioned portal user accounts (`HR`, `Field Officer`, `Site`, `Employee`, `Admin`)
 * strictly restricted to Admin (global) or authorized HR (branch-scoped).
 */
export async function listAllProvisionedPortalUsers(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<RexonUser[]> {
  if (caller.role !== 'admin' && caller.role !== 'hr') {
    throw new Error('Unauthorized: Portal Credentials Directory is restricted to System Administration.');
  }

  if (isPreviewSession || !isFirebaseConfigured || !firestoreDb) {
    const allPreview = listPreviewProvisionedUsers();
    if (caller.role === 'admin') return allPreview;
    return allPreview.filter((u) => u.branchId === caller.branchId);
  }

  const path = 'users';
  try {
    const q =
      caller.role === 'admin'
        ? collection(firestoreDb, 'users')
        : query(collection(firestoreDb, 'users'), where('branchId', '==', caller.branchId));
    const snap = await getDocs(q);
    const list: RexonUser[] = [];
    snap.docs.forEach((docSnap) => {
      try {
        list.push(parseFirestoreUserDocument(docSnap.id, docSnap.data() as Record<string, unknown>));
      } catch {
        // Skip malformed user docs
      }
    });
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
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
