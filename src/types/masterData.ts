import { UserRole } from './index';

export interface HistoryEntry {
  id: string;
  timestamp: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  details: string;
}

// ============================================================================
// 1. BRANCH MANAGEMENT TYPES (ADMIN ONLY)
// ============================================================================
export type BranchStatus = 'Active' | 'Inactive';

export interface BranchRecord {
  branchId: string; // Automatic unique ID (e.g. BRN-2026-0001)
  branchName: string;
  branchCode: string; // Unique uppercase code (e.g. MUM-HQ)
  managerName: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pinCode: string;
  status: BranchStatus;
  createdDate: string; // ISO date-time
  updatedAt: string;
  createdBy: string;
  isDeleted: boolean; // Soft delete flag preserving historical data
  deletedAt: string | null;
  deletedBy: string | null;
  history: HistoryEntry[];
}

export type BranchFormInput = Omit<
  BranchRecord,
  | 'branchId'
  | 'createdDate'
  | 'updatedAt'
  | 'createdBy'
  | 'isDeleted'
  | 'deletedAt'
  | 'deletedBy'
  | 'history'
>;

// ============================================================================
// 2. HR MANAGEMENT & GRANULAR PERMISSION TYPES (ADMIN ONLY)
// ============================================================================
export const HR_DESIGNATIONS = [
  'Senior HR',
  'Branch HR',
  'Site HR',
  'HR Executive',
  'Accountant',
] as const;

export type HRDesignation = (typeof HR_DESIGNATIONS)[number];

export const HR_PERMISSIONS = [
  'branch.view',
  'branch.manage',
  'hr.view',
  'hr.manage',
  'client.view',
  'client.create',
  'client.edit',
  'client.delete',
  'site.view',
  'site.create',
  'site.edit',
  'site.delete',
  'service.view',
  'service.manage',
  'designation.view',
  'designation.manage',
  'employee.view',
  'employee.create',
  'employee.edit',
  'employee.delete',
  'employee.verify_docs',
  'employee.sensitive',
  'employee.multi_designation',
  'employee.manage',
  'assignment.view',
  'assignment.create',
  'assignment.edit',
  'assignment.transfer',
  'assignment.manage',
  'billing.view',
  'billing.manage',
  'payroll.view',
  'payroll.manage',
  'reports.view',
  'attendance.view',
  'attendance.view_all_branch',
  'attendance.create',
  'attendance.edit',
  'attendance.verify',
  'attendance.approve',
  'attendance.correct',
  'attendance.export',
  'roster.view',
  'roster.create',
  'roster.edit',
  'roster.publish',
  'roster.delete',
  'attendance.qr_manage',
  'attendance.gps_settings',
  'attendance.overtime_approve',
] as const;

export type HRPermissionKey = (typeof HR_PERMISSIONS)[number];

export interface PermissionDefinitionItem {
  key: HRPermissionKey;
  label: string;
  module: string;
  description: string;
  sensitive?: boolean;
}

