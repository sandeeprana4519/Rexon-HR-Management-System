import { signOut } from 'firebase/auth';
import { UserRole } from '../../types';
import { getPortalByRole } from '../../utils/portalConfig';
import { firebaseAuth, isFirebaseConfigured } from '../firebase/config';

const PREVIEW_STORAGE_KEY = 'rexon_dev_preview_role_v1';

export function clearPreviewRoleSession(): void {
  try {
    sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
  } catch {
    // Ignore storage access restrictions
  }
}

export function savePreviewRoleSession(role: UserRole): void {
  try {
    sessionStorage.setItem(PREVIEW_STORAGE_KEY, role);
  } catch {
    // Ignore storage access restrictions
  }
}

export function loadPreviewRoleSession(): UserRole | null {
  try {
    const val = sessionStorage.getItem(PREVIEW_STORAGE_KEY);
    if (
      val === 'admin' ||
      val === 'hr' ||
      val === 'field_officer' ||
      val === 'site' ||
      val === 'employee'
    ) {
      return val;
    }
    return null;
  } catch {
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
