import { useEffect } from 'react';
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
import { InboundCallPopup } from '@/components/InboundCallPopup';
import { getSidebarForRole, getZoneConfigForRole } from '@/config/menu';
import type { Zone } from '@/config/menu';

/* ── Sidebar widths — keep in sync with Sidebar.tsx ── */
const SIDEBAR_EXPANDED_W = 264;  // px
const SIDEBAR_COLLAPSED_W = 70;  // px

/* ── Zone resolution helpers (Task 15) ────────────── */
const ZONE_LOOKUP_ORDER: Zone[] = ['shop', 'fin', 'settings'];
const ALL_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT'];

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
     (paths not in ANY role's sidebar — e.g., /profile, /404) pass through. */
  useEffect(() => {
    const role = user?.role ?? '';
    if (!role) return;
    if (!getZoneConfigForRole(role)) return;

    const targetZone = resolveZoneForPath(role, pathname);

    if (targetZone === null) {
      // Path is not in THIS role's sidebar — check if it's in any other role's
      // sidebar; if yes, it's an access-denied case; if no, it's a "common" route.
      const anyRoleHasIt = ALL_ROLES.some(
        (r) => r !== role && resolveZoneForPath(r, pathname) !== null
      );
      if (anyRoleHasIt) {
        toast.error('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
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
    <div className="flex min-h-screen bg-background">
      <SkipLink />

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
