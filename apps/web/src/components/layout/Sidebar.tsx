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
  Sliders,
  Percent,
  DollarSign,
  FileSignature,
  Activity,
  Shield,
  ScrollText,
  Database,
  ArrowRightLeft,
  ClipboardCheck,
  LogOut,
  ChevronsRight,
  ChevronsLeft,
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
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    key: 'sales',
    label: 'ขายสินค้า',
    icon: ShoppingCart,
    items: [
      { label: 'POS ขายสินค้า', path: '/pos', icon: ShoppingCart },
      { label: 'ประวัติการขาย', path: '/sales', icon: Receipt },
      { label: 'ลูกค้า', path: '/customers', icon: Users },
      { label: 'ตรวจเครดิต', path: '/credit-checks', icon: CreditCard },
    ],
  },
  {
    key: 'contracts',
    label: 'สัญญา & ชำระเงิน',
    icon: FileCheck,
    items: [
      { label: 'สัญญาผ่อน', path: '/contracts', icon: FileCheck },
      { label: 'ชำระเงิน', path: '/payments', icon: DollarSign },
      { label: 'ใบเสร็จรับเงิน', path: '/receipts', icon: Receipt, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
      { label: 'ตรวจสอบสลิป', path: '/slip-review', icon: FileCheck, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
      { label: 'สถานะเอกสาร', path: '/document-dashboard', icon: FileText, roles: ['OWNER', 'BRANCH_MANAGER'] },
    ],
  },
  {
    key: 'debt',
    label: 'ติดตามหนี้',
    icon: AlertTriangle,
    items: [
      { label: 'ติดตามหนี้', path: '/overdue', icon: AlertTriangle },
      { label: 'เปลี่ยนเครื่อง', path: '/exchange', icon: RefreshCw, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'ยึดคืน & ขายต่อ', path: '/repossessions', icon: Undo2, roles: ['OWNER', 'BRANCH_MANAGER'] },
    ],
  },
  {
    key: 'inventory',
    label: 'คลังสินค้า & จัดซื้อ',
    icon: Warehouse,
    items: [
      { label: 'คลังสินค้า', path: '/stock', icon: Warehouse, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES'] },
      { label: 'สั่งซื้อ', path: '/purchase-orders', icon: ClipboardList, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'โอนสาขา', path: '/stock/transfers', icon: ArrowRightLeft, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'ปรับสต็อก', path: '/stock/adjustments', icon: Sliders, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'ตรวจนับสต็อก', path: '/stock/count', icon: ClipboardCheck, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'แจ้งเตือนสต็อก', path: '/stock/alerts', icon: Bell, roles: ['OWNER', 'BRANCH_MANAGER'] },
    ],
  },
  {
    key: 'reports',
    label: 'รายงาน & แจ้งเตือน',
    icon: BarChart3,
    items: [
      { label: 'รายงาน', path: '/reports', icon: BarChart3, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
      { label: 'แจ้งเตือน', path: '/notifications', icon: Bell, roles: ['OWNER', 'BRANCH_MANAGER'] },
    ],
  },
  {
    key: 'settings',
    label: 'ตั้งค่า & ผู้ใช้',
    icon: Settings,
    items: [
      { label: 'ผู้ขาย', path: '/suppliers', icon: Building2, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'สาขา', path: '/branches', icon: Building2, roles: ['OWNER'] },
      { label: 'จัดการผู้ใช้', path: '/users', icon: UserCog, roles: ['OWNER'] },
      { label: 'ตั้งค่าระบบ', path: '/settings', icon: Settings, roles: ['OWNER'] },
      { label: 'เชื่อมต่อ LINE OA', path: '/settings/line-oa', icon: Settings, roles: ['OWNER'] },
      { label: 'ตั้งค่าดอกเบี้ย', path: '/settings/interest-config', icon: Percent, roles: ['OWNER'] },
      { label: 'ราคาตั้งต้น', path: '/settings/pricing-templates', icon: DollarSign, roles: ['OWNER'] },
      { label: 'เทมเพลตสัญญา', path: '/contract-templates', icon: FileSignature, roles: ['OWNER'] },
    ],
  },
  {
    key: 'admin',
    label: 'ผู้ดูแลระบบ',
    icon: Shield,
    items: [
      { label: 'PDPA', path: '/pdpa', icon: Shield, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'Audit Logs', path: '/audit-logs', icon: ScrollText, roles: ['OWNER'] },
      { label: 'สถานะระบบ', path: '/system-status', icon: Activity, roles: ['OWNER'] },
      { label: 'นำเข้าข้อมูล', path: '/migration', icon: Database, roles: ['OWNER'] },
    ],
  },
];

/* Expanded sidebar menu classNames (dark bg, white text) */
const expandedMenuClassNames: AccordionMenuClassNames = {
  root: 'space-y-1',
  item: 'h-9 rounded-lg text-2sm text-white/70 hover:bg-white/10 hover:text-white data-[selected=true]:bg-primary data-[selected=true]:text-white data-[selected=true]:font-medium',
  sub: '',
  subTrigger: 'h-10 rounded-lg text-2sm font-medium text-white/50 hover:bg-white/10 hover:text-white data-[state=open]:text-white',
  subContent: 'py-0 pl-3',
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
        (item) => item.path === pathname || (item.path.length > 1 && pathname.startsWith(item.path)),
      );
    },
    [pathname],
  );

  const isItemActive = useCallback(
    (path: string): boolean =>
      path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname],
  );

  return (
    <div className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[70px] flex flex-col items-center bg-sidebar-dark py-5 gap-1 transition-all duration-300">
      {/* Logo */}
      <Link to="/" className="flex items-center justify-center mb-2 shrink-0">
        <div className="size-10 rounded-xl bg-primary flex items-center justify-center">
          <span className="text-white text-lg font-bold">B</span>
        </div>
      </Link>

      {/* Expand toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center size-8 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors mb-2"
        aria-label="ขยายเมนู"
      >
        <ChevronsRight className="size-4" />
      </button>

      {/* Home icon */}
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/"
              className={cn(
                'flex items-center justify-center size-10 rounded-xl transition-colors',
                pathname === '/'
                  ? 'bg-primary text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/10',
              )}
            >
              <Home className="size-5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            หน้าหลัก
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Section icons with popovers */}
      <div className="flex-1 flex flex-col items-center gap-1 py-2 overflow-y-auto">
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
                        'flex items-center justify-center size-10 rounded-xl transition-colors',
                        isSectionActive(section)
                          ? 'bg-primary text-white'
                          : 'text-white/50 hover:text-white hover:bg-white/10',
                      )}
                    >
                      <section.icon className="size-5" />
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                {openPopover !== section.key && (
                  <TooltipContent side="right" sideOffset={8}>
                    {section.label}
                  </TooltipContent>
                )}
              </Tooltip>
              <PopoverContent
                side="right"
                sideOffset={12}
                align="start"
                className="w-56 p-2"
              >
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5 mb-1">
                  {section.label}
                </div>
                {section.items.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setOpenPopover(null)}
                    className={cn(
                      'flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors',
                      isItemActive(item.path)
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-foreground/80 hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {item.icon && <item.icon className="size-4 shrink-0" />}
                    <span>{item.label}</span>
                  </Link>
                ))}
              </PopoverContent>
            </Popover>
          ))}
        </TooltipProvider>
      </div>

      {/* Bottom: User avatar + logout */}
      <div className="flex flex-col items-center gap-2 mt-auto pt-2">
        {user && (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="size-9 rounded-full bg-primary/30 flex items-center justify-center cursor-default">
                  <span className="text-white text-sm font-semibold">{user.name?.charAt(0)}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
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
                className="flex items-center justify-center size-10 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              >
                <LogOut className="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
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
      {/* Header */}
      <div className="flex items-center justify-between px-5 h-[70px] shrink-0 border-b border-white/10">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white text-base font-bold">B</span>
          </div>
          <span className="text-base font-bold text-white leading-tight tracking-tight">
            BEST<span className="text-primary">CHOICE</span>
          </span>
        </Link>
        <button
          onClick={onToggle}
          className="flex items-center justify-center size-8 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="ย่อเมนู"
        >
          <ChevronsLeft className="size-4" />
        </button>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-3 px-3">
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

          {filteredSections.map((section) => (
            <AccordionMenuSub key={section.key} value={section.key}>
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
          ))}
        </AccordionMenu>
      </ScrollArea>

      {/* User footer */}
      {user && (
        <div className="px-4 py-4 border-t border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-primary/30 flex items-center justify-center shrink-0">
              <span className="text-white text-sm font-semibold">{user.name?.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-2sm font-medium text-white truncate">{user.name}</p>
              <p className="text-2xs text-white/50 truncate">{user.branchName}</p>
            </div>
            <button onClick={logout} className="text-white/40 hover:text-white transition-colors">
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
      <div className="flex items-center gap-2.5 px-5 h-[70px] shrink-0 border-b border-white/10">
        <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-white text-base font-bold">B</span>
        </div>
        <span className="text-base font-bold text-white leading-tight tracking-tight">
          BEST<span className="text-primary">CHOICE</span>
        </span>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-3 px-3">
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

          {filteredSections.map((section) => (
            <AccordionMenuSub key={section.key} value={section.key}>
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
          ))}
        </AccordionMenu>
      </ScrollArea>

      {/* User footer */}
      {user && (
        <div className="px-4 py-4 border-t border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-primary/30 flex items-center justify-center shrink-0">
              <span className="text-white text-sm font-semibold">{user.name?.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-2sm font-medium text-white truncate">{user.name}</p>
              <p className="text-2xs text-white/50 truncate">{user.branchName}</p>
            </div>
            <button onClick={logout} className="text-white/40 hover:text-white transition-colors">
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
