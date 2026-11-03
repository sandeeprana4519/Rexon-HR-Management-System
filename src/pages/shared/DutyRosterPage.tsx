import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  FileSpreadsheet,
  Moon,
  Plus,
  QrCode,
  Search,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { RotatingShiftQrModal } from '../../components/RotatingShiftQrModal';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import { listEmployeeAssignments, subscribeDeploymentData } from '../../services/firestore/assignmentService';
import {
  cancelDutyRosterEntry,
  createDutyRosterEntries,
  listDutyRosters,
  publishDutyRosters,
  subscribeAttendanceData,
  updateDutyRosterEntry,
} from '../../services/firestore/attendanceService';
import { listEmployees, subscribeEmployeeData } from '../../services/firestore/employeeService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  listBranches,
  listClients,
  listDesignations,
  listServices,
  listSiteServiceConfigs,
  listSites,
  subscribeMasterData,
} from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  ClientRecord,
  CreateDutyRosterInput,
  DUTY_ROSTER_SHIFT_PRESETS,
  DUTY_ROSTER_STATUSES,
  DesignationRecord,
  DutyRosterRecord,
  DutyRosterStatus,
  EmployeeAssignmentRecord,
  EmployeeRecord,
  ROSTER_SCHEDULE_MODES,
  ROSTER_SHIFT_TYPES,
  RosterScheduleMode,
  RosterShiftType,
  SERVICE_CATEGORIES,
  ServiceCategory,
  ServiceRecord,
  SiteRecord,
  SiteServiceConfigRecord,
} from '../../types';
import { computeRosterShiftMetrics } from '../../utils/attendanceValidation';
import {
  addDaysToIsoDate,
  exportTableToCsv,
  exportTableToExcelXml,
  getTodayIsoDate,
} from '../../utils/deploymentValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';

const PAGE_SIZE = 10;

const WEEKDAY_OPTIONS: readonly { day: number; label: string }[] = [
  { day: 0, label: 'Sun' },
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
];

