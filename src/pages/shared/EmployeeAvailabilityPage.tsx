import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Download,
  FileSpreadsheet,
  Search,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  buildEmployeeAvailabilityList,
  loadOperationalDeploymentBundle,
  subscribeDeploymentData,
} from '../../services/firestore/assignmentService';
import { subscribeEmployeeData } from '../../services/firestore/employeeService';
import { subscribeMasterData } from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  DesignationRecord,
  EmployeeAssignmentRecord,
  EmployeeAvailabilityItem,
  EmployeeAvailabilityState,
  EmployeeRecord,
  SERVICE_CATEGORIES,
  ServiceCategory,
  ServiceRecord,
} from '../../types';
import {
  exportTableToCsv,
  exportTableToExcelXml,
  getTodayIsoDate,
} from '../../utils/deploymentValidation';
import {
  getAuthorizedBranchIds,
  hasUserPermission,
  ROLE_TO_PORTAL_BASE,
} from '../../utils/portalConfig';

const AVAILABILITY_STATES: readonly EmployeeAvailabilityState[] = [
  'Available',
  'Currently Deployed',
  'On Leave',
  'Upcoming Assignment',
  'Conflicting Shifts',
  'Awaiting Verification',
  'Inactive',
];

const PAGE_SIZE = 12;

