import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRightLeft,
  CalendarClock,
  Camera,
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
import { CameraCaptureModal, CapturedAttendancePhoto } from '../../components/CameraCaptureModal';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  listAttendanceExceptionReports,
  listAttendanceRecords,
  listDutyRosters,
  submitFieldOfficerExceptionReport,
  subscribeAttendanceData,
  uploadAttendanceVerificationPhoto,
} from '../../services/firestore/attendanceService';
import { listEmployees, subscribeEmployeeData } from '../../services/firestore/employeeService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import { listSites, subscribeMasterData } from '../../services/firestore/masterDataService';
import {
  AttendanceExceptionReport,
  AttendanceRecord,
  DutyRosterRecord,
  EmployeeRecord,
  FIELD_OFFICER_EXCEPTION_TYPES,
  FieldOfficerExceptionType,
  ROSTER_SHIFT_TYPES,
  SiteRecord,
} from '../../types';
import { formatIstTimeOnly, getTodayIstIsoDate } from '../../utils/attendanceValidation';

interface FieldStreamItem {
  id: string;
  category: 'Roster' | 'Attendance' | 'Field Report';
  siteId: string;
  siteName: string;
  title: string;
  schedule: string;
  status: string;
}

interface FieldOfficerDashboardProps {
  section?: 'overview' | 'sites' | 'inspections' | 'incidents';
}

