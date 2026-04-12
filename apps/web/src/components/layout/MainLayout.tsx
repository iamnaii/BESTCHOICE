import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { LayoutProvider, useLayout } from './LayoutContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { Sheet, SheetContent, SheetBody } from '@/components/ui/sheet';
import CommandPalette from '@/components/CommandPalette';
import ShortcutsHelpOverlay from '@/components/ShortcutsHelpOverlay';
import MobileBottomNav from './MobileBottomNav';
import { SkipLink } from './SkipLink';

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
function MainContent() {
  const isMobile = useIsMobile();
  const { sidebarCollapse } = useLayout();
  const { pathname } = useLocation();
  const { showShortcutsHelp, setShowShortcutsHelp } = useGlobalShortcuts();

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
        <TopBar />

        <main
          id="main"
          tabIndex={-1}
          className="flex-1 grow pt-5 pb-20 lg:pb-8 bg-background focus-visible:outline-hidden"
          key={pathname}
        >
          <div className="container-fluid px-5 lg:px-7 animate-fadeIn">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      {isMobile && <MobileBottomNav />}

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
  return (
    <LayoutProvider>
      <MainContent />
    </LayoutProvider>
  );
}