export const HR_PERMISSION_GROUPS: {
  module: string;
  items: PermissionDefinitionItem[];
}[] = [
  {
    module: 'Branch & HR Governance',
    items: [
      {
        key: 'branch.view',
        label: 'View Branches',
        module: 'Branch',
        description: 'Inspect assigned regional branch details and operational rollups.',
      },
      {
        key: 'branch.manage',
        label: 'Manage Branches',
        module: 'Branch',
        description: 'Elevated branch master modification capability.',
        sensitive: true,
      },
      {
        key: 'hr.view',
        label: 'View HR Directory',
        module: 'HR',
        description: 'View HR personnel profiles within authorized scope.',
      },
      {
        key: 'hr.manage',
        label: 'Manage HR Profiles',
        module: 'HR',
        description: 'Elevated HR account coordination capability.',
        sensitive: true,
      },
    ],
  },
  {
    module: 'Client Master Management',
    items: [
      {
        key: 'client.view',
        label: 'View Clients',
        module: 'Client',
        description: 'Access contracted client directory within assigned branches.',
      },
      {
        key: 'client.create',
        label: 'Create Clients',
        module: 'Client',
        description: 'Onboard new contracted client organizations.',
      },
      {
        key: 'client.edit',
        label: 'Edit Clients',
        module: 'Client',
        description: 'Update client contacts, GST/PAN details, and contract schedules.',
      },
      {
        key: 'client.delete',
        label: 'Archive / Delete Clients',
        module: 'Client',
        description: 'Directly archive client records without separate Admin approval.',
        sensitive: true,
      },
    ],
  },
  {
    module: 'Site & Deployment Configuration',
    items: [
      {
        key: 'site.view',
        label: 'View Sites',
        module: 'Site',
        description: 'Inspect client sites and service-wise manpower summaries.',
      },
      {
        key: 'site.create',
        label: 'Create Sites',
        module: 'Site',
        description: 'Register new deployment sites under contracted clients.',
      },
      {
        key: 'site.edit',
        label: 'Edit Sites & Services',
        module: 'Site',
        description: 'Update site details and configure Security, Housekeeping & Manpower posts.',
      },
      {
        key: 'site.delete',
        label: 'Archive / Delete Sites',
        module: 'Site',
        description: 'Directly archive sites without submitting an Admin approval request.',
        sensitive: true,
      },
    ],
  },
  {
    module: 'Service & Designation Master',
    items: [
      {
        key: 'service.view',
        label: 'View Services',
        module: 'Service',
        description: 'Browse authorized Security, Housekeeping, and Manpower services.',
      },
      {
        key: 'service.manage',
        label: 'Manage Services',
        module: 'Service',
        description: 'Create, edit, activate, or deactivate master service catalog items.',
        sensitive: true,
      },
      {
        key: 'designation.view',
        label: 'View Designations',
        module: 'Designation',
        description: 'View authorized designations, skills, training, and license criteria.',
      },
      {
        key: 'designation.manage',
        label: 'Manage Designations',
        module: 'Designation',
        description: 'Create and update designations linked to service categories.',
        sensitive: true,
      },
    ],
  },
  {
    module: 'Workforce, Billing, Payroll & Reports',
    items: [
      {
        key: 'employee.view',
        label: 'View Employees',
        module: 'Employee',
        description: 'Inspect employee roster, operational profiles, and deployment assignments in branch.',
      },
      {
        key: 'employee.create',
        label: 'Register Employees',
        module: 'Employee',
        description: 'Onboard and register new Security, Housekeeping, and Manpower employees.',
      },
      {
        key: 'employee.edit',
        label: 'Edit Employees',
        module: 'Employee',
        description: 'Update employee details, status, site deployment, and service eligibility.',
      },
      {
        key: 'employee.verify_docs',
        label: 'Verify Employee Documents',
        module: 'Employee',
        description: 'Upload, verify, or reject employee KYC, police verification, and certificates.',
      },
      {
        key: 'employee.sensitive',
        label: 'View & Edit Sensitive KYC / Salary',
        module: 'Employee',
        description: 'Access isolated Aadhaar, PAN, Bank Account, IFSC, and base salary structure.',
        sensitive: true,
      },
      {
        key: 'employee.multi_designation',
        label: 'Assign Multiple Designations',
        module: 'Employee',
        description: 'Approve and assign multiple cross-trained designations to a single employee.',
      },
      {
        key: 'employee.delete',
        label: 'Soft-Delete Employees Directly',
        module: 'Employee',
        description: 'Directly archive/soft-delete employee records without separate Admin approval.',
        sensitive: true,
      },
      {
        key: 'employee.manage',
        label: 'Manage Employees (Full Branch HR)',
        module: 'Employee',
        description: 'Umbrella permission covering onboarding, edits, KYC verification, and salary setup.',
      },
      {
        key: 'assignment.view',
        label: 'View Site Assignments & Availability',
        module: 'Assignment',
        description: 'Inspect site deployments, employee shift assignments, vacancies, and availability.',
      },
      {
        key: 'assignment.create',
        label: 'Create Site Assignments',
        module: 'Assignment',
        description: 'Assign eligible active employees to client sites and shifts within branch scope.',
      },
      {
        key: 'assignment.edit',
        label: 'Edit & End Site Assignments',
        module: 'Assignment',
        description: 'Modify duty schedules, end completed assignments, or cancel erroneous entries.',
      },
      {
        key: 'assignment.transfer',
        label: 'Transfer Employees Between Sites',
        module: 'Assignment',
        description: 'Execute inter-site transfers while preserving full historical assignment lineage.',
      },
      {
        key: 'assignment.manage',
        label: 'Manage Workforce Deployment (Full)',
        module: 'Assignment',
        description: 'Full branch assignment control including reviewing Field Officer replacement/transfer actions.',
      },
      {
        key: 'billing.view',
        label: 'View Billing',
        module: 'Billing',
        description: 'Inspect client billing schedules and invoice summaries.',
      },
      {
        key: 'billing.manage',
        label: 'Manage Billing',
        module: 'Billing',
        description: 'Prepare and update client invoices and commercial statements.',
      },
      {
        key: 'payroll.view',
        label: 'View Payroll',
        module: 'Payroll',
        description: 'View monthly attendance-linked salary registers.',
      },
      {
        key: 'payroll.manage',
        label: 'Manage Payroll',
        module: 'Payroll',
        description: 'Process payroll disbursements, advances, and statutory deductions.',
      },
      {
        key: 'reports.view',
        label: 'View Reports',
        module: 'Reports',
        description: 'Access branch master data, manpower, and vacancy analytics.',
      },
    ],
  },
  {
    module: 'Duty Roster Management (Phase 4)',
    items: [
      {
        key: 'roster.view',
        label: 'View Duty Rosters',
        module: 'Roster',
        description: 'Inspect daily, weekly, and monthly shift rosters across authorized sites.',
      },
      {
        key: 'roster.create',
        label: 'Create Draft Duty Rosters',
        module: 'Roster',
        description: 'Generate daily, weekly, and monthly shift schedules including overnight duties.',
      },
      {
        key: 'roster.edit',
        label: 'Edit Duty Rosters',
        module: 'Roster',
        description: 'Modify draft or published shift timings, instructions, and Field Officer assignments.',
      },
      {
        key: 'roster.publish',
        label: 'Publish Rosters & Notify Workforce',
        module: 'Roster',
        description: 'Publish validated duty rosters so shifts appear in Employee & Field Officer portals.',
      },
      {
        key: 'roster.delete',
        label: 'Cancel / Delete Duty Rosters',
        module: 'Roster',
        description: 'Cancel or remove draft/erroneous duty roster entries with mandatory audit reason.',
        sensitive: true,
      },
    ],
  },
  {
    module: 'Attendance, Geofence, QR & Overtime (Phase 4)',
    items: [
      {
        key: 'attendance.view',
        label: 'View Branch Attendance',
        module: 'Attendance',
        description: 'Inspect daily, weekly, and monthly attendance logs within assigned branches.',
      },
      {
        key: 'attendance.view_all_branch',
        label: 'View Multi-Branch Attendance Rollups',
        module: 'Attendance',
        description: 'Cross-branch attendance inspection for senior HR leadership.',
        sensitive: true,
      },
      {
        key: 'attendance.create',
        label: 'Record Attendance Entries',
        module: 'Attendance',
        description: 'Log Weekly Off, Holiday, Leave, Absent, or manual verified attendance entries.',
      },
      {
        key: 'attendance.edit',
        label: 'Edit Attendance Status & Remarks',
        module: 'Attendance',
        description: 'Update non-locked attendance records and record operational HR remarks.',
      },
      {
        key: 'attendance.verify',
        label: 'Verify Daily Attendance',
        module: 'Attendance',
        description: 'Verify GPS/QR check-ins and publish sanitized site turnout counts.',
      },
      {
        key: 'attendance.approve',
        label: 'Approve Exceptions & Capacity Overrides',
        module: 'Attendance',
        description: 'Final approval authority for geofence exceptions and sanctioned roster overrides.',
        sensitive: true,
      },
      {
        key: 'attendance.correct',
        label: 'Process Missing Punch & Corrections',
        module: 'Attendance',
        description: 'Review and apply employee missing check-in/out and time correction requests.',
      },
      {
        key: 'attendance.overtime_approve',
        label: 'Approve Employee Overtime',
        module: 'Attendance',
        description: 'Approve or reject extra duty hours worked beyond scheduled shift duration.',
        sensitive: true,
      },
      {
        key: 'attendance.qr_manage',
        label: 'Generate & Manage Site Shift QR Codes',
        module: 'Attendance',
        description: 'Issue time-limited rotating QR verification sessions for site shifts.',
      },
      {
        key: 'attendance.gps_settings',
        label: 'Configure Site Geofence & GPS Thresholds',
        module: 'Attendance',
        description: 'Update site latitude, longitude, allowed radius (meters), and GPS accuracy rules.',
        sensitive: true,
      },
      {
        key: 'attendance.export',
        label: 'Export Attendance CSV / Excel Reports',
        module: 'Attendance',
        description: 'Download daily, weekly, and monthly attendance registers for payroll and audits.',
      },
    ],
  },
];

