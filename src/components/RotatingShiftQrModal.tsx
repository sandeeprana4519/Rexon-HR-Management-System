import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Clock, Copy, QrCode, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { RexonUser, SiteQrSessionRecord } from '../types';
import { generateRotatingSiteQrSession } from '../services/firestore/attendanceService';
import { formatServiceErrorMessage } from '../services/firestore/errorHandler';

interface RotatingShiftQrModalProps {
  open: boolean;
  onClose: () => void;
  caller: RexonUser;
  isPreviewSession: boolean;
  siteId: string;
  siteName: string;
  attendanceDate: string;
  shiftType: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
}

export const RotatingShiftQrModal: React.FC<RotatingShiftQrModalProps> = ({
  open,
  onClose,
  caller,
  isPreviewSession,
  siteId,
  siteName,
  attendanceDate,
  shiftType,
  scheduledStartTime,
  scheduledEndTime,
}) => {
  const [ttlSeconds, setTtlSeconds] = useState<number>(300);
  const [session, setSession] = useState<SiteQrSessionRecord | null>(null);
  const [svgMarkup, setSvgMarkup] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [copiedField, setCopiedField] = useState<'code' | 'token' | null>(null);

  const issueQrSession = async (customTtl?: number) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const nextSession = await generateRotatingSiteQrSession(caller, isPreviewSession, {
        siteId,
        attendanceDate,
        shiftType,
        scheduledStartTime,
        scheduledEndTime,
        ttlSeconds: customTtl ?? ttlSeconds,
      });
      setSession(nextSession);

      const svg = await QRCode.toString(nextSession.signedToken, {
        type: 'svg',
        margin: 1,
        width: 220,
        color: {
          dark: '#1F1916',
          light: '#FFFFFF',
        },
      });
      setSvgMarkup(svg);
    } catch (err) {
      setErrorMsg(formatServiceErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !siteId) return;
    void issueQrSession(ttlSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, siteId, attendanceDate, shiftType]);

  useEffect(() => {
    if (!open || !session) return;
    const updateRemaining = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000)
      );
      setRemainingSeconds(diff);
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [open, session]);

  if (!open) return null;

  const isExpired = session ? remainingSeconds <= 0 : false;
  const mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const secs = String(remainingSeconds % 60).padStart(2, '0');

  const handleCopy = async (text: string, type: 'code' | 'token') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(type);
      window.setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // Clipboard may be restricted in some sandbox contexts
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 my-auto">
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#E5DDD2]">
          <div>
            <div className="flex items-center gap-2 text-[#5C3D2E]">
              <QrCode className="w-4 h-4 shrink-0" />
              <span className="text-xs font-semibold">Time-Limited Rotating Shift QR</span>
            </div>
            <h2
              id="qr-modal-title"
              className="mt-1 font-display text-lg font-bold text-[#1F1916]"
            >
              {siteName}
            </h2>
            <p className="text-xs text-[#574B43] font-mono-tabular">
              {siteId} · {attendanceDate} · {shiftType} ({scheduledStartTime}–{scheduledEndTime})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
            aria-label="Close QR modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
            {errorMsg}
          </div>
        )}

        <div className="mt-5 flex flex-col items-center">
          <div className="w-[244px] h-[244px] bg-[#FAF8F5] border border-[#E5DDD2] rounded-xl flex items-center justify-center p-3">
            {loading ? (
              <div className="text-xs text-[#574B43] flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 text-[#5C3D2E] animate-spin" />
                <span>Signing rotating QR token...</span>
              </div>
            ) : svgMarkup && !isExpired ? (
              <div
                className="w-[220px] h-[220px] bg-white rounded-lg overflow-hidden flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: svgMarkup }}
              />
            ) : (
              <div className="text-center px-3 space-y-2">
                <p className="text-xs font-semibold text-[#B91C1C]">
                  {isExpired ? 'Shift QR Session Expired' : 'QR Not Generated'}
                </p>
                <p className="text-xs text-[#574B43]">
                  Rotate a fresh signed QR code to accept on-duty punches.
                </p>
              </div>
            )}
          </div>

          {session && (
            <div className="mt-4 w-full space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 px-3.5 bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-xs">
                <div className="flex items-center gap-1.5 text-[#574B43]">
                  <Clock className="w-3.5 h-3.5 text-[#5C3D2E]" />
                  <span>Token Validity Window:</span>
                </div>
                <span
                  className={`font-mono-tabular font-semibold ${
                    isExpired
                      ? 'text-[#B91C1C]'
                      : remainingSeconds <= 45
                        ? 'text-[#B45309]'
                        : 'text-[#166534]'
                  }`}
                >
                  {isExpired ? 'Expired (00:00)' : `Active · ${mins}:${secs} remaining`}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 px-3.5 bg-[#F3EDE4] border border-[#D4C7B8] rounded-lg">
                <div>
                  <span className="block text-[11px] text-[#574B43]">
                    8-Character Rotating Shift Code (Manual Entry Fallback)
                  </span>
                  <span className="font-mono-tabular text-base font-bold tracking-wider text-[#1F1916]">
                    {session.verificationCode}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy(session.verificationCode, 'code')}
                    className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#FAF8F5] whitespace-nowrap"
                  >
                    {copiedField === 'code' ? (
                      <Check className="w-3.5 h-3.5 text-[#166534]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[#5C3D2E]" />
                    )}
                    <span>{copiedField === 'code' ? 'Copied' : 'Copy Code'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopy(session.signedToken, 'token')}
                    className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#FAF8F5] whitespace-nowrap"
                  >
                    {copiedField === 'token' ? (
                      <Check className="w-3.5 h-3.5 text-[#166534]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedField === 'token' ? 'Token Copied' : 'Copy Token'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-[#E5DDD2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="qr-ttl-select" className="text-xs font-medium text-[#574B43] whitespace-nowrap">
              Rotation TTL:
            </label>
            <select
              id="qr-ttl-select"
              value={ttlSeconds}
              onChange={(e) => {
                const next = Number(e.target.value);
                setTtlSeconds(next);
              }}
              className="min-h-[38px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916]"
            >
              <option value={120}>2 Minutes (120s)</option>
              <option value={300}>5 Minutes (300s)</option>
              <option value={600}>10 Minutes (600s)</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void issueQrSession(ttlSeconds)}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Rotate New QR</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] flex items-start gap-2.5 text-[11px] text-[#574B43]">
          <ShieldCheck className="w-4 h-4 text-[#5C3D2E] shrink-0 mt-0.5" />
          <span>
            Each QR payload contains zero employee PII, is HMAC-signed for a single site, date, and
            shift, and blocks expired or duplicate replay scans. QR scans are logged alongside device
            and audit metadata for HR review.
          </span>
        </div>
      </div>
    </div>
  );
};
