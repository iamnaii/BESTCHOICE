import type { LucideIcon } from 'lucide-react';
import {
  ShoppingCart,
  Users,
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
  Wrench,
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
  UserSearch,
  ShoppingBag,
  ClipboardCheck,
  PiggyBank,
  Star,
  Tag,
  TrendingDown,
  BookOpen,
  History,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────── */

export type MenuBadgeKey = 'chat-unread' | 'asset-draft-count';

export interface MenuItem {
  label: string;
  path: string;
  icon: LucideIcon;
  children?: MenuItem[];   // when present, item renders as collapsible group (path is not navigable)
  badgeKey?: MenuBadgeKey; // optional dynamic count badge
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
  badgeKey?: MenuBadgeKey;  // promoted from inline 'chat-unread' literal
  action?: 'sidebar';
}

export interface RoleMenuConfig {
  sidebar: MenuSection[];
  bottomNav: BottomNavItem[];
}

/* ── Shared menu items ─────────────────────────────── */

// Asset section — promoted to its own top-level section per owner directive
// ("เอาสินทรัพย์ แยกออกจากบัญชีเลยดีกว่า"). Previously nested as a
// collapsible item inside "บัญชี & รายงาน" via the now-removed assetMenuItem.
// Shared across OWNER / FINANCE_MANAGER / ACCOUNTANT — visible to roles that
// own asset workflows. The `asset-draft-count` badge moves from the parent
// to the "บันทึกซื้อ" item where drafts are actually listed.
const assetMenuSection: MenuSection = {
  key: 'asset',
  label: 'สินทรัพย์',
  icon: Landmark,
  items: [
    { label: 'บันทึกซื้อ',                          path: '/assets',                icon: FileText, badgeKey: 'asset-draft-count' },
    { label: 'ทะเบียน + มูลค่าตามบัญชีสุทธิ (NBV)', path: '/assets/register',       icon: BookOpen },
    { label: 'สมุดรายวัน',                          path: '/assets/journal',        icon: FileText },
    { label: 'สรุปแยกหมวด',                         path: '/assets/summary-report', icon: BarChart3 },
    { label: 'ค่าเสื่อม',                           path: '/depreciation',          icon: TrendingDown },
    { label: 'ประวัติสินทรัพย์',                    path: '/assets/audit',          icon: History },
  ],
};

/* ── SALES — พนักงานขาย (10 เมนู) ──────────────────── */

const SALES_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'sales-work',
      label: 'ขาย',
      icon: ShoppingCart,
      items: [
        { label: 'ขายของ (POS)', path: '/pos', icon: ShoppingCart },
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'เช็คเครดิตลูกค้าใหม่', path: '/customer-intake', icon: UserSearch },
        { label: 'รับซื้อมือสอง', path: '/trade-in', icon: Smartphone },
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
        { label: 'ภาพรวมคลัง', path: '/stock', icon: Warehouse },
        { label: 'รายการสินค้า', path: '/stock/products', icon: ClipboardList },
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: 'CRM Pipeline', path: '/crm', icon: Kanban },
        { label: 'รวมแชท', path: '/chat', icon: MessageSquareMore },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
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

