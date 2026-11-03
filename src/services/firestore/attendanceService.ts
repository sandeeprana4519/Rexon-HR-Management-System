import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AttendanceAuditCategory,
  AttendanceAuditRecord,
  AttendanceCorrectionRequest,
  AttendanceDeviceMetadata,
  AttendanceGeoMetadata,
  AttendanceRecord,
  AttendanceStatus,
  AttendanceVerificationOutcome,
  CreateDutyRosterInput,
  DutyRosterRecord,
  EmployeeAssignmentRecord,
  EmployeeCheckInInput,
  EmployeeCheckOutInput,
  EmployeeNotificationCategory,
  EmployeeNotificationRecord,
  EmployeeRecord,
  EmployeeTodayDutyContext,
  ManualHrAttendanceInput,
  OperationType,
  RexonUser,
  SanitizedSiteAttendanceSummaryRecord,
  SanitizedSiteServiceAttendanceRow,
  SanitizedSiteShiftAttendanceRow,
  SiteGeoQrConfigInput,
  SiteQrSessionRecord,
  SiteRecord,
  SubmitAttendanceCorrectionInput,
  UpdateDutyRosterInput,
} from '../../types';
import {
  buildRosterTargetDates,
  calculateHaversineDistanceMeters,
  combineDateAndTimeToMs,
  computeCheckInLateMinutes,
  computeCheckOutMetrics,
  computeRosterShiftMetrics,
  detectDutyRosterConflict,
  isValidLatLng,
  resolveSiteGeoSettings,
  validateRosterTimings,
} from '../../utils/attendanceValidation';
import {
  addDaysToIsoDate,
  getTodayIsoDate,
  isAssignmentActiveOnDate,
  isValidIsoDate,
  isValidTime24h,
  validateEmployeeEligibilityForAssignment,
} from '../../utils/deploymentValidation';
import { getAuthorizedBranchIds, hasUserPermission } from '../../utils/portalConfig';
import { sanitizeInput } from '../../utils/validation';
import { firestoreDb, isFirebaseConfigured } from '../firebase/config';
import { listEmployeeAssignments } from './assignmentService';
import { getEmployeeById, getOwnEmployeeRecord, listEmployees } from './employeeService';
import { handleFirestoreError } from './errorHandler';
import {
  getSiteByIdForAttendance,
  listBranches,
  listClients,
  listDesignations,
  listServices,
  listSiteServiceConfigs,
  listSites,
  recordExternalMasterAudit,
  updateSiteAttendanceSettings,
} from './masterDataService';

const ATTENDANCE_STORAGE_KEY = 'rexon_phase4_attendance_v1';

interface LocalAttendanceStore {
  dutyRosters: DutyRosterRecord[];
  attendance: AttendanceRecord[];
  attendanceCorrections: AttendanceCorrectionRequest[];
  attendanceQrSessions: SiteQrSessionRecord[];
  employeeNotifications: EmployeeNotificationRecord[];
  attendanceAuditLogs: AttendanceAuditRecord[];
  siteAttendanceSummaries: Record<string, SanitizedSiteAttendanceSummaryRecord>;
}

type AttendanceListener = () => void;
const attendanceListeners = new Set<AttendanceListener>();

export function subscribeAttendanceData(listener: AttendanceListener): () => void {
  attendanceListeners.add(listener);
  return () => attendanceListeners.delete(listener);
}

function notifyAttendanceListeners(): void {
  attendanceListeners.forEach((fn) => fn());
}

function useLiveFirestore(isPreviewSession: boolean): boolean {
  return isFirebaseConfigured && Boolean(firestoreDb) && !isPreviewSession;
}

/**
 * Starts strictly empty — ZERO fake or hardcoded roster/attendance data.
 */
function buildEmptyAttendanceStore(): LocalAttendanceStore {
  return {
    dutyRosters: [],
    attendance: [],
    attendanceCorrections: [],
    attendanceQrSessions: [],
    employeeNotifications: [],
    attendanceAuditLogs: [],
    siteAttendanceSummaries: {},
  };
}

function readLocalAttendanceStore(): LocalAttendanceStore {
  try {
    const raw = localStorage.getItem(ATTENDANCE_STORAGE_KEY);
    if (!raw) return buildEmptyAttendanceStore();
    const parsed = JSON.parse(raw) as Partial<LocalAttendanceStore>;
    return {
      dutyRosters: Array.isArray(parsed.dutyRosters) ? parsed.dutyRosters : [],
      attendance: Array.isArray(parsed.attendance) ? parsed.attendance : [],
      attendanceCorrections: Array.isArray(parsed.attendanceCorrections)
        ? parsed.attendanceCorrections
        : [],
      attendanceQrSessions: Array.isArray(parsed.attendanceQrSessions)
        ? parsed.attendanceQrSessions
        : [],
      employeeNotifications: Array.isArray(parsed.employeeNotifications)
        ? parsed.employeeNotifications
        : [],
      attendanceAuditLogs: Array.isArray(parsed.attendanceAuditLogs)
        ? parsed.attendanceAuditLogs
        : [],
      siteAttendanceSummaries:
        parsed.siteAttendanceSummaries && typeof parsed.siteAttendanceSummaries === 'object'
          ? parsed.siteAttendanceSummaries
          : {},
    };
  } catch {
    return buildEmptyAttendanceStore();
  }
}

