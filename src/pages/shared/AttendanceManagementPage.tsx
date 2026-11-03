import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileSpreadsheet,
  History,
  MapPin,
  MessageSquarePlus,
  Navigation,
  Plus,
  QrCode,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { RotatingShiftQrModal } from '../../components/RotatingShiftQrModal';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  addFieldOfficerAttendanceRemark,
  configureSiteGeofenceAndQr,
  listAttendanceAuditLogs,
  listAttendanceCorrectionRequests,
  listAttendanceRecords,
  recordManualHrAttendance,
  reviewAttendanceCorrectionRequest,
  reviewOvertimeByHr,
  subscribeAttendanceData,
  verifyOrUpdateAttendanceByHr,
} from '../../services/firestore/attendanceService';
import { listEmployees, subscribeEmployeeData } from '../../services/firestore/employeeService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  listBranches,
  listClients,
  listSites,
  subscribeMasterData,
} from '../../services/firestore/masterDataService';
import {
  ATTENDANCE_STATUSES,
  AttendanceAuditRecord,
  AttendanceCorrectionRequest,
  AttendanceRecord,
  AttendanceStatus,
  BranchRecord,
  ClientRecord,
  EmployeeRecord,
  ROSTER_SHIFT_TYPES,
  SERVICE_CATEGORIES,
  SiteRecord,
} from '../../types';
import {
  buildEmployeeAttendanceRollups,
  resolveSiteGeoSettings,
} from '../../utils/attendanceValidation';
import {
  addDaysToIsoDate,
  exportTableToCsv,
  exportTableToExcelXml,
  getTodayIsoDate,
} from '../../utils/deploymentValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';

type ConsoleTab = 'register' | 'corrections' | 'geofence_qr' | 'rollups' | 'audit';

const PAGE_SIZE = 10;

function formatTimeShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const AttendanceManagementPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const today = useMemo(() => getTodayIsoDate(), []);

  const [activeTab, setActiveTab] = useState<ConsoleTab>('register');
  const [loading, setLoading] = useState<boolean>(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Records
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrectionRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AttendanceAuditRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);

  // Register & Rollup Filters
  const [rangePreset, setRangePreset] = useState<'Daily' | 'Weekly' | 'Monthly' | 'Custom'>('Monthly');
  const [fromDate, setFromDate] = useState<string>(addDaysToIsoDate(today, -29));
  const [toDate, setToDate] = useState<string>(today);
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [clientFilter, setClientFilter] = useState<string>('ALL');
  const [siteFilter, setSiteFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [shiftFilter, setShiftFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  // Permissions
  const isFieldOfficer = user?.role === 'field_officer';
  const canCreateManual = hasUserPermission(user, 'attendance.create');
  const canVerifyOrEdit =
    hasUserPermission(user, 'attendance.verify') ||
    hasUserPermission(user, 'attendance.edit') ||
    hasUserPermission(user, 'attendance.approve');
  const canReviewCorrections =
    hasUserPermission(user, 'attendance.correct') ||
    hasUserPermission(user, 'attendance.approve');
  const canApproveOvertime =
    hasUserPermission(user, 'attendance.overtime_approve') ||
    hasUserPermission(user, 'attendance.approve');
  const canExport =
    user?.role === 'admin' ||
    isFieldOfficer ||
    hasUserPermission(user, 'attendance.export');
  const canEditGpsSettings =
    user?.role === 'admin' ||
    hasUserPermission(user, 'attendance.gps_settings') ||
    hasUserPermission(user, 'site.edit');
  const canManageQr =
    user?.role === 'admin' ||
    isFieldOfficer ||
    hasUserPermission(user, 'attendance.qr_manage');

  // Modals State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // 1. Manual HR Entry Modal
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [manEmployeeId, setManEmployeeId] = useState<string>('');
  const [manSiteId, setManSiteId] = useState<string>('');
  const [manDate, setManDate] = useState<string>(today);
  const [manShift, setManShift] = useState<string>('Day Shift');
  const [manSchedStart, setManSchedStart] = useState<string>('08:00');
  const [manSchedEnd, setManSchedEnd] = useState<string>('20:00');
  const [manStatus, setManStatus] = useState<AttendanceStatus>('Present');
  const [manInTime, setManInTime] = useState<string>('08:00');
  const [manOutTime, setManOutTime] = useState<string>('20:00');
  const [manOutNextDay, setManOutNextDay] = useState<boolean>(false);
  const [manRemarks, setManRemarks] = useState<string>('');

  // 2. Verify / Status Edit Modal
  const [verifyingRecord, setVerifyingRecord] = useState<AttendanceRecord | null>(null);
  const [verStatus, setVerStatus] = useState<AttendanceStatus>('Present');
  const [verRemarks, setVerRemarks] = useState<string>('');
  const [verMarkVerified, setVerMarkVerified] = useState<boolean>(true);

  // 3. Overtime Approval Modal
  const [otRecord, setOtRecord] = useState<AttendanceRecord | null>(null);
  const [otDecision, setOtDecision] = useState<'Approved' | 'Rejected'>('Approved');
  const [otApprovedMins, setOtApprovedMins] = useState<number>(60);
  const [otRemarks, setOtRemarks] = useState<string>('');

  // 4. Field Officer Remark Modal
  const [foRecord, setFoRecord] = useState<AttendanceRecord | null>(null);
  const [foRemarkText, setFoRemarkText] = useState<string>('');

  // 5. Correction Review Modal
  const [reviewingCorrection, setReviewingCorrection] =
    useState<AttendanceCorrectionRequest | null>(null);
  const [corrDecision, setCorrDecision] = useState<'Approved' | 'Rejected'>('Approved');
  const [corrRemarks, setCorrRemarks] = useState<string>('');

  // 6. Site Geofence Config Modal
  const [configuringSite, setConfiguringSite] = useState<SiteRecord | null>(null);
  const [geoLat, setGeoLat] = useState<string>('');
  const [geoLng, setGeoLng] = useState<string>('');
  const [geoRadius, setGeoRadius] = useState<number>(150);
  const [geoAccThreshold, setGeoAccThreshold] = useState<number>(100);
  const [geoMandatory, setGeoMandatory] = useState<boolean>(true);
  const [geoQrEnabled, setGeoQrEnabled] = useState<boolean>(true);

  // 7. Shift QR Launch Modal
  const [qrLaunchSite, setQrLaunchSite] = useState<SiteRecord | null>(null);
  const [qrShiftSelector, setQrShiftSelector] = useState<string>('Day Shift');
  const [qrActiveModalOpen, setQrActiveModalOpen] = useState<boolean>(false);

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [attList, corrList, logList, brList, clList, stList, empList] = await Promise.all([
        listAttendanceRecords(user, isPreviewSession),
        listAttendanceCorrectionRequests(user, isPreviewSession),
        listAttendanceAuditLogs(user, isPreviewSession),
        listBranches(user, isPreviewSession).catch(() => []),
        listClients(user, isPreviewSession).catch(() => []),
        listSites(user, isPreviewSession).catch(() => []),
        listEmployees(user, isPreviewSession).catch(() => []),
      ]);

      setRecords(attList);
      setCorrections(corrList);
      setAuditLogs(logList);
      setBranches(brList.filter((b) => !b.isDeleted));
      setClients(clList.filter((c) => !c.isArchived));
      setSites(
        stList.filter((s) => {
          if (s.isArchived) return false;
          if (user.role === 'field_officer') {
            return user.assignedSiteIds.includes(s.siteId);
          }
          return true;
        })
      );
      setEmployees(empList.filter((e) => !e.isDeleted));
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadAll();
    const u1 = subscribeAttendanceData(() => void loadAll());
    const u2 = subscribeEmployeeData(() => void loadAll());
    const u3 = subscribeMasterData(() => void loadAll());
    return () => {
      u1();
      u2();
      u3();
    };
  }, [loadAll]);

  const authorizedBranches = useMemo(() => {
    if (user?.role === 'admin' || hasUserPermission(user, 'attendance.view_all_branch')) {
      return branches;
    }
    const allowed = getAuthorizedBranchIds(user);
    return branches.filter((b) => allowed.includes(b.branchId));
  }, [branches, user]);

  const applyDatePreset = (preset: 'Daily' | 'Weekly' | 'Monthly') => {
    setRangePreset(preset);
    if (preset === 'Daily') {
      setFromDate(today);
      setToDate(today);
    } else if (preset === 'Weekly') {
      setFromDate(addDaysToIsoDate(today, -6));
      setToDate(today);
    } else {
      setFromDate(addDaysToIsoDate(today, -29));
      setToDate(today);
    }
  };

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (fromDate && r.attendanceDate < fromDate) return false;
      if (toDate && r.attendanceDate > toDate) return false;
      if (branchFilter !== 'ALL' && r.branchId !== branchFilter) return false;
      if (clientFilter !== 'ALL' && r.clientId !== clientFilter) return false;
      if (siteFilter !== 'ALL' && r.siteId !== siteFilter) return false;
      if (categoryFilter !== 'ALL' && r.serviceCategory !== categoryFilter) return false;
      if (shiftFilter !== 'ALL' && r.shiftType !== shiftFilter) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;

      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const hay = `${r.attendanceId} ${r.employeeName} ${r.employeeId} ${r.siteName} ${r.clientName} ${r.designationName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    records,
    fromDate,
    toDate,
    branchFilter,
    clientFilter,
    siteFilter,
    categoryFilter,
    shiftFilter,
    statusFilter,
    searchQuery,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    activeTab,
    fromDate,
    toDate,
    branchFilter,
    clientFilter,
    siteFilter,
    categoryFilter,
    shiftFilter,
    statusFilter,
    searchQuery,
  ]);

  const paginatedRecords = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRecords.slice(start, start + PAGE_SIZE);
  }, [filteredRecords, page]);

  const rollups = useMemo(
    () => buildEmployeeAttendanceRollups(filteredRecords),
    [filteredRecords]
  );

  const pendingCorrectionsCount = useMemo(
    () => corrections.filter((c) => c.status === 'Pending').length,
    [corrections]
  );

  const kpis = useMemo(() => {
    const presentOrLate = filteredRecords.filter(
      (r) => r.status === 'Present' || r.status === 'Late' || r.status === 'Half Day'
    ).length;
    const exceptions = filteredRecords.filter((r) => r.status === 'Exception').length;
    const pendingOt = filteredRecords.filter((r) => r.overtimeStatus === 'Pending').length;
    return {
      total: filteredRecords.length,
      presentOrLate,
      exceptions,
      pendingActions: pendingCorrectionsCount + pendingOt,
    };
  }, [filteredRecords, pendingCorrectionsCount]);

  // Handlers
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setModalError(null);
    setSubmitting(true);
    try {
      const needsTimes =
        manStatus === 'Present' || manStatus === 'Late' || manStatus === 'Half Day';
      await recordManualHrAttendance(user, isPreviewSession, {
        employeeId: manEmployeeId,
        siteId: manSiteId,
        attendanceDate: manDate,
        shiftType: manShift,
        scheduledStartTime: manSchedStart,
        scheduledEndTime: manSchedEnd,
        breakDurationMinutes: 60,
        gracePeriodMinutes: 15,
        status: manStatus,
        checkInTime24h: needsTimes ? manInTime : undefined,
        checkOutTime24h: needsTimes ? manOutTime : undefined,
        checkOutNextDay: manOutNextDay,
        hrRemarks: manRemarks,
      });
      setManualOpen(false);
      setBanner({
        type: 'success',
        text: `Recorded manual HR attendance (${manStatus}) and updated sanitized site turnout summary.`,
      });
    } catch (err) {
      setModalError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !verifyingRecord) return;
    setModalError(null);
    setSubmitting(true);
    try {
      await verifyOrUpdateAttendanceByHr(user, isPreviewSession, verifyingRecord.attendanceId, {
        status: verStatus,
        hrRemarks: verRemarks,
        markVerified: verMarkVerified,
      });
      setVerifyingRecord(null);
      setBanner({
        type: 'success',
        text: `Attendance ${verifyingRecord.attendanceId} updated (${verStatus}) and audit-logged.`,
      });
    } catch (err) {
      setModalError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOvertimeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !otRecord) return;
    setModalError(null);
    setSubmitting(true);
    try {
      await reviewOvertimeByHr(user, isPreviewSession, otRecord.attendanceId, {
        decision: otDecision,
        approvedMinutes: otApprovedMins,
        remarks: otRemarks,
      });
      setOtRecord(null);
      setBanner({
        type: 'success',
        text: `Overtime ${otDecision.toLowerCase()} for ${otRecord.employeeName} (${otRecord.attendanceDate}).`,
      });
    } catch (err) {
      setModalError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFoRemarkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !foRecord) return;
    setModalError(null);
    setSubmitting(true);
    try {
      await addFieldOfficerAttendanceRemark(
        user,
        isPreviewSession,
        foRecord.attendanceId,
        foRemarkText
      );
      setFoRecord(null);
      setFoRemarkText('');
      setBanner({
        type: 'success',
        text: `Field observation saved on attendance record ${foRecord.attendanceId}.`,
      });
    } catch (err) {
      setModalError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCorrectionReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !reviewingCorrection) return;
    setModalError(null);
    setSubmitting(true);
    try {
      await reviewAttendanceCorrectionRequest(
        user,
        isPreviewSession,
        reviewingCorrection.correctionId,
        corrDecision,
        corrRemarks
      );
      setReviewingCorrection(null);
      setBanner({
        type: 'success',
        text: `Correction request ${reviewingCorrection.correctionId} ${corrDecision.toLowerCase()} and synced to attendance register.`,
      });
    } catch (err) {
      setModalError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openGeoConfigModal = (s: SiteRecord) => {
    const resolved = resolveSiteGeoSettings(s);
    setModalError(null);
    setConfiguringSite(s);
    setGeoLat(resolved.latitude !== null ? String(resolved.latitude) : '');
    setGeoLng(resolved.longitude !== null ? String(resolved.longitude) : '');
    setGeoRadius(resolved.allowedRadiusMeters);
    setGeoAccThreshold(resolved.gpsAccuracyThresholdMeters);
    setGeoMandatory(resolved.isGpsMandatory);
    setGeoQrEnabled(resolved.isQrEnabled);
  };

  const handleCaptureBrowserGpsForSite = () => {
    if (!navigator.geolocation) {
      setModalError('Browser Geolocation API is unavailable in this environment.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLat(String(Math.round(pos.coords.latitude * 1000000) / 1000000));
        setGeoLng(String(Math.round(pos.coords.longitude * 1000000) / 1000000));
      },
      (err) => {
        setModalError(`Unable to capture current GPS coordinates: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  const handleGeoConfigSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !configuringSite) return;
    setModalError(null);
    setSubmitting(true);
    try {
      const parsedLat = geoLat.trim() === '' ? null : Number(geoLat);
      const parsedLng = geoLng.trim() === '' ? null : Number(geoLng);
      await configureSiteGeofenceAndQr(user, isPreviewSession, {
        siteId: configuringSite.siteId,
        latitude: parsedLat,
        longitude: parsedLng,
        allowedRadiusMeters: geoRadius,
        gpsAccuracyThresholdMeters: geoAccThreshold,
        isGpsMandatory: geoMandatory,
        isQrEnabled: geoQrEnabled,
      });
      setConfiguringSite(null);
      setBanner({
        type: 'success',
        text: `Updated geofence radius (${geoRadius}m) and QR configuration for ${configuringSite.siteName}.`,
      });
    } catch (err) {
      setModalError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const exportRegister = (format: 'csv' | 'excel') => {
    const headers = [
      'Attendance ID',
      'Date',
      'Employee ID',
      'Employee Name',
      'Designation',
      'Service Category',
      'Site',
      'Client',
      'Shift',
      'Check-In',
      'Check-Out',
      'Method',
      'Verification Outcome',
      'Distance (m)',
      'Net Hours',
      'Late Mins',
      'Early Out Mins',
      'Overtime Mins',
      'OT Status',
      'Status',
      'HR Verified',
    ];
    const rows = filteredRecords.map((r) => [
      r.attendanceId,
      r.attendanceDate,
      r.employeeId,
      r.employeeName,
      r.designationName,
      r.serviceCategory,
      r.siteName,
      r.clientName,
      r.shiftType,
      formatTimeShort(r.checkInAt),
      formatTimeShort(r.checkOutAt),
      r.checkInMethod || '—',
      r.verificationOutcome,
      r.checkInGeo?.distanceMeters ?? '—',
      r.totalDutyHours,
      r.lateArrivalMinutes,
      r.earlyDepartureMinutes,
      r.overtimeMinutes,
      r.overtimeStatus,
      r.status,
      r.isVerifiedByHr ? 'Yes' : 'No',
    ]);
    if (format === 'csv') {
      exportTableToCsv('rexon-attendance-register', headers, rows);
    } else {
      exportTableToExcelXml('rexon-attendance-register', 'Attendance Register', headers, rows);
    }
  };

  const exportRollups = (format: 'csv' | 'excel') => {
    const headers = [
      'Employee ID',
      'Employee Name',
      'Branch',
      'Primary Site',
      'Designation',
      'Present Days',
      'Late Days',
      'Half Days',
      'Absent Days',
      'Weekly Off',
      'Holiday',
      'Leave',
      'Exceptions',
      'Total Net Hours',
      'Approved OT Hours',
      'Pending OT Hours',
    ];
    const rows = rollups.map((r) => [
      r.employeeId,
      r.employeeName,
      r.branchId,
      r.siteName,
      r.designationName,
      r.presentDays,
      r.lateDays,
      r.halfDays,
      r.absentDays,
      r.weeklyOffDays,
      r.holidayDays,
      r.leaveDays,
      r.exceptionDays,
      r.totalNetHours,
      r.approvedOvertimeHours,
      r.pendingOvertimeHours,
    ]);
    if (format === 'csv') {
      exportTableToCsv('rexon-attendance-summary', headers, rows);
    } else {
      exportTableToExcelXml('rexon-attendance-summary', 'Attendance Summary', headers, rows);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            {isFieldOfficer
              ? 'Site Attendance & Shift QR Monitor'
              : 'Attendance & Duty Verification Console'}
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            {isFieldOfficer
              ? 'Monitor real-time guard & workforce turnout across assigned sites, generate rotating shift QR codes, and log field observations.'
              : 'Server-verified GPS geofencing, rotating shift QR logs, missing punch corrections, overtime approvals, and payroll-ready rollups.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <>
              <button
                type="button"
                disabled={filteredRecords.length === 0}
                onClick={() => exportRegister('csv')}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-[#5C3D2E]" />
                <span>Download CSV</span>
              </button>
              <button
                type="button"
                disabled={filteredRecords.length === 0}
                onClick={() => exportRegister('excel')}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#5C3D2E]" />
                <span>Export Excel</span>
              </button>
            </>
          )}

          {canCreateManual && (
            <button
              type="button"
              onClick={() => {
                setModalError(null);
                setManEmployeeId(employees[0]?.employeeId || '');
                setManSiteId(sites[0]?.siteId || '');
                setManDate(today);
                setManRemarks('');
                setManualOpen(true);
              }}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Record HR Attendance</span>
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

      {/* KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Attendance Records"
          value={kpis.total}
          subtext="Entries in selected date & branch filter"
          icon={CalendarCheck}
        />
        <StatMetricCard
          label="Present / On-Duty"
          value={kpis.presentOrLate}
          subtext="Verified Present, Late & Half-Day shifts"
          icon={CheckCircle2}
        />
        <StatMetricCard
          label="Geofence Exceptions"
          value={kpis.exceptions}
          subtext="Outside-radius / low-accuracy punches"
          icon={AlertTriangle}
          tone={kpis.exceptions > 0 ? 'attention' : 'default'}
        />
        <StatMetricCard
          label="Pending Approvals"
          value={kpis.pendingActions}
          subtext="Corrections & overtime awaiting review"
          icon={Clock}
          tone={kpis.pendingActions > 0 ? 'attention' : 'default'}
        />
      </section>

      {/* Workspace Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl">
        {(
          [
            { key: 'register', label: 'Attendance Register', icon: ClipboardCheck },
            {
              key: 'corrections',
              label: `Corrections & Missing Punches (${pendingCorrectionsCount})`,
              icon: AlertTriangle,
            },
            { key: 'geofence_qr', label: 'Site Geofence & Shift QR', icon: MapPin },
            { key: 'rollups', label: 'Weekly & Monthly Summary', icon: CalendarCheck },
            { key: 'audit', label: 'Audit Trail', icon: History },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#5C3D2E] text-white'
                  : 'text-[#574B43] hover:text-[#1F1916] hover:bg-white/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: ATTENDANCE REGISTER */}
      {activeTab === 'register' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg self-start">
              {(['Daily', 'Weekly', 'Monthly'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyDatePreset(preset)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
                    rangePreset === preset
                      ? 'bg-[#5C3D2E] text-white'
                      : 'text-[#574B43] hover:text-[#1F1916]'
                  }`}
                >
                  {preset} View
                </button>
              ))}
            </div>

            <div className="relative w-full xl:w-80">
              <Search className="w-4 h-4 text-[#7D6F65] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search employee, site, attendance ID..."
                className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#574B43] mb-1">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setRangePreset('Custom');
                  setFromDate(e.target.value);
                }}
                className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#574B43] mb-1">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setRangePreset('Custom');
                  setToDate(e.target.value);
                }}
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
                Category
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
              >
                <option value="ALL">All Categories</option>
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
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
                {ATTENDANCE_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-xs text-[#574B43]">
              Loading operational attendance register...
            </div>
          ) : filteredRecords.length === 0 ? (
            <EmptyStatePanel
              icon={CalendarCheck}
              title="No Attendance Records in Selected Filter"
              description="Employee GPS/QR check-ins and manual HR duty entries (Present, Weekly Off, Holiday, Leave) appear here immediately."
              actionLabel={canCreateManual ? 'Record HR Attendance' : undefined}
              onAction={
                canCreateManual
                  ? () => {
                      setManEmployeeId(employees[0]?.employeeId || '');
                      setManSiteId(sites[0]?.siteId || '');
                      setManualOpen(true);
                    }
                  : undefined
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                      <th className="py-3 px-3">Date &amp; Shift</th>
                      <th className="py-3 px-3">Personnel</th>
                      <th className="py-3 px-3">Site</th>
                      <th className="py-3 px-3">In / Out</th>
                      <th className="py-3 px-3">Verification</th>
                      <th className="py-3 px-3 text-right">Hours &amp; OT</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5DDD2] text-sm">
                    {paginatedRecords.map((r) => (
                      <tr key={r.attendanceId} className="hover:bg-[#FAF8F5]">
                        <td className="py-3 px-3 align-top">
                          <div className="font-mono-tabular text-xs font-semibold text-[#1F1916] whitespace-nowrap">
                            {r.attendanceDate}
                          </div>
                          <div className="text-xs text-[#574B43]">
                            {r.shiftType} ({r.scheduledStartTime}–{r.scheduledEndTime}
                            {r.crossesMidnight ? '+1d' : ''})
                          </div>
                          <div className="font-mono-tabular text-[11px] text-[#7D6F65]">
                            {r.attendanceId}
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
                          <div className="text-xs text-[#574B43]">{r.clientName}</div>
                          {r.fieldOfficerRemarks && (
                            <div className="text-[11px] text-[#5C3D2E] mt-0.5">
                              FO: {r.fieldOfficerRemarks}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top font-mono-tabular text-xs whitespace-nowrap">
                          <div>In: {formatTimeShort(r.checkInAt)}</div>
                          <div>Out: {formatTimeShort(r.checkOutAt)}</div>
                          {(r.lateArrivalMinutes > 0 || r.earlyDepartureMinutes > 0) && (
                            <div className="text-[11px] text-[#B45309]">
                              {r.lateArrivalMinutes > 0 ? `Late ${r.lateArrivalMinutes}m ` : ''}
                              {r.earlyDepartureMinutes > 0
                                ? `Early ${r.earlyDepartureMinutes}m`
                                : ''}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top text-xs">
                          <div className="font-medium text-[#1F1916]">
                            {r.checkInMethod || '—'} · {r.verificationOutcome}
                          </div>
                          {r.checkInGeo && r.checkInGeo.distanceMeters !== null && (
                            <div className="font-mono-tabular text-[11px] text-[#574B43]">
                              Dist: {r.checkInGeo.distanceMeters}m / {r.checkInGeo.allowedRadiusMeters}
                              m
                            </div>
                          )}
                          {r.exceptionReason && (
                            <div className="text-[11px] text-[#B91C1C] max-w-[180px] truncate">
                              Note: {r.exceptionReason}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top text-right font-mono-tabular text-xs whitespace-nowrap">
                          <div className="font-semibold text-[#1F1916]">{r.totalDutyHours}h</div>
                          {r.overtimeMinutes > 0 && (
                            <div
                              className={`text-[11px] ${
                                r.overtimeStatus === 'Approved'
                                  ? 'text-[#166534]'
                                  : r.overtimeStatus === 'Pending'
                                    ? 'text-[#B45309]'
                                    : 'text-[#7D6F65]'
                              }`}
                            >
                              OT {r.overtimeMinutes}m ({r.overtimeStatus})
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top text-xs whitespace-nowrap">
                          <div
                            className={`font-semibold ${
                              r.status === 'Present'
                                ? 'text-[#166534]'
                                : r.status === 'Exception' || r.status === 'Absent'
                                  ? 'text-[#B91C1C]'
                                  : 'text-[#B45309]'
                            }`}
                          >
                            {r.status}
                          </div>
                          <div className="text-[11px] text-[#7D6F65]">
                            {r.isVerifiedByHr ? 'HR Verified' : 'Unverified'}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {canVerifyOrEdit && (
                              <button
                                type="button"
                                onClick={() => {
                                  setModalError(null);
                                  setVerifyingRecord(r);
                                  setVerStatus(
                                    r.status === 'Exception' ? 'Present' : r.status
                                  );
                                  setVerRemarks(r.hrRemarks || '');
                                  setVerMarkVerified(true);
                                }}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
                              >
                                Verify
                              </button>
                            )}

                            {canApproveOvertime && r.overtimeMinutes >= 15 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setModalError(null);
                                  setOtRecord(r);
                                  setOtDecision('Approved');
                                  setOtApprovedMins(r.overtimeMinutes);
                                  setOtRemarks('');
                                }}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap"
                              >
                                OT
                              </button>
                            )}

                            {(isFieldOfficer || user.role === 'admin') && (
                              <button
                                type="button"
                                onClick={() => {
                                  setModalError(null);
                                  setFoRecord(r);
                                  setFoRemarkText('');
                                }}
                                className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
                              >
                                <MessageSquarePlus className="w-3.5 h-3.5 text-[#5C3D2E]" />
                                <span>Remark</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <PaginationControls
                currentPage={page}
                totalItems={filteredRecords.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </section>
      )}

      {/* TAB 2: CORRECTIONS & MISSING PUNCHES */}
      {activeTab === 'corrections' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Missing Punch &amp; Attendance Correction Queue
            </h2>
            <p className="text-xs text-[#574B43]">
              Review employee missing check-in/out requests and geofence exceptions. Approved
              corrections automatically recalculate net duty hours and mark HR verification.
            </p>
          </div>

          {corrections.length === 0 ? (
            <EmptyStatePanel
              icon={CheckCircle2}
              title="No Attendance Correction Requests"
              description="Submitted missing punch and geofence exception requests appear here for HR review."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Ref &amp; Date</th>
                    <th className="py-3 px-3">Employee &amp; Site</th>
                    <th className="py-3 px-3">Type &amp; Requested Punches</th>
                    <th className="py-3 px-3">Reason</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {corrections.map((c) => (
                    <tr key={c.correctionId} className="hover:bg-[#FAF8F5]">
                      <td className="py-3 px-3 font-mono-tabular text-xs whitespace-nowrap">
                        <div className="font-semibold text-[#5C3D2E]">{c.correctionId}</div>
                        <div className="text-[#574B43]">{c.attendanceDate}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-[#1F1916]">{c.employeeName}</div>
                        <div className="text-xs text-[#574B43]">
                          {c.employeeId} · {c.siteName}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs">
                        <div className="font-semibold text-[#1F1916]">{c.requestType}</div>
                        <div className="font-mono-tabular text-[#574B43]">
                          In: {formatTimeShort(c.requestedCheckInAt || null)} · Out:{' '}
                          {formatTimeShort(c.requestedCheckOutAt || null)}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-[#574B43] max-w-xs">
                        <div>{c.reason}</div>
                        {c.reviewRemarks && (
                          <div className="text-[#5C3D2E] mt-0.5">HR: {c.reviewRemarks}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs font-semibold whitespace-nowrap">
                        <span
                          className={
                            c.status === 'Approved'
                              ? 'text-[#166534]'
                              : c.status === 'Rejected'
                                ? 'text-[#B91C1C]'
                                : 'text-[#B45309]'
                          }
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {c.status === 'Pending' && canReviewCorrections ? (
                          <button
                            type="button"
                            onClick={() => {
                              setModalError(null);
                              setReviewingCorrection(c);
                              setCorrDecision('Approved');
                              setCorrRemarks('');
                            }}
                            className="min-h-[34px] px-3 py-1 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
                          >
                            Review
                          </button>
                        ) : (
                          <span className="text-xs text-[#7D6F65]">
                            {c.reviewedByName ? `By ${c.reviewedByName}` : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 3: SITE GEOFENCE & SHIFT QR */}
      {activeTab === 'geofence_qr' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Site Geofence Boundaries &amp; Rotating Shift QR Access
              </h2>
              <p className="text-xs text-[#574B43]">
                Configure per-site GPS coordinates, allowed geofence radius (meters), GPS accuracy
                thresholds, and rotating HMAC-signed shift QR sessions.
              </p>
            </div>
          </div>

          {sites.length === 0 ? (
            <EmptyStatePanel
              icon={MapPin}
              title="No Active Deployment Sites Found"
              description="Sites within your authorized branch or Field Officer scope appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Site</th>
                    <th className="py-3 px-3">Coordinates (Lat, Lng)</th>
                    <th className="py-3 px-3 text-right">Radius</th>
                    <th className="py-3 px-3 text-right">Max Accuracy</th>
                    <th className="py-3 px-3">GPS Policy</th>
                    <th className="py-3 px-3">QR Attendance</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {sites.map((s) => {
                    const geo = resolveSiteGeoSettings(s);
                    return (
                      <tr key={s.siteId} className="hover:bg-[#FAF8F5]">
                        <td className="py-3 px-3">
                          <div className="font-medium text-[#1F1916]">{s.siteName}</div>
                          <div className="text-xs text-[#574B43] font-mono-tabular">
                            {s.siteId} · {s.city}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono-tabular text-xs text-[#1F1916] whitespace-nowrap">
                          {geo.latitude !== null && geo.longitude !== null
                            ? `${geo.latitude}, ${geo.longitude}`
                            : 'Not Configured'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-tabular text-xs text-[#1F1916] whitespace-nowrap">
                          {geo.allowedRadiusMeters}m
                        </td>
                        <td className="py-3 px-3 text-right font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                          &le; {geo.gpsAccuracyThresholdMeters}m
                        </td>
                        <td className="py-3 px-3 text-xs whitespace-nowrap">
                          <span
                            className={
                              geo.isGpsMandatory
                                ? 'font-semibold text-[#166534]'
                                : 'text-[#574B43]'
                            }
                          >
                            {geo.isGpsMandatory ? 'Mandatory Geofence' : 'Optional'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs whitespace-nowrap">
                          <span
                            className={
                              geo.isQrEnabled ? 'font-semibold text-[#166534]' : 'text-[#7D6F65]'
                            }
                          >
                            {geo.isQrEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {canManageQr && geo.isQrEnabled && (
                              <button
                                type="button"
                                onClick={() => {
                                  setQrLaunchSite(s);
                                  setQrShiftSelector('Day Shift');
                                  setQrActiveModalOpen(true);
                                }}
                                className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                                <span>Shift QR</span>
                              </button>
                            )}
                            {canEditGpsSettings && (
                              <button
                                type="button"
                                onClick={() => openGeoConfigModal(s)}
                                className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
                              >
                                <Settings2 className="w-3.5 h-3.5 text-[#5C3D2E]" />
                                <span>Configure</span>
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
        </section>
      )}

      {/* TAB 4: WEEKLY & MONTHLY ROLLUPS */}
      {activeTab === 'rollups' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Workforce Attendance Rollup ({fromDate} to {toDate})
              </h2>
              <p className="text-xs text-[#574B43]">
                Employee-wise totals of Present, Late, Half-Day, Absent, Weekly Off, Leave, Net
                Hours, and Approved Overtime for Phase 5 payroll readiness.
              </p>
            </div>
            {canExport && rollups.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => exportRollups('csv')}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-[#5C3D2E]" />
                  <span>Rollup CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportRollups('excel')}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Rollup Excel</span>
                </button>
              </div>
            )}
          </div>

          {rollups.length === 0 ? (
            <EmptyStatePanel
              icon={CalendarCheck}
              title="No Attendance Rollups for Selected Range"
              description="Once daily attendance entries are recorded in the selected date window, employee summaries aggregate automatically."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Employee</th>
                    <th className="py-3 px-3">Primary Site</th>
                    <th className="py-3 px-3 text-right">Present</th>
                    <th className="py-3 px-3 text-right">Late</th>
                    <th className="py-3 px-3 text-right">Half Day</th>
                    <th className="py-3 px-3 text-right">Absent</th>
                    <th className="py-3 px-3 text-right">W/Off &amp; Leave</th>
                    <th className="py-3 px-3 text-right">Net Hours</th>
                    <th className="py-3 px-3 text-right">Approved OT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {rollups.map((row) => (
                    <tr key={row.employeeId} className="hover:bg-[#FAF8F5]">
                      <td className="py-3 px-3">
                        <div className="font-medium text-[#1F1916]">{row.employeeName}</div>
                        <div className="text-xs text-[#574B43] font-mono-tabular">
                          {row.employeeId} · {row.designationName}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-[#574B43]">{row.siteName}</td>
                      <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#166534]">
                        {row.presentDays}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular text-[#B45309]">
                        {row.lateDays}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular text-[#574B43]">
                        {row.halfDays}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular text-[#B91C1C]">
                        {row.absentDays}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular text-[#574B43]">
                        {row.weeklyOffDays + row.holidayDays + row.leaveDays}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#1F1916]">
                        {row.totalNetHours}h
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular text-[#5C3D2E]">
                        {row.approvedOvertimeHours}h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 5: AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Immutable Attendance &amp; Roster Audit Log
            </h2>
            <p className="text-xs text-[#574B43]">
              Every roster publish/modification, GPS geofence update, QR session issuance, manual
              override, and overtime decision is permanently recorded.
            </p>
          </div>

          {auditLogs.length === 0 ? (
            <EmptyStatePanel
              icon={ShieldCheck}
              title="No Attendance Audit Events Recorded Yet"
              description="Audit entries populate automatically as rosters, geofence settings, QR codes, and attendance verifications occur."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Timestamp</th>
                    <th className="py-3 px-3">Category &amp; Action</th>
                    <th className="py-3 px-3">Target</th>
                    <th className="py-3 px-3">Change Summary &amp; Reason</th>
                    <th className="py-3 px-3">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {auditLogs.slice(0, 50).map((log) => (
                    <tr key={log.auditId} className="hover:bg-[#FAF8F5]">
                      <td className="py-3 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="py-3 px-3 text-xs">
                        <div className="font-semibold text-[#1F1916]">{log.action}</div>
                        <div className="text-[#7D6F65]">{log.category}</div>
                      </td>
                      <td className="py-3 px-3 font-mono-tabular text-xs text-[#5C3D2E] whitespace-nowrap">
                        {log.targetId}
                      </td>
                      <td className="py-3 px-3 text-xs text-[#574B43]">
                        <div>{log.newValueSummary}</div>
                        {log.reason && (
                          <div className="text-[#4A3023] mt-0.5">Reason: {log.reason}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs text-[#1F1916] whitespace-nowrap">
                        {log.actorName} ({log.actorRole})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* MODAL 1: MANUAL HR ENTRY */}
      {manualOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 my-8">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <div>
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  Record Manual HR Attendance Entry
                </h3>
                <p className="text-xs text-[#574B43]">
                  Record Present, Weekly Off, Holiday, Leave, or Absent entries with audit remarks.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#7D6F65]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="mt-4 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}

            <form onSubmit={(e) => void handleManualSubmit(e)} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Employee
                  </label>
                  <select
                    value={manEmployeeId}
                    onChange={(e) => setManEmployeeId(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    required
                  >
                    <option value="">Select Employee</option>
                    {employees.map((e) => (
                      <option key={e.employeeId} value={e.employeeId}>
                        {e.fullName} ({e.employeeId})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Site</label>
                  <select
                    value={manSiteId}
                    onChange={(e) => setManSiteId(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    required
                  >
                    <option value="">Select Site</option>
                    {sites.map((s) => (
                      <option key={s.siteId} value={s.siteId}>
                        {s.siteName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Date</label>
                  <input
                    type="date"
                    value={manDate}
                    onChange={(e) => setManDate(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Shift</label>
                  <select
                    value={manShift}
                    onChange={(e) => setManShift(e.target.value)}
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
                    value={manStatus}
                    onChange={(e) => setManStatus(e.target.value as AttendanceStatus)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    {ATTENDANCE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(manStatus === 'Present' || manStatus === 'Late' || manStatus === 'Half Day') && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Sched Start
                    </label>
                    <input
                      type="time"
                      value={manSchedStart}
                      onChange={(e) => setManSchedStart(e.target.value)}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Sched End
                    </label>
                    <input
                      type="time"
                      value={manSchedEnd}
                      onChange={(e) => setManSchedEnd(e.target.value)}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Actual In
                    </label>
                    <input
                      type="time"
                      value={manInTime}
                      onChange={(e) => setManInTime(e.target.value)}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Actual Out
                    </label>
                    <input
                      type="time"
                      value={manOutTime}
                      onChange={(e) => setManOutTime(e.target.value)}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-[#574B43]">
                <input
                  type="checkbox"
                  checked={manOutNextDay}
                  onChange={(e) => setManOutNextDay(e.target.checked)}
                  className="w-4 h-4 accent-[#5C3D2E]"
                />
                <span>Overnight shift: Check-Out occurred on next calendar day (+1d)</span>
              </label>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  HR Audit Remarks (Mandatory)
                </label>
                <textarea
                  rows={2}
                  value={manRemarks}
                  onChange={(e) => setManRemarks(e.target.value)}
                  placeholder="Enter reason or supporting attendance register reference..."
                  maxLength={300}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setManualOpen(false)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Attendance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: HR VERIFY / STATUS UPDATE */}
      {verifyingRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <h3 className="font-display text-lg font-bold text-[#1F1916]">
              Verify Attendance — {verifyingRecord.attendanceId}
            </h3>
            <p className="mt-1 text-xs text-[#574B43]">
              {verifyingRecord.employeeName} · {verifyingRecord.attendanceDate} ·{' '}
              {verifyingRecord.siteName}
            </p>

            {modalError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}

            <form onSubmit={(e) => void handleVerifySubmit(e)} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Attendance Status
                </label>
                <select
                  value={verStatus}
                  onChange={(e) => setVerStatus(e.target.value as AttendanceStatus)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                >
                  {ATTENDANCE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  HR Verification Remarks
                </label>
                <textarea
                  rows={2}
                  value={verRemarks}
                  onChange={(e) => setVerRemarks(e.target.value)}
                  placeholder="Optional verification notes..."
                  maxLength={300}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-[#1F1916]">
                <input
                  type="checkbox"
                  checked={verMarkVerified}
                  onChange={(e) => setVerMarkVerified(e.target.checked)}
                  className="w-4 h-4 accent-[#5C3D2E]"
                />
                <span>Lock as HR-Verified (prevents employee self-modification)</span>
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setVerifyingRecord(null)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  {submitting ? 'Saving...' : 'Confirm Verification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: OVERTIME REVIEW */}
      {otRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <h3 className="font-display text-lg font-bold text-[#1F1916]">
              Overtime Review — {otRecord.employeeName}
            </h3>
            <p className="mt-1 text-xs text-[#574B43] font-mono-tabular">
              Recorded Extra Duty: {otRecord.overtimeMinutes} mins ({otRecord.attendanceDate})
            </p>

            {modalError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}

            <form onSubmit={(e) => void handleOvertimeSubmit(e)} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">Decision</label>
                <select
                  value={otDecision}
                  onChange={(e) => setOtDecision(e.target.value as 'Approved' | 'Rejected')}
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                >
                  <option value="Approved">Approve Overtime</option>
                  <option value="Rejected">Reject Overtime</option>
                </select>
              </div>

              {otDecision === 'Approved' && (
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Approved Overtime Minutes
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={480}
                    value={otApprovedMins}
                    onChange={(e) => setOtApprovedMins(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">Remarks</label>
                <textarea
                  rows={2}
                  value={otRemarks}
                  onChange={(e) => setOtRemarks(e.target.value)}
                  placeholder="Enter overtime approval / rejection note..."
                  maxLength={250}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOtRecord(null)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  {submitting ? 'Saving...' : 'Submit Decision'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: FIELD OFFICER REMARK */}
      {foRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <h3 className="font-display text-lg font-bold text-[#1F1916]">
              Field Officer Site Attendance Remark
            </h3>
            <p className="mt-1 text-xs text-[#574B43]">
              {foRecord.employeeName} at {foRecord.siteName} ({foRecord.attendanceDate})
            </p>

            {modalError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}

            <form onSubmit={(e) => void handleFoRemarkSubmit(e)} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Field Verification Note
                </label>
                <textarea
                  rows={3}
                  value={foRemarkText}
                  onChange={(e) => setFoRemarkText(e.target.value)}
                  placeholder="e.g. Verified guard in full uniform on Main Gate post during 09:15 patrol."
                  maxLength={280}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFoRecord(null)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  Save Remark
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: CORRECTION REVIEW */}
      {reviewingCorrection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <h3 className="font-display text-lg font-bold text-[#1F1916]">
              Review Correction — {reviewingCorrection.correctionId}
            </h3>
            <p className="mt-1 text-xs text-[#574B43]">
              {reviewingCorrection.employeeName} · {reviewingCorrection.requestType} ·{' '}
              {reviewingCorrection.attendanceDate}
            </p>
            <p className="mt-2 p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs text-[#1F1916]">
              Employee Reason: {reviewingCorrection.reason}
            </p>

            {modalError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}

            <form
              onSubmit={(e) => void handleCorrectionReviewSubmit(e)}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">Decision</label>
                <select
                  value={corrDecision}
                  onChange={(e) => setCorrDecision(e.target.value as 'Approved' | 'Rejected')}
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                >
                  <option value="Approved">Approve &amp; Update Attendance</option>
                  <option value="Rejected">Reject Request</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  HR Review Remarks (Mandatory)
                </label>
                <textarea
                  rows={2}
                  value={corrRemarks}
                  onChange={(e) => setCorrRemarks(e.target.value)}
                  placeholder="Enter verification note for audit log and employee notification..."
                  maxLength={250}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReviewingCorrection(null)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  {submitting ? 'Saving...' : 'Submit Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: CONFIGURE SITE GEOFENCE & QR */}
      {configuringSite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <div>
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  Geofence &amp; QR Settings — {configuringSite.siteName}
                </h3>
                <p className="text-xs text-[#574B43]">
                  Server-side Haversine geofence verification uses these coordinates and radius.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfiguringSite(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#7D6F65]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}

            <form onSubmit={(e) => void handleGeoConfigSave(e)} className="mt-4 space-y-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCaptureBrowserGpsForSite}
                  className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#E5DDD2] whitespace-nowrap"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Use My Current GPS Location</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Site Latitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={geoLat}
                    onChange={(e) => setGeoLat(e.target.value)}
                    placeholder="e.g. 18.7606"
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Site Longitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={geoLng}
                    onChange={(e) => setGeoLng(e.target.value)}
                    placeholder="e.g. 73.8636"
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Allowed Radius (Meters)
                  </label>
                  <input
                    type="number"
                    min={20}
                    max={5000}
                    value={geoRadius}
                    onChange={(e) => setGeoRadius(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Max GPS Accuracy Threshold (Meters)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    value={geoAccThreshold}
                    onChange={(e) => setGeoAccThreshold(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-[#1F1916]">
                  <input
                    type="checkbox"
                    checked={geoMandatory}
                    onChange={(e) => setGeoMandatory(e.target.checked)}
                    className="w-4 h-4 accent-[#5C3D2E]"
                  />
                  <span>Enforce GPS Geofence Radius on GPS Check-In / Check-Out</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-[#1F1916]">
                  <input
                    type="checkbox"
                    checked={geoQrEnabled}
                    onChange={(e) => setGeoQrEnabled(e.target.checked)}
                    className="w-4 h-4 accent-[#5C3D2E]"
                  />
                  <span>Enable Rotating Time-Limited Shift QR Attendance for this Site</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfiguringSite(null)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  {submitting ? 'Saving...' : 'Save Site Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: SHIFT SELECTOR + ROTATING QR */}
      {qrLaunchSite && qrActiveModalOpen && (
        <div className="space-y-2">
          <div className="fixed top-4 right-4 z-[60] bg-white border border-[#D4C7B8] rounded-lg px-3 py-2 shadow-sm flex items-center gap-2 text-xs">
            <span className="font-semibold text-[#1F1916]">Shift:</span>
            <select
              value={qrShiftSelector}
              onChange={(e) => setQrShiftSelector(e.target.value)}
              className="px-2 py-1 bg-[#FAF8F5] border border-[#E5DDD2] rounded font-medium"
            >
              {ROSTER_SHIFT_TYPES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          <RotatingShiftQrModal
            open={qrActiveModalOpen}
            onClose={() => {
              setQrActiveModalOpen(false);
              setQrLaunchSite(null);
            }}
            caller={user}
            isPreviewSession={isPreviewSession}
            siteId={qrLaunchSite.siteId}
            siteName={qrLaunchSite.siteName}
            attendanceDate={today}
            shiftType={qrShiftSelector}
            scheduledStartTime={qrShiftSelector === 'Night Shift' ? '20:00' : '08:00'}
            scheduledEndTime={qrShiftSelector === 'Night Shift' ? '08:00' : '20:00'}
          />
        </div>
      )}
    </div>
  );
};
