import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  X,
} from 'lucide-react';
import { IssuedPortalCredentials } from '../types';

interface PortalCredentialSlipModalProps {
  credentials: IssuedPortalCredentials | null;
  onClose: () => void;
  title?: string;
}

export const PortalCredentialSlipModal: React.FC<PortalCredentialSlipModalProps> = ({
  credentials,
  onClose,
  title,
}) => {
  const [showPassword, setShowPassword] = useState(true);
  const [copiedField, setCopiedField] = useState<'id' | 'email' | 'password' | 'all' | null>(null);

  if (!credentials) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const fullPortalLoginUrl = `${origin}${credentials.loginPath}`;
  const canLoginWithSystemId = credentials.loginEmail.endsWith('@rexon.portal');

  const copyText = async (value: string, field: 'id' | 'email' | 'password' | 'all') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField((prev) => (prev === field ? null : prev));
      }, 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const shareSlipText = [
    `REXON ${credentials.portalName} — Login Credentials`,
    `Name: ${credentials.fullName}`,
    `System ID: ${credentials.systemId}`,
    `Login ID: ${canLoginWithSystemId ? `${credentials.systemId} (or ${credentials.loginEmail})` : credentials.loginEmail}`,
    `Password: ${credentials.loginPassword}`,
    `Portal Login Link: ${fullPortalLoginUrl}`,
    `Note: Sign in and update your password anytime from My Profile.`,
  ].join('\n');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/55 backdrop-blur-[2px] p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credential-slip-title"
    >
      <div className="w-full max-w-lg bg-white border border-[#D4C7B8] rounded-xl shadow-xl my-auto overflow-hidden">
        {/* Header */}
        <div className="bg-[#F3EDE4] border-b border-[#E5DDD2] px-5 sm:px-6 py-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#5C3D2E] text-white flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="credential-slip-title"
                className="font-display text-lg font-bold text-[#1F1916]"
              >
                {title || `${credentials.portalName} Login ID & Password`}
              </h2>
              <p className="text-xs text-[#574B43] mt-0.5">
                Share these credentials with <strong>{credentials.fullName}</strong> to sign in.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#574B43] hover:text-[#1F1916] hover:bg-white/60"
            aria-label="Close credential slip"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-4">
          <div className="p-3.5 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] flex items-start gap-2.5 text-xs text-[#166534]">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Account Ready for Portal Login:</span>{' '}
              {credentials.fullName} ({credentials.systemId}) can sign in at{' '}
              <code className="font-mono-tabular font-semibold">{credentials.loginPath}</code> and
              view only their own authorized profile &amp; duties.
            </div>
          </div>

          {/* Credentials Box */}
          <div className="bg-[#FAF8F5] border border-[#E5DDD2] rounded-xl divide-y divide-[#E5DDD2] text-sm">
            {/* System Record ID */}
            <div className="p-3.5 flex items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-medium text-[#7D6F65] block">
                  System Record ID
                </span>
                <span className="font-mono-tabular font-bold text-[#5C3D2E]">
                  {credentials.systemId}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void copyText(credentials.systemId, 'id')}
                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                {copiedField === 'id' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#166534]" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[#5C3D2E]" />
                    <span>Copy ID</span>
                  </>
                )}
              </button>
            </div>

            {/* Login Email / User ID */}
            <div className="p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-[#7D6F65] block">
                  Portal Login ID (Email {canLoginWithSystemId ? 'or System ID' : ''})
                </span>
                <span className="font-mono-tabular font-semibold text-[#1F1916] break-all">
                  {credentials.loginEmail}
                </span>
                {canLoginWithSystemId && (
                  <span className="text-[11px] text-[#574B43] block mt-0.5">
                    Can also type <strong className="font-mono-tabular">{credentials.systemId}</strong> directly on login screen
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void copyText(credentials.loginEmail, 'email')}
                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
              >
                {copiedField === 'email' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#166534]" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[#5C3D2E]" />
                    <span>Copy Login</span>
                  </>
                )}
              </button>
            </div>

            {/* Password */}
            <div className="p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-[#7D6F65] block">
                  Portal Login Password
                </span>
                <span className="font-mono-tabular font-bold text-[#1F1916] text-base">
                  {showPassword ? credentials.loginPassword : '••••••••••'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="min-h-[36px] min-w-[36px] rounded-lg bg-white border border-[#D4C7B8] text-[#574B43] hover:text-[#1F1916] flex items-center justify-center"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => void copyText(credentials.loginPassword, 'password')}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  {copiedField === 'password' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#166534]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#5C3D2E]" />
                      <span>Copy Password</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Target Portal Link */}
            <div className="p-3.5 flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-[#7D6F65] block">
                  Dedicated Login Page
                </span>
                <span className="font-mono-tabular text-[#5C3D2E] font-semibold break-all">
                  {fullPortalLoginUrl}
                </span>
              </div>
              <Link
                to={credentials.loginPath}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
              >
                <span>Open Portal</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Scope & Isolation Note */}
          <div className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] flex items-start gap-2.5 text-xs text-[#574B43]">
            <ShieldCheck className="w-4 h-4 text-[#5C3D2E] shrink-0 mt-0.5" />
            <span>
              Strict Role Isolation: Logging in with this ID grants access strictly to{' '}
              <strong>{credentials.fullName}</strong>&apos;s own {credentials.portalName} data
              {credentials.branchLabel ? ` (${credentials.branchLabel})` : ''}
              {credentials.siteLabel ? ` · ${credentials.siteLabel}` : ''}. No other user&apos;s
              personal records are accessible. They can also update their profile &amp; password
              from <strong>My Profile</strong>.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-4 bg-[#FAF8F5] border-t border-[#E5DDD2] flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => void copyText(shareSlipText, 'all')}
            className="min-h-[42px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] inline-flex items-center gap-2 whitespace-nowrap"
          >
            {copiedField === 'all' ? (
              <>
                <Check className="w-4 h-4" />
                <span>Complete Login Slip Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy Full ID &amp; Password Slip</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] px-4 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
