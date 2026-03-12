import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTheme } from 'next-themes';
import { useLayout } from './LayoutContext';
import { cn } from '@/lib/utils';
import { Menu, LogOut, ChevronFirst, Sun, Moon, Search, Bell, Building2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
  OWNER: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
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
    <header className="sticky top-0 z-10 h-[60px] bg-card border-b border-border flex items-center justify-between px-4 lg:px-6 shadow-topbar">
      <div className="flex items-center gap-2">
        {/* Mobile hamburger */}
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileSidebarOpen(true)}
            className="h-9 w-9"
          >
            <Menu className="h-5 w-5 text-muted-foreground" />
          </Button>
        )}

        {/* Desktop sidebar toggle */}
        {!isMobile && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarCollapse(!sidebarCollapse)}
            className="h-8 w-8 rounded-lg"
          >
            <ChevronFirst
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                sidebarCollapse && 'rotate-180',
              )}
            />
          </Button>
        )}

        {/* Separator */}
        <div className="hidden sm:block w-px h-5 bg-border mx-1" />

        {/* Branch badge */}
        {user?.branchName && (
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-[12px] font-medium text-muted-foreground">
            <Building2 className="w-3.5 h-3.5" />
            {user.branchName}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {/* Search */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg text-muted-foreground"
        >
          <Search className="h-[18px] w-[18px]" />
        </Button>

        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg text-muted-foreground relative"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-destructive" />
        </Button>

        {/* Dark mode toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="h-9 w-9 rounded-lg text-muted-foreground"
        >
          <Sun className="h-[18px] w-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>

        {/* Separator */}
        <div className="w-px h-5 bg-border mx-1.5" />

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2.5 outline-none hover:opacity-90 transition-opacity">
              <div className="text-right hidden sm:block">
                <p className="text-[13px] font-semibold text-foreground leading-tight">{user?.name}</p>
                {user?.role && (
                  <span className={cn(
                    'inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mt-0.5',
                    roleBadgeColors[user.role] || 'bg-secondary text-muted-foreground',
                  )}>
                    {roleLabels[user.role]}
                  </span>
                )}
              </div>
              <Avatar className="h-9 w-9 cursor-pointer ring-2 ring-border">
                <AvatarFallback className="bg-gradient-to-br from-primary-400 to-primary-600 text-white text-sm font-semibold">
                  {user?.name?.charAt(0)}
                </AvatarFallback>
              </Avatar>
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
    </header>
  );
}
