import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  FileWarning,
  History,
  MapPin,
  MessageSquarePlus,
  Navigation,
  Plus,
  Printer,
  QrCode,
  Search,
  Settings2,
  ShieldCheck,
  Sliders,
  X,
} from 'lucide-react';
import { CameraCaptureModal, CapturedAttendancePhoto } from '../../components/CameraCaptureModal';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { RotatingShiftQrModal } from '../../components/RotatingShiftQrModal';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  addFieldOfficerAttendanceRemark,
  configureSiteGeofenceAndQr,
  getAttendancePolicyConfig,
  listAttendanceApprovals,
  listAttendanceAuditLogs,
  listAttendanceCorrectionRequests,
  listAttendanceExceptionReports,
  listAttendanceRecords,
  recordManualHrAttendance,
  requestSiteGeofenceOverrideApproval,
  reviewAttendanceApproval,
  reviewAttendanceCorrectionRequest,
  reviewFieldOfficerExceptionReport,
  reviewOvertimeByHr,
  saveAttendancePolicyConfig,
  submitFieldOfficerExceptionReport,
  subscribeAttendanceData,
  uploadAttendanceVerificationPhoto,
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
  ATTENDANCE_REPORT_TYPES,
  ATTENDANCE_STATUSES,
  AttendanceApprovalRecord,
  AttendanceAuditRecord,
  AttendanceCorrectionRequest,
  AttendanceExceptionReport,
  AttendancePolicyConfig,
  AttendanceRecord,
  AttendanceReportType,
  AttendanceStatus,
  AttendanceVerificationStatus,
  BranchRecord,
  ClientRecord,
  EmployeeRecord,
  FIELD_OFFICER_EXCEPTION_TYPES,
  FieldOfficerExceptionType,
  ROSTER_SHIFT_TYPES,
  SERVICE_CATEGORIES,
  SiteRecord,
} from '../../types';
import { exportBrandedAttendancePdf } from '../../utils/attendancePdfExport';
import {
  buildPhase4ReportDataset,
  deriveAttendanceLocationStatus,
  deriveAttendanceVerificationStatus,
  formatIstTimeOnly,
  isAttendancePayrollEligible,
  resolveSiteGeoSettings,
} from '../../utils/attendanceValidation';
import {
  addDaysToIsoDate,
  exportTableToCsv,
  exportTableToExcelXml,
  getTodayIsoDate,
} from '../../utils/deploymentValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';

type ConsoleTab = 'register' | 'fo_reports' | 'corrections' | 'geofence_qr' | 'reports' | 'audit';

type VerificationSubQueue =
  | 'ALL'
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'OUTSIDE_GEOFENCE'
  | 'MISSING_CHECKOUT'
  | 'LATE_CHECKIN'
  | 'EARLY_CHECKOUT'
  | 'MANUAL_REQUESTS';

const PAGE_SIZE = 10;

function formatTimeShort(iso: string | null): string {
  if (!iso) return '—';
  return formatIstTimeOnly(iso);
}

function isoTo24hInput(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  const formatted = formatIstTimeOnly(iso);
  if (/^\d{2}:\d{2}$/.test(formatted)) return formatted;
  return fallback;
}

