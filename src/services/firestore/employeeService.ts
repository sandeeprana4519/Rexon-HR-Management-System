import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import {
  AssignedEmployeeDesignation,
  BranchRecord,
  DesignationRecord,
  DocVerificationSummary,
  DocumentVerificationStatus,
  EmployeeDocumentRecord,
  EmployeeDocumentType,
  EmployeeFormInput,
  EmployeeHistoryCategory,
  EmployeeHistoryRecord,
  EmployeePrivateRecord,
  EmployeeRecord,
  EmployeeStatus,
  IssuedPortalCredentials,
  OperationType,
  RexonUser,
  SENSITIVE_KYC_DOCUMENT_TYPES,
  ServiceCategory,
  SiteRecord,
} from '../../types';
import {
  maskAadhaarNumber,
  maskBankAccount,
  validateEmployeeDocumentFile,
  validateEmployeeForm,
} from '../../utils/employeeValidation';
import {
  getAuthorizedBranchIds,
  getPortalByRole,
  hasUserPermission,
} from '../../utils/portalConfig';
import { sanitizeInput } from '../../utils/validation';
import {
  buildSystemPortalLoginEmail,
  compressImageFileToDataUrl,
  firebaseStorage,
  firestoreDb,
  generateDefaultPortalPassword,
  isFirebaseConfigured,
  processInstantPhotoAsset,
  provisionFirebaseUserIsolated,
  uploadToStorageWithFastTimeout,
} from '../firebase/config';
import { handleFirestoreError } from './errorHandler';
import {
  listBranches,
  listDesignations,
  listFieldOfficers,
  listSites,
  recordExternalMasterAudit,
} from './masterDataService';
import {
  getPortalUserByUid,
  listPreviewProvisionedUsers,
  upsertPreviewProvisionedUser,
} from './userRoleService';

const EMPLOYEE_STORAGE_KEY = 'rexon_phase3_employees_v1';

interface LocalEmployeeStore {
  employees: EmployeeRecord[];
  employeePrivate: Record<string, EmployeePrivateRecord>;
  employeeDocuments: EmployeeDocumentRecord[];
  employeeHistory: EmployeeHistoryRecord[];
}

type EmployeeListener = () => void;
const employeeListeners = new Set<EmployeeListener>();

export function subscribeEmployeeData(listener: EmployeeListener): () => void {
  employeeListeners.add(listener);
  return () => employeeListeners.delete(listener);
}

function notifyEmployeeListeners(): void {
  employeeListeners.forEach((fn) => fn());
}

function useLiveFirestore(isPreviewSession: boolean): boolean {
  return isFirebaseConfigured && Boolean(firestoreDb) && !isPreviewSession;
}

/**
 * Starts strictly empty — NO fake or hardcoded employee records.
 */
function buildEmptyEmployeeStore(): LocalEmployeeStore {
  return {
    employees: [],
    employeePrivate: {},
    employeeDocuments: [],
    employeeHistory: [],
  };
}

function readLocalEmployeeStore(): LocalEmployeeStore {
  try {
    const raw = localStorage.getItem(EMPLOYEE_STORAGE_KEY);
    if (!raw) {
      return buildEmptyEmployeeStore();
    }
    const parsed = JSON.parse(raw) as Partial<LocalEmployeeStore>;
    return {
      employees: Array.isArray(parsed.employees) ? parsed.employees : [],
      employeePrivate:
        parsed.employeePrivate && typeof parsed.employeePrivate === 'object'
          ? parsed.employeePrivate
          : {},
      employeeDocuments: Array.isArray(parsed.employeeDocuments) ? parsed.employeeDocuments : [],
      employeeHistory: Array.isArray(parsed.employeeHistory) ? parsed.employeeHistory : [],
    };
  } catch {
    return buildEmptyEmployeeStore();
  }
}

