import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Edit3,
  FileSpreadsheet,
  Layers,
  Moon,
  Plus,
  Printer,
  QrCode,
  Search,
  Send,
  Settings2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { RotatingShiftQrModal } from '../../components/RotatingShiftQrModal';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  listEmployeeAssignments,
  subscribeDeploymentData,
} from '../../services/firestore/assignmentService';
import {
  cancelDutyRosterEntry,
  copyPreviousDayDutyRosters,
  createDutyRosterEntries,
  listDutyRosters,
  listShiftMasters,
  publishDutyRosters,
  subscribeAttendanceData,
  updateDutyRosterEntry,
  upsertShiftMaster,
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
  ShiftMasterRecord,
  ShiftMasterStatus,
  SiteRecord,
  SiteServiceConfigRecord,
} from '../../types';
import { exportBrandedAttendancePdf } from '../../utils/attendancePdfExport';
import { computeRosterShiftMetrics } from '../../utils/attendanceValidation';
import {
  addDaysToIsoDate,
  exportTableToCsv,
  exportTableToExcelXml,
  getTodayIsoDate,
} from '../../utils/deploymentValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';

const PAGE_SIZE = 10;

type RosterLayoutView = 'table' | 'date_wise' | 'site_wise' | 'employee_wise';

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
  const [shiftMasters, setShiftMasters] = useState<ShiftMasterRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [siteConfigs, setSiteConfigs] = useState<SiteServiceConfigRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [assignments, setAssignments] = useState<EmployeeAssignmentRecord[]>([]);

  // Filters & Layout View
  const today = useMemo(() => getTodayIsoDate(), []);
  const [layoutView, setLayoutView] = useState<RosterLayoutView>('table');
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

  // Create Modal State (supports Single or Bulk Multi-Employee selection)
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
  const [bulkMode, setBulkMode] = useState<boolean>(false);
  const [formEmployeeId, setFormEmployeeId] = useState<string>('');
  const [formBulkEmployeeIds, setFormBulkEmployeeIds] = useState<string[]>([]);
  const [formDutyDate, setFormDutyDate] = useState<string>(today);
  const [formEndDate, setFormEndDate] = useState<string>(addDaysToIsoDate(today, 6));
  const [formSkipWeekdays, setFormSkipWeekdays] = useState<number[]>([]);
  const [formShiftId, setFormShiftId] = useState<string>('');
  const [formShiftType, setFormShiftType] = useState<RosterShiftType>('Day Shift');
  const [formStartTime, setFormStartTime] = useState<string>('08:00');
  const [formEndTime, setFormEndTime] = useState<string>('20:00');
  const [formReportingTime, setFormReportingTime] = useState<string>('07:45');
  const [formBreakMins, setFormBreakMins] = useState<number>(60);
  const [formGraceMins, setFormGraceMins] = useState<number>(15);
  const [formWeeklyOffDay, setFormWeeklyOffDay] = useState<string>('Sunday');
  const [formFoName, setFormFoName] = useState<string>('');
  const [formFoUid, setFormFoUid] = useState<string>('');
  const [formInstructions, setFormInstructions] = useState<string>('');
  const [formPublishNow, setFormPublishNow] = useState<boolean>(true);
  const [formCapException, setFormCapException] = useState<boolean>(false);
  const [formCapReason, setFormCapReason] = useState<string>('');

  // Edit Modal State
  const [editingRoster, setEditingRoster] = useState<DutyRosterRecord | null>(null);
  const [editShiftId, setEditShiftId] = useState<string>('');
  const [editShiftType, setEditShiftType] = useState<RosterShiftType>('Day Shift');
  const [editStartTime, setEditStartTime] = useState<string>('08:00');
  const [editEndTime, setEditEndTime] = useState<string>('20:00');
  const [editReportingTime, setEditReportingTime] = useState<string>('07:45');
  const [editBreakMins, setEditBreakMins] = useState<number>(60);
  const [editGraceMins, setEditGraceMins] = useState<number>(15);
  const [editWeeklyOffDay, setEditWeeklyOffDay] = useState<string>('Rotational');
  const [editFoName, setEditFoName] = useState<string>('');
  const [editFoUid, setEditFoUid] = useState<string>('');
  const [editInstructions, setEditInstructions] = useState<string>('');
  const [editStatus, setEditStatus] = useState<DutyRosterStatus>('Draft');
  const [editReason, setEditReason] = useState<string>('');

  // Cancel Modal State
  const [cancellingRoster, setCancellingRoster] = useState<DutyRosterRecord | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');

  // Copy Previous Day Roster Modal State
  const [copyOpen, setCopyOpen] = useState<boolean>(false);
  const [copyTargetDate, setCopyTargetDate] = useState<string>(today);
  const [copyBranchId, setCopyBranchId] = useState<string>('');
  const [copySiteId, setCopySiteId] = useState<string>('');
  const [copyPublishNow, setCopyPublishNow] = useState<boolean>(true);

  // Shift Master Manager Modal State
  const [shiftModalOpen, setShiftModalOpen] = useState<boolean>(false);
  const [editingShiftId, setEditingShiftId] = useState<string>('');
  const [shfName, setShfName] = useState<string>('');
  const [shfCode, setShfCode] = useState<string>('');
  const [shfType, setShfType] = useState<RosterShiftType>('Morning Shift');
  const [shfStart, setShfStart] = useState<string>('06:00');
  const [shfEnd, setShfEnd] = useState<string>('14:00');
  const [shfReport, setShfReport] = useState<string>('05:45');
  const [shfGrace, setShfGrace] = useState<number>(15);
  const [shfBreak, setShfBreak] = useState<number>(30);
  const [shfWeeklyOff, setShfWeeklyOff] = useState<string>('Rotational');
  const [shfOtEligible, setShfOtEligible] = useState<boolean>(true);
  const [shfCutoff, setShfCutoff] = useState<number>(180);
  const [shfStatus, setShfStatus] = useState<ShiftMasterStatus>('Active');

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
        shiftList,
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
        listShiftMasters(user, isPreviewSession).catch(() => []),
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
      setShiftMasters(shiftList);
      setBranches(brList.filter((b) => !b.isDeleted && b.status === 'Active'));
      setClients(clList.filter((c) => !c.isArchived && c.clientStatus === 'Active'));
      setSites(
        stList.filter((s) => {
          if (s.isArchived || s.siteStatus !== 'Active') return false;
          if (user.role === 'field_officer') {
            return user.assignedSiteIds.includes(s.siteId);
          }
          return true;
        })
      );
      setServices(srvList.filter((s) => s.status === 'Active'));
      setDesignations(dsgList.filter((d) => d.status === 'Active'));
      setSiteConfigs(cfgList.filter((c) => c.status === 'Active'));
      setEmployees(
        empList.filter((e) => !e.isDeleted && e.isActive && e.employeeStatus === 'Active')
      );
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

  const activeShiftMasters = useMemo(
    () => shiftMasters.filter((s) => s.status === 'Active'),
    [shiftMasters]
  );

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

  const groupedByDate = useMemo(() => {
    const map = new Map<string, DutyRosterRecord[]>();
    for (const r of filteredRosters) {
      const list = map.get(r.dutyDate) ?? [];
      list.push(r);
      map.set(r.dutyDate, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredRosters]);

  const groupedBySite = useMemo(() => {
    const map = new Map<string, { siteName: string; clientName: string; items: DutyRosterRecord[] }>();
    for (const r of filteredRosters) {
      const cur = map.get(r.siteId) ?? {
        siteName: r.siteName,
        clientName: r.clientName,
        items: [],
      };
      cur.items.push(r);
      map.set(r.siteId, cur);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].siteName.localeCompare(b[1].siteName));
  }, [filteredRosters]);

  const groupedByEmployee = useMemo(() => {
    const map = new Map<
      string,
      { employeeName: string; designationName: string; items: DutyRosterRecord[] }
    >();
    for (const r of filteredRosters) {
      const cur = map.get(r.employeeId) ?? {
        employeeName: r.employeeName,
        designationName: r.designationName,
        items: [],
      };
      cur.items.push(r);
      map.set(r.employeeId, cur);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[1].employeeName.localeCompare(b[1].employeeName)
    );
  }, [filteredRosters]);

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

  // Cascading Create Form Options
  const formClients = useMemo(
    () => clients.filter((c) => !formBranchId || c.assignedBranch === formBranchId),
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

  const applyShiftSelection = (
    shiftOrId: string,
    mode: 'create' | 'edit'
  ) => {
    const matchedMaster = shiftMasters.find((s) => s.shiftId === shiftOrId);
    if (matchedMaster) {
      if (mode === 'create') {
        setFormShiftId(matchedMaster.shiftId);
        setFormShiftType(matchedMaster.shiftType);
        setFormStartTime(matchedMaster.startTime);
        setFormEndTime(matchedMaster.endTime);
        setFormReportingTime(matchedMaster.reportingTime);
        setFormBreakMins(matchedMaster.breakDurationMinutes);
        setFormGraceMins(matchedMaster.gracePeriodMinutes);
        setFormWeeklyOffDay(matchedMaster.weeklyOffDay);
      } else {
        setEditShiftId(matchedMaster.shiftId);
        setEditShiftType(matchedMaster.shiftType);
        setEditStartTime(matchedMaster.startTime);
        setEditEndTime(matchedMaster.endTime);
        setEditReportingTime(matchedMaster.reportingTime);
        setEditBreakMins(matchedMaster.breakDurationMinutes);
        setEditGraceMins(matchedMaster.gracePeriodMinutes);
        setEditWeeklyOffDay(matchedMaster.weeklyOffDay);
      }
      return;
    }

    const shift = shiftOrId as RosterShiftType;
    const preset = DUTY_ROSTER_SHIFT_PRESETS.find((p) => p.shiftType === shift);
    if (mode === 'create') {
      setFormShiftId('');
      setFormShiftType(shift);
      if (preset) {
        setFormStartTime(preset.startTime);
        setFormEndTime(preset.endTime);
        setFormReportingTime(preset.reportingTime);
        setFormBreakMins(preset.breakDurationMinutes);
        setFormGraceMins(preset.gracePeriodMinutes);
      }
    } else {
      setEditShiftId('');
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
    const defaultSrv = services.find((s) => s.serviceCategory === 'Security')?.serviceId || '';
    const defaultDesig =
      designations.find(
        (d) => d.serviceCategory === 'Security' && (!defaultSrv || d.relatedServiceId === defaultSrv)
      )?.designationId || '';
    const firstActiveShift = activeShiftMasters[0];

    setFormScheduleMode('Daily');
    setFormBranchId(defaultBranch);
    setFormClientId(defaultClient);
    setFormSiteId(defaultSite);
    setFormCategory('Security');
    setFormServiceId(defaultSrv);
    setFormDesignationId(defaultDesig);
    setBulkMode(false);
    setFormEmployeeId('');
    setFormBulkEmployeeIds([]);
    setFormDutyDate(today);
    setFormEndDate(addDaysToIsoDate(today, 6));
    setFormSkipWeekdays([]);
    if (firstActiveShift) {
      setFormShiftId(firstActiveShift.shiftId);
      setFormShiftType(firstActiveShift.shiftType);
      setFormStartTime(firstActiveShift.startTime);
      setFormEndTime(firstActiveShift.endTime);
      setFormReportingTime(firstActiveShift.reportingTime);
      setFormBreakMins(firstActiveShift.breakDurationMinutes);
      setFormGraceMins(firstActiveShift.gracePeriodMinutes);
      setFormWeeklyOffDay(firstActiveShift.weeklyOffDay);
    } else {
      setFormShiftId('');
      setFormShiftType('Day Shift');
      setFormStartTime('08:00');
      setFormEndTime('20:00');
      setFormReportingTime('07:45');
      setFormBreakMins(60);
      setFormGraceMins(15);
      setFormWeeklyOffDay('Sunday');
    }
    setFormFoName('');
    setFormFoUid('');
    setFormInstructions('');
    setFormPublishNow(canPublish);
    setFormCapException(false);
    setFormCapReason('');
    setCreateOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);

    if (bulkMode && formBulkEmployeeIds.length === 0) {
      setFormError('Select at least one assigned employee for bulk roster scheduling.');
      return;
    }

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
        employeeId: bulkMode ? formBulkEmployeeIds[0] : formEmployeeId,
        employeeIds: bulkMode ? formBulkEmployeeIds : undefined,
        dutyDate: formDutyDate,
        endDate: formScheduleMode === 'Daily' ? formDutyDate : formEndDate,
        skipWeekdays: formScheduleMode === 'Daily' ? [] : formSkipWeekdays,
        shiftId: formShiftId || undefined,
        shiftType: formShiftType,
        dutyStartTime: formStartTime,
        dutyEndTime: formEndTime,
        breakDurationMinutes: formBreakMins,
        reportingTime: formReportingTime,
        gracePeriodMinutes: formGraceMins,
        weeklyOffDay: formWeeklyOffDay,
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
          payload.publishImmediately
            ? ' and dispatched notifications to Employee Portal.'
            : ' as Draft.'
        }`,
      });
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyPreviousDaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await copyPreviousDayDutyRosters(user, isPreviewSession, {
        targetDate: copyTargetDate,
        siteId: copySiteId || undefined,
        branchId: copyBranchId || undefined,
        publishImmediately: canPublish ? copyPublishNow : false,
      });
      setCopyOpen(false);
      setBanner({
        type: res.copiedCount > 0 ? 'success' : 'error',
        text: `Copied ${res.copiedCount} shift(s) onto ${copyTargetDate}.${
          res.skippedCount > 0
            ? ` Skipped ${res.skippedCount} conflicting/on-leave entry(s): ${res.skippedReasons
                .slice(0, 2)
                .join(' | ')}`
            : ''
        }`,
      });
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const resetShiftFormForNew = () => {
    setFormError(null);
    setEditingShiftId('');
    setShfName('');
    setShfCode('');
    setShfType('Morning Shift');
    setShfStart('06:00');
    setShfEnd('14:00');
    setShfReport('05:45');
    setShfGrace(15);
    setShfBreak(30);
    setShfWeeklyOff('Rotational');
    setShfOtEligible(true);
    setShfCutoff(180);
    setShfStatus('Active');
  };

  const loadShiftIntoForm = (s: ShiftMasterRecord) => {
    setFormError(null);
    setEditingShiftId(s.shiftId);
    setShfName(s.shiftName);
    setShfCode(s.shiftCode);
    setShfType(s.shiftType);
    setShfStart(s.startTime);
    setShfEnd(s.endTime);
    setShfReport(s.reportingTime);
    setShfGrace(s.gracePeriodMinutes);
    setShfBreak(s.breakDurationMinutes);
    setShfWeeklyOff(s.weeklyOffDay);
    setShfOtEligible(s.overtimeEligible);
    setShfCutoff(s.cutoffMinutesAfterEnd);
    setShfStatus(s.status);
  };

  const handleSaveShiftMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const saved = await upsertShiftMaster(user, isPreviewSession, {
        shiftId: editingShiftId || undefined,
        shiftName: shfName,
        shiftCode: shfCode,
        shiftType: shfType,
        startTime: shfStart,
        endTime: shfEnd,
        reportingTime: shfReport,
        gracePeriodMinutes: shfGrace,
        breakDurationMinutes: shfBreak,
        weeklyOffDay: shfWeeklyOff,
        overtimeEligible: shfOtEligible,
        cutoffMinutesAfterEnd: shfCutoff,
        status: shfStatus,
      });
      resetShiftFormForNew();
      setBanner({
        type: 'success',
        text: `Shift Master "${saved.shiftName}" [${saved.shiftCode}] saved (${saved.status}).`,
      });
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickToggleShiftStatus = async (s: ShiftMasterRecord) => {
    if (!user || !canCreate) return;
    try {
      const nextStatus: ShiftMasterStatus = s.status === 'Active' ? 'Inactive' : 'Active';
      await upsertShiftMaster(user, isPreviewSession, {
        shiftId: s.shiftId,
        shiftName: s.shiftName,
        shiftCode: s.shiftCode,
        shiftType: s.shiftType,
        startTime: s.startTime,
        endTime: s.endTime,
        reportingTime: s.reportingTime,
        gracePeriodMinutes: s.gracePeriodMinutes,
        breakDurationMinutes: s.breakDurationMinutes,
        weeklyOffDay: s.weeklyOffDay,
        overtimeEligible: s.overtimeEligible,
        cutoffMinutesAfterEnd: s.cutoffMinutesAfterEnd,
        status: nextStatus,
      });
    } catch (err) {
      setFormError(formatServiceErrorMessage(err));
    }
  };

  const openEditModal = (r: DutyRosterRecord) => {
    setFormError(null);
    setEditingRoster(r);
    setEditShiftId(r.shiftId || '');
    setEditShiftType(r.shiftType);
    setEditStartTime(r.dutyStartTime);
    setEditEndTime(r.dutyEndTime);
    setEditReportingTime(r.reportingTime);
    setEditBreakMins(r.breakDurationMinutes);
    setEditGraceMins(r.gracePeriodMinutes);
    setEditWeeklyOffDay(r.weeklyOffDay || 'Rotational');
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
        shiftId: editShiftId || undefined,
        shiftType: editShiftType,
        dutyStartTime: editStartTime,
        dutyEndTime: editEndTime,
        breakDurationMinutes: editBreakMins,
        reportingTime: editReportingTime,
        gracePeriodMinutes: editGraceMins,
        weeklyOffDay: editWeeklyOffDay,
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

  const handleExportPdf = () => {
    if (!user) return;
    const { headers, rows } = buildExportData();
    exportBrandedAttendancePdf(
      {
        reportTitle: 'Duty Roster Deployment Schedule',
        subtitle: 'Multi-Site Shift Roster & Sanctioned Post Schedule',
        dateRangeLabel: `${fromDate} to ${toDate}`,
        generatedBy: `${user.fullName} (${user.role.toUpperCase()})`,
        branchOrSiteLabel: siteFilter !== 'ALL' ? siteFilter : branchFilter,
        summaryMetrics: [
          { label: 'Total Shifts', value: metrics.total },
          { label: 'Published', value: metrics.published },
          { label: 'Drafts', value: metrics.drafts },
          { label: 'Overnight (+1d)', value: metrics.overnight },
        ],
        headers,
        rows,
        filenameSlug: `rexon-duty-roster-${fromDate}-to-${toDate}`,
      },
      'print'
    );
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
            Duty Roster &amp; Shift Management
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Daily, weekly, and monthly multi-site scheduling, Shift Masters, bulk squad assignment,
            previous-day copy, and midnight-crossing conflict prevention.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              resetShiftFormForNew();
              setShiftModalOpen(true);
            }}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
          >
            <Settings2 className="w-3.5 h-3.5 text-[#5C3D2E]" />
            <span>Shift Masters ({activeShiftMasters.length})</span>
          </button>

          {canCreate && (
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setCopyTargetDate(today);
                setCopyBranchId(authorizedBranches[0]?.branchId || '');
                setCopySiteId('');
                setCopyPublishNow(canPublish);
                setCopyOpen(true);
              }}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5 text-[#5C3D2E]" />
              <span>Copy Previous Day</span>
            </button>
          )}

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
            onClick={handleExportPdf}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5 text-[#5C3D2E]" />
            <span>Print PDF</span>
          </button>

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
            <span>CSV</span>
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
            <span>Excel</span>
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

      {/* Filter Bar & Multi-Perspective Roster Workspace */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Schedule Horizon Filter */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg">
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
                  {mode === 'ALL' ? 'All Horizons' : mode}
                </button>
              ))}
            </div>

            {/* Perspective Switcher: Table | Date-wise | Site-wise | Employee-wise */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F3EDE4] border border-[#D4C7B8] rounded-lg">
              {(
                [
                  { id: 'table', label: 'Table View' },
                  { id: 'date_wise', label: 'Date-wise' },
                  { id: 'site_wise', label: 'Site-wise' },
                  { id: 'employee_wise', label: 'Employee-wise' },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setLayoutView(v.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    layoutView === v.id
                      ? 'bg-white text-[#1F1916] shadow-xs'
                      : 'text-[#574B43] hover:text-[#1F1916]'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full xl:w-72">
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
            description="Create daily, weekly, or monthly shift rosters for active assigned personnel, or copy the previous day's schedule."
            actionLabel={canCreate ? 'Create First Duty Roster' : undefined}
            onAction={canCreate ? openCreateModal : undefined}
          />
        ) : layoutView === 'date_wise' ? (
          <div className="space-y-4">
            {groupedByDate.map(([dateKey, items]) => (
              <div key={dateKey} className="border border-[#E5DDD2] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-[#FAF8F5] border-b border-[#E5DDD2] flex items-center justify-between text-xs">
                  <span className="font-mono-tabular font-semibold text-[#1F1916]">
                    Duty Date: {dateKey}
                  </span>
                  <span className="text-[#574B43] font-mono-tabular">
                    {items.length} Scheduled Shift(s)
                  </span>
                </div>
                <div className="divide-y divide-[#E5DDD2] text-xs">
                  {items.map((r) => (
                    <div
                      key={r.rosterId}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-semibold text-[#1F1916]">{r.employeeName}</span>
                        <span className="font-mono-tabular text-[#574B43]">
                          {' '}
                          ({r.employeeId}) · {r.designationName}
                        </span>
                        <div className="text-[#574B43] mt-0.5">
                          {r.siteName} · {r.shiftType} ({r.dutyStartTime}–{r.dutyEndTime}
                          {r.crossesMidnight ? ' +1d' : ''}) · {r.status}
                        </div>
                      </div>
                      {r.status !== 'Cancelled' && canEdit && (
                        <button
                          type="button"
                          onClick={() => openEditModal(r)}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] font-semibold text-[#1F1916] self-start sm:self-auto"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : layoutView === 'site_wise' ? (
          <div className="space-y-4">
            {groupedBySite.map(([siteId, group]) => (
              <div key={siteId} className="border border-[#E5DDD2] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-[#FAF8F5] border-b border-[#E5DDD2] flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-[#1F1916]">{group.siteName}</span>
                    <span className="text-[#574B43]"> · {group.clientName}</span>
                  </div>
                  <span className="font-mono-tabular text-[#5C3D2E] font-semibold">
                    {group.items.length} Shift(s)
                  </span>
                </div>
                <div className="divide-y divide-[#E5DDD2] text-xs">
                  {group.items.map((r) => (
                    <div
                      key={r.rosterId}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-mono-tabular font-semibold text-[#1F1916]">
                          {r.dutyDate}
                        </span>
                        <span> · </span>
                        <span className="font-semibold text-[#1F1916]">{r.employeeName}</span>
                        <span className="text-[#574B43]">
                          {' '}
                          ({r.designationName}) · {r.shiftType} ({r.dutyStartTime}–{r.dutyEndTime})
                        </span>
                      </div>
                      <span className="font-semibold text-[#5C3D2E]">{r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : layoutView === 'employee_wise' ? (
          <div className="space-y-4">
            {groupedByEmployee.map(([empId, group]) => {
              const distinctSites = new Set(group.items.map((i) => i.siteName)).size;
              return (
                <div key={empId} className="border border-[#E5DDD2] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#FAF8F5] border-b border-[#E5DDD2] flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-[#1F1916]">{group.employeeName}</span>
                      <span className="font-mono-tabular text-[#574B43]">
                        {' '}
                        ({empId}) · {group.designationName}
                      </span>
                    </div>
                    <span className="font-mono-tabular text-[#5C3D2E] font-semibold">
                      {group.items.length} Shift(s) · {distinctSites} Site(s)
                    </span>
                  </div>
                  <div className="divide-y divide-[#E5DDD2] text-xs">
                    {group.items.map((r) => (
                      <div
                        key={r.rosterId}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-mono-tabular font-semibold text-[#1F1916]">
                            {r.dutyDate}
                          </span>
                          <span className="text-[#574B43]">
                            {' '}
                            · {r.siteName} · {r.shiftType} ({r.dutyStartTime}–{r.dutyEndTime}
                            {r.crossesMidnight ? ' +1d' : ''})
                          </span>
                        </div>
                        <span className="font-semibold text-[#5C3D2E]">{r.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
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
                                className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
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
                                className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap"
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
                                className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
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
                                className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] whitespace-nowrap"
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

      {/* SHIFT MASTER MANAGER MODAL */}
      {shiftModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 my-8 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <div>
                <h2 className="font-display text-xl font-bold text-[#1F1916]">
                  Shift Master Definitions
                </h2>
                <p className="text-xs text-[#574B43]">
                  Configure General, Morning, Evening, Night (22:00–06:00 +1d), Day, Rotational, and
                  Custom shift timings, grace periods, breaks, and overtime rules.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShiftModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-[#7D6F65]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {formError}
              </div>
            )}

            {/* Existing Shifts Table */}
            <div className="overflow-x-auto border border-[#E5DDD2] rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF8F5] border-b border-[#E5DDD2] text-[#574B43] font-semibold">
                    <th className="py-2.5 px-3">Shift Name &amp; Code</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Timing</th>
                    <th className="py-2.5 px-3">Grace / Break</th>
                    <th className="py-2.5 px-3">OT / Off</th>
                    <th className="py-2.5 px-3">Status</th>
                    {canCreate && <th className="py-2.5 px-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2]">
                  {shiftMasters.map((s) => (
                    <tr key={s.shiftId} className="hover:bg-[#FAF8F5]">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-[#1F1916]">{s.shiftName}</div>
                        <div className="font-mono-tabular text-[#5C3D2E]">{s.shiftCode}</div>
                      </td>
                      <td className="py-2.5 px-3 text-[#574B43]">{s.shiftType}</td>
                      <td className="py-2.5 px-3 font-mono-tabular text-[#1F1916] whitespace-nowrap">
                        {s.startTime} – {s.endTime}
                        {s.crossesMidnight ? ' (+1d)' : ''}
                      </td>
                      <td className="py-2.5 px-3 font-mono-tabular text-[#574B43] whitespace-nowrap">
                        Grace {s.gracePeriodMinutes}m · Break {s.breakDurationMinutes}m
                      </td>
                      <td className="py-2.5 px-3 text-[#574B43]">
                        {s.overtimeEligible ? 'OT Eligible' : 'No OT'} · {s.weeklyOffDay}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">
                        <span
                          className={
                            s.status === 'Active' ? 'text-[#166534]' : 'text-[#7D6F65]'
                          }
                        >
                          {s.status}
                        </span>
                      </td>
                      {canCreate && (
                        <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            onClick={() => loadShiftIntoForm(s)}
                            className="min-h-[32px] px-2.5 py-1 rounded bg-[#FAF8F5] border border-[#E5DDD2] font-semibold text-[#1F1916]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleQuickToggleShiftStatus(s)}
                            className="min-h-[32px] px-2.5 py-1 rounded bg-white border border-[#D4C7B8] font-semibold text-[#5C3D2E]"
                          >
                            {s.status === 'Active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Create / Edit Shift Master Form */}
            {canCreate && (
              <form
                onSubmit={(e) => void handleSaveShiftMaster(e)}
                className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] space-y-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#1F1916]">
                    {editingShiftId ? `Update Shift (${editingShiftId})` : 'Add New Shift Master'}
                  </h3>
                  {editingShiftId && (
                    <button
                      type="button"
                      onClick={resetShiftFormForNew}
                      className="text-xs font-semibold text-[#5C3D2E] underline"
                    >
                      Switch to New Shift
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Shift Name
                    </label>
                    <input
                      type="text"
                      value={shfName}
                      onChange={(e) => setShfName(e.target.value)}
                      placeholder="e.g. Night Guard Shift"
                      maxLength={80}
                      className="w-full min-h-[40px] px-3 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Shift Code
                    </label>
                    <input
                      type="text"
                      value={shfCode}
                      onChange={(e) => setShfCode(e.target.value.toUpperCase())}
                      placeholder="e.g. NGT-8H"
                      maxLength={24}
                      className="w-full min-h-[40px] px-3 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Shift Category
                    </label>
                    <select
                      value={shfType}
                      onChange={(e) => setShfType(e.target.value as RosterShiftType)}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg"
                    >
                      {ROSTER_SHIFT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Status
                    </label>
                    <select
                      value={shfStatus}
                      onChange={(e) => setShfStatus(e.target.value as ShiftMasterStatus)}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">Start</label>
                    <input
                      type="time"
                      value={shfStart}
                      onChange={(e) => setShfStart(e.target.value)}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">End</label>
                    <input
                      type="time"
                      value={shfEnd}
                      onChange={(e) => setShfEnd(e.target.value)}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Report
                    </label>
                    <input
                      type="time"
                      value={shfReport}
                      onChange={(e) => setShfReport(e.target.value)}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Grace (m)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={shfGrace}
                      onChange={(e) => setShfGrace(Number(e.target.value))}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Break (m)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={180}
                      value={shfBreak}
                      onChange={(e) => setShfBreak(Number(e.target.value))}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Weekly Off
                    </label>
                    <input
                      type="text"
                      value={shfWeeklyOff}
                      onChange={(e) => setShfWeeklyOff(e.target.value)}
                      placeholder="Sunday / Rotational"
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="flex items-center gap-2 text-xs text-[#1F1916]">
                    <input
                      type="checkbox"
                      checked={shfOtEligible}
                      onChange={(e) => setShfOtEligible(e.target.checked)}
                      className="w-4 h-4 accent-[#5C3D2E]"
                    />
                    <span>Eligible for Overtime tracking beyond scheduled hours</span>
                  </label>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
                  >
                    {submitting
                      ? 'Saving...'
                      : editingShiftId
                        ? 'Update Shift Master'
                        : 'Create Shift Master'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* COPY PREVIOUS DAY ROSTER MODAL */}
      {copyOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <div>
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  Copy Previous Day Roster
                </h3>
                <p className="text-xs text-[#574B43]">
                  Clones active shifts from{' '}
                  <span className="font-mono-tabular font-semibold">
                    {addDaysToIsoDate(copyTargetDate, -1)}
                  </span>{' '}
                  onto{' '}
                  <span className="font-mono-tabular font-semibold">{copyTargetDate}</span> while
                  automatically skipping overlapping or approved-leave conflicts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCopyOpen(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#7D6F65]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {formError}
              </div>
            )}

            <form onSubmit={(e) => void handleCopyPreviousDaySubmit(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Target Duty Date
                </label>
                <input
                  type="date"
                  value={copyTargetDate}
                  onChange={(e) => setCopyTargetDate(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Branch Scope (Optional)
                </label>
                <select
                  value={copyBranchId}
                  onChange={(e) => {
                    setCopyBranchId(e.target.value);
                    setCopySiteId('');
                  }}
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                >
                  <option value="">All Authorized Branches</option>
                  {authorizedBranches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Specific Site (Optional)
                </label>
                <select
                  value={copySiteId}
                  onChange={(e) => setCopySiteId(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                >
                  <option value="">All Sites in Scope</option>
                  {sites
                    .filter((s) => !copyBranchId || s.branchId === copyBranchId)
                    .map((s) => (
                      <option key={s.siteId} value={s.siteId}>
                        {s.siteName}
                      </option>
                    ))}
                </select>
              </div>

              {canPublish && (
                <label className="flex items-center gap-2 text-xs font-medium text-[#1F1916]">
                  <input
                    type="checkbox"
                    checked={copyPublishNow}
                    onChange={(e) => setCopyPublishNow(e.target.checked)}
                    className="w-4 h-4 accent-[#5C3D2E]"
                  />
                  <span>Publish copied shifts immediately &amp; notify employees</span>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCopyOpen(false)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
                >
                  {submitting ? 'Copying...' : 'Copy Shifts'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE DUTY ROSTER MODAL (SINGLE OR BULK MULTI-EMPLOYEE) */}
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
                  approved leave blocks, midnight-crossing overlaps, and sanctioned post capacity.
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
                      setFormBulkEmployeeIds([]);
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
                      setFormBulkEmployeeIds([]);
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
                      setFormBulkEmployeeIds([]);
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

              {/* Service, Designation & Assigned Employee(s) */}
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
                      setFormBulkEmployeeIds([]);
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
                      setFormBulkEmployeeIds([]);
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
                      setFormBulkEmployeeIds([]);
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

              {/* Single vs Bulk Multi-Employee Selector */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-[#1F1916]">
                      Assigned Personnel (Site &amp; Designation Verified)
                    </span>
                    <div className="inline-flex p-0.5 bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg">
                      <button
                        type="button"
                        onClick={() => setBulkMode(false)}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${
                          !bulkMode ? 'bg-[#5C3D2E] text-white' : 'text-[#574B43]'
                        }`}
                      >
                        Single
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkMode(true)}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-md inline-flex items-center gap-1 ${
                          bulkMode ? 'bg-[#5C3D2E] text-white' : 'text-[#574B43]'
                        }`}
                      >
                        <Users className="w-3 h-3" />
                        <span>Bulk Multi-Assign</span>
                      </button>
                    </div>
                  </div>

                  {matchedSiteSanction && (
                    <span className="text-xs font-mono-tabular text-[#5C3D2E]">
                      Sanctioned Post Limit: {matchedSiteSanction.requiredCount}
                    </span>
                  )}
                </div>

                {!bulkMode ? (
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
                ) : eligibleEmployeesForSiteAndDesignation.length === 0 ? (
                  <div className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs text-[#574B43]">
                    No employees hold an active assignment for this Site + Designation.
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#5C3D2E]">
                        Selected: {formBulkEmployeeIds.length} /{' '}
                        {eligibleEmployeesForSiteAndDesignation.length}
                      </span>
                      <div className="space-x-2">
                        <button
                          type="button"
                          onClick={() =>
                            setFormBulkEmployeeIds(
                              eligibleEmployeesForSiteAndDesignation.map((e) => e.employeeId)
                            )
                          }
                          className="font-semibold text-[#5C3D2E] underline"
                        >
                          Select All Assigned
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormBulkEmployeeIds([])}
                          className="font-semibold text-[#574B43] underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pt-1">
                      {eligibleEmployeesForSiteAndDesignation.map((emp) => {
                        const checked = formBulkEmployeeIds.includes(emp.employeeId);
                        return (
                          <label
                            key={emp.employeeId}
                            className="flex items-center gap-2 p-2 rounded-lg bg-white border border-[#E5DDD2] text-xs cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setFormBulkEmployeeIds((prev) =>
                                  checked
                                    ? prev.filter((id) => id !== emp.employeeId)
                                    : [...prev, emp.employeeId]
                                )
                              }
                              className="w-4 h-4 accent-[#5C3D2E]"
                            />
                            <span className="font-medium text-[#1F1916]">{emp.fullName}</span>
                            <span className="font-mono-tabular text-[#7D6F65]">
                              ({emp.employeeId})
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Shift Master & Timings */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-[#E5DDD2]">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Shift Master / Preset
                  </label>
                  <select
                    value={formShiftId || formShiftType}
                    onChange={(e) => applyShiftSelection(e.target.value, 'create')}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    {activeShiftMasters.length > 0 && (
                      <optgroup label="Active Shift Masters">
                        {activeShiftMasters.map((sm) => (
                          <option key={sm.shiftId} value={sm.shiftId}>
                            {sm.shiftName} [{sm.shiftCode}] ({sm.startTime}–{sm.endTime})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Standard Shift Types">
                      {ROSTER_SHIFT_TYPES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </optgroup>
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
                  {submitting
                    ? 'Scheduling...'
                    : bulkMode
                      ? `Schedule ${formBulkEmployeeIds.length} Employee(s)`
                      : 'Save Duty Roster'}
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
                    Shift Master / Type
                  </label>
                  <select
                    value={editShiftId || editShiftType}
                    onChange={(e) => applyShiftSelection(e.target.value, 'edit')}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    {activeShiftMasters.length > 0 && (
                      <optgroup label="Active Shift Masters">
                        {activeShiftMasters.map((sm) => (
                          <option key={sm.shiftId} value={sm.shiftId}>
                            {sm.shiftName} [{sm.shiftCode}]
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Standard Shift Types">
                      {ROSTER_SHIFT_TYPES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </optgroup>
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
