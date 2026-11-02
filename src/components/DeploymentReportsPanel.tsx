import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Download, FileSpreadsheet, Search } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  buildEmployeeAvailabilityList,
  buildSiteDeploymentRows,
  loadOperationalDeploymentBundle,
  subscribeDeploymentData,
} from '../services/firestore/assignmentService';
import { subscribeEmployeeData } from '../services/firestore/employeeService';
import { subscribeMasterData } from '../services/firestore/masterDataService';
import {
  BranchRecord,
  ClientRecord,
  DeploymentReportKey,
  DesignationRecord,
  EmployeeAssignmentRecord,
  EmployeeRecord,
  ManpowerShortageRecord,
  SERVICE_CATEGORIES,
  ServiceCategory,
  ServiceRecord,
  SiteRecord,
  SiteServiceConfigRecord,
} from '../types';
import {
  exportTableToCsv,
  exportTableToExcelXml,
  getTodayIsoDate,
} from '../utils/deploymentValidation';
import { computeNonNegativeVacancy } from '../utils/masterValidation';
import { getAuthorizedBranchIds } from '../utils/portalConfig';

interface ReportDefinition {
  key: DeploymentReportKey;
  label: string;
  description: string;
}

const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    key: 'site_deployment',
    label: '1. Site-Wise Deployment',
    description: 'Post-level Required, Deployed, Vacant, Active, and Upcoming manpower per site.',
  },
  {
    key: 'client_deployment',
    label: '2. Client-Wise Deployment',
    description: 'Aggregated manpower fulfillment, active sites, and vacancies per contracted client.',
  },
  {
    key: 'branch_deployment',
    label: '3. Branch-Wise Deployment',
    description: 'Regional branch deployment totals across Security, Housekeeping, and Manpower.',
  },
  {
    key: 'service_deployment',
    label: '4. Service-Wise Deployment',
    description: 'Manpower deployment and vacancy breakdown across all authorized services.',
  },
  {
    key: 'designation_deployment',
    label: '5. Designation-Wise Deployment',
    description: 'Required vs deployed headcount grouped by operational designation.',
  },
  {
    key: 'assignment_history',
    label: '6. Employee Assignment History',
    description: 'Complete chronological site assignment, transfer, completion, and cancellation register.',
  },
  {
    key: 'vacancy_shortage',
    label: '7. Vacancy & Shortage Report',
    description: 'Unfilled sanctioned site posts combined with open Field Officer / HR shortage alerts.',
  },
  {
    key: 'upcoming_assignments',
    label: '8. Upcoming Assignment Report',
    description: 'Future-dated scheduled employee deployments with reporting times and instructions.',
  },
  {
    key: 'employee_availability',
    label: '9. Employee Availability Report',
    description: 'Workforce bench availability, active duty hours, leave, conflicts, and verification state.',
  },
];

const PAGE_SIZE = 12;

