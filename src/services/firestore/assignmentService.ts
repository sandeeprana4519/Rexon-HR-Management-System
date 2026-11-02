import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ApprovalRequestRecord,
  AssignmentFormInput,
  AssignmentHistoryActionType,
  AssignmentHistoryRecord,
  AssignmentStatus,
  BranchRecord,
  ClientRecord,
  DesignationRecord,
  EmployeeAssignmentRecord,
  EmployeeAvailabilityItem,
  EmployeeAvailabilityState,
  EmployeeRecord,
  ManpowerShortageRecord,
  OperationType,
  ReportManpowerShortageInput,
  RexonUser,
  SanitizedShiftSummary,
  SanitizedSiteLineSummary,
  ServiceCategory,
  ServiceRecord,
  ShortageStatus,
  SiteDeploymentLineRow,
  SiteDeploymentSummaryRecord,
  SiteRecord,
  SiteServiceConfigRecord,
  TransferAssignmentInput,
} from '../../types';
import {
  addDaysToIsoDate,
  detectShiftConflict,
  getTodayIsoDate,
  isAssignmentActiveOnDate,
  resolveAssignmentStatusByDates,
  validateAssignmentFormInput,
  validateEmployeeEligibilityForAssignment,
} from '../../utils/deploymentValidation';
import { computeNonNegativeVacancy } from '../../utils/masterValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';
import { sanitizeInput } from '../../utils/validation';
import { firestoreDb, isFirebaseConfigured } from '../firebase/config';
import {
  getEmployeeById,
  getOwnEmployeeRecord,
  listEmployees,
  syncLocalEmployeePrimarySiteFromAssignment,
} from './employeeService';
import { handleFirestoreError } from './errorHandler';
import {
  decideApprovalRequest,
  listBranches,
  listClients,
  listDesignations,
  listServices,
  listSiteServiceConfigs,
  listSites,
  recordExternalMasterAudit,
  submitApprovalRequest,
} from './masterDataService';

const DEPLOYMENT_STORAGE_KEY = 'rexon_phase3_deployments_v1';

interface LocalDeploymentStore {
  employeeAssignments: EmployeeAssignmentRecord[];
  assignmentHistory: AssignmentHistoryRecord[];
  manpowerShortages: ManpowerShortageRecord[];
  siteDeploymentSummaries: Record<string, SiteDeploymentSummaryRecord>;
}

type DeploymentListener = () => void;
const deploymentListeners = new Set<DeploymentListener>();

export function subscribeDeploymentData(listener: DeploymentListener): () => void {
  deploymentListeners.add(listener);
  return () => deploymentListeners.delete(listener);
}

function notifyDeploymentListeners(): void {
  deploymentListeners.forEach((fn) => fn());
}

function useLiveFirestore(isPreviewSession: boolean): boolean {
  return isFirebaseConfigured && Boolean(firestoreDb) && !isPreviewSession;
}

/**
 * Starts strictly empty — NO fake or hardcoded assignments.
 */
function buildEmptyDeploymentStore(): LocalDeploymentStore {
  return {
    employeeAssignments: [],
    assignmentHistory: [],
    manpowerShortages: [],
    siteDeploymentSummaries: {},
  };
}

function readLocalDeploymentStore(): LocalDeploymentStore {
  try {
    const raw = localStorage.getItem(DEPLOYMENT_STORAGE_KEY);
    if (!raw) return buildEmptyDeploymentStore();
    const parsed = JSON.parse(raw) as Partial<LocalDeploymentStore>;
    return {
      employeeAssignments: Array.isArray(parsed.employeeAssignments)
        ? parsed.employeeAssignments
        : [],
      assignmentHistory: Array.isArray(parsed.assignmentHistory) ? parsed.assignmentHistory : [],
      manpowerShortages: Array.isArray(parsed.manpowerShortages) ? parsed.manpowerShortages : [],
      siteDeploymentSummaries:
        parsed.siteDeploymentSummaries && typeof parsed.siteDeploymentSummaries === 'object'
          ? parsed.siteDeploymentSummaries
          : {},
    };
  } catch {
    return buildEmptyDeploymentStore();
  }
}

