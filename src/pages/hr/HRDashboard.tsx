import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Briefcase,
  CalendarClock,
  ClipboardCheck,
  FileSpreadsheet,
  Layers,
  MapPin,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import { listEmployees, subscribeEmployeeData } from '../../services/firestore/employeeService';
import {
  listApprovalRequests,
  listClients,
  listSites,
  submitApprovalRequest,
  subscribeMasterData,
} from '../../services/firestore/masterDataService';
import {
  ZERO_METRICS,
  fetchLivePortalMetrics,
} from '../../services/firestore/portalMetricsService';
import { ApprovalRequestRecord, EmployeeRecord, LivePortalMetrics } from '../../types';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';
import { validateRequiredText } from '../../utils/validation';

interface HRQueueItem {
  id: string;
  type: 'Leave' | 'Advance' | 'Admin Approval';
  subject: string;
  siteCode: string;
  submittedAt: string;
  status: 'Pending Review' | 'Awaiting Admin' | 'Verified' | 'Rejected';
}

const SAMPLE_HR_QUEUE: HRQueueItem[] = [
  {
    id: 'REQ-Sample-201',
    type: 'Leave',
    subject: '[Sample] 3-day medical leave application — Guard Post A',
    siteCode: 'STE-2026-0001',
    submittedAt: 'Today · 09:30',
    status: 'Pending Review',
  },
  {
    id: 'REQ-Sample-202',
    type: 'Advance',
    subject: '[Sample] Festival salary advance request (₹4,500)',
    siteCode: 'STE-2026-0002',
    submittedAt: 'Today · 08:45',
    status: 'Pending Review',
  },
  {
    id: 'REQ-Sample-204',
    type: 'Leave',
    subject: '[Sample] Annual earned leave — Housekeeping Supervisor',
    siteCode: 'STE-2026-0003',
    submittedAt: '2 days ago',
    status: 'Verified',
  },
  {
    id: 'REQ-Sample-205',
    type: 'Advance',
    subject: '[Sample] Emergency travel advance request (₹3,000)',
    siteCode: 'STE-2026-0001',
    submittedAt: '3 days ago',
    status: 'Pending Review',
  },
];

interface HRDashboardProps {
  section?: 'overview' | 'clients-sites' | 'workforce' | 'requests';
}

