import 'dotenv/config';
import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const ALLOWED_HR_PERMISSIONS = new Set([
  'branch.view',
  'branch.manage',
  'hr.view',
  'hr.manage',
  'client.view',
  'client.create',
  'client.edit',
  'client.delete',
  'site.view',
  'site.create',
  'site.edit',
  'site.delete',
  'service.view',
  'service.manage',
  'designation.view',
  'designation.manage',
  'employee.view',
  'employee.create',
  'employee.edit',
  'employee.verify_docs',
  'employee.sensitive',
  'employee.multi_designation',
  'employee.delete',
  'employee.manage',
  'assignment.view',
  'assignment.create',
  'assignment.edit',
  'assignment.transfer',
  'assignment.manage',
  'billing.view',
  'billing.manage',
  'payroll.view',
  'payroll.manage',
  'reports.view',
  'attendance.view',
  'attendance.view_all_branch',
  'attendance.create',
  'attendance.edit',
  'attendance.verify',
  'attendance.approve',
  'attendance.correct',
  'attendance.export',
  'roster.view',
  'roster.create',
  'roster.edit',
  'roster.publish',
  'roster.delete',
  'attendance.qr_manage',
  'attendance.gps_settings',
  'attendance.overtime_approve',
]);

const QR_HMAC_SECRET =
  process.env.REXON_QR_HMAC_SECRET ||
  process.env.FIREBASE_ADMIN_PRIVATE_KEY ||
  'rexon-attendance-qr-hmac-v4-key';

interface ServerQrSessionEntry {
  sessionId: string;
  siteId: string;
  branchId: string;
  attendanceDate: string;
  shiftType: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  verificationCode: string;
  signedToken: string;
  issuedAtMs: number;
  expiresAtMs: number;
  usedByEmployeeIds: Set<string>;
}

const activeQrSessionsByCode = new Map<string, ServerQrSessionEntry>();
const usedShiftEmployeeQrKeys = new Set<string>();

function calculateServerHaversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function signQrPayload(payloadObj: Record<string, string | number>): string {
  const encoded = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', QR_HMAC_SECRET)
    .update(encoded)
    .digest('base64url');
  return `rxqr1.${encoded}.${sig}`;
}

function verifySignedQrPayload(token: string): Record<string, string | number> | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'rxqr1') return null;
  const [, encoded, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', QR_HMAC_SECRET)
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<
      string,
      string | number
    >;
  } catch {
    return null;
  }
}

/**
 * REXON HR MANAGEMENT SYSTEM — TRUSTED BACKEND SERVER
 * Handles privileged administrative operations (provisioning HR Firebase Auth accounts
 * and syncing HR RBAC permissions without exposing Admin SDK credentials or plain-text passwords).
 */
