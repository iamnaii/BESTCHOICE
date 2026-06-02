import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useUiFlags } from '@/hooks/useUiFlags';
import { LayoutProvider, useLayout } from './LayoutContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { Sheet, SheetContent, SheetBody } from '@/components/ui/sheet';
import CommandPalette from '@/components/CommandPalette';
import ShortcutsHelpOverlay from '@/components/ShortcutsHelpOverlay';
import MobileBottomNav from './MobileBottomNav';
import { SkipLink } from './SkipLink';
import TestModeBanner from './TestModeBanner';
import { InboundCallPopup } from '@/components/InboundCallPopup';
import { getSidebarForRole, getZoneConfigForRole } from '@/config/menu';
import type { Zone } from '@/config/menu';

/* ── Sidebar widths — keep in sync with Sidebar.tsx ── */
const SIDEBAR_EXPANDED_W = 264;  // px
const SIDEBAR_COLLAPSED_W = 70;  // px

/* ── Zone resolution helpers (Task 15) ────────────── */
const ZONE_LOOKUP_ORDER: Zone[] = ['shop', 'fin', 'settings'];
const ALL_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT'];

/** Paths shared across every authenticated role — never treat as access-denied
 * even if a role's menu config forgets to list them. Defense-in-depth against
 * the bug pattern where a role omits a universal route (e.g. `/`) and the
 * auto-zone resolver bogusly fires the "no permission" toast. */
const COMMON_PATHS = new Set<string>(['/']);

/**
 * Find which zone a path belongs to across the role's accessible zones.
 * Returns null if the path isn't in any of the role's zones (caller decides
 * whether to let it through as a "common route" or redirect).
 */
function resolveZoneForPath(role: string, path: string): Zone | null {
  for (const z of ZONE_LOOKUP_ORDER) {
    const sections = getSidebarForRole(role, z);
    const found = sections.some((s) =>
      s.items.some(
        (item) =>
          item.path === path ||
          (item.children ?? []).some((c) => c.path === path)
      )
    );
    if (found) return z;
  }
  return null;
}

