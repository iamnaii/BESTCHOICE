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
  OWNER:          { label: 'OWNER',        cls: 'bg-gradient-to-r from-[#1e3a5f] to-[#059669] text-white' },
  BRANCH_MANAGER: { label: 'ผจก.สาขา',    cls: 'bg-[#1e3a5f] text-white' },
  FINANCE_MANAGER:{ label: 'การเงิน',      cls: 'bg-[#059669] text-white' },
  ACCOUNTANT:     { label: 'บัญชี',        cls: 'bg-[#7c3aed] text-white' },
  SALES:          { label: 'พนง.ขาย',      cls: 'bg-[#0ea5e9] text-white' },
};

/* ── Expanded menu AccordionMenu classNames ─────── */
const expandedMenuClassNames: AccordionMenuClassNames = {
  root: 'space-y-0.5',
  item: [
    'h-[34px] rounded-md text-[14px] font-medium',
    'text-white/45 hover:text-white/80 hover:bg-white/[0.06]',
    'transition-colors duration-150',
    'data-[selected=true]:bg-emerald-500/20 data-[selected=true]:text-emerald-300',
    'relative data-[selected=true]:before:absolute data-[selected=true]:before:left-0',
    'data-[selected=true]:before:top-[5px] data-[selected=true]:before:bottom-[5px]',
    'data-[selected=true]:before:w-[3px] data-[selected=true]:before:bg-emerald-500',
    'data-[selected=true]:before:rounded-r-full',
  ].join(' '),
  sub: '',
  subTrigger: [
    'h-[32px] rounded-md text-[11px] font-semibold uppercase tracking-[0.1em]',
    'text-white/25 hover:text-white/50 hover:bg-transparent',
    'data-[state=open]:text-white/40 data-[state=open]:bg-transparent',
    'transition-colors duration-150 px-2',
  ].join(' '),
  subContent: 'py-0.5 pl-0 border-l-0 ml-0',
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
      className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[70px] flex flex-col items-center bg-gradient-to-b from-[#1e3a5f] to-[#0f2035] py-3 border-r border-white/[0.06] shadow-[4px_0_24px_rgba(15,32,53,0.3)]"
      aria-label="เมนูหลัก (ย่อ)"
    >
      {/* Logo */}
      <Link to="/" className="flex items-center justify-center w-full mb-1 shrink-0 py-2">
        <div className="size-[36px] rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
          <span className="text-white text-[16px] font-bold leading-none">B</span>
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
                          ? 'bg-emerald-500/15 text-emerald-300 before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-[3px] before:bg-emerald-500 before:rounded-r-full'
                          : 'text-white/35 hover:text-white/70 hover:bg-white/[0.06]',
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
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'text-foreground/75 hover:text-emerald-700 hover:bg-emerald-50/50',
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
                <div className="size-9 rounded-full bg-white/10 flex items-center justify-center cursor-default ring-2 ring-white/10">
                  <span className="text-emerald-300 text-sm font-bold">{user.name?.charAt(0)}</span>
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
      className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[264px] flex flex-col bg-gradient-to-b from-[#1e3a5f] via-[#162d4a] to-[#0f2035] border-r border-white/[0.06] shadow-[4px_0_24px_rgba(15,32,53,0.3)] transition-all duration-300"
      aria-label="เมนูหลัก"
    >
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center px-5 h-[70px] shrink-0 border-b border-white/[0.06]">
        <Link to="/" className="flex items-center gap-3">
          <div className="size-[36px] rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
            <span className="text-white text-[16px] font-bold leading-none">B</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-bold text-white tracking-tight">
              BESTCHOICE
            </span>
            <span className="text-[11px] text-white/30 font-medium tracking-widest uppercase">
              Finance Management
            </span>
          </div>
        </Link>
      </div>

      {/* ── User info ───────────────────────────────── */}
      {user && (
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-white/[0.06]">
          <div className="size-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <span className="text-emerald-300 text-xs font-bold">{user.name?.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-white/70 truncate">{user.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {roleInfo && (
                <span className={cn('inline-flex text-[11px] font-bold px-1.5 py-px rounded', roleInfo.cls)}>
                  {roleInfo.label}
                </span>
              )}
              {user.branchName && (
                <span className="text-[11px] text-white/25 truncate">{user.branchName}</span>
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* ── Footer (collapse toggle + logout) ───────── */}
      <div className="px-4 py-3 border-t border-white/[0.06] shrink-0 flex items-center justify-between">
        <button
          onClick={onToggle}
          className="flex items-center justify-center size-8 rounded-lg text-white/25 hover:text-white/70 hover:bg-white/[0.07] transition-all duration-200"
          aria-label="ย่อเมนู"
        >
          <ChevronsLeft className="size-4" />
        </button>
        <button
          onClick={logout}
          className="flex items-center justify-center size-8 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
          aria-label="ออกจากระบบ"
        >
          <LogOut className="size-[15px]" />
        </button>
      </div>
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
    <div className="w-full h-full flex flex-col bg-gradient-to-b from-[#1e3a5f] via-[#162d4a] to-[#0f2035]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-[66px] shrink-0 border-b border-white/[0.06]">
        <div className="size-[36px] rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
          <span className="text-white text-[16px] font-bold leading-none">B</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-bold text-white tracking-tight">
            BESTCHOICE
          </span>
          <span className="text-[11px] text-white/30 font-medium tracking-widest uppercase">
            Finance Management
          </span>
        </div>
      </div>

      {/* User info */}
      {user && (
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-white/[0.06]">
          <div className="size-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <span className="text-emerald-300 text-xs font-bold">{user.name?.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-white/70 truncate">{user.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {roleInfo && (
                <span className={cn('inline-flex text-[11px] font-bold px-1.5 py-px rounded', roleInfo.cls)}>
                  {roleInfo.label}
                </span>
              )}
              {user.branchName && (
                <span className="text-[11px] text-white/25 truncate">{user.branchName}</span>
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* Footer (logout) */}
      <div className="px-4 py-3 border-t border-white/[0.06] shrink-0 flex justify-end">
        <button
          onClick={logout}
          className="flex items-center justify-center size-8 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
          aria-label="ออกจากระบบ"
        >
          <LogOut className="size-[15px]" />
        </button>
      </div>
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
