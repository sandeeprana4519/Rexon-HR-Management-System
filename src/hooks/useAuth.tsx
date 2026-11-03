import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { RexonUser, UserRole } from '../types';
import {
  buildDemoProfileByRole,
  verifyDemoCredentials,
} from '../utils/demoCredentials';
import { signInWithVerifiedRole } from '../services/auth/authService';
import {
  executeLogout,
  loadPreviewRoleSession,
  savePreviewRoleSession,
} from '../services/auth/logoutService';
import {
  configuredProjectId,
  firebaseAuth,
  isFirebaseConfigured,
  missingFirebaseEnvKeys,
} from '../services/firebase/config';
import {
  resolvePreviewHRUserOverlay,
  subscribeMasterData,
} from '../services/firestore/masterDataService';
import {
  fetchVerifiedUserProfile,
  updateOwnUserProfile,
} from '../services/firestore/userRoleService';

interface AuthContextValue {
  user: RexonUser | null;
  loading: boolean;
  authError: string | null;
  isFirebaseConfigured: boolean;
  configuredProjectId: string | null;
  missingEnvKeys: string[];
  isPreviewSession: boolean;
  showSampleLayoutData: boolean;
  setShowSampleLayoutData: (val: boolean) => void;
  loginWithEmail: (email: string, password: string) => Promise<RexonUser>;
  enterPreviewPortal: (role: UserRole) => void;
  updateProfileInfo: (updates: { fullName: string; phone: string }) => Promise<void>;
  logout: () => Promise<string>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<RexonUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isPreviewSession, setIsPreviewSession] = useState<boolean>(false);
  const [showSampleLayoutData, setShowSampleLayoutData] = useState<boolean>(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      const savedDemoRole = loadPreviewRoleSession();
      if (savedDemoRole) {
        const base = buildDemoProfileByRole(savedDemoRole);
        const { user: resolved, accountStatus } = resolvePreviewHRUserOverlay(base);
        if (accountStatus !== 'Active') {
          void executeLogout(savedDemoRole);
          setAuthError(`This HR account is currently marked ${accountStatus} by Administration.`);
          setUser(null);
        } else {
          setUser(resolved);
          setIsPreviewSession(true);
          setShowSampleLayoutData(true);
        }
        setLoading(false);
        return;
      }

      setLoading(false);
      return;
    }

    if (!firebaseAuth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (fbUser) => {
      setLoading(true);
      setAuthError(null);

      if (!fbUser) {
        setUser(null);
        setIsPreviewSession(false);
        setLoading(false);
        return;
      }

      try {
        const verifiedProfile = await fetchVerifiedUserProfile(fbUser.uid);
        if (!verifiedProfile) {
          setAuthError(
            `Authenticated account (${fbUser.email ?? fbUser.uid}) does not have a Firestore user document at "users/${fbUser.uid}".`
          );
          await executeLogout(null);
          setUser(null);
        } else if (!verifiedProfile.isActive) {
          setAuthError('Your REXON account is currently marked inactive by Administration.');
          await executeLogout(verifiedProfile.role);
          setUser(null);
        } else {
          setUser(verifiedProfile);
          setIsPreviewSession(false);
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Failed to verify user role from Firestore.');
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Keep Preview HR session permissions & branch scope dynamically synced when Admin updates HR permissions
  useEffect(() => {
    if (!isPreviewSession || !user || user.role !== 'hr') return;
    return subscribeMasterData(() => {
      const { user: synced, accountStatus } = resolvePreviewHRUserOverlay(user);
      if (accountStatus !== 'Active') {
        void executeLogout('hr');
        setUser(null);
        setIsPreviewSession(false);
        setAuthError(`HR account status changed to ${accountStatus} by Administration.`);
        return;
      }
      setUser(synced);
    });
  }, [isPreviewSession, user]);

  const loginWithEmail = useCallback(async (email: string, password: string): Promise<RexonUser> => {
    setAuthError(null);

    if (isFirebaseConfigured) {
      const { userProfile } = await signInWithVerifiedRole(email, password);
      setUser(userProfile);
      setIsPreviewSession(false);
      return userProfile;
    }

    const demoUser = verifyDemoCredentials(email, password);
    if (demoUser) {
      const { user: resolved, accountStatus } = resolvePreviewHRUserOverlay(demoUser);
      if (accountStatus !== 'Active') {
        throw new Error(`Your HR account is marked ${accountStatus} by Administration.`);
      }
      savePreviewRoleSession(resolved.role);
      setUser(resolved);
      setIsPreviewSession(true);
      setShowSampleLayoutData(true);
      return resolved;
    }

    throw new Error(
      'Invalid email or password. Use the testing Demo ID & Password listed below, or configure Firebase (.env) for live accounts.'
    );
  }, []);

  const enterPreviewPortal = useCallback((role: UserRole) => {
    if (isFirebaseConfigured) {
      setAuthError('Development Preview mode is disabled when live Firebase Authentication is configured.');
      return;
    }
    const demoProfile = buildDemoProfileByRole(role);
    const { user: resolved, accountStatus } = resolvePreviewHRUserOverlay(demoProfile);
    if (accountStatus !== 'Active') {
      setAuthError(`This HR account is marked ${accountStatus} by Administration.`);
      return;
    }
    savePreviewRoleSession(role);
    setUser(resolved);
    setIsPreviewSession(true);
    setShowSampleLayoutData(true);
    setAuthError(null);
  }, []);

  const updateProfileInfo = useCallback(
    async (updates: { fullName: string; phone: string }) => {
      if (!user) {
        throw new Error('No user session active.');
      }

      if (isPreviewSession || !isFirebaseConfigured) {
        setUser((prev) =>
          prev
            ? {
                ...prev,
                fullName: updates.fullName.trim(),
                phone: updates.phone.trim(),
                updatedAt: new Date().toISOString(),
              }
            : null
        );
        return;
      }

      await updateOwnUserProfile(user.uid, updates);
      const refreshed = await fetchVerifiedUserProfile(user.uid);
      if (refreshed) {
        setUser(refreshed);
      }
    },
    [user, isPreviewSession]
  );

  const logout = useCallback(async (): Promise<string> => {
    const lastRole = user?.role ?? null;
    const redirectPath = await executeLogout(lastRole);
    setUser(null);
    setIsPreviewSession(false);
    return redirectPath;
  }, [user]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      authError,
      isFirebaseConfigured,
      configuredProjectId,
      missingEnvKeys: missingFirebaseEnvKeys,
      isPreviewSession,
      showSampleLayoutData,
      setShowSampleLayoutData,
      loginWithEmail,
      enterPreviewPortal,
      updateProfileInfo,
      logout,
      clearAuthError,
    }),
    [
      user,
      loading,
      authError,
      isPreviewSession,
      showSampleLayoutData,
      loginWithEmail,
      enterPreviewPortal,
      updateProfileInfo,
      logout,
      clearAuthError,
    ]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return ctx;
}