export const PERMISSION_PROFILES = [
  'Full Branch Operations',
  'Client & Site Coordinator',
  'Site HR & Attendance',
  'Accounts & Billing Only',
  'View Only Auditor',
  'Custom Granular Profile',
] as const;

export type PermissionProfileName = (typeof PERMISSION_PROFILES)[number];

export const PERMISSION_PROFILE_MAP: Record<PermissionProfileName, HRPermissionKey[]> = {
  'Full Branch Operations': [
    'branch.view',
    'client.view',
    'client.create',
    'client.edit',
    'site.view',
    'site.create',
    'site.edit',
    'service.view',
    'designation.view',
    'employee.view',
    'employee.manage',
    'assignment.view',
    'assignment.manage',
    'roster.view',
    'roster.create',
    'roster.edit',
    'roster.publish',
    'attendance.view',
    'attendance.create',
    'attendance.edit',
    'attendance.verify',
    'attendance.correct',
    'attendance.qr_manage',
    'attendance.export',
    'billing.view',
    'billing.manage',
    'payroll.view',
    'reports.view',
  ],
  'Client & Site Coordinator': [
    'branch.view',
    'client.view',
    'client.create',
    'client.edit',
    'site.view',
    'site.create',
    'site.edit',
    'service.view',
    'designation.view',
    'employee.view',
    'assignment.view',
    'assignment.create',
    'assignment.edit',
    'assignment.transfer',
    'roster.view',
    'attendance.view',
    'reports.view',
  ],
  'Site HR & Attendance': [
    'branch.view',
    'client.view',
    'site.view',
    'service.view',
    'designation.view',
    'employee.view',
    'employee.manage',
    'assignment.view',
    'assignment.manage',
    'roster.view',
    'roster.create',
    'roster.edit',
    'roster.publish',
    'attendance.view',
    'attendance.create',
    'attendance.verify',
    'attendance.correct',
    'attendance.qr_manage',
    'reports.view',
  ],
  'Accounts & Billing Only': [
    'branch.view',
    'client.view',
    'site.view',
    'service.view',
    'designation.view',
    'assignment.view',
    'attendance.view',
    'attendance.export',
    'billing.view',
    'billing.manage',
    'payroll.view',
    'payroll.manage',
    'reports.view',
  ],
  'View Only Auditor': [
    'branch.view',
    'client.view',
    'site.view',
    'service.view',
    'designation.view',
    'employee.view',
    'assignment.view',
    'roster.view',
    'attendance.view',
    'reports.view',
  ],
  'Custom Granular Profile': ['client.view', 'site.view', 'service.view', 'designation.view'],
};

