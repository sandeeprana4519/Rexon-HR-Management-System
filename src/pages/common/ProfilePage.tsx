import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Lock,
  Save,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAuth } from '../../hooks/useAuth';
import { changeUserPassword } from '../../services/auth/authService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import { getPortalByRole } from '../../utils/portalConfig';
import {
  validateFullName,
  validateNewPassword,
  validatePhone,
} from '../../utils/validation';

export const ProfilePage: React.FC = () => {
  const { user, isPreviewSession, isFirebaseConfigured, updateProfileInfo } = useAuth();

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordConfirmOpen, setPasswordConfirmOpen] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setPhone(user.phone);
    }
  }, [user]);

  if (!user) return null;

  const portal = getPortalByRole(user.role);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);

    const nameCheck = validateFullName(fullName);
    if (!nameCheck.valid) {
      setProfileMessage({ type: 'error', text: nameCheck.error ?? 'Invalid full name.' });
      return;
    }

    const phoneCheck = validatePhone(phone);
    if (!phoneCheck.valid) {
      setProfileMessage({ type: 'error', text: phoneCheck.error ?? 'Invalid phone number.' });
      return;
    }

    setProfileSaving(true);
    try {
      await updateProfileInfo({ fullName, phone });
      setProfileMessage({
        type: 'success',
        text: isPreviewSession
          ? 'Updated in local Development Preview session only (Firebase is not configured).'
          : 'Profile updated and synchronized with Firestore users/{uid}.',
      });
    } catch (err) {
      setProfileMessage({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleValidatePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (!currentPassword) {
      setPasswordMessage({ type: 'error', text: 'Enter your current password to verify identity.' });
      return;
    }

    const pwdCheck = validateNewPassword(newPassword, confirmPassword);
    if (!pwdCheck.valid) {
      setPasswordMessage({ type: 'error', text: pwdCheck.error ?? 'Invalid new password.' });
      return;
    }

    setPasswordConfirmOpen(true);
  };

  const executePasswordChange = async () => {
    setPasswordSaving(true);
    try {
      await changeUserPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordConfirmOpen(false);
      setPasswordMessage({
        type: 'success',
        text: 'Your Firebase Authentication password has been updated.',
      });
    } catch (err) {
      setPasswordConfirmOpen(false);
      setPasswordMessage({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1F1916]">
          Account Profile &amp; Security
        </h1>
        <p className="mt-1 text-sm text-[#574B43]">
          Verified Firestore document <code className="font-mono-tabular text-[#5C3D2E]">users/{user.uid}</code> ·{' '}
          {portal.portalName}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Firestore RBAC Record Summary (Read-Only Security Attributes) */}
        <section className="lg:col-span-5 bg-white border border-[#E5DDD2] rounded-xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#F3EDE4] text-[#5C3D2E] flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-[#1F1916]">
                Firestore Role &amp; Access Scope
              </h2>
              <p className="text-xs text-[#7D6F65]">
                Protected by Firestore Security Rules; self-modification of RBAC fields is blocked.
              </p>
            </div>
          </div>

          <dl className="divide-y divide-[#E5DDD2] text-sm">
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-[#574B43]">User UID</dt>
              <dd className="font-mono-tabular text-xs text-[#1F1916] break-all text-right">
                {user.uid}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-[#574B43]">Verified Role</dt>
              <dd className="font-mono-tabular font-semibold text-[#5C3D2E]">{user.role}</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-[#574B43]">Account Status</dt>
              <dd className="font-medium text-[#166534]">
                {user.isActive ? 'Active (isActive: true)' : 'Inactive'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-[#574B43]">Authorized Branch</dt>
              <dd className="font-mono-tabular text-[#1F1916]">{user.branchId}</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-[#574B43]">Assigned Sites</dt>
              <dd className="font-mono-tabular text-xs text-[#1F1916] text-right">
                {user.assignedSiteIds.length > 0
                  ? user.assignedSiteIds.join(' · ')
                  : user.role === 'admin'
                    ? 'All Sites (Global)'
                    : 'None Assigned'}
              </dd>
            </div>
            <div className="py-2.5">
              <dt className="text-[#574B43] mb-1">Assigned Permissions</dt>
              <dd className="font-mono-tabular text-xs text-[#4A3023] leading-relaxed">
                {user.permissions.length > 0 ? user.permissions.join(' · ') : 'Standard role baseline'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4 text-xs">
              <dt className="text-[#7D6F65]">Last Updated</dt>
              <dd className="font-mono-tabular text-[#574B43]">
                {new Date(user.updatedAt).toLocaleString()}
              </dd>
            </div>
          </dl>

          <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] flex items-start gap-2.5 text-xs text-[#574B43]">
            <ShieldCheck className="w-4 h-4 text-[#5C3D2E] shrink-0 mt-0.5" />
            <span>
              Role, branch, assigned sites, and permissions can only be altered by an authorized
              Administrator.
            </span>
          </div>
        </section>

        {/* Right: Editable Personal Info + Change Password */}
        <div className="lg:col-span-7 space-y-6">
          {/* Edit Contact Profile */}
          <section className="bg-white border border-[#E5DDD2] rounded-xl p-6">
            <h2 className="font-display text-base font-semibold text-[#1F1916]">
              Personal Profile Details
            </h2>
            <p className="mt-1 text-xs text-[#574B43]">
              Update your display name and contact phone number stored in <code className="font-mono-tabular">users/{user.uid}</code>.
            </p>

            {profileMessage && (
              <div
                className={`mt-4 p-3.5 rounded-lg border flex items-start gap-2.5 text-xs ${
                  profileMessage.type === 'success'
                    ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
                    : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                }`}
              >
                {profileMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{profileMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="mt-5 space-y-4" noValidate>
              <div>
                <label
                  htmlFor="profile-email"
                  className="block text-xs font-semibold text-[#574B43] mb-1.5"
                >
                  Authenticated Email (Read-Only)
                </label>
                <input
                  id="profile-email"
                  type="email"
                  value={user.email}
                  disabled
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F3EDE4] border border-[#E5DDD2] rounded-lg text-[#574B43] cursor-not-allowed"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="profile-fullname"
                    className="block text-xs font-semibold text-[#1F1916] mb-1.5"
                  >
                    Full Name
                  </label>
                  <input
                    id="profile-fullname"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    maxLength={120}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-phone"
                    className="block text-xs font-semibold text-[#1F1916] mb-1.5"
                  >
                    Contact Phone
                  </label>
                  <input
                    id="profile-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={20}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  <span>{profileSaving ? 'Saving...' : 'Save Profile Changes'}</span>
                </button>
              </div>
            </form>
          </section>

          {/* Change Password Section */}
          <section className="bg-white border border-[#E5DDD2] rounded-xl p-6">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#F3EDE4] text-[#5C3D2E] flex items-center justify-center shrink-0">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-base font-semibold text-[#1F1916]">
                  Change Account Password
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  Requires current password verification via Firebase Authentication. Minimum 8
                  characters with uppercase, lowercase, and numeric characters.
                </p>
              </div>
            </div>

            {!isFirebaseConfigured && (
              <div className="mt-4 p-3 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs text-[#4A3023]">
                Password updates are inactive in Development Preview Mode until Firebase Auth is
                configured.
              </div>
            )}

            {passwordMessage && (
              <div
                className={`mt-4 p-3.5 rounded-lg border flex items-start gap-2.5 text-xs ${
                  passwordMessage.type === 'success'
                    ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
                    : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                }`}
              >
                {passwordMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{passwordMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleValidatePasswordChange} className="mt-5 space-y-4" noValidate>
              <div>
                <label
                  htmlFor="current-password"
                  className="block text-xs font-semibold text-[#1F1916] mb-1.5"
                >
                  Current Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#7D6F65] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full min-h-[44px] pl-10 pr-4 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="new-password"
                    className="block text-xs font-semibold text-[#1F1916] mb-1.5"
                  >
                    New Password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirm-password"
                    className="block text-xs font-semibold text-[#1F1916] mb-1.5"
                  >
                    Confirm New Password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={!isFirebaseConfigured || passwordSaving}
                  className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50 transition-colors"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>Update Password</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={passwordConfirmOpen}
        title="Confirm Password Change"
        description="Your Firebase Authentication password will be updated immediately. Continue?"
        confirmLabel="Update Password"
        loading={passwordSaving}
        onConfirm={executePasswordChange}
        onCancel={() => setPasswordConfirmOpen(false)}
      />
    </div>
  );
};
