import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Archive,
  Briefcase,
  Building2,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  FileCheck2,
  MapPin,
  Plus,
  Send,
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
  archiveClientRecord,
  createClientRecord,
  listBranches,
  listClients,
  listSites,
  submitApprovalRequest,
  subscribeMasterData,
  updateClientRecord,
} from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  CLIENT_STATUSES,
  CLIENT_TYPES,
  ClientFormInput,
  ClientRecord,
  INDIAN_STATES,
  PAYMENT_TERMS_OPTIONS,
  SiteRecord,
} from '../../types';
import {
  normalizeCode,
  validateApprovalSubmission,
  validateClientForm,
} from '../../utils/masterValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';

function formatIsoDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatIsoDateTime(iso: string): string {
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

export const ClientManagementPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  const canCreateClient = hasUserPermission(user, 'client.create');
  const canEditClient = hasUserPermission(user, 'client.edit');
  const canDeleteClient = hasUserPermission(user, 'client.delete');
  const portalBasePath = isAdmin ? '/admin' : '/hr';

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 6;

  // Create / Edit Modal
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRecord | null>(null);
  const [sameAsRegistered, setSameAsRegistered] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Detail, Archive & Approval Modals
  const [viewingClient, setViewingClient] = useState<ClientRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ClientRecord | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleteApprovalClient, setDeleteApprovalClient] = useState<ClientRecord | null>(null);
  const [deleteApprovalReason, setDeleteApprovalReason] = useState('');
  const [deleteApprovalErr, setDeleteApprovalErr] = useState<string | null>(null);
  const [submittingApproval, setSubmittingApproval] = useState(false);

  const authorizedBranches = useMemo(() => {
    const activeBranches = branches.filter((b) => !b.isDeleted);
    if (isAdmin) return activeBranches;
    const allowedIds = getAuthorizedBranchIds(user);
    return activeBranches.filter((b) => allowedIds.includes(b.branchId));
  }, [branches, isAdmin, user]);

  const buildEmptyClientForm = useCallback((): ClientFormInput => {
    const today = new Date().toISOString().slice(0, 10);
    const nextYearDate = new Date();
    nextYearDate.setFullYear(nextYearDate.getFullYear() + 1);
    const nextYear = nextYearDate.toISOString().slice(0, 10);

    const defaultBranch =
      authorizedBranches[0]?.branchId || getAuthorizedBranchIds(user)[0] || '';

    return {
      companyName: '',
      displayName: '',
      companyType: 'Corporate Office',
      gstNumber: '',
      panNumber: '',
      registeredAddress: '',
      state: 'Maharashtra',
      city: '',
      pinCode: '',
      contactPerson: '',
      contactDesignation: '',
      mobile: '',
      alternateMobile: '',
      email: '',
      billingAddress: '',
      billingContact: '',
      contractStartDate: today,
      contractEndDate: nextYear,
      paymentTerms: 'Net 30 Days',
      assignedBranch: defaultBranch,
      clientStatus: 'Active',
      notes: '',
    };
  }, [authorizedBranches, user]);

  const [formData, setFormData] = useState<ClientFormInput>(() => ({
    companyName: '',
    displayName: '',
    companyType: 'Corporate Office',
    gstNumber: '',
    panNumber: '',
    registeredAddress: '',
    state: 'Maharashtra',
    city: '',
    pinCode: '',
    contactPerson: '',
    contactDesignation: '',
    mobile: '',
    alternateMobile: '',
    email: '',
    billingAddress: '',
    billingContact: '',
    contractStartDate: new Date().toISOString().slice(0, 10),
    contractEndDate: '',
    paymentTerms: 'Net 30 Days',
    assignedBranch: '',
    clientStatus: 'Active',
    notes: '',
  }));

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [clientList, branchList, siteList] = await Promise.all([
        listClients(user, isPreviewSession),
        listBranches(user, isPreviewSession),
        listSites(user, isPreviewSession),
      ]);
      setClients(clientList);
      setBranches(branchList);
      setSites(siteList);
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

  // KeepviewingClient synced when clients reload
  useEffect(() => {
    if (!viewingClient) return;
    const updated = clients.find((c) => c.clientId === viewingClient.clientId);
    if (updated) {
      setViewingClient(updated);
    }
  }, [clients, viewingClient]);

  const branchMap = useMemo(() => {
    const map: Record<string, BranchRecord> = {};
    for (const b of branches) {
      map[b.branchId] = b;
    }
    return map;
  }, [branches]);

  const sitesByClient = useMemo(() => {
    const map: Record<string, SiteRecord[]> = {};
    for (const s of sites) {
      if (s.isArchived) continue;
      if (!map[s.clientId]) {
        map[s.clientId] = [];
      }
      map[s.clientId].push(s);
    }
    return map;
  }, [sites]);

  const kpis = useMemo(() => {
    const nonArchived = clients.filter((c) => !c.isArchived);
    const active = nonArchived.filter((c) => c.clientStatus === 'Active').length;
    const multiSiteClients = nonArchived.filter(
      (c) => (sitesByClient[c.clientId]?.length ?? 0) > 1
    ).length;
    const totalLinkedSites = nonArchived.reduce(
      (acc, c) => acc + (sitesByClient[c.clientId]?.length ?? 0),
      0
    );
    return {
      total: nonArchived.length,
      active,
      multiSiteClients,
      totalLinkedSites,
    };
  }, [clients, sitesByClient]);

  const filteredClients = useMemo(() => {
    return clients
      .filter((c) => !c.isArchived)
      .filter((c) => {
        if (statusFilter !== 'ALL' && c.clientStatus !== statusFilter) return false;
        if (typeFilter !== 'ALL' && c.companyType !== typeFilter) return false;
        if (branchFilter !== 'ALL' && c.assignedBranch !== branchFilter) return false;

        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return (
          c.clientId.toLowerCase().includes(q) ||
          c.companyName.toLowerCase().includes(q) ||
          c.displayName.toLowerCase().includes(q) ||
          c.gstNumber.toLowerCase().includes(q) ||
          c.panNumber.toLowerCase().includes(q) ||
          c.city.toLowerCase().includes(q) ||
          c.contactPerson.toLowerCase().includes(q) ||
          c.mobile.toLowerCase().includes(q)
        );
      });
  }, [clients, statusFilter, typeFilter, branchFilter, searchQuery]);

  const paginatedClients = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredClients.slice(start, start + pageSize);
  }, [filteredClients, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, typeFilter, branchFilter]);

  const openCreateModal = () => {
    setEditingClient(null);
    setSameAsRegistered(false);
    setFormData(buildEmptyClientForm());
    setFormError(null);
    setFormModalOpen(true);
  };

  const openEditModal = (client: ClientRecord) => {
    setEditingClient(client);
    setSameAsRegistered(false);
    setFormData({
      companyName: client.companyName,
      displayName: client.displayName,
      companyType: client.companyType,
      gstNumber: client.gstNumber === 'UNREGISTERED' ? '' : client.gstNumber,
      panNumber: client.panNumber,
      registeredAddress: client.registeredAddress,
      state: client.state,
      city: client.city,
      pinCode: client.pinCode,
      contactPerson: client.contactPerson,
      contactDesignation: client.contactDesignation,
      mobile: client.mobile,
      alternateMobile: client.alternateMobile,
      email: client.email,
      billingAddress: client.billingAddress,
      billingContact: client.billingContact,
      contractStartDate: client.contractStartDate,
      contractEndDate: client.contractEndDate,
      paymentTerms: client.paymentTerms,
      assignedBranch: client.assignedBranch,
      clientStatus: client.clientStatus,
      notes: client.notes,
    });
    setFormError(null);
    setFormModalOpen(true);
  };

  const handleCopyRegisteredAddress = (checked: boolean) => {
    setSameAsRegistered(checked);
    if (checked) {
      const composed = [
        formData.registeredAddress.trim(),
        formData.city.trim(),
        formData.state.trim(),
        formData.pinCode.trim(),
      ]
        .filter(Boolean)
        .join(', ');
      setFormData((prev) => ({
        ...prev,
        billingAddress: composed || prev.registeredAddress,
        billingContact: prev.billingContact || prev.contactPerson,
      }));
    }
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);

    const validation = validateClientForm(formData, clients, editingClient?.clientId);
    if (!validation.valid) {
      setFormError(validation.error ?? 'Please review the client form fields.');
      return;
    }

    setSaving(true);
    try {
      if (editingClient) {
        await updateClientRecord(user, isPreviewSession, editingClient.clientId, formData);
        setFeedback({
          type: 'success',
          text: `Client ${editingClient.clientId} (${formData.displayName}) updated.`,
        });
      } else {
        const created = await createClientRecord(user, isPreviewSession, formData);
        setFeedback({
          type: 'success',
          text: `Client ${created.clientId} (${created.companyName}) onboarded successfully.`,
        });
      }
      setFormModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmArchiveClient = async () => {
    if (!user || !archiveTarget) return;
    setArchiving(true);
    try {
      await archiveClientRecord(user, isPreviewSession, archiveTarget.clientId);
      setFeedback({
        type: 'success',
        text: `Client ${archiveTarget.clientId} (${archiveTarget.companyName}) archived; historical records preserved.`,
      });
      if (viewingClient?.clientId === archiveTarget.clientId) {
        setViewingClient(null);
      }
      setArchiveTarget(null);
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
      setArchiveTarget(null);
    } finally {
      setArchiving(false);
    }
  };

  const handleSubmitClientDeleteApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !deleteApprovalClient) return;
    setDeleteApprovalErr(null);

    const payload = {
      requestType: 'Client Deletion' as const,
      module: 'Client' as const,
      targetRecordId: deleteApprovalClient.clientId,
      targetRecordName: deleteApprovalClient.companyName,
      branchId: deleteApprovalClient.assignedBranch,
      summary: `Request archival of Client ${deleteApprovalClient.clientId} (${deleteApprovalClient.displayName})`,
      reason: deleteApprovalReason,
    };

    const check = validateApprovalSubmission(payload);
    if (!check.valid) {
      setDeleteApprovalErr(check.error ?? 'Provide a valid justification (min 8 chars).');
      return;
    }

    setSubmittingApproval(true);
    try {
      const apr = await submitApprovalRequest(user, isPreviewSession, payload);
      setFeedback({
        type: 'success',
        text: `Client archival request ${apr.approvalId} submitted for Administrator sign-off.`,
      });
      setDeleteApprovalClient(null);
      setDeleteApprovalReason('');
      await loadData();
    } catch (err) {
      setDeleteApprovalErr(formatServiceErrorMessage(err));
    } finally {
      setSubmittingApproval(false);
    }
  };

  const statusTextClass = (status: ClientRecord['clientStatus']) => {
    switch (status) {
      case 'Active':
        return 'text-[#166534] font-semibold';
      case 'On Hold':
        return 'text-[#B45309] font-semibold';
      case 'Expired':
        return 'text-[#B91C1C] font-semibold';
      case 'Inactive':
      default:
        return 'text-[#7D6F65] font-medium';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Client Master Management
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            {isAdmin
              ? 'Full multi-branch visibility and governance across all contracted Client organizations and their linked Sites.'
              : `Authorized HR Client registry scoped to assigned branch(es): ${getAuthorizedBranchIds(user).join(', ') || '—'}`}
          </p>
        </div>

        {canCreateClient && (
          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3023] transition-colors self-start sm:self-auto whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Register New Client</span>
          </button>
        )}
      </div>

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

      {/* KPI Summary Cards */}
      <section aria-label="Client master metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMetricCard
            label="Total Clients"
            value={kpis.total}
            subtext={isAdmin ? 'Across all REXON branches' : 'Within your authorized branches'}
            icon={Briefcase}
          />
          <StatMetricCard
            label="Active Contracts"
            value={kpis.active}
            subtext="Active billing & deployment agreements"
            icon={FileCheck2}
          />
          <StatMetricCard
            label="Multi-Site Clients"
            value={kpis.multiSiteClients}
            subtext="Clients operating 2+ deployment sites"
            icon={Building2}
          />
          <StatMetricCard
            label="Total Linked Sites"
            value={kpis.totalLinkedSites}
            subtext="Active sites mapped to these clients"
            icon={MapPin}
          />
        </div>
      </section>

      {/* Main Client Table Card */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Contracted Client Directory
            </h2>
            <p className="text-xs text-[#574B43]">
              One Client can have multiple Sites. Select any Client to view full GST/PAN, billing
              terms, and linked deployment Sites.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by Company Type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
            >
              <option value="ALL">All Company Types</option>
              {CLIENT_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
            </select>

            {authorizedBranches.length > 1 && (
              <select
                aria-label="Filter by Branch"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
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
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search Client ID, company, GST/PAN, contact, or city..."
          filterOptions={[
            { value: 'ALL', label: 'All Statuses' },
            ...CLIENT_STATUSES.map((st) => ({ value: st, label: st })),
          ]}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
        />

        {loading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] animate-pulse"
              />
            ))}
          </div>
        ) : filteredClients.length === 0 ? (
          <EmptyStatePanel
            icon={Briefcase}
            title="No Client Records Match Your Filter"
            description="Adjust your search query or register a new contracted Client under an authorized branch."
            actionLabel={canCreateClient ? 'Register New Client' : undefined}
            onAction={canCreateClient ? openCreateModal : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Client ID</th>
                    <th className="py-3 px-3">Organization &amp; Type</th>
                    <th className="py-3 px-3">Primary Contact</th>
                    <th className="py-3 px-3">City &amp; Branch</th>
                    <th className="py-3 px-3">Contract Window</th>
                    <th className="py-3 px-3 text-right">Sites</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedClients.map((client) => {
                    const linkedSitesCount = sitesByClient[client.clientId]?.length ?? 0;
                    const branchObj = branchMap[client.assignedBranch];

                    return (
                      <tr
                        key={client.clientId}
                        className="hover:bg-[#FAF8F5] transition-colors align-top"
                      >
                        <td className="py-3.5 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                          <div>{client.clientId}</div>
                          <div className="text-[11px] font-normal text-[#7D6F65] mt-0.5">
                            PAN: {client.panNumber}
                          </div>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="font-semibold text-[#1F1916]">{client.companyName}</div>
                          <div className="text-xs text-[#574B43] mt-0.5">
                            {client.displayName} · {client.companyType}
                          </div>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="text-[#1F1916] font-medium">{client.contactPerson}</div>
                          <div className="font-mono-tabular text-xs text-[#574B43] mt-0.5">
                            {client.mobile}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <div className="text-[#1F1916]">
                            {client.city}, {client.state}
                          </div>
                          <div className="font-mono-tabular text-xs text-[#7D6F65] mt-0.5">
                            {branchObj ? `${branchObj.branchCode}` : client.assignedBranch}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                          <div>{client.contractStartDate}</div>
                          <div className="text-[#7D6F65]">to {client.contractEndDate}</div>
                        </td>

                        <td className="py-3.5 px-3 text-right font-mono-tabular font-semibold text-[#1F1916] whitespace-nowrap">
                          {linkedSitesCount}
                        </td>

                        <td className="py-3.5 px-3 text-xs whitespace-nowrap">
                          <span className={statusTextClass(client.clientStatus)}>
                            {client.clientStatus}
                          </span>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingClient(client)}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors inline-flex items-center gap-1"
                              title="View full client details & sites"
                            >
                              <Eye className="w-3.5 h-3.5 text-[#5C3D2E]" />
                              <span>View</span>
                            </button>

                            {canEditClient && (
                              <button
                                type="button"
                                onClick={() => openEditModal(client)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors inline-flex items-center gap-1"
                                title="Edit client"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-[#5C3D2E]" />
                                <span>Edit</span>
                              </button>
                            )}

                            {hasUserPermission(user, 'site.create') && (
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(
                                    `${portalBasePath}/sites?clientId=${encodeURIComponent(
                                      client.clientId
                                    )}&create=1`
                                  )
                                }
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#E7DDD0] transition-colors inline-flex items-center gap-1 whitespace-nowrap"
                                title="Add a Site under this Client"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Site</span>
                              </button>
                            )}

                            {canDeleteClient ? (
                              <button
                                type="button"
                                onClick={() => setArchiveTarget(client)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#B91C1C] hover:bg-[#FEE2E2] transition-colors inline-flex items-center gap-1"
                                title="Archive Client"
                              >
                                <Archive className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            ) : (
                              !isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteApprovalClient(client);
                                    setDeleteApprovalReason('');
                                    setDeleteApprovalErr(null);
                                  }}
                                  className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-medium text-[#5C3D2E] hover:bg-[#F3EDE4] transition-colors inline-flex items-center gap-1 whitespace-nowrap"
                                  title="Request Admin Approval for Client Archival"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  <span>Req Delete</span>
                                </button>
                              )
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
              totalItems={filteredClients.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* ===================================================================== */}
      {/* CREATE / EDIT CLIENT MODAL (ALL 26 SPECIFIED FIELDS)                  */}
      {/* ===================================================================== */}
      {formModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-3 sm:p-5 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="client-form-modal-title"
        >
          <div className="w-full max-w-4xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2] shrink-0">
              <div>
                <h2
                  id="client-form-modal-title"
                  className="font-display text-lg sm:text-xl font-bold text-[#1F1916]"
                >
                  {editingClient
                    ? `Edit Client — ${editingClient.clientId}`
                    : 'Register New Client Organization'}
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  Client ID is generated automatically. Duplicate GST numbers and duplicate
                  Company + City records are blocked.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormModalOpen(false)}
                disabled={saving}
                className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form
              onSubmit={(e) => void handleSaveClient(e)}
              className="p-5 sm:p-6 overflow-y-auto space-y-6"
              noValidate
            >
              {formError && (
                <div className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Section 1: Organization & Statutory Tax Identity */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#5C3D2E] border-b border-[#E5DDD2] pb-1.5">
                  1. Organization &amp; Statutory Identity
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Client ID (Automatic)
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={editingClient ? editingClient.clientId : 'Auto-assigned on save (CLT-YYYY-XXXX)'}
                      className="w-full min-h-[42px] px-3.5 py-2 text-xs font-mono-tabular bg-[#F3EDE4] border border-[#E5DDD2] rounded-lg text-[#574B43] cursor-not-allowed"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Company Name <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.companyName}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, companyName: e.target.value }))
                      }
                      placeholder="e.g. Apex Precision Manufacturing Pvt Ltd"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Display Name <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.displayName}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, displayName: e.target.value }))
                      }
                      placeholder="e.g. Apex Precision"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Company Type <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={formData.companyType}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          companyType: e.target.value as ClientFormInput['companyType'],
                        }))
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      {CLIENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Client Status <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={formData.clientStatus}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          clientStatus: e.target.value as ClientFormInput['clientStatus'],
                        }))
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      {CLIENT_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      GST Number (15-char or blank)
                    </label>
                    <input
                      type="text"
                      maxLength={15}
                      value={formData.gstNumber}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          gstNumber: normalizeCode(e.target.value),
                        }))
                      }
                      placeholder="e.g. 27AABCU9603R1ZM"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular uppercase bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      PAN Number <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      maxLength={10}
                      value={formData.panNumber}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          panNumber: normalizeCode(e.target.value),
                        }))
                      }
                      placeholder="e.g. AABCU9603R"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular uppercase bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Assigned Branch <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={formData.assignedBranch}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, assignedBranch: e.target.value }))
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      <option value="">Select Branch...</option>
                      {authorizedBranches.map((b) => (
                        <option key={b.branchId} value={b.branchId}>
                          {b.branchCode} — {b.branchName} ({b.city})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 2: Registered Address */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#5C3D2E] border-b border-[#E5DDD2] pb-1.5">
                  2. Registered Office Location
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Registered Address <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.registeredAddress}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, registeredAddress: e.target.value }))
                      }
                      placeholder="Plot / Building / Street / Industrial Area"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      State <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={formData.state}
                      onChange={(e) => setFormData((p) => ({ ...p, state: e.target.value }))}
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
                      City <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => setFormData((p) => ({ ...p, city: e.target.value }))}
                      placeholder="e.g. Pune"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      PIN Code <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={formData.pinCode}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          pinCode: e.target.value.replace(/\D/g, '').slice(0, 6),
                        }))
                      }
                      placeholder="e.g. 410501"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Primary Contact & Billing Details */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5DDD2] pb-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#5C3D2E]">
                    3. Primary Contact &amp; Billing Details
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleCopyRegisteredAddress(!sameAsRegistered)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5C3D2E] hover:underline"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Registered Address to Billing</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Contact Person <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.contactPerson}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, contactPerson: e.target.value }))
                      }
                      placeholder="Full Name"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Contact Designation <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.contactDesignation}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, contactDesignation: e.target.value }))
                      }
                      placeholder="e.g. VP — Administration"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Email <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                      placeholder="client.admin@company.com"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Mobile <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="tel"
                      value={formData.mobile}
                      onChange={(e) => setFormData((p) => ({ ...p, mobile: e.target.value }))}
                      placeholder="+91 98200 00000"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Alternate Mobile
                    </label>
                    <input
                      type="tel"
                      value={formData.alternateMobile}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, alternateMobile: e.target.value }))
                      }
                      placeholder="Optional secondary phone"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Billing Contact <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.billingContact}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, billingContact: e.target.value }))
                      }
                      placeholder="Accounts / Finance SPOC"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Billing Address <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.billingAddress}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, billingAddress: e.target.value }))
                      }
                      placeholder="Full invoice dispatch & GST billing address"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Contract Schedule, Payment Terms & Notes */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#5C3D2E] border-b border-[#E5DDD2] pb-1.5">
                  4. Contract Schedule &amp; Commercial Terms
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Contract Start Date <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="date"
                      value={formData.contractStartDate}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, contractStartDate: e.target.value }))
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Contract End Date <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="date"
                      value={formData.contractEndDate}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, contractEndDate: e.target.value }))
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Payment Terms <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={formData.paymentTerms}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, paymentTerms: e.target.value }))
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      {PAYMENT_TERMS_OPTIONS.map((term) => (
                        <option key={term} value={term}>
                          {term}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Operational Notes
                    </label>
                    <textarea
                      rows={2}
                      value={formData.notes}
                      onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Special SLA clauses, guard uniform directives, or billing instructions..."
                      className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="pt-3 border-t border-[#E5DDD2] flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
                  disabled={saving}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#1F1916] bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg hover:bg-[#F3EDE4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] px-5 py-2 text-sm font-semibold text-white bg-[#5C3D2E] rounded-lg hover:bg-[#4A3023] disabled:opacity-60"
                >
                  {saving
                    ? 'Saving Client...'
                    : editingClient
                      ? 'Save Client Changes'
                      : 'Create Client Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW FULL CLIENT DETAILS & MULTI-SITE DIRECTORY MODAL                 */}
      {/* ===================================================================== */}
      {viewingClient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-3 sm:p-5 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="client-detail-title"
        >
          <div className="w-full max-w-4xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto max-h-[92vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2] shrink-0">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#7D6F65]">
                  <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                    {viewingClient.clientId}
                  </span>
                  <span>·</span>
                  <span>{viewingClient.companyType}</span>
                  <span>·</span>
                  <span className={statusTextClass(viewingClient.clientStatus)}>
                    {viewingClient.clientStatus}
                  </span>
                </div>
                <h2
                  id="client-detail-title"
                  className="mt-1 font-display text-lg sm:text-xl font-bold text-[#1F1916]"
                >
                  {viewingClient.companyName} ({viewingClient.displayName})
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setViewingClient(null)}
                className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
                aria-label="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-6 text-sm">
              {/* Complete 26-Field Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#FAF8F5] border border-[#E5DDD2] rounded-xl p-4">
                <div>
                  <span className="text-xs text-[#7D6F65] block">GST Number</span>
                  <span className="font-mono-tabular font-semibold text-[#1F1916]">
                    {viewingClient.gstNumber}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">PAN Number</span>
                  <span className="font-mono-tabular font-semibold text-[#1F1916]">
                    {viewingClient.panNumber}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Assigned Branch</span>
                  <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                    {branchMap[viewingClient.assignedBranch]
                      ? `${branchMap[viewingClient.assignedBranch].branchCode} — ${branchMap[viewingClient.assignedBranch].branchName}`
                      : viewingClient.assignedBranch}
                  </span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Contact Person</span>
                  <span className="font-medium text-[#1F1916]">
                    {viewingClient.contactPerson} ({viewingClient.contactDesignation})
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Mobile / Alternate Mobile</span>
                  <span className="font-mono-tabular text-[#1F1916]">
                    {viewingClient.mobile}
                    {viewingClient.alternateMobile ? ` · ${viewingClient.alternateMobile}` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Email</span>
                  <span className="text-[#1F1916] break-all">{viewingClient.email}</span>
                </div>

                <div className="sm:col-span-2">
                  <span className="text-xs text-[#7D6F65] block">Registered Address</span>
                  <span className="text-[#1F1916]">
                    {viewingClient.registeredAddress}, {viewingClient.city}, {viewingClient.state}{' '}
                    <span className="font-mono-tabular">{viewingClient.pinCode}</span>
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Payment Terms</span>
                  <span className="font-medium text-[#1F1916]">{viewingClient.paymentTerms}</span>
                </div>

                <div className="sm:col-span-2">
                  <span className="text-xs text-[#7D6F65] block">Billing Address</span>
                  <span className="text-[#1F1916]">{viewingClient.billingAddress}</span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Billing Contact</span>
                  <span className="text-[#1F1916]">{viewingClient.billingContact}</span>
                </div>

                <div>
                  <span className="text-xs text-[#7D6F65] block">Contract Period</span>
                  <span className="font-mono-tabular text-[#1F1916]">
                    {viewingClient.contractStartDate} to {viewingClient.contractEndDate}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Created By</span>
                  <span className="text-[#1F1916]">{viewingClient.createdBy}</span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Created At / Updated At</span>
                  <span className="font-mono-tabular text-xs text-[#574B43]">
                    {formatIsoDate(viewingClient.createdAt)} · Updated{' '}
                    {formatIsoDate(viewingClient.updatedAt)}
                  </span>
                </div>

                {viewingClient.notes && (
                  <div className="sm:col-span-3 pt-2 border-t border-[#E5DDD2]">
                    <span className="text-xs text-[#7D6F65] block">Notes</span>
                    <p className="text-[#1F1916] mt-0.5">{viewingClient.notes}</p>
                  </div>
                )}
              </div>

              {/* Linked Deployment Sites Section (One Client -> Multiple Sites) */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-semibold text-[#1F1916]">
                      Linked Deployment Sites (
                      {sitesByClient[viewingClient.clientId]?.length ?? 0})
                    </h3>
                    <p className="text-xs text-[#574B43]">
                      Every Site under {viewingClient.displayName} is tracked with a unique Site ID.
                    </p>
                  </div>

                  {hasUserPermission(user, 'site.create') && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetClientId = viewingClient.clientId;
                        setViewingClient(null);
                        navigate(
                          `${portalBasePath}/sites?clientId=${encodeURIComponent(
                            targetClientId
                          )}&create=1`
                        );
                      }}
                      className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] inline-flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Site Under This Client</span>
                    </button>
                  )}
                </div>

                {(sitesByClient[viewingClient.clientId]?.length ?? 0) === 0 ? (
                  <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] text-xs text-[#574B43]">
                    No active Sites registered under this Client yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-[#E5DDD2] rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#FAF8F5] border-b border-[#E5DDD2] text-[#574B43] font-semibold">
                          <th className="py-2.5 px-3">Site ID</th>
                          <th className="py-2.5 px-3">Site Name</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">City &amp; PIN</th>
                          <th className="py-2.5 px-3">Site Manager</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5DDD2]">
                        {sitesByClient[viewingClient.clientId].map((s) => (
                          <tr key={s.siteId} className="hover:bg-[#FAF8F5]">
                            <td className="py-2.5 px-3 font-mono-tabular font-semibold text-[#5C3D2E]">
                              {s.siteId}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-[#1F1916]">{s.siteName}</td>
                            <td className="py-2.5 px-3 text-[#574B43]">{s.siteType}</td>
                            <td className="py-2.5 px-3 text-[#574B43]">
                              {s.city} (<span className="font-mono-tabular">{s.pinCode}</span>)
                            </td>
                            <td className="py-2.5 px-3 text-[#574B43]">
                              {s.siteManagerName} ·{' '}
                              <span className="font-mono-tabular">{s.managerMobile}</span>
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-[#1F1916]">
                              {s.siteStatus}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Historical Audit Log */}
              {viewingClient.history && viewingClient.history.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-display text-sm font-semibold text-[#1F1916]">
                    Client Record History
                  </h3>
                  <ul className="divide-y divide-[#E5DDD2] border border-[#E5DDD2] rounded-xl bg-[#FAF8F5] px-4">
                    {viewingClient.history.map((h) => (
                      <li key={h.id} className="py-2.5 text-xs flex flex-wrap justify-between gap-2">
                        <div>
                          <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                            {h.action}
                          </span>{' '}
                          — <span className="text-[#1F1916]">{h.details}</span>{' '}
                          <span className="text-[#7D6F65]">by {h.actorName}</span>
                        </div>
                        <span className="font-mono-tabular text-[#7D6F65]">
                          {formatIsoDateTime(h.timestamp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="px-5 sm:px-6 py-3.5 border-t border-[#E5DDD2] flex flex-wrap justify-between items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const cid = viewingClient.clientId;
                  setViewingClient(null);
                  navigate(`${portalBasePath}/sites?clientId=${encodeURIComponent(cid)}`);
                }}
                className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#F3EDE4] text-xs font-semibold text-[#5C3D2E] hover:bg-[#E7DDD0]"
              >
                Open All Sites for {viewingClient.displayName}
              </button>

              <div className="flex flex-wrap items-center gap-2">
                {canDeleteClient ? (
                  <button
                    type="button"
                    onClick={() => setArchiveTarget(viewingClient)}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2]"
                  >
                    Archive Client
                  </button>
                ) : (
                  !isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteApprovalClient(viewingClient);
                        setDeleteApprovalReason('');
                        setDeleteApprovalErr(null);
                      }}
                      className="min-h-[40px] px-4 py-2 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#E7DDD0]"
                    >
                      Request Deletion Approval
                    </button>
                  )
                )}

                {canEditClient && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = viewingClient;
                      setViewingClient(null);
                      openEditModal(target);
                    }}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                  >
                    Edit Client
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingClient(null)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteApprovalClient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="client-del-apr-title"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="client-del-apr-title"
                  className="font-display text-lg font-bold text-[#1F1916]"
                >
                  Request Client Archival Approval
                </h3>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  {deleteApprovalClient.clientId} — {deleteApprovalClient.companyName}. Direct
                  Client deletion requires <code className="font-mono-tabular">client.delete</code>{' '}
                  or Admin approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteApprovalClient(null)}
                disabled={submittingApproval}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {deleteApprovalErr && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
                {deleteApprovalErr}
              </div>
            )}

            <form
              onSubmit={(e) => void handleSubmitClientDeleteApproval(e)}
              className="mt-4 space-y-4"
              noValidate
            >
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Justification for Client Archival <span className="text-[#B91C1C]">*</span>
                </label>
                <textarea
                  rows={3}
                  maxLength={350}
                  value={deleteApprovalReason}
                  onChange={(e) => setDeleteApprovalReason(e.target.value)}
                  placeholder="Provide contract end confirmation and billing clearance details..."
                  className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteApprovalClient(null)}
                  disabled={submittingApproval}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingApproval}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
                >
                  {submittingApproval ? 'Submitting...' : 'Submit for Admin Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title={`Archive Client ${archiveTarget?.clientId ?? ''}?`}
        description={`"${archiveTarget?.companyName ?? ''}" will be marked Inactive and archived while keeping all historical Sites, deployments, and invoices intact.`}
        confirmLabel="Archive Client"
        variant="danger"
        loading={archiving}
        onConfirm={() => void handleConfirmArchiveClient()}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
};
