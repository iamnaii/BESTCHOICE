import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTheme } from 'next-themes';
import { useLayout } from './LayoutContext';
import { cn } from '@/lib/utils';
import { Menu, Sun, Moon, Search, Bell, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCommandPalette } from '@/components/CommandPalette';

const roleLabels: Record<string, string> = {
  OWNER: 'เจ้าของ',
  BRANCH_MANAGER: 'ผู้จัดการสาขา',
  FINANCE_MANAGER: 'ผู้จัดการการเงิน',
  SALES: 'พนักงานขาย',
  ACCOUNTANT: 'ฝ่ายบัญชี',
};

const roleBadgeColors: Record<string, string> = {
  OWNER: 'bg-primary/10 text-primary',
  BRANCH_MANAGER: 'bg-primary/10 text-primary',
  FINANCE_MANAGER: 'bg-info/10 text-info dark:bg-info/15',
  SALES: 'bg-success/10 text-success dark:bg-success/15',
  ACCOUNTANT: 'bg-warning/10 text-warning dark:bg-warning/15',
};

export default function TopBar() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { setMobileSidebarOpen } = useLayout();
  const { theme, setTheme } = useTheme();
  const { open: openCommandPalette } = useCommandPalette();

  return (
    <header className="header sticky top-0 z-10 flex items-center justify-between shrink-0 h-[60px] px-5 lg:px-7 bg-background/95 backdrop-blur-md border-b border-border/40">
      {/* Left: Hamburger (mobile) + Page context */}
      <div className="flex items-center gap-3">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-full"
            aria-label="เปิดเมนู"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu className="size-5 text-muted-foreground/70" />
          </Button>
        )}

        {/* Role badge */}
        {user?.role && (
          <span className={cn(
            'inline-flex items-center text-2xs font-semibold px-2.5 py-1 rounded-md',
            roleBadgeColors[user.role] || 'bg-muted text-muted-foreground',
          )}>
            {roleLabels[user.role]}
          </span>
        )}

        {/* Branch badge */}
        {user?.branchName && (
          <>
            <div className="hidden sm:block w-px h-4 bg-border/40" />
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 text-2xs font-medium text-muted-foreground">
              <Building2 className="size-3 opacity-50" />
              {user.branchName}
            </span>
          </>
        )}
      </div>

      {/* Right: Search + Icons + User — Metronic topbar pattern */}
      <div className="flex items-center gap-1">
        {/* Search bar — opens Command Palette */}
        <button
          onClick={openCommandPalette}
          className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border/50 bg-muted/30 text-[13px] text-muted-foreground hover:bg-muted/60 transition-colors duration-150"
          aria-label="ค้นหา (Ctrl+K)"
        >
          <Search className="size-3.5 opacity-50" />
          <span className="hidden sm:inline">ค้นหา...</span>
          <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-background/80 text-[10px] text-muted-foreground/50 border border-border/40 font-mono ml-6">
            ⌘K
          </kbd>
        </button>

        {/* Notifications — Metronic circle icon button */}
        <Button
          variant="ghost"
          size="icon"
          aria-label="การแจ้งเตือน"
          className="size-9 rounded-full relative text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors duration-150"
        >
          <Bell className="size-4" />
          <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-green-500 ring-2 ring-background" aria-hidden="true" />
        </Button>

        {/* Dark mode toggle — Metronic circle icon button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="size-9 rounded-full relative text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors duration-150"
        >
          <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>

        <div className="w-px h-5 bg-border/40 mx-1" />

        {/* User avatar — Metronic pattern */}
        <div className="flex items-center gap-2.5 pl-0.5">
          <div className="text-right hidden sm:block">
            <p className="text-[13px] font-medium text-foreground leading-tight">{user?.name}</p>
          </div>
          <img
            className="size-9 rounded-full border-2 border-primary/20 shrink-0 cursor-pointer bg-muted"
            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || 'U')}&background=3b82f6&color=fff&size=36`}
            alt={`${user?.name || 'User'} avatar`}
          />
        </div>
      </div>
    </header>
  );
}
