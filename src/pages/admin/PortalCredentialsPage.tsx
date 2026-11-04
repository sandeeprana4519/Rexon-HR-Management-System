import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  MapPin,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { PortalCredentialSlipModal } from '../../components/PortalCredentialSlipModal';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  buildSystemPortalLoginEmail,
  generateDefaultPortalPassword,
} from '../../services/firebase/config';
import {
  getIssuedCredentialsForEmployee,
  listEmployees,
  subscribeEmployeeData,
} from '../../services/firestore/employeeService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  buildFieldOfficerCredentialsView,
  getIssuedCredentialsForHR,
  getIssuedCredentialsForSite,
  listFieldOfficers,
  listHRProfiles,
  listSites,
  subscribeMasterData,
} from '../../services/firestore/masterDataService';
import { listAllProvisionedPortalUsers } from '../../services/firestore/userRoleService';
import {
  EmployeeRecord,
  FieldOfficerRecord,
  HRProfileRecord,
  IssuedPortalCredentials,
  RexonUser,
  SiteRecord,
  UserRole,
} from '../../types';
import { getPortalByRole } from '../../utils/portalConfig';

type CredentialRoleFilter = 'ALL' | 'hr' | 'field_officer' | 'site' | 'employee';

interface UnifiedPortalAccountRow {
  rowKey: string;
  role: 'hr' | 'field_officer' | 'site' | 'employee';
  systemId: string;
  fullName: string;
  phone: string;
  profilePhoto: string;
  loginEmail: string;
  loginPassword: string;
  scopeSummary: string;
  isActive: boolean;
  uid: string;
  createdAt: string;
  hrRecord?: HRProfileRecord;
  foRecord?: FieldOfficerRecord;
  siteRecord?: SiteRecord;
  empRecord?: EmployeeRecord;
}

