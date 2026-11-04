import React, { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRightLeft,
  Award,
  BarChart3,
  Briefcase,
  Building2,
  CalendarCheck,
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCheck,
  UserCircle,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FirebaseStatusBanner } from '../components/FirebaseStatusBanner';
import { OfflineIndicator } from '../components/OfflineIndicator';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { RexonBrandMark } from '../components/RexonBrandMark';
import { useAuth } from '../hooks/useAuth';
import { PortalMetadata, PortalNavItem } from '../types';

const ICON_MAP: Record<PortalNavItem['iconName'], React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Building2,
  UserCog,
  ShieldCheck,
  Users,
  Briefcase,
  FileSpreadsheet,
  MapPin,
  ClipboardCheck,
  AlertTriangle,
  CalendarCheck,
  Receipt,
  FileText,
  Wallet,
  UserCircle,
  Layers,
  Award,
  KeyRound,
  ScrollText,
  BarChart3,
  Settings,
  ArrowRightLeft,
  UserCheck,
};

interface PortalLayoutProps {
  portal: PortalMetadata;
}

export const PortalLayout: React.FC<PortalLayoutProps> = ({ portal }) => {
  const { user, logout, isPreviewSession } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const currentNavItem =
    portal.navItems.find((item) =>
      item.path === portal.basePath
        ? location.pathname === portal.basePath
        : location.pathname.startsWith(item.path)
    ) ?? portal.navItems[0];

  const handleConfirmLogout = async () => {
    setLoggingOut(true);
    try {
      const targetLoginPath = await logout();
      setLogoutConfirmOpen(false);
      navigate(targetLoginPath, { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] text-[#1F1916]">
      {/* Non-sticky top configuration banner when Firebase env vars are missing */}
      <FirebaseStatusBanner />

      <div className="flex-1 flex min-h-0">
        {/* Desktop Sidebar (264px) */}
        <aside className="hidden lg:flex lg:w-[264px] lg:flex-col lg:shrink-0 bg-[#F3EDE4] border-r border-[#E5DDD2]">
          <div className="h-16 px-5 flex items-center border-b border-[#E5DDD2]">
            <Link to={portal.basePath} className="focus-visible:outline-2 focus-visible:outline-[#5C3D2E] rounded">
              <RexonBrandMark compact />
            </Link>
          </div>

          <div className="px-5 py-4 border-b border-[#E5DDD2]">
            <p className="font-display text-sm font-semibold text-[#1F1916] truncate">
              {portal.portalName}
            </p>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-[#574B43] truncate">
              <span>Branch {user?.branchId ?? '—'}</span>
              <span aria-hidden="true">·</span>
              <span>{isPreviewSession ? 'Preview Session' : 'Verified Role'}</span>
            </div>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label={`${portal.shortTitle} navigation`}>
            {portal.navItems.map((item) => {
              const Icon = ICON_MAP[item.iconName];
              const isEnd = item.path === portal.basePath;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={isEnd}
                  className={({ isActive }) =>
                    `min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-[#5C3D2E] text-[#FAF8F5]'
                        : 'text-[#4A3023] hover:bg-[#EDE3D8] hover:text-[#1F1916]'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="p-4 border-t border-[#E5DDD2] space-y-3">
            <PWAInstallButton fullWidth />

            {user && (
              <div className="px-1 flex items-center gap-2.5">
                {user.profilePhoto ? (
                  <img
                    src={user.profilePhoto}
                    alt={user.fullName}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-lg object-cover border border-[#D4C7B8] shrink-0"
                  />
                ) : (
                  <UserCircle className="w-7 h-7 text-[#5C3D2E] shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#1F1916] truncate">{user.fullName}</p>
                  <p className="text-[11px] font-mono-tabular text-[#7D6F65] truncate">
                    {user.systemId || user.email}
                  </p>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(true)}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#EDE3D8] transition-colors whitespace-nowrap"
            >
              <LogOut className="w-4 h-4 text-[#5C3D2E] shrink-0" />
              <span>Sign Out</span>
            </button>
          </div>
        </aside>

        {/* Main Workspace Column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar (Compact 54px mobile / 64px desktop — adheres to 3-zone SaaS Top Bar Contract) */}
          <header className="sticky top-0 z-30 h-[54px] lg:h-16 bg-white/95 backdrop-blur-xs border-b border-[#E5DDD2] px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="lg:hidden min-h-[42px] min-w-[42px] -ml-2 rounded-lg flex items-center justify-center text-[#1F1916] hover:bg-[#F3EDE4] transition-colors"
                aria-label="Open navigation menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 text-sm min-w-0">
                <span className="font-medium text-[#7D6F65] hidden sm:inline whitespace-nowrap">
                  {portal.shortTitle}
                </span>
                <span className="text-[#D4C7B8] hidden sm:inline" aria-hidden="true">
                  /
                </span>
                <span className="font-display font-semibold text-[#1F1916] truncate">
                  {currentNavItem.label}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <Link
                to={`${portal.basePath}/profile`}
                className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#FAF8F5] border border-[#E5DDD2] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap shrink-0"
              >
                {user?.profilePhoto ? (
                  <img
                    src={user.profilePhoto}
                    alt={user.fullName}
                    referrerPolicy="no-referrer"
                    className="w-5 h-5 rounded-full object-cover border border-[#D4C7B8] shrink-0"
                  />
                ) : (
                  <UserCircle className="w-4 h-4 text-[#5C3D2E] shrink-0" />
                )}
                <span className="hidden sm:inline max-w-[160px] truncate">
                  {user?.fullName ?? 'Account Profile'}
                </span>
                <span className="sm:hidden">Profile</span>
              </Link>
            </div>
          </header>

          {/* Main Viewport */}
          <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 pb-24 lg:pb-10 max-w-7xl w-full mx-auto">
            <Outlet />
          </main>

          {/* Quiet Footer (Desktop) */}
          <footer className="hidden lg:flex items-center justify-between px-8 py-4 border-t border-[#E5DDD2] text-xs text-[#7D6F65]">
            <span>REXON Security &amp; Manpower Solution · Master Data &amp; Multi-Portal Governance</span>
            <span>Single-Project Firebase RBAC · Append-Only Audit Trail</span>
          </footer>
        </div>
      </div>

      {/* Mobile Collapsible Navigation Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation drawer"
        >
          <div
            className="fixed inset-0 bg-[#1F1916]/45 backdrop-blur-[1px]"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative z-10 w-[280px] max-w-[85vw] bg-[#F3EDE4] h-full flex flex-col border-r border-[#D4C7B8] shadow-xl">
            <div className="h-14 px-4 flex items-center justify-between border-b border-[#E5DDD2]">
              <RexonBrandMark compact />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="min-h-[42px] min-w-[42px] rounded-lg flex items-center justify-center text-[#574B43] hover:text-[#1F1916]"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 py-3.5 border-b border-[#E5DDD2]">
              <p className="font-display text-sm font-semibold text-[#1F1916]">{portal.portalName}</p>
              <p className="mt-0.5 text-xs text-[#574B43]">
                Branch {user?.branchId ?? '—'} · {user?.role}
              </p>
            </div>

            <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
              {portal.navItems.map((item) => {
                const Icon = ICON_MAP[item.iconName];
                const isEnd = item.path === portal.basePath;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={isEnd}
                    onClick={() => setDrawerOpen(false)}
                    className={({ isActive }) =>
                      `min-h-[46px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-[#5C3D2E] text-[#FAF8F5]'
                          : 'text-[#4A3023] hover:bg-[#EDE3D8]'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            <div className="p-4 border-t border-[#E5DDD2] space-y-2.5">
              <PWAInstallButton fullWidth />
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  setLogoutConfirmOpen(true);
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#1F1916] hover:bg-[#EDE3D8] transition-colors"
              >
                <LogOut className="w-4 h-4 text-[#5C3D2E]" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Fixed Bottom Navigation Bar (52px — Thumb-Friendly Natural Reach Zone) */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-white/95 backdrop-blur-md border-t border-[#E5DDD2]"
        aria-label="Mobile quick navigation"
      >
        <div className="grid grid-cols-5 items-center h-[54px]">
          {portal.navItems.slice(0, 5).map((item) => {
            const Icon = ICON_MAP[item.iconName];
            const isEnd = item.path === portal.basePath;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={isEnd}
                className={({ isActive }) =>
                  `min-h-[48px] flex flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
                    isActive ? 'text-[#5C3D2E] font-semibold' : 'text-[#7D6F65] hover:text-[#1F1916]'
                  }`
                }
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span className="text-[10px] tracking-tight truncate max-w-full">
                  {item.shortLabel}
                </span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <OfflineIndicator />

      <ConfirmDialog
        open={logoutConfirmOpen}
        title="Sign Out of REXON Portal"
        description="Are you sure you want to end your current session? You will need to authenticate again to access protected portal data."
        confirmLabel="Sign Out"
        cancelLabel="Stay Signed In"
        loading={loggingOut}
        onConfirm={handleConfirmLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
    </div>
  );
};