function writeLocalEmployeeStore(store: LocalEmployeeStore): void {
  try {
    localStorage.setItem(EMPLOYEE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors
  }
  notifyEmployeeListeners();
}

function generateSequentialId(prefix: string, existingIds: string[]): string {
  const year = new Date().getFullYear();
  let maxSeq = 0;
  const regex = new RegExp(`^${prefix}-\\d{4}-(\\d+)$`);
  for (const id of existingIds) {
    const match = id.match(regex);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (!Number.isNaN(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }
  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  const candidate = `${prefix}-${year}-${nextSeq}`;
  if (existingIds.includes(candidate)) {
    return `${prefix}-${year}-${nextSeq}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  }
  return candidate;
}

function makeHistoryId(): string {
  return `EHS-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}-${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;
}

function buildHistoryRecord(
  actor: RexonUser,
  params: {
    employeeId: string;
    linkedUid: string;
    branchId: string;
    category: EmployeeHistoryCategory;
    action: string;
    summary: string;
    metadata?: Record<string, string>;
    timestamp?: string;
  }
): EmployeeHistoryRecord {
  return {
    historyId: makeHistoryId(),
    employeeId: params.employeeId,
    linkedUid: params.linkedUid || '',
    branchId: params.branchId,
    category: params.category,
    action: sanitizeInput(params.action, 100),
    summary: sanitizeInput(params.summary, 400),
    ...(params.metadata ? { metadata: params.metadata } : {}),
    actorUid: actor.uid,
    actorName: actor.fullName,
    actorRole: actor.role,
    timestamp: params.timestamp ?? new Date().toISOString(),
  };
}

export function computeDocVerificationSummary(
  docs: EmployeeDocumentRecord[]
): {
  summary: DocVerificationSummary;
  totalCount: number;
  pendingCount: number;
} {
  if (docs.length === 0) {
    return { summary: 'No Documents', totalCount: 0, pendingCount: 0 };
  }
  const pendingCount = docs.filter((d) => d.verificationStatus === 'Pending').length;
  const hasRejected = docs.some((d) => d.verificationStatus === 'Rejected');
  if (hasRejected) {
    return { summary: 'Rejected', totalCount: docs.length, pendingCount };
  }
  if (pendingCount > 0) {
    return { summary: 'Pending', totalCount: docs.length, pendingCount };
  }
  return { summary: 'Verified', totalCount: docs.length, pendingCount: 0 };
}

function assertNotSitePortal(caller: RexonUser): void {
  if (caller.role === 'site') {
    throw new Error(
      'Unauthorized: Site Portal accounts do not have access to Employee Management or private personnel records.'
    );
  }
}

function canFieldOfficerAccessEmployee(caller: RexonUser, emp: EmployeeRecord): boolean {
  if (emp.isDeleted) return false;
  if (emp.reportingFieldOfficerUid && emp.reportingFieldOfficerUid === caller.uid) {
    return true;
  }
  if (emp.currentSiteId && caller.assignedSiteIds.includes(emp.currentSiteId)) {
    return true;
  }
  const authorizedBranches = getAuthorizedBranchIds(caller);
  if (authorizedBranches.includes(emp.branchId)) {
    return true;
  }
  return false;
}

function sanitizeEmployeeForFieldOfficer(emp: EmployeeRecord): EmployeeRecord {
  // Operational view only — strip private residential address, alternate phone, and personal email
  return {
    ...emp,
    fatherOrSpouseName: '',
    dateOfBirth: '',
    alternateMobile: '',
    email: '',
    currentAddress: '',
    permanentAddress: '',
    pinCode: '',
  };
}

function canCallerReadSensitivePrivate(caller: RexonUser, branchId: string): boolean {
  if (caller.role === 'admin') return true;
  if (caller.role === 'hr') {
    return (
      getAuthorizedBranchIds(caller).includes(branchId) &&
      hasUserPermission(caller, 'employee.sensitive')
    );
  }
  return false;
}

async function resolveLinkedEmployeeUid(
  inputUid: string,
  email: string,
  isPreviewSession: boolean
): Promise<string> {
  const trimmedUid = sanitizeInput(inputUid, 128);
  if (trimmedUid) return trimmedUid;

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return '';

  if (!useLiveFirestore(isPreviewSession)) {
    if (cleanEmail === 'employee@rexon.com') {
      return 'demo-employee-001';
    }
    return '';
  }

  try {
    const q = query(
      collection(firestoreDb!, 'users'),
      where('email', '==', cleanEmail),
      where('role', '==', 'employee')
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs[0].id;
    }
  } catch {
    // Non-fatal if caller cannot query users by email
  }
  return '';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to encode file preview.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

export interface FieldOfficerOption {
  uid: string;
  fullName: string;
  branchId: string;
  phone: string;
}

export async function listAvailableFieldOfficers(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<FieldOfficerOption[]> {
  assertNotSitePortal(caller);
  try {
    const officers = await listFieldOfficers(caller, isPreviewSession);
    return officers
      .filter((fo) => fo.isActive)
      .map((fo) => ({
        uid: fo.uid,
        fullName: `${fo.fullName} (${fo.fieldOfficerId})`,
        branchId: fo.branchId,
        phone: fo.phone,
      }));
  } catch {
    return [];
  }
}

// ============================================================================
// 1. LIST & GET EMPLOYEE RECORDS
// ============================================================================
export async function listEmployees(
  caller: RexonUser,
  isPreviewSession: boolean,
  options?: { includeDeleted?: boolean }
): Promise<EmployeeRecord[]> {
  assertNotSitePortal(caller);
  const includeDeleted = Boolean(options?.includeDeleted && caller.role === 'admin');

  if (caller.role === 'hr' && !hasUserPermission(caller, 'employee.view')) {
    throw new Error('Your HR profile does not have permission (employee.view) to view employees.');
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    const base = includeDeleted
      ? store.employees
      : store.employees.filter((e) => !e.isDeleted);

    if (caller.role === 'admin') {
      return [...base].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    if (caller.role === 'hr') {
      const allowed = getAuthorizedBranchIds(caller);
      return base
        .filter((e) => allowed.includes(e.branchId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    if (caller.role === 'field_officer') {
      return base
        .filter((e) => canFieldOfficerAccessEmployee(caller, e))
        .map(sanitizeEmployeeForFieldOfficer)
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
    }

    if (caller.role === 'employee') {
      return base.filter(
        (e) =>
          e.linkedUid === caller.uid ||
          (caller.email && e.email.toLowerCase() === caller.email.toLowerCase())
      );
    }

    return [];
  }

  const path = 'employees';
  try {
    let q;
    if (caller.role === 'admin') {
      q = query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      const allowed = getAuthorizedBranchIds(caller);
      if (allowed.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('branchId', 'in', allowed.slice(0, 10))
      );
    } else if (caller.role === 'field_officer') {
      const authorizedBranches = getAuthorizedBranchIds(caller);
      if (authorizedBranches.length > 0) {
        q = query(
          collection(firestoreDb!, path),
          where('branchId', 'in', authorizedBranches.slice(0, 10))
        );
      } else if (!caller.assignedSiteIds || caller.assignedSiteIds.length === 0) {
        q = query(
          collection(firestoreDb!, path),
          where('reportingFieldOfficerUid', '==', caller.uid)
        );
      } else {
        q = query(
          collection(firestoreDb!, path),
          where('currentSiteId', 'in', caller.assignedSiteIds.slice(0, 10))
        );
      }
    } else if (caller.role === 'employee') {
      q = query(collection(firestoreDb!, path), where('linkedUid', '==', caller.uid));
    } else {
      return [];
    }

    const snap = await getDocs(q);
    let records = snap.docs.map((d) => d.data() as EmployeeRecord);
    if (!includeDeleted) {
      records = records.filter((e) => !e.isDeleted);
    }
    if (caller.role === 'field_officer') {
      records = records
        .filter((e) => canFieldOfficerAccessEmployee(caller, e))
        .map(sanitizeEmployeeForFieldOfficer);
    }
    return records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function getEmployeeById(
  caller: RexonUser,
  isPreviewSession: boolean,
  employeeId: string
): Promise<EmployeeRecord | null> {
  assertNotSitePortal(caller);
  if (!employeeId.trim()) return null;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    const found = store.employees.find((e) => e.employeeId === employeeId) ?? null;
    if (!found) return null;
    if (found.isDeleted && caller.role !== 'admin') return null;

    if (caller.role === 'admin') return found;
    if (caller.role === 'hr') {
      if (
        !hasUserPermission(caller, 'employee.view') ||
        !getAuthorizedBranchIds(caller).includes(found.branchId)
      ) {
        throw new Error('Unauthorized branch or missing employee.view permission.');
      }
      return found;
    }
    if (caller.role === 'field_officer') {
      if (!canFieldOfficerAccessEmployee(caller, found)) {
        throw new Error('Field Officers can only view personnel deployed to their assigned sites.');
      }
      return sanitizeEmployeeForFieldOfficer(found);
    }
    if (caller.role === 'employee') {
      const isSelf =
        found.linkedUid === caller.uid ||
        (caller.email && found.email.toLowerCase() === caller.email.toLowerCase());
      if (!isSelf) {
        throw new Error('Employees can only access their own personal profile.');
      }
      return found;
    }
    return null;
  }

  const path = `employees/${employeeId}`;
  try {
    const snap = await getDoc(doc(firestoreDb!, 'employees', employeeId));
    if (!snap.exists()) return null;
    const record = snap.data() as EmployeeRecord;
    if (record.isDeleted && caller.role !== 'admin') return null;
    if (caller.role === 'field_officer') {
      if (!canFieldOfficerAccessEmployee(caller, record)) {
        throw new Error('Field Officers can only view personnel deployed to their assigned sites.');
      }
      return sanitizeEmployeeForFieldOfficer(record);
    }
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function getOwnEmployeeRecord(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<EmployeeRecord | null> {
  if (caller.role !== 'employee') return null;
  const list = await listEmployees(caller, isPreviewSession);
  return list[0] ?? null;
}

export async function getEmployeePrivateData(
  caller: RexonUser,
  isPreviewSession: boolean,
  employeeId: string,
  branchId: string,
  linkedUid?: string
): Promise<EmployeePrivateRecord | null> {
  // Strictly block Site Portal & Field Officer Portal
  if (caller.role === 'site' || caller.role === 'field_officer') {
    return null;
  }

  const isSelfEmployee =
    caller.role === 'employee' && Boolean(linkedUid && linkedUid === caller.uid);
  const canReadFullSensitive = canCallerReadSensitivePrivate(caller, branchId);

  if (!canReadFullSensitive && !isSelfEmployee) {
    return null;
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    const priv = store.employeePrivate[employeeId] ?? null;
    if (!priv) return null;
    if (isSelfEmployee && !canReadFullSensitive) {
      return {
        ...priv,
        aadhaarNumber: '',
        bankAccountNumber: '',
      };
    }
    return priv;
  }

  const path = `employeePrivate/${employeeId}`;
  try {
    const snap = await getDoc(doc(firestoreDb!, 'employeePrivate', employeeId));
    if (!snap.exists()) return null;
    const priv = snap.data() as EmployeePrivateRecord;
    if (isSelfEmployee && !canReadFullSensitive) {
      return {
        ...priv,
        aadhaarNumber: '',
        bankAccountNumber: '',
      };
    }
    return priv;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

// ============================================================================
// 2. CREATE, UPDATE, STATUS TOGGLE & SOFT DELETE EMPLOYEE
// ============================================================================
function buildAssignedDesignationList(
  selectedIds: string[],
  confirmations: EmployeeFormInput['eligibilityConfirmations'],
  allDesignations: DesignationRecord[],
  actorLabel: string,
  nowIso: string,
  previous?: AssignedEmployeeDesignation[]
): AssignedEmployeeDesignation[] {
  const prevMap = new Map<string, AssignedEmployeeDesignation>();
  if (previous) {
    for (const p of previous) {
      prevMap.set(p.designationId, p);
    }
  }

  return selectedIds
    .map((id) => allDesignations.find((d) => d.designationId === id))
    .filter((d): d is DesignationRecord => Boolean(d))
    .map((desig) => {
      const existingEntry = prevMap.get(desig.designationId);
      const conf = confirmations[desig.designationId] ?? {
        qualificationVerified: true,
        trainingVerified: true,
        licenseVerified: true,
      };
      return {
        designationId: desig.designationId,
        designationName: desig.designationName,
        serviceId: desig.relatedServiceId,
        serviceName: desig.relatedServiceName,
        serviceCategory: desig.serviceCategory,
        qualificationRequired: desig.qualification,
        trainingRequired: desig.trainingRequirements,
        licenseRequired: desig.licenseRequirements,
        qualificationVerified: Boolean(conf.qualificationVerified),
        trainingVerified: Boolean(conf.trainingVerified),
        licenseVerified: Boolean(conf.licenseVerified),
        assignedAt: existingEntry?.assignedAt ?? nowIso,
        assignedBy: existingEntry?.assignedBy ?? actorLabel,
      };
    });
}

export async function uploadEmployeeProfilePhoto(
  caller: RexonUser,
  isPreviewSession: boolean,
  branchId: string,
  employeeRefId: string,
  file: File
): Promise<string> {
  assertNotSitePortal(caller);
  return processInstantPhotoAsset(file, {
    storagePath: `employee_documents/${branchId || 'GENERAL'}/${employeeRefId || 'NEW_EMP'}/photo_${Date.now()}.jpg`,
    tryCloudStorage: useLiveFirestore(isPreviewSession),
    maxDimension: 280,
  });
}

export interface CreateEmployeeAuthOptions {
  initialPassword?: string;
}

export async function createEmployeeRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  rawInput: EmployeeFormInput,
  authOptions?: CreateEmployeeAuthOptions
): Promise<EmployeeRecord & { issuedCredentials?: IssuedPortalCredentials }> {
  assertNotSitePortal(caller);
  if (caller.role !== 'admin' && !hasUserPermission(caller, 'employee.create')) {
    throw new Error('Creating an employee requires Admin authority or HR employee.create permission.');
  }

  const hasAnyFinancialField = Boolean(
    rawInput.basicSalary.trim() ||
      rawInput.bankAccountNumber.trim() ||
      rawInput.bankName.trim() ||
      rawInput.ifscCode.trim() ||
      rawInput.panNumber.trim() ||
      rawInput.aadhaarNumber.trim()
  );

  const input: EmployeeFormInput = {
    ...rawInput,
    includePrivateFinancials: rawInput.includePrivateFinancials && hasAnyFinancialField,
  };

  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(input.branchId)) {
    throw new Error('HR accounts can only register employees under their assigned branch(es).');
  }

  const [branches, designations, sites] = await Promise.all([
    listBranches(caller, isPreviewSession),
    listDesignations(caller, isPreviewSession),
    listSites(caller, isPreviewSession),
  ]);

  const validation = validateEmployeeForm(input, designations, caller);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Employee validation failed.');
  }

  const branchObj: BranchRecord | undefined = branches.find(
    (b) => b.branchId === input.branchId && !b.isDeleted
  );
  if (!branchObj) {
    throw new Error('Selected Branch does not exist or is inactive.');
  }

  const siteObj: SiteRecord | undefined = input.currentSiteId
    ? sites.find((s) => s.siteId === input.currentSiteId && !s.isArchived)
    : undefined;
  if (input.currentSiteId && !siteObj) {
    throw new Error('Selected Deployment Site could not be found.');
  }
  if (siteObj && siteObj.branchId !== branchObj.branchId && caller.role !== 'admin') {
    throw new Error('Selected Deployment Site must belong to the employee’s assigned branch.');
  }

  let existingEmployees: EmployeeRecord[] = [];
  if (!useLiveFirestore(isPreviewSession)) {
    const localStore = readLocalEmployeeStore();
    existingEmployees = localStore.employees;
    if (input.includePrivateFinancials) {
      const cleanAadhaarCheck = input.aadhaarNumber.replace(/[\s-]/g, '');
      const cleanPanCheck = input.panNumber.trim().toUpperCase();
      for (const emp of existingEmployees) {
        if (emp.isDeleted) continue;
        const priv = localStore.employeePrivate[emp.employeeId];
        if (!priv) continue;
        if (cleanAadhaarCheck && priv.aadhaarNumber === cleanAadhaarCheck) {
          throw new Error(
            `Duplicate prevented: Aadhaar number is already registered to active employee ${emp.fullName} (${emp.employeeId}).`
          );
        }
        if (cleanPanCheck && priv.panNumber.toUpperCase() === cleanPanCheck) {
          throw new Error(
            `Duplicate prevented: PAN "${cleanPanCheck}" is already registered to active employee ${emp.fullName} (${emp.employeeId}).`
          );
        }
      }
    }
  } else {
    const existingSnap = await getDocs(
      caller.role === 'admin'
        ? query(collection(firestoreDb!, 'employees'))
        : query(
            collection(firestoreDb!, 'employees'),
            where('branchId', 'in', getAuthorizedBranchIds(caller).slice(0, 10))
          )
    );
    existingEmployees = existingSnap.docs.map((d) => d.data() as EmployeeRecord);
  }

  const normalizedPhone = input.mobile.replace(/\D/g, '').slice(-10);
  const normalizedEmail = input.email.trim().toLowerCase();
  const duplicateMobile = existingEmployees.find(
    (e) => !e.isDeleted && e.mobile.replace(/\D/g, '').slice(-10) === normalizedPhone
  );
  if (duplicateMobile) {
    throw new Error(
      `Duplicate prevented: Mobile number ${input.mobile.trim()} is already registered to ${duplicateMobile.fullName} (${duplicateMobile.employeeId}).`
    );
  }
  if (normalizedEmail) {
    const duplicateEmail = existingEmployees.find(
      (e) => !e.isDeleted && e.email && e.email.trim().toLowerCase() === normalizedEmail
    );
    if (duplicateEmail) {
      throw new Error(
        `Duplicate prevented: Email "${normalizedEmail}" is already registered to ${duplicateEmail.fullName} (${duplicateEmail.employeeId}).`
      );
    }
  }

  const existingIds = existingEmployees.map((e) => e.employeeId);
  let employeeId = generateSequentialId('EMP', existingIds);
  if (useLiveFirestore(isPreviewSession)) {
    const collisionCheck = await getDoc(doc(firestoreDb!, 'employees', employeeId));
    if (collisionCheck.exists()) {
      employeeId = `${employeeId}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    }
  }

  const nowIso = new Date().toISOString();
  const actorLabel = `${caller.fullName} (${caller.role})`;

  const cleanInitialPassword = (authOptions?.initialPassword ?? '').trim();
  if (cleanInitialPassword.length > 0 && cleanInitialPassword.length < 6) {
    throw new Error('Employee Portal Login Password must be at least 6 characters long.');
  }

  let portalLoginEmail = sanitizeInput(
    normalizedEmail || buildSystemPortalLoginEmail(employeeId),
    160
  );
  let portalPassword = generateDefaultPortalPassword(input.mobile, cleanInitialPassword);
  let provisionedEmployeeUid = `preview-emp-${employeeId.toLowerCase()}`;

  if (useLiveFirestore(isPreviewSession)) {
    const provisioned = await provisionFirebaseUserIsolated({
      email: portalLoginEmail,
      initialPassword: cleanInitialPassword,
      mobileForDefaultPassword: input.mobile,
      existingAuthUid: input.linkedUid,
    });
    provisionedEmployeeUid = provisioned.uid;
    portalLoginEmail = provisioned.emailUsed;
    portalPassword = provisioned.passwordUsed;
  }

  const linkedUid = provisionedEmployeeUid;

  const assignedDesignations = buildAssignedDesignationList(
    input.selectedDesignationIds,
    input.eligibilityConfirmations,
    designations,
    actorLabel,
    nowIso
  );

  const assignedServiceCategories = Array.from(
    new Set<ServiceCategory>(assignedDesignations.map((d) => d.serviceCategory))
  );
  const assignedServiceIds = Array.from(new Set(assignedDesignations.map((d) => d.serviceId)));
  const assignedServiceNames = Array.from(new Set(assignedDesignations.map((d) => d.serviceName)));
  const assignedDesignationIds = assignedDesignations.map((d) => d.designationId);

  const isActive = input.employeeStatus === 'Active';

  const record: EmployeeRecord = {
    employeeId,
    linkedUid,
    fullName: sanitizeInput(input.fullName, 120),
    fatherOrSpouseName: sanitizeInput(input.fatherOrSpouseName, 120),
    dateOfBirth: sanitizeInput(input.dateOfBirth, 20),
    gender: input.gender,
    mobile: sanitizeInput(input.mobile, 20),
    alternateMobile: sanitizeInput(input.alternateMobile, 20),
    email: portalLoginEmail,
    currentAddress: sanitizeInput(input.currentAddress, 300),
    permanentAddress: sanitizeInput(input.permanentAddress, 300),
    city: sanitizeInput(input.city, 80),
    state: sanitizeInput(input.state, 80),
    pinCode: sanitizeInput(input.pinCode, 10),
    emergencyContactName: sanitizeInput(input.emergencyContactName, 120),
    emergencyContactNumber: sanitizeInput(input.emergencyContactNumber, 20),
    profilePhoto: input.profilePhoto || '',
    joiningDate: sanitizeInput(input.joiningDate, 20),
    branchId: branchObj.branchId,
    branchName: `${branchObj.branchCode} — ${branchObj.branchName}`,
    employmentType: input.employmentType,
    employeeStatus: input.employeeStatus,
    assignedServiceCategories,
    assignedServiceIds,
    assignedServiceNames,
    assignedDesignationIds,
    assignedDesignations,
    skillsAndExperience: sanitizeInput(input.skillsAndExperience, 400),
    qualification: sanitizeInput(input.qualification, 200),
    trainingDetails: sanitizeInput(input.trainingDetails, 250),
    licenseDetails: sanitizeInput(input.licenseDetails, 250),
    reportingFieldOfficerUid: sanitizeInput(input.reportingFieldOfficerUid, 128),
    reportingFieldOfficerName: sanitizeInput(input.reportingFieldOfficerName, 120),
    currentSiteId: siteObj ? siteObj.siteId : '',
    currentSiteName: siteObj ? `${siteObj.siteName} (${siteObj.clientName})` : '',
    notes: sanitizeInput(input.notes, 400),
    docVerificationSummary: 'No Documents',
    totalDocumentsCount: 0,
    pendingDocumentsCount: 0,
    isActive,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: actorLabel,
    updatedBy: actorLabel,
  };

  const empPortal = getPortalByRole('employee');
  const issuedCredentials: IssuedPortalCredentials = {
    role: 'employee',
    portalName: empPortal.portalName,
    loginPath: empPortal.loginPath,
    systemId: employeeId,
    fullName: record.fullName,
    loginEmail: portalLoginEmail,
    loginPassword: portalPassword,
    uid: linkedUid,
    branchLabel: record.branchName,
    siteLabel: record.currentSiteName || 'Available Pool',
    isPreviewMode: !useLiveFirestore(isPreviewSession),
  };

  const canSavePrivate =
    input.includePrivateFinancials && canCallerReadSensitivePrivate(caller, record.branchId);

  const cleanAcc = input.bankAccountNumber.replace(/\s+/g, '');
  const cleanAadhaar = input.aadhaarNumber.replace(/[\s-]/g, '');

  const privateRecord: EmployeePrivateRecord | null = canSavePrivate
    ? {
        employeeId,
        linkedUid,
        branchId: record.branchId,
        salaryType: input.salaryType,
        basicSalary: Math.round(Number(input.basicSalary) * 100) / 100,
        bankAccountNumber: sanitizeInput(cleanAcc, 24),
        bankAccountHolderName: sanitizeInput(input.bankAccountHolderName, 120),
        bankName: sanitizeInput(input.bankName, 120),
        ifscCode: sanitizeInput(input.ifscCode.toUpperCase(), 16),
        panNumber: sanitizeInput(input.panNumber.toUpperCase(), 12),
        aadhaarNumber: sanitizeInput(cleanAadhaar, 16),
        aadhaarMasked: maskAadhaarNumber(cleanAadhaar),
        bankAccountMasked: maskBankAccount(cleanAcc),
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: actorLabel,
        updatedBy: actorLabel,
      }
    : null;

  const historyItems: EmployeeHistoryRecord[] = [
    buildHistoryRecord(caller, {
      employeeId,
      linkedUid,
      branchId: record.branchId,
      category: 'Activity',
      action: 'Employee Registered',
      summary: `Registered ${record.fullName} (${employeeId}) under ${record.branchName} as ${record.employmentType} (${record.employeeStatus}) with Portal Login ${portalLoginEmail}.`,
      timestamp: nowIso,
    }),
    buildHistoryRecord(caller, {
      employeeId,
      linkedUid,
      branchId: record.branchId,
      category: 'Designation',
      action: 'Initial Designation Eligibility Verified',
      summary: `Assigned ${assignedDesignations.map((d) => `${d.designationName} (${d.serviceCategory})`).join(', ')} with qualification, training, and license checks verified.`,
      timestamp: nowIso,
    }),
  ];

  if (siteObj) {
    historyItems.push(
      buildHistoryRecord(caller, {
        employeeId,
        linkedUid,
        branchId: record.branchId,
        category: 'SiteAssignment',
        action: 'Initial Site Deployment',
        summary: `Assigned to site ${siteObj.siteId} — ${siteObj.siteName} (${siteObj.clientName}).`,
        metadata: {
          siteId: siteObj.siteId,
          siteName: siteObj.siteName,
        },
        timestamp: nowIso,
      })
    );
  }

  const auditSummary = `Registered Employee ${employeeId} (${record.fullName}) · Designations: ${assignedDesignations
    .map((d) => d.designationName)
    .join(', ')} · Branch: ${branchObj.branchCode}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    store.employees.unshift(record);
    if (privateRecord) {
      store.employeePrivate[employeeId] = privateRecord;
    }
    store.employeeHistory.unshift(...historyItems);
    writeLocalEmployeeStore(store);

    upsertPreviewProvisionedUser({
      uid: linkedUid,
      systemId: employeeId,
      fullName: record.fullName,
      email: portalLoginEmail,
      phone: record.mobile,
      ...(record.profilePhoto ? { profilePhoto: record.profilePhoto } : {}),
      designationLabel: assignedDesignations[0]?.designationName || 'Employee',
      initialAccessKey: portalPassword,
      role: 'employee',
      branchId: record.branchId,
      assignedBranches: [record.branchId],
      assignedSiteIds: siteObj ? [siteObj.siteId] : [],
      permissions: [],
      isActive: record.isActive,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Registered',
      module: 'Employee',
      recordId: employeeId,
      branchId: record.branchId,
      summary: auditSummary,
    });
    return { ...record, issuedCredentials };
  }

  const path = `employees/${employeeId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    const empUserPayload = {
      uid: provisionedEmployeeUid,
      systemId: employeeId,
      fullName: record.fullName,
      email: portalLoginEmail,
      phone: record.mobile,
      ...(record.profilePhoto ? { profilePhoto: record.profilePhoto } : {}),
      designationLabel: sanitizeInput(
        assignedDesignations[0]?.designationName || 'Employee',
        100
      ),
      initialAccessKey: portalPassword,
      role: 'employee',
      branchId: record.branchId,
      assignedBranches: [record.branchId],
      assignedSiteIds: siteObj ? [siteObj.siteId] : [],
      permissions: [],
      isActive: record.isActive,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const canBatchProvisionUser =
      caller.role === 'admin' ||
      (caller.role === 'hr' && hasUserPermission(caller, 'employee.manage'));

    if (provisionedEmployeeUid && canBatchProvisionUser) {
      batch.set(doc(firestoreDb!, 'users', provisionedEmployeeUid), empUserPayload);
    }

    batch.set(doc(firestoreDb!, 'employees', employeeId), {
      ...record,
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });

    if (privateRecord) {
      batch.set(doc(firestoreDb!, 'employeePrivate', employeeId), {
        ...privateRecord,
        serverUpdatedAt: serverTimestamp(),
      });
    }

    for (const h of historyItems) {
      batch.set(doc(firestoreDb!, 'employeeHistory', h.historyId), {
        ...h,
        serverCreatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    if (provisionedEmployeeUid && !canBatchProvisionUser) {
      try {
        await setDoc(doc(firestoreDb!, 'users', provisionedEmployeeUid), empUserPayload);
      } catch {
        // Non-fatal if HR user lacks employee.manage on older deployed ruleset
      }
    }

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Registered',
      module: 'Employee',
      recordId: employeeId,
      branchId: record.branchId,
      summary: auditSummary,
    });
    notifyEmployeeListeners();
    return { ...record, issuedCredentials };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function getIssuedCredentialsForEmployee(
  caller: RexonUser,
  isPreviewSession: boolean,
  emp: EmployeeRecord
): Promise<IssuedPortalCredentials> {
  if (
    caller.role !== 'admin' &&
    !(
      caller.role === 'hr' &&
      (hasUserPermission(caller, 'employee.manage') || hasUserPermission(caller, 'employee.create'))
    )
  ) {
    throw new Error('Unauthorized to view Employee Portal credentials.');
  }

  const empPortal = getPortalByRole('employee');
  let uid = emp.linkedUid || '';
  let loginEmail =
    emp.email?.trim().toLowerCase() || buildSystemPortalLoginEmail(emp.employeeId);
  let loginPassword = generateDefaultPortalPassword(emp.mobile);

  const existingUserDoc = uid
    ? await getPortalUserByUid(caller, uid, isPreviewSession)
    : null;

  if (existingUserDoc) {
    loginEmail = existingUserDoc.email || loginEmail;
    loginPassword = existingUserDoc.initialAccessKey || loginPassword;
  } else if (
    useLiveFirestore(isPreviewSession) &&
    (caller.role === 'admin' || hasUserPermission(caller, 'employee.manage'))
  ) {
    const isolated = await provisionFirebaseUserIsolated({
      email: loginEmail,
      mobileForDefaultPassword: emp.mobile,
    });
    uid = isolated.uid;
    loginEmail = isolated.emailUsed;
    loginPassword = isolated.passwordUsed;
    const nowIso = new Date().toISOString();
    await setDoc(doc(firestoreDb!, 'users', uid), {
      uid,
      systemId: emp.employeeId,
      fullName: emp.fullName,
      email: loginEmail,
      phone: emp.mobile,
      ...(emp.profilePhoto ? { profilePhoto: emp.profilePhoto } : {}),
      designationLabel: sanitizeInput(
        emp.assignedDesignations?.[0]?.designationName || 'Employee',
        100
      ),
      initialAccessKey: loginPassword,
      role: 'employee',
      branchId: emp.branchId,
      assignedBranches: [emp.branchId],
      assignedSiteIds: emp.currentSiteId ? [emp.currentSiteId] : [],
      permissions: [],
      isActive: emp.isActive,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await updateDoc(doc(firestoreDb!, 'employees', emp.employeeId), {
      linkedUid: uid,
      email: loginEmail,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    notifyEmployeeListeners();
  }

  return {
    role: 'employee',
    portalName: empPortal.portalName,
    loginPath: empPortal.loginPath,
    systemId: emp.employeeId,
    fullName: emp.fullName,
    loginEmail,
    loginPassword,
    uid: uid || `emp-${emp.employeeId.toLowerCase()}`,
    branchLabel: emp.branchName,
    siteLabel: emp.currentSiteName || 'Available Pool',
    isPreviewMode: !useLiveFirestore(isPreviewSession),
  };
}

export async function updateEmployeeRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  employeeId: string,
  input: EmployeeFormInput
): Promise<EmployeeRecord> {
  assertNotSitePortal(caller);
  if (caller.role !== 'admin' && !hasUserPermission(caller, 'employee.edit')) {
    throw new Error('Updating an employee requires Admin authority or HR employee.edit permission.');
  }

  const existing = await getEmployeeById(caller, isPreviewSession, employeeId);
  if (!existing) {
    throw new Error(`Employee ${employeeId} not found.`);
  }

  if (caller.role === 'hr') {
    const allowed = getAuthorizedBranchIds(caller);
    if (!allowed.includes(existing.branchId) || !allowed.includes(input.branchId)) {
      throw new Error('HR accounts can only edit employees within their assigned branch(es).');
    }
  }

  const [branches, designations, sites] = await Promise.all([
    listBranches(caller, isPreviewSession),
    listDesignations(caller, isPreviewSession),
    listSites(caller, isPreviewSession),
  ]);

  const validation = validateEmployeeForm(input, designations, caller);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Employee validation failed.');
  }

  const branchObj = branches.find((b) => b.branchId === input.branchId && !b.isDeleted);
  if (!branchObj) {
    throw new Error('Selected Branch does not exist or is inactive.');
  }

  const siteObj = input.currentSiteId
    ? sites.find((s) => s.siteId === input.currentSiteId && !s.isArchived)
    : undefined;
  if (input.currentSiteId && !siteObj) {
    throw new Error('Selected Deployment Site could not be found.');
  }

  const peerEmployees = !useLiveFirestore(isPreviewSession)
    ? readLocalEmployeeStore().employees
    : await listEmployees(caller, isPreviewSession);
  const normalizedPhone = input.mobile.replace(/\D/g, '').slice(-10);
  const normalizedEmail = input.email.trim().toLowerCase();
  const duplicateMobile = peerEmployees.find(
    (e) =>
      !e.isDeleted &&
      e.employeeId !== employeeId &&
      e.mobile.replace(/\D/g, '').slice(-10) === normalizedPhone
  );
  if (duplicateMobile) {
    throw new Error(
      `Duplicate prevented: Mobile number ${input.mobile.trim()} is already registered to ${duplicateMobile.fullName} (${duplicateMobile.employeeId}).`
    );
  }
  if (normalizedEmail) {
    const duplicateEmail = peerEmployees.find(
      (e) =>
        !e.isDeleted &&
        e.employeeId !== employeeId &&
        e.email &&
        e.email.trim().toLowerCase() === normalizedEmail
    );
    if (duplicateEmail) {
      throw new Error(
        `Duplicate prevented: Email "${normalizedEmail}" is already registered to ${duplicateEmail.fullName} (${duplicateEmail.employeeId}).`
      );
    }
  }
  if (!useLiveFirestore(isPreviewSession) && input.includePrivateFinancials) {
    const localStore = readLocalEmployeeStore();
    const cleanAadhaarCheck = input.aadhaarNumber.replace(/[\s-]/g, '');
    const cleanPanCheck = input.panNumber.trim().toUpperCase();
    for (const emp of localStore.employees) {
      if (emp.isDeleted || emp.employeeId === employeeId) continue;
      const priv = localStore.employeePrivate[emp.employeeId];
      if (!priv) continue;
      if (cleanAadhaarCheck && priv.aadhaarNumber === cleanAadhaarCheck) {
        throw new Error(
          `Duplicate prevented: Aadhaar number is already registered to active employee ${emp.fullName} (${emp.employeeId}).`
        );
      }
      if (cleanPanCheck && priv.panNumber.toUpperCase() === cleanPanCheck) {
        throw new Error(
          `Duplicate prevented: PAN "${cleanPanCheck}" is already registered to active employee ${emp.fullName} (${emp.employeeId}).`
        );
      }
    }
  }

  const nowIso = new Date().toISOString();
  const actorLabel = `${caller.fullName} (${caller.role})`;
  const linkedUid = await resolveLinkedEmployeeUid(
    input.linkedUid || existing.linkedUid,
    input.email,
    isPreviewSession
  );

  const assignedDesignations = buildAssignedDesignationList(
    input.selectedDesignationIds,
    input.eligibilityConfirmations,
    designations,
    actorLabel,
    nowIso,
    existing.assignedDesignations
  );

  const assignedServiceCategories = Array.from(
    new Set<ServiceCategory>(assignedDesignations.map((d) => d.serviceCategory))
  );
  const assignedServiceIds = Array.from(new Set(assignedDesignations.map((d) => d.serviceId)));
  const assignedServiceNames = Array.from(new Set(assignedDesignations.map((d) => d.serviceName)));
  const assignedDesignationIds = assignedDesignations.map((d) => d.designationId);

  const updated: EmployeeRecord = {
    ...existing,
    linkedUid,
    fullName: sanitizeInput(input.fullName, 120),
    fatherOrSpouseName: sanitizeInput(input.fatherOrSpouseName, 120),
    dateOfBirth: sanitizeInput(input.dateOfBirth, 20),
    gender: input.gender,
    mobile: sanitizeInput(input.mobile, 20),
    alternateMobile: sanitizeInput(input.alternateMobile, 20),
    email: sanitizeInput(input.email.toLowerCase(), 160),
    currentAddress: sanitizeInput(input.currentAddress, 300),
    permanentAddress: sanitizeInput(input.permanentAddress, 300),
    city: sanitizeInput(input.city, 80),
    state: sanitizeInput(input.state, 80),
    pinCode: sanitizeInput(input.pinCode, 10),
    emergencyContactName: sanitizeInput(input.emergencyContactName, 120),
    emergencyContactNumber: sanitizeInput(input.emergencyContactNumber, 20),
    profilePhoto: input.profilePhoto || existing.profilePhoto || '',
    joiningDate: sanitizeInput(input.joiningDate, 20),
    branchId: branchObj.branchId,
    branchName: `${branchObj.branchCode} — ${branchObj.branchName}`,
    employmentType: input.employmentType,
    employeeStatus: input.employeeStatus,
    assignedServiceCategories,
    assignedServiceIds,
    assignedServiceNames,
    assignedDesignationIds,
    assignedDesignations,
    skillsAndExperience: sanitizeInput(input.skillsAndExperience, 400),
    qualification: sanitizeInput(input.qualification, 200),
    trainingDetails: sanitizeInput(input.trainingDetails, 250),
    licenseDetails: sanitizeInput(input.licenseDetails, 250),
    reportingFieldOfficerUid: sanitizeInput(input.reportingFieldOfficerUid, 128),
    reportingFieldOfficerName: sanitizeInput(input.reportingFieldOfficerName, 120),
    currentSiteId: siteObj ? siteObj.siteId : '',
    currentSiteName: siteObj ? `${siteObj.siteName} (${siteObj.clientName})` : '',
    notes: sanitizeInput(input.notes, 400),
    isActive: input.employeeStatus === 'Active',
    updatedAt: nowIso,
    updatedBy: actorLabel,
  };

  const historyItems: EmployeeHistoryRecord[] = [
    buildHistoryRecord(caller, {
      employeeId,
      linkedUid,
      branchId: updated.branchId,
      category: 'Activity',
      action: 'Employee Profile Updated',
      summary: `Updated profile details for ${updated.fullName} (${employeeId}) · Status: ${updated.employeeStatus}.`,
      timestamp: nowIso,
    }),
  ];

  // Track Designation History if designations changed
  const prevDesigSet = [...existing.assignedDesignationIds].sort().join(',');
  const nextDesigSet = [...assignedDesignationIds].sort().join(',');
  if (prevDesigSet !== nextDesigSet) {
    historyItems.push(
      buildHistoryRecord(caller, {
        employeeId,
        linkedUid,
        branchId: updated.branchId,
        category: 'Designation',
        action: 'Designations Updated',
        summary: `Updated designations to: ${assignedDesignations
          .map((d) => `${d.designationName} (${d.serviceCategory})`)
          .join(', ')}.`,
        timestamp: nowIso,
      })
    );
  }

  // Track Site Assignment History if currentSiteId changed
  if (existing.currentSiteId !== updated.currentSiteId) {
    const siteAction = updated.currentSiteId
      ? existing.currentSiteId
        ? 'Site Transfer / Reassignment'
        : 'Assigned to Deployment Site'
      : 'Unassigned / Released from Site';
    const siteSummary = updated.currentSiteId
      ? `Deployed to ${updated.currentSiteId} — ${updated.currentSiteName}${
          existing.currentSiteId ? ` (previously ${existing.currentSiteId})` : ''
        }.`
      : `Released from ${existing.currentSiteId} (${existing.currentSiteName}) to Available Pool.`;

    historyItems.push(
      buildHistoryRecord(caller, {
        employeeId,
        linkedUid,
        branchId: updated.branchId,
        category: 'SiteAssignment',
        action: siteAction,
        summary: siteSummary,
        metadata: {
          previousSiteId: existing.currentSiteId || 'UNASSIGNED',
          currentSiteId: updated.currentSiteId || 'UNASSIGNED',
        },
        timestamp: nowIso,
      })
    );
  }

  const canSavePrivate =
    input.includePrivateFinancials && canCallerReadSensitivePrivate(caller, updated.branchId);
  const existingPrivate = canSavePrivate
    ? await getEmployeePrivateData(caller, isPreviewSession, employeeId, existing.branchId)
    : null;

  const cleanAcc = input.bankAccountNumber.replace(/\s+/g, '');
  const cleanAadhaar = input.aadhaarNumber.replace(/[\s-]/g, '');

  const nextPrivateRecord: EmployeePrivateRecord | null = canSavePrivate
    ? {
        employeeId,
        linkedUid,
        branchId: updated.branchId,
        salaryType: input.salaryType,
        basicSalary: Math.round(Number(input.basicSalary) * 100) / 100,
        bankAccountNumber: sanitizeInput(cleanAcc, 24),
        bankAccountHolderName: sanitizeInput(input.bankAccountHolderName, 120),
        bankName: sanitizeInput(input.bankName, 120),
        ifscCode: sanitizeInput(input.ifscCode.toUpperCase(), 16),
        panNumber: sanitizeInput(input.panNumber.toUpperCase(), 12),
        aadhaarNumber: sanitizeInput(cleanAadhaar, 16),
        aadhaarMasked: maskAadhaarNumber(cleanAadhaar),
        bankAccountMasked: maskBankAccount(cleanAcc),
        createdAt: existingPrivate?.createdAt ?? nowIso,
        updatedAt: nowIso,
        createdBy: existingPrivate?.createdBy ?? actorLabel,
        updatedBy: actorLabel,
      }
    : null;

  const auditSummary = `Updated Employee ${employeeId} (${updated.fullName}) · Status: ${updated.employeeStatus} · Site: ${
    updated.currentSiteId || 'Unassigned'
  }.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    store.employees = store.employees.map((e) => (e.employeeId === employeeId ? updated : e));
    if (nextPrivateRecord) {
      store.employeePrivate[employeeId] = nextPrivateRecord;
    }
    store.employeeHistory.unshift(...historyItems);
    writeLocalEmployeeStore(store);
    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Updated',
      module: 'Employee',
      recordId: employeeId,
      branchId: updated.branchId,
      summary: auditSummary,
    });
    return updated;
  }

  const path = `employees/${employeeId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(
      doc(firestoreDb!, 'employees', employeeId),
      {
        ...updated,
        serverUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (nextPrivateRecord) {
      batch.set(
        doc(firestoreDb!, 'employeePrivate', employeeId),
        {
          ...nextPrivateRecord,
          serverUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    for (const h of historyItems) {
      batch.set(doc(firestoreDb!, 'employeeHistory', h.historyId), {
        ...h,
        serverCreatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    if (updated.linkedUid && caller.role === 'admin') {
      try {
        await updateDoc(doc(firestoreDb!, 'users', updated.linkedUid), {
          fullName: updated.fullName,
          phone: updated.mobile,
          ...(updated.profilePhoto ? { profilePhoto: updated.profilePhoto } : {}),
          branchId: updated.branchId,
          assignedBranches: [updated.branchId],
          assignedSiteIds: updated.currentSiteId ? [updated.currentSiteId] : [],
          isActive: updated.isActive,
          updatedAt: nowIso,
        });
      } catch {
        // Non-fatal if linked user doc was not yet created
      }
    }

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Updated',
      module: 'Employee',
      recordId: employeeId,
      branchId: updated.branchId,
      summary: auditSummary,
    });
    notifyEmployeeListeners();
    return updated;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function toggleEmployeeActiveStatus(
  caller: RexonUser,
  isPreviewSession: boolean,
  employeeId: string,
  nextStatus: EmployeeStatus
): Promise<void> {
  assertNotSitePortal(caller);
  if (caller.role !== 'admin' && !hasUserPermission(caller, 'employee.edit')) {
    throw new Error('Changing employee status requires Admin authority or HR employee.edit permission.');
  }

  const existing = await getEmployeeById(caller, isPreviewSession, employeeId);
  if (!existing) {
    throw new Error(`Employee ${employeeId} not found.`);
  }
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(existing.branchId)) {
    throw new Error('Unauthorized branch scope.');
  }

  const nowIso = new Date().toISOString();
  const actorLabel = `${caller.fullName} (${caller.role})`;
  const isActive = nextStatus === 'Active';

  const historyItem = buildHistoryRecord(caller, {
    employeeId,
    linkedUid: existing.linkedUid,
    branchId: existing.branchId,
    category: 'Activity',
    action: isActive ? 'Employee Activated' : `Status Changed to ${nextStatus}`,
    summary: `Changed employee status from ${existing.employeeStatus} to ${nextStatus}.`,
    timestamp: nowIso,
  });

  const auditSummary = `Changed status of Employee ${employeeId} (${existing.fullName}) to ${nextStatus}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    store.employees = store.employees.map((e) =>
      e.employeeId === employeeId
        ? {
            ...e,
            employeeStatus: nextStatus,
            isActive,
            updatedAt: nowIso,
            updatedBy: actorLabel,
          }
        : e
    );
    store.employeeHistory.unshift(historyItem);
    writeLocalEmployeeStore(store);
    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Status Changed',
      module: 'Employee',
      recordId: employeeId,
      branchId: existing.branchId,
      summary: auditSummary,
    });
    return;
  }

  const path = `employees/${employeeId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'employees', employeeId), {
      employeeStatus: nextStatus,
      isActive,
      updatedAt: nowIso,
      updatedBy: actorLabel,
      serverUpdatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'employeeHistory', historyItem.historyId), {
      ...historyItem,
      serverCreatedAt: serverTimestamp(),
    });
    await batch.commit();

    if (existing.linkedUid && caller.role === 'admin') {
      try {
        await updateDoc(doc(firestoreDb!, 'users', existing.linkedUid), {
          isActive,
          updatedAt: nowIso,
        });
      } catch {
        // Non-fatal
      }
    }

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Status Changed',
      module: 'Employee',
      recordId: employeeId,
      branchId: existing.branchId,
      summary: auditSummary,
    });
    notifyEmployeeListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function softDeleteEmployeeRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  employeeId: string,
  reason: string
): Promise<void> {
  assertNotSitePortal(caller);
  if (caller.role !== 'admin' && !hasUserPermission(caller, 'employee.delete')) {
    throw new Error(
      'Direct employee soft-deletion requires Admin authority or HR employee.delete permission. Submit an Employee Deletion approval request instead.'
    );
  }

  const existing = await getEmployeeById(caller, isPreviewSession, employeeId);
  if (!existing) {
    throw new Error(`Employee ${employeeId} not found.`);
  }
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(existing.branchId)) {
    throw new Error('Unauthorized branch scope.');
  }

  const nowIso = new Date().toISOString();
  const actorLabel = `${caller.fullName} (${caller.role})`;
  const cleanReason = sanitizeInput(reason || 'Archived by authorized personnel.', 250);

  const historyItem = buildHistoryRecord(caller, {
    employeeId,
    linkedUid: existing.linkedUid,
    branchId: existing.branchId,
    category: 'Activity',
    action: 'Employee Soft-Deleted',
    summary: `Soft-deleted employee ${employeeId} (${existing.fullName}). Reason: ${cleanReason}`,
    timestamp: nowIso,
  });

  const auditSummary = `Soft-deleted Employee ${employeeId} (${existing.fullName}) · Historical records preserved. Reason: ${cleanReason}`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    store.employees = store.employees.map((e) =>
      e.employeeId === employeeId
        ? {
            ...e,
            employeeStatus: 'Inactive',
            isActive: false,
            isDeleted: true,
            deletedAt: nowIso,
            deletedBy: actorLabel,
            updatedAt: nowIso,
            updatedBy: actorLabel,
          }
        : e
    );
    store.employeeHistory.unshift(historyItem);
    writeLocalEmployeeStore(store);
    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Soft-Deleted',
      module: 'Employee',
      recordId: employeeId,
      branchId: existing.branchId,
      summary: auditSummary,
    });
    return;
  }

  const path = `employees/${employeeId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'employees', employeeId), {
      employeeStatus: 'Inactive',
      isActive: false,
      isDeleted: true,
      deletedAt: nowIso,
      deletedBy: caller.uid,
      updatedAt: nowIso,
      updatedBy: actorLabel,
      serverUpdatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'employeeHistory', historyItem.historyId), {
      ...historyItem,
      serverCreatedAt: serverTimestamp(),
    });
    await batch.commit();

    if (existing.linkedUid && caller.role === 'admin') {
      try {
        await updateDoc(doc(firestoreDb!, 'users', existing.linkedUid), {
          isActive: false,
          updatedAt: nowIso,
        });
      } catch {
        // Non-fatal
      }
    }

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Soft-Deleted',
      module: 'Employee',
      recordId: employeeId,
      branchId: existing.branchId,
      summary: auditSummary,
    });
    notifyEmployeeListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 3. EMPLOYEE DOCUMENT MANAGEMENT (`employeeDocuments` + FIREBASE STORAGE)
// ============================================================================
export async function listEmployeeDocuments(
  caller: RexonUser,
  isPreviewSession: boolean,
  employeeId: string
): Promise<EmployeeDocumentRecord[]> {
  // Never accessible to Site Portal or Field Officers
  if (caller.role === 'site' || caller.role === 'field_officer') {
    return [];
  }

  const emp = await getEmployeeById(caller, isPreviewSession, employeeId);
  if (!emp) return [];

  const canReadSensitiveDocs = canCallerReadSensitivePrivate(caller, emp.branchId) ||
    hasUserPermission(caller, 'employee.verify_docs');

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    return store.employeeDocuments
      .filter((d) => {
        if (d.employeeId !== employeeId) return false;
        if (caller.role === 'employee') {
          return !d.isSensitiveKyc && (d.linkedUid === caller.uid || emp.linkedUid === caller.uid);
        }
        if (d.isSensitiveKyc && !canReadSensitiveDocs) return false;
        return true;
      })
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  const path = 'employeeDocuments';
  try {
    const q =
      caller.role === 'employee'
        ? query(
            collection(firestoreDb!, path),
            where('employeeId', '==', employeeId),
            where('linkedUid', '==', caller.uid),
            where('isSensitiveKyc', '==', false)
          )
        : query(collection(firestoreDb!, path), where('employeeId', '==', employeeId));

    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as EmployeeDocumentRecord)
      .filter((d) => (d.isSensitiveKyc ? canReadSensitiveDocs : true))
      .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function uploadEmployeeDocument(
  caller: RexonUser,
  isPreviewSession: boolean,
  params: {
    employeeId: string;
    documentType: EmployeeDocumentType;
    file: File;
    remarks?: string;
  }
): Promise<EmployeeDocumentRecord> {
  assertNotSitePortal(caller);
  if (
    caller.role !== 'admin' &&
    !hasUserPermission(caller, 'employee.edit') &&
    !hasUserPermission(caller, 'employee.create') &&
    !hasUserPermission(caller, 'employee.verify_docs')
  ) {
    throw new Error('Uploading employee documents requires Admin or authorized HR permissions.');
  }

  const fileCheck = validateEmployeeDocumentFile(params.file, params.documentType);
  if (!fileCheck.valid) {
    throw new Error(fileCheck.error ?? 'Document validation failed.');
  }

  const emp = await getEmployeeById(caller, isPreviewSession, params.employeeId);
  if (!emp) {
    throw new Error(`Employee ${params.employeeId} not found.`);
  }
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(emp.branchId)) {
    throw new Error('Unauthorized branch scope for document upload.');
  }

  const isSensitiveKyc = SENSITIVE_KYC_DOCUMENT_TYPES.includes(params.documentType);
  if (
    isSensitiveKyc &&
    caller.role === 'hr' &&
    !hasUserPermission(caller, 'employee.sensitive') &&
    !hasUserPermission(caller, 'employee.verify_docs')
  ) {
    throw new Error(
      'Uploading sensitive KYC documents (Aadhaar, PAN, Police Verification, Bank Proof) requires employee.sensitive or employee.verify_docs permission.'
    );
  }

  const existingDocs = await listEmployeeDocuments(caller, isPreviewSession, emp.employeeId);
  const documentId = generateSequentialId(
    'DOC',
    existingDocs.map((d) => d.documentId)
  );
  const safeFileName = params.file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90);
  const storageBucketFolder = isSensitiveKyc ? 'employee_kyc' : 'employee_documents';
  const targetOwnerKey = emp.linkedUid || emp.employeeId;
  const storagePath = `${storageBucketFolder}/${emp.branchId}/${targetOwnerKey}/${Date.now()}_${safeFileName}`;

  let downloadUrl = '';
  if (useLiveFirestore(isPreviewSession) && firebaseStorage) {
    const remoteUrl = await uploadToStorageWithFastTimeout(storagePath, params.file, 4500);
    if (remoteUrl) {
      downloadUrl = remoteUrl;
    }
  }
  if (!downloadUrl) {
    if (params.file.type.startsWith('image/')) {
      downloadUrl = await compressImageFileToDataUrl(params.file, 1050, 0.74);
    } else if (!useLiveFirestore(isPreviewSession) || params.file.size <= 650 * 1024) {
      downloadUrl = await readFileAsDataUrl(params.file);
    } else {
      throw new Error(
        'Firebase Storage is not initialized on this project yet. Upload an image scan (JPG, PNG, WEBP) or a PDF under 650 KB, or enable Firebase Storage in Firebase Console.'
      );
    }
  }

  const nowIso = new Date().toISOString();
  const actorLabel = `${caller.fullName} (${caller.role})`;

  const docRecord: EmployeeDocumentRecord = {
    documentId,
    employeeId: emp.employeeId,
    linkedUid: emp.linkedUid || '',
    branchId: emp.branchId,
    documentType: params.documentType,
    isSensitiveKyc,
    fileName: sanitizeInput(params.file.name, 120),
    mimeType: params.file.type,
    fileSizeBytes: params.file.size,
    storagePath,
    downloadUrl,
    uploadedAt: nowIso,
    uploadedBy: actorLabel,
    uploadedByUid: caller.uid,
    verificationStatus: 'Pending',
    verificationRemarks: sanitizeInput(params.remarks || 'Uploaded; awaiting KYC verification.', 250),
    verifiedBy: null,
    verifiedByUid: null,
    verifiedAt: null,
    updatedAt: nowIso,
  };

  const allDocsAfter = [docRecord, ...existingDocs];
  const rollup = computeDocVerificationSummary(allDocsAfter);

  const historyItem = buildHistoryRecord(caller, {
    employeeId: emp.employeeId,
    linkedUid: emp.linkedUid,
    branchId: emp.branchId,
    category: 'Activity',
    action: 'Document Uploaded',
    summary: `Uploaded ${params.documentType} (${docRecord.fileName}) · Status: Pending Verification.`,
    timestamp: nowIso,
  });

  const auditSummary = `Uploaded ${params.documentType} (${documentId}) for Employee ${emp.employeeId} (${emp.fullName}).`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    store.employeeDocuments.unshift(docRecord);
    store.employees = store.employees.map((e) =>
      e.employeeId === emp.employeeId
        ? {
            ...e,
            ...(params.documentType === 'Photograph' && !e.profilePhoto
              ? { profilePhoto: downloadUrl }
              : {}),
            docVerificationSummary: rollup.summary,
            totalDocumentsCount: rollup.totalCount,
            pendingDocumentsCount: rollup.pendingCount,
            updatedAt: nowIso,
            updatedBy: actorLabel,
          }
        : e
    );
    store.employeeHistory.unshift(historyItem);
    writeLocalEmployeeStore(store);
    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Document Uploaded',
      module: 'Employee',
      recordId: emp.employeeId,
      branchId: emp.branchId,
      summary: auditSummary,
    });
    return docRecord;
  }

  const path = `employeeDocuments/${documentId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'employeeDocuments', documentId), {
      ...docRecord,
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });
    batch.update(doc(firestoreDb!, 'employees', emp.employeeId), {
      ...(params.documentType === 'Photograph' && !emp.profilePhoto
        ? { profilePhoto: downloadUrl }
        : {}),
      docVerificationSummary: rollup.summary,
      totalDocumentsCount: rollup.totalCount,
      pendingDocumentsCount: rollup.pendingCount,
      updatedAt: nowIso,
      updatedBy: actorLabel,
      serverUpdatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'employeeHistory', historyItem.historyId), {
      ...historyItem,
      serverCreatedAt: serverTimestamp(),
    });
    await batch.commit();
    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Document Uploaded',
      module: 'Employee',
      recordId: emp.employeeId,
      branchId: emp.branchId,
      summary: auditSummary,
    });
    notifyEmployeeListeners();
    return docRecord;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function verifyEmployeeDocument(
  caller: RexonUser,
  isPreviewSession: boolean,
  params: {
    documentId: string;
    employeeId: string;
    status: DocumentVerificationStatus;
    remarks: string;
  }
): Promise<void> {
  assertNotSitePortal(caller);
  if (caller.role !== 'admin' && !hasUserPermission(caller, 'employee.verify_docs')) {
    throw new Error(
      'Verifying or rejecting employee documents requires Admin authority or HR employee.verify_docs permission.'
    );
  }

  const emp = await getEmployeeById(caller, isPreviewSession, params.employeeId);
  if (!emp) {
    throw new Error(`Employee ${params.employeeId} not found.`);
  }
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(emp.branchId)) {
    throw new Error('Unauthorized branch scope.');
  }

  const nowIso = new Date().toISOString();
  const actorLabel = `${caller.fullName} (${caller.role})`;
  const cleanRemarks = sanitizeInput(
    params.remarks ||
      (params.status === 'Verified'
        ? 'Original/clear copy verified against employee KYC details.'
        : params.status === 'Rejected'
          ? 'Document rejected; clear re-upload required.'
          : 'Marked pending verification.'),
    250
  );

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    const targetDoc = store.employeeDocuments.find((d) => d.documentId === params.documentId);
    if (!targetDoc) {
      throw new Error('Document record not found.');
    }

    store.employeeDocuments = store.employeeDocuments.map((d) =>
      d.documentId === params.documentId
        ? {
            ...d,
            verificationStatus: params.status,
            verificationRemarks: cleanRemarks,
            verifiedBy: params.status === 'Pending' ? null : actorLabel,
            verifiedByUid: params.status === 'Pending' ? null : caller.uid,
            verifiedAt: params.status === 'Pending' ? null : nowIso,
            updatedAt: nowIso,
          }
        : d
    );

    const empDocs = store.employeeDocuments.filter((d) => d.employeeId === emp.employeeId);
    const rollup = computeDocVerificationSummary(empDocs);

    store.employees = store.employees.map((e) =>
      e.employeeId === emp.employeeId
        ? {
            ...e,
            docVerificationSummary: rollup.summary,
            totalDocumentsCount: rollup.totalCount,
            pendingDocumentsCount: rollup.pendingCount,
            updatedAt: nowIso,
            updatedBy: actorLabel,
          }
        : e
    );

    store.employeeHistory.unshift(
      buildHistoryRecord(caller, {
        employeeId: emp.employeeId,
        linkedUid: emp.linkedUid,
        branchId: emp.branchId,
        category: 'Activity',
        action: `Document ${params.status}`,
        summary: `${targetDoc.documentType} (${targetDoc.fileName}) marked ${params.status}. Remarks: ${cleanRemarks}`,
        timestamp: nowIso,
      })
    );

    writeLocalEmployeeStore(store);
    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: `Document ${params.status}`,
      module: 'Employee',
      recordId: emp.employeeId,
      branchId: emp.branchId,
      summary: `Marked ${targetDoc.documentType} (${params.documentId}) as ${params.status} for Employee ${emp.employeeId}.`,
    });
    return;
  }

  const path = `employeeDocuments/${params.documentId}`;
  try {
    await runTransaction(firestoreDb!, async (tx) => {
      const docRef = doc(firestoreDb!, 'employeeDocuments', params.documentId);
      const docSnap = await tx.get(docRef);
      if (!docSnap.exists()) {
        throw new Error('Document record not found.');
      }
      const targetDoc = docSnap.data() as EmployeeDocumentRecord;

      tx.update(docRef, {
        verificationStatus: params.status,
        verificationRemarks: cleanRemarks,
        verifiedBy: params.status === 'Pending' ? null : actorLabel,
        verifiedByUid: params.status === 'Pending' ? null : caller.uid,
        verifiedAt: params.status === 'Pending' ? null : nowIso,
        updatedAt: nowIso,
        serverUpdatedAt: serverTimestamp(),
      });

      const hist = buildHistoryRecord(caller, {
        employeeId: emp.employeeId,
        linkedUid: emp.linkedUid,
        branchId: emp.branchId,
        category: 'Activity',
        action: `Document ${params.status}`,
        summary: `${targetDoc.documentType} (${targetDoc.fileName}) marked ${params.status}. Remarks: ${cleanRemarks}`,
        timestamp: nowIso,
      });
      tx.set(doc(firestoreDb!, 'employeeHistory', hist.historyId), {
        ...hist,
        serverCreatedAt: serverTimestamp(),
      });
    });

    // Recompute document summary across all employee documents
    const refreshedDocsSnap = await getDocs(
      query(collection(firestoreDb!, 'employeeDocuments'), where('employeeId', '==', emp.employeeId))
    );
    const refreshedDocs = refreshedDocsSnap.docs.map((d) => d.data() as EmployeeDocumentRecord);
    const rollup = computeDocVerificationSummary(refreshedDocs);
    await updateDoc(doc(firestoreDb!, 'employees', emp.employeeId), {
      docVerificationSummary: rollup.summary,
      totalDocumentsCount: rollup.totalCount,
      pendingDocumentsCount: rollup.pendingCount,
      updatedAt: nowIso,
      updatedBy: actorLabel,
      serverUpdatedAt: serverTimestamp(),
    });

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: `Document ${params.status}`,
      module: 'Employee',
      recordId: emp.employeeId,
      branchId: emp.branchId,
      summary: `Marked document ${params.documentId} as ${params.status} for Employee ${emp.employeeId}.`,
    });
    notifyEmployeeListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteEmployeeDocument(
  caller: RexonUser,
  isPreviewSession: boolean,
  documentId: string,
  employeeId: string
): Promise<void> {
  assertNotSitePortal(caller);
  if (caller.role !== 'admin' && !hasUserPermission(caller, 'employee.verify_docs')) {
    throw new Error('Removing a document requires Admin authority or HR employee.verify_docs permission.');
  }

  const emp = await getEmployeeById(caller, isPreviewSession, employeeId);
  if (!emp) throw new Error('Employee not found.');
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(emp.branchId)) {
    throw new Error('Unauthorized branch scope.');
  }

  const nowIso = new Date().toISOString();
  const actorLabel = `${caller.fullName} (${caller.role})`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    const target = store.employeeDocuments.find((d) => d.documentId === documentId);
    if (!target) return;
    store.employeeDocuments = store.employeeDocuments.filter((d) => d.documentId !== documentId);
    const rollup = computeDocVerificationSummary(
      store.employeeDocuments.filter((d) => d.employeeId === employeeId)
    );
    store.employees = store.employees.map((e) =>
      e.employeeId === employeeId
        ? {
            ...e,
            docVerificationSummary: rollup.summary,
            totalDocumentsCount: rollup.totalCount,
            pendingDocumentsCount: rollup.pendingCount,
            updatedAt: nowIso,
            updatedBy: actorLabel,
          }
        : e
    );
    writeLocalEmployeeStore(store);
    return;
  }

  const path = `employeeDocuments/${documentId}`;
  try {
    const docRef = doc(firestoreDb!, 'employeeDocuments', documentId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const target = snap.data() as EmployeeDocumentRecord;
      if (firebaseStorage && target.storagePath && !target.downloadUrl.startsWith('data:')) {
        try {
          await deleteObject(ref(firebaseStorage, target.storagePath));
        } catch {
          // Storage object may already be deleted
        }
      }
      await deleteDoc(docRef);
    }

    const refreshedSnap = await getDocs(
      query(collection(firestoreDb!, 'employeeDocuments'), where('employeeId', '==', employeeId))
    );
    const rollup = computeDocVerificationSummary(
      refreshedSnap.docs.map((d) => d.data() as EmployeeDocumentRecord)
    );
    await updateDoc(doc(firestoreDb!, 'employees', employeeId), {
      docVerificationSummary: rollup.summary,
      totalDocumentsCount: rollup.totalCount,
      pendingDocumentsCount: rollup.pendingCount,
      updatedAt: nowIso,
      updatedBy: actorLabel,
      serverUpdatedAt: serverTimestamp(),
    });
    notifyEmployeeListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// 4. LIST EMPLOYEE HISTORY (`employeeHistory`)
// ============================================================================
export async function listEmployeeHistory(
  caller: RexonUser,
  isPreviewSession: boolean,
  employeeId: string
): Promise<EmployeeHistoryRecord[]> {
  assertNotSitePortal(caller);
  const emp = await getEmployeeById(caller, isPreviewSession, employeeId);
  if (!emp) return [];

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalEmployeeStore();
    return store.employeeHistory
      .filter((h) => {
        if (h.employeeId !== employeeId) return false;
        if (caller.role === 'field_officer') {
          return h.category === 'Designation' || h.category === 'SiteAssignment';
        }
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  const path = 'employeeHistory';
  try {
    const q =
      caller.role === 'employee'
        ? query(
            collection(firestoreDb!, path),
            where('employeeId', '==', employeeId),
            where('linkedUid', '==', caller.uid)
          )
        : query(collection(firestoreDb!, path), where('employeeId', '==', employeeId));

    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as EmployeeHistoryRecord)
      .filter((h) =>
        caller.role === 'field_officer'
          ? h.category === 'Designation' || h.category === 'SiteAssignment'
          : true
      )
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  } catch {
    return [];
  }
}

/**
 * Synchronizes an employee's primary currentSiteId/currentSiteName and appends a
 * SiteAssignment entry to local preview store when assignmentService modifies deployments.
 */
export function syncLocalEmployeePrimarySiteFromAssignment(
  actor: RexonUser,
  params: {
    employeeId: string;
    currentSiteId: string;
    currentSiteName: string;
    historyAction: string;
    historySummary: string;
    metadata?: Record<string, string>;
  }
): void {
  const store = readLocalEmployeeStore();
  const target = store.employees.find((e) => e.employeeId === params.employeeId);
  if (!target) return;

  const nowIso = new Date().toISOString();
  const actorLabel = `${actor.fullName} (${actor.role})`;

  store.employees = store.employees.map((e) =>
    e.employeeId === params.employeeId
      ? {
          ...e,
          currentSiteId: params.currentSiteId,
          currentSiteName: params.currentSiteName,
          updatedAt: nowIso,
          updatedBy: actorLabel,
        }
      : e
  );

  store.employeeHistory.unshift(
    buildHistoryRecord(actor, {
      employeeId: target.employeeId,
      linkedUid: target.linkedUid,
      branchId: target.branchId,
      category: 'SiteAssignment',
      action: params.historyAction,
      summary: params.historySummary,
      metadata: params.metadata,
      timestamp: nowIso,
    })
  );

  writeLocalEmployeeStore(store);
}

