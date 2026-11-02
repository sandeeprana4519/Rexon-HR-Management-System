import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
} from 'lucide-react';
import { OfflineIndicator } from '../../components/OfflineIndicator';
import { PWAInstallButton } from '../../components/PWAInstallButton';
import { RexonBrandMark } from '../../components/RexonBrandMark';
import { useAuth } from '../../hooks/useAuth';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import { UserRole } from '../../types';
import {
  DEMO_ACCOUNTS,
  DEMO_ACCOUNT_LIST,
  DEMO_SHARED_PASSWORD,
} from '../../utils/demoCredentials';
import { PORTAL_LIST, getPortalByRole } from '../../utils/portalConfig';
import { validateEmail, validateLoginPassword } from '../../utils/validation';

interface PortalLoginPageProps {
  portalRole: UserRole;
}

export const PortalLoginPage: React.FC<PortalLoginPageProps> = ({ portalRole }) => {
  const portal = getPortalByRole(portalRole);
  const currentDemo = DEMO_ACCOUNTS[portalRole];
  const { user, loginWithEmail, logout } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filledFeedback, setFilledFeedback] = useState(false);

  // Clear form messages when switching portal tabs
  useEffect(() => {
    setFormError(null);
    setFilledFeedback(false);
  }, [portalRole]);

  const authorizedPortalForCurrentUser = user ? getPortalByRole(user.role) : null;

  const handleAutoFillDemo = (demoEmail: string, demoPwd: string) => {
    setEmail(demoEmail);
    setPassword(demoPwd);
    setFormError(null);
    setFilledFeedback(true);
    window.setTimeout(() => setFilledFeedback(false), 1800);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      setFormError(emailCheck.error ?? 'Invalid email.');
      return;
    }

    const passwordCheck = validateLoginPassword(password);
    if (!passwordCheck.valid) {
      setFormError(passwordCheck.error ?? 'Invalid password.');
      return;
    }

    setSubmitting(true);
    try {
      const verifiedUser = await loginWithEmail(email, password);
      if (verifiedUser.role !== portalRole) {
        navigate('/unauthorized', {
          replace: true,
          state: {
            attemptedPath: portal.basePath,
            requiredRole: portalRole,
            actualRole: verifiedUser.role,
            reason: 'role_mismatch',
          },
        });
        return;
      }
      navigate(portal.basePath, { replace: true });
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] text-[#1F1916]">
      {/* Clean Top Brand Header */}
      <header className="w-full border-b border-[#E5DDD2] bg-white px-4 sm:px-8 py-3.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <Link to="/" className="shrink-0">
            <RexonBrandMark />
          </Link>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
          </div>
        </div>
      </header>

      {/* Stacked / Wrapped Portal Selector Bar (2 clean lines on mobile, zero horizontal scroll) */}
      <nav
        className="w-full bg-[#F3EDE4] border-b border-[#E5DDD2] px-3 sm:px-6 py-3"
        aria-label="Select Portal"
      >
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-center gap-2">
          {PORTAL_LIST.map((item) => {
            const isCurrent = item.role === portalRole;
            return (
              <Link
                key={item.role}
                to={item.loginPath}
                className={`flex-1 basis-[calc(33.333%-8px)] min-w-[102px] sm:basis-auto sm:flex-initial min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold text-center flex items-center justify-center whitespace-nowrap transition-colors ${
                  isCurrent
                    ? 'bg-[#5C3D2E] text-white shadow-xs'
                    : 'bg-white text-[#4A3023] border border-[#D4C7B8] hover:bg-[#FAF8F5] hover:text-[#1F1916]'
                }`}
              >
                {item.shortTitle}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Main Centered Sign-In Section (No extra descriptive card above) */}
      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-6 sm:py-10 flex flex-col justify-center">
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-8 shadow-xs">
          {user && authorizedPortalForCurrentUser && (
            <div className="mb-5 p-3.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs">
              <p className="font-semibold text-[#1F1916]">
                Signed in as {user.fullName}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigate(authorizedPortalForCurrentUser.basePath)}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors"
                >
                  Open {authorizedPortalForCurrentUser.shortTitle}
                </button>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}

          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-[#1F1916]">
              Sign in to {portal.shortTitle}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-[#574B43]">
              Enter your registered email ID and password to continue.
            </p>
          </div>

          {formError && (
            <div
              className="mt-4 p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-2.5 text-xs text-[#991B1B]"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            <div>
              <label
                htmlFor="portal-email"
                className="block text-xs font-semibold text-[#1F1916] mb-1.5"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-[#7D6F65] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="portal-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={currentDemo.email}
                  className="w-full min-h-[46px] pl-10 pr-4 py-2.5 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] placeholder:text-[#7D6F65] focus:outline-none focus:bg-white focus:border-[#5C3D2E] transition-colors"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="portal-password"
                  className="block text-xs font-semibold text-[#1F1916]"
                >
                  Password
                </label>
                <Link
                  to={`/forgot-password?portal=${portal.slug}`}
                  className="text-xs font-medium text-[#5C3D2E] hover:underline"
                >
                  Forgot Password?
                </Link>
              </div>
              <div className="relative">
                <Lock
                  className="w-4 h-4 text-[#7D6F65] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="portal-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full min-h-[46px] pl-10 pr-11 py-2.5 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] placeholder:text-[#7D6F65] focus:outline-none focus:bg-white focus:border-[#5C3D2E] transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded text-[#7D6F65] hover:text-[#1F1916]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] mt-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3023] active:bg-[#3B251A] disabled:opacity-60 transition-colors"
            >
              <span>
                {submitting ? 'Signing In...' : `Sign In to ${portal.shortTitle}`}
              </span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
          </form>

          {/* Temporary Demo ID & Password Section for Testing */}
          <div className="mt-6 pt-5 border-t border-[#E5DDD2]">
            <div className="bg-[#FAF8F5] border border-[#D4C7B8] rounded-xl p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#4A3023]">
                  <KeyRound className="w-3.5 h-3.5 text-[#5C3D2E] shrink-0" />
                  <span>Demo Login Credentials (For Testing)</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleAutoFillDemo(currentDemo.email, currentDemo.password)}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#5C3D2E] text-[11px] font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
                >
                  {filledFeedback ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Filled</span>
                    </>
                  ) : (
                    <span>Auto-Fill {portal.shortTitle}</span>
                  )}
                </button>
              </div>

              {/* Active Portal Highlighted Demo Credentials */}
              <div className="mt-3 p-3 rounded-lg bg-white border border-[#E5DDD2] space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#574B43]">{portal.shortTitle} ID:</span>
                  <code className="font-mono-tabular font-semibold text-[#1F1916]">
                    {currentDemo.email}
                  </code>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#574B43]">Demo Password:</span>
                  <code className="font-mono-tabular font-semibold text-[#5C3D2E]">
                    {currentDemo.password}
                  </code>
                </div>
              </div>

              {/* All 5 Portals Demo Reference Table */}
              <div className="mt-3 pt-2.5 border-t border-[#E5DDD2]">
                <p className="text-[11px] font-medium text-[#7D6F65] mb-2">
                  All Portals Demo IDs (Password for all:{' '}
                  <code className="font-mono-tabular font-semibold text-[#4A3023]">
                    {DEMO_SHARED_PASSWORD}
                  </code>
                  ):
                </p>
                <div className="space-y-1.5">
                  {DEMO_ACCOUNT_LIST.map((acct) => {
                    const isSelected = acct.role === portalRole;
                    return (
                      <div
                        key={acct.role}
                        className={`flex items-center justify-between gap-2 text-xs py-1 px-2 rounded ${
                          isSelected ? 'bg-[#F3EDE4] font-semibold text-[#1F1916]' : 'text-[#574B43]'
                        }`}
                      >
                        <span className="truncate">{acct.portalLabel}</span>
                        <code className="font-mono-tabular text-[#1F1916] shrink-0">
                          {acct.email}
                        </code>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E5DDD2] bg-white px-4 py-3.5 text-center text-xs text-[#7D6F65]">
        &copy; {new Date().getFullYear()} REXON Security &amp; Manpower Solution
      </footer>

      <OfflineIndicator />
    </div>
  );
};
