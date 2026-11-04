import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  FileEdit,
  LogIn,
  LogOut,
  MapPin,
  Moon,
  Navigation,
  Printer,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import {
  CameraCaptureModal,
  CapturedAttendancePhoto,
} from '../../components/CameraCaptureModal';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  enqueueOfflineAttendancePunch,
  getEmployeeTodayDutyContext,
  listAttendanceCorrectionRequests,
  listAttendanceRecords,
  listEmployeeNotifications,
  listOfflineAttendanceQueue,
  markEmployeeNotificationRead,
  removeOfflineAttendanceQueueItem,
  submitAttendanceCorrectionRequest,
  submitEmployeeCheckIn,
  submitEmployeeCheckOut,
  subscribeAttendanceData,
  syncOfflineAttendanceQueue,
  uploadAttendanceVerificationPhoto,
} from '../../services/firestore/attendanceService';
import { subscribeDeploymentData } from '../../services/firestore/assignmentService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  AttendanceCorrectionRequest,
  AttendanceCorrectionType,
  AttendanceLocationStatus,
  AttendanceRecord,
  CORRECTION_REQUEST_TYPES,
  EmployeeCheckInInput,
  EmployeeCheckOutInput,
  EmployeeNotificationRecord,
  EmployeeTodayDutyContext,
  OfflineAttendanceQueueItem,
} from '../../types';
import { exportBrandedAttendancePdf } from '../../utils/attendancePdfExport';
import {
  DEFAULT_ALLOWED_RADIUS_METERS,
  calculateHaversineDistanceMeters,
  deriveAttendanceLocationStatus,
  deriveAttendanceVerificationStatus,
  isAttendancePayrollEligible,
} from '../../utils/attendanceValidation';
import { getTodayIsoDate } from '../../utils/deploymentValidation';

