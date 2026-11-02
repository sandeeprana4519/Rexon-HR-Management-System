import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  Eye,
  Lock,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { DataTableToolbar } from '../../components/DataTableToolbar';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { PaginationControls } from '../../components/PaginationControls';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import { listAuditLogs, subscribeMasterData } from '../../services/firestore/masterDataService';
import { AuditLogRecord, AuditModuleName } from '../../types';

const AUDIT_MODULES: AuditModuleName[] = [
  'Branch',
  'HR',
  'Client',
  'Site',
  'Employee',
  'SiteService',
  'Service',
  'Designation',
  'Permissions',
  'Approvals',
];

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const AuditLogsPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();

  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [selectedLog, setSelectedLog] = useState<AuditLogRecord | null>(null);

  const loadLogs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const list = await listAuditLogs(user, isPreviewSession);
      setLogs(list);
    } catch (err) {
      setErrorMsg(formatServiceErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadLogs();
    return subscribeMasterData(() => {
      void loadLogs();
    });
  }, [loadLogs]);

  const kpis = useMemo(() => {
    const adminActions = logs.filter((l) => l.role === 'admin').length;
    const hrActions = logs.filter((l) => l.role === 'hr').length;
    const permissionAndApprovals = logs.filter(
      (l) => l.module === 'Permissions' || l.module === 'Approvals'
    ).length;
    return {
      total: logs.length,
      adminActions,
      hrActions,
      permissionAndApprovals,
    };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (moduleFilter !== 'ALL' && log.module !== moduleFilter) return false;
      if (roleFilter !== 'ALL' && log.role !== roleFilter) return false;

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        log.logId.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.module.toLowerCase().includes(q) ||
        log.recordId.toLowerCase().includes(q) ||
        log.performedBy.toLowerCase().includes(q) ||
        log.branchId.toLowerCase().includes(q) ||
        log.summary.toLowerCase().includes(q)
      );
    });
  }, [logs, moduleFilter, roleFilter, searchQuery]);

  const paginatedLogs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredLogs.slice(start, start + pageSize);
  }, [filteredLogs, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, moduleFilter, roleFilter]);

  const handleDownloadCsv = () => {
    const headers = [
      'Log ID',
      'Action',
      'Module',
      'Record ID',
      'Performed By',
      'Role',
      'Branch ID',
      'Timestamp',
      'Summary',
    ];
    const escapeCsv = (val: string) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const rows = filteredLogs.map((l) =>
      [
        l.logId,
        l.action,
        l.module,
        l.recordId,
        l.performedBy,
        l.role,
        l.branchId,
        l.timestamp,
        l.summary,
      ]
        .map(escapeCsv)
        .join(',')
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rexon-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (user?.role !== 'admin') {
    return (
      <EmptyStatePanel
        icon={Lock}
        title="Administrator Access Required"
        description="Immutable Audit Logs can only be inspected by verified Administrator accounts."
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            Immutable System Audit Logs
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Append-only forensic ledger recording every Branch, HR, Client, Site, Service,
            Designation, Permission, and Approval event. Modification and deletion are strictly
            blocked in Firestore Security Rules.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => void loadLogs()}
            disabled={loading}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={filteredLogs.length === 0}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
          {errorMsg}
        </div>
      )}

      {/* KPI Summary */}
      <section aria-label="Audit log metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMetricCard
            label="Total Audit Events"
            value={kpis.total}
            subtext="Append-only immutable records"
            icon={ScrollText}
          />
          <StatMetricCard
            label="Admin Actions"
            value={kpis.adminActions}
            subtext="Executive & RBAC mutations"
            icon={ShieldCheck}
          />
          <StatMetricCard
            label="HR Operations"
            value={kpis.hrActions}
            subtext="Scoped branch & site changes"
            icon={UserCheck}
          />
          <StatMetricCard
            label="Security & Approvals"
            value={kpis.permissionAndApprovals}
            subtext="Permission changes & workflow sign-offs"
            icon={Lock}
          />
        </div>
      </section>

      {/* Audit Ledger Table */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Chronological Audit Stream
            </h2>
            <p className="text-xs text-[#574B43]">
              Collection <code className="font-mono-tabular">auditLogs/&#123;logId&#125;</code> ·{' '}
              <code className="font-mono-tabular">allow update, delete: if false;</code>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by Module"
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
            >
              <option value="ALL">All Modules</option>
              {AUDIT_MODULES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by Actor Role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] focus:outline-none focus:border-[#5C3D2E]"
            >
              <option value="ALL">All Roles</option>
              <option value="admin">Admin</option>
              <option value="hr">HR</option>
            </select>
          </div>
        </div>

        <DataTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search Action, Record ID, Actor, Branch ID, or Summary..."
        />

        {loading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-14 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] animate-pulse"
              />
            ))}
          </div>
        ) : filteredLogs.length === 0 ? (
          <EmptyStatePanel
            icon={ScrollText}
            title="No Audit Events Match Your Filter"
            description="Clear your search or module filter to inspect recorded system events."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                    <th className="py-3 px-3">Timestamp</th>
                    <th className="py-3 px-3">Action &amp; Module</th>
                    <th className="py-3 px-3">Record ID</th>
                    <th className="py-3 px-3">Performed By &amp; Role</th>
                    <th className="py-3 px-3">Branch ID</th>
                    <th className="py-3 px-3">Summary</th>
                    <th className="py-3 px-3 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5DDD2] text-sm">
                  {paginatedLogs.map((log) => (
                    <tr
                      key={log.logId}
                      className="hover:bg-[#FAF8F5] transition-colors align-top"
                    >
                      <td className="py-3.5 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                        <div>{formatDateTime(log.timestamp)}</div>
                        <div className="text-[11px] text-[#7D6F65]">{log.logId}</div>
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="font-semibold text-[#1F1916]">{log.action}</div>
                        <div className="text-xs text-[#5C3D2E] font-medium">{log.module}</div>
                      </td>

                      <td className="py-3.5 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E] whitespace-nowrap">
                        {log.recordId}
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="text-xs font-medium text-[#1F1916]">{log.performedBy}</div>
                        <div className="font-mono-tabular text-[11px] uppercase text-[#7D6F65]">
                          Role: {log.role}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 font-mono-tabular text-xs text-[#574B43] whitespace-nowrap">
                        {log.branchId}
                      </td>

                      <td className="py-3.5 px-3 text-xs text-[#1F1916] max-w-md leading-relaxed">
                        {log.summary}
                      </td>

                      <td className="py-3.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedLog(log)}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5 text-[#5C3D2E]" />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={page}
              totalItems={filteredLogs.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </section>

      {/* Audit Event Inspection Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-detail-title"
        >
          <div className="w-full max-w-xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl">
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#E5DDD2]">
              <div>
                <span className="font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                  {selectedLog.logId}
                </span>
                <h2
                  id="audit-detail-title"
                  className="mt-0.5 font-display text-lg font-bold text-[#1F1916]"
                >
                  {selectedLog.action}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#FAF8F5] border border-[#E5DDD2] rounded-xl p-4">
                <div>
                  <span className="text-[#7D6F65] block">Action</span>
                  <span className="font-semibold text-[#1F1916]">{selectedLog.action}</span>
                </div>
                <div>
                  <span className="text-[#7D6F65] block">Module</span>
                  <span className="font-semibold text-[#5C3D2E]">{selectedLog.module}</span>
                </div>
                <div>
                  <span className="text-[#7D6F65] block">Record ID</span>
                  <span className="font-mono-tabular font-semibold text-[#1F1916]">
                    {selectedLog.recordId}
                  </span>
                </div>
                <div>
                  <span className="text-[#7D6F65] block">Branch ID</span>
                  <span className="font-mono-tabular font-semibold text-[#1F1916]">
                    {selectedLog.branchId}
                  </span>
                </div>
                <div>
                  <span className="text-[#7D6F65] block">Performed By</span>
                  <span className="font-medium text-[#1F1916]">{selectedLog.performedBy}</span>
                </div>
                <div>
                  <span className="text-[#7D6F65] block">Actor Role &amp; UID</span>
                  <span className="font-mono-tabular text-[#1F1916]">
                    {selectedLog.role} ({selectedLog.actorUid || 'system'})
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-[#7D6F65] block">Timestamp</span>
                  <span className="font-mono-tabular text-[#1F1916]">
                    {formatDateTime(selectedLog.timestamp)} ({selectedLog.timestamp})
                  </span>
                </div>
                <div className="sm:col-span-2 pt-2 border-t border-[#E5DDD2]">
                  <span className="text-[#7D6F65] block">Event Summary</span>
                  <p className="text-sm text-[#1F1916] mt-0.5 leading-relaxed">
                    {selectedLog.summary}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[#E5DDD2] flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
