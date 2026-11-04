import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  ShieldCheck,
  Upload,
  User,
  X,
} from 'lucide-react';
import {
  BranchRecord,
  DesignationRecord,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  EmployeeFormInput,
  EmployeePrivateRecord,
  EmployeeRecord,
  GENDERS,
  INDIAN_STATES,
  IssuedPortalCredentials,
  RexonUser,
  SALARY_TYPES,
  SERVICE_CATEGORIES,
  ServiceRecord,
  SiteRecord,
} from '../types';
import { generateDefaultPortalPassword } from '../services/firebase/config';
import {
  FieldOfficerOption,
  createEmployeeRecord,
  getEmployeePrivateData,
  listAvailableFieldOfficers,
  updateEmployeeRecord,
  uploadEmployeeProfilePhoto,
} from '../services/firestore/employeeService';
import { formatServiceErrorMessage } from '../services/firestore/errorHandler';
import { createBranchRecord } from '../services/firestore/masterDataService';
import {
  requirementNeedsVerification,
  validateEmployeeDocumentFile,
  validateEmployeeForm,
} from '../utils/employeeValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../utils/portalConfig';

interface EmployeeFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialEmployee?: EmployeeRecord | null;
  branches: BranchRecord[];
  services: ServiceRecord[];
  designations: DesignationRecord[];
  sites: SiteRecord[];
  caller: RexonUser;
  isPreviewSession: boolean;
  onClose: () => void;
  onSaved: (saved: EmployeeRecord, issuedCredentials?: IssuedPortalCredentials) => void;
}

type ModalSectionTab = 'personal' | 'employment' | 'financial';

function hasAnyFinancialOrKycInput(input: EmployeeFormInput): boolean {
  return Boolean(
    input.basicSalary.trim() ||
      input.bankAccountNumber.trim() ||
      input.bankName.trim() ||
      input.ifscCode.trim() ||
      input.panNumber.trim() ||
      input.aadhaarNumber.trim()
  );
}

function detectValidationErrorTab(errorMessage: string): ModalSectionTab {
  const msg = errorMessage.toLowerCase();
  if (
    msg.includes('basic salary') ||
    msg.includes('bank account') ||
    msg.includes('bank name') ||
    msg.includes('ifsc') ||
    msg.includes('pan number') ||
    msg.includes('aadhaar')
  ) {
    return 'financial';
  }
  if (
    msg.includes('joining date') ||
    msg.includes('assigned branch') ||
    msg.includes('service designation') ||
    msg.includes('multiple designations') ||
    msg.includes('designation "') ||
    msg.includes('qualification') ||
    msg.includes('training') ||
    msg.includes('assignment blocked') ||
    msg.includes('deployment site')
  ) {
    return 'employment';
  }
  return 'personal';
}

function buildEmptyForm(defaultBranchId: string, canEditSensitive: boolean): EmployeeFormInput {
  const today = new Date().toISOString().slice(0, 10);
  return {
    linkedUid: '',
    fullName: '',
    fatherOrSpouseName: '',
    dateOfBirth: '',
    gender: 'Male',
    mobile: '',
    alternateMobile: '',
    email: '',
    currentAddress: '',
    permanentAddress: '',
    city: '',
    state: 'Maharashtra',
    pinCode: '',
    emergencyContactName: '',
    emergencyContactNumber: '',
    profilePhoto: '',
    joiningDate: today,
    branchId: defaultBranchId,
    employmentType: 'Full-Time',
    employeeStatus: 'Active',
    selectedDesignationIds: [],
    eligibilityConfirmations: {},
    skillsAndExperience: '',
    qualification: '',
    trainingDetails: '',
    licenseDetails: '',
    reportingFieldOfficerUid: '',
    reportingFieldOfficerName: '',
    currentSiteId: '',
    notes: '',
    includePrivateFinancials: canEditSensitive,
    salaryType: 'Monthly',
    basicSalary: '',
    bankAccountNumber: '',
    bankAccountHolderName: '',
    bankName: '',
    ifscCode: '',
    panNumber: '',
    aadhaarNumber: '',
  };
}