function formatPunchTime(iso: string | null | undefined): string {
  if (!iso) return '— : —';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

interface LiveGpsProbeState {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  locationStatus: AttendanceLocationStatus;
  detailMessage: string;
  probedAt: string;
}

export const MyAttendancePage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const today = useMemo(() => getTodayIsoDate(), []);

  const [loading, setLoading] = useState<boolean>(true);
  const [dutyCtx, setDutyCtx] = useState<EmployeeTodayDutyContext | null>(null);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrectionRequest[]>([]);
  const [notifications, setNotifications] = useState<EmployeeNotificationRecord[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<OfflineAttendanceQueueItem[]>([]);
  const [avatarFailed, setAvatarFailed] = useState<boolean>(false);

  // Check-In / Check-Out Interactive State
  const [punchMode, setPunchMode] = useState<'GPS' | 'QR'>('GPS');
  const [qrCodeInput, setQrCodeInput] = useState<string>('');
  const [punchLoading, setPunchLoading] = useState<boolean>(false);
  const [gpsProbing, setGpsProbing] = useState<boolean>(false);
  const [gpsProbe, setGpsProbe] = useState<LiveGpsProbeState | null>(null);
  const [syncingOffline, setSyncingOffline] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Camera Verification Photo State
  const [cameraOpen, setCameraOpen] = useState<boolean>(false);
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedAttendancePhoto | null>(null);

  // Explicit Pre-Submit Confirmation Modal State
  const [confirmDialog, setConfirmDialog] = useState<{
    action: 'check_in' | 'check_out';
    probe: LiveGpsProbeState | null;
    requiresExceptionReason: boolean;
  } | null>(null);
  const [exceptionReason, setExceptionReason] = useState<string>('');

  // Missing Punch / Attendance Correction Request Modal
  const [corrOpen, setCorrOpen] = useState<boolean>(false);
  const [corrType, setCorrType] = useState<AttendanceCorrectionType>('Missing Check-Out');
  const [corrDate, setCorrDate] = useState<string>(today);
  const [corrInTime, setCorrInTime] = useState<string>('08:00');
  const [corrOutTime, setCorrOutTime] = useState<string>('20:00');
  const [corrOutNextDay, setCorrOutNextDay] = useState<boolean>(false);
  const [corrReason, setCorrReason] = useState<string>('');
  const [corrLocationNote, setCorrLocationNote] = useState<string>('');
  const [corrError, setCorrError] = useState<string | null>(null);
  const [corrSubmitting, setCorrSubmitting] = useState<boolean>(false);

  const loadPersonalData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [ctx, attList, corrList, notifList] = await Promise.all([
        getEmployeeTodayDutyContext(user, isPreviewSession, today),
        listAttendanceRecords(user, isPreviewSession),
        listAttendanceCorrectionRequests(user, isPreviewSession),
        listEmployeeNotifications(user, isPreviewSession),
      ]);
      setDutyCtx(ctx);
      setHistory(attList);
      setCorrections(corrList);
      setNotifications(notifList);
      setOfflineQueue(listOfflineAttendanceQueue(user.uid));
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession, today]);

  useEffect(() => {
    void loadPersonalData();
    const u1 = subscribeAttendanceData(() => {
      if (user) {
        setOfflineQueue(listOfflineAttendanceQueue(user.uid));
      }
      void loadPersonalData();
    });
    const u2 = subscribeDeploymentData(() => void loadPersonalData());
    return () => {
      u1();
      u2();
    };
  }, [loadPersonalData, user]);

  // Determine active shift context (including open overnight shift started yesterday)
  const openOvernight = dutyCtx?.openOvernightAttendance ?? null;
  const activeRecord = openOvernight || dutyCtx?.todayAttendance || null;
  const activeRoster = dutyCtx?.activeRoster ?? null;
  const fallbackAsg = dutyCtx?.fallbackAssignment ?? null;
  const employeeProfile = dutyCtx?.employee ?? null;

  const displayEmployeeId = employeeProfile?.employeeId || user?.uid || '—';
  const displayEmployeeName = employeeProfile?.fullName || user?.fullName || 'Employee';
  const displayBranchName = employeeProfile?.branchName || user?.branchId || 'Assigned Branch';
  const profilePhotoUrl = !avatarFailed ? employeeProfile?.profilePhoto || '' : '';

  const targetBranchId =
    openOvernight?.branchId ||
    activeRoster?.branchId ||
    fallbackAsg?.branchId ||
    employeeProfile?.branchId ||
    user?.branchId ||
    'HQ';

  const targetSiteId =
    openOvernight?.siteId ||
    activeRoster?.siteId ||
    fallbackAsg?.siteId ||
    '';

  const targetSiteName =
    openOvernight?.siteName ||
    activeRoster?.siteName ||
    fallbackAsg?.siteName ||
    'No Active Site Assigned';

  const targetSiteAddress = dutyCtx?.siteGeoConfig?.fullAddress || '';

  const targetClientName =
    openOvernight?.clientName ||
    activeRoster?.clientName ||
    fallbackAsg?.clientName ||
    '';

  const targetServiceCategory =
    openOvernight?.serviceCategory ||
    activeRoster?.serviceCategory ||
    fallbackAsg?.serviceCategory ||
    '';

  const targetDesignation =
    openOvernight?.designationName ||
    activeRoster?.designationName ||
    fallbackAsg?.designationName ||
    '';

  const targetShiftLabel =
    openOvernight?.shiftType ||
    activeRoster?.shiftType ||
    fallbackAsg?.shift ||
    'Not Scheduled';

  const targetStartTime =
    openOvernight?.scheduledStartTime ||
    activeRoster?.dutyStartTime ||
    fallbackAsg?.shiftStartTime ||
    '—';

  const targetEndTime =
    openOvernight?.scheduledEndTime ||
    activeRoster?.dutyEndTime ||
    fallbackAsg?.shiftEndTime ||
    '—';

  const allowedRadiusMeters =
    dutyCtx?.siteGeoConfig?.allowedRadiusMeters || DEFAULT_ALLOWED_RADIUS_METERS;
  const accuracyThresholdMeters =
    dutyCtx?.siteGeoConfig?.gpsAccuracyThresholdMeters || 100;

  const isOvernightDuty = Boolean(
    openOvernight?.crossesMidnight || activeRoster?.crossesMidnight
  );

  const approvedLeaveToday = dutyCtx?.approvedLeaveToday ?? null;
  const isPhotoMandatory = Boolean(dutyCtx?.isPhotoRequired);

  const canCheckIn =
    Boolean(targetSiteId) &&
    !approvedLeaveToday &&
    !openOvernight &&
    !dutyCtx?.todayAttendance?.checkInAt;

  const canCheckOut =
    Boolean(activeRecord?.checkInAt) && !activeRecord?.checkOutAt;

  const activeVerificationLabel = activeRecord
    ? deriveAttendanceVerificationStatus(activeRecord)
    : 'Not Marked';
  const activePayrollReady = activeRecord ? isAttendancePayrollEligible(activeRecord) : false;

  const monthlyStats = useMemo(() => {
    const currentMonthPrefix = today.slice(0, 7);
    const monthRecs = history.filter((r) => r.attendanceDate.startsWith(currentMonthPrefix));
    const presentDays = monthRecs.filter(
      (r) =>
        r.status === 'Present' ||
        r.status === 'Late' ||
        r.status === 'Half Day' ||
        r.status === 'On Duty'
    ).length;
    const verifiedPayrollDays = monthRecs.filter((r) => isAttendancePayrollEligible(r)).length;
    const totalHours =
      Math.round(monthRecs.reduce((sum, r) => sum + (r.totalDutyHours || 0), 0) * 100) / 100;
    const approvedOtHours =
      Math.round(
        monthRecs
          .filter((r) => r.overtimeStatus === 'Approved')
          .reduce((sum, r) => sum + r.approvedOvertimeMinutes / 60, 0) * 100
      ) / 100;
    return { presentDays, verifiedPayrollDays, totalHours, approvedOtHours, monthRecs };
  }, [history, today]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.isRead),
    [notifications]
  );

  /**
   * Captures a single browser GPS fix ONLY on explicit user click (never continuous tracking)
   * and evaluates deterministic geofence distance & status without faking coordinates.
   */
  const runOneShotGpsProbe = useCallback(async (): Promise<LiveGpsProbeState> => {
    const nowIso = new Date().toISOString();
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return {
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        distanceMeters: null,
        locationStatus: 'Location Unavailable',
        detailMessage: 'Browser Geolocation API is not supported on this device.',
        probedAt: nowIso,
      };
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const acc = Math.round(pos.coords.accuracy);
          const siteLat = dutyCtx?.siteGeoConfig?.latitude ?? null;
          const siteLng = dutyCtx?.siteGeoConfig?.longitude ?? null;

          if (
            siteLat === null ||
            siteLng === null ||
            !Number.isFinite(siteLat) ||
            !Number.isFinite(siteLng)
          ) {
            resolve({
              latitude: lat,
              longitude: lng,
              accuracyMeters: acc,
              distanceMeters: null,
              locationStatus: 'Location Unavailable',
              detailMessage:
                'Device GPS acquired, but site geofence coordinates are not yet configured by HR/Admin.',
              probedAt: nowIso,
            });
            return;
          }

          const distanceMeters = calculateHaversineDistanceMeters(lat, lng, siteLat, siteLng);
          if (acc > accuracyThresholdMeters) {
            resolve({
              latitude: lat,
              longitude: lng,
              accuracyMeters: acc,
              distanceMeters,
              locationStatus: 'GPS Accuracy Low',
              detailMessage: `GPS accuracy (±${acc}m) is weaker than site threshold (±${accuracyThresholdMeters}m). Distance: ${distanceMeters}m.`,
              probedAt: nowIso,
            });
            return;
          }

          if (distanceMeters > allowedRadiusMeters) {
            resolve({
              latitude: lat,
              longitude: lng,
              accuracyMeters: acc,
              distanceMeters,
              locationStatus: 'Outside Geofence',
              detailMessage: `${distanceMeters}m from site center (Allowed radius <= ${allowedRadiusMeters}m).`,
              probedAt: nowIso,
            });
            return;
          }

          resolve({
            latitude: lat,
            longitude: lng,
            accuracyMeters: acc,
            distanceMeters,
            locationStatus: 'Within Geofence',
            detailMessage: `Verified ${distanceMeters}m from site center (±${acc}m accuracy · Allowed <= ${allowedRadiusMeters}m).`,
            probedAt: nowIso,
          });
        },
        (err) => {
          const isDenied = err.code === 1;
          resolve({
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            distanceMeters: null,
            locationStatus: isDenied ? 'GPS Permission Denied' : 'Location Unavailable',
            detailMessage: isDenied
              ? 'Location permission was denied in browser settings. Enable Location access or submit a flagged Exception.'
              : err.message || 'GPS signal unavailable indoors/offline.',
            probedAt: nowIso,
          });
        },
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 }
      );
    });
  }, [dutyCtx?.siteGeoConfig, accuracyThresholdMeters, allowedRadiusMeters]);

  const handleTestGpsSignal = async () => {
    setGpsProbing(true);
    try {
      const result = await runOneShotGpsProbe();
      setGpsProbe(result);
    } finally {
      setGpsProbing(false);
    }
  };

  const initiatePunchConfirmation = async (action: 'check_in' | 'check_out') => {
    if (!user) return;
    setBanner(null);
    setExceptionReason('');

    if (action === 'check_in' && !targetSiteId) return;
    if (action === 'check_out' && !activeRecord) return;

    if (punchMode === 'QR') {
      if (!qrCodeInput.trim()) {
        setBanner({
          type: 'error',
          text: 'Enter the 8-character rotating site shift code or scanned QR token before continuing.',
        });
        return;
      }
      setConfirmDialog({
        action,
        probe: null,
        requiresExceptionReason: false,
      });
      return;
    }

    // GPS Mode: acquire one-shot GPS probe before presenting confirmation modal
    setGpsProbing(true);
    try {
      const probe = await runOneShotGpsProbe();
      setGpsProbe(probe);
      const isNominal = probe.locationStatus === 'Within Geofence';
      setConfirmDialog({
        action,
        probe,
        requiresExceptionReason: !isNominal,
      });
    } finally {
      setGpsProbing(false);
    }
  };

  const handleConfirmPunchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !confirmDialog) return;

    const { action, probe, requiresExceptionReason } = confirmDialog;

    if (isPhotoMandatory && !capturedPhoto) {
      setBanner({
        type: 'error',
        text: 'Attendance policy requires a live verification photo before confirming Check-In / Check-Out.',
      });
      return;
    }

    if (requiresExceptionReason && exceptionReason.trim().length < 5) {
      setBanner({
        type: 'error',
        text: 'Provide a clear reason (at least 5 characters) when GPS is outside geofence or unavailable.',
      });
      return;
    }

    setPunchLoading(true);
    setBanner(null);

    try {
      // Upload / compress photo if captured
      let photoMeta = null;
      if (capturedPhoto) {
        photoMeta = await uploadAttendanceVerificationPhoto(
          user,
          isPreviewSession,
          capturedPhoto.file,
          {
            branchId: targetBranchId,
            employeeId: displayEmployeeId,
            siteId: targetSiteId || activeRecord?.siteId || 'SITE',
            attendanceId: activeRecord?.attendanceId,
            photoType: action,
            cameraFacing: capturedPhoto.cameraFacing,
          }
        );
      }

      const isDeviceOffline =
        typeof navigator !== 'undefined' && navigator.onLine === false;

      if (action === 'check_in') {
        const checkInPayload: EmployeeCheckInInput = {
          siteId: targetSiteId,
          rosterId: activeRoster?.rosterId,
          assignmentId: activeRoster?.assignmentId || fallbackAsg?.assignmentId,
          attendanceDate: today,
          method: punchMode,
          latitude: punchMode === 'GPS' ? probe?.latitude ?? null : null,
          longitude: punchMode === 'GPS' ? probe?.longitude ?? null : null,
          accuracyMeters: punchMode === 'GPS' ? probe?.accuracyMeters ?? null : null,
          gpsLocationStatus: punchMode === 'GPS' ? probe?.locationStatus : undefined,
          qrTokenOrCode: punchMode === 'QR' ? qrCodeInput.trim() : undefined,
          photo: photoMeta,
          submitAsException: requiresExceptionReason,
          exceptionReason: requiresExceptionReason ? exceptionReason.trim() : undefined,
        };

        if (isDeviceOffline) {
          enqueueOfflineAttendancePunch(user, {
            action: 'check_in',
            siteId: targetSiteId,
            siteName: targetSiteName,
            attendanceDate: today,
            checkInPayload,
          });
          setOfflineQueue(listOfflineAttendanceQueue(user.uid));
          setConfirmDialog(null);
          setCapturedPhoto(null);
          setExceptionReason('');
          setBanner({
            type: 'success',
            text: 'Device is offline: Check-In queued locally with idempotency protection. It will sync for HR verification once online (never finalized for payroll until HR-verified).',
          });
          return;
        }

        const created = await submitEmployeeCheckIn(user, isPreviewSession, checkInPayload);
        setConfirmDialog(null);
        setCapturedPhoto(null);
        setQrCodeInput('');
        setExceptionReason('');
        setBanner({
          type: 'success',
          text:
            punchMode === 'QR'
              ? `Shift QR Check-In recorded at ${formatPunchTime(created.checkInAt)} (${created.status} · Pending HR Verification).`
              : `Check-In recorded at ${formatPunchTime(created.checkInAt)} · ${
                  created.locationStatus || deriveAttendanceLocationStatus(created)
                } (${created.status} · Pending HR Verification).`,
        });
      } else if (activeRecord) {
        const checkOutPayload: EmployeeCheckOutInput = {
          attendanceId: activeRecord.attendanceId,
          method: punchMode,
          latitude: punchMode === 'GPS' ? probe?.latitude ?? null : null,
          longitude: punchMode === 'GPS' ? probe?.longitude ?? null : null,
          accuracyMeters: punchMode === 'GPS' ? probe?.accuracyMeters ?? null : null,
          gpsLocationStatus: punchMode === 'GPS' ? probe?.locationStatus : undefined,
          qrTokenOrCode: punchMode === 'QR' ? qrCodeInput.trim() : undefined,
          photo: photoMeta,
          exceptionReason: requiresExceptionReason ? exceptionReason.trim() : undefined,
        };

        if (isDeviceOffline) {
          enqueueOfflineAttendancePunch(user, {
            action: 'check_out',
            siteId: activeRecord.siteId,
            siteName: activeRecord.siteName,
            attendanceDate: activeRecord.attendanceDate,
            checkOutPayload,
          });
          setOfflineQueue(listOfflineAttendanceQueue(user.uid));
          setConfirmDialog(null);
          setCapturedPhoto(null);
          setExceptionReason('');
          setBanner({
            type: 'success',
            text: 'Device is offline: Check-Out queued locally and will sync when connectivity returns.',
          });
          return;
        }

        const updated = await submitEmployeeCheckOut(user, isPreviewSession, checkOutPayload);
        setConfirmDialog(null);
        setCapturedPhoto(null);
        setQrCodeInput('');
        setExceptionReason('');
        setBanner({
          type: 'success',
          text: `Check-Out recorded at ${formatPunchTime(updated.checkOutAt)} · Net Worked: ${updated.totalDutyHours}h (${updated.status} · Pending HR Verification).`,
        });
      }
    } catch (err) {
      const msg = formatServiceErrorMessage(err);
      setBanner({ type: 'error', text: msg });
    } finally {
      setPunchLoading(false);
    }
  };

  const handleSyncOfflineNow = async () => {
    if (!user || syncingOffline) return;
    setSyncingOffline(true);
    try {
      const res = await syncOfflineAttendanceQueue(user, isPreviewSession);
      setOfflineQueue(listOfflineAttendanceQueue(user.uid));
      await loadPersonalData();
      setBanner({
        type: res.failedCount > 0 ? 'error' : 'success',
        text:
          res.syncedCount > 0
            ? `Synchronized ${res.syncedCount} queued offline punch(es) for HR verification.${
                res.failedCount > 0 ? ` ${res.failedCount} item(s) still pending.` : ''
              }`
            : 'Offline queue could not sync yet. Check internet connectivity or error note.',
      });
    } finally {
      setSyncingOffline(false);
    }
  };

  const handleExportMonthlyStatement = (mode: 'print' | 'download') => {
    const monthLabel = today.slice(0, 7);
    const headers = [
      'Duty Date',
      'Site',
      'Shift',
      'Check-In',
      'Check-Out',
      'Net Hours',
      'Approved OT (h)',
      'Status',
      'HR Verification',
    ];
    const rows = monthlyStats.monthRecs.map((r) => [
      r.attendanceDate,
      r.siteName,
      r.shiftType,
      formatPunchTime(r.checkInAt),
      formatPunchTime(r.checkOutAt),
      r.totalDutyHours,
      r.overtimeStatus === 'Approved'
        ? Math.round((r.approvedOvertimeMinutes / 60) * 100) / 100
        : 0,
      r.status,
      deriveAttendanceVerificationStatus(r),
    ]);

    exportBrandedAttendancePdf(
      {
        reportTitle: 'Personal Monthly Attendance Statement',
        subtitle: `${displayEmployeeName} (${displayEmployeeId}) · ${displayBranchName}`,
        dateRangeLabel: `Month: ${monthLabel}`,
        generatedBy: `${displayEmployeeName} (Employee Portal)`,
        branchOrSiteLabel: targetSiteName,
        summaryMetrics: [
          { label: 'Present Shifts', value: monthlyStats.presentDays },
          { label: 'Payroll-Verified Days', value: monthlyStats.verifiedPayrollDays },
          { label: 'Total Net Hours', value: `${monthlyStats.totalHours}h` },
          { label: 'Approved Overtime', value: `${monthlyStats.approvedOtHours}h` },
        ],
        headers,
        rows,
        footerNote:
          'Only HR-Verified or Exception-Approved attendance days are eligible for monthly payroll processing.',
        filenameSlug: `rexon-my-attendance-${displayEmployeeId}-${monthLabel}`,
      },
      mode
    );
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !targetSiteId) {
      setCorrError('An assigned site is required to submit an attendance correction.');
      return;
    }
    setCorrError(null);
    setCorrSubmitting(true);
    try {
      await submitAttendanceCorrectionRequest(user, isPreviewSession, {
        requestType: corrType,
        siteId: targetSiteId,
        attendanceDate: corrDate,
        shiftType: targetShiftLabel,
        requestedCheckInTime: corrType === 'Missing Check-Out' ? undefined : corrInTime,
        requestedCheckOutTime: corrType === 'Missing Check-In' ? undefined : corrOutTime,
        requestedCheckOutNextDay: corrOutNextDay,
        reason: corrReason,
        supportingLocationNote: corrLocationNote,
      });
      setCorrOpen(false);
      setCorrReason('');
      setCorrLocationNote('');
      setBanner({
        type: 'success',
        text: 'Attendance correction request submitted to Branch HR for verification.',
      });
    } catch (err) {
      setCorrError(formatServiceErrorMessage(err));
    } finally {
      setCorrSubmitting(false);
    }
  };

  if (!user) return null;

  const initials = displayEmployeeName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="space-y-6">
      {/* Header & Primary Employee Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-3.5">
          {profilePhotoUrl ? (
            <img
              src={profilePhotoUrl}
              alt={`${displayEmployeeName} profile photo`}
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
              className="w-14 h-14 rounded-xl object-cover border border-[#D4C7B8] shrink-0 bg-[#F3EDE4]"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-[#5C3D2E] text-white font-display font-bold text-base flex items-center justify-center shrink-0">
              {initials || 'RX'}
            </div>
          )}
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
              My Duty &amp; Attendance
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#574B43]">
              <span className="font-semibold text-[#1F1916]">{displayEmployeeName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                ID: {displayEmployeeId}
              </span>
              <span aria-hidden="true">·</span>
              <span>{displayBranchName}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={monthlyStats.monthRecs.length === 0}
            onClick={() => handleExportMonthlyStatement('print')}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
          >
            <Printer className="w-4 h-4 text-[#5C3D2E]" />
            <span>Print / Save Monthly PDF</span>
          </button>

          <button
            type="button"
            disabled={monthlyStats.monthRecs.length === 0}
            onClick={() => handleExportMonthlyStatement('download')}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
          >
            <Download className="w-4 h-4 text-[#5C3D2E]" />
            <span>Download HTML</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCorrError(null);
              setCorrDate(today);
              setCorrOpen(true);
            }}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
          >
            <FileEdit className="w-4 h-4" />
            <span>Request Missing Punch / Correction</span>
          </button>
        </div>
      </div>

      {/* Approved Leave Notice */}
      {approvedLeaveToday && (
        <section className="bg-[#F3EDE4] border border-[#D4C7B8] rounded-xl p-4 text-xs text-[#4A3023]">
          <span className="font-semibold">Approved Leave Today ({approvedLeaveToday.leaveType}): </span>
          <span>
            You have an approved leave from {approvedLeaveToday.startDate} to{' '}
            {approvedLeaveToday.endDate} ({approvedLeaveToday.reason || 'HR Approved'}). Check-In is
            paused for today.
          </span>
        </section>
      )}

      {/* Pending Offline Attendance Sync Queue */}
      {offlineQueue.length > 0 && (
        <section className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#92400E]">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>
                Pending Offline Attendance Queue ({offlineQueue.length}) · Excluded from payroll
                until synced &amp; HR-verified
              </span>
            </div>
            <button
              type="button"
              disabled={syncingOffline}
              onClick={() => void handleSyncOfflineNow()}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50 self-start sm:self-auto whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingOffline ? 'animate-spin' : ''}`} />
              <span>{syncingOffline ? 'Syncing...' : 'Sync Now'}</span>
            </button>
          </div>
          <div className="divide-y divide-[#FDE68A] text-xs">
            {offlineQueue.map((item) => (
              <div
                key={item.queueId}
                className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <span className="font-semibold text-[#1F1916]">
                    {item.action === 'check_in' ? 'Check-In' : 'Check-Out'} · {item.siteName}
                  </span>
                  <span className="text-[#574B43] font-mono-tabular">
                    {' '}
                    · {item.attendanceDate} · Captured {formatPunchTime(item.capturedAt)} · Retries:{' '}
                    {item.retryCount}
                  </span>
                  {item.lastError && <div className="text-[#92400E] mt-0.5">{item.lastError}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    removeOfflineAttendanceQueueItem(item.queueId);
                    setOfflineQueue(listOfflineAttendanceQueue(user.uid));
                  }}
                  className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-[#FDE68A] text-xs font-semibold text-[#B91C1C] self-start sm:self-auto whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Discard</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Unread Roster & Attendance Notifications */}
      {unreadNotifications.length > 0 && (
        <section className="bg-[#F3EDE4] border border-[#D4C7B8] rounded-xl p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#5C3D2E]">
            <Bell className="w-4 h-4" />
            <span>New Duty &amp; Attendance Updates ({unreadNotifications.length})</span>
          </div>
          <div className="divide-y divide-[#E5DDD2]">
            {unreadNotifications.slice(0, 4).map((n) => (
              <div
                key={n.notificationId}
                className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div>
                  <span className="font-semibold text-[#1F1916]">{n.title}: </span>
                  <span className="text-[#574B43]">{n.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void markEmployeeNotificationRead(user, isPreviewSession, n.notificationId)
                  }
                  className="min-h-[36px] px-2 text-xs font-semibold text-[#5C3D2E] hover:underline self-start sm:self-auto whitespace-nowrap"
                >
                  Mark Read
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

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
            className="min-h-[36px] px-2 font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Today's Duty Details + Check-In / Check-Out Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Today's Assigned Duty Card */}
        <section className="lg:col-span-7 bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#7D6F65]">
              <span>
                {openOvernight
                  ? `Open Overnight Shift (Started ${openOvernight.attendanceDate})`
                  : `Today's Duty Schedule · ${today}`}
              </span>
              {isOvernightDuty && (
                <span className="inline-flex items-center gap-1 font-semibold text-[#5C3D2E]">
                  <Moon className="w-3.5 h-3.5" />
                  <span>Overnight Shift (+1 Day)</span>
                </span>
              )}
            </div>

            <h2 className="font-display text-xl font-bold text-[#1F1916]">{targetSiteName}</h2>
            {targetSiteAddress && (
              <p className="text-xs text-[#574B43]">{targetSiteAddress}</p>
            )}
            {(targetClientName || targetServiceCategory || targetDesignation) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#574B43]">
                {targetClientName && <span>{targetClientName}</span>}
                {targetClientName && targetServiceCategory && <span aria-hidden="true">·</span>}
                {targetServiceCategory && <span>{targetServiceCategory}</span>}
                {targetDesignation && <span aria-hidden="true">·</span>}
                {targetDesignation && (
                  <span className="font-semibold text-[#1F1916]">{targetDesignation}</span>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-[#E5DDD2] text-xs">
            <div>
              <span className="block text-[#7D6F65]">Shift</span>
              <span className="font-semibold text-[#1F1916]">{targetShiftLabel}</span>
            </div>
            <div>
              <span className="block text-[#7D6F65]">Duty Hours</span>
              <span className="font-mono-tabular font-semibold text-[#1F1916]">
                {targetStartTime} – {targetEndTime}
              </span>
            </div>
            <div>
              <span className="block text-[#7D6F65]">Report By</span>
              <span className="font-mono-tabular font-semibold text-[#1F1916]">
                {activeRoster?.reportingTime || fallbackAsg?.reportingTime || '—'}
              </span>
            </div>
            <div>
              <span className="block text-[#7D6F65]">Geofence Radius</span>
              <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                {targetSiteId ? `${allowedRadiusMeters}m` : '—'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="block text-[#7D6F65]">Check-In</span>
              <span className="font-mono-tabular text-sm font-semibold text-[#1F1916]">
                {formatPunchTime(activeRecord?.checkInAt)}
              </span>
            </div>
            <div>
              <span className="block text-[#7D6F65]">Check-Out</span>
              <span className="font-mono-tabular text-sm font-semibold text-[#1F1916]">
                {formatPunchTime(activeRecord?.checkOutAt)}
              </span>
            </div>
            <div>
              <span className="block text-[#7D6F65]">Net Worked</span>
              <span className="font-mono-tabular text-sm font-semibold text-[#1F1916]">
                {activeRecord ? `${activeRecord.totalDutyHours}h` : '0h'}
              </span>
            </div>
            <div>
              <span className="block text-[#7D6F65]">Status &amp; HR Gate</span>
              <div className="font-semibold text-[#5C3D2E]">
                {activeRecord ? activeRecord.status : targetSiteId ? 'Awaiting Check-In' : 'Off Duty'}
              </div>
              {activeRecord && (
                <div className="text-[11px] text-[#574B43]">
                  {activeVerificationLabel} ·{' '}
                  {activePayrollReady ? 'Payroll Ready' : 'Excluded Until Verified'}
                </div>
              )}
            </div>
          </div>

          {(activeRoster?.dutyInstructions || fallbackAsg?.reportingInstructions) && (
            <p className="text-xs text-[#574B43]">
              Post Instructions:{' '}
              <span className="text-[#1F1916] font-medium">
                {activeRoster?.dutyInstructions || fallbackAsg?.reportingInstructions}
              </span>
            </p>
          )}
        </section>

        {/* Right: GPS + Photo + QR Check-In / Check-Out Action Console */}
        <section className="lg:col-span-5 bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-[#1F1916]">
                Verify Location, Photo &amp; Punch
              </h2>
              <ShieldCheck className="w-5 h-5 text-[#5C3D2E]" />
            </div>

            {/* Mode Switch: GPS vs Site QR */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-white border border-[#D4C7B8] rounded-lg">
              <button
                type="button"
                onClick={() => setPunchMode('GPS')}
                className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  punchMode === 'GPS'
                    ? 'bg-[#5C3D2E] text-white'
                    : 'text-[#574B43] hover:text-[#1F1916]'
                }`}
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>GPS Geofence</span>
              </button>
              <button
                type="button"
                onClick={() => setPunchMode('QR')}
                className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  punchMode === 'QR'
                    ? 'bg-[#5C3D2E] text-white'
                    : 'text-[#574B43] hover:text-[#1F1916]'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Site Shift QR</span>
              </button>
            </div>

            {punchMode === 'GPS' ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1F1916]">
                    One-Shot GPS Geofence Check
                  </span>
                  <button
                    type="button"
                    disabled={gpsProbing || !targetSiteId}
                    onClick={() => void handleTestGpsSignal()}
                    className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#FAF8F5] disabled:opacity-45 whitespace-nowrap"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{gpsProbing ? 'Checking GPS...' : 'Test GPS Signal'}</span>
                  </button>
                </div>

                {gpsProbe ? (
                  <div className="p-3 rounded-lg bg-white border border-[#D4C7B8] text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-semibold ${
                          gpsProbe.locationStatus === 'Within Geofence'
                            ? 'text-[#166534]'
                            : gpsProbe.locationStatus === 'GPS Permission Denied'
                              ? 'text-[#B91C1C]'
                              : 'text-[#B45309]'
                        }`}
                      >
                        {gpsProbe.locationStatus}
                      </span>
                      {gpsProbe.distanceMeters !== null && (
                        <span className="font-mono-tabular font-semibold text-[#1F1916]">
                          {gpsProbe.distanceMeters}m / {allowedRadiusMeters}m
                        </span>
                      )}
                    </div>
                    <p className="text-[#574B43]">{gpsProbe.detailMessage}</p>
                  </div>
                ) : (
                  <p className="text-xs text-[#574B43]">
                    Location is captured once when you tap Check In or Check Out and verified
                    against your site geofence ({allowedRadiusMeters}m). REXON never tracks location
                    in the background.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#1F1916]">
                  Enter Rotating 8-Char Shift Code or Scanned QR Token
                </label>
                <input
                  type="text"
                  value={qrCodeInput}
                  onChange={(e) => setQrCodeInput(e.target.value)}
                  placeholder="e.g. 001-A9F3K or rxqr1..."
                  className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-white border border-[#D4C7B8] rounded-lg focus:outline-none focus:border-[#5C3D2E]"
                />
              </div>
            )}

            {/* Live Attendance Photo Verification */}
            <div className="pt-2 border-t border-[#D4C7B8] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#1F1916]">
                  Attendance Photo {isPhotoMandatory ? '(Required)' : '(Recommended)'}
                </span>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#FAF8F5] whitespace-nowrap"
                >
                  <Camera className="w-3.5 h-3.5 text-[#5C3D2E]" />
                  <span>{capturedPhoto ? 'Retake Photo' : 'Capture Photo'}</span>
                </button>
              </div>

              {capturedPhoto ? (
                <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-white border border-[#D4C7B8] text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={capturedPhoto.previewDataUrl}
                      alt="Captured attendance verification preview"
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded-lg object-cover border border-[#E5DDD2] shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-[#166534] truncate">
                        Photo Ready ({capturedPhoto.cameraFacing === 'user' ? 'Front' : 'Rear'} Cam)
                      </div>
                      <div className="font-mono-tabular text-[#574B43]">
                        {formatPunchTime(capturedPhoto.capturedAt)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCapturedPhoto(null)}
                    className="min-h-[36px] px-2 text-xs font-semibold text-[#B91C1C] hover:underline shrink-0"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-[#574B43]">
                  Photos are stored privately for HR shift verification only (no automated facial
                  recognition).
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              disabled={!canCheckIn || punchLoading || gpsProbing}
              onClick={() => void initiatePunchConfirmation('check_in')}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-45 transition-colors whitespace-nowrap"
            >
              <LogIn className="w-4 h-4 shrink-0" />
              <span>{gpsProbing && canCheckIn ? 'Locating...' : 'Check In'}</span>
            </button>

            <button
              type="button"
              disabled={!canCheckOut || punchLoading || gpsProbing}
              onClick={() => void initiatePunchConfirmation('check_out')}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#FAF8F5] disabled:opacity-45 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-4 h-4 text-[#5C3D2E] shrink-0" />
              <span>{gpsProbing && canCheckOut ? 'Locating...' : 'Check Out'}</span>
            </button>
          </div>
        </section>
      </div>

      {/* Monthly KPI Summary */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Present Days (Month)"
          value={monthlyStats.presentDays}
          subtext="Marked duty shifts this month"
          icon={CalendarCheck}
        />
        <StatMetricCard
          label="Payroll-Verified Days"
          value={monthlyStats.verifiedPayrollDays}
          subtext="HR-verified days ready for payroll"
          icon={ShieldCheck}
        />
        <StatMetricCard
          label="Total Duty Hours"
          value={`${monthlyStats.totalHours}h`}
          subtext="Net worked hours this month"
          icon={Clock}
        />
        <StatMetricCard
          label="Approved Overtime"
          value={`${monthlyStats.approvedOtHours}h`}
          subtext="HR-approved extra duty hours"
          icon={CheckCircle2}
        />
      </section>

      {/* Personal Attendance History */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#1F1916]">
            My Attendance History
          </h2>
          <p className="text-xs text-[#574B43]">
            Verified attendance records cannot be edited directly; use Request Missing Punch /
            Correction if an adjustment is needed.
          </p>
        </div>

        {loading ? (
          <div className="py-10 text-center text-xs text-[#574B43]">
            Loading your personal attendance history...
          </div>
        ) : history.length === 0 ? (
          <EmptyStatePanel
            icon={CalendarCheck}
            title="No Attendance Records Logged Yet"
            description="Your daily GPS, Photo, and QR shift check-ins, duty hours, and HR-verified payroll statuses appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                  <th className="py-3 px-3">Duty Date</th>
                  <th className="py-3 px-3">Site &amp; Shift</th>
                  <th className="py-3 px-3">Check-In / Out</th>
                  <th className="py-3 px-3">Location &amp; Photo</th>
                  <th className="py-3 px-3 text-right">Net Hours</th>
                  <th className="py-3 px-3 text-right">Late / OT</th>
                  <th className="py-3 px-3">Status &amp; HR Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5DDD2] text-sm">
                {history.map((r) => {
                  const verStatus = deriveAttendanceVerificationStatus(r);
                  const locStatus = deriveAttendanceLocationStatus(r);
                  const payrollOk = isAttendancePayrollEligible(r);
                  return (
                    <tr key={r.attendanceId} className="hover:bg-[#FAF8F5]">
                      <td className="py-3 px-3 font-mono-tabular text-xs font-semibold text-[#1F1916] whitespace-nowrap">
                        {r.attendanceDate}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-[#1F1916]">{r.siteName}</div>
                        <div className="text-xs text-[#574B43]">
                          {r.shiftType} · {r.checkInMethod || 'Manual HR'}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono-tabular text-xs text-[#1F1916] whitespace-nowrap">
                        <div>In: {formatPunchTime(r.checkInAt)}</div>
                        <div className="text-[#574B43]">Out: {formatPunchTime(r.checkOutAt)}</div>
                      </td>
                      <td className="py-3 px-3 text-xs text-[#574B43] whitespace-nowrap">
                        <div>{locStatus}</div>
                        <div className="font-mono-tabular text-[11px] text-[#7D6F65]">
                          {r.checkInGeo?.distanceMeters !== null &&
                          r.checkInGeo?.distanceMeters !== undefined
                            ? `${r.checkInGeo.distanceMeters}m`
                            : '—'}
                          {' · '}
                          {r.checkInPhoto ? 'In Photo' : 'No In Photo'}
                          {r.checkOutPhoto ? ' / Out Photo' : ''}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular text-xs font-semibold text-[#1F1916] whitespace-nowrap">
                        {r.totalDutyHours}h
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                        {r.lateArrivalMinutes > 0 ? `Late ${r.lateArrivalMinutes}m ` : ''}
                        {r.overtimeMinutes > 0
                          ? `OT ${r.overtimeMinutes}m (${r.overtimeStatus})`
                          : r.lateArrivalMinutes === 0
                            ? '—'
                            : ''}
                      </td>
                      <td className="py-3 px-3 text-xs whitespace-nowrap">
                        <div>
                          <span
                            className={`font-semibold ${
                              r.status === 'Present'
                                ? 'text-[#166534]'
                                : r.status === 'Exception' ||
                                    r.status === 'Absent' ||
                                    r.status === 'Rejected'
                                  ? 'text-[#B91C1C]'
                                  : 'text-[#B45309]'
                            }`}
                          >
                            {r.status}
                          </span>
                          <span className="text-[#7D6F65]"> · {verStatus}</span>
                        </div>
                        <div className="text-[11px] text-[#574B43]">
                          {payrollOk ? 'Payroll Ready' : 'Excluded Until Verified'}
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

      {/* Personal Correction Requests */}
      {corrections.length > 0 && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-3">
          <h2 className="font-display text-base font-semibold text-[#1F1916]">
            My Attendance Correction Requests
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                  <th className="py-2.5 px-3">ID &amp; Date</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Reason &amp; HR Remarks</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5DDD2] text-xs">
                {corrections.map((c) => (
                  <tr key={c.correctionId}>
                    <td className="py-2.5 px-3 font-mono-tabular whitespace-nowrap">
                      <span className="font-semibold text-[#5C3D2E]">{c.correctionId}</span> ·{' '}
                      {c.attendanceDate}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-[#1F1916]">{c.requestType}</td>
                    <td className="py-2.5 px-3 text-[#574B43]">
                      <div>{c.reason}</div>
                      {c.reviewRemarks && (
                        <div className="text-[#5C3D2E]">HR: {c.reviewRemarks}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-semibold whitespace-nowrap">{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* CAMERA VERIFICATION MODAL */}
      <CameraCaptureModal
        isOpen={cameraOpen}
        title="Capture Attendance Verification Photo"
        subtitle={`${targetSiteName} · ${targetShiftLabel}`}
        defaultFacing="user"
        onClose={() => setCameraOpen(false)}
        onCapture={(photo) => {
          setCapturedPhoto(photo);
          setCameraOpen(false);
        }}
      />

      {/* CHECK-IN / CHECK-OUT PRE-SUBMIT CONFIRMATION MODAL */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/60 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-2xl p-5 sm:p-6 my-8 space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <div>
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  Confirm {confirmDialog.action === 'check_in' ? 'Shift Check-In' : 'Shift Check-Out'}
                </h3>
                <p className="text-xs text-[#574B43]">
                  Review duty site, location verification, and photo before recording punch.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleConfirmPunchSubmit(e)} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] text-xs space-y-2">
                <div className="flex justify-between gap-2">
                  <span className="text-[#7D6F65]">Assigned Site</span>
                  <span className="font-semibold text-[#1F1916] text-right">{targetSiteName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#7D6F65]">Shift &amp; Schedule</span>
                  <span className="font-mono-tabular font-semibold text-[#1F1916]">
                    {targetShiftLabel} ({targetStartTime}–{targetEndTime})
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#7D6F65]">Verification Method</span>
                  <span className="font-semibold text-[#5C3D2E]">{punchMode}</span>
                </div>

                {punchMode === 'GPS' && confirmDialog.probe && (
                  <div className="pt-2 border-t border-[#E5DDD2] space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="text-[#7D6F65]">GPS Status</span>
                      <span
                        className={`font-semibold ${
                          confirmDialog.probe.locationStatus === 'Within Geofence'
                            ? 'text-[#166534]'
                            : 'text-[#B45309]'
                        }`}
                      >
                        {confirmDialog.probe.locationStatus}
                      </span>
                    </div>
                    <p className="text-[#574B43]">{confirmDialog.probe.detailMessage}</p>
                  </div>
                )}

                <div className="pt-2 border-t border-[#E5DDD2] flex items-center justify-between gap-2">
                  <span className="text-[#7D6F65]">Verification Photo</span>
                  {capturedPhoto ? (
                    <div className="flex items-center gap-2">
                      <img
                        src={capturedPhoto.previewDataUrl}
                        alt="Verification thumbnail"
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 rounded object-cover border border-[#D4C7B8]"
                      />
                      <span className="font-semibold text-[#166534]">Attached</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCameraOpen(true)}
                      className="min-h-[36px] px-2.5 py-1 rounded-lg bg-white border border-[#D4C7B8] font-semibold text-[#5C3D2E]"
                    >
                      Capture Now
                    </button>
                  )}
                </div>
              </div>

              {confirmDialog.requiresExceptionReason && (
                <div className="p-3.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] space-y-2">
                  <div className="flex items-start gap-2 text-xs text-[#92400E]">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Location could not be verified inside the {allowedRadiusMeters}m site
                      geofence. Enter a reason to submit this punch as a flagged Exception for HR
                      verification.
                    </span>
                  </div>
                  <textarea
                    rows={2}
                    value={exceptionReason}
                    onChange={(e) => setExceptionReason(e.target.value)}
                    placeholder="e.g. Deployed at Rear Gate Post 3 / Basement patrol with weak indoor GPS..."
                    maxLength={240}
                    className="w-full px-3 py-2 text-xs bg-white border border-[#D4C7B8] rounded-lg"
                    required
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmDialog(null)}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={punchLoading}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50 whitespace-nowrap"
                >
                  {punchLoading
                    ? 'Submitting...'
                    : confirmDialog.requiresExceptionReason
                      ? 'Submit Flagged Exception'
                      : confirmDialog.action === 'check_in'
                        ? 'Confirm Check-In'
                        : 'Confirm Check-Out'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MISSING PUNCH / CORRECTION REQUEST MODAL */}
      {corrOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 my-8">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <h3 className="font-display text-lg font-bold text-[#1F1916]">
                Request Attendance Correction
              </h3>
              <button
                type="button"
                onClick={() => setCorrOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#7D6F65]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {corrError && (
              <div className="mt-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {corrError}
              </div>
            )}

            <form onSubmit={(e) => void handleSubmitCorrection(e)} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Request Type
                </label>
                <select
                  value={corrType}
                  onChange={(e) => setCorrType(e.target.value as AttendanceCorrectionType)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                >
                  {CORRECTION_REQUEST_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Duty Date
                </label>
                <input
                  type="date"
                  value={corrDate}
                  max={today}
                  onChange={(e) => setCorrDate(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {corrType !== 'Missing Check-Out' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Actual Check-In
                    </label>
                    <input
                      type="time"
                      value={corrInTime}
                      onChange={(e) => setCorrInTime(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                )}
                {corrType !== 'Missing Check-In' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Actual Check-Out
                    </label>
                    <input
                      type="time"
                      value={corrOutTime}
                      onChange={(e) => setCorrOutTime(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs text-[#574B43] min-h-[36px]">
                <input
                  type="checkbox"
                  checked={corrOutNextDay}
                  onChange={(e) => setCorrOutNextDay(e.target.checked)}
                  className="w-4 h-4 accent-[#5C3D2E]"
                />
                <span>Overnight shift: Check-Out was on the next morning (+1 day)</span>
              </label>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Detailed Reason (Mandatory)
                </label>
                <textarea
                  rows={3}
                  value={corrReason}
                  onChange={(e) => setCorrReason(e.target.value)}
                  placeholder="Explain missing punch or gate register entry time..."
                  maxLength={280}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Supporting Post / Supervisor Note (Optional)
                </label>
                <input
                  type="text"
                  value={corrLocationNote}
                  onChange={(e) => setCorrLocationNote(e.target.value)}
                  placeholder="e.g. Gate Register Entry #42 signed by Site Supervisor"
                  maxLength={200}
                  className="w-full min-h-[44px] px-3 py-2 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCorrOpen(false)}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={corrSubmitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
                >
                  {corrSubmitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