export const PortalCredentialsPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();

  const [portalUsers, setPortalUsers] = useState<RexonUser[]>([]);
  const [hrProfiles, setHrProfiles] = useState<HRProfileRecord[]>([]);
  const [fieldOfficers, setFieldOfficers] = useState<FieldOfficerRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [roleFilter, setRoleFilter] = useState<CredentialRoleFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [busyRowKey, setBusyRowKey] = useState<string | null>(null);
  const [slipCredentials, setSlipCredentials] = useState<IssuedPortalCredentials | null>(null);

  const loadDirectory = useCallback(async () => {
    if (!user || user.role !== 'admin') return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [usersRes, hrRes, foRes, sitesRes, empRes] = await Promise.all([
        listAllProvisionedPortalUsers(user, isPreviewSession),
        listHRProfiles(user, isPreviewSession),
        listFieldOfficers(user, isPreviewSession),
        listSites(user, isPreviewSession),
        listEmployees(user, isPreviewSession),
      ]);
      setPortalUsers(usersRes);
      setHrProfiles(hrRes);
      setFieldOfficers(foRes);
      setSites(sitesRes.filter((s) => !s.isArchived));
      setEmployees(empRes.filter((e) => !e.isDeleted));
    } catch (err) {
      setErrorMsg(formatServiceErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadDirectory();
    const unsubMaster = subscribeMasterData(() => {
      void loadDirectory();
    });
    const unsubEmp = subscribeEmployeeData(() => {
      void loadDirectory();
    });
    return () => {
      unsubMaster();
      unsubEmp();
    };
  }, [loadDirectory]);

  const userMapByUid = useMemo(() => {
    const map = new Map<string, RexonUser>();
    for (const u of portalUsers) {
      map.set(u.uid, u);
    }
    return map;
  }, [portalUsers]);

  const unifiedRows = useMemo<UnifiedPortalAccountRow[]>(() => {
    const rows: UnifiedPortalAccountRow[] = [];

    // 1. HR Accounts
    for (const hr of hrProfiles) {
      const linkedUser = hr.uid ? userMapByUid.get(hr.uid) : undefined;
      rows.push({
        rowKey: `hr:${hr.hrId}`,
        role: 'hr',
        systemId: hr.hrId,
        fullName: hr.fullName,
        phone: hr.mobile,
        profilePhoto: hr.profilePhoto || linkedUser?.profilePhoto || '',
        loginEmail: linkedUser?.email || hr.email || buildSystemPortalLoginEmail(hr.hrId),
        loginPassword: linkedUser?.initialAccessKey || generateDefaultPortalPassword(hr.mobile),
        scopeSummary: `${hr.hrDesignation} · Branches: ${hr.assignedBranches.join(', ') || 'HQ'}`,
        isActive: hr.accountStatus === 'Active',
        uid: hr.uid,
        createdAt: hr.createdAt,
        hrRecord: hr,
      });
    }

    // 2. Field Officers
    for (const fo of fieldOfficers) {
      const linkedUser = userMapByUid.get(fo.uid);
      rows.push({
        rowKey: `fo:${fo.uid}`,
        role: 'field_officer',
        systemId: fo.fieldOfficerId,
        fullName: fo.fullName,
        phone: fo.phone,
        profilePhoto: fo.profilePhoto || linkedUser?.profilePhoto || '',
        loginEmail: fo.email || buildSystemPortalLoginEmail(fo.fieldOfficerId),
        loginPassword:
          fo.initialAccessKey ||
          linkedUser?.initialAccessKey ||
          generateDefaultPortalPassword(fo.phone),
        scopeSummary: `${fo.designationLabel} · Branches: ${fo.assignedBranches.join(', ')}${
          fo.assignedSiteIds.length > 0 ? ` · ${fo.assignedSiteIds.length} Site(s)` : ''
        }`,
        isActive: fo.isActive,
        uid: fo.uid,
        createdAt: fo.createdAt,
        foRecord: fo,
      });
    }

    // 3. Site Portal Accounts
    for (const site of sites) {
      const linkedUser = site.sitePortalUid ? userMapByUid.get(site.sitePortalUid) : undefined;
      rows.push({
        rowKey: `site:${site.siteId}`,
        role: 'site',
        systemId: site.siteId,
        fullName: `${site.siteManagerName} (${site.siteName})`,
        phone: site.managerMobile,
        profilePhoto: site.sitePhoto || linkedUser?.profilePhoto || '',
        loginEmail:
          linkedUser?.email ||
          site.sitePortalEmail ||
          site.managerEmail?.trim().toLowerCase() ||
          buildSystemPortalLoginEmail(site.siteId),
        loginPassword:
          linkedUser?.initialAccessKey || generateDefaultPortalPassword(site.managerMobile),
        scopeSummary: `Site Isolated: ${site.siteId} — ${site.clientName} (${site.city})`,
        isActive: site.siteStatus === 'Active',
        uid: site.sitePortalUid || '',
        createdAt: site.createdAt,
        siteRecord: site,
      });
    }

    // 4. Employee Portal Accounts
    for (const emp of employees) {
      const linkedUser = emp.linkedUid ? userMapByUid.get(emp.linkedUid) : undefined;
      rows.push({
        rowKey: `emp:${emp.employeeId}`,
        role: 'employee',
        systemId: emp.employeeId,
        fullName: emp.fullName,
        phone: emp.mobile,
        profilePhoto: emp.profilePhoto || linkedUser?.profilePhoto || '',
        loginEmail:
          linkedUser?.email ||
          emp.email?.trim().toLowerCase() ||
          buildSystemPortalLoginEmail(emp.employeeId),
        loginPassword: linkedUser?.initialAccessKey || generateDefaultPortalPassword(emp.mobile),
        scopeSummary: `${
          emp.assignedDesignations.map((d) => d.designationName).join(' · ') || 'Personnel'
        } · ${emp.currentSiteId ? `${emp.currentSiteId}` : 'Available Pool'}`,
        isActive: emp.employeeStatus === 'Active',
        uid: emp.linkedUid || '',
        createdAt: emp.createdAt,
        empRecord: emp,
      });
    }

    return rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [hrProfiles, fieldOfficers, sites, employees, userMapByUid]);

  const counts = useMemo(() => {
    return {
      hr: unifiedRows.filter((r) => r.role === 'hr').length,
      field_officer: unifiedRows.filter((r) => r.role === 'field_officer').length,
      site: unifiedRows.filter((r) => r.role === 'site').length,
      employee: unifiedRows.filter((r) => r.role === 'employee').length,
    };
  }, [unifiedRows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return unifiedRows.filter((r) => {
      if (roleFilter !== 'ALL' && r.role !== roleFilter) return false;
      if (!q) return true;
      return (
        r.systemId.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q) ||
        r.loginEmail.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        r.scopeSummary.toLowerCase().includes(q)
      );
    });
  }, [unifiedRows, roleFilter, searchQuery]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page]);

  useEffect(() => {
    setPage(1);
  }, [roleFilter, searchQuery]);

  const handleCopyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      window.setTimeout(() => {
        setCopiedField((prev) => (prev === key ? null : prev));
      }, 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleOpenCredentialSlip = async (row: UnifiedPortalAccountRow) => {
    if (!user) return;
    setBusyRowKey(row.rowKey);
    setErrorMsg(null);
    try {
      let creds: IssuedPortalCredentials;
      if (row.role === 'hr' && row.hrRecord) {
        creds = await getIssuedCredentialsForHR(user, isPreviewSession, row.hrRecord);
      } else if (row.role === 'field_officer' && row.foRecord) {
        creds = buildFieldOfficerCredentialsView(row.foRecord, isPreviewSession);
      } else if (row.role === 'site' && row.siteRecord) {
        creds = await getIssuedCredentialsForSite(user, isPreviewSession, row.siteRecord);
      } else if (row.role === 'employee' && row.empRecord) {
        creds = await getIssuedCredentialsForEmployee(user, isPreviewSession, row.empRecord);
      } else {
        const meta = getPortalByRole(row.role);
        creds = {
          role: row.role,
          portalName: meta.portalName,
          loginPath: meta.loginPath,
          systemId: row.systemId,
          fullName: row.fullName,
          loginEmail: row.loginEmail,
          loginPassword: row.loginPassword,
          uid: row.uid,
          branchLabel: row.scopeSummary,
          isPreviewMode: isPreviewSession,
        };
      }
      setSlipCredentials(creds);
      void loadDirectory();
    } catch (err) {
      setErrorMsg(formatServiceErrorMessage(err));
    } finally {
      setBusyRowKey(null);
    }
  };

  const roleLabel = (role: UserRole) => {
    switch (role) {
      case 'hr':
        return 'HR Portal';
      case 'field_officer':
        return 'Field Officer Portal';
      case 'site':
        return 'Site Portal';
      case 'employee':
        return 'Employee Portal';
      default:
        return 'Admin Portal';
    }
  };

  if (!user || user.role !== 'admin') return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Portal IDs &amp; Passwords Directory
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Central Admin registry of Login IDs and Passwords for all HR, Field Officer, Site, and
            Employee accounts. Each account is strictly isolated to its own portal and authorized
            scope.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadDirectory()}
          disabled={loading}
          className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors self-start sm:self-auto whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Credentials</span>
        </button>
      </div>

      {/* Security & Isolation Notice */}
      <div className="p-4 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] flex items-start gap-3 text-xs text-[#4A3023]">
        <ShieldCheck className="w-4 h-4 text-[#5C3D2E] shrink-0 mt-0.5" />
        <div>
          <strong>Strict Portal &amp; Data Isolation:</strong> Every user can sign in using either
          their <strong>System ID</strong> (e.g. <span className="font-mono-tabular">HR-2026-0001</span>,{' '}
          <span className="font-mono-tabular">FO-2026-0001</span>,{' '}
          <span className="font-mono-tabular">STE-2026-0001</span>,{' '}
          <span className="font-mono-tabular">EMP-2026-0001</span>) or their{' '}
          <strong>Login Email</strong>, and can update their own photo, phone, and password from
          their Profile page without accessing any other user&apos;s private records.
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 4 Role Summary Cards */}
      <section aria-label="Portal credential counts">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMetricCard
            label="HR Portal Logins"
            value={counts.hr}
            subtext="Login at /hr/login"
            icon={UserCog}
          />
          <StatMetricCard
            label="Field Officer Logins"
            value={counts.field_officer}
            subtext="Login at /field-officer/login"
            icon={UserCheck}
          />
          <StatMetricCard
            label="Site Portal Logins"
            value={counts.site}
            subtext="Login at /site/login"
            icon={MapPin}
          />
          <StatMetricCard
            label="Employee Portal Logins"
            value={counts.employee}
            subtext="Login at /employee/login"
            icon={Users}
          />
        </div>
      </section>

      {/* Main Directory Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by System ID (EMP / FO / STE / HR), Name, Login Email, or Mobile..."
          filterOptions={[
            { value: 'ALL', label: `All Portals (${unifiedRows.length})` },
            { value: 'hr', label: `HR (${counts.hr})` },
            { value: 'field_officer', label: `Field Officers (${counts.field_officer})` },
            { value: 'site', label: `Sites (${counts.site})` },
            { value: 'employee', label: `Employees (${counts.employee})` },
          ]}
          activeFilter={roleFilter}
          onFilterChange={(val) => setRoleFilter(val as CredentialRoleFilter)}
        />

        {loading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] animate-pulse"
              />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <EmptyStatePanel
            icon={KeyRound}
            title="No Portal Accounts Found"
            description="Create an HR user, Field Officer, Client Site, or Employee to automatically generate and inspect their Portal Login ID and Password here."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Account &amp; Role</th>
                    <th className="py-3 px-3">System Login ID</th>
                    <th className="py-3 px-3">Email Login ID</th>
                    <th className="py-3 px-3">Portal Password</th>
                    <th className="py-3 px-3">Portal &amp; Isolation Scope</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedRows.map((row) => {
                    const portalMeta = getPortalByRole(row.role);
                    const isRevealed = Boolean(revealedKeys[row.rowKey]);

                    return (
                      <tr
                        key={row.rowKey}
                        className="hover:bg-[#FAF8F5] transition-colors align-middle"
                      >
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-3">
                            {row.profilePhoto ? (
                              <img
                                src={row.profilePhoto}
                                alt={row.fullName}
                                referrerPolicy="no-referrer"
                                className="w-9 h-9 rounded-lg object-cover border border-[#D4C7B8] shrink-0"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-[#F3EDE4] text-[#5C3D2E] font-display text-xs font-bold flex items-center justify-center shrink-0">
                                {row.fullName.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="font-semibold text-[#1F1916] truncate max-w-[220px]">
                                {row.fullName}
                              </div>
                              <div className="text-xs text-[#7D6F65] flex items-center gap-1.5">
                                <span className="font-medium text-[#5C3D2E]">
                                  {roleLabel(row.role)}
                                </span>
                                <span>·</span>
                                <span
                                  className={
                                    row.isActive
                                      ? 'text-[#166534] font-semibold'
                                      : 'text-[#7D6F65]'
                                  }
                                >
                                  {row.isActive ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <span className="font-mono-tabular text-xs font-bold text-[#5C3D2E]">
                              {row.systemId}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyValue(`sys:${row.rowKey}`, row.systemId)
                              }
                              className="p-1 rounded text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#F3EDE4]"
                              title="Copy System Login ID"
                            >
                              {copiedField === `sys:${row.rowKey}` ? (
                                <Check className="w-3.5 h-3.5 text-[#166534]" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <span className="font-mono-tabular text-xs text-[#1F1916]">
                              {row.loginEmail}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyValue(`email:${row.rowKey}`, row.loginEmail)
                              }
                              className="p-1 rounded text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#F3EDE4]"
                              title="Copy Email Login ID"
                            >
                              {copiedField === `email:${row.rowKey}` ? (
                                <Check className="w-3.5 h-3.5 text-[#166534]" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <span className="font-mono-tabular text-xs font-semibold text-[#1F1916]">
                              {isRevealed ? row.loginPassword : '••••••••••'}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setRevealedKeys((prev) => ({
                                  ...prev,
                                  [row.rowKey]: !prev[row.rowKey],
                                }))
                              }
                              className="p-1 rounded text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#F3EDE4]"
                              title={isRevealed ? 'Hide password' : 'Show password'}
                            >
                              {isRevealed ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyValue(`pass:${row.rowKey}`, row.loginPassword)
                              }
                              className="p-1 rounded text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#F3EDE4]"
                              title="Copy Password"
                            >
                              {copiedField === `pass:${row.rowKey}` ? (
                                <Check className="w-3.5 h-3.5 text-[#166534]" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 text-xs text-[#574B43]">
                          <div className="truncate max-w-[260px]" title={row.scopeSummary}>
                            {row.scopeSummary}
                          </div>
                          <a
                            href={portalMeta.loginPath}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono-tabular text-[11px] font-semibold text-[#5C3D2E] hover:underline mt-0.5"
                          >
                            <span>{portalMeta.loginPath}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>

                        <td className="py-3.5 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            disabled={busyRowKey === row.rowKey}
                            onClick={() => void handleOpenCredentialSlip(row)}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>
                              {busyRowKey === row.rowKey ? 'Opening...' : 'Credential Slip'}
                            </span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={page}
              totalItems={filteredRows.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      <PortalCredentialSlipModal
        credentials={slipCredentials}
        onClose={() => setSlipCredentials(null)}
      />
    </div>
  );
};
