import { useMemo, useCallback, memo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  ShoppingCart,
  Warehouse,
  BarChart3,
  Settings,
  Home,
  CreditCard,
  Users,
  FileCheck,
  FileText,
  Receipt,
  AlertTriangle,
  RefreshCw,
  Undo2,
  ClipboardList,
  Bell,
  Building2,
  UserCog,
  DollarSign,
  FileSignature,
  Shield,
  ScrollText,
  ArrowRightLeft,
  LogOut,
  ChevronsRight,
  ChevronsLeft,
  Banknote,
  Zap,
  Store,
  Package,
  Truck,
  HandCoins,
  TrendingDown,
  Smartphone,
  Lock,
  Wallet,
  PieChart,
  Calculator,
  Landmark,
  BadgePercent,
  CircleDollarSign,
  UserSearch,
  Coins,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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

interface NavItem {
  label: string;
  path: string;
  icon?: LucideIcon;
  roles?: string[];
}

interface NavSection {
  key: string;
  label: string;
  icon: LucideIcon;
  group?: 'shop' | 'finance' | 'general'; // section group header
  items: NavItem[];
}

const navSections: NavSection[] = [
  // ── SHOP (หน้าร้าน) ──────────────────────────────
  {
    key: 'sales',
    label: 'ขาย',
    icon: Store,
    group: 'shop',
    items: [
      { label: 'ขายของ', path: '/pos', icon: ShoppingCart },
      { label: 'ลูกค้า', path: '/customers', icon: Users },
      { label: 'ตรวจสอบลูกค้า', path: '/credit-checks', icon: UserSearch },
      { label: 'รับซื้อเครื่อง', path: '/trade-in', icon: Smartphone, roles: ['OWNER', 'BRANCH_MANAGER', 'SALES'] },
    ],
  },
  {
    key: 'inventory',
    label: 'คลัง',
    icon: Package,
    group: 'shop',
    items: [
      { label: 'สต็อกสินค้า', path: '/stock', icon: Warehouse, roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'] },
      { label: 'สั่งซื้อ', path: '/purchase-orders', icon: ClipboardList, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'โอนสินค้า', path: '/stock/transfers', icon: Truck, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'ผู้ขาย', path: '/suppliers', icon: Building2, roles: ['OWNER', 'BRANCH_MANAGER'] },
    ],
  },
  // ── FINANCE (ไฟแนนซ์) ────────────────────────────
  {
    key: 'contracts',
    label: 'สัญญา',
    icon: FileSignature,
    group: 'finance',
    items: [
      { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
      { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
      { label: 'เงินรับจาก FINANCE', path: '/finance-receivable', icon: Banknote, roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
    ],
  },
  {
    key: 'debt',
    label: 'ติดตาม',
    icon: TrendingDown,
    group: 'finance',
    items: [
      { label: 'ลูกค้าค้างชำระ', path: '/overdue', icon: AlertTriangle },
      { label: 'เปลี่ยนเครื่อง', path: '/exchange', icon: RefreshCw, roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'] },
      { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock, roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'] },
    ],
  },
  // ── ทั่วไป ───────────────────────────────────────
  {
    key: 'accounting',
    label: 'การเงิน',
    icon: Wallet,
    group: 'general',
    items: [
      { label: 'รายจ่าย', path: '/expenses', icon: Receipt, roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
      { label: 'ใบเสร็จ', path: '/receipts', icon: FileText, roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
      { label: 'กำไร-ขาดทุน', path: '/profit-loss', icon: PieChart, roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
      { label: 'ค่าคอม', path: '/commissions', icon: Coins, roles: ['OWNER', 'FINANCE_MANAGER', 'SALES'] },
      { label: 'สินทรัพย์', path: '/assets', icon: Landmark, roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
    ],
  },
  {
    key: 'reports',
    label: 'รายงาน',
    icon: BarChart3,
    group: 'general',
    items: [
      { label: 'รายงาน', path: '/reports', icon: BarChart3, roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
      { label: 'ภาษี', path: '/tax-reports', icon: Calculator, roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
      { label: 'แจ้งเตือน', path: '/notifications', icon: Bell, roles: ['OWNER', 'BRANCH_MANAGER'] },
    ],
  },
  {
    key: 'settings',
    label: 'ตั้งค่า',
    icon: Settings,
    group: 'general',
    items: [
      { label: 'ระบบ', path: '/settings', icon: Settings, roles: ['OWNER'] },
      { label: 'ผู้ใช้', path: '/users', icon: UserCog, roles: ['OWNER'] },
      { label: 'สาขา', path: '/branches', icon: Building2, roles: ['OWNER'] },
      { label: 'บริษัท', path: '/settings/companies', icon: Building2, roles: ['OWNER'] },
      { label: 'ตั้งราคา', path: '/settings/pricing-templates', icon: CircleDollarSign, roles: ['OWNER'] },
      { label: 'แบบสัญญา', path: '/contract-templates', icon: FileCheck, roles: ['OWNER'] },
      { label: 'โปรโมชัน', path: '/promotions', icon: BadgePercent, roles: ['OWNER'] },
      { label: 'PDPA', path: '/pdpa', icon: Shield, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'Audit Log', path: '/audit-logs', icon: ScrollText, roles: ['OWNER'] },
      { label: 'ผังบัญชี', path: '/settings/chart-of-accounts', icon: ClipboardList, roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
      { label: 'ตรวจสอบบัญชี', path: '/financial-audit', icon: ClipboardList, roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
    ],
  },
];

/* Expanded sidebar menu classNames (dark bg, white text) — Metronic v9 pattern */
const expandedMenuClassNames: AccordionMenuClassNames = {
  root: 'space-y-1',
  item: 'h-[34px] rounded-md text-[13px] text-white/60 hover:bg-transparent hover:text-white transition-colors duration-150 data-[selected=true]:bg-white/[0.08] data-[selected=true]:text-white data-[selected=true]:font-medium relative data-[selected=true]:before:absolute data-[selected=true]:before:left-0 data-[selected=true]:before:top-1 data-[selected=true]:before:bottom-1 data-[selected=true]:before:w-[3px] data-[selected=true]:before:bg-primary data-[selected=true]:before:rounded-r-full',
  sub: '',
  subTrigger: 'h-[38px] rounded-md text-[13px] font-semibold uppercase tracking-wide text-white/40 hover:bg-transparent hover:text-white/70 data-[state=open]:text-white/80 transition-colors duration-150',
  subContent: 'py-0.5 pl-2.5',
};

/* ─── Collapsed Icon Rail (70px) — Demo 9 default ─── */
function CollapsedSidebar({ onToggle }: { onToggle: () => void }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [openPopover, setOpenPopover] = useState<string | null>(null);

  const filteredSections = useMemo((): NavSection[] => {
    return navSections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => !item.roles || (user && item.roles.includes(user.role)),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [user]);

  const isSectionActive = useCallback(
    (section: NavSection): boolean => {
      return section.items.some(
        (item) => item.path === pathname || (item.path.length > 1 && (pathname.startsWith(item.path + '/') || pathname === item.path)),
      );
    },
    [pathname],
  );

  const isItemActive = useCallback(
    (path: string): boolean =>
      path === pathname || (path.length > 1 && (pathname.startsWith(path + '/') || pathname === path)),
    [pathname],
  );

  return (
    <div className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[70px] flex flex-col items-center bg-sidebar-dark py-4 gap-1 transition-all duration-300">
      {/* Logo */}
      <Link to="/" className="flex items-center justify-center mb-0.5 shrink-0">
        <div className="size-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/25 ring-1 ring-white/[0.06]">
          <span className="text-white text-lg font-bold">B</span>
        </div>
      </Link>

      {/* Expand toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center size-8 rounded-full text-white/20 hover:text-white/60 hover:bg-white/[0.06] transition-all duration-200 mb-0.5"
        aria-label="ขยายเมนู"
      >
        <ChevronsRight className="size-4" />
      </button>

      {/* Divider */}
      <div className="w-7 h-px bg-white/[0.06] mb-0.5" />

      {/* Home icon */}
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/"
              className={cn(
                'flex items-center justify-center size-10 rounded-lg transition-all duration-200',
                pathname === '/'
                  ? 'bg-white/[0.08] text-white shadow-sm'
                  : 'text-white/35 hover:text-white/75 hover:bg-white/[0.06]',
              )}
            >
              <Home className="size-[18px]" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10} className="font-medium">
            หน้าหลัก
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Section icons with popovers */}
      <div className="flex-1 flex flex-col items-center gap-0.5 py-2 overflow-y-auto scrollbar-none">
        <TooltipProvider delayDuration={0}>
          {filteredSections.map((section) => (
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
                        'flex items-center justify-center size-10 rounded-lg transition-all duration-200 relative group',
                        isSectionActive(section)
                          ? 'bg-white/[0.08] text-white'
                          : 'text-white/35 hover:text-white/75 hover:bg-white/[0.06]',
                      )}
                    >
                      {isSectionActive(section) && (
                        <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] bg-primary rounded-r-full" />
                      )}
                      <section.icon className="size-[18px]" />
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                {openPopover !== section.key && (
                  <TooltipContent side="right" sideOffset={10} className="font-medium">
                    {section.label}
                  </TooltipContent>
                )}
              </Tooltip>
              <PopoverContent
                side="right"
                sideOffset={14}
                align="start"
                className="w-56 p-1.5 shadow-lg shadow-black/10 border-border/50"
              >
                <div className="text-2xs font-semibold text-muted-foreground/70 uppercase tracking-wider px-2.5 py-2 mb-0.5">
                  {section.label}
                </div>
                {section.items.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setOpenPopover(null)}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] transition-colors duration-150',
                      isItemActive(item.path)
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-foreground/80 hover:text-primary hover:bg-transparent',
                    )}
                  >
                    {item.icon && <item.icon className="size-4 shrink-0 opacity-60" />}
                    <span>{item.label}</span>
                  </Link>
                ))}
              </PopoverContent>
            </Popover>
          ))}
        </TooltipProvider>
      </div>

      {/* Bottom: User avatar + logout */}
      <div className="flex flex-col items-center gap-1.5 mt-auto pt-3">
        <div className="w-7 h-px bg-white/[0.06] mb-1" />
        {user && (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="size-9 rounded-full bg-gradient-to-br from-primary/30 to-primary/15 flex items-center justify-center cursor-default ring-1 ring-white/[0.08]">
                  <span className="text-white/90 text-sm font-semibold">{user.name?.charAt(0)}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                <div>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.branchName}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={logout}
                className="flex items-center justify-center size-9 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
              >
                <LogOut className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              ออกจากระบบ
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

/* ─── Expanded Full Sidebar (264px) ─── */
function ExpandedSidebar({ onToggle }: { onToggle: () => void }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  const matchPath = useCallback(
    (path: string): boolean =>
      path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname],
  );

  const filteredSections = useMemo((): NavSection[] => {
    return navSections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => !item.roles || (user && item.roles.includes(user.role)),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [user]);

  return (
    <div className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[264px] flex flex-col bg-sidebar-dark transition-all duration-300">
      {/* Header — Metronic sidebar-header pattern */}
      <div className="flex items-center justify-between px-5 h-[70px] shrink-0 border-b border-white/[0.04]">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="size-9 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/25 ring-1 ring-white/[0.06]">
            <span className="text-white text-base font-bold">B</span>
          </div>
          <span className="text-[15px] font-bold text-white leading-tight tracking-tight">
            BEST<span className="text-primary">CHOICE</span>
          </span>
        </Link>
        <button
          onClick={onToggle}
          className="flex items-center justify-center size-7 rounded-full text-white/20 hover:text-white/60 hover:bg-white/[0.06] transition-all duration-200"
          aria-label="ย่อเมนู"
        >
          <ChevronsLeft className="size-4" />
        </button>
      </div>

      {/* Navigation — Metronic ScrollArea pattern */}
      <ScrollArea className="flex-1 py-5 px-4">
        <AccordionMenu
          selectedValue={pathname}
          matchPath={matchPath}
          type="multiple"
          classNames={expandedMenuClassNames}
        >
          <AccordionMenuItem value="/" className="text-sm font-medium">
            <Link to="/" className="flex items-center justify-between grow gap-2">
              <Home data-slot="accordion-menu-icon" />
              <span data-slot="accordion-menu-title">หน้าหลัก</span>
            </Link>
          </AccordionMenuItem>

          {filteredSections.map((section, i) => {
            const prevGroup = i > 0 ? filteredSections[i - 1].group : null;
            const showGroupHeader = section.group && section.group !== prevGroup;
            const groupLabels: Record<string, string> = { shop: 'หน้าร้าน', finance: 'ไฟแนนซ์', general: 'ทั่วไป' };
            const groupColors: Record<string, { text: string; dot: string; line: string }> = {
              shop: { text: 'text-sky-300/90', dot: 'bg-sky-400', line: 'bg-sky-400/20' },
              finance: { text: 'text-violet-300/90', dot: 'bg-violet-400', line: 'bg-violet-400/20' },
              general: { text: 'text-emerald-300/90', dot: 'bg-emerald-400', line: 'bg-emerald-400/20' },
            };
            const gc = groupColors[section.group!] || groupColors.general;

            return (
              <div key={section.key}>
                {showGroupHeader && (
                  <div className={`px-3 pb-2.5 ${i > 0 ? 'pt-6 mt-2' : 'pt-3'}`}>
                    <div className="flex items-center gap-2.5">
                      <div className={`size-2 rounded-full ${gc.dot} shadow-sm`} />
                      <span className={`text-[13px] font-bold uppercase tracking-wider ${gc.text}`}>
                        {groupLabels[section.group!] || section.group}
                      </span>
                      <div className={`flex-1 h-px ${gc.line}`} />
                    </div>
                  </div>
                )}
                <AccordionMenuSub value={section.key} data-testid={`nav-${section.key}`}>
                  <AccordionMenuSubTrigger>
                    <section.icon data-slot="accordion-menu-icon" className="size-4" />
                    <span data-slot="accordion-menu-title">{section.label}</span>
                  </AccordionMenuSubTrigger>
                  <AccordionMenuSubContent parentValue={section.key} type="single" collapsible>
                    {section.items.map((item) => (
                      <AccordionMenuItem key={item.path} value={item.path} className="text-2sm">
                        <Link to={item.path} className="flex items-center gap-2 w-full">
                          {item.icon && <item.icon data-slot="accordion-menu-icon" className="size-4" />}
                          <span data-slot="accordion-menu-title">{item.label}</span>
                        </Link>
                      </AccordionMenuItem>
                    ))}
                  </AccordionMenuSubContent>
                </AccordionMenuSub>
              </div>
            );
          })}
        </AccordionMenu>
      </ScrollArea>

      {/* User footer — Metronic compact user section */}
      {user && (
        <div className="px-4 py-3.5 border-t border-white/[0.04] shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-gradient-to-br from-primary/30 to-primary/15 flex items-center justify-center shrink-0 ring-1 ring-white/[0.08]">
              <span className="text-white/90 text-sm font-semibold">{user.name?.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-white truncate">{user.name}</p>
              <p className="text-2xs text-white/35 truncate">{user.branchName}</p>
            </div>
            <button onClick={logout} className="text-white/25 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded-lg transition-all duration-200">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Mobile Full Sidebar (Sheet) ─── */
function MobileSidebar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  const matchPath = useCallback(
    (path: string): boolean =>
      path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname],
  );

  const filteredSections = useMemo((): NavSection[] => {
    return navSections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => !item.roles || (user && item.roles.includes(user.role)),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [user]);

  return (
    <div className="w-full h-full flex flex-col bg-sidebar-dark">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 h-[70px] shrink-0 border-b border-white/[0.04]">
        <div className="size-9 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/25 ring-1 ring-white/[0.06]">
          <span className="text-white text-base font-bold">B</span>
        </div>
        <span className="text-[15px] font-bold text-white leading-tight tracking-tight">
          BEST<span className="text-primary">CHOICE</span>
        </span>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-5 px-4">
        <AccordionMenu
          selectedValue={pathname}
          matchPath={matchPath}
          type="multiple"
          classNames={expandedMenuClassNames}
        >
          <AccordionMenuItem value="/" className="text-sm font-medium">
            <Link to="/" className="flex items-center justify-between grow gap-2">
              <Home data-slot="accordion-menu-icon" />
              <span data-slot="accordion-menu-title">หน้าหลัก</span>
            </Link>
          </AccordionMenuItem>

          {filteredSections.map((section, i) => {
            const prevGroup = i > 0 ? filteredSections[i - 1].group : null;
            const showGroupHeader = section.group && section.group !== prevGroup;
            const groupLabels: Record<string, string> = { shop: 'หน้าร้าน', finance: 'ไฟแนนซ์', general: 'ทั่วไป' };
            const groupColors: Record<string, { text: string; dot: string; line: string }> = {
              shop: { text: 'text-sky-300/90', dot: 'bg-sky-400', line: 'bg-sky-400/20' },
              finance: { text: 'text-violet-300/90', dot: 'bg-violet-400', line: 'bg-violet-400/20' },
              general: { text: 'text-emerald-300/90', dot: 'bg-emerald-400', line: 'bg-emerald-400/20' },
            };
            const gc = groupColors[section.group!] || groupColors.general;

            return (
              <div key={section.key}>
                {showGroupHeader && (
                  <div className={`px-3 pb-2.5 ${i > 0 ? 'pt-6 mt-2' : 'pt-3'}`}>
                    <div className="flex items-center gap-2.5">
                      <div className={`size-2 rounded-full ${gc.dot} shadow-sm`} />
                      <span className={`text-[13px] font-bold uppercase tracking-wider ${gc.text}`}>
                        {groupLabels[section.group!] || section.group}
                      </span>
                      <div className={`flex-1 h-px ${gc.line}`} />
                    </div>
                  </div>
                )}
                <AccordionMenuSub value={section.key} data-testid={`nav-${section.key}`}>
                  <AccordionMenuSubTrigger>
                    <section.icon data-slot="accordion-menu-icon" className="size-4" />
                    <span data-slot="accordion-menu-title">{section.label}</span>
                  </AccordionMenuSubTrigger>
                  <AccordionMenuSubContent parentValue={section.key} type="single" collapsible>
                    {section.items.map((item) => (
                      <AccordionMenuItem key={item.path} value={item.path} className="text-2sm">
                        <Link to={item.path} className="flex items-center gap-2 w-full">
                          {item.icon && <item.icon data-slot="accordion-menu-icon" className="size-4" />}
                          <span data-slot="accordion-menu-title">{item.label}</span>
                        </Link>
                      </AccordionMenuItem>
                    ))}
                  </AccordionMenuSubContent>
                </AccordionMenuSub>
              </div>
            );
          })}
        </AccordionMenu>
      </ScrollArea>

      {/* User footer */}
      {user && (
        <div className="px-4 py-3.5 border-t border-white/[0.04] shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-gradient-to-br from-primary/30 to-primary/15 flex items-center justify-center shrink-0 ring-1 ring-white/[0.08]">
              <span className="text-white/90 text-sm font-semibold">{user.name?.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-white truncate">{user.name}</p>
              <p className="text-2xs text-white/35 truncate">{user.branchName}</p>
            </div>
            <button onClick={logout} className="text-white/25 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded-lg transition-all duration-200">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Sidebar Component ─── */
function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const { sidebarCollapse, setSidebarCollapse } = useLayout();

  if (mobile) {
    return <MobileSidebar />;
  }

  const handleToggle = () => setSidebarCollapse(!sidebarCollapse);

  if (sidebarCollapse) {
    return <CollapsedSidebar onToggle={handleToggle} />;
  }

  return <ExpandedSidebar onToggle={handleToggle} />;
}

export default memo(Sidebar);
