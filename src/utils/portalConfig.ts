import { PortalMetadata, PortalSlug, RexonUser, UserRole } from '../types';

export const ALLOWED_ROLES: UserRole[] = [
  'admin',
  'hr',
  'field_officer',
  'site',
  'employee',
];

export const ROLE_TO_PORTAL_BASE: Record<UserRole, string> = {
  admin: '/admin',
  hr: '/hr',
  field_officer: '/field-officer',
  site: '/site',
  employee: '/employee',
};

/**
 * Maps legacy Phase 2 Part 1 colon-separated permission strings to the
 * canonical Phase 2 Part 2 dot-notation permissions so existing cached sessions
 * and live Firestore documents remain 100% compatible.
 */
const LEGACY_PERMISSION_ALIASES: Record<string, string> = {
  'branches:manage': 'branch.manage',
  'hr:provision': 'hr.manage',
  'clients:view': 'client.view',
  'clients:create': 'client.create',
  'clients:edit': 'client.edit',
  'clients:delete': 'client.delete',
  'sites:view': 'site.view',
  'sites:create': 'site.create',
  'sites:edit': 'site.edit',
  'sites:delete': 'site.delete',
  'employees:manage': 'employee.manage',
  'billing:prepare': 'billing.manage',
  'invoices:manage': 'billing.manage',
};

export function normalizePermissionKey(perm: string): string {
  const trimmed = perm.trim();
  return LEGACY_PERMISSION_ALIASES[trimmed] ?? trimmed;
}

export function normalizePermissionList(perms: string[]): string[] {
  const set = new Set<string>();
  for (const p of perms) {
    const normalized = normalizePermissionKey(p);
    if (normalized) {
      set.add(normalized);
    }
  }
  return Array.from(set);
}

