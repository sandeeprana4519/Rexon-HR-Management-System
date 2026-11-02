import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  MapPin,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  AssignmentFormInput,
  BranchRecord,
  ClientRecord,
  DesignationRecord,
  EmployeeAssignmentRecord,
  EmployeeRecord,
  RexonUser,
  SERVICE_CATEGORIES,
  STANDARD_SHIFTS,
  ServiceCategory,
  ServiceRecord,
  SiteRecord,
  SiteServiceConfigRecord,
  TransferAssignmentInput,
} from '../types';
import {
  addDaysToIsoDate,
  computeShiftDurationHours,
  detectShiftConflict,
  findStandardShiftByLabel,
  getTodayIsoDate,
  isAssignmentActiveOnDate,
  validateEmployeeEligibilityForAssignment,
} from '../utils/deploymentValidation';
import { computeNonNegativeVacancy } from '../utils/masterValidation';
import { getAuthorizedBranchIds } from '../utils/portalConfig';

export type AssignmentModalMode = 'create' | 'edit' | 'transfer';

export interface AssignmentModalPrefill {
  employeeId?: string;
  branchId?: string;
  clientId?: string;
  siteId?: string;
  siteServiceId?: string;
  serviceCategory?: ServiceCategory;
  serviceId?: string;
  designationId?: string;
  startDate?: string;
}

interface AssignmentFormModalProps {
  isOpen: boolean;
  mode: AssignmentModalMode;
  caller: RexonUser;
  targetAssignment?: EmployeeAssignmentRecord | null;
  prefill?: AssignmentModalPrefill | null;
  branches: BranchRecord[];
  clients: ClientRecord[];
  sites: SiteRecord[];
  services: ServiceRecord[];
  designations: DesignationRecord[];
  siteConfigs: SiteServiceConfigRecord[];
  employees: EmployeeRecord[];
  assignments: EmployeeAssignmentRecord[];
  onClose: () => void;
  onSubmitCreate: (input: AssignmentFormInput) => Promise<void>;
  onSubmitEdit: (assignmentId: string, input: AssignmentFormInput) => Promise<void>;
  onSubmitTransfer: (input: TransferAssignmentInput) => Promise<void>;
}

const WEEKLY_OFF_OPTIONS = [
  'Rotational (1 Day / Week)',
  'Sunday Fixed',
  'Saturday & Sunday',
  'Reliever Covered (No Post Gap)',
  'Fortnightly Off',
];

