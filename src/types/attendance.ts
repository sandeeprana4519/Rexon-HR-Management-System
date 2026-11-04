import { ServiceCategory, UserRole } from './index';

// ============================================================================
// 1. DUTY ROSTER & SHIFT MASTER TYPES (`dutyRosters` & `shifts` COLLECTIONS)
// ============================================================================
export const ROSTER_SHIFT_TYPES = [
  'General Shift',
  'Morning Shift',
  'Evening Shift',
  'Day Shift',
  'Night Shift',
  'Rotational Shift',
  'Custom Shift',
] as const;

export type RosterShiftType = (typeof ROSTER_SHIFT_TYPES)[number];

export type ShiftMasterStatus = 'Active' | 'Inactive';

export interface ShiftMasterRecord {
  shiftId: string; // e.g. SHF-2026-0001
  shiftName: string;
  shiftCode: string;
  shiftType: RosterShiftType;
  startTime: string; // HH:MM (24h)
  endTime: string; // HH:MM (24h)
  reportingTime: string; // HH:MM (24h)
  gracePeriodMinutes: number;
  breakDurationMinutes: number;
  weeklyOffDay: string; // e.g. 'Sunday' | 'Rotational'
  crossesMidnight: boolean;
  overtimeEligible: boolean;
  cutoffMinutesAfterEnd: number; // Minutes after scheduled end before unmarked shift is flagged Absent
  status: ShiftMasterStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertShiftMasterInput {
  shiftId?: string;
  shiftName: string;
  shiftCode: string;
  shiftType: RosterShiftType;
  startTime: string;
  endTime: string;
  reportingTime: string;
  gracePeriodMinutes: number;
  breakDurationMinutes: number;
  weeklyOffDay: string;
  overtimeEligible: boolean;
  cutoffMinutesAfterEnd?: number;
  status: ShiftMasterStatus;
}

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
    shiftType: 'Morning Shift',
    label: 'Morning Shift (06:00 – 14:00 · 8h)',
    startTime: '06:00',
    endTime: '14:00',
    reportingTime: '05:45',
    breakDurationMinutes: 30,
    gracePeriodMinutes: 10,
    crossesMidnight: false,
  },
  {
    shiftType: 'Evening Shift',
    label: 'Evening Shift (14:00 – 22:00 · 8h)',
    startTime: '14:00',
    endTime: '22:00',
    reportingTime: '13:45',
    breakDurationMinutes: 30,
    gracePeriodMinutes: 10,
    crossesMidnight: false,
  },
  {
    shiftType: 'Night Shift',
    label: 'Night Shift (22:00 – 06:00 Next Day · 8h)',
    startTime: '22:00',
    endTime: '06:00',
    reportingTime: '21:45',
    breakDurationMinutes: 30,
    gracePeriodMinutes: 15,
    crossesMidnight: true,
  },
  {
    shiftType: 'Day Shift',
    label: 'Day Shift 12h (08:00 – 20:00 · 12h)',
    startTime: '08:00',
    endTime: '20:00',
    reportingTime: '07:45',
    breakDurationMinutes: 60,
    gracePeriodMinutes: 15,
    crossesMidnight: false,
  },
  {
    shiftType: 'Rotational Shift',
    label: 'Rotational Shift (20:00 – 08:00 Next Day · 12h)',
    startTime: '20:00',
    endTime: '08:00',
    reportingTime: '19:45',
    breakDurationMinutes: 60,
    gracePeriodMinutes: 15,
    crossesMidnight: true,
  },
  {
    shiftType: 'Custom Shift',
    label: 'Custom Shift Timing',
    startTime: '10:00',
    endTime: '19:00',
    reportingTime: '09:45',
    breakDurationMinutes: 60,
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
  shiftId?: string;
  shiftType: RosterShiftType;
  dutyStartTime: string; // HH:MM
  dutyEndTime: string; // HH:MM
  crossesMidnight: boolean;
  breakDurationMinutes: number;
  grossDurationMinutes: number;
  netScheduledMinutes: number;
  reportingTime: string; // HH:MM
  gracePeriodMinutes: number;
  weeklyOffDay?: string;
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
  employeeIds?: string[]; // Optional bulk employee selection
  dutyDate: string; // Start date for Weekly/Monthly or exact date for Daily
  endDate?: string; // Optional explicit range end for Weekly/Monthly
  skipWeekdays?: number[]; // Optional JS day-of-week numbers (0=Sun..6=Sat) to skip as Weekly Off
  shiftId?: string;
  shiftType: RosterShiftType;
  dutyStartTime: string;
  dutyEndTime: string;
  breakDurationMinutes: number;
  reportingTime: string;
  gracePeriodMinutes: number;
  weeklyOffDay?: string;
  assignedFieldOfficerUid: string;
  assignedFieldOfficerName: string;
  dutyInstructions: string;
  publishImmediately: boolean;
  authorizedCapacityException?: boolean;
  capacityExceptionReason?: string;
}