export const AttendanceManagementPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const today = useMemo(() => getTodayIsoDate(), []);

  const [activeTab, setActiveTab] = useState<ConsoleTab>('register');
  const [subQueue, setSubQueue] = useState<VerificationSubQueue>('ALL');
  const [loading, setLoading] = useState<boolean>(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Records
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrectionRequest[]>([]);
  const [foReports, setFoReports] = useState<AttendanceExceptionReport[]>([]);
  const [geoApprovals, setGeoApprovals] = useState<AttendanceApprovalRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AttendanceAuditRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [policyConfig, setPolicyConfig] = useState<AttendancePolicyConfig>(() =>
    getAttendancePolicyConfig()
  );

  // Register & Report Filters
  const [rangePreset, setRangePreset] = useState<'Daily' | 'Weekly' | 'Monthly' | 'Custom'>(
    'Monthly'
  );
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

  // 12 Phase 4 Reports State
  const [selectedReportType, setSelectedReportType] = useState<AttendanceReportType>(
    'Monthly Attendance Report'
  );

  // Permissions
  const isFieldOfficer = user?.role === 'field_officer';
  const isAdmin = user?.role === 'admin';
  const canCreateManual = hasUserPermission(user, 'attendance.create');
  const canVerifyOrEdit =
    isAdmin ||
    hasUserPermission(user, 'attendance.verify') ||
    hasUserPermission(user, 'attendance.edit') ||
    hasUserPermission(user, 'attendance.approve');
  const canReviewCorrections =
    isAdmin ||
    hasUserPermission(user, 'attendance.correct') ||
    hasUserPermission(user, 'attendance.approve');
  const canApproveOvertime =
    isAdmin ||
    hasUserPermission(user, 'attendance.overtime_approve') ||
    hasUserPermission(user, 'attendance.approve');
  const canExport =
    isAdmin || isFieldOfficer || hasUserPermission(user, 'attendance.export');
  const canEditGpsSettings =
    isAdmin ||
    hasUserPermission(user, 'attendance.gps_settings') ||
    hasUserPermission(user, 'site.edit');
  const canManageQr =
    isAdmin || isFieldOfficer || hasUserPermission(user, 'attendance.qr_manage');

  // Shared Modal State
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

  // 2. Enhanced HR Verify & Time Correction Modal
  const [verifyingRecord, setVerifyingRecord] = useState<AttendanceRecord | null>(null);
  const [verStatus, setVerStatus] = useState<AttendanceStatus>('Present');
  const [verDecision, setVerDecision] = useState<AttendanceVerificationStatus>('Verified');
  const [verRemarks, setVerRemarks] = useState<string>('');
  const [verCorrectTimes, setVerCorrectTimes] = useState<boolean>(false);
  const [verCheckIn24h, setVerCheckIn24h] = useState<string>('08:00');
  const [verCheckOut24h, setVerCheckOut24h] = useState<string>('20:00');
  const [verCheckOutNextDay, setVerCheckOutNextDay] = useState<boolean>(false);
  const [verCorrectionReason, setVerCorrectionReason] = useState<string>('');

  // 3. Overtime Approval Modal
  const [otRecord, setOtRecord] = useState<AttendanceRecord | null>(null);
  const [otDecision, setOtDecision] = useState<'Approved' | 'Rejected'>('Approved');
  const [otApprovedMins, setOtApprovedMins] = useState<number>(60);
  const [otRemarks, setOtRemarks] = useState<string>('');

  // 4. Field Officer Quick Remark Modal
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
  const [geoRadius, setGeoRadius] = useState<number>(200);
  const [geoAccThreshold, setGeoAccThreshold] = useState<number>(100);
  const [geoMandatory, setGeoMandatory] = useState<boolean>(true);
  const [geoQrEnabled, setGeoQrEnabled] = useState<boolean>(true);

  // 7. HR Request Geofence Radius Override Modal
  const [overrideReqSite, setOverrideReqSite] = useState<SiteRecord | null>(null);
  const [overrideRadius, setOverrideRadius] = useState<number>(300);
  const [overrideReason, setOverrideReason] = useState<string>('');

  // 8. Admin Global Policy Modal
  const [policyModalOpen, setPolicyModalOpen] = useState<boolean>(false);
  const [polRadius, setPolRadius] = useState<number>(policyConfig.defaultGeofenceRadiusMeters);
  const [polAccuracy, setPolAccuracy] = useState<number>(
    policyConfig.defaultGpsAccuracyThresholdMeters
  );
  const [polCutoff, setPolCutoff] = useState<number>(policyConfig.shiftAbsentCutoffMinutes);
  const [polOtMin, setPolOtMin] = useState<number>(policyConfig.overtimeMinimumMinutes);
  const [polPhotoIn, setPolPhotoIn] = useState<boolean>(policyConfig.requireCheckInPhoto);
  const [polPhotoOut, setPolPhotoOut] = useState<boolean>(policyConfig.requireCheckOutPhoto);

  // 9. Field Officer Exception / Site Visit Report Modal & Review Modal
  const [foReportModalOpen, setFoReportModalOpen] = useState<boolean>(false);
  const [foRepType, setFoRepType] = useState<FieldOfficerExceptionType>('Missing Attendance');
  const [foRepSiteId, setFoRepSiteId] = useState<string>('');
  const [foRepDate, setFoRepDate] = useState<string>(today);
  const [foRepEmpId, setFoRepEmpId] = useState<string>('');
  const [foRepShift, setFoRepShift] = useState<string>('Day Shift');
  const [foRepSummary, setFoRepSummary] = useState<string>('');
  const [foRepRemarks, setFoRepRemarks] = useState<string>('');
  const [foRepPhoto, setFoRepPhoto] = useState<CapturedAttendancePhoto | null>(null);
  const [foCameraOpen, setFoCameraOpen] = useState<boolean>(false);

  const [reviewingFoReport, setReviewingFoReport] = useState<AttendanceExceptionReport | null>(
    null
  );
  const [foReviewDecision, setFoReviewDecision] = useState<'Resolved' | 'Rejected'>('Resolved');
  const [foReviewNotes, setFoReviewNotes] = useState<string>('');

  // 10. Shift QR Launch Modal
  const [qrLaunchSite, setQrLaunchSite] = useState<SiteRecord | null>(null);
  const [qrShiftSelector] = useState<string>('Day Shift');
  const [qrActiveModalOpen, setQrActiveModalOpen] = useState<boolean>(false);

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [
        attList,
        corrList,
        foRepList,
        geoAppList,
        logList,
        brList,
        clList,
        stList,
        empList,
      ] = await Promise.all([
        listAttendanceRecords(user, isPreviewSession),
        listAttendanceCorrectionRequests(user, isPreviewSession),
        listAttendanceExceptionReports(user, isPreviewSession).catch(() => []),
        listAttendanceApprovals(user, isPreviewSession).catch(() => []),
        listAttendanceAuditLogs(user, isPreviewSession),
        listBranches(user, isPreviewSession).catch(() => []),
        listClients(user, isPreviewSession).catch(() => []),
        listSites(user, isPreviewSession).catch(() => []),
        listEmployees(user, isPreviewSession).catch(() => []),
      ]);

      setRecords(attList);
      setCorrections(corrList);
      setFoReports(foRepList);
      setGeoApprovals(geoAppList);
      setAuditLogs(logList);
      setPolicyConfig(getAttendancePolicyConfig());
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

  // Base filtered records (before HR Verification Sub-Queue filter, used for Reports & Sub-Queue counts)
  const baseFilteredRecords = useMemo(() => {
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

  const matchesSubQueue = useCallback((r: AttendanceRecord, q: VerificationSubQueue): boolean => {
    const vStatus = deriveAttendanceVerificationStatus(r);
    if (q === 'ALL') return true;
    if (q === 'PENDING') return !r.isVerifiedByHr && vStatus === 'Pending';
    if (q === 'VERIFIED')
      return r.isVerifiedByHr || vStatus === 'Verified' || vStatus === 'Exception Approved';
    if (q === 'REJECTED') return r.status === 'Rejected' || vStatus === 'Rejected';
    if (q === 'OUTSIDE_GEOFENCE')
      return (
        r.verificationOutcome === 'Outside_Geofence' ||
        r.verificationOutcome === 'Low_GPS_Accuracy' ||
        r.status === 'Exception'
      );
    if (q === 'MISSING_CHECKOUT') return Boolean(r.checkInAt) && !r.checkOutAt;
    if (q === 'LATE_CHECKIN') return r.lateArrivalMinutes > 0 || r.status === 'Late';
    if (q === 'EARLY_CHECKOUT') return r.earlyDepartureMinutes > 0;
    if (q === 'MANUAL_REQUESTS')
      return (
        r.checkInMethod === 'Manual_HR' ||
        r.verificationOutcome === 'Manual_Override' ||
        (r.timeCorrectionHistory?.length ?? 0) > 0
      );
    return true;
  }, []);

  const filteredRecords = useMemo(() => {
    return baseFilteredRecords.filter((r) => matchesSubQueue(r, subQueue));
  }, [baseFilteredRecords, matchesSubQueue, subQueue]);

  useEffect(() => {
    setPage(1);
  }, [
    activeTab,
    subQueue,
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

  const reportDataset = useMemo(
    () =>
      buildPhase4ReportDataset({
        reportType: selectedReportType,
        records: baseFilteredRecords,
      }),
    [selectedReportType, baseFilteredRecords]
  );

  const pendingCorrectionsCount = useMemo(
    () => corrections.filter((c) => c.status === 'Pending').length,
    [corrections]
  );

  const pendingFoReportsCount = useMemo(
    () => foReports.filter((f) => f.status === 'Pending HR Review').length,
    [foReports]
  );

  const kpis = useMemo(() => {
    const payrollReady = baseFilteredRecords.filter((r) => isAttendancePayrollEligible(r)).length;
    const exceptions = baseFilteredRecords.filter(
      (r) =>
        r.status === 'Exception' ||
        r.verificationOutcome === 'Outside_Geofence' ||
        r.verificationOutcome === 'Low_GPS_Accuracy'
    ).length;
    const pendingOt = baseFilteredRecords.filter((r) => r.overtimeStatus === 'Pending').length;
    const unverifiedCount = baseFilteredRecords.filter((r) => !r.isVerifiedByHr).length;
    return {
      total: baseFilteredRecords.length,
      payrollReady,
      exceptions,
      pendingActions: unverifiedCount + pendingCorrectionsCount + pendingFoReportsCount + pendingOt,
    };
  }, [baseFilteredRecords, pendingCorrectionsCount, pendingFoReportsCount]);

  // Handlers
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setModalError(null);
    setSubmitting(true);
    try {
      const needsTimes =
        manStatus === 'Present' ||
        manStatus === 'Late' ||
        manStatus === 'Half Day' ||
        manStatus === 'On Duty';
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

  const openVerifyModal = (r: AttendanceRecord) => {
    setModalError(null);
    setVerifyingRecord(r);
    setVerStatus(
      r.status === 'Exception' || r.status === 'Incomplete' || r.status === 'On Duty'
        ? 'Present'
        : r.status
    );
    const defaultDec: AttendanceVerificationStatus =
      r.status === 'Rejected'
        ? 'Rejected'
        : r.status === 'Exception' ||
            r.verificationOutcome === 'Outside_Geofence' ||
            r.verificationOutcome === 'Low_GPS_Accuracy'
          ? 'Exception Approved'
          : 'Verified';
    setVerDecision(defaultDec);
    setVerRemarks(r.hrRemarks || '');
    setVerCorrectTimes(false);
    setVerCheckIn24h(isoTo24hInput(r.checkInAt, r.scheduledStartTime || '08:00'));
    setVerCheckOut24h(isoTo24hInput(r.checkOutAt, r.scheduledEndTime || '20:00'));
    setVerCheckOutNextDay(Boolean(r.crossesMidnight));
    setVerCorrectionReason('');
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !verifyingRecord) return;
    setModalError(null);
    setSubmitting(true);
    try {
      const markVer = verDecision === 'Verified' || verDecision === 'Exception Approved';
      await verifyOrUpdateAttendanceByHr(user, isPreviewSession, verifyingRecord.attendanceId, {
        status: verDecision === 'Rejected' ? 'Rejected' : verStatus,
        hrRemarks: verRemarks,
        markVerified: markVer,
        verificationDecision: verDecision,
        correctedCheckInTime24h: verCorrectTimes ? verCheckIn24h : undefined,
        correctedCheckOutTime24h: verCorrectTimes ? verCheckOut24h : undefined,
        correctedCheckOutNextDay: verCorrectTimes ? verCheckOutNextDay : undefined,
        correctionReason: verCorrectTimes ? verCorrectionReason : undefined,
      });
      setVerifyingRecord(null);
      setBanner({
        type: 'success',
        text: `Attendance ${verifyingRecord.attendanceId} updated (${verDecision}) and synced with payroll eligibility gate.`,
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

  const handleCreateFoReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setModalError(null);
    setSubmitting(true);
    try {
      let photoUrl = '';
      let photoStoragePath = '';
      const siteObj = sites.find((s) => s.siteId === foRepSiteId);
      if (foRepPhoto) {
        const uploaded = await uploadAttendanceVerificationPhoto(
          user,
          isPreviewSession,
          foRepPhoto.file,
          {
            branchId: siteObj?.branchId || user.branchId,
            employeeId: foRepEmpId || user.uid,
            siteId: foRepSiteId,
            photoType: 'field_report',
            cameraFacing: foRepPhoto.cameraFacing,
          }
        );
        photoUrl = uploaded.previewUrl;
        photoStoragePath = uploaded.storagePath;
      }

      const created = await submitFieldOfficerExceptionReport(user, isPreviewSession, {
        reportType: foRepType,
        siteId: foRepSiteId,
        attendanceDate: foRepDate,
        employeeId: foRepEmpId || undefined,
        shiftType: foRepShift,
        summary: foRepSummary,
        remarks: foRepRemarks,
        photoUrl,
        photoStoragePath,
      });

      setFoReportModalOpen(false);
      setFoRepSummary('');
      setFoRepRemarks('');
      setFoRepEmpId('');
      setFoRepPhoto(null);
      setBanner({
        type: 'success',
        text: `Field report ${created.exceptionId} (${created.reportType}) submitted to HR review queue.`,
      });
    } catch (err) {
      setModalError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewFoReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !reviewingFoReport) return;
    setModalError(null);
    setSubmitting(true);
    try {
      await reviewFieldOfficerExceptionReport(
        user,
        isPreviewSession,
        reviewingFoReport.exceptionId,
        foReviewDecision,
        foReviewNotes
      );
      setReviewingFoReport(null);
      setBanner({
        type: 'success',
        text: `Field report ${reviewingFoReport.exceptionId} marked ${foReviewDecision} and audit-logged.`,
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

  const handleRequestRadiusOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !overrideReqSite) return;
    setModalError(null);
    setSubmitting(true);
    try {
      const created = await requestSiteGeofenceOverrideApproval(user, isPreviewSession, {
        siteId: overrideReqSite.siteId,
        requestedRadiusMeters: overrideRadius,
        reason: overrideReason,
      });
      setOverrideReqSite(null);
      setOverrideReason('');
      setBanner({
        type: 'success',
        text: `Geofence radius override request ${created.approvalId} routed to Administrator queue.`,
      });
    } catch (err) {
      setModalError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminDecideGeoApproval = async (
    approvalId: string,
    decision: 'Approved' | 'Rejected'
  ) => {
    if (!user) return;
    try {
      await reviewAttendanceApproval(
        user,
        isPreviewSession,
        approvalId,
        decision,
        `${decision} from Attendance Geofence Console`
      );
      setBanner({
        type: 'success',
        text: `Geofence override request ${approvalId} ${decision.toLowerCase()}.`,
      });
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    }
  };

  const handleSaveGlobalPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setModalError(null);
    setSubmitting(true);
    try {
      const updated = await saveAttendancePolicyConfig(user, isPreviewSession, {
        defaultGeofenceRadiusMeters: polRadius,
        defaultGpsAccuracyThresholdMeters: polAccuracy,
        shiftAbsentCutoffMinutes: polCutoff,
        overtimeMinimumMinutes: polOtMin,
        requireCheckInPhoto: polPhotoIn,
        requireCheckOutPhoto: polPhotoOut,
      });
      setPolicyConfig(updated);
      setPolicyModalOpen(false);
      setBanner({
        type: 'success',
        text: `Saved global attendance policy (Default Geofence: ${updated.defaultGeofenceRadiusMeters}m).`,
      });
    } catch (err) {
      setModalError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const exportCurrentReport = (mode: 'pdf_print' | 'pdf_download' | 'csv' | 'excel') => {
    const headers = reportDataset.columns.map((c) => c.header);
    const slug = selectedReportType.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    if (mode === 'csv') {
      exportTableToCsv(`rexon-${slug}`, headers, reportDataset.rows);
      return;
    }
    if (mode === 'excel') {
      exportTableToExcelXml(`rexon-${slug}`, selectedReportType.slice(0, 30), headers, reportDataset.rows);
      return;
    }

    const branchObj = branches.find((b) => b.branchId === branchFilter);
    const clientObj = clients.find((c) => c.clientId === clientFilter);
    const siteObj = sites.find((s) => s.siteId === siteFilter);

    exportBrandedAttendancePdf(
      {
        reportTitle: selectedReportType,
        reportPeriod: `${fromDate} to ${toDate}`,
        branchName: branchObj ? `${branchObj.branchName} (${branchObj.branchId})` : undefined,
        clientName: clientObj ? clientObj.companyName : undefined,
        siteName: siteObj ? `${siteObj.siteName} (${siteObj.siteId})` : undefined,
        generatedBy: user ? `${user.fullName} (${user.role})` : 'REXON HR Portal',
        summaryMetrics: reportDataset.summaryMetrics,
        columns: reportDataset.columns,
        rows: reportDataset.rows,
        footerNote:
          'Payroll Readiness Rule: Only attendance records verified or exception-approved by HR are eligible for Phase 5 payroll calculation.',
        fileNamePrefix: `rexon-${slug}`,
      },
      mode === 'pdf_print' ? 'print' : 'download'
    );
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            {isFieldOfficer
              ? 'Site Attendance, Field Reports & Shift QR'
              : 'Attendance, Verification & Reports Console'}
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            {isFieldOfficer
              ? 'Monitor real-time guard & workforce turnout across assigned sites, submit field reports with photos, and launch rotating shift QR codes.'
              : 'GPS geofence & photo verification, HR time corrections, Field Officer reports, overtime approvals, and 12 branded attendance reports.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('reports');
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5 text-[#5C3D2E]" />
              <span>12 Branded PDF / Excel Reports</span>
            </button>
          )}

          {(isFieldOfficer || isAdmin || user.role === 'hr') && (
            <button
              type="button"
              onClick={() => {
                setModalError(null);
                setFoRepSiteId(sites[0]?.siteId || '');
                setFoRepDate(today);
                setFoRepSummary('');
                setFoRepRemarks('');
                setFoRepPhoto(null);
                setFoReportModalOpen(true);
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap"
            >
              <FileWarning className="w-3.5 h-3.5" />
              <span>Log Field Report</span>
            </button>
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
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
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
          label="Payroll-Ready (HR Verified)"
          value={kpis.payrollReady}
          subtext="Verified shifts cleared for Phase 5 payroll"
          icon={CheckCircle2}
        />
        <StatMetricCard
          label="Geofence / GPS Exceptions"
          value={kpis.exceptions}
          subtext="Outside-radius or low-accuracy punches"
          icon={AlertTriangle}
          tone={kpis.exceptions > 0 ? 'attention' : 'default'}
        />
        <StatMetricCard
          label="Pending HR Actions"
          value={kpis.pendingActions}
          subtext="Unverified logs, corrections, FO & OT items"
          icon={Clock}
          tone={kpis.pendingActions > 0 ? 'attention' : 'default'}
        />
      </section>

      {/* Workspace Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl">
        {(
          [
            { key: 'register', label: 'Attendance & HR Verification', icon: ClipboardCheck },
            {
              key: 'fo_reports',
              label: `Field Officer Reports (${pendingFoReportsCount})`,
              icon: FileWarning,
            },
            {
              key: 'corrections',
              label: `Corrections (${pendingCorrectionsCount})`,
              icon: AlertTriangle,
            },
            { key: 'geofence_qr', label: 'Geofence Policy & Shift QR', icon: MapPin },
            { key: 'reports', label: '12 Reports & Branded PDF', icon: FileText },
            { key: 'audit', label: 'Audit History', icon: History },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
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

      {/* SHARED DATE / BRANCH / CLIENT / SITE FILTER BAR FOR REGISTER & REPORTS */}
      {(activeTab === 'register' || activeTab === 'reports') && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg self-start">
              {(['Daily', 'Weekly', 'Monthly'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyDatePreset(preset)}
                  className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
                    rangePreset === preset
                      ? 'bg-[#5C3D2E] text-white'
                      : 'text-[#574B43] hover:text-[#1F1916]'
                  }`}
                >
                  {preset} Window
                </button>
              ))}
            </div>

            <div className="relative w-full xl:w-80">
              <Search className="w-4 h-4 text-[#7D6F65] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search employee, site, client, attendance ID..."
                className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
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
              <label className="block text-[11px] font-semibold text-[#574B43] mb-1">Client</label>
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="w-full min-h-[38px] px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
              >
                <option value="ALL">All Clients</option>
                {clients.map((c) => (
                  <option key={c.clientId} value={c.clientId}>
                    {c.companyName}
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
                <option value="ALL">All Services</option>
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
        </section>
      )}

      {/* TAB 1: ATTENDANCE REGISTER & HR VERIFICATION QUEUES */}
      {activeTab === 'register' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          {/* HR Verification Sub-Queues */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#574B43]">
              HR Verification Queues (Select queue to inspect pending, geofence, or missing-punch
              records)
            </div>
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'PENDING', label: 'Pending' },
                  { id: 'VERIFIED', label: 'Verified' },
                  { id: 'REJECTED', label: 'Rejected' },
                  { id: 'OUTSIDE_GEOFENCE', label: 'Outside Geofence' },
                  { id: 'MISSING_CHECKOUT', label: 'Missing Check-out' },
                  { id: 'LATE_CHECKIN', label: 'Late Check-in' },
                  { id: 'EARLY_CHECKOUT', label: 'Early Check-out' },
                  { id: 'MANUAL_REQUESTS', label: 'Manual / Corrected' },
                ] as const
              ).map((qItem) => {
                const count = baseFilteredRecords.filter((r) =>
                  matchesSubQueue(r, qItem.id)
                ).length;
                const active = subQueue === qItem.id;
                return (
                  <button
                    key={qItem.id}
                    type="button"
                    onClick={() => setSubQueue(qItem.id)}
                    className={`min-h-[36px] px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#5C3D2E] text-white'
                        : 'text-[#574B43] hover:text-[#1F1916] hover:bg-white'
                    }`}
                  >
                    {qItem.label} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-xs text-[#574B43]">
              Loading operational attendance register...
            </div>
          ) : filteredRecords.length === 0 ? (
            <EmptyStatePanel
              icon={CalendarCheck}
              title="No Attendance Records in Selected Queue"
              description="Switch verification sub-queues above or widen your date range to inspect employee GPS/photo/QR attendance records."
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
                      <th className="py-3 px-3">GPS &amp; Photo</th>
                      <th className="py-3 px-3 text-right">Hours &amp; OT</th>
                      <th className="py-3 px-3">Verification &amp; Payroll</th>
                      <th className="py-3 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5DDD2] text-sm">
                    {paginatedRecords.map((r) => {
                      const locStatus = deriveAttendanceLocationStatus(r);
                      const verDecisionLabel = deriveAttendanceVerificationStatus(r);
                      const payrollReady = isAttendancePayrollEligible(r);
                      return (
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
                            {(r.timeCorrectionHistory?.length ?? 0) > 0 && (
                              <div className="text-[11px] text-[#5C3D2E]">
                                Time Corrected ({r.timeCorrectionHistory?.length})
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-3 align-top text-xs">
                            <div className="font-medium text-[#1F1916]">
                              {r.checkInMethod || '—'} · {locStatus}
                            </div>
                            {r.checkInGeo && r.checkInGeo.distanceMeters !== null && (
                              <div className="font-mono-tabular text-[11px] text-[#574B43]">
                                Dist: {r.checkInGeo.distanceMeters}m /{' '}
                                {r.checkInGeo.allowedRadiusMeters}m
                              </div>
                            )}
                            {(r.checkInPhoto?.previewUrl || r.checkOutPhoto?.previewUrl) && (
                              <div className="text-[11px] text-[#5C3D2E] mt-0.5">
                                {r.checkInPhoto?.previewUrl ? 'Photo In' : ''}
                                {r.checkInPhoto?.previewUrl && r.checkOutPhoto?.previewUrl
                                  ? ' · '
                                  : ''}
                                {r.checkOutPhoto?.previewUrl ? 'Photo Out' : ''}
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
                                r.status === 'Present' || r.status === 'On Duty'
                                  ? 'text-[#166534]'
                                  : r.status === 'Exception' ||
                                      r.status === 'Absent' ||
                                      r.status === 'Rejected'
                                    ? 'text-[#B91C1C]'
                                    : 'text-[#B45309]'
                              }`}
                            >
                              {r.status} · {verDecisionLabel}
                            </div>
                            <div
                              className={`text-[11px] ${
                                payrollReady ? 'text-[#166534] font-medium' : 'text-[#7D6F65]'
                              }`}
                            >
                              {payrollReady ? 'Payroll Ready' : 'Excluded from Payroll'}
                            </div>
                          </td>

                          <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {canVerifyOrEdit && (
                                <button
                                  type="button"
                                  onClick={() => openVerifyModal(r)}
                                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
                                >
                                  Verify / Edit
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
                                  className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap"
                                >
                                  OT
                                </button>
                              )}

                              {(isFieldOfficer || isAdmin) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModalError(null);
                                    setFoRecord(r);
                                    setFoRemarkText('');
                                  }}
                                  className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
                                >
                                  <MessageSquarePlus className="w-3.5 h-3.5 text-[#5C3D2E]" />
                                  <span>Remark</span>
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
                totalItems={filteredRecords.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </section>
      )}

      {/* TAB 2: FIELD OFFICER MONITORING & SITE REPORTS */}
      {activeTab === 'fo_reports' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Field Officer Site Monitoring &amp; Replacement Reports
              </h2>
              <p className="text-xs text-[#574B43]">
                Missing Attendance, Attendance Issues, Site Visit Reports, and Employee Replacement
                Requirements reported from the field.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setModalError(null);
                setFoRepSiteId(sites[0]?.siteId || '');
                setFoRepDate(today);
                setFoReportModalOpen(true);
              }}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Submit Field Report</span>
            </button>
          </div>

          {foReports.length === 0 ? (
            <EmptyStatePanel
              icon={FileWarning}
              title="No Field Officer Reports Logged Yet"
              description="Field Officers can log Missing Attendance, Site Visit Reports, and Replacement Requirements with photo verification here."
              actionLabel="Submit Field Report"
              onAction={() => {
                setModalError(null);
                setFoRepSiteId(sites[0]?.siteId || '');
                setFoReportModalOpen(true);
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Ref &amp; Date</th>
                    <th className="py-3 px-3">Type &amp; Site</th>
                    <th className="py-3 px-3">Summary &amp; Field Observations</th>
                    <th className="py-3 px-3">Photo</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {foReports.map((rep) => (
                    <tr key={rep.exceptionId} className="hover:bg-[#FAF8F5]">
                      <td className="py-3 px-3 font-mono-tabular text-xs whitespace-nowrap">
                        <div className="font-semibold text-[#5C3D2E]">{rep.exceptionId}</div>
                        <div className="text-[#574B43]">{rep.attendanceDate}</div>
                        <div className="text-[11px] text-[#7D6F65]">{rep.reportedByName}</div>
                      </td>
                      <td className="py-3 px-3 text-xs">
                        <div className="font-semibold text-[#1F1916]">{rep.reportType}</div>
                        <div className="text-[#574B43]">
                          {rep.siteName} · {rep.shiftType}
                        </div>
                        {rep.employeeName && (
                          <div className="font-mono-tabular text-[#5C3D2E]">
                            Personnel: {rep.employeeName} ({rep.employeeId})
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs text-[#1F1916] max-w-sm">
                        <div className="font-medium">{rep.summary}</div>
                        <div className="text-[#574B43] mt-0.5">{rep.remarks}</div>
                        {rep.hrResolutionNotes && (
                          <div className="text-[#5C3D2E] mt-1">
                            HR Resolution: {rep.hrResolutionNotes}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {rep.photoUrl ? (
                          <img
                            src={rep.photoUrl}
                            alt={`Field report ${rep.exceptionId}`}
                            referrerPolicy="no-referrer"
                            className="w-12 h-12 rounded-lg object-cover border border-[#D4C7B8]"
                          />
                        ) : (
                          <span className="text-xs text-[#7D6F65]">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs font-semibold whitespace-nowrap">
                        <span
                          className={
                            rep.status === 'Resolved'
                              ? 'text-[#166534]'
                              : rep.status === 'Rejected'
                                ? 'text-[#B91C1C]'
                                : 'text-[#B45309]'
                          }
                        >
                          {rep.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {rep.status === 'Pending HR Review' && canVerifyOrEdit && !isFieldOfficer ? (
                          <button
                            type="button"
                            onClick={() => {
                              setModalError(null);
                              setReviewingFoReport(rep);
                              setFoReviewDecision('Resolved');
                              setFoReviewNotes('');
                            }}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
                          >
                            Resolve
                          </button>
                        ) : (
                          <span className="text-xs text-[#7D6F65]">
                            {rep.reviewedByName ? `By ${rep.reviewedByName}` : '—'}
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

      {/* TAB 3: CORRECTIONS & MISSING PUNCHES */}
      {activeTab === 'corrections' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Missing Punch &amp; Attendance Correction Queue
            </h2>
            <p className="text-xs text-[#574B43]">
              Review employee missing check-in/out requests and geofence exceptions. Approved
              corrections recalculate net duty hours, mark HR verification, and unlock payroll
              eligibility.
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
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
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

      {/* TAB 4: SITE GEOFENCE, POLICY & SHIFT QR */}
      {activeTab === 'geofence_qr' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Site Geofence Boundaries, Policy Defaults &amp; Rotating Shift QR
              </h2>
              <p className="text-xs text-[#574B43]">
                Default Geofence: {policyConfig.defaultGeofenceRadiusMeters}m · Max GPS Accuracy:{' '}
                &le; {policyConfig.defaultGpsAccuracyThresholdMeters}m · Absent Cutoff: +
                {policyConfig.shiftAbsentCutoffMinutes}m · Photo Required (In/Out):{' '}
                {policyConfig.requireCheckInPhoto ? 'Yes' : 'Optional'} /{' '}
                {policyConfig.requireCheckOutPhoto ? 'Yes' : 'Optional'}
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setPolRadius(policyConfig.defaultGeofenceRadiusMeters);
                  setPolAccuracy(policyConfig.defaultGpsAccuracyThresholdMeters);
                  setPolCutoff(policyConfig.shiftAbsentCutoffMinutes);
                  setPolOtMin(policyConfig.overtimeMinimumMinutes);
                  setPolPhotoIn(policyConfig.requireCheckInPhoto);
                  setPolPhotoOut(policyConfig.requireCheckOutPhoto);
                  setPolicyModalOpen(true);
                }}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap self-start sm:self-auto"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Global Attendance Policy</span>
              </button>
            )}
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
                                  setQrActiveModalOpen(true);
                                }}
                                className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                                <span>Shift QR</span>
                              </button>
                            )}
                            {canEditGpsSettings ? (
                              <button
                                type="button"
                                onClick={() => openGeoConfigModal(s)}
                                className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
                              >
                                <Settings2 className="w-3.5 h-3.5 text-[#5C3D2E]" />
                                <span>Configure</span>
                              </button>
                            ) : user.role === 'hr' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setModalError(null);
                                  setOverrideReqSite(s);
                                  setOverrideRadius(geo.allowedRadiusMeters + 100);
                                  setOverrideReason('');
                                }}
                                className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap"
                              >
                                <span>Request Radius Override</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {geoApprovals.length > 0 && (
            <div className="pt-4 border-t border-[#E5DDD2] space-y-3">
              <h3 className="font-display text-sm font-semibold text-[#1F1916]">
                Site Geofence Radius Override Approval Requests
              </h3>
              <div className="divide-y divide-[#E5DDD2]">
                {geoApprovals.map((app) => (
                  <div
                    key={app.approvalId}
                    className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-[#1F1916]">
                        <span className="font-mono-tabular text-[#5C3D2E]">{app.approvalId}</span> ·{' '}
                        {app.siteName} ({app.currentRadiusMeters}m &rarr;{' '}
                        {app.requestedRadiusMeters}m)
                      </div>
                      <div className="text-[#574B43]">
                        Requested by {app.requestedByName} · Reason: {app.reason}
                      </div>
                    </div>
                    {app.status === 'Pending' && isAdmin ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleAdminDecideGeoApproval(app.approvalId, 'Rejected')}
                          className="min-h-[36px] px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] font-semibold text-[#B91C1C]"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAdminDecideGeoApproval(app.approvalId, 'Approved')}
                          className="min-h-[36px] px-3 py-1 rounded-lg bg-[#5C3D2E] font-semibold text-white"
                        >
                          Approve
                        </button>
                      </div>
                    ) : (
                      <span className="font-semibold text-[#5C3D2E]">{app.status}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB 5: 12 PHASE 4 ATTENDANCE REPORTS & BRANDED PDF EXPORT */}
      {activeTab === 'reports' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                REXON Phase 4 Operational Attendance Reports ({fromDate} to {toDate})
              </h2>
              <p className="text-xs text-[#574B43]">
                Select any of the 12 official report types below and export as a branded REXON PDF
                statement, CSV, or Excel workbook.
              </p>
            </div>

            {canExport && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={reportDataset.rows.length === 0}
                  onClick={() => exportCurrentReport('pdf_print')}
                  className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-45 whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print / Save Branded PDF</span>
                </button>
                <button
                  type="button"
                  disabled={reportDataset.rows.length === 0}
                  onClick={() => exportCurrentReport('pdf_download')}
                  className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
                >
                  <FileText className="w-3.5 h-3.5 text-[#5C3D2E]" />
                  <span>Download Statement</span>
                </button>
                <button
                  type="button"
                  disabled={reportDataset.rows.length === 0}
                  onClick={() => exportCurrentReport('csv')}
                  className="min-h-[42px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-[#5C3D2E]" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  disabled={reportDataset.rows.length === 0}
                  onClick={() => exportCurrentReport('excel')}
                  className="min-h-[42px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#5C3D2E]" />
                  <span>Excel</span>
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {ATTENDANCE_REPORT_TYPES.map((repName) => {
              const active = selectedReportType === repName;
              return (
                <button
                  key={repName}
                  type="button"
                  onClick={() => setSelectedReportType(repName)}
                  className={`min-h-[42px] px-3 py-2 rounded-lg border text-left text-xs font-semibold transition-colors truncate ${
                    active
                      ? 'bg-[#5C3D2E] border-[#5C3D2E] text-white'
                      : 'bg-[#FAF8F5] border-[#E5DDD2] text-[#1F1916] hover:border-[#5C3D2E]'
                  }`}
                >
                  {repName}
                </button>
              );
            })}
          </div>

          {/* Summary Totals Strip */}
          <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
            {reportDataset.summaryMetrics.map((m) => (
              <div key={m.label}>
                <span className="text-[#7D6F65] block truncate">{m.label}</span>
                <span className="mt-0.5 block font-mono-tabular text-base font-bold text-[#1F1916]">
                  {m.value}
                </span>
              </div>
            ))}
          </div>

          {reportDataset.rows.length === 0 ? (
            <EmptyStatePanel
              icon={FileText}
              title={`No Rows for ${selectedReportType}`}
              description="Adjust the date range, branch, client, or site filter above to generate this report."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    {reportDataset.columns.map((col) => (
                      <th
                        key={col.header}
                        className={`py-3 px-3 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                      >
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-xs">
                  {reportDataset.rows.slice(0, 60).map((row, idx) => (
                    <tr key={idx} className="hover:bg-[#FAF8F5]">
                      {row.map((cell, cIdx) => {
                        const col = reportDataset.columns[cIdx];
                        return (
                          <td
                            key={cIdx}
                            className={`py-2.5 px-3 text-[#1F1916] ${
                              col?.align === 'right'
                                ? 'text-right font-mono-tabular'
                                : 'text-left'
                            }`}
                          >
                            {cell}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 6: AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Immutable Attendance, Shift &amp; Roster Audit History
            </h2>
            <p className="text-xs text-[#574B43]">
              Every shift master update, roster publish/copy, GPS/photo check-in, HR time
              correction, Field Officer report, and overtime decision is permanently logged.
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
                    <th className="py-3 px-3">Before / After Summary &amp; Reason</th>
                    <th className="py-3 px-3">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {auditLogs.slice(0, 80).map((log) => (
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
                        {log.previousValueSummary && (
                          <div className="text-[#7D6F65]">Before: {log.previousValueSummary}</div>
                        )}
                        <div className="text-[#1F1916]">{log.newValueSummary}</div>
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
                  Record Present, Weekly Off, Holiday, Leave, or Absent entries with mandatory audit
                  remarks.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center text-[#7D6F65]"
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
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                    className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Shift</label>
                  <select
                    value={manShift}
                    onChange={(e) => setManShift(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    {ATTENDANCE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(manStatus === 'Present' ||
                manStatus === 'Late' ||
                manStatus === 'Half Day' ||
                manStatus === 'On Duty') && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Sched Start
                    </label>
                    <input
                      type="time"
                      value={manSchedStart}
                      onChange={(e) => setManSchedStart(e.target.value)}
                      className="w-full min-h-[42px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                      className="w-full min-h-[42px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                      className="w-full min-h-[42px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                      className="w-full min-h-[42px] px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Attendance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ENHANCED HR VERIFY, PHOTO/GPS INSPECTION & TIME CORRECTION */}
      {verifyingRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 my-8">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <div>
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  HR Attendance Verification — {verifyingRecord.attendanceId}
                </h3>
                <p className="mt-0.5 text-xs text-[#574B43]">
                  {verifyingRecord.employeeName} ({verifyingRecord.employeeId}) ·{' '}
                  {verifyingRecord.attendanceDate} · {verifyingRecord.siteName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVerifyingRecord(null)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center text-[#7D6F65]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* GPS & Photo Evidence Panel */}
            <div className="mt-4 p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="font-semibold text-[#1F1916] block">
                    GPS Location Verification
                  </span>
                  <span className="text-[#574B43] block mt-0.5">
                    Status: <strong>{deriveAttendanceLocationStatus(verifyingRecord)}</strong>
                  </span>
                  {verifyingRecord.checkInGeo && (
                    <span className="font-mono-tabular text-[11px] text-[#574B43] block">
                      In: {verifyingRecord.checkInGeo.latitude ?? '—'},{' '}
                      {verifyingRecord.checkInGeo.longitude ?? '—'} (
                      {verifyingRecord.checkInGeo.distanceMeters ?? '—'}m /{' '}
                      {verifyingRecord.checkInGeo.allowedRadiusMeters}m)
                    </span>
                  )}
                  {verifyingRecord.checkOutGeo && (
                    <span className="font-mono-tabular text-[11px] text-[#574B43] block">
                      Out: {verifyingRecord.checkOutGeo.latitude ?? '—'},{' '}
                      {verifyingRecord.checkOutGeo.longitude ?? '—'} (
                      {verifyingRecord.checkOutGeo.distanceMeters ?? '—'}m)
                    </span>
                  )}
                </div>

                <div>
                  <span className="font-semibold text-[#1F1916] block">
                    Recorded Punches &amp; Hours
                  </span>
                  <span className="font-mono-tabular text-[#574B43] block mt-0.5">
                    Scheduled: {verifyingRecord.scheduledStartTime}–
                    {verifyingRecord.scheduledEndTime} ({verifyingRecord.shiftType})
                  </span>
                  <span className="font-mono-tabular text-[#1F1916] block">
                    Actual: In {formatTimeShort(verifyingRecord.checkInAt)} · Out{' '}
                    {formatTimeShort(verifyingRecord.checkOutAt)} ({verifyingRecord.totalDutyHours}
                    h)
                  </span>
                </div>
              </div>

              {(verifyingRecord.checkInPhoto?.previewUrl ||
                verifyingRecord.checkOutPhoto?.previewUrl) && (
                <div className="pt-3 border-t border-[#E5DDD2] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#1F1916]">
                      Captured Attendance Verification Photos
                    </span>
                    <span className="text-[11px] text-[#7D6F65]">
                      Visual HR check only — zero automated biometric recognition
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {verifyingRecord.checkInPhoto?.previewUrl && (
                      <div className="flex items-center gap-3 p-2 rounded-lg bg-white border border-[#E5DDD2]">
                        <img
                          src={verifyingRecord.checkInPhoto.previewUrl}
                          alt="Check-in verification"
                          referrerPolicy="no-referrer"
                          className="w-16 h-16 rounded-lg object-cover border border-[#D4C7B8]"
                        />
                        <div className="text-[11px]">
                          <div className="font-semibold text-[#1F1916]">Check-In Photo</div>
                          <div className="text-[#574B43]">
                            Camera: {verifyingRecord.checkInPhoto.cameraFacing}
                          </div>
                          <div className="font-mono-tabular text-[#7D6F65]">
                            {formatTimeShort(verifyingRecord.checkInPhoto.captureTime)}
                          </div>
                        </div>
                      </div>
                    )}
                    {verifyingRecord.checkOutPhoto?.previewUrl && (
                      <div className="flex items-center gap-3 p-2 rounded-lg bg-white border border-[#E5DDD2]">
                        <img
                          src={verifyingRecord.checkOutPhoto.previewUrl}
                          alt="Check-out verification"
                          referrerPolicy="no-referrer"
                          className="w-16 h-16 rounded-lg object-cover border border-[#D4C7B8]"
                        />
                        <div className="text-[11px]">
                          <div className="font-semibold text-[#1F1916]">Check-Out Photo</div>
                          <div className="text-[#574B43]">
                            Camera: {verifyingRecord.checkOutPhoto.cameraFacing}
                          </div>
                          <div className="font-mono-tabular text-[#7D6F65]">
                            {formatTimeShort(verifyingRecord.checkOutPhoto.captureTime)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(verifyingRecord.timeCorrectionHistory?.length ?? 0) > 0 && (
                <div className="pt-3 border-t border-[#E5DDD2] space-y-1">
                  <span className="font-semibold text-[#5C3D2E] block">
                    Preserved Time Correction History
                  </span>
                  {verifyingRecord.timeCorrectionHistory?.map((h, i) => (
                    <div key={i} className="text-[11px] text-[#574B43] font-mono-tabular">
                      {h.correctedByName}: In {formatTimeShort(h.previousCheckInAt)}&rarr;
                      {formatTimeShort(h.newCheckInAt)} · Out{' '}
                      {formatTimeShort(h.previousCheckOutAt)}&rarr;
                      {formatTimeShort(h.newCheckOutAt)} ({h.reason})
                    </div>
                  ))}
                </div>
              )}
            </div>

            {modalError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}

            <form onSubmit={(e) => void handleVerifySubmit(e)} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    HR Verification Decision
                  </label>
                  <select
                    value={verDecision}
                    onChange={(e) =>
                      setVerDecision(e.target.value as AttendanceVerificationStatus)
                    }
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="Verified">Verified (Payroll Eligible)</option>
                    <option value="Exception Approved">
                      Exception Approved (Payroll Eligible)
                    </option>
                    <option value="Rejected">Rejected (Excluded from Payroll)</option>
                    <option value="Pending">Keep Pending Review</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Attendance Status
                  </label>
                  <select
                    value={verDecision === 'Rejected' ? 'Rejected' : verStatus}
                    disabled={verDecision === 'Rejected'}
                    onChange={(e) => setVerStatus(e.target.value as AttendanceStatus)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg disabled:opacity-60"
                  >
                    {ATTENDANCE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-[#5C3D2E]">
                <input
                  type="checkbox"
                  checked={verCorrectTimes}
                  onChange={(e) => setVerCorrectTimes(e.target.checked)}
                  className="w-4 h-4 accent-[#5C3D2E]"
                />
                <span>
                  Correct Check-In / Check-Out Timestamps (Preserves original punch in audit
                  history)
                </span>
              </label>

              {verCorrectTimes && (
                <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#D4C7B8] space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                        Corrected Check-In
                      </label>
                      <input
                        type="time"
                        value={verCheckIn24h}
                        onChange={(e) => setVerCheckIn24h(e.target.value)}
                        className="w-full min-h-[42px] px-3 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                        Corrected Check-Out
                      </label>
                      <input
                        type="time"
                        value={verCheckOut24h}
                        onChange={(e) => setVerCheckOut24h(e.target.value)}
                        className="w-full min-h-[42px] px-3 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg"
                      />
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-2 text-xs text-[#574B43]">
                        <input
                          type="checkbox"
                          checked={verCheckOutNextDay}
                          onChange={(e) => setVerCheckOutNextDay(e.target.checked)}
                          className="w-4 h-4 accent-[#5C3D2E]"
                        />
                        <span>Next Day (+1d)</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Mandatory Time Correction Reason
                    </label>
                    <input
                      type="text"
                      value={verCorrectionReason}
                      onChange={(e) => setVerCorrectionReason(e.target.value)}
                      placeholder="e.g. Gate register verified with Field Officer at 20:05"
                      maxLength={240}
                      className="w-full min-h-[42px] px-3 py-1.5 text-xs bg-white border border-[#E5DDD2] rounded-lg"
                      required
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  HR Verification Remarks{' '}
                  {(verDecision === 'Rejected' || verDecision === 'Exception Approved') &&
                    '(Mandatory)'}
                </label>
                <textarea
                  rows={2}
                  value={verRemarks}
                  onChange={(e) => setVerRemarks(e.target.value)}
                  placeholder="Enter HR verification or exception approval justification..."
                  maxLength={300}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required={verDecision === 'Rejected' || verDecision === 'Exception Approved'}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setVerifyingRecord(null)}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save HR Decision'}
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
              Regular Duty: {otRecord.totalDutyHours}h · Extra Duty: {otRecord.overtimeMinutes} mins
              ({otRecord.attendanceDate})
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
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                    className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  {submitting ? 'Saving...' : 'Submit Decision'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: FIELD OFFICER QUICK REMARK */}
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
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
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
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
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
                className="min-h-[38px] min-w-[38px] flex items-center justify-center text-[#7D6F65]"
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
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#E5DDD2] whitespace-nowrap"
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
                    placeholder="e.g. 28.6139"
                    className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                    placeholder="e.g. 77.2090"
                    className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                    className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Max GPS Accuracy (Meters)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    value={geoAccThreshold}
                    onChange={(e) => setGeoAccThreshold(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-[#1F1916]">
                  <input
                    type="checkbox"
                    checked={geoMandatory}
                    onChange={(e) => setGeoMandatory(e.target.checked)}
                    className="w-4 h-4 accent-[#5C3D2E]"
                  />
                  <span>Enforce geofence boundary (flag outside-radius punches as Exception)</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-[#1F1916]">
                  <input
                    type="checkbox"
                    checked={geoQrEnabled}
                    onChange={(e) => setGeoQrEnabled(e.target.checked)}
                    className="w-4 h-4 accent-[#5C3D2E]"
                  />
                  <span>Enable rotating HMAC-signed Shift QR attendance on this site</span>
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfiguringSite(null)}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  {submitting ? 'Saving...' : 'Save Geofence Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: HR REQUEST GEOFENCE OVERRIDE */}
      {overrideReqSite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <h3 className="font-display text-lg font-bold text-[#1F1916]">
              Request Site Radius Override — {overrideReqSite.siteName}
            </h3>
            <p className="mt-1 text-xs text-[#574B43]">
              Submit a site geofence radius adjustment for Administrator sign-off.
            </p>
            {modalError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}
            <form onSubmit={(e) => void handleRequestRadiusOverride(e)} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Requested Radius (Meters)
                </label>
                <input
                  type="number"
                  min={20}
                  max={5000}
                  value={overrideRadius}
                  onChange={(e) => setOverrideRadius(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Operational Reason
                </label>
                <textarea
                  rows={3}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Large warehouse perimeter requires 350m check-in radius..."
                  maxLength={280}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOverrideReqSite(null)}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white"
                >
                  {submitting ? 'Submitting...' : 'Submit to Admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 8: ADMIN GLOBAL ATTENDANCE POLICY */}
      {policyModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <div>
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  Global Attendance &amp; Geofence Policy Defaults
                </h3>
                <p className="text-xs text-[#574B43]">
                  Applies default radius, GPS accuracy, shift cutoff, and photo rules system-wide.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPolicyModalOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center text-[#7D6F65]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {modalError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}
            <form onSubmit={(e) => void handleSaveGlobalPolicy(e)} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Default Geofence Radius (m)
                  </label>
                  <input
                    type="number"
                    min={20}
                    max={5000}
                    value={polRadius}
                    onChange={(e) => setPolRadius(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Max GPS Accuracy (m)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    value={polAccuracy}
                    onChange={(e) => setPolAccuracy(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Shift Absent Cutoff (mins)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={720}
                    value={polCutoff}
                    onChange={(e) => setPolCutoff(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Minimum Overtime (mins)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={240}
                    value={polOtMin}
                    onChange={(e) => setPolOtMin(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-[#1F1916]">
                  <input
                    type="checkbox"
                    checked={polPhotoIn}
                    onChange={(e) => setPolPhotoIn(e.target.checked)}
                    className="w-4 h-4 accent-[#5C3D2E]"
                  />
                  <span>Require live camera photo on Employee Check-In</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-[#1F1916]">
                  <input
                    type="checkbox"
                    checked={polPhotoOut}
                    onChange={(e) => setPolPhotoOut(e.target.checked)}
                    className="w-4 h-4 accent-[#5C3D2E]"
                  />
                  <span>Require live camera photo on Employee Check-Out</span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPolicyModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white"
                >
                  Save Global Policy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 9: SUBMIT FIELD OFFICER REPORT */}
      {foReportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 my-8">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <div>
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  Submit Field Attendance / Site Visit Report
                </h3>
                <p className="text-xs text-[#574B43]">
                  Report Missing Attendance, Site Visits, or Employee Replacement Requirements.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFoReportModalOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center text-[#7D6F65]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {modalError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}
            <form onSubmit={(e) => void handleCreateFoReport(e)} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Site</label>
                  <select
                    value={foRepSiteId}
                    onChange={(e) => setFoRepSiteId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Report Type
                  </label>
                  <select
                    value={foRepType}
                    onChange={(e) => setFoRepType(e.target.value as FieldOfficerExceptionType)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    {FIELD_OFFICER_EXCEPTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
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
                    value={foRepDate}
                    onChange={(e) => setFoRepDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Shift</label>
                  <select
                    value={foRepShift}
                    onChange={(e) => setFoRepShift(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="All Shifts">All Shifts</option>
                    {ROSTER_SHIFT_TYPES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Employee (Optional)
                  </label>
                  <select
                    value={foRepEmpId}
                    onChange={(e) => setFoRepEmpId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="">Site-wide</option>
                    {employees.map((emp) => (
                      <option key={emp.employeeId} value={emp.employeeId}>
                        {emp.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">Summary</label>
                <input
                  type="text"
                  value={foRepSummary}
                  onChange={(e) => setFoRepSummary(e.target.value)}
                  placeholder="Short headline for HR queue..."
                  maxLength={150}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Detailed Field Remarks
                </label>
                <textarea
                  rows={3}
                  value={foRepRemarks}
                  onChange={(e) => setFoRepRemarks(e.target.value)}
                  placeholder="Detailed observations, post status, or replacement need..."
                  maxLength={380}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>

              <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {foRepPhoto && (
                    <img
                      src={foRepPhoto.previewDataUrl}
                      alt="Captured field photo"
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded-lg object-cover border border-[#D4C7B8]"
                    />
                  )}
                  <span className="text-xs text-[#574B43]">
                    {foRepPhoto ? 'Site photo attached' : 'Attach supporting site photo (optional)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setFoCameraOpen(true)}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E]"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{foRepPhoto ? 'Retake' : 'Camera'}</span>
                </button>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFoReportModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white"
                >
                  {submitting ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 10: HR REVIEW FIELD OFFICER REPORT */}
      {reviewingFoReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <h3 className="font-display text-lg font-bold text-[#1F1916]">
              Resolve Field Report — {reviewingFoReport.exceptionId}
            </h3>
            <p className="mt-1 text-xs text-[#574B43]">
              {reviewingFoReport.reportType} · {reviewingFoReport.siteName} (
              {reviewingFoReport.attendanceDate})
            </p>
            <p className="mt-2 p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs text-[#1F1916]">
              {reviewingFoReport.summary}: {reviewingFoReport.remarks}
            </p>
            {modalError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {modalError}
              </div>
            )}
            <form onSubmit={(e) => void handleReviewFoReport(e)} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">Decision</label>
                <select
                  value={foReviewDecision}
                  onChange={(e) => setFoReviewDecision(e.target.value as 'Resolved' | 'Rejected')}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                >
                  <option value="Resolved">Mark Resolved</option>
                  <option value="Rejected">Reject Report</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  HR Resolution Notes (Mandatory)
                </label>
                <textarea
                  rows={3}
                  value={foReviewNotes}
                  onChange={(e) => setFoReviewNotes(e.target.value)}
                  placeholder="Enter HR action taken (e.g. reliever deployed, attendance corrected)..."
                  maxLength={280}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReviewingFoReport(null)}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white"
                >
                  Save Resolution
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ROTATING SHIFT QR MODAL */}
      {qrLaunchSite && (
        <RotatingShiftQrModal
          open={qrActiveModalOpen}
          caller={user}
          isPreviewSession={isPreviewSession}
          siteId={qrLaunchSite.siteId}
          siteName={qrLaunchSite.siteName}
          attendanceDate={today}
          shiftType={qrShiftSelector}
          scheduledStartTime="08:00"
          scheduledEndTime="20:00"
          onClose={() => {
            setQrActiveModalOpen(false);
            setQrLaunchSite(null);
          }}
        />
      )}

      {/* CAMERA CAPTURE FOR FO REPORTS */}
      <CameraCaptureModal
        isOpen={foCameraOpen}
        title="Capture Field Verification Photo"
        subtitle="Capture site turnout, post inspection, or attendance verification evidence."
        defaultFacing="environment"
        onClose={() => setFoCameraOpen(false)}
        onCapture={(cap) => {
          setFoRepPhoto(cap);
          setFoCameraOpen(false);
        }}
      />
    </div>
  );
};
