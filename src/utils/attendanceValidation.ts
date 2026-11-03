import {
  AttendanceRecord,
  AttendanceStatus,
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

export const DEFAULT_ALLOWED_RADIUS_METERS = 150;
export const DEFAULT_GPS_ACCURACY_THRESHOLD_METERS = 100;

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

export function resolveSiteGeoSettings(site: SiteRecord): {
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
    Math.max(20, Number(site.allowedRadiusMeters) || DEFAULT_ALLOWED_RADIUS_METERS)
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
 * Example: 20:00 -> 08:00 crosses midnight onto dutyDate + 1 (720 gross mins).
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
 * Fully supports overnight shifts crossing midnight (e.g., 20:00 Day 1 -> 08:00 Day 2).
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

  // Overtime counts extra minutes worked beyond netScheduledMinutes (threshold >= 15 mins)
  const extraBeyondSchedule = totalDutyMinutes - shiftMeta.netScheduledMinutes;
  const overtimeMinutes = extraBeyondSchedule >= 15 ? extraBeyondSchedule : 0;

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
      // End of the month of startDate
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
      totalNetHours: 0,
      approvedOvertimeHours: 0,
      pendingOvertimeHours: 0,
    };

    if (r.status === 'Present') existing.presentDays += 1;
    else if (r.status === 'Late') {
      existing.presentDays += 1;
      existing.lateDays += 1;
    } else if (r.status === 'Half Day') existing.halfDays += 1;
    else if (r.status === 'Absent') existing.absentDays += 1;
    else if (r.status === 'Weekly Off') existing.weeklyOffDays += 1;
    else if (r.status === 'Holiday') existing.holidayDays += 1;
    else if (r.status === 'Leave') existing.leaveDays += 1;
    else if (r.status === 'Exception') existing.exceptionDays += 1;

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
