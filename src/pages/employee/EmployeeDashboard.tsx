import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  Bell,
  CalendarCheck,
  Clock,
  FileText,
  LogIn,
  MapPin,
  Plus,
  QrCode,
  Wallet,
  X,
} from 'lucide-react';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import {
  listMyEmployeeAssignments,
  subscribeDeploymentData,
} from '../../services/firestore/assignmentService';
import {
  getEmployeeTodayDutyContext,
  listAttendanceRecords,
  subscribeAttendanceData,
} from '../../services/firestore/attendanceService';
import {
  ZERO_METRICS,
  fetchLivePortalMetrics,
} from '../../services/firestore/portalMetricsService';
import {
  AttendanceRecord,
  EmployeeAssignmentRecord,
  EmployeeTodayDutyContext,
} from '../../types';
import { getTodayIsoDate, isAssignmentActiveOnDate } from '../../utils/deploymentValidation';
import {
  validatePositiveAmount,
  validateRequiredText,
} from '../../utils/validation';

interface EmployeePersonalItem {
  id: string;
  category: 'Leave Request' | 'Advance Request' | 'Salary Slip';
  title: string;
  dateOrPeriod: string;
  detail: string;
  status: string;
}

const SAMPLE_EMPLOYEE_ITEMS: EmployeePersonalItem[] = [
  {
    id: 'SLP-Sample-501',
    category: 'Salary Slip',
    title: '[Sample] Monthly Duty Payslip & PF/ESIC Statement',
    dateOrPeriod: 'Prior Month Cycle',
    detail: '26 Duty Days · Verified',
    status: 'Available',
  },
  {
    id: 'LVE-Sample-502',
    category: 'Leave Request',
    title: '[Sample] Casual Leave Application (2 Days)',
    dateOrPeriod: 'Submitted 4 days ago',
    detail: 'Personal family visit',
    status: 'Approved',
  },
  {
    id: 'ADV-Sample-503',
    category: 'Advance Request',
    title: '[Sample] Mid-month Salary Advance Application',
    dateOrPeriod: 'Submitted 2 days ago',
    detail: '₹3,000 requested',
    status: 'Pending HR Review',
  },
];

interface EmployeeDashboardProps {
  section?: 'overview' | 'attendance' | 'requests' | 'documents';
}

