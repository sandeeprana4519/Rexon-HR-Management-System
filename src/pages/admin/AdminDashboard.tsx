import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Award,
  Briefcase,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  KeyRound,
  Layers,
  MapPin,
  Plus,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  listAttendanceApprovals,
  reviewAttendanceApproval,
  subscribeAttendanceData,
} from '../../services/firestore/attendanceService';
import { listEmployees, subscribeEmployeeData } from '../../services/firestore/employeeService';
import {
  decideApprovalRequest,
  listApprovalRequests,
  listAuditLogs,
  listBranches,
  listClients,
  listHRProfiles,
  listSites,
  subscribeMasterData,
} from '../../services/firestore/masterDataService';
import {
  ZERO_METRICS,
  fetchLivePortalMetrics,
} from '../../services/firestore/portalMetricsService';
import {
  ApprovalRequestRecord,
  AttendanceApprovalRecord,
  AuditLogRecord,
  BranchRecord,
  ClientRecord,
  EmployeeRecord,
  HRProfileRecord,
  LivePortalMetrics,
  SiteRecord,
} from '../../types';

interface AdminDashboardProps {
  section?: 'overview' | 'approvals';
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ section = 'overview' }) => {
  const { user, isFirebaseConfigured, isPreviewSession, showSampleLayoutData } = useAuth();
  const navigate = useNavigate();

  const [metrics, setMetrics] = useState<LivePortalMetrics>(ZERO_METRICS);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [hrProfiles, setHrProfiles] = useState<HRProfileRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequestRecord[]>([]);
  const [geoApprovals, setGeoApprovals] = useState<AttendanceApprovalRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState<boolean>(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const [pendingDecision, setPendingDecision] = useState<{
    id: string;
    kind: 'master' | 'geofence';
    action: 'Approved' | 'Rejected';
    summary: string;
  } | null>(null);
  const [deciding, setDeciding] = useState(false);

  const loadOverviewData = useCallback(async () => {
    if (!user) return;
    setLoadingMetrics(true);
    setMetricsError(null);
    try {
      const [
        branchList,
        hrList,
        clientList,
        siteList,
        employeeList,
        approvalList,
        geoApprovalList,
        auditList,
      ] = await Promise.all([
        listBranches(user, isPreviewSession),
        listHRProfiles(user, isPreviewSession),
        listClients(user, isPreviewSession),
        listSites(user, isPreviewSession),
        listEmployees(user, isPreviewSession),
        listApprovalRequests(user, isPreviewSession),
        listAttendanceApprovals(user, isPreviewSession).catch(() => []),
        listAuditLogs(user, isPreviewSession),
      ]);
      setBranches(branchList);
      setHrProfiles(hrList);
      setClients(clientList);
      setSites(siteList);
      setEmployees(employeeList);
      setApprovals(approvalList);
      setGeoApprovals(geoApprovalList);
      setAuditLogs(auditList);

      if (isFirebaseConfigured && !isPreviewSession) {
        const live = await fetchLivePortalMetrics(user);
        setMetrics(live);
      } else {
        setMetrics(ZERO_METRICS);
      }
    } catch (err) {
      setMetricsError(err instanceof Error ? err.message : 'Unable to load operational summary.');
    } finally {
      setLoadingMetrics(false);
    }
  }, [user, isFirebaseConfigured, isPreviewSession]);

  useEffect(() => {
    void loadOverviewData();
    const unsubMaster = subscribeMasterData(() => {
      void loadOverviewData();
    });
    const unsubEmp = subscribeEmployeeData(() => {
      void loadOverviewData();
    });
    const unsubAtt = subscribeAttendanceData(() => {
      void loadOverviewData();
    });
    return () => {
      unsubMaster();
      unsubEmp();
      unsubAtt();
    };
  }, [loadOverviewData]);

  const useSample = isPreviewSession && showSampleLayoutData;

  const activeBranches = useMemo(() => branches.filter((b) => !b.isDeleted), [branches]);

  const pendingApprovals = useMemo(
    () => approvals.filter((a) => a.status === 'Pending'),
    [approvals]
  );

  const pendingGeoApprovals = useMemo(
    () => geoApprovals.filter((a) => a.status === 'Pending'),
    [geoApprovals]
  );

  const displayedMetrics = useMemo(() => {
    const nonArchivedClients = clients.filter((c) => !c.isArchived);
    const nonArchivedSites = sites.filter((s) => !s.isArchived);
    const nonDeletedEmployees = employees.filter((e) => !e.isDeleted);

    return {
      branchesCount: activeBranches.length,
      hrUsersCount: hrProfiles.length,
      clientsCount: nonArchivedClients.length,
      sitesCount: nonArchivedSites.length,
      employeesCount:
        nonDeletedEmployees.length > 0 || !useSample ? nonDeletedEmployees.length : 620,
      fieldOfficersCount: useSample ? 14 : metrics.fieldOfficersCount,
      pendingApprovalsCount: pendingApprovals.length + pendingGeoApprovals.length,
    };
  }, [
    activeBranches.length,
    hrProfiles.length,
    clients,
    sites,
    employees,
    useSample,
    metrics,
    pendingApprovals.length,
    pendingGeoApprovals.length,
  ]);

  const branchSummaryRows = useMemo(() => {
    return activeBranches.map((b) => {
      const hrCount = hrProfiles.filter((h) => h.assignedBranches.includes(b.branchId)).length;
      const clientCount = clients.filter(
        (c) => !c.isArchived && c.assignedBranch === b.branchId
      ).length;
      const siteCount = sites.filter(
        (s) => !s.isArchived && s.branchId === b.branchId
      ).length;
      return {
        ...b,
        hrCount,
        clientCount,
        siteCount,
      };
    });
  }, [activeBranches, hrProfiles, clients, sites]);

  const filteredBranches = useMemo(() => {
    return branchSummaryRows.filter((row) => {
      const matchesStatus = statusFilter === 'ALL' || row.status === statusFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        row.branchId.toLowerCase().includes(q) ||
        row.branchCode.toLowerCase().includes(q) ||
        row.branchName.toLowerCase().includes(q) ||
        row.city.toLowerCase().includes(q) ||
        row.state.toLowerCase().includes(q) ||
        row.managerName.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [branchSummaryRows, statusFilter, searchQuery]);

  const paginatedBranches = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredBranches.slice(start, start + pageSize);
  }, [filteredBranches, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter]);

  const recentAuditItems = useMemo(() => auditLogs.slice(0, 6), [auditLogs]);

  const handleConfirmApprovalDecision = async () => {
    if (!pendingDecision || !user) return;
    setDeciding(true);
    setMetricsError(null);
    try {
      if (pendingDecision.kind === 'geofence') {
        await reviewAttendanceApproval(
          user,
          isPreviewSession,
          pendingDecision.id,
          pendingDecision.action,
          `${pendingDecision.action} from Executive Administration Dashboard.`
        );
      } else {
        await decideApprovalRequest(
          user,
          isPreviewSession,
          pendingDecision.id,
          pendingDecision.action,
          `${pendingDecision.action} from Executive Administration Dashboard.`
        );
      }
      setDecisionNotice(
        `Request ${pendingDecision.id} marked as ${pendingDecision.action} and recorded in Audit Logs.`
      );
      setPendingDecision(null);
    } catch (err) {
      setMetricsError(err instanceof Error ? err.message : 'Unable to record approval decision.');
      setPendingDecision(null);
    } finally {
      setDeciding(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            {section === 'approvals'
              ? 'Sensitive Approvals & Security Audit'
              : 'Executive Administration Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            REXON Security &amp; Manpower Solution · Master Data Governance, RBAC, Roster &amp;
            Attendance Verification
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadOverviewData()}
          disabled={loadingMetrics}
          className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors self-start sm:self-auto whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingMetrics ? 'animate-spin' : ''}`} />
          <span>Refresh Summary</span>
        </button>
      </div>

      {metricsError && (
        <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
          {metricsError}
        </div>
      )}

      {decisionNotice && (
        <div className="p-4 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] text-xs text-[#4A3023] flex items-center justify-between gap-4">
          <span>{decisionNotice}</span>
          <button
            type="button"
            onClick={() => setDecisionNotice(null)}
            className="text-[#5C3D2E] font-semibold whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Summary Grid */}
      {section !== 'approvals' && (
        <section aria-label="System-wide operational metrics">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatMetricCard
              label="Total Branches"
              value={displayedMetrics.branchesCount}
              subtext="Active & inactive regional branches"
              icon={Building2}
            />
            <StatMetricCard
              label="Total HR Users"
              value={displayedMetrics.hrUsersCount}
              subtext="Provisioned HR accounts"
              icon={UserCheck}
            />
            <StatMetricCard
              label="Total Clients"
              value={displayedMetrics.clientsCount}
              subtext="Contracted client organizations"
              icon={Briefcase}
            />
            <StatMetricCard
              label="Total Sites"
              value={displayedMetrics.sitesCount}
              subtext="Operational deployment locations"
              icon={ClipboardList}
            />
            <StatMetricCard
              label="Total Employees"
              value={displayedMetrics.employeesCount}
              subtext={useSample ? 'Sample UI preview count' : 'Security & manpower personnel'}
              icon={Users}
            />
            <StatMetricCard
              label="Active Field Officers"
              value={displayedMetrics.fieldOfficersCount}
              subtext={useSample ? 'Sample UI preview count' : 'Field supervisors on duty'}
              icon={Activity}
            />
            <StatMetricCard
              label="Pending Approvals"
              value={displayedMetrics.pendingApprovalsCount}
              subtext="Sensitive HR & geofence overrides awaiting sign-off"
              icon={ShieldCheck}
              tone={displayedMetrics.pendingApprovalsCount > 0 ? 'attention' : 'default'}
            />
          </div>
        </section>
      )}

      {/* Quick Master Data & Phase 4 Operations Shortcuts */}
      {section === 'overview' && (
        <section className="bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="font-display text-base font-semibold text-[#1F1916]">
              Master Data, Roster &amp; Attendance Governance Shortcuts
            </h2>
            <p className="text-xs text-[#574B43]">
              Direct access to Master Data, Duty Roster &amp; Shift Masters, Attendance Verification,
              Permissions, and Audit Logs
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => navigate('/admin/rosters')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Duty Roster &amp; Shifts</span>
              <CalendarClock className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/attendance')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Attendance &amp; Verification</span>
              <ClipboardCheck className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/branches')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Branch Management</span>
              <Plus className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/hr-management')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">HR Account Management</span>
              <UserCog className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/clients')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Client Master Registry</span>
              <Briefcase className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/sites')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Site Master Directory</span>
              <MapPin className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/employees')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Employee Management</span>
              <Users className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/services')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Service Management</span>
              <Layers className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/designations')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Designation Management</span>
              <Award className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/permissions')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Permission Matrix</span>
              <KeyRound className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/audit-logs')}
              className="min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white border border-[#D4C7B8] text-left text-xs font-semibold text-[#1F1916] hover:border-[#5C3D2E] transition-colors whitespace-nowrap"
            >
              <span className="truncate">Immutable Audit Logs</span>
              <ScrollText className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            </button>
          </div>
        </section>
      )}

      {/* Branch-Wise Operational Summary Table */}
      {section !== 'approvals' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Branch-Wise Operational Summary
              </h2>
              <p className="text-xs text-[#574B43]">
                Real-time rollup of HR users, contracted clients, and deployment sites per branch.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/admin/branches')}
              className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] self-start sm:self-auto whitespace-nowrap shrink-0"
            >
              Open Full Branch Manager
            </button>
          </div>

          <DataTableToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search branch code, name, manager, or city..."
            filterOptions={[
              { value: 'ALL', label: 'All Branches' },
              { value: 'Active', label: 'Active' },
              { value: 'Inactive', label: 'Inactive' },
            ]}
            activeFilter={statusFilter}
            onFilterChange={setStatusFilter}
          />

          {filteredBranches.length === 0 ? (
            <EmptyStatePanel
              icon={Building2}
              title="No Matching Branches"
              description="Create or activate regional branches in Branch Management to view operational rollups here."
              actionLabel="Go to Branch Management"
              onAction={() => navigate('/admin/branches')}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                      <th className="py-3 px-3">Branch Code</th>
                      <th className="py-3 px-3">Branch Name</th>
                      <th className="py-3 px-3">City &amp; Manager</th>
                      <th className="py-3 px-3 text-right">HR Users</th>
                      <th className="py-3 px-3 text-right">Clients</th>
                      <th className="py-3 px-3 text-right">Sites</th>
                      <th className="py-3 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5DDD2] text-sm">
                    {paginatedBranches.map((row) => (
                      <tr key={row.branchId} className="hover:bg-[#FAF8F5] transition-colors">
                        <td className="py-3 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                          <div>{row.branchCode}</div>
                          <div className="text-[11px] font-normal text-[#7D6F65]">
                            {row.branchId}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-medium text-[#1F1916]">{row.branchName}</td>
                        <td className="py-3 px-3 text-[#574B43] whitespace-nowrap">
                          <div>
                            {row.city}, {row.state}
                          </div>
                          <div className="text-xs text-[#7D6F65]">{row.managerName}</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono-tabular text-[#1F1916]">
                          {row.hrCount}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-tabular text-[#1F1916]">
                          {row.clientCount}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-tabular text-[#1F1916]">
                          {row.siteCount}
                        </td>
                        <td className="py-3 px-3 text-xs whitespace-nowrap">
                          <span
                            className={
                              row.status === 'Active'
                                ? 'font-semibold text-[#166534]'
                                : 'font-medium text-[#7D6F65]'
                            }
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
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
      )}

      {/* Pending Approvals & Master Data Audit Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-7 bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Pending Sensitive HR &amp; Geofence Approvals
              </h2>
              <p className="mt-0.5 text-xs text-[#574B43]">
                Sensitive HR overrides and site geofence radius changes require explicit
                Administrator confirmation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/admin/approvals')}
              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap shrink-0"
            >
              Open Full Queue
            </button>
          </div>

          {geoApprovals.length > 0 && (
            <div className="pt-2 border-t border-[#E5DDD2] space-y-3">
              <div className="text-xs font-semibold text-[#5C3D2E]">
                Site Geofence Radius Override Requests ({pendingGeoApprovals.length} Pending)
              </div>
              <div className="divide-y divide-[#E5DDD2]">
                {geoApprovals.slice(0, 4).map((geoItem) => (
                  <div key={geoItem.approvalId} className="py-3 first:pt-1 last:pb-1 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#7D6F65]">
                      <span>
                        <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                          {geoItem.approvalId}
                        </span>{' '}
                        · {geoItem.siteName} ({geoItem.siteId})
                      </span>
                      <span className="font-mono-tabular">
                        {geoItem.currentRadiusMeters}m &rarr; {geoItem.requestedRadiusMeters}m
                      </span>
                    </div>
                    <p className="text-xs text-[#1F1916]">{geoItem.reason}</p>
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <span className="text-xs text-[#574B43]">
                        Requested by {geoItem.requestedByName} ({geoItem.requestedByRole})
                      </span>
                      {geoItem.status === 'Pending' ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={deciding}
                            onClick={() =>
                              setPendingDecision({
                                id: geoItem.approvalId,
                                kind: 'geofence',
                                action: 'Rejected',
                                summary: `${geoItem.siteName}: ${geoItem.currentRadiusMeters}m -> ${geoItem.requestedRadiusMeters}m`,
                              })
                            }
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#B91C1C] hover:bg-[#FEF2F2] whitespace-nowrap shrink-0"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            disabled={deciding}
                            onClick={() =>
                              setPendingDecision({
                                id: geoItem.approvalId,
                                kind: 'geofence',
                                action: 'Approved',
                                summary: `${geoItem.siteName}: ${geoItem.currentRadiusMeters}m -> ${geoItem.requestedRadiusMeters}m`,
                              })
                            }
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap shrink-0"
                          >
                            Approve Radius
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`text-xs font-semibold ${
                            geoItem.status === 'Approved' ? 'text-[#166534]' : 'text-[#B91C1C]'
                          }`}
                        >
                          {geoItem.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            {approvals.length === 0 && geoApprovals.length === 0 ? (
              <EmptyStatePanel
                icon={ShieldCheck}
                title="Zero Approval Requests"
                description="Sensitive HR workflow and site geofence override requests appear here for Admin sign-off."
                actionLabel="Open Approvals Workspace"
                onAction={() => navigate('/admin/approvals')}
              />
            ) : (
              <div className="divide-y divide-[#E5DDD2]">
                {approvals.slice(0, 5).map((item) => (
                  <div key={item.approvalId} className="py-4 first:pt-1 last:pb-1 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#7D6F65]">
                      <span>
                        <span className="font-mono-tabular text-[#5C3D2E] font-medium">
                          {item.approvalId}
                        </span>{' '}
                        · {item.requestType} ·{' '}
                        <span className="font-mono-tabular">{item.branchId}</span>
                      </span>
                      <span className="font-mono-tabular">
                        {new Date(item.createdAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-[#1F1916]">{item.summary}</p>
                    <p className="text-xs text-[#574B43]">{item.reason}</p>
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <span className="text-xs text-[#574B43]">
                        Requested by {item.requestedByName} · Target:{' '}
                        <span className="font-mono-tabular">{item.targetRecordId}</span>
                      </span>
                      {item.status === 'Pending' ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={deciding}
                            onClick={() =>
                              setPendingDecision({
                                id: item.approvalId,
                                kind: 'master',
                                action: 'Rejected',
                                summary: item.summary,
                              })
                            }
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors whitespace-nowrap shrink-0"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            disabled={deciding}
                            onClick={() =>
                              setPendingDecision({
                                id: item.approvalId,
                                kind: 'master',
                                action: 'Approved',
                                summary: item.summary,
                              })
                            }
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap shrink-0"
                          >
                            Approve Action
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`text-xs font-semibold ${
                            item.status === 'Approved'
                              ? 'text-[#166534]'
                              : item.status === 'Rejected'
                                ? 'text-[#B91C1C]'
                                : 'text-[#7D6F65]'
                          }`}
                        >
                          {item.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="lg:col-span-5 bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Recent Master Data &amp; Audit Activity
              </h2>
              <p className="mt-0.5 text-xs text-[#574B43]">
                Immutable chronological trail from{' '}
                <code className="font-mono-tabular">auditLogs</code>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/admin/audit-logs')}
              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap shrink-0"
            >
              Audit Explorer
            </button>
          </div>

          <div className="mt-4">
            {recentAuditItems.length === 0 ? (
              <EmptyStatePanel
                icon={Activity}
                title="No Recent Audit Events"
                description="Master data mutations and approval decisions stream here automatically."
              />
            ) : (
              <ul className="divide-y divide-[#E5DDD2]">
                {recentAuditItems.map((act) => (
                  <li key={act.logId} className="py-3 first:pt-1 last:pb-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-mono-tabular font-semibold text-[#5C3D2E]">
                        {act.module} · {act.action}
                      </p>
                      <span className="text-[11px] font-mono-tabular text-[#7D6F65] shrink-0">
                        {new Date(act.timestamp).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[#1F1916]">{act.summary}</p>
                    <p className="mt-0.5 text-[11px] text-[#7D6F65]">
                      {act.performedBy} · <span className="font-mono-tabular">{act.recordId}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDecision)}
        title={`Confirm ${pendingDecision?.action ?? ''} Decision`}
        description={`Are you sure you want to mark "${pendingDecision?.summary ?? ''}" as ${pendingDecision?.action ?? ''}?`}
        confirmLabel={pendingDecision?.action === 'Rejected' ? 'Reject Request' : 'Approve Request'}
        variant={pendingDecision?.action === 'Rejected' ? 'danger' : 'primary'}
        onConfirm={() => void handleConfirmApprovalDecision()}
        onCancel={() => setPendingDecision(null)}
      />
    </div>
  );
};
