import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Clock,
  Download,
  FileSpreadsheet,
  Layers,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  getSitePortalDeploymentSummary,
  subscribeDeploymentData,
} from '../../services/firestore/assignmentService';
import { subscribeMasterData } from '../../services/firestore/masterDataService';
import {
  SERVICE_CATEGORIES,
  ServiceCategory,
  SiteDeploymentSummaryRecord,
} from '../../types';
import { exportTableToCsv, exportTableToExcelXml } from '../../utils/deploymentValidation';

export const SiteManpowerSummaryPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();

  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<SiteDeploymentSummaryRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<ServiceCategory | 'ALL'>('ALL');

  const loadSummaries = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getSitePortalDeploymentSummary(user, isPreviewSession);
      setSummaries(data);
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadSummaries();
    const u1 = subscribeDeploymentData(() => void loadSummaries());
    const u2 = subscribeMasterData(() => void loadSummaries());
    return () => {
      u1();
      u2();
    };
  }, [loadSummaries]);

  const activeSummaries = useMemo(() => {
    if (selectedSiteId === 'ALL') return summaries;
    return summaries.filter((s) => s.siteId === selectedSiteId);
  }, [summaries, selectedSiteId]);

  const aggregatedLines = useMemo(() => {
    return activeSummaries.flatMap((site) =>
      site.lines
        .filter((l) => categoryFilter === 'ALL' || l.serviceCategory === categoryFilter)
        .map((line) => ({
          siteId: site.siteId,
          siteName: site.siteName,
          clientName: site.clientName,
          ...line,
        }))
    );
  }, [activeSummaries, categoryFilter]);

  const aggregatedShifts = useMemo(() => {
    return activeSummaries.flatMap((site) =>
      site.shiftBreakdown.map((sh) => ({
        siteId: site.siteId,
        siteName: site.siteName,
        ...sh,
      }))
    );
  }, [activeSummaries]);

  const totals = useMemo(() => {
    return aggregatedLines.reduce(
      (acc, l) => {
        acc.required += l.requiredCount;
        acc.deployed += l.deployedCount;
        acc.vacant += l.vacantCount;
        acc.activeDeployment += l.activeAssignmentsCount;
        return acc;
      },
      { required: 0, deployed: 0, vacant: 0, activeDeployment: 0 }
    );
  }, [aggregatedLines]);

  const categoryCards = useMemo(() => {
    return SERVICE_CATEGORIES.map((cat) => {
      const lines = activeSummaries
        .flatMap((s) => s.lines)
        .filter((l) => l.serviceCategory === cat);
      return {
        category: cat,
        required: lines.reduce((s, l) => s + l.requiredCount, 0),
        deployed: lines.reduce((s, l) => s + l.deployedCount, 0),
        vacant: lines.reduce((s, l) => s + l.vacantCount, 0),
      };
    });
  }, [activeSummaries]);

  if (!user) return null;

  const exportHeaders = [
    'Site ID',
    'Site Name',
    'Service Category',
    'Service',
    'Designation',
    'Shift',
    'Required Manpower',
    'Deployed Manpower',
    'Vacancies',
  ];

  const exportRows = aggregatedLines.map((l) => [
    l.siteId,
    l.siteName,
    l.serviceCategory,
    l.serviceName,
    l.designationName,
    l.shiftType,
    l.requiredCount,
    l.deployedCount,
    l.vacantCount,
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#1F1916]">
            Authorized Site Manpower Deployment Summary
          </h1>
          <p className="text-sm text-[#6B5E55]">
            Read-only live overview of contracted services, designations, deployed headcount, vacancies, and shift-wise coverage for your site.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {summaries.length > 1 && (
            <select
              value={selectedSiteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              className="rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-xs font-medium text-[#1F1916]"
            >
              <option value="ALL">All Authorized Sites ({summaries.length})</option>
              {summaries.map((s) => (
                <option key={s.siteId} value={s.siteId}>
                  {s.siteName} ({s.siteId})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            disabled={exportRows.length === 0}
            onClick={() =>
              exportTableToCsv('site-manpower-summary', exportHeaders, exportRows)
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-xs font-semibold text-[#4A3E36] hover:bg-[#FAF8F5] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            disabled={exportRows.length === 0}
            onClick={() =>
              exportTableToExcelXml(
                'site-manpower-summary',
                'Site Manpower Summary',
                exportHeaders,
                exportRows
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#5C3D2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Excel</span>
          </button>
        </div>
      </div>

      {/* Zero-PII Client Privacy Notice */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E5DDD3] bg-[#FAF8F5] p-4 text-xs text-[#4A3E36]">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-[#5C3D2E] shrink-0" />
          <span>
            <strong>Strict Privacy Isolation Active:</strong> Displays sanitized site headcount, designations, and shift coverage only. Employee Aadhaar, PAN, bank accounts, salary, and private contact records are never exposed.
          </span>
        </div>
        <span className="rounded bg-[#EFE9E0] px-2.5 py-1 font-semibold text-[#4A3023] shrink-0">
          Read-Only View
        </span>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Required Manpower</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-tabular text-[#1F1916]">
            {totals.required}
          </p>
          <p className="mt-1 text-xs text-[#6B5E55]">Contracted post requirement</p>
        </div>

        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Deployed Manpower</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-tabular text-emerald-800">
            {totals.deployed}
          </p>
          <p className="mt-1 text-xs text-emerald-700">Assigned to configured posts</p>
        </div>

        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <p className="text-xs font-medium text-[#6B5E55]">Open Vacancies</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-tabular text-amber-800">
            {totals.vacant}
          </p>
          <p className="mt-1 text-xs text-amber-800">Unfilled sanctioned posts</p>
        </div>

        <div className="rounded-xl border border-[#E5DDD3] bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[#6B5E55]">Total Active Deployment</p>
            <Users className="h-4 w-4 text-[#5C3D2E]" />
          </div>
          <p className="mt-1.5 text-2xl font-bold font-mono-tabular text-[#5C3D2E]">
            {totals.activeDeployment}
          </p>
          <p className="mt-1 text-xs text-[#6B5E55]">Active personnel on duty today</p>
        </div>
      </div>

      {/* Service Categories Breakdown (Security, Housekeeping, Manpower) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {categoryCards.map((c) => {
          const isSelected = categoryFilter === c.category;
          return (
            <button
              key={c.category}
              type="button"
              onClick={() => setCategoryFilter(isSelected ? 'ALL' : c.category)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                isSelected
                  ? 'border-[#5C3D2E] bg-[#FAF8F5] ring-1 ring-[#5C3D2E]'
                  : 'border-[#E5DDD3] bg-white hover:bg-[#FAF8F5]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#5C3D2E]">
                  <Layers className="h-3.5 w-3.5" />
                  <span>{c.category}</span>
                </span>
                <span className="text-[11px] text-[#6B5E55]">
                  {isSelected ? 'Filtered' : 'Click to filter'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 font-mono-tabular text-sm">
                <div>
                  <div className="text-[11px] font-sans text-[#6B5E55]">Required</div>
                  <div className="font-bold text-[#1F1916]">{c.required}</div>
                </div>
                <div>
                  <div className="text-[11px] font-sans text-[#6B5E55]">Deployed</div>
                  <div className="font-bold text-emerald-800">{c.deployed}</div>
                </div>
                <div>
                  <div className="text-[11px] font-sans text-[#6B5E55]">Vacant</div>
                  <div className="font-bold text-amber-800">{c.vacant}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Designation-Wise Manpower Table */}
      <div className="rounded-xl border border-[#E5DDD3] bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#E5DDD3] bg-[#FAF8F5] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#5C3D2E]" />
            <h2 className="text-sm font-bold text-[#1F1916]">
              Service Category &amp; Designation Deployment Summary
            </h2>
          </div>
          {categoryFilter !== 'ALL' && (
            <button
              type="button"
              onClick={() => setCategoryFilter('ALL')}
              className="text-xs font-semibold text-[#5C3D2E] hover:underline"
            >
              Show All Categories
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-[#6B5E55]">
            Loading authorized site manpower summary...
          </div>
        ) : aggregatedLines.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#6B5E55]">
            No active service lines found for your assigned site scope ({user.assignedSiteIds.join(', ') || 'Unassigned'}).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E5DDD3] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                  <th className="px-4 py-3">Site</th>
                  <th className="px-4 py-3">Service Category</th>
                  <th className="px-4 py-3">Designation &amp; Service</th>
                  <th className="px-4 py-3">Shift &amp; Working Hours</th>
                  <th className="px-4 py-3 text-right">Required</th>
                  <th className="px-4 py-3 text-right">Deployed</th>
                  <th className="px-4 py-3 text-right">Vacancies</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE9E0] text-sm">
                {aggregatedLines.map((line) => (
                  <tr key={`${line.siteId}-${line.lineKey}`} className="hover:bg-[#FAF8F5]/70">
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-[#1F1916]">{line.siteName}</div>
                      <div className="text-xs font-mono-tabular text-[#6B5E55]">{line.siteId}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="inline-block rounded bg-[#EFE9E0] px-2 py-0.5 text-xs font-semibold text-[#4A3023]">
                        {line.serviceCategory}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-[#1F1916]">{line.designationName}</div>
                      <div className="text-xs text-[#6B5E55]">{line.serviceName}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-[#4A3E36]">
                      <div>{line.shiftType}</div>
                      <div className="text-[#8A7B70]">
                        {line.workingHours} · {line.weeklyOff}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono-tabular font-semibold text-[#1F1916]">
                      {line.requiredCount}
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono-tabular font-semibold text-emerald-800">
                      {line.deployedCount}
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono-tabular">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-bold ${
                          line.vacantCount > 0
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {line.vacantCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Shift-Wise Manpower Summary */}
      <div className="rounded-xl border border-[#E5DDD3] bg-white overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[#E5DDD3] bg-[#FAF8F5] px-5 py-3.5">
          <Clock className="h-4 w-4 text-[#5C3D2E]" />
          <h2 className="text-sm font-bold text-[#1F1916]">Shift-Wise Manpower Summary</h2>
        </div>

        {aggregatedShifts.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#6B5E55]">
            No active shift deployments recorded for today yet. Shift breakdown populates automatically as REXON HR / Field Officers assign personnel.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E5DDD3] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                  <th className="px-4 py-3">Site</th>
                  <th className="px-4 py-3">Shift</th>
                  <th className="px-4 py-3">Timing</th>
                  <th className="px-4 py-3 text-right">Security</th>
                  <th className="px-4 py-3 text-right">Housekeeping</th>
                  <th className="px-4 py-3 text-right">Manpower</th>
                  <th className="px-4 py-3 text-right">Total Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE9E0] text-sm">
                {aggregatedShifts.map((sh, idx) => (
                  <tr key={`${sh.siteId}-${sh.shift}-${idx}`} className="hover:bg-[#FAF8F5]/70">
                    <td className="px-4 py-3 font-medium text-[#1F1916]">{sh.siteName}</td>
                    <td className="px-4 py-3 font-semibold text-[#1F1916]">{sh.shift}</td>
                    <td className="px-4 py-3 font-mono-tabular text-xs text-[#6B5E55]">
                      {sh.shiftTiming}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular">
                      {sh.securityDeployed}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular">
                      {sh.housekeepingDeployed}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular">
                      {sh.manpowerDeployed}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-bold text-emerald-800">
                      {sh.totalActiveDeployed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