export interface UpdateDutyRosterInput {
  shiftId?: string;
  shiftType: RosterShiftType;
  dutyStartTime: string;
  dutyEndTime: string;
  breakDurationMinutes: number;
  reportingTime: string;
  gracePeriodMinutes: number;
  weeklyOffDay?: string;
  assignedFieldOfficerUid: string;
  assignedFieldOfficerName: string;
  dutyInstructions: string;
  status: DutyRosterStatus;
  editReason?: string; // Mandatory when editing an already Published roster
  authorizedCapacityException?: boolean;
  capacityExceptionReason?: string;
}

// ============================================================================
// 2. ATTENDANCE, GPS LOCATION, PHOTO & PAYROLL VERIFICATION (`attendance`)
// ============================================================================
export const ATTENDANCE_STATUSES = [
  'Present',
  'Absent',
  'Late',
  'Half Day',
  'Weekly Off',
  'Holiday',
  'Leave',
  'On Duty',
  'Pending Verification',
  'Rejected',
  'Incomplete',
  'Pending',
  'Exception',
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_VERIFICATION_STATUSES = [
  'Pending',
  'Verified',
  'Rejected',
  'Exception Approved',
] as const;

export type AttendanceVerificationStatus = (typeof ATTENDANCE_VERIFICATION_STATUSES)[number];

export const ATTENDANCE_LOCATION_STATUSES = [
  'Within Geofence',
  'Outside Geofence',
  'GPS Accuracy Low',
  'GPS Permission Denied',
  'Location Unavailable',
] as const;

export type AttendanceLocationStatus = (typeof ATTENDANCE_LOCATION_STATUSES)[number];

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
  siteLatitude?: number | null;
  siteLongitude?: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  allowedRadiusMeters: number;
  withinGeofence: boolean;
  locationStatus?: AttendanceLocationStatus;
  serverVerified: boolean;
  capturedAt: string;
}

export interface AttendancePhotoMetadata {
  storagePath: string;
  previewUrl: string; // Signed Firebase Storage download URL or compact compressed JPEG preview
  employeeId: string;
  attendanceId: string;
  captureTime: string;
  photoType: 'check_in' | 'check_out' | 'field_report';
  cameraFacing: 'user' | 'environment';
  uploadedBy: string;
}

export interface AttendanceTimeCorrectionEntry {
  correctedAt: string;
  correctedByUid: string;
  correctedByName: string;
  previousCheckInAt: string | null;
  previousCheckOutAt: string | null;
  newCheckInAt: string | null;
  newCheckOutAt: string | null;
  reason: string;
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
 * ONLY records where `isPayrollEligible === true` (`Verified` or `Exception Approved`)
 * are included in downstream Payroll calculations.
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
  verificationStatus?: AttendanceVerificationStatus;
  locationStatus?: AttendanceLocationStatus;
  isPayrollEligible?: boolean;
  checkInAt: string | null; // ISO timestamp
  checkOutAt: string | null; // ISO timestamp
  checkInMethod: CheckInMethod | null;
  checkOutMethod: CheckInMethod | null;
  checkInGeo: AttendanceGeoMetadata | null;
  checkOutGeo: AttendanceGeoMetadata | null;
  checkInPhoto?: AttendancePhotoMetadata | null;
  checkOutPhoto?: AttendancePhotoMetadata | null;
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
  timeCorrectionHistory?: AttendanceTimeCorrectionEntry[];
  idempotencyKey?: string;
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
  gpsLocationStatus?: AttendanceLocationStatus;
  qrTokenOrCode?: string;
  photo?: AttendancePhotoMetadata | null;
  submitAsException?: boolean;
  exceptionReason?: string;
  idempotencyKey?: string;
}

