import { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useIsMobile } from '@/hooks/useIsMobile';
import { LayoutProvider, useLayout } from './LayoutContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { Sheet, SheetContent, SheetBody } from '@/components/ui/sheet';
import SearchModal from '@/components/SearchModal';

function MobileSidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useLayout();
  const { pathname } = useLocation();

  // Close sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname, setMobileSidebarOpen]);

  return (
    <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
      <SheetContent className="p-0 gap-0 w-[280px]" side="left" close={false}>
        <SheetBody className="p-0 overflow-y-auto">
          <Sidebar mobile />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function MainContent() {
  const isMobile = useIsMobile();
  const { sidebarCollapse } = useLayout();
  const [searchOpen, setSearchOpen] = useState(false);

  // Global Cmd+K / Ctrl+K shortcut
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setSearchOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      {!isMobile && <Sidebar />}

      {/* Mobile: Sheet Sidebar */}
      {isMobile && <MobileSidebar />}

      {/* Main content wrapper — Demo 9 pattern */}
      <div
        className="wrapper flex-1 flex flex-col min-w-0 transition-all duration-300"
        style={{
          paddingLeft: isMobile ? 0 : sidebarCollapse ? 70 : 264,
        }}
      >
        <TopBar onSearchClick={() => setSearchOpen(true)} />
        <main className="flex-1 grow pt-5 px-5 lg:px-7 pb-7 bg-background">
          <Outlet />
        </main>
      </div>

      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

export default function MainLayout() {
  return (
    <LayoutProvider>
      <MainContent />
    </LayoutProvider>
  );
}