export const AssignmentFormModal: React.FC<AssignmentFormModalProps> = ({
  isOpen,
  mode,
  caller,
  targetAssignment,
  prefill,
  branches,
  clients,
  sites,
  services,
  designations,
  siteConfigs,
  employees,
  assignments,
  onClose,
  onSubmitCreate,
  onSubmitEdit,
  onSubmitTransfer,
}) => {
  const today = getTodayIsoDate();
  const defaultEndDate = addDaysToIsoDate(today, 180);

  const [employeeId, setEmployeeId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [clientId, setClientId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [siteServiceId, setSiteServiceId] = useState('');
  const [serviceCategory, setServiceCategory] = useState<ServiceCategory>('Security');
  const [serviceId, setServiceId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [shift, setShift] = useState(STANDARD_SHIFTS[3].label);
  const [shiftStartTime, setShiftStartTime] = useState(STANDARD_SHIFTS[3].startTime);
  const [shiftEndTime, setShiftEndTime] = useState(STANDARD_SHIFTS[3].endTime);
  const [reportingTime, setReportingTime] = useState(STANDARD_SHIFTS[3].defaultReportingTime);
  const [dutyHours, setDutyHours] = useState<number>(STANDARD_SHIFTS[3].dutyHours);
  const [weeklyOff, setWeeklyOff] = useState(WEEKLY_OFF_OPTIONS[0]);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [reportingInstructions, setReportingInstructions] = useState('');
  const [remarks, setRemarks] = useState('');
  const [showEligibleEmployeesOnly, setShowEligibleEmployeesOnly] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const authorizedBranches = useMemo(() => getAuthorizedBranchIds(caller), [caller]);

  const availableBranches = useMemo(() => {
    return branches.filter((b) => {
      if (b.isDeleted || b.status !== 'Active') return false;
      if (caller.role === 'admin') return true;
      return authorizedBranches.includes(b.branchId);
    });
  }, [branches, caller.role, authorizedBranches]);

  const availableSites = useMemo(() => {
    return sites.filter((s) => {
      if (s.isArchived || s.siteStatus !== 'Active') return false;
      if (caller.role === 'field_officer' && !caller.assignedSiteIds.includes(s.siteId)) {
        return false;
      }
      if (caller.role === 'hr' && !authorizedBranches.includes(s.branchId)) {
        return false;
      }
      if (mode === 'transfer' && targetAssignment && s.siteId === targetAssignment.siteId) {
        return false;
      }
      if (branchId && s.branchId !== branchId) return false;
      if (clientId && s.clientId !== clientId) return false;
      return true;
    });
  }, [sites, caller, authorizedBranches, mode, targetAssignment, branchId, clientId]);

  const availableClients = useMemo(() => {
    const siteClientIds = new Set(
      sites
        .filter((s) => {
          if (s.isArchived || s.siteStatus !== 'Active') return false;
          if (caller.role === 'field_officer' && !caller.assignedSiteIds.includes(s.siteId)) {
            return false;
          }
          if (branchId && s.branchId !== branchId) return false;
          return true;
        })
        .map((s) => s.clientId)
    );
    return clients.filter(
      (c) => !c.isArchived && c.clientStatus === 'Active' && (siteClientIds.has(c.clientId) || !branchId)
    );
  }, [clients, sites, caller, branchId]);

  const activeSiteConfigsForSelectedSite = useMemo(() => {
    if (!siteId) return [];
    return siteConfigs.filter((c) => c.siteId === siteId && c.status === 'Active');
  }, [siteConfigs, siteId]);

  const filteredServices = useMemo(() => {
    return services.filter(
      (s) => s.status === 'Active' && s.serviceCategory === serviceCategory
    );
  }, [services, serviceCategory]);

  const filteredDesignations = useMemo(() => {
    return designations.filter(
      (d) =>
        d.status === 'Active' &&
        d.serviceCategory === serviceCategory &&
        (!serviceId || d.relatedServiceId === serviceId)
    );
  }, [designations, serviceCategory, serviceId]);

  // Initialize form state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);

    if (mode === 'edit' && targetAssignment) {
      setEmployeeId(targetAssignment.employeeId);
      setBranchId(targetAssignment.branchId);
      setClientId(targetAssignment.clientId);
      setSiteId(targetAssignment.siteId);
      setSiteServiceId(targetAssignment.siteServiceId || '');
      setServiceCategory(targetAssignment.serviceCategory);
      setServiceId(targetAssignment.serviceId);
      setDesignationId(targetAssignment.designationId);
      setShift(targetAssignment.shift);
      setShiftStartTime(targetAssignment.shiftStartTime);
      setShiftEndTime(targetAssignment.shiftEndTime);
      setReportingTime(targetAssignment.reportingTime);
      setDutyHours(targetAssignment.dutyHours);
      setWeeklyOff(targetAssignment.weeklyOff);
      setStartDate(targetAssignment.startDate);
      setEndDate(targetAssignment.endDate);
      setReportingInstructions(targetAssignment.reportingInstructions || '');
      setRemarks(targetAssignment.remarks || '');
      return;
    }

    if (mode === 'transfer' && targetAssignment) {
      setEmployeeId(targetAssignment.employeeId);
      setBranchId(targetAssignment.branchId);
      setClientId('');
      setSiteId('');
      setSiteServiceId('');
      setServiceCategory(targetAssignment.serviceCategory);
      setServiceId(targetAssignment.serviceId);
      setDesignationId(targetAssignment.designationId);
      setShift(targetAssignment.shift);
      setShiftStartTime(targetAssignment.shiftStartTime);
      setShiftEndTime(targetAssignment.shiftEndTime);
      setReportingTime(targetAssignment.reportingTime);
      setDutyHours(targetAssignment.dutyHours);
      setWeeklyOff(targetAssignment.weeklyOff);
      setStartDate(today >= targetAssignment.startDate ? today : targetAssignment.startDate);
      setEndDate(
        targetAssignment.endDate >= today ? targetAssignment.endDate : addDaysToIsoDate(today, 180)
      );
      setReportingInstructions(targetAssignment.reportingInstructions || '');
      setRemarks(`Inter-site transfer from ${targetAssignment.siteName}`);
      return;
    }

    // Create mode (with optional prefill from Deployment Dashboard or Availability View)
    const preSite = prefill?.siteId ? sites.find((s) => s.siteId === prefill.siteId) : undefined;
    const preEmp = prefill?.employeeId
      ? employees.find((e) => e.employeeId === prefill.employeeId)
      : undefined;

    const initialBranch =
      prefill?.branchId ||
      preSite?.branchId ||
      preEmp?.branchId ||
      availableBranches[0]?.branchId ||
      '';
    const initialClient = prefill?.clientId || preSite?.clientId || '';
    const initialSite = prefill?.siteId || '';
    const initialCat: ServiceCategory =
      prefill?.serviceCategory ||
      preEmp?.assignedDesignations[0]?.serviceCategory ||
      'Security';
    const initialSvc =
      prefill?.serviceId ||
      preEmp?.assignedDesignations[0]?.serviceId ||
      services.find((s) => s.status === 'Active' && s.serviceCategory === initialCat)?.serviceId ||
      '';
    const initialDesig =
      prefill?.designationId ||
      preEmp?.assignedDesignations[0]?.designationId ||
      designations.find(
        (d) =>
          d.status === 'Active' &&
          d.serviceCategory === initialCat &&
          (!initialSvc || d.relatedServiceId === initialSvc)
      )?.designationId ||
      '';

    setEmployeeId(prefill?.employeeId || '');
    setBranchId(initialBranch);
    setClientId(initialClient);
    setSiteId(initialSite);
    setSiteServiceId(prefill?.siteServiceId || '');
    setServiceCategory(initialCat);
    setServiceId(initialSvc);
    setDesignationId(initialDesig);
    setShift(STANDARD_SHIFTS[3].label);
    setShiftStartTime(STANDARD_SHIFTS[3].startTime);
    setShiftEndTime(STANDARD_SHIFTS[3].endTime);
    setReportingTime(STANDARD_SHIFTS[3].defaultReportingTime);
    setDutyHours(STANDARD_SHIFTS[3].dutyHours);
    setWeeklyOff(WEEKLY_OFF_OPTIONS[0]);
    const effStart = prefill?.startDate || today;
    setStartDate(effStart);
    setEndDate(addDaysToIsoDate(effStart, 180));
    setReportingInstructions('Report in full uniform 15 minutes before shift handover with REXON ID card.');
    setRemarks('');
  }, [
    isOpen,
    mode,
    targetAssignment,
    prefill,
    sites,
    employees,
    services,
    designations,
    availableBranches,
    today,
  ]);

  const handleSelectConfiguredPost = (cfgId: string) => {
    setSiteServiceId(cfgId);
    const cfg = activeSiteConfigsForSelectedSite.find((c) => c.siteServiceId === cfgId);
    if (!cfg) return;
    setServiceCategory(cfg.serviceCategory);
    setServiceId(cfg.serviceId);
    setDesignationId(cfg.designationId);
    if (cfg.weeklyOff) {
      setWeeklyOff(cfg.weeklyOff);
    }
    const matchedShift = findStandardShiftByLabel(cfg.shiftType);
    if (matchedShift) {
      setShift(matchedShift.label);
      setShiftStartTime(matchedShift.startTime);
      setShiftEndTime(matchedShift.endTime);
      setReportingTime(matchedShift.defaultReportingTime);
      setDutyHours(matchedShift.dutyHours);
    }
  };

  const handleShiftPresetChange = (selectedLabel: string) => {
    setShift(selectedLabel);
    const preset = findStandardShiftByLabel(selectedLabel);
    if (preset) {
      setShiftStartTime(preset.startTime);
      setShiftEndTime(preset.endTime);
      setReportingTime(preset.defaultReportingTime);
      setDutyHours(preset.dutyHours);
    }
  };

  const handleTimeChange = (nextStart: string, nextEnd: string) => {
    setShiftStartTime(nextStart);
    setShiftEndTime(nextEnd);
    const hrs = computeShiftDurationHours(nextStart, nextEnd);
    if (hrs >= 1 && hrs <= 16) {
      setDutyHours(hrs);
    }
  };

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.employeeId === employeeId),
    [employees, employeeId]
  );

  // Live eligibility & conflict check preview
  const liveAdvisory = useMemo(() => {
    if (!selectedEmployee) return null;

    const eligibility = designationId
      ? validateEmployeeEligibilityForAssignment(
          selectedEmployee,
          designationId,
          serviceCategory,
          serviceId
        )
      : { valid: true };

    if (!eligibility.valid) {
      return {
        type: 'error' as const,
        message: eligibility.error || 'Employee is ineligible for the selected designation.',
      };
    }

    const empExisting = assignments.filter((a) => a.employeeId === selectedEmployee.employeeId);
    const excludeIds = targetAssignment ? [targetAssignment.assignmentId] : [];
    const conflict = detectShiftConflict(
      {
        startDate,
        endDate,
        shift,
        shiftStartTime,
        shiftEndTime,
        dutyHours,
      },
      empExisting,
      { excludeAssignmentIds: excludeIds }
    );

    if (conflict.hasConflict) {
      return {
        type: 'error' as const,
        message: conflict.reason || 'Overlapping shift conflict detected.',
      };
    }

    return {
      type: 'ok' as const,
      message: `${selectedEmployee.fullName} (${selectedEmployee.employeeId}) is verified for this designation and has zero shift conflicts during ${startDate} to ${endDate}.`,
    };
  }, [
    selectedEmployee,
    designationId,
    serviceCategory,
    serviceId,
    assignments,
    targetAssignment,
    startDate,
    endDate,
    shift,
    shiftStartTime,
    shiftEndTime,
    dutyHours,
  ]);

  const candidateEmployees = useMemo(() => {
    return employees
      .filter((e) => !e.isDeleted)
      .filter((e) => {
        if (!showEligibleEmployeesOnly) return true;
        if (!designationId) return e.isActive && e.employeeStatus === 'Active';
        return validateEmployeeEligibilityForAssignment(
          e,
          designationId,
          serviceCategory,
          serviceId
        ).valid;
      })
      .sort((a, b) => {
        const aOk = designationId
          ? validateEmployeeEligibilityForAssignment(a, designationId).valid
          : a.isActive;
        const bOk = designationId
          ? validateEmployeeEligibilityForAssignment(b, designationId).valid
          : b.isActive;
        if (aOk !== bOk) return aOk ? -1 : 1;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [employees, showEligibleEmployeesOnly, designationId, serviceCategory, serviceId]);

  if (!isOpen) return null;

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const selectedSiteObj = sites.find((s) => s.siteId === siteId);
      const effectiveBranchId = selectedSiteObj?.branchId || branchId;
      const effectiveClientId = selectedSiteObj?.clientId || clientId;

      if (mode === 'transfer' && targetAssignment) {
        await onSubmitTransfer({
          sourceAssignmentId: targetAssignment.assignmentId,
          newClientId: effectiveClientId,
          newSiteId: siteId,
          newSiteServiceId: siteServiceId || undefined,
          serviceCategory,
          serviceId,
          designationId,
          shift,
          shiftStartTime,
          shiftEndTime,
          reportingTime,
          dutyHours,
          weeklyOff,
          transferDate: startDate,
          newEndDate: endDate,
          reportingInstructions,
          remarks,
        });
      } else if (mode === 'edit' && targetAssignment) {
        await onSubmitEdit(targetAssignment.assignmentId, {
          employeeId,
          branchId: effectiveBranchId,
          clientId: effectiveClientId,
          siteId,
          siteServiceId: siteServiceId || undefined,
          serviceCategory,
          serviceId,
          designationId,
          shift,
          shiftStartTime,
          shiftEndTime,
          reportingTime,
          dutyHours,
          weeklyOff,
          startDate,
          endDate,
          reportingInstructions,
          remarks,
        });
      } else {
        await onSubmitCreate({
          employeeId,
          branchId: effectiveBranchId,
          clientId: effectiveClientId,
          siteId,
          siteServiceId: siteServiceId || undefined,
          serviceCategory,
          serviceId,
          designationId,
          shift,
          shiftStartTime,
          shiftEndTime,
          reportingTime,
          dutyHours,
          weeklyOff,
          startDate,
          endDate,
          reportingInstructions,
          remarks,
        });
      }
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save site assignment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-xl border border-[#E5DDD3] bg-[#FFFFFF] shadow-xl my-auto max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#E5DDD3] bg-[#FAF8F5] px-5 py-4 rounded-t-xl">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#5C3D2E] text-white">
              {mode === 'transfer' ? (
                <ArrowRightLeft className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1F1916]">
                {mode === 'transfer'
                  ? `Transfer Employee Site Duty (${targetAssignment?.assignmentId})`
                  : mode === 'edit'
                    ? `Modify Site Assignment (${targetAssignment?.assignmentId})`
                    : 'Assign Employee to Client Site'}
              </h2>
              <p className="text-xs text-[#6B5E55]">
                {mode === 'transfer'
                  ? `Moving ${targetAssignment?.employeeName} from "${targetAssignment?.siteName}" while preserving full assignment history`
                  : 'Enforces approved designation, verified qualification/KYC, shift-conflict prevention & post capacity'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#6B5E55] hover:bg-[#EFE9E0] hover:text-[#1F1916]"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} className="overflow-y-auto p-5 space-y-5">
          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Site & Post Selection */}
          <div className="rounded-lg border border-[#E5DDD3] bg-[#FAF8F5] p-4 space-y-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#5C3D2E]">
              <MapPin className="h-3.5 w-3.5" />
              <span>1. Target Branch, Client & Site Post</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Branch <span className="text-red-600">*</span>
                </label>
                <select
                  value={branchId}
                  onChange={(e) => {
                    setBranchId(e.target.value);
                    setClientId('');
                    setSiteId('');
                    setSiteServiceId('');
                  }}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                >
                  <option value="">Select Branch</option>
                  {availableBranches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchName} ({b.branchCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Client Filter
                </label>
                <select
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setSiteId('');
                    setSiteServiceId('');
                  }}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                >
                  <option value="">All Contracted Clients</option>
                  {availableClients.map((c) => (
                    <option key={c.clientId} value={c.clientId}>
                      {c.companyName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  {mode === 'transfer' ? 'New Deployment Site' : 'Deployment Site'}{' '}
                  <span className="text-red-600">*</span>
                </label>
                <select
                  value={siteId}
                  onChange={(e) => {
                    const nextSiteId = e.target.value;
                    setSiteId(nextSiteId);
                    setSiteServiceId('');
                    const found = sites.find((s) => s.siteId === nextSiteId);
                    if (found) {
                      setBranchId(found.branchId);
                      setClientId(found.clientId);
                    }
                  }}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                >
                  <option value="">Select Site</option>
                  {availableSites.map((s) => (
                    <option key={s.siteId} value={s.siteId}>
                      {s.siteName} — {s.clientName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Configured Site Posts Quick Selector */}
            {siteId && activeSiteConfigsForSelectedSite.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Configured Site Service Post (Auto-fills Category, Designation & Shift)
                </label>
                <select
                  value={siteServiceId}
                  onChange={(e) => handleSelectConfiguredPost(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                >
                  <option value="">-- Select Configured Post or Choose Manually Below --</option>
                  {activeSiteConfigsForSelectedSite.map((cfg) => {
                    const liveDeployed = assignments.filter(
                      (a) =>
                        a.siteId === siteId &&
                        (a.siteServiceId === cfg.siteServiceId ||
                          (!a.siteServiceId && a.designationId === cfg.designationId)) &&
                        isAssignmentActiveOnDate(a, startDate)
                    ).length;
                    const vac = computeNonNegativeVacancy(cfg.requiredCount, liveDeployed);
                    return (
                      <option key={cfg.siteServiceId} value={cfg.siteServiceId}>
                        [{cfg.serviceCategory}] {cfg.designationName} — {cfg.shiftType} | Req:{' '}
                        {cfg.requiredCount}, Deployed: {liveDeployed}, Vacant: {vac}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Service Category <span className="text-red-600">*</span>
                </label>
                <select
                  value={serviceCategory}
                  onChange={(e) => {
                    const cat = e.target.value as ServiceCategory;
                    setServiceCategory(cat);
                    setSiteServiceId('');
                    const firstSvc = services.find(
                      (sv) => sv.status === 'Active' && sv.serviceCategory === cat
                    );
                    const nextSvcId = firstSvc?.serviceId || '';
                    setServiceId(nextSvcId);
                    const firstDesig = designations.find(
                      (d) =>
                        d.status === 'Active' &&
                        d.serviceCategory === cat &&
                        (!nextSvcId || d.relatedServiceId === nextSvcId)
                    );
                    setDesignationId(firstDesig?.designationId || '');
                  }}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                >
                  {SERVICE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Service <span className="text-red-600">*</span>
                </label>
                <select
                  value={serviceId}
                  onChange={(e) => {
                    const nextSvc = e.target.value;
                    setServiceId(nextSvc);
                    setSiteServiceId('');
                    const firstDesig = designations.find(
                      (d) =>
                        d.status === 'Active' &&
                        d.serviceCategory === serviceCategory &&
                        d.relatedServiceId === nextSvc
                    );
                    if (firstDesig) setDesignationId(firstDesig.designationId);
                  }}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                >
                  <option value="">Select Service</option>
                  {filteredServices.map((sv) => (
                    <option key={sv.serviceId} value={sv.serviceId}>
                      {sv.serviceName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Designation <span className="text-red-600">*</span>
                </label>
                <select
                  value={designationId}
                  onChange={(e) => {
                    setDesignationId(e.target.value);
                    setSiteServiceId('');
                  }}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                >
                  <option value="">Select Designation</option>
                  {filteredDesignations.map((d) => (
                    <option key={d.designationId} value={d.designationId}>
                      {d.designationName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Employee Selection & Qualification Verification */}
          <div className="rounded-lg border border-[#E5DDD3] bg-[#FAF8F5] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#5C3D2E]">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>2. Employee Selection & Eligibility Check</span>
              </div>
              {mode === 'create' && (
                <label className="inline-flex items-center gap-1.5 text-xs text-[#4A3E36] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showEligibleEmployeesOnly}
                    onChange={(e) => setShowEligibleEmployeesOnly(e.target.checked)}
                    className="rounded border-[#C9BEB2] text-[#5C3D2E] focus:ring-[#5C3D2E]"
                  />
                  <span>Show only employees verified for selected designation</span>
                </label>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                Employee <span className="text-red-600">*</span>
              </label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={mode === 'transfer' || mode === 'edit'}
                className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] disabled:bg-[#EFE9E0] focus:border-[#5C3D2E] focus:outline-none"
                required
              >
                <option value="">
                  {candidateEmployees.length === 0
                    ? 'No matching employees found in your scope'
                    : 'Select Employee'}
                </option>
                {candidateEmployees.map((emp) => {
                  const desigs =
                    emp.assignedDesignations.map((d) => d.designationName).join(', ') ||
                    'No Approved Designation';
                  const elig = designationId
                    ? validateEmployeeEligibilityForAssignment(
                        emp,
                        designationId,
                        serviceCategory,
                        serviceId
                      )
                    : { valid: emp.isActive && emp.employeeStatus === 'Active' };
                  return (
                    <option key={emp.employeeId} value={emp.employeeId}>
                      {elig.valid ? '[ELIGIBLE] ' : '[INELIGIBLE] '}
                      {emp.fullName} ({emp.employeeId}) — {emp.employeeStatus} | {desigs}
                    </option>
                  );
                })}
              </select>
            </div>

            {liveAdvisory && (
              <div
                className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
                  liveAdvisory.type === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                {liveAdvisory.type === 'ok' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-700" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
                )}
                <span>{liveAdvisory.message}</span>
              </div>
            )}
          </div>

          {/* Section 3: Shift, Duty Dates & Reporting */}
          <div className="rounded-lg border border-[#E5DDD3] bg-[#FAF8F5] p-4 space-y-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#5C3D2E]">
              <Clock className="h-3.5 w-3.5" />
              <span>3. Duty Dates, Shift Window & Reporting</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  {mode === 'transfer' ? 'Transfer Effective Date' : 'Duty Start Date'}{' '}
                  <span className="text-red-600">*</span>
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm font-mono-tabular text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Duty End Date <span className="text-red-600">*</span>
                </label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm font-mono-tabular text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Weekly Off <span className="text-red-600">*</span>
                </label>
                <select
                  value={weeklyOff}
                  onChange={(e) => setWeeklyOff(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                >
                  {WEEKLY_OFF_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Duty Shift <span className="text-red-600">*</span>
                </label>
                <select
                  value={shift}
                  onChange={(e) => handleShiftPresetChange(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                >
                  {STANDARD_SHIFTS.map((s) => (
                    <option key={s.code} value={s.label}>
                      {s.label}
                    </option>
                  ))}
                  {!STANDARD_SHIFTS.some((s) => s.label === shift) && (
                    <option value={shift}>{shift}</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Shift Start <span className="text-red-600">*</span>
                </label>
                <input
                  type="time"
                  value={shiftStartTime}
                  onChange={(e) => handleTimeChange(e.target.value, shiftEndTime)}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm font-mono-tabular text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Shift End <span className="text-red-600">*</span>
                </label>
                <input
                  type="time"
                  value={shiftEndTime}
                  onChange={(e) => handleTimeChange(shiftStartTime, e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm font-mono-tabular text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Reporting Time <span className="text-red-600">*</span>
                </label>
                <input
                  type="time"
                  value={reportingTime}
                  onChange={(e) => setReportingTime(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm font-mono-tabular text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Duty Hours / Shift <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={16}
                  step={0.5}
                  value={dutyHours}
                  onChange={(e) => setDutyHours(Number(e.target.value))}
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm font-mono-tabular text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                  required
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                  Reporting Instructions (Visible on Employee Portal)
                </label>
                <input
                  type="text"
                  value={reportingInstructions}
                  onChange={(e) => setReportingInstructions(e.target.value)}
                  placeholder="e.g. Report to Gate-1 Security Office 15 mins prior to shift with ID & baton"
                  className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#4A3E36] mb-1">
                Operational Remarks
              </label>
              <textarea
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Add deployment note, reliever context, or post assignment instructions..."
                className="w-full rounded-lg border border-[#D8CEC2] bg-white px-3 py-2 text-sm text-[#1F1916] focus:border-[#5C3D2E] focus:outline-none"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2 border-t border-[#E5DDD3]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#D8CEC2] bg-white px-4 py-2 text-sm font-medium text-[#4A3E36] hover:bg-[#FAF8F5]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#5C3D2E] px-5 py-2 text-sm font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60"
            >
              {submitting
                ? 'Validating & Saving...'
                : mode === 'transfer'
                  ? 'Confirm Site Transfer'
                  : mode === 'edit'
                    ? 'Save Assignment Changes'
                    : startDate > today
                      ? 'Schedule Upcoming Assignment'
                      : 'Confirm Site Assignment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
