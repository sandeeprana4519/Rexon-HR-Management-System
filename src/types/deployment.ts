import { ServiceCategory, UserRole } from './index';

export const ASSIGNMENT_STATUSES = [
  'Active',
  'Upcoming',
  'Completed',
  'Transferred',
  'Cancelled',
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export interface ShiftDefinition {
  code: string;
  label: string;
  startTime: string; // HH:MM (24-hour)
  endTime: string; // HH:MM (24-hour)
  defaultReportingTime: string; // HH:MM
  dutyHours: number;
  overnight: boolean;
}

export const STANDARD_SHIFTS: readonly ShiftDefinition[] = [
  {
    code: 'SHIFT_A_8H',
    label: 'Morning Shift A (06:00–14:00)',
    startTime: '06:00',
    endTime: '14:00',
    defaultReportingTime: '05:45',
    dutyHours: 8,
    overnight: false,
  },
  {
    code: 'SHIFT_B_8H',
    label: 'Afternoon Shift B (14:00–22:00)',
    startTime: '14:00',
    endTime: '22:00',
    defaultReportingTime: '13:45',
    dutyHours: 8,
    overnight: false,
  },
  {
    code: 'SHIFT_C_8H',
    label: 'Night Shift C (22:00–06:00)',
    startTime: '22:00',
    endTime: '06:00',
    defaultReportingTime: '21:45',
    dutyHours: 8,
    overnight: true,
  },
  {
    code: 'DAY_12H',
    label: 'Day Shift (08:00–20:00)',
    startTime: '08:00',
    endTime: '20:00',
    defaultReportingTime: '07:45',
    dutyHours: 12,
    overnight: false,
  },
  {
    code: 'NIGHT_12H',
    label: 'Night Shift (20:00–08:00)',
    startTime: '20:00',
    endTime: '08:00',
    defaultReportingTime: '19:45',
    dutyHours: 12,
    overnight: true,
  },
  {
    code: 'GENERAL_9H',
    label: 'General Shift (09:00–18:00)',
    startTime: '09:00',
    endTime: '18:00',
    defaultReportingTime: '08:45',
    dutyHours: 9,
    overnight: false,
  },
  {
    code: 'DAY_8H_STD',
    label: 'Day Shift (08:00–16:00)',
    startTime: '08:00',
    endTime: '16:00',
    defaultReportingTime: '07:45',
    dutyHours: 8,
    overnight: false,
  },
] as const;

/**
 * Primary Employee Site Assignment Record: `employeeAssignments/{assignmentId}`
 * Historical records are never deleted; transitions use Completed, Transferred, or Cancelled.
 */
export interface EmployeeAssignmentRecord {
  assignmentId: string; // Auto-generated e.g. ASN-2026-0001
  employeeId: string;
  employeeName: string;
  linkedUid: string; // Employee Auth UID for isolated self-read in Employee Portal
  branchId: string;
  branchName: string;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  siteServiceId: string; // Linked Phase 2 siteServices configuration ID if matched
  serviceCategory: ServiceCategory;
  serviceId: string;
  serviceName: string;
  designationId: string;
  designationName: string;
  shift: string;
  shiftStartTime: string; // HH:MM
  shiftEndTime: string; // HH:MM
  reportingTime: string; // HH:MM
  dutyHours: number;
  weeklyOff: string;
  startDate: string; // YYYY-MM-DD (Duty start date)
  endDate: string; // YYYY-MM-DD (Duty end date)
  reportingInstructions: string;
  remarks: string;
  assignmentStatus: AssignmentStatus;

  // Transfer Lineage (maintains previous site and new site information)
  previousAssignmentId: string;
  previousSiteId: string;
  previousSiteName: string;
  transferredToAssignmentId: string;
  transferredToSiteId: string;
  transferredToSiteName: string;

  // Audit & Ownership Metadata
  assignedBy: string; // Actor display name & role
  assignedByRole: UserRole;
  createdBy: string; // Actor UID
  updatedBy: string; // Actor UID
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface AssignmentFormInput {
  employeeId: string;
  branchId: string;
  clientId: string;
  siteId: string;
  siteServiceId?: string;
  serviceCategory: ServiceCategory;
  serviceId: string;
  designationId: string;
  shift: string;
  shiftStartTime: string;
  shiftEndTime: string;
  reportingTime: string;
  dutyHours: number;
  weeklyOff: string;
  startDate: string;
  endDate: string;
  reportingInstructions: string;
  remarks: string;
}

export interface TransferAssignmentInput {
  sourceAssignmentId: string;
  newClientId: string;
  newSiteId: string;
  newSiteServiceId?: string;
  serviceCategory: ServiceCategory;
  serviceId: string;
  designationId: string;
  shift: string;
  shiftStartTime: string;
  shiftEndTime: string;
  reportingTime: string;
  dutyHours: number;
  weeklyOff: string;
  transferDate: string; // YYYY-MM-DD (start date at new site; closes old duty)
  newEndDate: string; // YYYY-MM-DD
  reportingInstructions: string;
  remarks: string;
}

export type AssignmentHistoryActionType =
  | 'Employee Assigned'
  | 'Employee Transferred'
  | 'Assignment Modified'
  | 'Assignment Ended'
  | 'Assignment Cancelled'
  | 'Field Officer Remark Added'
  | 'Field Officer Action Requested'
  | 'Approval Decision Recorded';

/**
 * Append-Only Assignment History Record: `assignmentHistory/{historyId}`
 */
export interface AssignmentHistoryRecord {
  historyId: string; // e.g. AHS-2026-0001
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  linkedUid: string;
  branchId: string;
  clientId: string;
  siteId: string;
  siteName: string;
  previousSiteId: string;
  previousSiteName: string;
  newSiteId: string;
  newSiteName: string;
  actionType: AssignmentHistoryActionType;
  summary: string;
  remarks: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  timestamp: string;
}

export const SHORTAGE_URGENCY_LEVELS = ['Normal', 'High', 'Critical'] as const;
export type ShortageUrgencyLevel = (typeof SHORTAGE_URGENCY_LEVELS)[number];

export const SHORTAGE_STATUSES = ['Open', 'Acknowledged', 'Resolved'] as const;
export type ShortageStatus = (typeof SHORTAGE_STATUSES)[number];

/**
 * Field Officer / HR Manpower Shortage Report: `manpowerShortages/{shortageId}`
 */
export interface ManpowerShortageRecord {
  shortageId: string; // e.g. MSH-2026-0001
  siteId: string;
  siteName: string;
  clientId: string;
  clientName: string;
  branchId: string;
  serviceCategory: ServiceCategory;
  serviceId: string;
  serviceName: string;
  designationId: string;
  designationName: string;
  shift: string;
  shortageCount: number;
  urgency: ShortageUrgencyLevel;
  dateReportedFor: string; // YYYY-MM-DD
  reason: string;
  status: ShortageStatus;
  reportedByUid: string;
  reportedByName: string;
  reportedByRole: UserRole;
  resolutionRemarks: string;
  resolvedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportManpowerShortageInput {
  siteId: string;
  serviceCategory: ServiceCategory;
  serviceId: string;
  designationId: string;
  shift: string;
  shortageCount: number;
  urgency: ShortageUrgencyLevel;
  dateReportedFor: string;
  reason: string;
  escalateToApproval?: boolean;
}

/**
 * Sanitized Site Deployment Summary: `siteDeploymentSummaries/{siteId}`
 * Strictly excludes ALL employee PII, names, contact info, Aadhaar, PAN, bank, and salary
 * so Site Portal (`role == 'site'`) can inspect live post & shift deployment safely.
 */
export interface SanitizedSiteLineSummary {
  lineKey: string;
  serviceCategory: ServiceCategory;
  serviceId: string;
  serviceName: string;
  designationId: string;
  designationName: string;
  shiftType: string;
  workingHours: string;
  weeklyOff: string;
  requiredCount: number;
  deployedCount: number;
  vacantCount: number; // Always >= 0: Math.max(0, requiredCount - deployedCount)
  activeAssignmentsCount: number;
  upcomingAssignmentsCount: number;
}

export interface SanitizedShiftSummary {
  shift: string;
  shiftTiming: string;
  securityDeployed: number;
  housekeepingDeployed: number;
  manpowerDeployed: number;
  totalActiveDeployed: number;
  upcomingCount: number;
}

export interface SiteDeploymentSummaryRecord {
  siteId: string;
  siteName: string;
  clientId: string;
  clientName: string;
  branchId: string;
  totalRequired: number;
  totalDeployed: number;
  totalVacant: number; // Always >= 0
  totalActiveAssignments: number;
  totalUpcomingAssignments: number;
  lines: SanitizedSiteLineSummary[];
  shiftBreakdown: SanitizedShiftSummary[];
  updatedAt: string;
}

// ============================================================================
// DASHBOARD & AVAILABILITY VIEW COMPUTED MODELS
// ============================================================================
export interface SiteDeploymentLineRow {
  rowKey: string;
  siteServiceId: string;
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
  shiftType: string;
  workingHours: string;
  weeklyOff: string;
  requiredEmployees: number;
  deployedEmployees: number;
  vacantPositions: number; // Math.max(0, requiredEmployees - deployedEmployees)
  activeAssignments: number;
  upcomingAssignments: number;
  openShortageReports: number;
}

export type EmployeeAvailabilityState =
  | 'Available'
  | 'Currently Deployed'
  | 'On Leave'
  | 'Upcoming Assignment'
  | 'Conflicting Shifts'
  | 'Awaiting Verification'
  | 'Inactive';

export interface EmployeeAvailabilityItem {
  employeeId: string;
  fullName: string;
  mobile: string;
  branchId: string;
  branchName: string;
  employeeStatus: string;
  docVerificationSummary: string;
  hasUnverifiedQualification: boolean;
  assignedServiceCategories: ServiceCategory[];
  assignedDesignationIds: string[];
  assignedDesignationNames: string[];
  availabilityState: EmployeeAvailabilityState;
  activeAssignmentsOnDate: EmployeeAssignmentRecord[];
  upcomingAssignments: EmployeeAssignmentRecord[];
  hasShiftConflict: boolean;
  conflictDetails: string;
  totalDutyHoursOnDate: number;
}

export type DeploymentReportKey =
  | 'site_deployment'
  | 'client_deployment'
  | 'branch_deployment'
  | 'service_deployment'
  | 'designation_deployment'
  | 'assignment_history'
  | 'vacancy_shortage'
  | 'upcoming_assignments'
  | 'employee_availability';
