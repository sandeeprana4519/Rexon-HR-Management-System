import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileWarning,
  MapPin,
  Plus,
  QrCode,
  Users,
  X,
} from 'lucide-react';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import { validateRequiredText } from '../../utils/validation';

interface FieldRecordItem {
  id: string;
  category: 'Task' | 'Assignment' | 'Site Visit' | 'Inspection';
  siteId: string;
  title: string;
  schedule: string;
  status: 'Completed' | 'Pending';
}

const SAMPLE_FIELD_RECORDS: FieldRecordItem[] = [
  {
    id: 'FO-Sample-301',
    category: 'Site Visit',
    siteId: 'SITE-101',
    title: '[Sample] Morning shift turnout & gate register verification',
    schedule: 'Today · 08:30',
    status: 'Completed',
  },
  {
    id: 'FO-Sample-302',
    category: 'Inspection',
    siteId: 'SITE-101',
    title: '[Sample] Security uniform, baton & perimeter patrol audit',
    schedule: 'Today · 10:00',
    status: 'Completed',
  },
  {
    id: 'FO-Sample-303',
    category: 'Assignment',
    siteId: 'SITE-102',
    title: '[Sample] Reliever guard post allocation — Main Lobby',
    schedule: 'Today · 14:00',
    status: 'Pending',
  },
  {
    id: 'FO-Sample-304',
    category: 'Inspection',
    siteId: 'SITE-102',
    title: '[Sample] Housekeeping checklist & lobby sanitation inspection',
    schedule: 'Today · 16:30',
    status: 'Pending',
  },
  {
    id: 'FO-Sample-305',
    category: 'Task',
    siteId: 'SITE-101',
    title: '[Sample] Night shift biometric attendance discrepancy check',
    schedule: 'Today · 21:00',
    status: 'Pending',
  },
];

interface FieldOfficerDashboardProps {
  section?: 'overview' | 'sites' | 'inspections' | 'incidents';
}