export type HRAccountStatus = 'Active' | 'Inactive' | 'Suspended';

export interface HRProfileRecord {
  hrId: string; // Automatic unique HR ID (e.g. HR-2026-0001)
  uid: string; // Firebase Auth UID (or pending/demo UID)
  fullName: string;
  email: string;
  mobile: string;
  profilePhoto: string; // Storage URL or validated data preview URL
  assignedBranches: string[]; // Array of branchIds
  hrDesignation: HRDesignation;
  permissionProfile: PermissionProfileName;
  permissions: string[];
  joiningDate: string; // YYYY-MM-DD
  accountStatus: HRAccountStatus;
  authProvisionMode: 'firebase_backend' | 'demo_preview';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  history: HistoryEntry[];
}

export type HRProfileFormInput = Omit<
  HRProfileRecord,
  | 'hrId'
  | 'uid'
  | 'permissions'
  | 'authProvisionMode'
  | 'createdAt'
  | 'updatedAt'
  | 'createdBy'
  | 'history'
>;

// ============================================================================
// 3. CLIENT MANAGEMENT TYPES (HR WITHIN PERMISSIONS & ADMIN ALL)
// ============================================================================
export const CLIENT_TYPES = [
  'Factory',
  'Manufacturing Company',
  'Hospital',
  'Mall',
  'Society',
  'Warehouse',
  'Corporate Office',
  'School/College',
  'Hotel',
  'Other',
] as const;

