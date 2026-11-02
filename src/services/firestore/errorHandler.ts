import { FirestoreErrorInfo, OperationType } from '../../types';
import { firebaseAuth } from '../firebase/config';

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = firebaseAuth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
  };

  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatServiceErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'An unexpected error occurred. Please try again.';
  }

  // Check if structured JSON from handleFirestoreError
  try {
    const parsed = JSON.parse(error.message) as Partial<FirestoreErrorInfo>;
    if (parsed && typeof parsed.error === 'string') {
      if (parsed.error.includes('Missing or insufficient permissions')) {
        return 'Access denied by Firestore Security Rules. Verify your assigned role, branch, and site permissions.';
      }
      if (parsed.error.includes('Quota exceeded')) {
        return 'Firestore daily quota exceeded. Operations will resume after quota reset or plan upgrade.';
      }
      return parsed.error;
    }
  } catch {
    // Plain Error message
  }

  const msg = error.message;
  if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/user-not-found')) {
    return 'Invalid email address or password. Verify your credentials and try again.';
  }
  if (msg.includes('auth/too-many-requests')) {
    return 'Too many unsuccessful sign-in attempts. Please wait a few minutes or reset your password.';
  }
  if (msg.includes('auth/user-disabled')) {
    return 'This account has been deactivated by an administrator.';
  }
  if (msg.includes('auth/requires-recent-login')) {
    return 'Please re-enter your current password to verify your identity before changing your password.';
  }
  if (msg.includes('auth/network-request-failed')) {
    return 'Network error while contacting Firebase Authentication. Check your internet connection.';
  }
  return msg;
}
