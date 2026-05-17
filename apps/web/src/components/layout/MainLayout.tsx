import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
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

/* ── Sidebar widths — keep in sync with Sidebar.tsx ── */
const SIDEBAR_EXPANDED_W = 264;  // px
const SIDEBAR_COLLAPSED_W = 70;  // px

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
  const { sidebarCollapse } = useLayout();
  const { pathname } = useLocation();
  const { showShortcutsHelp, setShowShortcutsHelp } = useGlobalShortcuts();

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

      {/* Shortcuts Help Overlay (Shift+?) */}
      {showShortcutsHelp && (
        <ShortcutsHelpOverlay onClose={() => setShowShortcutsHelp(false)} />
      )}
    </div>
  );
}

/* ── Layout root ──────────────────────────────────── */
export default function MainLayout() {
  // D1.4.1.3 — useUiFlags side-effects (animation toggle + future) run at the
  // earliest authenticated paint. Hook is React-Query cached so the extra
  // mount here is cheap.
  useUiFlags();
  return (
    <LayoutProvider>
      <MainContent />
    </LayoutProvider>
  );
}
