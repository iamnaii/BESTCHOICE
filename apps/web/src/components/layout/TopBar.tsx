import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTheme } from 'next-themes';
import { useLayout } from './LayoutContext';
import { cn } from '@/lib/utils';
import { Menu, LogOut, ChevronFirst, Sun, Moon } from 'lucide-react';
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

export default function TopBar() {
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const { sidebarCollapse, setSidebarCollapse, setMobileSidebarOpen } = useLayout();
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-10 h-16 bg-background border-b border-border flex items-center justify-between px-4 lg:px-8">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileSidebarOpen(true)}
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
            className="h-8 w-8"
          >
            <ChevronFirst
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                sidebarCollapse && 'rotate-180',
              )}
            />
          </Button>
        )}

        {/* Branch name */}
        {user?.branchName && (
          <span className="hidden sm:inline-flex items-center gap-2 text-sm text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            {user.branchName}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Dark mode toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="h-9 w-9"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 outline-none">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-semibold text-foreground">{user?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {user?.role && roleLabels[user.role]}
                </p>
              </div>
              <Avatar className="h-9 w-9 cursor-pointer">
                <AvatarFallback className="bg-gradient-to-br from-teal-400 to-emerald-600 text-white text-sm font-semibold">
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
