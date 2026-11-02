import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  Plus,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import { listEmployees, subscribeEmployeeData } from '../../services/firestore/employeeService';
import {
  cancelApprovalRequest,
  decideApprovalRequest,
  listApprovalRequests,
  listBranches,
  listClients,
  listSites,
  submitApprovalRequest,
  subscribeMasterData,
} from '../../services/firestore/masterDataService';
import {
  APPROVAL_REQUEST_TYPES,
  APPROVAL_STATUSES,
  ApprovalRequestRecord,
  ApprovalRequestType,
  BranchRecord,
  ClientRecord,
  EmployeeRecord,
  SiteRecord,
  SubmitApprovalInput,
} from '../../types';
import { validateApprovalSubmission } from '../../utils/masterValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';

function formatDateTime(iso: string | null | undefined): string {
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

function mapRequestTypeToModule(
  requestType: ApprovalRequestType
): ApprovalRequestRecord['module'] {
  switch (requestType) {
    case 'Site Deletion':
    case 'Site Sanctioned Strength Override':
      return 'Site';
    case 'Client Deletion':
    case 'Client Sensitive Change':
      return 'Client';
    case 'Employee Deletion':
    case 'Employee Sensitive Change':
      return 'Employee';
    case 'Permission Change Request':
      return 'Permissions';
    case 'Branch Scope Exception':
      return 'Branch';
    case 'Field Officer Replacement Request':
    case 'Field Officer Transfer Request':
    case 'Manpower Shortage Escalation':
      return 'Assignment';
  }
}

export const ApprovalsPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [approvals, setApprovals] = useState<ApprovalRequestRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 7;

  // Submit New Approval Modal
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitForm, setSubmitForm] = useState<SubmitApprovalInput>({
    requestType: 'Site Deletion',
    module: 'Site',
    targetRecordId: '',
    targetRecordName: '',
    branchId: '',
    summary: '',
    reason: '',
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Admin Review Modal
  const [decisionTarget, setDecisionTarget] = useState<{
    approval: ApprovalRequestRecord;
    decision: 'Approved' | 'Rejected';
  } | null>(null);
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [deciding, setDeciding] = useState(false);

  // Cancel Request Confirm & View Details Modal
  const [cancelTarget, setCancelTarget] = useState<ApprovalRequestRecord | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [viewingApproval, setViewingApproval] = useState<ApprovalRequestRecord | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const canReadEmployees = isAdmin || hasUserPermission(user, 'employee.view');
      const [aprList, brList, clList, stList, empList] = await Promise.all([
        listApprovalRequests(user, isPreviewSession),
        listBranches(user, isPreviewSession),
        listClients(user, isPreviewSession),
        listSites(user, isPreviewSession),
        canReadEmployees ? listEmployees(user, isPreviewSession) : Promise.resolve([]),
      ]);
      setApprovals(aprList);
      setBranches(brList.filter((b) => !b.isDeleted));
      setClients(clList.filter((c) => !c.isArchived));
      setSites(stList.filter((s) => !s.isArchived));
      setEmployees(empList.filter((e) => !e.isDeleted));
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [user, isAdmin, isPreviewSession]);

  useEffect(() => {
    void loadData();
    const unsubMaster = subscribeMasterData(() => {
      void loadData();
    });
    const unsubEmp = subscribeEmployeeData(() => {
      void loadData();
    });
    return () => {
      unsubMaster();
      unsubEmp();
    };
  }, [loadData]);

  useEffect(() => {
    if (!viewingApproval) return;
    const refreshed = approvals.find((a) => a.approvalId === viewingApproval.approvalId);
    if (refreshed) {
      setViewingApproval(refreshed);
    }
  }, [approvals, viewingApproval]);

  const authorizedBranches = useMemo(() => {
    if (isAdmin) return branches;
    const allowedIds = getAuthorizedBranchIds(user);
    return branches.filter((b) => allowedIds.includes(b.branchId));
  }, [branches, isAdmin, user]);

  const branchCodeMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of branches) {
      map[b.branchId] = `${b.branchCode} (${b.city})`;
    }
    return map;
  }, [branches]);

  const kpis = useMemo(() => {
    const pending = approvals.filter((a) => a.status === 'Pending').length;
    const approved = approvals.filter((a) => a.status === 'Approved').length;
    const rejected = approvals.filter((a) => a.status === 'Rejected').length;
    const cancelled = approvals.filter((a) => a.status === 'Cancelled').length;
    return { pending, approved, rejected, cancelled };
  }, [approvals]);

  const filteredApprovals = useMemo(() => {
    return approvals.filter((a) => {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && a.requestType !== typeFilter) return false;

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        a.approvalId.toLowerCase().includes(q) ||
        a.requestType.toLowerCase().includes(q) ||
        a.targetRecordId.toLowerCase().includes(q) ||
        a.targetRecordName.toLowerCase().includes(q) ||
        a.requestedByName.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.branchId.toLowerCase().includes(q)
      );
    });
  }, [approvals, statusFilter, typeFilter, searchQuery]);

  const paginatedApprovals = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredApprovals.slice(start, start + pageSize);
  }, [filteredApprovals, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, typeFilter]);

  const openSubmitModal = () => {
    const defaultBranch =
      authorizedBranches[0]?.branchId || getAuthorizedBranchIds(user)[0] || '';
    const firstSite = sites.find((s) => !defaultBranch || s.branchId === defaultBranch) || sites[0];

    setSubmitForm({
      requestType: 'Site Deletion',
      module: 'Site',
      branchId: firstSite?.branchId || defaultBranch,
      targetRecordId: firstSite?.siteId || '',
      targetRecordName: firstSite?.siteName || '',
      summary: '',
      reason: '',
    });
    setSubmitError(null);
    setSubmitModalOpen(true);
  };

  const handleRequestTypeChange = (nextType: ApprovalRequestType) => {
    const mod = mapRequestTypeToModule(nextType);
    let targetRecordId = '';
    let targetRecordName = '';
    let branchId = submitForm.branchId || authorizedBranches[0]?.branchId || '';

    if (mod === 'Site') {
      const s = sites.find((item) => item.branchId === branchId) || sites[0];
      if (s) {
        targetRecordId = s.siteId;
        targetRecordName = s.siteName;
        branchId = s.branchId;
      }
    } else if (mod === 'Client') {
      const c = clients.find((item) => item.assignedBranch === branchId) || clients[0];
      if (c) {
        targetRecordId = c.clientId;
        targetRecordName = c.companyName;
        branchId = c.assignedBranch;
      }
    } else if (mod === 'Employee') {
      const emp = employees.find((item) => item.branchId === branchId) || employees[0];
      if (emp) {
        targetRecordId = emp.employeeId;
        targetRecordName = emp.fullName;
        branchId = emp.branchId;
      }
    } else if (mod === 'Permissions') {
      targetRecordId = user?.uid || 'HR-PERMISSION-REQ';
      targetRecordName = `${user?.fullName ?? 'HR User'} Permission Scope`;
    } else if (mod === 'Branch') {
      const b = authorizedBranches[0];
      targetRecordId = b?.branchId || 'BRN-SCOPE';
      targetRecordName = b?.branchName || 'Branch Scope Request';
    }

    setSubmitForm((prev) => ({
      ...prev,
      requestType: nextType,
      module: mod,
      branchId,
      targetRecordId,
      targetRecordName,
    }));
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitError(null);

    const check = validateApprovalSubmission(submitForm);
    if (!check.valid) {
      setSubmitError(check.error ?? 'Verify all approval request fields.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await submitApprovalRequest(user, isPreviewSession, submitForm);
      setSubmitModalOpen(false);
      setFeedback({
        type: 'success',
        text: `Approval request ${created.approvalId} (${created.requestType}) submitted to Administrator queue.`,
      });
      await loadData();
    } catch (err) {
      setSubmitError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenDecisionModal = (
    approval: ApprovalRequestRecord,
    decision: 'Approved' | 'Rejected'
  ) => {
    setDecisionTarget({ approval, decision });
    setReviewRemarks(
      decision === 'Approved'
        ? 'Verified justification and approved by Administrator.'
        : 'Insufficient justification or active deployment dependency; request declined.'
    );
  };

  const handleConfirmDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !decisionTarget) return;
    setDeciding(true);
    try {
      await decideApprovalRequest(
        user,
        isPreviewSession,
        decisionTarget.approval.approvalId,
        decisionTarget.decision,
        reviewRemarks
      );
      const extraNote =
        decisionTarget.decision === 'Approved' &&
        (decisionTarget.approval.requestType === 'Site Deletion' ||
          decisionTarget.approval.requestType === 'Client Deletion' ||
          decisionTarget.approval.requestType === 'Employee Deletion')
          ? ` Target record ${decisionTarget.approval.targetRecordId} has been archived automatically.`
          : '';
      setFeedback({
        type: 'success',
        text: `Request ${decisionTarget.approval.approvalId} marked ${decisionTarget.decision}.${extraNote}`,
      });
      setDecisionTarget(null);
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
      setDecisionTarget(null);
    } finally {
      setDeciding(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!user || !cancelTarget) return;
    setCancelling(true);
    try {
      await cancelApprovalRequest(user, isPreviewSession, cancelTarget.approvalId);
      setFeedback({
        type: 'success',
        text: `Pending approval request ${cancelTarget.approvalId} cancelled.`,
      });
      setCancelTarget(null);
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  };

  const statusTextClass = (status: ApprovalRequestRecord['status']) => {
    switch (status) {
      case 'Pending':
        return 'text-[#B45309] font-semibold';
      case 'Approved':
        return 'text-[#166534] font-semibold';
      case 'Rejected':
        return 'text-[#B91C1C] font-semibold';
      case 'Cancelled':
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
            {isAdmin ? 'Sensitive Action Approvals' : 'HR Approval Workflow Queue'}
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            {isAdmin
              ? 'Review and sign off on sensitive HR operations (Site/Client archival, strength overrides, and scope exceptions). Normal HR work proceeds without friction.'
              : 'Submit sensitive deletions or overrides for Administrator sign-off while continuing normal permitted Client and Site work directly.'}
          </p>
        </div>

        <button
          type="button"
          onClick={openSubmitModal}
          className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3023] transition-colors self-start sm:self-auto whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>New Approval Request</span>
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
            className="font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 4 Status KPI Cards */}
      <section aria-label="Approval status counts">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMetricCard
            label="Pending Review"
            value={kpis.pending}
            subtext="Awaiting Administrator decision"
            icon={Clock}
            tone={kpis.pending > 0 ? 'attention' : 'default'}
          />
          <StatMetricCard
            label="Approved"
            value={kpis.approved}
            subtext="Signed off & executed"
            icon={ShieldCheck}
          />
          <StatMetricCard
            label="Rejected"
            value={kpis.rejected}
            subtext="Declined with remarks"
            icon={XCircle}
          />
          <StatMetricCard
            label="Cancelled"
            value={kpis.cancelled}
            subtext="Withdrawn prior to Admin review"
            icon={Ban}
          />
        </div>
      </section>

      {/* Main Approval Queue Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Approval Request Ledger
            </h2>
            <p className="text-xs text-[#574B43]">
              Tracked in <code className="font-mono-tabular">approvals/&#123;approvalId&#125;</code>{' '}
              with atomic audit logging on submission, decision, and cancellation.
            </p>
          </div>

          <select
            aria-label="Filter by Request Type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E] self-start sm:self-auto"
          >
            <option value="ALL">All Request Types</option>
            {APPROVAL_REQUEST_TYPES.map((rt) => (
              <option key={rt} value={rt}>
                {rt}
              </option>
            ))}
          </select>
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search Approval ID, target record, requester, or summary..."
          filterOptions={[
            { value: 'ALL', label: 'All Statuses' },
            ...APPROVAL_STATUSES.map((st) => ({ value: st, label: st })),
          ]}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
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
        ) : filteredApprovals.length === 0 ? (
          <EmptyStatePanel
            icon={ShieldAlert}
            title="No Matching Approval Requests"
            description="Sensitive HR requests for Site/Client archival or strength overrides appear here."
            actionLabel="Submit Approval Request"
            onAction={openSubmitModal}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Approval ID</th>
                    <th className="py-3 px-3">Type &amp; Target Record</th>
                    <th className="py-3 px-3">Summary &amp; Requester</th>
                    <th className="py-3 px-3">Branch</th>
                    <th className="py-3 px-3">Submitted</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedApprovals.map((apr) => {
                    const canCancel =
                      apr.status === 'Pending' &&
                      (isAdmin || apr.requestedByUid === user?.uid);

                    return (
                      <tr
                        key={apr.approvalId}
                        className="hover:bg-[#FAF8F5] transition-colors align-top"
                      >
                        <td className="py-3.5 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                          {apr.approvalId}
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="font-semibold text-[#1F1916]">{apr.requestType}</div>
                          <div className="text-xs text-[#574B43] mt-0.5">
                            <span className="font-mono-tabular font-medium text-[#5C3D2E]">
                              {apr.targetRecordId}
                            </span>{' '}
                            · {apr.targetRecordName}
                          </div>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="text-[#1F1916] font-medium max-w-md">{apr.summary}</div>
                          <div className="text-xs text-[#7D6F65] mt-0.5">
                            By {apr.requestedByName} ({apr.requestedByRole})
                          </div>
                        </td>

                        <td className="py-3.5 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                          {branchCodeMap[apr.branchId] ?? apr.branchId}
                        </td>

                        <td className="py-3.5 px-3 font-mono-tabular text-xs text-[#7D6F65] whitespace-nowrap">
                          {formatDateTime(apr.createdAt)}
                        </td>

                        <td className="py-3.5 px-3 text-xs whitespace-nowrap">
                          <span className={statusTextClass(apr.status)}>{apr.status}</span>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingApproval(apr)}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors inline-flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5 text-[#5C3D2E]" />
                              <span>Inspect</span>
                            </button>

                            {apr.status === 'Pending' &&
                              (isAdmin ||
                                (user?.role === 'hr' &&
                                  apr.module === 'Assignment' &&
                                  apr.requestedByRole === 'field_officer' &&
                                  (hasUserPermission(user, 'assignment.manage') ||
                                    hasUserPermission(user, 'assignment.edit')))) && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenDecisionModal(apr, 'Approved')}
                                    className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenDecisionModal(apr, 'Rejected')}
                                    className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] transition-colors whitespace-nowrap"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}

                            {!isAdmin && canCancel && (
                              <button
                                type="button"
                                onClick={() => setCancelTarget(apr)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-medium text-[#574B43] hover:text-[#B91C1C] transition-colors whitespace-nowrap"
                              >
                                Cancel
                              </button>
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
              totalItems={filteredApprovals.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Submit Sensitive Approval Request Modal */}
      {submitModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-apr-title"
        >
          <div className="w-full max-w-xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto">
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2]">
              <div>
                <h2
                  id="submit-apr-title"
                  className="font-display text-lg font-bold text-[#1F1916]"
                >
                  Submit Sensitive Action for Admin Approval
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  Creates a Pending request in Firestore and records an immutable Audit Log entry.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubmitModalOpen(false)}
                disabled={submitting}
                className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSubmitRequest(e)}
              className="p-5 sm:p-6 space-y-4"
              noValidate
            >
              {submitError && (
                <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Sensitive Action Type <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={submitForm.requestType}
                    onChange={(e) =>
                      handleRequestTypeChange(e.target.value as ApprovalRequestType)
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {APPROVAL_REQUEST_TYPES.map((rt) => (
                      <option key={rt} value={rt}>
                        {rt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Branch Scope <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={submitForm.branchId}
                    onChange={(e) =>
                      setSubmitForm((p) => ({ ...p, branchId: e.target.value }))
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    <option value="">Select Branch...</option>
                    {authorizedBranches.map((b) => (
                      <option key={b.branchId} value={b.branchId}>
                        {b.branchCode} — {b.city}
                      </option>
                    ))}
                  </select>
                </div>

                {submitForm.module === 'Site' && sites.length > 0 ? (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Target Site Record <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={submitForm.targetRecordId}
                      onChange={(e) => {
                        const found = sites.find((s) => s.siteId === e.target.value);
                        setSubmitForm((p) => ({
                          ...p,
                          targetRecordId: found?.siteId ?? '',
                          targetRecordName: found?.siteName ?? '',
                          branchId: found?.branchId ?? p.branchId,
                        }));
                      }}
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      <option value="">Select Site...</option>
                      {sites.map((s) => (
                        <option key={s.siteId} value={s.siteId}>
                          {s.siteId} — {s.siteName} ({s.clientName})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : submitForm.module === 'Client' && clients.length > 0 ? (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Target Client Record <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={submitForm.targetRecordId}
                      onChange={(e) => {
                        const found = clients.find((c) => c.clientId === e.target.value);
                        setSubmitForm((p) => ({
                          ...p,
                          targetRecordId: found?.clientId ?? '',
                          targetRecordName: found?.companyName ?? '',
                          branchId: found?.assignedBranch ?? p.branchId,
                        }));
                      }}
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      <option value="">Select Client...</option>
                      {clients.map((c) => (
                        <option key={c.clientId} value={c.clientId}>
                          {c.clientId} — {c.companyName} ({c.city})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : submitForm.module === 'Employee' && employees.length > 0 ? (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Target Employee Record <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={submitForm.targetRecordId}
                      onChange={(e) => {
                        const found = employees.find((emp) => emp.employeeId === e.target.value);
                        setSubmitForm((p) => ({
                          ...p,
                          targetRecordId: found?.employeeId ?? '',
                          targetRecordName: found?.fullName ?? '',
                          branchId: found?.branchId ?? p.branchId,
                        }));
                      }}
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      <option value="">Select Employee...</option>
                      {employees.map((emp) => (
                        <option key={emp.employeeId} value={emp.employeeId}>
                          {emp.employeeId} — {emp.fullName} ({emp.branchName})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                        Target Record ID <span className="text-[#B91C1C]">*</span>
                      </label>
                      <input
                        type="text"
                        value={submitForm.targetRecordId}
                        onChange={(e) =>
                          setSubmitForm((p) => ({ ...p, targetRecordId: e.target.value }))
                        }
                        placeholder="e.g. HR-2026-0001 or STE-2026-0001"
                        className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                        Target Record Name
                      </label>
                      <input
                        type="text"
                        value={submitForm.targetRecordName}
                        onChange={(e) =>
                          setSubmitForm((p) => ({ ...p, targetRecordName: e.target.value }))
                        }
                        placeholder="Descriptive label"
                        className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                      />
                    </div>
                  </>
                )}

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Request Summary <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={160}
                    value={submitForm.summary}
                    onChange={(e) => setSubmitForm((p) => ({ ...p, summary: e.target.value }))}
                    placeholder="Concise summary of the requested action..."
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Operational Justification <span className="text-[#B91C1C]">*</span>
                  </label>
                  <textarea
                    rows={3}
                    maxLength={400}
                    value={submitForm.reason}
                    onChange={(e) => setSubmitForm((p) => ({ ...p, reason: e.target.value }))}
                    placeholder="Provide complete business context, contract reference, or handover details for Admin review..."
                    className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#E5DDD2] flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setSubmitModalOpen(false)}
                  disabled={submitting}
                  className="min-h-[42px] px-4 py-2 text-xs font-semibold text-[#1F1916] bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg hover:bg-[#F3EDE4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[42px] px-5 py-2 text-xs font-semibold text-white bg-[#5C3D2E] rounded-lg hover:bg-[#4A3023] disabled:opacity-60"
                >
                  {submitting ? 'Submitting Request...' : 'Submit Approval Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Approve / Reject Modal with Review Remarks */}
      {decisionTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="decision-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-[#E5DDD2] rounded-xl shadow-xl">
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#E5DDD2]">
              <div>
                <h2
                  id="decision-modal-title"
                  className="font-display text-lg font-bold text-[#1F1916]"
                >
                  {decisionTarget.decision === 'Approved'
                    ? `Approve Request ${decisionTarget.approval.approvalId}`
                    : `Reject Request ${decisionTarget.approval.approvalId}`}
                </h2>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  {decisionTarget.approval.requestType} · {decisionTarget.approval.targetRecordId} (
                  {decisionTarget.approval.targetRecordName})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDecisionTarget(null)}
                disabled={deciding}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmDecision(e)}
              className="p-5 space-y-4 text-sm"
            >
              <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] space-y-1 text-xs">
                <div className="font-semibold text-[#1F1916]">
                  {decisionTarget.approval.summary}
                </div>
                <p className="text-[#574B43]">{decisionTarget.approval.reason}</p>
              </div>

              {decisionTarget.decision === 'Approved' &&
                (decisionTarget.approval.requestType === 'Site Deletion' ||
                  decisionTarget.approval.requestType === 'Client Deletion' ||
                  decisionTarget.approval.requestType === 'Employee Deletion') && (
                  <div className="p-3 rounded-lg bg-[#FEF3C7]/60 border border-[#FDE68A] text-xs text-[#92400E]">
                    <strong>Transactional Execution:</strong> Approving this request will
                    immediately archive <strong>{decisionTarget.approval.targetRecordId}</strong>{' '}
                    while preserving all historical records.
                  </div>
                )}

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Administrator Review Remarks
                </label>
                <textarea
                  rows={3}
                  maxLength={300}
                  value={reviewRemarks}
                  onChange={(e) => setReviewRemarks(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDecisionTarget(null)}
                  disabled={deciding}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deciding}
                  className={`min-h-[42px] px-5 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-60 ${
                    decisionTarget.decision === 'Rejected'
                      ? 'bg-[#B91C1C] hover:bg-[#991B1B]'
                      : 'bg-[#5C3D2E] hover:bg-[#4A3023]'
                  }`}
                >
                  {deciding
                    ? 'Recording Decision...'
                    : decisionTarget.decision === 'Approved'
                      ? 'Confirm Approval'
                      : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect Full Approval Request Modal */}
      {viewingApproval && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="view-apr-title"
        >
          <div className="w-full max-w-2xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto">
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2]">
              <div>
                <div className="flex items-center gap-2 text-xs text-[#7D6F65]">
                  <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                    {viewingApproval.approvalId}
                  </span>
                  <span>·</span>
                  <span>{viewingApproval.module}</span>
                  <span>·</span>
                  <span className={statusTextClass(viewingApproval.status)}>
                    {viewingApproval.status}
                  </span>
                </div>
                <h2
                  id="view-apr-title"
                  className="mt-1 font-display text-lg font-bold text-[#1F1916]"
                >
                  {viewingApproval.requestType}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setViewingApproval(null)}
                className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#FAF8F5] border border-[#E5DDD2] rounded-xl p-4">
                <div>
                  <span className="text-xs text-[#7D6F65] block">Target Record</span>
                  <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                    {viewingApproval.targetRecordId}
                  </span>{' '}
                  — <span className="font-medium text-[#1F1916]">{viewingApproval.targetRecordName}</span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Branch Scope</span>
                  <span className="font-mono-tabular font-semibold text-[#1F1916]">
                    {branchCodeMap[viewingApproval.branchId] ?? viewingApproval.branchId}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Requested By</span>
                  <span className="font-medium text-[#1F1916]">
                    {viewingApproval.requestedByName} ({viewingApproval.requestedByRole})
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#7D6F65] block">Submitted At</span>
                  <span className="font-mono-tabular text-[#1F1916]">
                    {formatDateTime(viewingApproval.createdAt)}
                  </span>
                </div>

                <div className="sm:col-span-2 pt-2 border-t border-[#E5DDD2]">
                  <span className="text-xs text-[#7D6F65] block">Action Summary</span>
                  <p className="font-semibold text-[#1F1916] mt-0.5">{viewingApproval.summary}</p>
                </div>

                <div className="sm:col-span-2">
                  <span className="text-xs text-[#7D6F65] block">Operational Justification</span>
                  <p className="text-[#574B43] mt-0.5 leading-relaxed">{viewingApproval.reason}</p>
                </div>

                {viewingApproval.status !== 'Pending' && (
                  <div className="sm:col-span-2 pt-2 border-t border-[#E5DDD2] space-y-1">
                    <span className="text-xs text-[#7D6F65] block">
                      Review Outcome ({viewingApproval.status})
                    </span>
                    <p className="text-xs text-[#1F1916]">
                      {viewingApproval.reviewedByName
                        ? `Reviewed by ${viewingApproval.reviewedByName}`
                        : 'Closed prior to review'}{' '}
                      ·{' '}
                      <span className="font-mono-tabular text-[#7D6F65]">
                        {formatDateTime(viewingApproval.decidedAt)}
                      </span>
                    </p>
                    {viewingApproval.reviewRemarks && (
                      <p className="text-xs text-[#574B43] italic">
                        “{viewingApproval.reviewRemarks}”
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 sm:px-6 py-3.5 border-t border-[#E5DDD2] flex flex-wrap justify-end gap-2">
              {viewingApproval.status === 'Pending' &&
                (isAdmin || viewingApproval.requestedByUid === user?.uid) && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = viewingApproval;
                      setViewingApproval(null);
                      setCancelTarget(target);
                    }}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#574B43] hover:text-[#B91C1C]"
                  >
                    Cancel Request
                  </button>
                )}

              {isAdmin && viewingApproval.status === 'Pending' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const target = viewingApproval;
                      setViewingApproval(null);
                      handleOpenDecisionModal(target, 'Rejected');
                    }}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#B91C1C]"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = viewingApproval;
                      setViewingApproval(null);
                      handleOpenDecisionModal(target, 'Approved');
                    }}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white"
                  >
                    Approve Request
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setViewingApproval(null)}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title={`Cancel Pending Request ${cancelTarget?.approvalId ?? ''}?`}
        description={`"${cancelTarget?.summary ?? ''}" will be marked Cancelled and removed from the Administrator pending approval queue.`}
        confirmLabel="Cancel Approval Request"
        variant="danger"
        loading={cancelling}
        onConfirm={() => void handleConfirmCancel()}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
};