export const HRDashboard: React.FC<HRDashboardProps> = ({ section = 'overview' }) => {
  const {
    user,
    isFirebaseConfigured,
    isPreviewSession,
    showSampleLayoutData,
    setShowSampleLayoutData,
  } = useAuth();
  const navigate = useNavigate();

  const [metrics, setMetrics] = useState<LivePortalMetrics>(ZERO_METRICS);
  const [masterCounts, setMasterCounts] = useState<{ clients: number; sites: number }>({
    clients: 0,
    sites: 0,
  });
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequestRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 4;

  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [approvalSubject, setApprovalSubject] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [approvalFormErr, setApprovalFormErr] = useState<string | null>(null);
  const [confirmApprovalSubmit, setConfirmApprovalSubmit] = useState(false);
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [submissionNotice, setSubmissionNotice] = useState<string | null>(null);

  const canViewEmployees = hasUserPermission(user, 'employee.view');

  const loadDashboardData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [clientList, siteList, empList, approvalList] = await Promise.all([
        listClients(user, isPreviewSession),
        listSites(user, isPreviewSession),
        canViewEmployees ? listEmployees(user, isPreviewSession) : Promise.resolve([]),
        listApprovalRequests(user, isPreviewSession),
      ]);
      setMasterCounts({
        clients: clientList.filter((c) => !c.isArchived).length,
        sites: siteList.filter((s) => !s.isArchived).length,
      });
      setEmployees(empList.filter((e) => !e.isDeleted));
      setApprovals(approvalList);

      if (isFirebaseConfigured && !isPreviewSession) {
        const res = await fetchLivePortalMetrics(user);
        setMetrics(res);
      } else {
        setMetrics(ZERO_METRICS);
      }
    } finally {
      setLoading(false);
    }
  }, [user, canViewEmployees, isFirebaseConfigured, isPreviewSession]);

  useEffect(() => {
    void loadDashboardData();
    const unsubMaster = subscribeMasterData(() => {
      void loadDashboardData();
    });
    const unsubEmp = subscribeEmployeeData(() => {
      void loadDashboardData();
    });
    return () => {
      unsubMaster();
      unsubEmp();
    };
  }, [loadDashboardData]);

  const useSample = isPreviewSession && showSampleLayoutData;

  const pendingApprovalsCount = useMemo(
    () => approvals.filter((a) => a.status === 'Pending').length,
    [approvals]
  );

  const kpis = useMemo(() => {
    const currentMonthPrefix = new Date().toISOString().slice(0, 7);
    const activeEmpCount = employees.filter((e) => e.employeeStatus === 'Active').length;
    const joinedThisMonth = employees.filter((e) =>
      (e.joiningDate || '').startsWith(currentMonthPrefix)
    ).length;

    if (useSample && employees.length === 0) {
      return {
        totalClients: masterCounts.clients,
        totalSites: masterCounts.sites,
        totalEmployees: 186,
        activeEmployees: 179,
        newJoining: 6,
        attendancePending: 3,
        leaveRequests: 4,
        advanceRequests: 2,
        pendingApprovals: pendingApprovalsCount,
      };
    }
    return {
      totalClients: masterCounts.clients,
      totalSites: masterCounts.sites,
      totalEmployees: employees.length,
      activeEmployees: activeEmpCount,
      newJoining: joinedThisMonth,
      attendancePending: 0,
      leaveRequests: metrics.leaveRequestsCount,
      advanceRequests: metrics.advanceRequestsCount,
      pendingApprovals: pendingApprovalsCount,
    };
  }, [useSample, employees, metrics, masterCounts, pendingApprovalsCount]);

  const combinedQueue = useMemo(() => {
    const liveApprovalItems: HRQueueItem[] = approvals.map((a) => ({
      id: a.approvalId,
      type: 'Admin Approval',
      subject: `${a.requestType}: ${a.summary}`,
      siteCode: a.targetRecordId,
      submittedAt: new Date(a.createdAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
      }),
      status:
        a.status === 'Pending'
          ? 'Awaiting Admin'
          : a.status === 'Approved'
            ? 'Verified'
            : 'Rejected',
    }));
    return useSample ? [...liveApprovalItems, ...SAMPLE_HR_QUEUE] : liveApprovalItems;
  }, [approvals, useSample]);

  const filteredQueue = useMemo(() => {
    return combinedQueue.filter((item) => {
      const matchesType = typeFilter === 'ALL' || item.type === typeFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.id.toLowerCase().includes(q) ||
        item.subject.toLowerCase().includes(q) ||
        item.siteCode.toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [combinedQueue, typeFilter, searchQuery]);

  const paginatedQueue = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredQueue.slice(start, start + pageSize);
  }, [filteredQueue, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, typeFilter, useSample]);

  const handleValidateApprovalSubmission = (e: React.FormEvent) => {
    e.preventDefault();
    setApprovalFormErr(null);

    const subjCheck = validateRequiredText(approvalSubject, 'Action Summary', 5, 140);
    if (!subjCheck.valid) {
      setApprovalFormErr(subjCheck.error ?? 'Invalid summary.');
      return;
    }
    const reasonCheck = validateRequiredText(approvalReason, 'Justification', 8, 300);
    if (!reasonCheck.valid) {
      setApprovalFormErr(reasonCheck.error ?? 'Invalid justification.');
      return;
    }

    setConfirmApprovalSubmit(true);
  };

  const executeApprovalRequest = async () => {
    if (!user) return;
    setSubmittingApproval(true);
    setApprovalFormErr(null);
    try {
      const branchScope = getAuthorizedBranchIds(user)[0] || user.branchId;
      const created = await submitApprovalRequest(user, isPreviewSession, {
        requestType: 'Site Sanctioned Strength Override',
        module: 'Site',
        targetRecordId: branchScope,
        targetRecordName: approvalSubject.trim(),
        branchId: branchScope,
        summary: approvalSubject.trim(),
        reason: approvalReason.trim(),
      });
      setConfirmApprovalSubmit(false);
      setApprovalModalOpen(false);
      setApprovalSubject('');
      setApprovalReason('');
      setSubmissionNotice(
        `Approval request ${created.approvalId} submitted to the Administrator queue and logged in Audit Logs.`
      );
    } catch (err) {
      setConfirmApprovalSubmit(false);
      setApprovalFormErr(err instanceof Error ? err.message : 'Unable to submit approval request.');
    } finally {
      setSubmittingApproval(false);
    }
  };

  const canViewClients = hasUserPermission(user, 'client.view');
  const canViewSites = hasUserPermission(user, 'site.view');
  const canViewServicesOrDesignations =
    hasUserPermission(user, 'service.view') || hasUserPermission(user, 'designation.view');
  const canViewReports = hasUserPermission(user, 'reports.view');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            {section === 'clients-sites'
              ? 'Clients & Site Deployments'
              : section === 'workforce'
                ? 'Workforce Onboarding & Attendance'
                : section === 'requests'
                  ? 'Leave, Advance & Billing Queue'
                  : 'HR Operations Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Authorized Branch Scope:{' '}
            <code className="font-mono-tabular font-semibold text-[#5C3D2E]">
              {getAuthorizedBranchIds(user).join(', ') || '—'}
            </code>{' '}
            · Restricted strictly to assigned branches &amp; permission profile
          </p>
        </div>
      </div>

      {submissionNotice && (
        <div className="p-4 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] text-xs text-[#4A3023] flex items-center justify-between gap-4">
          <span>{submissionNotice}</span>
          <button
            type="button"
            onClick={() => setSubmissionNotice(null)}
            className="text-[#5C3D2E] font-semibold whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 9 Required HR KPI Cards */}
      <section aria-label="HR operational metrics">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="h-[118px] bg-white border border-[#E5DDD2] rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatMetricCard
              label="Total Clients"
              value={kpis.totalClients}
              subtext="Active client contracts in branch"
              icon={Briefcase}
            />
            <StatMetricCard
              label="Total Sites"
              value={kpis.totalSites}
              subtext="Authorized client deployment sites"
              icon={MapPin}
            />
            <StatMetricCard
              label="Total Employees"
              value={kpis.totalEmployees}
              subtext="Registered branch personnel"
              icon={Users}
            />
            <StatMetricCard
              label="Active Employees"
              value={kpis.activeEmployees}
              subtext="Currently deployed & active"
              icon={ClipboardCheck}
            />
            <StatMetricCard
              label="New Joining"
              value={kpis.newJoining}
              subtext="Current month onboarding queue"
              icon={UserPlus}
            />
            <StatMetricCard
              label="Attendance Pending"
              value={kpis.attendancePending}
              subtext="Site sheets awaiting HR verification"
              icon={CalendarClock}
              tone={kpis.attendancePending > 0 ? 'attention' : 'default'}
            />
            <StatMetricCard
              label="Leave Requests"
              value={kpis.leaveRequests}
              subtext="Employee leave applications pending"
              icon={FileSpreadsheet}
            />
            <StatMetricCard
              label="Advance Requests"
              value={kpis.advanceRequests}
              subtext="Salary advance requests pending"
              icon={Wallet}
            />
            <StatMetricCard
              label="Pending Approvals"
              value={kpis.pendingApprovals}
              subtext="Submitted actions awaiting Admin sign-off"
              icon={ShieldCheck}
              tone={kpis.pendingApprovals > 0 ? 'attention' : 'default'}
            />
          </div>
        )}
      </section>

      {/* Quick Actions */}
      <section className="bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <h2 className="font-display text-base font-semibold text-[#1F1916]">HR Quick Actions</h2>
        <p className="mt-0.5 text-xs text-[#574B43]">
          Manage authorized Clients, Sites &amp; Service Configurations or submit sensitive HR
          actions for Administrator approval.
        </p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {canViewClients && (
            <button
              type="button"
              onClick={() => navigate('/hr/clients')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Client Management</span>
              <Briefcase className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>
          )}

          {canViewSites && (
            <button
              type="button"
              onClick={() => navigate('/hr/sites')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Site &amp; Service Config</span>
              <MapPin className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>
          )}

          {canViewEmployees && (
            <button
              type="button"
              onClick={() => navigate('/hr/employees')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Employee Management</span>
              <Users className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>
          )}

          {canViewServicesOrDesignations && (
            <button
              type="button"
              onClick={() => navigate('/hr/services-designations')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Service &amp; Designation</span>
              <Layers className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setApprovalModalOpen(true)}
            className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
          >
            <span className="truncate">Request Admin Approval</span>
            <Send className="w-4 h-4 text-[#5C3D2E] shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => navigate('/hr/approvals')}
            className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
          >
            <span className="truncate">Approval Queue ({pendingApprovalsCount} Pending)</span>
            <ShieldCheck className="w-4 h-4 text-[#5C3D2E] shrink-0" />
          </button>

          {canViewReports && (
            <button
              type="button"
              onClick={() => navigate('/hr/reports')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Branch Vacancy Reports</span>
              <BarChart3 className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>
          )}
        </div>
      </section>

      {/* HR Operational Queue Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Branch HR Requests &amp; Verification Queue
            </h2>
            <p className="text-xs text-[#574B43]">
              {useSample
                ? 'Showing live Admin Approval submissions combined with [Sample] Leave/Advance rows.'
                : 'Displays live Leave, Advance, and Admin Approval items for your authorized branch.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/hr/approvals')}
            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap shrink-0"
          >
            Open Approvals Page
          </button>
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search request ID, site, or subject..."
          filterOptions={[
            { value: 'ALL', label: 'All Items' },
            { value: 'Leave', label: 'Leave' },
            { value: 'Advance', label: 'Advance' },
            { value: 'Admin Approval', label: 'Admin Approval' },
          ]}
          activeFilter={typeFilter}
          onFilterChange={setTypeFilter}
        />

        {filteredQueue.length === 0 ? (
          <EmptyStatePanel
            icon={FileSpreadsheet}
            title={useSample ? 'No Matching Queue Items' : 'HR Request Queue is Clear'}
            description={
              useSample
                ? 'Clear your search filter to see HR workflow items.'
                : 'Employee leave requests, advance requests, and pending Admin approvals for your branch will populate here.'
            }
            actionLabel={!useSample && isPreviewSession ? 'Inspect Sample HR Queue' : undefined}
            onAction={
              !useSample && isPreviewSession ? () => setShowSampleLayoutData(true) : undefined
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Request ID</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Details</th>
                    <th className="py-3 px-3">Target</th>
                    <th className="py-3 px-3">Submitted</th>
                    <th className="py-3 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedQueue.map((item) => (
                    <tr key={item.id} className="hover:bg-[#FAF8F5] transition-colors">
                      <td className="py-3 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                        {item.id}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium text-[#1F1916] whitespace-nowrap">
                        {item.type}
                      </td>
                      <td className="py-3 px-3 text-[#1F1916]">{item.subject}</td>
                      <td className="py-3 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                        {item.siteCode}
                      </td>
                      <td className="py-3 px-3 font-mono-tabular text-xs text-[#7D6F65] whitespace-nowrap">
                        {item.submittedAt}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium whitespace-nowrap">
                        <span
                          className={
                            item.status === 'Verified'
                              ? 'text-[#166534]'
                              : item.status === 'Rejected'
                                ? 'text-[#B91C1C]'
                                : item.status === 'Awaiting Admin'
                                  ? 'text-[#5C3D2E]'
                                  : 'text-[#B45309]'
                          }
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={page}
              totalItems={filteredQueue.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Sensitive Action Approval Submission Modal */}
      {approvalModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold text-[#1F1916]">
                  Submit Action for Admin Approval
                </h3>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  Sensitive HR overrides are queued in{' '}
                  <code className="font-mono-tabular">approvals/&#123;id&#125;</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApprovalModalOpen(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {approvalFormErr && (
              <div className="mt-4 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
                {approvalFormErr}
              </div>
            )}

            <form onSubmit={handleValidateApprovalSubmission} className="mt-4 space-y-4" noValidate>
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Action Summary
                </label>
                <input
                  type="text"
                  value={approvalSubject}
                  onChange={(e) => setApprovalSubject(e.target.value)}
                  placeholder="e.g. Sanctioned Post Strength Revision — STE-2026-0001"
                  maxLength={140}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Operational Justification
                </label>
                <textarea
                  rows={3}
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  placeholder="Provide business justification for Administrator review..."
                  maxLength={300}
                  className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setApprovalModalOpen(false)}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916] whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingApproval}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
                >
                  Submit for Review
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmApprovalSubmit}
        title="Route Request to Administrator?"
        description="This action will be logged under your HR UID and placed in the Administrator pending approval queue."
        confirmLabel="Confirm Submission"
        onConfirm={() => void executeApprovalRequest()}
        onCancel={() => setConfirmApprovalSubmit(false)}
      />
    </div>
  );
};
