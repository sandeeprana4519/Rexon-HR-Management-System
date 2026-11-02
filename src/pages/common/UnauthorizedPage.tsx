import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, LogOut, ShieldAlert } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FirebaseStatusBanner } from '../../components/FirebaseStatusBanner';
import { RexonBrandMark } from '../../components/RexonBrandMark';
import { useAuth } from '../../hooks/useAuth';
import { UserRole } from '../../types';
import { getPortalByRole } from '../../utils/portalConfig';

interface UnauthorizedLocationState {
  attemptedPath?: string;
  requiredRole?: UserRole;
  actualRole?: UserRole;
  reason?: 'role_mismatch' | 'inactive';
}

export const UnauthorizedPage: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const state = (location.state as UnauthorizedLocationState | null) ?? {};
  const actualRole = user?.role ?? state.actualRole ?? null;
  const authorizedPortal = actualRole ? getPortalByRole(actualRole) : null;
  const requiredPortal = state.requiredRole ? getPortalByRole(state.requiredRole) : null;

  const handleSignOut = async () => {
    const loginPath = await logout();
    setConfirmLogout(false);
    navigate(state.requiredRole ? getPortalByRole(state.requiredRole).loginPath : loginPath, {
      replace: true,
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] text-[#1F1916]">
      <FirebaseStatusBanner />

      <header className="w-full border-b border-[#E5DDD2] bg-white px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link to="/">
            <RexonBrandMark />
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg bg-white border border-[#E5DDD2] rounded-xl p-6 sm:p-8">
          <div className="w-12 h-12 rounded-xl bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center mb-5">
            <ShieldAlert className="w-6 h-6" />
          </div>

          <h1 className="font-display text-2xl font-bold text-[#1F1916]">
            Unauthorized Portal Access Blocked
          </h1>
          <p className="mt-2 text-sm text-[#574B43] leading-relaxed">
            REXON HR Management System verifies every session against authenticated Firestore role
            records. Direct URL navigation to unauthorized portals is strictly prohibited.
          </p>

          <div className="mt-5 bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg p-4 space-y-2 text-xs text-[#574B43]">
            {state.attemptedPath && (
              <div className="flex items-center justify-between gap-4">
                <span>Attempted Route</span>
                <code className="font-mono-tabular font-semibold text-[#1F1916]">
                  {state.attemptedPath}
                </code>
              </div>
            )}
            {requiredPortal && (
              <div className="flex items-center justify-between gap-4">
                <span>Required Role</span>
                <code className="font-mono-tabular font-semibold text-[#B91C1C]">
                  {requiredPortal.role} ({requiredPortal.shortTitle})
                </code>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <span>Verified Session Role</span>
              <code className="font-mono-tabular font-semibold text-[#5C3D2E]">
                {actualRole ? `${actualRole} (${authorizedPortal?.shortTitle})` : 'Unauthenticated'}
              </code>
            </div>
            {state.reason === 'inactive' && (
              <p className="pt-2 border-t border-[#E5DDD2] text-[#B91C1C] font-medium">
                Account status is marked inactive (isActive = false). Contact REXON Administration.
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {authorizedPortal ? (
              <button
                type="button"
                onClick={() => navigate(authorizedPortal.basePath, { replace: true })}
                className="flex-1 min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3023] transition-colors"
              >
                <span>Go to {authorizedPortal.shortTitle}</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
            ) : (
              <Link
                to="/admin/login"
                className="flex-1 min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3023] transition-colors"
              >
                <span>Open Portal Sign-In</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </Link>
            )}

            {user && (
              <button
                type="button"
                onClick={() => setConfirmLogout(true)}
                className="min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-sm font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors"
              >
                <LogOut className="w-4 h-4 text-[#5C3D2E]" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={confirmLogout}
        title="Sign Out to Switch Account"
        description="Sign out of your current session so you can authenticate with credentials authorized for another portal?"
        confirmLabel="Sign Out"
        onConfirm={handleSignOut}
        onCancel={() => setConfirmLogout(false)}
      />
    </div>
  );
};
