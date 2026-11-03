import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarCheck,
  Download,
  FileText,
  Receipt,
  ShieldCheck,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  getSitePortalDeploymentSummary,
  subscribeDeploymentData,
} from '../../services/firestore/assignmentService';
import {
  getSitePortalAttendanceSummaries,
  subscribeAttendanceData,
} from '../../services/firestore/attendanceService';
import { subscribeMasterData } from '../../services/firestore/masterDataService';
import {
  SanitizedSiteAttendanceSummaryRecord,
  SiteDeploymentSummaryRecord,
} from '../../types';
import { getTodayIsoDate } from '../../utils/deploymentValidation';

interface SiteDocumentItem {
  id: string;
  docType: 'Invoice' | 'Payment Receipt' | 'Service Report';
  period: string;
  title: string;
  amountOrRef: string;
  status: string;
}

interface ShiftAttendanceRow {
  shiftName: string;
  timing: string;
  sanctioned: number;
  present: number;
  absent: number;
}

const SAMPLE_SHIFT_SUMMARY: ShiftAttendanceRow[] = [
  {
    shiftName: '[Sample] Shift A — Morning Security & Reception',
    timing: '06:00 – 14:00',
    sanctioned: 12,
    present: 12,
    absent: 0,
  },
  {
    shiftName: '[Sample] Shift B — General Facility & Housekeeping',
    timing: '09:00 – 18:00',
    sanctioned: 10,
    present: 9,
    absent: 1,
  },
  {
    shiftName: '[Sample] Shift C — Night Perimeter & Access Control',
    timing: '22:00 – 06:00',
    sanctioned: 10,
    present: 10,
    absent: 0,
  },
];

const SAMPLE_SITE_DOCUMENTS: SiteDocumentItem[] = [
  {
    id: 'INV-Sample-401',
    docType: 'Invoice',
    period: 'Monthly Billing Cycle',
    title: '[Sample] Monthly Security & Housekeeping Deployment Invoice',
    amountOrRef: '₹4,82,000',
    status: 'Issued',
  },
  {
    id: 'RCP-Sample-402',
    docType: 'Payment Receipt',
    period: 'Prior Billing Cycle',
    title: '[Sample] Official Payment Acknowledgement Receipt',
    amountOrRef: '₹4,82,000',
    status: 'Settled',
  },
  {
    id: 'SRV-Sample-403',
    docType: 'Service Report',
    period: 'Monthly Audit',
    title: '[Sample] Authorized Site Turnout & Patrol Compliance Summary',
    amountOrRef: '96.9% Turnout',
    status: 'Available',
  },
  {
    id: 'SRV-Sample-404',
    docType: 'Service Report',
    period: 'Fortnightly Check',
    title: '[Sample] Housekeeping Hygiene & Supervisor Inspection Summary',
    amountOrRef: 'Verified',
    status: 'Available',
  },
];

interface SiteDashboardProps {
  section?: 'overview' | 'attendance' | 'billing' | 'reports';
}

