import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  Clock,
  Download,
  FileSpreadsheet,
  ShieldCheck,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  getSitePortalAttendanceSummaries,
  subscribeAttendanceData,
} from '../../services/firestore/attendanceService';
import { subscribeDeploymentData } from '../../services/firestore/assignmentService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import { SanitizedSiteAttendanceSummaryRecord } from '../../types';
import {
  exportTableToCsv,
  exportTableToExcelXml,
  getTodayIsoDate,
} from '../../utils/deploymentValidation';

export const SiteAttendanceSummaryPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const today = useMemo(() => getTodayIsoDate(), []);

  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [summaries, setSummaries] = useState<SanitizedSiteAttendanceSummaryRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadSummaries = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const list = await getSitePortalAttendanceSummaries(user, isPreviewSession, selectedDate);
      setSummaries(list);
    } catch (err) {
      setErrorMsg(formatServiceErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession, selectedDate]);

  useEffect(() => {
    void loadSummaries();
    const u1 = subscribeAttendanceData(() => void loadSummaries());
    const u2 = subscribeDeploymentData(() => void loadSummaries());
    return () => {
      u1();
      u2();
    };
  }, [loadSummaries]);

  const totals = useMemo(() => {
    return summaries.reduce(
      (acc, s) => ({
        sanctioned: acc.sanctioned + s.totalSanctioned,
        deployed: acc.deployed + s.totalDeployed,
        present: acc.present + s.presentCount + s.lateCount + s.halfDayCount,
        late: acc.late + s.lateCount,
        absent: acc.absent + s.absentCount,
        offOrLeave: acc.offOrLeave + s.weeklyOffCount + s.leaveCount,
      }),
      { sanctioned: 0, deployed: 0, present: 0, late: 0, absent: 0, offOrLeave: 0 }
    );
  }, [summaries]);

  const handleExport = (format: 'csv' | 'excel') => {
    const headers = [
      'Site ID',
      'Site Name',
      'Date',
      'Service Category',
      'Service Name',
      'Designation',
      'Shift',
      'Deployed Count',
      'Present Count',
      'Late Count',
      'Half Day Count',
      'Absent Count',
      'Weekly Off Count',
    ];
    const rows: (string | number)[][] = [];
    for (const s of summaries) {
      for (const line of s.serviceBreakdown) {
        rows.push([
          s.siteId,
          s.siteName,
          s.attendanceDate,
          line.serviceCategory,
          line.serviceName,
          line.designationName,
          line.shiftType,
          line.deployedCount,
          line.presentCount,
          line.lateCount,
          line.halfDayCount,
          line.absentCount,
          line.weeklyOffCount,
        ]);
      }
    }
    if (format === 'csv') {
      exportTableToCsv('site-turnout-headcount-summary', headers, rows);
    } else {
      exportTableToExcelXml(
        'site-turnout-headcount-summary',
        'Site Attendance Summary',
        headers,
        rows
      );
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Authorized Site Attendance Summary
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Daily shift-wise and designation-wise headcount turnout for your assigned site(s).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="min-h-[42px] px-3 py-2 text-xs font-mono-tabular bg-white border border-[#D4C7B8] rounded-lg text-[#1F1916]"
          />
          <button
            type="button"
            disabled={summaries.length === 0}
            onClick={() => handleExport('csv')}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#5C3D2E]" />
            <span>Download CSV</span>
          </button>
          <button
            type="button"
            disabled={summaries.length === 0}
            onClick={() => handleExport('excel')}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-45 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* Zero-PII & Zero-GPS Privacy Isolation Banner */}
      <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] flex items-start gap-3 text-xs text-[#574B43]">
        <ShieldCheck className="w-4 h-4 text-[#5C3D2E] shrink-0 mt-0.5" />
        <span>
          Client Privacy &amp; Data Isolation: This portal provides aggregated post, shift, and
          service headcounts only. Individual employee names, phone numbers, Aadhaar/PAN, bank
          accounts, salary figures, and raw GPS coordinates are strictly excluded.
        </span>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
          {errorMsg}
        </div>
      )}

      {/* Headcount KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Scheduled / Deployed"
          value={totals.deployed}
          subtext={`Sanctioned strength: ${totals.sanctioned}`}
          icon={Users}
        />
        <StatMetricCard
          label="Present on Site"
          value={totals.present}
          subtext="Verified on-duty personnel today"
          icon={UserCheck}
        />
        <StatMetricCard
          label="Late Arrivals"
          value={totals.late}
          subtext="Included in active present headcount"
          icon={Clock}
          tone={totals.late > 0 ? 'attention' : 'default'}
        />
        <StatMetricCard
          label="Absent / Unfilled"
          value={totals.absent}
          subtext={`Weekly Off / Leave: ${totals.offOrLeave}`}
          icon={UserMinus}
          tone={totals.absent > 0 ? 'attention' : 'default'}
        />
      </section>

      {loading ? (
        <div className="bg-white border border-[#E5DDD2] rounded-xl p-10 text-center text-xs text-[#574B43]">
          Loading sanitized site attendance summary...
        </div>
      ) : summaries.length === 0 ? (
        <div className="bg-white border border-[#E5DDD2] rounded-xl p-6">
          <EmptyStatePanel
            icon={CalendarCheck}
            title="No Site Turnout Summary Recorded for Selected Date"
            description="Once duty rosters or daily attendance verifications are published for your assigned site, shift-wise and designation-wise headcounts appear here."
          />
        </div>
      ) : (
        summaries.map((sum) => (
          <div key={sum.summaryId} className="space-y-6">
            {/* Shift-Wise Breakdown */}
            <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                    Shift-Wise Turnout — {sum.siteName}
                  </h2>
                  <p className="text-xs text-[#574B43] font-mono-tabular">
                    {sum.siteId} · {sum.clientName} · {sum.attendanceDate}
                  </p>
                </div>
              </div>

              {sum.shiftBreakdown.length === 0 ? (
                <p className="text-xs text-[#574B43]">
                  No shift entries scheduled on {sum.attendanceDate}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                        <th className="py-3 px-3">Shift</th>
                        <th className="py-3 px-3">Hours</th>
                        <th className="py-3 px-3 text-right">Deployed</th>
                        <th className="py-3 px-3 text-right">Present</th>
                        <th className="py-3 px-3 text-right">Late</th>
                        <th className="py-3 px-3 text-right">Absent</th>
                        <th className="py-3 px-3 text-right">Weekly Off</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5DDD2] text-sm">
                      {sum.shiftBreakdown.map((sh) => (
                        <tr key={sh.shiftType} className="hover:bg-[#FAF8F5]">
                          <td className="py-3 px-3 font-medium text-[#1F1916]">{sh.shiftType}</td>
                          <td className="py-3 px-3 font-mono-tabular text-xs text-[#574B43]">
                            {sh.timing}
                          </td>
                          <td className="py-3 px-3 text-right font-mono-tabular text-[#1F1916]">
                            {sh.deployedCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#166534]">
                            {sh.presentCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono-tabular text-[#B45309]">
                            {sh.lateCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#B91C1C]">
                            {sh.absentCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono-tabular text-[#574B43]">
                            {sh.weeklyOffCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Service & Designation Breakdown */}
            <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                  Service &amp; Designation Headcount Breakdown — {sum.siteName}
                </h2>
                <p className="text-xs text-[#574B43]">
                  Headcount verification across Security, Housekeeping, and Manpower posts.
                </p>
              </div>

              {sum.serviceBreakdown.length === 0 ? (
                <p className="text-xs text-[#574B43]">
                  No designation turnout records published for {sum.attendanceDate}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                        <th className="py-3 px-3">Service Category</th>
                        <th className="py-3 px-3">Service &amp; Designation</th>
                        <th className="py-3 px-3">Shift</th>
                        <th className="py-3 px-3 text-right">Deployed</th>
                        <th className="py-3 px-3 text-right">Present</th>
                        <th className="py-3 px-3 text-right">Late</th>
                        <th className="py-3 px-3 text-right">Half Day</th>
                        <th className="py-3 px-3 text-right">Absent</th>
                        <th className="py-3 px-3 text-right">Weekly Off</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5DDD2] text-sm">
                      {sum.serviceBreakdown.map((row) => (
                        <tr key={row.lineKey} className="hover:bg-[#FAF8F5]">
                          <td className="py-3 px-3 text-xs font-medium text-[#5C3D2E]">
                            {row.serviceCategory}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-[#1F1916]">{row.designationName}</div>
                            <div className="text-xs text-[#574B43]">{row.serviceName}</div>
                          </td>
                          <td className="py-3 px-3 text-xs text-[#574B43]">{row.shiftType}</td>
                          <td className="py-3 px-3 text-right font-mono-tabular text-[#1F1916]">
                            {row.deployedCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#166534]">
                            {row.presentCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono-tabular text-[#B45309]">
                            {row.lateCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono-tabular text-[#574B43]">
                            {row.halfDayCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#B91C1C]">
                            {row.absentCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono-tabular text-[#574B43]">
                            {row.weeklyOffCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        ))
      )}
    </div>
  );
};
