import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTheme } from 'next-themes';
import { useLayout } from './LayoutContext';
import { cn } from '@/lib/utils';
import { Menu, Sun, Moon, Search, Bell, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const roleLabels: Record<string, string> = {
  OWNER: 'เจ้าของ',
  BRANCH_MANAGER: 'ผู้จัดการสาขา',
  SALES: 'พนักงานขาย',
  ACCOUNTANT: 'ฝ่ายบัญชี',
};

const roleBadgeColors: Record<string, string> = {
  OWNER: 'bg-primary/10 text-primary',
  BRANCH_MANAGER: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  SALES: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  ACCOUNTANT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

export default function TopBar() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { setMobileSidebarOpen } = useLayout();
  const { theme, setTheme } = useTheme();

  return (
    <header className="header sticky top-0 z-10 flex items-center justify-between shrink-0 h-16 px-5 lg:px-7 bg-card border-b border-border">
      {/* Left: Hamburger (mobile) + Page context */}
      <div className="flex items-center gap-3">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="เปิดเมนู"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu className="size-5 text-muted-foreground" />
          </Button>
        )}

        {/* Role badge */}
        {user?.role && (
          <span className={cn(
            'inline-flex items-center text-2xs font-medium px-2.5 py-1 rounded-md',
            roleBadgeColors[user.role] || 'bg-muted text-muted-foreground',
          )}>
            {roleLabels[user.role]}
          </span>
        )}

        {/* Branch badge */}
        {user?.branchName && (
          <>
            <div className="hidden sm:block w-px h-4 bg-border" />
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-2xs font-medium text-muted-foreground">
              <Building2 className="size-3" />
              {user.branchName}
            </span>
          </>
        )}
      </div>

      {/* Right: Search + Icons + User */}
      <div className="flex items-center gap-2">
        {/* Search bar */}
        <button
          className="flex items-center gap-2 h-9 px-3.5 rounded-lg bg-muted/70 text-sm text-muted-foreground hover:bg-muted transition-colors"
          aria-label="ค้นหา"
        >
          <Search className="size-4" />
          <span className="hidden sm:inline">ค้นหา...</span>
          <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-background text-2xs text-muted-foreground/70 border border-border font-mono ml-4">
            ⌘K
          </kbd>
        </button>

        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          aria-label="การแจ้งเตือน"
          className="size-9 rounded-lg relative"
        >
          <Bell className="size-4" />
          <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-green-500" aria-hidden="true" />
        </Button>

        {/* Dark mode toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="size-9 rounded-lg relative"
        >
          <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* User avatar */}
        <div className="flex items-center gap-2.5">
          <div className="text-right hidden sm:block">
            <p className="text-2sm font-medium text-foreground leading-tight">{user?.name}</p>
          </div>
          <img
            className="size-9 rounded-lg border-2 border-primary/20 shrink-0 cursor-pointer bg-muted"
            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || 'U')}&background=3b82f6&color=fff&size=36`}
            alt={`${user?.name || 'User'} avatar`}
          />
        </div>
      </div>
    </header>
  );
}
