import { ServiceCategory, UserRole } from './index';

// ============================================================================
// 1. DUTY ROSTER TYPES (`dutyRosters` COLLECTION)
// ============================================================================
export const ROSTER_SHIFT_TYPES = [
  'Day Shift',
  'Night Shift',
  'General Shift',
  'Rotational Shift',
  'Custom Shift',
] as const;

export type RosterShiftType = (typeof ROSTER_SHIFT_TYPES)[number];

export const ROSTER_SCHEDULE_MODES = ['Daily', 'Weekly', 'Monthly'] as const;
export type RosterScheduleMode = (typeof ROSTER_SCHEDULE_MODES)[number];

export const DUTY_ROSTER_STATUSES = ['Draft', 'Published', 'Cancelled'] as const;
export type DutyRosterStatus = (typeof DUTY_ROSTER_STATUSES)[number];

export interface DutyRosterPresetShift {
  shiftType: RosterShiftType;
  label: string;
  startTime: string; // HH:MM (24-hour)
  endTime: string; // HH:MM (24-hour)
  reportingTime: string; // HH:MM
  breakDurationMinutes: number;
  gracePeriodMinutes: number;
  crossesMidnight: boolean;
}

export const DUTY_ROSTER_SHIFT_PRESETS: readonly DutyRosterPresetShift[] = [
  {
    shiftType: 'Day Shift',
    label: 'Day Shift (08:00 – 20:00 · 12h)',
    startTime: '08:00',
    endTime: '20:00',
    reportingTime: '07:45',
    breakDurationMinutes: 60,
    gracePeriodMinutes: 15,
    crossesMidnight: false,
  },
  {
    shiftType: 'Night Shift',
    label: 'Night Shift (20:00 – 08:00 Next Day · 12h)',
    startTime: '20:00',
    endTime: '08:00',
    reportingTime: '19:45',
    breakDurationMinutes: 60,
    gracePeriodMinutes: 15,
    crossesMidnight: true,
  },
  {
    shiftType: 'General Shift',
    label: 'General Shift (09:00 – 18:00 · 9h)',
    startTime: '09:00',
    endTime: '18:00',
    reportingTime: '08:45',
    breakDurationMinutes: 60,
    gracePeriodMinutes: 15,
    crossesMidnight: false,
  },
  {
    shiftType: 'Rotational Shift',
    label: 'Rotational Shift A (06:00 – 14:00 · 8h)',
    startTime: '06:00',
    endTime: '14:00',
    reportingTime: '05:45',
    breakDurationMinutes: 30,
    gracePeriodMinutes: 10,
    crossesMidnight: false,
  },
  {
    shiftType: 'Custom Shift',
    label: 'Custom Shift Timing',
    startTime: '14:00',
    endTime: '22:00',
    reportingTime: '13:45',
    breakDurationMinutes: 30,
    gracePeriodMinutes: 15,
    crossesMidnight: false,
  },
] as const;

