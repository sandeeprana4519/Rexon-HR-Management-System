import React from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { PortalLayout } from '../layouts/PortalLayout';
import { AdminDashboard } from '../pages/admin/AdminDashboard';
import { AdminSettingsPage } from '../pages/admin/AdminSettingsPage';
import { AuditLogsPage } from '../pages/admin/AuditLogsPage';
import { BranchManagementPage } from '../pages/admin/BranchManagementPage';
import { HRManagementPage } from '../pages/admin/HRManagementPage';
import { PermissionManagementPage } from '../pages/admin/PermissionManagementPage';
import { ForgotPasswordPage } from '../pages/common/ForgotPasswordPage';
import { PortalLoginPage } from '../pages/common/PortalLoginPage';
import { ProfilePage } from '../pages/common/ProfilePage';
import { UnauthorizedPage } from '../pages/common/UnauthorizedPage';
import { EmployeeDashboard } from '../pages/employee/EmployeeDashboard';
import { MyAssignmentsPage } from '../pages/employee/MyAssignmentsPage';
import { MyAttendancePage } from '../pages/employee/MyAttendancePage';
import { FieldOfficerDashboard } from '../pages/fieldOfficer/FieldOfficerDashboard';
import { HRDashboard } from '../pages/hr/HRDashboard';
import { ServiceAndDesignationPage } from '../pages/hr/ServiceAndDesignationPage';
import { ApprovalsPage } from '../pages/shared/ApprovalsPage';
import { AttendanceManagementPage } from '../pages/shared/AttendanceManagementPage';
import { ClientManagementPage } from '../pages/shared/ClientManagementPage';
import { DeploymentDashboardPage } from '../pages/shared/DeploymentDashboardPage';
import { DesignationManagementPage } from '../pages/shared/DesignationManagementPage';
import { DutyRosterPage } from '../pages/shared/DutyRosterPage';
import { EmployeeAvailabilityPage } from '../pages/shared/EmployeeAvailabilityPage';
import { EmployeeManagementPage } from '../pages/shared/EmployeeManagementPage';
import { EmployeeProfilePage } from '../pages/shared/EmployeeProfilePage';
import { MasterReportsPage } from '../pages/shared/MasterReportsPage';
import { ServiceManagementPage } from '../pages/shared/ServiceManagementPage';
import { SiteAssignmentPage } from '../pages/shared/SiteAssignmentPage';
import { SiteManagementPage } from '../pages/shared/SiteManagementPage';
import { SiteAttendanceSummaryPage } from '../pages/site/SiteAttendanceSummaryPage';
import { SiteDashboard } from '../pages/site/SiteDashboard';
import { SiteManpowerSummaryPage } from '../pages/site/SiteManpowerSummaryPage';
import { PORTAL_METADATA, hasUserPermission } from '../utils/portalConfig';
import { ProtectedRoute } from './ProtectedRoute';

interface HRPermissionGuardProps {
  anyOf: string[];
  moduleLabel: string;
  children: React.ReactNode;
}

