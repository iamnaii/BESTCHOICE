import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useIsMobile } from '@/hooks/useIsMobile';
import { LayoutProvider, useLayout } from './LayoutContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { Sheet, SheetContent, SheetHeader, SheetBody } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';

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
        <SheetHeader className="p-0 space-y-0" />
        <SheetBody className="p-0">
          <ScrollArea className="h-full">
            <Sidebar />
          </ScrollArea>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function MainContent() {
  const isMobile = useIsMobile();
  const { sidebarCollapse } = useLayout();

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      {!isMobile && <Sidebar />}

      {/* Mobile Sidebar Sheet */}
      {isMobile && <MobileSidebar />}

      {/* Main content - Metronic Demo 9 wrapper pattern */}
      <div
        className="wrapper flex-1 flex flex-col min-w-0 transition-all duration-300"
        style={{
          paddingLeft: isMobile ? 0 : sidebarCollapse ? 80 : 280,
        }}
      >
        <TopBar />
        <main className="flex-1 grow pt-5 px-5 lg:px-7 pb-7 bg-background" role="content">
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
