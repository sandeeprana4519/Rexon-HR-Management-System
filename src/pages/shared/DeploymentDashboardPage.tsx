import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Download,
  FileSpreadsheet,
  FileWarning,
  Layers,
  MapPin,
  Search,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  buildSiteDeploymentRows,
  loadOperationalDeploymentBundle,
  subscribeDeploymentData,
} from '../../services/firestore/assignmentService';
import { subscribeEmployeeData } from '../../services/firestore/employeeService';
import { subscribeMasterData } from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  ClientRecord,
  EmployeeAssignmentRecord,
  ManpowerShortageRecord,
  SERVICE_CATEGORIES,
  ServiceCategory,
  SiteDeploymentLineRow,
  SiteRecord,
  SiteServiceConfigRecord,
} from '../../types';
import {
  exportTableToCsv,
  exportTableToExcelXml,
  getTodayIsoDate,
} from '../../utils/deploymentValidation';
import { getAuthorizedBranchIds, hasUserPermission, ROLE_TO_PORTAL_BASE } from '../../utils/portalConfig';

const PAGE_SIZE = 12;

export const DeploymentDashboardPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [siteConfigs, setSiteConfigs] = useState<SiteServiceConfigRecord[]>([]);
  const [assignments, setAssignments] = useState<EmployeeAssignmentRecord[]>([]);
  const [shortages, setShortages] = useState<ManpowerShortageRecord[]>([]);

  // Filters
  const [referenceDate, setReferenceDate] = useState(getTodayIsoDate());
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [clientFilter, setClientFilter] = useState('ALL');
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState<ServiceCategory | 'ALL'>('ALL');
  const [vacantOnly, setVacantOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const bundle = await loadOperationalDeploymentBundle(user, isPreviewSession);
      setBranches(bundle.branches);
      setClients(bundle.clients);
      setSites(bundle.sites);
      setSiteConfigs(bundle.siteConfigs);
      setAssignments(bundle.assignments);
      setShortages(bundle.shortages);
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadData();
    const unsub1 = subscribeDeploymentData(() => void loadData());
    const unsub2 = subscribeEmployeeData(() => void loadData());
    const unsub3 = subscribeMasterData(() => void loadData());
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [loadData]);

  const deploymentRows: SiteDeploymentLineRow[] = useMemo(() => {
    return buildSiteDeploymentRows({
      branches,
      clients,
      sites,
      siteConfigs,
      assignments,
      shortages,
      referenceDate,
    });
  }, [branches, clients, sites, siteConfigs, assignments, shortages, referenceDate]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return deploymentRows.filter((row) => {
      if (branchFilter !== 'ALL' && row.branchId !== branchFilter) return false;
      if (clientFilter !== 'ALL' && row.clientId !== clientFilter) return false;
      if (siteFilter !== 'ALL' && row.siteId !== siteFilter) return false;
      if (categoryFilter !== 'ALL' && row.serviceCategory !== categoryFilter) return false;
      if (vacantOnly && row.vacantPositions <= 0) return false;
      if (q) {
        const hay = `${row.clientName} ${row.siteName} ${row.serviceCategory} ${row.serviceName} ${row.designationName} ${row.shiftType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    deploymentRows,
    branchFilter,
    clientFilter,
    siteFilter,
    categoryFilter,
    vacantOnly,
    searchQuery,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [branchFilter, clientFilter, siteFilter, categoryFilter, vacantOnly, searchQuery, referenceDate]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, r) => {
        acc.required += r.requiredEmployees;
        acc.deployed += r.deployedEmployees;
        acc.vacant += r.vacantPositions;
        acc.active += r.activeAssignments;
        acc.upcoming += r.upcomingAssignments;
        return acc;
      },
      { required: 0, deployed: 0, vacant: 0, active: 0, upcoming: 0 }
    );
  }, [filteredRows]);

  const categoryRollups = useMemo(() => {
    return SERVICE_CATEGORIES.map((cat) => {
      const subset = filteredRows.filter((r) => r.serviceCategory === cat);
      return {
        category: cat,
        required: subset.reduce((s, r) => s + r.requiredEmployees, 0),
        deployed: subset.reduce((s, r) => s + r.deployedEmployees, 0),
        vacant: subset.reduce((s, r) => s + r.vacantPositions, 0),
        lines: subset.length,
      };
    });
  }, [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, currentPage]);

  if (!user) return null;

  const portalBase = ROLE_TO_PORTAL_BASE[user.role];
  const canAssign =
    user.role === 'admin' ||
    user.role === 'field_officer' ||
    (user.role === 'hr' && hasUserPermission(user, 'assignment.create'));

  const authorizedBranches = getAuthorizedBranchIds(user);
  const visibleBranches = branches.filter(
    (b) => !b.isDeleted && (user.role === 'admin' || authorizedBranches.includes(b.branchId))
  );

  const exportHeaders = [
    'Branch',
    'Client Name',
    'Site Name',
    'Service Category',
    'Service',
    'Designation',
    'Shift',
    'Required Employees',
    'Currently Deployed',
    'Vacant Positions',
    'Active Assignments',
    'Upcoming Assignments',
  ];

  const buildExportMatrix = () =>
    filteredRows.map((r) => [
      r.branchName,
      r.clientName,
      r.siteName,
      r.serviceCategory,
      r.serviceName,
      r.designationName,
      r.shiftType,
      r.requiredEmployees,
      r.deployedEmployees,
      r.vacantPositions,
      r.activeAssignments,
      r.upcomingAssignments,
    ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#1F1916]">
            Site-Wise Manpower Deployment Dashboard
          </h1>
          <p className="text-sm text-[#6B5E55]">
            Live Security, Housekeeping, and Manpower post fulfillment, deployed strength, and non-negative vacancies across client sites.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              exportTableToCsv('rexon-site-deployment', exportHeaders, buildExportMatrix())
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-xs font-semibold text-[#4A3E36] hover:bg-[#FAF8F5]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() =>
              exportTableToExcelXml(
                'rexon-site-deployment',
                'Site Deployment',
                exportHeaders,
                buildExportMatrix()
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-xs font-semibold text-[#5C3D2E] hover:bg-[#FAF8F5]"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Export Excel</span>
          </button>
          {canAssign && (
            <button
              type="button"
              onClick={() => navigate(`${portalBase}/assignments?action=assign`)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5C3D2E] px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#4A3023]"
            >
              <UserPlus className="h-4 w-4" />
              <span>Assign Personnel</span>
            </button>
          )}
        </div>
      </div>

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Required Employees</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#1F1916]">
            {totals.required}
          </p>
        </div>
        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Currently Deployed</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-emerald-800">
            {totals.deployed}
          </p>
        </div>
        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Vacant Positions</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-amber-800">
            {totals.vacant}
          </p>
        </div>
        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Active Assignments</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#1F1916]">
            {totals.active}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1 rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Upcoming Assignments</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-sky-800">
            {totals.upcoming}
          </p>
        </div>
      </div>

      {/* Multi-Service Category Rollup Cards (Security, Housekeeping, Manpower) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {categoryRollups.map((item) => (
          <div
            key={item.category}
            className="rounded-xl border border-[#E5DDD3] bg-[#FAF8F5] p-4 flex items-center justify-between"
          >
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#5C3D2E]">
                <Layers className="h-3.5 w-3.5" />
                <span>{item.category}</span>
              </div>
              <p className="mt-1 text-xs text-[#6B5E55]">{item.lines} configured site post line(s)</p>
            </div>
            <div className="flex items-center gap-4 text-right font-mono-tabular">
              <div>
                <div className="text-[11px] text-[#6B5E55]">Req</div>
                <div className="text-sm font-bold text-[#1F1916]">{item.required}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#6B5E55]">Dep</div>
                <div className="text-sm font-bold text-emerald-800">{item.deployed}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#6B5E55]">Vac</div>
                <div className="text-sm font-bold text-amber-800">{item.vacant}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-[#E5DDD3] bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="h-4 w-4 text-[#8A7B70] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search client, site, service, designation..."
              className="w-full rounded-lg border border-[#D8CEC2] bg-[#FAF8F5] pl-9 pr-3 py-2 text-sm focus:border-[#5C3D2E] focus:bg-white focus:outline-none"
            />
          </div>

          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
          >
            <option value="ALL">All Branches</option>
            {visibleBranches.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branchName}
              </option>
            ))}
          </select>

          <select
            value={clientFilter}
            onChange={(e) => {
              setClientFilter(e.target.value);
              setSiteFilter('ALL');
            }}
            className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
          >
            <option value="ALL">All Clients</option>
            {clients
              .filter((c) => !c.isArchived)
              .map((c) => (
                <option key={c.clientId} value={c.clientId}>
                  {c.companyName}
                </option>
              ))}
          </select>

          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
          >
            <option value="ALL">All Sites</option>
            {sites
              .filter((s) => !s.isArchived && (clientFilter === 'ALL' || s.clientId === clientFilter))
              .map((s) => (
                <option key={s.siteId} value={s.siteId}>
                  {s.siteName}
                </option>
              ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ServiceCategory | 'ALL')}
            className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
          >
            <option value="ALL">All Categories</option>
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#F0EAE1]">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#4A3E36]">
            <label className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-[#5C3D2E]" />
              <span className="font-medium">Deployment Snapshot Date:</span>
              <input
                type="date"
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value || getTodayIsoDate())}
                className="rounded border border-[#D8CEC2] px-2 py-1 font-mono-tabular text-xs"
              />
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={vacantOnly}
                onChange={(e) => setVacantOnly(e.target.checked)}
                className="rounded border-[#C9BEB2] text-[#5C3D2E]"
              />
              <span>Show only posts with open vacancies</span>
            </label>
          </div>
          <span className="text-xs text-[#6B5E55]">
            Multi-service support active: Security + Housekeeping + Manpower per site
          </span>
        </div>
      </div>

      {/* Deployment Table */}
      <div className="rounded-xl border border-[#E5DDD3] bg-white overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-[#6B5E55]">
            Calculating site manpower deployment...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <MapPin className="h-8 w-8 text-[#8A7B70] mx-auto" />
            <p className="text-sm font-semibold text-[#1F1916]">
              No site service deployment rows match the current filter.
            </p>
            <p className="text-xs text-[#6B5E55]">
              Configure Security, Housekeeping, or Manpower requirements under Sites Management or create a site assignment.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E5DDD3] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                  <th className="px-4 py-3">Client & Site</th>
                  <th className="px-4 py-3">Service Category</th>
                  <th className="px-4 py-3">Service & Designation</th>
                  <th className="px-4 py-3">Shift & Off</th>
                  <th className="px-4 py-3 text-right">Required</th>
                  <th className="px-4 py-3 text-right">Deployed</th>
                  <th className="px-4 py-3 text-right">Vacant</th>
                  <th className="px-4 py-3 text-right">Active / Upcoming</th>
                  <th className="px-4 py-3 text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE9E0] text-sm">
                {paginatedRows.map((row) => (
                  <tr key={row.rowKey} className="hover:bg-[#FAF8F5]/70">
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-[#1F1916]">{row.siteName}</div>
                      <div className="text-xs text-[#6B5E55]">
                        {row.clientName} · {row.branchName}
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top">
                      <span className="inline-block rounded bg-[#EFE9E0] px-2 py-0.5 text-xs font-semibold text-[#4A3023]">
                        {row.serviceCategory}
                      </span>
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-[#1F1916]">{row.designationName}</div>
                      <div className="text-xs text-[#6B5E55]">{row.serviceName}</div>
                    </td>

                    <td className="px-4 py-3 align-top text-xs text-[#4A3E36]">
                      <div>{row.shiftType}</div>
                      <div className="text-[#8A7B70]">{row.weeklyOff}</div>
                    </td>

                    <td className="px-4 py-3 align-top text-right font-mono-tabular font-semibold text-[#1F1916]">
                      {row.requiredEmployees}
                    </td>

                    <td className="px-4 py-3 align-top text-right font-mono-tabular font-semibold text-emerald-800">
                      {row.deployedEmployees}
                    </td>

                    <td className="px-4 py-3 align-top text-right font-mono-tabular">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-bold ${
                          row.vacantPositions > 0
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {row.vacantPositions}
                      </span>
                      {row.openShortageReports > 0 && (
                        <div className="mt-1 text-[11px] text-red-700">
                          {row.openShortageReports} reported short
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 align-top text-right font-mono-tabular text-xs text-[#4A3E36]">
                      <div>{row.activeAssignments} Active</div>
                      <div className="text-sky-800">{row.upcomingAssignments} Upcoming</div>
                    </td>

                    <td className="px-4 py-3 align-top text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {canAssign && (
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `${portalBase}/assignments?action=assign&siteId=${encodeURIComponent(
                                  row.siteId
                                )}&siteServiceId=${encodeURIComponent(
                                  row.siteServiceId
                                )}&category=${encodeURIComponent(
                                  row.serviceCategory
                                )}&serviceId=${encodeURIComponent(
                                  row.serviceId
                                )}&designationId=${encodeURIComponent(
                                  row.designationId
                                )}&date=${encodeURIComponent(referenceDate)}`
                              )
                            }
                            className="rounded bg-[#5C3D2E] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#4A3023]"
                          >
                            Deploy
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `${portalBase}/assignments?action=shortage&siteId=${encodeURIComponent(
                                row.siteId
                              )}&category=${encodeURIComponent(
                                row.serviceCategory
                              )}&serviceId=${encodeURIComponent(
                                row.serviceId
                              )}&designationId=${encodeURIComponent(row.designationId)}`
                            )
                          }
                          title="Report Shortage"
                          className="rounded border border-[#D8CEC2] bg-white p-1.5 text-amber-800 hover:bg-[#FAF8F5]"
                        >
                          <FileWarning className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filteredRows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-[#E5DDD3] bg-[#FAF8F5] px-4 py-3 text-xs text-[#6B5E55]">
            <span>
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length} post
              lines
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="rounded border border-[#D8CEC2] bg-white px-2.5 py-1 font-medium disabled:opacity-50"
              >
                Previous
              </button>
              <span className="font-mono-tabular">
                Page {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-[#D8CEC2] bg-white px-2.5 py-1 font-medium disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