const HRPermissionGuard: React.FC<HRPermissionGuardProps> = ({
  anyOf,
  moduleLabel,
  children,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const isAllowed = anyOf.some((perm) => hasUserPermission(user, perm));

  if (!isAllowed) {
    return (
      <div className="max-w-xl mx-auto my-12 bg-white border border-[#E5DDD2] rounded-xl p-6 sm:p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-center mx-auto text-[#B91C1C]">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="font-display text-xl font-bold text-[#1F1916]">
          Module Permission Required
        </h2>
        <p className="text-sm text-[#574B43]">
          Your HR account does not currently hold the required permission (
          <code className="font-mono-tabular font-semibold text-[#5C3D2E]">
            {anyOf.join(' or ')}
          </code>
          ) to access <strong>{moduleLabel}</strong>. Contact an Administrator or submit a
          Permission Change Request.
        </p>
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/hr')}
            className="min-h-[42px] px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#F3EDE4] whitespace-nowrap"
          >
            Back to HR Dashboard
          </button>
          <button
            type="button"
            onClick={() => navigate('/hr/approvals')}
            className="min-h-[42px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] whitespace-nowrap"
          >
            Request Permission Change
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Root "/" opens Admin Portal Login Page by default */}
      <Route path="/" element={<PortalLoginPage portalRole="admin" />} />

      {/* Dedicated Login Page for each of the Five Portals */}
      <Route path="/admin/login" element={<PortalLoginPage portalRole="admin" />} />
      <Route path="/hr/login" element={<PortalLoginPage portalRole="hr" />} />
      <Route path="/field-officer/login" element={<PortalLoginPage portalRole="field_officer" />} />
      <Route path="/site/login" element={<PortalLoginPage portalRole="site" />} />
      <Route path="/employee/login" element={<PortalLoginPage portalRole="employee" />} />

      {/* Common Auth Utility Screens */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />

      {/* 1. ADMIN PORTAL ("/admin") */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRole="admin">
            <PortalLayout portal={PORTAL_METADATA.admin} />
          </ProtectedRoute>
        }
      >
        <Route index element={<AdminDashboard section="overview" />} />
        <Route path="branches" element={<BranchManagementPage />} />
        <Route path="hr-management" element={<HRManagementPage />} />
        <Route path="clients" element={<ClientManagementPage />} />
        <Route path="sites" element={<SiteManagementPage />} />
        <Route path="employees" element={<EmployeeManagementPage />} />
        <Route path="employees/:employeeId" element={<EmployeeProfilePage />} />
        <Route path="assignments" element={<SiteAssignmentPage />} />
        <Route path="rosters" element={<DutyRosterPage />} />
        <Route path="attendance" element={<AttendanceManagementPage />} />
        <Route path="deployment" element={<DeploymentDashboardPage />} />
        <Route path="availability" element={<EmployeeAvailabilityPage />} />
        <Route path="services" element={<ServiceManagementPage />} />
        <Route path="designations" element={<DesignationManagementPage />} />
        <Route path="permissions" element={<PermissionManagementPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="audit-logs" element={<AuditLogsPage />} />
        <Route path="reports" element={<MasterReportsPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/* 2. HR PORTAL ("/hr") */}
      <Route
        path="/hr"
        element={
          <ProtectedRoute allowedRole="hr">
            <PortalLayout portal={PORTAL_METADATA.hr} />
          </ProtectedRoute>
        }
      >
        <Route index element={<HRDashboard section="overview" />} />
        <Route
          path="clients"
          element={
            <HRPermissionGuard anyOf={['client.view']} moduleLabel="Client Management">
              <ClientManagementPage />
            </HRPermissionGuard>
          }
        />
        <Route
          path="sites"
          element={
            <HRPermissionGuard anyOf={['site.view']} moduleLabel="Site Management">
              <SiteManagementPage />
            </HRPermissionGuard>
          }
        />
        <Route
          path="employees"
          element={
            <HRPermissionGuard
              anyOf={['employee.view', 'employee.manage']}
              moduleLabel="Employee Management"
            >
              <EmployeeManagementPage />
            </HRPermissionGuard>
          }
        />
        <Route
          path="employees/:employeeId"
          element={
            <HRPermissionGuard
              anyOf={['employee.view', 'employee.manage']}
              moduleLabel="Employee Profile"
            >
              <EmployeeProfilePage />
            </HRPermissionGuard>
          }
        />
        <Route
          path="assignments"
          element={
            <HRPermissionGuard
              anyOf={['assignment.view', 'assignment.manage']}
              moduleLabel="Site Assignments"
            >
              <SiteAssignmentPage />
            </HRPermissionGuard>
          }
        />
        <Route
          path="rosters"
          element={
            <HRPermissionGuard
              anyOf={['roster.view', 'roster.create', 'roster.edit', 'roster.publish']}
              moduleLabel="Duty Roster Management"
            >
              <DutyRosterPage />
            </HRPermissionGuard>
          }
        />
        <Route
          path="attendance"
          element={
            <HRPermissionGuard
              anyOf={[
                'attendance.view',
                'attendance.create',
                'attendance.edit',
                'attendance.verify',
                'attendance.approve',
                'attendance.correct',
              ]}
              moduleLabel="Attendance & Duty Management"
            >
              <AttendanceManagementPage />
            </HRPermissionGuard>
          }
        />
        <Route
          path="deployment"
          element={
            <HRPermissionGuard
              anyOf={['assignment.view', 'assignment.manage']}
              moduleLabel="Deployment Dashboard"
            >
              <DeploymentDashboardPage />
            </HRPermissionGuard>
          }
        />
        <Route
          path="availability"
          element={
            <HRPermissionGuard
              anyOf={['assignment.view', 'assignment.manage']}
              moduleLabel="Employee Availability"
            >
              <EmployeeAvailabilityPage />
            </HRPermissionGuard>
          }
        />
        <Route
          path="services-designations"
          element={
            <HRPermissionGuard
              anyOf={['service.view', 'designation.view']}
              moduleLabel="Service & Designation Catalog"
            >
              <ServiceAndDesignationPage />
            </HRPermissionGuard>
          }
        />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route
          path="reports"
          element={
            <HRPermissionGuard anyOf={['reports.view']} moduleLabel="Branch Reports">
              <MasterReportsPage />
            </HRPermissionGuard>
          }
        />
        <Route path="clients-sites" element={<Navigate to="/hr/clients" replace />} />
        <Route path="workforce" element={<Navigate to="/hr/employees" replace />} />
        <Route path="requests" element={<HRDashboard section="requests" />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/* 3. FIELD OFFICER PORTAL ("/field-officer") */}
      <Route
        path="/field-officer"
        element={
          <ProtectedRoute allowedRole="field_officer">
            <PortalLayout portal={PORTAL_METADATA.field_officer} />
          </ProtectedRoute>
        }
      >
        <Route index element={<FieldOfficerDashboard section="overview" />} />
        <Route path="assignments" element={<SiteAssignmentPage />} />
        <Route path="rosters" element={<DutyRosterPage />} />
        <Route path="attendance" element={<AttendanceManagementPage />} />
        <Route path="deployment" element={<DeploymentDashboardPage />} />
        <Route path="availability" element={<EmployeeAvailabilityPage />} />
        <Route path="employees" element={<EmployeeManagementPage fieldOfficerView />} />
        <Route path="employees/:employeeId" element={<EmployeeProfilePage />} />
        <Route path="sites" element={<FieldOfficerDashboard section="sites" />} />
        <Route path="inspections" element={<FieldOfficerDashboard section="inspections" />} />
        <Route path="incidents" element={<FieldOfficerDashboard section="incidents" />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/* 4. SITE PORTAL ("/site") — Strictly No Employee Management Access */}
      <Route
        path="/site"
        element={
          <ProtectedRoute allowedRole="site">
            <PortalLayout portal={PORTAL_METADATA.site} />
          </ProtectedRoute>
        }
      >
        <Route index element={<SiteDashboard section="overview" />} />
        <Route path="manpower" element={<SiteManpowerSummaryPage />} />
        <Route path="attendance" element={<SiteAttendanceSummaryPage />} />
        <Route path="billing" element={<SiteDashboard section="billing" />} />
        <Route path="reports" element={<SiteDashboard section="reports" />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/* 5. EMPLOYEE PORTAL ("/employee") */}
      <Route
        path="/employee"
        element={
          <ProtectedRoute allowedRole="employee">
            <PortalLayout portal={PORTAL_METADATA.employee} />
          </ProtectedRoute>
        }
      >
        <Route index element={<EmployeeDashboard section="overview" />} />
        <Route path="assignments" element={<MyAssignmentsPage />} />
        <Route path="my-record" element={<EmployeeProfilePage selfView />} />
        <Route path="attendance" element={<MyAttendancePage />} />
        <Route path="requests" element={<EmployeeDashboard section="requests" />} />
        <Route path="documents" element={<EmployeeDashboard section="documents" />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/* Fallback Redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
