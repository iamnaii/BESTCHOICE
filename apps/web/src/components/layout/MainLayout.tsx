import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useIsMobile } from '@/hooks/useIsMobile';
import { LayoutProvider, useLayout } from './LayoutContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { Sheet, SheetContent, SheetBody } from '@/components/ui/sheet';

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

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop: Icon Rail Sidebar (70px fixed) */}
      {!isMobile && <Sidebar />}

      {/* Mobile: Sheet Sidebar */}
      {isMobile && <MobileSidebar />}

      {/* Main content wrapper — Demo 9 pattern */}
      <div
        className="wrapper flex-1 flex flex-col min-w-0 transition-all duration-300"
        style={{
          paddingLeft: isMobile ? 0 : 70,
        }}
      >
        <TopBar />
        <main className="flex-1 grow pt-5 px-5 lg:px-7 pb-7 bg-background">
          <Outlet />
        </main>
      </div>
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
