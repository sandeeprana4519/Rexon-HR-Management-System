import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LoadingScreen } from '../components/LoadingScreen';
import { useAuth } from '../hooks/useAuth';
import { UserRole } from '../types';
import { getPortalByRole } from '../utils/portalConfig';

interface ProtectedRouteProps {
  allowedRole: UserRole;
  children: React.ReactNode;
}

/**
 * Enforces strict portal-level RBAC.
 * - Never trusts manual URL entry.
 * - Unauthenticated visitors are sent to that specific portal's login screen.
 * - Authenticated users whose verified Firestore role does not match `allowedRole`
 *   are blocked and routed to `/unauthorized` with full context.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRole, children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const targetPortal = getPortalByRole(allowedRole);

  if (loading) {
    return (
      <LoadingScreen
        message={`Verifying ${targetPortal.shortTitle} credentials against Firestore users/{uid}...`}
      />
    );
  }

  if (!user) {
    return (
      <Navigate
        to={targetPortal.loginPath}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  if (!user.isActive) {
    return (
      <Navigate
        to="/unauthorized"
        replace
        state={{
          attemptedPath: location.pathname,
          requiredRole: allowedRole,
          actualRole: user.role,
          reason: 'inactive',
        }}
      />
    );
  }

  if (user.role !== allowedRole) {
    return (
      <Navigate
        to="/unauthorized"
        replace
        state={{
          attemptedPath: location.pathname,
          requiredRole: allowedRole,
          actualRole: user.role,
          reason: 'role_mismatch',
        }}
      />
    );
  }

  return <>{children}</>;
};