export const DeploymentReportsPanel: React.FC = () => {
  const { user, isPreviewSession } = useAuth();

  const [selectedReport, setSelectedReport] =
    useState<DeploymentReportKey>('site_deployment');
  const [loading, setLoading] = useState(true);

  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [siteConfigs, setSiteConfigs] = useState<SiteServiceConfigRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [assignments, setAssignments] = useState<EmployeeAssignmentRecord[]>([]);
  const [shortages, setShortages] = useState<ManpowerShortageRecord[]>([]);

  // Filters
  const [referenceDate, setReferenceDate] = useState(getTodayIsoDate());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState<ServiceCategory | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const bundle = await loadOperationalDeploymentBundle(user, isPreviewSession);
      setBranches(bundle.branches);
      setClients(bundle.clients);
      setSites(bundle.sites);
      setServices(bundle.services);
      setDesignations(bundle.designations);
      setSiteConfigs(bundle.siteConfigs);
      setEmployees(bundle.employees);
      setAssignments(bundle.assignments);
      setShortages(bundle.shortages);
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadData();
    const u1 = subscribeDeploymentData(() => void loadData());
    const u2 = subscribeEmployeeData(() => void loadData());
    const u3 = subscribeMasterData(() => void loadData());
    return () => {
      u1();
      u2();
      u3();
    };
  }, [loadData]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedReport, referenceDate, dateFrom, dateTo, branchFilter, categoryFilter, searchQuery]);

  const deploymentLines = useMemo(() => {
    return buildSiteDeploymentRows({
      branches,
      clients,
      sites,
      siteConfigs,
      assignments,
      shortages,
      referenceDate,
    }).filter((r) => {
      if (branchFilter !== 'ALL' && r.branchId !== branchFilter) return false;
      if (categoryFilter !== 'ALL' && r.serviceCategory !== categoryFilter) return false;
      return true;
    });
  }, [
    branches,
    clients,
    sites,
    siteConfigs,
    assignments,
    shortages,
    referenceDate,
    branchFilter,
    categoryFilter,
  ]);

  const availabilityList = useMemo(() => {
    return buildEmployeeAvailabilityList({
      employees,
      assignments,
      targetDate: referenceDate,
    }).filter((item) => {
      if (branchFilter !== 'ALL' && item.branchId !== branchFilter) return false;
      if (
        categoryFilter !== 'ALL' &&
        !item.assignedServiceCategories.includes(categoryFilter)
      ) {
        return false;
      }
      return true;
    });
  }, [employees, assignments, referenceDate, branchFilter, categoryFilter]);

  // Build tabular Headers + Rows dynamically for all 9 reports
  const reportTable = useMemo((): { headers: string[]; rows: (string | number)[][] } => {
    const q = searchQuery.trim().toLowerCase();
    const filterBySearch = (rows: (string | number)[][]) => {
      if (!q) return rows;
      return rows.filter((r) => r.some((cell) => String(cell).toLowerCase().includes(q)));
    };

    switch (selectedReport) {
      case 'site_deployment': {
        const headers = [
          'Branch',
          'Client',
          'Site Name',
          'Category',
          'Service',
          'Designation',
          'Shift',
          'Required',
          'Deployed',
          'Vacant',
          'Active',
          'Upcoming',
        ];
        const rows = deploymentLines.map((l) => [
          l.branchName,
          l.clientName,
          l.siteName,
          l.serviceCategory,
          l.serviceName,
          l.designationName,
          l.shiftType,
          l.requiredEmployees,
          l.deployedEmployees,
          l.vacantPositions,
          l.activeAssignments,
          l.upcomingAssignments,
        ]);
        return { headers, rows: filterBySearch(rows) };
      }

      case 'client_deployment': {
        const headers = [
          'Client ID',
          'Client Name',
          'Active Sites',
          'Security Deployed',
          'Housekeeping Deployed',
          'Manpower Deployed',
          'Total Required',
          'Total Deployed',
          'Total Vacant',
        ];
        const map = new Map<
          string,
          {
            clientId: string;
            clientName: string;
            siteSet: Set<string>;
            secDep: number;
            hkpDep: number;
            mnpDep: number;
            req: number;
            dep: number;
          }
        >();

        for (const l of deploymentLines) {
          const cur = map.get(l.clientId) ?? {
            clientId: l.clientId,
            clientName: l.clientName,
            siteSet: new Set<string>(),
            secDep: 0,
            hkpDep: 0,
            mnpDep: 0,
            req: 0,
            dep: 0,
          };
          cur.siteSet.add(l.siteId);
          if (l.serviceCategory === 'Security') cur.secDep += l.deployedEmployees;
          else if (l.serviceCategory === 'Housekeeping') cur.hkpDep += l.deployedEmployees;
          else cur.mnpDep += l.deployedEmployees;
          cur.req += l.requiredEmployees;
          cur.dep += l.deployedEmployees;
          map.set(l.clientId, cur);
        }

        const rows = Array.from(map.values()).map((c) => [
          c.clientId,
          c.clientName,
          c.siteSet.size,
          c.secDep,
          c.hkpDep,
          c.mnpDep,
          c.req,
          c.dep,
          computeNonNegativeVacancy(c.req, c.dep),
        ]);
        return { headers, rows: filterBySearch(rows) };
      }

      case 'branch_deployment': {
        const headers = [
          'Branch ID',
          'Branch Name',
          'Active Sites',
          'Security (Req / Dep)',
          'Housekeeping (Req / Dep)',
          'Manpower (Req / Dep)',
          'Total Required',
          'Total Deployed',
          'Vacant Positions',
        ];
        const authorizedIds = user ? getAuthorizedBranchIds(user) : [];
        const visBranches = branches.filter(
          (b) =>
            !b.isDeleted &&
            (branchFilter === 'ALL' || b.branchId === branchFilter) &&
            (user?.role === 'admin' || authorizedIds.includes(b.branchId))
        );

        const rows = visBranches.map((b) => {
          const bLines = deploymentLines.filter((l) => l.branchId === b.branchId);
          const siteCount = new Set(bLines.map((l) => l.siteId)).size;
          const secReq = bLines
            .filter((l) => l.serviceCategory === 'Security')
            .reduce((s, l) => s + l.requiredEmployees, 0);
          const secDep = bLines
            .filter((l) => l.serviceCategory === 'Security')
            .reduce((s, l) => s + l.deployedEmployees, 0);
          const hkpReq = bLines
            .filter((l) => l.serviceCategory === 'Housekeeping')
            .reduce((s, l) => s + l.requiredEmployees, 0);
          const hkpDep = bLines
            .filter((l) => l.serviceCategory === 'Housekeeping')
            .reduce((s, l) => s + l.deployedEmployees, 0);
          const mnpReq = bLines
            .filter((l) => l.serviceCategory === 'Manpower')
            .reduce((s, l) => s + l.requiredEmployees, 0);
          const mnpDep = bLines
            .filter((l) => l.serviceCategory === 'Manpower')
            .reduce((s, l) => s + l.deployedEmployees, 0);
          const totReq = secReq + hkpReq + mnpReq;
          const totDep = secDep + hkpDep + mnpDep;
          return [
            b.branchId,
            b.branchName,
            siteCount,
            `${secReq} / ${secDep}`,
            `${hkpReq} / ${hkpDep}`,
            `${mnpReq} / ${mnpDep}`,
            totReq,
            totDep,
            computeNonNegativeVacancy(totReq, totDep),
          ];
        });
        return { headers, rows: filterBySearch(rows) };
      }

      case 'service_deployment': {
        const headers = [
          'Service ID',
          'Service Category',
          'Service Name',
          'Sites Using Service',
          'Required Strength',
          'Deployed Strength',
          'Vacant Positions',
          'Upcoming Assignments',
        ];
        const rows = services
          .filter(
            (sv) =>
              sv.status === 'Active' &&
              (categoryFilter === 'ALL' || sv.serviceCategory === categoryFilter)
          )
          .map((sv) => {
            const svLines = deploymentLines.filter((l) => l.serviceId === sv.serviceId);
            const siteCount = new Set(svLines.map((l) => l.siteId)).size;
            const req = svLines.reduce((s, l) => s + l.requiredEmployees, 0);
            const dep = svLines.reduce((s, l) => s + l.deployedEmployees, 0);
            const upc = svLines.reduce((s, l) => s + l.upcomingAssignments, 0);
            return [
              sv.serviceId,
              sv.serviceCategory,
              sv.serviceName,
              siteCount,
              req,
              dep,
              computeNonNegativeVacancy(req, dep),
              upc,
            ];
          })
          .filter((r) => Number(r[4]) > 0 || Number(r[5]) > 0 || Number(r[7]) > 0);
        return { headers, rows: filterBySearch(rows) };
      }

      case 'designation_deployment': {
        const headers = [
          'Designation ID',
          'Category',
          'Designation Name',
          'Related Service',
          'Required Employees',
          'Deployed Employees',
          'Vacant Positions',
          'Upcoming Assignments',
        ];
        const rows = designations
          .filter(
            (d) =>
              d.status === 'Active' &&
              (categoryFilter === 'ALL' || d.serviceCategory === categoryFilter)
          )
          .map((d) => {
            const dLines = deploymentLines.filter((l) => l.designationId === d.designationId);
            const req = dLines.reduce((s, l) => s + l.requiredEmployees, 0);
            const dep = dLines.reduce((s, l) => s + l.deployedEmployees, 0);
            const upc = dLines.reduce((s, l) => s + l.upcomingAssignments, 0);
            return [
              d.designationId,
              d.serviceCategory,
              d.designationName,
              d.relatedServiceName,
              req,
              dep,
              computeNonNegativeVacancy(req, dep),
              upc,
            ];
          })
          .filter((r) => Number(r[4]) > 0 || Number(r[5]) > 0 || Number(r[7]) > 0);
        return { headers, rows: filterBySearch(rows) };
      }

      case 'assignment_history': {
        const headers = [
          'Assignment ID',
          'Employee ID',
          'Employee Name',
          'Branch',
          'Client',
          'Site Name',
          'Category & Designation',
          'Shift',
          'Start Date',
          'End Date',
          'Status',
          'Previous / Transferred Site',
          'Assigned By',
        ];
        const rows = assignments
          .filter((a) => {
            if (branchFilter !== 'ALL' && a.branchId !== branchFilter) return false;
            if (categoryFilter !== 'ALL' && a.serviceCategory !== categoryFilter) return false;
            if (dateFrom && (a.endDate || '9999-12-31') < dateFrom) return false;
            if (dateTo && a.startDate > dateTo) return false;
            return true;
          })
          .map((a) => [
            a.assignmentId,
            a.employeeId,
            a.employeeName,
            a.branchName,
            a.clientName,
            a.siteName,
            `${a.serviceCategory} — ${a.designationName}`,
            `${a.shift} (${a.shiftStartTime}–${a.shiftEndTime})`,
            a.startDate,
            a.endDate || 'Ongoing',
            a.assignmentStatus,
            a.transferredToSiteName
              ? `To: ${a.transferredToSiteName}`
              : a.previousSiteName
                ? `From: ${a.previousSiteName}`
                : '-',
            a.assignedBy,
          ]);
        return { headers, rows: filterBySearch(rows) };
      }

      case 'vacancy_shortage': {
        const headers = [
          'Source Type',
          'Branch',
          'Client',
          'Site Name',
          'Category',
          'Designation',
          'Shift',
          'Required',
          'Deployed',
          'Vacant / Short Count',
          'Status / Urgency',
        ];
        const vacancyRows = deploymentLines
          .filter((l) => l.vacantPositions > 0)
          .map((l) => [
            'Post Vacancy',
            l.branchName,
            l.clientName,
            l.siteName,
            l.serviceCategory,
            l.designationName,
            l.shiftType,
            l.requiredEmployees,
            l.deployedEmployees,
            l.vacantPositions,
            'Unfilled Sanctioned Post',
          ]);

        const branchMap = new Map(branches.map((b) => [b.branchId, b.branchName]));
        const shortageRows = shortages
          .filter((s) => {
            if (s.status === 'Resolved') return false;
            if (branchFilter !== 'ALL' && s.branchId !== branchFilter) return false;
            if (categoryFilter !== 'ALL' && s.serviceCategory !== categoryFilter) return false;
            if (dateFrom && s.dateReportedFor < dateFrom) return false;
            if (dateTo && s.dateReportedFor > dateTo) return false;
            return true;
          })
          .map((s) => [
            `Shortage Alert (${s.shortageId})`,
            branchMap.get(s.branchId) || s.branchId,
            s.clientName,
            s.siteName,
            s.serviceCategory,
            s.designationName,
            s.shift,
            '-',
            '-',
            s.shortageCount,
            `${s.urgency} (${s.status})`,
          ]);

        return { headers, rows: filterBySearch([...vacancyRows, ...shortageRows]) };
      }

      case 'upcoming_assignments': {
        const headers = [
          'Assignment ID',
          'Start Date',
          'End Date',
          'Employee ID',
          'Employee Name',
          'Site Name',
          'Client',
          'Designation',
          'Shift & Reporting Time',
          'Reporting Instructions',
        ];
        const today = getTodayIsoDate();
        const rows = assignments
          .filter((a) => {
            if (a.assignmentStatus !== 'Upcoming' && a.startDate <= today) return false;
            if (a.assignmentStatus === 'Cancelled' || a.assignmentStatus === 'Transferred') {
              return false;
            }
            if (branchFilter !== 'ALL' && a.branchId !== branchFilter) return false;
            if (categoryFilter !== 'ALL' && a.serviceCategory !== categoryFilter) return false;
            if (dateFrom && a.startDate < dateFrom) return false;
            if (dateTo && a.startDate > dateTo) return false;
            return true;
          })
          .sort((a, b) => a.startDate.localeCompare(b.startDate))
          .map((a) => [
            a.assignmentId,
            a.startDate,
            a.endDate,
            a.employeeId,
            a.employeeName,
            a.siteName,
            a.clientName,
            `${a.serviceCategory} — ${a.designationName}`,
            `${a.shift} (Report ${a.reportingTime})`,
            a.reportingInstructions || '-',
          ]);
        return { headers, rows: filterBySearch(rows) };
      }

      case 'employee_availability': {
        const headers = [
          'Date',
          'Employee ID',
          'Employee Name',
          'Branch',
          'Approved Designations',
          'Availability Status',
          'Active Site(s)',
          'Daily Hours',
          'Upcoming Duties',
          'Doc Verification',
        ];
        const rows = availabilityList.map((item) => [
          referenceDate,
          item.employeeId,
          item.fullName,
          item.branchName,
          item.assignedDesignationNames.join(', ') || 'None',
          item.availabilityState,
          item.activeAssignmentsOnDate.map((a) => a.siteName).join(', ') || 'Unassigned',
          item.totalDutyHoursOnDate,
          item.upcomingAssignments.length,
          item.docVerificationSummary,
        ]);
        return { headers, rows: filterBySearch(rows) };
      }
    }
  }, [
    selectedReport,
    searchQuery,
    deploymentLines,
    branches,
    services,
    designations,
    assignments,
    shortages,
    availabilityList,
    user,
    branchFilter,
    categoryFilter,
    dateFrom,
    dateTo,
    referenceDate,
  ]);

  const activeReportMeta =
    REPORT_DEFINITIONS.find((r) => r.key === selectedReport) ?? REPORT_DEFINITIONS[0];

  const totalPages = Math.max(1, Math.ceil(reportTable.rows.length / PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return reportTable.rows.slice(start, start + PAGE_SIZE);
  }, [reportTable.rows, currentPage]);

  if (!user) return null;

  const authorizedBranches = getAuthorizedBranchIds(user);
  const visibleBranches = branches.filter(
    (b) => !b.isDeleted && (user.role === 'admin' || authorizedBranches.includes(b.branchId))
  );

  return (
    <div className="space-y-5">
      {/* 9-Report Selector Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {REPORT_DEFINITIONS.map((rep) => {
          const active = rep.key === selectedReport;
          return (
            <button
              key={rep.key}
              type="button"
              onClick={() => setSelectedReport(rep.key)}
              className={`rounded-xl border p-3.5 text-left transition-colors ${
                active
                  ? 'border-[#5C3D2E] bg-[#5C3D2E] text-white shadow-sm'
                  : 'border-[#E5DDD3] bg-white text-[#1F1916] hover:bg-[#FAF8F5]'
              }`}
            >
              <div className="text-xs font-bold">{rep.label}</div>
              <p
                className={`mt-1 text-[11px] leading-snug ${
                  active ? 'text-[#EFE9E0]' : 'text-[#6B5E55]'
                }`}
              >
                {rep.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filters + Export Bar */}
      <div className="rounded-xl border border-[#E5DDD3] bg-white p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#1F1916]">{activeReportMeta.label}</h3>
            <p className="text-xs text-[#6B5E55]">{activeReportMeta.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={reportTable.rows.length === 0}
              onClick={() =>
                exportTableToCsv(
                  `rexon-${selectedReport}`,
                  reportTable.headers,
                  reportTable.rows
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-xs font-semibold text-[#4A3E36] hover:bg-[#FAF8F5] disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              disabled={reportTable.rows.length === 0}
              onClick={() =>
                exportTableToExcelXml(
                  `rexon-${selectedReport}`,
                  activeReportMeta.label.replace(/^\d+\.\s*/, ''),
                  reportTable.headers,
                  reportTable.rows
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5C3D2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Export Excel (.xls)</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-2 border-t border-[#F0EAE1]">
          <div className="lg:col-span-2 relative">
            <Search className="h-4 w-4 text-[#8A7B70] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter rows within selected report..."
              className="w-full rounded-lg border border-[#D8CEC2] bg-[#FAF8F5] pl-9 pr-3 py-2 text-xs text-[#1F1916] focus:border-[#5C3D2E] focus:bg-white focus:outline-none"
            />
          </div>

          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-xs text-[#1F1916]"
          >
            <option value="ALL">All Branches</option>
            {visibleBranches.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branchName}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ServiceCategory | 'ALL')}
            className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-xs text-[#1F1916]"
          >
            <option value="ALL">All Service Categories</option>
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {selectedReport === 'assignment_history' ||
          selectedReport === 'upcoming_assignments' ||
          selectedReport === 'vacancy_shortage' ? (
            <>
              <div>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  title="From Date"
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-2.5 py-2 text-xs font-mono-tabular"
                />
              </div>
              <div>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  title="To Date"
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-2.5 py-2 text-xs font-mono-tabular"
                />
              </div>
            </>
          ) : (
            <div className="lg:col-span-2 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-[#5C3D2E] shrink-0" />
              <span className="text-xs text-[#6B5E55] whitespace-nowrap">Snapshot Date:</span>
              <input
                type="date"
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value || getTodayIsoDate())}
                className="w-full rounded-lg border border-[#D8CEC2] bg-white px-2.5 py-2 text-xs font-mono-tabular"
              />
            </div>
          )}
        </div>
      </div>

      {/* Report Data Table */}
      <div className="rounded-xl border border-[#E5DDD3] bg-white overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-[#6B5E55]">
            Generating report dataset...
          </div>
        ) : reportTable.rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#6B5E55]">
            No records match the selected report filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E5DDD3] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                  {reportTable.headers.map((h) => (
                    <th key={h} className="px-4 py-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE9E0] text-xs sm:text-sm">
                {paginatedRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-[#FAF8F5]/70">
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        className={`px-4 py-3 align-top ${
                          typeof cell === 'number'
                            ? 'font-mono-tabular font-semibold text-right text-[#1F1916]'
                            : 'text-[#1F1916]'
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {reportTable.rows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-[#E5DDD3] bg-[#FAF8F5] px-4 py-3 text-xs text-[#6B5E55]">
            <span>
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, reportTable.rows.length)} of{' '}
              {reportTable.rows.length} rows
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
                className="rounded border border-[#D8CEC2] bg-white px-2.5 py-1 font-medium disabled:opacity-60"
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
