import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Edit3,
  Eye,
  FileWarning,
  Filter,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmployeeFormModal } from '../../components/EmployeeFormModal';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  listEmployees,
  softDeleteEmployeeRecord,
  subscribeEmployeeData,
  toggleEmployeeActiveStatus,
} from '../../services/firestore/employeeService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  listBranches,
  listDesignations,
  listServices,
  listSites,
  submitApprovalRequest,
  subscribeMasterData,
} from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  DesignationRecord,
  EMPLOYEE_STATUSES,
  EmployeeRecord,
  SERVICE_CATEGORIES,
  ServiceRecord,
  SiteRecord,
} from '../../types';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';
import { validateRequiredText } from '../../utils/validation';

interface EmployeeManagementPageProps {
  fieldOfficerView?: boolean;
}

type SortOption =
  | 'newest'
  | 'joining_desc'
  | 'joining_asc'
  | 'name_asc'
  | 'emp_id_asc';

export const EmployeeManagementPage: React.FC<EmployeeManagementPageProps> = ({
  fieldOfficerView = false,
}) => {
  const { user, isPreviewSession } = useAuth();
  const navigate = useNavigate();

  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Search, Sort & 7 Required Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [designationFilter, setDesignationFilter] = useState('ALL');
  const [joiningFrom, setJoiningFrom] = useState('');
  const [joiningTo, setJoiningTo] = useState('');
  const [docVerificationFilter, setDocVerificationFilter] = useState('ALL');
  const [deploymentFilter, setDeploymentFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  // Create / Edit Modal
  const [formModalState, setFormModalState] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    employee: EmployeeRecord | null;
  }>({ open: false, mode: 'create', employee: null });

  // Activate / Deactivate Confirm Dialog
  const [statusToggleTarget, setStatusToggleTarget] = useState<EmployeeRecord | null>(null);
  const [togglingStatus, setTogglingStatus] = useState(false);

  // Direct Soft Delete (Admin or HR with employee.delete)
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // HR Approval Workflow Modal when HR lacks direct employee.delete
  const [approvalDeleteTarget, setApprovalDeleteTarget] = useState<EmployeeRecord | null>(null);
  const [approvalReason, setApprovalReason] = useState('');
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [submittingApproval, setSubmittingApproval] = useState(false);

  const isFieldOfficer = fieldOfficerView || user?.role === 'field_officer';
  const isAdmin = user?.role === 'admin';
  const canCreate = !isFieldOfficer && (isAdmin || hasUserPermission(user, 'employee.create'));
  const canEdit = !isFieldOfficer && (isAdmin || hasUserPermission(user, 'employee.edit'));
  const canDirectDelete =
    !isFieldOfficer && (isAdmin || hasUserPermission(user, 'employee.delete'));
  const canRequestDeleteApproval = !isFieldOfficer && user?.role === 'hr' && !canDirectDelete;

  const portalBasePath = useMemo(() => {
    if (user?.role === 'admin') return '/admin/employees';
    if (user?.role === 'hr') return '/hr/employees';
    if (user?.role === 'field_officer') return '/field-officer/employees';
    return '/employee/my-record';
  }, [user?.role]);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (user.role === 'field_officer') {
        const empList = await listEmployees(user, isPreviewSession);
        setEmployees(empList);
      } else {
        const [empList, brList, srvList, dsgList, stList] = await Promise.all([
          listEmployees(user, isPreviewSession),
          listBranches(user, isPreviewSession),
          listServices(user, isPreviewSession),
          listDesignations(user, isPreviewSession),
          listSites(user, isPreviewSession),
        ]);
        setEmployees(empList);
        setBranches(brList.filter((b) => !b.isDeleted));
        setServices(srvList);
        setDesignations(dsgList);
        setSites(stList.filter((s) => !s.isArchived));
      }
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadData();
    const unsubEmp = subscribeEmployeeData(() => {
      void loadData();
    });
    const unsubMaster = subscribeMasterData(() => {
      void loadData();
    });
    return () => {
      unsubEmp();
      unsubMaster();
    };
  }, [loadData]);

  const authorizedBranches = useMemo(() => {
    if (isAdmin) return branches;
    const allowed = getAuthorizedBranchIds(user);
    return branches.filter((b) => allowed.includes(b.branchId));
  }, [branches, isAdmin, user]);

  const filteredDesignationOptions = useMemo(() => {
    return designations.filter(
      (d) => categoryFilter === 'ALL' || d.serviceCategory === categoryFilter
    );
  }, [designations, categoryFilter]);

  // 5 Required Summary Cards
  const summaryStats = useMemo(() => {
    const total = employees.length;
    const active = employees.filter((e) => e.employeeStatus === 'Active').length;
    const inactive = employees.filter((e) => e.employeeStatus !== 'Active').length;
    const available = employees.filter(
      (e) => e.employeeStatus === 'Active' && !e.currentSiteId
    ).length;
    const pendingDocs = employees.filter(
      (e) =>
        e.docVerificationSummary === 'Pending' || e.docVerificationSummary === 'No Documents'
    ).length;
    return { total, active, inactive, available, pendingDocs };
  }, [employees]);

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    branchFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    categoryFilter !== 'ALL' ||
    designationFilter !== 'ALL' ||
    Boolean(joiningFrom) ||
    Boolean(joiningTo) ||
    docVerificationFilter !== 'ALL' ||
    deploymentFilter !== 'ALL';

  const resetAllFilters = () => {
    setSearchQuery('');
    setBranchFilter('ALL');
    setStatusFilter('ALL');
    setCategoryFilter('ALL');
    setDesignationFilter('ALL');
    setJoiningFrom('');
    setJoiningTo('');
    setDocVerificationFilter('ALL');
    setDeploymentFilter('ALL');
    setSortBy('newest');
  };

  const filteredAndSortedEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = employees.filter((emp) => {
      if (branchFilter !== 'ALL' && emp.branchId !== branchFilter) return false;
      if (statusFilter !== 'ALL' && emp.employeeStatus !== statusFilter) return false;
      if (
        categoryFilter !== 'ALL' &&
        !emp.assignedServiceCategories.includes(categoryFilter as never)
      ) {
        return false;
      }
      if (
        designationFilter !== 'ALL' &&
        !emp.assignedDesignationIds.includes(designationFilter)
      ) {
        return false;
      }
      if (joiningFrom && emp.joiningDate < joiningFrom) return false;
      if (joiningTo && emp.joiningDate > joiningTo) return false;
      if (
        docVerificationFilter !== 'ALL' &&
        emp.docVerificationSummary !== docVerificationFilter
      ) {
        return false;
      }
      if (deploymentFilter === 'Assigned' && !emp.currentSiteId) return false;
      if (deploymentFilter === 'Unassigned' && Boolean(emp.currentSiteId)) return false;

      if (!q) return true;
      return (
        emp.employeeId.toLowerCase().includes(q) ||
        emp.fullName.toLowerCase().includes(q) ||
        emp.mobile.toLowerCase().includes(q) ||
        emp.email.toLowerCase().includes(q) ||
        emp.city.toLowerCase().includes(q) ||
        emp.currentSiteName.toLowerCase().includes(q) ||
        emp.assignedDesignations.some((d) => d.designationName.toLowerCase().includes(q))
      );
    });

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'joining_desc':
          return (b.joiningDate || '').localeCompare(a.joiningDate || '');
        case 'joining_asc':
          return (a.joiningDate || '').localeCompare(b.joiningDate || '');
        case 'name_asc':
          return a.fullName.localeCompare(b.fullName);
        case 'emp_id_asc':
          return a.employeeId.localeCompare(b.employeeId);
        case 'newest':
        default:
          return (b.createdAt || '').localeCompare(a.createdAt || '');
      }
    });
  }, [
    employees,
    searchQuery,
    branchFilter,
    statusFilter,
    categoryFilter,
    designationFilter,
    joiningFrom,
    joiningTo,
    docVerificationFilter,
    deploymentFilter,
    sortBy,
  ]);

  const paginatedEmployees = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAndSortedEmployees.slice(start, start + pageSize);
  }, [filteredAndSortedEmployees, page]);

  useEffect(() => {
    setPage(1);
  }, [
    searchQuery,
    branchFilter,
    statusFilter,
    categoryFilter,
    designationFilter,
    joiningFrom,
    joiningTo,
    docVerificationFilter,
    deploymentFilter,
    sortBy,
  ]);

  const handleConfirmToggleStatus = async () => {
    if (!user || !statusToggleTarget) return;
    const nextStatus = statusToggleTarget.employeeStatus === 'Active' ? 'Inactive' : 'Active';
    setTogglingStatus(true);
    try {
      await toggleEmployeeActiveStatus(
        user,
        isPreviewSession,
        statusToggleTarget.employeeId,
        nextStatus
      );
      setFeedback({
        type: 'success',
        text: `Employee ${statusToggleTarget.employeeId} (${statusToggleTarget.fullName}) status updated to ${nextStatus}.`,
      });
      setStatusToggleTarget(null);
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
      setStatusToggleTarget(null);
    } finally {
      setTogglingStatus(false);
    }
  };

  const handleConfirmSoftDelete = async () => {
    if (!user || !deleteTarget) return;
    setDeleting(true);
    try {
      await softDeleteEmployeeRecord(
        user,
        isPreviewSession,
        deleteTarget.employeeId,
        'Soft-deleted from Employee Management directory.'
      );
      setFeedback({
        type: 'success',
        text: `Employee ${deleteTarget.employeeId} (${deleteTarget.fullName}) soft-deleted. Historical deployment and audit logs remain preserved.`,
      });
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmitDeletionApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !approvalDeleteTarget) return;
    setApprovalError(null);

    const check = validateRequiredText(approvalReason, 'Deletion Justification', 8, 350);
    if (!check.valid) {
      setApprovalError(check.error ?? 'Provide a valid justification.');
      return;
    }

    setSubmittingApproval(true);
    try {
      const created = await submitApprovalRequest(user, isPreviewSession, {
        requestType: 'Employee Deletion',
        module: 'Employee',
        targetRecordId: approvalDeleteTarget.employeeId,
        targetRecordName: approvalDeleteTarget.fullName,
        branchId: approvalDeleteTarget.branchId,
        summary: `Archive Employee ${approvalDeleteTarget.employeeId} (${approvalDeleteTarget.fullName})`,
        reason: approvalReason.trim(),
      });
      setApprovalDeleteTarget(null);
      setApprovalReason('');
      setFeedback({
        type: 'success',
        text: `Employee Deletion request ${created.approvalId} submitted to Administrator Approval Queue.`,
      });
    } catch (err) {
      setApprovalError(formatServiceErrorMessage(err));
    } finally {
      setSubmittingApproval(false);
    }
  };

  const statusColorClass = (status: EmployeeRecord['employeeStatus']) => {
    switch (status) {
      case 'Active':
        return 'text-[#166534] font-semibold';
      case 'On Leave':
        return 'text-[#B45309] font-semibold';
      case 'Suspended':
      case 'Exited':
        return 'text-[#B91C1C] font-semibold';
      case 'Inactive':
      default:
        return 'text-[#7D6F65] font-medium';
    }
  };

  const docSummaryColorClass = (summary: EmployeeRecord['docVerificationSummary']) => {
    switch (summary) {
      case 'Verified':
        return 'text-[#166534] font-semibold';
      case 'Rejected':
        return 'text-[#B91C1C] font-semibold';
      case 'Pending':
        return 'text-[#B45309] font-semibold';
      case 'No Documents':
      default:
        return 'text-[#7D6F65]';
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            {isFieldOfficer ? 'Assigned Site Personnel Roster' : 'Employee Management'}
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            {isFieldOfficer
              ? 'Operational directory of guards, housekeeping, and manpower personnel deployed across your assigned sites. Financial & KYC data is restricted.'
              : 'Onboarding, dynamic service & designation eligibility, Firebase Storage KYC document verification, and branch-scoped workforce governance.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="min-h-[42px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {canCreate && (
            <button
              type="button"
              onClick={() =>
                setFormModalState({ open: true, mode: 'create', employee: null })
              }
              className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs sm:text-sm font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Add New Employee</span>
            </button>
          )}
        </div>
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

      {/* 5 Required Summary Cards */}
      <section aria-label="Employee summary metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatMetricCard
            label="Total Employees"
            value={summaryStats.total}
            subtext={
              isFieldOfficer
                ? 'Personnel on your assigned sites'
                : 'Registered active & inactive staff'
            }
            icon={Users}
          />
          <StatMetricCard
            label="Active Employees"
            value={summaryStats.active}
            subtext="Cleared for duty deployment"
            icon={UserCheck}
          />
          <StatMetricCard
            label="Inactive Employees"
            value={summaryStats.inactive}
            subtext="Inactive, on leave, or suspended"
            icon={Ban}
          />
          <StatMetricCard
            label="Available Employees"
            value={summaryStats.available}
            subtext="Active & currently unassigned"
            icon={UserPlus}
          />
          {!isFieldOfficer && (
            <StatMetricCard
              label="Pending Document Verification"
              value={summaryStats.pendingDocs}
              subtext="Awaiting KYC upload or review"
              icon={FileWarning}
              tone={summaryStats.pendingDocs > 0 ? 'attention' : 'default'}
            />
          )}
        </div>
      </section>

      {/* Filters, Search & Employee Directory */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
        {/* Search & Sort Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#7D6F65] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Employee ID, full name, mobile, designation, site, or city..."
              className="w-full min-h-[42px] pl-10 pr-4 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] placeholder:text-[#7D6F65] focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="text-xs font-medium text-[#574B43] whitespace-nowrap">
              Sort By:
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="min-h-[42px] px-3 py-2 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
            >
              <option value="newest">Newest Registered</option>
              <option value="joining_desc">Joining Date (Newest)</option>
              <option value="joining_asc">Joining Date (Oldest)</option>
              <option value="name_asc">Full Name (A–Z)</option>
              <option value="emp_id_asc">Employee ID</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="min-h-[42px] px-3.5 py-2 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* 7 Multi-Dimensional Filters */}
        {!isFieldOfficer && (
          <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#574B43]">
              <Filter className="w-3.5 h-3.5 text-[#5C3D2E]" />
              <span>Filter Workforce Directory</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* 1. Branch */}
              <div>
                <label className="block text-[11px] font-medium text-[#7D6F65] mb-1">
                  Branch
                </label>
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
                >
                  <option value="ALL">All Authorized Branches</option>
                  {authorizedBranches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchCode} — {b.city}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Employee Status */}
              <div>
                <label className="block text-[11px] font-medium text-[#7D6F65] mb-1">
                  Employee Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
                >
                  <option value="ALL">All Statuses</option>
                  {EMPLOYEE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Service Category */}
              <div>
                <label className="block text-[11px] font-medium text-[#7D6F65] mb-1">
                  Service Category
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setDesignationFilter('ALL');
                  }}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
                >
                  <option value="ALL">All Categories</option>
                  {SERVICE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. Designation (Dynamic from Firestore) */}
              <div>
                <label className="block text-[11px] font-medium text-[#7D6F65] mb-1">
                  Designation
                </label>
                <select
                  value={designationFilter}
                  onChange={(e) => setDesignationFilter(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
                >
                  <option value="ALL">All Designations</option>
                  {filteredDesignationOptions.map((d) => (
                    <option key={d.designationId} value={d.designationId}>
                      {d.designationName} ({d.serviceCategory})
                    </option>
                  ))}
                </select>
              </div>

              {/* 5. Joining Date Range */}
              <div>
                <label className="block text-[11px] font-medium text-[#7D6F65] mb-1">
                  Joined From
                </label>
                <input
                  type="date"
                  value={joiningFrom}
                  onChange={(e) => setJoiningFrom(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#7D6F65] mb-1">
                  Joined To
                </label>
                <input
                  type="date"
                  value={joiningTo}
                  onChange={(e) => setJoiningTo(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
                />
              </div>

              {/* 6. Document Verification Status */}
              <div>
                <label className="block text-[11px] font-medium text-[#7D6F65] mb-1">
                  Document Verification
                </label>
                <select
                  value={docVerificationFilter}
                  onChange={(e) => setDocVerificationFilter(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
                >
                  <option value="ALL">All Verification States</option>
                  <option value="Verified">Verified</option>
                  <option value="Pending">Pending Verification</option>
                  <option value="Rejected">Rejected</option>
                  <option value="No Documents">No Documents Uploaded</option>
                </select>
              </div>

              {/* 7. Assigned / Unassigned */}
              <div>
                <label className="block text-[11px] font-medium text-[#7D6F65] mb-1">
                  Site Deployment
                </label>
                <select
                  value={deploymentFilter}
                  onChange={(e) => setDeploymentFilter(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
                >
                  <option value="ALL">All (Assigned &amp; Unassigned)</option>
                  <option value="Assigned">Assigned to Site</option>
                  <option value="Unassigned">Unassigned (Available)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Loading / Empty / Table & Mobile Cards */}
        {loading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={idx}
                className="h-16 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] animate-pulse"
              />
            ))}
          </div>
        ) : filteredAndSortedEmployees.length === 0 ? (
          <EmptyStatePanel
            icon={Users}
            title={
              employees.length === 0
                ? isFieldOfficer
                  ? 'No Personnel Deployed on Your Assigned Sites Yet'
                  : 'No Employees Registered Yet'
                : 'No Matching Employees Found'
            }
            description={
              employees.length === 0
                ? isFieldOfficer
                  ? 'Once HR or Admin assigns active Security, Housekeeping, or Manpower employees to your sites, their operational roster will appear here.'
                  : 'Register your first Security Guard, Housekeeping staff, or Manpower employee. Records persist in Firestore without hardcoded demo employees.'
                : 'Adjust or clear your active search, branch, designation, joining date, or document verification filters.'
            }
            actionLabel={
              employees.length === 0
                ? canCreate
                  ? 'Register First Employee'
                  : undefined
                : 'Clear Filters'
            }
            onAction={
              employees.length === 0
                ? canCreate
                  ? () => setFormModalState({ open: true, mode: 'create', employee: null })
                  : undefined
                : resetAllFilters
            }
          />
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Employee</th>
                    <th className="py-3 px-3">Services &amp; Designations</th>
                    <th className="py-3 px-3">Branch &amp; Site Deployment</th>
                    <th className="py-3 px-3">Joining Date</th>
                    {!isFieldOfficer && <th className="py-3 px-3">Documents</th>}
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedEmployees.map((emp) => (
                    <tr key={emp.employeeId} className="hover:bg-[#FAF8F5] transition-colors">
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-3">
                          {emp.profilePhoto ? (
                            <img
                              src={emp.profilePhoto}
                              alt={emp.fullName}
                              className="w-9 h-9 rounded-lg object-cover border border-[#D4C7B8] shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-[#F3EDE4] text-[#5C3D2E] font-display text-xs font-bold flex items-center justify-center shrink-0">
                              {emp.fullName.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => navigate(`${portalBasePath}/${emp.employeeId}`)}
                              className="font-semibold text-[#1F1916] hover:text-[#5C3D2E] text-left truncate block"
                            >
                              {emp.fullName}
                            </button>
                            <div className="text-xs text-[#7D6F65] font-mono-tabular">
                              {emp.employeeId} · {emp.mobile}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="text-xs font-medium text-[#1F1916]">
                          {emp.assignedDesignations.map((d) => d.designationName).join(' · ') ||
                            '—'}
                        </div>
                        <div className="text-xs text-[#7D6F65]">
                          {emp.assignedServiceCategories.join(' / ')} · {emp.employmentType}
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="text-xs font-medium text-[#1F1916]">{emp.branchName}</div>
                        <div className="text-xs text-[#574B43] font-mono-tabular mt-0.5">
                          {emp.currentSiteId
                            ? `${emp.currentSiteId} · ${emp.currentSiteName}`
                            : 'Unassigned · Available Pool'}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                        {emp.joiningDate}
                      </td>

                      {!isFieldOfficer && (
                        <td className="py-3.5 px-3 text-xs whitespace-nowrap">
                          <div className={docSummaryColorClass(emp.docVerificationSummary)}>
                            {emp.docVerificationSummary}
                          </div>
                          <div className="text-[11px] text-[#7D6F65] font-mono-tabular">
                            {emp.totalDocumentsCount} file(s)
                            {emp.pendingDocumentsCount > 0
                              ? ` · ${emp.pendingDocumentsCount} pending`
                              : ''}
                          </div>
                        </td>
                      )}

                      <td className="py-3.5 px-3 text-xs whitespace-nowrap">
                        <span className={statusColorClass(emp.employeeStatus)}>
                          {emp.employeeStatus}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => navigate(`${portalBasePath}/${emp.employeeId}`)}
                            className="min-h-[34px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] inline-flex items-center gap-1"
                            title="View Full Profile"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Profile</span>
                          </button>

                          {canEdit && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setFormModalState({
                                    open: true,
                                    mode: 'edit',
                                    employee: emp,
                                  })
                                }
                                className="min-h-[34px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4]"
                                title="Edit Employee"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => setStatusToggleTarget(emp)}
                                className="min-h-[34px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#574B43] hover:text-[#1F1916] hover:bg-[#F3EDE4]"
                              >
                                {emp.employeeStatus === 'Active' ? 'Deactivate' : 'Activate'}
                              </button>
                            </>
                          )}

                          {canDirectDelete && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(emp)}
                              className="min-h-[34px] px-2.5 py-1.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#B91C1C] hover:bg-[#FEE2E2]"
                              title="Soft Delete Employee"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {canRequestDeleteApproval && (
                            <button
                              type="button"
                              onClick={() => {
                                setApprovalReason('');
                                setApprovalError(null);
                                setApprovalDeleteTarget(emp);
                              }}
                              className="min-h-[34px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-medium text-[#5C3D2E] hover:bg-[#F3EDE4]"
                              title="Request Admin Approval for Deletion"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile & Tablet Card List */}
            <div className="lg:hidden space-y-3">
              {paginatedEmployees.map((emp) => (
                <div
                  key={emp.employeeId}
                  className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {emp.profilePhoto ? (
                        <img
                          src={emp.profilePhoto}
                          alt={emp.fullName}
                          className="w-11 h-11 rounded-lg object-cover border border-[#D4C7B8] shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-lg bg-[#F3EDE4] text-[#5C3D2E] font-display text-xs font-bold flex items-center justify-center shrink-0">
                          {emp.fullName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-[#1F1916] truncate">
                          {emp.fullName}
                        </div>
                        <div className="text-xs font-mono-tabular text-[#5C3D2E]">
                          {emp.employeeId} · {emp.mobile}
                        </div>
                      </div>
                    </div>
                    <span className={`text-xs shrink-0 ${statusColorClass(emp.employeeStatus)}`}>
                      {emp.employeeStatus}
                    </span>
                  </div>

                  <div className="text-xs text-[#574B43] space-y-1 pt-2 border-t border-[#E5DDD2]">
                    <div>
                      <strong className="text-[#1F1916]">Designations:</strong>{' '}
                      {emp.assignedDesignations.map((d) => d.designationName).join(' · ') || '—'}
                    </div>
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-[#5C3D2E] shrink-0" />
                      <span className="truncate">
                        {emp.currentSiteId
                          ? `${emp.currentSiteId} — ${emp.currentSiteName}`
                          : 'Unassigned (Available Pool)'}
                      </span>
                    </div>
                    <div className="font-mono-tabular text-[11px] text-[#7D6F65]">
                      Branch: {emp.branchName} · Joined: {emp.joiningDate}
                      {!isFieldOfficer ? ` · Docs: ${emp.docVerificationSummary}` : ''}
                    </div>
                  </div>

                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`${portalBasePath}/${emp.employeeId}`)}
                      className="min-h-[40px] flex-1 px-3 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] text-center"
                    >
                      View Profile
                    </button>
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setFormModalState({ open: true, mode: 'edit', employee: emp })
                          }
                          className="min-h-[40px] px-3 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusToggleTarget(emp)}
                          className="min-h-[40px] px-3 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-medium text-[#574B43]"
                        >
                          {emp.employeeStatus === 'Active' ? 'Deactivate' : 'Activate'}
                        </button>
                      </>
                    )}
                    {canDirectDelete && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(emp)}
                        className="min-h-[40px] px-3 py-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#B91C1C]"
                      >
                        Archive
                      </button>
                    )}
                    {canRequestDeleteApproval && (
                      <button
                        type="button"
                        onClick={() => {
                          setApprovalReason('');
                          setApprovalError(null);
                          setApprovalDeleteTarget(emp);
                        }}
                        className="min-h-[40px] px-3 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E]"
                      >
                        Request Archive
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <PaginationControls
              currentPage={page}
              totalItems={filteredAndSortedEmployees.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Add / Edit Employee Modal */}
      {formModalState.open && (
        <EmployeeFormModal
          open={formModalState.open}
          mode={formModalState.mode}
          initialEmployee={formModalState.employee}
          branches={branches}
          services={services}
          designations={designations}
          sites={sites}
          caller={user}
          isPreviewSession={isPreviewSession}
          onClose={() => setFormModalState({ open: false, mode: 'create', employee: null })}
          onSaved={(saved) => {
            const wasEdit = formModalState.mode === 'edit';
            setFormModalState({ open: false, mode: 'create', employee: null });
            setFeedback({
              type: 'success',
              text: wasEdit
                ? `Updated Employee ${saved.employeeId} (${saved.fullName}) successfully.`
                : `Registered Employee ${saved.employeeId} (${saved.fullName}). Upload KYC documents on their profile page.`,
            });
            void loadData();
          }}
        />
      )}

      {/* Activate / Deactivate Confirmation */}
      <ConfirmDialog
        open={Boolean(statusToggleTarget)}
        title={
          statusToggleTarget?.employeeStatus === 'Active'
            ? `Deactivate ${statusToggleTarget.employeeId}?`
            : `Activate ${statusToggleTarget?.employeeId ?? ''}?`
        }
        description={
          statusToggleTarget?.employeeStatus === 'Active'
            ? `Marking ${statusToggleTarget.fullName} as Inactive prevents active roster check-ins while preserving all historical duty, salary, and KYC records.`
            : `Reactivating ${statusToggleTarget?.fullName ?? 'this employee'} restores their active deployment eligibility.`
        }
        confirmLabel={statusToggleTarget?.employeeStatus === 'Active' ? 'Deactivate' : 'Activate'}
        variant={statusToggleTarget?.employeeStatus === 'Active' ? 'danger' : 'primary'}
        loading={togglingStatus}
        onConfirm={() => void handleConfirmToggleStatus()}
        onCancel={() => setStatusToggleTarget(null)}
      />

      {/* Soft Delete Confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Soft-Delete Employee ${deleteTarget?.employeeId ?? ''}?`}
        description={`This archives ${deleteTarget?.fullName ?? ''} (isDeleted = true) from active rosters while retaining historical site assignments, documents, and audit logs.`}
        confirmLabel="Confirm Soft Delete"
        variant="danger"
        loading={deleting}
        onConfirm={() => void handleConfirmSoftDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* HR Deletion Approval Request Modal */}
      {approvalDeleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  Request Employee Deletion Approval
                </h3>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  {approvalDeleteTarget.employeeId} · {approvalDeleteTarget.fullName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApprovalDeleteTarget(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#574B43]">
              Your HR profile does not hold direct <code className="font-mono-tabular">employee.delete</code>{' '}
              permission. Submitting this request sends it to the Administrator Approval Queue for
              transactional archival.
            </p>

            {approvalError && (
              <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
                {approvalError}
              </div>
            )}

            <form onSubmit={(e) => void handleSubmitDeletionApproval(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Reason for Archiving Employee <span className="text-[#B91C1C]">*</span>
                </label>
                <textarea
                  rows={3}
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  placeholder="Provide resignation, clearance, or contract completion details..."
                  className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                />
              </div>

              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setApprovalDeleteTarget(null)}
                  disabled={submittingApproval}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingApproval}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60"
                >
                  {submittingApproval ? 'Submitting...' : 'Submit for Admin Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
