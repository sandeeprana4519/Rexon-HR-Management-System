import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Building2,
  CheckCircle2,
  Edit3,
  Eye,
  MapPin,
  Plus,
  Power,
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
  createBranchRecord,
  listBranches,
  listClients,
  listHRProfiles,
  listSites,
  softDeleteBranchRecord,
  subscribeMasterData,
  toggleBranchStatus,
  updateBranchRecord,
} from '../../services/firestore/masterDataService';
import {
  BranchFormInput,
  BranchRecord,
  BranchStatus,
  INDIAN_STATES,
} from '../../types';
import { normalizeCode, validateBranchForm } from '../../utils/masterValidation';

const EMPTY_BRANCH_FORM: BranchFormInput = {
  branchName: '',
  branchCode: '',
  managerName: '',
  mobile: '',
  email: '',
  address: '',
  city: '',
  state: 'Maharashtra',
  pinCode: '',
  status: 'Active',
};

export const BranchManagementPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();

  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [branchCounts, setBranchCounts] = useState<
    Record<string, { hr: number; clients: number; sites: number }>
  >({});
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL_ACTIVE_INACTIVE' | 'Active' | 'Inactive' | 'ARCHIVED'>('ALL_ACTIVE_INACTIVE');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 6;

  // Create / Edit Modal
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchRecord | null>(null);
  const [formData, setFormData] = useState<BranchFormInput>(EMPTY_BRANCH_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // View Detail Modal
  const [viewingBranch, setViewingBranch] = useState<BranchRecord | null>(null);

  // Confirm Dialogs
  const [statusToggleTarget, setStatusToggleTarget] = useState<{
    branch: BranchRecord;
    nextStatus: BranchStatus;
  } | null>(null);
  const [softDeleteTarget, setSoftDeleteTarget] = useState<BranchRecord | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [branchList, hrList, clientList, siteList] = await Promise.all([
        listBranches(user, isPreviewSession),
        listHRProfiles(user, isPreviewSession),
        listClients(user, isPreviewSession),
        listSites(user, isPreviewSession),
      ]);
      setBranches(branchList);

      const map: Record<string, { hr: number; clients: number; sites: number }> = {};
      for (const b of branchList) {
        map[b.branchId] = {
          hr: hrList.filter((h) => h.assignedBranches.includes(b.branchId)).length,
          clients: clientList.filter((c) => !c.isArchived && c.assignedBranch === b.branchId).length,
          sites: siteList.filter((s) => !s.isArchived && s.branchId === b.branchId).length,
        };
      }
      setBranchCounts(map);
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadData();
    const unsub = subscribeMasterData(() => {
      void loadData();
    });
    return unsub;
  }, [loadData]);

  const kpis = useMemo(() => {
    const nonDeleted = branches.filter((b) => !b.isDeleted);
    const active = nonDeleted.filter((b) => b.status === 'Active').length;
    const inactive = nonDeleted.filter((b) => b.status === 'Inactive').length;
    const archived = branches.filter((b) => b.isDeleted).length;
    return {
      total: nonDeleted.length,
      active,
      inactive,
      archived,
    };
  }, [branches]);

  const availableStates = useMemo(() => {
    const s = new Set(branches.map((b) => b.state).filter(Boolean));
    return Array.from(s).sort();
  }, [branches]);

  const filteredBranches = useMemo(() => {
    return branches.filter((b) => {
      if (statusFilter === 'ARCHIVED') {
        if (!b.isDeleted) return false;
      } else {
        if (b.isDeleted) return false;
        if (statusFilter !== 'ALL_ACTIVE_INACTIVE' && b.status !== statusFilter) {
          return false;
        }
      }

      if (stateFilter !== 'ALL' && b.state !== stateFilter) {
        return false;
      }

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        b.branchId.toLowerCase().includes(q) ||
        b.branchName.toLowerCase().includes(q) ||
        b.branchCode.toLowerCase().includes(q) ||
        b.managerName.toLowerCase().includes(q) ||
        b.city.toLowerCase().includes(q) ||
        b.state.toLowerCase().includes(q) ||
        b.pinCode.includes(q) ||
        b.mobile.includes(q) ||
        b.email.toLowerCase().includes(q)
      );
    });
  }, [branches, statusFilter, stateFilter, searchQuery]);

  const paginatedBranches = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredBranches.slice(start, start + pageSize);
  }, [filteredBranches, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, stateFilter]);

  const openCreateModal = () => {
    setEditingBranch(null);
    setFormData(EMPTY_BRANCH_FORM);
    setFormError(null);
    setFormModalOpen(true);
  };

  const openEditModal = (branch: BranchRecord) => {
    setEditingBranch(branch);
    setFormData({
      branchName: branch.branchName,
      branchCode: branch.branchCode,
      managerName: branch.managerName,
      mobile: branch.mobile,
      email: branch.email,
      address: branch.address,
      city: branch.city,
      state: branch.state,
      pinCode: branch.pinCode,
      status: branch.status,
    });
    setFormError(null);
    setFormModalOpen(true);
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);

    const validation = validateBranchForm(formData, branches, editingBranch?.branchId);
    if (!validation.valid) {
      setFormError(validation.error ?? 'Check branch form fields.');
      return;
    }

    setSaving(true);
    try {
      if (editingBranch) {
        await updateBranchRecord(user, isPreviewSession, editingBranch.branchId, formData);
        setFeedback({
          type: 'success',
          text: `Branch "${formData.branchName}" (${normalizeCode(formData.branchCode)}) updated.`,
        });
      } else {
        const created = await createBranchRecord(user, isPreviewSession, formData);
        setFeedback({
          type: 'success',
          text: `Branch "${created.branchName}" created with automatic ID ${created.branchId}.`,
        });
      }
      setFormModalOpen(false);
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmToggleStatus = async () => {
    if (!user || !statusToggleTarget) return;
    setActionBusy(true);
    try {
      await toggleBranchStatus(
        user,
        isPreviewSession,
        statusToggleTarget.branch.branchId,
        statusToggleTarget.nextStatus
      );
      setFeedback({
        type: 'success',
        text: `Branch ${statusToggleTarget.branch.branchCode} marked ${statusToggleTarget.nextStatus}.`,
      });
      setStatusToggleTarget(null);
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmSoftDelete = async () => {
    if (!user || !softDeleteTarget) return;
    setActionBusy(true);
    try {
      await softDeleteBranchRecord(user, isPreviewSession, softDeleteTarget.branchId);
      setFeedback({
        type: 'success',
        text: `Branch ${softDeleteTarget.branchCode} (${softDeleteTarget.branchId}) archived via soft delete. Historical data preserved.`,
      });
      setSoftDeleteTarget(null);
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Branch Management
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Admin-only regional branch registry with unique branch codes, manager assignment, and
            non-destructive soft delete
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors self-start sm:self-auto whitespace-nowrap"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>Create Branch</span>
        </button>
      </div>

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
            className="font-semibold shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Summary Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Total Operational Branches"
          value={kpis.total}
          subtext="Active & inactive non-archived branches"
          icon={Building2}
        />
        <StatMetricCard
          label="Active Branches"
          value={kpis.active}
          subtext="Currently operational offices"
          icon={CheckCircle2}
        />
        <StatMetricCard
          label="Inactive Branches"
          value={kpis.inactive}
          subtext="Temporarily paused branches"
          icon={Power}
          tone={kpis.inactive > 0 ? 'attention' : 'default'}
        />
        <StatMetricCard
          label="Soft-Deleted (Historical)"
          value={kpis.archived}
          subtext="Archived with historical data intact"
          icon={Archive}
        />
      </section>

      {/* Branch Registry Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Branch Master Directory
            </h2>
            <p className="text-xs text-[#574B43]">
              Search by Branch ID, unique Branch Code, Manager, City, State, or PIN Code
            </p>
          </div>

          {availableStates.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="branch-state-filter" className="text-xs font-medium text-[#574B43]">
                State:
              </label>
              <select
                id="branch-state-filter"
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="min-h-[36px] rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] px-3 text-xs font-medium text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
              >
                <option value="ALL">All States</option>
                {availableStates.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search ID, code, name, manager, city, PIN..."
          filterOptions={[
            { value: 'ALL_ACTIVE_INACTIVE', label: 'All Branches' },
            { value: 'Active', label: 'Active' },
            { value: 'Inactive', label: 'Inactive' },
            { value: 'ARCHIVED', label: 'Soft-Deleted' },
          ]}
          activeFilter={statusFilter}
          onFilterChange={(v) => setStatusFilter(v as typeof statusFilter)}
        />

        {loading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 bg-[#FAF8F5] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredBranches.length === 0 ? (
          <EmptyStatePanel
            icon={Building2}
            title="No Branches Match Your Criteria"
            description={
              statusFilter === 'ARCHIVED'
                ? 'No branches have been soft-deleted.'
                : 'Create a new regional branch or clear your current search and filter criteria.'
            }
            actionLabel={statusFilter !== 'ARCHIVED' ? 'Create Branch' : undefined}
            onAction={statusFilter !== 'ARCHIVED' ? openCreateModal : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Branch ID / Code</th>
                    <th className="py-3 px-3">Branch Name &amp; Location</th>
                    <th className="py-3 px-3">Manager &amp; Contact</th>
                    <th className="py-3 px-3 text-right">Linked Scope</th>
                    <th className="py-3 px-3">Created Date</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedBranches.map((branch) => {
                    const scope = branchCounts[branch.branchId] ?? { hr: 0, clients: 0, sites: 0 };
                    return (
                      <tr key={branch.branchId} className="hover:bg-[#FAF8F5] transition-colors">
                        <td className="py-3.5 px-3 whitespace-nowrap align-top">
                          <div className="font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                            {branch.branchCode}
                          </div>
                          <div className="font-mono-tabular text-[11px] text-[#7D6F65]">
                            {branch.branchId}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 align-top">
                          <div className="font-medium text-[#1F1916]">{branch.branchName}</div>
                          <div className="text-xs text-[#574B43] mt-0.5">
                            {branch.city}, {branch.state} ·{' '}
                            <span className="font-mono-tabular">{branch.pinCode}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 align-top">
                          <div className="text-xs font-medium text-[#1F1916]">
                            {branch.managerName}
                          </div>
                          <div className="font-mono-tabular text-xs text-[#574B43]">
                            {branch.mobile}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono-tabular text-xs text-[#574B43] whitespace-nowrap align-top">
                          {scope.hr} HR · {scope.clients} Clients · {scope.sites} Sites
                        </td>
                        <td className="py-3.5 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap align-top">
                          {new Date(branch.createdDate).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="py-3.5 px-3 text-xs font-semibold whitespace-nowrap align-top">
                          {branch.isDeleted ? (
                            <span className="text-[#B91C1C]">Soft-Deleted</span>
                          ) : branch.status === 'Active' ? (
                            <span className="text-[#166534]">Active</span>
                          ) : (
                            <span className="text-[#B45309]">Inactive</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-right whitespace-nowrap align-top">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingBranch(branch)}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-md bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors"
                              title="View complete branch details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {!branch.isDeleted && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(branch)}
                                  className="min-h-[36px] px-2.5 py-1.5 rounded-md bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#5C3D2E] hover:bg-[#F3EDE4] transition-colors"
                                  title="Edit branch"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setStatusToggleTarget({
                                      branch,
                                      nextStatus: branch.status === 'Active' ? 'Inactive' : 'Active',
                                    })
                                  }
                                  className="min-h-[36px] px-2.5 py-1.5 rounded-md bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#4A3023] hover:bg-[#F3EDE4] transition-colors"
                                  title={
                                    branch.status === 'Active'
                                      ? 'Deactivate branch'
                                      : 'Activate branch'
                                  }
                                >
                                  {branch.status === 'Active' ? 'Deactivate' : 'Activate'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSoftDeleteTarget(branch)}
                                  className="min-h-[36px] px-2.5 py-1.5 rounded-md bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors"
                                  title="Soft Delete branch"
                                >
                                  Soft Delete
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
              totalItems={filteredBranches.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Create / Edit Branch Modal */}
      {formModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E5DDD2]">
              <div>
                <h2 className="font-display text-lg font-bold text-[#1F1916]">
                  {editingBranch ? `Edit Branch — ${editingBranch.branchId}` : 'Create New Branch'}
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  {editingBranch
                    ? `Created on ${new Date(editingBranch.createdDate).toLocaleString('en-IN')}`
                    : 'Branch ID and Created Date are generated automatically on save.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormModalOpen(false)}
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

            <form onSubmit={handleSaveBranch} className="mt-5 space-y-4" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#574B43] mb-1">
                    Branch ID (Automatic)
                  </label>
                  <input
                    type="text"
                    disabled
                    value={editingBranch ? editingBranch.branchId : 'Auto-Generated (BRN-YYYY-XXXX)'}
                    className="w-full min-h-[42px] px-3 py-2 text-xs font-mono-tabular bg-[#F3EDE4] border border-[#E5DDD2] rounded-lg text-[#574B43]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Branch Code (Unique) *
                  </label>
                  <input
                    type="text"
                    value={formData.branchCode}
                    onChange={(e) =>
                      setFormData({ ...formData, branchCode: e.target.value.toUpperCase() })
                    }
                    placeholder="e.g. MUM-HQ"
                    maxLength={20}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Status *
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({ ...formData, status: e.target.value as BranchStatus })
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Branch Name *
                  </label>
                  <input
                    type="text"
                    value={formData.branchName}
                    onChange={(e) => setFormData({ ...formData, branchName: e.target.value })}
                    placeholder="e.g. Nagpur Vidarbha Regional Office"
                    maxLength={120}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Manager Name *
                  </label>
                  <input
                    type="text"
                    value={formData.managerName}
                    onChange={(e) => setFormData({ ...formData, managerName: e.target.value })}
                    placeholder="Branch Manager Full Name"
                    maxLength={100}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    Branch Email *
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="branch@rexonsecurity.com"
                    maxLength={160}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Full Street Address *
                </label>
                <textarea
                  rows={2}
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Office / Building, Landmark, Industrial Area..."
                  maxLength={250}
                  className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    City *
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    placeholder="e.g. Nagpur"
                    maxLength={80}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    State *
                  </label>
                  <select
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {INDIAN_STATES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    PIN Code *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formData.pinCode}
                    onChange={(e) => setFormData({ ...formData, pinCode: e.target.value })}
                    placeholder="440001"
                    maxLength={6}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    required
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-[#E5DDD2] flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
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
                    ? 'Saving Branch...'
                    : editingBranch
                      ? 'Save Branch Updates'
                      : 'Create Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Complete Branch Details Modal */}
      {viewingBranch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E5DDD2]">
              <div>
                <div className="font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                  {viewingBranch.branchId} · {viewingBranch.branchCode}
                </div>
                <h2 className="mt-0.5 font-display text-xl font-bold text-[#1F1916]">
                  {viewingBranch.branchName}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setViewingBranch(null)}
                className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <dt className="text-xs text-[#7D6F65]">Branch Manager</dt>
                <dd className="mt-0.5 font-semibold text-[#1F1916]">{viewingBranch.managerName}</dd>
                <dd className="font-mono-tabular text-xs text-[#574B43] mt-0.5">
                  {viewingBranch.mobile} · {viewingBranch.email}
                </dd>
              </div>
              <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <dt className="text-xs text-[#7D6F65]">Status &amp; Created Date</dt>
                <dd className="mt-0.5 font-semibold text-[#1F1916]">
                  {viewingBranch.isDeleted
                    ? 'Soft-Deleted (Archived)'
                    : viewingBranch.status}
                </dd>
                <dd className="font-mono-tabular text-xs text-[#574B43] mt-0.5">
                  Created: {new Date(viewingBranch.createdDate).toLocaleString('en-IN')}
                </dd>
              </div>
              <div className="sm:col-span-2 p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <dt className="text-xs text-[#7D6F65] flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-[#5C3D2E]" />
                  <span>Registered Office Address</span>
                </dt>
                <dd className="mt-1 text-sm text-[#1F1916]">{viewingBranch.address}</dd>
                <dd className="text-xs text-[#574B43] mt-0.5">
                  {viewingBranch.city}, {viewingBranch.state} —{' '}
                  <span className="font-mono-tabular font-semibold">{viewingBranch.pinCode}</span>
                </dd>
              </div>
            </dl>

            {/* Historical Audit Log */}
            {viewingBranch.history && viewingBranch.history.length > 0 && (
              <div className="mt-5 pt-4 border-t border-[#E5DDD2]">
                <h3 className="font-display text-sm font-semibold text-[#1F1916] mb-2.5">
                  Branch Historical Audit Trail
                </h3>
                <ul className="space-y-2 text-xs">
                  {viewingBranch.history.map((h) => (
                    <li
                      key={h.id}
                      className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
                    >
                      <div>
                        <span className="font-semibold text-[#5C3D2E]">{h.action}</span> ·{' '}
                        <span className="text-[#1F1916]">{h.details}</span>
                      </div>
                      <span className="font-mono-tabular text-[#7D6F65] shrink-0">
                        {new Date(h.timestamp).toLocaleString('en-IN')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              {!viewingBranch.isDeleted && (
                <button
                  type="button"
                  onClick={() => {
                    const target = viewingBranch;
                    setViewingBranch(null);
                    openEditModal(target);
                  }}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E]"
                >
                  Edit Branch
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewingBranch(null)}
                className="min-h-[42px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activate / Deactivate Confirmation */}
      <ConfirmDialog
        open={Boolean(statusToggleTarget)}
        title={`${statusToggleTarget?.nextStatus === 'Active' ? 'Activate' : 'Deactivate'} Branch`}
        description={`Change status of "${statusToggleTarget?.branch.branchName ?? ''}" (${statusToggleTarget?.branch.branchCode ?? ''}) to ${statusToggleTarget?.nextStatus ?? ''}?`}
        confirmLabel={
          statusToggleTarget?.nextStatus === 'Active' ? 'Activate Branch' : 'Deactivate Branch'
        }
        loading={actionBusy}
        onConfirm={handleConfirmToggleStatus}
        onCancel={() => setStatusToggleTarget(null)}
      />

      {/* Soft Delete Confirmation */}
      <ConfirmDialog
        open={Boolean(softDeleteTarget)}
        title="Soft Delete Branch"
        description={`Archive "${softDeleteTarget?.branchName ?? ''}" (${softDeleteTarget?.branchId ?? ''})? The branch will be marked Inactive and moved to Soft-Deleted archives while keeping all historical Clients, Sites, and HR references intact.`}
        confirmLabel="Confirm Soft Delete"
        variant="danger"
        loading={actionBusy}
        onConfirm={handleConfirmSoftDelete}
        onCancel={() => setSoftDeleteTarget(null)}
      />
    </div>
  );
};
