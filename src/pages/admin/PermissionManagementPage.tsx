import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  KeyRound,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { StatMetricCard } from '../../components/StatMetricCard';
import { useAuth } from '../../hooks/useAuth';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  listBranches,
  listHRProfiles,
  subscribeMasterData,
  updateHRPermissionsAndScope,
} from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  HR_PERMISSIONS,
  HR_PERMISSION_GROUPS,
  HRPermissionKey,
  HRProfileRecord,
  PERMISSION_PROFILES,
  PERMISSION_PROFILE_MAP,
  PermissionProfileName,
} from '../../types';
import { normalizePermissionList } from '../../utils/portalConfig';

export const PermissionManagementPage: React.FC = () => {
  const { user, isPreviewSession } = useAuth();

  const [hrProfiles, setHrProfiles] = useState<HRProfileRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [hrSearch, setHrSearch] = useState('');
  const [selectedHrId, setSelectedHrId] = useState<string>('');

  // Editable Permission & Branch State for Selected HR
  const [selectedProfilePreset, setSelectedProfilePreset] =
    useState<PermissionProfileName>('Full Branch Operations');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [hrs, brs] = await Promise.all([
        listHRProfiles(user, isPreviewSession),
        listBranches(user, isPreviewSession),
      ]);
      setHrProfiles(hrs);
      setBranches(brs.filter((b) => !b.isDeleted));
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession]);

  useEffect(() => {
    void loadData();
    return subscribeMasterData(() => {
      void loadData();
    });
  }, [loadData]);

  // Select first HR profile by default when loaded
  useEffect(() => {
    if (hrProfiles.length === 0) return;
    const currentExists = hrProfiles.some((h) => h.hrId === selectedHrId);
    const target = currentExists
      ? hrProfiles.find((h) => h.hrId === selectedHrId)!
      : hrProfiles[0];

    if (!currentExists) {
      setSelectedHrId(target.hrId);
    }
    setSelectedProfilePreset(target.permissionProfile);
    setSelectedPermissions(normalizePermissionList(target.permissions || []));
    setSelectedBranches([...target.assignedBranches]);
  }, [hrProfiles, selectedHrId]);

  const selectedHR = useMemo(
    () => hrProfiles.find((h) => h.hrId === selectedHrId) || null,
    [hrProfiles, selectedHrId]
  );

  const filteredHRList = useMemo(() => {
    const q = hrSearch.trim().toLowerCase();
    if (!q) return hrProfiles;
    return hrProfiles.filter(
      (h) =>
        h.hrId.toLowerCase().includes(q) ||
        h.fullName.toLowerCase().includes(q) ||
        h.email.toLowerCase().includes(q) ||
        h.hrDesignation.toLowerCase().includes(q)
    );
  }, [hrProfiles, hrSearch]);

  const handleSelectHR = (hr: HRProfileRecord) => {
    setSelectedHrId(hr.hrId);
    setSelectedProfilePreset(hr.permissionProfile);
    setSelectedPermissions(normalizePermissionList(hr.permissions || []));
    setSelectedBranches([...hr.assignedBranches]);
    setFeedback(null);
  };

  const handleApplyPreset = (preset: PermissionProfileName) => {
    setSelectedProfilePreset(preset);
    if (preset !== 'Custom Granular Profile') {
      setSelectedPermissions([...PERMISSION_PROFILE_MAP[preset]]);
    }
  };

  const togglePermission = (key: HRPermissionKey) => {
    setSelectedProfilePreset('Custom Granular Profile');
    setSelectedPermissions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const toggleModuleGroup = (keys: HRPermissionKey[]) => {
    setSelectedProfilePreset('Custom Granular Profile');
    const allEnabled = keys.every((k) => selectedPermissions.includes(k));
    if (allEnabled) {
      setSelectedPermissions((prev) => prev.filter((k) => !keys.includes(k as HRPermissionKey)));
    } else {
      setSelectedPermissions((prev) => Array.from(new Set([...prev, ...keys])));
    }
  };

  const toggleBranchScope = (branchId: string) => {
    setSelectedBranches((prev) =>
      prev.includes(branchId) ? prev.filter((b) => b !== branchId) : [...prev, branchId]
    );
  };

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedHR) return false;
    const origPerms = normalizePermissionList(selectedHR.permissions || []).sort().join(',');
    const nextPerms = [...selectedPermissions].sort().join(',');
    const origBranches = [...selectedHR.assignedBranches].sort().join(',');
    const nextBranches = [...selectedBranches].sort().join(',');
    return (
      origPerms !== nextPerms ||
      origBranches !== nextBranches ||
      selectedHR.permissionProfile !== selectedProfilePreset
    );
  }, [selectedHR, selectedPermissions, selectedBranches, selectedProfilePreset]);

  const handleRequestSave = () => {
    if (!selectedHR) return;
    if (selectedBranches.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Assign at least one operational Branch to this HR user before saving.',
      });
      return;
    }
    setConfirmSaveOpen(true);
  };

  const handleConfirmSave = async () => {
    if (!user || !selectedHR) return;
    setSaving(true);
    try {
      await updateHRPermissionsAndScope(user, isPreviewSession, selectedHR.hrId, {
        permissionProfile: selectedProfilePreset,
        permissions: selectedPermissions,
        assignedBranches: selectedBranches,
      });
      setConfirmSaveOpen(false);
      setFeedback({
        type: 'success',
        text: `Permissions & branch scope updated for ${selectedHR.fullName} (${selectedHR.hrId}) and recorded in Audit Logs.`,
      });
      await loadData();
    } catch (err) {
      setConfirmSaveOpen(false);
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const kpis = useMemo(() => {
    const activeHR = hrProfiles.filter((h) => h.accountStatus === 'Active').length;
    const customProfiles = hrProfiles.filter(
      (h) => h.permissionProfile === 'Custom Granular Profile'
    ).length;
    const multiBranchHR = hrProfiles.filter((h) => h.assignedBranches.length > 1).length;
    return {
      totalHR: hrProfiles.length,
      activeHR,
      customProfiles,
      multiBranchHR,
    };
  }, [hrProfiles]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1F1916]">
            HR Permission &amp; Branch Scope Governance
          </h1>
          <p className="mt-1 text-sm text-[#574B43]">
            Assign any of the {HR_PERMISSIONS.length} granular dot-notation permissions and branch boundaries per HR
            account. Enforced simultaneously in UI routes, backend API, and Firestore Security Rules.
          </p>
        </div>

        {selectedHR && (
          <button
            type="button"
            onClick={handleRequestSave}
            disabled={!hasUnsavedChanges || saving}
            className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#5C3D2E] text-sm font-semibold text-white hover:bg-[#4A3023] disabled:opacity-45 transition-colors self-start sm:self-auto whitespace-nowrap"
          >
            <Save className="w-4 h-4" />
            <span>Save Permission Matrix</span>
          </button>
        )}
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 text-xs ${
            feedback.type === 'success'
              ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Row */}
      <section aria-label="HR permission metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatMetricCard
            label="HR Accounts Governed"
            value={kpis.totalHR}
            subtext={`${kpis.activeHR} active HR login profile(s)`}
            icon={UserCog}
          />
          <StatMetricCard
            label="Granular Permission Keys"
            value={HR_PERMISSIONS.length}
            subtext="Standardized dot-notation RBAC capabilities"
            icon={KeyRound}
          />
          <StatMetricCard
            label="Multi-Branch HR Users"
            value={kpis.multiBranchHR}
            subtext="Scoped to 2+ regional branches"
            icon={Building2}
          />
          <StatMetricCard
            label="Custom Matrix Profiles"
            value={kpis.customProfiles}
            subtext="Tailored individual permission sets"
            icon={ShieldCheck}
          />
        </div>
      </section>

      {loading ? (
        <div className="h-72 rounded-xl bg-white border border-[#E5DDD2] animate-pulse" />
      ) : hrProfiles.length === 0 ? (
        <EmptyStatePanel
          icon={UserCog}
          title="No HR Accounts Provisioned Yet"
          description="Create an HR account in HR Management first to configure granular module permissions and branch access."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: HR Selector Directory */}
          <aside className="lg:col-span-4 bg-white border border-[#E5DDD2] rounded-xl p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[#1F1916]">
                1. Select HR Account
              </h2>
              <p className="text-xs text-[#574B43]">
                Choose an HR user to inspect or customize permissions.
              </p>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-[#7D6F65] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={hrSearch}
                onChange={(e) => setHrSearch(e.target.value)}
                placeholder="Search HR ID, name, or email..."
                className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
              />
            </div>

            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-0.5">
              {filteredHRList.map((hr) => {
                const isSelected = hr.hrId === selectedHrId;
                const permCount = normalizePermissionList(hr.permissions || []).length;

                return (
                  <button
                    key={hr.hrId}
                    type="button"
                    onClick={() => handleSelectHR(hr)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-colors ${
                      isSelected
                        ? 'bg-[#F3EDE4] border-[#5C3D2E]'
                        : 'bg-[#FAF8F5] border-[#E5DDD2] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-tabular text-xs font-semibold text-[#5C3D2E]">
                        {hr.hrId}
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          hr.accountStatus === 'Active' ? 'text-[#166534]' : 'text-[#B91C1C]'
                        }`}
                      >
                        {hr.accountStatus}
                      </span>
                    </div>
                    <div className="mt-1 font-semibold text-sm text-[#1F1916]">{hr.fullName}</div>
                    <div className="text-xs text-[#574B43]">{hr.hrDesignation}</div>
                    <div className="mt-2 pt-2 border-t border-[#E5DDD2] flex items-center justify-between text-[11px] text-[#7D6F65] font-mono-tabular">
                      <span>{permCount} / {HR_PERMISSIONS.length} perms</span>
                      <span>{hr.assignedBranches.length} branch(es)</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Right Column: Branch Scope + 23-Permission Matrix */}
          {selectedHR && (
            <div className="lg:col-span-8 space-y-6">
              {/* Selected HR Summary & Preset Bar */}
              <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-[#E5DDD2] pb-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-[#7D6F65]">
                      <span className="font-mono-tabular font-semibold text-[#5C3D2E]">
                        {selectedHR.hrId}
                      </span>
                      <span>·</span>
                      <span>{selectedHR.hrDesignation}</span>
                      <span>·</span>
                      <span>{selectedHR.email}</span>
                    </div>
                    <h2 className="mt-1 font-display text-xl font-bold text-[#1F1916]">
                      {selectedHR.fullName}
                    </h2>
                  </div>

                  <div className="text-xs font-mono-tabular text-[#574B43] bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg px-3 py-2">
                    Granted:{' '}
                    <span className="font-semibold text-[#1F1916]">
                      {selectedPermissions.length}
                    </span>{' '}
                    of {HR_PERMISSIONS.length} permissions
                  </div>
                </div>

                {/* Assigned Branch Scope */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#5C3D2E]">
                      2. Authorized Branch Scope (Strict Data Isolation)
                    </h3>
                    <span className="text-xs text-[#7D6F65]">
                      HR can only access Clients, Sites, and Reports in checked branches
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {branches.map((b) => {
                      const checked = selectedBranches.includes(b.branchId);
                      return (
                        <label
                          key={b.branchId}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            checked
                              ? 'bg-[#FAF8F5] border-[#5C3D2E]'
                              : 'bg-white border-[#E5DDD2] hover:bg-[#FAF8F5]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBranchScope(b.branchId)}
                            className="mt-0.5 w-4 h-4 accent-[#5C3D2E] rounded"
                          />
                          <div className="text-xs">
                            <div className="font-semibold text-[#1F1916]">
                              {b.branchCode} — {b.branchName}
                            </div>
                            <div className="font-mono-tabular text-[#7D6F65] mt-0.5">
                              {b.branchId} · {b.city}, {b.state} ({b.status})
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Preset Role Template Quick Selector */}
                <div className="space-y-2 pt-2 border-t border-[#E5DDD2]">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#5C3D2E]">
                      3. Permission Profile Template
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProfilePreset('Custom Granular Profile');
                          setSelectedPermissions([...HR_PERMISSIONS]);
                        }}
                        className="text-xs font-semibold text-[#5C3D2E] hover:underline"
                      >
                        Grant All {HR_PERMISSIONS.length}
                      </button>
                      <span className="text-[#D4C7B8]">|</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProfilePreset('Custom Granular Profile');
                          setSelectedPermissions([]);
                        }}
                        className="text-xs font-semibold text-[#B91C1C] hover:underline"
                      >
                        Revoke All
                      </button>
                    </div>
                  </div>

                  <select
                    value={selectedProfilePreset}
                    onChange={(e) => handleApplyPreset(e.target.value as PermissionProfileName)}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {PERMISSION_PROFILES.map((prof) => (
                      <option key={prof} value={prof}>
                        {prof}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              {/* Granular 23-Permission Matrix */}
              <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-6">
                <div>
                  <h3 className="font-display text-lg font-semibold text-[#1F1916]">
                    4. Granular Module Permission Matrix
                  </h3>
                  <p className="text-xs text-[#574B43]">
                    Toggle individual dot-notation capabilities. Elevated or destructive actions are
                    highlighted so you only grant them intentionally.
                  </p>
                </div>

                <div className="space-y-5">
                  {HR_PERMISSION_GROUPS.map((group) => {
                    const groupKeys = group.items.map((i) => i.key);
                    const allChecked = groupKeys.every((k) => selectedPermissions.includes(k));

                    return (
                      <div
                        key={group.module}
                        className="border border-[#E5DDD2] rounded-xl overflow-hidden"
                      >
                        <div className="bg-[#FAF8F5] px-4 py-2.5 border-b border-[#E5DDD2] flex items-center justify-between gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-[#1F1916]">
                            {group.module}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleModuleGroup(groupKeys)}
                            className="text-xs font-semibold text-[#5C3D2E] hover:underline"
                          >
                            {allChecked ? 'Unselect Group' : 'Select Group'}
                          </button>
                        </div>

                        <div className="divide-y divide-[#E5DDD2]">
                          {group.items.map((item) => {
                            const checked = selectedPermissions.includes(item.key);
                            return (
                              <label
                                key={item.key}
                                className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-[#FAF8F5] cursor-pointer transition-colors"
                              >
                                <div className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePermission(item.key)}
                                    className="mt-1 w-4 h-4 accent-[#5C3D2E] rounded"
                                  />
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-semibold text-[#1F1916]">
                                        {item.label}
                                      </span>
                                      <code className="font-mono-tabular text-xs text-[#5C3D2E] bg-[#F3EDE4] px-1.5 py-0.5 rounded">
                                        {item.key}
                                      </code>
                                      {item.sensitive && (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#B45309]">
                                          <ShieldAlert className="w-3 h-3" />
                                          Elevated
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-[#574B43] mt-0.5">
                                      {item.description}
                                    </p>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-3 border-t border-[#E5DDD2] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <span className="text-xs text-[#574B43]">
                    {hasUnsavedChanges
                      ? 'You have unsaved permission or branch scope changes.'
                      : 'All changes saved and synchronized.'}
                  </span>
                  <button
                    type="button"
                    onClick={handleRequestSave}
                    disabled={!hasUnsavedChanges || saving}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-45 transition-colors whitespace-nowrap"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Permissions for {selectedHR.fullName}</span>
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmSaveOpen}
        title={`Update Permissions for ${selectedHR?.fullName ?? ''}?`}
        description={`Assign ${selectedPermissions.length} permission(s) across ${selectedBranches.length} branch(es) (${selectedBranches.join(', ')}) to ${selectedHR?.hrId ?? ''}. This change takes effect immediately and writes an immutable entry to Audit Logs.`}
        confirmLabel="Apply Permissions"
        loading={saving}
        onConfirm={() => void handleConfirmSave()}
        onCancel={() => setConfirmSaveOpen(false)}
      />
    </div>
  );
};
