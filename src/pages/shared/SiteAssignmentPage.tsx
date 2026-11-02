import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRightLeft,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  Eye,
  FileWarning,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import {
  AssignmentFormModal,
  AssignmentModalMode,
  AssignmentModalPrefill,
} from '../../components/AssignmentFormModal';
import { useAuth } from '../../hooks/useAuth';
import {
  addAssignmentRemark,
  createEmployeeAssignment,
  endOrCancelAssignment,
  listAssignmentHistory,
  loadOperationalDeploymentBundle,
  reportManpowerShortage,
  requestFieldOfficerAssignmentAction,
  reviewFieldOfficerAssignmentApproval,
  subscribeDeploymentData,
  transferEmployeeAssignment,
  updateEmployeeAssignment,
  updateManpowerShortageStatus,
} from '../../services/firestore/assignmentService';
import { subscribeEmployeeData } from '../../services/firestore/employeeService';
import {
  listApprovalRequests,
  subscribeMasterData,
} from '../../services/firestore/masterDataService';
import {
  ASSIGNMENT_STATUSES,
  ApprovalRequestRecord,
  AssignmentHistoryRecord,
  AssignmentStatus,
  BranchRecord,
  ClientRecord,
  DesignationRecord,
  EmployeeAssignmentRecord,
  EmployeeRecord,
  ManpowerShortageRecord,
  SERVICE_CATEGORIES,
  SHORTAGE_URGENCY_LEVELS,
  STANDARD_SHIFTS,
  ServiceCategory,
  ServiceRecord,
  ShortageUrgencyLevel,
  SiteRecord,
  SiteServiceConfigRecord,
} from '../../types';
import { getTodayIsoDate } from '../../utils/deploymentValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';

type PageTab = 'assignments' | 'fo_requests' | 'shortages';

const PAGE_SIZE = 10;