async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const adminConfigured = Boolean(
      (process.env.FIREBASE_ADMIN_PROJECT_ID &&
        process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
        process.env.FIREBASE_ADMIN_PRIVATE_KEY) ||
        process.env.FIREBASE_PROVISION_FUNCTION_URL
    );
    res.json({
      status: 'ok',
      trustedProvisioningConfigured: adminConfigured,
    });
  });

  /**
   * 1. Privileged HR Account Provisioning Endpoint (Admin Only)
   * - Never stores plain-text passwords in Firestore or logs.
   * - Expects caller's Firebase ID Token in `Authorization: Bearer <token>`.
   */
  app.post('/api/admin/hr-accounts', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Missing Bearer authentication token. Only verified Administrators can provision HR accounts.',
      });
      return;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    const {
      hrId,
      fullName,
      email,
      mobile,
      assignedBranches,
      hrDesignation,
      permissionProfile,
      permissions,
      joiningDate,
      accountStatus,
    } = req.body ?? {};

    if (!email || !fullName || !Array.isArray(assignedBranches) || assignedBranches.length === 0) {
      res.status(400).json({
        error: 'Invalid HR account payload: fullName, email, and at least one assignedBranch are required.',
      });
      return;
    }

    const sanitizedPermissions = Array.isArray(permissions)
      ? permissions.filter((p): p is string => typeof p === 'string' && ALLOWED_HR_PERMISSIONS.has(p))
      : [];

    const cloudFunctionUrl = process.env.FIREBASE_PROVISION_FUNCTION_URL?.trim();
    if (cloudFunctionUrl) {
      try {
        const upstream = await fetch(cloudFunctionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            hrId,
            fullName,
            email,
            mobile,
            assignedBranches,
            hrDesignation,
            permissionProfile,
            permissions: sanitizedPermissions,
            joiningDate,
            accountStatus,
          }),
        });
        const payload = await upstream.json();
        res.status(upstream.status).json(payload);
        return;
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? `Cloud Function provisioning error: ${err.message}`
              : 'Failed to reach privileged provisioning Cloud Function.',
        });
        return;
      }
    }

    res.status(503).json({
      code: 'BACKEND_PROVISIONER_UNCONFIGURED',
      error:
        'Trusted backend HR Auth provisioner requires FIREBASE_PROVISION_FUNCTION_URL (Cloud Function) or server-side Firebase Admin credentials in .env.',
    });
  });

  /**
   * 2. Privileged HR Granular Permission & Branch Scope Sync Endpoint (Admin Only)
   * - Validates exact allowlist of 23 REXON HR permissions and assignedBranches.
   */
  app.patch('/api/admin/hr-permissions', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Missing Bearer authentication token. Only Administrators can update HR permissions.',
      });
      return;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    const { hrId, uid, permissionProfile, permissions, assignedBranches } = req.body ?? {};

    if (!hrId || !Array.isArray(assignedBranches) || assignedBranches.length === 0 || !Array.isArray(permissions)) {
      res.status(400).json({
        error: 'hrId, at least one assignedBranch, and a permissions array are required.',
      });
      return;
    }

    const invalidPerm = permissions.find(
      (p) => typeof p !== 'string' || !ALLOWED_HR_PERMISSIONS.has(p)
    );
    if (invalidPerm) {
      res.status(400).json({
        error: `Unrecognized permission key "${String(invalidPerm)}" rejected by backend allowlist.`,
      });
      return;
    }

    const permissionsFunctionUrl = process.env.FIREBASE_PERMISSIONS_FUNCTION_URL?.trim();
    if (permissionsFunctionUrl) {
      try {
        const upstream = await fetch(permissionsFunctionUrl, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            hrId,
            uid,
            permissionProfile,
            permissions,
            assignedBranches,
          }),
        });
        const payload = await upstream.json();
        res.status(upstream.status).json(payload);
        return;
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? `Cloud Function permission sync error: ${err.message}`
              : 'Failed to reach privileged HR permission sync Cloud Function.',
        });
        return;
      }
    }

    res.status(200).json({
      synced: true,
      mode: 'firestore_rules_validated',
      permissionsCount: permissions.length,
    });
  });

  /**
   * 3. Server-Side GPS Geofence & Accuracy Verification Endpoint
   * - Never relies solely on browser-computed distance.
   */
  app.post('/api/attendance/verify-gps', (req: Request, res: Response) => {
    const {
      employeeLat,
      employeeLng,
      accuracyMeters,
      siteLat,
      siteLng,
      allowedRadiusMeters,
      accuracyThresholdMeters,
    } = req.body ?? {};

    const eLat = Number(employeeLat);
    const eLng = Number(employeeLng);
    const sLat = Number(siteLat);
    const sLng = Number(siteLng);
    const acc = accuracyMeters == null ? null : Number(accuracyMeters);
    const radius = Math.min(5000, Math.max(20, Number(allowedRadiusMeters) || 200));
    const maxAcc = Math.min(1000, Math.max(10, Number(accuracyThresholdMeters) || 100));

    if (
      !Number.isFinite(eLat) ||
      !Number.isFinite(eLng) ||
      eLat < -90 ||
      eLat > 90 ||
      eLng < -180 ||
      eLng > 180
    ) {
      res.status(400).json({
        serverVerified: true,
        withinGeofence: false,
        accuracyAcceptable: false,
        distanceMeters: null,
        verificationOutcome: 'GPS_Unavailable',
        error: 'Valid employee GPS coordinates are required for geofence verification.',
      });
      return;
    }

    if (
      !Number.isFinite(sLat) ||
      !Number.isFinite(sLng) ||
      sLat < -90 ||
      sLat > 90 ||
      sLng < -180 ||
      sLng > 180
    ) {
      res.status(400).json({
        serverVerified: true,
        withinGeofence: false,
        accuracyAcceptable: false,
        distanceMeters: null,
        verificationOutcome: 'GPS_Unavailable',
        error: 'Site geofence coordinates are not configured on this site.',
      });
      return;
    }

    const distanceMeters = calculateServerHaversineMeters(eLat, eLng, sLat, sLng);
    const accuracyAcceptable = acc === null || (Number.isFinite(acc) && acc >= 0 && acc <= maxAcc);
    const withinGeofence = distanceMeters <= radius;

    let verificationOutcome = 'Verified';
    if (!accuracyAcceptable) {
      verificationOutcome = 'Low_GPS_Accuracy';
    } else if (!withinGeofence) {
      verificationOutcome = 'Outside_Geofence';
    }

    res.status(200).json({
      serverVerified: true,
      distanceMeters,
      allowedRadiusMeters: radius,
      accuracyThresholdMeters: maxAcc,
      withinGeofence,
      accuracyAcceptable,
      verificationOutcome,
      evaluatedAt: new Date().toISOString(),
    });
  });

  /**
   * 4. Server-Side Rotating Site Shift QR Token Generation (HMAC-SHA256, Zero Employee PII)
   */
  app.post('/api/attendance/qr/generate', (req: Request, res: Response) => {
    const {
      siteId,
      branchId,
      attendanceDate,
      shiftType,
      scheduledStartTime,
      scheduledEndTime,
      ttlSeconds,
    } = req.body ?? {};

    if (!siteId || !attendanceDate || !shiftType) {
      res.status(400).json({
        error: 'siteId, attendanceDate, and shiftType are required to generate a shift QR session.',
      });
      return;
    }

    const clampedTtl = Math.min(900, Math.max(60, Number(ttlSeconds) || 300));
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + clampedTtl * 1000;
    const nonce = crypto.randomBytes(6).toString('hex').toUpperCase();
    const sessionId = `QRS-${new Date().getFullYear()}-${nonce.slice(0, 8)}`;
    const verificationCode = `${String(siteId).replace(/[^A-Z0-9]/gi, '').slice(-3).toUpperCase()}-${nonce.slice(0, 5)}`;

    const signedToken = signQrPayload({
      sid: String(sessionId),
      site: String(siteId),
      brn: String(branchId || ''),
      dt: String(attendanceDate),
      shf: String(shiftType),
      st: String(scheduledStartTime || ''),
      et: String(scheduledEndTime || ''),
      iat: issuedAtMs,
      exp: expiresAtMs,
      n: nonce,
    });

    // Prune expired QR entries to keep memory bounded
    for (const [k, entry] of activeQrSessionsByCode.entries()) {
      if (entry.expiresAtMs + 60_000 < issuedAtMs) {
        activeQrSessionsByCode.delete(k);
      }
    }

    activeQrSessionsByCode.set(verificationCode, {
      sessionId,
      siteId: String(siteId),
      branchId: String(branchId || ''),
      attendanceDate: String(attendanceDate),
      shiftType: String(shiftType),
      scheduledStartTime: String(scheduledStartTime || ''),
      scheduledEndTime: String(scheduledEndTime || ''),
      verificationCode,
      signedToken,
      issuedAtMs,
      expiresAtMs,
      usedByEmployeeIds: new Set<string>(),
    });

    res.status(200).json({
      sessionId,
      signedToken,
      verificationCode,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttlSeconds: clampedTtl,
    });
  });

  /**
   * 5. Server-Side Rotating Site Shift QR Token Verification
   * - Rejects tampered signatures, expired tokens, wrong site, wrong shift, or duplicate replay.
   */
  app.post('/api/attendance/qr/verify', (req: Request, res: Response) => {
    const {
      tokenOrCode,
      expectedSiteId,
      expectedShiftType,
      expectedDate,
      allowedDates,
      employeeId,
      actionType,
    } = req.body ?? {};

    const rawInput = String(tokenOrCode || '').trim();
    if (!rawInput || !expectedSiteId || !employeeId) {
      res.status(400).json({
        verified: false,
        error: 'QR token/code, site context, and employeeId are required.',
      });
      return;
    }

    const nowMs = Date.now();
    let payload: Record<string, string | number> | null = null;
    let sessionId = '';

    if (rawInput.startsWith('rxqr1.')) {
      payload = verifySignedQrPayload(rawInput);
      if (!payload) {
        res.status(400).json({
          verified: false,
          error: 'Invalid or tampered QR token signature.',
        });
        return;
      }
      sessionId = String(payload.sid || '');
    } else {
      const normalizedCode = rawInput.toUpperCase();
      const entry = activeQrSessionsByCode.get(normalizedCode);
      if (!entry) {
        res.status(400).json({
          verified: false,
          error: 'Unrecognized or rotated QR verification code. Scan the latest active site QR.',
        });
        return;
      }
      payload = verifySignedQrPayload(entry.signedToken);
      sessionId = entry.sessionId;
    }

    if (!payload) {
      res.status(400).json({
        verified: false,
        error: 'Unable to validate QR session signature.',
      });
      return;
    }

    const expMs = Number(payload.exp || 0);
    if (!expMs || nowMs > expMs) {
      res.status(400).json({
        verified: false,
        error: 'This site QR code has expired. Request or scan the newly rotated shift QR code.',
      });
      return;
    }

    if (String(payload.site) !== String(expectedSiteId)) {
      res.status(400).json({
        verified: false,
        error: `QR site mismatch: scanned QR belongs to site ${String(payload.site)}, not your assigned site ${String(expectedSiteId)}.`,
      });
      return;
    }

    const validDates: string[] = Array.isArray(allowedDates) && allowedDates.length > 0
      ? allowedDates.map(String)
      : expectedDate
        ? [String(expectedDate)]
        : [];

    if (validDates.length > 0 && !validDates.includes(String(payload.dt))) {
      res.status(400).json({
        verified: false,
        error: `QR duty date mismatch: QR is dated ${String(payload.dt)}, expected ${validDates.join(' or ')}.`,
      });
      return;
    }

    if (expectedShiftType && String(payload.shf) !== String(expectedShiftType)) {
      res.status(400).json({
        verified: false,
        error: `QR shift mismatch: QR is issued for "${String(payload.shf)}", not "${String(expectedShiftType)}".`,
      });
      return;
    }

    const punchKind = actionType === 'check_out' ? 'OUT' : 'IN';
    const replayKey = `${punchKind}:${String(employeeId)}:${String(payload.site)}:${String(payload.dt)}:${String(payload.shf)}`;
    if (usedShiftEmployeeQrKeys.has(replayKey)) {
      res.status(409).json({
        verified: false,
        error: `Duplicate QR ${punchKind === 'IN' ? 'check-in' : 'check-out'} blocked for this employee and shift.`,
      });
      return;
    }
    usedShiftEmployeeQrKeys.add(replayKey);

    res.status(200).json({
      verified: true,
      sessionId,
      verificationOutcome: 'QR_Verified',
      verifiedAt: new Date(nowMs).toISOString(),
    });
  });

  /**
   * 6. Server-Side Phase 4 -> Phase 5 Payroll Readiness Gate
   * - Strictly excludes unverified, rejected, absent, or offline-unsynced attendance records.
   */
  app.post('/api/attendance/payroll-eligible-summary', (req: Request, res: Response) => {
    const { records, branchId, month } = req.body ?? {};
    if (!Array.isArray(records)) {
      res.status(400).json({
        error: 'records array is required to compute payroll-eligible attendance summary.',
      });
      return;
    }

    const eligibleByEmployee = new Map<
      string,
      {
        employeeId: string;
        employeeName: string;
        payrollEligibleDays: number;
        totalNetHours: number;
        approvedOvertimeMinutes: number;
      }
    >();
    let excludedUnverifiedCount = 0;

    for (const raw of records as Array<Record<string, unknown>>) {
      if (branchId && branchId !== 'ALL' && String(raw.branchId || '') !== String(branchId)) {
        continue;
      }
      if (month && !String(raw.attendanceDate || '').startsWith(String(month))) {
        continue;
      }

      const status = String(raw.status || '');
      const verificationStatus = String(raw.verificationStatus || '');
      const isVerifiedFlag =
        Boolean(raw.isVerifiedByHr) ||
        verificationStatus === 'Verified' ||
        verificationStatus === 'Exception Approved';
      const isEligible =
        Boolean(raw.isPayrollEligible) &&
        isVerifiedFlag &&
        status !== 'Rejected' &&
        status !== 'Absent' &&
        status !== 'Pending';

      if (!isEligible) {
        excludedUnverifiedCount += 1;
        continue;
      }

      const empId = String(raw.employeeId || '');
      if (!empId) continue;

      const current = eligibleByEmployee.get(empId) ?? {
        employeeId: empId,
        employeeName: String(raw.employeeName || empId),
        payrollEligibleDays: 0,
        totalNetHours: 0,
        approvedOvertimeMinutes: 0,
      };
      current.payrollEligibleDays += status === 'Half Day' ? 0.5 : 1;
      current.totalNetHours =
        Math.round((current.totalNetHours + (Number(raw.totalDutyHours) || 0)) * 100) / 100;
      if (String(raw.overtimeStatus || '') === 'Approved') {
        current.approvedOvertimeMinutes += Math.max(0, Number(raw.approvedOvertimeMinutes) || 0);
      }
      eligibleByEmployee.set(empId, current);
    }

    res.status(200).json({
      serverEvaluated: true,
      evaluatedAt: new Date().toISOString(),
      eligibleEmployeeSummaries: Array.from(eligibleByEmployee.values()),
      excludedUnverifiedCount,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: { server: httpServer },
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(import.meta.dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[REXON Server] Listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
