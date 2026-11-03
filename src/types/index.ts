export enum UserRoleEnum {
  ADMIN = 'admin',
  HR = 'hr',
  FIELD_OFFICER = 'field_officer',
  SITE = 'site',
  EMPLOYEE = 'employee',
}

export type UserRole = 'admin' | 'hr' | 'field_officer' | 'site' | 'employee';

export type PortalSlug = 'admin' | 'hr' | 'field-officer' | 'site' | 'employee';

/**
 * Initial Firestore User Document Structure: "users/{uid}"
 */
export interface RexonUser {
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  branchId: string;
  assignedBranches?: string[];
  assignedSiteIds: string[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PortalNavItem {
  label: string;
  path: string;
  iconName:
    | 'LayoutDashboard'
    | 'Building2'
    | 'UserCog'
    | 'ShieldCheck'
    | 'Users'
    | 'Briefcase'
    | 'FileSpreadsheet'
    | 'MapPin'
    | 'ClipboardCheck'
    | 'AlertTriangle'
    | 'CalendarCheck'
    | 'Receipt'
    | 'FileText'
    | 'Wallet'
    | 'UserCircle'
    | 'Layers'
    | 'Award'
    | 'KeyRound'
    | 'ScrollText'
      | 'BarChart3'
      | 'ArrowRightLeft'
      | 'UserCheck'
      | 'Settings';
  shortLabel: string;
}

export interface PortalMetadata {
  role: UserRole;
  slug: PortalSlug;
  basePath: string;
  loginPath: string;
  portalName: string;
  shortTitle: string;
  audienceTitle: string;
  description: string;
  securityNote: string;
  allowedCapabilities: string[];
  restrictedCapabilities: string[];
  navItems: PortalNavItem[];
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export interface LivePortalMetrics {
  branchesCount: number;
  hrUsersCount: number;
  clientsCount: number;
  sitesCount: number;
  employeesCount: number;
  fieldOfficersCount: number;
  pendingApprovalsCount: number;
  leaveRequestsCount: number;
  advanceRequestsCount: number;
}

export * from './masterData';
export * from './employee';
export * from './deployment';
export * from './attendance';


