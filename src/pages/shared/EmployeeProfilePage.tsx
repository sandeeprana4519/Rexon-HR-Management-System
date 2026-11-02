import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Award,
  Briefcase,
  CalendarCheck,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  Lock,
  MapPin,
  Phone,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmployeeFormModal } from '../../components/EmployeeFormModal';
import { EmptyStatePanel } from '../../components/EmptyStatePanel';
import { useAuth } from '../../hooks/useAuth';
import {
  deleteEmployeeDocument,
  getEmployeeById,
  getEmployeePrivateData,
  getOwnEmployeeRecord,
  listEmployeeDocuments,
  listEmployeeHistory,
  softDeleteEmployeeRecord,
  subscribeEmployeeData,
  toggleEmployeeActiveStatus,
  uploadEmployeeDocument,
  verifyEmployeeDocument,
} from '../../services/firestore/employeeService';
import {
  listEmployeeAssignments,
  listMyEmployeeAssignments,
  subscribeDeploymentData,
} from '../../services/firestore/assignmentService';
import { formatServiceErrorMessage } from '../../services/firestore/errorHandler';
import {
  listBranches,
  listDesignations,
  listServices,
  listSites,
  submitApprovalRequest,
} from '../../services/firestore/masterDataService';
import {
  BranchRecord,
  DesignationRecord,
  DocumentVerificationStatus,
  EMPLOYEE_DOCUMENT_TYPES,
  EmployeeAssignmentRecord,
  EmployeeDocumentRecord,
  EmployeeDocumentType,
  EmployeeHistoryRecord,
  EmployeePrivateRecord,
  EmployeeRecord,
  SENSITIVE_KYC_DOCUMENT_TYPES,
  ServiceRecord,
  SiteRecord,
} from '../../types';
import {
  calculateAgeYears,
  validateEmployeeDocumentFile,
} from '../../utils/employeeValidation';
import { hasUserPermission, ROLE_TO_PORTAL_BASE } from '../../utils/portalConfig';

interface EmployeeProfilePageProps {
  selfView?: boolean;
}

