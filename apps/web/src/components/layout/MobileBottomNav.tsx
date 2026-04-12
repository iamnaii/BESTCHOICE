import { memo } from 'react';
import { Link, useLocation } from 'react-router';
import { Home, ShoppingCart, FileCheck, HandCoins, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLayout } from './LayoutContext';

interface TabItem {
  label: string;
  path: string;
  icon: typeof Home;
  /** If 'sidebar', tapping opens the mobile sheet sidebar instead of navigating */
  action?: 'sidebar';
}

const tabs: TabItem[] = [
  { label: 'หน้าหลัก', path: '/',          icon: Home },
  { label: 'ขาย',     path: '/pos',        icon: ShoppingCart },
  { label: 'สัญญา',   path: '/contracts',  icon: FileCheck },
  { label: 'ชำระ',    path: '/payments',   icon: HandCoins },
  { label: 'เพิ่มเติม', path: '#more',     icon: MoreHorizontal, action: 'sidebar' },
];

function MobileBottomNav() {
  const { pathname } = useLocation();
  const { setMobileSidebarOpen } = useLayout();

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-background/97 backdrop-blur-lg border-t border-border/50 safe-area-bottom"
      aria-label="เมนูด้านล่าง"
    >
      <div className="flex items-stretch h-[56px]">
        {tabs.map((tab) => {
          const active = tab.action !== 'sidebar' && isActive(tab.path);

          if (tab.action === 'sidebar') {
            return (
              <button
                key={tab.label}
                onClick={() => setMobileSidebarOpen(true)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 px-1 py-1.5',
                  'text-muted-foreground/60 hover:text-muted-foreground',
                  'active:scale-90 transition-all duration-150 focus-visible:outline-none',
                )}
                aria-label="เปิดเมนูเพิ่มเติม"
              >
                <tab.icon className="size-[22px]" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                'relative flex flex-col items-center justify-center gap-0.5 flex-1 px-1 py-1.5',
                'transition-all duration-150 active:scale-90 focus-visible:outline-none',
                active ? 'text-primary' : 'text-muted-foreground/60 hover:text-muted-foreground',
              )}
              aria-current={active ? 'page' : undefined}
            >
              {/* Active top indicator bar */}
              {active && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2.5px] bg-primary rounded-b-full"
                  aria-hidden="true"
                />
              )}
              <tab.icon
                className={cn(
                  'transition-all duration-150',
                  active ? 'size-[22px] stroke-[2.5]' : 'size-[22px] stroke-2',
                )}
              />
              <span className={cn('text-[10px]', active ? 'font-bold' : 'font-medium')}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default memo(MobileBottomNav);