/* ── Mobile Sheet Sidebar ─────────────────────────── */
function MobileSidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useLayout();
  const { pathname } = useLocation();

  // Close on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname, setMobileSidebarOpen]);

  return (
    <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
      <SheetContent
        className="p-0 gap-0 w-[280px] border-r-0"
        side="left"
        close={false}
      >
        <SheetBody className="p-0 overflow-y-auto h-full">
          <Sidebar mobile />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/* ── Main Content Area ────────────────────────────── */
/* ── Full-bleed routes (no TopBar, no container padding) ── */
const FULL_BLEED_ROUTES = ['/inbox', '/chat'];

function MainContent() {
  const isMobile = useIsMobile();
  const { sidebarCollapse, currentZone, setCurrentZone } = useLayout();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showKeyboardShortcuts } = useUiFlags();

  /* Task 15 — auto-sync currentZone to the pathname's zone, and redirect
     if this role has no path that lives in any of its zones. Common routes
     (paths not in ANY role's sidebar — e.g., /profile, /404) pass through.

     IMPORTANT: this effect must NOT run when only `currentZone` changed
     (e.g., user clicked the PillSwitcher / GearButton). If it did, the
     auto-resolve would immediately revert the user's manual pill choice
     back to whatever zone owns the current path. Track previous pathname
     via a ref and skip when only the zone changed. */
  const prevPathnameRef = useRef<string | null>(null);
  useEffect(() => {
    const role = user?.role ?? '';
    if (!role) return;
    if (!getZoneConfigForRole(role)) return;

    // Skip if only `currentZone` changed (pill click) — preserve manual intent.
    const isFirstRun = prevPathnameRef.current === null;
    const pathChanged = prevPathnameRef.current !== pathname;
    prevPathnameRef.current = pathname;
    if (!isFirstRun && !pathChanged) return;

    const targetZone = resolveZoneForPath(role, pathname);

    if (targetZone === null) {
      // Path is not in THIS role's sidebar — check if it's in any other role's
      // sidebar; if yes, it's an access-denied case; if no, it's a "common" route.
      // COMMON_PATHS short-circuits the check for universally-accessible routes
      // (e.g. `/` Dashboard) to prevent bogus access-denied toasts when a role's
      // menu config omits them.
      if (COMMON_PATHS.has(pathname)) return;
      const anyRoleHasIt = ALL_ROLES.some(
        (r) => r !== role && resolveZoneForPath(r, pathname) !== null
      );
      if (anyRoleHasIt) {
        toast.error('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
        // Spec called for /403 + toast, but no such route exists in this app;
        // redirecting to dashboard as a soft landing while still surfacing the
        // toast so the user knows why the navigation happened.
        navigate('/', { replace: true });
      }
      return;
    }

    // Path lives in role's sidebar — switch the pill if needed.
    if (targetZone !== currentZone) {
      setCurrentZone(targetZone);
    }
  }, [pathname, user?.role, currentZone, setCurrentZone, navigate]);

  // D1.4.1.2 — when OWNER disables `show_keyboard_shortcuts`, the Shift+?
  // help-dialog binding becomes a no-op AND the overlay is never rendered.
  const { showShortcutsHelp, setShowShortcutsHelp } = useGlobalShortcuts({
    disabled: !showKeyboardShortcuts,
  });

  const isFullBleed = FULL_BLEED_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));

  /* Sidebar offset applied via padding-left so the content
     shifts correctly when sidebar collapses / expands. */
  const sidebarOffset = isMobile
    ? 0
    : sidebarCollapse
      ? SIDEBAR_COLLAPSED_W
      : SIDEBAR_EXPANDED_W;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SkipLink />

      {/* App-wide test-mode banner — shows on every page when test-mode is ON */}
      <TestModeBanner />

      <div className="flex flex-1 min-h-0">

      {/* Desktop Sidebar */}
      {!isMobile && <Sidebar />}

      {/* Mobile Sheet Sidebar */}
      {isMobile && <MobileSidebar />}

      {/* Main wrapper — shifts right of sidebar */}
      <div
        className="wrapper flex-1 flex flex-col min-w-0 transition-[padding-left] duration-300 ease-in-out"
        style={{ paddingLeft: sidebarOffset }}
      >
        {!isFullBleed && <TopBar />}

        <main
          id="main"
          tabIndex={-1}
          className="flex-1 grow bg-background focus-visible:outline-hidden"
          key={pathname}
        >
          {isFullBleed ? (
            <Outlet />
          ) : (
            <div className="container-fluid px-5 lg:px-7 pt-0 pb-20 lg:pb-8 animate-fadeIn">
              <Outlet />
            </div>
          )}
        </main>
      </div>
      </div>

      {/* Mobile bottom tab bar */}
      {isMobile && <MobileBottomNav />}

      {/* Inbound call popup (Yeastar PBX) */}
      <InboundCallPopup />

      {/* Global Command Palette (Ctrl+K) */}
      <CommandPalette />

      {/* Shortcuts Help Overlay (Shift+?) — gated by D1.4.1.2 */}
      {showShortcutsHelp && showKeyboardShortcuts && (
        <ShortcutsHelpOverlay onClose={() => setShowShortcutsHelp(false)} />
      )}
    </div>
  );
}

/* ── Layout root ──────────────────────────────────── */
export default function MainLayout() {
  // Fire useUiFlags here so the D1.4.1.1 first-device sidebar seed runs as
  // early as possible — before any consumer component asks for the flags.
  // D1.4.1.3 — animation toggle, D1.4.1.4 — dark mode bootstrap side-effects
  // also run here. Hook is React-Query cached so the extra mount is cheap.
  useUiFlags();
  return (
    <LayoutProvider>
      <MainContent />
    </LayoutProvider>
  );
}
