import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileEdit,
  LogIn,
  LogOut,
  MapPin,
  Moon,
  Navigation,
  QrCode,
  ShieldCheck,
  X,
} from 'lucide-react';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  getEmployeeTodayDutyContext,
  listAttendanceCorrectionRequests,
  listAttendanceRecords,
  listEmployeeNotifications,
  markEmployeeNotificationRead,
  submitAttendanceCorrectionRequest,
  submitEmployeeCheckIn,
  submitEmployeeCheckOut,
  subscribeAttendanceData,
} from '../../services/firestore/attendanceService';
import { subscribeDeploymentData } from '../../services/firestore/assignmentService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  AttendanceCorrectionRequest,
  AttendanceCorrectionType,
  AttendanceRecord,
  CORRECTION_REQUEST_TYPES,
  EmployeeNotificationRecord,
  EmployeeTodayDutyContext,
} from '../../types';
import { getTodayIsoDate } from '../../utils/deploymentValidation';

function formatPunchTime(iso: string | null | undefined): string {
  if (!iso) return '— : —';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const MyAttendancePage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const today = useMemo(() => getTodayIsoDate(), []);

  const [loading, setLoading] = useState<boolean>(true);
  const [dutyCtx, setDutyCtx] = useState<EmployeeTodayDutyContext | null>(null);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrectionRequest[]>([]);
  const [notifications, setNotifications] = useState<EmployeeNotificationRecord[]>([]);

  // Check-In / Check-Out Interactive State
  const [punchMode, setPunchMode] = useState<'GPS' | 'QR'>('GPS');
  const [qrCodeInput, setQrCodeInput] = useState<string>('');
  const [punchLoading, setPunchLoading] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Geofence / GPS Exception Escalation State (shown when GPS check-in is blocked by radius/accuracy/unavailable)
  const [exceptionPrompt, setExceptionPrompt] = useState<{
    action: 'check_in' | 'check_out';
    reasonMessage: string;
    capturedLat: number | null;
    capturedLng: number | null;
    capturedAcc: number | null;
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
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession, today]);

  useEffect(() => {
    void loadPersonalData();
    const u1 = subscribeAttendanceData(() => void loadPersonalData());
    const u2 = subscribeDeploymentData(() => void loadPersonalData());
    return () => {
      u1();
      u2();
    };
  }, [loadPersonalData]);

  // Determine active shift context (including open overnight shift started yesterday)
  const openOvernight = dutyCtx?.openOvernightAttendance ?? null;
  const activeRecord = openOvernight || dutyCtx?.todayAttendance || null;
  const activeRoster = dutyCtx?.activeRoster ?? null;
  const fallbackAsg = dutyCtx?.fallbackAssignment ?? null;

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

  const targetClientName =
    openOvernight?.clientName ||
    activeRoster?.clientName ||
    fallbackAsg?.clientName ||
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

  const isOvernightDuty = Boolean(
    openOvernight?.crossesMidnight || activeRoster?.crossesMidnight
  );

  const canCheckIn =
    Boolean(targetSiteId) && !openOvernight && !dutyCtx?.todayAttendance?.checkInAt;
  const canCheckOut =
    Boolean(activeRecord?.checkInAt) && !activeRecord?.checkOutAt;

  const monthlyStats = useMemo(() => {
    const currentMonthPrefix = today.slice(0, 7);
    const monthRecs = history.filter((r) => r.attendanceDate.startsWith(currentMonthPrefix));
    const presentDays = monthRecs.filter(
      (r) => r.status === 'Present' || r.status === 'Late' || r.status === 'Half Day'
    ).length;
    const lateCount = monthRecs.filter((r) => r.lateArrivalMinutes > 0).length;
    const totalHours =
      Math.round(monthRecs.reduce((sum, r) => sum + (r.totalDutyHours || 0), 0) * 100) / 100;
    const approvedOtHours =
      Math.round(
        monthRecs
          .filter((r) => r.overtimeStatus === 'Approved')
          .reduce((sum, r) => sum + r.approvedOvertimeMinutes / 60, 0) * 100
      ) / 100;
    return { presentDays, lateCount, totalHours, approvedOtHours };
  }, [history, today]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.isRead),
    [notifications]
  );

  /**
   * Captures a single browser GPS fix ONLY on explicit user click (never continuous tracking).
   */
  const captureOneShotGps = (): Promise<{
    lat: number;
    lng: number;
    acc: number;
  }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Browser Geolocation API is not supported on this device.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy,
          });
        },
        (err) => {
          reject(new Error(err.message || 'Location permission denied or GPS signal unavailable.'));
        },
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 }
      );
    });
  };

  const handleCheckInClick = async () => {
    if (!user || !targetSiteId) return;
    setBanner(null);
    setExceptionPrompt(null);
    setPunchLoading(true);

    if (punchMode === 'QR') {
      try {
        const created = await submitEmployeeCheckIn(user, isPreviewSession, {
          siteId: targetSiteId,
          rosterId: activeRoster?.rosterId,
          assignmentId: activeRoster?.assignmentId || fallbackAsg?.assignmentId,
          attendanceDate: today,
          method: 'QR',
          qrTokenOrCode: qrCodeInput,
        });
        setQrCodeInput('');
        setBanner({
          type: 'success',
          text: `Shift QR Check-In verified at ${formatPunchTime(created.checkInAt)} (${created.status}).`,
        });
      } catch (err) {
        setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
      } finally {
        setPunchLoading(false);
      }
      return;
    }

    // GPS Mode
    let coords: { lat: number; lng: number; acc: number } | null = null;
    try {
      coords = await captureOneShotGps();
    } catch (gpsErr) {
      setPunchLoading(false);
      setExceptionPrompt({
        action: 'check_in',
        reasonMessage: formatServiceErrorMessage(gpsErr),
        capturedLat: null,
        capturedLng: null,
        capturedAcc: null,
      });
      return;
    }

    try {
      const created = await submitEmployeeCheckIn(user, isPreviewSession, {
        siteId: targetSiteId,
        rosterId: activeRoster?.rosterId,
        assignmentId: activeRoster?.assignmentId || fallbackAsg?.assignmentId,
        attendanceDate: today,
        method: 'GPS',
        latitude: coords.lat,
        longitude: coords.lng,
        accuracyMeters: coords.acc,
      });
      setBanner({
        type: 'success',
        text: `GPS Check-In verified at ${formatPunchTime(created.checkInAt)} (${
          created.checkInGeo?.distanceMeters ?? 0
        }m from site center · ${created.status}).`,
      });
    } catch (err) {
      const msg = formatServiceErrorMessage(err);
      if (msg.includes('outside') || msg.includes('accuracy') || msg.includes('Exception')) {
        setExceptionPrompt({
          action: 'check_in',
          reasonMessage: msg,
          capturedLat: coords.lat,
          capturedLng: coords.lng,
          capturedAcc: coords.acc,
        });
      } else {
        setBanner({ type: 'error', text: msg });
      }
    } finally {
      setPunchLoading(false);
    }
  };

  const handleCheckOutClick = async () => {
    if (!user || !activeRecord) return;
    setBanner(null);
    setExceptionPrompt(null);
    setPunchLoading(true);

    if (punchMode === 'QR') {
      try {
        const updated = await submitEmployeeCheckOut(user, isPreviewSession, {
          attendanceId: activeRecord.attendanceId,
          method: 'QR',
          qrTokenOrCode: qrCodeInput,
        });
        setQrCodeInput('');
        setBanner({
          type: 'success',
          text: `Shift QR Check-Out recorded at ${formatPunchTime(updated.checkOutAt)}. Net duty: ${updated.totalDutyHours}h.`,
        });
      } catch (err) {
        setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
      } finally {
        setPunchLoading(false);
      }
      return;
    }

    // GPS Mode
    let coords: { lat: number; lng: number; acc: number } | null = null;
    try {
      coords = await captureOneShotGps();
    } catch {
      // Allow submitting exception check-out if GPS unavailable at shift end
      coords = null;
    }

    try {
      const updated = await submitEmployeeCheckOut(user, isPreviewSession, {
        attendanceId: activeRecord.attendanceId,
        method: 'GPS',
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        accuracyMeters: coords?.acc ?? null,
      });
      setBanner({
        type: 'success',
        text: `Check-Out recorded at ${formatPunchTime(updated.checkOutAt)} · Net Duty: ${updated.totalDutyHours}h (${updated.status}).`,
      });
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setPunchLoading(false);
    }
  };

  const handleExceptionCheckInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !exceptionPrompt || !targetSiteId) return;
    setPunchLoading(true);
    try {
      const created = await submitEmployeeCheckIn(user, isPreviewSession, {
        siteId: targetSiteId,
        rosterId: activeRoster?.rosterId,
        assignmentId: activeRoster?.assignmentId || fallbackAsg?.assignmentId,
        attendanceDate: today,
        method: 'GPS',
        latitude: exceptionPrompt.capturedLat,
        longitude: exceptionPrompt.capturedLng,
        accuracyMeters: exceptionPrompt.capturedAcc,
        submitAsException: true,
        exceptionReason,
      });
      setExceptionPrompt(null);
      setExceptionReason('');
      setBanner({
        type: 'success',
        text: `Flagged Exception Check-In (${created.attendanceId}) submitted for HR verification.`,
      });
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setPunchLoading(false);
    }
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
        requestedCheckInTime:
          corrType === 'Missing Check-Out' ? undefined : corrInTime,
        requestedCheckOutTime:
          corrType === 'Missing Check-In' ? undefined : corrOutTime,
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            My Duty &amp; Attendance
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Personal shift schedule, one-tap GPS / Site QR attendance punches, duty hours, and
            missing punch requests.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setCorrError(null);
            setCorrDate(today);
            setCorrOpen(true);
          }}
          className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] self-start sm:self-auto whitespace-nowrap"
        >
          <FileEdit className="w-4 h-4 text-[#5C3D2E]" />
          <span>Request Missing Punch / Correction</span>
        </button>
      </div>

      {/* Unread Roster & Attendance Notifications */}
      {unreadNotifications.length > 0 && (
        <section className="bg-[#F3EDE4] border border-[#D4C7B8] rounded-xl p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#5C3D2E]">
            <Bell className="w-4 h-4" />
            <span>New Duty &amp; Attendance Updates ({unreadNotifications.length})</span>
          </div>
          <div className="divide-y divide-[#E5DDD2]">
            {unreadNotifications.slice(0, 3).map((n) => (
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
                  className="text-xs font-semibold text-[#5C3D2E] hover:underline self-start sm:self-auto whitespace-nowrap"
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
            className="font-semibold underline shrink-0"
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
            {targetClientName && (
              <p className="text-xs text-[#574B43]">
                {targetClientName} · {targetDesignation}
              </p>
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
                {dutyCtx?.siteGeoConfig ? `${dutyCtx.siteGeoConfig.allowedRadiusMeters}m` : '—'}
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
              <span className="block text-[#7D6F65]">Shift Status</span>
              <span className="font-semibold text-[#5C3D2E]">
                {activeRecord ? activeRecord.status : targetSiteId ? 'Awaiting Check-In' : 'Off Duty'}
              </span>
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

        {/* Right: Check-In / Check-Out Action Console */}
        <section className="lg:col-span-5 bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-[#1F1916]">
                Verify &amp; Mark Attendance
              </h2>
              <ShieldCheck className="w-5 h-5 text-[#5C3D2E]" />
            </div>

            {/* Mode Switch: GPS vs Site QR */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-white border border-[#D4C7B8] rounded-lg">
              <button
                type="button"
                onClick={() => setPunchMode('GPS')}
                className={`min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
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
                className={`min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
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
              <p className="text-xs text-[#574B43]">
                Location is captured once when you tap Check In or Check Out and verified on the
                server against your assigned site geofence. REXON never tracks location in the
                background.
              </p>
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
                  className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-white border border-[#D4C7B8] rounded-lg focus:outline-none focus:border-[#5C3D2E]"
                />
              </div>
            )}
          </div>

          {exceptionPrompt && (
            <form
              onSubmit={(e) => void handleExceptionCheckInSubmit(e)}
              className="p-3.5 rounded-lg bg-white border border-[#FECACA] space-y-2.5"
            >
              <div className="flex items-start gap-2 text-xs text-[#B91C1C]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{exceptionPrompt.reasonMessage}</span>
              </div>
              <input
                type="text"
                value={exceptionReason}
                onChange={(e) => setExceptionReason(e.target.value)}
                placeholder="Enter reason to submit Exception Check-In for HR review..."
                maxLength={240}
                className="w-full min-h-[38px] px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#D4C7B8] rounded-lg"
                required
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setExceptionPrompt(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-[#574B43]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={punchLoading}
                  className="px-3 py-1.5 rounded-lg bg-[#B45309] text-xs font-semibold text-white whitespace-nowrap"
                >
                  Submit Exception for HR Review
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={!canCheckIn || punchLoading}
              onClick={() => void handleCheckInClick()}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-45 transition-colors whitespace-nowrap"
            >
              <LogIn className="w-4 h-4 shrink-0" />
              <span>{punchLoading && canCheckIn ? 'Verifying...' : 'Check In'}</span>
            </button>

            <button
              type="button"
              disabled={!canCheckOut || punchLoading}
              onClick={() => void handleCheckOutClick()}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#FAF8F5] disabled:opacity-45 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-4 h-4 text-[#5C3D2E] shrink-0" />
              <span>{punchLoading && canCheckOut ? 'Verifying...' : 'Check Out'}</span>
            </button>
          </div>
        </section>
      </div>

      {/* Monthly KPI Summary */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Present Days (Month)"
          value={monthlyStats.presentDays}
          subtext="Verified duty shifts this month"
          icon={CalendarCheck}
        />
        <StatMetricCard
          label="Total Duty Hours"
          value={`${monthlyStats.totalHours}h`}
          subtext="Net worked hours this month"
          icon={Clock}
        />
        <StatMetricCard
          label="Late Arrivals"
          value={monthlyStats.lateCount}
          subtext="Shifts exceeding grace period"
          icon={MapPin}
          tone={monthlyStats.lateCount > 0 ? 'attention' : 'default'}
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
            description="Your daily GPS and QR shift check-ins, duty hours, and HR-verified attendance statuses appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                  <th className="py-3 px-3">Duty Date</th>
                  <th className="py-3 px-3">Site &amp; Shift</th>
                  <th className="py-3 px-3">Check-In</th>
                  <th className="py-3 px-3">Check-Out</th>
                  <th className="py-3 px-3 text-right">Net Hours</th>
                  <th className="py-3 px-3 text-right">Late / OT</th>
                  <th className="py-3 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5DDD2] text-sm">
                {history.map((r) => (
                  <tr key={r.attendanceId} className="hover:bg-[#FAF8F5]">
                    <td className="py-3 px-3 font-mono-tabular text-xs font-semibold text-[#1F1916] whitespace-nowrap">
                      {r.attendanceDate}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-[#1F1916]">{r.siteName}</div>
                      <div className="text-xs text-[#574B43]">
                        {r.shiftType} · {r.checkInMethod || 'HR'}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono-tabular text-xs text-[#1F1916] whitespace-nowrap">
                      {formatPunchTime(r.checkInAt)}
                    </td>
                    <td className="py-3 px-3 font-mono-tabular text-xs text-[#1F1916] whitespace-nowrap">
                      {formatPunchTime(r.checkOutAt)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-tabular text-xs font-semibold text-[#1F1916] whitespace-nowrap">
                      {r.totalDutyHours}h
                    </td>
                    <td className="py-3 px-3 text-right font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                      {r.lateArrivalMinutes > 0 ? `Late ${r.lateArrivalMinutes}m ` : ''}
                      {r.overtimeMinutes > 0 ? `OT ${r.overtimeMinutes}m (${r.overtimeStatus})` : '—'}
                    </td>
                    <td className="py-3 px-3 text-xs whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          r.status === 'Present'
                            ? 'text-[#166534]'
                            : r.status === 'Exception' || r.status === 'Absent'
                              ? 'text-[#B91C1C]'
                              : 'text-[#B45309]'
                        }`}
                      >
                        {r.status}
                      </span>
                      <span className="text-[#7D6F65]">
                        {' '}
                        · {r.isVerifiedByHr ? 'Verified' : 'Pending HR'}
                      </span>
                    </td>
                  </tr>
                ))}
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
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#7D6F65]"
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
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                  className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                      className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
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
                      className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    />
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs text-[#574B43]">
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
                  className="w-full min-h-[40px] px-3 py-2 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCorrOpen(false)}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={corrSubmitting}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
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
