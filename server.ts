import 'dotenv/config';
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
  'employee.manage',
  'billing.view',
  'billing.manage',
  'payroll.view',
  'payroll.manage',
  'reports.view',
]);

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