export interface DutyRosterRecord {
  rosterId: string; // e.g. RST-2026-0001
  scheduleMode: RosterScheduleMode;
  batchCode: string; // Groups Weekly/Monthly roster generation runs
  branchId: string;
  branchName: string;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  siteServiceId: string;
  serviceCategory: ServiceCategory;
  serviceId: string;
  serviceName: string;
  designationId: string;
  designationName: string;
  employeeId: string;
  employeeName: string;
  linkedUid: string;
  assignmentId: string; // Verified Phase 3 assignment reference
  dutyDate: string; // YYYY-MM-DD (Shift start date)
  dutyEndDate: string; // YYYY-MM-DD (Equals dutyDate + 1 day if crossesMidnight)
  shiftType: RosterShiftType;
  dutyStartTime: string; // HH:MM
  dutyEndTime: string; // HH:MM
  crossesMidnight: boolean;
  breakDurationMinutes: number;
  grossDurationMinutes: number;
  netScheduledMinutes: number;
  reportingTime: string; // HH:MM
  gracePeriodMinutes: number;
  assignedFieldOfficerUid: string;
  assignedFieldOfficerName: string;
  dutyInstructions: string;
  status: DutyRosterStatus;
  authorizedCapacityException: boolean;
  capacityExceptionReason: string;
  publishedAt: string | null;
  publishedBy: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDutyRosterInput {
  scheduleMode: RosterScheduleMode;
  branchId: string;
  clientId: string;
  siteId: string;
  siteServiceId?: string;
  serviceCategory: ServiceCategory;
  serviceId: string;
  designationId: string;
  employeeId: string;
  dutyDate: string; // Start date for Weekly/Monthly or exact date for Daily
  endDate?: string; // Optional explicit range end for Weekly/Monthly
  skipWeekdays?: number[]; // Optional JS day-of-week numbers (0=Sun..6=Sat) to skip as Weekly Off
  shiftType: RosterShiftType;
  dutyStartTime: string;
  dutyEndTime: string;
  breakDurationMinutes: number;
  reportingTime: string;
  gracePeriodMinutes: number;
  assignedFieldOfficerUid: string;
  assignedFieldOfficerName: string;
  dutyInstructions: string;
  publishImmediately: boolean;
  authorizedCapacityException?: boolean;
  capacityExceptionReason?: string;
}

export interface UpdateDutyRosterInput {
  shiftType: RosterShiftType;
  dutyStartTime: string;
  dutyEndTime: string;
  breakDurationMinutes: number;
  reportingTime: string;
  gracePeriodMinutes: number;
  assignedFieldOfficerUid: string;
  assignedFieldOfficerName: string;
  dutyInstructions: string;
  status: DutyRosterStatus;
  editReason?: string; // Mandatory when editing an already Published roster
  authorizedCapacityException?: boolean;
  capacityExceptionReason?: string;
}

// ============================================================================
// 2. ATTENDANCE & GEOFENCE / QR VERIFICATION TYPES (`attendance` COLLECTION)
// ============================================================================
export const ATTENDANCE_STATUSES = [
  'Present',
  'Absent',
  'Late',
  'Half Day',
  'Weekly Off',
  'Holiday',
  'Leave',
  'Pending',
  'Exception',
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const CHECK_IN_METHODS = ['GPS', 'QR', 'Manual_HR'] as const;
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number];

export const VERIFICATION_OUTCOMES = [
  'Verified',
  'QR_Verified',
  'Outside_Geofence',
  'Low_GPS_Accuracy',
  'GPS_Unavailable',
  'Manual_Override',
  'Pending_Review',
  'Rejected',
] as const;

export type AttendanceVerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];

export interface AttendanceGeoMetadata {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  allowedRadiusMeters: number;
  withinGeofence: boolean;
  serverVerified: boolean;
  capturedAt: string;
}

export interface AttendanceDeviceMetadata {
  platform: string;
  userAgentSummary: string;
  timezone: string;
  onlineStatus: boolean;
}

export type OvertimeApprovalStatus = 'None' | 'Pending' | 'Approved' | 'Rejected';

/**
 * Primary Operational Attendance Record: `attendance/{attendanceId}`
 * Never readable by Site Portal (`role == 'site'`).
 * Employees can read ONLY their own linked records (`linkedUid == auth.uid`).
 */