export const EmployeeAvailabilityPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [assignments, setAssignments] = useState<EmployeeAssignmentRecord[]>([]);

  // Filters
  const [targetDate, setTargetDate] = useState(getTodayIsoDate());
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [serviceFilter, setServiceFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState<ServiceCategory | 'ALL'>('ALL');
  const [designationFilter, setDesignationFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<EmployeeAvailabilityState | 'ALL'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const bundle = await loadOperationalDeploymentBundle(user, isPreviewSession);
      setBranches(bundle.branches);
      setServices(bundle.services);
      setDesignations(bundle.designations);
      setEmployees(bundle.employees);
      setAssignments(bundle.assignments);
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

  const availabilityItems: EmployeeAvailabilityItem[] = useMemo(() => {
    return buildEmployeeAvailabilityList({
      employees,
      assignments,
      targetDate,
    });
  }, [employees, assignments, targetDate]);

  // Map serviceId -> designationIds for the Service filter
  const serviceToDesignationIds = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const d of designations) {
      const set = map.get(d.relatedServiceId) ?? new Set<string>();
      set.add(d.designationId);
      map.set(d.relatedServiceId, set);
    }
    return map;
  }, [designations]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return availabilityItems.filter((item) => {
      if (branchFilter !== 'ALL' && item.branchId !== branchFilter) return false;
      if (
        categoryFilter !== 'ALL' &&
        !item.assignedServiceCategories.includes(categoryFilter)
      ) {
        return false;
      }
      if (serviceFilter !== 'ALL') {
        const validDesigIds = serviceToDesignationIds.get(serviceFilter);
        if (
          !validDesigIds ||
          !item.assignedDesignationIds.some((id) => validDesigIds.has(id))
        ) {
          return false;
        }
      }
      if (
        designationFilter !== 'ALL' &&
        !item.assignedDesignationIds.includes(designationFilter)
      ) {
        return false;
      }
      if (statusFilter !== 'ALL' && item.availabilityState !== statusFilter) {
        return false;
      }
      if (q) {
        const hay = `${item.employeeId} ${item.fullName} ${item.branchName} ${item.assignedDesignationNames.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    availabilityItems,
    branchFilter,
    categoryFilter,
    serviceFilter,
    designationFilter,
    statusFilter,
    searchQuery,
    serviceToDesignationIds,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    branchFilter,
    categoryFilter,
    serviceFilter,
    designationFilter,
    statusFilter,
    searchQuery,
    targetDate,
  ]);

  const stateCounts = useMemo(() => {
    const counts: Record<EmployeeAvailabilityState, number> = {
      Available: 0,
      'Currently Deployed': 0,
      'On Leave': 0,
      'Upcoming Assignment': 0,
      'Conflicting Shifts': 0,
      'Awaiting Verification': 0,
      Inactive: 0,
    };
    for (const item of availabilityItems) {
      counts[item.availabilityState] += 1;
    }
    return counts;
  }, [availabilityItems]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, currentPage]);

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

  const renderAvailabilityBadge = (state: EmployeeAvailabilityState) => {
    const styleMap: Record<EmployeeAvailabilityState, string> = {
      Available: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      'Currently Deployed': 'border-[#D8CEC2] bg-[#FAF8F5] text-[#4A3023]',
      'On Leave': 'border-amber-200 bg-amber-50 text-amber-900',
      'Upcoming Assignment': 'border-sky-200 bg-sky-50 text-sky-800',
      'Conflicting Shifts': 'border-red-300 bg-red-50 text-red-800',
      'Awaiting Verification': 'border-orange-200 bg-orange-50 text-orange-800',
      Inactive: 'border-gray-200 bg-gray-100 text-gray-600',
    };
    return (
      <span
        className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${styleMap[state]}`}
      >
        {state}
      </span>
    );
  };

  const exportHeaders = [
    'Target Date',
    'Employee ID',
    'Employee Name',
    'Branch',
    'Approved Designations',
    'Availability Status',
    'Active Site(s) on Date',
    'Daily Duty Hours',
    'Upcoming Assignments',
    'Verification Summary',
  ];

  const buildExportMatrix = () =>
    filteredItems.map((i) => [
      targetDate,
      i.employeeId,
      i.fullName,
      i.branchName,
      i.assignedDesignationNames.join(', ') || 'None',
      i.availabilityState,
      i.activeAssignmentsOnDate.map((a) => `${a.siteName} (${a.shift})`).join('; ') || 'Unassigned',
      i.totalDutyHoursOnDate,
      i.upcomingAssignments.length,
      i.docVerificationSummary,
    ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#1F1916]">
            Employee Availability & Readiness View
          </h1>
          <p className="text-sm text-[#6B5E55]">
            Inspect bench availability, active site deployments, leave status, upcoming rosters, shift conflicts, and pending KYC/qualification checks.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              exportTableToCsv('rexon-employee-availability', exportHeaders, buildExportMatrix())
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
                'rexon-employee-availability',
                'Employee Availability',
                exportHeaders,
                buildExportMatrix()
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-xs font-semibold text-[#5C3D2E] hover:bg-[#FAF8F5]"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* 6 Status Summary Cards (Interactive Filter Triggers) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {(
          [
            { key: 'Available', label: 'Available', accent: 'text-emerald-800' },
            { key: 'Currently Deployed', label: 'Currently Deployed', accent: 'text-[#5C3D2E]' },
            { key: 'On Leave', label: 'On Leave', accent: 'text-amber-800' },
            { key: 'Upcoming Assignment', label: 'Upcoming Duty', accent: 'text-sky-800' },
            { key: 'Conflicting Shifts', label: 'Conflicting Shifts', accent: 'text-red-700' },
            {
              key: 'Awaiting Verification',
              label: 'Awaiting Verification',
              accent: 'text-orange-800',
            },
          ] as { key: EmployeeAvailabilityState; label: string; accent: string }[]
        ).map((card) => {
          const isSelected = statusFilter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setStatusFilter(isSelected ? 'ALL' : card.key)}
              className={`rounded-xl border p-3.5 text-left transition-colors ${
                isSelected
                  ? 'border-[#5C3D2E] bg-[#FAF8F5] ring-1 ring-[#5C3D2E]'
                  : 'border-[#E5DDD3] bg-white hover:bg-[#FAF8F5]'
              }`}
            >
              <p className="text-[11px] font-medium text-[#6B5E55]">{card.label}</p>
              <p className={`mt-1 text-2xl font-bold font-mono-tabular ${card.accent}`}>
                {stateCounts[card.key]}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filter Bar */}
      <div className="rounded-xl border border-[#E5DDD3] bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="h-4 w-4 text-[#8A7B70] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search employee ID, name, designation..."
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
            value={serviceFilter}
            onChange={(e) => {
              setServiceFilter(e.target.value);
              setDesignationFilter('ALL');
            }}
            className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
          >
            <option value="ALL">All Services</option>
            {services
              .filter(
                (s) =>
                  s.status === 'Active' &&
                  (categoryFilter === 'ALL' || s.serviceCategory === categoryFilter)
              )
              .map((s) => (
                <option key={s.serviceId} value={s.serviceId}>
                  [{s.serviceCategory}] {s.serviceName}
                </option>
              ))}
          </select>

          <select
            value={designationFilter}
            onChange={(e) => setDesignationFilter(e.target.value)}
            className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
          >
            <option value="ALL">All Designations</option>
            {designations
              .filter(
                (d) =>
                  d.status === 'Active' &&
                  (categoryFilter === 'ALL' || d.serviceCategory === categoryFilter) &&
                  (serviceFilter === 'ALL' || d.relatedServiceId === serviceFilter)
              )
              .map((d) => (
                <option key={d.designationId} value={d.designationId}>
                  {d.designationName}
                </option>
              ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EmployeeAvailabilityState | 'ALL')}
            className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916]"
          >
            <option value="ALL">All Availability States</option>
            {AVAILABILITY_STATES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#F0EAE1]">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#4A3E36]">
            <label className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-[#5C3D2E]" />
              <span className="font-medium">Availability Date:</span>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value || getTodayIsoDate())}
                className="rounded border border-[#D8CEC2] px-2 py-1 font-mono-tabular text-xs"
              />
            </label>

            <div className="inline-flex items-center gap-1.5">
              <span>Category:</span>
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value as ServiceCategory | 'ALL');
                  setServiceFilter('ALL');
                  setDesignationFilter('ALL');
                }}
                className="rounded border border-[#D8CEC2] bg-white px-2 py-1 text-xs"
              >
                <option value="ALL">All Categories</option>
                {SERVICE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(statusFilter !== 'ALL' ||
            branchFilter !== 'ALL' ||
            serviceFilter !== 'ALL' ||
            designationFilter !== 'ALL' ||
            categoryFilter !== 'ALL' ||
            searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setBranchFilter('ALL');
                setCategoryFilter('ALL');
                setServiceFilter('ALL');
                setDesignationFilter('ALL');
                setStatusFilter('ALL');
              }}
              className="text-xs font-semibold text-[#5C3D2E] hover:underline"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Availability Table */}
      <div className="rounded-xl border border-[#E5DDD3] bg-white overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-[#6B5E55]">
            Evaluating workforce availability...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <UserCheck className="h-8 w-8 text-[#8A7B70] mx-auto" />
            <p className="text-sm font-semibold text-[#1F1916]">
              No employees found matching the selected availability criteria.
            </p>
            <p className="text-xs text-[#6B5E55]">
              Onboard employees in Employee Management or adjust the date/designation filters above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E5DDD3] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                  <th className="px-4 py-3">Employee & Branch</th>
                  <th className="px-4 py-3">Approved Designations</th>
                  <th className="px-4 py-3">Availability on {targetDate}</th>
                  <th className="px-4 py-3">Active Deployment(s)</th>
                  <th className="px-4 py-3">Upcoming & Verification</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE9E0] text-sm">
                {paginatedItems.map((item) => {
                  const canDeployEmployee =
                    canAssign &&
                    item.employeeStatus === 'Active' &&
                    item.availabilityState !== 'Awaiting Verification' &&
                    item.availabilityState !== 'Inactive' &&
                    item.totalDutyHoursOnDate < 16;

                  return (
                    <tr key={item.employeeId} className="hover:bg-[#FAF8F5]/70">
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-[#1F1916]">{item.fullName}</div>
                        <div className="text-xs font-mono-tabular text-[#5C3D2E]">
                          {item.employeeId} · {item.mobile}
                        </div>
                        <div className="text-xs text-[#6B5E55]">{item.branchName}</div>
                      </td>

                      <td className="px-4 py-3 align-top">
                        {item.assignedDesignationNames.length === 0 ? (
                          <span className="text-xs text-orange-800">No approved designation</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {item.assignedDesignationNames.map((dName) => (
                              <span
                                key={dName}
                                className="rounded bg-[#EFE9E0] px-2 py-0.5 text-xs font-medium text-[#4A3023]"
                              >
                                {dName}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 align-top">
                        {renderAvailabilityBadge(item.availabilityState)}
                        {item.hasShiftConflict && (
                          <div className="mt-1 text-[11px] text-red-700 max-w-xs">
                            {item.conflictDetails}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 align-top text-xs">
                        {item.activeAssignmentsOnDate.length === 0 ? (
                          <span className="text-[#8A7B70]">Unassigned on {targetDate}</span>
                        ) : (
                          <div className="space-y-1">
                            {item.activeAssignmentsOnDate.map((a) => (
                              <div key={a.assignmentId} className="text-[#1F1916]">
                                <span className="font-semibold">{a.siteName}</span> — {a.shift} (
                                <span className="font-mono-tabular">
                                  {a.shiftStartTime}–{a.shiftEndTime}
                                </span>
                                )
                              </div>
                            ))}
                            <div className="font-mono-tabular text-[11px] text-[#6B5E55]">
                              Total daily duty: {item.totalDutyHoursOnDate}h / 16h max
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 align-top text-xs">
                        <div className="font-mono-tabular text-[#1F1916]">
                          Upcoming duties: <strong>{item.upcomingAssignments.length}</strong>
                        </div>
                        <div
                          className={`mt-0.5 font-medium ${
                            item.docVerificationSummary === 'Verified'
                              ? 'text-emerald-800'
                              : item.docVerificationSummary === 'Rejected'
                                ? 'text-red-700'
                                : 'text-amber-800'
                          }`}
                        >
                          Docs: {item.docVerificationSummary}
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top text-right">
                        {canDeployEmployee ? (
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `${portalBase}/assignments?action=assign&employeeId=${encodeURIComponent(
                                  item.employeeId
                                )}&date=${encodeURIComponent(targetDate)}`
                              )
                            }
                            className="inline-flex items-center gap-1 rounded bg-[#5C3D2E] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#4A3023]"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            <span>
                              {item.activeAssignmentsOnDate.length > 0
                                ? 'Add Shift / Site'
                                : 'Assign Site'}
                            </span>
                          </button>
                        ) : (
                          <span className="text-xs text-[#8A7B70]">
                            {item.availabilityState === 'Awaiting Verification'
                              ? 'Verify first'
                              : 'Unavailable'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filteredItems.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-[#E5DDD3] bg-[#FAF8F5] px-4 py-3 text-xs text-[#6B5E55]">
            <span>
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, filteredItems.length)} of {filteredItems.length}{' '}
              employees
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