export const PORTAL_METADATA: Record<UserRole, PortalMetadata> = {
  admin: {
    role: 'admin',
    slug: 'admin',
    basePath: '/admin',
    loginPath: '/admin/login',
    portalName: 'Admin Command Portal',
    shortTitle: 'Admin Portal',
    audienceTitle: 'Executive & System Administration',
    description:
      'Central governance across branches, HR provisioning, clients, sites, services, designations, granular HR permissions, approvals, and immutable audit logs.',
    securityNote:
      'Verified Firestore role "admin" required. All master mutations, permission assignments, and approval decisions are written to append-only audit logs.',
    allowedCapabilities: [
      'Manage Branches, HR Accounts, Services (Security, Housekeeping, Manpower), and Designations',
      'Assign granular HR permissions across 39 module actions and branch scopes',
      'Full visibility across all Clients, Sites, Duty Rosters, Attendance, and Manpower summaries',
      'Approve or reject sensitive HR workflow requests and inspect immutable Audit Logs',
    ],
    restrictedCapabilities: [
      'Self-deletion of active caller admin account is blocked by security rules',
      'Audit log records are strictly append-only and cannot be modified or deleted',
    ],
    navItems: [
      {
        label: 'Dashboard',
        shortLabel: 'Dashboard',
        path: '/admin',
        iconName: 'LayoutDashboard',
      },
      {
        label: 'Branch Management',
        shortLabel: 'Branches',
        path: '/admin/branches',
        iconName: 'Building2',
      },
      {
        label: 'HR Management',
        shortLabel: 'HR Users',
        path: '/admin/hr-management',
        iconName: 'UserCog',
      },
      {
        label: 'Client Management',
        shortLabel: 'Clients',
        path: '/admin/clients',
        iconName: 'Briefcase',
      },
      {
        label: 'Site Management',
        shortLabel: 'Sites',
        path: '/admin/sites',
        iconName: 'MapPin',
      },
      {
        label: 'Employee Management',
        shortLabel: 'Employees',
        path: '/admin/employees',
        iconName: 'Users',
      },
      {
        label: 'Site Assignments',
        shortLabel: 'Assign',
        path: '/admin/assignments',
        iconName: 'ArrowRightLeft',
      },
      {
        label: 'Workforce Deployment',
        shortLabel: 'Deployment',
        path: '/admin/deployment',
        iconName: 'FileSpreadsheet',
      },
      {
        label: 'Employee Availability',
        shortLabel: 'Available',
        path: '/admin/availability',
        iconName: 'UserCheck',
      },
      {
        label: 'Duty Rosters',
        shortLabel: 'Rosters',
        path: '/admin/rosters',
        iconName: 'CalendarCheck',
      },
      {
        label: 'Attendance & Duty',
        shortLabel: 'Attendance',
        path: '/admin/attendance',
        iconName: 'ClipboardCheck',
      },
      {
        label: 'Service Management',
        shortLabel: 'Services',
        path: '/admin/services',
        iconName: 'Layers',
      },
      {
        label: 'Designation Management',
        shortLabel: 'Designations',
        path: '/admin/designations',
        iconName: 'Award',
      },
      {
        label: 'Permission Management',
        shortLabel: 'Permissions',
        path: '/admin/permissions',
        iconName: 'KeyRound',
      },
      {
        label: 'Approvals',
        shortLabel: 'Approvals',
        path: '/admin/approvals',
        iconName: 'ShieldCheck',
      },
      {
        label: 'Audit Logs',
        shortLabel: 'Audit Logs',
        path: '/admin/audit-logs',
        iconName: 'ScrollText',
      },
      {
        label: 'Reports',
        shortLabel: 'Reports',
        path: '/admin/reports',
        iconName: 'BarChart3',
      },
      {
        label: 'Settings',
        shortLabel: 'Settings',
        path: '/admin/settings',
        iconName: 'Settings',
      },
    ],
  },
  hr: {
    role: 'hr',
    slug: 'hr',
    basePath: '/hr',
    loginPath: '/hr/login',
    portalName: 'HR Operations Portal',
    shortTitle: 'HR Portal',
    audienceTitle: 'Human Resources & Payroll Operations',
    description:
      'Branch-scoped management of clients, deployment sites, multi-service manpower configurations, authorized service/designation directories, approvals, and reports.',
    securityNote:
      'Verified Firestore role "hr" required. Access is strictly scoped to assignedBranches and granular dot-notation permissions.',
    allowedCapabilities: [
      'Create and manage Clients and Sites within assigned branches and permissions',
      'Configure Security, Housekeeping, and Manpower services & designations per Site',
      'Submit and track sensitive workflow Approval requests (and cancel pending own requests)',
      'Inspect branch-scoped Master Data & Manpower vacancy reports',
    ],
    restrictedCapabilities: [
      'Cannot access unauthorized branches or unpermitted modules',
      'Cannot modify or delete Audit Logs, or bypass Admin approval on sensitive deletions',
    ],
    navItems: [
      {
        label: 'Dashboard',
        shortLabel: 'Dashboard',
        path: '/hr',
        iconName: 'LayoutDashboard',
      },
      {
        label: 'Client Management',
        shortLabel: 'Clients',
        path: '/hr/clients',
        iconName: 'Briefcase',
      },
      {
        label: 'Site Management',
        shortLabel: 'Sites',
        path: '/hr/sites',
        iconName: 'MapPin',
      },
      {
        label: 'Employee Management',
        shortLabel: 'Employees',
        path: '/hr/employees',
        iconName: 'Users',
      },
      {
        label: 'Site Assignments',
        shortLabel: 'Assign',
        path: '/hr/assignments',
        iconName: 'ArrowRightLeft',
      },
      {
        label: 'Workforce Deployment',
        shortLabel: 'Deployment',
        path: '/hr/deployment',
        iconName: 'FileSpreadsheet',
      },
      {
        label: 'Employee Availability',
        shortLabel: 'Available',
        path: '/hr/availability',
        iconName: 'UserCheck',
      },
      {
        label: 'Duty Rosters',
        shortLabel: 'Rosters',
        path: '/hr/rosters',
        iconName: 'CalendarCheck',
      },
      {
        label: 'Attendance & Duty',
        shortLabel: 'Attendance',
        path: '/hr/attendance',
        iconName: 'ClipboardCheck',
      },
      {
        label: 'Service & Designation',
        shortLabel: 'Services',
        path: '/hr/services-designations',
        iconName: 'Layers',
      },
      {
        label: 'Approvals',
        shortLabel: 'Approvals',
        path: '/hr/approvals',
        iconName: 'ShieldCheck',
      },
      {
        label: 'Reports',
        shortLabel: 'Reports',
        path: '/hr/reports',
        iconName: 'BarChart3',
      },
      {
        label: 'My Profile',
        shortLabel: 'Profile',
        path: '/hr/profile',
        iconName: 'UserCircle',
      },
    ],
  },
  field_officer: {
    role: 'field_officer',
    slug: 'field-officer',
    basePath: '/field-officer',
    loginPath: '/field-officer/login',
    portalName: 'Field Officer Portal',
    shortTitle: 'Field Officer',
    audienceTitle: 'Field Supervision & Site Inspections',
    description:
      'Mobile-optimized operational workspace for assigned site visits, guard & housekeeping inspections, shift deployments, and incident reporting.',
    securityNote:
      'Verified Firestore role "field_officer" required. Restricted strictly to assignedSiteIds; financial and private HR records are blocked.',
    allowedCapabilities: [
      'View assigned sites, daily targets, and task history',
      'Assign deployed personnel to posts at authorized sites',
      'Submit site visit, security, and housekeeping inspection reports',
      'Report attendance discrepancies, incidents, photographs, and remarks',
    ],
    restrictedCapabilities: [
      'Cannot view payroll, client invoices, or unrestricted HR records',
      'Cannot view employee Aadhaar or bank account details',
    ],
    navItems: [
      {
        label: 'Dashboard',
        shortLabel: 'Overview',
        path: '/field-officer',
        iconName: 'LayoutDashboard',
      },
      {
        label: 'Site Attendance',
        shortLabel: 'Attendance',
        path: '/field-officer/attendance',
        iconName: 'CalendarCheck',
      },
      {
        label: 'Duty Rosters',
        shortLabel: 'Rosters',
        path: '/field-officer/rosters',
        iconName: 'ClipboardCheck',
      },
      {
        label: 'Site Assignments',
        shortLabel: 'Assign',
        path: '/field-officer/assignments',
        iconName: 'ArrowRightLeft',
      },
      {
        label: 'Site Deployment',
        shortLabel: 'Deploy',
        path: '/field-officer/deployment',
        iconName: 'FileSpreadsheet',
      },
      {
        label: 'Employee Availability',
        shortLabel: 'Available',
        path: '/field-officer/availability',
        iconName: 'UserCheck',
      },
      {
        label: 'Personnel Roster',
        shortLabel: 'Personnel',
        path: '/field-officer/employees',
        iconName: 'Users',
      },
      {
        label: 'Assigned Sites',
        shortLabel: 'Sites',
        path: '/field-officer/sites',
        iconName: 'MapPin',
      },
      {
        label: 'Visits & Inspections',
        shortLabel: 'Inspect',
        path: '/field-officer/inspections',
        iconName: 'ClipboardCheck',
      },
      {
        label: 'Incidents & Issues',
        shortLabel: 'Incidents',
        path: '/field-officer/incidents',
        iconName: 'AlertTriangle',
      },
      {
        label: 'Profile & Security',
        shortLabel: 'Profile',
        path: '/field-officer/profile',
        iconName: 'UserCircle',
      },
    ],
  },
  site: {
    role: 'site',
    slug: 'site',
    basePath: '/site',
    loginPath: '/site/login',
    portalName: 'Client & Site Portal',
    shortTitle: 'Site Portal',
    audienceTitle: 'Authorized Client & Facility Manager',
    description:
      'Dedicated client transparency portal for viewing deployed manpower headcount, present/absent summaries, invoices, payment receipts, and service reports.',
    securityNote:
      'Verified Firestore role "site" required. Private employee KYC (Aadhaar, bank details, individual salary) is isolated and inaccessible.',
    allowedCapabilities: [
      'View assigned site deployment details and shift coverage',
      'Monitor total deployed, present, and absent counts',
      'Review authorized shift-wise attendance summaries',
      'Download client invoices, payment receipts, and service reports',
    ],
    restrictedCapabilities: [
      'Zero access to employee Aadhaar, bank details, phone, salary, or GPS location history',
      'Read-only client scope — cannot create, edit, or delete employees, rosters, or sites',
    ],
    navItems: [
      {
        label: 'Dashboard',
        shortLabel: 'Overview',
        path: '/site',
        iconName: 'LayoutDashboard',
      },
      {
        label: 'Manpower Summary',
        shortLabel: 'Manpower',
        path: '/site/manpower',
        iconName: 'Users',
      },
      {
        label: 'Attendance Summary',
        shortLabel: 'Attendance',
        path: '/site/attendance',
        iconName: 'CalendarCheck',
      },
      {
        label: 'Invoices & Receipts',
        shortLabel: 'Billing',
        path: '/site/billing',
        iconName: 'Receipt',
      },
      {
        label: 'Service Reports',
        shortLabel: 'Reports',
        path: '/site/reports',
        iconName: 'FileText',
      },
      {
        label: 'Profile & Security',
        shortLabel: 'Profile',
        path: '/site/profile',
        iconName: 'UserCircle',
      },
    ],
  },
  employee: {
    role: 'employee',
    slug: 'employee',
    basePath: '/employee',
    loginPath: '/employee/login',
    portalName: 'Employee Self-Service Portal',
    shortTitle: 'Employee Portal',
    audienceTitle: 'Security & Manpower Personnel',
    description:
      'Personal duty companion for check-in/check-out, site assignment, duty roster, monthly attendance, salary slips, and leave or advance requests.',
    securityNote:
      'Verified Firestore role "employee" required. Strict UID isolation prevents viewing any other employee record.',
    allowedCapabilities: [
      'View personal profile, Employee ID, and current site roster',
      'Record duty Check-In and Check-Out',
      'View personal monthly attendance and download own salary slips',
      'Submit leave requests and salary advance applications',
    ],
    restrictedCapabilities: [
      'Cannot view or query any other employee profile, attendance, or pay',
      'Cannot modify assigned role, site, or branch metadata',
    ],
    navItems: [
      {
        label: 'Dashboard',
        shortLabel: 'Overview',
        path: '/employee',
        iconName: 'LayoutDashboard',
      },
      {
        label: 'My Assignments',
        shortLabel: 'My Duty',
        path: '/employee/assignments',
        iconName: 'MapPin',
      },
      {
        label: 'My Employee Profile',
        shortLabel: 'My Record',
        path: '/employee/my-record',
        iconName: 'Users',
      },
      {
        label: 'Duty & Attendance',
        shortLabel: 'Attendance',
        path: '/employee/attendance',
        iconName: 'CalendarCheck',
      },
      {
        label: 'Leave & Advance',
        shortLabel: 'Requests',
        path: '/employee/requests',
        iconName: 'Wallet',
      },
      {
        label: 'Salary Slips & Docs',
        shortLabel: 'Documents',
        path: '/employee/documents',
        iconName: 'FileText',
      },
      {
        label: 'Profile & Security',
        shortLabel: 'Profile',
        path: '/employee/profile',
        iconName: 'UserCircle',
      },
    ],
  },
};

