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
  authenticatePreviewProvisionedUser,
  fetchVerifiedUserProfile,
  loadActivePreviewCustomUser,
  readLocalAvatarFallback,
  saveActivePreviewCustomUserUid,
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
  loginWithEmail: (emailOrSystemId: string, password: string) => Promise<RexonUser>;
  enterPreviewPortal: (role: UserRole) => void;
  updateProfileInfo: (updates: {
    fullName: string;
    phone: string;
    profilePhoto?: string;
  }) => Promise<void>;
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
      const customPreviewUser = loadActivePreviewCustomUser();
      if (customPreviewUser) {
        if (!customPreviewUser.isActive) {
          saveActivePreviewCustomUserUid(null);
          void executeLogout(customPreviewUser.role);
          setAuthError('This portal account is currently marked Inactive by Administration.');
          setUser(null);
        } else {
          const cachedAvatar = readLocalAvatarFallback(customPreviewUser.uid);
          setUser({
            ...customPreviewUser,
            ...(cachedAvatar ? { profilePhoto: cachedAvatar } : {}),
          });
          setIsPreviewSession(true);
          setShowSampleLayoutData(true);
        }
        setLoading(false);
        return;
      }

      const savedDemoRole = loadPreviewRoleSession();
      if (savedDemoRole) {
        const base = buildDemoProfileByRole(savedDemoRole);
        const { user: resolved, accountStatus } = resolvePreviewHRUserOverlay(base);
        if (accountStatus !== 'Active') {
          void executeLogout(savedDemoRole);
          setAuthError(`This HR account is currently marked ${accountStatus} by Administration.`);
          setUser(null);
        } else {
          const cachedAvatar = readLocalAvatarFallback(resolved.uid);
          setUser({
            ...resolved,
            ...(cachedAvatar ? { profilePhoto: cachedAvatar } : {}),
          });
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
        saveActivePreviewCustomUserUid(null);
        void executeLogout('hr');
        setUser(null);
        setIsPreviewSession(false);
        setAuthError(`HR account status changed to ${accountStatus} by Administration.`);
        return;
      }
      setUser(synced);
    });
  }, [isPreviewSession, user]);

  const loginWithEmail = useCallback(async (emailOrSystemId: string, password: string): Promise<RexonUser> => {
    setAuthError(null);

    if (isFirebaseConfigured) {
      const { userProfile } = await signInWithVerifiedRole(emailOrSystemId, password);
      setUser(userProfile);
      setIsPreviewSession(false);
      return userProfile;
    }

    // 1. Check newly created Preview Portal Accounts (HR, Field Officer, Site, Employee)
    const customPreviewMatch = authenticatePreviewProvisionedUser(emailOrSystemId, password);
    if (customPreviewMatch) {
      if (!customPreviewMatch.isActive) {
        throw new Error('Your REXON portal account is currently marked Inactive by Administration.');
      }
      savePreviewRoleSession(customPreviewMatch.role);
      saveActivePreviewCustomUserUid(customPreviewMatch.uid);
      const cachedAvatar = readLocalAvatarFallback(customPreviewMatch.uid);
      const resolvedCustom: RexonUser = {
        ...customPreviewMatch,
        ...(cachedAvatar ? { profilePhoto: cachedAvatar } : {}),
      };
      setUser(resolvedCustom);
      setIsPreviewSession(true);
      setShowSampleLayoutData(true);
      return resolvedCustom;
    }

    // 2. Check built-in Demo Credentials
    const demoUser = verifyDemoCredentials(emailOrSystemId, password);
    if (demoUser) {
      const { user: resolved, accountStatus } = resolvePreviewHRUserOverlay(demoUser);
      if (accountStatus !== 'Active') {
        throw new Error(`Your HR account is marked ${accountStatus} by Administration.`);
      }
      saveActivePreviewCustomUserUid(null);
      savePreviewRoleSession(resolved.role);
      const cachedAvatar = readLocalAvatarFallback(resolved.uid);
      const withAvatar: RexonUser = {
        ...resolved,
        ...(cachedAvatar ? { profilePhoto: cachedAvatar } : {}),
      };
      setUser(withAvatar);
      setIsPreviewSession(true);
      setShowSampleLayoutData(true);
      return withAvatar;
    }

    throw new Error(
      'Invalid Login ID / Email or Password. Verify your issued Portal Login ID & Password or contact Administration.'
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
    saveActivePreviewCustomUserUid(null);
    savePreviewRoleSession(role);
    setUser(resolved);
    setIsPreviewSession(true);
    setShowSampleLayoutData(true);
    setAuthError(null);
  }, []);

  const updateProfileInfo = useCallback(
    async (updates: { fullName: string; phone: string; profilePhoto?: string }) => {
      if (!user) {
        throw new Error('No user session active.');
      }

      await updateOwnUserProfile(user.uid, updates);

      if (isPreviewSession || !isFirebaseConfigured) {
        setUser((prev) =>
          prev
            ? {
                ...prev,
                fullName: updates.fullName.trim(),
                phone: updates.phone.trim(),
                ...(updates.profilePhoto !== undefined
                  ? { profilePhoto: updates.profilePhoto || undefined }
                  : {}),
                updatedAt: new Date().toISOString(),
              }
            : null
        );
        return;
      }

      const refreshed = await fetchVerifiedUserProfile(user.uid);
      if (refreshed) {
        setUser({
          ...refreshed,
          ...(updates.profilePhoto !== undefined && updates.profilePhoto
            ? { profilePhoto: updates.profilePhoto }
            : {}),
        });
      }
    },
    [user, isPreviewSession]
  );

  const logout = useCallback(async (): Promise<string> => {
    const lastRole = user?.role ?? null;
    saveActivePreviewCustomUserUid(null);
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
