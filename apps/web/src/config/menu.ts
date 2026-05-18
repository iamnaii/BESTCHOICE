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
  // SP5 — SHOP additions
  ReceiptText,
  Inbox,
  ShieldCheck,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────── */

export type MenuBadgeKey = 'chat-unread' | 'asset-draft-count';

/** Logical zone — sidebar splits navigation into these contexts */
export type Zone = 'shop' | 'fin' | 'settings';

/** Hint shown on placeholder pages so users see which SP will deliver it */
export interface PlaceholderInfo {
  trackingSP: 'SP2' | 'SP3' | 'SP4' | 'SP5' | 'SP6';
  trackingIssueUrl?: string;
  eta?: string;
}

export interface MenuItem {
  label: string;
  path: string;
  icon: LucideIcon;
  children?: MenuItem[];   // when present, item renders as collapsible group (path is not navigable)
  badgeKey?: MenuBadgeKey; // optional dynamic count badge
  placeholder?: PlaceholderInfo; // marks the destination as a placeholder owned by a future SP
}

export interface MenuSection {
  key: string;
  label: string;
  icon: LucideIcon;
  zone?: Zone; // optional during SP1 staged rollout; required at render once all configs are tagged (Task 6)
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

export interface RoleZoneConfig {
  /** Pills visible to this role (1 zone → no pill switcher) */
  zones: Zone[];
  /** Default zone if no URL/localStorage value */
  defaultZone: Zone;
  /** Show gear (Settings) icon? */
  showSettingsGear: boolean;
  /** All sections across all zones — filtered at render */
  sections: MenuSection[];
  /** BottomNav items per zone */
  bottomNav: Record<Zone, BottomNavItem[]>;
}

/* ── Shared menu items ─────────────────────────────── */

// Asset section — promoted to its own top-level section per owner directive
// ("เอาสินทรัพย์ แยกออกจากบัญชีเลยดีกว่า"). Previously nested as a
// collapsible item inside "บัญชี & รายงาน" via the now-removed assetMenuItem.
// Shared across OWNER / FINANCE_MANAGER / ACCOUNTANT — visible to roles that
// own asset workflows. The `asset-draft-count` badge moves from the parent
// to the "บันทึกซื้อ" item where drafts are actually listed.
// SP1 zone tag: 'fin' — assets are FINANCE-side per spec §3.2
const assetMenuSection: MenuSection = {
  key: 'asset',
  label: 'สินทรัพย์',
  icon: Landmark,
  zone: 'fin',
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
      zone: 'shop',
      items: [
        { label: 'ขายของ (POS)', path: '/pos', icon: ShoppingCart },
        { label: 'ใบเสนอราคา', path: '/quotes', icon: ReceiptText },
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'เช็คเครดิตลูกค้าใหม่', path: '/customer-intake', icon: UserSearch },
        { label: 'รับซื้อมือสอง', path: '/trade-in', icon: Smartphone },
      ],
    },
    {
      key: 'sales-contracts',
      label: 'สัญญา & ชำระ',
      icon: FileCheck,
      zone: 'shop',
      items: [
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'เอกสารร่าง', path: '/drafts', icon: Inbox },
        { label: 'รับประกัน/ส่งซ่อม', path: '/insurance', icon: ShieldCheck },
      ],
    },
    {
      key: 'sales-tools',
      label: 'เครื่องมือ',
      icon: Warehouse,
      zone: 'shop',
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
      zone: 'shop',
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
      zone: 'shop',
      items: [
        { label: 'ขายของ (POS)', path: '/pos', icon: ShoppingCart },
        { label: 'ใบเสนอราคา', path: '/quotes', icon: ReceiptText },
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'เช็คเครดิตลูกค้าใหม่', path: '/customer-intake', icon: UserSearch },
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'เอกสารร่าง', path: '/drafts', icon: Inbox },
        { label: 'จัดการอุปกรณ์', path: '/mdm', icon: Smartphone },
        { label: 'รับประกัน/ส่งซ่อม', path: '/insurance', icon: ShieldCheck },
      ],
    },
    {
      key: 'bm-inventory',
      label: 'คลัง & จัดซื้อ',
      icon: Warehouse,
      zone: 'shop',
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
      zone: 'shop',
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
      zone: 'shop',
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
      zone: 'fin',
      items: [
        { label: 'Dashboard', path: '/', icon: Home },
        { label: 'Finance Overview', path: '/finance-portfolio', icon: CircleDollarSign },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
      ],
    },
    {
      key: 'fm-fin-daily',
      label: 'งานประจำวัน (การเงิน)',
      icon: HandCoins,
      zone: 'fin',
      items: [
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
      ],
    },
    {
      key: 'fm-shop-ops',
      label: 'งานหน้าร้าน',
      icon: ShoppingCart,
      zone: 'shop',
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
      zone: 'fin',
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
      zone: 'fin',
      items: [
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: 'รายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        { label: 'เอกสารร่าง', path: '/drafts', icon: Inbox },
        { label: 'กำไร-ขาดทุน', path: '/profit-loss', icon: PieChart },
        // SP3 — Tax module split
        { label: 'ภ.พ.30 (VAT)', path: '/finance/vat', icon: Calculator },
        { label: 'ภ.ง.ด. 1/3/53 (WHT)', path: '/finance/wht', icon: Calculator },
        { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
        // SP6 — Bank/Cash account directory
        { label: 'บัญชีเงินสด/ธนาคาร', path: '/finance/bank-accounts', icon: Landmark },
        { label: 'งวดบัญชี', path: '/accounting/periods', icon: CalendarDays },
        // P3-SP3 — PEAK CSV export (deep-linked from /settings#peak-mapping which is OWNER-only)
        { label: 'ส่งออก PEAK CSV', path: '/finance/peak-export', icon: Plug },
      ],
    },
    assetMenuSection,
    {
      key: 'fm-online-shop',
      label: 'ร้านค้าออนไลน์',
      icon: ShoppingBag,
      zone: 'shop',
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
      zone: 'fin',
      items: [
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'บันทึกรายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'เอกสารร่าง', path: '/drafts', icon: Inbox },
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
      ],
    },
    {
      key: 'acc-reports',
      label: 'บัญชี & รายงาน',
      icon: BarChart3,
      zone: 'fin',
      items: [
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        { label: 'กำไร-ขาดทุน', path: '/profit-loss', icon: PieChart },
        // SP2 — Accounting reports
        { label: 'งบกระแสเงินสด', path: '/finance/cash-flow', icon: Banknote },
        { label: 'งบ Equity', path: '/finance/equity-statement', icon: Landmark },
        { label: 'สมุดแยกประเภท', path: '/finance/general-ledger', icon: BookOpen },
        // SP3 — Tax module split (replaces /tax-reports)
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
      zone: 'fin',
      items: [
        { label: 'ปิดบัญชีรายเดือน', path: '/monthly-close', icon: CalendarDays },
        { label: 'งวดบัญชี', path: '/accounting/periods', icon: CalendarDays },
        { label: 'ชำระเงินระหว่างบริษัท', path: '/accounting/intercompany', icon: ClipboardList },
        { label: 'ผังบัญชี', path: '/settings/chart-of-accounts', icon: ClipboardList },
        // SP6 — Bank/Cash account directory
        { label: 'บัญชีเงินสด/ธนาคาร', path: '/finance/bank-accounts', icon: Landmark },
        { label: 'ตรวจสอบบัญชี', path: '/financial-audit', icon: ClipboardList },
        { label: 'PEAK Sync', path: '/settings/peak-sync', icon: Plug },
        { label: 'ส่งออก PEAK CSV', path: '/finance/peak-export', icon: Plug },
      ],
    },
    {
      key: 'acc-tax',
      label: 'ภาษี',
      icon: Calculator,
      zone: 'fin',
      items: [
        { label: 'VAT (ภ.พ.30)', path: '/finance/vat', icon: Receipt, placeholder: { trackingSP: 'SP3', eta: 'ภายในไตรมาส 3/2026' } },
        { label: 'WHT (ภ.ง.ด. 1/3/53)', path: '/finance/wht', icon: Receipt, placeholder: { trackingSP: 'SP3', eta: 'ภายในไตรมาส 3/2026' } },
        { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText, placeholder: { trackingSP: 'SP3', eta: 'ภายในไตรมาส 3/2026' } },
      ],
    },
    {
      key: 'acc-statements',
      label: 'งบการเงิน',
      icon: PieChart,
      zone: 'fin',
      items: [
        { label: 'กำไร-ขาดทุน (P&L)', path: '/profit-loss', icon: PieChart },
        { label: 'งบกระแสเงินสด', path: '/finance/cash-flow', icon: TrendingUp, placeholder: { trackingSP: 'SP2', eta: 'ภายในไตรมาส 2/2026' } },
        { label: 'งบ Equity', path: '/finance/equity-statement', icon: BarChart3, placeholder: { trackingSP: 'SP2', eta: 'ภายในไตรมาส 2/2026' } },
        { label: 'สมุดแยกประเภท', path: '/finance/general-ledger', icon: BookOpen, placeholder: { trackingSP: 'SP2', eta: 'ภายในไตรมาส 2/2026' } },
      ],
    },
    {
      key: 'acc-bank',
      label: 'ผังบัญชี + ธนาคาร',
      icon: Landmark,
      zone: 'fin',
      items: [
        { label: 'บัญชีธนาคาร', path: '/finance/bank-accounts', icon: Landmark, placeholder: { trackingSP: 'SP6', eta: 'ภายในไตรมาส 4/2026' } },
      ],
    },
    {
      key: 'acc-doc-config',
      label: 'ตั้งค่าเอกสาร',
      icon: FileText,
      zone: 'fin', // ACC sees doc config in FIN zone (no gear access)
      items: [
        // P2-SP2 — ACC currently sees the link but the page itself enforces
        // OWNER-only via ProtectedRoute, so non-OWNER clicks land on a
        // "ไม่มีสิทธิ์เข้าถึง" view. Kept here for menu parity per the
        // existing menu shape; security is enforced page-side.
        { label: 'เลขที่/รูปแบบเอกสาร', path: '/settings/document-config', icon: FileText },
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
      zone: 'shop',
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
      zone: 'shop',
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
      zone: 'shop',
      items: [
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'ขายของ (POS)', path: '/pos', icon: ShoppingCart },
        { label: 'ใบเสนอราคา', path: '/quotes', icon: ReceiptText },
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
        { label: 'เอกสารร่าง', path: '/drafts', icon: Inbox },
        { label: 'รับประกัน/ส่งซ่อม', path: '/insurance', icon: ShieldCheck },
      ],
    },
    {
      key: 'owner-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      zone: 'shop',
      items: [
        { label: 'ติดตามหนี้', path: '/overdue', icon: AlertTriangle },
        { label: 'เปลี่ยนเครื่องเสีย (7 วัน)', path: '/defect-exchange', icon: Wrench },
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
        { label: 'จัดการอุปกรณ์', path: '/mdm', icon: Smartphone },
        {
          label: 'ลงทะเบียนประกัน',
          path: '/insurance',
          icon: Shield,
          placeholder: { trackingSP: 'SP5', eta: 'ภายในไตรมาส 3/2026' },
        },
      ],
    },
    {
      key: 'owner-accounting',
      label: 'บัญชี & รายงาน',
      icon: Calculator,
      zone: 'fin',
      items: [
        // Daily-use direct items (one-click access)
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'รายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        { label: 'ผังบัญชี', path: '/settings/chart-of-accounts', icon: ClipboardList },
        // SP6 — Bank/Cash account directory (mirrors CoA 11-1101..1203)
        { label: 'บัญชีเงินสด/ธนาคาร', path: '/finance/bank-accounts', icon: Landmark },
        // Reports & period-close grouped under collapsible parents
        {
          label: 'รายงาน',
          path: '/reports',
          icon: BarChart3,
          children: [
            { label: 'รายงานรวม', path: '/reports', icon: BarChart3 },
            { label: 'งบกระแสเงินสด', path: '/finance/cash-flow', icon: Banknote },
            { label: 'งบ Equity', path: '/finance/equity-statement', icon: Landmark },
            { label: 'สมุดแยกประเภท', path: '/finance/general-ledger', icon: BookOpen },
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
            // P3-SP3 — PEAK CSV export (mapping config lives in /settings#peak-mapping)
            { label: 'ส่งออก PEAK CSV', path: '/finance/peak-export', icon: Plug },
          ],
        },
      ],
    },
    {
      key: 'owner-tax',
      label: 'ภาษี',
      icon: Calculator,
      zone: 'fin',
      items: [
        {
          label: 'VAT (ภ.พ.30)',
          path: '/finance/vat',
          icon: Receipt,
          placeholder: { trackingSP: 'SP3', eta: 'ภายในไตรมาส 3/2026' },
        },
        {
          label: 'WHT (ภ.ง.ด. 1/3/53)',
          path: '/finance/wht',
          icon: Receipt,
          placeholder: { trackingSP: 'SP3', eta: 'ภายในไตรมาส 3/2026' },
        },
        {
          label: 'e-Tax Invoice',
          path: '/finance/e-tax',
          icon: FileText,
          placeholder: { trackingSP: 'SP3', eta: 'ภายในไตรมาส 3/2026' },
        },
      ],
    },
    {
      key: 'owner-statements',
      label: 'งบการเงิน',
      icon: PieChart,
      zone: 'fin',
      items: [
        { label: 'กำไร-ขาดทุน (P&L)', path: '/profit-loss', icon: PieChart },
        {
          label: 'งบกระแสเงินสด',
          path: '/finance/cash-flow',
          icon: TrendingUp,
          placeholder: { trackingSP: 'SP2', eta: 'ภายในไตรมาส 2/2026' },
        },
        {
          label: 'งบ Equity',
          path: '/finance/equity-statement',
          icon: BarChart3,
          placeholder: { trackingSP: 'SP2', eta: 'ภายในไตรมาส 2/2026' },
        },
        {
          label: 'สมุดแยกประเภท',
          path: '/finance/general-ledger',
          icon: BookOpen,
          placeholder: { trackingSP: 'SP2', eta: 'ภายในไตรมาส 2/2026' },
        },
      ],
    },
    {
      key: 'owner-bank',
      label: 'ผังบัญชี + ธนาคาร',
      icon: Landmark,
      zone: 'fin',
      items: [
        {
          label: 'บัญชีธนาคาร',
          path: '/finance/bank-accounts',
          icon: Landmark,
          placeholder: { trackingSP: 'SP6', eta: 'ภายในไตรมาส 4/2026' },
        },
      ],
    },
    {
      key: 'owner-doc-config',
      label: 'ตั้งค่าเอกสาร',
      icon: FileText,
      zone: 'settings',
      items: [
        // P2-SP2 — live page (D1.1.2.x SystemConfig backend wired through
        // DocumentConfigPage). Previously a placeholder; promoted to a real
        // link once the UI shipped.
        {
          label: 'เลขที่/รูปแบบเอกสาร',
          path: '/settings/document-config',
          icon: FileText,
        },
      ],
    },
    assetMenuSection,
    {
      key: 'owner-online-shop',
      label: 'ร้านค้าออนไลน์',
      icon: ShoppingBag,
      zone: 'shop',
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
      zone: 'shop',
      items: [
        { label: 'Ads & ROI', path: '/ads', icon: Target },
        { label: 'Broadcast', path: '/broadcast', icon: Send },
      ],
    },
    {
      key: 'owner-settings',
      label: 'ตั้งค่า',
      icon: Settings,
      zone: 'settings',
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
      key: 'owner-fin-tools',
      label: 'เครื่องมือไฟแนนซ์',
      icon: Plug,
      zone: 'fin',
      items: [
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
      ],
    },
    {
      key: 'owner-settings-extra',
      label: 'บันทึกระบบ',
      icon: ScrollText,
      zone: 'settings',
      items: [
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

/** Map of role → new zone-aware config. Populated in SP1 Task 6. */
const ZONE_CONFIG: Record<string, RoleZoneConfig> = {
  OWNER: {
    zones: ['shop', 'fin'],
    defaultZone: 'shop',
    showSettingsGear: true,
    sections: OWNER_CONFIG.sidebar,
    bottomNav: {
      shop: OWNER_CONFIG.bottomNav,
      fin: [
        { label: 'Dashboard', path: '/finance-portfolio', icon: CircleDollarSign },
        { label: 'ค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'ชำระ', path: '/payments', icon: HandCoins },
        { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      settings: [
        { label: 'ผู้ใช้', path: '/users', icon: UserCog },
        { label: 'บริษัท', path: '/settings/companies', icon: Building2 },
        { label: 'สาขา', path: '/branches', icon: Building2 },
        { label: 'ตั้งค่า', path: '/settings', icon: Settings },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
    },
  },
  BRANCH_MANAGER: {
    zones: ['shop', 'fin'],
    defaultZone: 'shop',
    showSettingsGear: false,
    sections: BRANCH_MANAGER_CONFIG.sidebar,
    bottomNav: {
      shop: BRANCH_MANAGER_CONFIG.bottomNav,
      fin: [
        { label: 'ค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
        { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      settings: [],
    },
  },
  FINANCE_MANAGER: {
    zones: ['shop', 'fin'],
    defaultZone: 'fin',
    showSettingsGear: false,
    sections: FINANCE_MANAGER_CONFIG.sidebar,
    bottomNav: {
      shop: [
        { label: 'Dashboard', path: '/', icon: Home },
        { label: 'สัญญา', path: '/contracts', icon: FileCheck },
        { label: 'ชำระ', path: '/payments', icon: HandCoins },
        { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      fin: FINANCE_MANAGER_CONFIG.bottomNav,
      settings: [],
    },
  },
  SALES: {
    zones: ['shop'],
    defaultZone: 'shop',
    showSettingsGear: false,
    sections: SALES_CONFIG.sidebar,
    bottomNav: {
      shop: SALES_CONFIG.bottomNav,
      fin: [],
      settings: [],
    },
  },
  ACCOUNTANT: {
    zones: ['fin'],
    defaultZone: 'fin',
    showSettingsGear: false,
    sections: ACCOUNTANT_CONFIG.sidebar,
    bottomNav: {
      shop: [],
      fin: ACCOUNTANT_CONFIG.bottomNav,
      settings: [],
    },
  },
};

/**
 * Filter sections for the role's current zone.
 * Returns empty array if role/zone combo invalid (caller handles fallback).
 */
export function getSidebarForRole(role: string, currentZone: Zone): MenuSection[] {
  const config = ZONE_CONFIG[role];
  if (!config) return [];
  if (currentZone === 'settings') {
    return config.showSettingsGear
      ? config.sections.filter((s) => s.zone === 'settings')
      : [];
  }
  if (!config.zones.includes(currentZone)) return [];
  return config.sections.filter((s) => s.zone === currentZone);
}

/** Returns the RoleZoneConfig for a role (or undefined). Used by Sidebar to check pills/gear visibility. */
export function getZoneConfigForRole(role: string): RoleZoneConfig | undefined {
  return ZONE_CONFIG[role];
}

/* ── Chat visibility per role ──────────────────────── */

const CHAT_VISIBLE_ROLES = new Set(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']);

export function isChatVisibleForRole(role: string): boolean {
  return CHAT_VISIBLE_ROLES.has(role);
}