export const SiteDashboard: React.FC<SiteDashboardProps> = ({ section = 'overview' }) => {
  const {
    user,
    isFirebaseConfigured,
    isPreviewSession,
    showSampleLayoutData,
    setShowSampleLayoutData,
  } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [docFilter, setDocFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 4;

  const [downloadTarget, setDownloadTarget] = useState<SiteDocumentItem | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  useEffect(() => {
    if (section === 'billing') {
      setDocFilter('Invoice');
    } else if (section === 'reports') {
      setDocFilter('Service Report');
    } else {
      setDocFilter('ALL');
    }
  }, [section]);

  const [liveSiteSummaries, setLiveSiteSummaries] = useState<SiteDeploymentSummaryRecord[]>([]);
  const [liveAttendanceSummaries, setLiveAttendanceSummaries] = useState<
    SanitizedSiteAttendanceSummaryRecord[]
  >([]);

  useEffect(() => {
    if (!user) return;
    const load = () => {
      void getSitePortalDeploymentSummary(user, isPreviewSession).then(setLiveSiteSummaries);
      void getSitePortalAttendanceSummaries(user, isPreviewSession, getTodayIsoDate())
        .then(setLiveAttendanceSummaries)
        .catch(() => setLiveAttendanceSummaries([]));
    };
    load();
    const u1 = subscribeDeploymentData(load);
    const u2 = subscribeMasterData(load);
    const u3 = subscribeAttendanceData(load);
    return () => {
      u1();
      u2();
      u3();
    };
  }, [user, isPreviewSession]);

  const useSample = isPreviewSession && showSampleLayoutData;
  const primarySiteId = user?.assignedSiteIds[0] ?? 'UNASSIGNED';

  const liveShiftRows: ShiftAttendanceRow[] = useMemo(() => {
    const rows: ShiftAttendanceRow[] = [];
    for (const summary of liveAttendanceSummaries) {
      for (const sh of summary.shiftBreakdown) {
        rows.push({
          shiftName: `${summary.siteName} — ${sh.shiftType}`,
          timing: sh.timing,
          sanctioned: sh.deployedCount,
          present: sh.presentCount + sh.lateCount,
          absent: sh.absentCount,
        });
      }
    }
    return rows;
  }, [liveAttendanceSummaries]);

  const counts = useMemo(() => {
    const attDeployed = liveAttendanceSummaries.reduce((s, r) => s + r.totalDeployed, 0);
    const attPresent = liveAttendanceSummaries.reduce(
      (s, r) => s + r.presentCount + r.lateCount + r.halfDayCount,
      0
    );
    const attAbsent = liveAttendanceSummaries.reduce((s, r) => s + r.absentCount, 0);

    const liveDep = liveSiteSummaries.reduce((s, r) => s + r.totalDeployed, 0);
    const liveReq = liveSiteSummaries.reduce((s, r) => s + r.totalRequired, 0);
    const liveVac = liveSiteSummaries.reduce((s, r) => s + r.totalVacant, 0);

    if (attDeployed > 0 || attPresent > 0 || attAbsent > 0) {
      return {
        totalDeployed: Math.max(liveDep, attDeployed),
        presentCount: attPresent,
        absentCount: attAbsent,
      };
    }

    if (liveReq > 0 || liveDep > 0) {
      return {
        totalDeployed: liveDep,
        presentCount: 0,
        absentCount: liveVac,
      };
    }

    if (useSample) {
      return {
        totalDeployed: 32,
        presentCount: 31,
        absentCount: 1,
      };
    }
    return {
      totalDeployed: 0,
      presentCount: 0,
      absentCount: 0,
    };
  }, [useSample, liveSiteSummaries, liveAttendanceSummaries]);

  const filteredDocs = useMemo(() => {
    const source = useSample ? SAMPLE_SITE_DOCUMENTS : [];
    return source.filter((item) => {
      const matchesFilter = docFilter === 'ALL' || item.docType === docFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.id.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.period.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [useSample, docFilter, searchQuery]);

  const paginatedDocs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredDocs.slice(start, start + pageSize);
  }, [filteredDocs, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, docFilter, useSample]);

  const handleConfirmDownload = () => {
    if (!downloadTarget) return;
    const itemTitle = downloadTarget.title;
    setDownloadTarget(null);
    setDownloadNotice(
      isFirebaseConfigured
        ? `Authorized document lookup initiated for "${itemTitle}" from Firebase Storage path site_billing/${primarySiteId}.`
        : `Development Preview Mode: "${itemTitle}" is a sample UI layout record. Connect Firebase Storage (.env) to download live PDFs.`
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            {section === 'attendance'
              ? 'Authorized Site Attendance Summary'
              : section === 'billing'
                ? 'Client Invoices & Payment Receipts'
                : section === 'reports'
                  ? 'Authorized Site Service Reports'
                  : 'Client & Site Manager Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Assigned Site Scope:{' '}
            <code className="font-mono-tabular font-semibold text-[#5C3D2E]">{primarySiteId}</code> ·
            Read-only client transparency portal
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Link
            to="/site/attendance"
            className="min-h-[42px] inline-flex items-center gap-2 rounded-lg bg-white border border-[#D4C7B8] px-4 py-2 text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
          >
            <CalendarCheck className="w-4 h-4 text-[#5C3D2E]" />
            <span>Attendance Summary</span>
          </Link>
          <Link
            to="/site/manpower"
            className="min-h-[42px] inline-flex items-center gap-2 rounded-lg bg-[#5C3D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
          >
            <Users className="w-4 h-4" />
            <span>Manpower Deployment</span>
          </Link>
        </div>
      </div>

      {downloadNotice && (
        <div className="p-4 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] text-xs text-[#4A3023] flex items-center justify-between gap-4">
          <span>{downloadNotice}</span>
          <button
            type="button"
            onClick={() => setDownloadNotice(null)}
            className="text-[#5C3D2E] font-semibold shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Site Information & PII Isolation Notice */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#F3EDE4] text-[#5C3D2E] flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-[#1F1916]">
                Site Information — {primarySiteId}
              </h2>
              <p className="mt-0.5 text-sm text-[#574B43]">
                {useSample
                  ? '[Sample] Corporate Business Park — Security & Housekeeping Deployment (3 Shifts)'
                  : 'Authorized client site record linked to your account in Firestore "sites/{siteId}".'}
              </p>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] flex items-center gap-2.5 text-xs text-[#574B43]">
            <ShieldCheck className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            <span>
              Employee Aadhaar, bank accounts, and personal salary records are strictly excluded from
              Site Portal access.
            </span>
          </div>
        </div>
      </section>

      {/* Deployed, Present & Absent Counts */}
      {section !== 'billing' && section !== 'reports' && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatMetricCard
            label="Total Deployed Employees"
            value={counts.totalDeployed}
            subtext="Sanctioned personnel assigned to site"
            icon={Users}
          />
          <StatMetricCard
            label="Present Count"
            value={counts.presentCount}
            subtext="Verified present across active shifts"
            icon={UserCheck}
          />
          <StatMetricCard
            label="Absent Count"
            value={counts.absentCount}
            subtext="Unfilled or pending reliever posts"
            icon={UserMinus}
            tone={counts.absentCount > 0 ? 'attention' : 'default'}
          />
        </section>
      )}

      {/* Authorized Shift-Wise Attendance Summary (Headcounts Only — Zero Private Employee PII) */}
      {(section === 'overview' || section === 'attendance') && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Authorized Attendance Summary
              </h2>
              <p className="text-xs text-[#574B43]">
                Shift-level turnout counts for{' '}
                <code className="font-mono-tabular">{primarySiteId}</code> (headcount aggregates
                only; private personnel records and GPS coordinates remain isolated).
              </p>
            </div>
            <Link
              to="/site/attendance"
              className="text-xs font-semibold text-[#5C3D2E] hover:underline whitespace-nowrap"
            >
              Open Full Date-Wise Turnout →
            </Link>
          </div>

          {liveShiftRows.length === 0 && !useSample ? (
            <EmptyStatePanel
              icon={CalendarCheck}
              title="No Live Attendance Summary Published Today"
              description="Once daily duty rosters or attendance records are logged for your assigned site, sanitized shift-wise present and absent counts appear here."
              actionLabel={isPreviewSession ? 'Inspect Sample Attendance Layout' : undefined}
              onAction={isPreviewSession ? () => setShowSampleLayoutData(true) : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Shift Allocation</th>
                    <th className="py-3 px-3">Shift Hours</th>
                    <th className="py-3 px-3 text-right">Deployed</th>
                    <th className="py-3 px-3 text-right">Present</th>
                    <th className="py-3 px-3 text-right">Absent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {(liveShiftRows.length > 0 ? liveShiftRows : SAMPLE_SHIFT_SUMMARY).map((shift) => (
                    <tr key={`${shift.shiftName}-${shift.timing}`} className="hover:bg-[#FAF8F5]">
                      <td className="py-3 px-3 font-medium text-[#1F1916]">{shift.shiftName}</td>
                      <td className="py-3 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                        {shift.timing}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular text-[#1F1916]">
                        {shift.sanctioned}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#166534]">
                        {shift.present}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#B45309]">
                        {shift.absent}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Recent Invoices, Payment Receipts & Downloadable Service Reports */}
      {section !== 'attendance' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Recent Invoices, Payment Receipts &amp; Service Reports
            </h2>
            <p className="text-xs text-[#574B43]">
              Authorized billing and compliance documents for site{' '}
              <code className="font-mono-tabular">{primarySiteId}</code>.
            </p>
          </div>

          <DataTableToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search invoice number, period, or report..."
            filterOptions={[
              { value: 'ALL', label: 'All Documents' },
              { value: 'Invoice', label: 'Recent Invoices' },
              { value: 'Payment Receipt', label: 'Payment Receipts' },
              { value: 'Service Report', label: 'Download Reports' },
            ]}
            activeFilter={docFilter}
            onFilterChange={setDocFilter}
          />

          {filteredDocs.length === 0 ? (
            <EmptyStatePanel
              icon={docFilter === 'Service Report' ? FileText : Receipt}
              title={
                useSample ? 'No Matching Site Documents' : 'No Site Invoices or Reports Published Yet'
              }
              description={
                useSample
                  ? 'Clear search or switch document category tabs.'
                  : 'Authorized invoices, payment receipts, and monthly service reports uploaded to Firebase Storage for your site appear here.'
              }
              actionLabel={!useSample && isPreviewSession ? 'Inspect Sample Document Table' : undefined}
              onAction={
                !useSample && isPreviewSession ? () => setShowSampleLayoutData(true) : undefined
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                      <th className="py-3 px-3">Document ID</th>
                      <th className="py-3 px-3">Type</th>
                      <th className="py-3 px-3">Description</th>
                      <th className="py-3 px-3">Period</th>
                      <th className="py-3 px-3 text-right">Summary</th>
                      <th className="py-3 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5DDD2] text-sm">
                    {paginatedDocs.map((docItem) => (
                      <tr key={docItem.id} className="hover:bg-[#FAF8F5]">
                        <td className="py-3 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                          {docItem.id}
                        </td>
                        <td className="py-3 px-3 text-xs font-medium text-[#1F1916] whitespace-nowrap">
                          {docItem.docType}
                        </td>
                        <td className="py-3 px-3 text-[#1F1916]">{docItem.title}</td>
                        <td className="py-3 px-3 text-xs text-[#574B43] whitespace-nowrap">
                          {docItem.period}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-tabular text-xs font-semibold text-[#1F1916] whitespace-nowrap">
                          {docItem.amountOrRef}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDownloadTarget(docItem)}
                            className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <PaginationControls
                currentPage={page}
                totalItems={filteredDocs.length}
                pageSize={pageSize}
                onPageChange={setPage}
              />
            </>
          )}
        </section>
      )}

      <ConfirmDialog
        open={Boolean(downloadTarget)}
        title="Download Authorized Site Document"
        description={`Request authorized download for "${downloadTarget?.title ?? ''}" (${downloadTarget?.id ?? ''})?`}
        confirmLabel="Request Download"
        onConfirm={handleConfirmDownload}
        onCancel={() => setDownloadTarget(null)}
      />
    </div>
  );
};
