import type { LucideIcon } from 'lucide-react';
import {
  ShoppingCart,
  Users,
  UserSearch,
  Smartphone,
  FileCheck,
  HandCoins,
  Warehouse,
  Coins,
  Kanban,
  Home,
  TrendingUp,
  Truck,
  ClipboardList,
  Building2,
  AlertTriangle,
  BarChart3,
  CircleDollarSign,
  Banknote,
  FileText,
  RefreshCw,
  Lock,
  Receipt,
  PieChart,
  Calculator,
  Landmark,
  CalendarDays,
  Plug,
  Target,
  Settings,
  UserCog,
  BadgePercent,
  Shield,
  ScrollText,
  Bell,
  MessageSquareMore,
  MoreHorizontal,
  Sparkles,
  Send,
  LayoutGrid,
  CheckSquare,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────── */

export interface MenuItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface MenuSection {
  key: string;
  label: string;
  icon: LucideIcon;
  items: MenuItem[];
}

export interface BottomNavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  badgeKey?: 'chat-unread';
  action?: 'sidebar';
}

export interface RoleMenuConfig {
  sidebar: MenuSection[];
  bottomNav: BottomNavItem[];
}

/* ── SALES — พนักงานขาย (9 เมนู) ──────────────────── */

const SALES_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'sales-work',
      label: 'งานขาย',
      icon: ShoppingCart,
      items: [
        { label: 'ขายของ (POS)', path: '/pos', icon: ShoppingCart },
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'ตรวจเครดิต', path: '/credit-checks', icon: UserSearch },
        { label: 'รับซื้อมือสอง', path: '/trade-in', icon: Smartphone },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
      ],
    },
    {
      key: 'sales-contracts',
      label: 'สัญญา & ชำระ',
      icon: FileCheck,
      items: [
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
      ],
    },
    {
      key: 'sales-tools',
      label: 'เครื่องมือ',
      icon: Warehouse,
      items: [
        { label: 'สต็อกสินค้า', path: '/stock', icon: Warehouse },
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: 'CRM Pipeline', path: '/crm', icon: Kanban },
      ],
    },
  ],
  bottomNav: [
    { label: 'POS', path: '/pos', icon: ShoppingCart },
    { label: 'ลูกค้า', path: '/customers', icon: Users },
    { label: 'สัญญา', path: '/contracts', icon: FileCheck },
    { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
    { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
  ],
};

/* ── BRANCH_MANAGER — ผจก.สาขา (13 เมนู) ──────────── */

const BRANCH_MANAGER_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'bm-overview',
      label: 'ภาพรวม',
      icon: Home,
      items: [
        { label: 'Dashboard', path: '/', icon: Home },
        { label: 'ยอดขาย', path: '/sales', icon: TrendingUp },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
      ],
    },
    {
      key: 'bm-sales',
      label: 'ขาย & สัญญา',
      icon: ShoppingCart,
      items: [
        { label: 'ขายของ (POS)', path: '/pos', icon: ShoppingCart },
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
      ],
    },
    {
      key: 'bm-inventory',
      label: 'คลัง & จัดซื้อ',
      icon: Warehouse,
      items: [
        { label: 'สต็อกสินค้า', path: '/stock', icon: Warehouse },
        { label: 'โอนสินค้า', path: '/stock/transfers', icon: Truck },
        { label: 'สั่งซื้อ (PO)', path: '/purchase-orders', icon: ClipboardList },
        { label: 'ผู้ขาย', path: '/suppliers', icon: Building2 },
      ],
    },
    {
      key: 'bm-followup',
      label: 'ติดตาม & CRM',
      icon: AlertTriangle,
      items: [
        { label: 'ค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'CRM Pipeline', path: '/crm', icon: Kanban },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
      ],
    },
  ],
  bottomNav: [
    { label: 'Dashboard', path: '/', icon: Home },
    { label: 'สต็อก', path: '/stock', icon: Warehouse },
    { label: 'สัญญา', path: '/contracts', icon: FileCheck },
    { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
    { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
  ],
};

/* ── FINANCE_MANAGER — ผจก.การเงิน (13 เมนู) ─────── */

const FINANCE_MANAGER_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'fm-overview',
      label: 'ภาพรวม',
      icon: Home,
      items: [
        { label: 'Dashboard', path: '/', icon: Home },
        { label: 'Finance Portfolio', path: '/finance-portfolio', icon: CircleDollarSign },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
      ],
    },
    {
      key: 'fm-payments',
      label: 'รับชำระ & สัญญา',
      icon: FileCheck,
      items: [
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'เงินรับจาก FINANCE', path: '/finance-receivable', icon: Banknote },
        { label: 'ใบเสร็จ', path: '/receipts', icon: FileText },
      ],
    },
    {
      key: 'fm-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      items: [
        { label: 'ลูกค้าค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'Collection Dashboard', path: '/collection-dashboard', icon: BarChart3 },
        { label: 'เปลี่ยนเครื่อง', path: '/exchange', icon: RefreshCw },
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
      ],
    },
    {
      key: 'fm-finance',
      label: 'การเงิน',
      icon: Coins,
      items: [
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: 'รายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'กำไร-ขาดทุน', path: '/profit-loss', icon: PieChart },
      ],
    },
  ],
  bottomNav: [
    { label: 'Dashboard', path: '/', icon: Home },
    { label: 'ค้างชำระ', path: '/overdue', icon: AlertTriangle },
    { label: 'ชำระ', path: '/payments', icon: HandCoins },
    { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
    { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
  ],
};

/* ── ACCOUNTANT — ฝ่ายบัญชี (12 เมนู) ─────────────── */

const ACCOUNTANT_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'acc-daily',
      label: 'งานประจำวัน',
      icon: HandCoins,
      items: [
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'ใบเสร็จ', path: '/receipts', icon: FileText },
        { label: 'เงินรับจาก FINANCE', path: '/finance-receivable', icon: Banknote },
        { label: 'บันทึกรายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
      ],
    },
    {
      key: 'acc-reports',
      label: 'รายงาน & ภาษี',
      icon: BarChart3,
      items: [
        { label: 'กำไร-ขาดทุน', path: '/profit-loss', icon: PieChart },
        { label: 'ภาษี', path: '/tax-reports', icon: Calculator },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
        { label: 'สินทรัพย์', path: '/assets', icon: Landmark },
      ],
    },
    {
      key: 'acc-close',
      label: 'ปิดบัญชี & ตรวจสอบ',
      icon: CalendarDays,
      items: [
        { label: 'ปิดบัญชีรายเดือน', path: '/monthly-close', icon: CalendarDays },
        { label: 'ผังบัญชี', path: '/settings/chart-of-accounts', icon: ClipboardList },
        { label: 'PEAK Sync', path: '/settings/peak-sync', icon: Plug },
        { label: 'ตรวจสอบบัญชี', path: '/financial-audit', icon: ClipboardList },
      ],
    },
  ],
  bottomNav: [
    { label: 'ชำระ', path: '/payments', icon: HandCoins },
    { label: 'ใบเสร็จ', path: '/receipts', icon: FileText },
    { label: 'รายจ่าย', path: '/expenses', icon: Receipt },
    { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
    { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
  ],
};

/* ── OWNER — เจ้าของ (ทุกเมนู) ─────────────────────── */

const OWNER_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'owner-overview',
      label: 'ภาพรวม',
      icon: Home,
      items: [
        { label: 'Dashboard', path: '/', icon: Home },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
        { label: 'CRM Pipeline', path: '/crm', icon: Kanban },
      ],
    },
    {
      key: 'owner-sales',
      label: 'ขาย',
      icon: ShoppingCart,
      items: [
        { label: 'ขายของ (POS)', path: '/pos', icon: ShoppingCart },
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'ตรวจเครดิต', path: '/credit-checks', icon: UserSearch },
        { label: 'รับซื้อมือสอง', path: '/trade-in', icon: Smartphone },
      ],
    },
    {
      key: 'owner-inventory',
      label: 'คลัง & จัดซื้อ',
      icon: Warehouse,
      items: [
        { label: 'สต็อกสินค้า', path: '/stock', icon: Warehouse },
        { label: 'สั่งซื้อ (PO)', path: '/purchase-orders', icon: ClipboardList },
        { label: 'ผู้ขาย', path: '/suppliers', icon: Building2 },
      ],
    },
    {
      key: 'owner-contracts',
      label: 'สัญญา & ชำระ',
      icon: FileCheck,
      items: [
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'Finance Overview', path: '/finance-portfolio', icon: CircleDollarSign },
        { label: 'ใบเสร็จ', path: '/receipts', icon: FileText },
      ],
    },
    {
      key: 'owner-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      items: [
        { label: 'ติดตามหนี้', path: '/overdue', icon: AlertTriangle },
        { label: 'เปลี่ยนเครื่อง', path: '/exchange', icon: RefreshCw },
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
      ],
    },
    {
      key: 'owner-accounting',
      label: 'บัญชี & รายงาน',
      icon: Calculator,
      items: [
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: 'รายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'ภาษี', path: '/tax-reports', icon: Calculator },
        { label: 'ปิดบัญชีรายเดือน', path: '/monthly-close', icon: CalendarDays },
      ],
    },
    {
      key: 'owner-marketing',
      label: 'การตลาด',
      icon: Target,
      items: [
        { label: 'Ads & ROI', path: '/ads', icon: Target },
        { label: 'Broadcast', path: '/broadcast', icon: Send },
      ],
    },
    {
      key: 'owner-settings',
      label: 'ตั้งค่า',
      icon: Settings,
      items: [
        { label: 'ตั้งค่าระบบ', path: '/settings', icon: Settings },
        { label: 'ผู้ใช้', path: '/users', icon: UserCog },
        { label: 'สาขา', path: '/branches', icon: Building2 },
        { label: 'บริษัท', path: '/settings/companies', icon: Building2 },
        { label: 'แบบสัญญา', path: '/contract-templates', icon: FileCheck },
        { label: 'ตั้งราคา', path: '/settings/pricing-templates', icon: CircleDollarSign },
        { label: 'โปรโมชัน', path: '/promotions', icon: BadgePercent },
        { label: 'PDPA', path: '/pdpa', icon: Shield },
      ],
    },
    {
      key: 'owner-tools',
      label: 'เครื่องมือ',
      icon: Plug,
      items: [
        { label: 'AI Assistant', path: '/settings/ai-chat', icon: Sparkles },
        { label: 'การเชื่อมต่อ', path: '/settings/integrations', icon: Plug },
        { label: 'LINE OA', path: '/settings/rich-menu', icon: MessageSquareMore },
        { label: 'Dunning', path: '/settings/dunning', icon: Bell },
        { label: 'Audit Log', path: '/audit-logs', icon: ScrollText },
      ],
    },
  ],
  bottomNav: [
    { label: 'Dashboard', path: '/', icon: Home },
    { label: 'รายงาน', path: '/reports', icon: BarChart3 },
    { label: 'Collection', path: '/overdue', icon: AlertTriangle },
    { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' as const },
    { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' as const },
  ],
};

/* ── Config map ────────────────────────────────────── */

const MENU_CONFIG: Record<string, RoleMenuConfig> = {
  SALES: SALES_CONFIG,
  BRANCH_MANAGER: BRANCH_MANAGER_CONFIG,
  FINANCE_MANAGER: FINANCE_MANAGER_CONFIG,
  ACCOUNTANT: ACCOUNTANT_CONFIG,
  OWNER: OWNER_CONFIG,
};

export function getMenuConfig(role: string): RoleMenuConfig {
  return MENU_CONFIG[role] ?? OWNER_CONFIG;
}

/* ── Chat visibility per role ──────────────────────── */

const CHAT_VISIBLE_ROLES = new Set(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']);

export function isChatVisibleForRole(role: string): boolean {
  return CHAT_VISIBLE_ROLES.has(role);
}
