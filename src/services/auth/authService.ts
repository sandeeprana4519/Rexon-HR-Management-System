import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import { RexonUser } from '../../types';
import { firebaseAuth, isFirebaseConfigured } from '../firebase/config';
import { fetchVerifiedUserProfile, recordAuditEvent } from '../firestore/userRoleService';

export interface PortalSignInResult {
  userProfile: RexonUser;
}

/**
 * Authenticates a user with Firebase Auth and immediately verifies their
 * `users/{uid}` role and `isActive` flag in Cloud Firestore.
 */
export async function signInWithVerifiedRole(
  email: string,
  password: string
): Promise<PortalSignInResult> {
  if (!isFirebaseConfigured || !firebaseAuth) {
    throw new Error(
      'Firebase Authentication is not configured. Supply VITE_FIREBASE_* variables in .env to enable live sign-in.'
    );
  }

  const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
  const uid = credential.user.uid;

  const verifiedProfile = await fetchVerifiedUserProfile(uid);

  if (!verifiedProfile) {
    await signOut(firebaseAuth);
    throw new Error(
      `Authenticated account (${uid}) has no provisioned Firestore role document at "users/${uid}". Contact the REXON System Administrator.`
    );
  }

  if (!verifiedProfile.isActive) {
    await signOut(firebaseAuth);
    throw new Error(
      'Your REXON user profile is marked inactive. Contact HR or the System Administrator to restore access.'
    );
  }

  // Best-effort non-blocking audit log on live sign-in
  try {
    await recordAuditEvent({
      actorUid: verifiedProfile.uid,
      actorRole: verifiedProfile.role,
      action: 'PORTAL_SIGN_IN',
      targetPath: `users/${verifiedProfile.uid}`,
      branchId: verifiedProfile.branchId,
    });
  } catch {
    // Do not block sign-in if audit log rule requires verified email or additional setup
  }

  return { userProfile: verifiedProfile };
}

/**
 * Triggers a Firebase password reset email for the supplied account address.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!isFirebaseConfigured || !firebaseAuth) {
    throw new Error(
      'Password reset emails are unavailable because Firebase Authentication is not configured (.env missing).'
    );
  }

  await sendPasswordResetEmail(firebaseAuth, email.trim());
}

/**
 * Re-authenticates the active user with their current password and updates to a new password.
 */
export async function changeUserPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (!isFirebaseConfigured || !firebaseAuth) {
    throw new Error(
      'Password changes are disabled in Development Preview Mode because Firebase Authentication is not configured.'
    );
  }

  const currentUser = firebaseAuth.currentUser;
  if (!currentUser || !currentUser.email) {
    throw new Error('No active authenticated Firebase user session found.');
  }

  const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
  await reauthenticateWithCredential(currentUser, credential);
  await updatePassword(currentUser, newPassword);
}