function writeLocalAttendanceStore(store: LocalAttendanceStore): void {
  try {
    localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota warnings
  }
  notifyAttendanceListeners();
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

function makeRuntimeUniqueId(prefix: string): string {
  return `${prefix}-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}-${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;
}

function captureSanitizedDeviceMetadata(): AttendanceDeviceMetadata {
  if (typeof navigator === 'undefined') {
    return {
      platform: 'Server/Runtime',
      userAgentSummary: 'Automated Runtime',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
      onlineStatus: true,
    };
  }
  return {
    platform: sanitizeInput(navigator.platform || 'Web Browser', 48),
    userAgentSummary: sanitizeInput((navigator.userAgent || 'Browser').slice(0, 96), 96),
    timezone: sanitizeInput(
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
      64
    ),
    onlineStatus: navigator.onLine !== false,
  };
}

function assertNotSitePortal(caller: RexonUser): void {
  if (caller.role === 'site') {
    throw new Error(
      'Unauthorized: Site Portal users can only access sanitized site attendance headcount summaries.'
    );
  }
}

function canCallerAccessBranchForAttendance(caller: RexonUser, branchId: string): boolean {
  if (caller.role === 'admin') return true;
  if (caller.role === 'hr') {
    if (hasUserPermission(caller, 'attendance.view_all_branch')) return true;
    return getAuthorizedBranchIds(caller).includes(branchId);
  }
  if (caller.role === 'field_officer') {
    const branches = getAuthorizedBranchIds(caller);
    return branches.length === 0 || branches.includes(branchId);
  }
  return false;
}

function buildAttendanceAuditEntry(
  actor: RexonUser,
  params: {
    category: AttendanceAuditCategory;
    targetId: string;
    employeeId?: string;
    siteId?: string;
    branchId: string;
    action: string;
    previousValueSummary?: string;
    newValueSummary: string;
    reason?: string;
    timestamp?: string;
  }
): AttendanceAuditRecord {
  return {
    auditId: makeRuntimeUniqueId('AAL'),
    category: params.category,
    targetId: sanitizeInput(params.targetId, 64),
    employeeId: sanitizeInput(params.employeeId || '', 64),
    siteId: sanitizeInput(params.siteId || '', 64),
    branchId: sanitizeInput(params.branchId || actor.branchId || 'ALL', 64),
    action: sanitizeInput(params.action, 100),
    previousValueSummary: sanitizeInput(params.previousValueSummary || '—', 300),
    newValueSummary: sanitizeInput(params.newValueSummary, 350),
    reason: sanitizeInput(params.reason || '', 300),
    actorUid: actor.uid,
    actorName: actor.fullName,
    actorRole: actor.role,
    timestamp: params.timestamp ?? new Date().toISOString(),
  };
}

function buildEmployeeNotificationEntry(params: {
  employeeId: string;
  linkedUid: string;
  branchId: string;
  siteId: string;
  siteName: string;
  category: EmployeeNotificationCategory;
  title: string;
  message: string;
  dutyDate: string;
  createdAt?: string;
}): EmployeeNotificationRecord {
  return {
    notificationId: makeRuntimeUniqueId('NTF'),
    employeeId: params.employeeId,
    linkedUid: params.linkedUid || '',
    branchId: params.branchId,
    siteId: params.siteId,
    siteName: sanitizeInput(params.siteName, 140),
    category: params.category,
    title: sanitizeInput(params.title, 120),
    message: sanitizeInput(params.message, 350),
    dutyDate: params.dutyDate,
    isRead: false,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

// ============================================================================
// SERVER-ASSISTED GPS & QR VERIFICATION HELPERS (WITH DETERMINISTIC FALLBACK)
// ============================================================================
async function verifyGpsWithBackendOrDeterministic(params: {
  employeeLat: number | null;
  employeeLng: number | null;
  accuracyMeters: number | null;
  siteLat: number | null;
  siteLng: number | null;
  allowedRadiusMeters: number;
  accuracyThresholdMeters: number;
}): Promise<{
  serverVerified: boolean;
  distanceMeters: number | null;
  withinGeofence: boolean;
  accuracyAcceptable: boolean;
  verificationOutcome: AttendanceVerificationOutcome;
  errorMessage?: string;
}> {
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const response = await fetch('/api/attendance/verify-gps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const body = (await response.json()) as {
        serverVerified?: boolean;
        distanceMeters?: number | null;
        withinGeofence?: boolean;
        accuracyAcceptable?: boolean;
        verificationOutcome?: AttendanceVerificationOutcome;
        error?: string;
      };
      if (response.ok || body.verificationOutcome) {
        return {
          serverVerified: Boolean(body.serverVerified),
          distanceMeters: body.distanceMeters ?? null,
          withinGeofence: Boolean(body.withinGeofence),
          accuracyAcceptable: Boolean(body.accuracyAcceptable),
          verificationOutcome: body.verificationOutcome ?? 'GPS_Unavailable',
          errorMessage: body.error,
        };
      }
    } catch {
      // Fallback to deterministic local evaluation when offline/test runner
    }
  }

  if (!isValidLatLng(params.employeeLat, params.employeeLng)) {
    return {
      serverVerified: false,
      distanceMeters: null,
      withinGeofence: false,
      accuracyAcceptable: false,
      verificationOutcome: 'GPS_Unavailable',
      errorMessage: 'Employee GPS coordinates could not be acquired.',
    };
  }

  if (!isValidLatLng(params.siteLat, params.siteLng)) {
    return {
      serverVerified: false,
      distanceMeters: null,
      withinGeofence: false,
      accuracyAcceptable: false,
      verificationOutcome: 'GPS_Unavailable',
      errorMessage: 'Site geofence coordinates are not configured on this site.',
    };
  }

  const distanceMeters = calculateHaversineDistanceMeters(
    params.employeeLat!,
    params.employeeLng!,
    params.siteLat!,
    params.siteLng!
  );
  const accuracyAcceptable =
    params.accuracyMeters === null ||
    params.accuracyMeters === undefined ||
    (Number.isFinite(params.accuracyMeters) &&
      params.accuracyMeters >= 0 &&
      params.accuracyMeters <= params.accuracyThresholdMeters);
  const withinGeofence = distanceMeters <= params.allowedRadiusMeters;

  let verificationOutcome: AttendanceVerificationOutcome = 'Verified';
  if (!accuracyAcceptable) {
    verificationOutcome = 'Low_GPS_Accuracy';
  } else if (!withinGeofence) {
    verificationOutcome = 'Outside_Geofence';
  }

  return {
    serverVerified: true,
    distanceMeters,
    withinGeofence,
    accuracyAcceptable,
    verificationOutcome,
  };
}

function encodeLocalFallbackQrToken(payload: Record<string, string | number>): string {
  const json = JSON.stringify(payload);
  const b64 =
    typeof btoa === 'function'
      ? btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      : Buffer.from(json, 'utf8').toString('base64url');
  let checksum = 2166136261;
  for (let i = 0; i < b64.length; i += 1) {
    checksum ^= b64.charCodeAt(i);
    checksum = Math.imul(checksum, 16777619);
  }
  const sig = Math.abs(checksum >>> 0).toString(36).toUpperCase();
  return `rxqrloc.${b64}.${sig}`;
}

function decodeLocalFallbackQrToken(token: string): Record<string, string | number> | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'rxqrloc') return null;
  const [, b64, providedSig] = parts;
  let checksum = 2166136261;
  for (let i = 0; i < b64.length; i += 1) {
    checksum ^= b64.charCodeAt(i);
    checksum = Math.imul(checksum, 16777619);
  }
  const expectedSig = Math.abs(checksum >>> 0).toString(36).toUpperCase();
  if (providedSig !== expectedSig) return null;
  try {
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(b64, 'base64url').toString('utf8');
    return JSON.parse(json) as Record<string, string | number>;
  } catch {
    return null;
  }
}

// ============================================================================
// SANITIZED SITE PORTAL ATTENDANCE SUMMARY SYNC (`siteAttendanceSummaries`)
// ============================================================================
async function rebuildSanitizedSiteAttendanceSummary(
  actor: RexonUser,
  isPreviewSession: boolean,
  siteId: string,
  attendanceDate: string
): Promise<SanitizedSiteAttendanceSummaryRecord | null> {
  const site = await getSiteByIdForAttendance(siteId, isPreviewSession);
  if (!site) return null;

  const summaryId = `${siteId}_${attendanceDate}`;
  const nowIso = new Date().toISOString();

  // Gather site service configurations for sanctioned baseline
  const adminReader: RexonUser = {
    ...actor,
    role: 'admin',
    permissions: [],
  };
  const [siteServiceList, assignments] = await Promise.all([
    listSiteServiceConfigs(adminReader, isPreviewSession, siteId),
    listEmployeeAssignments(adminReader, isPreviewSession),
  ]);

  const activeSiteAssignments = assignments.filter(
    (a) => a.siteId === siteId && isAssignmentActiveOnDate(a, attendanceDate)
  );

  let rostersOnDate: DutyRosterRecord[] = [];
  let attendanceOnDate: AttendanceRecord[] = [];

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    rostersOnDate = store.dutyRosters.filter(
      (r) =>
        r.siteId === siteId &&
        r.dutyDate === attendanceDate &&
        r.status === 'Published'
    );
    attendanceOnDate = store.attendance.filter(
      (a) => a.siteId === siteId && a.attendanceDate === attendanceDate
    );
  } else {
    const [rSnap, aSnap] = await Promise.all([
      getDocs(
        query(
          collection(firestoreDb!, 'dutyRosters'),
          where('siteId', '==', siteId),
          where('dutyDate', '==', attendanceDate)
        )
      ),
      getDocs(
        query(
          collection(firestoreDb!, 'attendance'),
          where('siteId', '==', siteId),
          where('attendanceDate', '==', attendanceDate)
        )
      ),
    ]);
    rostersOnDate = rSnap.docs
      .map((d) => d.data() as DutyRosterRecord)
      .filter((r) => r.status === 'Published');
    attendanceOnDate = aSnap.docs.map((d) => d.data() as AttendanceRecord);
  }

  const totalSanctioned = siteServiceList
    .filter((s) => s.status === 'Active')
    .reduce((acc, s) => acc + (s.requiredCount || 0), 0);

  // Deployed headcount for the date = union of published rosters and active assignments on date
  const deployedEmployeeIds = new Set<string>();
  rostersOnDate.forEach((r) => deployedEmployeeIds.add(r.employeeId));
  activeSiteAssignments.forEach((a) => deployedEmployeeIds.add(a.employeeId));
  attendanceOnDate.forEach((a) => deployedEmployeeIds.add(a.employeeId));

  const totalDeployed = deployedEmployeeIds.size;

  let presentCount = 0;
  let lateCount = 0;
  let halfDayCount = 0;
  let absentCount = 0;
  let weeklyOffCount = 0;
  let leaveCount = 0;

  for (const att of attendanceOnDate) {
    if (att.status === 'Present') {
      presentCount += 1;
    } else if (att.status === 'Late') {
      presentCount += 1;
      lateCount += 1;
    } else if (att.status === 'Half Day') {
      presentCount += 1;
      halfDayCount += 1;
    } else if (att.status === 'Absent') {
      absentCount += 1;
    } else if (att.status === 'Weekly Off' || att.status === 'Holiday') {
      weeklyOffCount += 1;
    } else if (att.status === 'Leave') {
      leaveCount += 1;
    }
  }

  const accountedEmployees = new Set(attendanceOnDate.map((a) => a.employeeId));
  const pendingCount = Math.max(0, totalDeployed - accountedEmployees.size);

  // Service & Designation breakdown (STRICTLY ZERO PII)
  const serviceMap = new Map<string, SanitizedSiteServiceAttendanceRow>();
  for (const cfg of siteServiceList.filter((c) => c.status === 'Active')) {
    const key = `${cfg.serviceCategory}:${cfg.designationId}:${cfg.shiftType}`;
    serviceMap.set(key, {
      lineKey: key,
      serviceCategory: cfg.serviceCategory,
      serviceName: cfg.serviceName,
      designationName: cfg.designationName,
      shiftType: cfg.shiftType,
      deployedCount: cfg.deployedCount,
      presentCount: 0,
      lateCount: 0,
      halfDayCount: 0,
      absentCount: 0,
      weeklyOffCount: 0,
    });
  }

  for (const att of attendanceOnDate) {
    const matchedKey =
      Array.from(serviceMap.keys()).find((k) =>
        k.startsWith(`${att.serviceCategory}:${att.designationId}:`)
      ) || `${att.serviceCategory}:${att.designationId}:${att.shiftType}`;

    const row = serviceMap.get(matchedKey) ?? {
      lineKey: matchedKey,
      serviceCategory: att.serviceCategory,
      serviceName: att.serviceName,
      designationName: att.designationName,
      shiftType: String(att.shiftType),
      deployedCount: 1,
      presentCount: 0,
      lateCount: 0,
      halfDayCount: 0,
      absentCount: 0,
      weeklyOffCount: 0,
    };

    if (att.status === 'Present') row.presentCount += 1;
    else if (att.status === 'Late') {
      row.presentCount += 1;
      row.lateCount += 1;
    } else if (att.status === 'Half Day') {
      row.presentCount += 1;
      row.halfDayCount += 1;
    } else if (att.status === 'Absent') {
      row.absentCount += 1;
    } else if (att.status === 'Weekly Off' || att.status === 'Holiday') {
      row.weeklyOffCount += 1;
    }
    serviceMap.set(matchedKey, row);
  }

  // Shift breakdown (STRICTLY ZERO PII)
  const shiftMap = new Map<string, SanitizedSiteShiftAttendanceRow>();
  for (const r of rostersOnDate) {
    const sKey = `${r.shiftType}|${r.dutyStartTime}-${r.dutyEndTime}`;
    const existing = shiftMap.get(sKey) ?? {
      shiftType: r.shiftType,
      timing: `${r.dutyStartTime} – ${r.dutyEndTime}${r.crossesMidnight ? ' (+1d)' : ''}`,
      deployedCount: 0,
      presentCount: 0,
      lateCount: 0,
      absentCount: 0,
      weeklyOffCount: 0,
    };
    existing.deployedCount += 1;
    shiftMap.set(sKey, existing);
  }

  for (const att of attendanceOnDate) {
    const sKey = `${att.shiftType}|${att.scheduledStartTime}-${att.scheduledEndTime}`;
    const existing = shiftMap.get(sKey) ?? {
      shiftType: String(att.shiftType),
      timing: `${att.scheduledStartTime} – ${att.scheduledEndTime}${att.crossesMidnight ? ' (+1d)' : ''}`,
      deployedCount: 1,
      presentCount: 0,
      lateCount: 0,
      absentCount: 0,
      weeklyOffCount: 0,
    };
    if (att.status === 'Present' || att.status === 'Half Day') {
      existing.presentCount += 1;
    } else if (att.status === 'Late') {
      existing.presentCount += 1;
      existing.lateCount += 1;
    } else if (att.status === 'Absent') {
      existing.absentCount += 1;
    } else if (att.status === 'Weekly Off' || att.status === 'Holiday') {
      existing.weeklyOffCount += 1;
    }
    shiftMap.set(sKey, existing);
  }

  const summaryRecord: SanitizedSiteAttendanceSummaryRecord = {
    summaryId,
    siteId: site.siteId,
    siteName: site.siteName,
    clientId: site.clientId,
    clientName: site.clientName,
    branchId: site.branchId,
    attendanceDate,
    totalSanctioned,
    totalDeployed,
    presentCount,
    lateCount,
    halfDayCount,
    absentCount,
    weeklyOffCount,
    leaveCount,
    pendingCount,
    serviceBreakdown: Array.from(serviceMap.values()),
    shiftBreakdown: Array.from(shiftMap.values()),
    updatedAt: nowIso,
  };

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.siteAttendanceSummaries[summaryId] = summaryRecord;
    writeLocalAttendanceStore(store);
    return summaryRecord;
  }

  try {
    await setDoc(doc(firestoreDb!, 'siteAttendanceSummaries', summaryId), {
      ...summaryRecord,
      serverUpdatedAt: serverTimestamp(),
    });
    notifyAttendanceListeners();
  } catch {
    // Non-fatal if caller is an Employee whose security rules disallow writing site summaries directly;
    // HR verification and roster publish refresh the summary authoritatively.
  }

  return summaryRecord;
}

// ============================================================================
// 1. SITE GPS GEOFENCE & QR CONFIGURATION
// ============================================================================
export async function configureSiteGeofenceAndQr(
  caller: RexonUser,
  isPreviewSession: boolean,
  config: SiteGeoQrConfigInput
): Promise<SiteRecord> {
  const updated = await updateSiteAttendanceSettings(caller, isPreviewSession, config);
  const auditEntry = buildAttendanceAuditEntry(caller, {
    category: 'Geofence',
    targetId: updated.siteId,
    siteId: updated.siteId,
    branchId: updated.branchId,
    action: 'Site Geofence & QR Settings Updated',
    newValueSummary: `Coords: (${updated.latitude ?? 'none'}, ${updated.longitude ?? 'none'}), Radius: ${updated.allowedRadiusMeters}m, Accuracy <= ${updated.gpsAccuracyThresholdMeters}m, GPS Mandatory: ${Boolean(updated.isGpsMandatory)}, QR Enabled: ${Boolean(updated.isQrEnabled)}`,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.attendanceAuditLogs.unshift(auditEntry);
    writeLocalAttendanceStore(store);
  } else {
    await setDoc(doc(firestoreDb!, 'attendanceAuditLogs', auditEntry.auditId), {
      ...auditEntry,
      createdAt: serverTimestamp(),
    });
    notifyAttendanceListeners();
  }

  return updated;
}

// ============================================================================
// 2. DUTY ROSTER MANAGEMENT (`dutyRosters`)
// ============================================================================
export async function listDutyRosters(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<DutyRosterRecord[]> {
  assertNotSitePortal(caller);

  if (caller.role === 'hr' && !hasUserPermission(caller, 'roster.view')) {
    return [];
  }

  let ownEmp: EmployeeRecord | null = null;
  if (caller.role === 'employee') {
    ownEmp = await getOwnEmployeeRecord(caller, isPreviewSession);
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    let list = [...store.dutyRosters];

    if (caller.role === 'hr') {
      list = list.filter((r) => canCallerAccessBranchForAttendance(caller, r.branchId));
    } else if (caller.role === 'field_officer') {
      list = list.filter(
        (r) =>
          caller.assignedSiteIds.includes(r.siteId) ||
          r.assignedFieldOfficerUid === caller.uid
      );
    } else if (caller.role === 'employee') {
      list = list.filter(
        (r) =>
          r.status === 'Published' &&
          (r.linkedUid === caller.uid || (ownEmp && r.employeeId === ownEmp.employeeId))
      );
    }

    return list.sort((a, b) => {
      const dateCmp = b.dutyDate.localeCompare(a.dutyDate);
      if (dateCmp !== 0) return dateCmp;
      return a.dutyStartTime.localeCompare(b.dutyStartTime);
    });
  }

  const path = 'dutyRosters';
  try {
    let q;
    if (caller.role === 'admin' || (caller.role === 'hr' && hasUserPermission(caller, 'attendance.view_all_branch'))) {
      q = query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      const branches = getAuthorizedBranchIds(caller);
      if (branches.length === 0) return [];
      q = query(collection(firestoreDb!, path), where('branchId', 'in', branches.slice(0, 10)));
    } else if (caller.role === 'field_officer') {
      if (!caller.assignedSiteIds || caller.assignedSiteIds.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('siteId', 'in', caller.assignedSiteIds.slice(0, 10))
      );
    } else if (caller.role === 'employee') {
      q = query(collection(firestoreDb!, path), where('linkedUid', '==', caller.uid));
    } else {
      return [];
    }

    const snap = await getDocs(q);
    let list = snap.docs.map((d) => d.data() as DutyRosterRecord);
    if (caller.role === 'employee') {
      list = list.filter((r) => r.status === 'Published');
    }
    return list.sort((a, b) => b.dutyDate.localeCompare(a.dutyDate));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createDutyRosterEntries(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: CreateDutyRosterInput
): Promise<DutyRosterRecord[]> {
  assertNotSitePortal(caller);

  if (caller.role !== 'admin') {
    if (caller.role !== 'hr' || !hasUserPermission(caller, 'roster.create')) {
      throw new Error('Creating Duty Rosters requires Admin access or roster.create permission.');
    }
    if (input.publishImmediately && !hasUserPermission(caller, 'roster.publish')) {
      throw new Error(
        'Publishing rosters immediately requires roster.publish permission. Save as Draft instead.'
      );
    }
    if (!getAuthorizedBranchIds(caller).includes(input.branchId)) {
      throw new Error('Unauthorized branch scope: HR can only create rosters in assigned branches.');
    }
  }

  const timingCheck = validateRosterTimings({
    dutyDate: input.dutyDate,
    dutyStartTime: input.dutyStartTime,
    dutyEndTime: input.dutyEndTime,
    reportingTime: input.reportingTime,
    breakDurationMinutes: input.breakDurationMinutes,
    gracePeriodMinutes: input.gracePeriodMinutes,
  });
  if (!timingCheck.valid) {
    throw new Error(timingCheck.error ?? 'Invalid roster timing configuration.');
  }

  const targetDates = buildRosterTargetDates({
    scheduleMode: input.scheduleMode,
    startDate: input.dutyDate,
    endDate: input.endDate,
    skipWeekdays: input.skipWeekdays,
  });
  if (targetDates.length === 0) {
    throw new Error('No valid duty dates remain in the selected schedule range.');
  }

  const [branches, clients, sites, services, designations, employee, allAssignments, siteServiceConfigs, existingRosters] =
    await Promise.all([
      listBranches(caller, isPreviewSession),
      listClients(caller, isPreviewSession),
      listSites(caller, isPreviewSession),
      listServices(caller, isPreviewSession),
      listDesignations(caller, isPreviewSession),
      getEmployeeById(caller, isPreviewSession, input.employeeId),
      listEmployeeAssignments(caller, isPreviewSession),
      listSiteServiceConfigs(caller, isPreviewSession, input.siteId),
      listDutyRosters(caller, isPreviewSession),
    ]);

  if (!employee) {
    throw new Error(`Employee ${input.employeeId} not found.`);
  }

  // 1. Validate Active Employee + Designation + Qualification/Training/License
  const eligibility = validateEmployeeEligibilityForAssignment(
    employee,
    input.designationId,
    input.serviceCategory,
    input.serviceId
  );
  if (!eligibility.valid) {
    throw new Error(eligibility.error ?? 'Employee is ineligible for the selected duty.');
  }

  const branch = branches.find((b) => b.branchId === input.branchId && !b.isDeleted);
  if (!branch) throw new Error('Selected Branch is missing or inactive.');

  const client = clients.find((c) => c.clientId === input.clientId && !c.isArchived);
  if (!client) throw new Error('Selected Client is missing or archived.');

  const site = sites.find((s) => s.siteId === input.siteId && !s.isArchived);
  if (!site) throw new Error('Selected Site is missing or archived.');
  if (site.siteStatus !== 'Active') {
    throw new Error(`Cannot schedule duty roster at inactive/suspended site "${site.siteName}".`);
  }

  const service = services.find((sv) => sv.serviceId === input.serviceId && sv.status === 'Active');
  if (!service) throw new Error('Selected Service is missing or inactive.');

  const designation = designations.find(
    (ds) => ds.designationId === input.designationId && ds.status === 'Active'
  );
  if (!designation) throw new Error('Selected Designation is missing or inactive.');

  // Match sanctioned site service configuration for capacity validation
  const matchedSiteService =
    siteServiceConfigs.find(
      (cfg) =>
        cfg.status === 'Active' &&
        (input.siteServiceId
          ? cfg.siteServiceId === input.siteServiceId
          : cfg.designationId === input.designationId && cfg.serviceId === input.serviceId)
    ) ?? null;

  const empAssignmentsForSite = allAssignments.filter(
    (a) =>
      a.employeeId === employee.employeeId &&
      a.siteId === site.siteId &&
      a.designationId === designation.designationId &&
      a.assignmentStatus !== 'Cancelled' &&
      a.assignmentStatus !== 'Transferred' &&
      a.assignmentStatus !== 'Completed'
  );

  if (empAssignmentsForSite.length === 0) {
    throw new Error(
      `Employee ${employee.fullName} (${employee.employeeId}) does not hold an active/upcoming Site Assignment for "${site.siteName}" as "${designation.designationName}". Assign the employee in Site Assignments first.`
    );
  }

  const nowIso = new Date().toISOString();
  const batchCode = `BCH-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  const allExistingRosterIds = !useLiveFirestore(isPreviewSession)
    ? readLocalAttendanceStore().dutyRosters.map((r) => r.rosterId)
    : existingRosters.map((r) => r.rosterId);

  const workingRosterPool = [...existingRosters];
  const createdRecords: DutyRosterRecord[] = [];
  const notificationsToSend: EmployeeNotificationRecord[] = [];

  for (const targetDate of targetDates) {
    // 2. Verify assignment covers targetDate
    const validAssignmentOnDate: EmployeeAssignmentRecord | undefined = empAssignmentsForSite.find(
      (a) => {
        const end = a.endDate?.trim() || '9999-12-31';
        return a.startDate <= targetDate && targetDate <= end;
      }
    );

    if (!validAssignmentOnDate) {
      throw new Error(
        `Employee ${employee.fullName} does not have a valid site assignment covering ${targetDate} at "${site.siteName}".`
      );
    }

    // 3. Detect overlapping shifts (including overnight midnight-crossing spillovers)
    const conflict = detectDutyRosterConflict(
      {
        employeeId: employee.employeeId,
        dutyDate: targetDate,
        dutyStartTime: input.dutyStartTime,
        dutyEndTime: input.dutyEndTime,
      },
      workingRosterPool
    );
    if (conflict.hasConflict) {
      throw new Error(conflict.reason ?? `Overlapping duty conflict detected on ${targetDate}.`);
    }

    // 4. Enforce Sanctioned Post Capacity (`siteServices.requiredCount`)
    if (matchedSiteService) {
      const samePostCountOnDate = workingRosterPool.filter(
        (r) =>
          r.status !== 'Cancelled' &&
          r.siteId === site.siteId &&
          r.designationId === designation.designationId &&
          r.dutyDate === targetDate
      ).length;

      if (samePostCountOnDate + 1 > matchedSiteService.requiredCount) {
        const canAuthorizeException =
          Boolean(input.authorizedCapacityException) &&
          (caller.role === 'admin' || hasUserPermission(caller, 'attendance.approve'));

        if (!canAuthorizeException) {
          throw new Error(
            `Sanctioned post capacity exceeded on ${targetDate} for "${designation.designationName}" at "${site.siteName}" (${samePostCountOnDate}/${matchedSiteService.requiredCount} scheduled). Authorized exception requires Admin or attendance.approve permission.`
          );
        }
        if (!input.capacityExceptionReason || input.capacityExceptionReason.trim().length < 6) {
          throw new Error(
            'Provide a Capacity Exception Reason (at least 6 characters) to exceed sanctioned post count.'
          );
        }
      }
    }

    const shiftMeta = computeRosterShiftMetrics(
      targetDate,
      input.dutyStartTime,
      input.dutyEndTime,
      input.breakDurationMinutes
    );

    const nextId = generateSequentialId('RST', allExistingRosterIds);
    allExistingRosterIds.push(nextId);

    const status = input.publishImmediately ? 'Published' : 'Draft';

    const record: DutyRosterRecord = {
      rosterId: nextId,
      scheduleMode: input.scheduleMode,
      batchCode,
      branchId: branch.branchId,
      branchName: branch.branchName,
      clientId: client.clientId,
      clientName: client.companyName,
      siteId: site.siteId,
      siteName: site.siteName,
      siteServiceId: matchedSiteService?.siteServiceId || '',
      serviceCategory: input.serviceCategory,
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      designationId: designation.designationId,
      designationName: designation.designationName,
      employeeId: employee.employeeId,
      employeeName: employee.fullName,
      linkedUid: employee.linkedUid || '',
      assignmentId: validAssignmentOnDate.assignmentId,
      dutyDate: targetDate,
      dutyEndDate: shiftMeta.dutyEndDate,
      shiftType: input.shiftType,
      dutyStartTime: input.dutyStartTime,
      dutyEndTime: input.dutyEndTime,
      crossesMidnight: shiftMeta.crossesMidnight,
      breakDurationMinutes: Math.round(input.breakDurationMinutes || 0),
      grossDurationMinutes: shiftMeta.grossDurationMinutes,
      netScheduledMinutes: shiftMeta.netScheduledMinutes,
      reportingTime: input.reportingTime,
      gracePeriodMinutes: Math.round(input.gracePeriodMinutes || 0),
      assignedFieldOfficerUid: sanitizeInput(input.assignedFieldOfficerUid || '', 128),
      assignedFieldOfficerName: sanitizeInput(input.assignedFieldOfficerName || '', 120),
      dutyInstructions: sanitizeInput(input.dutyInstructions || '', 350),
      status,
      authorizedCapacityException: Boolean(input.authorizedCapacityException),
      capacityExceptionReason: sanitizeInput(input.capacityExceptionReason || '', 250),
      publishedAt: input.publishImmediately ? nowIso : null,
      publishedBy: input.publishImmediately ? `${caller.fullName} (${caller.role})` : null,
      createdBy: caller.uid,
      updatedBy: caller.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    createdRecords.push(record);
    workingRosterPool.push(record);

    if (input.publishImmediately) {
      notificationsToSend.push(
        buildEmployeeNotificationEntry({
          employeeId: employee.employeeId,
          linkedUid: employee.linkedUid || '',
          branchId: branch.branchId,
          siteId: site.siteId,
          siteName: site.siteName,
          category: 'Roster Published',
          title: `Duty Roster Published — ${targetDate}`,
          message: `${record.shiftType} (${record.dutyStartTime}–${record.dutyEndTime}${record.crossesMidnight ? ' next day' : ''}) at ${site.siteName} as ${designation.designationName}. Report at ${record.reportingTime}.`,
          dutyDate: targetDate,
          createdAt: nowIso,
        })
      );
    }
  }

  const auditRecord = buildAttendanceAuditEntry(caller, {
    category: 'Roster',
    targetId: createdRecords[0].rosterId,
    employeeId: employee.employeeId,
    siteId: site.siteId,
    branchId: branch.branchId,
    action: input.publishImmediately ? 'Duty Roster Created & Published' : 'Draft Duty Roster Created',
    newValueSummary: `${createdRecords.length} ${input.scheduleMode} shift(s) for ${employee.fullName} (${employee.employeeId}) at ${site.siteName} [${input.shiftType}: ${input.dutyStartTime}–${input.dutyEndTime}]`,
    reason: input.capacityExceptionReason || '',
    timestamp: nowIso,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.dutyRosters.unshift(...createdRecords);
    if (notificationsToSend.length > 0) {
      store.employeeNotifications.unshift(...notificationsToSend);
    }
    store.attendanceAuditLogs.unshift(auditRecord);
    writeLocalAttendanceStore(store);

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: auditRecord.action,
      module: 'Roster',
      recordId: createdRecords[0].rosterId,
      branchId: branch.branchId,
      summary: auditRecord.newValueSummary,
    });

    if (input.publishImmediately) {
      for (const r of createdRecords.slice(0, 7)) {
        await rebuildSanitizedSiteAttendanceSummary(caller, isPreviewSession, r.siteId, r.dutyDate);
      }
    }
    return createdRecords;
  }

  const path = 'dutyRosters';
  try {
    const batch = writeBatch(firestoreDb!);
    for (const r of createdRecords) {
      batch.set(doc(firestoreDb!, 'dutyRosters', r.rosterId), {
        ...r,
        serverUpdatedAt: serverTimestamp(),
      });
    }
    for (const n of notificationsToSend) {
      batch.set(doc(firestoreDb!, 'employeeNotifications', n.notificationId), {
        ...n,
        serverCreatedAt: serverTimestamp(),
      });
    }
    batch.set(doc(firestoreDb!, 'attendanceAuditLogs', auditRecord.auditId), {
      ...auditRecord,
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: auditRecord.action,
      module: 'Roster',
      recordId: createdRecords[0].rosterId,
      branchId: branch.branchId,
      summary: auditRecord.newValueSummary,
    });

    if (input.publishImmediately) {
      for (const r of createdRecords.slice(0, 7)) {
        await rebuildSanitizedSiteAttendanceSummary(caller, isPreviewSession, r.siteId, r.dutyDate);
      }
    }

    notifyAttendanceListeners();
    return createdRecords;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateDutyRosterEntry(
  caller: RexonUser,
  isPreviewSession: boolean,
  rosterId: string,
  input: UpdateDutyRosterInput
): Promise<DutyRosterRecord> {
  assertNotSitePortal(caller);

  if (caller.role !== 'admin') {
    if (caller.role !== 'hr' || !hasUserPermission(caller, 'roster.edit')) {
      throw new Error('Editing Duty Rosters requires Admin access or roster.edit permission.');
    }
  }

  const allRosters = await listDutyRosters(caller, isPreviewSession);
  const existing = allRosters.find((r) => r.rosterId === rosterId);
  if (!existing) {
    throw new Error(`Duty Roster ${rosterId} not found.`);
  }

  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(existing.branchId)) {
    throw new Error('Unauthorized branch scope for editing this roster.');
  }

  if (
    existing.status !== 'Published' &&
    input.status === 'Published' &&
    caller.role !== 'admin' &&
    !hasUserPermission(caller, 'roster.publish')
  ) {
    throw new Error('Publishing a Draft roster requires roster.publish permission.');
  }

  if (existing.status === 'Published') {
    if (!input.editReason || input.editReason.trim().length < 5) {
      throw new Error(
        'Modifying an already Published duty roster requires an Audit Reason (minimum 5 characters).'
      );
    }
  }

  const timingCheck = validateRosterTimings({
    dutyDate: existing.dutyDate,
    dutyStartTime: input.dutyStartTime,
    dutyEndTime: input.dutyEndTime,
    reportingTime: input.reportingTime,
    breakDurationMinutes: input.breakDurationMinutes,
    gracePeriodMinutes: input.gracePeriodMinutes,
  });
  if (!timingCheck.valid) {
    throw new Error(timingCheck.error ?? 'Invalid roster timing configuration.');
  }

  if (input.status !== 'Cancelled') {
    const conflict = detectDutyRosterConflict(
      {
        employeeId: existing.employeeId,
        dutyDate: existing.dutyDate,
        dutyStartTime: input.dutyStartTime,
        dutyEndTime: input.dutyEndTime,
      },
      allRosters,
      [rosterId]
    );
    if (conflict.hasConflict) {
      throw new Error(conflict.reason ?? 'Overlapping shift conflict detected.');
    }
  }

  const shiftMeta = computeRosterShiftMetrics(
    existing.dutyDate,
    input.dutyStartTime,
    input.dutyEndTime,
    input.breakDurationMinutes
  );
  const nowIso = new Date().toISOString();

  const updated: DutyRosterRecord = {
    ...existing,
    shiftType: input.shiftType,
    dutyStartTime: input.dutyStartTime,
    dutyEndTime: input.dutyEndTime,
    crossesMidnight: shiftMeta.crossesMidnight,
    dutyEndDate: shiftMeta.dutyEndDate,
    breakDurationMinutes: Math.round(input.breakDurationMinutes || 0),
    grossDurationMinutes: shiftMeta.grossDurationMinutes,
    netScheduledMinutes: shiftMeta.netScheduledMinutes,
    reportingTime: input.reportingTime,
    gracePeriodMinutes: Math.round(input.gracePeriodMinutes || 0),
    assignedFieldOfficerUid: sanitizeInput(input.assignedFieldOfficerUid || '', 128),
    assignedFieldOfficerName: sanitizeInput(input.assignedFieldOfficerName || '', 120),
    dutyInstructions: sanitizeInput(input.dutyInstructions || '', 350),
    status: input.status,
    publishedAt:
      input.status === 'Published' && !existing.publishedAt ? nowIso : existing.publishedAt,
    publishedBy:
      input.status === 'Published' && !existing.publishedBy
        ? `${caller.fullName} (${caller.role})`
        : existing.publishedBy,
    updatedBy: caller.uid,
    updatedAt: nowIso,
  };

  const wasPublished = existing.status === 'Published';
  const becamePublished = !wasPublished && updated.status === 'Published';

  const auditEntry = buildAttendanceAuditEntry(caller, {
    category: 'Roster',
    targetId: rosterId,
    employeeId: existing.employeeId,
    siteId: existing.siteId,
    branchId: existing.branchId,
    action: wasPublished ? 'Published Duty Roster Modified' : 'Duty Roster Updated',
    previousValueSummary: `${existing.status} · ${existing.shiftType} (${existing.dutyStartTime}–${existing.dutyEndTime})`,
    newValueSummary: `${updated.status} · ${updated.shiftType} (${updated.dutyStartTime}–${updated.dutyEndTime})`,
    reason: input.editReason || 'Roster schedule update',
    timestamp: nowIso,
  });

  const notif =
    wasPublished || becamePublished
      ? buildEmployeeNotificationEntry({
          employeeId: updated.employeeId,
          linkedUid: updated.linkedUid,
          branchId: updated.branchId,
          siteId: updated.siteId,
          siteName: updated.siteName,
          category: becamePublished ? 'Roster Published' : 'Roster Updated',
          title: becamePublished
            ? `Duty Roster Published — ${updated.dutyDate}`
            : `Published Duty Updated — ${updated.dutyDate}`,
          message: `${updated.shiftType} (${updated.dutyStartTime}–${updated.dutyEndTime}${updated.crossesMidnight ? ' next day' : ''}) at ${updated.siteName} [${updated.status}].`,
          dutyDate: updated.dutyDate,
          createdAt: nowIso,
        })
      : null;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.dutyRosters = store.dutyRosters.map((r) => (r.rosterId === rosterId ? updated : r));
    store.attendanceAuditLogs.unshift(auditEntry);
    if (notif) {
      store.employeeNotifications.unshift(notif);
    }
    writeLocalAttendanceStore(store);

    if (wasPublished || becamePublished) {
      await recordExternalMasterAudit(caller, isPreviewSession, {
        action: auditEntry.action,
        module: 'Roster',
        recordId: rosterId,
        branchId: updated.branchId,
        summary: `${auditEntry.newValueSummary}. Reason: ${auditEntry.reason}`,
      });
      await rebuildSanitizedSiteAttendanceSummary(
        caller,
        isPreviewSession,
        updated.siteId,
        updated.dutyDate
      );
    }
    return updated;
  }

  const path = `dutyRosters/${rosterId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'dutyRosters', rosterId), {
      ...updated,
      serverUpdatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'attendanceAuditLogs', auditEntry.auditId), {
      ...auditEntry,
      createdAt: serverTimestamp(),
    });
    if (notif) {
      batch.set(doc(firestoreDb!, 'employeeNotifications', notif.notificationId), {
        ...notif,
        serverCreatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    if (wasPublished || becamePublished) {
      await recordExternalMasterAudit(caller, isPreviewSession, {
        action: auditEntry.action,
        module: 'Roster',
        recordId: rosterId,
        branchId: updated.branchId,
        summary: `${auditEntry.newValueSummary}. Reason: ${auditEntry.reason}`,
      });
      await rebuildSanitizedSiteAttendanceSummary(
        caller,
        isPreviewSession,
        updated.siteId,
        updated.dutyDate
      );
    }

    notifyAttendanceListeners();
    return updated;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function publishDutyRosters(
  caller: RexonUser,
  isPreviewSession: boolean,
  rosterIds: string[]
): Promise<number> {
  assertNotSitePortal(caller);

  if (caller.role !== 'admin') {
    if (caller.role !== 'hr' || !hasUserPermission(caller, 'roster.publish')) {
      throw new Error('Publishing Duty Rosters requires Admin access or roster.publish permission.');
    }
  }

  const allRosters = await listDutyRosters(caller, isPreviewSession);
  const targets = allRosters.filter(
    (r) => rosterIds.includes(r.rosterId) && r.status === 'Draft'
  );
  if (targets.length === 0) return 0;

  const nowIso = new Date().toISOString();
  const notifications: EmployeeNotificationRecord[] = [];
  const audits: AttendanceAuditRecord[] = [];

  for (const r of targets) {
    if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(r.branchId)) {
      throw new Error(`Unauthorized branch scope for roster ${r.rosterId}.`);
    }

    notifications.push(
      buildEmployeeNotificationEntry({
        employeeId: r.employeeId,
        linkedUid: r.linkedUid,
        branchId: r.branchId,
        siteId: r.siteId,
        siteName: r.siteName,
        category: 'Roster Published',
        title: `Duty Roster Published — ${r.dutyDate}`,
        message: `${r.shiftType} (${r.dutyStartTime}–${r.dutyEndTime}${r.crossesMidnight ? ' next day' : ''}) at ${r.siteName} as ${r.designationName}. Report at ${r.reportingTime}.`,
        dutyDate: r.dutyDate,
        createdAt: nowIso,
      })
    );

    audits.push(
      buildAttendanceAuditEntry(caller, {
        category: 'Roster',
        targetId: r.rosterId,
        employeeId: r.employeeId,
        siteId: r.siteId,
        branchId: r.branchId,
        action: 'Duty Roster Published',
        previousValueSummary: 'Draft',
        newValueSummary: `Published (${r.dutyDate} · ${r.shiftType})`,
        timestamp: nowIso,
      })
    );
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    const idSet = new Set(targets.map((t) => t.rosterId));
    store.dutyRosters = store.dutyRosters.map((r) =>
      idSet.has(r.rosterId)
        ? {
            ...r,
            status: 'Published',
            publishedAt: nowIso,
            publishedBy: `${caller.fullName} (${caller.role})`,
            updatedBy: caller.uid,
            updatedAt: nowIso,
          }
        : r
    );
    store.employeeNotifications.unshift(...notifications);
    store.attendanceAuditLogs.unshift(...audits);
    writeLocalAttendanceStore(store);

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Duty Rosters Published',
      module: 'Roster',
      recordId: targets[0].rosterId,
      branchId: targets[0].branchId,
      summary: `Published ${targets.length} duty roster(s) and dispatched workforce notifications.`,
    });

    for (const r of targets.slice(0, 7)) {
      await rebuildSanitizedSiteAttendanceSummary(caller, isPreviewSession, r.siteId, r.dutyDate);
    }
    return targets.length;
  }

  const path = 'dutyRosters';
  try {
    const batch = writeBatch(firestoreDb!);
    for (const r of targets) {
      batch.update(doc(firestoreDb!, 'dutyRosters', r.rosterId), {
        status: 'Published',
        publishedAt: nowIso,
        publishedBy: `${caller.fullName} (${caller.role})`,
        updatedBy: caller.uid,
        updatedAt: nowIso,
        serverUpdatedAt: serverTimestamp(),
      });
    }
    for (const n of notifications) {
      batch.set(doc(firestoreDb!, 'employeeNotifications', n.notificationId), {
        ...n,
        serverCreatedAt: serverTimestamp(),
      });
    }
    for (const a of audits) {
      batch.set(doc(firestoreDb!, 'attendanceAuditLogs', a.auditId), {
        ...a,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: 'Duty Rosters Published',
      module: 'Roster',
      recordId: targets[0].rosterId,
      branchId: targets[0].branchId,
      summary: `Published ${targets.length} duty roster(s) and dispatched workforce notifications.`,
    });

    for (const r of targets.slice(0, 7)) {
      await rebuildSanitizedSiteAttendanceSummary(caller, isPreviewSession, r.siteId, r.dutyDate);
    }

    notifyAttendanceListeners();
    return targets.length;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function cancelDutyRosterEntry(
  caller: RexonUser,
  isPreviewSession: boolean,
  rosterId: string,
  reason: string
): Promise<void> {
  assertNotSitePortal(caller);
  if (caller.role !== 'admin') {
    if (caller.role !== 'hr' || !hasUserPermission(caller, 'roster.delete')) {
      throw new Error('Cancelling/deleting Duty Rosters requires Admin access or roster.delete permission.');
    }
  }
  if (!reason || reason.trim().length < 5) {
    throw new Error('Enter a cancellation reason (at least 5 characters) for audit traceability.');
  }

  const allRosters = await listDutyRosters(caller, isPreviewSession);
  const target = allRosters.find((r) => r.rosterId === rosterId);
  if (!target) throw new Error(`Duty Roster ${rosterId} not found.`);

  await updateDutyRosterEntry(caller, isPreviewSession, rosterId, {
    shiftType: target.shiftType,
    dutyStartTime: target.dutyStartTime,
    dutyEndTime: target.dutyEndTime,
    breakDurationMinutes: target.breakDurationMinutes,
    reportingTime: target.reportingTime,
    gracePeriodMinutes: target.gracePeriodMinutes,
    assignedFieldOfficerUid: target.assignedFieldOfficerUid,
    assignedFieldOfficerName: target.assignedFieldOfficerName,
    dutyInstructions: target.dutyInstructions,
    status: 'Cancelled',
    editReason: reason.trim(),
  });
}

// ============================================================================
// 3. ROTATING / TIME-LIMITED SITE SHIFT QR SESSIONS (`attendanceQrSessions`)
// ============================================================================
export async function generateRotatingSiteQrSession(
  caller: RexonUser,
  isPreviewSession: boolean,
  params: {
    siteId: string;
    attendanceDate: string;
    shiftType: string;
    scheduledStartTime: string;
    scheduledEndTime: string;
    ttlSeconds?: number;
  }
): Promise<SiteQrSessionRecord> {
  assertNotSitePortal(caller);

  if (caller.role === 'employee') {
    throw new Error('Unauthorized: Employees cannot generate site QR attendance codes.');
  }
  if (caller.role === 'hr' && !hasUserPermission(caller, 'attendance.qr_manage')) {
    throw new Error('Generating Site QR sessions requires attendance.qr_manage permission.');
  }
  if (caller.role === 'field_officer' && !caller.assignedSiteIds.includes(params.siteId)) {
    throw new Error('Field Officers can only generate shift QR codes for their assigned sites.');
  }

  const site = await getSiteByIdForAttendance(params.siteId, isPreviewSession);
  if (!site) throw new Error(`Site ${params.siteId} not found.`);
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(site.branchId)) {
    throw new Error('Unauthorized branch scope for generating site QR codes.');
  }

  const geoSettings = resolveSiteGeoSettings(site);
  if (!geoSettings.isQrEnabled) {
    throw new Error(
      `QR Attendance is currently disabled for site "${site.siteName}". Enable QR in Site Geofence & QR Settings first.`
    );
  }

  const clampedTtl = Math.min(900, Math.max(60, Math.round(params.ttlSeconds || 300)));
  let sessionId = '';
  let signedToken = '';
  let verificationCode = '';
  let issuedAt = new Date().toISOString();
  let expiresAt = new Date(Date.now() + clampedTtl * 1000).toISOString();

  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const resp = await fetch('/api/attendance/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.siteId,
          branchId: site.branchId,
          attendanceDate: params.attendanceDate,
          shiftType: params.shiftType,
          scheduledStartTime: params.scheduledStartTime,
          scheduledEndTime: params.scheduledEndTime,
          ttlSeconds: clampedTtl,
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          sessionId: string;
          signedToken: string;
          verificationCode: string;
          issuedAt: string;
          expiresAt: string;
        };
        sessionId = data.sessionId;
        signedToken = data.signedToken;
        verificationCode = data.verificationCode;
        issuedAt = data.issuedAt;
        expiresAt = data.expiresAt;
      }
    } catch {
      // Fallback below
    }
  }

  if (!signedToken) {
    const issuedMs = Date.now();
    const expMs = issuedMs + clampedTtl * 1000;
    const nonce = Math.random().toString(36).slice(2, 8).toUpperCase();
    sessionId = `QRS-${new Date().getFullYear()}-${nonce}`;
    verificationCode = `${site.siteId.replace(/[^A-Z0-9]/gi, '').slice(-3).toUpperCase()}-${nonce.slice(0, 5)}`;
    issuedAt = new Date(issuedMs).toISOString();
    expiresAt = new Date(expMs).toISOString();
    signedToken = encodeLocalFallbackQrToken({
      sid: sessionId,
      site: site.siteId,
      brn: site.branchId,
      dt: params.attendanceDate,
      shf: params.shiftType,
      st: params.scheduledStartTime,
      et: params.scheduledEndTime,
      iat: issuedMs,
      exp: expMs,
      n: nonce,
    });
  }

  const sessionRecord: SiteQrSessionRecord = {
    sessionId,
    siteId: site.siteId,
    siteName: site.siteName,
    clientId: site.clientId,
    branchId: site.branchId,
    attendanceDate: params.attendanceDate,
    shiftType: params.shiftType,
    scheduledStartTime: params.scheduledStartTime,
    scheduledEndTime: params.scheduledEndTime,
    signedToken,
    verificationCode,
    issuedAt,
    expiresAt,
    ttlSeconds: clampedTtl,
    isActive: true,
    generatedByUid: caller.uid,
    generatedByName: caller.fullName,
    generatedByRole: caller.role,
    scanCount: 0,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };

  const auditEntry = buildAttendanceAuditEntry(caller, {
    category: 'QR',
    targetId: sessionId,
    siteId: site.siteId,
    branchId: site.branchId,
    action: 'Rotating Site Shift QR Generated',
    newValueSummary: `Site ${site.siteName} (${params.attendanceDate} · ${params.shiftType}) · Code ${verificationCode} · Expires ${expiresAt}`,
    timestamp: issuedAt,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.attendanceQrSessions = store.attendanceQrSessions.map((q) =>
      q.siteId === site.siteId &&
      q.attendanceDate === params.attendanceDate &&
      q.shiftType === params.shiftType
        ? { ...q, isActive: false }
        : q
    );
    store.attendanceQrSessions.unshift(sessionRecord);
    store.attendanceAuditLogs.unshift(auditEntry);
    writeLocalAttendanceStore(store);
    return sessionRecord;
  }

  const path = `attendanceQrSessions/${sessionId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'attendanceQrSessions', sessionId), {
      ...sessionRecord,
      serverCreatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'attendanceAuditLogs', auditEntry.auditId), {
      ...auditEntry,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyAttendanceListeners();
    return sessionRecord;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function listActiveSiteQrSessions(
  caller: RexonUser,
  isPreviewSession: boolean,
  siteId?: string
): Promise<SiteQrSessionRecord[]> {
  assertNotSitePortal(caller);
  if (caller.role === 'employee') return [];

  const nowIso = new Date().toISOString();

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    return store.attendanceQrSessions.filter((s) => {
      if (siteId && s.siteId !== siteId) return false;
      if (caller.role === 'field_officer' && !caller.assignedSiteIds.includes(s.siteId)) {
        return false;
      }
      if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(s.branchId)) {
        return false;
      }
      return s.isActive && s.expiresAt > nowIso;
    });
  }

  const path = 'attendanceQrSessions';
  try {
    const q = siteId
      ? query(collection(firestoreDb!, path), where('siteId', '==', siteId))
      : query(collection(firestoreDb!, path));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as SiteQrSessionRecord)
      .filter((s) => s.isActive && s.expiresAt > nowIso);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

async function verifyQrTokenForPunch(params: {
  tokenOrCode: string;
  expectedSiteId: string;
  expectedBranchId?: string;
  expectedShiftType: string;
  expectedDate: string;
  allowedDates?: string[];
  employeeId: string;
  actionType: 'check_in' | 'check_out';
  isPreviewSession: boolean;
}): Promise<{ sessionId: string }> {
  const cleaned = params.tokenOrCode.trim();
  if (!cleaned) {
    throw new Error('Scan or enter the active Site Shift QR code before submitting.');
  }

  const validDates =
    params.allowedDates && params.allowedDates.length > 0
      ? params.allowedDates
      : [params.expectedDate];

  // 1. Check backend HMAC endpoint if token was signed by backend (`rxqr1.`) or in live browser
  if (
    cleaned.startsWith('rxqr1.') &&
    typeof window !== 'undefined' &&
    typeof fetch === 'function'
  ) {
    const resp = await fetch('/api/attendance/qr/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenOrCode: cleaned,
        expectedSiteId: params.expectedSiteId,
        expectedShiftType: params.expectedShiftType,
        expectedDate: params.expectedDate,
        allowedDates: validDates,
        employeeId: params.employeeId,
        actionType: params.actionType,
      }),
    });
    const body = (await resp.json()) as {
      verified?: boolean;
      sessionId?: string;
      error?: string;
    };
    if (!resp.ok || !body.verified) {
      throw new Error(body.error || 'QR verification failed.');
    }
    return { sessionId: body.sessionId || '' };
  }

  // 2. Verify against stored `attendanceQrSessions` or local signed payload
  const nowMs = Date.now();
  let matchedSession: SiteQrSessionRecord | null = null;

  if (!useLiveFirestore(params.isPreviewSession)) {
    const store = readLocalAttendanceStore();
    matchedSession =
      store.attendanceQrSessions.find(
        (s) =>
          s.signedToken === cleaned ||
          s.verificationCode.toUpperCase() === cleaned.toUpperCase()
      ) ?? null;
  } else {
    const q = params.expectedBranchId
      ? query(
          collection(firestoreDb!, 'attendanceQrSessions'),
          where('siteId', '==', params.expectedSiteId),
          where('branchId', '==', params.expectedBranchId)
        )
      : query(
          collection(firestoreDb!, 'attendanceQrSessions'),
          where('siteId', '==', params.expectedSiteId)
        );
    const snap = await getDocs(q);
    const sessions = snap.docs.map((d) => d.data() as SiteQrSessionRecord);
    matchedSession =
      sessions.find(
        (s) =>
          s.signedToken === cleaned ||
          s.verificationCode.toUpperCase() === cleaned.toUpperCase()
      ) ?? null;
  }

  if (matchedSession) {
    if (!matchedSession.isActive) {
      throw new Error(
        'This QR code has been superseded by a newer rotated shift QR code. Scan the latest QR.'
      );
    }
    if (new Date(matchedSession.expiresAt).getTime() < nowMs) {
      throw new Error(
        'This site QR code has expired. Request or scan the newly rotated shift QR code.'
      );
    }
    if (matchedSession.siteId !== params.expectedSiteId) {
      throw new Error(
        `QR site mismatch: scanned QR belongs to site ${matchedSession.siteName} (${matchedSession.siteId}), not your assigned site.`
      );
    }
    if (!validDates.includes(matchedSession.attendanceDate)) {
      throw new Error(
        `QR date mismatch: scanned QR is dated ${matchedSession.attendanceDate}, expected ${validDates.join(' or ')}.`
      );
    }
    if (matchedSession.shiftType !== params.expectedShiftType) {
      throw new Error(
        `QR shift mismatch: scanned QR is for "${matchedSession.shiftType}", not "${params.expectedShiftType}".`
      );
    }
    return { sessionId: matchedSession.sessionId };
  }

  // Check local signed token structure if passed directly in test environment
  if (cleaned.startsWith('rxqrloc.')) {
    const payload = decodeLocalFallbackQrToken(cleaned);
    if (!payload) {
      throw new Error('Invalid or tampered QR token signature.');
    }
    if (Number(payload.exp || 0) < nowMs) {
      throw new Error('This site QR code has expired.');
    }
    if (String(payload.site) !== params.expectedSiteId) {
      throw new Error('QR site mismatch: scanned QR belongs to a different site.');
    }
    if (!validDates.includes(String(payload.dt))) {
      throw new Error('QR duty date mismatch.');
    }
    if (String(payload.shf) !== params.expectedShiftType) {
      throw new Error('QR shift mismatch.');
    }
    return { sessionId: String(payload.sid || '') };
  }

  throw new Error('Invalid, unrecognized, or rotated QR verification code.');
}