export interface AttendanceRecord {
  attendanceId: string; // e.g. ATT-2026-0001
  employeeId: string;
  employeeName: string;
  linkedUid: string;
  employeeUid: string; // Synced with linkedUid for Phase 1 index compatibility
  branchId: string;
  branchName: string;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  serviceCategory: ServiceCategory;
  serviceId: string;
  serviceName: string;
  designationId: string;
  designationName: string;
  assignmentId: string;
  rosterId: string;
  attendanceDate: string; // YYYY-MM-DD (Shift start date)
  date: string; // Synced with attendanceDate for Phase 1 index compatibility
  shiftType: RosterShiftType | string;
  scheduledStartTime: string; // HH:MM
  scheduledEndTime: string; // HH:MM
  crossesMidnight: boolean;
  breakDurationMinutes: number;
  gracePeriodMinutes: number;
  status: AttendanceStatus;
  checkInAt: string | null; // ISO timestamp
  checkOutAt: string | null; // ISO timestamp
  checkInMethod: CheckInMethod | null;
  checkOutMethod: CheckInMethod | null;
  checkInGeo: AttendanceGeoMetadata | null;
  checkOutGeo: AttendanceGeoMetadata | null;
  qrSessionId: string;
  qrVerificationStatus: string;
  deviceMetadata: AttendanceDeviceMetadata | null;
  totalGrossMinutes: number;
  totalDutyMinutes: number;
  totalDutyHours: number;
  lateArrivalMinutes: number;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
  overtimeStatus: OvertimeApprovalStatus;
  approvedOvertimeMinutes: number;
  overtimeApprovedBy: string | null;
  overtimeApprovedAt: string | null;
  verificationOutcome: AttendanceVerificationOutcome;
  isVerifiedByHr: boolean;
  verifiedByUid: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  exceptionReason: string;
  hrRemarks: string;
  fieldOfficerRemarks: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteGeoQrConfigInput {
  siteId: string;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
  gpsAccuracyThresholdMeters: number;
  isGpsMandatory: boolean;
  isQrEnabled: boolean;
}

export interface EmployeeCheckInInput {
  siteId: string;
  rosterId?: string;
  assignmentId?: string;
  attendanceDate?: string;
  method: 'GPS' | 'QR';
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  qrTokenOrCode?: string;
  submitAsException?: boolean;
  exceptionReason?: string;
}

export interface EmployeeCheckOutInput {
  attendanceId: string;
  method: 'GPS' | 'QR';
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  qrTokenOrCode?: string;
  exceptionReason?: string;
}

export interface ManualHrAttendanceInput {
  employeeId: string;
  siteId: string;
  rosterId?: string;
  assignmentId?: string;
  attendanceDate: string;
  shiftType: RosterShiftType | string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  breakDurationMinutes: number;
  gracePeriodMinutes: number;
  status: AttendanceStatus;
  checkInTime24h?: string; // Optional HH:MM
  checkOutTime24h?: string; // Optional HH:MM
  checkOutNextDay?: boolean;
  hrRemarks: string;
}

// ============================================================================
// 3. MISSING PUNCH & ATTENDANCE CORRECTION REQUESTS (`attendanceCorrections`)
// ============================================================================
export const CORRECTION_REQUEST_TYPES = [
  'Missing Check-In',
  'Missing Check-Out',
  'Both Punches Missing',
  'Geofence Exception',
  'Time / Status Correction',
] as const;

export type AttendanceCorrectionType = (typeof CORRECTION_REQUEST_TYPES)[number];

export type CorrectionRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export interface AttendanceCorrectionRequest {
  correctionId: string; // e.g. ACR-2026-0001
  requestType: AttendanceCorrectionType;
  attendanceId: string;
  rosterId: string;
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  linkedUid: string;
  branchId: string;
  clientId: string;
  siteId: string;
  siteName: string;
  attendanceDate: string; // YYYY-MM-DD
  shiftType: string;
  requestedCheckInAt: string; // ISO or HH:MM
  requestedCheckOutAt: string; // ISO or HH:MM
  requestedCheckOutNextDay: boolean;
  reason: string;
  supportingLocationNote: string;
  status: CorrectionRequestStatus;
  requestedByUid: string;
  requestedByName: string;
  requestedByRole: UserRole;
  reviewedByUid: string | null;
  reviewedByName: string | null;
  reviewRemarks: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitAttendanceCorrectionInput {
  requestType: AttendanceCorrectionType;
  attendanceId?: string;
  rosterId?: string;
  assignmentId?: string;
  siteId: string;
  attendanceDate: string;
  shiftType: string;
  requestedCheckInTime?: string; // HH:MM
  requestedCheckOutTime?: string; // HH:MM
  requestedCheckOutNextDay?: boolean;
  reason: string;
  supportingLocationNote?: string;
}

// ============================================================================
// 4. TIME-LIMITED ROTATING SITE QR SESSIONS (`attendanceQrSessions`)
//    Zero employee PII in QR payload; validated via HMAC on backend.
// ============================================================================
export interface SiteQrSessionRecord {
  sessionId: string; // e.g. QRS-2026-0001
  siteId: string;
  siteName: string;
  clientId: string;
  branchId: string;
  attendanceDate: string; // YYYY-MM-DD
  shiftType: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  signedToken: string;
  verificationCode: string; // Short 8-char code for manual fallback entry
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
  isActive: boolean;
  generatedByUid: string;
  generatedByName: string;
  generatedByRole: UserRole;
  scanCount: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 5. EMPLOYEE NOTIFICATIONS (`employeeNotifications`)
// ============================================================================
export type EmployeeNotificationCategory =
  | 'Roster Published'
  | 'Roster Updated'
  | 'Attendance Verified'
  | 'Correction Reviewed'
  | 'Overtime Approved';

export interface EmployeeNotificationRecord {
  notificationId: string; // e.g. NTF-2026-0001
  employeeId: string;
  linkedUid: string;
  branchId: string;
  siteId: string;
  siteName: string;
  category: EmployeeNotificationCategory;
  title: string;
  message: string;
  dutyDate: string;
  isRead: boolean;
  createdAt: string;
}

// ============================================================================
// 6. ATTENDANCE & ROSTER AUDIT LOGS (`attendanceAuditLogs`)
// ============================================================================
export type AttendanceAuditCategory =
  | 'Roster'
  | 'Attendance'
  | 'Geofence'
  | 'QR'
  | 'Correction'
  | 'Overtime';

export interface AttendanceAuditRecord {
  auditId: string; // e.g. AAL-2026-0001
  category: AttendanceAuditCategory;
  targetId: string;
  employeeId: string;
  siteId: string;
  branchId: string;
  action: string;
  previousValueSummary: string;
  newValueSummary: string;
  reason: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  timestamp: string;
}

// ============================================================================
// 7. SANITIZED SITE PORTAL ATTENDANCE SUMMARY (`siteAttendanceSummaries`)
//    Strictly headcount-only — ZERO employee names, phone, KYC, salary, or GPS!
// ============================================================================
export interface SanitizedSiteServiceAttendanceRow {
  lineKey: string;
  serviceCategory: ServiceCategory;
  serviceName: string;
  designationName: string;
  shiftType: string;
  deployedCount: number;
  presentCount: number;
  lateCount: number;
  halfDayCount: number;
  absentCount: number;
  weeklyOffCount: number;
}

export interface SanitizedSiteShiftAttendanceRow {
  shiftType: string;
  timing: string;
  deployedCount: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  weeklyOffCount: number;
}

export interface SanitizedSiteAttendanceSummaryRecord {
  summaryId: string; // `${siteId}_${attendanceDate}`
  siteId: string;
  siteName: string;
  clientId: string;
  clientName: string;
  branchId: string;
  attendanceDate: string; // YYYY-MM-DD
  totalSanctioned: number;
  totalDeployed: number;
  presentCount: number;
  lateCount: number;
  halfDayCount: number;
  absentCount: number;
  weeklyOffCount: number;
  leaveCount: number;
  pendingCount: number;
  serviceBreakdown: SanitizedSiteServiceAttendanceRow[];
  shiftBreakdown: SanitizedSiteShiftAttendanceRow[];
  updatedAt: string;
}

// ============================================================================
// 8. COMPUTED CONTEXT & ROLLUP MODELS
// ============================================================================
export interface EmployeeTodayDutyContext {
  employee: {
    employeeId: string;
    fullName: string;
    branchId: string;
    branchName: string;
    employeeStatus: string;
  } | null;
  activeRoster: DutyRosterRecord | null;
  fallbackAssignment: {
    assignmentId: string;
    branchId: string;
    branchName: string;
    clientId: string;
    clientName: string;
    siteId: string;
    siteName: string;
    serviceCategory: ServiceCategory;
    serviceId: string;
    serviceName: string;
    designationId: string;
    designationName: string;
    shift: string;
    shiftStartTime: string;
    shiftEndTime: string;
    reportingTime: string;
    dutyHours: number;
    weeklyOff: string;
    reportingInstructions: string;
  } | null;
  siteGeoConfig: {
    siteId: string;
    siteName: string;
    latitude: number | null;
    longitude: number | null;
    allowedRadiusMeters: number;
    gpsAccuracyThresholdMeters: number;
    isGpsMandatory: boolean;
    isQrEnabled: boolean;
  } | null;
  todayAttendance: AttendanceRecord | null;
  openOvernightAttendance: AttendanceRecord | null;
  unreadNotificationsCount: number;
}

export interface EmployeeAttendanceSummaryRollup {
  employeeId: string;
  employeeName: string;
  branchId: string;
  siteName: string;
  designationName: string;
  presentDays: number;
  lateDays: number;
  halfDays: number;
  absentDays: number;
  weeklyOffDays: number;
  holidayDays: number;
  leaveDays: number;
  exceptionDays: number;
  totalNetHours: number;
  approvedOvertimeHours: number;
  pendingOvertimeHours: number;
}
