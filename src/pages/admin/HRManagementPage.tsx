import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Edit3,
  Eye,
  Plus,
  ShieldCheck,
  UserCheck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  createHRProfileAccount,
  listBranches,
  listHRProfiles,
  subscribeMasterData,
  updateHRAccountStatus,
  updateHRProfileAccount,
} from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  HRAccountStatus,
  HRDesignation,
  HRProfileFormInput,
  HRProfileRecord,
  HR_DESIGNATIONS,
  PERMISSION_PROFILES,
  PERMISSION_PROFILE_MAP,
  PermissionProfileName,
} from '../../types';
import { validateHRProfileForm } from '../../utils/masterValidation';

const INITIAL_HR_FORM: HRProfileFormInput = {
  fullName: '',
  email: '',
  mobile: '',
  profilePhoto: '',
  assignedBranches: [],
  hrDesignation: 'Branch HR',
  permissionProfile: 'Full Branch Operations',
  joiningDate: new Date().toISOString().slice(0, 10),
  accountStatus: 'Active',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export const HRManagementPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();

  const [hrProfiles, setHrProfiles] = useState<HRProfileRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [designationFilter, setDesignationFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 6;

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingHR, setEditingHR] = useState<HRProfileRecord | null>(null);
  const [formData, setFormData] = useState<HRProfileFormInput>(INITIAL_HR_FORM);
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Detail View & Status Confirmation
  const [viewingHR, setViewingHR] = useState<HRProfileRecord | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    hr: HRProfileRecord;
    nextStatus: HRAccountStatus;
  } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [hrs, brs] = await Promise.all([
        listHRProfiles(user, isPreviewSession),
        listBranches(user, isPreviewSession),
      ]);
      setHrProfiles(hrs);
      setBranches(brs.filter((b) => !b.isDeleted));
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadData();
    return subscribeMasterData(() => {
      void loadData();
    });
  }, [loadData]);

  const branchNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of branches) {
      map[b.branchId] = `${b.branchCode} (${b.city})`;
    }
    return map;
  }, [branches]);

  const kpis = useMemo(() => {
    const active = hrProfiles.filter((h) => h.accountStatus === 'Active').length;
    const seniorOrBranch = hrProfiles.filter(
      (h) => h.hrDesignation === 'Senior HR' || h.hrDesignation === 'Branch HR'
    ).length;
    const accountants = hrProfiles.filter((h) => h.hrDesignation === 'Accountant').length;
    return {
      total: hrProfiles.length,
      active,
      seniorOrBranch,
      accountants,
    };
  }, [hrProfiles]);

  const filteredHR = useMemo(() => {
    return hrProfiles.filter((h) => {
      if (designationFilter !== 'ALL' && h.hrDesignation !== designationFilter) return false;
      if (statusFilter !== 'ALL' && h.accountStatus !== statusFilter) return false;

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      const branchLabels = h.assignedBranches.map((id) => branchNameMap[id] ?? id).join(' ').toLowerCase();
      return (
        h.hrId.toLowerCase().includes(q) ||
        h.fullName.toLowerCase().includes(q) ||
        h.email.toLowerCase().includes(q) ||
        h.mobile.includes(q) ||
        h.hrDesignation.toLowerCase().includes(q) ||
        h.permissionProfile.toLowerCase().includes(q) ||
        branchLabels.includes(q)
      );
    });
  }, [hrProfiles, designationFilter, statusFilter, searchQuery, branchNameMap]);

  const paginatedHR = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredHR.slice(start, start + pageSize);
  }, [filteredHR, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, designationFilter, statusFilter]);

  const openCreateModal = () => {
    setEditingHR(null);
    const defaultBranch = branches.find((b) => b.status === 'Active')?.branchId;
    setFormData({
      ...INITIAL_HR_FORM,
      assignedBranches: defaultBranch ? [defaultBranch] : [],
    });
    setSelectedPhotoFile(null);
    setPhotoPreviewUrl('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (hr: HRProfileRecord) => {
    setEditingHR(hr);
    setFormData({
      fullName: hr.fullName,
      email: hr.email,
      mobile: hr.mobile,
      profilePhoto: hr.profilePhoto,
      assignedBranches: [...hr.assignedBranches],
      hrDesignation: hr.hrDesignation,
      permissionProfile: hr.permissionProfile,
      joiningDate: hr.joiningDate,
      accountStatus: hr.accountStatus,
    });
    setSelectedPhotoFile(null);
    setPhotoPreviewUrl(hr.profilePhoto || '');
    setFormError(null);
    setModalOpen(true);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFormError('Profile photo must be JPG, PNG, or WebP format.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setFormError('Profile photo file size must not exceed 2 MB.');
      return;
    }
    setFormError(null);
    setSelectedPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  };

  const toggleBranchSelection = (branchId: string) => {
    setFormData((prev) => {
      const exists = prev.assignedBranches.includes(branchId);
      const next = exists
        ? prev.assignedBranches.filter((id) => id !== branchId)
        : [...prev.assignedBranches, branchId];
      return { ...prev, assignedBranches: next };
    });
  };

  const handleSaveHR = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);

    const check = validateHRProfileForm(formData, hrProfiles, editingHR?.hrId);
    if (!check.valid) {
      setFormError(check.error ?? 'Verify HR account fields.');
      return;
    }

    setSaving(true);
    try {
      if (editingHR) {
        await updateHRProfileAccount(
          user,
          isPreviewSession,
          editingHR.hrId,
          formData,
          selectedPhotoFile
        );
        setBanner({
          type: 'success',
          text: `HR account ${editingHR.hrId} (${formData.fullName}) updated.`,
        });
      } else {
        const { record, provisioningNote } = await createHRProfileAccount(
          user,
          isPreviewSession,
          formData,
          selectedPhotoFile
        );
        setBanner({
          type: 'success',
          text: `Created ${record.hrId} (${record.fullName} · ${record.hrDesignation}). ${provisioningNote}`,
        });
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!user || !statusTarget) return;
    setStatusBusy(true);
    try {
      await updateHRAccountStatus(
        user,
        isPreviewSession,
        statusTarget.hr.hrId,
        statusTarget.nextStatus
      );
      setBanner({
        type: 'success',
        text: `HR account ${statusTarget.hr.hrId} status updated to ${statusTarget.nextStatus}.`,
      });
      setStatusTarget(null);
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            HR Account Management
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Admin-only HR provisioning across Senior HR, Branch HR, Site HR, HR Executive, and
            Accountant designations
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors self-start sm:self-auto whitespace-nowrap"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>Create HR Account</span>
        </button>
      </div>

      {/* Zero Plain-Text Password & Backend Provisioning Notice */}
      <div className="p-4 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] flex items-start gap-3 text-xs text-[#4A3023]">
        <ShieldCheck className="w-4 h-4 text-[#5C3D2E] shrink-0 mt-0.5" />
        <div>
          <strong className="text-[#1F1916]">Privileged Firebase Auth Security:</strong> Plain-text
          passwords are never accepted or stored in Firestore. Privileged HR creation routes through
          the trusted backend (<code className="font-mono-tabular">/api/admin/hr-accounts</code> /
          Cloud Function) and dispatches a Firebase Authentication password-setup email link.
        </div>
      </div>

      {banner && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 text-xs ${
            banner.type === 'success'
              ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{banner.text}</span>
          </div>
          <button type="button" onClick={() => setBanner(null)} className="font-semibold shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Summary */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Total HR Accounts"
          value={kpis.total}
          subtext="Provisioned HR & finance personnel"
          icon={Users}
        />
        <StatMetricCard
          label="Active HR Users"
          value={kpis.active}
          subtext="Enabled for HR Portal access"
          icon={UserCheck}
        />
        <StatMetricCard
          label="Senior & Branch HR"
          value={kpis.seniorOrBranch}
          subtext="Multi-site & branch coordinators"
          icon={UserCog}
        />
        <StatMetricCard
          label="HR Accountants"
          value={kpis.accountants}
          subtext="Billing & payroll specialists"
          icon={ShieldCheck}
        />
      </section>

      {/* HR Accounts Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              HR Personnel &amp; Permission Profiles
            </h2>
            <p className="text-xs text-[#574B43]">
              Filter by HR Type, account status, or search by name, email, HR ID, and branch
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="hr-status-select" className="text-xs font-medium text-[#574B43]">
              Status:
            </label>
            <select
              id="hr-status-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-[36px] rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] px-3 text-xs font-medium text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
            >
              <option value="ALL">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Suspended">Suspended</option>
            </select>
          </div>
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search HR ID, name, email, mobile, branch..."
          filterOptions={[
            { value: 'ALL', label: 'All HR Types' },
            ...HR_DESIGNATIONS.map((d) => ({ value: d, label: d })),
          ]}
          activeFilter={designationFilter}
          onFilterChange={setDesignationFilter}
        />

        {loading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 bg-[#FAF8F5] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredHR.length === 0 ? (
          <EmptyStatePanel
            icon={UserCog}
            title="No HR Accounts Found"
            description="Create a new HR account or clear your current designation and search filters."
            actionLabel="Create HR Account"
            onAction={openCreateModal}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">HR Officer</th>
                    <th className="py-3 px-3">Designation &amp; Profile</th>
                    <th className="py-3 px-3">Assigned Branches</th>
                    <th className="py-3 px-3">Joining Date</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedHR.map((hr) => (
                    <tr key={hr.hrId} className="hover:bg-[#FAF8F5] transition-colors">
                      <td className="py-3.5 px-3 align-top">
                        <div className="flex items-center gap-3">
                          {hr.profilePhoto ? (
                            <img
                              src={hr.profilePhoto}
                              alt={hr.fullName}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-full object-cover border border-[#D4C7B8] shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-[#F3EDE4] border border-[#D4C7B8] text-[#5C3D2E] font-display text-xs font-bold flex items-center justify-center shrink-0">
                              {getInitials(hr.fullName)}
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-[#1F1916]">{hr.fullName}</div>
                            <div className="text-xs text-[#574B43]">
                              <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                                {hr.hrId}
                              </span>{' '}
                              · {hr.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 align-top">
                        <div className="text-xs font-semibold text-[#1F1916]">
                          {hr.hrDesignation}
                        </div>
                        <div className="text-xs text-[#574B43] mt-0.5">{hr.permissionProfile}</div>
                      </td>
                      <td className="py-3.5 px-3 align-top text-xs text-[#4A3023]">
                        {hr.assignedBranches
                          .map((bId) => branchNameMap[bId] ?? bId)
                          .join(' · ')}
                      </td>
                      <td className="py-3.5 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap align-top">
                        {hr.joiningDate}
                      </td>
                      <td className="py-3.5 px-3 text-xs font-semibold whitespace-nowrap align-top">
                        <span
                          className={
                            hr.accountStatus === 'Active'
                              ? 'text-[#166534]'
                              : hr.accountStatus === 'Suspended'
                                ? 'text-[#B91C1C]'
                                : 'text-[#B45309]'
                          }
                        >
                          {hr.accountStatus}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-right whitespace-nowrap align-top">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingHR(hr)}
                            className="min-h-[36px] px-2.5 py-1.5 rounded-md bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4]"
                            title="View HR profile"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(hr)}
                            className="min-h-[36px] px-2.5 py-1.5 rounded-md bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#5C3D2E] hover:bg-[#F3EDE4]"
                            title="Edit HR account"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setStatusTarget({
                                hr,
                                nextStatus: hr.accountStatus === 'Active' ? 'Inactive' : 'Active',
                              })
                            }
                            className="min-h-[36px] px-2.5 py-1.5 rounded-md bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#4A3023] hover:bg-[#F3EDE4]"
                          >
                            {hr.accountStatus === 'Active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={page}
              totalItems={filteredHR.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Create / Edit HR Account Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E5DDD2]">
              <div>
                <h2 className="font-display text-lg font-bold text-[#1F1916]">
                  {editingHR ? `Edit HR Account — ${editingHR.hrId}` : 'Provision New HR Account'}
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  Assign HR Type, Branch scope, and Permission Profile. No plain-text password is
                  stored.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-2.5 text-xs text-[#991B1B]">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveHR} className="mt-5 space-y-4" noValidate>
              {/* Profile Photo + HR ID */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <div className="flex items-center gap-3.5">
                  {photoPreviewUrl ? (
                    <img
                      src={photoPreviewUrl}
                      alt="HR Profile preview"
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-full object-cover border border-[#D4C7B8]"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-[#F3EDE4] border border-[#D4C7B8] text-[#5C3D2E] font-display text-sm font-bold flex items-center justify-center">
                      {formData.fullName ? getInitials(formData.fullName) : 'HR'}
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-[#1F1916]">
                      Profile Photo &amp; Automatic HR ID
                    </p>
                    <p className="font-mono-tabular text-xs text-[#5C3D2E]">
                      {editingHR ? editingHR.hrId : 'Auto-Generated (HR-YYYY-XXXX)'}
                    </p>
                  </div>
                </div>

                <label className="min-h-[40px] inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] cursor-pointer whitespace-nowrap">
                  <Camera className="w-4 h-4" />
                  <span>Upload Photo</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoChange}
                    className="sr-only"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="e.g. Anjali Kulkarni"
                    maxLength={120}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Official Email (Firebase Auth Login) *
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="hr.officer@rexonsecurity.com"
                    maxLength={160}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Mobile Number *
                  </label>
                  <input
                    type="tel"
                    value={formData.mobile}
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                    placeholder="+91 98XXXXXXXX"
                    maxLength={20}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Joining Date *
                  </label>
                  <input
                    type="date"
                    value={formData.joiningDate}
                    onChange={(e) => setFormData({ ...formData, joiningDate: e.target.value })}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Account Status *
                  </label>
                  <select
                    value={formData.accountStatus}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        accountStatus: e.target.value as HRAccountStatus,
                      })
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    HR Designation (HR Type) *
                  </label>
                  <select
                    value={formData.hrDesignation}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        hrDesignation: e.target.value as HRDesignation,
                      })
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {HR_DESIGNATIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Permission Profile *
                  </label>
                  <select
                    value={formData.permissionProfile}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        permissionProfile: e.target.value as PermissionProfileName,
                      })
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {PERMISSION_PROFILES.map((prof) => (
                      <option key={prof} value={prof}>
                        {prof}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Visible Granted Scopes */}
              <div className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs">
                <span className="font-semibold text-[#574B43]">Granted Permissions: </span>
                <span className="font-mono-tabular text-[#5C3D2E]">
                  {PERMISSION_PROFILE_MAP[formData.permissionProfile].join(' · ')}
                </span>
              </div>

              {/* Assigned Branches Multi-Select */}
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-2">
                  Assigned Branches (Select one or more) *
                </label>
                {branches.length === 0 ? (
                  <p className="text-xs text-[#B91C1C]">
                    Create at least one Branch in Branch Management before assigning HR officers.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {branches.map((branch) => {
                      const checked = formData.assignedBranches.includes(branch.branchId);
                      return (
                        <label
                          key={branch.branchId}
                          className={`min-h-[44px] flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors text-xs ${
                            checked
                              ? 'bg-[#F3EDE4] border-[#5C3D2E] text-[#1F1916] font-semibold'
                              : 'bg-[#FAF8F5] border-[#E5DDD2] text-[#574B43] hover:bg-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBranchSelection(branch.branchId)}
                            className="w-4 h-4 accent-[#5C3D2E] rounded"
                          />
                          <span className="truncate">
                            {branch.branchCode} — {branch.branchName}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-[#E5DDD2] flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] px-5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60 transition-colors"
                >
                  {saving
                    ? 'Provisioning HR Account...'
                    : editingHR
                      ? 'Save HR Account Changes'
                      : 'Provision HR Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View HR Details Modal */}
      {viewingHR && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E5DDD2]">
              <div className="flex items-center gap-3.5">
                {viewingHR.profilePhoto ? (
                  <img
                    src={viewingHR.profilePhoto}
                    alt={viewingHR.fullName}
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 rounded-full object-cover border border-[#D4C7B8]"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-[#F3EDE4] border border-[#D4C7B8] text-[#5C3D2E] font-display text-sm font-bold flex items-center justify-center">
                    {getInitials(viewingHR.fullName)}
                  </div>
                )}
                <div>
                  <div className="font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                    {viewingHR.hrId} · {viewingHR.hrDesignation}
                  </div>
                  <h2 className="font-display text-lg font-bold text-[#1F1916]">
                    {viewingHR.fullName}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingHR(null)}
                className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <dl className="mt-4 divide-y divide-[#E5DDD2] text-sm">
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#574B43]">Email &amp; Mobile</dt>
                <dd className="text-right font-mono-tabular text-xs text-[#1F1916]">
                  {viewingHR.email} · {viewingHR.mobile}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#574B43]">Account Status</dt>
                <dd className="font-semibold text-[#1F1916]">{viewingHR.accountStatus}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#574B43]">Joining Date</dt>
                <dd className="font-mono-tabular text-[#1F1916]">{viewingHR.joiningDate}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#574B43]">Permission Profile</dt>
                <dd className="font-semibold text-[#5C3D2E]">{viewingHR.permissionProfile}</dd>
              </div>
              <div className="py-2.5">
                <dt className="text-[#574B43] mb-1">Assigned Branches</dt>
                <dd className="text-xs text-[#1F1916]">
                  {viewingHR.assignedBranches
                    .map((id) => branchNameMap[id] ?? id)
                    .join(' · ')}
                </dd>
              </div>
              <div className="py-2.5">
                <dt className="text-[#574B43] mb-1">Effective Permissions</dt>
                <dd className="font-mono-tabular text-xs text-[#4A3023]">
                  {viewingHR.permissions.join(' · ')}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const target = viewingHR;
                  setViewingHR(null);
                  openEditModal(target);
                }}
                className="min-h-[42px] px-4 py-2 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E]"
              >
                Edit HR Account
              </button>
              <button
                type="button"
                onClick={() => setViewingHR(null)}
                className="min-h-[42px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={`Change HR Account Status`}
        description={`Set account status for ${statusTarget?.hr.fullName ?? ''} (${statusTarget?.hr.hrId ?? ''}) to ${statusTarget?.nextStatus ?? ''}?`}
        confirmLabel={`Mark ${statusTarget?.nextStatus ?? ''}`}
        loading={statusBusy}
        onConfirm={handleConfirmStatusChange}
        onCancel={() => setStatusTarget(null)}
      />
    </div>
  );
};
