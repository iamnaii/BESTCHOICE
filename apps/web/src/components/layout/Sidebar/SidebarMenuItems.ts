import {
  ShoppingCart,
  Warehouse,
  BarChart3,
  Settings,
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
  DollarSign,
  FileSignature,
  Activity,
  Shield,
  ScrollText,
  Database,
  ArrowRightLeft,
  ClipboardCheck,
  Upload,
  GitBranchPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AccordionMenuClassNames } from '@/components/ui/accordion-menu';

export interface NavItem {
  label: string;
  path: string;
  icon?: LucideIcon;
  roles?: string[];
}

export interface NavSection {
  key: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export const navSections: NavSection[] = [
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
      { label: 'นำเข้าชำระเงิน (CSV)', path: '/payments/import-csv', icon: Upload, roles: ['OWNER', 'ACCOUNTANT'] },
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
      { label: 'ขั้นตอนสต็อก', path: '/stock/workflow', icon: GitBranchPlus, roles: ['OWNER', 'BRANCH_MANAGER', 'SALES'] },
      { label: 'ตรวจสอบสินค้า', path: '/inspections', icon: ClipboardCheck, roles: ['OWNER', 'BRANCH_MANAGER', 'SALES'] },
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
      { label: 'Financial Audit', path: '/financial-audit', icon: FileText, roles: ['OWNER', 'ACCOUNTANT'] },
      { label: 'สถานะระบบ', path: '/system-status', icon: Activity, roles: ['OWNER'] },
      { label: 'นำเข้าข้อมูล', path: '/migration', icon: Database, roles: ['OWNER'] },
    ],
  },
];

/* Expanded sidebar menu classNames (dark bg, white text) */
export const expandedMenuClassNames: AccordionMenuClassNames = {
  root: 'space-y-1',
  item: 'h-9 rounded-lg text-2sm text-white/70 hover:bg-white/10 hover:text-white data-[selected=true]:bg-primary data-[selected=true]:text-white data-[selected=true]:font-medium',
  sub: '',
  subTrigger: 'h-10 rounded-lg text-2sm font-medium text-white/50 hover:bg-white/10 hover:text-white data-[state=open]:text-white',
  subContent: 'py-0 pl-3',
};
