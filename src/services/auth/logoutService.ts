import { signOut } from 'firebase/auth';
import { UserRole } from '../../types';
import { DEMO_ACCOUNTS } from '../../utils/demoCredentials';
import { getPortalByRole, isValidUserRole } from '../../utils/portalConfig';
import { firebaseAuth, isFirebaseConfigured } from '../firebase/config';

const PREVIEW_STORAGE_KEY = 'rexon_dev_preview_role_v2';
const LEGACY_PREVIEW_STORAGE_KEY = 'rexon_dev_preview_role_v1';

function computePreviewSessionSignature(role: UserRole): string {
  const acct = DEMO_ACCOUNTS[role];
  const raw = `REXON_PREVIEW_SIG_2026::${role}::${acct.portalLabel}::${acct.email}::${acct.branchId}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function clearPreviewRoleSession(): void {
  try {
    sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_PREVIEW_STORAGE_KEY);
  } catch {
    // Ignore storage access restrictions
  }
}

export function savePreviewRoleSession(role: UserRole): void {
  if (isFirebaseConfigured) {
    clearPreviewRoleSession();
    return;
  }
  try {
    clearPreviewRoleSession();
    const payload = JSON.stringify({
      role,
      sig: computePreviewSessionSignature(role),
    });
    sessionStorage.setItem(PREVIEW_STORAGE_KEY, payload);
  } catch {
    // Ignore storage access restrictions
  }
}

export function loadPreviewRoleSession(): UserRole | null {
  if (isFirebaseConfigured) {
    clearPreviewRoleSession();
    return null;
  }
  try {
    // Remove any legacy unsigned v1 session key
    sessionStorage.removeItem(LEGACY_PREVIEW_STORAGE_KEY);
    const raw = sessionStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { role?: unknown; sig?: unknown };
    if (!isValidUserRole(parsed?.role) || typeof parsed?.sig !== 'string') {
      clearPreviewRoleSession();
      return null;
    }
    const expectedSig = computePreviewSessionSignature(parsed.role);
    if (parsed.sig !== expectedSig) {
      clearPreviewRoleSession();
      return null;
    }
    return parsed.role;
  } catch {
    clearPreviewRoleSession();
    return null;
  }
}

/**
 * Signs the user out of Firebase Authentication (when configured) and clears
 * any local Development Preview session state, returning the portal login path.
 */
export async function executeLogout(lastKnownRole?: UserRole | null): Promise<string> {
  clearPreviewRoleSession();

  if (isFirebaseConfigured && firebaseAuth) {
    await signOut(firebaseAuth);
  }

  if (lastKnownRole) {
    return getPortalByRole(lastKnownRole).loginPath;
  }
  return '/admin/login';
}
