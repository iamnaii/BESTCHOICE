import { memo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, ShoppingCart, FileCheck, DollarSign, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLayout } from './LayoutContext';

interface TabItem {
  label: string;
  path: string;
  icon: typeof Home;
  /** If true, opens mobile sidebar instead of navigating */
  action?: 'sidebar';
}

const tabs: TabItem[] = [
  { label: 'หน้าหลัก', path: '/', icon: Home },
  { label: 'ขาย', path: '/pos', icon: ShoppingCart },
  { label: 'สัญญา', path: '/contracts', icon: FileCheck },
  { label: 'ชำระ', path: '/payments', icon: DollarSign },
  { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
];

function MobileBottomNav() {
  const { pathname } = useLocation();
  const { setMobileSidebarOpen } = useLayout();

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border lg:hidden safe-area-bottom">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) =>
          tab.action === 'sidebar' ? (
            <button
              key={tab.label}
              onClick={() => setMobileSidebarOpen(true)}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 text-muted-foreground"
            >
              <tab.icon className="size-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          ) : (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 transition-colors',
                isActive(tab.path)
                  ? 'text-primary'
                  : 'text-muted-foreground',
              )}
            >
              <tab.icon className={cn('size-5', isActive(tab.path) && 'stroke-[2.5]')} />
              <span className={cn(
                'text-[10px]',
                isActive(tab.path) ? 'font-semibold' : 'font-medium',
              )}>
                {tab.label}
              </span>
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}

export default memo(MobileBottomNav);
