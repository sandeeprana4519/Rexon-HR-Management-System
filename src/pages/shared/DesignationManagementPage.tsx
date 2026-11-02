import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Edit3,
  Eye,
  FileBadge,
  GraduationCap,
  Plus,
  Power,
  ShieldCheck,
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
  createDesignationRecord,
  listDesignations,
  listServices,
  subscribeMasterData,
  toggleDesignationStatus,
  updateDesignationRecord,
} from '../../services/firestore/masterDataService';
import {
  DesignationFormInput,
  DesignationRecord,
  MasterActiveStatus,
  SERVICE_CATEGORIES,
  ServiceCategory,
  ServiceRecord,
} from '../../types';
import { validateDesignationForm } from '../../utils/masterValidation';
import { hasUserPermission } from '../../utils/portalConfig';

interface DesignationManagementPageProps {
  embedded?: boolean;
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const DesignationManagementPage: React.FC<DesignationManagementPageProps> = ({
  embedded = false,
}) => {
  const { user, isPreviewSession } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canManageDesignation = hasUserPermission(user, 'designation.manage');

  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDesignation, setEditingDesignation] = useState<DesignationRecord | null>(null);
  const [formData, setFormData] = useState<DesignationFormInput>({
    designationName: '',
    serviceCategory: 'Security',
    relatedServiceId: '',
    relatedServiceName: '',
    description: '',
    requiredSkills: '',
    qualification: '',
    trainingRequirements: '',
    licenseRequirements: '',
    status: 'Active',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Detail & Status Toggle Modals
  const [viewingDesignation, setViewingDesignation] = useState<DesignationRecord | null>(null);
  const [toggleTarget, setToggleTarget] = useState<{
    designation: DesignationRecord;
    nextStatus: MasterActiveStatus;
  } | null>(null);
  const [toggling, setToggling] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [dsgList, srvList] = await Promise.all([
        listDesignations(user, isPreviewSession),
        listServices(user, isPreviewSession),
      ]);
      setDesignations(dsgList);
      setServices(srvList);
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
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

  useEffect(() => {
    if (!viewingDesignation) return;
    const updated = designations.find(
      (d) => d.designationId === viewingDesignation.designationId
    );
    if (updated) {
      setViewingDesignation(updated);
    }
  }, [designations, viewingDesignation]);

  const categoryServices = useMemo(() => {
    return services.filter(
      (s) =>
        s.serviceCategory === formData.serviceCategory &&
        (s.status === 'Active' || s.serviceId === formData.relatedServiceId)
    );
  }, [services, formData.serviceCategory, formData.relatedServiceId]);

  const kpis = useMemo(() => {
    const active = designations.filter((d) => d.status === 'Active').length;
    const sec = designations.filter((d) => d.serviceCategory === 'Security').length;
    const hkp = designations.filter((d) => d.serviceCategory === 'Housekeeping').length;
    const mnp = designations.filter((d) => d.serviceCategory === 'Manpower').length;
    return {
      total: designations.length,
      active,
      sec,
      hkpAndMnp: hkp + mnp,
      hkp,
      mnp,
    };
  }, [designations]);

  const filteredDesignations = useMemo(() => {
    return designations.filter((d) => {
      if (categoryFilter !== 'ALL' && d.serviceCategory !== categoryFilter) return false;
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        d.designationId.toLowerCase().includes(q) ||
        d.designationName.toLowerCase().includes(q) ||
        d.relatedServiceName.toLowerCase().includes(q) ||
        d.serviceCategory.toLowerCase().includes(q) ||
        d.requiredSkills.toLowerCase().includes(q) ||
        d.qualification.toLowerCase().includes(q) ||
        d.licenseRequirements.toLowerCase().includes(q)
      );
    });
  }, [designations, categoryFilter, statusFilter, searchQuery]);

  const paginatedDesignations = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredDesignations.slice(start, start + pageSize);
  }, [filteredDesignations, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, categoryFilter, statusFilter]);

  const openCreateModal = () => {
    const defaultCategory: ServiceCategory =
      categoryFilter !== 'ALL' ? (categoryFilter as ServiceCategory) : 'Security';
    const matchingService = services.find(
      (s) => s.serviceCategory === defaultCategory && s.status === 'Active'
    );

    setEditingDesignation(null);
    setFormData({
      designationName: '',
      serviceCategory: defaultCategory,
      relatedServiceId: matchingService?.serviceId ?? '',
      relatedServiceName: matchingService?.serviceName ?? '',
      description: '',
      requiredSkills: '',
      qualification: '',
      trainingRequirements: '',
      licenseRequirements: '',
      status: 'Active',
    });
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (d: DesignationRecord) => {
    setEditingDesignation(d);
    setFormData({
      designationName: d.designationName,
      serviceCategory: d.serviceCategory,
      relatedServiceId: d.relatedServiceId,
      relatedServiceName: d.relatedServiceName,
      description: d.description,
      requiredSkills: d.requiredSkills,
      qualification: d.qualification,
      trainingRequirements: d.trainingRequirements,
      licenseRequirements: d.licenseRequirements,
      status: d.status,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleCategoryChange = (nextCat: ServiceCategory) => {
    const firstSrv = services.find((s) => s.serviceCategory === nextCat && s.status === 'Active');
    setFormData((prev) => ({
      ...prev,
      serviceCategory: nextCat,
      relatedServiceId: firstSrv?.serviceId ?? '',
      relatedServiceName: firstSrv?.serviceName ?? '',
    }));
  };

  const handleRelatedServiceChange = (srvId: string) => {
    const found = services.find((s) => s.serviceId === srvId);
    setFormData((prev) => ({
      ...prev,
      relatedServiceId: found?.serviceId ?? '',
      relatedServiceName: found?.serviceName ?? '',
    }));
  };

  const handleSaveDesignation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);

    const check = validateDesignationForm(
      formData,
      designations,
      editingDesignation?.designationId
    );
    if (!check.valid) {
      setFormError(check.error ?? 'Verify all Designation fields.');
      return;
    }

    setSaving(true);
    try {
      if (editingDesignation) {
        await updateDesignationRecord(
          user,
          isPreviewSession,
          editingDesignation.designationId,
          formData
        );
        setFeedback({
          type: 'success',
          text: `Designation ${editingDesignation.designationId} (${formData.designationName}) updated.`,
        });
      } else {
        const created = await createDesignationRecord(user, isPreviewSession, formData);
        setFeedback({
          type: 'success',
          text: `Designation ${created.designationId} (${created.designationName}) added dynamically without code changes.`,
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

  const handleConfirmToggle = async () => {
    if (!user || !toggleTarget) return;
    setToggling(true);
    try {
      await toggleDesignationStatus(
        user,
        isPreviewSession,
        toggleTarget.designation.designationId,
        toggleTarget.nextStatus
      );
      setFeedback({
        type: 'success',
        text: `Designation ${toggleTarget.designation.designationName} (${toggleTarget.designation.designationId}) marked ${toggleTarget.nextStatus}.`,
      });
      setToggleTarget(null);
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="space-y-8">
      {!embedded ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
              Designation Master Management
            </h1>
            <p className="mt-1 text-sm text-[#574B43]">
              {isAdmin
                ? 'Create and manage deployment Designations, qualifications, PSARA/fire training, and licensing criteria dynamically without code changes.'
                : 'Inspect authorized Designations, required skills, qualifications, and statutory license requirements.'}
            </p>
          </div>

          {canManageDesignation && (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3023] transition-colors self-start sm:self-auto whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Create Designation</span>
            </button>
          )}
        </div>
      ) : (
        canManageDesignation && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Create Designation</span>
            </button>
          </div>
        )
      )}

      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 text-xs ${
            feedback.type === 'success'
              ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Summary */}
      <section aria-label="Designation metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMetricCard
            label="Total Designations"
            value={kpis.total}
            subtext="Dynamic role records in Firestore"
            icon={Award}
          />
          <StatMetricCard
            label="Active Designations"
            value={kpis.active}
            subtext="Available for Site post configuration"
            icon={ShieldCheck}
          />
          <StatMetricCard
            label="Security Roles"
            value={kpis.sec}
            subtext="Guard, Gunman, Armed & Supervisory"
            icon={FileBadge}
          />
          <StatMetricCard
            label="Housekeeping & Manpower"
            value={kpis.hkpAndMnp}
            subtext={`${kpis.hkp} Housekeeping · ${kpis.mnp} Manpower`}
            icon={GraduationCap}
          />
        </div>
      </section>

      {/* Main Designation Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Designation &amp; Competency Registry
            </h2>
            <p className="text-xs text-[#574B43]">
              Every Designation links to one Service Category and Related Service, storing skills,
              qualification, training, and license compliance rules.
            </p>
          </div>

          <select
            aria-label="Filter by Designation Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E] self-start sm:self-auto"
          >
            <option value="ALL">All Statuses</option>
            <option value="Active">Active Only</option>
            <option value="Inactive">Inactive Only</option>
          </select>
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search Designation ID, name, service, skill, or license..."
          filterOptions={[
            { value: 'ALL', label: 'All Categories' },
            ...SERVICE_CATEGORIES.map((cat) => ({ value: cat, label: cat })),
          ]}
          activeFilter={categoryFilter}
          onFilterChange={setCategoryFilter}
        />

        {loading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-14 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] animate-pulse"
              />
            ))}
          </div>
        ) : filteredDesignations.length === 0 ? (
          <EmptyStatePanel
            icon={Award}
            title="No Designations Match Your Filter"
            description="Adjust your search criteria or add a new Designation under an authorized Service."
            actionLabel={canManageDesignation ? 'Create Designation' : undefined}
            onAction={canManageDesignation ? openCreateModal : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Designation ID</th>
                    <th className="py-3 px-3">Designation &amp; Related Service</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Qualification &amp; License</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedDesignations.map((d) => (
                    <tr
                      key={d.designationId}
                      className="hover:bg-[#FAF8F5] transition-colors align-top"
                    >
                      <td className="py-3.5 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                        {d.designationId}
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="font-semibold text-[#1F1916]">{d.designationName}</div>
                        <div className="text-xs text-[#574B43] mt-0.5">
                          Service: <span className="font-medium">{d.relatedServiceName}</span> (
                          <span className="font-mono-tabular">{d.relatedServiceId}</span>)
                        </div>
                      </td>

                      <td className="py-3.5 px-3 text-xs font-semibold text-[#1F1916] whitespace-nowrap">
                        {d.serviceCategory}
                      </td>

                      <td className="py-3.5 px-3 text-xs text-[#574B43]">
                        <div className="text-[#1F1916] font-medium">{d.qualification}</div>
                        <div className="text-[#7D6F65] mt-0.5">{d.licenseRequirements}</div>
                      </td>

                      <td className="py-3.5 px-3 text-xs whitespace-nowrap">
                        <span
                          className={
                            d.status === 'Active'
                              ? 'font-semibold text-[#166534]'
                              : 'font-medium text-[#7D6F65]'
                          }
                        >
                          {d.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingDesignation(d)}
                            className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5 text-[#5C3D2E]" />
                            <span>Details</span>
                          </button>

                          {canManageDesignation && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(d)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors inline-flex items-center gap-1"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-[#5C3D2E]" />
                                <span>Edit</span>
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setToggleTarget({
                                    designation: d,
                                    nextStatus: d.status === 'Active' ? 'Inactive' : 'Active',
                                  })
                                }
                                className={`min-h-[36px] px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors inline-flex items-center gap-1 whitespace-nowrap ${
                                  d.status === 'Active'
                                    ? 'bg-[#FAF8F5] border-[#D4C7B8] text-[#B45309] hover:bg-[#FEF3C7]/50'
                                    : 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534] hover:bg-[#DCFCE7]'
                                }`}
                              >
                                <Power className="w-3.5 h-3.5" />
                                <span>{d.status === 'Active' ? 'Deactivate' : 'Activate'}</span>
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
              totalItems={filteredDesignations.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Create / Edit Designation Modal (All 10 Required Fields) */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-3 sm:p-5 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="designation-modal-title"
        >
          <div className="w-full max-w-3xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto max-h-[92vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2] shrink-0">
              <div>
                <h2
                  id="designation-modal-title"
                  className="font-display text-lg sm:text-xl font-bold text-[#1F1916]"
                >
                  {editingDesignation
                    ? `Edit Designation — ${editingDesignation.designationId}`
                    : 'Create New Master Designation'}
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  New designations become immediately selectable in Site Service Configuration
                  without any code deployment.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveDesignation(e)}
              className="p-5 sm:p-6 overflow-y-auto space-y-5"
              noValidate
            >
              {formError && (
                <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Designation ID (Automatic)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={
                      editingDesignation
                        ? editingDesignation.designationId
                        : 'Auto-assigned (DSG-YYYY-XXXX)'
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-xs font-mono-tabular bg-[#F3EDE4] border border-[#E5DDD2] rounded-lg text-[#574B43] cursor-not-allowed"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Designation Name <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={formData.designationName}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, designationName: e.target.value }))
                    }
                    placeholder="e.g. Senior Armed Escort / Industrial Forklift Operator"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Service Category <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={formData.serviceCategory}
                    onChange={(e) => handleCategoryChange(e.target.value as ServiceCategory)}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {SERVICE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Related Service <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={formData.relatedServiceId}
                    onChange={(e) => handleRelatedServiceChange(e.target.value)}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    <option value="">Select Service...</option>
                    {categoryServices.map((srv) => (
                      <option key={srv.serviceId} value={srv.serviceId}>
                        {srv.serviceName} ({srv.serviceCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Status <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        status: e.target.value as MasterActiveStatus,
                      }))
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Description <span className="text-[#B91C1C]">*</span>
                  </label>
                  <textarea
                    rows={2}
                    maxLength={300}
                    value={formData.description}
                    onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Role responsibility overview at client deployment sites..."
                    className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Required Skills <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={250}
                    value={formData.requiredSkills}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, requiredSkills: e.target.value }))
                    }
                    placeholder="e.g. Access logging, physical frisking, CCTV alert response, fire extinguisher operation"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Qualification <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={160}
                    value={formData.qualification}
                    onChange={(e) => setFormData((p) => ({ ...p, qualification: e.target.value }))}
                    placeholder="e.g. Minimum 10th / 12th Pass / ITI"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Training Requirements <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={200}
                    value={formData.trainingRequirements}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, trainingRequirements: e.target.value }))
                    }
                    placeholder="e.g. PSARA 20-Day Induction & Fire Drill"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    License Requirements <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={200}
                    value={formData.licenseRequirements}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, licenseRequirements: e.target.value }))
                    }
                    placeholder="e.g. Police Verification / Valid Arms License"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#E5DDD2] flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  className="min-h-[42px] px-4 py-2 text-xs font-semibold text-[#1F1916] bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg hover:bg-[#F3EDE4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[42px] px-5 py-2 text-xs font-semibold text-white bg-[#5C3D2E] rounded-lg hover:bg-[#4A3023] disabled:opacity-60"
                >
                  {saving
                    ? 'Saving Designation...'
                    : editingDesignation
                      ? 'Save Designation Changes'
                      : 'Create Designation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Full Designation Details Modal */}
      {viewingDesignation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="designation-view-title"
        >
          <div className="w-full max-w-2xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto">
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2]">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#7D6F65]">
                  <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                    {viewingDesignation.designationId}
                  </span>
                  <span>·</span>
                  <span>{viewingDesignation.serviceCategory}</span>
                  <span>·</span>
                  <span
                    className={
                      viewingDesignation.status === 'Active'
                        ? 'font-semibold text-[#166534]'
                        : 'font-medium text-[#7D6F65]'
                    }
                  >
                    {viewingDesignation.status}
                  </span>
                </div>
                <h2
                  id="designation-view-title"
                  className="mt-1 font-display text-lg font-bold text-[#1F1916]"
                >
                  {viewingDesignation.designationName}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setViewingDesignation(null)}
                className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#FAF8F5] border border-[#E5DDD2] rounded-xl p-4">
                <div>
                  <span className="text-xs text-[#7D6F65] block">Designation ID</span>
                  <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                    {viewingDesignation.designationId}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Related Service</span>
                  <span className="font-semibold text-[#1F1916]">
                    {viewingDesignation.relatedServiceName} (
                    <span className="font-mono-tabular">{viewingDesignation.relatedServiceId}</span>
                    )
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-xs text-[#7D6F65] block">Description</span>
                  <p className="text-[#1F1916] mt-0.5">{viewingDesignation.description}</p>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-xs text-[#7D6F65] block">Required Skills</span>
                  <p className="text-[#1F1916] mt-0.5">{viewingDesignation.requiredSkills}</p>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Qualification</span>
                  <p className="font-medium text-[#1F1916] mt-0.5">
                    {viewingDesignation.qualification}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">License Requirements</span>
                  <p className="font-medium text-[#1F1916] mt-0.5">
                    {viewingDesignation.licenseRequirements}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-xs text-[#7D6F65] block">Training Requirements</span>
                  <p className="text-[#1F1916] mt-0.5">{viewingDesignation.trainingRequirements}</p>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Created By</span>
                  <span className="text-xs text-[#574B43]">{viewingDesignation.createdBy}</span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Updated At</span>
                  <span className="font-mono-tabular text-xs text-[#574B43]">
                    {formatDateTime(viewingDesignation.updatedAt)}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-6 py-3.5 border-t border-[#E5DDD2] flex justify-end gap-2">
              {canManageDesignation && (
                <button
                  type="button"
                  onClick={() => {
                    const target = viewingDesignation;
                    setViewingDesignation(null);
                    openEditModal(target);
                  }}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  Edit Designation
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewingDesignation(null)}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={`${toggleTarget?.nextStatus === 'Inactive' ? 'Deactivate' : 'Activate'} Designation?`}
        description={
          toggleTarget?.nextStatus === 'Inactive'
            ? `"${toggleTarget.designation.designationName}" (${toggleTarget.designation.designationId}) will be marked Inactive for future site configurations while preserving existing deployed site posts.`
            : `"${toggleTarget?.designation.designationName ?? ''}" will become Active and selectable in Site Service Configuration.`
        }
        confirmLabel={
          toggleTarget?.nextStatus === 'Inactive'
            ? 'Deactivate Designation'
            : 'Activate Designation'
        }
        variant={toggleTarget?.nextStatus === 'Inactive' ? 'danger' : 'primary'}
        loading={toggling}
        onConfirm={() => void handleConfirmToggle()}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  );
};
