import { HR_PERMISSIONS, PERMISSION_PROFILE_MAP, RexonUser, UserRole } from '../types';

export interface DemoAccountCredential {
  role: UserRole;
  portalLabel: string;
  email: string;
  password: string;
  fullName: string;
  phone: string;
  branchId: string;
  assignedBranches: string[];
  assignedSiteIds: string[];
  permissions: string[];
}

/**
 * TEMPORARY TESTING DEMO CREDENTIALS
 * Added specifically for initial portal & Master Data RBAC testing.
 * Remove this file and its hook reference when going live with production Firebase Auth.
 */
export const DEMO_SHARED_PASSWORD = 'Rexon@123';

export const DEMO_ACCOUNTS: Record<UserRole, DemoAccountCredential> = {
  admin: {
    role: 'admin',
    portalLabel: 'Admin Portal',
    email: 'admin@rexon.com',
    password: DEMO_SHARED_PASSWORD,
    fullName: 'Rajesh Sharma (Demo Admin)',
    phone: '+91 98201 10001',
    branchId: 'BRN-2026-0001',
    assignedBranches: ['BRN-2026-0001', 'BRN-2026-0002', 'BRN-2026-0003'],
    assignedSiteIds: [],
    permissions: [...HR_PERMISSIONS],
  },
  hr: {
    role: 'hr',
    portalLabel: 'HR Portal',
    email: 'hr@rexon.com',
    password: DEMO_SHARED_PASSWORD,
    fullName: 'Priya Verma (Demo Senior HR)',
    phone: '+91 98201 10002',
    branchId: 'BRN-2026-0001',
    assignedBranches: ['BRN-2026-0001', 'BRN-2026-0002'],
    assignedSiteIds: ['STE-2026-0001', 'STE-2026-0002', 'STE-2026-0003'],
    permissions: [...PERMISSION_PROFILE_MAP['Full Branch Operations']],
  },
  field_officer: {
    role: 'field_officer',
    portalLabel: 'Field Officer Portal',
    email: 'field@rexon.com',
    password: DEMO_SHARED_PASSWORD,
    fullName: 'Vikram Singh (Demo Field Officer)',
    phone: '+91 98201 10003',
    branchId: 'BRN-2026-0001',
    assignedBranches: ['BRN-2026-0001'],
    assignedSiteIds: ['STE-2026-0001', 'STE-2026-0002'],
    permissions: ['sites:inspect', 'roster:assign', 'incidents:create'],
  },
  site: {
    role: 'site',
    portalLabel: 'Site Portal',
    email: 'site@rexon.com',
    password: DEMO_SHARED_PASSWORD,
    fullName: 'Amit Patel (Demo Site Manager)',
    phone: '+91 98201 10004',
    branchId: 'BRN-2026-0001',
    assignedBranches: ['BRN-2026-0001'],
    assignedSiteIds: ['STE-2026-0001'],
    permissions: ['site_summary:read', 'invoices:download', 'reports:download'],
  },
  employee: {
    role: 'employee',
    portalLabel: 'Employee Portal',
    email: 'employee@rexon.com',
    password: DEMO_SHARED_PASSWORD,
    fullName: 'Suresh Yadav (Demo Guard)',
    phone: '+91 98201 10005',
    branchId: 'BRN-2026-0001',
    assignedBranches: ['BRN-2026-0001'],
    assignedSiteIds: ['STE-2026-0001'],
    permissions: ['self:read', 'attendance:checkin', 'leave:request', 'advance:request'],
  },
};

export const DEMO_ACCOUNT_LIST: DemoAccountCredential[] = [
  DEMO_ACCOUNTS.admin,
  DEMO_ACCOUNTS.hr,
  DEMO_ACCOUNTS.field_officer,
  DEMO_ACCOUNTS.site,
  DEMO_ACCOUNTS.employee,
];

export function verifyDemoCredentials(email: string, password: string): RexonUser | null {
  const normalizedEmail = email.trim().toLowerCase();
  const matched = DEMO_ACCOUNT_LIST.find(
    (acct) => acct.email.toLowerCase() === normalizedEmail && acct.password === password
  );

  if (!matched) {
    return null;
  }

  return buildDemoProfileByRole(matched.role);
}

export function buildDemoProfileByRole(role: UserRole): RexonUser {
  const acct = DEMO_ACCOUNTS[role];
  const nowIso = new Date().toISOString();
  return {
    uid: `demo-${acct.role}-001`,
    fullName: acct.fullName,
    email: acct.email,
    phone: acct.phone,
    role: acct.role,
    branchId: acct.branchId,
    assignedBranches: acct.assignedBranches,
    assignedSiteIds: acct.assignedSiteIds,
    permissions: acct.permissions,
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
