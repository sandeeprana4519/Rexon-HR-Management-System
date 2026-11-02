import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Eye,
  Layers,
  Plus,
  Power,
  Shield,
  Sparkles,
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
  createServiceRecord,
  listDesignations,
  listServices,
  subscribeMasterData,
  toggleServiceStatus,
  updateServiceRecord,
} from '../../services/firestore/masterDataService';
import {
  DesignationRecord,
  MasterActiveStatus,
  SERVICE_CATEGORIES,
  ServiceCategory,
  ServiceFormInput,
  ServiceRecord,
} from '../../types';
import { normalizeCode, validateServiceForm } from '../../utils/masterValidation';
import { hasUserPermission } from '../../utils/portalConfig';

interface ServiceManagementPageProps {
  embedded?: boolean;
}

const INITIAL_SERVICE_FORM: ServiceFormInput = {
  serviceName: '',
  serviceCategory: 'Security',
  serviceCode: '',
  description: '',
  status: 'Active',
};

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

export const ServiceManagementPage: React.FC<ServiceManagementPageProps> = ({
  embedded = false,
}) => {
  const { user, isPreviewSession } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canManageService = hasUserPermission(user, 'service.manage');

  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
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
  const [editingService, setEditingService] = useState<ServiceRecord | null>(null);
  const [formData, setFormData] = useState<ServiceFormInput>(INITIAL_SERVICE_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Detail & Status Toggle Modals
  const [viewingService, setViewingService] = useState<ServiceRecord | null>(null);
  const [toggleTarget, setToggleTarget] = useState<{
    service: ServiceRecord;
    nextStatus: MasterActiveStatus;
  } | null>(null);
  const [toggling, setToggling] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [srvList, dsgList] = await Promise.all([
        listServices(user, isPreviewSession),
        listDesignations(user, isPreviewSession),
      ]);
      setServices(srvList);
      setDesignations(dsgList);
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
    if (!viewingService) return;
    const refreshed = services.find((s) => s.serviceId === viewingService.serviceId);
    if (refreshed) {
      setViewingService(refreshed);
    }
  }, [services, viewingService]);

  const designationsByServiceId = useMemo(() => {
    const map: Record<string, DesignationRecord[]> = {};
    for (const d of designations) {
      if (!map[d.relatedServiceId]) {
        map[d.relatedServiceId] = [];
      }
      map[d.relatedServiceId].push(d);
    }
    return map;
  }, [designations]);

  const kpis = useMemo(() => {
    const activeTotal = services.filter((s) => s.status === 'Active').length;
    const secCount = services.filter((s) => s.serviceCategory === 'Security').length;
    const secActive = services.filter(
      (s) => s.serviceCategory === 'Security' && s.status === 'Active'
    ).length;
    const hkpCount = services.filter((s) => s.serviceCategory === 'Housekeeping').length;
    const hkpActive = services.filter(
      (s) => s.serviceCategory === 'Housekeeping' && s.status === 'Active'
    ).length;
    const mnpCount = services.filter((s) => s.serviceCategory === 'Manpower').length;
    const mnpActive = services.filter(
      (s) => s.serviceCategory === 'Manpower' && s.status === 'Active'
    ).length;

    return {
      total: services.length,
      activeTotal,
      secCount,
      secActive,
      hkpCount,
      hkpActive,
      mnpCount,
      mnpActive,
    };
  }, [services]);

  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      if (categoryFilter !== 'ALL' && s.serviceCategory !== categoryFilter) return false;
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        s.serviceId.toLowerCase().includes(q) ||
        s.serviceCode.toLowerCase().includes(q) ||
        s.serviceName.toLowerCase().includes(q) ||
        s.serviceCategory.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    });
  }, [services, categoryFilter, statusFilter, searchQuery]);

  const paginatedServices = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredServices.slice(start, start + pageSize);
  }, [filteredServices, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, categoryFilter, statusFilter]);

  const openCreateModal = () => {
    setEditingService(null);
    setFormData({
      ...INITIAL_SERVICE_FORM,
      serviceCategory:
        categoryFilter !== 'ALL' ? (categoryFilter as ServiceCategory) : 'Security',
    });
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (srv: ServiceRecord) => {
    setEditingService(srv);
    setFormData({
      serviceName: srv.serviceName,
      serviceCategory: srv.serviceCategory,
      serviceCode: srv.serviceCode,
      description: srv.description,
      status: srv.status,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);

    const validation = validateServiceForm(formData, services, editingService?.serviceId);
    if (!validation.valid) {
      setFormError(validation.error ?? 'Verify all Service fields.');
      return;
    }

    setSaving(true);
    try {
      if (editingService) {
        await updateServiceRecord(user, isPreviewSession, editingService.serviceId, formData);
        setFeedback({
          type: 'success',
          text: `Service ${editingService.serviceId} (${formData.serviceName}) updated.`,
        });
      } else {
        const created = await createServiceRecord(user, isPreviewSession, formData);
        setFeedback({
          type: 'success',
          text: `Service ${created.serviceId} (${created.serviceName}) created in Firestore catalog.`,
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
      await toggleServiceStatus(
        user,
        isPreviewSession,
        toggleTarget.service.serviceId,
        toggleTarget.nextStatus
      );
      setFeedback({
        type: 'success',
        text: `Service ${toggleTarget.service.serviceName} (${toggleTarget.service.serviceId}) marked ${toggleTarget.nextStatus}.`,
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
      {/* Header (omitted when embedded inside HR ServiceAndDesignationPage) */}
      {!embedded ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
              Service Master Management
            </h1>
            <p className="mt-1 text-sm text-[#574B43]">
              {isAdmin
                ? 'Dynamic Firestore catalog across Security, Housekeeping, and Manpower services. Authorized active services feed directly into Site Service Configuration.'
                : 'Authorized Security, Housekeeping, and Manpower service lines available for Site deployment configuration.'}
            </p>
          </div>

          {canManageService && (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3023] transition-colors self-start sm:self-auto whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Service</span>
            </button>
          )}
        </div>
      ) : (
        canManageService && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Service</span>
            </button>
          </div>
        )
      )}

      {/* Feedback Banner */}
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

      {/* 4 Category KPI Cards */}
      <section aria-label="Service catalog metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMetricCard
            label="Total Services"
            value={kpis.total}
            subtext={`${kpis.activeTotal} active in Firestore catalog`}
            icon={Layers}
          />
          <StatMetricCard
            label="Security Services"
            value={kpis.secCount}
            subtext={`${kpis.secActive} active guard & supervisory lines`}
            icon={Shield}
          />
          <StatMetricCard
            label="Housekeeping Services"
            value={kpis.hkpCount}
            subtext={`${kpis.hkpActive} active facility & hygiene lines`}
            icon={Sparkles}
          />
          <StatMetricCard
            label="Manpower Services"
            value={kpis.mnpCount}
            subtext={`${kpis.mnpActive} active industrial & skilled lines`}
            icon={Users}
          />
        </div>
      </section>

      {/* Main Catalog Card */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Service Directory (Security · Housekeeping · Manpower)
            </h2>
            <p className="text-xs text-[#574B43]">
              Stored in <code className="font-mono-tabular">services/&#123;serviceId&#125;</code>.
              Deactivating a service prevents new site assignments while preserving existing site
              configurations.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Filter by Service Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
            >
              <option value="ALL">All Statuses</option>
              <option value="Active">Active Only</option>
              <option value="Inactive">Inactive Only</option>
            </select>
          </div>
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search Service ID, code, service name, or description..."
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
        ) : filteredServices.length === 0 ? (
          <EmptyStatePanel
            icon={Layers}
            title="No Matching Services Found"
            description="Adjust your category or search filter, or create a new Service record in Firestore."
            actionLabel={canManageService ? 'Add New Service' : undefined}
            onAction={canManageService ? openCreateModal : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Service ID &amp; Code</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Service Name &amp; Scope</th>
                    <th className="py-3 px-3 text-right">Designations</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedServices.map((srv) => {
                    const linkedDesignations = designationsByServiceId[srv.serviceId]?.length ?? 0;

                    return (
                      <tr
                        key={srv.serviceId}
                        className="hover:bg-[#FAF8F5] transition-colors align-top"
                      >
                        <td className="py-3.5 px-3 font-mono-tabular text-xs whitespace-nowrap">
                          <div className="font-semibold text-[#5C3D2E]">{srv.serviceId}</div>
                          <div className="text-[11px] text-[#7D6F65] mt-0.5">{srv.serviceCode}</div>
                        </td>

                        <td className="py-3.5 px-3 text-xs font-semibold text-[#1F1916] whitespace-nowrap">
                          {srv.serviceCategory}
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="font-semibold text-[#1F1916]">{srv.serviceName}</div>
                          <p className="text-xs text-[#574B43] mt-0.5 max-w-xl leading-relaxed">
                            {srv.description}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 text-right font-mono-tabular font-semibold text-[#1F1916] whitespace-nowrap">
                          {linkedDesignations}
                        </td>

                        <td className="py-3.5 px-3 text-xs whitespace-nowrap">
                          <span
                            className={
                              srv.status === 'Active'
                                ? 'font-semibold text-[#166534]'
                                : 'font-medium text-[#7D6F65]'
                            }
                          >
                            {srv.status}
                          </span>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingService(srv)}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors inline-flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5 text-[#5C3D2E]" />
                              <span>View</span>
                            </button>

                            {canManageService && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(srv)}
                                  className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors inline-flex items-center gap-1"
                                >
                                  <Edit3 className="w-3.5 h-3.5 text-[#5C3D2E]" />
                                  <span>Edit</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setToggleTarget({
                                      service: srv,
                                      nextStatus: srv.status === 'Active' ? 'Inactive' : 'Active',
                                    })
                                  }
                                  className={`min-h-[36px] px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors inline-flex items-center gap-1 whitespace-nowrap ${
                                    srv.status === 'Active'
                                      ? 'bg-[#FAF8F5] border-[#D4C7B8] text-[#B45309] hover:bg-[#FEF3C7]/50'
                                      : 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534] hover:bg-[#DCFCE7]'
                                  }`}
                                >
                                  <Power className="w-3.5 h-3.5" />
                                  <span>
                                    {srv.status === 'Active' ? 'Deactivate' : 'Activate'}
                                  </span>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={page}
              totalItems={filteredServices.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Create / Edit Service Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="service-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto">
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2]">
              <div>
                <h2
                  id="service-modal-title"
                  className="font-display text-lg font-bold text-[#1F1916]"
                >
                  {editingService
                    ? `Edit Service — ${editingService.serviceId}`
                    : 'Create New Master Service'}
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  Persisted directly in Firestore under Security, Housekeeping, or Manpower.
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

            <form onSubmit={(e) => void handleSaveService(e)} className="p-5 sm:p-6 space-y-4" noValidate>
              {formError && (
                <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Service Category <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={formData.serviceCategory}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        serviceCategory: e.target.value as ServiceCategory,
                      }))
                    }
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
                    Service Code (Unique) <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={20}
                    value={formData.serviceCode}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        serviceCode: normalizeCode(e.target.value),
                      }))
                    }
                    placeholder="e.g. SEC-K9 or HKP-FAC"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular uppercase bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Service Name <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={formData.serviceName}
                    onChange={(e) => setFormData((p) => ({ ...p, serviceName: e.target.value }))}
                    placeholder="e.g. Security Guard / Pantry Staff / Machine Operator"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Operational Description <span className="text-[#B91C1C]">*</span>
                  </label>
                  <textarea
                    rows={3}
                    maxLength={300}
                    value={formData.description}
                    onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Describe duty post scope, SLA deliverables, and deployment standards..."
                    className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
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
                    ? 'Saving Service...'
                    : editingService
                      ? 'Save Service Updates'
                      : 'Create Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Service Details Modal */}
      {viewingService && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="service-view-title"
        >
          <div className="w-full max-w-2xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto">
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2]">
              <div>
                <div className="flex items-center gap-2 text-xs text-[#7D6F65]">
                  <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                    {viewingService.serviceId}
                  </span>
                  <span>·</span>
                  <span className="font-mono-tabular">{viewingService.serviceCode}</span>
                  <span>·</span>
                  <span
                    className={
                      viewingService.status === 'Active'
                        ? 'font-semibold text-[#166534]'
                        : 'font-medium text-[#7D6F65]'
                    }
                  >
                    {viewingService.status}
                  </span>
                </div>
                <h2
                  id="service-view-title"
                  className="mt-1 font-display text-lg font-bold text-[#1F1916]"
                >
                  {viewingService.serviceName} ({viewingService.serviceCategory})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setViewingService(null)}
                className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
                aria-label="Close service details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-5 text-sm">
              <div className="bg-[#FAF8F5] border border-[#E5DDD2] rounded-xl p-4 space-y-3">
                <div>
                  <span className="text-xs text-[#7D6F65] block">Operational Scope</span>
                  <p className="text-[#1F1916] mt-0.5 leading-relaxed">
                    {viewingService.description}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#E5DDD2] text-xs">
                  <div>
                    <span className="text-[#7D6F65] block">Created By</span>
                    <span className="font-medium text-[#1F1916]">{viewingService.createdBy}</span>
                  </div>
                  <div>
                    <span className="text-[#7D6F65] block">Last Updated</span>
                    <span className="font-mono-tabular text-[#1F1916]">
                      {formatDateTime(viewingService.updatedAt)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="font-display text-sm font-semibold text-[#1F1916]">
                  Linked Designations (
                  {designationsByServiceId[viewingService.serviceId]?.length ?? 0})
                </h3>
                {(designationsByServiceId[viewingService.serviceId]?.length ?? 0) === 0 ? (
                  <p className="text-xs text-[#574B43] bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg p-3">
                    No designations currently mapped to this service. Add one in Designation
                    Management.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#E5DDD2] border border-[#E5DDD2] rounded-xl bg-[#FAF8F5] px-4">
                    {designationsByServiceId[viewingService.serviceId].map((d) => (
                      <li
                        key={d.designationId}
                        className="py-2.5 text-xs flex items-center justify-between gap-3"
                      >
                        <div>
                          <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                            {d.designationId}
                          </span>{' '}
                          · <span className="font-semibold text-[#1F1916]">{d.designationName}</span>
                          <span className="text-[#574B43]"> — {d.qualification}</span>
                        </div>
                        <span
                          className={
                            d.status === 'Active'
                              ? 'font-semibold text-[#166534]'
                              : 'text-[#7D6F65]'
                          }
                        >
                          {d.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="px-5 sm:px-6 py-3.5 border-t border-[#E5DDD2] flex justify-end gap-2">
              {canManageService && (
                <button
                  type="button"
                  onClick={() => {
                    const target = viewingService;
                    setViewingService(null);
                    openEditModal(target);
                  }}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  Edit Service
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewingService(null)}
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
        title={`${toggleTarget?.nextStatus === 'Inactive' ? 'Deactivate' : 'Activate'} Service?`}
        description={
          toggleTarget?.nextStatus === 'Inactive'
            ? `"${toggleTarget.service.serviceName}" (${toggleTarget.service.serviceId}) will be marked Inactive and hidden from new Site Service selections while keeping existing site postings intact.`
            : `"${toggleTarget?.service.serviceName ?? ''}" will become Active and immediately available for HR Site Service Configuration.`
        }
        confirmLabel={
          toggleTarget?.nextStatus === 'Inactive' ? 'Deactivate Service' : 'Activate Service'
        }
        variant={toggleTarget?.nextStatus === 'Inactive' ? 'danger' : 'primary'}
        loading={toggling}
        onConfirm={() => void handleConfirmToggle()}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  );
};