export const PORTAL_LIST: PortalMetadata[] = [
  PORTAL_METADATA.admin,
  PORTAL_METADATA.hr,
  PORTAL_METADATA.field_officer,
  PORTAL_METADATA.site,
  PORTAL_METADATA.employee,
];

export function isValidUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ALLOWED_ROLES as string[]).includes(value);
}

export function getPortalByRole(role: UserRole): PortalMetadata {
  return PORTAL_METADATA[role];
}

export function getPortalBySlug(slug: string | undefined): PortalMetadata {
  switch (slug) {
    case 'hr':
      return PORTAL_METADATA.hr;
    case 'field-officer':
      return PORTAL_METADATA.field_officer;
    case 'site':
      return PORTAL_METADATA.site;
    case 'employee':
      return PORTAL_METADATA.employee;
    case 'admin':
    default:
      return PORTAL_METADATA.admin;
  }
}

export function getRoleFromSlug(slug: PortalSlug): UserRole {
  switch (slug) {
    case 'hr':
      return 'hr';
    case 'field-officer':
      return 'field_officer';
    case 'site':
      return 'site';
    case 'employee':
      return 'employee';
    case 'admin':
      return 'admin';
  }
}

export function getAuthorizedBranchIds(user: RexonUser | null): string[] {
  if (!user) return [];
  if (user.assignedBranches && user.assignedBranches.length > 0) {
    return user.assignedBranches;
  }
  return user.branchId ? [user.branchId] : [];
}