export const FieldOfficerDashboard: React.FC<FieldOfficerDashboardProps> = ({
  section = 'overview',
}) => {
  const { user, isPreviewSession } = useAuth();
  const navigate = useNavigate();
  const today = useMemo(() => getTodayIstIsoDate(), []);

  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [rosters, setRosters] = useState<DutyRosterRecord[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [foReports, setFoReports] = useState<AttendanceExceptionReport[]>([]);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 6;

  // Submit Field Exception / Site Visit Report Modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [selectedSite, setSelectedSite] = useState('');
  const [reportType, setReportType] = useState<FieldOfficerExceptionType>('Site Visit Report');
  const [reportDate, setReportDate] = useState(today);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedShiftType, setSelectedShiftType] = useState('Day Shift');
  const [summary, setSummary] = useState('');
  const [remarks, setRemarks] = useState('');
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedAttendancePhoto | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const loadFieldData = useCallback(async () => {
    if (!user) return;
    try {
      const [siteList, empList, rosterList, attList, reportList] = await Promise.all([
        listSites(user, isPreviewSession).catch(() => []),
        listEmployees(user, isPreviewSession).catch(() => []),
        listDutyRosters(user, isPreviewSession).catch(() => []),
        listAttendanceRecords(user, isPreviewSession).catch(() => []),
        listAttendanceExceptionReports(user, isPreviewSession).catch(() => []),
      ]);
      const assignedSet = new Set(user.assignedSiteIds || []);
      const filteredSites = siteList.filter(
        (s) => !s.isArchived && (user.role === 'admin' || assignedSet.has(s.siteId))
      );
      setSites(filteredSites);
      setEmployees(empList.filter((e) => !e.isDeleted));
      setRosters(rosterList);
      setAttendanceRecords(attList);
      setFoReports(reportList);
      setSelectedSite((prev) => prev || filteredSites[0]?.siteId || user.assignedSiteIds[0] || '');
    } catch (err) {
      setBanner({ type: 'error', text: formatServiceErrorMessage(err) });
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadFieldData();
    const u1 = subscribeAttendanceData(() => void loadFieldData());
    const u2 = subscribeMasterData(() => void loadFieldData());
    const u3 = subscribeEmployeeData(() => void loadFieldData());
    return () => {
      u1();
      u2();
      u3();
    };
  }, [loadFieldData]);

  useEffect(() => {
    if (section === 'inspections' || section === 'incidents') {
      setCategoryFilter('Field Report');
    } else if (section === 'sites') {
      setCategoryFilter('Roster');
    } else {
      setCategoryFilter('ALL');
    }
  }, [section]);

  const stats = useMemo(() => {
    const assignedSitesCount = sites.length || (user?.assignedSiteIds.length ?? 0);
    const todayRosters = rosters.filter((r) => r.dutyDate === today && r.status !== 'Cancelled');
    const todayAttendance = attendanceRecords.filter((a) => a.attendanceDate === today);
    const presentCount = todayAttendance.filter(
      (a) =>
        a.status === 'Present' ||
        a.status === 'Late' ||
        a.status === 'Half Day' ||
        a.status === 'On Duty'
    ).length;
    const pendingIssues =
      foReports.filter((r) => r.status === 'Pending HR Review').length +
      todayAttendance.filter((a) => Boolean(a.checkInAt) && !a.checkOutAt).length;
    const targetPercent =
      todayRosters.length > 0
        ? Math.min(100, Math.round((presentCount / todayRosters.length) * 100))
        : foReports.length > 0
          ? 100
          : 0;
    return {
      assignedSites: assignedSitesCount,
      todaysRostered: todayRosters.length,
      checkedInToday: presentCount,
      openAlerts: pendingIssues,
      targetPercent,
    };
  }, [sites.length, user, rosters, attendanceRecords, foReports, today]);

  const streamItems = useMemo<FieldStreamItem[]>(() => {
    const items: FieldStreamItem[] = [];

    for (const rep of foReports) {
      items.push({
        id: rep.exceptionId,
        category: 'Field Report',
        siteId: rep.siteId,
        siteName: rep.siteName,
        title: `${rep.reportType}: ${rep.summary}${rep.employeeName ? ` (${rep.employeeName})` : ''}`,
        schedule: `${rep.attendanceDate} · ${rep.shiftType}`,
        status: rep.status,
      });
    }

    for (const att of attendanceRecords.slice(0, 25)) {
      items.push({
        id: att.attendanceId,
        category: 'Attendance',
        siteId: att.siteId,
        siteName: att.siteName,
        title: `${att.employeeName} (${att.designationName}) · In ${formatIstTimeOnly(att.checkInAt)} / Out ${formatIstTimeOnly(att.checkOutAt)}`,
        schedule: `${att.attendanceDate} · ${att.shiftType}`,
        status: `${att.status} · ${att.isVerifiedByHr ? 'HR Verified' : 'Pending HR'}`,
      });
    }

    for (const ros of rosters.filter((r) => r.dutyDate >= today && r.status !== 'Cancelled').slice(0, 25)) {
      items.push({
        id: ros.rosterId,
        category: 'Roster',
        siteId: ros.siteId,
        siteName: ros.siteName,
        title: `${ros.employeeName} · ${ros.designationName} (${ros.serviceCategory})`,
        schedule: `${ros.dutyDate} · ${ros.shiftType} (${ros.dutyStartTime}–${ros.dutyEndTime})`,
        status: ros.status,
      });
    }

    return items;
  }, [foReports, attendanceRecords, rosters, today]);

  const filteredRecords = useMemo(() => {
    return streamItems.filter((item) => {
      const matchesCat = categoryFilter === 'ALL' || item.category === categoryFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.id.toLowerCase().includes(q) ||
        item.siteId.toLowerCase().includes(q) ||
        item.siteName.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    });
  }, [streamItems, categoryFilter, searchQuery]);

  const paginatedRecords = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, categoryFilter]);

  const handleFieldReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setReportError(null);

    if (!selectedSite) {
      setReportError('Select an assigned site before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      let photoUrl = '';
      let photoStoragePath = '';
      const siteRecord = sites.find((s) => s.siteId === selectedSite);

      if (capturedPhoto) {
        const uploaded = await uploadAttendanceVerificationPhoto(
          user,
          isPreviewSession,
          capturedPhoto.file,
          {
            branchId: siteRecord?.branchId || user.branchId,
            employeeId: selectedEmployeeId || user.uid,
            siteId: selectedSite,
            photoType: 'field_report',
            cameraFacing: capturedPhoto.cameraFacing,
          }
        );
        photoUrl = uploaded.previewUrl;
        photoStoragePath = uploaded.storagePath;
      }

      const created = await submitFieldOfficerExceptionReport(user, isPreviewSession, {
        reportType,
        siteId: selectedSite,
        attendanceDate: reportDate,
        employeeId: selectedEmployeeId || undefined,
        shiftType: selectedShiftType,
        summary,
        remarks,
        photoUrl,
        photoStoragePath,
      });

      setReportModalOpen(false);
      setSummary('');
      setRemarks('');
      setSelectedEmployeeId('');
      setCapturedPhoto(null);
      setBanner({
        type: 'success',
        text: `Field report ${created.exceptionId} (${created.reportType}) submitted to HR Verification Queue.`,
      });
    } catch (err) {
      setReportError(formatServiceErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            {section === 'sites'
              ? 'Assigned Sites & Duty Roster Turnout'
              : section === 'inspections'
                ? 'Site Visit & Turnout Verification Reports'
                : section === 'incidents'
                  ? 'Missing Attendance & Replacement Reports'
                  : 'Field Officer Operations Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Authorized Sites:{' '}
            <code className="font-mono-tabular font-semibold text-[#5C3D2E]">
              {user && user.assignedSiteIds.length > 0
                ? user.assignedSiteIds.join(' · ')
                : sites.length > 0
                  ? `${sites.length} Active Sites`
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
              setReportError(null);
              setSelectedSite(sites[0]?.siteId || user?.assignedSiteIds[0] || '');
              setReportDate(today);
              setReportModalOpen(true);
            }}
            className="min-h-[48px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Log Field Attendance Report</span>
          </button>
        </div>
      </div>

      {banner && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-center justify-between gap-4 ${
            banner.type === 'error'
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
              : 'bg-[#F3EDE4] border-[#D4C7B8] text-[#4A3023]'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Assigned Sites"
          value={stats.assignedSites}
          subtext="Active sites under your supervision"
          icon={MapPin}
        />
        <StatMetricCard
          label="Today's Rostered Posts"
          value={stats.todaysRostered}
          subtext="Scheduled shifts on assigned sites today"
          icon={ClipboardCheck}
        />
        <StatMetricCard
          label="Checked-In Today"
          value={stats.checkedInToday}
          subtext="Present / On-Duty personnel today"
          icon={CheckCircle2}
        />
        <StatMetricCard
          label="Open Issues & Missing Out"
          value={stats.openAlerts}
          subtext="Pending FO reports & open punches"
          icon={Clock}
          tone={stats.openAlerts > 0 ? 'attention' : 'default'}
        />
      </section>

      {/* Daily Turnout Progress */}
      <section className="bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div>
            <h2 className="font-display text-base font-semibold text-[#1F1916]">
              Today&apos;s Assigned Site Turnout Coverage
            </h2>
            <p className="text-xs text-[#574B43]">
              Ratio of checked-in guards and workforce personnel against today&apos;s published site
              rosters
            </p>
          </div>
          <div className="font-mono-tabular text-sm font-semibold text-[#5C3D2E]">
            {stats.checkedInToday} / {stats.todaysRostered} Checked-In ({stats.targetPercent}%)
          </div>
        </div>
        <div className="w-full h-3 bg-white border border-[#D4C7B8] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#5C3D2E] transition-transform duration-200 origin-left"
            style={{ transform: `scaleX(${stats.targetPercent / 100})` }}
          />
        </div>
      </section>

      {/* Live Stream of Site Rosters, Attendance & Field Reports */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="font-display text-lg font-semibold text-[#1F1916]">
            Assigned Site Rosters, Live Attendance &amp; Field Reports
          </h2>
          <p className="text-xs text-[#574B43]">
            Monitor guard check-ins, missing check-outs, replacement requirements, and HR resolution
            notes across your assigned sites.
          </p>
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search site, employee, roster ID, or report..."
          filterOptions={[
            { value: 'ALL', label: 'All Activity' },
            { value: 'Field Report', label: 'Field Reports' },
            { value: 'Attendance', label: 'Attendance Logs' },
            { value: 'Roster', label: 'Scheduled Rosters' },
          ]}
          activeFilter={categoryFilter}
          onFilterChange={setCategoryFilter}
        />

        {filteredRecords.length === 0 ? (
          <EmptyStatePanel
            icon={Users}
            title="No Field Attendance Items Found"
            description="Scheduled duty rosters, employee punches, and your submitted site visit / missing attendance reports for assigned sites appear here."
            actionLabel="Log Field Attendance Report"
            onAction={() => {
              setReportError(null);
              setReportModalOpen(true);
            }}
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
                    <th className="py-3 px-3">Details</th>
                    <th className="py-3 px-3">Date &amp; Shift</th>
                    <th className="py-3 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedRecords.map((item) => (
                    <tr key={`${item.category}-${item.id}`} className="hover:bg-[#FAF8F5] transition-colors">
                      <td className="py-3 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                        {item.id}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium text-[#1F1916] whitespace-nowrap">
                        {item.category}
                      </td>
                      <td className="py-3 px-3 text-xs text-[#574B43]">
                        <div className="font-medium text-[#1F1916]">{item.siteName}</div>
                        <div className="font-mono-tabular text-[11px] text-[#7D6F65]">
                          {item.siteId}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-[#1F1916]">{item.title}</td>
                      <td className="py-3 px-3 font-mono-tabular text-xs text-[#7D6F65] whitespace-nowrap">
                        {item.schedule}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium whitespace-nowrap">
                        <span
                          className={
                            item.status.includes('Resolved') ||
                            item.status.includes('Verified') ||
                            item.status === 'Scheduled'
                              ? 'text-[#166534]'
                              : item.status.includes('Rejected')
                                ? 'text-[#B91C1C]'
                                : 'text-[#B45309]'
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

      {/* Submit Field Attendance / Exception Report Modal */}
      {reportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-lg my-8">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E5DDD2]">
              <div className="flex items-center gap-2.5">
                <FileWarning className="w-5 h-5 text-[#5C3D2E] shrink-0" />
                <div>
                  <h3 className="font-display text-lg font-semibold text-[#1F1916]">
                    Log Field Attendance / Site Visit Report
                  </h3>
                  <p className="text-xs text-[#574B43]">
                    Routes directly to Branch HR Verification Queue with audit logging.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReportModalOpen(false)}
                className="min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {reportError && (
              <div className="mt-4 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {reportError}
              </div>
            )}

            <form onSubmit={(e) => void handleFieldReportSubmit(e)} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Assigned Site
                  </label>
                  <select
                    value={selectedSite}
                    onChange={(e) => setSelectedSite(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    required
                  >
                    <option value="">Select Site</option>
                    {sites.map((s) => (
                      <option key={s.siteId} value={s.siteId}>
                        {s.siteName} ({s.siteId})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Report Type
                  </label>
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value as FieldOfficerExceptionType)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    {FIELD_OFFICER_EXCEPTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Date</label>
                  <input
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-xs font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">Shift</label>
                  <select
                    value={selectedShiftType}
                    onChange={(e) => setSelectedShiftType(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="All Shifts">All Shifts</option>
                    {ROSTER_SHIFT_TYPES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Personnel (Optional)
                  </label>
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  >
                    <option value="">Site-wide / General</option>
                    {employees.map((emp) => (
                      <option key={emp.employeeId} value={emp.employeeId}>
                        {emp.fullName} ({emp.employeeId})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Report Headline / Summary
                </label>
                <input
                  type="text"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="e.g. Night shift guard reliever needed at Gate 2"
                  maxLength={150}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Detailed Field Observations
                </label>
                <textarea
                  rows={3}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Enter turnout count, missing punch explanation, uniform check, or replacement justification..."
                  maxLength={380}
                  className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg"
                  required
                />
              </div>

              <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {capturedPhoto ? (
                    <img
                      src={capturedPhoto.previewDataUrl}
                      alt="Captured field verification preview"
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-lg object-cover border border-[#D4C7B8]"
                    />
                  ) : null}
                  <div className="text-xs">
                    <div className="font-semibold text-[#1F1916]">
                      {capturedPhoto ? 'Site Photo Attached' : 'Supporting Site Photo (Optional)'}
                    </div>
                    <div className="text-[#574B43]">
                      {capturedPhoto
                        ? `Captured (${capturedPhoto.cameraFacing === 'environment' ? 'Rear' : 'Front'} camera)`
                        : 'Capture gate register or post turnout photo'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {capturedPhoto && (
                    <button
                      type="button"
                      onClick={() => setCapturedPhoto(null)}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#B91C1C]"
                    >
                      Remove
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setCameraOpen(true)}
                    className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] whitespace-nowrap"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{capturedPhoto ? 'Retake Photo' : 'Capture Photo'}</span>
                  </button>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReportModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit to HR'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CameraCaptureModal
        isOpen={cameraOpen}
        title="Capture Field Site Photo"
        subtitle="Capture site turnout, post inspection, or attendance verification evidence."
        defaultFacing="environment"
        onClose={() => setCameraOpen(false)}
        onCapture={(cap) => {
          setCapturedPhoto(cap);
          setCameraOpen(false);
        }}
      />
    </div>
  );
};
