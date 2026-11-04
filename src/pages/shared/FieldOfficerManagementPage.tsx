import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Camera,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { PortalCredentialSlipModal } from '../../components/PortalCredentialSlipModal';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  MAX_PHOTO_UPLOAD_BYTES,
  generateDefaultPortalPassword,
  isSupportedImageFile,
} from '../../services/firebase/config';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  buildFieldOfficerCredentialsView,
  createFieldOfficerAccount,
  listBranches,
  listFieldOfficers,
  listSites,
  subscribeMasterData,
  toggleFieldOfficerStatus,
  updateFieldOfficerAccount,
  uploadFieldOfficerPhoto,
} from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  FieldOfficerFormInput,
  FieldOfficerRecord,
  IssuedPortalCredentials,
  SiteRecord,
} from '../../types';
import { validateFieldOfficerForm } from '../../utils/masterValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';

const FIELD_OFFICER_DESIGNATIONS = [
  'Field Officer',
  'Senior Field Officer',
  'Area Operations Officer',
  'Night Patrol Supervisor',
  'Zonal Inspection Officer',
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export const FieldOfficerManagementPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canManage =
    isAdmin || (user?.role === 'hr' && hasUserPermission(user, 'employee.manage'));

  const [officers, setOfficers] = useState<FieldOfficerRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState<FieldOfficerRecord | null>(null);
  const [formData, setFormData] = useState<FieldOfficerFormInput>({
    fullName: '',
    email: '',
    phone: '',
    profilePhoto: '',
    designationLabel: 'Field Officer',
    branchId: '',
    assignedBranches: [],
    assignedSiteIds: [],
    isActive: true,
    initialPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Credential Slip Modal & Status Confirm
  const [slipCredentials, setSlipCredentials] = useState<IssuedPortalCredentials | null>(null);
  const [statusTarget, setStatusTarget] = useState<FieldOfficerRecord | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [foList, brList, siteList] = await Promise.all([
        listFieldOfficers(user, isPreviewSession),
        listBranches(user, isPreviewSession),
        listSites(user, isPreviewSession),
      ]);
      setOfficers(foList);
      setBranches(brList.filter((b) => !b.isDeleted));
      setSites(siteList.filter((s) => !s.isArchived));
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

  const authorizedBranches = useMemo(() => {
    if (isAdmin) return branches;
    const allowed = getAuthorizedBranchIds(user);
    return branches.filter((b) => allowed.includes(b.branchId));
  }, [branches, isAdmin, user]);

  const branchMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of branches) {
      map[b.branchId] = `${b.branchCode} (${b.city})`;
    }
    return map;
  }, [branches]);

  const siteMap = useMemo(() => {
    const map: Record<string, SiteRecord> = {};
    for (const s of sites) {
      map[s.siteId] = s;
    }
    return map;
  }, [sites]);

  const selectableSitesForForm = useMemo(() => {
    const selectedBranches =
      formData.assignedBranches.length > 0
        ? formData.assignedBranches
        : formData.branchId
          ? [formData.branchId]
          : [];
    if (selectedBranches.length === 0) return sites;
    return sites.filter((s) => selectedBranches.includes(s.branchId));
  }, [sites, formData.assignedBranches, formData.branchId]);

  const stats = useMemo(() => {
    const active = officers.filter((o) => o.isActive).length;
    const coveredBranches = new Set(officers.flatMap((o) => o.assignedBranches)).size;
    const coveredSites = new Set(officers.flatMap((o) => o.assignedSiteIds)).size;
    return {
      total: officers.length,
      active,
      coveredBranches,
      coveredSites,
    };
  }, [officers]);

  const filteredOfficers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return officers.filter((fo) => {
      if (statusFilter === 'ACTIVE' && !fo.isActive) return false;
      if (statusFilter === 'INACTIVE' && fo.isActive) return false;
      if (
        branchFilter !== 'ALL' &&
        fo.branchId !== branchFilter &&
        !fo.assignedBranches.includes(branchFilter)
      ) {
        return false;
      }
      if (!q) return true;
      const siteLabels = fo.assignedSiteIds
        .map((id) => siteMap[id]?.siteName ?? id)
        .join(' ')
        .toLowerCase();
      return (
        fo.fieldOfficerId.toLowerCase().includes(q) ||
        fo.fullName.toLowerCase().includes(q) ||
        fo.email.toLowerCase().includes(q) ||
        fo.phone.toLowerCase().includes(q) ||
        fo.designationLabel.toLowerCase().includes(q) ||
        siteLabels.includes(q)
      );
    });
  }, [officers, searchQuery, statusFilter, branchFilter, siteMap]);

  const paginatedOfficers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredOfficers.slice(start, start + pageSize);
  }, [filteredOfficers, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, branchFilter]);

  const openCreateModal = () => {
    const defaultBr = authorizedBranches[0]?.branchId || user?.branchId || '';
    setEditingOfficer(null);
    setFormData({
      fullName: '',
      email: '',
      phone: '',
      profilePhoto: '',
      designationLabel: 'Field Officer',
      branchId: defaultBr,
      assignedBranches: defaultBr ? [defaultBr] : [],
      assignedSiteIds: [],
      isActive: true,
      initialPassword: '',
    });
    setShowPassword(false);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (fo: FieldOfficerRecord) => {
    setEditingOfficer(fo);
    setFormData({
      fullName: fo.fullName,
      email: fo.email,
      phone: fo.phone,
      profilePhoto: fo.profilePhoto,
      designationLabel: fo.designationLabel || 'Field Officer',
      branchId: fo.branchId,
      assignedBranches: fo.assignedBranches.length > 0 ? [...fo.assignedBranches] : [fo.branchId],
      assignedSiteIds: [...fo.assignedSiteIds],
      isActive: fo.isActive,
      initialPassword: '',
    });
    setShowPassword(false);
    setFormError(null);
    setModalOpen(true);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.currentTarget;
    const file = inputEl.files?.[0];
    if (!file) return;
    if (!isSupportedImageFile(file)) {
      inputEl.value = '';
      setFormError('Field Officer photo must be a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
      inputEl.value = '';
      setFormError('Field Officer photo size must not exceed 15 MB.');
      return;
    }
    setFormError(null);
    setUploadingPhoto(true);
    try {
      const url = await uploadFieldOfficerPhoto(
        editingOfficer?.fieldOfficerId || 'NEW_FO',
        file,
        isPreviewSession
      );
      setFormData((prev) => ({ ...prev, profilePhoto: url }));
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      inputEl.value = '';
      setUploadingPhoto(false);
    }
  };

  const toggleBranchInForm = (branchId: string) => {
    setFormData((prev) => {
      const exists = prev.assignedBranches.includes(branchId);
      const nextBranches = exists
        ? prev.assignedBranches.filter((id) => id !== branchId)
        : [...prev.assignedBranches, branchId];
      const nextPrimary = nextBranches.includes(prev.branchId)
        ? prev.branchId
        : nextBranches[0] || '';
      return {
        ...prev,
        branchId: nextPrimary,
        assignedBranches: nextBranches,
      };
    });
  };

  const toggleSiteInForm = (siteId: string) => {
    setFormData((prev) => {
      const exists = prev.assignedSiteIds.includes(siteId);
      const nextSites = exists
        ? prev.assignedSiteIds.filter((id) => id !== siteId)
        : [...prev.assignedSiteIds, siteId];
      return { ...prev, assignedSiteIds: nextSites };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);

    const normalizedInput: FieldOfficerFormInput = {
      ...formData,
      branchId: formData.branchId || formData.assignedBranches[0] || '',
      assignedBranches:
        formData.assignedBranches.length > 0
          ? formData.assignedBranches
          : formData.branchId
            ? [formData.branchId]
            : [],
    };

    const check = validateFieldOfficerForm(normalizedInput, officers, editingOfficer?.uid);
    if (!check.valid) {
      setFormError(check.error ?? 'Verify all Field Officer fields.');
      return;
    }

    setSaving(true);
    try {
      if (editingOfficer) {
        await updateFieldOfficerAccount(user, isPreviewSession, editingOfficer.uid, normalizedInput);
        setBanner({
          type: 'success',
          text: `Field Officer ${editingOfficer.fieldOfficerId} (${normalizedInput.fullName}) updated.`,
        });
      } else {
        const { record, issuedCredentials } = await createFieldOfficerAccount(
          user,
          isPreviewSession,
          normalizedInput
        );
        setSlipCredentials(issuedCredentials);
        setBanner({
          type: 'success',
          text: `Field Officer ${record.fieldOfficerId} (${record.fullName}) registered with Field Officer Portal login credentials.`,
        });
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmStatusToggle = async () => {
    if (!user || !statusTarget) return;
    setStatusBusy(true);
    try {
      const nextActive = !statusTarget.isActive;
      await toggleFieldOfficerStatus(user, isPreviewSession, statusTarget.uid, nextActive);
      setBanner({
        type: 'success',
        text: `Field Officer ${statusTarget.fieldOfficerId} (${statusTarget.fullName}) marked ${nextActive ? 'Active' : 'Inactive'}.`,
      });
      setStatusTarget(null);
      await loadData();
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
      setStatusTarget(null);
    } finally {
      setStatusBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Field Officer Management
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Register Field Officers, assign operational branches &amp; client sites, and issue
            isolated Field Officer Portal login IDs &amp; passwords.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="min-h-[42px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {canManage && (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs sm:text-sm font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Register Field Officer</span>
            </button>
          )}
        </div>
      </div>

      {/* Role Isolation Callout */}
      <div className="p-4 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] flex items-start gap-3 text-xs text-[#4A3023]">
        <ShieldCheck className="w-4 h-4 text-[#5C3D2E] shrink-0 mt-0.5" />
        <div>
          <strong className="text-[#1F1916]">Field Officer Portal Scope &amp; Isolation:</strong>{' '}
          Each Field Officer receives a dedicated Login ID &amp; Password for{' '}
          <code className="font-mono-tabular">/field-officer/login</code> and can inspect only their
          assigned branches &amp; sites without access to private employee Aadhaar, bank, or salary
          records.
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
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Total Field Officers"
          value={stats.total}
          subtext="Provisioned field supervision staff"
          icon={Users}
        />
        <StatMetricCard
          label="Active Field Officers"
          value={stats.active}
          subtext="Enabled for Field Officer Portal"
          icon={UserCheck}
        />
        <StatMetricCard
          label="Covered Branches"
          value={stats.coveredBranches}
          subtext="Operational branches with officers"
          icon={Building2}
        />
        <StatMetricCard
          label="Assigned Client Sites"
          value={stats.coveredSites}
          subtext="Sites under direct inspection scope"
          icon={MapPin}
        />
      </section>

      {/* Directory Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Field Officer Directory &amp; Portal Access
            </h2>
            <p className="text-xs text-[#574B43]">
              Click <strong>ID &amp; Password</strong> on any row to copy or share their Field
              Officer Portal login slip.
            </p>
          </div>

          {authorizedBranches.length > 1 && (
            <select
              aria-label="Filter by Branch"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="min-h-[38px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
            >
              <option value="ALL">All Authorized Branches</option>
              {authorizedBranches.map((b) => (
                <option key={b.branchId} value={b.branchId}>
                  {b.branchCode} — {b.city}
                </option>
              ))}
            </select>
          )}
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search FO ID, name, mobile, email, or assigned site..."
          filterOptions={[
            { value: 'ALL', label: 'All Officers' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
          ]}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
        />

        {loading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-[#FAF8F5] animate-pulse" />
            ))}
          </div>
        ) : filteredOfficers.length === 0 ? (
          <EmptyStatePanel
            icon={UserCheck}
            title="No Field Officers Found"
            description="Register a Field Officer to issue their Field Officer Portal ID & Password and assign inspection sites."
            actionLabel={canManage ? 'Register Field Officer' : undefined}
            onAction={canManage ? openCreateModal : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Field Officer</th>
                    <th className="py-3 px-3">Portal Login ID &amp; Contact</th>
                    <th className="py-3 px-3">Branch &amp; Site Scope</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedOfficers.map((fo) => (
                    <tr key={fo.uid} className="hover:bg-[#FAF8F5] transition-colors align-top">
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-3">
                          {fo.profilePhoto ? (
                            <img
                              src={fo.profilePhoto}
                              alt={fo.fullName}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-full object-cover border border-[#D4C7B8] shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-[#F3EDE4] border border-[#D4C7B8] text-[#5C3D2E] font-display text-xs font-bold flex items-center justify-center shrink-0">
                              {getInitials(fo.fullName)}
                            </div>
                          )}
                          <div>
                            <div className="font-semibold text-[#1F1916]">{fo.fullName}</div>
                            <div className="text-xs text-[#574B43]">
                              <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                                {fo.fieldOfficerId}
                              </span>{' '}
                              · {fo.designationLabel || 'Field Officer'}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 text-xs">
                        <div className="font-mono-tabular font-semibold text-[#1F1916]">
                          {fo.email}
                        </div>
                        <div className="font-mono-tabular text-[#574B43] mt-0.5">{fo.phone}</div>
                      </td>

                      <td className="py-3.5 px-3 text-xs text-[#4A3023]">
                        <div className="font-semibold text-[#1F1916]">
                          {fo.assignedBranches.map((b) => branchMap[b] ?? b).join(' · ') ||
                            fo.branchId}
                        </div>
                        <div className="text-[#574B43] mt-0.5">
                          {fo.assignedSiteIds.length > 0
                            ? `${fo.assignedSiteIds.length} Assigned Site(s): ${fo.assignedSiteIds
                                .slice(0, 3)
                                .map((id) => siteMap[id]?.siteName ?? id)
                                .join(', ')}${fo.assignedSiteIds.length > 3 ? '...' : ''}`
                            : 'All sites in assigned branch'}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 text-xs font-semibold whitespace-nowrap">
                        <span className={fo.isActive ? 'text-[#166534]' : 'text-[#B45309]'}>
                          {fo.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() =>
                                setSlipCredentials(
                                  buildFieldOfficerCredentialsView(fo, isPreviewSession)
                                )
                              }
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#E7DDD0] inline-flex items-center gap-1 whitespace-nowrap"
                              title="View Field Officer Login ID & Password"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>ID &amp; Password</span>
                            </button>
                          )}

                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(fo)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4]"
                                title="Edit Field Officer"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-[#5C3D2E]" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setStatusTarget(fo)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#4A3023] hover:bg-[#F3EDE4]"
                              >
                                {fo.isActive ? 'Deactivate' : 'Activate'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={page}
              totalItems={filteredOfficers.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Register / Edit Field Officer Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-xl my-auto max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E5DDD2]">
              <div>
                <h2 className="font-display text-lg font-bold text-[#1F1916]">
                  {editingOfficer
                    ? `Edit Field Officer — ${editingOfficer.fieldOfficerId}`
                    : 'Register New Field Officer'}
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  Auto-generates Field Officer ID and provisions Field Officer Portal login
                  credentials.
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

            <form onSubmit={(e) => void handleSave(e)} className="mt-5 space-y-4" noValidate>
              {/* Photo Upload */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <div className="flex items-center gap-3.5">
                  {formData.profilePhoto ? (
                    <img
                      src={formData.profilePhoto}
                      alt={formData.fullName || 'Field Officer'}
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-full object-cover border border-[#D4C7B8] shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-[#F3EDE4] border border-[#D4C7B8] text-[#5C3D2E] font-display text-sm font-bold flex items-center justify-center shrink-0">
                      {formData.fullName ? getInitials(formData.fullName) : 'FO'}
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-[#1F1916]">
                      Field Officer Photograph
                      {formData.profilePhoto ? (
                        <span className="text-[#166534] ml-1.5">· Ready</span>
                      ) : null}
                    </p>
                    <p className="font-mono-tabular text-xs text-[#5C3D2E]">
                      {editingOfficer ? editingOfficer.fieldOfficerId : 'Auto-Generated (FO-YYYY-XXXX)'}
                    </p>
                    <p className="text-[11px] text-[#7D6F65]">
                      JPG, PNG, or WebP up to 15 MB · Instant auto-compression
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] cursor-pointer whitespace-nowrap">
                    <Camera className="w-4 h-4" />
                    <span>
                      {uploadingPhoto
                        ? 'Processing...'
                        : formData.profilePhoto
                          ? 'Change Photo'
                          : 'Upload Photo'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={uploadingPhoto}
                      onChange={(e) => void handlePhotoUpload(e)}
                      className="sr-only"
                    />
                  </label>
                  {formData.profilePhoto && (
                    <button
                      type="button"
                      onClick={() => setFormData((p) => ({ ...p, profilePhoto: '' }))}
                      className="min-h-[40px] px-2.5 py-2 rounded-lg text-xs font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Full Name <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="e.g. Vikram Rathore"
                    maxLength={120}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Mobile Number <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+91 98201 XXXXX"
                    maxLength={20}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Email Address (Optional · Auto FO ID Login if blank)
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    disabled={Boolean(editingOfficer)}
                    placeholder="officer@rexon.com or leave blank"
                    maxLength={160}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E] disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Officer Designation
                  </label>
                  <select
                    value={formData.designationLabel}
                    onChange={(e) => setFormData({ ...formData, designationLabel: e.target.value })}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {FIELD_OFFICER_DESIGNATIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Portal Login ID & Password Preview on Creation */}
              {!editingOfficer && (
                <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#D4C7B8] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#1F1916]">
                      <KeyRound className="w-3.5 h-3.5 text-[#5C3D2E]" />
                      <span>Field Officer Portal Login ID &amp; Password</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFormData((p) => ({
                          ...p,
                          initialPassword: generateDefaultPortalPassword(p.phone),
                        }));
                        setShowPassword(true);
                      }}
                      className="min-h-[30px] px-2.5 py-1 rounded-md bg-white border border-[#D4C7B8] text-[11px] font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap"
                    >
                      Use Auto Password ({generateDefaultPortalPassword(formData.phone)})
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-white border border-[#E5DDD2] rounded-lg p-3">
                    <div>
                      <span className="text-[#7D6F65] block">Portal Login ID</span>
                      <span className="font-mono-tabular font-semibold text-[#1F1916] break-all">
                        {formData.email.trim() || 'Auto FO ID (FO-YYYY-XXXX)'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#7D6F65] block">Password Issued on Save</span>
                      <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                        {(formData.initialPassword ?? '').trim().length >= 6
                          ? (formData.initialPassword ?? '').trim()
                          : generateDefaultPortalPassword(formData.phone)}
                      </span>
                    </div>
                  </div>

                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#7D6F65] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.initialPassword ?? ''}
                      onChange={(e) =>
                        setFormData({ ...formData, initialPassword: e.target.value })
                      }
                      placeholder={`Custom password (min 6 chars) or leave blank for ${generateDefaultPortalPassword(formData.phone)}`}
                      autoComplete="new-password"
                      className="w-full min-h-[42px] pl-10 pr-11 py-2 text-sm font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg focus:outline-none focus:border-[#5C3D2E]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[34px] min-w-[34px] flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Authorized Branches */}
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1.5">
                  Assigned Operational Branch(es) <span className="text-[#B91C1C]">*</span>
                </label>
                {authorizedBranches.length === 0 ? (
                  <p className="text-xs text-[#92400E] p-3 rounded-lg bg-[#FFFBEB] border border-[#FDE68A]">
                    Create at least one Branch in Branch Management before registering Field
                    Officers.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {authorizedBranches.map((br) => {
                      const checked = formData.assignedBranches.includes(br.branchId);
                      return (
                        <label
                          key={br.branchId}
                          className={`min-h-[42px] flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer text-xs ${
                            checked
                              ? 'bg-[#F3EDE4] border-[#5C3D2E] text-[#1F1916] font-semibold'
                              : 'bg-[#FAF8F5] border-[#E5DDD2] text-[#574B43] hover:bg-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBranchInForm(br.branchId)}
                            className="w-4 h-4 accent-[#5C3D2E] rounded"
                          />
                          <span className="truncate">
                            {br.branchCode} — {br.branchName} ({br.city})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Assigned Sites */}
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1.5">
                  Assigned Client Sites (Optional — Leave unchecked to cover all branch sites)
                </label>
                {selectableSitesForForm.length === 0 ? (
                  <p className="text-xs text-[#7D6F65] p-3 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                    No active Sites under selected branch(es) yet. You can assign Sites anytime.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto p-1">
                    {selectableSitesForForm.map((site) => {
                      const checked = formData.assignedSiteIds.includes(site.siteId);
                      return (
                        <label
                          key={site.siteId}
                          className={`min-h-[40px] flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer text-xs ${
                            checked
                              ? 'bg-[#F3EDE4] border-[#5C3D2E] text-[#1F1916] font-semibold'
                              : 'bg-[#FAF8F5] border-[#E5DDD2] text-[#574B43] hover:bg-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSiteInForm(site.siteId)}
                            className="w-4 h-4 accent-[#5C3D2E] rounded shrink-0"
                          />
                          <span className="truncate">
                            <span className="font-mono-tabular">{site.siteId}</span> —{' '}
                            {site.siteName}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#1F1916] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-4 h-4 accent-[#5C3D2E] rounded"
                  />
                  <span>Active Field Officer Portal Account</span>
                </label>
              </div>

              <div className="pt-4 border-t border-[#E5DDD2] flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916] whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadingPhoto}
                  className="min-h-[44px] px-5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60 whitespace-nowrap"
                >
                  {saving
                    ? 'Saving Field Officer...'
                    : editingOfficer
                      ? 'Save Field Officer Changes'
                      : 'Register & Generate Login ID'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <PortalCredentialSlipModal
        credentials={slipCredentials}
        onClose={() => setSlipCredentials(null)}
      />

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={
          statusTarget?.isActive
            ? `Deactivate Field Officer ${statusTarget.fieldOfficerId}?`
            : `Activate Field Officer ${statusTarget?.fieldOfficerId ?? ''}?`
        }
        description={
          statusTarget?.isActive
            ? `Deactivating ${statusTarget.fullName} suspends their Field Officer Portal sign-in while preserving past inspection and attendance logs.`
            : `Activating ${statusTarget?.fullName ?? ''} restores their Field Officer Portal access.`
        }
        confirmLabel={statusTarget?.isActive ? 'Deactivate' : 'Activate'}
        loading={statusBusy}
        onConfirm={() => void handleConfirmStatusToggle()}
        onCancel={() => setStatusTarget(null)}
      />
    </div>
  );
};
