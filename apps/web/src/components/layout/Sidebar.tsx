import { useMemo, useCallback, memo } from 'react';
import { Link, useLocation } from 'react-router-dom';
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

/* Metronic Demo 9 — light sidebar menu classNames */
const menuClassNames: AccordionMenuClassNames = {
  root: 'space-y-1',
  group: 'gap-px',
  label: 'uppercase text-2xs font-semibold tracking-wider text-muted-foreground/70 pt-4 pb-1 px-3',
  separator: '',
  item: 'h-9 rounded-lg text-sm text-foreground/80 hover:bg-muted hover:text-foreground data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary data-[selected=true]:font-medium',
  sub: '',
  subTrigger: 'h-9 rounded-lg text-sm text-foreground/80 hover:bg-muted hover:text-foreground data-[selected=true]:text-primary data-[selected=true]:font-medium',
  subContent: 'py-0',
};

function Sidebar({ mobile = false }: { mobile?: boolean }) {
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
        'sidebar flex flex-col items-stretch shrink-0 bg-card',
        mobile
          ? 'w-full h-full'
          : 'fixed top-0 bottom-0 z-20 border-e border-border transition-all duration-300',
        !mobile && (sidebarCollapse ? 'w-[80px]' : 'w-[280px]'),
      )}
    >
      {/* Sidebar Header — Demo 9 light style */}
      <div className={cn(
        'sidebar-header items-center relative justify-between px-3 lg:px-6 shrink-0 h-[70px] border-b border-border',
        mobile ? 'flex' : 'hidden lg:flex',
      )}>
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <span className="text-white text-base font-bold">B</span>
          </div>
          {!sidebarCollapse && (
            <span className="text-base font-bold text-foreground leading-tight tracking-tight">
              BEST<span className="text-primary">CHOICE</span>
            </span>
          )}
        </Link>
      </div>

      {/* Navigation — Demo 9 light sidebar pattern */}
      <div className="overflow-hidden flex-1">
        <div className={sidebarCollapse ? 'w-[80px]' : 'w-[280px]'}>
          <ScrollArea className="py-4 px-4 lg:max-h-[calc(100vh-5.5rem)]">
            <AccordionMenu
              selectedValue={pathname}
              matchPath={matchPath}
              type="single"
              collapsible
              classNames={menuClassNames}
            >
              {/* Home - direct link */}
              <AccordionMenuItem value="/" className="text-sm font-medium">
                <Link to="/" className="flex items-center justify-between grow gap-2">
                  <Home data-slot="accordion-menu-icon" />
                  {!sidebarCollapse && <span data-slot="accordion-menu-title">หน้าหลัก</span>}
                </Link>
              </AccordionMenuItem>

              {filteredSections.map((section) => (
                <div key={section.key}>
                  <AccordionMenuLabel>{section.label}</AccordionMenuLabel>
                  <AccordionMenuGroup>
                    {section.items.map((item) => (
                      <AccordionMenuItem key={item.path} value={item.path} className="text-2sm">
                        <Link to={item.path} className="flex items-center gap-2 w-full">
                          {item.icon && <item.icon data-slot="accordion-menu-icon" className="size-4" />}
                          {!sidebarCollapse && <span data-slot="accordion-menu-title">{item.label}</span>}
                        </Link>
                      </AccordionMenuItem>
                    ))}
                  </AccordionMenuGroup>
                </div>
              ))}
            </AccordionMenu>
          </ScrollArea>
        </div>
      </div>

      {/* User info at bottom — Demo 9 light style */}
      {user && !sidebarCollapse && (
        <div className="px-4 py-4 border-t border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-primary text-sm font-semibold">{user.name?.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-2sm font-medium text-foreground truncate">{user.name}</p>
              <p className="text-2xs text-muted-foreground truncate">{user.branchName}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(Sidebar);
