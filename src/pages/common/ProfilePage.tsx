import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Save,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCircle,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAuth } from '../../hooks/useAuth';
import { changeUserPassword } from '../../services/auth/authService';
import { processInstantPhotoAsset } from '../../services/firebase/config';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  syncOwnChangedPasswordHint,
  updatePreviewProvisionedUserPassword,
} from '../../services/firestore/userRoleService';
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
  const [profilePhoto, setProfilePhoto] = useState(user?.profilePhoto ?? '');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
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
      setProfilePhoto(user.profilePhoto ?? '');
    }
  }, [user]);

  if (!user) return null;

  const portal = getPortalByRole(user.role);
  const isSystemPortalEmail = user.email.toLowerCase().endsWith('@rexon.portal');
  const displayLoginShortcut =
    user.systemId ||
    (isSystemPortalEmail ? user.email.split('@')[0].toUpperCase() : '');

  const copyValue = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setPhotoUploading(true);
    setProfileMessage(null);
    try {
      const processedUrl = await processInstantPhotoAsset(file, {
        storagePath: `userProfiles/${user.uid}/avatar_${Date.now()}.jpg`,
        tryCloudStorage: isFirebaseConfigured && !isPreviewSession,
        maxDimension: 280,
      });
      setProfilePhoto(processedUrl);
      setProfileMessage({
        type: 'success',
        text: 'Photograph processed. Click "Save Profile Changes" to save it permanently.',
      });
    } catch (err) {
      setProfileMessage({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setPhotoUploading(false);
    }
  };

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
      await updateProfileInfo({ fullName, phone, profilePhoto });
      setProfileMessage({
        type: 'success',
        text: 'Your profile details and photograph have been updated.',
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
      if (isPreviewSession || !isFirebaseConfigured) {
        updatePreviewProvisionedUserPassword(user.uid, currentPassword, newPassword);
      } else {
        await changeUserPassword(currentPassword, newPassword);
        await syncOwnChangedPasswordHint(user.uid, newPassword, false);
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordConfirmOpen(false);
      setPasswordMessage({
        type: 'success',
        text: 'Your portal login password has been updated. Use your new password the next time you sign in.',
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
          My Profile, Portal ID &amp; Password
        </h1>
        <p className="mt-1 text-sm text-[#574B43]">
          {portal.portalName} · Private account workspace isolated to your identity
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Portal Identity, System ID & RBAC Access Scope */}
        <section className="lg:col-span-5 bg-white border border-[#E5DDD2] rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] overflow-hidden flex items-center justify-center shrink-0">
              {profilePhoto ? (
                <img
                  src={profilePhoto}
                  alt={`${user.fullName} profile photograph`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserCircle className="w-9 h-9 text-[#5C3D2E]" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-[#1F1916] truncate">
                {user.fullName}
              </h2>
              <p className="text-xs text-[#574B43] mt-0.5">
                {user.designationLabel || portal.shortTitle} · Branch {user.branchId}
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#4A3023]">
                <UserCheck className="w-3.5 h-3.5 text-[#5C3D2E]" />
                <span>Your Portal Login ID</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  void copyValue('loginId', displayLoginShortcut || user.email)
                }
                className="min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-[#D4C7B8] text-[11px] font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
              >
                {copiedKey === 'loginId' ? (
                  <>
                    <Check className="w-3 h-3 text-[#166534]" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-[#5C3D2E]" />
                    <span>Copy ID</span>
                  </>
                )}
              </button>
            </div>

            {displayLoginShortcut && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[#574B43]">System ID:</span>
                <code className="font-mono-tabular font-bold text-[#1F1916]">
                  {displayLoginShortcut}
                </code>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[#574B43]">Login Email / Handle:</span>
              <code className="font-mono-tabular font-semibold text-[#5C3D2E] break-all text-right">
                {user.email}
              </code>
            </div>
          </div>

          <dl className="divide-y divide-[#E5DDD2] text-sm">
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-[#574B43]">Verified Portal Role</dt>
              <dd className="font-mono-tabular font-semibold text-[#5C3D2E]">{user.role}</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-[#574B43]">Account Status</dt>
              <dd className="font-medium text-[#166534]">
                {user.isActive ? 'Active' : 'Inactive'}
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
                    : 'Scoped by Active Duty / Branch'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4 text-xs">
              <dt className="text-[#7D6F65]">User UID</dt>
              <dd className="font-mono-tabular text-[#574B43] break-all text-right">
                {user.uid}
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
              Strict Data Isolation: Your login grants access strictly to your own profile and authorized{' '}
              {portal.shortTitle} records. Other users&apos; private records are blocked.
            </span>
          </div>
        </section>

        {/* Right: Editable Personal Info + Photograph + Change Password */}
        <div className="lg:col-span-7 space-y-6">
          {/* Edit Contact Profile & Photo */}
          <section className="bg-white border border-[#E5DDD2] rounded-xl p-6">
            <h2 className="font-display text-base font-semibold text-[#1F1916]">
              Update Profile Details &amp; Photograph
            </h2>
            <p className="mt-1 text-xs text-[#574B43]">
              Keep your photograph, display name, and mobile number up to date.
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
              {/* Instant Photograph Uploader */}
              <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-14 h-14 rounded-xl bg-[#EDE3D8] border border-[#D4C7B8] overflow-hidden flex items-center justify-center shrink-0">
                    {profilePhoto ? (
                      <img
                        src={profilePhoto}
                        alt="Profile preview"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <UserCircle className="w-7 h-7 text-[#5C3D2E]" />
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#1F1916]">Profile Photograph</p>
                    <p className="text-[11px] text-[#7D6F65] mt-0.5">
                      JPG, PNG, or WEBP up to 15 MB · Auto-optimized instantly
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] cursor-pointer transition-colors whitespace-nowrap">
                    <Camera className="w-3.5 h-3.5 text-[#5C3D2E]" />
                    <span>{photoUploading ? 'Processing...' : profilePhoto ? 'Change Photo' : 'Upload Photo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      disabled={photoUploading}
                      className="hidden"
                    />
                  </label>

                  {profilePhoto && (
                    <button
                      type="button"
                      onClick={() => setProfilePhoto('')}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#E5DDD2] text-xs font-semibold text-[#991B1B] hover:bg-[#FEF2F2] transition-colors whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="profile-email"
                    className="block text-xs font-semibold text-[#574B43] mb-1.5"
                  >
                    Login ID / Email (Read-Only)
                  </label>
                  <input
                    id="profile-email"
                    type="text"
                    value={displayLoginShortcut ? `${displayLoginShortcut} (${user.email})` : user.email}
                    disabled
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono-tabular bg-[#F3EDE4] border border-[#E5DDD2] rounded-lg text-[#574B43] cursor-not-allowed"
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-role"
                    className="block text-xs font-semibold text-[#574B43] mb-1.5"
                  >
                    Portal Access Role (Read-Only)
                  </label>
                  <input
                    id="profile-role"
                    type="text"
                    value={portal.portalName}
                    disabled
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs bg-[#F3EDE4] border border-[#E5DDD2] rounded-lg text-[#574B43] cursor-not-allowed"
                  />
                </div>
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
                    Contact Mobile Number
                  </label>
                  <input
                    id="profile-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={20}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={profileSaving || photoUploading}
                  className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60 transition-colors whitespace-nowrap"
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
                  Change Portal Login Password
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  Enter your current password and set a new password (minimum 6 characters).
                </p>
              </div>
            </div>

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
                    type={showCurrentPwd ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter your current password"
                    className="w-full min-h-[44px] pl-10 pr-11 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPwd((p) => !p)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded text-[#7D6F65] hover:text-[#1F1916]"
                    aria-label={showCurrentPwd ? 'Hide current password' : 'Show current password'}
                  >
                    {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
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
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showNewPwd ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full min-h-[44px] pl-3.5 pr-11 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPwd((p) => !p)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded text-[#7D6F65] hover:text-[#1F1916]"
                      aria-label={showNewPwd ? 'Hide new password' : 'Show new password'}
                    >
                      {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
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
                    type={showNewPwd ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{passwordSaving ? 'Updating...' : 'Update Password'}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={passwordConfirmOpen}
        title="Confirm Password Change"
        description="Your portal login password will be updated immediately. Continue?"
        confirmLabel="Update Password"
        loading={passwordSaving}
        onConfirm={executePasswordChange}
        onCancel={() => setPasswordConfirmOpen(false)}
      />
    </div>
  );
};