export const EmployeeFormModal: React.FC<EmployeeFormModalProps> = ({
  open,
  mode,
  initialEmployee,
  branches,
  services,
  designations,
  sites,
  caller,
  isPreviewSession,
  onClose,
  onSaved,
}) => {
  const canEditSensitive =
    caller.role === 'admin' || hasUserPermission(caller, 'employee.sensitive');
  const canAssignMultiDesignations =
    caller.role === 'admin' || hasUserPermission(caller, 'employee.multi_designation');

  const authorizedBranches = useMemo(() => {
    const active = branches.filter((b) => !b.isDeleted);
    if (caller.role === 'admin') return active;
    const allowedIds = getAuthorizedBranchIds(caller);
    return active.filter((b) => allowedIds.includes(b.branchId));
  }, [branches, caller]);

  const defaultBranchId = authorizedBranches[0]?.branchId || caller.branchId || '';

  const canProvisionPortalLogin =
    mode === 'create' &&
    (caller.role === 'admin' ||
      (caller.role === 'hr' &&
        (hasUserPermission(caller, 'employee.manage') ||
          hasUserPermission(caller, 'employee.create'))));

  const formBodyRef = useRef<HTMLFormElement | null>(null);
  const [activeTab, setActiveTab] = useState<ModalSectionTab>('personal');
  const [form, setForm] = useState<EmployeeFormInput>(() =>
    buildEmptyForm(defaultBranchId, canEditSensitive)
  );
  const [portalInitialPassword, setPortalInitialPassword] = useState('');
  const [showPortalPassword, setShowPortalPassword] = useState(false);
  const [localQuickBranches, setLocalQuickBranches] = useState<BranchRecord[]>([]);
  const [creatingQuickBranch, setCreatingQuickBranch] = useState(false);
  const [sameAsCurrentAddress, setSameAsCurrentAddress] = useState(false);
  const [fieldOfficers, setFieldOfficers] = useState<FieldOfficerOption[]>([]);
  const [loadingPrivate, setLoadingPrivate] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveAuthorizedBranches = useMemo(() => {
    const merged = [...authorizedBranches];
    for (const qb of localQuickBranches) {
      if (!merged.some((b) => b.branchId === qb.branchId)) {
        merged.push(qb);
      }
    }
    return merged;
  }, [authorizedBranches, localQuickBranches]);

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setActiveTab('personal');
    setPortalInitialPassword('');
    setShowPortalPassword(false);
    void listAvailableFieldOfficers(caller, isPreviewSession).then(setFieldOfficers);

    if (mode === 'edit' && initialEmployee) {
      const confirmations: EmployeeFormInput['eligibilityConfirmations'] = {};
      for (const d of initialEmployee.assignedDesignations) {
        confirmations[d.designationId] = {
          qualificationVerified: d.qualificationVerified,
          trainingVerified: d.trainingVerified,
          licenseVerified: d.licenseVerified,
        };
      }

      setForm({
        linkedUid: initialEmployee.linkedUid || '',
        fullName: initialEmployee.fullName,
        fatherOrSpouseName: initialEmployee.fatherOrSpouseName,
        dateOfBirth: initialEmployee.dateOfBirth,
        gender: initialEmployee.gender,
        mobile: initialEmployee.mobile,
        alternateMobile: initialEmployee.alternateMobile,
        email: initialEmployee.email,
        currentAddress: initialEmployee.currentAddress,
        permanentAddress: initialEmployee.permanentAddress,
        city: initialEmployee.city,
        state: initialEmployee.state,
        pinCode: initialEmployee.pinCode,
        emergencyContactName: initialEmployee.emergencyContactName,
        emergencyContactNumber: initialEmployee.emergencyContactNumber,
        profilePhoto: initialEmployee.profilePhoto,
        joiningDate: initialEmployee.joiningDate,
        branchId: initialEmployee.branchId,
        employmentType: initialEmployee.employmentType,
        employeeStatus: initialEmployee.employeeStatus,
        selectedDesignationIds: [...initialEmployee.assignedDesignationIds],
        eligibilityConfirmations: confirmations,
        skillsAndExperience: initialEmployee.skillsAndExperience,
        qualification: initialEmployee.qualification,
        trainingDetails: initialEmployee.trainingDetails,
        licenseDetails: initialEmployee.licenseDetails,
        reportingFieldOfficerUid: initialEmployee.reportingFieldOfficerUid,
        reportingFieldOfficerName: initialEmployee.reportingFieldOfficerName,
        currentSiteId: initialEmployee.currentSiteId,
        notes: initialEmployee.notes,
        includePrivateFinancials: false,
        salaryType: 'Monthly',
        basicSalary: '',
        bankAccountNumber: '',
        bankAccountHolderName: initialEmployee.fullName,
        bankName: '',
        ifscCode: '',
        panNumber: '',
        aadhaarNumber: '',
      });
      setSameAsCurrentAddress(
        Boolean(
          initialEmployee.currentAddress &&
            initialEmployee.currentAddress === initialEmployee.permanentAddress
        )
      );

      if (canEditSensitive) {
        setLoadingPrivate(true);
        void getEmployeePrivateData(
          caller,
          isPreviewSession,
          initialEmployee.employeeId,
          initialEmployee.branchId
        )
          .then((priv: EmployeePrivateRecord | null) => {
            if (priv) {
              setForm((prev) => ({
                ...prev,
                includePrivateFinancials: true,
                salaryType: priv.salaryType,
                basicSalary: String(priv.basicSalary || ''),
                bankAccountNumber: priv.bankAccountNumber || '',
                bankAccountHolderName: priv.bankAccountHolderName || initialEmployee.fullName,
                bankName: priv.bankName || '',
                ifscCode: priv.ifscCode || '',
                panNumber: priv.panNumber || '',
                aadhaarNumber: priv.aadhaarNumber || '',
              }));
            }
          })
          .finally(() => setLoadingPrivate(false));
      }
    } else {
      setSameAsCurrentAddress(false);
      setForm(buildEmptyForm(defaultBranchId, canEditSensitive));
    }
  }, [open, mode, initialEmployee, defaultBranchId, canEditSensitive, caller, isPreviewSession]);

  const activeServicesMap = useMemo(() => {
    const map = new Map<string, ServiceRecord>();
    for (const s of services) {
      if (s.status === 'Active') {
        map.set(s.serviceId, s);
      }
    }
    return map;
  }, [services]);

  const activeDesignationsByCategory = useMemo(() => {
    const grouped: Record<string, DesignationRecord[]> = {
      Security: [],
      Housekeeping: [],
      Manpower: [],
    };
    for (const d of designations) {
      if (d.status !== 'Active') continue;
      // Ensure parent service is also active if present
      if (services.length > 0 && !activeServicesMap.has(d.relatedServiceId)) continue;
      if (grouped[d.serviceCategory]) {
        grouped[d.serviceCategory].push(d);
      }
    }
    return grouped;
  }, [designations, services.length, activeServicesMap]);

  const branchSites = useMemo(() => {
    return sites.filter(
      (s) => !s.isArchived && s.siteStatus === 'Active' && (!form.branchId || s.branchId === form.branchId)
    );
  }, [sites, form.branchId]);

  const selectedDesignationObjects = useMemo(() => {
    return form.selectedDesignationIds
      .map((id) => designations.find((d) => d.designationId === id))
      .filter((d): d is DesignationRecord => Boolean(d));
  }, [form.selectedDesignationIds, designations]);

  if (!open) return null;

  const scrollToModalTop = () => {
    window.requestAnimationFrame(() => {
      formBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const handleQuickCreateBranch = async () => {
    if (caller.role !== 'admin') return;
    setCreatingQuickBranch(true);
    setErrorMsg(null);
    try {
      const validPhone =
        caller.phone && caller.phone.replace(/\D/g, '').length >= 10
          ? caller.phone
          : '+91 98201 10001';
      const validEmail =
        caller.email && caller.email.includes('@')
          ? caller.email
          : 'mumbai.hq@rexonsecurity.com';
      const validManager =
        caller.fullName && caller.fullName.trim().length >= 2
          ? caller.fullName.trim()
          : 'Admin Manager';

      const created = await createBranchRecord(caller, isPreviewSession, {
        branchName: 'Mumbai Corporate & Western Command',
        branchCode: 'MUM-HQ',
        managerName: validManager,
        mobile: validPhone,
        email: validEmail,
        address: '402, Heritage Corporate Plaza, Andheri East',
        city: 'Mumbai',
        state: 'Maharashtra',
        pinCode: '400069',
        status: 'Active',
      });
      setLocalQuickBranches((prev) => [...prev, created]);
      setForm((prev) => ({ ...prev, branchId: created.branchId }));
    } catch (err) {
      setErrorMsg(formatServiceErrorMessage(err));
      scrollToModalTop();
    } finally {
      setCreatingQuickBranch(false);
    }
  };

  const handleToggleDesignation = (designationId: string) => {
    setErrorMsg(null);
    const desigObj = designations.find((d) => d.designationId === designationId);
    setForm((prev) => {
      const exists = prev.selectedDesignationIds.includes(designationId);
      if (exists) {
        const nextIds = prev.selectedDesignationIds.filter((id) => id !== designationId);
        return { ...prev, selectedDesignationIds: nextIds };
      }

      const autoQual =
        mode === 'create' &&
        !prev.qualification.trim() &&
        desigObj &&
        requirementNeedsVerification(desigObj.qualification)
          ? desigObj.qualification
          : prev.qualification;

      const autoTrain =
        mode === 'create' &&
        !prev.trainingDetails.trim() &&
        desigObj &&
        requirementNeedsVerification(desigObj.trainingRequirements)
          ? desigObj.trainingRequirements
          : prev.trainingDetails;

      if (!canAssignMultiDesignations && prev.selectedDesignationIds.length >= 1) {
        // Replace single selection when caller lacks multi-designation permission
        return {
          ...prev,
          qualification: autoQual,
          trainingDetails: autoTrain,
          selectedDesignationIds: [designationId],
          eligibilityConfirmations: {
            ...prev.eligibilityConfirmations,
            [designationId]: prev.eligibilityConfirmations[designationId] ?? {
              qualificationVerified: true,
              trainingVerified: true,
              licenseVerified: false,
            },
          },
        };
      }

      return {
        ...prev,
        qualification: autoQual,
        trainingDetails: autoTrain,
        selectedDesignationIds: [...prev.selectedDesignationIds, designationId],
        eligibilityConfirmations: {
          ...prev.eligibilityConfirmations,
          [designationId]: prev.eligibilityConfirmations[designationId] ?? {
            qualificationVerified: true,
            trainingVerified: true,
            licenseVerified: false,
          },
        },
      };
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.currentTarget;
    const file = inputEl.files?.[0] ?? null;
    if (!file) return;
    setErrorMsg(null);
    const check = validateEmployeeDocumentFile(file, 'Photograph');
    if (!check.valid) {
      inputEl.value = '';
      setErrorMsg(check.error ?? 'Invalid photograph.');
      scrollToModalTop();
      return;
    }

    setUploadingPhoto(true);
    try {
      const url = await uploadEmployeeProfilePhoto(
        caller,
        isPreviewSession,
        form.branchId || defaultBranchId || 'GENERAL',
        initialEmployee?.employeeId || 'NEW_EMP',
        file
      );
      setForm((prev) => ({ ...prev, profilePhoto: url }));
    } catch (err) {
      setErrorMsg(formatServiceErrorMessage(err));
      scrollToModalTop();
    } finally {
      inputEl.value = '';
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const effectiveForm: EmployeeFormInput =
      mode === 'create' && !hasAnyFinancialOrKycInput(form)
        ? { ...form, includePrivateFinancials: false }
        : form;

    if (portalInitialPassword.trim().length > 0 && portalInitialPassword.trim().length < 6) {
      setActiveTab('personal');
      setErrorMsg('Employee Portal Login Password must be at least 6 characters long.');
      scrollToModalTop();
      return;
    }

    const check = validateEmployeeForm(effectiveForm, designations, caller);
    if (!check.valid) {
      const msg = check.error ?? 'Please complete all required employee fields.';
      setActiveTab(detectValidationErrorTab(msg));
      setErrorMsg(msg);
      scrollToModalTop();
      return;
    }

    setSaving(true);
    try {
      if (mode === 'edit' && initialEmployee) {
        const updated = await updateEmployeeRecord(
          caller,
          isPreviewSession,
          initialEmployee.employeeId,
          effectiveForm
        );
        onSaved(updated);
      } else {
        const created = await createEmployeeRecord(caller, isPreviewSession, effectiveForm, {
          initialPassword: portalInitialPassword.trim() || undefined,
        });
        onSaved(created, created.issuedCredentials);
      }
    } catch (err) {
      const formatted = formatServiceErrorMessage(err);
      setActiveTab(detectValidationErrorTab(formatted));
      setErrorMsg(formatted);
      scrollToModalTop();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-3 sm:p-5 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="emp-form-modal-title"
    >
      <div className="w-full max-w-4xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl my-auto max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[#E5DDD2] shrink-0">
          <div>
            <h2
              id="emp-form-modal-title"
              className="font-display text-lg sm:text-xl font-bold text-[#1F1916]"
            >
              {mode === 'edit' && initialEmployee
                ? `Edit Employee · ${initialEmployee.employeeId}`
                : 'Register New Employee'}
            </h2>
            <p className="mt-0.5 text-xs text-[#574B43]">
              {mode === 'edit'
                ? 'Update operational profile, dynamic service designations, and isolated KYC records.'
                : 'Auto-generates unique Employee ID and isolates sensitive financial/KYC data in employeePrivate.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section Tabs */}
        <div className="px-5 sm:px-6 pt-3 pb-2 bg-[#FAF8F5] border-b border-[#E5DDD2] flex flex-wrap gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('personal')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === 'personal'
                ? 'bg-[#5C3D2E] text-white'
                : 'bg-white border border-[#E5DDD2] text-[#574B43] hover:text-[#1F1916]'
            }`}
          >
            1. Personal Information
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('employment')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === 'employment'
                ? 'bg-[#5C3D2E] text-white'
                : 'bg-white border border-[#E5DDD2] text-[#574B43] hover:text-[#1F1916]'
            }`}
          >
            2. Employment &amp; Designations ({form.selectedDesignationIds.length})
          </button>
          {canEditSensitive && (
            <button
              type="button"
              onClick={() => setActiveTab('financial')}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
                activeTab === 'financial'
                  ? 'bg-[#5C3D2E] text-white'
                  : 'bg-white border border-[#E5DDD2] text-[#574B43] hover:text-[#1F1916]'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>3. Salary &amp; Sensitive KYC</span>
            </button>
          )}
        </div>

        {/* Form Body */}
        <form
          ref={formBodyRef}
          onSubmit={(e) => void handleSubmit(e)}
          className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6"
        >
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* TAB 1: PERSONAL INFORMATION */}
          {activeTab === 'personal' && (
            <div className="space-y-5">
              {/* Profile Photo Upload */}
              <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  {form.profilePhoto ? (
                    <img
                      src={form.profilePhoto}
                      alt={form.fullName || 'Employee'}
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-xl object-cover border border-[#D4C7B8] shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] text-[#5C3D2E] flex items-center justify-center shrink-0">
                      <User className="w-6 h-6" />
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-semibold text-[#1F1916] flex items-center gap-2">
                      <span>Employee Passport Photograph</span>
                      {form.profilePhoto && (
                        <span className="text-[11px] font-semibold text-[#166534]">
                          · Photo Ready
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#574B43]">
                      JPG, PNG, or WEBP up to 15 MB · Instant auto-compression &amp; preview
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="min-h-[40px] px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Upload className="w-3.5 h-3.5 text-[#5C3D2E]" />
                    <span>
                      {uploadingPhoto
                        ? 'Processing Photo...'
                        : form.profilePhoto
                          ? 'Change Photo'
                          : 'Choose Photo'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploadingPhoto}
                      onChange={(e) => void handlePhotoUpload(e)}
                    />
                  </label>
                  {form.profilePhoto && (
                    <button
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, profilePhoto: '' }))}
                      className="min-h-[40px] px-3 py-2 rounded-lg text-xs font-medium text-[#B91C1C] hover:bg-[#FEF2F2]"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Full Name <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        fullName: e.target.value,
                        bankAccountHolderName: p.bankAccountHolderName || e.target.value,
                      }))
                    }
                    placeholder="e.g. Ramesh Kumar Yadav"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Father&apos;s / Spouse&apos;s Name <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.fatherOrSpouseName}
                    onChange={(e) => setForm((p) => ({ ...p, fatherOrSpouseName: e.target.value }))}
                    placeholder="e.g. Mahendra Prasad Yadav"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Date of Birth (18+ yrs) <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setForm((p) => ({ ...p, dateOfBirth: e.target.value }))}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Gender <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={form.gender}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        gender: e.target.value as EmployeeFormInput['gender'],
                      }))
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {GENDERS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Primary Mobile Number <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="tel"
                    value={form.mobile}
                    onChange={(e) => setForm((p) => ({ ...p, mobile: e.target.value }))}
                    placeholder="+91 98201 55410"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Alternate Mobile Number
                  </label>
                  <input
                    type="tel"
                    value={form.alternateMobile}
                    onChange={(e) => setForm((p) => ({ ...p, alternateMobile: e.target.value }))}
                    placeholder="Optional secondary number"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Email Address (Optional · Auto-generates EMP-YYYY-XXXX Login ID if left blank)
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="e.g. employee@rexon.com (or leave blank to login with Employee ID)"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                {canProvisionPortalLogin && (
                  <div className="sm:col-span-2 lg:col-span-3 p-4 rounded-xl bg-[#FAF8F5] border border-[#D4C7B8] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-[#1F1916] inline-flex items-center gap-1.5">
                        <KeyRound className="w-4 h-4 text-[#5C3D2E]" />
                        <span>Employee Portal Login ID &amp; Password (Issued Automatically on Save)</span>
                      </div>
                      <span className="text-[11px] font-medium text-[#5C3D2E]">
                        Strict Self-Record Isolation
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#574B43] mb-1">
                          Employee Portal Login ID
                        </label>
                        <div className="min-h-[40px] px-3 py-2 rounded-lg bg-white border border-[#E5DDD2] text-xs font-mono-tabular font-semibold text-[#1F1916] flex items-center">
                          {form.email.trim().toLowerCase() || 'Auto Employee ID (EMP-YYYY-XXXX)'}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#574B43] mb-1">
                          Initial Portal Password (Optional Custom · Min 6 chars)
                        </label>
                        <div className="relative">
                          <input
                            type={showPortalPassword ? 'text' : 'password'}
                            value={portalInitialPassword}
                            onChange={(e) => setPortalInitialPassword(e.target.value)}
                            placeholder={`Auto: ${generateDefaultPortalPassword(form.mobile)}`}
                            className="w-full min-h-[40px] pl-3.5 pr-9 py-1.5 text-xs font-mono-tabular bg-white border border-[#E5DDD2] rounded-lg focus:outline-none focus:border-[#5C3D2E]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPortalPassword((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7D6F65] hover:text-[#1F1916]"
                            aria-label={showPortalPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPortalPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Current Residential Address <span className="text-[#B91C1C]">*</span>
                  </label>
                  <textarea
                    rows={2}
                    value={form.currentAddress}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((p) => ({
                        ...p,
                        currentAddress: val,
                        ...(sameAsCurrentAddress ? { permanentAddress: val } : {}),
                      }));
                    }}
                    placeholder="House/Chawl/Flat No., Street, Area, Landmark..."
                    className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-semibold text-[#1F1916]">
                      Permanent Address <span className="text-[#B91C1C]">*</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-[#5C3D2E] font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sameAsCurrentAddress}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSameAsCurrentAddress(checked);
                          if (checked) {
                            setForm((p) => ({ ...p, permanentAddress: p.currentAddress }));
                          }
                        }}
                        className="rounded border-[#D4C7B8] text-[#5C3D2E] focus:ring-[#5C3D2E]"
                      />
                      <span>Same as Current Address</span>
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={form.permanentAddress}
                    onChange={(e) => setForm((p) => ({ ...p, permanentAddress: e.target.value }))}
                    placeholder="Native / permanent home address..."
                    className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    City <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                    placeholder="e.g. Mumbai"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    State <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={form.state}
                    onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {INDIAN_STATES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    PIN Code <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    value={form.pinCode}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, pinCode: e.target.value.replace(/\D/g, '') }))
                    }
                    placeholder="400001"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Emergency Contact Person Name &amp; Relation{' '}
                    <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.emergencyContactName}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, emergencyContactName: e.target.value }))
                    }
                    placeholder="e.g. Sunita Yadav (Spouse)"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Emergency Contact Mobile <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="tel"
                    value={form.emergencyContactNumber}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, emergencyContactNumber: e.target.value }))
                    }
                    placeholder="+91 98201 99100"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: EMPLOYMENT & DYNAMIC DESIGNATION ELIGIBILITY */}
          {activeTab === 'employment' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Joining Date <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.joiningDate}
                    onChange={(e) => setForm((p) => ({ ...p, joiningDate: e.target.value }))}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Assigned Branch <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={form.branchId}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        branchId: e.target.value,
                        currentSiteId: '',
                      }))
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    <option value="">Select Branch...</option>
                    {effectiveAuthorizedBranches.map((b) => (
                      <option key={b.branchId} value={b.branchId}>
                        {b.branchCode} — {b.city}
                      </option>
                    ))}
                  </select>
                  {effectiveAuthorizedBranches.length === 0 && caller.role === 'admin' && (
                    <button
                      type="button"
                      disabled={creatingQuickBranch}
                      onClick={() => void handleQuickCreateBranch()}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#5C3D2E] hover:underline disabled:opacity-60"
                    >
                      <Plus className="w-3 h-3" />
                      <span>
                        {creatingQuickBranch
                          ? 'Creating HQ Branch...'
                          : 'Quick-Create HQ Branch (MUM-HQ)'}
                      </span>
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Employment Type <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={form.employmentType}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        employmentType: e.target.value as EmployeeFormInput['employmentType'],
                      }))
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {EMPLOYMENT_TYPES.map((et) => (
                      <option key={et} value={et}>
                        {et}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Employee Status <span className="text-[#B91C1C]">*</span>
                  </label>
                  <select
                    value={form.employeeStatus}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        employeeStatus: e.target.value as EmployeeFormInput['employeeStatus'],
                      }))
                    }
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    {EMPLOYEE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Current Deployment Site (Optional — Leave Empty for Available Pool)
                  </label>
                  <select
                    value={form.currentSiteId}
                    onChange={(e) => setForm((p) => ({ ...p, currentSiteId: e.target.value }))}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    <option value="">Unassigned (Available Bench Pool)</option>
                    {branchSites.map((s) => (
                      <option key={s.siteId} value={s.siteId}>
                        {s.siteId} — {s.siteName} ({s.clientName})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Reporting Field Officer
                  </label>
                  <select
                    value={form.reportingFieldOfficerUid}
                    onChange={(e) => {
                      const fo = fieldOfficers.find((f) => f.uid === e.target.value);
                      setForm((p) => ({
                        ...p,
                        reportingFieldOfficerUid: e.target.value,
                        reportingFieldOfficerName: fo ? fo.fullName : p.reportingFieldOfficerName,
                      }));
                    }}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  >
                    <option value="">Select Field Officer...</option>
                    {fieldOfficers.map((fo) => (
                      <option key={fo.uid} value={fo.uid}>
                        {fo.fullName} ({fo.uid})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Field Officer Name
                  </label>
                  <input
                    type="text"
                    value={form.reportingFieldOfficerName}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, reportingFieldOfficerName: e.target.value }))
                    }
                    placeholder="e.g. Vikram Singh"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>
              </div>

              {/* Dynamic Firestore Services & Designations Picker */}
              <div className="pt-4 border-t border-[#E5DDD2] space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-[#1F1916] flex items-center gap-1.5">
                      <Award className="w-4 h-4 text-[#5C3D2E]" />
                      <span>
                        Authorized Services &amp; Designations{' '}
                        <span className="text-[#B91C1C]">*</span>
                      </span>
                    </h3>
                    <p className="text-xs text-[#574B43]">
                      Loaded dynamically from Firestore Master Designation Catalog.{' '}
                      {canAssignMultiDesignations
                        ? 'You can assign one or multiple cross-trained designations.'
                        : 'Single designation selection active (multi-designation requires employee.multi_designation).'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {SERVICE_CATEGORIES.map((category) => {
                    const list = activeDesignationsByCategory[category] || [];
                    return (
                      <div
                        key={category}
                        className="bg-[#FAF8F5] border border-[#E5DDD2] rounded-xl p-3.5 space-y-2.5"
                      >
                        <div className="text-xs font-semibold text-[#5C3D2E] flex items-center justify-between">
                          <span>{category} Services</span>
                          <span className="font-mono-tabular text-[#7D6F65]">{list.length}</span>
                        </div>
                        {list.length === 0 ? (
                          <p className="text-xs text-[#7D6F65]">
                            No active designations configured under {category}.
                          </p>
                        ) : (
                          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                            {list.map((d) => {
                              const checked = form.selectedDesignationIds.includes(d.designationId);
                              return (
                                <label
                                  key={d.designationId}
                                  className={`flex items-start gap-2.5 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                                    checked
                                      ? 'bg-white border-[#5C3D2E] text-[#1F1916]'
                                      : 'bg-white/70 border-[#E5DDD2] text-[#574B43] hover:border-[#D4C7B8]'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => handleToggleDesignation(d.designationId)}
                                    className="mt-0.5 rounded border-[#D4C7B8] text-[#5C3D2E] focus:ring-[#5C3D2E]"
                                  />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-[#1F1916] leading-snug">
                                      {d.designationName}
                                    </div>
                                    <div className="text-[11px] text-[#7D6F65] truncate">
                                      Service: {d.relatedServiceName}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Qualification, Training, License & Skills Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Educational Qualification <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.qualification}
                    onChange={(e) => setForm((p) => ({ ...p, qualification: e.target.value }))}
                    placeholder="e.g. 12th Pass (HSC) / Ex-Serviceman / ITI"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Completed Training Details <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.trainingDetails}
                    onChange={(e) => setForm((p) => ({ ...p, trainingDetails: e.target.value }))}
                    placeholder="e.g. PSARA 20-Day Induction & Fire Drill Certified"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    License / Police Verification Reference (Mandatory for Licensed Roles)
                  </label>
                  <input
                    type="text"
                    value={form.licenseDetails}
                    onChange={(e) => setForm((p) => ({ ...p, licenseDetails: e.target.value }))}
                    placeholder="e.g. PVC Ref #MH-2026-88412 / Arms Lic #AL-4410"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Skills &amp; Prior Experience
                  </label>
                  <input
                    type="text"
                    value={form.skillsAndExperience}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, skillsAndExperience: e.target.value }))
                    }
                    placeholder="e.g. 4 yrs industrial gate control, visitor management, firefighting"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                    Operational Notes / Remarks
                  </label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Shift preference, language proficiency, uniform size, or deployment notes..."
                    className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                  />
                </div>
              </div>

              {/* Mandatory Designation Eligibility Verification Checklist */}
              {selectedDesignationObjects.length > 0 && (
                <div className="p-4 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#5C3D2E]" />
                    <h4 className="font-display text-sm font-semibold text-[#1F1916]">
                      Mandatory Designation Eligibility Verification
                    </h4>
                  </div>
                  <p className="text-xs text-[#574B43]">
                    Assignment is blocked unless mandatory qualification, training, and license
                    criteria defined in the Master Designation record are verified below:
                  </p>

                  <div className="space-y-3">
                    {selectedDesignationObjects.map((desig) => {
                      const conf = form.eligibilityConfirmations[desig.designationId] ?? {
                        qualificationVerified: false,
                        trainingVerified: false,
                        licenseVerified: false,
                      };
                      const needsQual = requirementNeedsVerification(desig.qualification);
                      const needsTrain = requirementNeedsVerification(desig.trainingRequirements);
                      const needsLic = requirementNeedsVerification(desig.licenseRequirements);

                      return (
                        <div
                          key={desig.designationId}
                          className="bg-white border border-[#E5DDD2] rounded-lg p-3.5 space-y-2.5 text-xs"
                        >
                          <div className="font-semibold text-[#1F1916]">
                            {desig.designationName}{' '}
                            <span className="font-normal text-[#7D6F65]">
                              · {desig.serviceCategory} · {desig.relatedServiceName}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            {needsQual && (
                              <label className="flex items-start gap-2 cursor-pointer text-[#1F1916]">
                                <input
                                  type="checkbox"
                                  checked={conf.qualificationVerified}
                                  onChange={(e) =>
                                    setForm((p) => ({
                                      ...p,
                                      eligibilityConfirmations: {
                                        ...p.eligibilityConfirmations,
                                        [desig.designationId]: {
                                          ...conf,
                                          qualificationVerified: e.target.checked,
                                        },
                                      },
                                    }))
                                  }
                                  className="mt-0.5 rounded border-[#D4C7B8] text-[#5C3D2E]"
                                />
                                <span>
                                  <strong className="block">Qualification Verified</strong>
                                  <span className="text-[#574B43]">{desig.qualification}</span>
                                </span>
                              </label>
                            )}

                            {needsTrain && (
                              <label className="flex items-start gap-2 cursor-pointer text-[#1F1916]">
                                <input
                                  type="checkbox"
                                  checked={conf.trainingVerified}
                                  onChange={(e) =>
                                    setForm((p) => ({
                                      ...p,
                                      eligibilityConfirmations: {
                                        ...p.eligibilityConfirmations,
                                        [desig.designationId]: {
                                          ...conf,
                                          trainingVerified: e.target.checked,
                                        },
                                      },
                                    }))
                                  }
                                  className="mt-0.5 rounded border-[#D4C7B8] text-[#5C3D2E]"
                                />
                                <span>
                                  <strong className="block">Training Verified</strong>
                                  <span className="text-[#574B43]">
                                    {desig.trainingRequirements}
                                  </span>
                                </span>
                              </label>
                            )}

                            {needsLic && (
                              <label className="flex items-start gap-2 cursor-pointer text-[#1F1916]">
                                <input
                                  type="checkbox"
                                  checked={conf.licenseVerified}
                                  onChange={(e) =>
                                    setForm((p) => ({
                                      ...p,
                                      eligibilityConfirmations: {
                                        ...p.eligibilityConfirmations,
                                        [desig.designationId]: {
                                          ...conf,
                                          licenseVerified: e.target.checked,
                                        },
                                      },
                                    }))
                                  }
                                  className="mt-0.5 rounded border-[#D4C7B8] text-[#5C3D2E]"
                                />
                                <span>
                                  <strong className="block text-[#9A3412]">
                                    Mandatory License / Clearance
                                  </strong>
                                  <span className="text-[#574B43]">
                                    {desig.licenseRequirements}
                                  </span>
                                </span>
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: FINANCIAL & SENSITIVE INFORMATION (ISOLATED IN employeePrivate) */}
          {activeTab === 'financial' && canEditSensitive && (
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-[#5C3D2E] shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-[#1F1916]">
                      Split-Collection PII Isolation (employeePrivate/&#123;employeeId&#125;)
                    </div>
                    <p className="text-[#574B43] mt-0.5">
                      Optional during initial registration — leave blank to configure later, or
                      enter Salary, Bank, PAN, and Aadhaar details below (isolated from Site &amp;
                      Field Officer portals).
                    </p>
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 font-semibold text-[#1F1916] cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={form.includePrivateFinancials}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, includePrivateFinancials: e.target.checked }))
                    }
                    className="rounded border-[#D4C7B8] text-[#5C3D2E]"
                  />
                  <span>Save Financial &amp; KYC Details</span>
                </label>
              </div>

              {loadingPrivate ? (
                <div className="py-8 text-center text-xs text-[#574B43]">
                  Loading isolated financial record...
                </div>
              ) : form.includePrivateFinancials ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Salary Type <span className="text-[#B91C1C]">*</span>
                    </label>
                    <select
                      value={form.salaryType}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          salaryType: e.target.value as EmployeeFormInput['salaryType'],
                        }))
                      }
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    >
                      {SALARY_TYPES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Basic Salary / Wage (₹) <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      value={form.basicSalary}
                      onChange={(e) => setForm((p) => ({ ...p, basicSalary: e.target.value }))}
                      placeholder="e.g. 18500"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Bank Name
                    </label>
                    <input
                      type="text"
                      value={form.bankName}
                      onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))}
                      placeholder="e.g. State Bank of India"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Account Holder Name
                    </label>
                    <input
                      type="text"
                      value={form.bankAccountHolderName}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, bankAccountHolderName: e.target.value }))
                      }
                      placeholder="Name as per bank passbook"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Bank Account Number
                    </label>
                    <input
                      type="text"
                      value={form.bankAccountNumber}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          bankAccountNumber: e.target.value.replace(/\D/g, ''),
                        }))
                      }
                      placeholder="9 to 18 digit account number"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Bank IFSC Code
                    </label>
                    <input
                      type="text"
                      maxLength={11}
                      value={form.ifscCode}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, ifscCode: e.target.value.toUpperCase() }))
                      }
                      placeholder="SBIN0001234"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular uppercase bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      PAN Number (10 Characters)
                    </label>
                    <input
                      type="text"
                      maxLength={10}
                      value={form.panNumber}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, panNumber: e.target.value.toUpperCase() }))
                      }
                      placeholder="ABCDE1234F"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular uppercase bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                      Aadhaar Number (12 Digits)
                    </label>
                    <input
                      type="text"
                      maxLength={12}
                      value={form.aadhaarNumber}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          aadhaarNumber: e.target.value.replace(/\D/g, ''),
                        }))
                      }
                      placeholder="12-digit UIDAI number"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm font-mono-tabular bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-5 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] text-xs text-[#574B43]">
                  Financial &amp; Sensitive KYC updates are skipped for this save. Enable the
                  checkbox above to record or modify salary, bank, PAN, or Aadhaar details.
                </div>
              )}
            </div>
          )}

          {/* Footer Navigation & Submit */}
          <div className="pt-4 border-t border-[#E5DDD2] space-y-3">
            {errorMsg && (
              <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-[#574B43]">
                <CheckCircle2 className="w-4 h-4 text-[#5C3D2E] shrink-0" />
                <span>
                  Selected Designations: <strong>{form.selectedDesignationIds.length}</strong>
                </span>
              </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="min-h-[42px] px-4 py-2 text-xs font-semibold text-[#1F1916] bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg hover:bg-[#F3EDE4]"
              >
                Cancel
              </button>
              {activeTab === 'personal' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('employment')}
                  className="min-h-[42px] px-4 py-2 text-xs font-semibold text-[#5C3D2E] bg-[#F3EDE4] border border-[#D4C7B8] rounded-lg hover:bg-[#E5DDD2]"
                >
                  Next: Employment &amp; Designations
                </button>
              )}
              {activeTab === 'employment' && canEditSensitive && (
                <button
                  type="button"
                  onClick={() => setActiveTab('financial')}
                  className="min-h-[42px] px-4 py-2 text-xs font-semibold text-[#5C3D2E] bg-[#F3EDE4] border border-[#D4C7B8] rounded-lg hover:bg-[#E5DDD2]"
                >
                  Next: Salary &amp; KYC
                </button>
              )}
              <button
                type="submit"
                disabled={saving || uploadingPhoto}
                className="min-h-[42px] px-5 py-2 text-xs font-semibold text-white bg-[#5C3D2E] rounded-lg hover:bg-[#4A3023] disabled:opacity-60 whitespace-nowrap"
              >
                {saving
                  ? 'Saving Employee...'
                  : mode === 'edit'
                    ? 'Save Employee Changes'
                    : 'Register Employee'}
              </button>
            </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
