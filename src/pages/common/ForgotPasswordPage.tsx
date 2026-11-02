import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import { FirebaseStatusBanner } from '../../components/FirebaseStatusBanner';
import { RexonBrandMark } from '../../components/RexonBrandMark';
import { useAuth } from '../../hooks/useAuth';
import { requestPasswordReset } from '../../services/auth/authService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import { getPortalBySlug } from '../../utils/portalConfig';
import { validateEmail } from '../../utils/validation';

export const ForgotPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const portalSlug = searchParams.get('portal') ?? 'admin';
  const originPortal = getPortalBySlug(portalSlug);
  const { isFirebaseConfigured } = useAuth();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sentSuccess, setSentSuccess] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSentSuccess(false);

    const check = validateEmail(email);
    if (!check.valid) {
      setErrorMsg(check.error ?? 'Enter a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSentSuccess(true);
    } catch (err) {
      setErrorMsg(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] text-[#1F1916]">
      <FirebaseStatusBanner />

      <header className="w-full border-b border-[#E5DDD2] bg-white px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <Link to={originPortal.loginPath}>
            <RexonBrandMark />
          </Link>
          <Link
            to={originPortal.loginPath}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to {originPortal.shortTitle} Login</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-6 sm:p-8">
          <h1 className="font-display text-xl sm:text-2xl font-bold text-[#1F1916]">
            Reset Account Password
          </h1>
          <p className="mt-1.5 text-sm text-[#574B43] leading-relaxed">
            Enter your registered REXON email address. Firebase Authentication will send a password
            recovery link if an active account exists.
          </p>

          {!isFirebaseConfigured && (
            <div className="mt-4 p-3.5 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs text-[#4A3023]">
              Live password recovery emails require Firebase Authentication credentials in{' '}
              <code className="font-mono-tabular">.env</code>.
            </div>
          )}

          {errorMsg && (
            <div
              className="mt-4 p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-2.5 text-xs text-[#991B1B]"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {sentSuccess ? (
            <div className="mt-5 p-4 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] text-sm text-[#166534]">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Recovery Link Dispatched</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed">
                Check inbox for <strong>{email.trim()}</strong> and follow the Firebase password
                reset link, then sign in to {originPortal.shortTitle}.
              </p>
              <Link
                to={originPortal.loginPath}
                className="mt-4 w-full min-h-[44px] inline-flex items-center justify-center rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors"
              >
                Return to {originPortal.shortTitle} Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleReset} className="mt-6 space-y-4" noValidate>
              <div>
                <label
                  htmlFor="reset-email"
                  className="block text-xs font-semibold text-[#1F1916] mb-1.5"
                >
                  Registered Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#7D6F65] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@rexonsecurity.com"
                    className="w-full min-h-[46px] pl-10 pr-4 py-2.5 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] placeholder:text-[#7D6F65] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[46px] px-5 py-2.5 rounded-lg bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60 transition-colors"
              >
                {submitting ? 'Sending Recovery Email...' : 'Send Password Reset Link'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};