type ProfileTabKey =
  | 'overview'
  | 'personal'
  | 'employment'
  | 'designations'
  | 'documents'
  | 'salary'
  | 'site_history'
  | 'attendance'
  | 'activity';

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const EmployeeProfilePage: React.FC<EmployeeProfilePageProps> = ({
  selfView = false,
}) => {
  const { employeeId: routeEmployeeId } = useParams<{ employeeId: string }>();
  const { user, isPreviewSession } = useAuth();
  const navigate = useNavigate();

  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [privateData, setPrivateData] = useState<EmployeePrivateRecord | null>(null);
  const [documents, setDocuments] = useState<EmployeeDocumentRecord[]>([]);
  const [history, setHistory] = useState<EmployeeHistoryRecord[]>([]);
  const [employeeAssignments, setEmployeeAssignments] = useState<EmployeeAssignmentRecord[]>([]);

  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<ProfileTabKey>('overview');
  const [revealSensitiveNumbers, setRevealSensitiveNumbers] = useState(false);

  // Edit Modal
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Document Upload Modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadDocType, setUploadDocType] = useState<EmployeeDocumentType>('Aadhaar Document');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadRemarks, setUploadRemarks] = useState('');
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Document Preview Modal
  const [previewDoc, setPreviewDoc] = useState<EmployeeDocumentRecord | null>(null);

  // Document Verification Modal
  const [verifyTarget, setVerifyTarget] = useState<{
    doc: EmployeeDocumentRecord;
    nextStatus: DocumentVerificationStatus;
  } | null>(null);
  const [verifyRemarks, setVerifyRemarks] = useState('');
  const [verifyingDoc, setVerifyingDoc] = useState(false);

  // Document Delete Confirm
  const [deleteDocTarget, setDeleteDocTarget] = useState<EmployeeDocumentRecord | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);

  // Status Toggle & Soft Delete
  const [confirmToggleStatus, setConfirmToggleStatus] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [confirmSoftDelete, setConfirmSoftDelete] = useState(false);
  const [softDeleting, setSoftDeleting] = useState(false);

  const isAdmin = user?.role === 'admin';
  const isHR = user?.role === 'hr';
  const isFieldOfficer = user?.role === 'field_officer';
  const isEmployeeSelf = selfView || user?.role === 'employee';

  const canEdit = isAdmin || (isHR && hasUserPermission(user, 'employee.edit'));
  const canVerifyDocs = isAdmin || (isHR && hasUserPermission(user, 'employee.verify_docs'));
  const canUploadDocs =
    isAdmin ||
    (isHR &&
      (hasUserPermission(user, 'employee.edit') ||
        hasUserPermission(user, 'employee.create') ||
        hasUserPermission(user, 'employee.verify_docs')));
  const canViewSensitive =
    isAdmin || (isHR && hasUserPermission(user, 'employee.sensitive'));
  const canDirectDelete = isAdmin || (isHR && hasUserPermission(user, 'employee.delete'));

  const backListPath = useMemo(() => {
    if (isAdmin) return '/admin/employees';
    if (isHR) return '/hr/employees';
    if (isFieldOfficer) return '/field-officer/employees';
    return '/employee';
  }, [isAdmin, isHR, isFieldOfficer]);

  // Role-gated visible tabs (out of the 9 required tabs)
  const visibleTabs = useMemo(() => {
    const allTabs: { key: ProfileTabKey; label: string; show: boolean }[] = [
      { key: 'overview', label: 'Overview', show: true },
      { key: 'personal', label: 'Personal Information', show: !isFieldOfficer },
      { key: 'employment', label: 'Employment Details', show: true },
      { key: 'designations', label: 'Services and Designations', show: true },
      { key: 'documents', label: 'Documents', show: !isFieldOfficer },
      {
        key: 'salary',
        label: 'Salary Information',
        show: !isFieldOfficer && (canViewSensitive || isEmployeeSelf),
      },
      { key: 'site_history', label: 'Site Assignment History', show: true },
      { key: 'attendance', label: 'Attendance Summary', show: true },
      { key: 'activity', label: 'Activity History', show: !isFieldOfficer && !isEmployeeSelf },
    ];
    return allTabs.filter((t) => t.show);
  }, [isFieldOfficer, canViewSensitive, isEmployeeSelf]);

  useEffect(() => {
    if (!visibleTabs.some((t) => t.key === activeTab)) {
      setActiveTab('overview');
    }
  }, [visibleTabs, activeTab]);

  const loadProfileBundle = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const empRecord = isEmployeeSelf
        ? await getOwnEmployeeRecord(user, isPreviewSession)
        : routeEmployeeId
          ? await getEmployeeById(user, isPreviewSession, routeEmployeeId)
          : null;

      setEmployee(empRecord);

      if (!empRecord) {
        setPrivateData(null);
        setDocuments([]);
        setHistory([]);
        return;
      }

      const [priv, docs, hist, empAsns] = await Promise.all([
        getEmployeePrivateData(
          user,
          isPreviewSession,
          empRecord.employeeId,
          empRecord.branchId,
          empRecord.linkedUid
        ),
        listEmployeeDocuments(user, isPreviewSession, empRecord.employeeId),
        listEmployeeHistory(user, isPreviewSession, empRecord.employeeId),
        isEmployeeSelf
          ? listMyEmployeeAssignments(user, isPreviewSession)
          : listEmployeeAssignments(user, isPreviewSession, {
              employeeId: empRecord.employeeId,
            }),
      ]);

      setPrivateData(priv);
      setDocuments(docs);
      setHistory(hist);
      setEmployeeAssignments(empAsns);

      if (canEdit) {
        const [brList, srvList, dsgList, stList] = await Promise.all([
          listBranches(user, isPreviewSession),
          listServices(user, isPreviewSession),
          listDesignations(user, isPreviewSession),
          listSites(user, isPreviewSession),
        ]);
        setBranches(brList);
        setServices(srvList);
        setDesignations(dsgList);
        setSites(stList);
      }
    } catch (err) {
      setErrorMsg(formatServiceErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user, isPreviewSession, isEmployeeSelf, routeEmployeeId, canEdit]);

  useEffect(() => {
    void loadProfileBundle();
    const u1 = subscribeEmployeeData(() => {
      void loadProfileBundle();
    });
    const u2 = subscribeDeploymentData(() => {
      void loadProfileBundle();
    });
    return () => {
      u1();
      u2();
    };
  }, [loadProfileBundle]);

  const designationHistory = useMemo(
    () => history.filter((h) => h.category === 'Designation'),
    [history]
  );
  const siteHistory = useMemo(
    () => history.filter((h) => h.category === 'SiteAssignment'),
    [history]
  );

  const allowedDocumentTypesForUpload = useMemo(() => {
    if (canViewSensitive || canVerifyDocs) {
      return [...EMPLOYEE_DOCUMENT_TYPES];
    }
    return EMPLOYEE_DOCUMENT_TYPES.filter((dt) => !SENSITIVE_KYC_DOCUMENT_TYPES.includes(dt));
  }, [canViewSensitive, canVerifyDocs]);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !employee) return;
    setUploadErr(null);

    const check = validateEmployeeDocumentFile(uploadFile, uploadDocType);
    if (!check.valid || !uploadFile) {
      setUploadErr(check.error ?? 'Select a valid PDF or image file.');
      return;
    }

    setUploadingDoc(true);
    try {
      await uploadEmployeeDocument(user, isPreviewSession, {
        employeeId: employee.employeeId,
        documentType: uploadDocType,
        file: uploadFile,
        remarks: uploadRemarks,
      });
      setUploadModalOpen(false);
      setUploadFile(null);
      setUploadRemarks('');
      setFeedback({
        type: 'success',
        text: `${uploadDocType} uploaded to Firebase Storage and marked Pending Verification.`,
      });
      await loadProfileBundle();
    } catch (err) {
      setUploadErr(formatServiceErrorMessage(err));
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleConfirmVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !employee || !verifyTarget) return;
    setVerifyingDoc(true);
    try {
      await verifyEmployeeDocument(user, isPreviewSession, {
        documentId: verifyTarget.doc.documentId,
        employeeId: employee.employeeId,
        status: verifyTarget.nextStatus,
        remarks: verifyRemarks,
      });
      setFeedback({
        type: 'success',
        text: `${verifyTarget.doc.documentType} marked as ${verifyTarget.nextStatus}.`,
      });
      setVerifyTarget(null);
      setVerifyRemarks('');
      await loadProfileBundle();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
      setVerifyTarget(null);
    } finally {
      setVerifyingDoc(false);
    }
  };

  const handleConfirmDeleteDoc = async () => {
    if (!user || !employee || !deleteDocTarget) return;
    setDeletingDoc(true);
    try {
      await deleteEmployeeDocument(
        user,
        isPreviewSession,
        deleteDocTarget.documentId,
        employee.employeeId
      );
      setDeleteDocTarget(null);
      setFeedback({
        type: 'success',
        text: `Removed document ${deleteDocTarget.fileName}.`,
      });
      await loadProfileBundle();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
      setDeleteDocTarget(null);
    } finally {
      setDeletingDoc(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!user || !employee) return;
    const nextStatus = employee.employeeStatus === 'Active' ? 'Inactive' : 'Active';
    setTogglingStatus(true);
    try {
      await toggleEmployeeActiveStatus(user, isPreviewSession, employee.employeeId, nextStatus);
      setConfirmToggleStatus(false);
      setFeedback({
        type: 'success',
        text: `Employee status updated to ${nextStatus}.`,
      });
      await loadProfileBundle();
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
      setConfirmToggleStatus(false);
    } finally {
      setTogglingStatus(false);
    }
  };

  const handleSoftDeleteOrRequest = async () => {
    if (!user || !employee) return;
    setSoftDeleting(true);
    try {
      if (canDirectDelete) {
        await softDeleteEmployeeRecord(
          user,
          isPreviewSession,
          employee.employeeId,
          'Archived from Employee Profile page.'
        );
        setConfirmSoftDelete(false);
        navigate(backListPath);
      } else if (isHR) {
        const apr = await submitApprovalRequest(user, isPreviewSession, {
          requestType: 'Employee Deletion',
          module: 'Employee',
          targetRecordId: employee.employeeId,
          targetRecordName: employee.fullName,
          branchId: employee.branchId,
          summary: `Archive Employee ${employee.employeeId} (${employee.fullName})`,
          reason: 'Requested employee archival from Employee Profile view.',
        });
        setConfirmSoftDelete(false);
        setFeedback({
          type: 'success',
          text: `Submitted Employee Deletion request ${apr.approvalId} for Administrator review.`,
        });
      }
    } catch (err) {
      setFeedback({ type: 'error', text: formatServiceErrorMessage(err) });
      setConfirmSoftDelete(false);
    } finally {
      setSoftDeleting(false);
    }
  };

  if (!user) return null;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 rounded-xl bg-white border border-[#E5DDD2] animate-pulse" />
        <div className="h-72 rounded-xl bg-white border border-[#E5DDD2] animate-pulse" />
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => navigate(backListPath)}
          className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="p-5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-sm text-[#991B1B]">
          {errorMsg}
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="space-y-4">
        {!isEmployeeSelf && (
          <button
            type="button"
            onClick={() => navigate(backListPath)}
            className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Directory</span>
          </button>
        )}
        <EmptyStatePanel
          icon={User}
          title={
            isEmployeeSelf
              ? 'Your HR Master Employee Record Is Pending Onboarding'
              : 'Employee Record Not Found'
          }
          description={
            isEmployeeSelf
              ? `No Employee Master profile is currently linked to your UID (${user.uid}) or email (${user.email}). Once HR registers your profile with your email or UID, your verified personal details, designations, site assignments, and documents will appear here automatically.`
              : 'The requested Employee ID does not exist, has been archived, or is outside your authorized branch/site scope.'
          }
          actionLabel={!isEmployeeSelf ? 'Return to Employee Directory' : 'Back to Dashboard'}
          onAction={() => navigate(backListPath)}
        />
      </div>
    );
  }

  const ageYears = calculateAgeYears(employee.dateOfBirth);

  return (
    <div className="space-y-6">
      {/* Top Back Bar */}
      {!isEmployeeSelf && (
        <div>
          <button
            type="button"
            onClick={() => navigate(backListPath)}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E5DDD2] text-xs font-semibold text-[#574B43] hover:text-[#1F1916] hover:bg-[#F3EDE4]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>
              {isFieldOfficer ? 'Back to Personnel Roster' : 'Back to Employee Management'}
            </span>
          </button>
        </div>
      )}

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

      {/* Employee Header Card */}
      <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {employee.profilePhoto ? (
              <img
                src={employee.profilePhoto}
                alt={employee.fullName}
                className="w-20 h-20 rounded-xl object-cover border border-[#D4C7B8] shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] text-[#5C3D2E] font-display text-xl font-bold flex items-center justify-center shrink-0">
                {employee.fullName.slice(0, 2).toUpperCase()}
              </div>
            )}

            <div className="space-y-1">
              <div className="text-xs text-[#7D6F65] font-mono-tabular">
                {employee.employeeId} · {employee.employmentType} ·{' '}
                <span
                  className={
                    employee.employeeStatus === 'Active'
                      ? 'text-[#166534] font-semibold'
                      : 'text-[#B45309] font-semibold'
                  }
                >
                  {employee.employeeStatus}
                </span>
              </div>
              <h1 className="font-display text-2xl font-bold text-[#1F1916]">
                {employee.fullName}
              </h1>
              <div className="text-xs text-[#574B43]">
                {employee.assignedDesignations.map((d) => d.designationName).join(' · ') ||
                  'No Designation'}{' '}
                · {employee.branchName}
              </div>
              <div className="text-xs text-[#7D6F65] font-mono-tabular">
                Site:{' '}
                <strong className="text-[#1F1916]">
                  {employee.currentSiteId
                    ? `${employee.currentSiteId} (${employee.currentSiteName})`
                    : 'Unassigned · Available Pool'}
                </strong>{' '}
                · Joined {employee.joiningDate}
              </div>
            </div>
          </div>

          {/* Role-Gated Header Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {canUploadDocs && (
              <button
                type="button"
                onClick={() => {
                  setUploadErr(null);
                  setUploadDocType(allowedDocumentTypesForUpload[0] ?? 'Other Documents');
                  setUploadModalOpen(true);
                }}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4]"
              >
                <Upload className="w-3.5 h-3.5 text-[#5C3D2E]" />
                <span>Upload Document</span>
              </button>
            )}

            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => setEditModalOpen(true)}
                  className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Profile</span>
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmToggleStatus(true)}
                  className="min-h-[42px] px-3.5 py-2 rounded-lg bg-white border border-[#E5DDD2] text-xs font-semibold text-[#574B43] hover:text-[#1F1916] hover:bg-[#FAF8F5]"
                >
                  {employee.employeeStatus === 'Active' ? 'Deactivate' : 'Activate'}
                </button>
              </>
            )}

            {(canDirectDelete || isHR) && !isEmployeeSelf && !isFieldOfficer && (
              <button
                type="button"
                onClick={() => setConfirmSoftDelete(true)}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{canDirectDelete ? 'Soft Delete' : 'Request Archive'}</span>
              </button>
            )}
          </div>
        </div>

        {/* 9 Role-Filtered Interactive Tabs */}
        <div className="mt-6 pt-4 border-t border-[#E5DDD2] flex flex-wrap gap-1.5">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-[#5C3D2E] text-white'
                  : 'bg-[#FAF8F5] border border-[#E5DDD2] text-[#574B43] hover:text-[#1F1916] hover:bg-[#F3EDE4]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="lg:col-span-2 bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
            <h2 className="font-display text-base font-semibold text-[#1F1916]">
              Operational Deployment &amp; Profile Summary
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <div className="text-xs text-[#7D6F65]">Assigned Branch</div>
                <div className="mt-0.5 font-semibold text-[#1F1916]">{employee.branchName}</div>
              </div>
              <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <div className="text-xs text-[#7D6F65]">Current Site Assignment</div>
                <div className="mt-0.5 font-semibold text-[#1F1916]">
                  {employee.currentSiteId
                    ? `${employee.currentSiteId} — ${employee.currentSiteName}`
                    : 'Unassigned (Available Bench Pool)'}
                </div>
              </div>
              <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <div className="text-xs text-[#7D6F65]">Reporting Field Officer</div>
                <div className="mt-0.5 font-semibold text-[#1F1916]">
                  {employee.reportingFieldOfficerName || 'Not Assigned'}
                </div>
              </div>
              <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <div className="text-xs text-[#7D6F65]">Primary Contact &amp; City</div>
                <div className="mt-0.5 font-mono-tabular font-semibold text-[#1F1916]">
                  {employee.mobile} · {employee.city}, {employee.state}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#E5DDD2]">
              <div className="text-xs font-semibold text-[#574B43] mb-2">
                Approved Designations &amp; Service Categories
              </div>
              <div className="space-y-2">
                {employee.assignedDesignations.map((d) => (
                  <div
                    key={d.designationId}
                    className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-[#1F1916]">{d.designationName}</span>{' '}
                      <span className="text-[#7D6F65]">
                        · {d.serviceCategory} · {d.serviceName}
                      </span>
                    </div>
                    <div className="text-[#166534] font-medium">
                      Eligibility Verified · Assigned {d.assignedAt.slice(0, 10)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-[#F3EDE4] border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
            <h2 className="font-display text-base font-semibold text-[#1F1916]">
              Emergency &amp; Compliance Status
            </h2>

            <div className="p-4 rounded-lg bg-white border border-[#E5DDD2] space-y-1 text-xs">
              <div className="text-[#7D6F65] flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-[#5C3D2E]" />
                <span>Emergency Contact</span>
              </div>
              <div className="text-sm font-semibold text-[#1F1916]">
                {employee.emergencyContactName}
              </div>
              <div className="font-mono-tabular text-[#5C3D2E] font-medium">
                {employee.emergencyContactNumber}
              </div>
            </div>

            {!isFieldOfficer && (
              <div className="p-4 rounded-lg bg-white border border-[#E5DDD2] space-y-1 text-xs">
                <div className="text-[#7D6F65] flex items-center gap-1.5">
                  <FileCheck2 className="w-3.5 h-3.5 text-[#5C3D2E]" />
                  <span>KYC &amp; Document Verification</span>
                </div>
                <div className="text-sm font-semibold text-[#1F1916]">
                  {employee.docVerificationSummary}
                </div>
                <div className="font-mono-tabular text-[#574B43]">
                  {employee.totalDocumentsCount} uploaded · {employee.pendingDocumentsCount} pending
                </div>
              </div>
            )}

            <div className="p-4 rounded-lg bg-white border border-[#E5DDD2] space-y-1 text-xs">
              <div className="text-[#7D6F65]">Record Audit Metadata</div>
              <div className="text-[#1F1916]">Created by: {employee.createdBy}</div>
              <div className="font-mono-tabular text-[#7D6F65]">
                Updated: {formatDateTime(employee.updatedAt)}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: PERSONAL INFORMATION */}
      {activeTab === 'personal' && !isFieldOfficer && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Personal &amp; Residential Details
            </h2>
            {isEmployeeSelf && (
              <span className="text-xs text-[#7D6F65]">
                Read-only self-service view · Contact Branch HR for corrections
              </span>
            )}
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Employee ID</dt>
              <dd className="mt-0.5 font-mono-tabular font-semibold text-[#5C3D2E]">
                {employee.employeeId}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Full Name</dt>
              <dd className="mt-0.5 font-semibold text-[#1F1916]">{employee.fullName}</dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Father&apos;s / Spouse&apos;s Name</dt>
              <dd className="mt-0.5 font-medium text-[#1F1916]">
                {employee.fatherOrSpouseName || '—'}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Date of Birth &amp; Age</dt>
              <dd className="mt-0.5 font-mono-tabular text-[#1F1916]">
                {employee.dateOfBirth || '—'}
                {ageYears !== null ? ` (${ageYears} yrs)` : ''}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Gender</dt>
              <dd className="mt-0.5 text-[#1F1916]">{employee.gender}</dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Primary Mobile</dt>
              <dd className="mt-0.5 font-mono-tabular font-semibold text-[#1F1916]">
                {employee.mobile}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Alternate Mobile</dt>
              <dd className="mt-0.5 font-mono-tabular text-[#1F1916]">
                {employee.alternateMobile || '—'}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] sm:col-span-2">
              <dt className="text-xs text-[#7D6F65]">Email Address</dt>
              <dd className="mt-0.5 text-[#1F1916]">{employee.email || 'Not provided'}</dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] sm:col-span-3">
              <dt className="text-xs text-[#7D6F65]">Current Residential Address</dt>
              <dd className="mt-0.5 text-[#1F1916]">
                {employee.currentAddress} · {employee.city}, {employee.state} —{' '}
                <span className="font-mono-tabular">{employee.pinCode}</span>
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] sm:col-span-3">
              <dt className="text-xs text-[#7D6F65]">Permanent Address</dt>
              <dd className="mt-0.5 text-[#1F1916]">{employee.permanentAddress}</dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] sm:col-span-2">
              <dt className="text-xs text-[#7D6F65]">Emergency Contact Name</dt>
              <dd className="mt-0.5 font-semibold text-[#1F1916]">
                {employee.emergencyContactName}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Emergency Contact Number</dt>
              <dd className="mt-0.5 font-mono-tabular font-semibold text-[#5C3D2E]">
                {employee.emergencyContactNumber}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* TAB 3: EMPLOYMENT DETAILS */}
      {activeTab === 'employment' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
          <h2 className="font-display text-lg font-semibold text-[#1F1916]">
            Employment, Qualifications &amp; Supervision
          </h2>

          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Joining Date</dt>
              <dd className="mt-0.5 font-mono-tabular font-semibold text-[#1F1916]">
                {employee.joiningDate}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Branch</dt>
              <dd className="mt-0.5 font-semibold text-[#1F1916]">{employee.branchName}</dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Employment Type &amp; Status</dt>
              <dd className="mt-0.5 font-semibold text-[#1F1916]">
                {employee.employmentType} · {employee.employeeStatus}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">Reporting Field Officer</dt>
              <dd className="mt-0.5 font-medium text-[#1F1916]">
                {employee.reportingFieldOfficerName || 'Not Assigned'}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] sm:col-span-2">
              <dt className="text-xs text-[#7D6F65]">Qualification</dt>
              <dd className="mt-0.5 text-[#1F1916]">{employee.qualification || '—'}</dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] sm:col-span-2">
              <dt className="text-xs text-[#7D6F65]">Completed Training</dt>
              <dd className="mt-0.5 text-[#1F1916]">{employee.trainingDetails || '—'}</dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
              <dt className="text-xs text-[#7D6F65]">License / PVC Reference</dt>
              <dd className="mt-0.5 font-mono-tabular text-[#1F1916]">
                {employee.licenseDetails || 'Not Applicable / None'}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] sm:col-span-3">
              <dt className="text-xs text-[#7D6F65]">Skills &amp; Experience</dt>
              <dd className="mt-0.5 text-[#1F1916]">
                {employee.skillsAndExperience || 'No additional skill summary entered.'}
              </dd>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] sm:col-span-3">
              <dt className="text-xs text-[#7D6F65]">Operational Notes</dt>
              <dd className="mt-0.5 text-[#1F1916]">{employee.notes || 'None'}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* TAB 4: SERVICES AND DESIGNATIONS + DESIGNATION HISTORY */}
      {activeTab === 'designations' && (
        <div className="space-y-6">
          <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-[#5C3D2E]" />
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Approved Services &amp; Designations ({employee.assignedDesignations.length})
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {employee.assignedDesignations.map((d) => (
                <div
                  key={d.designationId}
                  className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] space-y-2.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-[#1F1916]">
                        {d.designationName}
                      </div>
                      <div className="text-[#574B43]">
                        {d.serviceCategory} · {d.serviceName} ({d.designationId})
                      </div>
                    </div>
                    <ShieldCheck className="w-4 h-4 text-[#166534] shrink-0" />
                  </div>

                  <div className="pt-2 border-t border-[#E5DDD2] space-y-1 text-[#574B43]">
                    <div>
                      <strong className="text-[#1F1916]">Qualification Criteria:</strong>{' '}
                      {d.qualificationRequired} ({d.qualificationVerified ? 'Verified' : 'Pending'})
                    </div>
                    <div>
                      <strong className="text-[#1F1916]">Training Criteria:</strong>{' '}
                      {d.trainingRequired} ({d.trainingVerified ? 'Verified' : 'Pending'})
                    </div>
                    <div>
                      <strong className="text-[#1F1916]">License / Clearance:</strong>{' '}
                      {d.licenseRequired} ({d.licenseVerified ? 'Verified' : 'Not Required / N/A'})
                    </div>
                    <div className="font-mono-tabular text-[11px] text-[#7D6F65] pt-1">
                      Approved by {d.assignedBy} on {formatDateTime(d.assignedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
            <h3 className="font-display text-base font-semibold text-[#1F1916]">
              Designation Eligibility History
            </h3>
            {designationHistory.length === 0 ? (
              <p className="text-xs text-[#7D6F65]">No designation history entries recorded yet.</p>
            ) : (
              <div className="divide-y divide-[#E5DDD2]">
                {designationHistory.map((item) => (
                  <div key={item.historyId} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-semibold text-[#1F1916]">{item.action}</div>
                      <p className="text-[#574B43] mt-0.5">{item.summary}</p>
                    </div>
                    <div className="font-mono-tabular text-[#7D6F65] shrink-0">
                      {item.actorName} · {formatDateTime(item.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 5: DOCUMENTS (FIREBASE STORAGE + FIRESTORE METADATA) */}
      {activeTab === 'documents' && !isFieldOfficer && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Employee KYC &amp; Compliance Documents
              </h2>
              <p className="text-xs text-[#574B43]">
                Private Firebase Storage buckets (<code className="font-mono-tabular">employee_kyc</code>{' '}
                &amp; <code className="font-mono-tabular">employee_documents</code>) · Max 5 MB per
                PDF/Image · Never publicly exposed.
              </p>
            </div>

            {canUploadDocs && (
              <button
                type="button"
                onClick={() => {
                  setUploadErr(null);
                  setUploadDocType(allowedDocumentTypesForUpload[0] ?? 'Other Documents');
                  setUploadModalOpen(true);
                }}
                className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] self-start sm:self-auto whitespace-nowrap"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Document</span>
              </button>
            )}
          </div>

          {documents.length === 0 ? (
            <EmptyStatePanel
              icon={FileText}
              title="No Documents Uploaded Yet"
              description={
                isEmployeeSelf
                  ? 'Authorized qualification, training, and appointment documents uploaded by Branch HR will appear here.'
                  : 'Upload Aadhaar, PAN, Photograph, Address Proof, Police Verification, Qualification/Training/Experience Certificates, or Bank Proof.'
              }
              actionLabel={canUploadDocs ? 'Upload First Document' : undefined}
              onAction={
                canUploadDocs
                  ? () => {
                      setUploadErr(null);
                      setUploadModalOpen(true);
                    }
                  : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {documents.map((docItem) => (
                <div
                  key={docItem.documentId}
                  className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E5DDD2] flex flex-col justify-between gap-3 text-xs"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm text-[#1F1916]">
                        {docItem.documentType}
                        {docItem.isSensitiveKyc ? ' (Restricted KYC)' : ''}
                      </div>
                      <span
                        className={
                          docItem.verificationStatus === 'Verified'
                            ? 'text-[#166534] font-semibold'
                            : docItem.verificationStatus === 'Rejected'
                              ? 'text-[#B91C1C] font-semibold'
                              : 'text-[#B45309] font-semibold'
                        }
                      >
                        {docItem.verificationStatus}
                      </span>
                    </div>

                    <div className="font-mono-tabular text-[#574B43] truncate">
                      {docItem.fileName} · {formatBytes(docItem.fileSizeBytes)}
                    </div>
                    <div className="text-[#7D6F65]">
                      Uploaded by {docItem.uploadedBy} on {formatDateTime(docItem.uploadedAt)}
                    </div>
                    {docItem.verificationRemarks && (
                      <div className="text-[#1F1916] pt-1">
                        <strong>Remarks:</strong> {docItem.verificationRemarks}
                        {docItem.verifiedBy ? ` — ${docItem.verifiedBy}` : ''}
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-[#E5DDD2] flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(docItem)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-[#D4C7B8] font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] inline-flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Preview</span>
                    </button>

                    <a
                      href={docItem.downloadUrl}
                      download={docItem.fileName}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-[#E5DDD2] font-medium text-[#1F1916] hover:bg-[#F3EDE4] inline-flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>

                    {canVerifyDocs && (
                      <>
                        {docItem.verificationStatus !== 'Verified' && (
                          <button
                            type="button"
                            onClick={() => {
                              setVerifyRemarks('Document verified against original KYC record.');
                              setVerifyTarget({ doc: docItem, nextStatus: 'Verified' });
                            }}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] font-semibold text-[#166534] hover:bg-[#DCFCE7]"
                          >
                            Verify
                          </button>
                        )}
                        {docItem.verificationStatus !== 'Rejected' && (
                          <button
                            type="button"
                            onClick={() => {
                              setVerifyRemarks('');
                              setVerifyTarget({ doc: docItem, nextStatus: 'Rejected' });
                            }}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] font-semibold text-[#B91C1C] hover:bg-[#FEE2E2]"
                          >
                            Reject
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteDocTarget(docItem)}
                          className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-[#7D6F65] hover:text-[#B91C1C] ml-auto"
                          title="Delete Document"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 6: SALARY & SENSITIVE KYC INFORMATION */}
      {activeTab === 'salary' && !isFieldOfficer && (canViewSensitive || isEmployeeSelf) && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-[#5C3D2E]" />
              <div>
                <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                  Salary Structure &amp; Isolated KYC Details
                </h2>
                <p className="text-xs text-[#574B43]">
                  Retrieved from <code className="font-mono-tabular">employeePrivate/&#123;employeeId&#125;</code>{' '}
                  · Blocked from Site Portal &amp; Field Officers.
                </p>
              </div>
            </div>

            {canViewSensitive && privateData && (
              <button
                type="button"
                onClick={() => setRevealSensitiveNumbers((v) => !v)}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] self-start sm:self-auto"
              >
                {revealSensitiveNumbers ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Mask Account &amp; Aadhaar</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>Reveal Full Numbers</span>
                  </>
                )}
              </button>
            )}
          </div>

          {!privateData ? (
            <EmptyStatePanel
              icon={Lock}
              title="No Financial / Salary Structure Recorded Yet"
              description={
                canEdit
                  ? 'Open Edit Profile -> Salary & Sensitive KYC to configure Salary Type, Basic Wage, Bank Account, IFSC, PAN, and Aadhaar.'
                  : 'Financial details have not been configured for this employee yet.'
              }
              actionLabel={canEdit ? 'Configure Salary & KYC' : undefined}
              onAction={canEdit ? () => setEditModalOpen(true) : undefined}
            />
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div className="p-4 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <dt className="text-xs text-[#7D6F65]">Salary Type</dt>
                <dd className="mt-0.5 font-semibold text-[#1F1916]">{privateData.salaryType}</dd>
              </div>
              <div className="p-4 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <dt className="text-xs text-[#7D6F65]">Basic Salary / Wage</dt>
                <dd className="mt-0.5 font-mono-tabular text-lg font-bold text-[#5C3D2E]">
                  ₹{privateData.basicSalary.toLocaleString('en-IN')}
                </dd>
              </div>
              <div className="p-4 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <dt className="text-xs text-[#7D6F65]">Bank Name</dt>
                <dd className="mt-0.5 font-medium text-[#1F1916]">
                  {privateData.bankName || '—'}
                </dd>
              </div>
              <div className="p-4 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <dt className="text-xs text-[#7D6F65]">Account Holder Name</dt>
                <dd className="mt-0.5 font-medium text-[#1F1916]">
                  {privateData.bankAccountHolderName || '—'}
                </dd>
              </div>
              <div className="p-4 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <dt className="text-xs text-[#7D6F65]">Bank Account Number</dt>
                <dd className="mt-0.5 font-mono-tabular font-semibold text-[#1F1916]">
                  {revealSensitiveNumbers && privateData.bankAccountNumber
                    ? privateData.bankAccountNumber
                    : privateData.bankAccountMasked || '—'}
                </dd>
              </div>
              <div className="p-4 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                <dt className="text-xs text-[#7D6F65]">Bank IFSC Code</dt>
                <dd className="mt-0.5 font-mono-tabular font-semibold text-[#1F1916]">
                  {privateData.ifscCode || '—'}
                </dd>
              </div>
              {canViewSensitive && (
                <>
                  <div className="p-4 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                    <dt className="text-xs text-[#7D6F65]">PAN Number</dt>
                    <dd className="mt-0.5 font-mono-tabular font-semibold text-[#1F1916]">
                      {privateData.panNumber || '—'}
                    </dd>
                  </div>
                  <div className="p-4 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2]">
                    <dt className="text-xs text-[#7D6F65]">Aadhaar Number</dt>
                    <dd className="mt-0.5 font-mono-tabular font-semibold text-[#1F1916]">
                      {revealSensitiveNumbers && privateData.aadhaarNumber
                        ? privateData.aadhaarNumber
                        : privateData.aadhaarMasked || '—'}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          )}
        </section>
      )}

      {/* TAB 7: SITE ASSIGNMENT HISTORY */}
      {activeTab === 'site_history' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-[#5C3D2E]" />
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Site Deployment &amp; Transfer History
              </h2>
            </div>

            {user &&
              (isAdmin ||
                isFieldOfficer ||
                (isHR && hasUserPermission(user, 'assignment.create'))) &&
              employee.isActive && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `${ROLE_TO_PORTAL_BASE[user.role]}/assignments?action=assign&employeeId=${encodeURIComponent(
                        employee.employeeId
                      )}`
                    )
                  }
                  className="rounded-lg bg-[#5C3D2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4A3023]"
                >
                  Assign to Site
                </button>
              )}
          </div>

          <div className="p-4 rounded-xl bg-[#F3EDE4] border border-[#D4C7B8] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div>
              <span className="text-[#574B43]">Current Posting:</span>{' '}
              <strong className="text-[#1F1916] font-mono-tabular">
                {employee.currentSiteId
                  ? `${employee.currentSiteId} — ${employee.currentSiteName}`
                  : 'Unassigned (Available Bench Pool)'}
              </strong>
            </div>
            <div className="text-[#574B43]">
              Reporting Field Officer:{' '}
              <strong className="text-[#1F1916]">
                {employee.reportingFieldOfficerName || 'None'}
              </strong>
            </div>
          </div>

          {/* Structured Assignments Table */}
          {employeeAssignments.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[#E5DDD2]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E5DDD2] bg-[#FAF8F5] text-[11px] font-semibold uppercase tracking-wider text-[#6B5E55]">
                    <th className="px-3.5 py-2.5">Assignment ID</th>
                    <th className="px-3.5 py-2.5">Site &amp; Client</th>
                    <th className="px-3.5 py-2.5">Designation &amp; Shift</th>
                    <th className="px-3.5 py-2.5">Duty Dates</th>
                    <th className="px-3.5 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE9E0] text-xs">
                  {employeeAssignments.map((asn) => (
                    <tr key={asn.assignmentId} className="hover:bg-[#FAF8F5]/70">
                      <td className="px-3.5 py-2.5 font-mono-tabular font-semibold text-[#5C3D2E]">
                        {asn.assignmentId}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-semibold text-[#1F1916]">{asn.siteName}</div>
                        <div className="text-[#6B5E55]">{asn.clientName}</div>
                        {asn.transferredToSiteName && (
                          <div className="text-[11px] text-amber-800">
                            Transferred to: {asn.transferredToSiteName}
                          </div>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-medium text-[#1F1916]">
                          [{asn.serviceCategory}] {asn.designationName}
                        </div>
                        <div className="font-mono-tabular text-[#6B5E55]">
                          {asn.shift} ({asn.shiftStartTime}–{asn.shiftEndTime})
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono-tabular text-[#1F1916]">
                        {asn.startDate} to {asn.endDate}
                      </td>
                      <td className="px-3.5 py-2.5 font-semibold text-[#4A3023]">
                        {asn.assignmentStatus}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {siteHistory.length === 0 && employeeAssignments.length === 0 ? (
            <EmptyStatePanel
              icon={Briefcase}
              title="No Site Assignment History Yet"
              description="Site deployments, transfers, and bench releases for this employee are automatically logged here."
            />
          ) : (
            siteHistory.length > 0 && (
              <div className="divide-y divide-[#E5DDD2]">
                {siteHistory.map((item) => (
                  <div
                    key={item.historyId}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-[#1F1916]">{item.action}</div>
                      <p className="text-[#574B43] mt-0.5">{item.summary}</p>
                    </div>
                    <div className="font-mono-tabular text-[#7D6F65] shrink-0">
                      {item.actorName} · {formatDateTime(item.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </section>
      )}

      {/* TAB 8: ATTENDANCE SUMMARY (INTEGRATION PLACEHOLDER READY FOR ATTENDANCE MODULE) */}
      {activeTab === 'attendance' && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-[#5C3D2E]" />
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F1916]">
                Attendance Summary
              </h2>
              <p className="text-xs text-[#574B43]">
                Read-only duty attendance integration linked to{' '}
                <code className="font-mono-tabular">attendance</code> collection for Employee{' '}
                <code className="font-mono-tabular">{employee.employeeId}</code>.
              </p>
            </div>
          </div>

          <EmptyStatePanel
            icon={CalendarCheck}
            title="Attendance Ledger Ready for Shift Roster & Check-In Module"
            description="No verified monthly shift attendance sheets have been posted for this employee yet. Once daily site attendance and duty check-in/check-out records are submitted in the Attendance Module, present days, weekly offs, overtime hours, and absent counts will summarize here automatically."
          />
        </section>
      )}

      {/* TAB 9: ACTIVITY HISTORY */}
      {activeTab === 'activity' && !isFieldOfficer && !isEmployeeSelf && (
        <section className="bg-white border border-[#E5DDD2] rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#5C3D2E]" />
            <h2 className="font-display text-lg font-semibold text-[#1F1916]">
              Complete Profile Activity Timeline
            </h2>
          </div>

          {history.length === 0 ? (
            <p className="text-xs text-[#7D6F65]">No activity events recorded yet.</p>
          ) : (
            <div className="divide-y divide-[#E5DDD2]">
              {history.map((item) => (
                <div
                  key={item.historyId}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="font-semibold text-[#1F1916]">
                      {item.action}{' '}
                      <span className="font-normal text-[#7D6F65]">· {item.category}</span>
                    </div>
                    <p className="text-[#574B43] mt-0.5">{item.summary}</p>
                  </div>
                  <div className="font-mono-tabular text-[#7D6F65] shrink-0">
                    {item.actorName} ({item.actorRole}) · {formatDateTime(item.timestamp)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Edit Employee Modal */}
      {editModalOpen && (
        <EmployeeFormModal
          open={editModalOpen}
          mode="edit"
          initialEmployee={employee}
          branches={branches}
          services={services}
          designations={designations}
          sites={sites}
          caller={user}
          isPreviewSession={isPreviewSession}
          onClose={() => setEditModalOpen(false)}
          onSaved={() => {
            setEditModalOpen(false);
            setFeedback({
              type: 'success',
              text: `Updated profile for ${employee.employeeId} (${employee.fullName}).`,
            });
            void loadProfileBundle();
          }}
        />
      )}

      {/* Upload Document Modal */}
      {uploadModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  Upload Employee Document
                </h3>
                <p className="text-xs text-[#574B43]">
                  {employee.employeeId} · {employee.fullName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                disabled={uploadingDoc}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {uploadErr && (
              <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
                {uploadErr}
              </div>
            )}

            <form onSubmit={(e) => void handleUploadSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Document Type <span className="text-[#B91C1C]">*</span>
                </label>
                <select
                  value={uploadDocType}
                  onChange={(e) => setUploadDocType(e.target.value as EmployeeDocumentType)}
                  className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                >
                  {allowedDocumentTypesForUpload.map((dt) => (
                    <option key={dt} value={dt}>
                      {dt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Select File (PDF, JPG, PNG, WEBP · Max 5 MB){' '}
                  <span className="text-[#B91C1C]">*</span>
                </label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-[#574B43] file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border file:border-[#D4C7B8] file:text-xs file:font-semibold file:bg-[#FAF8F5] file:text-[#1F1916] hover:file:bg-[#F3EDE4]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Upload Notes / Reference Number
                </label>
                <input
                  type="text"
                  value={uploadRemarks}
                  onChange={(e) => setUploadRemarks(e.target.value)}
                  placeholder="Optional reference or scan note..."
                  className="w-full min-h-[42px] px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  disabled={uploadingDoc}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadingDoc}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] disabled:opacity-60"
                >
                  {uploadingDoc ? 'Uploading...' : 'Upload Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Authorized In-App Document Preview Modal */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/60 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl bg-white border border-[#E5DDD2] rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#E5DDD2]">
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-[#1F1916] truncate">
                  {previewDoc.documentType} — {previewDoc.fileName}
                </h3>
                <p className="text-xs text-[#574B43]">
                  Status: {previewDoc.verificationStatus} · {formatBytes(previewDoc.fileSizeBytes)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewDoc.downloadUrl}
                  download={previewDoc.fileName}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#5C3D2E] inline-flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-[#FAF8F5] p-4 overflow-auto flex items-center justify-center min-h-[320px]">
              {previewDoc.mimeType.startsWith('image/') ? (
                <img
                  src={previewDoc.downloadUrl}
                  alt={previewDoc.documentType}
                  className="max-h-[70vh] w-auto rounded-lg border border-[#E5DDD2] object-contain"
                />
              ) : (
                <iframe
                  src={previewDoc.downloadUrl}
                  title={previewDoc.documentType}
                  className="w-full h-[68vh] rounded-lg border border-[#E5DDD2] bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Document Verify / Reject Modal */}
      {verifyTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1916]/50 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                {verifyTarget.nextStatus === 'Verified' ? (
                  <CheckCircle2 className="w-5 h-5 text-[#166534]" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#B91C1C]" />
                )}
                <h3 className="font-display text-lg font-bold text-[#1F1916]">
                  {verifyTarget.nextStatus === 'Verified'
                    ? 'Verify Employee Document'
                    : 'Reject Employee Document'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setVerifyTarget(null)}
                className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7D6F65] hover:text-[#1F1916]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#574B43]">
              {verifyTarget.doc.documentType} (<code className="font-mono-tabular">{verifyTarget.doc.fileName}</code>)
            </p>

            <form onSubmit={(e) => void handleConfirmVerify(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1F1916] mb-1">
                  Verification Remarks
                </label>
                <textarea
                  rows={3}
                  required={verifyTarget.nextStatus === 'Rejected'}
                  value={verifyRemarks}
                  onChange={(e) => setVerifyRemarks(e.target.value)}
                  placeholder={
                    verifyTarget.nextStatus === 'Rejected'
                      ? 'Specify why this document was rejected (blurry scan, expired ID, mismatch)...'
                      : 'Verification remarks...'
                  }
                  className="w-full px-3.5 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg focus:outline-none focus:bg-white focus:border-[#5C3D2E]"
                />
              </div>

              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setVerifyTarget(null)}
                  disabled={verifyingDoc}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-semibold text-[#1F1916]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={verifyingDoc}
                  className={`min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-60 ${
                    verifyTarget.nextStatus === 'Verified'
                      ? 'bg-[#166534] hover:bg-[#14532D]'
                      : 'bg-[#B91C1C] hover:bg-[#991B1B]'
                  }`}
                >
                  {verifyingDoc
                    ? 'Saving...'
                    : verifyTarget.nextStatus === 'Verified'
                      ? 'Confirm Verified'
                      : 'Confirm Rejected'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Document Confirm */}
      <ConfirmDialog
        open={Boolean(deleteDocTarget)}
        title="Delete Uploaded Document?"
        description={`Remove ${deleteDocTarget?.documentType ?? ''} (${deleteDocTarget?.fileName ?? ''}) from this employee's file?`}
        confirmLabel="Delete Document"
        variant="danger"
        loading={deletingDoc}
        onConfirm={() => void handleConfirmDeleteDoc()}
        onCancel={() => setDeleteDocTarget(null)}
      />

      {/* Status Toggle Confirm */}
      <ConfirmDialog
        open={confirmToggleStatus}
        title={
          employee.employeeStatus === 'Active'
            ? `Deactivate ${employee.employeeId}?`
            : `Activate ${employee.employeeId}?`
        }
        description={
          employee.employeeStatus === 'Active'
            ? `Mark ${employee.fullName} as Inactive while retaining all deployment and KYC records?`
            : `Restore ${employee.fullName} to Active status?`
        }
        confirmLabel={employee.employeeStatus === 'Active' ? 'Deactivate' : 'Activate'}
        variant={employee.employeeStatus === 'Active' ? 'danger' : 'primary'}
        loading={togglingStatus}
        onConfirm={() => void handleToggleStatus()}
        onCancel={() => setConfirmToggleStatus(false)}
      />

      {/* Soft Delete / Request Archive Confirm */}
      <ConfirmDialog
        open={confirmSoftDelete}
        title={
          canDirectDelete
            ? `Soft-Delete Employee ${employee.employeeId}?`
            : `Submit Archive Approval for ${employee.employeeId}?`
        }
        description={
          canDirectDelete
            ? `This archives ${employee.fullName} (isDeleted = true) and preserves all historical data.`
            : `This submits an Employee Deletion request to the Administrator Approval Queue.`
        }
        confirmLabel={canDirectDelete ? 'Confirm Soft Delete' : 'Submit Approval Request'}
        variant={canDirectDelete ? 'danger' : 'primary'}
        loading={softDeleting}
        onConfirm={() => void handleSoftDeleteOrRequest()}
        onCancel={() => setConfirmSoftDelete(false)}
      />
    </div>
  );
};