export const EmployeeDashboard: React.FC<EmployeeDashboardProps> = ({
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
  const [liveCounts, setLiveCounts] = useState(ZERO_METRICS);
  const [dutyContext, setDutyContext] = useState<EmployeeTodayDutyContext | null>(null);
  const [myAttendanceRecords, setMyAttendanceRecords] = useState<AttendanceRecord[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 4;

  const [requestModalType, setRequestModalType] = useState<'leave' | 'advance' | null>(null);
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveDays, setLeaveDays] = useState('1');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceReason, setAdvanceReason] = useState('');
  const [requestFormMsg, setRequestFormMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !isFirebaseConfigured || isPreviewSession) {
      setLiveCounts(ZERO_METRICS);
      return;
    }
    void fetchLivePortalMetrics(user).then(setLiveCounts);
  }, [user, isFirebaseConfigured, isPreviewSession]);

  useEffect(() => {
    if (section === 'requests') {
      setActiveTab('Leave Request');
    } else if (section === 'documents') {
      setActiveTab('Salary Slip');
    } else {
      setActiveTab('ALL');
    }
  }, [section]);

  const [myAssignments, setMyAssignments] = useState<EmployeeAssignmentRecord[]>([]);

  useEffect(() => {
    if (!user) return;
    const load = () => {
      void listMyEmployeeAssignments(user, isPreviewSession).then(setMyAssignments);
      void getEmployeeTodayDutyContext(user, isPreviewSession)
        .then(setDutyContext)
        .catch(() => setDutyContext(null));
      void listAttendanceRecords(user, isPreviewSession)
        .then(setMyAttendanceRecords)
        .catch(() => setMyAttendanceRecords([]));
    };
    load();
    const unsubDeploy = subscribeDeploymentData(load);
    const unsubAtt = subscribeAttendanceData(load);
    return () => {
      unsubDeploy();
      unsubAtt();
    };
  }, [user, isPreviewSession]);

  const useSample = isPreviewSession && showSampleLayoutData;
  const activeDutyToday = useMemo(() => {
    const today = getTodayIsoDate();
    return myAssignments.find((a) => isAssignmentActiveOnDate(a, today));
  }, [myAssignments]);

  const activeRoster = dutyContext?.activeRoster ?? null;
  const activeAttendance =
    dutyContext?.openOvernightAttendance ?? dutyContext?.todayAttendance ?? null;

  const currentSite =
    activeRoster?.siteName ??
    activeDutyToday?.siteName ??
    user?.assignedSiteIds[0] ??
    'Not Assigned';

  const formattedCheckIn = activeAttendance?.checkInAt
    ? new Date(activeAttendance.checkInAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const formattedCheckOut = activeAttendance?.checkOutAt
    ? new Date(activeAttendance.checkOutAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const summaryStats = useMemo(() => {
    const currentMonthPrefix = getTodayIsoDate().slice(0, 7);
    const monthPresentDays = myAttendanceRecords.filter(
      (r) =>
        r.attendanceDate.startsWith(currentMonthPrefix) &&
        (r.status === 'Present' || r.status === 'Late' || r.status === 'Half Day')
    ).length;

    if (useSample && myAttendanceRecords.length === 0) {
      return {
        presentDays: 22,
        leaveRequests: 1,
        advanceRequests: 1,
        salarySlips: 1,
      };
    }
    return {
      presentDays: monthPresentDays,
      leaveRequests: liveCounts.leaveRequestsCount,
      advanceRequests: liveCounts.advanceRequestsCount,
      salarySlips: 0,
    };
  }, [useSample, myAttendanceRecords, liveCounts]);

  const filteredItems = useMemo(() => {
    const source = useSample ? SAMPLE_EMPLOYEE_ITEMS : [];
    return source.filter((item) => {
      const matchesTab = activeTab === 'ALL' || item.category === activeTab;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.id.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q);
      return matchesTab && matchesSearch;
    });
  }, [useSample, activeTab, searchQuery]);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, activeTab, useSample]);

  const handleRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setRequestFormMsg(null);

    if (requestModalType === 'leave') {
      const daysCheck = validatePositiveAmount(leaveDays, 30);
      if (!daysCheck.valid) {
        setRequestFormMsg('Enter a valid number of leave days (1 to 30).');
        return;
      }
      const reasonCheck = validateRequiredText(leaveReason, 'Leave Reason', 5, 250);
      if (!reasonCheck.valid) {
        setRequestFormMsg(reasonCheck.error ?? 'Reason required.');
        return;
      }
    } else if (requestModalType === 'advance') {
      const amtCheck = validatePositiveAmount(advanceAmount, 50000);
      if (!amtCheck.valid) {
        setRequestFormMsg(amtCheck.error ?? 'Invalid advance amount.');
        return;
      }
      const reasonCheck = validateRequiredText(advanceReason, 'Advance Reason', 5, 250);
      if (!reasonCheck.valid) {
        setRequestFormMsg(reasonCheck.error ?? 'Reason required.');
        return;
      }
    }

    setRequestFormMsg(
      isFirebaseConfigured
        ? 'Request payload validated against Firestore schema; full Phase 2 HR request module will persist submissions.'
        : 'Preview Mode Notice: Request validated locally; live Firestore writes are inactive until .env is configured.'
    );
  };

  if (!user) return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            {section === 'attendance'
              ? 'My Duty Roster & Attendance'
              : section === 'requests'
                ? 'Leave & Salary Advance Requests'
                : section === 'documents'
                  ? 'Salary Slips & Authorized Documents'
                  : 'Employee Self-Service Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Employee ID:{' '}
            <code className="font-mono-tabular font-semibold text-[#5C3D2E]">{user.uid}</code> ·
            Isolated personal workspace
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRequestFormMsg(null);
              setRequestModalType('leave');
            }}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5 text-[#5C3D2E]" />
            <span>Request Leave</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setRequestFormMsg(null);
              setRequestModalType('advance');
            }}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>Request Advance</span>
          </button>
        </div>
      </div>

      {dutyContext && dutyContext.unreadNotificationsCount > 0 && (
        <div className="p-4 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] text-xs text-[#4A3023] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#5C3D2E] shrink-0" />
            <span>
              You have <strong>{dutyContext.unreadNotificationsCount}</strong> unread roster or
              attendance notification{dutyContext.unreadNotificationsCount === 1 ? '' : 's'}.
            </span>
          </div>
          <Link
            to="/employee/attendance"
            className="text-[#5C3D2E] font-semibold whitespace-nowrap shrink-0 hover:underline"
          >
            View in Attendance
          </Link>
        </div>
      )}

      {/* Employee Profile, Current Site, Today's Duty & Check-In / Check-Out */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Profile, Site & Duty Assignment Card */}
        <section className="lg:col-span-7 bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-[#7D6F65]">Verified Personnel Profile</span>
              <h2 className="mt-0.5 font-display text-xl font-bold text-[#1F1916]">
                {user.fullName}
              </h2>
              <p className="mt-1 text-xs text-[#574B43]">
                Employee ID <code className="font-mono-tabular text-[#5C3D2E]">{user.uid}</code> ·
                Branch <code className="font-mono-tabular">{user.branchId}</code>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/employee/assignments"
                className="min-h-[38px] inline-flex items-center px-3 py-1.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
              >
                My Assignments
              </Link>
              <Link
                to="/employee/my-record"
                className="min-h-[38px] inline-flex items-center px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
              >
                My HR Profile
              </Link>
              <Link
                to="/employee/profile"
                className="min-h-[38px] inline-flex items-center px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
              >
                Account Settings
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-[#E5DDD2]">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#7D6F65]">
                <MapPin className="w-3.5 h-3.5 text-[#5C3D2E]" />
                <span>Current Site Assignment</span>
              </div>
              <p className="mt-1 font-mono-tabular text-sm font-semibold text-[#1F1916]">
                {currentSite}
              </p>
              <p className="text-xs text-[#574B43]">
                {activeDutyToday
                  ? `${activeDutyToday.clientName} · ${activeDutyToday.designationName}`
                  : useSample
                    ? '[Sample] Main Gate & Access Control Post'
                    : 'View full assignment history under My Assignments'}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#7D6F65]">
                <Clock className="w-3.5 h-3.5 text-[#5C3D2E]" />
                <span>Today&apos;s Duty Roster</span>
              </div>
              <p className="mt-1 font-mono-tabular text-sm font-semibold text-[#1F1916]">
                {activeRoster
                  ? `${activeRoster.shiftType} (${activeRoster.dutyStartTime}–${activeRoster.dutyEndTime}${activeRoster.crossesMidnight ? ' +1d' : ''})`
                  : activeDutyToday
                    ? `${activeDutyToday.shift} (${activeDutyToday.shiftStartTime}–${activeDutyToday.shiftEndTime})`
                    : useSample
                      ? 'Shift A · 06:00 – 14:00'
                      : 'No Active Shift Today'}
              </p>
              <p className="text-xs text-[#574B43]">
                {activeRoster
                  ? `Report ${activeRoster.reportingTime} · Roster ${activeRoster.rosterId}`
                  : activeDutyToday
                    ? `Report ${activeDutyToday.reportingTime} · Off: ${activeDutyToday.weeklyOff}`
                    : useSample
                      ? '[Sample] Reporting to Field Officer'
                      : 'Standard shift roster'}
              </p>
            </div>
          </div>
        </section>

        {/* Check-In / Check-Out Action Card */}
        <section className="lg:col-span-5 bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-[#1F1916]">
                GPS &amp; Shift QR Attendance
              </h2>
              <BadgeCheck className="w-5 h-5 text-[#5C3D2E]" />
            </div>
            <p className="mt-1 text-xs text-[#574B43]">
              Verify duty arrival and departure via one-shot site geofence GPS or rotating Shift QR.
            </p>
          </div>

          <div className="bg-white border border-[#E5DDD2] rounded-lg p-3.5 grid grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-[#7D6F65] block">Check-In</span>
              <span className="font-mono-tabular text-sm font-semibold text-[#1F1916]">
                {formattedCheckIn ?? '— : —'}
              </span>
            </div>
            <div>
              <span className="text-[#7D6F65] block">Check-Out</span>
              <span className="font-mono-tabular text-sm font-semibold text-[#1F1916]">
                {formattedCheckOut ?? '— : —'}
              </span>
            </div>
            <div>
              <span className="text-[#7D6F65] block">Status</span>
              <span className="font-mono-tabular text-sm font-semibold text-[#5C3D2E]">
                {activeAttendance?.status ?? 'Not Marked'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => navigate('/employee/attendance')}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
            >
              <LogIn className="w-4 h-4 shrink-0" />
              <span>
                {activeAttendance?.checkInAt && !activeAttendance?.checkOutAt
                  ? 'Proceed to Check-Out'
                  : 'Open GPS Check-In'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => navigate('/employee/attendance')}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#FAF8F5] transition-colors whitespace-nowrap"
            >
              <QrCode className="w-4 h-4 text-[#5C3D2E] shrink-0" />
              <span>Shift QR / History</span>
            </button>
          </div>
        </section>
      </div>

      {/* Attendance, Leave, Advance & Salary Slip Summary Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMetricCard
          label="Attendance Summary"
          value={`${summaryStats.presentDays} Days`}
          subtext="Verified duty attendance this cycle"
          icon={CalendarCheck}
        />
        <StatMetricCard
          label="Leave Requests"
          value={summaryStats.leaveRequests}
          subtext="Submitted personal leave applications"
          icon={Clock}
        />
        <StatMetricCard
          label="Advance Requests"
          value={summaryStats.advanceRequests}
          subtext="Submitted salary advance requests"
          icon={Wallet}
        />
        <StatMetricCard
          label="Salary Slips"
          value={summaryStats.salarySlips}
          subtext="Authorized monthly payslips"
          icon={FileText}
        />
      </section>

      {/* Personal Leave, Advance & Salary Slips Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="font-display text-lg font-semibold text-[#1F1916]">
            My Requests, Salary Slips &amp; Authorized Documents
          </h2>
          <p className="text-xs text-[#574B43]">
            Strictly scoped to your Employee UID (<code className="font-mono-tabular">{user.uid}</code>
            ); other employees&apos; records are inaccessible.
          </p>
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search payslips, leave, or advances..."
          filterOptions={[
            { value: 'ALL', label: 'All Records' },
            { value: 'Leave Request', label: 'Leave Requests' },
            { value: 'Advance Request', label: 'Advance Requests' },
            { value: 'Salary Slip', label: 'Salary Slips' },
          ]}
          activeFilter={activeTab}
          onFilterChange={setActiveTab}
        />

        {filteredItems.length === 0 ? (
          <EmptyStatePanel
            icon={FileText}
            title={useSample ? 'No Matching Personal Records' : 'No Personal Slips or Requests Yet'}
            description={
              useSample
                ? 'Switch tabs or clear search to view sample employee self-service items.'
                : 'Your verified attendance logs, leave applications, salary advance statuses, and monthly salary slips appear here.'
            }
            actionLabel={!useSample && isPreviewSession ? 'Inspect Sample Employee Layout' : undefined}
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
                    <th className="py-3 px-3">Description</th>
                    <th className="py-3 px-3">Cycle / Date</th>
                    <th className="py-3 px-3">Details</th>
                    <th className="py-3 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedItems.map((item) => (
                    <tr key={item.id} className="hover:bg-[#FAF8F5]">
                      <td className="py-3 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                        {item.id}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium text-[#1F1916] whitespace-nowrap">
                        {item.category}
                      </td>
                      <td className="py-3 px-3 text-[#1F1916]">{item.title}</td>
                      <td className="py-3 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                        {item.dateOrPeriod}
                      </td>
                      <td className="py-3 px-3 text-xs text-[#574B43]">{item.detail}</td>
                      <td className="py-3 px-3 text-xs font-medium whitespace-nowrap">
                        <span
                          className={
                            item.status === 'Approved' || item.status === 'Available'
                              ? 'text-[#166534]'
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
              totalItems={filteredItems.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Leave / Advance Request Modal */}
      {requestModalType && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-lg font-semibold text-[#1F1916]">
                {requestModalType === 'leave'
                  ? 'Submit Leave Request'
                  : 'Submit Salary Advance Request'}
              </h3>
              <button
                type="button"
                onClick={() => setRequestModalType(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {requestFormMsg && (
              <div className="mt-4 p-3 rounded-lg bg-[#F3EDE4] border border-[#D4C7B8] text-xs text-[#4A3023]">
                {requestFormMsg}
              </div>
            )}

            <form onSubmit={handleRequestSubmit} className="mt-4 space-y-4" noValidate>
              {requestModalType === 'leave' ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Number of Days
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={leaveDays}
                      onChange={(e) => setLeaveDays(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Reason for Leave
                    </label>
                    <textarea
                      rows={3}
                      value={leaveReason}
                      onChange={(e) => setLeaveReason(e.target.value)}
                      placeholder="Provide dates and reason for HR verification..."
                      maxLength={250}
                      className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Requested Advance Amount (₹)
                    </label>
                    <input
                      type="number"
                      min={100}
                      max={50000}
                      value={advanceAmount}
                      onChange={(e) => setAdvanceAmount(e.target.value)}
                      placeholder="e.g. 3000"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Reason for Advance
                    </label>
                    <textarea
                      rows={3}
                      value={advanceReason}
                      onChange={(e) => setAdvanceReason(e.target.value)}
                      placeholder="Explain reason for mid-cycle salary advance..."
                      maxLength={250}
                      className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                </>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRequestModalType(null)}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