export const DutyRosterPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();

  const [loading, setLoading] = useState<boolean>(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Master & operational records
  const [rosters, setRosters] = useState<DutyRosterRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [siteConfigs, setSiteConfigs] = useState<SiteServiceConfigRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [assignments, setAssignments] = useState<EmployeeAssignmentRecord[]>([]);

  // Filters
  const today = useMemo(() => getTodayIsoDate(), []);
  const [scheduleView, setScheduleView] = useState<'ALL' | RosterScheduleMode>('ALL');
  const [fromDate, setFromDate] = useState<string>(addDaysToIsoDate(today, -7));
  const [toDate, setToDate] = useState<string>(addDaysToIsoDate(today, 30));
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [siteFilter, setSiteFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [shiftFilter, setShiftFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  // Permissions
  const canCreate = hasUserPermission(user, 'roster.create');
  const canEdit = hasUserPermission(user, 'roster.edit');
  const canPublish = hasUserPermission(user, 'roster.publish');
  const canDelete = hasUserPermission(user, 'roster.delete');
  const canApproveCapacity =
    user?.role === 'admin' || hasUserPermission(user, 'attendance.approve');
  const canManageQr =
    user?.role === 'admin' ||
    user?.role === 'field_officer' ||
    hasUserPermission(user, 'attendance.qr_manage');

  // Create Modal State
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formScheduleMode, setFormScheduleMode] = useState<RosterScheduleMode>('Daily');
  const [formBranchId, setFormBranchId] = useState<string>('');
  const [formClientId, setFormClientId] = useState<string>('');
  const [formSiteId, setFormSiteId] = useState<string>('');
  const [formCategory, setFormCategory] = useState<ServiceCategory>('Security');
  const [formServiceId, setFormServiceId] = useState<string>('');
  const [formDesignationId, setFormDesignationId] = useState<string>('');
  const [formEmployeeId, setFormEmployeeId] = useState<string>('');
  const [formDutyDate, setFormDutyDate] = useState<string>(today);
  const [formEndDate, setFormEndDate] = useState<string>(addDaysToIsoDate(today, 6));
  const [formSkipWeekdays, setFormSkipWeekdays] = useState<number[]>([]);
  const [formShiftType, setFormShiftType] = useState<RosterShiftType>('Day Shift');
  const [formStartTime, setFormStartTime] = useState<string>('08:00');
  const [formEndTime, setFormEndTime] = useState<string>('20:00');
  const [formReportingTime, setFormReportingTime] = useState<string>('07:45');
  const [formBreakMins, setFormBreakMins] = useState<number>(60);
  const [formGraceMins, setFormGraceMins] = useState<number>(15);
  const [formFoName, setFormFoName] = useState<string>('');
  const [formFoUid, setFormFoUid] = useState<string>('');
  const [formInstructions, setFormInstructions] = useState<string>('');
  const [formPublishNow, setFormPublishNow] = useState<boolean>(true);
  const [formCapException, setFormCapException] = useState<boolean>(false);
  const [formCapReason, setFormCapReason] = useState<string>('');

  // Edit Modal State
  const [editingRoster, setEditingRoster] = useState<DutyRosterRecord | null>(null);
  const [editShiftType, setEditShiftType] = useState<RosterShiftType>('Day Shift');
  const [editStartTime, setEditStartTime] = useState<string>('08:00');
  const [editEndTime, setEditEndTime] = useState<string>('20:00');
  const [editReportingTime, setEditReportingTime] = useState<string>('07:45');
  const [editBreakMins, setEditBreakMins] = useState<number>(60);
  const [editGraceMins, setEditGraceMins] = useState<number>(15);
  const [editFoName, setEditFoName] = useState<string>('');
  const [editFoUid, setEditFoUid] = useState<string>('');
  const [editInstructions, setEditInstructions] = useState<string>('');
  const [editStatus, setEditStatus] = useState<DutyRosterStatus>('Draft');
  const [editReason, setEditReason] = useState<string>('');

  // Cancel Modal State
  const [cancellingRoster, setCancellingRoster] = useState<DutyRosterRecord | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');

  // QR Modal State
  const [qrTarget, setQrTarget] = useState<{
    siteId: string;
    siteName: string;
    attendanceDate: string;
    shiftType: string;
    scheduledStartTime: string;
    scheduledEndTime: string;
  } | null>(null);

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [
        rosterList,
        brList,
        clList,
        stList,
        srvList,
        dsgList,
        cfgList,
        empList,
        asgList,
      ] = await Promise.all([
        listDutyRosters(user, isPreviewSession),
        listBranches(user, isPreviewSession).catch(() => []),
        listClients(user, isPreviewSession).catch(() => []),
        listSites(user, isPreviewSession).catch(() => []),
        listServices(user, isPreviewSession).catch(() => []),
        listDesignations(user, isPreviewSession).catch(() => []),
        listSiteServiceConfigs(user, isPreviewSession).catch(() => []),
        listEmployees(user, isPreviewSession).catch(() => []),
        listEmployeeAssignments(user, isPreviewSession).catch(() => []),
      ]);

      setRosters(rosterList);
      setBranches(brList.filter((b) => !b.isDeleted && b.status === 'Active'));
      setClients(clList.filter((c) => !c.isArchived && c.clientStatus === 'Active'));
      setSites(stList.filter((s) => !s.isArchived && s.siteStatus === 'Active'));
      setServices(srvList.filter((s) => s.status === 'Active'));
      setDesignations(dsgList.filter((d) => d.status === 'Active'));
      setSiteConfigs(cfgList.filter((c) => c.status === 'Active'));
      setEmployees(empList.filter((e) => !e.isDeleted && e.isActive && e.employeeStatus === 'Active'));
      setAssignments(
        asgList.filter(
          (a) => a.assignmentStatus === 'Active' || a.assignmentStatus === 'Upcoming'
        )
      );
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadAll();
    const u1 = subscribeAttendanceData(() => void loadAll());
    const u2 = subscribeDeploymentData(() => void loadAll());
    const u3 = subscribeEmployeeData(() => void loadAll());
    const u4 = subscribeMasterData(() => void loadAll());
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, [loadAll]);

  const authorizedBranches = useMemo(() => {
    if (user?.role === 'admin' || hasUserPermission(user, 'attendance.view_all_branch')) {
      return branches;
    }
    const allowed = getAuthorizedBranchIds(user);
    return branches.filter((b) => allowed.includes(b.branchId));
  }, [branches, user]);

  const filteredRosters = useMemo(() => {
    return rosters.filter((r) => {
      if (scheduleView !== 'ALL' && r.scheduleMode !== scheduleView) return false;
      if (fromDate && r.dutyDate < fromDate) return false;
      if (toDate && r.dutyDate > toDate) return false;
      if (branchFilter !== 'ALL' && r.branchId !== branchFilter) return false;
      if (siteFilter !== 'ALL' && r.siteId !== siteFilter) return false;
      if (categoryFilter !== 'ALL' && r.serviceCategory !== categoryFilter) return false;
      if (shiftFilter !== 'ALL' && r.shiftType !== shiftFilter) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;

      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const hay = `${r.rosterId} ${r.employeeName} ${r.employeeId} ${r.siteName} ${r.clientName} ${r.designationName} ${r.batchCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    rosters,
    scheduleView,
    fromDate,
    toDate,
    branchFilter,
    siteFilter,
    categoryFilter,
    shiftFilter,
    statusFilter,
    searchQuery,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    scheduleView,
    fromDate,
    toDate,
    branchFilter,
    siteFilter,
    categoryFilter,
    shiftFilter,
    statusFilter,
    searchQuery,
  ]);

  const paginatedRosters = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRosters.slice(start, start + PAGE_SIZE);
  }, [filteredRosters, page]);

  const metrics = useMemo(() => {
    const published = filteredRosters.filter((r) => r.status === 'Published').length;
    const drafts = filteredRosters.filter((r) => r.status === 'Draft').length;
    const overnight = filteredRosters.filter(
      (r) => r.status !== 'Cancelled' && r.crossesMidnight
    ).length;
    return {
      total: filteredRosters.length,
      published,
      drafts,
      overnight,
    };
  }, [filteredRosters]);

  //Cascading Create Form Options
  const formClients = useMemo(
    () =>
      clients.filter((c) => !formBranchId || c.assignedBranch === formBranchId),
    [clients, formBranchId]
  );

  const formSites = useMemo(
    () =>
      sites.filter(
        (s) =>
          (!formBranchId || s.branchId === formBranchId) &&
          (!formClientId || s.clientId === formClientId)
      ),
    [sites, formBranchId, formClientId]
  );

  const formServices = useMemo(
    () => services.filter((s) => s.serviceCategory === formCategory),
    [services, formCategory]
  );

  const formDesignations = useMemo(
    () =>
      designations.filter(
        (d) =>
          d.serviceCategory === formCategory &&
          (!formServiceId || d.relatedServiceId === formServiceId)
      ),
    [designations, formCategory, formServiceId]
  );

  const matchedSiteSanction = useMemo(() => {
    if (!formSiteId || !formDesignationId) return null;
    return (
      siteConfigs.find(
        (c) => c.siteId === formSiteId && c.designationId === formDesignationId
      ) ?? null
    );
  }, [siteConfigs, formSiteId, formDesignationId]);

  const eligibleEmployeesForSiteAndDesignation = useMemo(() => {
    if (!formSiteId || !formDesignationId) return [];
    const assignedEmpIds = new Set(
      assignments
        .filter((a) => a.siteId === formSiteId && a.designationId === formDesignationId)
        .map((a) => a.employeeId)
    );
    return employees.filter((e) => assignedEmpIds.has(e.employeeId));
  }, [employees, assignments, formSiteId, formDesignationId]);

  const computedPreview = useMemo(() => {
    return computeRosterShiftMetrics(
      formDutyDate || today,
      formStartTime,
      formEndTime,
      formBreakMins
    );
  }, [formDutyDate, today, formStartTime, formEndTime, formBreakMins]);

  const openCreateModal = () => {
    setFormError(null);
    const defaultBranch = authorizedBranches[0]?.branchId || '';
    const defaultClient =
      clients.find((c) => !defaultBranch || c.assignedBranch === defaultBranch)?.clientId || '';
    const defaultSite =
      sites.find(
        (s) =>
          (!defaultBranch || s.branchId === defaultBranch) &&
          (!defaultClient || s.clientId === defaultClient)
      )?.siteId || '';
    const defaultSrv =
      services.find((s) => s.serviceCategory === 'Security')?.serviceId || '';
    const defaultDesig =
      designations.find(
        (d) => d.serviceCategory === 'Security' && (!defaultSrv || d.relatedServiceId === defaultSrv)
      )?.designationId || '';

    setFormScheduleMode('Daily');
    setFormBranchId(defaultBranch);
    setFormClientId(defaultClient);
    setFormSiteId(defaultSite);
    setFormCategory('Security');
    setFormServiceId(defaultSrv);
    setFormDesignationId(defaultDesig);
    setFormEmployeeId('');
    setFormDutyDate(today);
    setFormEndDate(addDaysToIsoDate(today, 6));
    setFormSkipWeekdays([]);
    setFormShiftType('Day Shift');
    setFormStartTime('08:00');
    setFormEndTime('20:00');
    setFormReportingTime('07:45');
    setFormBreakMins(60);
    setFormGraceMins(15);
    setFormFoName('');
    setFormFoUid('');
    setFormInstructions('');
    setFormPublishNow(canPublish);
    setFormCapException(false);
    setFormCapReason('');
    setCreateOpen(true);
  };

  const applyShiftPreset = (shift: RosterShiftType, mode: 'create' | 'edit') => {
    const preset = DUTY_ROSTER_SHIFT_PRESETS.find((p) => p.shiftType === shift);
    if (mode === 'create') {
      setFormShiftType(shift);
      if (preset) {
        setFormStartTime(preset.startTime);
        setFormEndTime(preset.endTime);
        setFormReportingTime(preset.reportingTime);
        setFormBreakMins(preset.breakDurationMinutes);
        setFormGraceMins(preset.gracePeriodMinutes);
      }
    } else {
      setEditShiftType(shift);
      if (preset) {
        setEditStartTime(preset.startTime);
        setEditEndTime(preset.endTime);
        setEditReportingTime(preset.reportingTime);
        setEditBreakMins(preset.breakDurationMinutes);
        setEditGraceMins(preset.gracePeriodMinutes);
      }
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const payload: CreateDutyRosterInput = {
        scheduleMode: formScheduleMode,
        branchId: formBranchId,
        clientId: formClientId,
        siteId: formSiteId,
        siteServiceId: matchedSiteSanction?.siteServiceId || '',
        serviceCategory: formCategory,
        serviceId: formServiceId,
        designationId: formDesignationId,
        employeeId: formEmployeeId,
        dutyDate: formDutyDate,
        endDate: formScheduleMode === 'Daily' ? formDutyDate : formEndDate,
        skipWeekdays: formScheduleMode === 'Daily' ? [] : formSkipWeekdays,
        shiftType: formShiftType,
        dutyStartTime: formStartTime,
        dutyEndTime: formEndTime,
        breakDurationMinutes: formBreakMins,
        reportingTime: formReportingTime,
        gracePeriodMinutes: formGraceMins,
        assignedFieldOfficerUid: formFoUid,
        assignedFieldOfficerName: formFoName,
        dutyInstructions: formInstructions,
        publishImmediately: canPublish ? formPublishNow : false,
        authorizedCapacityException: formCapException,
        capacityExceptionReason: formCapReason,
      };

      const created = await createDutyRosterEntries(user, isPreviewSession, payload);
      setCreateOpen(false);
      setBanner({
        type: 'success',
        text: `Created ${created.length} ${payload.scheduleMode.toLowerCase()} duty roster shift(s)${
          payload.publishImmediately ? ' and published notifications to employee portal.' : ' as Draft.'
        }`,
      });
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (r: DutyRosterRecord) => {
    setFormError(null);
    setEditingRoster(r);
    setEditShiftType(r.shiftType);
    setEditStartTime(r.dutyStartTime);
    setEditEndTime(r.dutyEndTime);
    setEditReportingTime(r.reportingTime);
    setEditBreakMins(r.breakDurationMinutes);
    setEditGraceMins(r.gracePeriodMinutes);
    setEditFoName(r.assignedFieldOfficerName);
    setEditFoUid(r.assignedFieldOfficerUid);
    setEditInstructions(r.dutyInstructions);
    setEditStatus(r.status);
    setEditReason('');
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editingRoster) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await updateDutyRosterEntry(user, isPreviewSession, editingRoster.rosterId, {
        shiftType: editShiftType,
        dutyStartTime: editStartTime,
        dutyEndTime: editEndTime,
        breakDurationMinutes: editBreakMins,
        reportingTime: editReportingTime,
        gracePeriodMinutes: editGraceMins,
        assignedFieldOfficerUid: editFoUid,
        assignedFieldOfficerName: editFoName,
        dutyInstructions: editInstructions,
        status: editStatus,
        editReason,
      });
      setEditingRoster(null);
      setBanner({
        type: 'success',
        text: `Duty roster ${editingRoster.rosterId} updated and logged in audit trail.`,
      });
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublishBatch = async (ids: string[]) => {
    if (!user || ids.length === 0) return;
    setBanner(null);
    try {
      const count = await publishDutyRosters(user, isPreviewSession, ids);
      setBanner({
        type: 'success',
        text: `Published ${count} draft duty roster(s) and dispatched employee duty notifications.`,
      });
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    }
  };

  const handleCancelConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !cancellingRoster) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await cancelDutyRosterEntry(
        user,
        isPreviewSession,
        cancellingRoster.rosterId,
        cancelReason
      );
      setCancellingRoster(null);
      setCancelReason('');
      setBanner({
        type: 'success',
        text: `Duty roster ${cancellingRoster.rosterId} cancelled with audit traceability.`,
      });
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const buildExportData = () => {
    const headers = [
      'Roster ID',
      'Schedule Mode',
      'Duty Date',
      'Duty End Date',
      'Crosses Midnight',
      'Shift Type',
      'Start Time',
      'End Time',
      'Reporting Time',
      'Net Hours',
      'Employee ID',
      'Employee Name',
      'Designation',
      'Service Category',
      'Site Name',
      'Client Name',
      'Branch',
      'Status',
      'Capacity Exception',
    ];
    const rows = filteredRosters.map((r) => [
      r.rosterId,
      r.scheduleMode,
      r.dutyDate,
      r.dutyEndDate,
      r.crossesMidnight ? 'Yes (+1 Day)' : 'No',
      r.shiftType,
      r.dutyStartTime,
      r.dutyEndTime,
      r.reportingTime,
      Math.round((r.netScheduledMinutes / 60) * 100) / 100,
      r.employeeId,
      r.employeeName,
      r.designationName,
      r.serviceCategory,
      r.siteName,
      r.clientName,
      r.branchName,
      r.status,
      r.authorizedCapacityException ? r.capacityExceptionReason || 'Yes' : 'No',
    ]);
    return { headers, rows };
  };

  if (!user) return null;

  const draftIdsInView = filteredRosters
    .filter((r) => r.status === 'Draft')
    .map((r) => r.rosterId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Duty Roster Management
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Daily, weekly, and monthly shift scheduling with overnight midnight-crossing support,
            conflict prevention, and sanctioned post validation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canPublish && draftIdsInView.length > 0 && (
            <button
              type="button"
              onClick={() => void handlePublishBatch(draftIdsInView)}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Publish Drafts ({draftIdsInView.length})</span>
            </button>
          )}

          <button
            type="button"
            disabled={filteredRosters.length === 0}
            onClick={() => {
              const { headers, rows } = buildExportData();
              exportTableToCsv('rexon-duty-rosters', headers, rows);
            }}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#5C3D2E]" />
            <span>Download CSV</span>
          </button>

          <button
            type="button"
            disabled={filteredRosters.length === 0}
            onClick={() => {
              const { headers, rows } = buildExportData();
              exportTableToExcelXml('rexon-duty-rosters', 'Duty Rosters', headers, rows);
            }}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#5C3D2E]" />
            <span>Export Excel</span>
          </button>

          {canCreate && (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Create Duty Roster</span>
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-center justify-between gap-4 ${
            banner.type === 'error'
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
              : 'bg-[#F3EDE4] border-[#D4C7B8] text-[#4A3023]'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Row */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Scheduled Shifts"
          value={metrics.total}
          subtext="Rosters matching active filter window"
          icon={CalendarClock}
        />
        <StatMetricCard
          label="Published Shifts"
          value={metrics.published}
          subtext="Live on Employee & Field Officer portals"
          icon={CheckCircle2}
        />
        <StatMetricCard
          label="Draft Shifts"
          value={metrics.drafts}
          subtext="Awaiting HR / Admin publish action"
          icon={Clock}
          tone={metrics.drafts > 0 ? 'attention' : 'default'}
        />
        <StatMetricCard
          label="Overnight Shifts"
          value={metrics.overnight}
          subtext="Continuous shifts crossing midnight"
          icon={Moon}
        />
      </section>

      {/* Filter Bar & Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Interactive Schedule Mode Segmented Filter */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg self-start">
            {(['ALL', ...ROSTER_SCHEDULE_MODES] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setScheduleView(mode)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  scheduleView === mode
                    ? 'bg-[#5C3D2E] text-white'
                    : 'text-[#574B43] hover:text-[#1F1916]'
                }`}
              >
                {mode === 'ALL' ? 'All Schedules' : `${mode} Rosters`}
              </button>
            ))}
          </div>

          <div className="relative w-full xl:w-80">
            <Search className="w-4 h-4 text-[#7D6F65] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search employee, site, roster ID..."
              className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-1">
          <div>
            <label className="block text-[11px] font-semibold text-[#574B43] mb-1">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#574B43] mb-1">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#574B43] mb-1">Branch</label>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
            >
              <option value="ALL">All Branches</option>
              {authorizedBranches.map((b) => (
                <option key={b.branchId} value={b.branchId}>
                  {b.branchName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#574B43] mb-1">Site</label>
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
            >
              <option value="ALL">All Sites</option>
              {sites.map((s) => (
                <option key={s.siteId} value={s.siteId}>
                  {s.siteName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#574B43] mb-1">
              Shift Type
            </label>
            <select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
            >
              <option value="ALL">All Shifts</option>
              {ROSTER_SHIFT_TYPES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#574B43] mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
            >
              <option value="ALL">All Statuses</option>
              {DUTY_ROSTER_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-[#574B43]">
            Loading duty rosters and deployment schedules...
          </div>
        ) : filteredRosters.length === 0 ? (
          <EmptyStatePanel
            icon={Calendar}
            title="No Duty Rosters Scheduled in Selected Window"
            description="Create daily, weekly, or monthly shift rosters for active assigned personnel. Overnight shifts crossing midnight are automatically linked across dates."
            actionLabel={canCreate ? 'Create First Duty Roster' : undefined}
            onAction={canCreate ? openCreateModal : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Duty Date &amp; Shift</th>
                    <th className="py-3 px-3">Personnel</th>
                    <th className="py-3 px-3">Site &amp; Service</th>
                    <th className="py-3 px-3">Timings &amp; Grace</th>
                    <th className="py-3 px-3 text-right">Net Hrs</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedRosters.map((r) => {
                    const netHrs = Math.round((r.netScheduledMinutes / 60) * 100) / 100;
                    return (
                      <tr key={r.rosterId} className="hover:bg-[#FAF8F5]">
                        <td className="py-3 px-3 align-top">
                          <div className="font-mono-tabular text-xs font-semibold text-[#1F1916] whitespace-nowrap">
                            {r.dutyDate}
                            {r.crossesMidnight ? ` -> ${r.dutyEndDate}` : ''}
                          </div>
                          <div className="text-xs text-[#574B43] mt-0.5">
                            {r.shiftType} · {r.scheduleMode}
                          </div>
                          <div className="font-mono-tabular text-[11px] text-[#7D6F65]">
                            {r.rosterId}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="font-medium text-[#1F1916]">{r.employeeName}</div>
                          <div className="text-xs text-[#574B43] font-mono-tabular">
                            {r.employeeId} · {r.designationName}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="font-medium text-[#1F1916]">{r.siteName}</div>
                          <div className="text-xs text-[#574B43]">
                            {r.clientName} · {r.serviceCategory}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top font-mono-tabular text-xs text-[#1F1916] whitespace-nowrap">
                          <div>
                            {r.dutyStartTime} – {r.dutyEndTime}
                            {r.crossesMidnight ? ' (+1d)' : ''}
                          </div>
                          <div className="text-[11px] text-[#574B43]">
                            Report {r.reportingTime} · Break {r.breakDurationMinutes}m · Grace{' '}
                            {r.gracePeriodMinutes}m
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top text-right font-mono-tabular text-xs font-semibold text-[#1F1916] whitespace-nowrap">
                          {netHrs}h
                        </td>

                        <td className="py-3 px-3 align-top text-xs whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              r.status === 'Published'
                                ? 'text-[#166534]'
                                : r.status === 'Draft'
                                  ? 'text-[#B45309]'
                                  : 'text-[#7D6F65]'
                            }`}
                          >
                            {r.status}
                          </span>
                          {r.authorizedCapacityException && (
                            <div className="text-[11px] text-[#B45309] mt-0.5">
                              Capacity Override
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {r.status === 'Draft' && canPublish && (
                              <button
                                type="button"
                                onClick={() => void handlePublishBatch([r.rosterId])}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
                              >
                                Publish
                              </button>
                            )}

                            {r.status === 'Published' && canManageQr && (
                              <button
                                type="button"
                                onClick={() =>
                                  setQrTarget({
                                    siteId: r.siteId,
                                    siteName: r.siteName,
                                    attendanceDate: r.dutyDate,
                                    shiftType: r.shiftType,
                                    scheduledStartTime: r.dutyStartTime,
                                    scheduledEndTime: r.dutyEndTime,
                                  })
                                }
                                className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap"
                                title="Generate Rotating Shift QR"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                                <span>QR</span>
                              </button>
                            )}

                            {r.status !== 'Cancelled' && canEdit && (
                              <button
                                type="button"
                                onClick={() => openEditModal(r)}
                                className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-[#5C3D2E]" />
                                <span>Edit</span>
                              </button>
                            )}

                            {r.status !== 'Cancelled' && canDelete && (
                              <button
                                type="button"
                                onClick={() => {
                                  setFormError(null);
                                  setCancelReason('');
                                  setCancellingRoster(r);
                                }}
                                className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] whitespace-nowrap"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Cancel</span>
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
              totalItems={filteredRosters.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* CREATE DUTY ROSTER MODAL */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#E5DDD2]">
              <div>
                <h2 className="font-display text-xl font-bold text-[#1F1916]">
                  Create Duty Roster Schedule
                </h2>
                <p className="text-xs text-[#574B43]">
                  Validates active employee site assignment, verified designation eligibility,
                  midnight-crossing overlaps, and sanctioned post capacity.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {formError}
              </div>
            )}

            <form onSubmit={(e) => void handleCreateSubmit(e)} className="mt-4 space-y-5" noValidate>
              {/* Schedule Mode & Date Span */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Schedule Horizon
                  </label>
                  <select
                    value={formScheduleMode}
                    onChange={(e) => {
                      const nextMode = e.target.value as RosterScheduleMode;
                      setFormScheduleMode(nextMode);
                      if (nextMode === 'Weekly') {
                        setFormEndDate(addDaysToIsoDate(formDutyDate, 6));
                      } else if (nextMode === 'Monthly') {
                        setFormEndDate(addDaysToIsoDate(formDutyDate, 29));
                      }
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    {ROSTER_SCHEDULE_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m} Roster
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    {formScheduleMode === 'Daily' ? 'Duty Date' : 'Start Date'}
                  </label>
                  <input
                    type="date"
                    value={formDutyDate}
                    onChange={(e) => setFormDutyDate(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    required
                  />
                </div>

                {formScheduleMode !== 'Daily' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={formEndDate}
                      min={formDutyDate}
                      onChange={(e) => setFormEndDate(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                )}
              </div>

              {formScheduleMode !== 'Daily' && (
                <div>
                  <span className="block text-xs font-semibold text-[#1F1916] mb-1.5">
                    Weekly Off Days to Skip During Generation
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAY_OPTIONS.map((w) => {
                      const checked = formSkipWeekdays.includes(w.day);
                      return (
                        <button
                          key={w.day}
                          type="button"
                          onClick={() =>
                            setFormSkipWeekdays((prev) =>
                              checked ? prev.filter((d) => d !== w.day) : [...prev, w.day]
                            )
                          }
                          className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold border whitespace-nowrap ${
                            checked
                              ? 'bg-[#5C3D2E] text-white border-[#5C3D2E]'
                              : 'bg-[#FAF8F5] text-[#574B43] border-[#E5DDD2]'
                          }`}
                        >
                          Skip {w.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Branch, Client, Site */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-[#E5DDD2]">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Branch</label>
                  <select
                    value={formBranchId}
                    onChange={(e) => {
                      setFormBranchId(e.target.value);
                      setFormClientId('');
                      setFormSiteId('');
                      setFormEmployeeId('');
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="">Select Branch</option>
                    {authorizedBranches.map((b) => (
                      <option key={b.branchId} value={b.branchId}>
                        {b.branchName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Client</label>
                  <select
                    value={formClientId}
                    onChange={(e) => {
                      setFormClientId(e.target.value);
                      setFormSiteId('');
                      setFormEmployeeId('');
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="">Select Client</option>
                    {formClients.map((c) => (
                      <option key={c.clientId} value={c.clientId}>
                        {c.companyName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Deployment Site
                  </label>
                  <select
                    value={formSiteId}
                    onChange={(e) => {
                      setFormSiteId(e.target.value);
                      setFormEmployeeId('');
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="">Select Site</option>
                    {formSites.map((s) => (
                      <option key={s.siteId} value={s.siteId}>
                        {s.siteName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Service, Designation & Assigned Employee */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Service Category
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => {
                      const cat = e.target.value as ServiceCategory;
                      setFormCategory(cat);
                      const nextSrv =
                        services.find((s) => s.serviceCategory === cat)?.serviceId || '';
                      setFormServiceId(nextSrv);
                      setFormDesignationId('');
                      setFormEmployeeId('');
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    {SERVICE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Service</label>
                  <select
                    value={formServiceId}
                    onChange={(e) => {
                      setFormServiceId(e.target.value);
                      setFormDesignationId('');
                      setFormEmployeeId('');
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="">Select Service</option>
                    {formServices.map((s) => (
                      <option key={s.serviceId} value={s.serviceId}>
                        {s.serviceName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Designation
                  </label>
                  <select
                    value={formDesignationId}
                    onChange={(e) => {
                      setFormDesignationId(e.target.value);
                      setFormEmployeeId('');
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="">Select Designation</option>
                    {formDesignations.map((d) => (
                      <option key={d.designationId} value={d.designationId}>
                        {d.designationName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label className="text-xs font-semibold text-[#1F1916]">
                    Assigned Active Employee (Site &amp; Designation Verified)
                  </label>
                  {matchedSiteSanction && (
                    <span className="text-xs font-mono-tabular text-[#5C3D2E]">
                      Sanctioned Post Limit: {matchedSiteSanction.requiredCount}
                    </span>
                  )}
                </div>
                <select
                  value={formEmployeeId}
                  onChange={(e) => setFormEmployeeId(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                >
                  <option value="">
                    {eligibleEmployeesForSiteAndDesignation.length === 0
                      ? 'No employees hold an active assignment for this Site + Designation'
                      : 'Select Assigned Employee'}
                  </option>
                  {eligibleEmployeesForSiteAndDesignation.map((emp) => (
                    <option key={emp.employeeId} value={emp.employeeId}>
                      {emp.fullName} ({emp.employeeId})
                    </option>
                  ))}
                </select>
              </div>

              {/* Shift & Timings */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-[#E5DDD2]">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Shift Preset
                  </label>
                  <select
                    value={formShiftType}
                    onChange={(e) => applyShiftPreset(e.target.value as RosterShiftType, 'create')}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    {ROSTER_SHIFT_TYPES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Duty Start (24h)
                  </label>
                  <input
                    type="time"
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Duty End (24h)
                  </label>
                  <input
                    type="time"
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Reporting Time
                  </label>
                  <input
                    type="time"
                    value={formReportingTime}
                    onChange={(e) => setFormReportingTime(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Break Duration (Mins)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={formBreakMins}
                    onChange={(e) => setFormBreakMins(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Late Grace (Mins)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={formGraceMins}
                    onChange={(e) => setFormGraceMins(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs text-[#4A3023] font-mono-tabular flex flex-wrap items-center justify-between gap-2">
                <span>
                  Computed Shift Duration:{' '}
                  <strong>
                    {Math.round((computedPreview.netScheduledMinutes / 60) * 100) / 100}h Net
                  </strong>{' '}
                  ({Math.round((computedPreview.grossDurationMinutes / 60) * 100) / 100}h Gross)
                </span>
                <span>
                  {computedPreview.crossesMidnight
                    ? `Overnight Shift: Ends Next Day (${computedPreview.dutyEndDate})`
                    : `Same-Day Shift (${formDutyDate})`}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Assigned Field Officer Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={formFoName}
                    onChange={(e) => setFormFoName(e.target.value)}
                    placeholder="e.g. Rajesh Verma"
                    maxLength={120}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Reporting &amp; Post Instructions
                  </label>
                  <input
                    type="text"
                    value={formInstructions}
                    onChange={(e) => setFormInstructions(e.target.value)}
                    placeholder="e.g. Main Gate Post 2 · Carry torch & radio"
                    maxLength={350}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-[#E5DDD2]">
                {canPublish && (
                  <label className="flex items-center gap-2.5 text-xs font-medium text-[#1F1916] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formPublishNow}
                      onChange={(e) => setFormPublishNow(e.target.checked)}
                      className="w-4 h-4 accent-[#5C3D2E]"
                    />
                    <span>
                      Publish roster immediately and notify employee portal (uncheck to save as
                      Draft)
                    </span>
                  </label>
                )}

                {canApproveCapacity && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2.5 text-xs font-medium text-[#1F1916] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formCapException}
                        onChange={(e) => setFormCapException(e.target.checked)}
                        className="w-4 h-4 accent-[#5C3D2E]"
                      />
                      <span>
                        Authorize Sanctioned Post Capacity Override (if scheduling extra reliever
                        above site requirement)
                      </span>
                    </label>
                    {formCapException && (
                      <input
                        type="text"
                        value={formCapReason}
                        onChange={(e) => setFormCapReason(e.target.value)}
                        placeholder="Mandatory capacity override reason (min 6 characters)..."
                        maxLength={250}
                        className="w-full min-h-[40px] px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D4C7B8] rounded-lg"
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[42px] px-5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50 whitespace-nowrap"
                >
                  {submitting ? 'Scheduling...' : 'Save Duty Roster'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT DUTY ROSTER MODAL */}
      {editingRoster && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 my-8">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <div>
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  Edit Duty Roster — {editingRoster.rosterId}
                </h3>
                <p className="text-xs text-[#574B43]">
                  {editingRoster.employeeName} · {editingRoster.siteName} · {editingRoster.dutyDate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRoster(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {formError}
              </div>
            )}

            <form onSubmit={(e) => void handleEditSubmit(e)} className="mt-4 space-y-4" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Shift Type
                  </label>
                  <select
                    value={editShiftType}
                    onChange={(e) => applyShiftPreset(e.target.value as RosterShiftType, 'edit')}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    {ROSTER_SHIFT_TYPES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as DutyRosterStatus)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="Draft">Draft</option>
                    {(canPublish || editingRoster.status === 'Published') && (
                      <option value="Published">Published</option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Report Time
                  </label>
                  <input
                    type="time"
                    value={editReportingTime}
                    onChange={(e) => setEditReportingTime(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Break (Mins)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={editBreakMins}
                    onChange={(e) => setEditBreakMins(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Late Grace (Mins)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={editGraceMins}
                    onChange={(e) => setEditGraceMins(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Duty Instructions
                </label>
                <input
                  type="text"
                  value={editInstructions}
                  onChange={(e) => setEditInstructions(e.target.value)}
                  maxLength={350}
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                />
              </div>

              {editingRoster.status === 'Published' && (
                <div>
                  <label className="block text-xs font-semibold text-[#B45309] mb-1">
                    Audit Reason for Modifying Published Roster (Mandatory)
                  </label>
                  <textarea
                    rows={2}
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="Explain why this already-published duty shift is being modified..."
                    maxLength={250}
                    className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#D4C7B8] rounded-lg"
                    required
                  />
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingRoster(null)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CANCEL DUTY ROSTER MODAL */}
      {cancellingRoster && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <h3 className="font-display text-lg font-bold text-[#1F1916]">
              Cancel Scheduled Roster — {cancellingRoster.rosterId}
            </h3>
            <p className="mt-1 text-xs text-[#574B43]">
              Cancelling {cancellingRoster.employeeName}&apos;s {cancellingRoster.shiftType} on{' '}
              {cancellingRoster.dutyDate} at {cancellingRoster.siteName}. Historical record is
              preserved in audit logs.
            </p>

            {formError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {formError}
              </div>
            )}

            <form onSubmit={(e) => void handleCancelConfirm(e)} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Cancellation Reason (Mandatory)
                </label>
                <textarea
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Enter reason for cancelling this scheduled duty shift..."
                  maxLength={250}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCancellingRoster(null)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Keep Roster
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#B91C1C] text-xs font-semibold text-white hover:bg-[#991B1B] disabled:opacity-50"
                >
                  {submitting ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ROTATING SHIFT QR MODAL */}
      {qrTarget && (
        <RotatingShiftQrModal
          open={Boolean(qrTarget)}
          onClose={() => setQrTarget(null)}
          caller={user}
          isPreviewSession={isPreviewSession}
          siteId={qrTarget.siteId}
          siteName={qrTarget.siteName}
          attendanceDate={qrTarget.attendanceDate}
          shiftType={qrTarget.shiftType}
          scheduledStartTime={qrTarget.scheduledStartTime}
          scheduledEndTime={qrTarget.scheduledEndTime}
        />
      )}
    </div>
  );
};