export function hasUserPermission(user: RexonUser | null, perm: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const target = normalizePermissionKey(perm);
  const userPerms = normalizePermissionList(user.permissions || []);
  if (userPerms.includes(target)) return true;

  // Manage permissions implicitly satisfy view permissions on the same module
  if (target === 'branch.view' && userPerms.includes('branch.manage')) return true;
  if (target === 'hr.view' && userPerms.includes('hr.manage')) return true;
  if (
    target === 'client.view' &&
    (userPerms.includes('client.create') ||
      userPerms.includes('client.edit') ||
      userPerms.includes('client.delete'))
  ) {
    return true;
  }
  if (
    target === 'site.view' &&
    (userPerms.includes('site.create') ||
      userPerms.includes('site.edit') ||
      userPerms.includes('site.delete'))
  ) {
    return true;
  }
  if (target === 'service.view' && userPerms.includes('service.manage')) return true;
  if (target === 'designation.view' && userPerms.includes('designation.manage')) return true;
  if (
    target === 'employee.view' &&
    (userPerms.includes('employee.manage') ||
      userPerms.includes('employee.create') ||
      userPerms.includes('employee.edit') ||
      userPerms.includes('employee.verify_docs') ||
      userPerms.includes('employee.delete'))
  ) {
    return true;
  }
  if (
    (target === 'employee.create' ||
      target === 'employee.edit' ||
      target === 'employee.verify_docs' ||
      target === 'employee.sensitive' ||
      target === 'employee.multi_designation') &&
    userPerms.includes('employee.manage')
  ) {
    return true;
  }
  if (target === 'employee.multi_designation' && userPerms.includes('designation.manage')) {
    return true;
  }
  if (
    target === 'employee.sensitive' &&
    (userPerms.includes('payroll.view') || userPerms.includes('payroll.manage'))
  ) {
    return true;
  }
  if (
    target === 'assignment.view' &&
    (userPerms.includes('assignment.manage') ||
      userPerms.includes('assignment.create') ||
      userPerms.includes('assignment.edit') ||
      userPerms.includes('assignment.transfer') ||
      userPerms.includes('employee.manage') ||
      userPerms.includes('employee.view') ||
      userPerms.includes('site.view') ||
      userPerms.includes('site.edit'))
  ) {
    return true;
  }
  if (
    (target === 'assignment.create' ||
      target === 'assignment.edit' ||
      target === 'assignment.transfer') &&
    (userPerms.includes('assignment.manage') ||
      userPerms.includes('employee.manage') ||
      userPerms.includes('employee.edit'))
  ) {
    return true;
  }
  if (target === 'assignment.manage' && userPerms.includes('employee.manage')) {
    return true;
  }
  if (target === 'billing.view' && userPerms.includes('billing.manage')) return true;
  if (target === 'payroll.view' && userPerms.includes('payroll.manage')) return true;

  // Phase 4 Roster & Attendance permission implications
  if (
    (target === 'site.view' ||
      target === 'client.view' ||
      target === 'service.view' ||
      target === 'designation.view' ||
      target === 'employee.view') &&
    (userPerms.includes('roster.view') ||
      userPerms.includes('roster.create') ||
      userPerms.includes('roster.edit') ||
      userPerms.includes('roster.publish') ||
      userPerms.includes('attendance.view') ||
      userPerms.includes('attendance.verify') ||
      userPerms.includes('attendance.approve') ||
      userPerms.includes('attendance.gps_settings') ||
      userPerms.includes('attendance.qr_manage'))
  ) {
    return true;
  }
  if (
    target === 'roster.view' &&
    (userPerms.includes('roster.create') ||
      userPerms.includes('roster.edit') ||
      userPerms.includes('roster.publish') ||
      userPerms.includes('roster.delete') ||
      userPerms.includes('attendance.view') ||
      userPerms.includes('attendance.verify') ||
      userPerms.includes('attendance.approve'))
  ) {
    return true;
  }
  if (target === 'roster.edit' && userPerms.includes('roster.publish')) return true;
  if (
    target === 'attendance.view' &&
    (userPerms.includes('attendance.view_all_branch') ||
      userPerms.includes('attendance.create') ||
      userPerms.includes('attendance.edit') ||
      userPerms.includes('attendance.verify') ||
      userPerms.includes('attendance.approve') ||
      userPerms.includes('attendance.correct') ||
      userPerms.includes('attendance.export') ||
      userPerms.includes('attendance.overtime_approve') ||
      userPerms.includes('attendance.qr_manage') ||
      userPerms.includes('attendance.gps_settings'))
  ) {
    return true;
  }
  if (
    (target === 'attendance.verify' ||
      target === 'attendance.correct' ||
      target === 'attendance.edit') &&
    userPerms.includes('attendance.approve')
  ) {
    return true;
  }

  return false;
}