// ============================================================================
// 4. EMPLOYEE ATTENDANCE CONTEXT, CHECK-IN & CHECK-OUT (`attendance`)
// ============================================================================
export async function listAttendanceRecords(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<AttendanceRecord[]> {
  assertNotSitePortal(caller);

  if (caller.role === 'hr' && !hasUserPermission(caller, 'attendance.view')) {
    return [];
  }

  let ownEmp: EmployeeRecord | null = null;
  if (caller.role === 'employee') {
    ownEmp = await getOwnEmployeeRecord(caller, isPreviewSession);
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    let list = [...store.attendance];

    if (caller.role === 'hr') {
      list = list.filter((a) => canCallerAccessBranchForAttendance(caller, a.branchId));
    } else if (caller.role === 'field_officer') {
      list = list.filter((a) => caller.assignedSiteIds.includes(a.siteId));
    } else if (caller.role === 'employee') {
      list = list.filter(
        (a) =>
          a.linkedUid === caller.uid ||
          a.employeeUid === caller.uid ||
          (ownEmp && a.employeeId === ownEmp.employeeId)
      );
    }

    return list.sort((a, b) => {
      const d = b.attendanceDate.localeCompare(a.attendanceDate);
      if (d !== 0) return d;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }

  const path = 'attendance';
  try {
    let q;
    if (caller.role === 'admin' || (caller.role === 'hr' && hasUserPermission(caller, 'attendance.view_all_branch'))) {
      q = query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      const branches = getAuthorizedBranchIds(caller);
      if (branches.length === 0) return [];
      q = query(collection(firestoreDb!, path), where('branchId', 'in', branches.slice(0, 10)));
    } else if (caller.role === 'field_officer') {
      if (!caller.assignedSiteIds || caller.assignedSiteIds.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('siteId', 'in', caller.assignedSiteIds.slice(0, 10))
      );
    } else if (caller.role === 'employee') {
      q = query(collection(firestoreDb!, path), where('employeeUid', '==', caller.uid));
    } else {
      return [];
    }

    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as AttendanceRecord)
      .sort((a, b) => (b.attendanceDate || '').localeCompare(a.attendanceDate || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function getEmployeeTodayDutyContext(
  caller: RexonUser,
  isPreviewSession: boolean,
  targetDate?: string
): Promise<EmployeeTodayDutyContext> {
  if (caller.role !== 'employee') {
    throw new Error('getEmployeeTodayDutyContext is strictly for Employee Portal accounts.');
  }

  const today = targetDate && isValidIsoDate(targetDate) ? targetDate : getTodayIsoDate();
  const yesterday = addDaysToIsoDate(today, -1);

  const [emp, rosters, assignments, myAttendance, notifications] = await Promise.all([
    getOwnEmployeeRecord(caller, isPreviewSession),
    listDutyRosters(caller, isPreviewSession),
    listEmployeeAssignments(caller, isPreviewSession),
    listAttendanceRecords(caller, isPreviewSession),
    listEmployeeNotifications(caller, isPreviewSession),
  ]);

  if (!emp) {
    return {
      employee: null,
      activeRoster: null,
      fallbackAssignment: null,
      siteGeoConfig: null,
      todayAttendance: null,
      openOvernightAttendance: null,
      unreadNotificationsCount: notifications.filter((n) => !n.isRead).length,
    };
  }

  // Check if employee has an open overnight attendance shift started yesterday
  const openOvernightAttendance =
    myAttendance.find(
      (a) =>
        a.attendanceDate === yesterday &&
        a.crossesMidnight &&
        Boolean(a.checkInAt) &&
        !a.checkOutAt
    ) ?? null;

  const activeRoster =
    rosters.find((r) => r.dutyDate === today && r.status === 'Published') ?? null;

  const matchedAssignment =
    assignments.find((a) => isAssignmentActiveOnDate(a, today)) ?? null;

  const resolvedSiteId =
    openOvernightAttendance?.siteId ||
    activeRoster?.siteId ||
    matchedAssignment?.siteId ||
    '';

  let siteGeoConfig: EmployeeTodayDutyContext['siteGeoConfig'] = null;
  if (resolvedSiteId) {
    const site = await getSiteByIdForAttendance(resolvedSiteId, isPreviewSession);
    if (site) {
      const geo = resolveSiteGeoSettings(site);
      siteGeoConfig = {
        siteId: site.siteId,
        siteName: site.siteName,
        ...geo,
      };
    }
  }

  const todayAttendance =
    myAttendance.find(
      (a) =>
        a.attendanceDate === today &&
        (!activeRoster || a.rosterId === activeRoster.rosterId || a.siteId === activeRoster.siteId)
    ) ?? null;

  return {
    employee: {
      employeeId: emp.employeeId,
      fullName: emp.fullName,
      branchId: emp.branchId,
      branchName: emp.branchName,
      employeeStatus: emp.employeeStatus,
    },
    activeRoster,
    fallbackAssignment: matchedAssignment
      ? {
          assignmentId: matchedAssignment.assignmentId,
          branchId: matchedAssignment.branchId,
          branchName: matchedAssignment.branchName,
          clientId: matchedAssignment.clientId,
          clientName: matchedAssignment.clientName,
          siteId: matchedAssignment.siteId,
          siteName: matchedAssignment.siteName,
          serviceCategory: matchedAssignment.serviceCategory,
          serviceId: matchedAssignment.serviceId,
          serviceName: matchedAssignment.serviceName,
          designationId: matchedAssignment.designationId,
          designationName: matchedAssignment.designationName,
          shift: matchedAssignment.shift,
          shiftStartTime: matchedAssignment.shiftStartTime,
          shiftEndTime: matchedAssignment.shiftEndTime,
          reportingTime: matchedAssignment.reportingTime,
          dutyHours: matchedAssignment.dutyHours,
          weeklyOff: matchedAssignment.weeklyOff,
          reportingInstructions: matchedAssignment.reportingInstructions,
        }
      : null,
    siteGeoConfig,
    todayAttendance,
    openOvernightAttendance,
    unreadNotificationsCount: notifications.filter((n) => !n.isRead).length,
  };
}

export async function submitEmployeeCheckIn(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: EmployeeCheckInInput,
  overrideNowIso?: string
): Promise<AttendanceRecord> {
  if (caller.role !== 'employee') {
    throw new Error('Only Employee Portal accounts can perform personal shift Check-In.');
  }

  const emp = await getOwnEmployeeRecord(caller, isPreviewSession);
  if (!emp) {
    throw new Error(
      'Your Employee Portal login is not linked to an active Employee master record. Contact Branch HR.'
    );
  }
  if (emp.isDeleted || !emp.isActive || emp.employeeStatus !== 'Active') {
    throw new Error(
      `Check-In blocked: Employee status is "${emp.employeeStatus}". Only Active employees can check in.`
    );
  }

  const attendanceDate =
    input.attendanceDate && isValidIsoDate(input.attendanceDate)
      ? input.attendanceDate
      : getTodayIsoDate();

  const [myRosters, myAssignments, existingAttendance, site] = await Promise.all([
    listDutyRosters(caller, isPreviewSession),
    listEmployeeAssignments(caller, isPreviewSession),
    listAttendanceRecords(caller, isPreviewSession),
    getSiteByIdForAttendance(input.siteId, isPreviewSession),
  ]);

  if (!site || site.siteStatus !== 'Active') {
    throw new Error('Check-In blocked: Selected deployment site is missing or inactive.');
  }

  const matchedRoster =
    myRosters.find(
      (r) =>
        r.status === 'Published' &&
        r.dutyDate === attendanceDate &&
        r.siteId === input.siteId &&
        (!input.rosterId || r.rosterId === input.rosterId)
    ) ?? null;

  const matchedAssignment =
    myAssignments.find(
      (a) =>
        a.siteId === input.siteId &&
        isAssignmentActiveOnDate(a, attendanceDate) &&
        (!input.assignmentId || a.assignmentId === input.assignmentId)
    ) ?? null;

  if (!matchedRoster && !matchedAssignment) {
    throw new Error(
      `Unauthorized Site Check-In blocked: You do not have a Published Duty Roster or Active Site Assignment at "${site.siteName}" on ${attendanceDate}.`
    );
  }

  const resolvedShiftType = matchedRoster
    ? matchedRoster.shiftType
    : matchedAssignment!.shift;
  const scheduledStartTime = matchedRoster
    ? matchedRoster.dutyStartTime
    : matchedAssignment!.shiftStartTime;
  const scheduledEndTime = matchedRoster
    ? matchedRoster.dutyEndTime
    : matchedAssignment!.shiftEndTime;
  const breakDurationMinutes = matchedRoster ? matchedRoster.breakDurationMinutes : 30;
  const gracePeriodMinutes = matchedRoster ? matchedRoster.gracePeriodMinutes : 15;

  // Duplicate check-in prevention for the same date & shift/roster
  const duplicate = existingAttendance.find(
    (a) =>
      a.attendanceDate === attendanceDate &&
      a.siteId === site.siteId &&
      (matchedRoster
        ? a.rosterId === matchedRoster.rosterId
        : a.shiftType === resolvedShiftType) &&
      Boolean(a.checkInAt)
  );
  if (duplicate) {
    throw new Error(
      `Duplicate Check-In blocked: You have already checked in for ${resolvedShiftType} on ${attendanceDate} (${duplicate.attendanceId}).`
    );
  }

  const nowIso = overrideNowIso || new Date().toISOString();
  const geoSettings = resolveSiteGeoSettings(site);
  const shiftMetrics = computeRosterShiftMetrics(
    attendanceDate,
    scheduledStartTime,
    scheduledEndTime,
    breakDurationMinutes
  );

  let checkInGeo: AttendanceGeoMetadata | null = null;
  let verificationOutcome: AttendanceVerificationOutcome = 'Verified';
  let qrSessionId = '';
  let qrVerificationStatus = '';
  let isException = false;
  let cleanExceptionReason = sanitizeInput(input.exceptionReason || '', 300);

  if (input.method === 'GPS') {
    const gpsEval = await verifyGpsWithBackendOrDeterministic({
      employeeLat: input.latitude ?? null,
      employeeLng: input.longitude ?? null,
      accuracyMeters: input.accuracyMeters ?? null,
      siteLat: geoSettings.latitude,
      siteLng: geoSettings.longitude,
      allowedRadiusMeters: geoSettings.allowedRadiusMeters,
      accuracyThresholdMeters: geoSettings.gpsAccuracyThresholdMeters,
    });

    checkInGeo = {
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      accuracyMeters: input.accuracyMeters ?? null,
      distanceMeters: gpsEval.distanceMeters,
      allowedRadiusMeters: geoSettings.allowedRadiusMeters,
      withinGeofence: gpsEval.withinGeofence,
      serverVerified: gpsEval.serverVerified,
      capturedAt: nowIso,
    };

    verificationOutcome = gpsEval.verificationOutcome;

    if (verificationOutcome !== 'Verified') {
      const detailMsg =
        verificationOutcome === 'Outside_Geofence'
          ? `You are ${gpsEval.distanceMeters}m away from "${site.siteName}" (allowed geofence radius: ${geoSettings.allowedRadiusMeters}m).`
          : verificationOutcome === 'Low_GPS_Accuracy'
            ? `GPS signal accuracy (±${Math.round(input.accuracyMeters || 0)}m) exceeds site threshold (±${geoSettings.gpsAccuracyThresholdMeters}m).`
            : gpsEval.errorMessage || 'GPS coordinates unavailable.';

      if (!input.submitAsException) {
        throw new Error(
          `Geofence Check-In Blocked: ${detailMsg} Move inside the authorized boundary or submit a Geofence Exception Request with reason for HR review.`
        );
      }
      if (cleanExceptionReason.length < 6) {
        throw new Error(
          'Enter an Exception Reason (minimum 6 characters) to submit an outside-geofence check-in for HR review.'
        );
      }
      isException = true;
    }
  } else {
    // QR Check-In
    if (!geoSettings.isQrEnabled) {
      throw new Error(`QR Check-In is disabled for site "${site.siteName}". Use GPS Check-In.`);
    }
    const qrRes = await verifyQrTokenForPunch({
      tokenOrCode: input.qrTokenOrCode || '',
      expectedSiteId: site.siteId,
      expectedBranchId: site.branchId,
      expectedShiftType: String(resolvedShiftType),
      expectedDate: attendanceDate,
      employeeId: emp.employeeId,
      actionType: 'check_in',
      isPreviewSession,
    });
    qrSessionId = qrRes.sessionId;
    qrVerificationStatus = 'HMAC_Rotating_QR_Verified';
    verificationOutcome = 'QR_Verified';
  }

  const lateCalc = computeCheckInLateMinutes(
    attendanceDate,
    scheduledStartTime,
    gracePeriodMinutes,
    nowIso
  );

  const initialStatus: AttendanceStatus = isException
    ? 'Exception'
    : lateCalc.derivedStatus;

  const existingIds = !useLiveFirestore(isPreviewSession)
    ? readLocalAttendanceStore().attendance.map((a) => a.attendanceId)
    : existingAttendance.map((a) => a.attendanceId);

  const attendanceId = generateSequentialId('ATT', existingIds);

  const record: AttendanceRecord = {
    attendanceId,
    employeeId: emp.employeeId,
    employeeName: emp.fullName,
    linkedUid: caller.uid,
    employeeUid: caller.uid,
    branchId: matchedRoster?.branchId || matchedAssignment!.branchId,
    branchName: matchedRoster?.branchName || matchedAssignment!.branchName,
    clientId: site.clientId,
    clientName: site.clientName,
    siteId: site.siteId,
    siteName: site.siteName,
    serviceCategory: matchedRoster?.serviceCategory || matchedAssignment!.serviceCategory,
    serviceId: matchedRoster?.serviceId || matchedAssignment!.serviceId,
    serviceName: matchedRoster?.serviceName || matchedAssignment!.serviceName,
    designationId: matchedRoster?.designationId || matchedAssignment!.designationId,
    designationName: matchedRoster?.designationName || matchedAssignment!.designationName,
    assignmentId: matchedRoster?.assignmentId || matchedAssignment?.assignmentId || '',
    rosterId: matchedRoster?.rosterId || '',
    attendanceDate,
    date: attendanceDate,
    shiftType: resolvedShiftType,
    scheduledStartTime,
    scheduledEndTime,
    crossesMidnight: shiftMetrics.crossesMidnight,
    breakDurationMinutes,
    gracePeriodMinutes,
    status: initialStatus,
    checkInAt: nowIso,
    checkOutAt: null,
    checkInMethod: input.method,
    checkOutMethod: null,
    checkInGeo,
    checkOutGeo: null,
    qrSessionId,
    qrVerificationStatus,
    deviceMetadata: captureSanitizedDeviceMetadata(),
    totalGrossMinutes: 0,
    totalDutyMinutes: 0,
    totalDutyHours: 0,
    lateArrivalMinutes: lateCalc.lateArrivalMinutes,
    earlyDepartureMinutes: 0,
    overtimeMinutes: 0,
    overtimeStatus: 'None',
    approvedOvertimeMinutes: 0,
    overtimeApprovedBy: null,
    overtimeApprovedAt: null,
    verificationOutcome,
    isVerifiedByHr: false,
    verifiedByUid: null,
    verifiedByName: null,
    verifiedAt: null,
    exceptionReason: cleanExceptionReason,
    hrRemarks: '',
    fieldOfficerRemarks: '',
    createdBy: caller.uid,
    updatedBy: caller.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const autoExceptionCorrection: AttendanceCorrectionRequest | null = isException
    ? {
        correctionId: makeRuntimeUniqueId('ACR'),
        requestType: 'Geofence Exception',
        attendanceId,
        rosterId: record.rosterId,
        assignmentId: record.assignmentId,
        employeeId: emp.employeeId,
        employeeName: emp.fullName,
        linkedUid: caller.uid,
        branchId: record.branchId,
        clientId: record.clientId,
        siteId: record.siteId,
        siteName: record.siteName,
        attendanceDate,
        shiftType: String(resolvedShiftType),
        requestedCheckInAt: nowIso,
        requestedCheckOutAt: '',
        requestedCheckOutNextDay: false,
        reason: cleanExceptionReason,
        supportingLocationNote: checkInGeo?.distanceMeters != null
          ? `Recorded ${checkInGeo.distanceMeters}m from site center (allowed ${checkInGeo.allowedRadiusMeters}m)`
          : 'GPS exception submitted on Check-In',
        status: 'Pending',
        requestedByUid: caller.uid,
        requestedByName: emp.fullName,
        requestedByRole: 'employee',
        reviewedByUid: null,
        reviewedByName: null,
        reviewRemarks: '',
        reviewedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
    : null;

  const auditEntry = buildAttendanceAuditEntry(caller, {
    category: 'Attendance',
    targetId: attendanceId,
    employeeId: emp.employeeId,
    siteId: site.siteId,
    branchId: record.branchId,
    action: isException ? 'Exception Check-In Recorded' : `Employee Check-In (${input.method})`,
    newValueSummary: `Status: ${record.status}, Method: ${input.method}, Outcome: ${verificationOutcome}, Late: ${record.lateArrivalMinutes}m`,
    reason: cleanExceptionReason,
    timestamp: nowIso,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.attendance.unshift(record);
    if (autoExceptionCorrection) {
      store.attendanceCorrections.unshift(autoExceptionCorrection);
    }
    if (qrSessionId) {
      store.attendanceQrSessions = store.attendanceQrSessions.map((s) =>
        s.sessionId === qrSessionId ? { ...s, scanCount: (s.scanCount || 0) + 1 } : s
      );
    }
    store.attendanceAuditLogs.unshift(auditEntry);
    writeLocalAttendanceStore(store);

    await rebuildSanitizedSiteAttendanceSummary(
      caller,
      isPreviewSession,
      site.siteId,
      attendanceDate
    );
    return record;
  }

  const path = `attendance/${attendanceId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'attendance', attendanceId), {
      ...record,
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });
    if (autoExceptionCorrection) {
      batch.set(
        doc(firestoreDb!, 'attendanceCorrections', autoExceptionCorrection.correctionId),
        {
          ...autoExceptionCorrection,
          serverCreatedAt: serverTimestamp(),
        }
      );
    }
    batch.set(doc(firestoreDb!, 'attendanceAuditLogs', auditEntry.auditId), {
      ...auditEntry,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyAttendanceListeners();
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function submitEmployeeCheckOut(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: EmployeeCheckOutInput,
  overrideNowIso?: string
): Promise<AttendanceRecord> {
  if (caller.role !== 'employee') {
    throw new Error('Only Employee Portal accounts can perform personal shift Check-Out.');
  }

  const myRecords = await listAttendanceRecords(caller, isPreviewSession);
  const existing = myRecords.find((a) => a.attendanceId === input.attendanceId);
  if (!existing) {
    throw new Error('Active Check-In record not found. Check in before checking out.');
  }
  if (!existing.checkInAt) {
    throw new Error('Cannot Check Out before recording a valid Check-In.');
  }
  if (existing.checkOutAt) {
    throw new Error(
      `Duplicate Check-Out blocked: Shift ${existing.attendanceId} was already checked out.`
    );
  }
  if (existing.isVerifiedByHr) {
    throw new Error('Verified attendance records are locked and cannot be modified by employees.');
  }

  const site = await getSiteByIdForAttendance(existing.siteId, isPreviewSession);
  if (!site) throw new Error('Assigned site record not found.');

  const nowIso = overrideNowIso || new Date().toISOString();
  const geoSettings = resolveSiteGeoSettings(site);

  let checkOutGeo: AttendanceGeoMetadata | null = null;
  let nextVerificationOutcome = existing.verificationOutcome;
  let preserveException = existing.status === 'Exception';
  let appendedExceptionReason = existing.exceptionReason;

  if (input.method === 'GPS') {
    const gpsEval = await verifyGpsWithBackendOrDeterministic({
      employeeLat: input.latitude ?? null,
      employeeLng: input.longitude ?? null,
      accuracyMeters: input.accuracyMeters ?? null,
      siteLat: geoSettings.latitude,
      siteLng: geoSettings.longitude,
      allowedRadiusMeters: geoSettings.allowedRadiusMeters,
      accuracyThresholdMeters: geoSettings.gpsAccuracyThresholdMeters,
    });

    checkOutGeo = {
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      accuracyMeters: input.accuracyMeters ?? null,
      distanceMeters: gpsEval.distanceMeters,
      allowedRadiusMeters: geoSettings.allowedRadiusMeters,
      withinGeofence: gpsEval.withinGeofence,
      serverVerified: gpsEval.serverVerified,
      capturedAt: nowIso,
    };

    if (gpsEval.verificationOutcome !== 'Verified') {
      if (!input.exceptionReason || input.exceptionReason.trim().length < 5) {
        const msg =
          gpsEval.verificationOutcome === 'Outside_Geofence'
            ? `You are ${gpsEval.distanceMeters}m from "${site.siteName}" (allowed ${geoSettings.allowedRadiusMeters}m).`
            : 'GPS signal accuracy is outside threshold.';
        throw new Error(
          `Geofence Check-Out Blocked: ${msg} Move inside the site boundary or provide an Exception Reason for HR verification.`
        );
      }
      preserveException = true;
      nextVerificationOutcome = gpsEval.verificationOutcome;
      appendedExceptionReason = sanitizeInput(
        existing.exceptionReason
          ? `${existing.exceptionReason} | Out: ${input.exceptionReason}`
          : input.exceptionReason,
        300
      );
    }
  } else {
    await verifyQrTokenForPunch({
      tokenOrCode: input.qrTokenOrCode || '',
      expectedSiteId: site.siteId,
      expectedBranchId: site.branchId,
      expectedShiftType: String(existing.shiftType),
      expectedDate: existing.attendanceDate,
      allowedDates: existing.crossesMidnight
        ? [existing.attendanceDate, addDaysToIsoDate(existing.attendanceDate, 1)]
        : [existing.attendanceDate],
      employeeId: existing.employeeId,
      actionType: 'check_out',
      isPreviewSession,
    });
  }

  const metrics = computeCheckOutMetrics({
    attendanceDate: existing.attendanceDate,
    scheduledStartTime: existing.scheduledStartTime,
    scheduledEndTime: existing.scheduledEndTime,
    breakDurationMinutes: existing.breakDurationMinutes,
    gracePeriodMinutes: existing.gracePeriodMinutes,
    checkInIso: existing.checkInAt,
    checkOutIso: nowIso,
    preserveExceptionStatus: preserveException,
  });

  const updated: AttendanceRecord = {
    ...existing,
    checkOutAt: nowIso,
    checkOutMethod: input.method,
    checkOutGeo,
    totalGrossMinutes: metrics.totalGrossMinutes,
    totalDutyMinutes: metrics.totalDutyMinutes,
    totalDutyHours: metrics.totalDutyHours,
    earlyDepartureMinutes: metrics.earlyDepartureMinutes,
    overtimeMinutes: metrics.overtimeMinutes,
    overtimeStatus:
      metrics.overtimeMinutes >= 15
        ? existing.overtimeStatus === 'Approved'
          ? 'Approved'
          : 'Pending'
        : 'None',
    status: metrics.derivedStatus,
    verificationOutcome: nextVerificationOutcome,
    exceptionReason: appendedExceptionReason,
    updatedBy: caller.uid,
    updatedAt: nowIso,
  };

  const auditEntry = buildAttendanceAuditEntry(caller, {
    category: 'Attendance',
    targetId: existing.attendanceId,
    employeeId: existing.employeeId,
    siteId: existing.siteId,
    branchId: existing.branchId,
    action: `Employee Check-Out (${input.method})`,
    previousValueSummary: `Checked In at ${existing.checkInAt}`,
    newValueSummary: `Checked Out at ${nowIso} · Net ${updated.totalDutyHours}h · OT ${updated.overtimeMinutes}m · Status ${updated.status}`,
    reason: input.exceptionReason || '',
    timestamp: nowIso,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.attendance = store.attendance.map((a) =>
      a.attendanceId === updated.attendanceId ? updated : a
    );
    store.attendanceAuditLogs.unshift(auditEntry);
    writeLocalAttendanceStore(store);

    await rebuildSanitizedSiteAttendanceSummary(
      caller,
      isPreviewSession,
      existing.siteId,
      existing.attendanceDate
    );
    return updated;
  }

  const path = `attendance/${existing.attendanceId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'attendance', existing.attendanceId), {
      checkOutAt: updated.checkOutAt,
      checkOutMethod: updated.checkOutMethod,
      checkOutGeo: updated.checkOutGeo,
      totalGrossMinutes: updated.totalGrossMinutes,
      totalDutyMinutes: updated.totalDutyMinutes,
      totalDutyHours: updated.totalDutyHours,
      earlyDepartureMinutes: updated.earlyDepartureMinutes,
      overtimeMinutes: updated.overtimeMinutes,
      overtimeStatus: updated.overtimeStatus,
      status: updated.status,
      verificationOutcome: updated.verificationOutcome,
      exceptionReason: updated.exceptionReason,
      updatedBy: caller.uid,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'attendanceAuditLogs', auditEntry.auditId), {
      ...auditEntry,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyAttendanceListeners();
    return updated;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 5. HR / ADMIN MANUAL ENTRY, VERIFICATION, OVERTIME & FIELD OFFICER REMARKS
// ============================================================================
export async function recordManualHrAttendance(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: ManualHrAttendanceInput
): Promise<AttendanceRecord> {
  assertNotSitePortal(caller);

  if (caller.role !== 'admin') {
    if (caller.role !== 'hr' || !hasUserPermission(caller, 'attendance.create')) {
      throw new Error('Recording manual attendance entries requires attendance.create permission.');
    }
  }
  if (!isValidIsoDate(input.attendanceDate)) {
    throw new Error('Select a valid Attendance Date (YYYY-MM-DD).');
  }
  if (!input.hrRemarks || input.hrRemarks.trim().length < 4) {
    throw new Error('Enter HR Remarks (minimum 4 characters) explaining this attendance entry.');
  }

  const [emp, site, allAssignments, existingAttendance] = await Promise.all([
    getEmployeeById(caller, isPreviewSession, input.employeeId),
    getSiteByIdForAttendance(input.siteId, isPreviewSession),
    listEmployeeAssignments(caller, isPreviewSession),
    listAttendanceRecords(caller, isPreviewSession),
  ]);

  if (!emp) throw new Error(`Employee ${input.employeeId} not found.`);
  if (!site) throw new Error(`Site ${input.siteId} not found.`);

  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(site.branchId)) {
    throw new Error('Unauthorized branch scope for manual attendance entry.');
  }

  const duplicate = existingAttendance.find(
    (a) =>
      a.employeeId === emp.employeeId &&
      a.siteId === site.siteId &&
      a.attendanceDate === input.attendanceDate &&
      a.shiftType === input.shiftType
  );
  if (duplicate) {
    throw new Error(
      `Attendance record ${duplicate.attendanceId} already exists for ${emp.fullName} on ${input.attendanceDate} (${input.shiftType}). Edit or verify that record instead.`
    );
  }

  const matchedAssignment =
    allAssignments.find(
      (a) => a.employeeId === emp.employeeId && a.siteId === site.siteId
    ) ?? null;
  const fallbackDesig = emp.assignedDesignations[0];

  const shiftMeta = computeRosterShiftMetrics(
    input.attendanceDate,
    input.scheduledStartTime,
    input.scheduledEndTime,
    input.breakDurationMinutes
  );

  let checkInAt: string | null = null;
  let checkOutAt: string | null = null;
  let totalGrossMinutes = 0;
  let totalDutyMinutes = 0;
  let totalDutyHours = 0;
  let lateArrivalMinutes = 0;
  let earlyDepartureMinutes = 0;
  let overtimeMinutes = 0;

  if (input.checkInTime24h && isValidTime24h(input.checkInTime24h)) {
    checkInAt = new Date(
      combineDateAndTimeToMs(input.attendanceDate, input.checkInTime24h)
    ).toISOString();
    const lateCalc = computeCheckInLateMinutes(
      input.attendanceDate,
      input.scheduledStartTime,
      input.gracePeriodMinutes,
      checkInAt
    );
    lateArrivalMinutes = lateCalc.lateArrivalMinutes;
  }

  if (checkInAt && input.checkOutTime24h && isValidTime24h(input.checkOutTime24h)) {
    const outDate = input.checkOutNextDay
      ? addDaysToIsoDate(input.attendanceDate, 1)
      : input.attendanceDate;
    checkOutAt = new Date(combineDateAndTimeToMs(outDate, input.checkOutTime24h)).toISOString();
    const outMetrics = computeCheckOutMetrics({
      attendanceDate: input.attendanceDate,
      scheduledStartTime: input.scheduledStartTime,
      scheduledEndTime: input.scheduledEndTime,
      breakDurationMinutes: input.breakDurationMinutes,
      gracePeriodMinutes: input.gracePeriodMinutes,
      checkInIso: checkInAt,
      checkOutIso: checkOutAt,
    });
    totalGrossMinutes = outMetrics.totalGrossMinutes;
    totalDutyMinutes = outMetrics.totalDutyMinutes;
    totalDutyHours = outMetrics.totalDutyHours;
    earlyDepartureMinutes = outMetrics.earlyDepartureMinutes;
    overtimeMinutes = outMetrics.overtimeMinutes;
  }

  const nowIso = new Date().toISOString();
  const attendanceId = generateSequentialId(
    'ATT',
    existingAttendance.map((a) => a.attendanceId)
  );

  const record: AttendanceRecord = {
    attendanceId,
    employeeId: emp.employeeId,
    employeeName: emp.fullName,
    linkedUid: emp.linkedUid || '',
    employeeUid: emp.linkedUid || emp.employeeId,
    branchId: site.branchId,
    branchName: emp.branchName,
    clientId: site.clientId,
    clientName: site.clientName,
    siteId: site.siteId,
    siteName: site.siteName,
    serviceCategory:
      matchedAssignment?.serviceCategory || fallbackDesig?.serviceCategory || 'Security',
    serviceId: matchedAssignment?.serviceId || fallbackDesig?.serviceId || 'SRV-MANUAL',
    serviceName: matchedAssignment?.serviceName || fallbackDesig?.serviceName || 'General Service',
    designationId:
      matchedAssignment?.designationId || fallbackDesig?.designationId || 'DSG-MANUAL',
    designationName:
      matchedAssignment?.designationName || fallbackDesig?.designationName || 'Personnel',
    assignmentId: input.assignmentId || matchedAssignment?.assignmentId || '',
    rosterId: input.rosterId || '',
    attendanceDate: input.attendanceDate,
    date: input.attendanceDate,
    shiftType: input.shiftType,
    scheduledStartTime: input.scheduledStartTime,
    scheduledEndTime: input.scheduledEndTime,
    crossesMidnight: shiftMeta.crossesMidnight,
    breakDurationMinutes: input.breakDurationMinutes,
    gracePeriodMinutes: input.gracePeriodMinutes,
    status: input.status,
    checkInAt,
    checkOutAt,
    checkInMethod: checkInAt ? 'Manual_HR' : null,
    checkOutMethod: checkOutAt ? 'Manual_HR' : null,
    checkInGeo: null,
    checkOutGeo: null,
    qrSessionId: '',
    qrVerificationStatus: '',
    deviceMetadata: null,
    totalGrossMinutes,
    totalDutyMinutes,
    totalDutyHours,
    lateArrivalMinutes,
    earlyDepartureMinutes,
    overtimeMinutes,
    overtimeStatus: overtimeMinutes >= 15 ? 'Pending' : 'None',
    approvedOvertimeMinutes: 0,
    overtimeApprovedBy: null,
    overtimeApprovedAt: null,
    verificationOutcome: 'Manual_Override',
    isVerifiedByHr: true,
    verifiedByUid: caller.uid,
    verifiedByName: caller.fullName,
    verifiedAt: nowIso,
    exceptionReason: '',
    hrRemarks: sanitizeInput(input.hrRemarks, 300),
    fieldOfficerRemarks: '',
    createdBy: caller.uid,
    updatedBy: caller.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const auditEntry = buildAttendanceAuditEntry(caller, {
    category: 'Attendance',
    targetId: attendanceId,
    employeeId: emp.employeeId,
    siteId: site.siteId,
    branchId: site.branchId,
    action: `Manual HR Attendance Recorded (${input.status})`,
    newValueSummary: `${emp.fullName} on ${input.attendanceDate} at ${site.siteName} -> ${input.status} (${totalDutyHours}h)`,
    reason: input.hrRemarks,
    timestamp: nowIso,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.attendance.unshift(record);
    store.attendanceAuditLogs.unshift(auditEntry);
    writeLocalAttendanceStore(store);

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: auditEntry.action,
      module: 'Attendance',
      recordId: attendanceId,
      branchId: site.branchId,
      summary: auditEntry.newValueSummary,
    });
    await rebuildSanitizedSiteAttendanceSummary(
      caller,
      isPreviewSession,
      site.siteId,
      input.attendanceDate
    );
    return record;
  }

  const path = `attendance/${attendanceId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'attendance', attendanceId), {
      ...record,
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'attendanceAuditLogs', auditEntry.auditId), {
      ...auditEntry,
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: auditEntry.action,
      module: 'Attendance',
      recordId: attendanceId,
      branchId: site.branchId,
      summary: auditEntry.newValueSummary,
    });
    await rebuildSanitizedSiteAttendanceSummary(
      caller,
      isPreviewSession,
      site.siteId,
      input.attendanceDate
    );
    notifyAttendanceListeners();
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function verifyOrUpdateAttendanceByHr(
  caller: RexonUser,
  isPreviewSession: boolean,
  attendanceId: string,
  params: {
    status: AttendanceStatus;
    hrRemarks: string;
    markVerified: boolean;
  }
): Promise<AttendanceRecord> {
  assertNotSitePortal(caller);

  if (caller.role === 'employee' || caller.role === 'field_officer') {
    throw new Error('Only Admin or authorized HR personnel can verify or modify attendance status.');
  }

  if (caller.role === 'hr') {
    const hasPerm =
      hasUserPermission(caller, 'attendance.verify') ||
      hasUserPermission(caller, 'attendance.edit') ||
      hasUserPermission(caller, 'attendance.approve');
    if (!hasPerm) {
      throw new Error('Verifying or updating attendance requires attendance.verify or attendance.edit permission.');
    }
  }

  const records = await listAttendanceRecords(caller, isPreviewSession);
  const existing = records.find((a) => a.attendanceId === attendanceId);
  if (!existing) throw new Error(`Attendance record ${attendanceId} not found.`);

  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(existing.branchId)) {
    throw new Error('Unauthorized branch scope for attendance verification.');
  }

  // Resolving an Exception requires attendance.approve (or Admin)
  if (
    existing.status === 'Exception' &&
    params.status !== 'Exception' &&
    caller.role !== 'admin' &&
    !hasUserPermission(caller, 'attendance.approve') &&
    !hasUserPermission(caller, 'attendance.verify')
  ) {
    throw new Error('Approving a Geofence Exception requires attendance.approve or attendance.verify permission.');
  }

  const nowIso = new Date().toISOString();
  const nextVerificationOutcome: AttendanceVerificationOutcome =
    params.markVerified &&
    (existing.verificationOutcome === 'Outside_Geofence' ||
      existing.verificationOutcome === 'Low_GPS_Accuracy' ||
      existing.verificationOutcome === 'Pending_Review')
      ? 'Manual_Override'
      : existing.verificationOutcome;

  const updated: AttendanceRecord = {
    ...existing,
    status: params.status,
    hrRemarks: sanitizeInput(params.hrRemarks || existing.hrRemarks, 300),
    verificationOutcome: nextVerificationOutcome,
    isVerifiedByHr: params.markVerified ? true : existing.isVerifiedByHr,
    verifiedByUid: params.markVerified ? caller.uid : existing.verifiedByUid,
    verifiedByName: params.markVerified ? caller.fullName : existing.verifiedByName,
    verifiedAt: params.markVerified ? nowIso : existing.verifiedAt,
    updatedBy: caller.uid,
    updatedAt: nowIso,
  };

  const auditEntry = buildAttendanceAuditEntry(caller, {
    category: 'Attendance',
    targetId: attendanceId,
    employeeId: existing.employeeId,
    siteId: existing.siteId,
    branchId: existing.branchId,
    action: params.markVerified ? 'Attendance Verified by HR' : 'Attendance Status Updated by HR',
    previousValueSummary: `${existing.status} (Verified: ${existing.isVerifiedByHr})`,
    newValueSummary: `${updated.status} (Verified: ${updated.isVerifiedByHr})`,
    reason: params.hrRemarks,
    timestamp: nowIso,
  });

  const notif = params.markVerified
    ? buildEmployeeNotificationEntry({
        employeeId: updated.employeeId,
        linkedUid: updated.linkedUid,
        branchId: updated.branchId,
        siteId: updated.siteId,
        siteName: updated.siteName,
        category: 'Attendance Verified',
        title: `Attendance Verified — ${updated.attendanceDate}`,
        message: `Your shift at ${updated.siteName} on ${updated.attendanceDate} was verified as "${updated.status}" (${updated.totalDutyHours}h).`,
        dutyDate: updated.attendanceDate,
        createdAt: nowIso,
      })
    : null;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.attendance = store.attendance.map((a) =>
      a.attendanceId === attendanceId ? updated : a
    );
    store.attendanceAuditLogs.unshift(auditEntry);
    if (notif) store.employeeNotifications.unshift(notif);
    writeLocalAttendanceStore(store);

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: auditEntry.action,
      module: 'Attendance',
      recordId: attendanceId,
      branchId: updated.branchId,
      summary: `${updated.employeeName} (${updated.attendanceDate}): ${auditEntry.newValueSummary}`,
    });
    await rebuildSanitizedSiteAttendanceSummary(
      caller,
      isPreviewSession,
      updated.siteId,
      updated.attendanceDate
    );
    return updated;
  }

  const path = `attendance/${attendanceId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'attendance', attendanceId), {
      status: updated.status,
      hrRemarks: updated.hrRemarks,
      verificationOutcome: updated.verificationOutcome,
      isVerifiedByHr: updated.isVerifiedByHr,
      verifiedByUid: updated.verifiedByUid,
      verifiedByName: updated.verifiedByName,
      verifiedAt: updated.verifiedAt,
      updatedBy: caller.uid,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'attendanceAuditLogs', auditEntry.auditId), {
      ...auditEntry,
      createdAt: serverTimestamp(),
    });
    if (notif) {
      batch.set(doc(firestoreDb!, 'employeeNotifications', notif.notificationId), {
        ...notif,
        serverCreatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: auditEntry.action,
      module: 'Attendance',
      recordId: attendanceId,
      branchId: updated.branchId,
      summary: `${updated.employeeName} (${updated.attendanceDate}): ${auditEntry.newValueSummary}`,
    });
    await rebuildSanitizedSiteAttendanceSummary(
      caller,
      isPreviewSession,
      updated.siteId,
      updated.attendanceDate
    );
    notifyAttendanceListeners();
    return updated;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function reviewOvertimeByHr(
  caller: RexonUser,
  isPreviewSession: boolean,
  attendanceId: string,
  params: {
    decision: 'Approved' | 'Rejected';
    approvedMinutes?: number;
    remarks: string;
  }
): Promise<AttendanceRecord> {
  assertNotSitePortal(caller);

  if (caller.role !== 'admin') {
    if (
      caller.role !== 'hr' ||
      (!hasUserPermission(caller, 'attendance.overtime_approve') &&
        !hasUserPermission(caller, 'attendance.approve'))
    ) {
      throw new Error(
        'Overtime approval requires Admin access or attendance.overtime_approve permission.'
      );
    }
  }

  const records = await listAttendanceRecords(caller, isPreviewSession);
  const existing = records.find((a) => a.attendanceId === attendanceId);
  if (!existing) throw new Error(`Attendance record ${attendanceId} not found.`);

  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(existing.branchId)) {
    throw new Error('Unauthorized branch scope for overtime approval.');
  }

  const nowIso = new Date().toISOString();
  const approvedMins =
    params.decision === 'Approved'
      ? Math.max(15, Math.min(480, Math.round(params.approvedMinutes ?? existing.overtimeMinutes)))
      : 0;

  const updated: AttendanceRecord = {
    ...existing,
    overtimeStatus: params.decision,
    approvedOvertimeMinutes: approvedMins,
    overtimeApprovedBy: `${caller.fullName} (${caller.role})`,
    overtimeApprovedAt: nowIso,
    hrRemarks: sanitizeInput(
      params.remarks
        ? existing.hrRemarks
          ? `${existing.hrRemarks} | OT: ${params.remarks}`
          : params.remarks
        : existing.hrRemarks,
      300
    ),
    updatedBy: caller.uid,
    updatedAt: nowIso,
  };

  const auditEntry = buildAttendanceAuditEntry(caller, {
    category: 'Overtime',
    targetId: attendanceId,
    employeeId: existing.employeeId,
    siteId: existing.siteId,
    branchId: existing.branchId,
    action: `Overtime ${params.decision}`,
    previousValueSummary: `Recorded OT: ${existing.overtimeMinutes}m (${existing.overtimeStatus})`,
    newValueSummary: `${params.decision}: ${approvedMins}m approved`,
    reason: params.remarks,
    timestamp: nowIso,
  });

  const notif = buildEmployeeNotificationEntry({
    employeeId: updated.employeeId,
    linkedUid: updated.linkedUid,
    branchId: updated.branchId,
    siteId: updated.siteId,
    siteName: updated.siteName,
    category: 'Overtime Approved',
    title: `Overtime ${params.decision} — ${updated.attendanceDate}`,
    message:
      params.decision === 'Approved'
        ? `${Math.round((approvedMins / 60) * 100) / 100}h (${approvedMins} mins) overtime approved for your shift at ${updated.siteName}.`
        : `Overtime claim for ${updated.attendanceDate} at ${updated.siteName} was not approved. Remarks: ${params.remarks || 'Per shift schedule'}.`,
    dutyDate: updated.attendanceDate,
    createdAt: nowIso,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.attendance = store.attendance.map((a) =>
      a.attendanceId === attendanceId ? updated : a
    );
    store.attendanceAuditLogs.unshift(auditEntry);
    store.employeeNotifications.unshift(notif);
    writeLocalAttendanceStore(store);

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: auditEntry.action,
      module: 'Attendance',
      recordId: attendanceId,
      branchId: updated.branchId,
      summary: `${updated.employeeName} (${updated.attendanceDate}): ${auditEntry.newValueSummary}`,
    });
    return updated;
  }

  const path = `attendance/${attendanceId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'attendance', attendanceId), {
      overtimeStatus: updated.overtimeStatus,
      approvedOvertimeMinutes: updated.approvedOvertimeMinutes,
      overtimeApprovedBy: updated.overtimeApprovedBy,
      overtimeApprovedAt: updated.overtimeApprovedAt,
      hrRemarks: updated.hrRemarks,
      updatedBy: caller.uid,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'attendanceAuditLogs', auditEntry.auditId), {
      ...auditEntry,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'employeeNotifications', notif.notificationId), {
      ...notif,
      serverCreatedAt: serverTimestamp(),
    });
    await batch.commit();
    notifyAttendanceListeners();
    return updated;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function addFieldOfficerAttendanceRemark(
  caller: RexonUser,
  isPreviewSession: boolean,
  attendanceId: string,
  remark: string
): Promise<void> {
  if (caller.role !== 'field_officer' && caller.role !== 'admin' && caller.role !== 'hr') {
    throw new Error('Unauthorized role for field attendance remarks.');
  }
  if (!remark || remark.trim().length < 4) {
    throw new Error('Enter at least 4 characters for the Field Officer observation.');
  }

  const records = await listAttendanceRecords(caller, isPreviewSession);
  const existing = records.find((a) => a.attendanceId === attendanceId);
  if (!existing) throw new Error('Attendance record not found.');

  if (caller.role === 'field_officer' && !caller.assignedSiteIds.includes(existing.siteId)) {
    throw new Error('Field Officers can only record attendance remarks for assigned sites.');
  }

  const nowIso = new Date().toISOString();
  const formatted = sanitizeInput(`${caller.fullName}: ${remark.trim()}`, 300);

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.attendance = store.attendance.map((a) =>
      a.attendanceId === attendanceId
        ? { ...a, fieldOfficerRemarks: formatted, updatedAt: nowIso }
        : a
    );
    writeLocalAttendanceStore(store);
    return;
  }

  const path = `attendance/${attendanceId}`;
  try {
    await updateDoc(doc(firestoreDb!, 'attendance', attendanceId), {
      fieldOfficerRemarks: formatted,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    notifyAttendanceListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 6. MISSING PUNCH & ATTENDANCE CORRECTION WORKFLOW (`attendanceCorrections`)
// ============================================================================
export async function listAttendanceCorrectionRequests(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<AttendanceCorrectionRequest[]> {
  assertNotSitePortal(caller);

  let ownEmp: EmployeeRecord | null = null;
  if (caller.role === 'employee') {
    ownEmp = await getOwnEmployeeRecord(caller, isPreviewSession);
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    let list = [...store.attendanceCorrections];
    if (caller.role === 'hr') {
      list = list.filter((c) => canCallerAccessBranchForAttendance(caller, c.branchId));
    } else if (caller.role === 'field_officer') {
      list = list.filter((c) => caller.assignedSiteIds.includes(c.siteId));
    } else if (caller.role === 'employee') {
      list = list.filter(
        (c) =>
          c.linkedUid === caller.uid ||
          c.requestedByUid === caller.uid ||
          (ownEmp && c.employeeId === ownEmp.employeeId)
      );
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const path = 'attendanceCorrections';
  try {
    let q;
    if (caller.role === 'admin' || (caller.role === 'hr' && hasUserPermission(caller, 'attendance.view_all_branch'))) {
      q = query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      const branches = getAuthorizedBranchIds(caller);
      if (branches.length === 0) return [];
      q = query(collection(firestoreDb!, path), where('branchId', 'in', branches.slice(0, 10)));
    } else if (caller.role === 'field_officer') {
      if (!caller.assignedSiteIds || caller.assignedSiteIds.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('siteId', 'in', caller.assignedSiteIds.slice(0, 10))
      );
    } else {
      q = query(collection(firestoreDb!, path), where('requestedByUid', '==', caller.uid));
    }
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as AttendanceCorrectionRequest)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function submitAttendanceCorrectionRequest(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: SubmitAttendanceCorrectionInput
): Promise<AttendanceCorrectionRequest> {
  assertNotSitePortal(caller);

  if (!isValidIsoDate(input.attendanceDate)) {
    throw new Error('Select a valid Attendance Date (YYYY-MM-DD).');
  }
  if (!input.reason || input.reason.trim().length < 6) {
    throw new Error('Provide a detailed reason (at least 6 characters) for the attendance correction.');
  }

  let emp: EmployeeRecord | null = null;
  if (caller.role === 'employee') {
    emp = await getOwnEmployeeRecord(caller, isPreviewSession);
    if (!emp) {
      throw new Error('Your account is not linked to an Employee record.');
    }
  } else {
    const allEmps = await listEmployees(caller, isPreviewSession);
    emp = allEmps[0] ?? null;
  }
  if (!emp) throw new Error('Employee context not found for correction request.');

  const site = await getSiteByIdForAttendance(input.siteId, isPreviewSession);
  if (!site) throw new Error('Selected site not found.');

  const reqInIso =
    input.requestedCheckInTime && isValidTime24h(input.requestedCheckInTime)
      ? new Date(
          combineDateAndTimeToMs(input.attendanceDate, input.requestedCheckInTime)
        ).toISOString()
      : '';

  const outDate = input.requestedCheckOutNextDay
    ? addDaysToIsoDate(input.attendanceDate, 1)
    : input.attendanceDate;
  const reqOutIso =
    input.requestedCheckOutTime && isValidTime24h(input.requestedCheckOutTime)
      ? new Date(combineDateAndTimeToMs(outDate, input.requestedCheckOutTime)).toISOString()
      : '';

  const nowIso = new Date().toISOString();
  const existingReqs = await listAttendanceCorrectionRequests(caller, isPreviewSession);
  const correctionId = generateSequentialId(
    'ACR',
    existingReqs.map((c) => c.correctionId)
  );

  const requestRecord: AttendanceCorrectionRequest = {
    correctionId,
    requestType: input.requestType,
    attendanceId: input.attendanceId || '',
    rosterId: input.rosterId || '',
    assignmentId: input.assignmentId || '',
    employeeId: emp.employeeId,
    employeeName: emp.fullName,
    linkedUid: emp.linkedUid || caller.uid,
    branchId: site.branchId,
    clientId: site.clientId,
    siteId: site.siteId,
    siteName: site.siteName,
    attendanceDate: input.attendanceDate,
    shiftType: sanitizeInput(input.shiftType || 'General Shift', 60),
    requestedCheckInAt: reqInIso,
    requestedCheckOutAt: reqOutIso,
    requestedCheckOutNextDay: Boolean(input.requestedCheckOutNextDay),
    reason: sanitizeInput(input.reason, 300),
    supportingLocationNote: sanitizeInput(input.supportingLocationNote || '', 250),
    status: 'Pending',
    requestedByUid: caller.uid,
    requestedByName: caller.fullName,
    requestedByRole: caller.role,
    reviewedByUid: null,
    reviewedByName: null,
    reviewRemarks: '',
    reviewedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const auditEntry = buildAttendanceAuditEntry(caller, {
    category: 'Correction',
    targetId: correctionId,
    employeeId: emp.employeeId,
    siteId: site.siteId,
    branchId: site.branchId,
    action: `Correction Requested (${input.requestType})`,
    newValueSummary: `${emp.fullName} · ${input.attendanceDate} at ${site.siteName}`,
    reason: input.reason,
    timestamp: nowIso,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.attendanceCorrections.unshift(requestRecord);
    store.attendanceAuditLogs.unshift(auditEntry);
    writeLocalAttendanceStore(store);
    return requestRecord;
  }

  const path = `attendanceCorrections/${correctionId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'attendanceCorrections', correctionId), {
      ...requestRecord,
      serverCreatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'attendanceAuditLogs', auditEntry.auditId), {
      ...auditEntry,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyAttendanceListeners();
    return requestRecord;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function reviewAttendanceCorrectionRequest(
  caller: RexonUser,
  isPreviewSession: boolean,
  correctionId: string,
  decision: 'Approved' | 'Rejected',
  reviewRemarks: string
): Promise<void> {
  assertNotSitePortal(caller);

  if (caller.role !== 'admin') {
    if (
      caller.role !== 'hr' ||
      (!hasUserPermission(caller, 'attendance.correct') &&
        !hasUserPermission(caller, 'attendance.approve'))
    ) {
      throw new Error(
        'Reviewing attendance correction requests requires attendance.correct or attendance.approve permission.'
      );
    }
  }
  if (!reviewRemarks || reviewRemarks.trim().length < 4) {
    throw new Error('Provide review remarks (at least 4 characters) for the audit trail.');
  }

  const [allCorrections, allAttendance, empList] = await Promise.all([
    listAttendanceCorrectionRequests(caller, isPreviewSession),
    listAttendanceRecords(caller, isPreviewSession),
    listEmployees(caller, isPreviewSession),
  ]);

  const target = allCorrections.find((c) => c.correctionId === correctionId);
  if (!target) throw new Error(`Correction request ${correctionId} not found.`);
  if (target.status !== 'Pending') {
    throw new Error('Only Pending correction requests can be reviewed.');
  }

  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(target.branchId)) {
    throw new Error('Unauthorized branch scope for reviewing this correction request.');
  }

  const nowIso = new Date().toISOString();
  const matchedAttendance = target.attendanceId
    ? allAttendance.find((a) => a.attendanceId === target.attendanceId) ?? null
    : allAttendance.find(
        (a) =>
          a.employeeId === target.employeeId &&
          a.siteId === target.siteId &&
          a.attendanceDate === target.attendanceDate
      ) ?? null;

  let updatedOrCreatedAttendance: AttendanceRecord | null = null;

  if (decision === 'Approved') {
    if (matchedAttendance) {
      const nextIn = target.requestedCheckInAt || matchedAttendance.checkInAt;
      const nextOut = target.requestedCheckOutAt || matchedAttendance.checkOutAt;

      let totalGrossMinutes = matchedAttendance.totalGrossMinutes;
      let totalDutyMinutes = matchedAttendance.totalDutyMinutes;
      let totalDutyHours = matchedAttendance.totalDutyHours;
      let lateArrivalMinutes = matchedAttendance.lateArrivalMinutes;
      let earlyDepartureMinutes = matchedAttendance.earlyDepartureMinutes;
      let overtimeMinutes = matchedAttendance.overtimeMinutes;
      let nextStatus: AttendanceStatus =
        matchedAttendance.status === 'Exception' ? 'Present' : matchedAttendance.status;

      if (nextIn && nextOut) {
        const calc = computeCheckOutMetrics({
          attendanceDate: matchedAttendance.attendanceDate,
          scheduledStartTime: matchedAttendance.scheduledStartTime,
          scheduledEndTime: matchedAttendance.scheduledEndTime,
          breakDurationMinutes: matchedAttendance.breakDurationMinutes,
          gracePeriodMinutes: matchedAttendance.gracePeriodMinutes,
          checkInIso: nextIn,
          checkOutIso: nextOut,
        });
        totalGrossMinutes = calc.totalGrossMinutes;
        totalDutyMinutes = calc.totalDutyMinutes;
        totalDutyHours = calc.totalDutyHours;
        lateArrivalMinutes = calc.lateArrivalMinutes;
        earlyDepartureMinutes = calc.earlyDepartureMinutes;
        overtimeMinutes = calc.overtimeMinutes;
        nextStatus = calc.derivedStatus;
      } else if (nextIn) {
        const l = computeCheckInLateMinutes(
          matchedAttendance.attendanceDate,
          matchedAttendance.scheduledStartTime,
          matchedAttendance.gracePeriodMinutes,
          nextIn
        );
        lateArrivalMinutes = l.lateArrivalMinutes;
        nextStatus = l.derivedStatus;
      }

      updatedOrCreatedAttendance = {
        ...matchedAttendance,
        checkInAt: nextIn,
        checkOutAt: nextOut,
        totalGrossMinutes,
        totalDutyMinutes,
        totalDutyHours,
        lateArrivalMinutes,
        earlyDepartureMinutes,
        overtimeMinutes,
        overtimeStatus:
          overtimeMinutes >= 15 && matchedAttendance.overtimeStatus === 'None'
            ? 'Pending'
            : matchedAttendance.overtimeStatus,
        status: nextStatus,
        verificationOutcome: 'Manual_Override',
        isVerifiedByHr: true,
        verifiedByUid: caller.uid,
        verifiedByName: caller.fullName,
        verifiedAt: nowIso,
        hrRemarks: sanitizeInput(`Correction ${correctionId} Approved: ${reviewRemarks}`, 300),
        updatedBy: caller.uid,
        updatedAt: nowIso,
      };
    } else {
      // Missing punch where no attendance doc existed yet -> create verified record
      const emp = empList.find((e) => e.employeeId === target.employeeId);
      const site = await getSiteByIdForAttendance(target.siteId, isPreviewSession);
      if (emp && site) {
        const desig = emp.assignedDesignations[0];
        const nextId = generateSequentialId(
          'ATT',
          allAttendance.map((a) => a.attendanceId)
        );
        const inIso =
          target.requestedCheckInAt ||
          new Date(combineDateAndTimeToMs(target.attendanceDate, '09:00')).toISOString();
        const outIso =
          target.requestedCheckOutAt ||
          new Date(combineDateAndTimeToMs(target.attendanceDate, '18:00')).toISOString();
        const calc = computeCheckOutMetrics({
          attendanceDate: target.attendanceDate,
          scheduledStartTime: '09:00',
          scheduledEndTime: '18:00',
          breakDurationMinutes: 60,
          gracePeriodMinutes: 15,
          checkInIso: inIso,
          checkOutIso: outIso,
        });

        updatedOrCreatedAttendance = {
          attendanceId: nextId,
          employeeId: emp.employeeId,
          employeeName: emp.fullName,
          linkedUid: emp.linkedUid || '',
          employeeUid: emp.linkedUid || emp.employeeId,
          branchId: site.branchId,
          branchName: emp.branchName,
          clientId: site.clientId,
          clientName: site.clientName,
          siteId: site.siteId,
          siteName: site.siteName,
          serviceCategory: desig?.serviceCategory || 'Security',
          serviceId: desig?.serviceId || 'SRV-CORR',
          serviceName: desig?.serviceName || 'General Service',
          designationId: desig?.designationId || 'DSG-CORR',
          designationName: desig?.designationName || 'Personnel',
          assignmentId: target.assignmentId,
          rosterId: target.rosterId,
          attendanceDate: target.attendanceDate,
          date: target.attendanceDate,
          shiftType: target.shiftType,
          scheduledStartTime: '09:00',
          scheduledEndTime: '18:00',
          crossesMidnight: target.requestedCheckOutNextDay,
          breakDurationMinutes: 60,
          gracePeriodMinutes: 15,
          status: calc.derivedStatus,
          checkInAt: inIso,
          checkOutAt: outIso,
          checkInMethod: 'Manual_HR',
          checkOutMethod: 'Manual_HR',
          checkInGeo: null,
          checkOutGeo: null,
          qrSessionId: '',
          qrVerificationStatus: '',
          deviceMetadata: null,
          totalGrossMinutes: calc.totalGrossMinutes,
          totalDutyMinutes: calc.totalDutyMinutes,
          totalDutyHours: calc.totalDutyHours,
          lateArrivalMinutes: calc.lateArrivalMinutes,
          earlyDepartureMinutes: calc.earlyDepartureMinutes,
          overtimeMinutes: calc.overtimeMinutes,
          overtimeStatus: calc.overtimeMinutes >= 15 ? 'Pending' : 'None',
          approvedOvertimeMinutes: 0,
          overtimeApprovedBy: null,
          overtimeApprovedAt: null,
          verificationOutcome: 'Manual_Override',
          isVerifiedByHr: true,
          verifiedByUid: caller.uid,
          verifiedByName: caller.fullName,
          verifiedAt: nowIso,
          exceptionReason: target.reason,
          hrRemarks: sanitizeInput(`Correction ${correctionId} Approved: ${reviewRemarks}`, 300),
          fieldOfficerRemarks: '',
          createdBy: caller.uid,
          updatedBy: caller.uid,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
      }
    }
  } else if (matchedAttendance && matchedAttendance.status === 'Exception') {
    updatedOrCreatedAttendance = {
      ...matchedAttendance,
      status: 'Absent',
      verificationOutcome: 'Rejected',
      isVerifiedByHr: true,
      verifiedByUid: caller.uid,
      verifiedByName: caller.fullName,
      verifiedAt: nowIso,
      hrRemarks: sanitizeInput(`Exception Rejected (${correctionId}): ${reviewRemarks}`, 300),
      updatedBy: caller.uid,
      updatedAt: nowIso,
    };
  }

  const notif = buildEmployeeNotificationEntry({
    employeeId: target.employeeId,
    linkedUid: target.linkedUid,
    branchId: target.branchId,
    siteId: target.siteId,
    siteName: target.siteName,
    category: 'Correction Reviewed',
    title: `Attendance Correction ${decision} — ${target.attendanceDate}`,
    message: `${target.requestType} request (${correctionId}) for ${target.siteName} was ${decision.toLowerCase()}. Remarks: ${reviewRemarks}`,
    dutyDate: target.attendanceDate,
    createdAt: nowIso,
  });

  const auditEntry = buildAttendanceAuditEntry(caller, {
    category: 'Correction',
    targetId: correctionId,
    employeeId: target.employeeId,
    siteId: target.siteId,
    branchId: target.branchId,
    action: `Correction ${decision} (${target.requestType})`,
    previousValueSummary: 'Pending Review',
    newValueSummary: `${decision} · ${target.employeeName} (${target.attendanceDate})`,
    reason: reviewRemarks,
    timestamp: nowIso,
  });

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.attendanceCorrections = store.attendanceCorrections.map((c) =>
      c.correctionId === correctionId
        ? {
            ...c,
            status: decision,
            reviewedByUid: caller.uid,
            reviewedByName: caller.fullName,
            reviewRemarks: sanitizeInput(reviewRemarks, 300),
            reviewedAt: nowIso,
            updatedAt: nowIso,
          }
        : c
    );
    if (updatedOrCreatedAttendance) {
      const existsInStore = store.attendance.some(
        (a) => a.attendanceId === updatedOrCreatedAttendance!.attendanceId
      );
      if (existsInStore) {
        store.attendance = store.attendance.map((a) =>
          a.attendanceId === updatedOrCreatedAttendance!.attendanceId
            ? updatedOrCreatedAttendance!
            : a
        );
      } else {
        store.attendance.unshift(updatedOrCreatedAttendance);
      }
    }
    store.employeeNotifications.unshift(notif);
    store.attendanceAuditLogs.unshift(auditEntry);
    writeLocalAttendanceStore(store);

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: auditEntry.action,
      module: 'Attendance',
      recordId: correctionId,
      branchId: target.branchId,
      summary: `${auditEntry.newValueSummary}. Remarks: ${reviewRemarks}`,
    });
    await rebuildSanitizedSiteAttendanceSummary(
      caller,
      isPreviewSession,
      target.siteId,
      target.attendanceDate
    );
    return;
  }

  const path = `attendanceCorrections/${correctionId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'attendanceCorrections', correctionId), {
      status: decision,
      reviewedByUid: caller.uid,
      reviewedByName: caller.fullName,
      reviewRemarks: sanitizeInput(reviewRemarks, 300),
      reviewedAt: nowIso,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    if (updatedOrCreatedAttendance) {
      batch.set(doc(firestoreDb!, 'attendance', updatedOrCreatedAttendance.attendanceId), {
        ...updatedOrCreatedAttendance,
        serverUpdatedAt: serverTimestamp(),
      });
    }
    batch.set(doc(firestoreDb!, 'employeeNotifications', notif.notificationId), {
      ...notif,
      serverCreatedAt: serverTimestamp(),
    });
    batch.set(doc(firestoreDb!, 'attendanceAuditLogs', auditEntry.auditId), {
      ...auditEntry,
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    await recordExternalMasterAudit(caller, isPreviewSession, {
      action: auditEntry.action,
      module: 'Attendance',
      recordId: correctionId,
      branchId: target.branchId,
      summary: `${auditEntry.newValueSummary}. Remarks: ${reviewRemarks}`,
    });
    await rebuildSanitizedSiteAttendanceSummary(
      caller,
      isPreviewSession,
      target.siteId,
      target.attendanceDate
    );
    notifyAttendanceListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 7. EMPLOYEE NOTIFICATIONS & ATTENDANCE AUDIT TRAIL
// ============================================================================
export async function listEmployeeNotifications(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<EmployeeNotificationRecord[]> {
  if (caller.role === 'site') return [];

  let ownEmp: EmployeeRecord | null = null;
  if (caller.role === 'employee') {
    ownEmp = await getOwnEmployeeRecord(caller, isPreviewSession);
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    if (caller.role === 'employee') {
      return store.employeeNotifications
        .filter(
          (n) =>
            n.linkedUid === caller.uid ||
            (ownEmp && n.employeeId === ownEmp.employeeId)
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    if (caller.role === 'admin') {
      return [...store.employeeNotifications].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
    }
    return store.employeeNotifications
      .filter((n) => canCallerAccessBranchForAttendance(caller, n.branchId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const path = 'employeeNotifications';
  try {
    const q =
      caller.role === 'employee'
        ? query(collection(firestoreDb!, path), where('linkedUid', '==', caller.uid))
        : query(collection(firestoreDb!, path));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as EmployeeNotificationRecord)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function markEmployeeNotificationRead(
  caller: RexonUser,
  isPreviewSession: boolean,
  notificationId: string
): Promise<void> {
  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    store.employeeNotifications = store.employeeNotifications.map((n) =>
      n.notificationId === notificationId ? { ...n, isRead: true } : n
    );
    writeLocalAttendanceStore(store);
    return;
  }

  const path = `employeeNotifications/${notificationId}`;
  try {
    await updateDoc(doc(firestoreDb!, 'employeeNotifications', notificationId), {
      isRead: true,
    });
    notifyAttendanceListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function listAttendanceAuditLogs(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<AttendanceAuditRecord[]> {
  assertNotSitePortal(caller);
  if (caller.role === 'employee') return [];

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalAttendanceStore();
    if (caller.role === 'admin') {
      return [...store.attendanceAuditLogs].sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp)
      );
    }
    if (caller.role === 'hr') {
      return store.attendanceAuditLogs
        .filter((l) => canCallerAccessBranchForAttendance(caller, l.branchId))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }
    return store.attendanceAuditLogs
      .filter((l) => caller.assignedSiteIds.includes(l.siteId))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  const path = 'attendanceAuditLogs';
  try {
    let q;
    if (caller.role === 'admin' || (caller.role === 'hr' && hasUserPermission(caller, 'attendance.view_all_branch'))) {
      q = query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      const branches = getAuthorizedBranchIds(caller);
      if (branches.length === 0) return [];
      q = query(collection(firestoreDb!, path), where('branchId', 'in', branches.slice(0, 10)));
    } else {
      if (!caller.assignedSiteIds || caller.assignedSiteIds.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('siteId', 'in', caller.assignedSiteIds.slice(0, 10))
      );
    }
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as AttendanceAuditRecord)
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

// ============================================================================
// 8. SANITIZED SITE PORTAL ATTENDANCE SUMMARY READER
//    Strictly headcount-only — ZERO employee names, phone, KYC, salary, or GPS!
// ============================================================================
export async function getSitePortalAttendanceSummaries(
  caller: RexonUser,
  isPreviewSession: boolean,
  targetDate?: string
): Promise<SanitizedSiteAttendanceSummaryRecord[]> {
  const authorizedSiteIds =
    caller.role === 'admin'
      ? (await listSites(caller, isPreviewSession)).map((s) => s.siteId)
      : caller.assignedSiteIds || [];

  if (authorizedSiteIds.length === 0) return [];

  if (!useLiveFirestore(isPreviewSession)) {
    const dateToEnsure = targetDate && isValidIsoDate(targetDate) ? targetDate : getTodayIsoDate();
    for (const sId of authorizedSiteIds.slice(0, 10)) {
      await rebuildSanitizedSiteAttendanceSummary(caller, isPreviewSession, sId, dateToEnsure);
    }
    const store = readLocalAttendanceStore();
    return Object.values(store.siteAttendanceSummaries)
      .filter((sum) => {
        if (!authorizedSiteIds.includes(sum.siteId)) return false;
        if (targetDate && sum.attendanceDate !== targetDate) return false;
        return true;
      })
      .sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate));
  }

  const path = 'siteAttendanceSummaries';
  try {
    const q =
      caller.role === 'admin'
        ? query(collection(firestoreDb!, path))
        : query(
            collection(firestoreDb!, path),
            where('siteId', 'in', authorizedSiteIds.slice(0, 10))
          );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as SanitizedSiteAttendanceSummaryRecord)
      .filter((sum) => (!targetDate ? true : sum.attendanceDate === targetDate))
      .sort((a, b) => (b.attendanceDate || '').localeCompare(a.attendanceDate || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}