export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_STATUSES = ['Active', 'Inactive', 'On Hold', 'Expired'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const PAYMENT_TERMS_OPTIONS = [
  'Net 15 Days',
  'Net 30 Days',
  'Net 45 Days',
  '7th of Every Month',
  '10th of Every Month',
  'Advance Monthly Billing',
] as const;

export interface ClientRecord {
  clientId: string; // Automatic unique ID (e.g. CLT-2026-0001)
  companyName: string;
  displayName: string;
  companyType: ClientType;
  gstNumber: string;
  panNumber: string;
  registeredAddress: string;
  state: string;
  city: string;
  pinCode: string;
  contactPerson: string;
  contactDesignation: string;
  mobile: string;
  alternateMobile: string;
  email: string;
  billingAddress: string;
  billingContact: string;
  contractStartDate: string;
  contractEndDate: string;
  paymentTerms: string;
  assignedBranch: string; // branchId
  clientStatus: ClientStatus;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  history: HistoryEntry[];
}

export type ClientFormInput = Omit<
  ClientRecord,
  'clientId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'isArchived' | 'history'
>;

// ============================================================================
// 4. SITE MANAGEMENT TYPES (HR CREATE/EDIT IN SCOPE & ADMIN FULL ACCESS)
// ============================================================================
export const SITE_TYPES = [
  'Factory',
  'Warehouse',
  'Office',
  'Hospital',
  'Mall',
  'Society',
  'School/College',
  'Hotel',
  'Construction Site',
  'Other',
] as const;

export type SiteType = (typeof SITE_TYPES)[number];

export const SITE_STATUSES = ['Active', 'Inactive', 'Pending', 'Suspended'] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export interface SiteRecord {
  siteId: string; // Automatic unique ID (e.g. STE-2026-0001)
  siteName: string;
  clientId: string; // Every Site must belong to one Client
  clientName: string;
  branchId: string;
  siteType: SiteType;
  fullAddress: string;
  city: string;
  state: string;
  pinCode: string;
  googleMapsLocation: string;
  latitude?: number | null;
  longitude?: number | null;
  allowedRadiusMeters?: number;
  gpsAccuracyThresholdMeters?: number;
  isGpsMandatory?: boolean;
  isQrEnabled?: boolean;
  siteContactPerson: string;
  siteManagerName: string;
  managerMobile: string;
  managerEmail: string;
  startDate: string;
  contractEndDate: string;
  siteStatus: SiteStatus;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean; // Soft delete preserving historical records
  archivedAt: string | null;
  archivedBy: string | null;
  history: HistoryEntry[];
}

export type SiteFormInput = Omit<
  SiteRecord,
  | 'siteId'
  | 'createdBy'
  | 'createdAt'
  | 'updatedAt'
  | 'isArchived'
  | 'archivedAt'
  | 'archivedBy'
  | 'history'
>;

// ============================================================================
// 5. SERVICE MANAGEMENT TYPES (STORED IN FIRESTORE `services` COLLECTION)
// ============================================================================
export const SERVICE_CATEGORIES = ['Security', 'Housekeeping', 'Manpower'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export type MasterActiveStatus = 'Active' | 'Inactive';

export interface ServiceRecord {
  serviceId: string; // e.g. SRV-2026-0001
  serviceName: string;
  serviceCategory: ServiceCategory;
  serviceCode: string; // e.g. SEC-GRD
  description: string;
  status: MasterActiveStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type ServiceFormInput = Omit<
  ServiceRecord,
  'serviceId' | 'createdBy' | 'createdAt' | 'updatedAt'
>;

// ============================================================================
// 6. DESIGNATION MANAGEMENT TYPES (STORED IN FIRESTORE `designations` COLLECTION)
// ============================================================================
export interface DesignationRecord {
  designationId: string; // e.g. DSG-2026-0001
  designationName: string;
  serviceCategory: ServiceCategory;
  relatedServiceId: string; // Links to services/{serviceId}
  relatedServiceName: string;
  description: string;
  requiredSkills: string;
  qualification: string;
  trainingRequirements: string;
  licenseRequirements: string;
  status: MasterActiveStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type DesignationFormInput = Omit<
  DesignationRecord,
  'designationId' | 'createdBy' | 'createdAt' | 'updatedAt'
>;

// ============================================================================
// 7. SITE SERVICE CONFIGURATION TYPES (`siteServices` COLLECTION)
//    Vacant = Math.max(0, Required - Deployed) — Never negative!
// ============================================================================
export const SHIFT_TYPES = [
  'Day Shift (8h)',
  'Night Shift (8h)',
  'Rotational 3-Shift (8h)',
  'Day Shift (12h)',
  'Night Shift (12h)',
  'General Shift (9h)',
  '24x7 Reliever Covered',
] as const;

export type ShiftTypeOption = (typeof SHIFT_TYPES)[number];

export const WORKING_HOURS_OPTIONS = [
  '8 Hours',
  '9 Hours',
  '10 Hours',
  '12 Hours',
] as const;

export const WEEKLY_OFF_OPTIONS = [
  'Rotational (1 Day/Week)',
  'Sunday Fixed',
  'Reliever Covered (No Post Gap)',
  'Saturday & Sunday',
  'Alternate Sunday',
] as const;

export interface SiteServiceConfigRecord {
  siteServiceId: string; // e.g. SSC-2026-0001
  siteId: string;
  siteName: string;
  clientId: string;
  branchId: string;
  serviceCategory: ServiceCategory;
  serviceId: string;
  serviceName: string;
  designationId: string;
  designationName: string;
  requiredCount: number;
  deployedCount: number;
  vacantCount: number; // Always >= 0: Math.max(0, requiredCount - deployedCount)
  shiftType: string;
  workingHours: string;
  weeklyOff: string;
  serviceStartDate: string;
  serviceEndDate: string;
  notes: string;
  status: MasterActiveStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type SiteServiceConfigFormInput = Omit<
  SiteServiceConfigRecord,
  | 'siteServiceId'
  | 'vacantCount'
  | 'createdBy'
  | 'createdAt'
  | 'updatedAt'
>;

export interface CategoryManpowerRollup {
  category: ServiceCategory;
  designationLines: number;
  requiredCount: number;
  deployedCount: number;
  vacantCount: number;
}

export interface SiteManpowerSummary {
  totalLines: number;
  totalRequired: number;
  totalDeployed: number;
  totalVacant: number;
  byCategory: Record<ServiceCategory, CategoryManpowerRollup>;
}

// ============================================================================
// 8. APPROVAL WORKFLOW TYPES (`approvals` COLLECTION)
// ============================================================================
export const APPROVAL_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_REQUEST_TYPES = [
  'Site Deletion',
  'Client Deletion',
  'Employee Deletion',
  'Employee Sensitive Change',
  'Client Sensitive Change',
  'Site Sanctioned Strength Override',
  'Field Officer Replacement Request',
  'Field Officer Transfer Request',
  'Manpower Shortage Escalation',
  'Roster Capacity Exception',
  'Attendance Correction Approval',
  'Overtime Approval Request',
  'Permission Change Request',
  'Branch Scope Exception',
] as const;

export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

export interface ApprovalRequestRecord {
  approvalId: string; // e.g. APR-2026-0001
  requestType: ApprovalRequestType;
  module:
    | 'Client'
    | 'Site'
    | 'Employee'
    | 'Assignment'
    | 'Roster'
    | 'Attendance'
    | 'Permissions'
    | 'Branch'
    | 'Service'
    | 'Designation';
  targetRecordId: string;
  targetRecordName: string;
  branchId: string;
  requestedByUid: string;
  requestedByName: string;
  requestedByRole: UserRole;
  summary: string;
  reason: string;
  proposedPayload?: Record<string, string | number | boolean>;
  status: ApprovalStatus;
  reviewedByUid: string | null;
  reviewedByName: string | null;
  reviewRemarks: string;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

export interface SubmitApprovalInput {
  requestType: ApprovalRequestType;
  module: ApprovalRequestRecord['module'];
  targetRecordId: string;
  targetRecordName: string;
  branchId: string;
  summary: string;
  reason: string;
  proposedPayload?: Record<string, string | number | boolean>;
}

// ============================================================================
// 9. AUDIT LOG TYPES (`auditLogs` COLLECTION — IMMUTABLE APPEND-ONLY)
// ============================================================================
export type AuditModuleName =
  | 'Branch'
  | 'HR'
  | 'Client'
  | 'Site'
  | 'SiteService'
  | 'Service'
  | 'Designation'
  | 'Employee'
  | 'Assignment'
  | 'Roster'
  | 'Attendance'
  | 'Permissions'
  | 'Approvals';

export interface AuditLogRecord {
  logId: string; // e.g. AUD-2026-0001
  action: string; // e.g. 'Branch Created', 'Service Updated', 'Permission Changed'
  module: AuditModuleName;
  recordId: string;
  performedBy: string; // Full Name + Email/Role
  actorUid: string;
  role: UserRole;
  branchId: string;
  timestamp: string; // ISO string for UI sorting/display
  summary: string;
}

export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Delhi (NCT)',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Tamil Nadu',
  'Telangana',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;
