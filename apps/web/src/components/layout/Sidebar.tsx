import { useMemo, useCallback, memo } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  ShoppingCart,
  Clock,
  Package,
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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  AccordionMenu,
  AccordionMenuClassNames,
  AccordionMenuGroup,
  AccordionMenuItem,
  AccordionMenuLabel,
  AccordionMenuSub,
  AccordionMenuSubContent,
  AccordionMenuSubTrigger,
} from '@/components/ui/accordion-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
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

const navSections: { key: string; label: string; icon: LucideIcon; items: NavItem[] }[] = [
  {
    key: 'sales',
    label: 'ขาย & ผ่อนชำระ',
    icon: ShoppingCart,
    items: [
      { label: 'POS ขายสินค้า', path: '/pos', icon: ShoppingCart },
      { label: 'ประวัติการขาย', path: '/sales', icon: Receipt },
      { label: 'ลูกค้า', path: '/customers', icon: Users },
      { label: 'ตรวจเครดิต', path: '/credit-checks', icon: CreditCard },
      { label: 'สัญญาผ่อน', path: '/contracts', icon: FileCheck },
      { label: 'ชำระเงิน', path: '/payments', icon: DollarSign },
      { label: 'สถานะเอกสาร', path: '/document-dashboard', icon: FileText, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'ใบเสร็จรับเงิน', path: '/receipts', icon: Receipt, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
      { label: 'ตรวจสอบสลิป', path: '/slip-review', icon: FileCheck, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
    ],
  },
  {
    key: 'debt',
    label: 'ติดตาม & จัดการหนี้',
    icon: Clock,
    items: [
      { label: 'ติดตามหนี้', path: '/overdue', icon: AlertTriangle },
      { label: 'เปลี่ยนเครื่อง', path: '/exchange', icon: RefreshCw, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'ยึดคืน & ขายต่อ', path: '/repossessions', icon: Undo2, roles: ['OWNER', 'BRANCH_MANAGER'] },
    ],
  },
  {
    key: 'purchasing',
    label: 'จัดซื้อ',
    icon: Package,
    items: [
      { label: 'สั่งซื้อ', path: '/purchase-orders', icon: ClipboardList, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'แจ้งเตือนสต็อก', path: '/stock/alerts', icon: Bell, roles: ['OWNER', 'BRANCH_MANAGER'] },
    ],
  },
  {
    key: 'warehouse',
    label: 'คลังสินค้า',
    icon: Warehouse,
    items: [
      { label: 'คลังสินค้า', path: '/stock', icon: Warehouse, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES'] },
      { label: 'โอนสาขา', path: '/stock/transfers', icon: ArrowRightLeft, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'ปรับสต็อก', path: '/stock/adjustments', icon: Sliders, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'ตรวจนับสต๊อก', path: '/stock/count', icon: ClipboardCheck, roles: ['OWNER', 'BRANCH_MANAGER'] },
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
    key: 'system',
    label: 'ระบบ',
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
      { label: 'สถานะระบบ', path: '/system-status', icon: Activity, roles: ['OWNER'] },
      { label: 'PDPA', path: '/pdpa', icon: Shield, roles: ['OWNER', 'BRANCH_MANAGER'] },
      { label: 'Audit Logs', path: '/audit-logs', icon: ScrollText, roles: ['OWNER'] },
      { label: 'นำเข้าข้อมูล', path: '/migration', icon: Database, roles: ['OWNER'] },
    ],
  },
];

const menuClassNames: AccordionMenuClassNames = {
  root: 'space-y-1',
  group: 'gap-px',
  label: 'uppercase text-xs font-medium text-primary-400/70 pt-2 pb-0.5',
  item: 'h-9 text-slate-400 hover:bg-white/5 hover:text-white data-[selected=true]:bg-primary-600 data-[selected=true]:text-white data-[selected=true]:font-medium',
  subTrigger: 'h-9 text-slate-400 hover:bg-white/5 hover:text-white',
  subContent: 'py-0',
};

function Sidebar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { sidebarCollapse } = useLayout();

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
    <div
      className={cn(
        'sidebar fixed top-0 bottom-0 z-20 flex flex-col items-stretch shrink-0 bg-primary-950 transition-all duration-300',
        sidebarCollapse ? 'w-[70px]' : 'w-64',
      )}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10 shrink-0">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo-icon.svg" alt="BestChoice" className="w-10 h-10 rounded-xl shrink-0" />
          {!sidebarCollapse && (
            <div>
              <h1 className="text-lg font-semibold text-white leading-tight tracking-wide">
                BEST<span className="text-primary-400">CHOICE</span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">ระบบจัดการร้าน</p>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4 px-3">
        {/* Home */}
        <div className="mb-2">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white',
              )
            }
          >
            <Home className="w-4 h-4 shrink-0" />
            {!sidebarCollapse && <span>หน้าหลัก</span>}
          </NavLink>
        </div>

        {/* Sections with AccordionMenu */}
        <AccordionMenu
          selectedValue={pathname}
          matchPath={matchPath}
          type="single"
          collapsible
          classNames={menuClassNames}
        >
          {filteredSections.map((section) => {
            const SectionIcon = section.icon;

            // Single-item section: render as direct link
            if (section.items.length === 1) {
              const item = section.items[0];
              return (
                <AccordionMenuItem key={section.key} value={item.path}>
                  <Link to={item.path} className="flex items-center gap-2.5 w-full">
                    <SectionIcon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapse && <span>{section.label}</span>}
                  </Link>
                </AccordionMenuItem>
              );
            }

            // Multi-item section: collapsible
            return (
              <div key={section.key}>
                <AccordionMenuLabel className="text-slate-600 mt-3">
                  {!sidebarCollapse && (
                    <div className="flex items-center gap-2">
                      <SectionIcon className="w-3.5 h-3.5 shrink-0 opacity-60" />
                      <span>{section.label}</span>
                    </div>
                  )}
                  {sidebarCollapse && (
                    <div className="flex justify-center">
                      <SectionIcon className="w-3.5 h-3.5 shrink-0 opacity-60" />
                    </div>
                  )}
                </AccordionMenuLabel>
                <AccordionMenuGroup>
                  {section.items.map((item) => (
                    <AccordionMenuItem key={item.path} value={item.path}>
                      <Link to={item.path} className="flex items-center gap-2.5 w-full">
                        {item.icon && <item.icon className="w-4 h-4 shrink-0 opacity-60" />}
                        {!sidebarCollapse && <span>{item.label}</span>}
                      </Link>
                    </AccordionMenuItem>
                  ))}
                </AccordionMenuGroup>
              </div>
            );
          })}
        </AccordionMenu>
      </ScrollArea>

      {/* User info at bottom */}
      {user && !sidebarCollapse && (
        <div className="px-4 py-5 border-t border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary-700 flex items-center justify-center shrink-0">
              <span className="text-white text-sm font-semibold">{user.name?.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.name}</p>
              <p className="text-xs text-slate-500 truncate">{user.branchName}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(Sidebar);
