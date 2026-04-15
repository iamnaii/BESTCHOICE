import { useMemo, useCallback, memo, useState } from 'react';
import { useUnreadChat } from '@/hooks/useUnreadChat';
import { Link, useLocation } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  Home,
  LogOut,
  ChevronsRight,
  ChevronsLeft,
  ChevronRight,
} from 'lucide-react';
import {
  AccordionMenu,
  AccordionMenuClassNames,
  AccordionMenuItem,
  AccordionMenuSub,
  AccordionMenuSubTrigger,
  AccordionMenuSubContent,
} from '@/components/ui/accordion-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useLayout } from './LayoutContext';
import { getMenuConfig } from '@/config/menu';
import type { MenuSection } from '@/config/menu';

/* ── Role label map ─────────────────────────────── */
const roleBadgeMap: Record<string, { label: string; cls: string }> = {
  OWNER:          { label: 'เจ้าของ',         cls: 'bg-primary/20 text-primary' },
  BRANCH_MANAGER: { label: 'ผจก.สาขา',        cls: 'bg-sky-500/20 text-sky-300' },
  FINANCE_MANAGER:{ label: 'ผจก.การเงิน',     cls: 'bg-violet-500/20 text-violet-300' },
  ACCOUNTANT:     { label: 'ฝ่ายบัญชี',       cls: 'bg-amber-500/20 text-amber-300' },
  SALES:          { label: 'พนักงานขาย',      cls: 'bg-emerald-500/20 text-emerald-300' },
};

/* ── Expanded menu AccordionMenu classNames ─────── */
const expandedMenuClassNames: AccordionMenuClassNames = {
  root: 'space-y-0.5',
  item: [
    'h-[34px] rounded-lg text-[13px] font-medium',
    'text-white/55 hover:text-white hover:bg-white/6',
    'transition-colors duration-150',
    'data-[selected=true]:bg-white/9 data-[selected=true]:text-white',
    'relative data-[selected=true]:before:absolute data-[selected=true]:before:left-0',
    'data-[selected=true]:before:top-[5px] data-[selected=true]:before:bottom-[5px]',
    'data-[selected=true]:before:w-[3px] data-[selected=true]:before:bg-primary',
    'data-[selected=true]:before:rounded-r-full',
  ].join(' '),
  sub: '',
  subTrigger: [
    'h-[36px] rounded-lg text-[12px] font-semibold uppercase tracking-widest',
    'text-white/30 hover:text-white/60 hover:bg-white/4',
    'data-[state=open]:text-white/70 data-[state=open]:bg-white/4',
    'transition-colors duration-150',
  ].join(' '),
  subContent: 'py-0.5 pl-3 border-l border-white/6 ml-3.5',
};

/* ─── useRoleMenu ───────────────────────────────── */
function useRoleMenu(role: string): MenuSection[] {
  return useMemo(() => getMenuConfig(role).sidebar, [role]);
}

