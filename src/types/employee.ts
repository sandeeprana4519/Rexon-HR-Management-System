import { ServiceCategory, UserRole } from './index';

export const GENDERS = ['Male', 'Female', 'Other'] as const;
export type EmployeeGender = (typeof GENDERS)[number];

export const EMPLOYMENT_TYPES = [
  'Full-Time',
  'Contract',
  'Part-Time',
  'Reliever',
  'Temporary',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYEE_STATUSES = [
  'Active',
  'Inactive',
  'On Leave',
  'Suspended',
  'Exited',
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const SALARY_TYPES = ['Monthly', 'Daily', 'Hourly'] as const;
export type SalaryType = (typeof SALARY_TYPES)[number];

export const EMPLOYEE_DOCUMENT_TYPES = [
  'Aadhaar Document',
  'PAN Document',
  'Photograph',
  'Address Proof',
  'Police Verification',
  'Qualification Certificates',
  'Training Certificates',
  'Experience Certificates',
  'Bank Proof',
  'Other Documents',
] as const;
export type EmployeeDocumentType = (typeof EMPLOYEE_DOCUMENT_TYPES)[number];

export const SENSITIVE_KYC_DOCUMENT_TYPES: readonly EmployeeDocumentType[] = [
  'Aadhaar Document',
  'PAN Document',
  'Police Verification',
  'Bank Proof',
];

export const DOCUMENT_VERIFICATION_STATUSES = [
  'Pending',
  'Verified',
  'Rejected',
] as const;
export type DocumentVerificationStatus = (typeof DOCUMENT_VERIFICATION_STATUSES)[number];

export type DocVerificationSummary =
  | 'Verified'
  | 'Pending'
  | 'Rejected'
  | 'No Documents';

export interface AssignedEmployeeDesignation {
  designationId: string;
  designationName: string;
  serviceId: string;
  serviceName: string;
  serviceCategory: ServiceCategory;
  qualificationRequired: string;
  trainingRequired: string;
  licenseRequired: string;
  qualificationVerified: boolean;
  trainingVerified: boolean;
  licenseVerified: boolean;
  assignedAt: string;
  assignedBy: string;
}

/**
 * Operational & Personal Employee Master Record: `employees/{employeeId}`
 * Strictly excludes Aadhaar, PAN, Bank Account, IFSC, and Salary amounts
 * so document-level Firestore Security Rules never leak sensitive PII to Field Officers.
 */
export interface EmployeeRecord {
  employeeId: string; // Auto-generated unique e.g. EMP-2026-0001
  linkedUid: string; // Optional Firebase Auth UID for Employee Portal self-access

  // A. Personal Information
  fullName: string;
  fatherOrSpouseName: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: EmployeeGender;
  mobile: string;
  alternateMobile: string;
  email: string;
  currentAddress: string;
  permanentAddress: string;
  city: string;
  state: string;
  pinCode: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  profilePhoto: string;

  // B. Employment Information
  joiningDate: string; // YYYY-MM-DD
  branchId: string;
  branchName: string;
  employmentType: EmploymentType;
  employeeStatus: EmployeeStatus;
  assignedServiceCategories: ServiceCategory[];
  assignedServiceIds: string[];
  assignedServiceNames: string[];
  assignedDesignationIds: string[];
  assignedDesignations: AssignedEmployeeDesignation[];
  skillsAndExperience: string;
  qualification: string;
  trainingDetails: string;
  licenseDetails: string;
  reportingFieldOfficerUid: string;
  reportingFieldOfficerName: string;
  currentSiteId: string; // Empty string '' when Unassigned
  currentSiteName: string;
  notes: string;

  // Document & Operational Rollups
  docVerificationSummary: DocVerificationSummary;
  totalDocumentsCount: number;
  pendingDocumentsCount: number;

  // Required Lifecycle & Audit Metadata
  isActive: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

/**
 * Isolated Sensitive Financial & KYC Record: `employeePrivate/{employeeId}`
 * Accessible strictly to Admin and authorized Branch HR (plus own salary read where permitted).
 * 100% blocked from Site Portal and Field Officer Portal.
 */
export interface EmployeePrivateRecord {
  employeeId: string;
  linkedUid: string;
  branchId: string;
  salaryType: SalaryType;
  basicSalary: number;
  bankAccountNumber: string;
  bankAccountHolderName: string;
  bankName: string;
  ifscCode: string;
  panNumber: string;
  aadhaarNumber: string;
  aadhaarMasked: string;
  bankAccountMasked: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

/**
 * Employee Document Metadata Record: `employeeDocuments/{documentId}`
 * Files stored in Firebase Storage under `employee_kyc` or `employee_documents`.
 */
export interface EmployeeDocumentRecord {
  documentId: string; // e.g. DOC-2026-0001
  employeeId: string;
  linkedUid: string;
  branchId: string;
  documentType: EmployeeDocumentType;
  isSensitiveKyc: boolean;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  storagePath: string;
  downloadUrl: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByUid: string;
  verificationStatus: DocumentVerificationStatus;
  verificationRemarks: string;
  verifiedBy: string | null;
  verifiedByUid: string | null;
  verifiedAt: string | null;
  updatedAt: string;
}

export type EmployeeHistoryCategory =
  | 'Designation'
  | 'SiteAssignment'
  | 'Activity';

/**
 * Chronological Employee Ledger: `employeeHistory/{historyId}`
 * Backs Designation History, Site Assignment History, and Activity History tabs.
 */
export interface EmployeeHistoryRecord {
  historyId: string;
  employeeId: string;
  linkedUid: string;
  branchId: string;
  category: EmployeeHistoryCategory;
  action: string;
  summary: string;
  metadata?: Record<string, string>;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  timestamp: string;
}

export interface EmployeeFormInput {
  linkedUid: string;
  // Personal
  fullName: string;
  fatherOrSpouseName: string;
  dateOfBirth: string;
  gender: EmployeeGender;
  mobile: string;
  alternateMobile: string;
  email: string;
  currentAddress: string;
  permanentAddress: string;
  city: string;
  state: string;
  pinCode: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  profilePhoto: string;
  // Employment
  joiningDate: string;
  branchId: string;
  employmentType: EmploymentType;
  employeeStatus: EmployeeStatus;
  selectedDesignationIds: string[];
  eligibilityConfirmations: Record<
    string,
    {
      qualificationVerified: boolean;
      trainingVerified: boolean;
      licenseVerified: boolean;
    }
  >;
  skillsAndExperience: string;
  qualification: string;
  trainingDetails: string;
  licenseDetails: string;
  reportingFieldOfficerUid: string;
  reportingFieldOfficerName: string;
  currentSiteId: string;
  notes: string;
  // Financial & Sensitive (optional if HR lacks sensitive permission during edit)
  includePrivateFinancials: boolean;
  salaryType: SalaryType;
  basicSalary: string;
  bankAccountNumber: string;
  bankAccountHolderName: string;
  bankName: string;
  ifscCode: string;
  panNumber: string;
  aadhaarNumber: string;
}