export const FieldOfficerDashboard: React.FC<FieldOfficerDashboardProps> = ({
  section = 'overview',
}) => {
  const {
    user,
    isFirebaseConfigured,
    isPreviewSession,
    showSampleLayoutData,
    setShowSampleLayoutData,
  } = useAuth();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 4;

  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [selectedSite, setSelectedSite] = useState(user?.assignedSiteIds[0] ?? 'SITE-101');
  const [reportType, setReportType] = useState('Security Inspection');
  const [remarks, setRemarks] = useState('');
  const [reportMsg, setReportMsg] = useState<string | null>(null);

  useEffect(() => {
    if (section === 'inspections') {
      setCategoryFilter('Inspection');
    } else if (section === 'sites') {
      setCategoryFilter('Site Visit');
    } else {
      setCategoryFilter('ALL');
    }
  }, [section]);

  const useSample = isPreviewSession && showSampleLayoutData;

  const stats = useMemo(() => {
    const assignedSitesCount = user?.assignedSiteIds.length ?? 0;
    if (useSample) {
      return {
        assignedSites: Math.max(assignedSitesCount, 2),
        todaysTasks: 5,
        completedTasks: 2,
        pendingTasks: 3,
        targetPercent: 40,
      };
    }
    return {
      assignedSites: assignedSitesCount,
      todaysTasks: 0,
      completedTasks: 0,
      pendingTasks: 0,
      targetPercent: 0,
    };
  }, [useSample, user]);

  const filteredRecords = useMemo(() => {
    const source = useSample ? SAMPLE_FIELD_RECORDS : [];
    return source.filter((item) => {
      const matchesCat = categoryFilter === 'ALL' || item.category === categoryFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.id.toLowerCase().includes(q) ||
        item.siteId.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    });
  }, [useSample, categoryFilter, searchQuery]);

  const paginatedRecords = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, categoryFilter, useSample]);

  const handleFieldReportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setReportMsg(null);
    const check = validateRequiredText(remarks, 'Inspection / Incident Remarks', 6, 300);
    if (!check.valid) {
      setReportMsg(check.error ?? 'Remarks required.');
      return;
    }
    setReportMsg(
      isFirebaseConfigured
        ? 'Phase 1 Foundation: Field report schema validated; photo & inspection module writes attach in Phase 2.'
        : 'Preview Mode Notice: Field report validated locally; live Firestore & Storage uploads require .env setup.'
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            {section === 'sites'
              ? 'Assigned Sites & Visit Schedule'
              : section === 'inspections'
                ? 'Security & Housekeeping Inspections'
                : section === 'incidents'
                  ? 'Attendance Issues & Incident Reports'
                  : 'Field Officer Operations Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Authorized Sites:{' '}
            <code className="font-mono-tabular font-semibold text-[#5C3D2E]">
              {user && user.assignedSiteIds.length > 0
                ? user.assignedSiteIds.join(' · ')
                : 'None Assigned'}
            </code>{' '}
            · Financial &amp; unrestricted HR records restricted
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => navigate('/field-officer/rosters')}
            className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
          >
            <CalendarClock className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            <span>Duty Rosters</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/field-officer/attendance')}
            className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
          >
            <QrCode className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            <span>Attendance &amp; QR</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/field-officer/assignments')}
            className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
          >
            <ArrowRightLeft className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            <span>Site Assignments</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/field-officer/employees')}
            className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
          >
            <Users className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            <span>Personnel</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setReportMsg(null);
              setReportModalOpen(true);
            }}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Field Inspection / Issue</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Assigned Sites"
          value={stats.assignedSites}
          subtext="Active sites under your supervision"
          icon={MapPin}
        />
        <StatMetricCard
          label="Today's Tasks"
          value={stats.todaysTasks}
          subtext="Scheduled visits, assignments & checks"
          icon={ClipboardCheck}
        />
        <StatMetricCard
          label="Completed Tasks"
          value={stats.completedTasks}
          subtext="Verified field submissions today"
          icon={CheckCircle2}
        />
        <StatMetricCard
          label="Pending Tasks"
          value={stats.pendingTasks}
          subtext="Remaining visits & inspections today"
          icon={Clock}
          tone={stats.pendingTasks > 0 ? 'attention' : 'default'}
        />
      </section>

      {/* Daily Target Progress */}
      <section className="bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div>
            <h2 className="font-display text-base font-semibold text-[#1F1916]">
              Daily Target Progress
            </h2>
            <p className="text-xs text-[#574B43]">
              Completion of assigned site visits, employee post assignments, and inspection reports
            </p>
          </div>
          <div className="font-mono-tabular text-sm font-semibold text-[#5C3D2E]">
            {stats.completedTasks} / {stats.todaysTasks} Completed ({stats.targetPercent}%)
          </div>
        </div>
        <div className="w-full h-3 bg-white border border-[#D4C7B8] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#5C3D2E] transition-transform duration-200 origin-left"
            style={{ transform: `scaleX(${stats.targetPercent / 100})` }}
          />
        </div>
      </section>

      {/* Employee Assignments, Site Visits & Inspection Reports Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="font-display text-lg font-semibold text-[#1F1916]">
            Employee Assignments, Site Visits &amp; Inspection Reports
          </h2>
          <p className="text-xs text-[#574B43]">
            Filter across today&apos;s tasks, guard assignments, site visits, and security /
            housekeeping inspections.
          </p>
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search site code or activity..."
          filterOptions={[
            { value: 'ALL', label: 'All Field Items' },
            { value: 'Assignment', label: 'Employee Assignments' },
            { value: 'Site Visit', label: 'Site Visits' },
            { value: 'Inspection', label: 'Inspection Reports' },
            { value: 'Task', label: "Today's Tasks" },
          ]}
          activeFilter={categoryFilter}
          onFilterChange={setCategoryFilter}
        />

        {filteredRecords.length === 0 ? (
          <EmptyStatePanel
            icon={Users}
            title={useSample ? 'No Matching Field Items' : 'No Field Tasks Scheduled Yet'}
            description={
              useSample
                ? 'Switch filter tabs or clear search to view sample field officer records.'
                : 'Assigned site visits, employee shift assignments, and inspection checklists for your sites will appear here.'
            }
            actionLabel={!useSample && isPreviewSession ? 'Inspect Sample Field Layout' : undefined}
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
                    <th className="py-3 px-3">Ref ID</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">Site</th>
                    <th className="py-3 px-3">Activity / Assignment</th>
                    <th className="py-3 px-3">Schedule</th>
                    <th className="py-3 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedRecords.map((item) => (
                    <tr key={item.id} className="hover:bg-[#FAF8F5] transition-colors">
                      <td className="py-3 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                        {item.id}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium text-[#1F1916] whitespace-nowrap">
                        {item.category}
                      </td>
                      <td className="py-3 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                        {item.siteId}
                      </td>
                      <td className="py-3 px-3 text-[#1F1916]">{item.title}</td>
                      <td className="py-3 px-3 font-mono-tabular text-xs text-[#7D6F65] whitespace-nowrap">
                        {item.schedule}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium whitespace-nowrap">
                        <span
                          className={
                            item.status === 'Completed' ? 'text-[#166534]' : 'text-[#B45309]'
                          }
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={page}
              totalItems={filteredRecords.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Field Inspection / Incident Validation Modal */}
      {reportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FileWarning className="w-5 h-5 text-[#5C3D2E]" />
                <h3 className="font-display text-lg font-semibold text-[#1F1916]">
                  Field Inspection &amp; Incident Form
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReportModalOpen(false)}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {reportMsg && (
              <div className="mt-4 p-3 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs text-[#4A3023]">
                {reportMsg}
              </div>
            )}

            <form onSubmit={handleFieldReportSubmit} className="mt-4 space-y-4" noValidate>
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Assigned Site
                </label>
                <select
                  value={selectedSite}
                  onChange={(e) => setSelectedSite(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                >
                  {(user && user.assignedSiteIds.length > 0
                    ? user.assignedSiteIds
                    : ['SITE-101']
                  ).map((siteId) => (
                    <option key={siteId} value={siteId}>
                      {siteId}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Report Category
                </label>
                <select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                >
                  <option value="Security Inspection">Security Inspection</option>
                  <option value="Housekeeping Inspection">Housekeeping Inspection</option>
                  <option value="Site Visit Report">Site Visit Report</option>
                  <option value="Attendance Discrepancy">Attendance Issue</option>
                  <option value="Incident / Complaint">Incident / Complaint</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Field Observations &amp; Remarks
                </label>
                <textarea
                  rows={3}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Enter turnout observations, uniform status, or incident details..."
                  maxLength={300}
                  className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReportModalOpen(false)}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  Validate Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
