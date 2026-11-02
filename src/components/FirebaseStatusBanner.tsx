import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, Info, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { UserRole } from '../types';
import { PORTAL_LIST, getPortalByRole } from '../utils/portalConfig';

export const FirebaseStatusBanner: React.FC = () => {
  const {
    isFirebaseConfigured,
    missingEnvKeys,
    isPreviewSession,
    user,
    enterPreviewPortal,
    showSampleLayoutData,
    setShowSampleLayoutData,
  } = useAuth();
  const [showConfigModal, setShowConfigModal] = useState(false);
  const navigate = useNavigate();

  if (isFirebaseConfigured) {
    return null;
  }

  const handleSwitchPreviewRole = (role: UserRole) => {
    enterPreviewPortal(role);
    navigate(getPortalByRole(role).basePath);
  };

  return (
    <>
      <div className="w-full bg-[#F3EDE4] border-b border-[#D4C7B8] px-4 sm:px-6 py-2.5 text-xs text-[#1F1916]">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
          <div className="flex items-start sm:items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5 sm:mt-0" />
            <p className="leading-snug">
              <strong className="font-semibold text-[#4A3023]">Development Preview Mode:</strong>{' '}
              Firebase credentials are not configured (<span className="font-mono-tabular">{missingEnvKeys.length}</span>{' '}
              env variables missing). Real authentication and Firestore reads/writes are inactive.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isPreviewSession && user && (
              <>
                <label className="inline-flex items-center gap-1.5 text-xs text-[#574B43]">
                  <span className="sr-only">Switch Preview Portal</span>
                  <select
                    value={user.role}
                    onChange={(e) => handleSwitchPreviewRole(e.target.value as UserRole)}
                    aria-label="Switch Development Preview Role"
                    className="h-8 rounded-md bg-white border border-[#D4C7B8] px-2.5 text-xs font-medium text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
                  >
                    {PORTAL_LIST.map((p) => (
                      <option key={p.role} value={p.role}>
                        Preview: {p.shortTitle}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => setShowSampleLayoutData(!showSampleLayoutData)}
                  className={`h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap ${
                    showSampleLayoutData
                      ? 'bg-[#5C3D2E] text-white border-[#5C3D2E]'
                      : 'bg-white text-[#4A3023] border-[#D4C7B8] hover:bg-[#FAF8F5]'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>Sample Layout Rows: {showSampleLayoutData ? 'On' : 'Off'}</span>
                </button>

                {user.role !== 'admin' && (
                  <button
                    type="button"
                    onClick={() => navigate('/admin')}
                    className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md bg-white border border-[#D4C7B8] text-xs font-medium text-[#574B43] hover:text-[#1F1916] hover:bg-[#FAF8F5] transition-colors whitespace-nowrap"
                    title="Attempt visiting /admin while previewing a non-admin role to verify RBAC protection"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 text-[#B45309] shrink-0" />
                    <span>Test Route Guard</span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() => setShowConfigModal(true)}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md bg-white border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#FAF8F5] transition-colors whitespace-nowrap"
            >
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Firebase Setup Guide</span>
            </button>
          </div>
        </div>
      </div>

      {showConfigModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="firebase-config-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3
                  id="firebase-config-modal-title"
                  className="font-display text-lg font-semibold text-[#1F1916]"
                >
                  Firebase Environment Configuration Required
                </h3>
                <p className="mt-1 text-sm text-[#574B43]">
                  REXON HR Management System uses one shared Firebase project across all five portals.
                  No fake credentials or hardcoded keys are bundled.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="min-h-[40px] min-w-[40px] -mt-1 -mr-1 rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close setup guide"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg p-4">
              <p className="text-xs font-semibold text-[#1F1916] mb-2">
                Missing Environment Variables in <code className="font-mono-tabular">.env</code>:
              </p>
              <ul className="space-y-1 font-mono-tabular text-xs text-[#5C3D2E]">
                {missingEnvKeys.map((key) => (
                  <li key={key}>{key}=</li>
                ))}
              </ul>
            </div>

            <div className="mt-4 space-y-2.5 text-sm text-[#574B43]">
              <p>
                <strong className="text-[#1F1916]">1. Enable Authentication &amp; Firestore:</strong>{' '}
                In Firebase Console, enable Email/Password Authentication, Cloud Firestore, and Firebase Storage.
              </p>
              <p>
                <strong className="text-[#1F1916]">2. Provision First Admin Profile:</strong>{' '}
                Create your Admin user in Firebase Auth, then create document{' '}
                <code className="font-mono-tabular text-xs bg-[#F3EDE4] px-1.5 py-0.5 rounded">
                  users/&#123;uid&#125;
                </code>{' '}
                with <code className="font-mono-tabular text-xs">role: "admin"</code> and{' '}
                <code className="font-mono-tabular text-xs">isActive: true</code>.
              </p>
              <p>
                <strong className="text-[#1F1916]">3. Deploy Security Rules:</strong>{' '}
                Deploy <code className="font-mono-tabular text-xs">firestore.rules</code> and{' '}
                <code className="font-mono-tabular text-xs">storage.rules</code> via Firebase CLI.
              </p>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="min-h-[44px] px-5 py-2 rounded-lg bg-[#5C3D2E] text-sm font-medium text-white hover:bg-[#4A3023] transition-colors"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