export interface EmployeeCheckOutInput {
  attendanceId: string;
  method: 'GPS' | 'QR';
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  gpsLocationStatus?: AttendanceLocationStatus;
  qrTokenOrCode?: string;
  photo?: AttendancePhotoMetadata | null;
  exceptionReason?: string;
  idempotencyKey?: string;
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
  employeeId?: string; // Supported when HR or Field Officer submits on behalf of an employee
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
// 3B. FIELD OFFICER REPORTS & ATTENDANCE EXCEPTIONS (`attendanceExceptions`)
// ============================================================================
export const FIELD_OFFICER_EXCEPTION_TYPES = [
  'Missing Attendance',
  'Attendance Issue',
  'Site Visit Report',
  'Employee Replacement Requirement',
] as const;

export type FieldOfficerExceptionType = (typeof FIELD_OFFICER_EXCEPTION_TYPES)[number];

export type AttendanceExceptionStatus = 'Pending HR Review' | 'Resolved' | 'Rejected';

export interface AttendanceExceptionReport {
  exceptionId: string; // e.g. AEX-2026-0001
  reportType: FieldOfficerExceptionType;
  branchId: string;
  clientId: string;
  siteId: string;
  siteName: string;
  attendanceDate: string; // YYYY-MM-DD
  employeeId: string; // Optional empty string for site-wide visit report
  employeeName: string;
  shiftType: string;
  summary: string;
  remarks: string;
  photoUrl: string;
  photoStoragePath: string;
  status: AttendanceExceptionStatus;
  reportedByUid: string;
  reportedByName: string;
  reportedByRole: UserRole;
  reviewedByUid: string | null;
  reviewedByName: string | null;
  hrResolutionNotes: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitFieldOfficerExceptionInput {
  reportType: FieldOfficerExceptionType;
  siteId: string;
  attendanceDate: string;
  employeeId?: string;
  shiftType?: string;
  summary: string;
  remarks: string;
  photoUrl?: string;
  photoStoragePath?: string;
}

// ============================================================================
// 3C. ATTENDANCE POLICY & GEOFENCE OVERRIDE APPROVALS (`attendanceApprovals`)
// ============================================================================
export interface AttendancePolicyConfig {
  defaultGeofenceRadiusMeters: number; // Default 200m
  defaultGpsAccuracyThresholdMeters: number; // Default 100m
  shiftAbsentCutoffMinutes: number; // Minutes after shift end before scheduled duty is flagged Absent
  overtimeMinimumMinutes: number; // Minimum extra minutes to qualify for Overtime review
  requireCheckInPhoto: boolean;
  requireCheckOutPhoto: boolean;
  updatedBy: string;
  updatedAt: string;
}

export interface AttendanceApprovalRecord {
  approvalId: string; // e.g. AAP-2026-0001
  approvalType: 'Site Geofence Radius Override' | 'Attendance Policy Change';
  branchId: string;
  siteId: string;
  siteName: string;
  requestedRadiusMeters: number;
  currentRadiusMeters: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
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

// ============================================================================
// 3D. OFFLINE ATTENDANCE QUEUE (CLIENT RESILIENCE — NEVER AUTO-VERIFIED)
// ============================================================================
export interface OfflineAttendanceQueueItem {
  queueId: string;
  idempotencyKey: string;
  action: 'check_in' | 'check_out';
  employeeUid: string;
  employeeName: string;
  siteId: string;
  siteName: string;
  attendanceDate: string;
  capturedAt: string;
  checkInPayload?: EmployeeCheckInInput;
  checkOutPayload?: EmployeeCheckOutInput;
  retryCount: number;
  lastError: string;
}

// ============================================================================
// 3E. 12 PHASE 4 ATTENDANCE REPORT TYPES
// ============================================================================
export const ATTENDANCE_REPORT_TYPES = [
  'Daily Attendance Report',
  'Weekly Attendance Report',
  'Monthly Attendance Report',
  'Employee-wise Attendance Report',
  'Site-wise Attendance Report',
  'Client-wise Attendance Report',
  'Branch-wise Attendance Report',
  'Service-wise Attendance Report',
  'Late Arrival Report',
  'Overtime Report',
  'Missing Check-out Report',
  'Attendance Exception Report',
] as const;

export type AttendanceReportType = (typeof ATTENDANCE_REPORT_TYPES)[number];

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
  | 'Shift'
  | 'Attendance'
  | 'Geofence'
  | 'QR'
  | 'Correction'
  | 'Overtime'
  | 'FieldReport';

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
    profilePhoto?: string;
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
    fullAddress?: string;
    latitude: number | null;
    longitude: number | null;
    allowedRadiusMeters: number;
    gpsAccuracyThresholdMeters: number;
    isGpsMandatory: boolean;
    isQrEnabled: boolean;
  } | null;
  approvedLeaveToday?: {
    requestId: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    reason: string;
  } | null;
  isPhotoRequired?: boolean;
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
  verifiedPayrollDays: number;
  totalNetHours: number;
  approvedOvertimeHours: number;
  pendingOvertimeHours: number;
}
