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
  OWNER: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
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
    <header
      className={cn(
        'header sticky top-0 z-10 flex items-stretch shrink-0 bg-background border-b border-transparent h-[70px]',
        'border-border',
      )}
    >
      <div className="flex justify-between items-stretch w-full px-4 lg:px-6">
        {/* Left side */}
        <div className="flex items-center gap-1">
          {/* Mobile hamburger */}
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="text-muted-foreground/70" />
            </Button>
          )}

          {/* Desktop sidebar toggle */}
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarCollapse(!sidebarCollapse)}
              className="size-8"
            >
              <ChevronFirst
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  sidebarCollapse && 'rotate-180',
                )}
              />
            </Button>
          )}

          {/* Branch badge */}
          {user?.branchName && (
            <>
              <div className="hidden sm:block w-px h-5 bg-border mx-2" />
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-xs font-medium text-muted-foreground">
                <Building2 className="size-3.5" />
                {user.branchName}
              </span>
            </>
          )}
        </div>

        {/* Right side - Metronic topbar icon pattern */}
        <div className="flex items-center gap-1.5">
          {/* Search */}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-full hover:bg-primary/10 hover:[&_svg]:text-primary"
          >
            <Search className="size-[18px]" />
          </Button>

          {/* Notifications */}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-full hover:bg-primary/10 hover:[&_svg]:text-primary relative"
          >
            <Bell className="size-[18px]" />
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-green-500" />
          </Button>

          {/* Dark mode toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="size-9 rounded-full hover:bg-primary/10 hover:[&_svg]:text-primary"
          >
            <Sun className="size-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute size-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>

          {/* User avatar + dropdown - Metronic pattern */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 outline-none ml-1">
                <div className="text-right hidden sm:block">
                  <p className="text-2sm font-medium text-foreground leading-tight">{user?.name}</p>
                  {user?.role && (
                    <span className={cn(
                      'inline-block text-2xs font-medium px-1.5 py-0.5 rounded mt-0.5',
                      roleBadgeColors[user.role] || 'bg-secondary text-muted-foreground',
                    )}>
                      {roleLabels[user.role]}
                    </span>
                  )}
                </div>
                <img
                  className="size-9 rounded-full border-2 border-green-500 shrink-0 cursor-pointer bg-muted"
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || 'U')}&background=3b82f6&color=fff&size=36`}
                  alt="User Avatar"
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
