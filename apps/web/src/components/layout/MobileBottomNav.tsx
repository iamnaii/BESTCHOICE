import { memo, useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { useLayout } from './LayoutContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUnreadChat } from '@/hooks/useUnreadChat';
import { getMenuConfig } from '@/config/menu';
import type { BottomNavItem } from '@/config/menu';

function MobileBottomNav() {
  const { pathname } = useLocation();
  const { setMobileSidebarOpen } = useLayout();
  const { user } = useAuth();

  const tabs = useMemo(
    () => getMenuConfig(user?.role ?? '').bottomNav,
    [user?.role],
  );

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
                  'active:scale-90 transition-all duration-150 focus-visible:outline-hidden',
                )}
                aria-label="เปิดเมนูเพิ่มเติม"
              >
                <tab.icon className="size-[22px]" strokeWidth={1.75} />
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
                'transition-all duration-150 active:scale-90 focus-visible:outline-hidden',
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
              <div className="relative">
                <tab.icon
                  className="size-[22px] transition-all duration-150"
                  strokeWidth={1.75}
                />
                {tab.badgeKey === 'chat-unread' && <ChatBadgeDot />}
              </div>
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

function ChatBadgeDot() {
  const count = useUnreadChat();
  if (count <= 0) return null;
  return (
    <span
      className="absolute -top-1 -right-1.5 min-w-[16px] h-[16px] px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none ring-2 ring-background"
      aria-label={`${count > 99 ? '99+' : count} ข้อความใหม่`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default memo(MobileBottomNav);
