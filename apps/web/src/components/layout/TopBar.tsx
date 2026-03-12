import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTheme } from 'next-themes';
import { useLayout } from './LayoutContext';
import { cn } from '@/lib/utils';
import { Menu, LogOut, ChevronFirst, Sun, Moon, Search, Bell, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const { sidebarCollapse, setSidebarCollapse, setMobileSidebarOpen } = useLayout();
  const { theme, setTheme } = useTheme();

  return (
    <header className="header sticky top-0 z-10 flex flex-col shrink-0 bg-card border-b border-border">
      {/* Row 1: Extended topbar — workspace, branch, search */}
      <div className="flex items-center justify-between h-[44px] px-4 lg:px-6 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          {/* Mobile hamburger */}
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="เปิดเมนู"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="size-4 text-muted-foreground" />
            </Button>
          )}

          {/* Desktop sidebar toggle */}
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={sidebarCollapse ? 'ขยายเมนู' : 'ย่อเมนู'}
              onClick={() => setSidebarCollapse(!sidebarCollapse)}
              className="size-7"
            >
              <ChevronFirst
                className={cn(
                  'size-3.5 text-muted-foreground transition-transform',
                  sidebarCollapse && 'rotate-180',
                )}
              />
            </Button>
          )}

          {/* Branch badge */}
          {user?.branchName && (
            <>
              <div className="hidden sm:block w-px h-4 bg-border" />
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-2xs font-medium text-muted-foreground">
                <Building2 className="size-3" />
                {user.branchName}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Search */}
          <button
            className="flex items-center gap-2 h-7 px-3 rounded-md bg-muted text-2xs text-muted-foreground hover:bg-muted/80 transition-colors"
            aria-label="ค้นหา"
          >
            <Search className="size-3" />
            <span className="hidden sm:inline">ค้นหา...</span>
            <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-background text-2xs text-muted-foreground/70 border border-border font-mono">
              ⌘K
            </kbd>
          </button>

          {/* Dark mode toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="size-7 relative"
          >
            <Sun className="size-3.5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute size-3.5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </div>
      </div>

      {/* Row 2: Main header — page context + user controls */}
      <div className="flex items-center justify-between h-[56px] px-4 lg:px-6">
        <div className="flex items-center gap-2">
          {/* Role badge */}
          {user?.role && (
            <span className={cn(
              'inline-flex items-center text-2xs font-medium px-2 py-0.5 rounded-md',
              roleBadgeColors[user.role] || 'bg-muted text-muted-foreground',
            )}>
              {roleLabels[user.role]}
            </span>
          )}
        </div>

        {/* Right side — notifications + user */}
        <div className="flex items-center gap-1.5">
          {/* Notifications */}
          <Button
            variant="ghost"
            size="icon"
            aria-label="การแจ้งเตือน"
            className="size-8 rounded-full hover:bg-muted relative"
          >
            <Bell className="size-4" />
            <span className="absolute top-1 right-1 size-2 rounded-full bg-green-500" aria-hidden="true" />
          </Button>

          <div className="w-px h-5 bg-border mx-1" />

          {/* User avatar + dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 outline-none">
                <div className="text-right hidden sm:block">
                  <p className="text-2sm font-medium text-foreground leading-tight">{user?.name}</p>
                </div>
                <img
                  className="size-8 rounded-full border-2 border-primary/20 shrink-0 cursor-pointer bg-muted"
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || 'U')}&background=3b82f6&color=fff&size=36`}
                  alt={`${user?.name || 'User'} avatar`}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div>
                  <p className="font-medium">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                ออกจากระบบ
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
