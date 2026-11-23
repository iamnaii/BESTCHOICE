import { useMemo, useCallback, memo, useState, useEffect } from 'react';
import { useUnreadChat } from '@/hooks/useUnreadChat';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { WORK_ZONE_ICONS, MENU_GROUP_ICONS } from '@/config/navigation-icons';

import {
  LogOut,
  ChevronsRight,
  ChevronsLeft,
  ChevronRight,
} from '@/lib/icons';
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
import { getSidebarForRole, getZoneConfigForRole, getZoneEntryPathForRole, getWorkZoneHref } from '@/config/menu';
import type { MenuSection, MenuBadgeKey, Zone } from '@/config/menu';
import { useCollectionsFlag } from '@/pages/CollectionsPage/hooks/useCollectionsFlag';
import { useDraftAssetCount } from '@/hooks/useDraftAssetCount';
import { useQcPendingCount } from '@/hooks/useQcPendingCount';
import { useStockAdjustmentPendingCount } from '@/hooks/useStockAdjustmentPendingCount';
import { VersionBadge } from './VersionBadge';
import { PillSwitcher } from './PillSwitcher';
import { GearButton } from './GearButton';
import { WorkNavigation } from './WorkNavigation';
import { ExitSettingsBar, SettingsNavList, SettingsZoneHeader, useSettingsZone } from './SettingsNav';

const SettingsIcon = MENU_GROUP_ICONS['settings:ตั้งค่าระบบ'];

