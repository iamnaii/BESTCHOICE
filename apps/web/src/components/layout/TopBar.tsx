import { useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTheme } from 'next-themes';
import { useLayout } from './LayoutContext';
import { cn } from '@/lib/utils';
import {
  Menu,
  Sun,
  Moon,
  Search,
  Bell,
  Building2,
  LogOut,
  Settings,
  ChevronDown,
  MessageSquareMore,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCommandPalette } from '@/components/CommandPalette';
import { ChatUnreadBadge } from './Sidebar';
import { isChatVisibleForRole } from '@/config/menu';

/* ── Role display metadata ─────────────────────── */
const roleLabels: Record<string, string> = {
  OWNER:          'เจ้าของ',
  BRANCH_MANAGER: 'ผู้จัดการสาขา',
  FINANCE_MANAGER:'ผู้จัดการการเงิน',
  SALES:          'พนักงานขาย',
  ACCOUNTANT:     'ฝ่ายบัญชี',
};

const roleBadgeColors: Record<string, string> = {
  OWNER:          'bg-primary/10 text-primary',
  BRANCH_MANAGER: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  FINANCE_MANAGER:'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  SALES:          'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  ACCOUNTANT:     'bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

/* ── UserDropdown ──────────────────────────────── */
function UserDropdown() {
  const { user, logout } = useAuth();

  if (!user) return null;

  const initials = user.name
    ?.split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'U';

  const roleLabel = roleLabels[user.role] ?? user.role;
  const roleCls   = roleBadgeColors[user.role] ?? 'bg-muted text-muted-foreground';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2.5 pl-1 pr-2 py-1.5 rounded-xl hover:bg-muted/60 transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="เมนูผู้ใช้"
        >
          {/* Avatar */}
          <div className="size-8 rounded-full bg-gradient-to-br from-[#1e3a5f] to-[#059669] flex items-center justify-center ring-2 ring-primary/20 shrink-0">
            <span className="text-white text-[13px] font-bold leading-none">{initials}</span>
          </div>
          {/* Name (hidden on small) */}
          <div className="hidden sm:flex flex-col items-start leading-tight">
            <span className="text-[13px] font-semibold text-foreground leading-tight">{user.name}</span>
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-md mt-0.5', roleCls)}>
              {roleLabel}
            </span>
          </div>
          <ChevronDown className="size-3.5 text-muted-foreground/60 hidden sm:block" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        {/* User info header */}
        <DropdownMenuLabel className="font-normal pb-2">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-gradient-to-br from-[#1e3a5f] to-[#059669] flex items-center justify-center ring-2 ring-primary/20 shrink-0">
              <span className="text-white text-sm font-bold leading-none">{initials}</span>
            </div>
            <div className="flex flex-col min-w-0">
              <p className="text-[13px] font-semibold text-foreground truncate">{user.name}</p>
              <span className={cn('inline-flex w-fit text-[10px] font-bold px-1.5 py-0.5 rounded-md mt-0.5', roleCls)}>
                {roleLabel}
              </span>
              {user.branchName && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Building2 className="size-3 opacity-60" strokeWidth={1.75} />
                  {user.branchName}
                </p>
              )}
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/settings" className="flex items-center gap-2.5 cursor-pointer">
              <Settings className="size-4 text-muted-foreground" strokeWidth={1.75} />
              <span>ตั้งค่าระบบ</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={logout}
          className="flex items-center gap-2.5 text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
        >
          <LogOut className="size-4" strokeWidth={1.75} />
          <span>ออกจากระบบ</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── TopBar ────────────────────────────────────── */
export default function TopBar() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { setMobileSidebarOpen } = useLayout();
  const { theme, setTheme } = useTheme();
  const { open: openCommandPalette } = useCommandPalette();
  const { pathname } = useLocation();

  const pageTitle = useMemo(() => {
    const map: Record<string, string> = {
      '/': 'Dashboard', '/pos': 'POS', '/customers': 'ลูกค้า',
      '/contracts': 'สัญญา', '/payments': 'ชำระเงิน', '/stock': 'สต็อก',
      '/overdue': 'ค้างชำระ', '/settings': 'ตั้งค่า', '/users': 'ผู้ใช้',
      '/branches': 'สาขา', '/suppliers': 'ผู้จำหน่าย', '/commissions': 'คอมมิชชัน',
      '/receipts': 'ใบเสร็จ', '/audit-logs': 'Audit Logs', '/notifications': 'แจ้งเตือน',
    };
    const exactMatch = map[pathname];
    if (exactMatch) return exactMatch;
    // Try prefix match
    const prefix = Object.keys(map).find(k => k !== '/' && pathname.startsWith(k));
    return prefix ? map[prefix] : pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 'Dashboard';
  }, [pathname]);

  return (
    <header className="sticky top-0 z-10 h-[60px] bg-white dark:bg-card border-b border-[#e2e8f0] dark:border-border flex items-center justify-between shrink-0 px-5 lg:px-6">

      {/* ── Left: hamburger (mobile) + breadcrumb ── */}
      <div className="flex items-center gap-2.5">
        {/* Mobile hamburger */}
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl -ml-1"
            aria-label="เปิดเมนู"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu className="size-5 text-muted-foreground/70" strokeWidth={1.75} />
          </Button>
        )}

        {/* Breadcrumb — desktop only */}
        <nav className="hidden lg:flex items-center gap-1.5 text-xs">
          <Link to="/" className="text-[#94a3b8] hover:text-foreground transition-colors">หน้าหลัก</Link>
          {pathname !== '/' && (
            <>
              <span className="text-[#cbd5e1]">/</span>
              <span className="text-foreground font-medium">{pageTitle}</span>
            </>
          )}
        </nav>

        {/* Branch badge — shown on mobile/tablet when no breadcrumb */}
        {user?.branchName && (
          <span className="lg:hidden inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/60 text-[12px] font-medium text-muted-foreground border border-border/40">
            <Building2 className="size-3 opacity-50" strokeWidth={1.75} />
            {user.branchName}
          </span>
        )}
      </div>

      {/* ── Right: search + actions + user ─────────── */}
      <div className="flex items-center gap-1">

        {/* Search button → opens Command Palette */}
        <button
          onClick={() => openCommandPalette()}
          className="hidden md:flex items-center gap-2 h-9 px-3 rounded-md bg-[#f1f5f9] dark:bg-muted text-muted-foreground text-xs hover:bg-[#e2e8f0] transition-colors min-w-[180px]"
          aria-label="ค้นหา (Ctrl+K)"
        >
          <Search className="size-3.5 text-[#94a3b8]" strokeWidth={1.75} />
          <span className="text-[#94a3b8]">ค้นหา... (⌘K)</span>
        </button>

        {/* Chat inbox button */}
        {user && isChatVisibleForRole(user.role) && (
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="size-9 rounded-xl relative text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors duration-150"
          >
            <Link to="/inbox" aria-label="กล่องข้อความ">
              <MessageSquareMore className="size-[17px]" strokeWidth={1.75} />
              <ChatUnreadBadge className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] text-[9px]" />
            </Link>
          </Button>
        )}

        {/* Notifications bell */}
        <Button
          variant="ghost"
          size="icon"
          aria-label="การแจ้งเตือน"
          className="size-9 rounded-xl relative text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors duration-150"
        >
          <Bell className="size-[17px]" strokeWidth={1.75} />
          {/* Active indicator dot */}
          <span
            className="absolute top-[9px] right-[9px] size-[7px] rounded-full bg-emerald-500 ring-[1.5px] ring-background"
            aria-hidden="true"
          />
        </Button>

        {/* Dark/light mode toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="size-9 rounded-xl relative text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors duration-150"
          aria-label="สลับธีม"
        >
          <Sun className="size-[17px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" strokeWidth={1.75} />
          <Moon className="absolute size-[17px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" strokeWidth={1.75} />
        </Button>

        {/* Vertical divider */}
        <div className="w-px h-5 bg-border/50 mx-0.5" aria-hidden="true" />

        {/* User dropdown */}
        <UserDropdown />
      </div>
    </header>
  );
}