/* ─── Collapsed Icon Rail (70px wide) ────────────── */
function CollapsedSidebar({ onToggle }: { onToggle: () => void }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [openPopover, setOpenPopover] = useState<string | null>(null);

  const sections = useRoleMenu(user?.role ?? '');

  const isSectionActive = useCallback(
    (section: MenuSection): boolean =>
      section.items.some(
        (item) =>
          item.path === pathname ||
          (item.path.length > 1 && pathname.startsWith(item.path + '/')) ||
          pathname === item.path,
      ),
    [pathname],
  );

  const isItemActive = useCallback(
    (path: string): boolean =>
      path === pathname ||
      (path.length > 1 && (pathname.startsWith(path + '/') || pathname === path)),
    [pathname],
  );

  const role = user?.role ?? '';
  const roleInfo = roleBadgeMap[role];

  return (
    <div
      className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[70px] flex flex-col items-center bg-sidebar-dark py-3 border-r border-white/4 shadow-[4px_0_24px_rgba(0,0,0,0.25)]"
      aria-label="เมนูหลัก (ย่อ)"
    >
      {/* Logo */}
      <Link to="/" className="flex items-center justify-center w-full mb-1 shrink-0 py-2">
        <div className="size-[38px] rounded-xl bg-linear-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/30 ring-1 ring-white/10">
          <span className="text-white text-[17px] font-bold leading-none">B</span>
        </div>
      </Link>

      {/* Divider */}
      <div className="w-8 h-px bg-white/[0.07] mb-2" />

      {/* Expand toggle */}
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggle}
              className="flex items-center justify-center size-9 rounded-lg text-white/25 hover:text-white/70 hover:bg-white/[0.07] transition-all duration-200 mb-2"
              aria-label="ขยายเมนู"
            >
              <ChevronsRight className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={12} className="text-[12px]">
            ขยายเมนู
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Divider */}
      <div className="w-8 h-px bg-white/[0.07] my-2" />

      {/* Section icons with popovers */}
      <div className="flex-1 flex flex-col items-center gap-0.5 w-full px-2 overflow-y-auto scrollbar-none">
        <TooltipProvider delayDuration={0}>
          {sections.map((section) => (
            <Popover
              key={section.key}
              open={openPopover === section.key}
              onOpenChange={(open) => setOpenPopover(open ? section.key : null)}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        'relative flex items-center justify-center size-10 w-full rounded-lg transition-all duration-200',
                        isSectionActive(section)
                          ? 'bg-white/10 text-white before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-[3px] before:bg-primary before:rounded-r-full'
                          : 'text-white/40 hover:text-white/80 hover:bg-white/[0.07]',
                      )}
                      aria-label={section.label}
                    >
                      <section.icon className="size-[18px]" />
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                {openPopover !== section.key && (
                  <TooltipContent side="right" sideOffset={12} className="text-[12px] font-medium">
                    {section.label}
                  </TooltipContent>
                )}
              </Tooltip>

              <PopoverContent
                side="right"
                sideOffset={16}
                align="start"
                className="w-52 p-1.5 shadow-xl shadow-black/15 border-border/60 rounded-xl"
              >
                {/* Section header */}
                <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-2 mb-0.5">
                  <section.icon className="size-3.5 text-muted-foreground/60" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    {section.label}
                  </span>
                </div>
                <div className="h-px bg-border/60 mb-1.5 mx-1" />
                {section.items.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setOpenPopover(null)}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-colors duration-150',
                      isItemActive(item.path)
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground/75 hover:text-primary hover:bg-primary/6',
                    )}
                  >
                    <item.icon
                      className={cn(
                        'size-4 shrink-0',
                        isItemActive(item.path) ? 'opacity-100' : 'opacity-50',
                      )}
                    />
                    <span>{item.label}</span>
                    {isItemActive(item.path) && (
                      <ChevronRight className="size-3 ml-auto opacity-40" />
                    )}
                  </Link>
                ))}
              </PopoverContent>
            </Popover>
          ))}
        </TooltipProvider>
      </div>

      {/* Divider */}
      <div className="w-8 h-px bg-white/[0.07] mt-2 mb-3" />

      {/* User avatar at bottom */}
      {user && (
        <div className="flex flex-col items-center gap-2 shrink-0">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="size-9 rounded-full bg-linear-to-br from-primary/40 to-primary/20 flex items-center justify-center cursor-default ring-2 ring-white/10">
                  <span className="text-white text-sm font-bold">{user.name?.charAt(0)}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={12} className="text-[12px]">
                <p className="font-semibold">{user.name}</p>
                {roleInfo && <p className="text-muted-foreground">{roleInfo.label}</p>}
                {user.branchName && <p className="text-muted-foreground">{user.branchName}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={logout}
                  className="flex items-center justify-center size-9 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
                  aria-label="ออกจากระบบ"
                >
                  <LogOut className="size-[17px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={12} className="text-[12px]">
                ออกจากระบบ
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}

/* ─── Expanded Full Sidebar (264px wide) ─────────── */
function ExpandedSidebar({ onToggle }: { onToggle: () => void }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  const matchPath = useCallback(
    (path: string): boolean =>
      path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname],
  );

  const sections = useRoleMenu(user?.role ?? '');

  const role = user?.role ?? '';
  const roleInfo = roleBadgeMap[role];

  return (
    <div
      className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[264px] flex flex-col bg-sidebar-dark border-r border-white/4 shadow-[4px_0_24px_rgba(0,0,0,0.25)] transition-all duration-300"
      aria-label="เมนูหลัก"
    >
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 h-[70px] shrink-0 border-b border-white/5">
        <Link to="/" className="flex items-center gap-3">
          <div className="size-[38px] rounded-xl bg-linear-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/30 ring-1 ring-white/10 shrink-0">
            <span className="text-white text-[17px] font-bold leading-none">B</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-extrabold text-white tracking-tight">
              BEST<span className="text-primary">CHOICE</span>
            </span>
            <span className="text-[10px] text-white/30 font-medium tracking-widest uppercase">
              Finance System
            </span>
          </div>
        </Link>
        <button
          onClick={onToggle}
          className="flex items-center justify-center size-7 rounded-lg text-white/25 hover:text-white/70 hover:bg-white/[0.07] transition-all duration-200 shrink-0"
          aria-label="ย่อเมนู"
        >
          <ChevronsLeft className="size-4" />
        </button>
      </div>

      {/* ── Navigation ──────────────────────────────── */}
      <ScrollArea className="flex-1 py-4 px-3">
        <AccordionMenu
          selectedValue={pathname}
          matchPath={matchPath}
          type="multiple"
          classNames={expandedMenuClassNames}
        >
          {sections.map((section) => (
            <AccordionMenuSub key={section.key} value={section.key} data-testid={`nav-${section.key}`}>
              <AccordionMenuSubTrigger>
                <section.icon data-slot="accordion-menu-icon" className="size-[15px] shrink-0" />
                <span data-slot="accordion-menu-title">{section.label}</span>
              </AccordionMenuSubTrigger>
              <AccordionMenuSubContent parentValue={section.key} type="single" collapsible>
                {section.items.map((item) => (
                  <AccordionMenuItem key={item.path} value={item.path} className="text-[13px]">
                    <Link to={item.path} className="flex items-center gap-2.5 w-full">
                      <item.icon
                        data-slot="accordion-menu-icon"
                        className="size-[15px] shrink-0 opacity-60"
                      />
                      <span data-slot="accordion-menu-title">{item.label}</span>
                    </Link>
                  </AccordionMenuItem>
                ))}
              </AccordionMenuSubContent>
            </AccordionMenuSub>
          ))}
        </AccordionMenu>
      </ScrollArea>

      {/* ── User footer ─────────────────────────────── */}
      {user && (
        <div className="px-4 py-3.5 border-t border-white/5 shrink-0 bg-white/1.5">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="size-9 rounded-full bg-linear-to-br from-primary/40 to-primary/20 flex items-center justify-center shrink-0 ring-2 ring-white/10">
              <span className="text-white text-sm font-bold">{user.name?.charAt(0)}</span>
            </div>

            {/* Name + role */}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white truncate leading-tight">{user.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {roleInfo && (
                  <span className={cn('inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded-md', roleInfo.cls)}>
                    {roleInfo.label}
                  </span>
                )}
                {user.branchName && (
                  <span className="text-[10px] text-white/30 truncate">{user.branchName}</span>
                )}
              </div>
            </div>

            {/* Logout */}
            <button
              onClick={logout}
              className="flex items-center justify-center size-8 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 shrink-0"
              aria-label="ออกจากระบบ"
            >
              <LogOut className="size-[15px]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Mobile Full Sidebar (inside Sheet) ─────────── */
function MobileSidebarContent() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  const matchPath = useCallback(
    (path: string): boolean =>
      path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname],
  );

  const sections = useRoleMenu(user?.role ?? '');
  const role = user?.role ?? '';
  const roleInfo = roleBadgeMap[role];

  return (
    <div className="w-full h-full flex flex-col bg-sidebar-dark">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-[66px] shrink-0 border-b border-white/5">
        <div className="size-[36px] rounded-xl bg-linear-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/30 ring-1 ring-white/10 shrink-0">
          <span className="text-white text-base font-bold leading-none">B</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-extrabold text-white tracking-tight">
            BEST<span className="text-primary">CHOICE</span>
          </span>
          <span className="text-[10px] text-white/30 font-medium tracking-widest uppercase">
            Finance System
          </span>
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4 px-3">
        <AccordionMenu
          selectedValue={pathname}
          matchPath={matchPath}
          type="multiple"
          classNames={expandedMenuClassNames}
        >
          {sections.map((section) => (
            <AccordionMenuSub key={section.key} value={section.key} data-testid={`nav-mobile-${section.key}`}>
              <AccordionMenuSubTrigger>
                <section.icon data-slot="accordion-menu-icon" className="size-[15px] shrink-0" />
                <span data-slot="accordion-menu-title">{section.label}</span>
              </AccordionMenuSubTrigger>
              <AccordionMenuSubContent parentValue={section.key} type="single" collapsible>
                {section.items.map((item) => (
                  <AccordionMenuItem key={item.path} value={item.path} className="text-[13px]">
                    <Link to={item.path} className="flex items-center gap-2.5 w-full">
                      <item.icon
                        data-slot="accordion-menu-icon"
                        className="size-[15px] shrink-0 opacity-60"
                      />
                      <span data-slot="accordion-menu-title">{item.label}</span>
                    </Link>
                  </AccordionMenuItem>
                ))}
              </AccordionMenuSubContent>
            </AccordionMenuSub>
          ))}
        </AccordionMenu>
      </ScrollArea>

      {/* User footer */}
      {user && (
        <div className="px-4 py-3.5 border-t border-white/5 shrink-0 bg-white/1.5">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-linear-to-br from-primary/40 to-primary/20 flex items-center justify-center shrink-0 ring-2 ring-white/10">
              <span className="text-white text-sm font-bold">{user.name?.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white truncate leading-tight">{user.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {roleInfo && (
                  <span className={cn('inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded-md', roleInfo.cls)}>
                    {roleInfo.label}
                  </span>
                )}
                {user.branchName && (
                  <span className="text-[10px] text-white/30 truncate">{user.branchName}</span>
                )}
              </div>
            </div>
            <button
              onClick={logout}
              className="flex items-center justify-center size-8 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 shrink-0"
              aria-label="ออกจากระบบ"
            >
              <LogOut className="size-[15px]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Chat Unread Badge (exported for TopBar) ──────── */
export function ChatUnreadBadge({ className }: { className?: string }) {
  const count = useUnreadChat();
  if (count <= 0) return null;
  return (
    <span className={cn('min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none', className)}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

/* ─── Main Sidebar Component ─────────────────────── */
function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const { sidebarCollapse, setSidebarCollapse } = useLayout();

  if (mobile) {
    return <MobileSidebarContent />;
  }

  const handleToggle = () => setSidebarCollapse(!sidebarCollapse);

  return sidebarCollapse ? (
    <CollapsedSidebar onToggle={handleToggle} />
  ) : (
    <ExpandedSidebar onToggle={handleToggle} />
  );
}

export default memo(Sidebar);