/* ── NavBadge — dynamic count badge for sidebar items ── */
function NavBadge({ badgeKey }: { badgeKey: MenuBadgeKey }) {
  const draftCount = useDraftAssetCount(badgeKey === 'asset-draft-count');
  const qcCount = useQcPendingCount(badgeKey === 'qc-pending-count');
  const saCount = useStockAdjustmentPendingCount(badgeKey === 'stock-adjustment-pending');
  const count = badgeKey === 'asset-draft-count' ? draftCount
    : badgeKey === 'qc-pending-count' ? qcCount
    : badgeKey === 'stock-adjustment-pending' ? saCount
    : undefined;
  if (!count || count === 0) return null;
  const cls = badgeKey === 'qc-pending-count' || badgeKey === 'stock-adjustment-pending'
    ? 'bg-warning/10 text-warning-strong dark:bg-warning/15'
    : 'bg-primary/15 text-primary';
  return (
    <span className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium ${cls}`}>
      {count}
    </span>
  );
}

/* ── Role label map ─────────────────────────────── */
const roleBadgeMap: Record<string, { label: string; cls: string }> = {
  OWNER:          { label: "เจ้าของ",        cls: 'bg-primary text-primary-foreground' },
  BRANCH_MANAGER: { label: 'ผจก.สาขา',    cls: 'bg-info text-info-foreground' },
  FINANCE_MANAGER:{ label: 'การเงิน',      cls: 'bg-primary text-primary-foreground' },
  ACCOUNTANT:     { label: 'บัญชี',        cls: 'bg-accent-purple text-accent-purple-foreground' },
  SALES:          { label: 'พนง.ขาย',      cls: 'bg-accent-sky text-accent-sky-foreground' },
};

/* ─── useRoleMenu ───────────────────────────────── */
function useRoleMenu(role: string, zone: Zone): MenuSection[] {
  const { enabled: collectionsEnabled } = useCollectionsFlag();
  return useMemo(() => {
    const sections = getSidebarForRole(role, zone);
    if (!collectionsEnabled) return sections;
    // Swap /overdue → /collections when the flag is on
    return sections.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.path === '/overdue' ? { ...item, path: '/collections' } : item,
      ),
    }));
  }, [role, zone, collectionsEnabled]);
}

/* ─── useZoneValidator ────────────────────────────
 * Falls back to defaultZone when the current zone is invalid for the active role.
 * Shared between Expanded/Collapsed/Mobile variants.
 */
function useZoneValidator() {
  const { currentZone, setCurrentZone } = useLayout();
  const { user } = useAuth();
  const role = user?.role ?? '';
  const zoneConfig = getZoneConfigForRole(role, user?.accessibleCompanies);

  useEffect(() => {
    if (!zoneConfig) return;
    // For non-settings zones: must be in role's zones[]
    if (currentZone !== 'settings' && !zoneConfig.zones.includes(currentZone)) {
      setCurrentZone(zoneConfig.defaultZone);
    }
    // For settings: must have gear access
    if (currentZone === 'settings' && !zoneConfig.showSettingsGear) {
      setCurrentZone(zoneConfig.defaultZone);
    }
  }, [zoneConfig, currentZone, setCurrentZone]);

  return { role, zoneConfig, currentZone, setCurrentZone };
}

// path ที่มี hash (เช่น '/settings/accounting#vat') ต้อง match ทั้ง pathname + hash
// ขอบท้ายต้องเป็น '/' ไม่งั้น '/products' จะกินหน้า '/products-foo' ไปด้วย
function pathMatches(path: string, pathname: string, hash: string): boolean {
  if (path.includes('#')) return path === pathname + hash;
  return path === pathname || (path.length > 1 && pathname.startsWith(path + '/'));
}

/**
 * เมนูที่เจาะจงที่สุดชนะ — เมนูซ้อน path กัน ('/purchase-orders' กับ '/purchase-orders/qc')
 * เข้าเงื่อนไข match พร้อมกันทั้งคู่; ถ้าไฮไลต์ทุกตัวที่ match ผู้ใช้จะเห็นแถบเขียวสองอัน
 * แล้วบอกไม่ได้ว่าอยู่หน้าไหน จึงเลือกเฉพาะตัวที่ path ยาวที่สุดเพียงตัวเดียว
 */
export function resolveActivePath(paths: string[], pathname: string, hash: string): string | null {
  let best: string | null = null;
  for (const p of paths) {
    if (!pathMatches(p, pathname, hash)) continue;
    if (best === null || p.length > best.length) best = p;
  }
  return best;
}

/** ทุก path ที่เมนูชุดนี้เสนอ (รวมเมนูย่อย) — ใช้ตัดสินว่าใครเจาะจงที่สุด */
function collectMenuPaths(sections: MenuSection[]): string[] {
  return sections.flatMap((s) =>
    s.items.flatMap((item) => [item.path, ...(item.children ?? []).map((c) => c.path)]),
  );
}

/* ─── Collapsed Icon Rail (70px wide) ────────────── */
function CollapsedSidebar({ onToggle }: { onToggle: () => void }) {
  const { user, logout } = useAuth();
  const { pathname, hash } = useLocation();
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const { role, zoneConfig, currentZone } = useZoneValidator();
  const { enter: enterSettings } = useSettingsZone();
  const navigate = useNavigate();

  const sections = useRoleMenu(role, currentZone);
  const sale = currentZone === 'shop' ? sections.flatMap((section) => section.items).find((item) => item.path === '/pos') : undefined;

  const activePath = useMemo(
    () => resolveActivePath(collectMenuPaths(sections), pathname, hash),
    [sections, pathname, hash],
  );

  const isSectionActive = useCallback(
    (section: MenuSection): boolean =>
      activePath !== null &&
      section.items.some(
        (item) =>
          item.path === activePath ||
          (item.children ?? []).some((child) => child.path === activePath),
      ),
    [activePath],
  );

  const isItemActive = useCallback((path: string): boolean => path === activePath, [activePath]);

  const roleInfo = roleBadgeMap[role];

  return (
    <div
      className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[70px] flex flex-col items-center bg-sidebar-bg py-3 border-r border-sidebar-border shadow-sm dark:shadow-[4px_0_24px_-8px_rgba(0,0,0,0.5)]"
      aria-label="เมนูหลัก (ย่อ)"
    >
      {/* Logo */}
      <Link to="/" className="flex items-center justify-center w-full mb-1 shrink-0 py-2">
        <img src="/logo-icon.svg" alt="BESTCHOICE" className="size-[36px] shrink-0" />
      </Link>

      {/* Divider */}
      <div className="w-8 h-px bg-sidebar-border mb-2" />

      {/* Expand toggle */}
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggle}
              className="flex items-center justify-center size-9 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-hover dark:text-muted-foreground/80 transition-all duration-200 mb-2"
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

      {/* Zone icons (only for multi-zone roles, hidden while in settings mode) */}
      {zoneConfig && zoneConfig.zones.length >= 2 && currentZone !== 'settings' && (
        <>
          <div className="w-8 h-px bg-sidebar-border my-1" />
          <TooltipProvider delayDuration={0}>
            {zoneConfig.zones
              .filter((z): z is 'shop' | 'fin' => z === 'shop' || z === 'fin')
              .map((zone) => {
                const Icon = WORK_ZONE_ICONS[zone];
                const active = currentZone === zone;
                const label = zone === 'shop' ? 'งานหน้าร้าน (SHOP)' : 'งานการเงิน (FINANCE)';
                return (
                  <Tooltip key={zone}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          if (zone === currentZone) return;
                          navigate(getWorkZoneHref(getZoneEntryPathForRole(role, zone), zone));
                        }}
                        aria-label={label}
                        aria-pressed={active}
                        className={cn(
                          'flex items-center justify-center size-9 rounded-lg transition-all duration-200 mb-1',
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-hover',
                        )}
                      >
                        <Icon className="size-[18px]" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={12} className="text-[12px]">
                      {label}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
          </TooltipProvider>
        </>
      )}

      {/* Divider */}
      <div className="w-8 h-px bg-sidebar-border my-2" />

      {sale && (
        <TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild>
          <Link to={sale.path} aria-label={sale.label} aria-current={activePath === sale.path ? 'page' : undefined}
            className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring">
            <sale.icon className="size-5" aria-hidden="true" data-nav-icon />
          </Link>
        </TooltipTrigger><TooltipContent side="right">{sale.label}</TooltipContent></Tooltip></TooltipProvider>
      )}

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
                          ? 'bg-primary/10 text-primary dark:bg-primary/20 before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-[3px] before:bg-primary before:rounded-r-full'
                          : 'text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-hover dark:text-muted-foreground/85',
                      )}
                      aria-label={section.label}
                    >
                      <section.icon className="size-[18px]" aria-hidden="true" data-nav-icon />
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
                className="w-52 p-1.5 shadow-xl shadow-black/15 dark:shadow-black/40 border-border/60 rounded-xl"
              >
                {/* Section header */}
                <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-2 mb-0.5">
                  <section.icon className="size-[18px] text-muted-foreground" aria-hidden="true" data-nav-icon />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                    {section.label}
                  </span>
                </div>
                <div className="h-px bg-border/60 mb-1.5 mx-1" />
                {section.items.filter((item) => !sale || item.path !== sale.path).map((item) =>
                  item.children && item.children.length > 0 ? (
                    <div key={item.path}>
                      <div className="flex items-center gap-2 px-2.5 pt-2 pb-1">
                        <item.icon className="size-[18px] shrink-0" aria-hidden="true" data-nav-icon />
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          {item.label}
                        </span>
                      </div>
                      {item.children.map((child) => (
                        <Link
                          key={child.path}
                          to={child.path}
                          onClick={() => setOpenPopover(null)}
                          className={cn(
                            'flex items-center gap-2.5 pl-6 pr-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-colors duration-150',
                            isItemActive(child.path)
                              ? 'bg-primary/10 text-primary dark:bg-primary/20'
                              : 'text-foreground/80 hover:text-primary hover:bg-primary/5 dark:hover:bg-primary/10',
                          )}
                        >
                          <child.icon className="size-[18px] shrink-0" aria-hidden="true" data-nav-icon />
                          <span>{child.label}</span>
                          {isItemActive(child.path) && (
                            <ChevronRight className="size-3 ml-auto opacity-60" />
                          )}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setOpenPopover(null)}
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-colors duration-150',
                        isItemActive(item.path)
                          ? 'bg-primary/10 text-primary dark:bg-primary/20'
                          : 'text-foreground/80 hover:text-primary hover:bg-primary/5 dark:hover:bg-primary/10',
                      )}
                    >
                      <item.icon className="size-[18px] shrink-0" aria-hidden="true" data-nav-icon />
                      <span>{item.label}</span>
                      {isItemActive(item.path) && (
                        <ChevronRight className="size-3 ml-auto opacity-60" />
                      )}
                    </Link>
                  )
                )}
              </PopoverContent>
            </Popover>
          ))}
        </TooltipProvider>
      </div>

      {/* Gear (settings) — only for roles with showSettingsGear */}
      {zoneConfig?.showSettingsGear && (
        <>
          <div className="w-8 h-px bg-sidebar-border my-1" />
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={enterSettings}
                  aria-label="ตั้งค่ากลาง"
                  className={cn(
                    'flex items-center justify-center size-9 rounded-lg transition-all duration-200',
                    'text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-hover',
                  )}
                >
                  <SettingsIcon className="size-[18px]" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={12} className="text-[12px]">
                ตั้งค่ากลาง
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </>
      )}

      {/* Divider */}
      <div className="w-8 h-px bg-sidebar-border mt-2 mb-3" />

      {/* User avatar at bottom */}
      {user && (
        <div className="flex flex-col items-center gap-2 shrink-0">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="size-9 rounded-full bg-muted flex items-center justify-center cursor-default ring-2 ring-sidebar-border">
                  <span className="text-primary text-sm font-bold">{user.name?.charAt(0)}</span>
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
                  className="flex items-center justify-center size-9 rounded-lg text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 dark:text-muted-foreground/80 transition-all duration-200"
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
  const { pathname, hash } = useLocation();
  const { role, zoneConfig, currentZone } = useZoneValidator();
  const { inSettings, enter: enterSettings } = useSettingsZone();

  const sections = useRoleMenu(role, currentZone);

  // เจาะจงที่สุดชนะ — กันแถบไฮไลต์ขึ้นสองอันเวลาเมนูซ้อน path กัน
  const activePath = useMemo(
    () => resolveActivePath(collectMenuPaths(sections), pathname, hash),
    [sections, pathname, hash],
  );
  const roleInfo = roleBadgeMap[role];

  return (
    <div
      className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[264px] flex flex-col bg-sidebar-bg border-r border-sidebar-border shadow-sm dark:shadow-[4px_0_24px_-8px_rgba(0,0,0,0.5)] transition-all duration-300"
      aria-label="เมนูหลัก"
    >
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center px-5 h-[60px] shrink-0 border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/logo-icon.svg" alt="BESTCHOICE" className="size-[32px] shrink-0" />
          <div className="flex flex-col leading-tight">
            <span className="text-[14px] font-extrabold text-foreground tracking-tight">
              BEST<span className="text-primary">CHOICE</span>
            </span>
            <span className="text-[10px] text-muted-foreground font-medium leading-snug">
              ระบบบริหารร้านและการเงิน
            </span>
          </div>
        </Link>
      </div>

      {/* ── User info ───────────────────────────────── */}
      {user && inSettings && (
        <div data-sidebar-user className="flex items-center gap-2.5 px-5 py-3 border-b border-sidebar-border">
          <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <span className="text-primary text-xs font-bold">{user.name?.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-medium text-foreground truncate">{user.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {roleInfo && (
                <span className={cn('inline-flex text-[12px] font-bold px-1.5 py-px rounded', roleInfo.cls)}>
                  {roleInfo.label}
                </span>
              )}
              {user.branchName && (
                <span className="text-[12px] text-muted-foreground truncate">{user.branchName}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── โหมดตั้งค่า: ทางออกอยู่บนสุด แทนที่ตำแหน่งของ PillSwitcher ที่ถูกซ่อน ── */}
      {inSettings ? (
        <>
          <ExitSettingsBar />
          <SettingsZoneHeader />
          <ScrollArea className="flex-1 pb-4 px-3">
            <SettingsNavList />
          </ScrollArea>
        </>
      ) : (
      <>
      {/* ── PillSwitcher (only if role has 2+ zones AND not in settings mode) ── */}
      {zoneConfig && zoneConfig.zones.length >= 2 && (
        <PillSwitcher
          zones={zoneConfig.zones}
          current={currentZone}
        />
      )}

      <WorkNavigation
        key={`${role}-${currentZone}`}
        zone={currentZone === 'fin' ? 'fin' : 'shop'}
        sections={sections}
        activePath={activePath}
        renderBadge={(badgeKey) => <NavBadge badgeKey={badgeKey} />}
      />

      {/* ── GearButton = ทางเข้าเท่านั้น; ในโหมดตั้งค่าใช้แถบด้านบนออก
           (ปุ่มเดียวทำสองหน้าที่ + ไฮไลต์เขียวตอน active = อ่านเป็นป้ายบอกตำแหน่ง ไม่ใช่ปุ่มออก) ── */}
      {zoneConfig?.showSettingsGear && <GearButton onClick={enterSettings} />}
      </>
      )}

      {/* ── User info ───────────────────────────────── */}
      {user && !inSettings && (
        <div data-sidebar-user className="flex items-center gap-2.5 px-4 py-2 border-t border-sidebar-border shrink-0">
          <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <span className="text-primary text-xs font-bold">{user.name?.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-foreground truncate">{user.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {roleInfo && (
                <span className={cn('inline-flex text-[11px] font-medium text-muted-foreground')}>
                  {roleInfo.label}
                </span>
              )}
              {user.branchName && (
                <span className="text-[12px] text-muted-foreground truncate">{user.branchName}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Footer (collapse toggle + logout) ───────── */}
      <div className="px-4 py-3 border-t border-sidebar-border shrink-0 flex items-center justify-between">
        {!inSettings && (
        <button
          onClick={onToggle}
          className="flex items-center justify-center size-8 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-hover dark:text-muted-foreground/85 transition-all duration-200"
          aria-label="ย่อเมนู"
        >
          <ChevronsLeft className="size-4" />
        </button>
        )}
        {/* ที่ว่างแทนปุ่มย่อ — footer เป็น justify-between 3 ช่อง ถ้าหายไปเฉย ๆ
            VersionBadge จะกระโดดไปชิดซ้ายทุกครั้งที่เข้า/ออกโหมดตั้งค่า */}
        {inSettings && <span className="size-8 shrink-0" aria-hidden="true" />}
        <VersionBadge />
        <button
          onClick={logout}
          className="flex items-center justify-center size-8 rounded-lg text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 dark:text-muted-foreground/85 transition-all duration-200"
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
  const { setMobileSidebarOpen } = useLayout();
  const { user, logout } = useAuth();
  const { pathname, hash } = useLocation();
  const { role, zoneConfig, currentZone } = useZoneValidator();
  const { inSettings, enter: enterSettings } = useSettingsZone();

  const sections = useRoleMenu(role, currentZone);

  // เจาะจงที่สุดชนะ — กันแถบไฮไลต์ขึ้นสองอันเวลาเมนูซ้อน path กัน
  const activePath = useMemo(
    () => resolveActivePath(collectMenuPaths(sections), pathname, hash),
    [sections, pathname, hash],
  );
  const roleInfo = roleBadgeMap[role];

  return (
    <div className="w-full h-full flex flex-col bg-sidebar-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-[66px] shrink-0 border-b border-sidebar-border">
        <img src="/logo-icon.svg" alt="BESTCHOICE" className="size-[32px] shrink-0" />
        <div className="flex flex-col leading-tight">
          <span className="text-[14px] font-extrabold text-foreground tracking-tight">
            BEST<span className="text-primary">CHOICE</span>
          </span>
          <span className="text-[10px] text-muted-foreground font-medium leading-snug">
            ระบบบริหารร้านและการเงิน
          </span>
        </div>
      </div>

      {/* User info */}
      {user && inSettings && (
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-sidebar-border">
          <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <span className="text-primary text-xs font-bold">{user.name?.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-medium text-foreground truncate">{user.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {roleInfo && (
                <span className={cn('inline-flex text-[12px] font-bold px-1.5 py-px rounded', roleInfo.cls)}>
                  {roleInfo.label}
                </span>
              )}
              {user.branchName && (
                <span className="text-[12px] text-muted-foreground truncate">{user.branchName}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* โหมดตั้งค่า: ทางออกอยู่บนสุด (บาร์ล่างมีปุ่มออกอีกทาง สำหรับคนที่ไม่เปิดลิ้นชัก) */}
      {inSettings ? (
        <>
          <ExitSettingsBar testId="exit-settings-mobile" />
          <SettingsZoneHeader />
          <ScrollArea className="flex-1 pb-4 px-3">
            <SettingsNavList testIdPrefix="settings-nav-mobile" />
          </ScrollArea>
        </>
      ) : (
      <>
      {/* PillSwitcher (only if role has 2+ zones AND not in settings mode) */}
      {zoneConfig && zoneConfig.zones.length >= 2 && (
        <PillSwitcher
          zones={zoneConfig.zones}
          current={currentZone}
        />
      )}

      <WorkNavigation
        key={`${role}-${currentZone}`}
        zone={currentZone === 'fin' ? 'fin' : 'shop'}
        sections={sections}
        activePath={activePath}
        mobile
        onNavigate={() => setMobileSidebarOpen(false)}
        renderBadge={(badgeKey) => <NavBadge badgeKey={badgeKey} />}
      />

      {/* GearButton = ทางเข้าเท่านั้น (ทางออกอยู่แถบบน + บาร์ล่าง) */}
      {zoneConfig?.showSettingsGear && <GearButton onClick={enterSettings} />}
      </>
      )}

      {/* User info */}
      {user && !inSettings && (
        <div className="flex items-center gap-2.5 px-4 py-2 border-t border-sidebar-border shrink-0">
          <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <span className="text-primary text-xs font-bold">{user.name?.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-foreground truncate">{user.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {roleInfo && (
                <span className={cn('inline-flex text-[11px] font-medium text-muted-foreground')}>
                  {roleInfo.label}
                </span>
              )}
              {user.branchName && (
                <span className="text-[12px] text-muted-foreground truncate">{user.branchName}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer (logout) */}
      <div className="px-4 py-3 border-t border-sidebar-border shrink-0 flex items-center justify-between">
        <VersionBadge />
        <button
          onClick={logout}
          className="flex items-center justify-center size-8 rounded-lg text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 dark:text-muted-foreground/85 transition-all duration-200"
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
    <span className={cn('min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-snug', className)}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

/* ─── Main Sidebar Component ─────────────────────── */
function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const { sidebarCollapse, setSidebarCollapse, effectiveSidebarCollapse } = useLayout();

  if (mobile) {
    return <MobileSidebarContent />;
  }

  const handleToggle = () => setSidebarCollapse(!sidebarCollapse);

  // โหมดตั้งค่าบังคับกาง — 10 หมวดที่ไอคอนหน้าตาใกล้กัน (Wallet/BarChart3/Smartphone)
  // แยกด้วยไอคอนล้วนไม่ออก และ tooltip ต้อง hover ซึ่งจอสัมผัสไม่มี
  return effectiveSidebarCollapse ? (
    <CollapsedSidebar onToggle={handleToggle} />
  ) : (
    <ExpandedSidebar onToggle={handleToggle} />
  );
}

export default memo(Sidebar);