function writeLocalDeploymentStore(store: LocalDeploymentStore): void {
  try {
    localStorage.setItem(DEPLOYMENT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota warnings
  }
  notifyDeploymentListeners();
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

function makeAssignmentHistoryId(): string {
  return `AHS-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}-${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;
}

function makeEmployeeHistoryId(): string {
  return `EHS-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}-${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;
}

function buildAssignmentHistoryObject(
  actor: RexonUser,
  params: {
    assignmentId: string;
    employeeId: string;
    employeeName: string;
    linkedUid: string;
    branchId: string;
    clientId: string;
    siteId: string;
    siteName: string;
    previousSiteId?: string;
    previousSiteName?: string;
    newSiteId?: string;
    newSiteName?: string;
    actionType: AssignmentHistoryActionType;
    summary: string;
    remarks?: string;
    timestamp?: string;
  }
): AssignmentHistoryRecord {
  return {
    historyId: makeAssignmentHistoryId(),
    assignmentId: params.assignmentId,
    employeeId: params.employeeId,
    employeeName: params.employeeName,
    linkedUid: params.linkedUid || '',
    branchId: params.branchId,
    clientId: params.clientId,
    siteId: params.siteId,
    siteName: params.siteName,
    previousSiteId: params.previousSiteId || '',
    previousSiteName: params.previousSiteName || '',
    newSiteId: params.newSiteId || params.siteId,
    newSiteName: params.newSiteName || params.siteName,
    actionType: params.actionType,
    summary: sanitizeInput(params.summary, 400),
    remarks: sanitizeInput(params.remarks || '', 300),
    actorUid: actor.uid,
    actorName: actor.fullName,
    actorRole: actor.role,
    timestamp: params.timestamp ?? new Date().toISOString(),
  };
}

function normalizeAssignmentLifecycle(
  record: EmployeeAssignmentRecord,
  referenceDate?: string
): EmployeeAssignmentRecord {
  const resolved = resolveAssignmentStatusByDates(
    record.startDate,
    record.endDate,
    record.assignmentStatus,
    referenceDate
  );
  if (resolved === record.assignmentStatus) return record;
  return {
    ...record,
    assignmentStatus: resolved,
  };
}

function assertNotSiteRole(caller: RexonUser): void {
  if (caller.role === 'site') {
    throw new Error(
      'Unauthorized: Site Portal accounts can only view sanitized site manpower summaries.'
    );
  }
}

function assertSiteScopeForCaller(
  caller: RexonUser,
  branchId: string,
  siteId: string,
  requiredHrPermission?: 'assignment.view' | 'assignment.create' | 'assignment.edit' | 'assignment.transfer' | 'assignment.manage'
): void {
  if (caller.role === 'admin') return;

  if (caller.role === 'hr') {
    const allowedBranches = getAuthorizedBranchIds(caller);
    if (!allowedBranches.includes(branchId)) {
      throw new Error('Unauthorized branch scope: HR can only manage assignments in assigned branch(es).');
    }
    if (requiredHrPermission && !hasUserPermission(caller, requiredHrPermission)) {
      throw new Error(`Insufficient HR permission (${requiredHrPermission}) for this operation.`);
    }
    return;
  }

  if (caller.role === 'field_officer') {
    if (!caller.assignedSiteIds.includes(siteId)) {
      throw new Error(
        'Restricted Site Scope: Field Officers can only assign or manage workforce at their authorized sites.'
      );
    }
    const allowedBranches = getAuthorizedBranchIds(caller);
    if (allowedBranches.length > 0 && !allowedBranches.includes(branchId)) {
      throw new Error('Field Officer cannot operate outside their assigned branch.');
    }
    return;
  }

  throw new Error('Unauthorized role for workforce assignment operations.');
}

/**
 * Computes sanitized, zero-PII SiteDeploymentSummaryRecord for a single site.
 */
export function computeSanitizedSiteSummary(
  site: SiteRecord,
  siteConfigs: SiteServiceConfigRecord[],
  siteAssignments: EmployeeAssignmentRecord[],
  referenceDate?: string
): SiteDeploymentSummaryRecord {
  const today = referenceDate || getTodayIsoDate();
  const normalizedAssignments = siteAssignments
    .filter((a) => a.siteId === site.siteId)
    .map((a) => normalizeAssignmentLifecycle(a, today));

  const activeConfigs = siteConfigs.filter(
    (c) => c.siteId === site.siteId && c.status === 'Active'
  );

  const matchedAssignmentIds = new Set<string>();

  const lines: SanitizedSiteLineSummary[] = activeConfigs.map((cfg) => {
    const matching = normalizedAssignments.filter((a) => {
      if (
        a.assignmentStatus === 'Cancelled' ||
        a.assignmentStatus === 'Transferred' ||
        a.assignmentStatus === 'Completed'
      ) {
        return false;
      }
      if (a.siteServiceId && a.siteServiceId === cfg.siteServiceId) {
        return true;
      }
      if (!a.siteServiceId) {
        return (
          a.serviceCategory === cfg.serviceCategory &&
          a.serviceId === cfg.serviceId &&
          a.designationId === cfg.designationId
        );
      }
      return false;
    });

    matching.forEach((m) => matchedAssignmentIds.add(m.assignmentId));

    const activeCount = matching.filter((a) => isAssignmentActiveOnDate(a, today)).length;
    const upcomingCount = matching.filter(
      (a) => a.assignmentStatus === 'Upcoming' && a.startDate > today
    ).length;

    return {
      lineKey: cfg.siteServiceId,
      serviceCategory: cfg.serviceCategory,
      serviceId: cfg.serviceId,
      serviceName: cfg.serviceName,
      designationId: cfg.designationId,
      designationName: cfg.designationName,
      shiftType: cfg.shiftType,
      workingHours: cfg.workingHours,
      weeklyOff: cfg.weeklyOff,
      requiredCount: cfg.requiredCount,
      deployedCount: activeCount,
      vacantCount: computeNonNegativeVacancy(cfg.requiredCount, activeCount),
      activeAssignmentsCount: activeCount,
      upcomingAssignmentsCount: upcomingCount,
    };
  });

  // Include any active/upcoming assignments on the site whose designation does not yet have a siteServices row
  const unmatchedLive = normalizedAssignments.filter(
    (a) =>
      !matchedAssignmentIds.has(a.assignmentId) &&
      (a.assignmentStatus === 'Active' || a.assignmentStatus === 'Upcoming')
  );

  const adHocGroupMap = new Map<string, EmployeeAssignmentRecord[]>();
  for (const item of unmatchedLive) {
    const key = `${item.serviceCategory}__${item.serviceId}__${item.designationId}__${item.shift}`;
    const bucket = adHocGroupMap.get(key) ?? [];
    bucket.push(item);
    adHocGroupMap.set(key, bucket);
  }

  for (const [key, bucket] of adHocGroupMap.entries()) {
    const sample = bucket[0];
    const activeCount = bucket.filter((a) => isAssignmentActiveOnDate(a, today)).length;
    const upcomingCount = bucket.filter(
      (a) => a.assignmentStatus === 'Upcoming' && a.startDate > today
    ).length;
    lines.push({
      lineKey: `ADHOC-${site.siteId}-${key}`,
      serviceCategory: sample.serviceCategory,
      serviceId: sample.serviceId,
      serviceName: sample.serviceName,
      designationId: sample.designationId,
      designationName: sample.designationName,
      shiftType: sample.shift,
      workingHours: `${sample.dutyHours} Hours (${sample.shiftStartTime}–${sample.shiftEndTime})`,
      weeklyOff: sample.weeklyOff,
      requiredCount: 0,
      deployedCount: activeCount,
      vacantCount: 0,
      activeAssignmentsCount: activeCount,
      upcomingAssignmentsCount: upcomingCount,
    });
  }

  // Shift-wise breakdown (strictly counts only, zero PII)
  const shiftMap = new Map<string, SanitizedShiftSummary>();
  for (const asn of normalizedAssignments) {
    if (asn.assignmentStatus !== 'Active' && asn.assignmentStatus !== 'Upcoming') continue;
    const isTodayActive = isAssignmentActiveOnDate(asn, today);
    const isUpcoming = asn.assignmentStatus === 'Upcoming' && asn.startDate > today;
    if (!isTodayActive && !isUpcoming) continue;

    const shiftKey = `${asn.shift}__${asn.shiftStartTime}-${asn.shiftEndTime}`;
    const current = shiftMap.get(shiftKey) ?? {
      shift: asn.shift,
      shiftTiming: `${asn.shiftStartTime} – ${asn.shiftEndTime}`,
      securityDeployed: 0,
      housekeepingDeployed: 0,
      manpowerDeployed: 0,
      totalActiveDeployed: 0,
      upcomingCount: 0,
    };

    if (isTodayActive) {
      if (asn.serviceCategory === 'Security') current.securityDeployed += 1;
      else if (asn.serviceCategory === 'Housekeeping') current.housekeepingDeployed += 1;
      else current.manpowerDeployed += 1;
      current.totalActiveDeployed += 1;
    } else if (isUpcoming) {
      current.upcomingCount += 1;
    }

    shiftMap.set(shiftKey, current);
  }

  const totalRequired = lines.reduce((sum, l) => sum + l.requiredCount, 0);
  const totalDeployed = lines.reduce((sum, l) => sum + l.deployedCount, 0);
  const totalVacant = lines.reduce((sum, l) => sum + l.vacantCount, 0);
  const totalActiveAssignments = normalizedAssignments.filter((a) =>
    isAssignmentActiveOnDate(a, today)
  ).length;
  const totalUpcomingAssignments = normalizedAssignments.filter(
    (a) => a.assignmentStatus === 'Upcoming' && a.startDate > today
  ).length;

  return {
    siteId: site.siteId,
    siteName: site.siteName,
    clientId: site.clientId,
    clientName: site.clientName,
    branchId: site.branchId,
    totalRequired,
    totalDeployed,
    totalVacant,
    totalActiveAssignments,
    totalUpcomingAssignments,
    lines,
    shiftBreakdown: Array.from(shiftMap.values()),
    updatedAt: new Date().toISOString(),
  };
}

async function syncLiveSiteSummaryDocument(
  caller: RexonUser,
  isPreviewSession: boolean,
  siteId: string
): Promise<void> {
  if (!siteId) return;
  const [sites, siteConfigs, allAssignments] = await Promise.all([
    listSites(caller, isPreviewSession),
    listSiteServiceConfigs(caller, isPreviewSession, siteId),
    listEmployeeAssignments(caller, isPreviewSession, { siteId }),
  ]);
  const siteObj = sites.find((s) => s.siteId === siteId);
  if (!siteObj) return;

  const summary = computeSanitizedSiteSummary(siteObj, siteConfigs, allAssignments);

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    store.siteDeploymentSummaries[siteId] = summary;
    writeLocalDeploymentStore(store);
    return;
  }

  try {
    await setDoc(doc(firestoreDb!, 'siteDeploymentSummaries', siteId), {
      ...summary,
      serverUpdatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal if caller lacks summary write permission on an external site
  }
}

function findEmployeePrimaryActiveAssignment(
  assignments: EmployeeAssignmentRecord[],
  employeeId: string,
  today: string
): EmployeeAssignmentRecord | undefined {
  const empActive = assignments
    .filter((a) => a.employeeId === employeeId)
    .map((a) => normalizeAssignmentLifecycle(a, today))
    .filter((a) => isAssignmentActiveOnDate(a, today))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return empActive[0];
}

/**
 * Checks post capacity when matching Phase 2 `siteServices` lines are configured for the site & designation.
 */
function checkSitePostCapacity(params: {
  siteName: string;
  designationName: string;
  siteId: string;
  siteServiceId?: string;
  serviceCategory: ServiceCategory;
  serviceId: string;
  designationId: string;
  startDate: string;
  endDate: string;
  siteConfigs: SiteServiceConfigRecord[];
  existingSiteAssignments: EmployeeAssignmentRecord[];
  excludeAssignmentIds?: string[];
}): { matchedSiteServiceId: string; error?: string } {
  const excluded = new Set(params.excludeAssignmentIds ?? []);
  const activeConfigs = params.siteConfigs.filter(
    (c) => c.siteId === params.siteId && c.status === 'Active'
  );

  const matchingConfigs = params.siteServiceId
    ? activeConfigs.filter((c) => c.siteServiceId === params.siteServiceId)
    : activeConfigs.filter(
        (c) =>
          c.serviceCategory === params.serviceCategory &&
          c.serviceId === params.serviceId &&
          c.designationId === params.designationId
      );

  if (matchingConfigs.length === 0) {
    return { matchedSiteServiceId: params.siteServiceId || '' };
  }

  const chosenConfigId =
    params.siteServiceId || (matchingConfigs.length === 1 ? matchingConfigs[0].siteServiceId : '');
  const sanctionedRequired = matchingConfigs.reduce((sum, c) => sum + c.requiredCount, 0);

  if (sanctionedRequired <= 0) {
    return { matchedSiteServiceId: chosenConfigId };
  }

  const candStart = params.startDate.trim();
  const candEnd = params.endDate.trim() || '9999-12-31';

  const overlappingPostAssignments = params.existingSiteAssignments.filter((a) => {
    if (excluded.has(a.assignmentId)) return false;
    if (a.siteId !== params.siteId) return false;
    if (a.assignmentStatus !== 'Active' && a.assignmentStatus !== 'Upcoming') return false;

    const matchesLine = params.siteServiceId
      ? a.siteServiceId === params.siteServiceId
      : a.serviceCategory === params.serviceCategory &&
        a.serviceId === params.serviceId &&
        a.designationId === params.designationId;

    if (!matchesLine) return false;

    const exStart = a.startDate.trim();
    const exEnd = a.endDate.trim() || '9999-12-31';
    return candStart <= exEnd && exStart <= candEnd;
  });

  if (overlappingPostAssignments.length >= sanctionedRequired) {
    return {
      matchedSiteServiceId: chosenConfigId,
      error: `Sanctioned post capacity reached for "${params.designationName}" at "${params.siteName}" (${overlappingPostAssignments.length}/${sanctionedRequired} filled during ${params.startDate} to ${params.endDate}). Transfer/end an existing duty or update Site Service Configuration first.`,
    };
  }

  return { matchedSiteServiceId: chosenConfigId };
}

// ============================================================================
// 1. LIST & QUERY ASSIGNMENTS (ROLE-SCOPED)
// ============================================================================
export interface AssignmentQueryFilters {
  employeeId?: string;
  siteId?: string;
  branchId?: string;
  clientId?: string;
  status?: AssignmentStatus | 'ALL';
}

export async function listEmployeeAssignments(
  caller: RexonUser,
  isPreviewSession: boolean,
  filters?: AssignmentQueryFilters
): Promise<EmployeeAssignmentRecord[]> {
  assertNotSiteRole(caller);

  if (caller.role === 'employee') {
    return listMyEmployeeAssignments(caller, isPreviewSession);
  }

  const today = getTodayIsoDate();
  const authorizedBranches = getAuthorizedBranchIds(caller);

  const applyFiltersAndSort = (rows: EmployeeAssignmentRecord[]) => {
    return rows
      .map((r) => normalizeAssignmentLifecycle(r, today))
      .filter((r) => {
        if (caller.role === 'hr' && !authorizedBranches.includes(r.branchId)) {
          return false;
        }
        if (caller.role === 'field_officer') {
          const inSite = caller.assignedSiteIds.includes(r.siteId);
          const inEmployeeQuery = Boolean(filters?.employeeId && r.employeeId === filters.employeeId);
          if (!inSite && !inEmployeeQuery) return false;
        }
        if (filters?.employeeId && r.employeeId !== filters.employeeId) return false;
        if (filters?.siteId && r.siteId !== filters.siteId) return false;
        if (filters?.branchId && filters.branchId !== 'ALL' && r.branchId !== filters.branchId) {
          return false;
        }
        if (filters?.clientId && filters.clientId !== 'ALL' && r.clientId !== filters.clientId) {
          return false;
        }
        if (filters?.status && filters.status !== 'ALL' && r.assignmentStatus !== filters.status) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
  };

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    return applyFiltersAndSort(store.employeeAssignments);
  }

  const path = 'employeeAssignments';
  try {
    let q;
    if (filters?.employeeId) {
      q = query(collection(firestoreDb!, path), where('employeeId', '==', filters.employeeId));
    } else if (caller.role === 'admin') {
      q = query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      if (authorizedBranches.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('branchId', 'in', authorizedBranches.slice(0, 10))
      );
    } else if (caller.role === 'field_officer') {
      if (caller.assignedSiteIds.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('siteId', 'in', caller.assignedSiteIds.slice(0, 10))
      );
    } else {
      return [];
    }

    const snap = await getDocs(q);
    const raw = snap.docs.map((d) => d.data() as EmployeeAssignmentRecord);
    return applyFiltersAndSort(raw);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

/**
 * Employee Portal strictly isolated self-assignment reader.
 */
export async function listMyEmployeeAssignments(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<EmployeeAssignmentRecord[]> {
  if (caller.role !== 'employee') {
    return [];
  }
  const today = getTodayIsoDate();

  if (!useLiveFirestore(isPreviewSession)) {
    const ownEmp = await getOwnEmployeeRecord(caller, isPreviewSession);
    const store = readLocalDeploymentStore();
    return store.employeeAssignments
      .filter(
        (a) =>
          a.linkedUid === caller.uid ||
          (ownEmp && a.employeeId === ownEmp.employeeId)
      )
      .map((a) => normalizeAssignmentLifecycle(a, today))
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  const path = 'employeeAssignments';
  try {
    const q = query(collection(firestoreDb!, path), where('linkedUid', '==', caller.uid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => normalizeAssignmentLifecycle(d.data() as EmployeeAssignmentRecord, today))
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function listAssignmentHistory(
  caller: RexonUser,
  isPreviewSession: boolean,
  filters?: { assignmentId?: string; employeeId?: string; siteId?: string }
): Promise<AssignmentHistoryRecord[]> {
  assertNotSiteRole(caller);
  const authorizedBranches = getAuthorizedBranchIds(caller);

  const filterRows = (rows: AssignmentHistoryRecord[]) =>
    rows
      .filter((h) => {
        if (caller.role === 'employee' && h.linkedUid !== caller.uid) return false;
        if (caller.role === 'hr' && !authorizedBranches.includes(h.branchId)) return false;
        if (
          caller.role === 'field_officer' &&
          !caller.assignedSiteIds.includes(h.siteId) &&
          !(h.newSiteId && caller.assignedSiteIds.includes(h.newSiteId))
        ) {
          return false;
        }
        if (filters?.assignmentId && h.assignmentId !== filters.assignmentId) return false;
        if (filters?.employeeId && h.employeeId !== filters.employeeId) return false;
        if (filters?.siteId && h.siteId !== filters.siteId && h.newSiteId !== filters.siteId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    return filterRows(store.assignmentHistory);
  }

  const path = 'assignmentHistory';
  try {
    let q;
    if (caller.role === 'employee') {
      q = query(collection(firestoreDb!, path), where('linkedUid', '==', caller.uid));
    } else if (filters?.assignmentId) {
      q = query(collection(firestoreDb!, path), where('assignmentId', '==', filters.assignmentId));
    } else if (filters?.employeeId) {
      q = query(collection(firestoreDb!, path), where('employeeId', '==', filters.employeeId));
    } else if (caller.role === 'admin') {
      q = query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      if (authorizedBranches.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('branchId', 'in', authorizedBranches.slice(0, 10))
      );
    } else if (caller.role === 'field_officer') {
      if (caller.assignedSiteIds.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('siteId', 'in', caller.assignedSiteIds.slice(0, 10))
      );
    } else {
      return [];
    }

    const snap = await getDocs(q);
    return filterRows(snap.docs.map((d) => d.data() as AssignmentHistoryRecord));
  } catch {
    return [];
  }
}

// ============================================================================
// 2. CREATE EMPLOYEE SITE ASSIGNMENT
// ============================================================================
export async function createEmployeeAssignment(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: AssignmentFormInput
): Promise<EmployeeAssignmentRecord> {
  assertNotSiteRole(caller);
  assertSiteScopeForCaller(caller, input.branchId, input.siteId, 'assignment.create');

  const formCheck = validateAssignmentFormInput(input);
  if (!formCheck.valid) {
    throw new Error(formCheck.error ?? 'Invalid assignment details.');
  }

  const [employee, branches, clients, sites, services, designations, siteConfigs, empAssignments, siteAssignments] =
    await Promise.all([
      getEmployeeById(caller, isPreviewSession, input.employeeId),
      listBranches(caller, isPreviewSession),
      listClients(caller, isPreviewSession),
      listSites(caller, isPreviewSession),
      listServices(caller, isPreviewSession),
      listDesignations(caller, isPreviewSession),
      listSiteServiceConfigs(caller, isPreviewSession, input.siteId),
      listEmployeeAssignments(caller, isPreviewSession, { employeeId: input.employeeId }),
      listEmployeeAssignments(caller, isPreviewSession, { siteId: input.siteId }),
    ]);

  if (!employee) {
    throw new Error(`Employee ${input.employeeId} could not be found in your authorized scope.`);
  }

  const eligibility = validateEmployeeEligibilityForAssignment(
    employee,
    input.designationId,
    input.serviceCategory,
    input.serviceId
  );
  if (!eligibility.valid) {
    throw new Error(eligibility.error ?? 'Employee is not eligible for this site assignment.');
  }

  const branchObj = branches.find(
    (b) => b.branchId === input.branchId && !b.isDeleted && b.status === 'Active'
  );
  if (!branchObj) {
    throw new Error('Selected Branch does not exist or is inactive.');
  }

  const siteObj = sites.find(
    (s) => s.siteId === input.siteId && !s.isArchived && s.siteStatus === 'Active'
  );
  if (!siteObj) {
    throw new Error('Selected Deployment Site does not exist or is inactive.');
  }
  if (siteObj.branchId !== branchObj.branchId) {
    throw new Error('Selected Site does not belong to the chosen Branch.');
  }

  const clientObj = clients.find(
    (c) => c.clientId === siteObj.clientId && !c.isArchived && c.clientStatus === 'Active'
  );
  if (!clientObj && caller.role !== 'field_officer') {
    throw new Error('Parent Client for the selected Site is inactive or archived.');
  }

  const serviceObj = services.find(
    (sv) => sv.serviceId === input.serviceId && sv.status === 'Active'
  );
  if (!serviceObj) {
    throw new Error('Selected Service is inactive or does not exist.');
  }

  const desigObj = designations.find(
    (ds) => ds.designationId === input.designationId && ds.status === 'Active'
  );
  if (!desigObj) {
    throw new Error('Selected Designation is inactive or does not exist.');
  }

  // Shift conflict validation across all Active/Upcoming assignments of this employee
  const conflict = detectShiftConflict(
    {
      startDate: input.startDate,
      endDate: input.endDate,
      shift: input.shift,
      shiftStartTime: input.shiftStartTime,
      shiftEndTime: input.shiftEndTime,
      dutyHours: input.dutyHours,
    },
    empAssignments
  );
  if (conflict.hasConflict) {
    throw new Error(conflict.reason ?? 'Overlapping shift conflict detected for this employee.');
  }

  // Post capacity check against Phase 2 siteServices configuration
  const capacityCheck = checkSitePostCapacity({
    siteName: siteObj.siteName,
    designationName: desigObj.designationName,
    siteId: siteObj.siteId,
    siteServiceId: input.siteServiceId,
    serviceCategory: input.serviceCategory,
    serviceId: input.serviceId,
    designationId: input.designationId,
    startDate: input.startDate,
    endDate: input.endDate,
    siteConfigs,
    existingSiteAssignments: siteAssignments,
  });
  if (capacityCheck.error) {
    throw new Error(capacityCheck.error);
  }

  const today = getTodayIsoDate();
  const initialStatus = resolveAssignmentStatusByDates(input.startDate, input.endDate, undefined, today);
  const nowIso = new Date().toISOString();
  const actorLabel = `${caller.fullName} (${caller.role})`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    const assignmentId = generateSequentialId(
      'ASN',
      store.employeeAssignments.map((a) => a.assignmentId)
    );

    const record: EmployeeAssignmentRecord = {
      assignmentId,
      employeeId: employee.employeeId,
      employeeName: employee.fullName,
      linkedUid: employee.linkedUid || '',
      branchId: siteObj.branchId,
      branchName: branchObj.branchName,
      clientId: siteObj.clientId,
      clientName: clientObj?.companyName || siteObj.clientName,
      siteId: siteObj.siteId,
      siteName: siteObj.siteName,
      siteServiceId: capacityCheck.matchedSiteServiceId,
      serviceCategory: input.serviceCategory,
      serviceId: serviceObj.serviceId,
      serviceName: serviceObj.serviceName,
      designationId: desigObj.designationId,
      designationName: desigObj.designationName,
      shift: sanitizeInput(input.shift, 80),
      shiftStartTime: input.shiftStartTime.trim(),
      shiftEndTime: input.shiftEndTime.trim(),
      reportingTime: input.reportingTime.trim(),
      dutyHours: Number(input.dutyHours),
      weeklyOff: sanitizeInput(input.weeklyOff, 40),
      startDate: input.startDate.trim(),
      endDate: input.endDate.trim(),
      reportingInstructions: sanitizeInput(input.reportingInstructions, 400),
      remarks: sanitizeInput(input.remarks, 300),
      assignmentStatus: initialStatus,
      previousAssignmentId: '',
      previousSiteId: employee.currentSiteId || '',
      previousSiteName: employee.currentSiteName || '',
      transferredToAssignmentId: '',
      transferredToSiteId: '',
      transferredToSiteName: '',
      assignedBy: actorLabel,
      assignedByRole: caller.role,
      createdBy: caller.uid,
      updatedBy: caller.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const summaryText = `Assigned ${employee.fullName} (${employee.employeeId}) to "${siteObj.siteName}" as ${desigObj.designationName} (${record.shift}, ${record.startDate} to ${record.endDate}) [${initialStatus}].`;

    store.employeeAssignments.unshift(record);
    store.assignmentHistory.unshift(
      buildAssignmentHistoryObject(caller, {
        assignmentId,
        employeeId: employee.employeeId,
        employeeName: employee.fullName,
        linkedUid: employee.linkedUid,
        branchId: siteObj.branchId,
        clientId: siteObj.clientId,
        siteId: siteObj.siteId,
        siteName: siteObj.siteName,
        previousSiteId: employee.currentSiteId,
        previousSiteName: employee.currentSiteName,
        newSiteId: siteObj.siteId,
        newSiteName: siteObj.siteName,
        actionType: 'Employee Assigned',
        summary: summaryText,
        remarks: record.remarks,
        timestamp: nowIso,
      })
    );
    store.siteDeploymentSummaries[siteObj.siteId] = computeSanitizedSiteSummary(
      siteObj,
      siteConfigs,
      store.employeeAssignments,
      today
    );
    writeLocalDeploymentStore(store);

    if (initialStatus === 'Active' || !employee.currentSiteId) {
      syncLocalEmployeePrimarySiteFromAssignment(caller, {
        employeeId: employee.employeeId,
        currentSiteId: initialStatus === 'Active' ? siteObj.siteId : employee.currentSiteId,
        currentSiteName: initialStatus === 'Active' ? siteObj.siteName : employee.currentSiteName,
        historyAction: 'Site Assignment Created',
        historySummary: summaryText,
        metadata: {
          assignmentId,
          siteId: siteObj.siteId,
          siteName: siteObj.siteName,
          shift: record.shift,
        },
      });
    }

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: caller.role === 'field_officer' ? 'Field Officer Assignment Created' : 'Employee Assigned',
      module: 'Assignment',
      recordId: assignmentId,
      branchId: siteObj.branchId,
      summary: summaryText,
    });

    return record;
  }

  // Live Firestore transactional write
  const path = 'employeeAssignments';
  try {
    const allVis = await listEmployeeAssignments(caller, isPreviewSession);
    const assignmentId = generateSequentialId(
      'ASN',
      allVis.map((a) => a.assignmentId)
    );

    const record: EmployeeAssignmentRecord = {
      assignmentId,
      employeeId: employee.employeeId,
      employeeName: employee.fullName,
      linkedUid: employee.linkedUid || '',
      branchId: siteObj.branchId,
      branchName: branchObj.branchName,
      clientId: siteObj.clientId,
      clientName: clientObj?.companyName || siteObj.clientName,
      siteId: siteObj.siteId,
      siteName: siteObj.siteName,
      siteServiceId: capacityCheck.matchedSiteServiceId,
      serviceCategory: input.serviceCategory,
      serviceId: serviceObj.serviceId,
      serviceName: serviceObj.serviceName,
      designationId: desigObj.designationId,
      designationName: desigObj.designationName,
      shift: sanitizeInput(input.shift, 80),
      shiftStartTime: input.shiftStartTime.trim(),
      shiftEndTime: input.shiftEndTime.trim(),
      reportingTime: input.reportingTime.trim(),
      dutyHours: Number(input.dutyHours),
      weeklyOff: sanitizeInput(input.weeklyOff, 40),
      startDate: input.startDate.trim(),
      endDate: input.endDate.trim(),
      reportingInstructions: sanitizeInput(input.reportingInstructions, 400),
      remarks: sanitizeInput(input.remarks, 300),
      assignmentStatus: initialStatus,
      previousAssignmentId: '',
      previousSiteId: employee.currentSiteId || '',
      previousSiteName: employee.currentSiteName || '',
      transferredToAssignmentId: '',
      transferredToSiteId: '',
      transferredToSiteName: '',
      assignedBy: actorLabel,
      assignedByRole: caller.role,
      createdBy: caller.uid,
      updatedBy: caller.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const summaryText = `Assigned ${employee.fullName} (${employee.employeeId}) to "${siteObj.siteName}" as ${desigObj.designationName} (${record.shift}, ${record.startDate} to ${record.endDate}) [${initialStatus}].`;

    const historyObj = buildAssignmentHistoryObject(caller, {
      assignmentId,
      employeeId: employee.employeeId,
      employeeName: employee.fullName,
      linkedUid: employee.linkedUid,
      branchId: siteObj.branchId,
      clientId: siteObj.clientId,
      siteId: siteObj.siteId,
      siteName: siteObj.siteName,
      previousSiteId: employee.currentSiteId,
      previousSiteName: employee.currentSiteName,
      newSiteId: siteObj.siteId,
      newSiteName: siteObj.siteName,
      actionType: 'Employee Assigned',
      summary: summaryText,
      remarks: record.remarks,
      timestamp: nowIso,
    });

    await runTransaction(firestoreDb!, async (tx) => {
      const asnRef = doc(firestoreDb!, 'employeeAssignments', assignmentId);
      const existingSnap = await tx.get(asnRef);
      if (existingSnap.exists()) {
        throw new Error(`Assignment ID ${assignmentId} already exists. Please retry.`);
      }

      const empRef = doc(firestoreDb!, 'employees', employee.employeeId);
      const empSnap = await tx.get(empRef);
      if (!empSnap.exists()) {
        throw new Error(`Employee ${employee.employeeId} not found.`);
      }
      const latestEmp = empSnap.data() as EmployeeRecord;
      if (!latestEmp.isActive || latestEmp.employeeStatus !== 'Active' || latestEmp.isDeleted) {
        throw new Error('Employee is no longer Active and cannot be assigned.');
      }

      tx.set(asnRef, {
        ...record,
        serverCreatedAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
      });

      tx.set(doc(firestoreDb!, 'assignmentHistory', historyObj.historyId), {
        ...historyObj,
        serverCreatedAt: serverTimestamp(),
      });

      if (initialStatus === 'Active' && caller.role !== 'field_officer') {
        tx.update(empRef, {
          currentSiteId: siteObj.siteId,
          currentSiteName: siteObj.siteName,
          updatedAt: nowIso,
          updatedBy: actorLabel,
          serverUpdatedAt: serverTimestamp(),
        });
      }

      const empHistId = makeEmployeeHistoryId();
      tx.set(doc(firestoreDb!, 'employeeHistory', empHistId), {
        historyId: empHistId,
        employeeId: employee.employeeId,
        linkedUid: employee.linkedUid || '',
        branchId: employee.branchId,
        category: 'SiteAssignment',
        action: 'Site Assignment Created',
        summary: summaryText,
        actorUid: caller.uid,
        actorName: caller.fullName,
        actorRole: caller.role,
        timestamp: nowIso,
        serverCreatedAt: serverTimestamp(),
      });
    });

    await syncLiveSiteSummaryDocument(caller, isPreviewSession, siteObj.siteId);
    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: caller.role === 'field_officer' ? 'Field Officer Assignment Created' : 'Employee Assigned',
      module: 'Assignment',
      recordId: assignmentId,
      branchId: siteObj.branchId,
      summary: summaryText,
    });
    notifyDeploymentListeners();
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

// ============================================================================
// 3. MODIFY / CORRECT ASSIGNMENT DETAILS (ADMIN & AUTHORIZED HR)
// ============================================================================
export async function updateEmployeeAssignment(
  caller: RexonUser,
  isPreviewSession: boolean,
  assignmentId: string,
  input: AssignmentFormInput
): Promise<EmployeeAssignmentRecord> {
  if (caller.role !== 'admin' && caller.role !== 'hr') {
    throw new Error('Only Admin or authorized HR can modify core assignment details.');
  }

  const formCheck = validateAssignmentFormInput(input);
  if (!formCheck.valid) {
    throw new Error(formCheck.error ?? 'Invalid assignment details.');
  }

  const allVisible = await listEmployeeAssignments(caller, isPreviewSession);
  const existing = allVisible.find((a) => a.assignmentId === assignmentId);
  if (!existing) {
    throw new Error(`Assignment ${assignmentId} not found.`);
  }

  if (
    existing.assignmentStatus === 'Cancelled' ||
    existing.assignmentStatus === 'Transferred' ||
    existing.assignmentStatus === 'Completed'
  ) {
    throw new Error(
      `Finalized assignment (${existing.assignmentStatus}) cannot be edited. Create a new assignment instead.`
    );
  }

  assertSiteScopeForCaller(caller, existing.branchId, existing.siteId, 'assignment.edit');
  assertSiteScopeForCaller(caller, input.branchId, input.siteId, 'assignment.edit');

  const [employee, branches, clients, sites, services, designations, siteConfigs, empAssignments, siteAssignments] =
    await Promise.all([
      getEmployeeById(caller, isPreviewSession, input.employeeId),
      listBranches(caller, isPreviewSession),
      listClients(caller, isPreviewSession),
      listSites(caller, isPreviewSession),
      listServices(caller, isPreviewSession),
      listDesignations(caller, isPreviewSession),
      listSiteServiceConfigs(caller, isPreviewSession, input.siteId),
      listEmployeeAssignments(caller, isPreviewSession, { employeeId: input.employeeId }),
      listEmployeeAssignments(caller, isPreviewSession, { siteId: input.siteId }),
    ]);

  if (!employee) throw new Error(`Employee ${input.employeeId} not found.`);

  const eligibility = validateEmployeeEligibilityForAssignment(
    employee,
    input.designationId,
    input.serviceCategory,
    input.serviceId
  );
  if (!eligibility.valid) {
    throw new Error(eligibility.error ?? 'Employee is not eligible for the updated designation.');
  }

  const branchObj = branches.find((b) => b.branchId === input.branchId && !b.isDeleted);
  const siteObj = sites.find((s) => s.siteId === input.siteId && !s.isArchived);
  const serviceObj = services.find((sv) => sv.serviceId === input.serviceId);
  const desigObj = designations.find((ds) => ds.designationId === input.designationId);
  if (!branchObj || !siteObj || !serviceObj || !desigObj) {
    throw new Error('Selected Branch, Site, Service, or Designation could not be found.');
  }
  const clientObj = clients.find((c) => c.clientId === siteObj.clientId);

  const conflict = detectShiftConflict(
    {
      startDate: input.startDate,
      endDate: input.endDate,
      shift: input.shift,
      shiftStartTime: input.shiftStartTime,
      shiftEndTime: input.shiftEndTime,
      dutyHours: input.dutyHours,
    },
    empAssignments,
    { excludeAssignmentIds: [assignmentId] }
  );
  if (conflict.hasConflict) {
    throw new Error(conflict.reason ?? 'Updated timing conflicts with another duty.');
  }

  const capacityCheck = checkSitePostCapacity({
    siteName: siteObj.siteName,
    designationName: desigObj.designationName,
    siteId: siteObj.siteId,
    siteServiceId: input.siteServiceId,
    serviceCategory: input.serviceCategory,
    serviceId: input.serviceId,
    designationId: input.designationId,
    startDate: input.startDate,
    endDate: input.endDate,
    siteConfigs,
    existingSiteAssignments: siteAssignments,
    excludeAssignmentIds: [assignmentId],
  });
  if (capacityCheck.error) {
    throw new Error(capacityCheck.error);
  }

  const today = getTodayIsoDate();
  const nextStatus = resolveAssignmentStatusByDates(input.startDate, input.endDate, undefined, today);
  const nowIso = new Date().toISOString();

  const updated: EmployeeAssignmentRecord = {
    ...existing,
    employeeId: employee.employeeId,
    employeeName: employee.fullName,
    linkedUid: employee.linkedUid || '',
    branchId: siteObj.branchId,
    branchName: branchObj.branchName,
    clientId: siteObj.clientId,
    clientName: clientObj?.companyName || siteObj.clientName,
    siteId: siteObj.siteId,
    siteName: siteObj.siteName,
    siteServiceId: capacityCheck.matchedSiteServiceId,
    serviceCategory: input.serviceCategory,
    serviceId: serviceObj.serviceId,
    serviceName: serviceObj.serviceName,
    designationId: desigObj.designationId,
    designationName: desigObj.designationName,
    shift: sanitizeInput(input.shift, 80),
    shiftStartTime: input.shiftStartTime.trim(),
    shiftEndTime: input.shiftEndTime.trim(),
    reportingTime: input.reportingTime.trim(),
    dutyHours: Number(input.dutyHours),
    weeklyOff: sanitizeInput(input.weeklyOff, 40),
    startDate: input.startDate.trim(),
    endDate: input.endDate.trim(),
    reportingInstructions: sanitizeInput(input.reportingInstructions, 400),
    remarks: sanitizeInput(input.remarks, 300),
    assignmentStatus: nextStatus,
    updatedBy: caller.uid,
    updatedAt: nowIso,
  };

  const summaryText = `Modified assignment ${assignmentId} for ${employee.fullName} at "${siteObj.siteName}" (${desigObj.designationName}, ${updated.shift}, ${updated.startDate} to ${updated.endDate}).`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    store.employeeAssignments = store.employeeAssignments.map((a) =>
      a.assignmentId === assignmentId ? updated : a
    );
    store.assignmentHistory.unshift(
      buildAssignmentHistoryObject(caller, {
        assignmentId,
        employeeId: employee.employeeId,
        employeeName: employee.fullName,
        linkedUid: employee.linkedUid,
        branchId: siteObj.branchId,
        clientId: siteObj.clientId,
        siteId: siteObj.siteId,
        siteName: siteObj.siteName,
        previousSiteId: existing.siteId,
        previousSiteName: existing.siteName,
        newSiteId: siteObj.siteId,
        newSiteName: siteObj.siteName,
        actionType: 'Assignment Modified',
        summary: summaryText,
        remarks: updated.remarks,
        timestamp: nowIso,
      })
    );
    store.siteDeploymentSummaries[siteObj.siteId] = computeSanitizedSiteSummary(
      siteObj,
      siteConfigs,
      store.employeeAssignments,
      today
    );
    writeLocalDeploymentStore(store);

    const primaryActive = findEmployeePrimaryActiveAssignment(
      store.employeeAssignments,
      employee.employeeId,
      today
    );
    syncLocalEmployeePrimarySiteFromAssignment(caller, {
      employeeId: employee.employeeId,
      currentSiteId: primaryActive?.siteId || '',
      currentSiteName: primaryActive?.siteName || '',
      historyAction: 'Site Assignment Modified',
      historySummary: summaryText,
    });

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Assignment Modified',
      module: 'Assignment',
      recordId: assignmentId,
      branchId: siteObj.branchId,
      summary: summaryText,
    });
    return updated;
  }

  const path = `employeeAssignments/${assignmentId}`;
  try {
    const historyObj = buildAssignmentHistoryObject(caller, {
      assignmentId,
      employeeId: employee.employeeId,
      employeeName: employee.fullName,
      linkedUid: employee.linkedUid,
      branchId: siteObj.branchId,
      clientId: siteObj.clientId,
      siteId: siteObj.siteId,
      siteName: siteObj.siteName,
      previousSiteId: existing.siteId,
      previousSiteName: existing.siteName,
      newSiteId: siteObj.siteId,
      newSiteName: siteObj.siteName,
      actionType: 'Assignment Modified',
      summary: summaryText,
      remarks: updated.remarks,
      timestamp: nowIso,
    });

    const batch = writeBatch(firestoreDb!);
    batch.set(
      doc(firestoreDb!, 'employeeAssignments', assignmentId),
      {
        ...updated,
        serverUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    batch.set(doc(firestoreDb!, 'assignmentHistory', historyObj.historyId), {
      ...historyObj,
      serverCreatedAt: serverTimestamp(),
    });
    if (nextStatus === 'Active') {
      batch.update(doc(firestoreDb!, 'employees', employee.employeeId), {
        currentSiteId: siteObj.siteId,
        currentSiteName: siteObj.siteName,
        updatedAt: nowIso,
        updatedBy: `${caller.fullName} (${caller.role})`,
        serverUpdatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    await syncLiveSiteSummaryDocument(caller, isPreviewSession, siteObj.siteId);
    if (existing.siteId !== siteObj.siteId) {
      await syncLiveSiteSummaryDocument(caller, isPreviewSession, existing.siteId);
    }

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Assignment Modified',
      module: 'Assignment',
      recordId: assignmentId,
      branchId: siteObj.branchId,
      summary: summaryText,
    });
    notifyDeploymentListeners();
    return updated;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 4. INTER-SITE EMPLOYEE TRANSFER (PRESERVES OLD & NEW SITE LINEAGE)
// ============================================================================
export async function transferEmployeeAssignment(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: TransferAssignmentInput
): Promise<EmployeeAssignmentRecord> {
  if (caller.role !== 'admin' && caller.role !== 'hr') {
    throw new Error(
      'Direct inter-site transfers require Admin or authorized HR authority. Field Officers should submit a Transfer Request.'
    );
  }

  const allVisible = await listEmployeeAssignments(caller, isPreviewSession);
  const source = allVisible.find((a) => a.assignmentId === input.sourceAssignmentId);
  if (!source) {
    throw new Error(`Source assignment ${input.sourceAssignmentId} not found.`);
  }
  if (source.assignmentStatus !== 'Active' && source.assignmentStatus !== 'Upcoming') {
    throw new Error(
      `Only Active or Upcoming assignments can be transferred (current: ${source.assignmentStatus}).`
    );
  }
  if (source.siteId === input.newSiteId) {
    throw new Error('Select a different target Site to transfer this employee.');
  }

  const [employee, branches, clients, sites, services, designations, newSiteConfigs, empAssignments, newSiteAssignments] =
    await Promise.all([
      getEmployeeById(caller, isPreviewSession, source.employeeId),
      listBranches(caller, isPreviewSession),
      listClients(caller, isPreviewSession),
      listSites(caller, isPreviewSession),
      listServices(caller, isPreviewSession),
      listDesignations(caller, isPreviewSession),
      listSiteServiceConfigs(caller, isPreviewSession, input.newSiteId),
      listEmployeeAssignments(caller, isPreviewSession, { employeeId: source.employeeId }),
      listEmployeeAssignments(caller, isPreviewSession, { siteId: input.newSiteId }),
    ]);

  if (!employee) throw new Error(`Employee ${source.employeeId} not found.`);

  const newSiteObj = sites.find(
    (s) => s.siteId === input.newSiteId && !s.isArchived && s.siteStatus === 'Active'
  );
  if (!newSiteObj) {
    throw new Error('Target Transfer Site does not exist or is inactive.');
  }

  assertSiteScopeForCaller(caller, source.branchId, source.siteId, 'assignment.transfer');
  assertSiteScopeForCaller(caller, newSiteObj.branchId, newSiteObj.siteId, 'assignment.transfer');

  const formCheck = validateAssignmentFormInput({
    employeeId: employee.employeeId,
    branchId: newSiteObj.branchId,
    clientId: newSiteObj.clientId,
    siteId: newSiteObj.siteId,
    siteServiceId: input.newSiteServiceId,
    serviceCategory: input.serviceCategory,
    serviceId: input.serviceId,
    designationId: input.designationId,
    shift: input.shift,
    shiftStartTime: input.shiftStartTime,
    shiftEndTime: input.shiftEndTime,
    reportingTime: input.reportingTime,
    dutyHours: input.dutyHours,
    weeklyOff: input.weeklyOff,
    startDate: input.transferDate,
    endDate: input.newEndDate,
    reportingInstructions: input.reportingInstructions,
    remarks: input.remarks,
  });
  if (!formCheck.valid) {
    throw new Error(formCheck.error ?? 'Invalid transfer details.');
  }

  const eligibility = validateEmployeeEligibilityForAssignment(
    employee,
    input.designationId,
    input.serviceCategory,
    input.serviceId
  );
  if (!eligibility.valid) {
    throw new Error(eligibility.error ?? 'Employee is not eligible for the target site designation.');
  }

  const conflict = detectShiftConflict(
    {
      startDate: input.transferDate,
      endDate: input.newEndDate,
      shift: input.shift,
      shiftStartTime: input.shiftStartTime,
      shiftEndTime: input.shiftEndTime,
      dutyHours: input.dutyHours,
    },
    empAssignments,
    { excludeAssignmentIds: [source.assignmentId] }
  );
  if (conflict.hasConflict) {
    throw new Error(conflict.reason ?? 'Transfer timing conflicts with another duty.');
  }

  const desigObj = designations.find((d) => d.designationId === input.designationId);
  const serviceObj = services.find((s) => s.serviceId === input.serviceId);
  const newBranchObj = branches.find((b) => b.branchId === newSiteObj.branchId);
  const newClientObj = clients.find((c) => c.clientId === newSiteObj.clientId);

  if (!desigObj || !serviceObj || !newBranchObj) {
    throw new Error('Target Service, Designation, or Branch could not be found.');
  }

  const capacityCheck = checkSitePostCapacity({
    siteName: newSiteObj.siteName,
    designationName: desigObj.designationName,
    siteId: newSiteObj.siteId,
    siteServiceId: input.newSiteServiceId,
    serviceCategory: input.serviceCategory,
    serviceId: input.serviceId,
    designationId: input.designationId,
    startDate: input.transferDate,
    endDate: input.newEndDate,
    siteConfigs: newSiteConfigs,
    existingSiteAssignments: newSiteAssignments,
  });
  if (capacityCheck.error) {
    throw new Error(capacityCheck.error);
  }

  const today = getTodayIsoDate();
  const closedOldEndDate =
    input.transferDate > source.startDate
      ? addDaysToIsoDate(input.transferDate, -1)
      : source.startDate;
  const newStatus = resolveAssignmentStatusByDates(
    input.transferDate,
    input.newEndDate,
    undefined,
    today
  );
  const nowIso = new Date().toISOString();
  const actorLabel = `${caller.fullName} (${caller.role})`;

  const newAssignmentId = generateSequentialId(
    'ASN',
    allVisible.map((a) => a.assignmentId)
  );

  const closedSource: EmployeeAssignmentRecord = {
    ...source,
    endDate: closedOldEndDate,
    assignmentStatus: 'Transferred',
    transferredToAssignmentId: newAssignmentId,
    transferredToSiteId: newSiteObj.siteId,
    transferredToSiteName: newSiteObj.siteName,
    remarks: sanitizeInput(
      `${source.remarks ? `${source.remarks} | ` : ''}Transferred to ${newSiteObj.siteName} (${newAssignmentId}) effective ${input.transferDate}.`,
      300
    ),
    updatedBy: caller.uid,
    updatedAt: nowIso,
  };

  const newRecord: EmployeeAssignmentRecord = {
    assignmentId: newAssignmentId,
    employeeId: employee.employeeId,
    employeeName: employee.fullName,
    linkedUid: employee.linkedUid || '',
    branchId: newSiteObj.branchId,
    branchName: newBranchObj.branchName,
    clientId: newSiteObj.clientId,
    clientName: newClientObj?.companyName || newSiteObj.clientName,
    siteId: newSiteObj.siteId,
    siteName: newSiteObj.siteName,
    siteServiceId: capacityCheck.matchedSiteServiceId,
    serviceCategory: input.serviceCategory,
    serviceId: serviceObj.serviceId,
    serviceName: serviceObj.serviceName,
    designationId: desigObj.designationId,
    designationName: desigObj.designationName,
    shift: sanitizeInput(input.shift, 80),
    shiftStartTime: input.shiftStartTime.trim(),
    shiftEndTime: input.shiftEndTime.trim(),
    reportingTime: input.reportingTime.trim(),
    dutyHours: Number(input.dutyHours),
    weeklyOff: sanitizeInput(input.weeklyOff, 40),
    startDate: input.transferDate.trim(),
    endDate: input.newEndDate.trim(),
    reportingInstructions: sanitizeInput(input.reportingInstructions, 400),
    remarks: sanitizeInput(input.remarks, 300),
    assignmentStatus: newStatus,
    previousAssignmentId: source.assignmentId,
    previousSiteId: source.siteId,
    previousSiteName: source.siteName,
    transferredToAssignmentId: '',
    transferredToSiteId: '',
    transferredToSiteName: '',
    assignedBy: actorLabel,
    assignedByRole: caller.role,
    createdBy: caller.uid,
    updatedBy: caller.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const transferSummary = `Transferred ${employee.fullName} (${employee.employeeId}) from "${source.siteName}" (${source.assignmentId}) to "${newSiteObj.siteName}" (${newAssignmentId}) effective ${input.transferDate} as ${desigObj.designationName}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    store.employeeAssignments = [
      newRecord,
      ...store.employeeAssignments.map((a) =>
        a.assignmentId === source.assignmentId ? closedSource : a
      ),
    ];

    store.assignmentHistory.unshift(
      buildAssignmentHistoryObject(caller, {
        assignmentId: newAssignmentId,
        employeeId: employee.employeeId,
        employeeName: employee.fullName,
        linkedUid: employee.linkedUid,
        branchId: newSiteObj.branchId,
        clientId: newSiteObj.clientId,
        siteId: newSiteObj.siteId,
        siteName: newSiteObj.siteName,
        previousSiteId: source.siteId,
        previousSiteName: source.siteName,
        newSiteId: newSiteObj.siteId,
        newSiteName: newSiteObj.siteName,
        actionType: 'Employee Transferred',
        summary: transferSummary,
        remarks: newRecord.remarks,
        timestamp: nowIso,
      })
    );

    const oldSiteObj = sites.find((s) => s.siteId === source.siteId);
    if (oldSiteObj) {
      const oldConfigs = await listSiteServiceConfigs(caller, isPreviewSession, oldSiteObj.siteId);
      store.siteDeploymentSummaries[oldSiteObj.siteId] = computeSanitizedSiteSummary(
        oldSiteObj,
        oldConfigs,
        store.employeeAssignments,
        today
      );
    }
    store.siteDeploymentSummaries[newSiteObj.siteId] = computeSanitizedSiteSummary(
      newSiteObj,
      newSiteConfigs,
      store.employeeAssignments,
      today
    );
    writeLocalDeploymentStore(store);

    syncLocalEmployeePrimarySiteFromAssignment(caller, {
      employeeId: employee.employeeId,
      currentSiteId: newStatus === 'Active' ? newSiteObj.siteId : employee.currentSiteId,
      currentSiteName: newStatus === 'Active' ? newSiteObj.siteName : employee.currentSiteName,
      historyAction: 'Employee Transferred Between Sites',
      historySummary: transferSummary,
      metadata: {
        previousSiteId: source.siteId,
        previousSiteName: source.siteName,
        newSiteId: newSiteObj.siteId,
        newSiteName: newSiteObj.siteName,
        newAssignmentId,
      },
    });

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Transferred',
      module: 'Assignment',
      recordId: newAssignmentId,
      branchId: newSiteObj.branchId,
      summary: transferSummary,
    });

    return newRecord;
  }

  const path = `employeeAssignments/${newAssignmentId}`;
  try {
    const historyObj = buildAssignmentHistoryObject(caller, {
      assignmentId: newAssignmentId,
      employeeId: employee.employeeId,
      employeeName: employee.fullName,
      linkedUid: employee.linkedUid,
      branchId: newSiteObj.branchId,
      clientId: newSiteObj.clientId,
      siteId: newSiteObj.siteId,
      siteName: newSiteObj.siteName,
      previousSiteId: source.siteId,
      previousSiteName: source.siteName,
      newSiteId: newSiteObj.siteId,
      newSiteName: newSiteObj.siteName,
      actionType: 'Employee Transferred',
      summary: transferSummary,
      remarks: newRecord.remarks,
      timestamp: nowIso,
    });

    await runTransaction(firestoreDb!, async (tx) => {
      const oldRef = doc(firestoreDb!, 'employeeAssignments', source.assignmentId);
      const newRef = doc(firestoreDb!, 'employeeAssignments', newAssignmentId);
      const empRef = doc(firestoreDb!, 'employees', employee.employeeId);

      const oldSnap = await tx.get(oldRef);
      if (!oldSnap.exists()) throw new Error('Source assignment not found.');

      tx.update(oldRef, {
        endDate: closedSource.endDate,
        assignmentStatus: 'Transferred',
        transferredToAssignmentId: newAssignmentId,
        transferredToSiteId: newSiteObj.siteId,
        transferredToSiteName: newSiteObj.siteName,
        remarks: closedSource.remarks,
        updatedBy: caller.uid,
        updatedAt: nowIso,
        serverUpdatedAt: serverTimestamp(),
      });

      tx.set(newRef, {
        ...newRecord,
        serverCreatedAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
      });

      tx.set(doc(firestoreDb!, 'assignmentHistory', historyObj.historyId), {
        ...historyObj,
        serverCreatedAt: serverTimestamp(),
      });

      if (newStatus === 'Active') {
        tx.update(empRef, {
          currentSiteId: newSiteObj.siteId,
          currentSiteName: newSiteObj.siteName,
          updatedAt: nowIso,
          updatedBy: actorLabel,
          serverUpdatedAt: serverTimestamp(),
        });
      }

      const empHistId = makeEmployeeHistoryId();
      tx.set(doc(firestoreDb!, 'employeeHistory', empHistId), {
        historyId: empHistId,
        employeeId: employee.employeeId,
        linkedUid: employee.linkedUid || '',
        branchId: employee.branchId,
        category: 'SiteAssignment',
        action: 'Employee Transferred Between Sites',
        summary: transferSummary,
        actorUid: caller.uid,
        actorName: caller.fullName,
        actorRole: caller.role,
        timestamp: nowIso,
        serverCreatedAt: serverTimestamp(),
      });
    });

    await syncLiveSiteSummaryDocument(caller, isPreviewSession, source.siteId);
    await syncLiveSiteSummaryDocument(caller, isPreviewSession, newSiteObj.siteId);
    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Employee Transferred',
      module: 'Assignment',
      recordId: newAssignmentId,
      branchId: newSiteObj.branchId,
      summary: transferSummary,
    });
    notifyDeploymentListeners();
    return newRecord;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// ============================================================================
// 5. END OR CANCEL ASSIGNMENT (NEVER DELETES HISTORICAL RECORDS)
// ============================================================================
export async function endOrCancelAssignment(
  caller: RexonUser,
  isPreviewSession: boolean,
  assignmentId: string,
  terminalStatus: 'Completed' | 'Cancelled',
  remarks: string,
  effectiveEndDate?: string
): Promise<void> {
  if (caller.role !== 'admin' && caller.role !== 'hr') {
    throw new Error('Only Admin or authorized HR can end or cancel site assignments.');
  }

  const allVisible = await listEmployeeAssignments(caller, isPreviewSession);
  const target = allVisible.find((a) => a.assignmentId === assignmentId);
  if (!target) {
    throw new Error(`Assignment ${assignmentId} not found.`);
  }

  assertSiteScopeForCaller(caller, target.branchId, target.siteId, 'assignment.edit');

  if (
    target.assignmentStatus === 'Cancelled' ||
    target.assignmentStatus === 'Transferred' ||
    target.assignmentStatus === 'Completed'
  ) {
    throw new Error(`Assignment ${assignmentId} is already ${target.assignmentStatus}.`);
  }

  const today = getTodayIsoDate();
  const cleanRemarks = sanitizeInput(
    remarks || (terminalStatus === 'Completed' ? 'Duty completed.' : 'Assignment cancelled.'),
    300
  );
  const resolvedEnd =
    terminalStatus === 'Completed'
      ? effectiveEndDate?.trim() || (today >= target.startDate ? today : target.endDate)
      : target.endDate;
  const nowIso = new Date().toISOString();
  const actionType: AssignmentHistoryActionType =
    terminalStatus === 'Completed' ? 'Assignment Ended' : 'Assignment Cancelled';
  const summaryText = `${actionType} for ${target.employeeName} (${target.employeeId}) at "${target.siteName}" (${assignmentId}). Remarks: ${cleanRemarks}`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    store.employeeAssignments = store.employeeAssignments.map((a) =>
      a.assignmentId === assignmentId
        ? {
            ...a,
            endDate: resolvedEnd,
            assignmentStatus: terminalStatus,
            remarks: cleanRemarks,
            updatedBy: caller.uid,
            updatedAt: nowIso,
          }
        : a
    );
    store.assignmentHistory.unshift(
      buildAssignmentHistoryObject(caller, {
        assignmentId,
        employeeId: target.employeeId,
        employeeName: target.employeeName,
        linkedUid: target.linkedUid,
        branchId: target.branchId,
        clientId: target.clientId,
        siteId: target.siteId,
        siteName: target.siteName,
        actionType,
        summary: summaryText,
        remarks: cleanRemarks,
        timestamp: nowIso,
      })
    );

    const sites = await listSites(caller, isPreviewSession);
    const siteObj = sites.find((s) => s.siteId === target.siteId);
    if (siteObj) {
      const siteConfigs = await listSiteServiceConfigs(caller, isPreviewSession, target.siteId);
      store.siteDeploymentSummaries[target.siteId] = computeSanitizedSiteSummary(
        siteObj,
        siteConfigs,
        store.employeeAssignments,
        today
      );
    }
    writeLocalDeploymentStore(store);

    const remainingActive = findEmployeePrimaryActiveAssignment(
      store.employeeAssignments,
      target.employeeId,
      today
    );
    syncLocalEmployeePrimarySiteFromAssignment(caller, {
      employeeId: target.employeeId,
      currentSiteId: remainingActive?.siteId || '',
      currentSiteName: remainingActive?.siteName || '',
      historyAction: actionType,
      historySummary: summaryText,
    });

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: actionType,
      module: 'Assignment',
      recordId: assignmentId,
      branchId: target.branchId,
      summary: summaryText,
    });
    return;
  }

  const path = `employeeAssignments/${assignmentId}`;
  try {
    const historyObj = buildAssignmentHistoryObject(caller, {
      assignmentId,
      employeeId: target.employeeId,
      employeeName: target.employeeName,
      linkedUid: target.linkedUid,
      branchId: target.branchId,
      clientId: target.clientId,
      siteId: target.siteId,
      siteName: target.siteName,
      actionType,
      summary: summaryText,
      remarks: cleanRemarks,
      timestamp: nowIso,
    });

    const empAssignments = await listEmployeeAssignments(caller, isPreviewSession, {
      employeeId: target.employeeId,
    });
    const remainingActive = empAssignments
      .filter((a) => a.assignmentId !== assignmentId)
      .find((a) => isAssignmentActiveOnDate(a, today));

    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'employeeAssignments', assignmentId), {
      endDate: resolvedEnd,
      assignmentStatus: terminalStatus,
      remarks: cleanRemarks,
      updatedBy: caller.uid,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'assignmentHistory', historyObj.historyId), {
      ...historyObj,
      serverCreatedAt: serverTimestamp(),
    });
    batch.update(doc(firestoreDb!, 'employees', target.employeeId), {
      currentSiteId: remainingActive?.siteId || '',
      currentSiteName: remainingActive?.siteName || '',
      updatedAt: nowIso,
      updatedBy: `${caller.fullName} (${caller.role})`,
      serverUpdatedAt: serverTimestamp(),
    });
    await batch.commit();

    await syncLiveSiteSummaryDocument(caller, isPreviewSession, target.siteId);
    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: actionType,
      module: 'Assignment',
      recordId: assignmentId,
      branchId: target.branchId,
      summary: summaryText,
    });
    notifyDeploymentListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 6. FIELD OFFICER & HR REMARKS, REPLACEMENT/TRANSFER REQUESTS, SHORTAGE REPORTS
// ============================================================================
export async function addAssignmentRemark(
  caller: RexonUser,
  isPreviewSession: boolean,
  assignmentId: string,
  remark: string
): Promise<void> {
  assertNotSiteRole(caller);
  const cleanRemark = sanitizeInput(remark, 300);
  if (!cleanRemark) {
    throw new Error('Enter a valid remark note.');
  }

  const allVisible = await listEmployeeAssignments(caller, isPreviewSession);
  const target = allVisible.find((a) => a.assignmentId === assignmentId);
  if (!target) throw new Error(`Assignment ${assignmentId} not found.`);

  assertSiteScopeForCaller(caller, target.branchId, target.siteId, 'assignment.view');

  const nowIso = new Date().toISOString();
  const mergedRemark = sanitizeInput(
    target.remarks
      ? `${target.remarks} | [${caller.fullName}]: ${cleanRemark}`
      : `[${caller.fullName}]: ${cleanRemark}`,
    300
  );
  const summaryText = `Added operational remark on assignment ${assignmentId} (${target.employeeName} at "${target.siteName}"): ${cleanRemark}`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    store.employeeAssignments = store.employeeAssignments.map((a) =>
      a.assignmentId === assignmentId
        ? { ...a, remarks: mergedRemark, updatedBy: caller.uid, updatedAt: nowIso }
        : a
    );
    store.assignmentHistory.unshift(
      buildAssignmentHistoryObject(caller, {
        assignmentId,
        employeeId: target.employeeId,
        employeeName: target.employeeName,
        linkedUid: target.linkedUid,
        branchId: target.branchId,
        clientId: target.clientId,
        siteId: target.siteId,
        siteName: target.siteName,
        actionType: 'Field Officer Remark Added',
        summary: summaryText,
        remarks: cleanRemark,
        timestamp: nowIso,
      })
    );
    writeLocalDeploymentStore(store);

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Assignment Remark Added',
      module: 'Assignment',
      recordId: assignmentId,
      branchId: target.branchId,
      summary: summaryText,
    });
    return;
  }

  const path = `employeeAssignments/${assignmentId}`;
  try {
    const historyObj = buildAssignmentHistoryObject(caller, {
      assignmentId,
      employeeId: target.employeeId,
      employeeName: target.employeeName,
      linkedUid: target.linkedUid,
      branchId: target.branchId,
      clientId: target.clientId,
      siteId: target.siteId,
      siteName: target.siteName,
      actionType: 'Field Officer Remark Added',
      summary: summaryText,
      remarks: cleanRemark,
      timestamp: nowIso,
    });

    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'employeeAssignments', assignmentId), {
      remarks: mergedRemark,
      updatedBy: caller.uid,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'assignmentHistory', historyObj.historyId), {
      ...historyObj,
      serverCreatedAt: serverTimestamp(),
    });
    await batch.commit();

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Assignment Remark Added',
      module: 'Assignment',
      recordId: assignmentId,
      branchId: target.branchId,
      summary: summaryText,
    });
    notifyDeploymentListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function requestFieldOfficerAssignmentAction(
  caller: RexonUser,
  isPreviewSession: boolean,
  params: {
    assignmentId: string;
    actionKind: 'Replacement' | 'Transfer';
    proposedReplacementEmployeeId?: string;
    proposedTargetSiteName?: string;
    effectiveDate: string;
    reason: string;
  }
): Promise<ApprovalRequestRecord> {
  if (caller.role !== 'field_officer' && caller.role !== 'hr' && caller.role !== 'admin') {
    throw new Error('Unauthorized role for assignment action requests.');
  }

  const cleanReason = sanitizeInput(params.reason, 360);
  if (cleanReason.length < 8) {
    throw new Error('Provide a clear operational reason (minimum 8 characters).');
  }

  const allVisible = await listEmployeeAssignments(caller, isPreviewSession);
  const target = allVisible.find((a) => a.assignmentId === params.assignmentId);
  if (!target) throw new Error(`Assignment ${params.assignmentId} not found.`);

  assertSiteScopeForCaller(caller, target.branchId, target.siteId, 'assignment.view');

  const requestType =
    params.actionKind === 'Replacement'
      ? 'Field Officer Replacement Request'
      : 'Field Officer Transfer Request';

  const summary =
    params.actionKind === 'Replacement'
      ? `Replacement requested for ${target.employeeName} (${target.designationName}) at ${target.siteName} effective ${params.effectiveDate}${params.proposedReplacementEmployeeId ? ` [Suggested: ${params.proposedReplacementEmployeeId}]` : ''}`
      : `Transfer requested for ${target.employeeName} from ${target.siteName}${params.proposedTargetSiteName ? ` to ${params.proposedTargetSiteName}` : ''} effective ${params.effectiveDate}`;

  const approval = await submitApprovalRequest(caller, isPreviewSession, {
    requestType,
    module: 'Assignment',
    targetRecordId: target.assignmentId,
    targetRecordName: `${target.employeeName} — ${target.siteName}`,
    branchId: target.branchId,
    summary,
    reason: cleanReason,
    proposedPayload: {
      assignmentId: target.assignmentId,
      employeeId: target.employeeId,
      employeeName: target.employeeName,
      siteId: target.siteId,
      siteName: target.siteName,
      effectiveDate: params.effectiveDate,
      ...(params.proposedReplacementEmployeeId
        ? { proposedReplacementEmployeeId: params.proposedReplacementEmployeeId }
        : {}),
      ...(params.proposedTargetSiteName
        ? { proposedTargetSiteName: params.proposedTargetSiteName }
        : {}),
    },
  });

  const nowIso = new Date().toISOString();
  const historyObj = buildAssignmentHistoryObject(caller, {
    assignmentId: target.assignmentId,
    employeeId: target.employeeId,
    employeeName: target.employeeName,
    linkedUid: target.linkedUid,
    branchId: target.branchId,
    clientId: target.clientId,
    siteId: target.siteId,
    siteName: target.siteName,
    actionType: 'Field Officer Action Requested',
    summary: `${requestType} (${approval.approvalId}): ${summary}`,
    remarks: cleanReason,
    timestamp: nowIso,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    store.assignmentHistory.unshift(historyObj);
    writeLocalDeploymentStore(store);
  } else {
    try {
      await setDoc(doc(firestoreDb!, 'assignmentHistory', historyObj.historyId), {
        ...historyObj,
        serverCreatedAt: serverTimestamp(),
      });
      notifyDeploymentListeners();
    } catch {
      // Non-fatal
    }
  }

  return approval;
}

export async function reviewFieldOfficerAssignmentApproval(
  caller: RexonUser,
  isPreviewSession: boolean,
  approval: ApprovalRequestRecord,
  decision: 'Approved' | 'Rejected',
  reviewRemarks: string
): Promise<void> {
  await decideApprovalRequest(
    caller,
    isPreviewSession,
    approval.approvalId,
    decision,
    reviewRemarks
  );

  // Record decision in assignmentHistory when linked to an assignmentId
  const allVisible = await listEmployeeAssignments(caller, isPreviewSession);
  const linkedAssignment = allVisible.find((a) => a.assignmentId === approval.targetRecordId);
  if (!linkedAssignment) {
    notifyDeploymentListeners();
    return;
  }

  const historyObj = buildAssignmentHistoryObject(caller, {
    assignmentId: linkedAssignment.assignmentId,
    employeeId: linkedAssignment.employeeId,
    employeeName: linkedAssignment.employeeName,
    linkedUid: linkedAssignment.linkedUid,
    branchId: linkedAssignment.branchId,
    clientId: linkedAssignment.clientId,
    siteId: linkedAssignment.siteId,
    siteName: linkedAssignment.siteName,
    actionType: 'Approval Decision Recorded',
    summary: `${decision} ${approval.requestType} (${approval.approvalId}) for ${linkedAssignment.employeeName}.`,
    remarks: reviewRemarks,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    store.assignmentHistory.unshift(historyObj);
    writeLocalDeploymentStore(store);
  } else {
    try {
      await setDoc(doc(firestoreDb!, 'assignmentHistory', historyObj.historyId), {
        ...historyObj,
        serverCreatedAt: serverTimestamp(),
      });
      notifyDeploymentListeners();
    } catch {
      // Non-fatal
    }
  }
}

// ============================================================================
// 7. MANPOWER SHORTAGE REPORTING (`manpowerShortages` COLLECTION)
// ============================================================================
export async function listManpowerShortages(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<ManpowerShortageRecord[]> {
  assertNotSiteRole(caller);
  if (caller.role === 'employee') return [];
  const authorizedBranches = getAuthorizedBranchIds(caller);

  const filterRows = (rows: ManpowerShortageRecord[]) =>
    rows
      .filter((s) => {
        if (caller.role === 'hr' && !authorizedBranches.includes(s.branchId)) return false;
        if (caller.role === 'field_officer' && !caller.assignedSiteIds.includes(s.siteId)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    return filterRows(store.manpowerShortages);
  }

  const path = 'manpowerShortages';
  try {
    let q;
    if (caller.role === 'admin') {
      q = query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      if (authorizedBranches.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('branchId', 'in', authorizedBranches.slice(0, 10))
      );
    } else if (caller.role === 'field_officer') {
      if (caller.assignedSiteIds.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('siteId', 'in', caller.assignedSiteIds.slice(0, 10))
      );
    } else {
      return [];
    }

    const snap = await getDocs(q);
    return filterRows(snap.docs.map((d) => d.data() as ManpowerShortageRecord));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function reportManpowerShortage(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: ReportManpowerShortageInput
): Promise<ManpowerShortageRecord> {
  if (caller.role !== 'admin' && caller.role !== 'hr' && caller.role !== 'field_officer') {
    throw new Error('Only Admin, HR, or Field Officers can report manpower shortages.');
  }

  if (!Number.isFinite(input.shortageCount) || input.shortageCount < 1 || input.shortageCount > 500) {
    throw new Error('Shortage headcount must be between 1 and 500.');
  }
  const cleanReason = sanitizeInput(input.reason, 360);
  if (cleanReason.length < 6) {
    throw new Error('Provide a brief operational reason for the shortage (minimum 6 characters).');
  }

  const [sites, services, designations, existingShortages] = await Promise.all([
    listSites(caller, isPreviewSession),
    listServices(caller, isPreviewSession),
    listDesignations(caller, isPreviewSession),
    listManpowerShortages(caller, isPreviewSession),
  ]);

  const siteObj = sites.find((s) => s.siteId === input.siteId && !s.isArchived);
  if (!siteObj) throw new Error('Selected Site could not be found.');

  assertSiteScopeForCaller(caller, siteObj.branchId, siteObj.siteId, 'assignment.view');

  const serviceObj = services.find((sv) => sv.serviceId === input.serviceId);
  const desigObj = designations.find((ds) => ds.designationId === input.designationId);
  if (!serviceObj || !desigObj) {
    throw new Error('Selected Service or Designation could not be found.');
  }

  const shortageId = generateSequentialId(
    'MSH',
    existingShortages.map((s) => s.shortageId)
  );
  const nowIso = new Date().toISOString();

  const record: ManpowerShortageRecord = {
    shortageId,
    siteId: siteObj.siteId,
    siteName: siteObj.siteName,
    clientId: siteObj.clientId,
    clientName: siteObj.clientName,
    branchId: siteObj.branchId,
    serviceCategory: input.serviceCategory,
    serviceId: serviceObj.serviceId,
    serviceName: serviceObj.serviceName,
    designationId: desigObj.designationId,
    designationName: desigObj.designationName,
    shift: sanitizeInput(input.shift || 'General Shift', 80),
    shortageCount: Math.round(input.shortageCount),
    urgency: input.urgency,
    dateReportedFor: input.dateReportedFor || getTodayIsoDate(),
    reason: cleanReason,
    status: 'Open',
    reportedByUid: caller.uid,
    reportedByName: caller.fullName,
    reportedByRole: caller.role,
    resolutionRemarks: '',
    resolvedByName: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const auditSummary = `Reported manpower shortage ${shortageId} at "${siteObj.siteName}" (${record.shortageCount} × ${desigObj.designationName}, ${record.urgency} urgency): ${cleanReason}`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    store.manpowerShortages.unshift(record);
    writeLocalDeploymentStore(store);
  } else {
    const path = `manpowerShortages/${shortageId}`;
    try {
      await setDoc(doc(firestoreDb!, 'manpowerShortages', shortageId), {
        ...record,
        serverCreatedAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
      });
      notifyDeploymentListeners();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  if (input.escalateToApproval || input.urgency === 'Critical') {
    await submitApprovalRequest(caller, isPreviewSession, {
      requestType: 'Manpower Shortage Escalation',
      module: 'Assignment',
      targetRecordId: shortageId,
      targetRecordName: `${siteObj.siteName} — ${desigObj.designationName}`,
      branchId: siteObj.branchId,
      summary: `${record.urgency} shortage of ${record.shortageCount} ${desigObj.designationName}(s) at ${siteObj.siteName}`,
      reason: cleanReason,
      proposedPayload: {
        shortageId,
        siteId: siteObj.siteId,
        designationId: desigObj.designationId,
        shortageCount: String(record.shortageCount),
      },
    });
  }

  await recordExternalMasterAudit(caller, isPreviewSession, {
    action: 'Manpower Shortage Reported',
    module: 'Assignment',
    recordId: shortageId,
    branchId: siteObj.branchId,
    summary: auditSummary,
  });

  return record;
}

export async function updateManpowerShortageStatus(
  caller: RexonUser,
  isPreviewSession: boolean,
  shortageId: string,
  nextStatus: ShortageStatus,
  resolutionRemarks: string
): Promise<void> {
  if (caller.role !== 'admin' && caller.role !== 'hr') {
    throw new Error('Only Admin or authorized HR can acknowledge or resolve shortage reports.');
  }

  const existing = await listManpowerShortages(caller, isPreviewSession);
  const target = existing.find((s) => s.shortageId === shortageId);
  if (!target) throw new Error(`Shortage report ${shortageId} not found.`);

  assertSiteScopeForCaller(caller, target.branchId, target.siteId, 'assignment.edit');

  const cleanNotes = sanitizeInput(
    resolutionRemarks || `Marked ${nextStatus} by ${caller.fullName}.`,
    300
  );
  const nowIso = new Date().toISOString();

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    store.manpowerShortages = store.manpowerShortages.map((s) =>
      s.shortageId === shortageId
        ? {
            ...s,
            status: nextStatus,
            resolutionRemarks: cleanNotes,
            resolvedByName: nextStatus === 'Resolved' ? caller.fullName : s.resolvedByName,
            updatedAt: nowIso,
          }
        : s
    );
    writeLocalDeploymentStore(store);
  } else {
    const path = `manpowerShortages/${shortageId}`;
    try {
      await setDoc(
        doc(firestoreDb!, 'manpowerShortages', shortageId),
        {
          status: nextStatus,
          resolutionRemarks: cleanNotes,
          resolvedByName: nextStatus === 'Resolved' ? caller.fullName : target.resolvedByName,
          updatedAt: nowIso,
          serverUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      notifyDeploymentListeners();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  await recordExternalMasterAudit(caller, isPreviewSession, {
    action: `Shortage ${nextStatus}`,
    module: 'Assignment',
    recordId: shortageId,
    branchId: target.branchId,
    summary: `Updated shortage ${shortageId} (${target.siteName}) to ${nextStatus}: ${cleanNotes}`,
  });
}

// ============================================================================
// 8. SITE PORTAL SANITIZED SUMMARY READER (ZERO PII / ZERO EMPLOYEE RECORDS)
// ============================================================================
export async function getSitePortalDeploymentSummary(
  caller: RexonUser,
  isPreviewSession: boolean,
  targetSiteId?: string
): Promise<SiteDeploymentSummaryRecord[]> {
  const [sites, siteConfigs] = await Promise.all([
    listSites(caller, isPreviewSession),
    listSiteServiceConfigs(caller, isPreviewSession, targetSiteId),
  ]);

  const scopedSites = sites.filter((s) => {
    if (s.isArchived) return false;
    if (targetSiteId && s.siteId !== targetSiteId) return false;
    if (caller.role === 'site' || caller.role === 'field_officer') {
      return caller.assignedSiteIds.includes(s.siteId);
    }
    if (caller.role === 'hr') {
      return getAuthorizedBranchIds(caller).includes(s.branchId);
    }
    return caller.role === 'admin';
  });

  if (scopedSites.length === 0) return [];

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalDeploymentStore();
    const today = getTodayIsoDate();
    return scopedSites.map((site) =>
      computeSanitizedSiteSummary(site, siteConfigs, store.employeeAssignments, today)
    );
  }

  // Live Firestore: Site Portal reads `siteDeploymentSummaries/{siteId}` (zero PII)
  // and merges with Phase 2 `siteServices` if no summary doc has been materialized yet.
  const results: SiteDeploymentSummaryRecord[] = [];
  for (const site of scopedSites) {
    try {
      const snap = await getDoc(doc(firestoreDb!, 'siteDeploymentSummaries', site.siteId));
      if (snap.exists()) {
        const stored = snap.data() as SiteDeploymentSummaryRecord;
        // Ensure newly added Phase 2 siteServices lines appear immediately even before next assignment write
        const activeCfgs = siteConfigs.filter(
          (c) => c.siteId === site.siteId && c.status === 'Active'
        );
        const existingKeys = new Set(stored.lines.map((l) => l.lineKey));
        const missingLines: SanitizedSiteLineSummary[] = activeCfgs
          .filter((c) => !existingKeys.has(c.siteServiceId))
          .map((cfg) => ({
            lineKey: cfg.siteServiceId,
            serviceCategory: cfg.serviceCategory,
            serviceId: cfg.serviceId,
            serviceName: cfg.serviceName,
            designationId: cfg.designationId,
            designationName: cfg.designationName,
            shiftType: cfg.shiftType,
            workingHours: cfg.workingHours,
            weeklyOff: cfg.weeklyOff,
            requiredCount: cfg.requiredCount,
            deployedCount: 0,
            vacantCount: cfg.requiredCount,
            activeAssignmentsCount: 0,
            upcomingAssignmentsCount: 0,
          }));

        if (missingLines.length > 0) {
          const mergedLines = [...stored.lines, ...missingLines];
          const totalRequired = mergedLines.reduce((s, l) => s + l.requiredCount, 0);
          const totalDeployed = mergedLines.reduce((s, l) => s + l.deployedCount, 0);
          const totalVacant = mergedLines.reduce((s, l) => s + l.vacantCount, 0);
          results.push({
            ...stored,
            lines: mergedLines,
            totalRequired,
            totalDeployed,
            totalVacant,
          });
        } else {
          results.push(stored);
        }
      } else {
        results.push(computeSanitizedSiteSummary(site, siteConfigs, []));
      }
    } catch {
      results.push(computeSanitizedSiteSummary(site, siteConfigs, []));
    }
  }
  return results;
}

// ============================================================================
// 9. DASHBOARD & AVAILABILITY COMPUTATION BUILDERS (ADMIN / HR / FIELD OFFICER)
// ============================================================================
export function buildSiteDeploymentRows(params: {
  branches: BranchRecord[];
  clients: ClientRecord[];
  sites: SiteRecord[];
  siteConfigs: SiteServiceConfigRecord[];
  assignments: EmployeeAssignmentRecord[];
  shortages: ManpowerShortageRecord[];
  referenceDate?: string;
}): SiteDeploymentLineRow[] {
  const today = params.referenceDate || getTodayIsoDate();
  const branchMap = new Map(params.branches.map((b) => [b.branchId, b.branchName]));
  const clientMap = new Map(params.clients.map((c) => [c.clientId, c.companyName]));

  const rows: SiteDeploymentLineRow[] = [];

  for (const site of params.sites) {
    if (site.isArchived) continue;
    const summary = computeSanitizedSiteSummary(
      site,
      params.siteConfigs,
      params.assignments,
      today
    );
    const branchName = branchMap.get(site.branchId) || site.branchId;
    const clientName = clientMap.get(site.clientId) || site.clientName;

    for (const line of summary.lines) {
      const openShortageCount = params.shortages
        .filter(
          (sh) =>
            sh.siteId === site.siteId &&
            sh.designationId === line.designationId &&
            sh.status !== 'Resolved'
        )
        .reduce((sum, sh) => sum + sh.shortageCount, 0);

      rows.push({
        rowKey: line.lineKey,
        siteServiceId: line.lineKey.startsWith('ADHOC-') ? '' : line.lineKey,
        branchId: site.branchId,
        branchName,
        clientId: site.clientId,
        clientName,
        siteId: site.siteId,
        siteName: site.siteName,
        serviceCategory: line.serviceCategory,
        serviceId: line.serviceId,
        serviceName: line.serviceName,
        designationId: line.designationId,
        designationName: line.designationName,
        shiftType: line.shiftType,
        workingHours: line.workingHours,
        weeklyOff: line.weeklyOff,
        requiredEmployees: line.requiredCount,
        deployedEmployees: line.deployedCount,
        vacantPositions: computeNonNegativeVacancy(line.requiredCount, line.deployedCount),
        activeAssignments: line.activeAssignmentsCount,
        upcomingAssignments: line.upcomingAssignmentsCount,
        openShortageReports: openShortageCount,
      });
    }
  }

  return rows.sort(
    (a, b) =>
      a.clientName.localeCompare(b.clientName) ||
      a.siteName.localeCompare(b.siteName) ||
      a.serviceCategory.localeCompare(b.serviceCategory) ||
      a.designationName.localeCompare(b.designationName)
  );
}

export function buildEmployeeAvailabilityList(params: {
  employees: EmployeeRecord[];
  assignments: EmployeeAssignmentRecord[];
  targetDate?: string;
}): EmployeeAvailabilityItem[] {
  const targetDate = params.targetDate || getTodayIsoDate();

  return params.employees
    .filter((emp) => !emp.isDeleted)
    .map((emp) => {
      const empAssignments = params.assignments
        .filter((a) => a.employeeId === emp.employeeId)
        .map((a) => normalizeAssignmentLifecycle(a, targetDate));

      const activeOnDate = empAssignments.filter((a) => isAssignmentActiveOnDate(a, targetDate));
      const upcomingAfterDate = empAssignments.filter(
        (a) =>
          (a.assignmentStatus === 'Active' || a.assignmentStatus === 'Upcoming') &&
          a.startDate > targetDate
      );

      // Detect any conflict among active/upcoming duties
      let hasShiftConflict = false;
      let conflictDetails = '';
      const totalDutyHoursOnDate = activeOnDate.reduce((s, a) => s + (a.dutyHours || 0), 0);

      for (let i = 0; i < activeOnDate.length; i += 1) {
        const current = activeOnDate[i];
        const check = detectShiftConflict(
          {
            startDate: current.startDate,
            endDate: current.endDate,
            shift: current.shift,
            shiftStartTime: current.shiftStartTime,
            shiftEndTime: current.shiftEndTime,
            dutyHours: current.dutyHours,
          },
          activeOnDate.slice(i + 1)
        );
        if (check.hasConflict) {
          hasShiftConflict = true;
          conflictDetails = check.reason || 'Overlapping shifts on selected date.';
          break;
        }
      }

      const hasUnverifiedQualification =
        emp.docVerificationSummary === 'Rejected' ||
        emp.docVerificationSummary === 'Pending' ||
        emp.assignedDesignations.length === 0 ||
        emp.assignedDesignations.some(
          (d) => !d.qualificationVerified || !d.trainingVerified || !d.licenseVerified
        );

      let availabilityState: EmployeeAvailabilityState = 'Available';

      if (emp.employeeStatus === 'On Leave') {
        availabilityState = 'On Leave';
      } else if (!emp.isActive || emp.employeeStatus !== 'Active') {
        availabilityState = 'Inactive';
      } else if (hasShiftConflict) {
        availabilityState = 'Conflicting Shifts';
      } else if (
        emp.docVerificationSummary === 'Rejected' ||
        emp.assignedDesignations.length === 0 ||
        emp.assignedDesignations.every(
          (d) => !d.qualificationVerified || !d.trainingVerified || !d.licenseVerified
        )
      ) {
        availabilityState = 'Awaiting Verification';
      } else if (activeOnDate.length > 0) {
        availabilityState = 'Currently Deployed';
      } else if (upcomingAfterDate.length > 0) {
        availabilityState = 'Upcoming Assignment';
      } else {
        availabilityState = 'Available';
      }

      const categories = Array.from(
        new Set(emp.assignedDesignations.map((d) => d.serviceCategory))
      );

      return {
        employeeId: emp.employeeId,
        fullName: emp.fullName,
        mobile: emp.mobile,
        branchId: emp.branchId,
        branchName: emp.branchName,
        employeeStatus: emp.employeeStatus,
        docVerificationSummary: emp.docVerificationSummary,
        hasUnverifiedQualification,
        assignedServiceCategories: categories,
        assignedDesignationIds: emp.assignedDesignations.map((d) => d.designationId),
        assignedDesignationNames: emp.assignedDesignations.map((d) => d.designationName),
        availabilityState,
        activeAssignmentsOnDate: activeOnDate,
        upcomingAssignments: upcomingAfterDate,
        hasShiftConflict,
        conflictDetails,
        totalDutyHoursOnDate,
      };
    });
}

export async function loadOperationalDeploymentBundle(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<{
  branches: BranchRecord[];
  clients: ClientRecord[];
  sites: SiteRecord[];
  services: ServiceRecord[];
  designations: DesignationRecord[];
  siteConfigs: SiteServiceConfigRecord[];
  employees: EmployeeRecord[];
  assignments: EmployeeAssignmentRecord[];
  shortages: ManpowerShortageRecord[];
}> {
  const [
    branches,
    clients,
    sites,
    services,
    designations,
    siteConfigs,
    employees,
    assignments,
    shortages,
  ] = await Promise.all([
    listBranches(caller, isPreviewSession),
    listClients(caller, isPreviewSession),
    listSites(caller, isPreviewSession),
    listServices(caller, isPreviewSession),
    listDesignations(caller, isPreviewSession),
    listSiteServiceConfigs(caller, isPreviewSession),
    listEmployees(caller, isPreviewSession),
    listEmployeeAssignments(caller, isPreviewSession),
    listManpowerShortages(caller, isPreviewSession),
  ]);

  return {
    branches,
    clients,
    sites,
    services,
    designations,
    siteConfigs,
    employees,
    assignments,
    shortages,
  };
}
