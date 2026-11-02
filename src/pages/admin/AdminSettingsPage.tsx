import React, { useCallback, useEffect, useState } from 'react';
import { Database, Lock, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import { listEmployees, subscribeEmployeeData } from '../../services/firestore/employeeService';
import {
  listApprovalRequests,
  listAuditLogs,
  listBranches,
  listClients,
  listDesignations,
  listHRProfiles,
  listServices,
  listSites,
  listSiteServiceConfigs,
  subscribeMasterData,
} from '../../services/firestore/masterDataService';
import { HR_PERMISSIONS } from '../../types';
import { ProfilePage } from '../common/ProfilePage';

interface CollectionSummary {
  name: string;
  count: number;
  policy: string;
}

export const AdminSettingsPage: React.FC = () => {
  const { user, isFirebaseConfigured, isPreviewSession } = useAuth();
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDiagnostics = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [
        branches,
        hrProfiles,
        clients,
        sites,
        employees,
        services,
        designations,
        siteServices,
        approvals,
        auditLogs,
      ] = await Promise.all([
        listBranches(user, isPreviewSession),
        listHRProfiles(user, isPreviewSession),
        listClients(user, isPreviewSession),
        listSites(user, isPreviewSession),
        listEmployees(user, isPreviewSession),
        listServices(user, isPreviewSession),
        listDesignations(user, isPreviewSession),
        listSiteServiceConfigs(user, isPreviewSession),
        listApprovalRequests(user, isPreviewSession),
        listAuditLogs(user, isPreviewSession),
      ]);

      setCollections([
        {
          name: 'branches',
          count: branches.length,
          policy: 'Admin write only · Soft-delete (isDeleted) preserves history',
        },
        {
          name: 'hrProfiles',
          count: hrProfiles.length,
          policy: 'Admin write only · Never stores plain-text passwords',
        },
        {
          name: 'clients',
          count: clients.length,
          policy: 'Admin all · HR scoped to assignedBranches + client.* permissions',
        },
        {
          name: 'sites',
          count: sites.length,
          policy: 'Linked to 1 Client · HR scoped · Soft-archive preserves history',
        },
        {
          name: 'employees',
          count: employees.length,
          policy: 'Operational profile · Soft-delete only · Zero Site Portal access',
        },
        {
          name: 'services',
          count: services.length,
          policy: 'Dynamic Security, Housekeeping & Manpower catalog in Firestore',
        },
        {
          name: 'designations',
          count: designations.length,
          policy: 'Dynamic roles, skills, training & license rules without code edits',
        },
        {
          name: 'siteServices',
          count: siteServices.length,
          policy: 'Enforces Vacant = Required − Deployed >= 0 (never negative)',
        },
        {
          name: 'approvals',
          count: approvals.length,
          policy: 'Pending / Approved / Rejected / Cancelled workflow state machine',
        },
        {
          name: 'auditLogs',
          count: auditLogs.length,
          policy: 'Admin read only · Append-only immutable (update/delete blocked)',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadDiagnostics();
    const unsubMaster = subscribeMasterData(() => {
      void loadDiagnostics();
    });
    const unsubEmp = subscribeEmployeeData(() => {
      void loadDiagnostics();
    });
    return () => {
      unsubMaster();
      unsubEmp();
    };
  }, [loadDiagnostics]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            System Governance &amp; Admin Settings
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Firestore Master Data &amp; Employee architecture overview, RBAC security invariants,
            and Administrator account security controls.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadDiagnostics()}
          disabled={loading}
          className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Overview</span>
        </button>
      </div>

      {/* Architecture KPIs */}
      <section aria-label="System governance overview">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMetricCard
            label="Master & HR Collections"
            value="13"
            subtext="branches, hrProfiles, clients, sites, employees, employeePrivate, employeeDocuments, employeeHistory, services, designations, siteServices, approvals, auditLogs"
            icon={Database}
          />
          <StatMetricCard
            label="Granular HR Permissions"
            value={HR_PERMISSIONS.length}
            subtext="Dot-notation module capabilities"
            icon={Lock}
          />
          <StatMetricCard
            label="Portal Isolation"
            value="5 Portals"
            subtext="Admin, HR, Field Officer, Site, Employee"
            icon={ShieldCheck}
          />
          <StatMetricCard
            label="Backend Mode"
            value={isFirebaseConfigured && !isPreviewSession ? 'Live Firebase' : 'Preview Store'}
            subtext={
              isFirebaseConfigured
                ? 'Firebase Auth + Firestore connected'
                : 'Add VITE_FIREBASE_* keys in .env for live cloud sync'
            }
            icon={Server}
          />
        </div>
      </section>

      {/* Firestore Master Collection Ledger */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="font-display text-lg font-semibold text-[#1F1916]">
            Firestore Master Collection Architecture &amp; Security Policy
          </h2>
          <p className="text-xs text-[#574B43]">
            Live document counts and security invariants enforced across Phase 1 &amp; Phase 2.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-[#E5DDD2] bg-[#FAF8F5] text-xs font-semibold text-[#574B43]">
                <th className="py-3 px-3">Collection Path</th>
                <th className="py-3 px-3 text-right">Records</th>
                <th className="py-3 px-3">Security &amp; Integrity Rule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5DDD2] text-sm">
              {collections.map((col) => (
                <tr key={col.name} className="hover:bg-[#FAF8F5]">
                  <td className="py-3 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                    /{col.name}/&#123;id&#125;
                  </td>
                  <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#1F1916]">
                    {col.count}
                  </td>
                  <td className="py-3 px-3 text-xs text-[#574B43]">{col.policy}</td>
                </tr>
              ))}
              <tr className="hover:bg-[#FAF8F5]">
                <td className="py-3 px-3 font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                  /users/&#123;uid&#125; &amp; /employeePrivate/&#123;uid&#125;
                </td>
                <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#1F1916]">
                  RBAC + PII
                </td>
                <td className="py-3 px-3 text-xs text-[#574B43]">
                  Role verification on login · Aadhaar/Bank/Salary strictly hidden from Site &amp;
                  Field Officer portals
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Embedded Administrator Account Profile & Password Reset */}
      <div className="pt-2 border-t border-[#E5DDD2]">
        <ProfilePage />
      </div>
    </div>
  );
};
