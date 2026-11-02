import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  Layers,
  Lock,
  Users,
} from 'lucide-react';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { DeploymentReportsPanel } from '../../components/DeploymentReportsPanel';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  computeSiteManpowerSummary,
  listBranches,
  listClients,
  listSites,
  listSiteServiceConfigs,
  subscribeMasterData,
} from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  ClientRecord,
  SERVICE_CATEGORIES,
  SiteRecord,
  SiteServiceConfigRecord,
} from '../../types';
import { computeNonNegativeVacancy } from '../../utils/masterValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';

export const MasterReportsPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canViewReports = hasUserPermission(user, 'reports.view');

  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [siteConfigs, setSiteConfigs] = useState<SiteServiceConfigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [siteSearch, setSiteSearch] = useState<string>('');
  const [reportSuite, setReportSuite] = useState<'deployment_suite' | 'master_overview'>(
    'deployment_suite'
  );

  const loadReportData = useCallback(async () => {
    if (!user || !canViewReports) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const [brList, clList, stList, cfgList] = await Promise.all([
        listBranches(user, isPreviewSession),
        listClients(user, isPreviewSession),
        listSites(user, isPreviewSession),
        listSiteServiceConfigs(user, isPreviewSession),
      ]);
      setBranches(brList.filter((b) => !b.isDeleted));
      setClients(clList.filter((c) => !c.isArchived));
      setSites(stList.filter((s) => !s.isArchived));
      setSiteConfigs(cfgList.filter((c) => c.status === 'Active'));
    } catch (err) {
      setErrorMsg(formatServiceErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession, canViewReports]);

  useEffect(() => {
    void loadReportData();
    return subscribeMasterData(() => {
      void loadReportData();
    });
  }, [loadReportData]);

  const authorizedBranches = useMemo(() => {
    if (isAdmin) return branches;
    const allowedIds = getAuthorizedBranchIds(user);
    return branches.filter((b) => allowedIds.includes(b.branchId));
  }, [branches, isAdmin, user]);

  const scopedConfigs = useMemo(() => {
    if (branchFilter === 'ALL') return siteConfigs;
    return siteConfigs.filter((c) => c.branchId === branchFilter);
  }, [siteConfigs, branchFilter]);

  const scopedSites = useMemo(() => {
    if (branchFilter === 'ALL') return sites;
    return sites.filter((s) => s.branchId === branchFilter);
  }, [sites, branchFilter]);

  const overallSummary = useMemo(
    () => computeSiteManpowerSummary(scopedConfigs),
    [scopedConfigs]
  );

  const fulfillmentRate = useMemo(() => {
    if (overallSummary.totalRequired === 0) return '100%';
    const pct = Math.round(
      (overallSummary.totalDeployed / overallSummary.totalRequired) * 100
    );
    return `${Math.min(100, Math.max(0, pct))}%`;
  }, [overallSummary]);

  const branchRollups = useMemo(() => {
    return authorizedBranches.map((b) => {
      const brClients = clients.filter((c) => c.assignedBranch === b.branchId).length;
      const brSites = sites.filter((s) => s.branchId === b.branchId).length;
      const brConfigs = siteConfigs.filter((cfg) => cfg.branchId === b.branchId);
      const summary = computeSiteManpowerSummary(brConfigs);
      return {
        branch: b,
        clientsCount: brClients,
        sitesCount: brSites,
        required: summary.totalRequired,
        deployed: summary.totalDeployed,
        vacant: summary.totalVacant,
      };
    });
  }, [authorizedBranches, clients, sites, siteConfigs]);

  const siteManpowerRows = useMemo(() => {
    const q = siteSearch.trim().toLowerCase();
    return scopedSites
      .map((s) => {
        const cfgs = scopedConfigs.filter((c) => c.siteId === s.siteId);
        const summary = computeSiteManpowerSummary(cfgs);
        return {
          site: s,
          summary,
        };
      })
      .filter(({ site }) => {
        if (!q) return true;
        return (
          site.siteId.toLowerCase().includes(q) ||
          site.siteName.toLowerCase().includes(q) ||
          site.clientName.toLowerCase().includes(q) ||
          site.city.toLowerCase().includes(q)
        );
      });
  }, [scopedSites, scopedConfigs, siteSearch]);

  const handleExportCsv = () => {
    const headers = [
      'Site ID',
      'Site Name',
      'Client Name',
      'Branch ID',
      'City',
      'Security (Req/Dep/Vac)',
      'Housekeeping (Req/Dep/Vac)',
      'Manpower (Req/Dep/Vac)',
      'Total Required',
      'Total Deployed',
      'Total Vacant',
    ];
    const escapeCsv = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;

    const rows = siteManpowerRows.map(({ site, summary }) => {
      const sec = summary.byCategory.Security;
      const hkp = summary.byCategory.Housekeeping;
      const mnp = summary.byCategory.Manpower;
      return [
        site.siteId,
        site.siteName,
        site.clientName,
        site.branchId,
        site.city,
        `${sec.requiredCount}/${sec.deployedCount}/${sec.vacantCount}`,
        `${hkp.requiredCount}/${hkp.deployedCount}/${hkp.vacantCount}`,
        `${mnp.requiredCount}/${mnp.deployedCount}/${mnp.vacantCount}`,
        summary.totalRequired,
        summary.totalDeployed,
        summary.totalVacant,
      ]
        .map(escapeCsv)
        .join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rexon-manpower-vacancy-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!canViewReports) {
    return (
      <EmptyStatePanel
        icon={Lock}
        title="Permission Required (reports.view)"
        description="Your HR account does not currently include the reports.view permission. Contact an Administrator to enable report access."
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Workforce Deployment &amp; Master Vacancy Reports
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            {isAdmin
              ? 'Enterprise-wide Deployment, Availability, Assignment History, Shortage, and Vacancy reports with CSV & Excel export.'
              : `Branch-scoped deployment & vacancy analytics for: ${getAuthorizedBranchIds(user).join(', ') || '—'}`}
          </p>
        </div>

        {reportSuite === 'master_overview' && (
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {authorizedBranches.length > 1 && (
              <select
                aria-label="Filter report by branch"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="min-h-[42px] px-3.5 py-2 text-xs font-medium bg-white border border-[#D4C7B8] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
              >
                <option value="ALL">All Authorized Branches</option>
                {authorizedBranches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.branchCode} — {b.city}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={siteManpowerRows.length === 0}
              className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV Report</span>
            </button>
          </div>
        )}
      </div>

      {/* Report Suite Switcher */}
      <div className="flex flex-wrap gap-2 border-b border-[#E5DDD3]">
        <button
          type="button"
          onClick={() => setReportSuite('deployment_suite')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            reportSuite === 'deployment_suite'
              ? 'border-[#5C3D2E] text-[#5C3D2E]'
              : 'border-transparent text-[#6B5E55] hover:text-[#1F1916]'
          }`}
        >
          Workforce Deployment Suite (9 Reports · CSV &amp; Excel)
        </button>
        <button
          type="button"
          onClick={() => setReportSuite('master_overview')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            reportSuite === 'master_overview'
              ? 'border-[#5C3D2E] text-[#5C3D2E]'
              : 'border-transparent text-[#6B5E55] hover:text-[#1F1916]'
          }`}
        >
          Phase 2 Master Site Configuration Rollup
        </button>
      </div>

      {reportSuite === 'deployment_suite' ? (
        <DeploymentReportsPanel />
      ) : (
        <>
          {errorMsg && (
            <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
              {errorMsg}
            </div>
          )}

          {/* KPI Summary */}
          <section aria-label="Manpower report KPIs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMetricCard
            label="Total Required Strength"
            value={overallSummary.totalRequired}
            subtext={`Across ${overallSummary.totalLines} configured site post line(s)`}
            icon={Layers}
          />
          <StatMetricCard
            label="Total Deployed Count"
            value={overallSummary.totalDeployed}
            subtext="Active personnel deployed on posts"
            icon={Users}
          />
          <StatMetricCard
            label="Total Vacant Posts"
            value={overallSummary.totalVacant}
            subtext="Vacant = Required − Deployed (never negative)"
            icon={AlertTriangle}
            tone={overallSummary.totalVacant > 0 ? 'attention' : 'default'}
          />
          <StatMetricCard
            label="Deployment Fulfillment"
            value={fulfillmentRate}
            subtext={`${scopedSites.length} active site(s) in current scope`}
            icon={CheckCircle2}
          />
        </div>
      </section>

      {loading ? (
        <div className="h-64 rounded-xl bg-white border border-[#E5DDD2] animate-pulse" />
      ) : (
        <>
          {/* Service Category Rollup Table */}
          <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <div className="mb-4">
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                1. Service-Category Manpower Rollup (Security · Housekeeping · Manpower)
              </h2>
              <p className="text-xs text-[#574B43]">
                Real-time rollup of sanctioned posts, active deployments, and open vacancies per
                service vertical.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Service Category</th>
                    <th className="py-3 px-3 text-right">Designation Lines</th>
                    <th className="py-3 px-3 text-right">Required Count</th>
                    <th className="py-3 px-3 text-right">Deployed Count</th>
                    <th className="py-3 px-3 text-right">Vacant Count</th>
                    <th className="py-3 px-3 text-right">Fulfillment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {SERVICE_CATEGORIES.map((cat) => {
                    const row = overallSummary.byCategory[cat];
                    const vac = computeNonNegativeVacancy(row.requiredCount, row.deployedCount);
                    const pct =
                      row.requiredCount === 0
                        ? 100
                        : Math.round((row.deployedCount / row.requiredCount) * 100);

                    return (
                      <tr key={cat} className="hover:bg-[#FAF8F5]">
                        <td className="py-3.5 px-3 font-semibold text-[#1F1916]">{cat}</td>
                        <td className="py-3.5 px-3 text-right font-mono-tabular text-[#574B43]">
                          {row.designationLines}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono-tabular font-semibold text-[#1F1916]">
                          {row.requiredCount}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono-tabular font-semibold text-[#166534]">
                          {row.deployedCount}
                        </td>
                        <td
                          className={`py-3.5 px-3 text-right font-mono-tabular font-semibold ${
                            vac > 0 ? 'text-[#B45309]' : 'text-[#574B43]'
                          }`}
                        >
                          {vac}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                          {pct}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Branch-Wise Master & Manpower Summary */}
          <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <div className="mb-4">
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                2. Branch-Wise Client, Site &amp; Manpower Summary
              </h2>
              <p className="text-xs text-[#574B43]">
                Regional branch breakdown within your authorized scope.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Branch</th>
                    <th className="py-3 px-3">City &amp; State</th>
                    <th className="py-3 px-3 text-right">Clients</th>
                    <th className="py-3 px-3 text-right">Sites</th>
                    <th className="py-3 px-3 text-right">Required</th>
                    <th className="py-3 px-3 text-right">Deployed</th>
                    <th className="py-3 px-3 text-right">Vacant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {branchRollups.map((item) => (
                    <tr key={item.branch.branchId} className="hover:bg-[#FAF8F5]">
                      <td className="py-3.5 px-3">
                        <div className="font-semibold text-[#1F1916]">
                          {item.branch.branchName}
                        </div>
                        <div className="font-mono-tabular text-xs text-[#5C3D2E]">
                          {item.branch.branchCode} · {item.branch.branchId}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-[#574B43]">
                        {item.branch.city}, {item.branch.state}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono-tabular text-[#1F1916]">
                        {item.clientsCount}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono-tabular text-[#1F1916]">
                        {item.sitesCount}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono-tabular font-semibold text-[#1F1916]">
                        {item.required}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono-tabular font-semibold text-[#166534]">
                        {item.deployed}
                      </td>
                      <td
                        className={`py-3.5 px-3 text-right font-mono-tabular font-semibold ${
                          item.vacant > 0 ? 'text-[#B45309]' : 'text-[#574B43]'
                        }`}
                      >
                        {item.vacant}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Site-Wise Service & Vacancy Breakdown */}
          <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
            <div className="mb-3">
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                3. Site-Wise Service &amp; Vacancy Breakdown
              </h2>
              <p className="text-xs text-[#574B43]">
                Inspect Required, Deployed, and Vacant headcount across Security, Housekeeping, and
                Manpower for every active Site.
              </p>
            </div>

            <DataTableToolbar
              searchQuery={siteSearch}
              onSearchChange={setSiteSearch}
              searchPlaceholder="Search Site ID, site name, client, or city..."
            />

            {siteManpowerRows.length === 0 ? (
              <EmptyStatePanel
                icon={BarChart3}
                title="No Sites Match Filter"
                description="Clear the search filter or configure Site Services in Site Management."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                      <th className="py-3 px-3">Site &amp; Client</th>
                      <th className="py-3 px-3 text-right">Security (Req/Dep/Vac)</th>
                      <th className="py-3 px-3 text-right">Housekeeping (Req/Dep/Vac)</th>
                      <th className="py-3 px-3 text-right">Manpower (Req/Dep/Vac)</th>
                      <th className="py-3 px-3 text-right">Total Req</th>
                      <th className="py-3 px-3 text-right">Total Dep</th>
                      <th className="py-3 px-3 text-right">Total Vac</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5DDD2] text-sm">
                    {siteManpowerRows.map(({ site, summary }) => {
                      const sec = summary.byCategory.Security;
                      const hkp = summary.byCategory.Housekeeping;
                      const mnp = summary.byCategory.Manpower;

                      return (
                        <tr key={site.siteId} className="hover:bg-[#FAF8F5]">
                          <td className="py-3.5 px-3">
                            <div className="font-semibold text-[#1F1916]">{site.siteName}</div>
                            <div className="text-xs text-[#574B43] mt-0.5">
                              <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                                {site.siteId}
                              </span>{' '}
                              · {site.clientName} ({site.city})
                            </div>
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                            {sec.requiredCount} / {sec.deployedCount} /{' '}
                            <span
                              className={
                                sec.vacantCount > 0 ? 'font-semibold text-[#B45309]' : ''
                              }
                            >
                              {sec.vacantCount}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                            {hkp.requiredCount} / {hkp.deployedCount} /{' '}
                            <span
                              className={
                                hkp.vacantCount > 0 ? 'font-semibold text-[#B45309]' : ''
                              }
                            >
                              {hkp.vacantCount}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                            {mnp.requiredCount} / {mnp.deployedCount} /{' '}
                            <span
                              className={
                                mnp.vacantCount > 0 ? 'font-semibold text-[#B45309]' : ''
                              }
                            >
                              {mnp.vacantCount}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular font-semibold text-[#1F1916]">
                            {summary.totalRequired}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular font-semibold text-[#166534]">
                            {summary.totalDeployed}
                          </td>
                          <td
                            className={`py-3.5 px-3 text-right font-mono-tabular font-semibold ${
                              summary.totalVacant > 0 ? 'text-[#B45309]' : 'text-[#574B43]'
                            }`}
                          >
                            {summary.totalVacant}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
        </>
      )}
    </div>
  );
};
