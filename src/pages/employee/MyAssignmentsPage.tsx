import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Calendar,
  Clock,
  Info,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  listMyEmployeeAssignments,
  subscribeDeploymentData,
} from '../../services/firestore/assignmentService';
import { subscribeEmployeeData } from '../../services/firestore/employeeService';
import { AssignmentStatus, EmployeeAssignmentRecord } from '../../types';
import { getTodayIsoDate, isAssignmentActiveOnDate } from '../../utils/deploymentValidation';

export const MyAssignmentsPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<EmployeeAssignmentRecord[]>([]);

  const loadMyDuties = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const rows = await listMyEmployeeAssignments(user, isPreviewSession);
      setAssignments(rows);
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadMyDuties();
    const u1 = subscribeDeploymentData(() => void loadMyDuties());
    const u2 = subscribeEmployeeData(() => void loadMyDuties());
    return () => {
      u1();
      u2();
    };
  }, [loadMyDuties]);

  const today = getTodayIsoDate();

  const currentDuties = useMemo(
    () => assignments.filter((a) => isAssignmentActiveOnDate(a, today)),
    [assignments, today]
  );

  const upcomingDuties = useMemo(
    () =>
      assignments
        .filter(
          (a) =>
            (a.assignmentStatus === 'Upcoming' || a.startDate > today) &&
            a.assignmentStatus !== 'Cancelled' &&
            a.assignmentStatus !== 'Transferred' &&
            a.assignmentStatus !== 'Completed'
        )
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [assignments, today]
  );

  const historyDuties = useMemo(
    () =>
      assignments.filter(
        (a) =>
          !currentDuties.some((c) => c.assignmentId === a.assignmentId) &&
          !upcomingDuties.some((u) => u.assignmentId === a.assignmentId)
      ),
    [assignments, currentDuties, upcomingDuties]
  );

  const renderBadge = (status: AssignmentStatus) => {
    const styles: Record<AssignmentStatus, string> = {
      Active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      Upcoming: 'border-sky-200 bg-sky-50 text-sky-800',
      Transferred: 'border-amber-200 bg-amber-50 text-amber-800',
      Completed: 'border-[#D8CEC2] bg-[#FAF8F5] text-[#4A3E36]',
      Cancelled: 'border-red-200 bg-red-50 text-red-800',
    };
    return (
      <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${styles[status]}`}>
        {status}
      </span>
    );
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#1F1916]">
            My Site Assignments &amp; Duty Roster
          </h1>
          <p className="text-sm text-[#6B5E55]">
            Personal read-only record of your current assigned site, shift timings, reporting instructions, upcoming rosters, and assignment history.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-lg border border-[#E5DDD3] bg-[#FAF8F5] px-3 py-2 text-xs text-[#4A3E36] self-start sm:self-auto">
          <ShieldCheck className="h-4 w-4 text-[#5C3D2E]" />
          <span>Isolated Self-Service View</span>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[#E5DDD3] bg-white p-10 text-center text-sm text-[#6B5E55]">
          Loading your site assignments...
        </div>
      ) : (
        <>
          {/* 1. Current Active Assignment(s) */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#5C3D2E]">
              Current Active Site Assignment ({currentDuties.length})
            </h2>

            {currentDuties.length === 0 ? (
              <div className="rounded-xl border border-[#E5DDD3] bg-white p-6 text-sm text-[#6B5E55]">
                You do not have an active site duty scheduled for today ({today}). Check Upcoming Assignments below or contact your Branch HR / Field Officer.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {currentDuties.map((asn) => (
                  <div
                    key={asn.assignmentId}
                    className="rounded-xl border-2 border-[#5C3D2E]/30 bg-white p-5 space-y-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                          {asn.assignmentId}
                        </span>
                        <h3 className="text-lg font-bold text-[#1F1916]">{asn.siteName}</h3>
                        <p className="text-xs text-[#6B5E55] flex items-center gap-1 mt-0.5">
                          <Building2 className="h-3.5 w-3.5 text-[#5C3D2E]" />
                          <span>Client: {asn.clientName}</span>
                        </p>
                      </div>
                      {renderBadge(asn.assignmentStatus)}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-[#E5DDD3] bg-[#FAF8F5] p-3.5 text-xs">
                      <div>
                        <span className="text-[#6B5E55]">Service &amp; Designation</span>
                        <div className="mt-0.5 font-semibold text-[#1F1916]">
                          [{asn.serviceCategory}] {asn.designationName}
                        </div>
                        <div className="text-[#6B5E55]">{asn.serviceName}</div>
                      </div>

                      <div>
                        <span className="text-[#6B5E55]">Shift &amp; Duty Timing</span>
                        <div className="mt-0.5 font-semibold text-[#1F1916]">{asn.shift}</div>
                        <div className="font-mono-tabular text-[#4A3E36]">
                          {asn.shiftStartTime} – {asn.shiftEndTime} ({asn.dutyHours}h) · Report{' '}
                          {asn.reportingTime}
                        </div>
                      </div>

                      <div>
                        <span className="text-[#6B5E55]">Start &amp; End Dates</span>
                        <div className="mt-0.5 font-mono-tabular font-semibold text-[#1F1916]">
                          {asn.startDate} to {asn.endDate || 'Ongoing'}
                        </div>
                      </div>

                      <div>
                        <span className="text-[#6B5E55]">Weekly Off &amp; Branch</span>
                        <div className="mt-0.5 font-semibold text-[#1F1916]">{asn.weeklyOff}</div>
                        <div className="text-[#6B5E55]">{asn.branchName}</div>
                      </div>
                    </div>

                    {asn.reportingInstructions && (
                      <div className="flex items-start gap-2 rounded-lg border border-[#E5DDD3] bg-[#FAF8F5] p-3 text-xs text-[#1F1916]">
                        <Info className="h-4 w-4 text-[#5C3D2E] shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold text-[#5C3D2E]">
                            Site Reporting Instructions
                          </div>
                          <p className="mt-0.5">{asn.reportingInstructions}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 2. Upcoming Assignments */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#5C3D2E]">
              Upcoming Scheduled Assignments ({upcomingDuties.length})
            </h2>

            <div className="rounded-xl border border-[#E5DDD3] bg-white overflow-hidden">
              {upcomingDuties.length === 0 ? (
                <div className="p-6 text-sm text-[#6B5E55]">
                  No future-dated site assignments are currently scheduled for you.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#E5DDD3] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                        <th className="px-4 py-3">Assignment ID</th>
                        <th className="px-4 py-3">Client &amp; Site</th>
                        <th className="px-4 py-3">Service &amp; Designation</th>
                        <th className="px-4 py-3">Shift &amp; Reporting</th>
                        <th className="px-4 py-3">Dates</th>
                        <th className="px-4 py-3">Reporting Instructions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE9E0] text-sm">
                      {upcomingDuties.map((u) => (
                        <tr key={u.assignmentId} className="hover:bg-[#FAF8F5]/70">
                          <td className="px-4 py-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                            {u.assignmentId}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[#1F1916]">{u.siteName}</div>
                            <div className="text-xs text-[#6B5E55]">{u.clientName}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-[#1F1916]">{u.designationName}</div>
                            <div className="text-xs text-[#6B5E55]">
                              {u.serviceCategory} · {u.serviceName}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <div className="font-semibold text-[#1F1916]">{u.shift}</div>
                            <div className="font-mono-tabular text-[#6B5E55]">
                              {u.shiftStartTime}–{u.shiftEndTime} · Report {u.reportingTime}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono-tabular text-xs">
                            <div className="inline-flex items-center gap-1 text-[#1F1916]">
                              <Calendar className="h-3.5 w-3.5 text-[#5C3D2E]" />
                              <span>{u.startDate}</span>
                            </div>
                            <div className="text-[#6B5E55]">to {u.endDate}</div>
                          </td>
                          <td className="px-4 py-3 text-xs text-[#4A3E36] max-w-xs">
                            {u.reportingInstructions || 'Standard uniform & ID card reporting'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* 3. Previous Assignment History */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#5C3D2E]">
              Previous Assignment History ({historyDuties.length})
            </h2>

            <div className="rounded-xl border border-[#E5DDD3] bg-white overflow-hidden">
              {historyDuties.length === 0 ? (
                <div className="p-6 text-sm text-[#6B5E55]">
                  No completed or transferred past site assignments on record yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#E5DDD3] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                        <th className="px-4 py-3">Assignment ID</th>
                        <th className="px-4 py-3">Client &amp; Site</th>
                        <th className="px-4 py-3">Designation</th>
                        <th className="px-4 py-3">Shift</th>
                        <th className="px-4 py-3">Duty Period</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE9E0] text-sm">
                      {historyDuties.map((h) => (
                        <tr key={h.assignmentId} className="hover:bg-[#FAF8F5]/70">
                          <td className="px-4 py-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                            {h.assignmentId}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[#1F1916] flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5 text-[#5C3D2E]" />
                              <span>{h.siteName}</span>
                            </div>
                            <div className="text-xs text-[#6B5E55]">{h.clientName}</div>
                            {h.transferredToSiteName && (
                              <div className="text-[11px] text-amber-800 mt-0.5">
                                Transferred to: {h.transferredToSiteName}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-[#1F1916]">{h.designationName}</div>
                            <div className="text-xs text-[#6B5E55]">{h.serviceCategory}</div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <div className="inline-flex items-center gap-1 font-medium text-[#1F1916]">
                              <Clock className="h-3 w-3 text-[#6B5E55]" />
                              <span>{h.shift}</span>
                            </div>
                            <div className="font-mono-tabular text-[#6B5E55]">
                              {h.shiftStartTime}–{h.shiftEndTime}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono-tabular text-xs text-[#4A3E36]">
                            {h.startDate} to {h.endDate}
                          </td>
                          <td className="px-4 py-3">{renderBadge(h.assignmentStatus)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};