/* ── BRANCH_MANAGER — ผจก.สาขา (12 เมนู) ──────────── */

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
      label: 'ขาย',
      icon: ShoppingCart,
      items: [
        { label: 'ขายของ (POS)', path: '/pos', icon: ShoppingCart },
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'เช็คเครดิตลูกค้าใหม่', path: '/customer-intake', icon: UserSearch },
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'จัดการอุปกรณ์', path: '/mdm', icon: Smartphone },
      ],
    },
    {
      key: 'bm-inventory',
      label: 'คลัง & จัดซื้อ',
      icon: Warehouse,
      items: [
        { label: 'ภาพรวมคลัง', path: '/stock', icon: Warehouse },
        { label: 'รายการสินค้า', path: '/stock/products', icon: ClipboardList },
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
        { label: 'สั่งซื้อ (PO)', path: '/purchase-orders', icon: ClipboardList },
        { label: 'ผู้ขาย', path: '/suppliers', icon: Building2 },
      ],
    },
    {
      key: 'bm-followup',
      label: 'ติดตาม',
      icon: AlertTriangle,
      items: [
        { label: 'ค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'CRM Pipeline', path: '/crm', icon: Kanban },
        { label: 'รวมแชท', path: '/chat', icon: MessageSquareMore },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
      ],
    },
    {
      key: 'bm-online-shop',
      label: 'ร้านค้าออนไลน์',
      icon: ShoppingBag,
      items: [
        { label: 'คำสั่งซื้อออนไลน์', path: '/online-orders', icon: ShoppingBag },
        { label: 'คำขอผ่อนชำระ', path: '/installment-applications', icon: ClipboardCheck },
        { label: 'แผนออม', path: '/saving-plans', icon: PiggyBank },
        { label: 'รีวิวลูกค้า', path: '/reviews', icon: Star },
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

/* ── FINANCE_MANAGER — ผจก.การเงิน (12 เมนู) ─────── */

const FINANCE_MANAGER_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'fm-overview',
      label: 'ภาพรวม',
      icon: Home,
      items: [
        { label: 'Dashboard', path: '/', icon: Home },
        { label: 'Finance Overview', path: '/finance-portfolio', icon: CircleDollarSign },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
      ],
    },
    {
      key: 'fm-payments',
      label: 'สัญญา & ชำระ',
      icon: FileCheck,
      items: [
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'จัดการอุปกรณ์', path: '/mdm', icon: Smartphone },
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
      ],
    },
    {
      key: 'fm-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      items: [
        { label: 'ติดตามหนี้', path: '/overdue', icon: AlertTriangle },
        { label: 'เปลี่ยนเครื่องเสีย (7 วัน)', path: '/defect-exchange', icon: Wrench },
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
        { label: 'รวมแชท', path: '/chat', icon: MessageSquareMore },
      ],
    },
    {
      key: 'fm-finance',
      label: 'บัญชี & รายงาน',
      icon: Coins,
      items: [
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: 'รายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        { label: 'กำไร-ขาดทุน', path: '/profit-loss', icon: PieChart },
        // SP3 — Tax module split
        { label: 'ภ.พ.30 (VAT)', path: '/finance/vat', icon: Calculator },
        { label: 'ภ.ง.ด. 1/3/53 (WHT)', path: '/finance/wht', icon: Calculator },
        { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
        { label: 'งวดบัญชี', path: '/accounting/periods', icon: CalendarDays },
      ],
    },
    assetMenuSection,
    {
      key: 'fm-online-shop',
      label: 'ร้านค้าออนไลน์',
      icon: ShoppingBag,
      items: [
        { label: 'คำสั่งซื้อออนไลน์', path: '/online-orders', icon: ShoppingBag },
        { label: 'คำขอผ่อนชำระ', path: '/installment-applications', icon: ClipboardCheck },
        { label: 'แผนออม', path: '/saving-plans', icon: PiggyBank },
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

/* ── ACCOUNTANT — ฝ่ายบัญชี (11 เมนู) ─────────────── */

const ACCOUNTANT_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'acc-daily',
      label: 'งานประจำวัน',
      icon: HandCoins,
      items: [
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'บันทึกรายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
      ],
    },
    {
      key: 'acc-reports',
      label: 'บัญชี & รายงาน',
      icon: BarChart3,
      items: [
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        { label: 'กำไร-ขาดทุน', path: '/profit-loss', icon: PieChart },
        // SP3 — Tax module split
        { label: 'ภ.พ.30 (VAT)', path: '/finance/vat', icon: Calculator },
        { label: 'ภ.ง.ด. 1/3/53 (WHT)', path: '/finance/wht', icon: Calculator },
        { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
      ],
    },
    assetMenuSection,
    {
      key: 'acc-close',
      label: 'ปิดบัญชี',
      icon: CalendarDays,
      items: [
        { label: 'ปิดบัญชีรายเดือน', path: '/monthly-close', icon: CalendarDays },
        { label: 'งวดบัญชี', path: '/accounting/periods', icon: CalendarDays },
        { label: 'ชำระเงินระหว่างบริษัท', path: '/accounting/intercompany', icon: ClipboardList },
        { label: 'ผังบัญชี', path: '/settings/chart-of-accounts', icon: ClipboardList },
        { label: 'ตรวจสอบบัญชี', path: '/financial-audit', icon: ClipboardList },
        { label: 'PEAK Sync', path: '/settings/peak-sync', icon: Plug },
      ],
    },
  ],
  bottomNav: [
    { label: 'ชำระ', path: '/payments', icon: HandCoins },
    { label: 'ใบเสร็จ', path: '/payments?tab=receipts', icon: FileText },
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
        { label: 'Finance Overview', path: '/finance-portfolio', icon: CircleDollarSign },
      ],
    },
    {
      key: 'owner-inventory',
      label: 'คลัง & จัดซื้อ',
      icon: Warehouse,
      items: [
        { label: 'ผู้ขาย', path: '/suppliers', icon: Building2 },
        { label: 'สั่งซื้อ (PO)', path: '/purchase-orders', icon: ClipboardList },
        { label: 'รับซื้อมือสอง', path: '/trade-in', icon: Smartphone },
        { label: 'ภาพรวมคลัง', path: '/stock', icon: Warehouse },
        { label: 'รายการสินค้า', path: '/stock/products', icon: ClipboardList },
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
      ],
    },
    {
      key: 'owner-sales',
      label: 'ขาย',
      icon: ShoppingCart,
      items: [
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'ขายของ (POS)', path: '/pos', icon: ShoppingCart },
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
      ],
    },
    {
      key: 'owner-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      items: [
        { label: 'ติดตามหนี้', path: '/overdue', icon: AlertTriangle },
        { label: 'เปลี่ยนเครื่องเสีย (7 วัน)', path: '/defect-exchange', icon: Wrench },
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
        { label: 'จัดการอุปกรณ์', path: '/mdm', icon: Smartphone },
      ],
    },
    {
      key: 'owner-accounting',
      label: 'บัญชี & รายงาน',
      icon: Calculator,
      items: [
        // Daily-use direct items (one-click access)
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'รายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        { label: 'ผังบัญชี', path: '/settings/chart-of-accounts', icon: ClipboardList },
        // Reports & period-close grouped under collapsible parents
        {
          label: 'รายงาน',
          path: '/reports',
          icon: BarChart3,
          children: [
            { label: 'รายงานรวม', path: '/reports', icon: BarChart3 },
            { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
            // SP3 — Tax module split
            { label: 'ภ.พ.30 (VAT)', path: '/finance/vat', icon: Calculator },
            { label: 'ภ.ง.ด. 1/3/53 (WHT)', path: '/finance/wht', icon: Calculator },
            { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
            { label: 'ตรวจสอบบัญชี', path: '/financial-audit', icon: ClipboardList },
          ],
        },
        {
          label: 'ปิดบัญชี',
          path: '/monthly-close',
          icon: CalendarDays,
          children: [
            { label: 'ปิดบัญชีรายเดือน', path: '/monthly-close', icon: CalendarDays },
            { label: 'งวดบัญชี', path: '/accounting/periods', icon: CalendarDays },
            { label: 'ชำระเงินระหว่างบริษัท', path: '/accounting/intercompany', icon: ClipboardList },
          ],
        },
      ],
    },
    assetMenuSection,
    {
      key: 'owner-online-shop',
      label: 'ร้านค้าออนไลน์',
      icon: ShoppingBag,
      items: [
        { label: 'คำสั่งซื้อออนไลน์', path: '/online-orders', icon: ShoppingBag },
        { label: 'คำขอผ่อนชำระ', path: '/installment-applications', icon: ClipboardCheck },
        { label: 'แผนออม', path: '/saving-plans', icon: PiggyBank },
        { label: 'รีวิวลูกค้า', path: '/reviews', icon: Star },
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
        { label: 'บัญชีตาม Role', path: '/settings/account-roles', icon: ClipboardList },
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
        // /chat removed — already in bottomNav as 'แชท'.
        {
          label: 'AI',
          path: '/settings/ai-admin',
          icon: Sparkles,
          children: [
            { label: 'AI Admin', path: '/settings/ai-admin', icon: Sparkles },
            { label: 'AI Assistant', path: '/settings/ai-chat', icon: Sparkles },
          ],
        },
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