export const SiteAssignmentPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<PageTab>('assignments');
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Operational data bundle
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [siteConfigs, setSiteConfigs] = useState<SiteServiceConfigRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [assignments, setAssignments] = useState<EmployeeAssignmentRecord[]>([]);
  const [shortages, setShortages] = useState<ManpowerShortageRecord[]>([]);
  const [foApprovals, setFoApprovals] = useState<ApprovalRequestRecord[]>([]);

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | 'ALL'>('ALL');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState<ServiceCategory | 'ALL'>('ALL');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Assignment Modal (Create / Edit / Transfer)
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<AssignmentModalMode>('create');
  const [selectedAssignment, setSelectedAssignment] =
    useState<EmployeeAssignmentRecord | null>(null);
  const [modalPrefill, setModalPrefill] = useState<AssignmentModalPrefill | null>(null);

  // Detail & History Drawer
  const [detailAssignment, setDetailAssignment] = useState<EmployeeAssignmentRecord | null>(null);
  const [detailHistory, setDetailHistory] = useState<AssignmentHistoryRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Remark Modal
  const [remarkTarget, setRemarkTarget] = useState<EmployeeAssignmentRecord | null>(null);
  const [remarkText, setRemarkText] = useState('');
  const [savingRemark, setSavingRemark] = useState(false);

  // End / Cancel Assignment Modal
  const [terminateTarget, setTerminateTarget] = useState<{
    assignment: EmployeeAssignmentRecord;
    mode: 'Completed' | 'Cancelled';
  } | null>(null);
  const [terminateDate, setTerminateDate] = useState(getTodayIsoDate());
  const [terminateRemarks, setTerminateRemarks] = useState('');
  const [savingTerminate, setSavingTerminate] = useState(false);

  // Field Officer Replacement / Transfer Request Modal
  const [foRequestTarget, setFoRequestTarget] = useState<{
    assignment: EmployeeAssignmentRecord;
    kind: 'Replacement' | 'Transfer';
  } | null>(null);
  const [foEffectiveDate, setFoEffectiveDate] = useState(getTodayIsoDate());
  const [foSuggestedEmployeeId, setFoSuggestedEmployeeId] = useState('');
  const [foSuggestedSiteName, setFoSuggestedSiteName] = useState('');
  const [foReason, setFoReason] = useState('');
  const [savingFoRequest, setSavingFoRequest] = useState(false);

  // HR/Admin Approval Review Modal
  const [reviewTarget, setReviewTarget] = useState<{
    approval: ApprovalRequestRecord;
    decision: 'Approved' | 'Rejected';
  } | null>(null);
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [savingReview, setSavingReview] = useState(false);

  // Report Manpower Shortage Modal
  const [shortageModalOpen, setShortageModalOpen] = useState(false);
  const [shSiteId, setShSiteId] = useState('');
  const [shCategory, setShCategory] = useState<ServiceCategory>('Security');
  const [shServiceId, setShServiceId] = useState('');
  const [shDesignationId, setShDesignationId] = useState('');
  const [shShift, setShShift] = useState(STANDARD_SHIFTS[3].label);
  const [shCount, setShCount] = useState(1);
  const [shUrgency, setShUrgency] = useState<ShortageUrgencyLevel>('High');
  const [shDate, setShDate] = useState(getTodayIsoDate());
  const [shReason, setShReason] = useState('');
  const [shEscalate, setShEscalate] = useState(false);
  const [savingShortage, setSavingShortage] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [bundle, approvals] = await Promise.all([
        loadOperationalDeploymentBundle(user, isPreviewSession),
        listApprovalRequests(user, isPreviewSession),
      ]);
      setBranches(bundle.branches);
      setClients(bundle.clients);
      setSites(bundle.sites);
      setServices(bundle.services);
      setDesignations(bundle.designations);
      setSiteConfigs(bundle.siteConfigs);
      setEmployees(bundle.employees);
      setAssignments(bundle.assignments);
      setShortages(bundle.shortages);
      setFoApprovals(approvals.filter((a) => a.module === 'Assignment'));
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load site assignment data.',
      });
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadData();
    const unsub1 = subscribeDeploymentData(() => void loadData());
    const unsub2 = subscribeEmployeeData(() => void loadData());
    const unsub3 = subscribeMasterData(() => void loadData());
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [loadData]);

  // Handle URL query prefills (?action=assign&employeeId=...&siteId=...)
  useEffect(() => {
    if (loading || !user) return;
    const action = searchParams.get('action');
    if (action === 'assign') {
      const prefill: AssignmentModalPrefill = {
        employeeId: searchParams.get('employeeId') || undefined,
        siteId: searchParams.get('siteId') || undefined,
        siteServiceId: searchParams.get('siteServiceId') || undefined,
        serviceCategory: (searchParams.get('category') as ServiceCategory) || undefined,
        serviceId: searchParams.get('serviceId') || undefined,
        designationId: searchParams.get('designationId') || undefined,
        startDate: searchParams.get('date') || undefined,
      };
      setModalMode('create');
      setSelectedAssignment(null);
      setModalPrefill(prefill);
      setModalOpen(true);
      setSearchParams({}, { replace: true });
    } else if (action === 'shortage') {
      const targetSite = searchParams.get('siteId') || '';
      const targetCat = (searchParams.get('category') as ServiceCategory) || 'Security';
      const targetSvc = searchParams.get('serviceId') || '';
      const targetDesig = searchParams.get('designationId') || '';
      setShSiteId(targetSite);
      setShCategory(targetCat);
      setShServiceId(targetSvc);
      setShDesignationId(targetDesig);
      setActiveTab('shortages');
      setShortageModalOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [loading, user, searchParams, setSearchParams]);

  const canCreateAssignment = useMemo(() => {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'field_officer') return true;
    return user.role === 'hr' && hasUserPermission(user, 'assignment.create');
  }, [user]);

  const canEditAssignment = useMemo(() => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.role === 'hr' && hasUserPermission(user, 'assignment.edit');
  }, [user]);

  const canTransferAssignment = useMemo(() => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.role === 'hr' && hasUserPermission(user, 'assignment.transfer');
  }, [user]);

  const canReviewFoQueue = useMemo(() => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return (
      user.role === 'hr' &&
      (hasUserPermission(user, 'assignment.manage') || hasUserPermission(user, 'assignment.edit'))
    );
  }, [user]);

  const filteredAssignments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assignments.filter((a) => {
      if (statusFilter !== 'ALL' && a.assignmentStatus !== statusFilter) return false;
      if (branchFilter !== 'ALL' && a.branchId !== branchFilter) return false;
      if (siteFilter !== 'ALL' && a.siteId !== siteFilter) return false;
      if (categoryFilter !== 'ALL' && a.serviceCategory !== categoryFilter) return false;
      if (dateFromFilter && (a.endDate || '9999-12-31') < dateFromFilter) return false;
      if (dateToFilter && a.startDate > dateToFilter) return false;

      if (q) {
        const hay = `${a.assignmentId} ${a.employeeName} ${a.employeeId} ${a.siteName} ${a.clientName} ${a.designationName} ${a.shift}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    assignments,
    searchQuery,
    statusFilter,
    branchFilter,
    siteFilter,
    categoryFilter,
    dateFromFilter,
    dateToFilter,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, branchFilter, siteFilter, categoryFilter, dateFromFilter, dateToFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAssignments.length / PAGE_SIZE));
  const paginatedAssignments = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredAssignments.slice(start, start + PAGE_SIZE);
  }, [filteredAssignments, currentPage]);

  const kpis = useMemo(() => {
    const active = assignments.filter((a) => a.assignmentStatus === 'Active').length;
    const upcoming = assignments.filter((a) => a.assignmentStatus === 'Upcoming').length;
    const transferred = assignments.filter((a) => a.assignmentStatus === 'Transferred').length;
    const pendingActionItems =
      foApprovals.filter((r) => r.status === 'Pending').length +
      shortages.filter((s) => s.status === 'Open').length;
    return { active, upcoming, transferred, pendingActionItems };
  }, [assignments, foApprovals, shortages]);

  const openDetailDrawer = async (asn: EmployeeAssignmentRecord) => {
    if (!user) return;
    setDetailAssignment(asn);
    setLoadingHistory(true);
    try {
      const hist = await listAssignmentHistory(user, isPreviewSession, {
        employeeId: asn.employeeId,
      });
      setDetailHistory(hist);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleOpenCreate = () => {
    setModalMode('create');
    setSelectedAssignment(null);
    setModalPrefill(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (asn: EmployeeAssignmentRecord) => {
    setModalMode('edit');
    setSelectedAssignment(asn);
    setModalPrefill(null);
    setModalOpen(true);
  };

  const handleOpenTransfer = (asn: EmployeeAssignmentRecord) => {
    setModalMode('transfer');
    setSelectedAssignment(asn);
    setModalPrefill(null);
    setModalOpen(true);
  };

  const handleSaveRemark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !remarkTarget) return;
    setSavingRemark(true);
    try {
      await addAssignmentRemark(user, isPreviewSession, remarkTarget.assignmentId, remarkText);
      setBanner({
        type: 'success',
        text: `Operational remark added to assignment ${remarkTarget.assignmentId}.`,
      });
      setRemarkTarget(null);
      setRemarkText('');
      await loadData();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save remark.',
      });
    } finally {
      setSavingRemark(false);
    }
  };

  const handleSaveTerminate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !terminateTarget) return;
    setSavingTerminate(true);
    try {
      await endOrCancelAssignment(
        user,
        isPreviewSession,
        terminateTarget.assignment.assignmentId,
        terminateTarget.mode,
        terminateRemarks,
        terminateTarget.mode === 'Completed' ? terminateDate : undefined
      );
      setBanner({
        type: 'success',
        text: `Assignment ${terminateTarget.assignment.assignmentId} marked as ${terminateTarget.mode}. Historical record preserved.`,
      });
      setTerminateTarget(null);
      setTerminateRemarks('');
      await loadData();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to update assignment status.',
      });
    } finally {
      setSavingTerminate(false);
    }
  };

  const handleSubmitFoRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !foRequestTarget) return;
    setSavingFoRequest(true);
    try {
      const apr = await requestFieldOfficerAssignmentAction(user, isPreviewSession, {
        assignmentId: foRequestTarget.assignment.assignmentId,
        actionKind: foRequestTarget.kind,
        effectiveDate: foEffectiveDate,
        proposedReplacementEmployeeId: foSuggestedEmployeeId || undefined,
        proposedTargetSiteName: foSuggestedSiteName || undefined,
        reason: foReason,
      });
      setBanner({
        type: 'success',
        text: `${foRequestTarget.kind} request ${apr.approvalId} submitted to HR / Admin for review.`,
      });
      setFoRequestTarget(null);
      setFoReason('');
      setFoSuggestedEmployeeId('');
      setFoSuggestedSiteName('');
      await loadData();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to submit request.',
      });
    } finally {
      setSavingFoRequest(false);
    }
  };

  const handleConfirmReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !reviewTarget) return;
    setSavingReview(true);
    try {
      await reviewFieldOfficerAssignmentApproval(
        user,
        isPreviewSession,
        reviewTarget.approval,
        reviewTarget.decision,
        reviewRemarks
      );
      setBanner({
        type: 'success',
        text: `Request ${reviewTarget.approval.approvalId} ${reviewTarget.decision.toLowerCase()}.`,
      });
      setReviewTarget(null);
      setReviewRemarks('');
      await loadData();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save review decision.',
      });
    } finally {
      setSavingReview(false);
    }
  };

  const handleOpenShortageModal = () => {
    const firstSite = sites.find((s) => !s.isArchived && s.siteStatus === 'Active');
    const firstSvc = services.find((sv) => sv.status === 'Active' && sv.serviceCategory === 'Security');
    const firstDesig = designations.find(
      (d) =>
        d.status === 'Active' &&
        d.serviceCategory === 'Security' &&
        (!firstSvc || d.relatedServiceId === firstSvc.serviceId)
    );
    setShSiteId(firstSite?.siteId || '');
    setShCategory('Security');
    setShServiceId(firstSvc?.serviceId || '');
    setShDesignationId(firstDesig?.designationId || '');
    setShShift(STANDARD_SHIFTS[3].label);
    setShCount(1);
    setShUrgency('High');
    setShDate(getTodayIsoDate());
    setShReason('');
    setShEscalate(false);
    setShortageModalOpen(true);
  };

  const handleSubmitShortage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSavingShortage(true);
    try {
      const rec = await reportManpowerShortage(user, isPreviewSession, {
        siteId: shSiteId,
        serviceCategory: shCategory,
        serviceId: shServiceId,
        designationId: shDesignationId,
        shift: shShift,
        shortageCount: shCount,
        urgency: shUrgency,
        dateReportedFor: shDate,
        reason: shReason,
        escalateToApproval: shEscalate,
      });
      setBanner({
        type: 'success',
        text: `Manpower shortage ${rec.shortageId} recorded for "${rec.siteName}".`,
      });
      setShortageModalOpen(false);
      await loadData();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to report manpower shortage.',
      });
    } finally {
      setSavingShortage(false);
    }
  };

  const renderStatusBadge = (status: AssignmentStatus) => {
    const map: Record<AssignmentStatus, string> = {
      Active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      Upcoming: 'border-sky-200 bg-sky-50 text-sky-800',
      Transferred: 'border-amber-200 bg-amber-50 text-amber-800',
      Completed: 'border-[#D8CEC2] bg-[#FAF8F5] text-[#4A3E36]',
      Cancelled: 'border-red-200 bg-red-50 text-red-800',
    };
    return (
      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${map[status]}`}>
        {status}
      </span>
    );
  };

  if (!user) return null;

  const authorizedBranches = getAuthorizedBranchIds(user);
  const visibleBranches = branches.filter(
    (b) => !b.isDeleted && (user.role === 'admin' || authorizedBranches.includes(b.branchId))
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#1F1916]">
            Site Assignments & Workforce Control
          </h1>
          <p className="text-sm text-[#6B5E55]">
            {user.role === 'field_officer'
              ? 'Deploy verified personnel to your authorized sites, add operational remarks, and submit replacement/shortage requests.'
              : 'Manage employee site deployments, future duty rosters, inter-site transfers, and Field Officer action requests.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleOpenShortageModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CEC2] bg-white px-3.5 py-2 text-xs sm:text-sm font-medium text-[#4A3E36] hover:bg-[#FAF8F5]"
          >
            <FileWarning className="h-4 w-4 text-amber-700" />
            <span>Report Shortage</span>
          </button>

          {canCreateAssignment && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5C3D2E] px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#4A3023]"
            >
              <UserPlus className="h-4 w-4" />
              <span>Assign Employee to Site</span>
            </button>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {banner && (
        <div
          className={`flex items-center justify-between gap-3 rounded-lg border p-3.5 text-sm ${
            banner.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Active Assignments</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-tabular text-[#1F1916]">
            {kpis.active}
          </p>
          <p className="mt-1 text-xs text-emerald-700">Live on-duty site deployments</p>
        </div>

        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Upcoming Assignments</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-tabular text-[#1F1916]">
            {kpis.upcoming}
          </p>
          <p className="mt-1 text-xs text-sky-700">Scheduled future duty starts</p>
        </div>

        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Inter-Site Transfers</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-tabular text-[#1F1916]">
            {kpis.transferred}
          </p>
          <p className="mt-1 text-xs text-[#6B5E55]">Historical site movements logged</p>
        </div>

        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Open Requests & Shortages</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-tabular text-[#5C3D2E]">
            {kpis.pendingActionItems}
          </p>
          <p className="mt-1 text-xs text-amber-700">FO replacement/transfer & shortages</p>
        </div>
      </div>

      {/* Operational Tabs */}
      <div className="border-b border-[#E5DDD3] flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('assignments')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'assignments'
              ? 'border-[#5C3D2E] text-[#5C3D2E]'
              : 'border-transparent text-[#6B5E55] hover:text-[#1F1916]'
          }`}
        >
          Site Assignments ({assignments.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('fo_requests')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'fo_requests'
              ? 'border-[#5C3D2E] text-[#5C3D2E]'
              : 'border-transparent text-[#6B5E55] hover:text-[#1F1916]'
          }`}
        >
          Field Officer Action Queue ({foApprovals.filter((a) => a.status === 'Pending').length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('shortages')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'shortages'
              ? 'border-[#5C3D2E] text-[#5C3D2E]'
              : 'border-transparent text-[#6B5E55] hover:text-[#1F1916]'
          }`}
        >
          Manpower Shortages ({shortages.filter((s) => s.status !== 'Resolved').length})
        </button>
      </div>

      {/* TAB 1: ASSIGNMENTS & HISTORY */}
      {activeTab === 'assignments' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="rounded-xl border border-[#E5DDD3] bg-white p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="lg:col-span-2 relative">
                <Search className="h-4 w-4 text-[#8A7B70] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ID, employee, site, client, designation..."
                  className="w-full rounded-lg border border-[#D8CEC2] bg-[#FAF8F5] pl-9 pr-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:bg-white focus:outline-none"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as AssignmentStatus | 'ALL')}
                className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
              >
                <option value="ALL">All Statuses</option>
                {ASSIGNMENT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>

              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
              >
                <option value="ALL">All Branches</option>
                {visibleBranches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.branchName}
                  </option>
                ))}
              </select>

              <select
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
              >
                <option value="ALL">All Authorized Sites</option>
                {sites
                  .filter((s) => !s.isArchived)
                  .map((s) => (
                    <option key={s.siteId} value={s.siteId}>
                      {s.siteName}
                    </option>
                  ))}
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as ServiceCategory | 'ALL')}
                className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
              >
                <option value="ALL">All Categories</option>
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[#F0EAE1]">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B5E55]">
                <Calendar className="h-3.5 w-3.5" />
                <span>Duty Date Overlap:</span>
                <input
                  type="date"
                  value={dateFromFilter}
                  onChange={(e) => setDateFromFilter(e.target.value)}
                  className="rounded border border-[#D8CEC2] px-2 py-1 font-mono-tabular text-xs text-[#1F1916]"
                />
                <span>to</span>
                <input
                  type="date"
                  value={dateToFilter}
                  onChange={(e) => setDateToFilter(e.target.value)}
                  className="rounded border border-[#D8CEC2] px-2 py-1 font-mono-tabular text-xs text-[#1F1916]"
                />
                {(dateFromFilter || dateToFilter || searchQuery || statusFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('ALL');
                      setBranchFilter('ALL');
                      setSiteFilter('ALL');
                      setCategoryFilter('ALL');
                      setDateFromFilter('');
                      setDateToFilter('');
                    }}
                    className="text-[#5C3D2E] font-semibold hover:underline ml-1"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => void loadData()}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#5C3D2E] hover:underline"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Assignments Table */}
          <div className="rounded-xl border border-[#E5DDD3] bg-white overflow-hidden">
            {loading ? (
              <div className="p-10 text-center text-sm text-[#6B5E55]">
                Loading site assignments...
              </div>
            ) : filteredAssignments.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-semibold text-[#1F1916]">
                  No site assignments match the current criteria.
                </p>
                <p className="text-xs text-[#6B5E55]">
                  Register verified employees in Employee Management and assign them to configured client sites.
                </p>
                {canCreateAssignment && (
                  <button
                    type="button"
                    onClick={handleOpenCreate}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#5C3D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4A3023]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Create First Site Assignment</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E5DDD3] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                      <th className="px-4 py-3">Assignment & Employee</th>
                      <th className="px-4 py-3">Site & Client</th>
                      <th className="px-4 py-3">Category & Designation</th>
                      <th className="px-4 py-3">Shift & Reporting</th>
                      <th className="px-4 py-3">Duty Dates</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE9E0] text-sm">
                    {paginatedAssignments.map((asn) => {
                      const isLive =
                        asn.assignmentStatus === 'Active' || asn.assignmentStatus === 'Upcoming';
                      return (
                        <tr key={asn.assignmentId} className="hover:bg-[#FAF8F5]/70">
                          <td className="px-4 py-3 align-top">
                            <div className="font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                              {asn.assignmentId}
                            </div>
                            <div className="font-semibold text-[#1F1916]">{asn.employeeName}</div>
                            <div className="text-xs font-mono-tabular text-[#6B5E55]">
                              {asn.employeeId} · {asn.branchName}
                            </div>
                          </td>

                          <td className="px-4 py-3 align-top">
                            <div className="font-semibold text-[#1F1916]">{asn.siteName}</div>
                            <div className="text-xs text-[#6B5E55]">{asn.clientName}</div>
                            {asn.previousSiteName && (
                              <div className="mt-1 text-[11px] text-amber-800">
                                From: {asn.previousSiteName}
                              </div>
                            )}
                            {asn.transferredToSiteName && (
                              <div className="mt-1 text-[11px] text-amber-800">
                                Moved to: {asn.transferredToSiteName}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3 align-top">
                            <span className="inline-block rounded bg-[#EFE9E0] px-2 py-0.5 text-[11px] font-semibold text-[#4A3023]">
                              {asn.serviceCategory}
                            </span>
                            <div className="mt-1 font-medium text-[#1F1916]">
                              {asn.designationName}
                            </div>
                            <div className="text-xs text-[#6B5E55]">{asn.serviceName}</div>
                          </td>

                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-[#1F1916]">{asn.shift}</div>
                            <div className="text-xs font-mono-tabular text-[#6B5E55]">
                              {asn.shiftStartTime}–{asn.shiftEndTime} ({asn.dutyHours}h) · Report{' '}
                              {asn.reportingTime}
                            </div>
                            <div className="text-[11px] text-[#8A7B70]">Off: {asn.weeklyOff}</div>
                          </td>

                          <td className="px-4 py-3 align-top font-mono-tabular text-xs text-[#1F1916]">
                            <div>Start: {asn.startDate}</div>
                            <div className="text-[#6B5E55]">End: {asn.endDate || 'Ongoing'}</div>
                            <div className="mt-1 text-[11px] text-[#8A7B70] font-sans">
                              By {asn.assignedBy}
                            </div>
                          </td>

                          <td className="px-4 py-3 align-top">
                            {renderStatusBadge(asn.assignmentStatus)}
                          </td>

                          <td className="px-4 py-3 align-top text-right">
                            <div className="inline-flex flex-wrap justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => void openDetailDrawer(asn)}
                                title="View Details & History"
                                className="rounded border border-[#D8CEC2] bg-white p-1.5 text-[#4A3E36] hover:bg-[#FAF8F5]"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setRemarkTarget(asn);
                                  setRemarkText('');
                                }}
                                title="Add Operational Remark"
                                className="rounded border border-[#D8CEC2] bg-white p-1.5 text-[#4A3E36] hover:bg-[#FAF8F5]"
                              >
                                <MessageSquarePlus className="h-3.5 w-3.5" />
                              </button>

                              {isLive && user.role === 'field_officer' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFoRequestTarget({ assignment: asn, kind: 'Replacement' });
                                      setFoEffectiveDate(getTodayIsoDate());
                                      setFoReason('');
                                    }}
                                    className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                                  >
                                    Req. Replace
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFoRequestTarget({ assignment: asn, kind: 'Transfer' });
                                      setFoEffectiveDate(getTodayIsoDate());
                                      setFoReason('');
                                    }}
                                    className="rounded border border-[#D8CEC2] bg-white px-2 py-1 text-xs font-semibold text-[#5C3D2E] hover:bg-[#FAF8F5]"
                                  >
                                    Req. Transfer
                                  </button>
                                </>
                              )}

                              {isLive && canEditAssignment && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(asn)}
                                  title="Modify Assignment"
                                  className="rounded border border-[#D8CEC2] bg-white p-1.5 text-[#5C3D2E] hover:bg-[#FAF8F5]"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                              )}

                              {isLive && canTransferAssignment && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenTransfer(asn)}
                                  title="Transfer Between Sites"
                                  className="rounded border border-[#D8CEC2] bg-white p-1.5 text-[#5C3D2E] hover:bg-[#FAF8F5]"
                                >
                                  <ArrowRightLeft className="h-3.5 w-3.5" />
                                </button>
                              )}

                              {isLive && canEditAssignment && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTerminateTarget({ assignment: asn, mode: 'Completed' });
                                      setTerminateDate(getTodayIsoDate());
                                      setTerminateRemarks('');
                                    }}
                                    title="End Duty (Mark Completed)"
                                    className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                                  >
                                    End
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTerminateTarget({ assignment: asn, mode: 'Cancelled' });
                                      setTerminateRemarks('');
                                    }}
                                    title="Cancel Assignment"
                                    className="rounded border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
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
            )}

            {/* Pagination Footer */}
            {filteredAssignments.length > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-[#E5DDD3] bg-[#FAF8F5] px-4 py-3 text-xs text-[#6B5E55]">
                <span>
                  Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(currentPage * PAGE_SIZE, filteredAssignments.length)} of{' '}
                  {filteredAssignments.length} assignments
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-[#D8CEC2] bg-white px-2.5 py-1 font-medium disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="font-mono-tabular">
                    Page {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded border border-[#D8CEC2] bg-white px-2.5 py-1 font-medium disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: FIELD OFFICER ACTION QUEUE */}
      {activeTab === 'fo_requests' && (
        <div className="rounded-xl border border-[#E5DDD3] bg-white overflow-hidden">
          {foApprovals.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#6B5E55]">
              No Field Officer replacement, transfer, or escalated shortage requests found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E5DDD3] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                    <th className="px-4 py-3">Request ID & Type</th>
                    <th className="px-4 py-3">Target Assignment / Site</th>
                    <th className="px-4 py-3">Operational Summary & Reason</th>
                    <th className="px-4 py-3">Requested By</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Review / Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE9E0] text-sm">
                  {foApprovals.map((req) => {
                    const linkedAsn = assignments.find((a) => a.assignmentId === req.targetRecordId);
                    return (
                      <tr key={req.approvalId} className="hover:bg-[#FAF8F5]/70">
                        <td className="px-4 py-3 align-top">
                          <div className="font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                            {req.approvalId}
                          </div>
                          <div className="font-semibold text-[#1F1916]">{req.requestType}</div>
                          <div className="text-xs font-mono-tabular text-[#8A7B70]">
                            {req.createdAt.slice(0, 10)}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-[#1F1916]">{req.targetRecordName}</div>
                          <div className="text-xs font-mono-tabular text-[#6B5E55]">
                            Ref: {req.targetRecordId}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top max-w-md">
                          <div className="text-[#1F1916]">{req.summary}</div>
                          <div className="mt-1 text-xs text-[#6B5E55]">Reason: {req.reason}</div>
                          {req.reviewRemarks && (
                            <div className="mt-1 text-xs font-medium text-[#5C3D2E]">
                              Review Note: {req.reviewRemarks}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-[#4A3E36]">
                          <div className="font-semibold">{req.requestedByName}</div>
                          <div className="capitalize">{req.requestedByRole.replace('_', ' ')}</div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${
                              req.status === 'Approved'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : req.status === 'Rejected'
                                  ? 'border-red-200 bg-red-50 text-red-800'
                                  : 'border-amber-200 bg-amber-50 text-amber-800'
                            }`}
                          >
                            {req.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1.5">
                            {req.status === 'Pending' && canReviewFoQueue && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReviewTarget({ approval: req, decision: 'Approved' });
                                    setReviewRemarks('');
                                  }}
                                  className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReviewTarget({ approval: req, decision: 'Rejected' });
                                    setReviewRemarks('');
                                  }}
                                  className="rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {linkedAsn &&
                              (linkedAsn.assignmentStatus === 'Active' ||
                                linkedAsn.assignmentStatus === 'Upcoming') &&
                              canTransferAssignment && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenTransfer(linkedAsn)}
                                  className="rounded border border-[#D8CEC2] bg-white px-2.5 py-1 text-xs font-semibold text-[#5C3D2E] hover:bg-[#FAF8F5]"
                                >
                                  Execute Transfer
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
          )}
        </div>
      )}

      {/* TAB 3: MANPOWER SHORTAGES */}
      {activeTab === 'shortages' && (
        <div className="rounded-xl border border-[#E5DDD3] bg-white overflow-hidden">
          {shortages.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-[#1F1916]">
                No manpower shortage reports logged.
              </p>
              <p className="text-xs text-[#6B5E55]">
                Field Officers and HR can log post shortages here for immediate deployment fulfillment.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E5DDD3] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                    <th className="px-4 py-3">Shortage ID & Date</th>
                    <th className="px-4 py-3">Site & Client</th>
                    <th className="px-4 py-3">Designation & Shift</th>
                    <th className="px-4 py-3">Shortage</th>
                    <th className="px-4 py-3">Reason & Reporter</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE9E0] text-sm">
                  {shortages.map((sh) => (
                    <tr key={sh.shortageId} className="hover:bg-[#FAF8F5]/70">
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                          {sh.shortageId}
                        </div>
                        <div className="text-xs font-mono-tabular text-[#6B5E55]">
                          For: {sh.dateReportedFor}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-[#1F1916]">{sh.siteName}</div>
                        <div className="text-xs text-[#6B5E55]">{sh.clientName}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-[#1F1916]">{sh.designationName}</div>
                        <div className="text-xs text-[#6B5E55]">
                          {sh.serviceCategory} · {sh.shift}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono-tabular font-bold text-red-700">
                          {sh.shortageCount} Post(s)
                        </div>
                        <span
                          className={`inline-block mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            sh.urgency === 'Critical'
                              ? 'bg-red-100 text-red-800'
                              : sh.urgency === 'High'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-[#EFE9E0] text-[#4A3E36]'
                          }`}
                        >
                          {sh.urgency}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top max-w-xs">
                        <div className="text-xs text-[#1F1916]">{sh.reason}</div>
                        <div className="mt-1 text-[11px] text-[#6B5E55]">
                          Reported by {sh.reportedByName}
                        </div>
                        {sh.resolutionRemarks && (
                          <div className="mt-1 text-[11px] font-medium text-emerald-800">
                            Resolution: {sh.resolutionRemarks}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${
                            sh.status === 'Resolved'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : sh.status === 'Acknowledged'
                                ? 'border-sky-200 bg-sky-50 text-sky-800'
                                : 'border-red-200 bg-red-50 text-red-800'
                          }`}
                        >
                          {sh.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          {sh.status !== 'Resolved' && canCreateAssignment && (
                            <button
                              type="button"
                              onClick={() => {
                                setModalMode('create');
                                setSelectedAssignment(null);
                                setModalPrefill({
                                  siteId: sh.siteId,
                                  serviceCategory: sh.serviceCategory,
                                  serviceId: sh.serviceId,
                                  designationId: sh.designationId,
                                  startDate: sh.dateReportedFor,
                                });
                                setModalOpen(true);
                              }}
                              className="rounded bg-[#5C3D2E] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#4A3023]"
                            >
                              Deploy Guard/Staff
                            </button>
                          )}
                          {sh.status === 'Open' && canEditAssignment && (
                            <button
                              type="button"
                              onClick={() =>
                                void updateManpowerShortageStatus(
                                  user,
                                  isPreviewSession,
                                  sh.shortageId,
                                  'Acknowledged',
                                  'Acknowledged by HR/Admin; sourcing replacement.'
                                ).then(loadData)
                              }
                              className="rounded border border-[#D8CEC2] bg-white px-2 py-1 text-xs font-medium text-[#4A3E36] hover:bg-[#FAF8F5]"
                            >
                              Acknowledge
                            </button>
                          )}
                          {sh.status !== 'Resolved' && canEditAssignment && (
                            <button
                              type="button"
                              onClick={() =>
                                void updateManpowerShortageStatus(
                                  user,
                                  isPreviewSession,
                                  sh.shortageId,
                                  'Resolved',
                                  'Shortage fulfilled / closed.'
                                ).then(loadData)
                              }
                              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                            >
                              Mark Resolved
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CREATE / EDIT / TRANSFER MODAL */}
      <AssignmentFormModal
        isOpen={modalOpen}
        mode={modalMode}
        caller={user}
        targetAssignment={selectedAssignment}
        prefill={modalPrefill}
        branches={branches}
        clients={clients}
        sites={sites}
        services={services}
        designations={designations}
        siteConfigs={siteConfigs}
        employees={employees}
        assignments={assignments}
        onClose={() => setModalOpen(false)}
        onSubmitCreate={async (input) => {
          const created = await createEmployeeAssignment(user, isPreviewSession, input);
          setBanner({
            type: 'success',
            text: `Assignment ${created.assignmentId} created for ${created.employeeName} at "${created.siteName}" [${created.assignmentStatus}].`,
          });
          await loadData();
        }}
        onSubmitEdit={async (id, input) => {
          const updated = await updateEmployeeAssignment(user, isPreviewSession, id, input);
          setBanner({
            type: 'success',
            text: `Assignment ${updated.assignmentId} updated successfully.`,
          });
          await loadData();
        }}
        onSubmitTransfer={async (input) => {
          const transferred = await transferEmployeeAssignment(user, isPreviewSession, input);
          setBanner({
            type: 'success',
            text: `Transferred ${transferred.employeeName} to "${transferred.siteName}" under new assignment ${transferred.assignmentId}.`,
          });
          await loadData();
        }}
      />

      {/* ASSIGNMENT DETAILS & HISTORY DRAWER */}
      {detailAssignment && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl border-l border-[#E5DDD3] flex flex-col">
            <div className="flex items-center justify-between border-b border-[#E5DDD3] bg-[#FAF8F5] px-5 py-4">
              <div>
                <span className="font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                  {detailAssignment.assignmentId}
                </span>
                <h3 className="text-base font-bold text-[#1F1916]">
                  {detailAssignment.employeeName} — {detailAssignment.siteName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailAssignment(null)}
                className="rounded-lg p-1.5 text-[#6B5E55] hover:bg-[#EFE9E0]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-5 text-sm">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#E5DDD3] bg-[#FAF8F5] p-4 text-xs">
                <div>
                  <span className="text-[#6B5E55]">Employee ID:</span>
                  <div className="font-mono-tabular font-semibold text-[#1F1916]">
                    {detailAssignment.employeeId}
                  </div>
                </div>
                <div>
                  <span className="text-[#6B5E55]">Status:</span>
                  <div className="mt-0.5">{renderStatusBadge(detailAssignment.assignmentStatus)}</div>
                </div>
                <div>
                  <span className="text-[#6B5E55]">Client & Branch:</span>
                  <div className="font-semibold text-[#1F1916]">
                    {detailAssignment.clientName} ({detailAssignment.branchName})
                  </div>
                </div>
                <div>
                  <span className="text-[#6B5E55]">Service & Designation:</span>
                  <div className="font-semibold text-[#1F1916]">
                    {detailAssignment.serviceCategory} · {detailAssignment.designationName}
                  </div>
                </div>
                <div>
                  <span className="text-[#6B5E55]">Shift & Duty Hours:</span>
                  <div className="font-mono-tabular font-semibold text-[#1F1916]">
                    {detailAssignment.shift} ({detailAssignment.dutyHours}h)
                  </div>
                </div>
                <div>
                  <span className="text-[#6B5E55]">Reporting & Weekly Off:</span>
                  <div className="font-semibold text-[#1F1916]">
                    {detailAssignment.reportingTime} · {detailAssignment.weeklyOff}
                  </div>
                </div>
                <div>
                  <span className="text-[#6B5E55]">Duty Period:</span>
                  <div className="font-mono-tabular font-semibold text-[#1F1916]">
                    {detailAssignment.startDate} to {detailAssignment.endDate}
                  </div>
                </div>
                <div>
                  <span className="text-[#6B5E55]">Assigned By:</span>
                  <div className="font-semibold text-[#1F1916]">{detailAssignment.assignedBy}</div>
                </div>
              </div>

              {(detailAssignment.previousSiteName || detailAssignment.transferredToSiteName) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950 space-y-1">
                  <div className="font-semibold uppercase tracking-wider text-amber-800">
                    Inter-Site Transfer Lineage
                  </div>
                  {detailAssignment.previousSiteName && (
                    <div>
                      Previous Site: <strong>{detailAssignment.previousSiteName}</strong>{' '}
                      {detailAssignment.previousAssignmentId &&
                        `(${detailAssignment.previousAssignmentId})`}
                    </div>
                  )}
                  {detailAssignment.transferredToSiteName && (
                    <div>
                      Transferred To: <strong>{detailAssignment.transferredToSiteName}</strong>{' '}
                      {detailAssignment.transferredToAssignmentId &&
                        `(${detailAssignment.transferredToAssignmentId})`}
                    </div>
                  )}
                </div>
              )}

              {detailAssignment.reportingInstructions && (
                <div className="rounded-lg border border-[#E5DDD3] p-3.5 text-xs">
                  <div className="font-semibold text-[#5C3D2E] mb-1">Reporting Instructions</div>
                  <p className="text-[#1F1916]">{detailAssignment.reportingInstructions}</p>
                </div>
              )}

              {detailAssignment.remarks && (
                <div className="rounded-lg border border-[#E5DDD3] p-3.5 text-xs">
                  <div className="font-semibold text-[#5C3D2E] mb-1">Operational Remarks</div>
                  <p className="text-[#1F1916]">{detailAssignment.remarks}</p>
                </div>
              )}

              {/* Chronological Employee Assignment History */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#5C3D2E] mb-2.5">
                  Employee Assignment Audit Trail ({detailHistory.length})
                </h4>
                {loadingHistory ? (
                  <p className="text-xs text-[#6B5E55]">Loading history...</p>
                ) : detailHistory.length === 0 ? (
                  <p className="text-xs text-[#6B5E55]">No history entries recorded yet.</p>
                ) : (
                  <div className="space-y-2.5">
                    {detailHistory.map((h) => (
                      <div
                        key={h.historyId}
                        className="rounded-lg border border-[#E5DDD3] bg-[#FAF8F5] p-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#1F1916]">{h.actionType}</span>
                          <span className="font-mono-tabular text-[11px] text-[#6B5E55]">
                            {h.timestamp.slice(0, 16).replace('T', ' ')}
                          </span>
                        </div>
                        <p className="mt-1 text-[#4A3E36]">{h.summary}</p>
                        <p className="mt-1 text-[11px] text-[#8A7B70]">
                          Actor: {h.actorName} ({h.actorRole})
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD REMARK MODAL */}
      {remarkTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSaveRemark}
            className="w-full max-w-md rounded-xl border border-[#E5DDD3] bg-white p-5 space-y-4 shadow-xl"
          >
            <h3 className="text-base font-bold text-[#1F1916]">
              Add Assignment Remark ({remarkTarget.assignmentId})
            </h3>
            <p className="text-xs text-[#6B5E55]">
              {remarkTarget.employeeName} at {remarkTarget.siteName}
            </p>
            <textarea
              rows={3}
              required
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
              placeholder="Enter shift observation, punctuality note, or post briefing remark..."
              className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm focus:border-[#5C3D2E] focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemarkTarget(null)}
                className="rounded-lg border border-[#D8CEC2] px-3.5 py-1.5 text-xs font-medium text-[#4A3E36]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingRemark}
                className="rounded-lg bg-[#5C3D2E] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60"
              >
                {savingRemark ? 'Saving...' : 'Save Remark'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* END OR CANCEL ASSIGNMENT MODAL */}
      {terminateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSaveTerminate}
            className="w-full max-w-md rounded-xl border border-[#E5DDD3] bg-white p-5 space-y-4 shadow-xl"
          >
            <h3 className="text-base font-bold text-[#1F1916]">
              {terminateTarget.mode === 'Completed'
                ? `End Site Assignment (${terminateTarget.assignment.assignmentId})`
                : `Cancel Site Assignment (${terminateTarget.assignment.assignmentId})`}
            </h3>
            <p className="text-xs text-[#6B5E55]">
              Historical assignment records are never deleted. Marking this duty as{' '}
              <strong>{terminateTarget.mode}</strong> releases post capacity and logs an audit entry.
            </p>
            {terminateTarget.mode === 'Completed' && (
              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Effective Last Duty Date
                </label>
                <input
                  type="date"
                  value={terminateDate}
                  onChange={(e) => setTerminateDate(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm font-mono-tabular"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                Closing / Cancellation Reason <span className="text-red-600">*</span>
              </label>
              <textarea
                rows={2}
                required
                value={terminateRemarks}
                onChange={(e) => setTerminateRemarks(e.target.value)}
                placeholder="Enter reason for audit log..."
                className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTerminateTarget(null)}
                className="rounded-lg border border-[#D8CEC2] px-3.5 py-1.5 text-xs font-medium text-[#4A3E36]"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={savingTerminate}
                className={`rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60 ${
                  terminateTarget.mode === 'Cancelled'
                    ? 'bg-red-700 hover:bg-red-800'
                    : 'bg-[#5C3D2E] hover:bg-[#4A3023]'
                }`}
              >
                {savingTerminate
                  ? 'Updating...'
                  : terminateTarget.mode === 'Completed'
                    ? 'Confirm Duty Completion'
                    : 'Confirm Cancellation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FIELD OFFICER REPLACEMENT / TRANSFER REQUEST MODAL */}
      {foRequestTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSubmitFoRequest}
            className="w-full max-w-md rounded-xl border border-[#E5DDD3] bg-white p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center gap-2 text-[#5C3D2E]">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="text-base font-bold text-[#1F1916]">
                Request Employee {foRequestTarget.kind}
              </h3>
            </div>
            <p className="text-xs text-[#6B5E55]">
              Assignment {foRequestTarget.assignment.assignmentId}:{' '}
              <strong>{foRequestTarget.assignment.employeeName}</strong> at{' '}
              {foRequestTarget.assignment.siteName}
            </p>
            <div>
              <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                Requested Effective Date <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                required
                value={foEffectiveDate}
                onChange={(e) => setFoEffectiveDate(e.target.value)}
                className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm font-mono-tabular"
              />
            </div>

            {foRequestTarget.kind === 'Replacement' ? (
              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Suggested Replacement Employee (Optional)
                </label>
                <select
                  value={foSuggestedEmployeeId}
                  onChange={(e) => setFoSuggestedEmployeeId(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
                >
                  <option value="">-- Let Branch HR Assign Reliever --</option>
                  {employees
                    .filter(
                      (e) =>
                        e.isActive &&
                        e.employeeStatus === 'Active' &&
                        e.employeeId !== foRequestTarget.assignment.employeeId
                    )
                    .map((e) => (
                      <option key={e.employeeId} value={e.employeeId}>
                        {e.fullName} ({e.employeeId})
                      </option>
                    ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Suggested Target Site (Optional)
                </label>
                <input
                  type="text"
                  value={foSuggestedSiteName}
                  onChange={(e) => setFoSuggestedSiteName(e.target.value)}
                  placeholder="e.g. Client Plant Gate-2 or Branch Pool"
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                Operational Justification <span className="text-red-600">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={foReason}
                onChange={(e) => setFoReason(e.target.value)}
                placeholder="Explain why replacement or transfer is needed..."
                className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFoRequestTarget(null)}
                className="rounded-lg border border-[#D8CEC2] px-3.5 py-1.5 text-xs font-medium text-[#4A3E36]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingFoRequest}
                className="rounded-lg bg-[#5C3D2E] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60"
              >
                {savingFoRequest ? 'Submitting...' : 'Submit to HR / Admin'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* HR / ADMIN REVIEW DECISION MODAL */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleConfirmReview}
            className="w-full max-w-md rounded-xl border border-[#E5DDD3] bg-white p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-[#5C3D2E]" />
              <h3 className="text-base font-bold text-[#1F1916]">
                {reviewTarget.decision === 'Approved' ? 'Approve' : 'Reject'}{' '}
                {reviewTarget.approval.approvalId}
              </h3>
            </div>
            <p className="text-xs text-[#6B5E55]">{reviewTarget.approval.summary}</p>
            <div>
              <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                Review Remarks <span className="text-red-600">*</span>
              </label>
              <textarea
                rows={2}
                required
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                placeholder="Record decision remarks for audit trail..."
                className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                className="rounded-lg border border-[#D8CEC2] px-3.5 py-1.5 text-xs font-medium text-[#4A3E36]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingReview}
                className={`rounded-lg px-4 py-1.5 text-xs font-semibold text-white ${
                  reviewTarget.decision === 'Approved'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-red-700 hover:bg-red-800'
                }`}
              >
                {savingReview ? 'Saving...' : `Confirm ${reviewTarget.decision}`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* REPORT MANPOWER SHORTAGE MODAL */}
      {shortageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <form
            onSubmit={handleSubmitShortage}
            className="w-full max-w-lg rounded-xl border border-[#E5DDD3] bg-white p-5 space-y-4 shadow-xl my-auto"
          >
            <div className="flex items-center justify-between border-b border-[#E5DDD3] pb-3">
              <div className="flex items-center gap-2">
                <FileWarning className="h-5 w-5 text-amber-700" />
                <h3 className="text-base font-bold text-[#1F1916]">Report Manpower Shortage</h3>
              </div>
              <button
                type="button"
                onClick={() => setShortageModalOpen(false)}
                className="text-[#6B5E55] hover:text-[#1F1916]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Client Site <span className="text-red-600">*</span>
                </label>
                <select
                  required
                  value={shSiteId}
                  onChange={(e) => setShSiteId(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
                >
                  <option value="">Select Site</option>
                  {sites
                    .filter((s) => !s.isArchived && s.siteStatus === 'Active')
                    .map((s) => (
                      <option key={s.siteId} value={s.siteId}>
                        {s.siteName} — {s.clientName}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Service Category
                </label>
                <select
                  value={shCategory}
                  onChange={(e) => {
                    const cat = e.target.value as ServiceCategory;
                    setShCategory(cat);
                    const firstSvc = services.find(
                      (s) => s.status === 'Active' && s.serviceCategory === cat
                    );
                    setShServiceId(firstSvc?.serviceId || '');
                    const firstDesig = designations.find(
                      (d) =>
                        d.status === 'Active' &&
                        d.serviceCategory === cat &&
                        (!firstSvc || d.relatedServiceId === firstSvc.serviceId)
                    );
                    setShDesignationId(firstDesig?.designationId || '');
                  }}
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
                >
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">Service</label>
                <select
                  required
                  value={shServiceId}
                  onChange={(e) => {
                    const nextSvc = e.target.value;
                    setShServiceId(nextSvc);
                    const firstDesig = designations.find(
                      (d) => d.status === 'Active' && d.relatedServiceId === nextSvc
                    );
                    if (firstDesig) setShDesignationId(firstDesig.designationId);
                  }}
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
                >
                  <option value="">Select Service</option>
                  {services
                    .filter((s) => s.status === 'Active' && s.serviceCategory === shCategory)
                    .map((s) => (
                      <option key={s.serviceId} value={s.serviceId}>
                        {s.serviceName}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">Designation</label>
                <select
                  required
                  value={shDesignationId}
                  onChange={(e) => setShDesignationId(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
                >
                  <option value="">Select Designation</option>
                  {designations
                    .filter(
                      (d) =>
                        d.status === 'Active' &&
                        d.serviceCategory === shCategory &&
                        (!shServiceId || d.relatedServiceId === shServiceId)
                    )
                    .map((d) => (
                      <option key={d.designationId} value={d.designationId}>
                        {d.designationName}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">Shift</label>
                <select
                  value={shShift}
                  onChange={(e) => setShShift(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
                >
                  {STANDARD_SHIFTS.map((s) => (
                    <option key={s.code} value={s.label}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Shortage Headcount
                </label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  required
                  value={shCount}
                  onChange={(e) => setShCount(Number(e.target.value))}
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm font-mono-tabular"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">Urgency</label>
                <select
                  value={shUrgency}
                  onChange={(e) => setShUrgency(e.target.value as ShortageUrgencyLevel)}
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
                >
                  {SHORTAGE_URGENCY_LEVELS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Date Reported For
                </label>
                <input
                  type="date"
                  required
                  value={shDate}
                  onChange={(e) => setShDate(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm font-mono-tabular"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                Shortage Reason / Post Impact <span className="text-red-600">*</span>
              </label>
              <textarea
                rows={2}
                required
                value={shReason}
                onChange={(e) => setShReason(e.target.value)}
                placeholder="e.g. Night shift guard on emergency medical leave; urgent reliever needed at Gate-2"
                className="w-full rounded-lg border border-[#D8CEC2] px-3 py-2 text-sm"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-[#4A3E36] cursor-pointer">
              <input
                type="checkbox"
                checked={shEscalate}
                onChange={(e) => setShEscalate(e.target.checked)}
                className="rounded border-[#C9BEB2] text-[#5C3D2E]"
              />
              <span>Escalate directly to HR / Admin Approval Queue</span>
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#E5DDD3]">
              <button
                type="button"
                onClick={() => setShortageModalOpen(false)}
                className="rounded-lg border border-[#D8CEC2] px-3.5 py-1.5 text-xs font-medium text-[#4A3E36]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingShortage}
                className="rounded-lg bg-[#5C3D2E] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60"
              >
                {savingShortage ? 'Submitting...' : 'Submit Shortage Report'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
