import {
  AttendanceLocationStatus,
  AttendanceRecord,
  AttendanceReportType,
  AttendanceStatus,
  AttendanceVerificationStatus,
  DutyRosterRecord,
  EmployeeAttendanceSummaryRollup,
  SiteRecord,
  ValidationResult,
} from '../types';
import {
  addDaysToIsoDate,
  isValidIsoDate,
  isValidTime24h,
  parseTimeToMinutes,
} from './deploymentValidation';

export const DEFAULT_ALLOWED_RADIUS_METERS = 200;
export const DEFAULT_GPS_ACCURACY_THRESHOLD_METERS = 100;
export const DEFAULT_SHIFT_ABSENT_CUTOFF_MINUTES = 180;

/**
 * Returns YYYY-MM-DD in Asia/Kolkata (IST) timezone for consistent Indian shift boundaries.
 */
export function getTodayIstIsoDate(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback below
  }
  return now.toISOString().slice(0, 10);
}

export function formatIstTimeOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  try {
    return dt.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

export function deriveAttendanceVerificationStatus(
  record: AttendanceRecord
): AttendanceVerificationStatus {
  if (record.verificationStatus) {
    return record.verificationStatus;
  }
  if (record.verificationOutcome === 'Rejected' || record.status === 'Rejected') {
    return 'Rejected';
  }
  if (record.isVerifiedByHr) {
    return record.verificationOutcome === 'Manual_Override' ? 'Exception Approved' : 'Verified';
  }
  return 'Pending';
}

export function deriveAttendanceLocationStatus(
  record: AttendanceRecord
): AttendanceLocationStatus {
  if (record.locationStatus) {
    return record.locationStatus;
  }
  if (record.checkInGeo?.locationStatus) {
    return record.checkInGeo.locationStatus;
  }
  if (record.verificationOutcome === 'Outside_Geofence') {
    return 'Outside Geofence';
  }
  if (record.verificationOutcome === 'Low_GPS_Accuracy') {
    return 'GPS Accuracy Low';
  }
  if (record.verificationOutcome === 'GPS_Unavailable') {
    return 'Location Unavailable';
  }
  if (record.checkInGeo?.withinGeofence) {
    return 'Within Geofence';
  }
  if (record.checkInMethod === 'QR' || record.checkInMethod === 'Manual_HR') {
    return 'Within Geofence';
  }
  return 'Location Unavailable';
}

/**
 * Strict Payroll Gate: ONLY HR-Verified or Exception-Approved attendance records
 * are eligible for Payroll computation. Unverified, offline-pending, Absent, or Rejected
 * records are NEVER payroll-eligible.
 */
export function isAttendancePayrollEligible(record: AttendanceRecord): boolean {
  if (typeof record.isPayrollEligible === 'boolean') {
    return record.isPayrollEligible;
  }
  const vStatus = deriveAttendanceVerificationStatus(record);
  if (vStatus !== 'Verified' && vStatus !== 'Exception Approved') {
    return false;
  }
  if (record.status === 'Rejected' || record.status === 'Absent' || record.status === 'Pending') {
    return false;
  }
  return Boolean(record.isVerifiedByHr);
}

/**
 * Checks whether a scheduled duty shift has passed its post-shift attendance cut-off deadline.
 * Prevents scheduled employees from being prematurely labeled Absent before their shift ends + grace cutoff.
 */
export function isShiftPastCutoff(params: {
  dutyDate: string;
  dutyStartTime: string;
  dutyEndTime: string;
  cutoffMinutesAfterEnd?: number;
  nowMs?: number;
}): boolean {
  const {
    dutyDate,
    dutyStartTime,
    dutyEndTime,
    cutoffMinutesAfterEnd = DEFAULT_SHIFT_ABSENT_CUTOFF_MINUTES,
    nowMs = Date.now(),
  } = params;
  if (!isValidIsoDate(dutyDate) || !isValidTime24h(dutyStartTime) || !isValidTime24h(dutyEndTime)) {
    return false;
  }
  const shiftMeta = computeRosterShiftMetrics(dutyDate, dutyStartTime, dutyEndTime, 0);
  const shiftEndMs = combineDateAndTimeToMs(shiftMeta.dutyEndDate, dutyEndTime);
  return nowMs > shiftEndMs + Math.max(0, cutoffMinutesAfterEnd) * 60_000;
}

/**
 * Extracts { latitude, longitude } from a raw coordinate pair ("18.7606, 73.8636")
 * or a Google Maps URL ("https://maps.google.com/?q=18.7606,73.8636" / ".../@18.7606,73.8636...").
 */
export function parseCoordinatesFromLocationString(
  rawLocation: string | undefined | null
): { latitude: number; longitude: number } | null {
  if (!rawLocation) return null;
  const trimmed = rawLocation.trim();
  if (!trimmed) return null;

  // Pattern 1: @lat,lng or q=lat,lng or ll=lat,lng
  const urlCoordMatch = trimmed.match(/(?:@|[?&](?:q|ll|query)=)(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/i);
  if (urlCoordMatch) {
    const lat = parseFloat(urlCoordMatch[1]);
    const lng = parseFloat(urlCoordMatch[2]);
    if (isValidLatLng(lat, lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  // Pattern 2: Plain "18.7606, 73.8636"
  const plainMatch = trimmed.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (plainMatch) {
    const lat = parseFloat(plainMatch[1]);
    const lng = parseFloat(plainMatch[2]);
    if (isValidLatLng(lat, lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  return null;
}

export function isValidLatLng(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function resolveSiteGeoSettings(
  site: SiteRecord,
  fallbackDefaultRadius: number = DEFAULT_ALLOWED_RADIUS_METERS
): {
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
  gpsAccuracyThresholdMeters: number;
  isGpsMandatory: boolean;
  isQrEnabled: boolean;
} {
  let lat = site.latitude ?? null;
  let lng = site.longitude ?? null;
  if (!isValidLatLng(lat, lng)) {
    const parsed = parseCoordinatesFromLocationString(site.googleMapsLocation);
    if (parsed) {
      lat = parsed.latitude;
      lng = parsed.longitude;
    } else {
      lat = null;
      lng = null;
    }
  }

  const allowedRadiusMeters = Math.min(
    5000,
    Math.max(20, Number(site.allowedRadiusMeters) || fallbackDefaultRadius || DEFAULT_ALLOWED_RADIUS_METERS)
  );
  const gpsAccuracyThresholdMeters = Math.min(
    1000,
    Math.max(10, Number(site.gpsAccuracyThresholdMeters) || DEFAULT_GPS_ACCURACY_THRESHOLD_METERS)
  );

  return {
    latitude: lat,
    longitude: lng,
    allowedRadiusMeters,
    gpsAccuracyThresholdMeters,
    isGpsMandatory: site.isGpsMandatory ?? isValidLatLng(lat, lng),
    isQrEnabled: site.isQrEnabled ?? true,
  };
}

/**
 * Spherical Haversine distance in meters.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Computes overnight-aware shift schedule timing.
 * Example: 22:00 -> 06:00 crosses midnight onto dutyDate + 1 (480 gross mins).
 */
export function computeRosterShiftMetrics(
  dutyDate: string,
  startTime: string,
  endTime: string,
  breakDurationMinutes: number
): {
  crossesMidnight: boolean;
  dutyEndDate: string;
  grossDurationMinutes: number;
  netScheduledMinutes: number;
} {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  const crossesMidnight = endMin <= startMin;
  const grossDurationMinutes = crossesMidnight ? 1440 - startMin + endMin : endMin - startMin;
  const clampedBreak = Math.max(0, Math.min(240, Math.round(breakDurationMinutes || 0)));
  const netScheduledMinutes = Math.max(30, grossDurationMinutes - clampedBreak);
  const dutyEndDate = crossesMidnight ? addDaysToIsoDate(dutyDate, 1) : dutyDate;

  return {
    crossesMidnight,
    dutyEndDate,
    grossDurationMinutes,
    netScheduledMinutes,
  };
}

/**
 * Converts a YYYY-MM-DD date and HH:MM 24h time into a local Date timestamp (ms).
 */
export function combineDateAndTimeToMs(isoDate: string, hhmm: string): number {
  const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10));
  const mins = parseTimeToMinutes(hhmm);
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return new Date(y, (m || 1) - 1, d || 1, hours, minutes, 0, 0).getTime();
}

/**
 * Computes late arrival minutes at Check-In accounting for gracePeriodMinutes.
 */
export function computeCheckInLateMinutes(
  attendanceDate: string,
  scheduledStartTime: string,
  gracePeriodMinutes: number,
  checkInIso: string
): {
  lateArrivalMinutes: number;
  derivedStatus: 'Present' | 'Late';
} {
  const scheduledStartMs = combineDateAndTimeToMs(attendanceDate, scheduledStartTime);
  const checkInMs = new Date(checkInIso).getTime();
  if (!Number.isFinite(checkInMs)) {
    return { lateArrivalMinutes: 0, derivedStatus: 'Present' };
  }
  const rawDiffMinutes = Math.floor((checkInMs - scheduledStartMs) / 60000);
  const grace = Math.max(0, Math.min(180, Math.round(gracePeriodMinutes || 0)));
  if (rawDiffMinutes <= grace) {
    return { lateArrivalMinutes: 0, derivedStatus: 'Present' };
  }
  return {
    lateArrivalMinutes: rawDiffMinutes,
    derivedStatus: 'Late',
  };
}

/**
 * Computes total gross/net duty minutes, early departure, overtime, and status upon Check-Out.
 * Fully supports overnight shifts crossing midnight (e.g., 22:00 Day 1 -> 06:00 Day 2).
 */
export function computeCheckOutMetrics(params: {
  attendanceDate: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  breakDurationMinutes: number;
  gracePeriodMinutes: number;
  checkInIso: string;
  checkOutIso: string;
  preserveExceptionStatus?: boolean;
  overtimeMinimumMinutes?: number;
}): {
  totalGrossMinutes: number;
  totalDutyMinutes: number;
  totalDutyHours: number;
  lateArrivalMinutes: number;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
  derivedStatus: AttendanceStatus;
} {
  const {
    attendanceDate,
    scheduledStartTime,
    scheduledEndTime,
    breakDurationMinutes,
    gracePeriodMinutes,
    checkInIso,
    checkOutIso,
    preserveExceptionStatus,
    overtimeMinimumMinutes = 15,
  } = params;

  const shiftMeta = computeRosterShiftMetrics(
    attendanceDate,
    scheduledStartTime,
    scheduledEndTime,
    breakDurationMinutes
  );

  const scheduledEndMs = combineDateAndTimeToMs(shiftMeta.dutyEndDate, scheduledEndTime);
  const inMs = new Date(checkInIso).getTime();
  let outMs = new Date(checkOutIso).getTime();

  // Safety guard if caller passed same-day time string for an overnight shift
  if (outMs < inMs) {
    outMs += 24 * 60 * 60 * 1000;
  }

  const totalGrossMinutes = Math.max(0, Math.round((outMs - inMs) / 60000));
  const effectiveBreak =
    totalGrossMinutes > breakDurationMinutes + 180
      ? Math.max(0, Math.round(breakDurationMinutes || 0))
      : 0;
  const totalDutyMinutes = Math.max(0, totalGrossMinutes - effectiveBreak);
  const totalDutyHours = Math.round((totalDutyMinutes / 60) * 100) / 100;

  const { lateArrivalMinutes } = computeCheckInLateMinutes(
    attendanceDate,
    scheduledStartTime,
    gracePeriodMinutes,
    checkInIso
  );

  const earlyDepartureMinutes =
    outMs < scheduledEndMs ? Math.max(0, Math.round((scheduledEndMs - outMs) / 60000)) : 0;

  // Overtime counts extra minutes worked beyond netScheduledMinutes (threshold >= overtimeMinimumMinutes)
  const extraBeyondSchedule = totalDutyMinutes - shiftMeta.netScheduledMinutes;
  const overtimeMinutes =
    extraBeyondSchedule >= Math.max(5, overtimeMinimumMinutes) ? extraBeyondSchedule : 0;

  let derivedStatus: AttendanceStatus = 'Present';
  if (preserveExceptionStatus) {
    derivedStatus = 'Exception';
  } else if (totalDutyMinutes < Math.floor(shiftMeta.netScheduledMinutes * 0.5)) {
    derivedStatus = 'Half Day';
  } else if (lateArrivalMinutes > 0) {
    derivedStatus = 'Late';
  }

  return {
    totalGrossMinutes,
    totalDutyMinutes,
    totalDutyHours,
    lateArrivalMinutes,
    earlyDepartureMinutes,
    overtimeMinutes,
    derivedStatus,
  };
}

/**
 * Midnight-aware Roster Conflict Detector across adjacent dates (`dutyDate - 1`, `dutyDate`, `dutyDate + 1`).
 */
export function detectDutyRosterConflict(
  candidate: {
    employeeId: string;
    dutyDate: string;
    dutyStartTime: string;
    dutyEndTime: string;
  },
  existingRosters: DutyRosterRecord[],
  excludeRosterIds: string[] = []
): { hasConflict: boolean; conflictingRoster?: DutyRosterRecord; reason?: string } {
  const excluded = new Set(excludeRosterIds);
  const candMetrics = computeRosterShiftMetrics(
    candidate.dutyDate,
    candidate.dutyStartTime,
    candidate.dutyEndTime,
    0
  );
  const candStartMs = combineDateAndTimeToMs(candidate.dutyDate, candidate.dutyStartTime);
  const candEndMs = combineDateAndTimeToMs(candMetrics.dutyEndDate, candidate.dutyEndTime);

  for (const existing of existingRosters) {
    if (excluded.has(existing.rosterId)) continue;
    if (existing.status === 'Cancelled') continue;
    if (existing.employeeId !== candidate.employeeId) continue;

    // Only need to compare rosters within +/- 1 day window
    const prevDay = addDaysToIsoDate(candidate.dutyDate, -1);
    const nextDay = addDaysToIsoDate(candidate.dutyDate, 1);
    if (
      existing.dutyDate !== prevDay &&
      existing.dutyDate !== candidate.dutyDate &&
      existing.dutyDate !== nextDay
    ) {
      continue;
    }

    const exEndDate =
      existing.dutyEndDate ||
      (existing.crossesMidnight ? addDaysToIsoDate(existing.dutyDate, 1) : existing.dutyDate);
    const exStartMs = combineDateAndTimeToMs(existing.dutyDate, existing.dutyStartTime);
    const exEndMs = combineDateAndTimeToMs(exEndDate, existing.dutyEndTime);

    if (Math.max(candStartMs, exStartMs) < Math.min(candEndMs, exEndMs)) {
      return {
        hasConflict: true,
        conflictingRoster: existing,
        reason: `Overlapping duty roster conflict with ${existing.rosterId} at "${existing.siteName}" on ${existing.dutyDate} (${existing.shiftType}: ${existing.dutyStartTime}–${existing.dutyEndTime}${existing.crossesMidnight ? ' next day' : ''}).`,
      };
    }
  }

  return { hasConflict: false };
}

/**
 * Generates an inclusive list of YYYY-MM-DD dates for Daily, Weekly, or Monthly roster creation.
 */
export function buildRosterTargetDates(params: {
  scheduleMode: 'Daily' | 'Weekly' | 'Monthly';
  startDate: string;
  endDate?: string;
  skipWeekdays?: number[];
}): string[] {
  const { scheduleMode, startDate, endDate, skipWeekdays = [] } = params;
  if (!isValidIsoDate(startDate)) return [];

  if (scheduleMode === 'Daily') {
    return [startDate];
  }

  let finalEndDate = endDate && isValidIsoDate(endDate) ? endDate : '';
  if (!finalEndDate) {
    if (scheduleMode === 'Weekly') {
      finalEndDate = addDaysToIsoDate(startDate, 6);
    } else {
      const [y, m] = startDate.split('-').map((n) => parseInt(n, 10));
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      finalEndDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }
  }

  if (finalEndDate < startDate) return [];

  const skipSet = new Set(skipWeekdays);
  const dates: string[] = [];
  let cursor = startDate;
  let guard = 0;

  while (cursor <= finalEndDate && guard < 62) {
    const [y, m, d] = cursor.split('-').map((n) => parseInt(n, 10));
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (!skipSet.has(dayOfWeek)) {
      dates.push(cursor);
    }
    cursor = addDaysToIsoDate(cursor, 1);
    guard += 1;
  }

  return dates;
}

export function validateRosterTimings(params: {
  dutyDate: string;
  dutyStartTime: string;
  dutyEndTime: string;
  reportingTime: string;
  breakDurationMinutes: number;
  gracePeriodMinutes: number;
}): ValidationResult {
  if (!isValidIsoDate(params.dutyDate)) {
    return { valid: false, error: 'Select a valid Duty Date (YYYY-MM-DD).' };
  }
  if (!isValidTime24h(params.dutyStartTime) || !isValidTime24h(params.dutyEndTime)) {
    return { valid: false, error: 'Enter valid 24-hour Duty Start and End times (HH:MM).' };
  }
  if (!isValidTime24h(params.reportingTime)) {
    return { valid: false, error: 'Enter a valid 24-hour Reporting Time (HH:MM).' };
  }
  if (
    !Number.isFinite(params.breakDurationMinutes) ||
    params.breakDurationMinutes < 0 ||
    params.breakDurationMinutes > 180
  ) {
    return { valid: false, error: 'Break duration must be between 0 and 180 minutes.' };
  }
  if (
    !Number.isFinite(params.gracePeriodMinutes) ||
    params.gracePeriodMinutes < 0 ||
    params.gracePeriodMinutes > 120
  ) {
    return { valid: false, error: 'Grace period must be between 0 and 120 minutes.' };
  }
  const metrics = computeRosterShiftMetrics(
    params.dutyDate,
    params.dutyStartTime,
    params.dutyEndTime,
    params.breakDurationMinutes
  );
  if (metrics.grossDurationMinutes < 60 || metrics.grossDurationMinutes > 960) {
    return {
      valid: false,
      error: 'Shift gross duration must be between 1 hour and 16 hours.',
    };
  }
  return { valid: true };
}

/**
 * Aggregates attendance records into employee-level Weekly or Monthly summary rollups.
 */
export function buildEmployeeAttendanceRollups(
  records: AttendanceRecord[]
): EmployeeAttendanceSummaryRollup[] {
  const byEmployee = new Map<string, EmployeeAttendanceSummaryRollup>();

  for (const r of records) {
    const existing = byEmployee.get(r.employeeId) ?? {
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      branchId: r.branchId,
      siteName: r.siteName,
      designationName: r.designationName,
      presentDays: 0,
      lateDays: 0,
      halfDays: 0,
      absentDays: 0,
      weeklyOffDays: 0,
      holidayDays: 0,
      leaveDays: 0,
      exceptionDays: 0,
      verifiedPayrollDays: 0,
      totalNetHours: 0,
      approvedOvertimeHours: 0,
      pendingOvertimeHours: 0,
    };

    if (r.status === 'Present' || r.status === 'On Duty') existing.presentDays += 1;
    else if (r.status === 'Late') {
      existing.presentDays += 1;
      existing.lateDays += 1;
    } else if (r.status === 'Half Day') existing.halfDays += 1;
    else if (r.status === 'Absent' || r.status === 'Rejected') existing.absentDays += 1;
    else if (r.status === 'Weekly Off') existing.weeklyOffDays += 1;
    else if (r.status === 'Holiday') existing.holidayDays += 1;
    else if (r.status === 'Leave') existing.leaveDays += 1;
    else if (r.status === 'Exception' || r.status === 'Incomplete') existing.exceptionDays += 1;

    if (isAttendancePayrollEligible(r)) {
      existing.verifiedPayrollDays += 1;
    }

    existing.totalNetHours =
      Math.round((existing.totalNetHours + (r.totalDutyHours || 0)) * 100) / 100;

    if (r.overtimeStatus === 'Approved' && r.approvedOvertimeMinutes > 0) {
      existing.approvedOvertimeHours =
        Math.round((existing.approvedOvertimeHours + r.approvedOvertimeMinutes / 60) * 100) / 100;
    } else if (r.overtimeStatus === 'Pending' && r.overtimeMinutes > 0) {
      existing.pendingOvertimeHours =
        Math.round((existing.pendingOvertimeHours + r.overtimeMinutes / 60) * 100) / 100;
    }

    byEmployee.set(r.employeeId, existing);
  }

  return Array.from(byEmployee.values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName)
  );
}

/**
 * Generates tabular columns, rows, and summary totals for all 12 Phase 4 Attendance Reports.
 */
export function buildPhase4ReportDataset(params: {
  reportType: AttendanceReportType;
  records: AttendanceRecord[];
}): {
  columns: Array<{ header: string; align?: 'left' | 'right' | 'center' }>;
  rows: Array<Array<string | number>>;
  summaryMetrics: Array<{ label: string; value: string | number }>;
} {
  const { reportType, records } = params;

  const totalPresent = records.filter(
    (r) => r.status === 'Present' || r.status === 'Late' || r.status === 'Half Day' || r.status === 'On Duty'
  ).length;
  const totalAbsent = records.filter((r) => r.status === 'Absent' || r.status === 'Rejected').length;
  const totalLate = records.filter((r) => r.lateArrivalMinutes > 0 || r.status === 'Late').length;
  const totalPayrollReady = records.filter((r) => isAttendancePayrollEligible(r)).length;
  const totalNetHrs = Math.round(records.reduce((s, r) => s + (r.totalDutyHours || 0), 0) * 100) / 100;
  const totalApprovedOtHrs =
    Math.round(
      (records.reduce((s, r) => s + (r.overtimeStatus === 'Approved' ? r.approvedOvertimeMinutes : 0), 0) /
        60) *
        100
    ) / 100;

  const baseSummary = [
    { label: 'Total Records', value: records.length },
    { label: 'Present / Late', value: totalPresent },
    { label: 'Absent / Rejected', value: totalAbsent },
    { label: 'Late Arrivals', value: totalLate },
    { label: 'Payroll-Ready (HR Verified)', value: totalPayrollReady },
    { label: 'Net Duty Hours', value: `${totalNetHrs}h` },
    { label: 'Approved Overtime', value: `${totalApprovedOtHrs}h` },
  ];

  // Grouped rollup helper for Site / Client / Branch / Service reports
  const buildGroupedSummary = (
    groupHeader: string,
    keyFn: (r: AttendanceRecord) => string,
    labelFn: (r: AttendanceRecord) => string
  ) => {
    const map = new Map<
      string,
      {
        label: string;
        records: number;
        present: number;
        late: number;
        absent: number;
        missingOut: number;
        verified: number;
        hours: number;
        otHours: number;
      }
    >();

    for (const r of records) {
      const k = keyFn(r) || 'UNSPECIFIED';
      const entry = map.get(k) ?? {
        label: labelFn(r) || k,
        records: 0,
        present: 0,
        late: 0,
        absent: 0,
        missingOut: 0,
        verified: 0,
        hours: 0,
        otHours: 0,
      };
      entry.records += 1;
      if (r.status === 'Present' || r.status === 'Late' || r.status === 'Half Day' || r.status === 'On Duty') {
        entry.present += 1;
      }
      if (r.lateArrivalMinutes > 0 || r.status === 'Late') entry.late += 1;
      if (r.status === 'Absent' || r.status === 'Rejected') entry.absent += 1;
      if (r.checkInAt && !r.checkOutAt) entry.missingOut += 1;
      if (isAttendancePayrollEligible(r)) entry.verified += 1;
      entry.hours = Math.round((entry.hours + (r.totalDutyHours || 0)) * 100) / 100;
      if (r.overtimeStatus === 'Approved') {
        entry.otHours = Math.round((entry.otHours + (r.approvedOvertimeMinutes || 0) / 60) * 100) / 100;
      }
      map.set(k, entry);
    }

    const rows = Array.from(map.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((item) => [
        item.label,
        item.records,
        item.present,
        item.late,
        item.absent,
        item.missingOut,
        item.verified,
        `${item.hours}h`,
        `${item.otHours}h`,
      ]);

    return {
      columns: [
        { header: groupHeader, align: 'left' as const },
        { header: 'Total Logs', align: 'right' as const },
        { header: 'Present', align: 'right' as const },
        { header: 'Late', align: 'right' as const },
        { header: 'Absent', align: 'right' as const },
        { header: 'Missing Out', align: 'right' as const },
        { header: 'Payroll Verified', align: 'right' as const },
        { header: 'Net Hours', align: 'right' as const },
        { header: 'Approved OT', align: 'right' as const },
      ],
      rows,
      summaryMetrics: baseSummary,
    };
  };

  if (reportType === 'Employee-wise Attendance Report' || reportType === 'Weekly Attendance Report' || reportType === 'Monthly Attendance Report') {
    const rollups = buildEmployeeAttendanceRollups(records);
    return {
      columns: [
        { header: 'Employee ID', align: 'left' },
        { header: 'Employee Name', align: 'left' },
        { header: 'Site', align: 'left' },
        { header: 'Designation', align: 'left' },
        { header: 'Present', align: 'right' },
        { header: 'Late', align: 'right' },
        { header: 'Half Day', align: 'right' },
        { header: 'Absent', align: 'right' },
        { header: 'W-Off / Leave', align: 'right' },
        { header: 'Payroll Days', align: 'right' },
        { header: 'Net Hours', align: 'right' },
        { header: 'Approved OT', align: 'right' },
      ],
      rows: rollups.map((u) => [
        u.employeeId,
        u.employeeName,
        u.siteName,
        u.designationName,
        u.presentDays,
        u.lateDays,
        u.halfDays,
        u.absentDays,
        u.weeklyOffDays + u.holidayDays + u.leaveDays,
        u.verifiedPayrollDays,
        `${u.totalNetHours}h`,
        `${u.approvedOvertimeHours}h`,
      ]),
      summaryMetrics: baseSummary,
    };
  }

  if (reportType === 'Site-wise Attendance Report') {
    return buildGroupedSummary(
      'Deployment Site',
      (r) => r.siteId,
      (r) => `${r.siteName} (${r.siteId})`
    );
  }

  if (reportType === 'Client-wise Attendance Report') {
    return buildGroupedSummary(
      'Client Organization',
      (r) => r.clientId || r.clientName,
      (r) => r.clientName || r.clientId
    );
  }

  if (reportType === 'Branch-wise Attendance Report') {
    return buildGroupedSummary(
      'REXON Branch',
      (r) => r.branchId,
      (r) => `${r.branchName || r.branchId} (${r.branchId})`
    );
  }

  if (reportType === 'Service-wise Attendance Report') {
    return buildGroupedSummary(
      'Service & Designation',
      (r) => `${r.serviceCategory}:${r.designationName}`,
      (r) => `${r.serviceCategory} · ${r.designationName}`
    );
  }

  // Filtered detailed row reports
  let subset = records;
  if (reportType === 'Late Arrival Report') {
    subset = records.filter((r) => r.lateArrivalMinutes > 0 || r.status === 'Late');
  } else if (reportType === 'Overtime Report') {
    subset = records.filter((r) => r.overtimeMinutes > 0 || r.approvedOvertimeMinutes > 0);
  } else if (reportType === 'Missing Check-out Report') {
    subset = records.filter((r) => Boolean(r.checkInAt) && !r.checkOutAt);
  } else if (reportType === 'Attendance Exception Report') {
    subset = records.filter(
      (r) =>
        r.status === 'Exception' ||
        r.verificationOutcome === 'Outside_Geofence' ||
        r.verificationOutcome === 'Low_GPS_Accuracy' ||
        r.verificationOutcome === 'GPS_Unavailable'
    );
  }

  return {
    columns: [
      { header: 'Date', align: 'left' },
      { header: 'Employee', align: 'left' },
      { header: 'Site & Client', align: 'left' },
      { header: 'Service / Shift', align: 'left' },
      { header: 'Check-In', align: 'left' },
      { header: 'Check-Out', align: 'left' },
      { header: 'GPS / Location', align: 'left' },
      { header: 'Duty Hrs', align: 'right' },
      { header: 'Late / OT', align: 'right' },
      { header: 'Status', align: 'left' },
      { header: 'Verification', align: 'left' },
    ],
    rows: subset.map((r) => [
      r.attendanceDate,
      `${r.employeeName} (${r.employeeId})`,
      `${r.siteName}${r.clientName ? ` · ${r.clientName}` : ''}`,
      `${r.designationName} · ${r.shiftType} (${r.scheduledStartTime}–${r.scheduledEndTime})`,
      formatIstTimeOnly(r.checkInAt),
      formatIstTimeOnly(r.checkOutAt),
      deriveAttendanceLocationStatus(r),
      `${r.totalDutyHours}h`,
      `L:${r.lateArrivalMinutes}m / OT:${r.overtimeMinutes}m`,
      r.status,
      `${deriveAttendanceVerificationStatus(r)}${isAttendancePayrollEligible(r) ? ' (Payroll)' : ''}`,
    ]),
    summaryMetrics: [
      { label: 'Matching Rows', value: subset.length },
      ...baseSummary.slice(1),
    ],
  };
}
