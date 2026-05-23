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
  ShieldCheck,
  // P3-SP5 — SHOP-side accounting menu icon
  Store,
  // P2-SP2 / P4 — document config menu
  ReceiptText,
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
        {
          label: 'รับซ่อม/รับประกัน',
          path: '/insurance',
          icon: ShieldCheck,
          children: [
            { label: 'รายการ ticket', path: '/insurance', icon: ShieldCheck },
            { label: 'เช็คประกัน', path: '/insurance/warranty-check', icon: ShieldCheck },
          ],
        },
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
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'เช็คเครดิตลูกค้าใหม่', path: '/customer-intake', icon: UserSearch },
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'จัดการอุปกรณ์', path: '/mdm', icon: Smartphone },
        {
          label: 'รับซ่อม/รับประกัน',
          path: '/insurance',
          icon: ShieldCheck,
          children: [
            { label: 'รายการ ticket', path: '/insurance', icon: ShieldCheck },
            { label: 'เช็คประกัน', path: '/insurance/warranty-check', icon: ShieldCheck },
          ],
        },
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
    // P3-SP5 W5 — BM does NOT have access to /shop/accounting (the API
    // endpoint excludes BRANCH_MANAGER because the report is cross-branch
    // by design, and BM is NOT in CROSS_BRANCH_ROLES). The menu entry
    // that used to live here would 403 on click. Removed.
    // SHOP P&L for BM is deferred to a future per-branch report.
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
        // P3-SP5 W6 — SHOP-side accounting (visible to FM in SHOP zone for cross-side overview)
        // Standardized label + icon across all 4 role configs.
        { label: 'บัญชีหน้าร้าน (SHOP)', path: '/shop/accounting', icon: Store },
      ],
    },
    {
      key: 'fm-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      zone: 'fin',
      items: [
        { label: 'ติดตามหนี้', path: '/overdue', icon: AlertTriangle },
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
        { label: 'กำไร-ขาดทุน', path: '/profit-loss', icon: PieChart },
        // P4-SP2 — Tax module (finance-tax endpoints)
        { label: 'ภ.พ.30 (VAT)', path: '/finance/vat', icon: Calculator },
        { label: 'ภ.ง.ด. 1/3/53 (WHT)', path: '/finance/wht', icon: Calculator },
        { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
        { label: 'VAT Auto Journal', path: '/finance/vat-auto-journal', icon: Calculator },
        // SP6 — Bank/Cash account directory
        { label: 'บัญชีเงินสด/ธนาคาร', path: '/finance/bank-accounts', icon: Landmark },
        { label: 'งวดบัญชี', path: '/accounting/periods', icon: CalendarDays },
        { label: 'ปิดบัญชีสิ้นปี', path: '/finance/year-end-closing', icon: CalendarDays },
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
        // P4-SP2 — Tax module (finance-tax endpoints)
        { label: 'ภ.พ.30 (VAT)', path: '/finance/vat', icon: Calculator },
        { label: 'ภ.ง.ด. 1/3/53 (WHT)', path: '/finance/wht', icon: Calculator },
        { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
        { label: 'VAT Auto Journal', path: '/finance/vat-auto-journal', icon: Calculator },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
        // P3-SP5 — SHOP-side accounting reports
        { label: 'บัญชีหน้าร้าน (SHOP)', path: '/shop/accounting', icon: Store },
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
        { label: 'ปิดบัญชีสิ้นปี', path: '/finance/year-end-closing', icon: CalendarDays },
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
        { label: 'VAT (ภ.พ.30)', path: '/finance/vat', icon: Receipt },
        { label: 'WHT (ภ.ง.ด. 1/3/53)', path: '/finance/wht', icon: Receipt },
        { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
        { label: 'VAT Auto Journal', path: '/finance/vat-auto-journal', icon: Calculator },
      ],
    },
    {
      key: 'acc-statements',
      label: 'งบการเงิน',
      icon: PieChart,
      zone: 'fin',
      items: [
        { label: 'กำไร-ขาดทุน (P&L)', path: '/profit-loss', icon: PieChart },
        { label: 'งบกระแสเงินสด', path: '/finance/cash-flow', icon: TrendingUp },
        { label: 'งบ Equity', path: '/finance/equity-statement', icon: BarChart3 },
        { label: 'สมุดแยกประเภท', path: '/finance/general-ledger', icon: BookOpen },
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
      zone: 'fin',
      items: [
        { label: 'Dashboard', path: '/', icon: Home },
        { label: 'Finance Overview', path: '/finance-portfolio', icon: CircleDollarSign },
      ],
    },
    {
      key: 'owner-fin-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      zone: 'fin',
      items: [
        { label: 'ติดตามหนี้', path: '/overdue', icon: AlertTriangle },
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
        { label: 'จัดการอุปกรณ์', path: '/mdm', icon: Smartphone },
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
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: 'สัญญาผ่อนชำระ', path: '/contracts', icon: FileCheck },
      ],
    },
    {
      key: 'owner-aftersales',
      label: 'หลังการขาย',
      icon: Shield,
      zone: 'shop',
      items: [
        {
          label: 'รับซ่อม/รับประกัน',
          path: '/insurance',
          icon: ShieldCheck,
          children: [
            { label: 'รายการ ticket', path: '/insurance', icon: ShieldCheck },
            { label: 'เช็คประกัน', path: '/insurance/warranty-check', icon: ShieldCheck },
          ],
        },
      ],
    },
    /* ── FIN zone restructure (per owner CSV) ───────────────────
     * 9 sections mirroring the CSV "BESTCHOICE FINANCE" outline:
     * รายรับ / รายจ่าย / ภาษี / บัญชี+งบ / รายงาน /
     * ผังบัญชี+ธนาคาร / ตั้งค่าเอกสาร / เครื่องมือเชื่อมต่อ / การแจ้งเตือน
     * SHOP-zone duplicates (overdue/defect/mdm/repo) intentional —
     * OWNER sees them from both zones; FM/ACC already have them in FIN.
     * Asset menu items embedded as sub-group inside "รายจ่าย" → ซื้อทรัพย์สิน
     * (mirrors `assetMenuSection.items` — kept in sync manually). */
    {
      key: 'owner-fin-revenue',
      label: 'รายรับ',
      icon: TrendingUp,
      zone: 'fin',
      items: [
        { label: 'รับชำระค่างวด', path: '/payments', icon: HandCoins },
        { label: 'ติดตามลูกค้าค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'ล็อคเครื่อง (MDM)', path: '/mdm', icon: Lock },
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
        // CSV §2 placeholder — owner-flagged ✏ "ต้องสร้าง"
        { label: 'เอกสารยกเลิกสัญญา', path: '/finance/contract-cancellation', icon: FileText },
      ],
    },
    {
      key: 'owner-fin-expense',
      label: 'รายจ่าย',
      icon: TrendingDown,
      zone: 'fin',
      items: [
        { label: 'จ่ายให้หน้าร้าน (Inter-co)', path: '/accounting/intercompany', icon: ClipboardList },
        { label: 'ค่าใช้จ่ายดำเนินงาน', path: '/expenses', icon: Receipt },
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        // Period-close grouped under collapsible parent
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
        {
          label: 'ซื้อทรัพย์สิน',
          path: '/assets',
          icon: Landmark,
          children: [
            { label: 'บันทึกซื้อ', path: '/assets', icon: FileText, badgeKey: 'asset-draft-count' },
            { label: 'ทะเบียน + NBV', path: '/assets/register', icon: BookOpen },
            { label: 'สมุดรายวัน', path: '/assets/journal', icon: FileText },
            { label: 'สรุปแยกหมวด', path: '/assets/summary-report', icon: BarChart3 },
            { label: 'ค่าเสื่อม', path: '/depreciation', icon: TrendingDown },
            { label: 'ประวัติสินทรัพย์', path: '/assets/audit', icon: History },
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
        { label: 'VAT (ภ.พ.30)', path: '/finance/vat', icon: Receipt },
        { label: 'WHT (ภ.ง.ด. 1/3/53)', path: '/finance/wht', icon: Receipt },
        { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
        { label: 'VAT Auto Journal', path: '/finance/vat-auto-journal', icon: Calculator },
      ],
    },
    {
      // CSV §5 — "บัญชี + บันทึกเริ่ม" merged "บัญชี" + "งบการเงิน" groups
      key: 'owner-accounting',
      label: 'บัญชี + งบการเงิน',
      icon: PieChart,
      zone: 'fin',
      items: [
        { label: 'ปิดบัญชีรายเดือน', path: '/monthly-close', icon: CalendarDays },
        { label: 'ปิดบัญชีสิ้นปี', path: '/finance/year-end-closing', icon: CalendarDays },
        { label: 'งวดบัญชี', path: '/accounting/periods', icon: CalendarDays },
        // CSV §5 — "งบ 4 ประเภท" (full 4-statement set per TFRS)
        { label: 'งบดุล (Balance Sheet)', path: '/finance/balance-sheet', icon: PieChart },
        { label: 'กำไร-ขาดทุน (P&L)', path: '/profit-loss', icon: PieChart },
        { label: 'งบกระแสเงินสด', path: '/finance/cash-flow', icon: Banknote },
        { label: 'งบ Equity', path: '/finance/equity-statement', icon: BarChart3 },
      ],
    },
    {
      key: 'owner-reports',
      label: 'รายงาน',
      icon: BarChart3,
      zone: 'fin',
      items: [
        { label: 'รายงานรวม', path: '/reports', icon: BarChart3 },
        // CSV §6 placeholders — flagged "ต้องสร้าง"
        { label: 'รายงานลูกหนี้ + Aging', path: '/finance/aging-report', icon: AlertTriangle },
        { label: 'สมุดรายวัน', path: '/finance/general-journal', icon: BookOpen },
        { label: 'สมุดแยกประเภท', path: '/finance/general-ledger', icon: BookOpen },
        { label: 'รายงานหนี้สูญ', path: '/finance/bad-debt-report', icon: TrendingDown },
        { label: 'รายงานลูกหนี้ Inter-co', path: '/finance/intercompany-report', icon: Building2 },
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: 'ตรวจสอบบัญชี', path: '/financial-audit', icon: ClipboardList },
        // P3-SP3 — PEAK CSV export (mapping config lives in /settings#peak-mapping)
        { label: 'ส่งออก PEAK CSV', path: '/finance/peak-export', icon: Plug },
      ],
    },
    {
      key: 'owner-bank',
      label: 'ผังบัญชี + ธนาคาร',
      icon: Landmark,
      zone: 'fin',
      items: [
        { label: 'ผังบัญชี', path: '/settings/chart-of-accounts', icon: ClipboardList },
        // SP6 — Bank/Cash account directory (mirrors CoA 11-1101..1203)
        { label: 'บัญชีเงินสด/ธนาคาร', path: '/finance/bank-accounts', icon: Landmark },
      ],
    },
    {
      // MOVED from `zone: 'settings'` → `zone: 'fin'` per CSV §8.
      // SystemConfig backend (D1.1.2.x) is shared but UX-wise this is a
      // finance-team config, so it belongs in the FIN zone for OWNER.
      // CSV §8 sub-grouping: รายรับ (3 doc types) + รายจ่าย (5 doc types).
      // Sub-items are placeholders — backend config UI per doc type pending.
      key: 'owner-doc-config',
      label: 'ตั้งค่าเอกสาร',
      icon: FileText,
      zone: 'fin',
      items: [
        { label: 'เลขที่/รูปแบบเอกสาร', path: '/settings/document-config?tab=numbering', icon: FileText },
        {
          label: 'เอกสารรายรับ',
          path: '/settings/document-config',
          icon: TrendingUp,
          children: [
            { label: 'ใบรับเงินมัดจำ', path: '/settings/document-config?tab=deposit_receipt', icon: Receipt },
            { label: 'ใบเสร็จรับเงิน', path: '/settings/document-config?tab=receipt', icon: ReceiptText },
            { label: 'ใบลดหนี้', path: '/settings/document-config?tab=credit_note', icon: FileText },
          ],
        },
        {
          label: 'เอกสารรายจ่าย',
          path: '/settings/document-config',
          icon: TrendingDown,
          children: [
            { label: 'ใบสั่งซื้อ (PO)', path: '/settings/document-config?tab=purchase_order', icon: ClipboardList },
            { label: 'ค่าใช้จ่าย', path: '/settings/document-config?tab=expense_doc', icon: Receipt },
            { label: 'รับใบลดหนี้', path: '/settings/document-config?tab=credit_note_received', icon: FileText },
            { label: 'ใบรวมจ่าย', path: '/settings/document-config?tab=payment_summary', icon: FileText },
            { label: 'ซื้อสินทรัพย์', path: '/settings/document-config?tab=asset_purchase', icon: Landmark },
          ],
        },
      ],
    },
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
    // P3-SP5 W6 — SHOP-side accounting reports
    // Standardized label + Store icon across 4 role configs (OWNER/FM/ACC).
    // BM excluded per W5.
    {
      key: 'owner-shop-accounting',
      label: 'บัญชีหน้าร้าน (SHOP)',
      icon: Store,
      zone: 'shop',
      items: [
        { label: 'งบทดลอง + P&L', path: '/shop/accounting', icon: PieChart },
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
        { label: 'ตั้งค่า GFIN', path: '/settings/gfin-rates', icon: Calculator },
        { label: 'โปรโมชัน', path: '/promotions', icon: BadgePercent },
        { label: 'PDPA', path: '/pdpa', icon: Shield },
      ],
    },
    {
      // AI gets its own top-level section in the gear (settings) zone — separated
      // from "ตั้งค่า" because AI configuration is a distinct concern (cost,
      // persona, training, performance) and the settings group was getting crowded.
      key: 'owner-ai',
      label: 'AI',
      icon: Sparkles,
      zone: 'settings',
      items: [
        { label: 'AI Admin', path: '/settings/ai-admin', icon: Sparkles },
        { label: 'AI Persona', path: '/settings/ai-persona', icon: Sparkles },
        { label: 'AI Assistant', path: '/settings/ai-chat', icon: Sparkles },
        { label: 'AI Training', path: '/settings/ai-training', icon: Sparkles },
        { label: 'AI Performance', path: '/settings/ai-performance', icon: Sparkles },
      ],
    },
    {
      // CSV §9 — split from old "เครื่องมือไฟแนนซ์" — Dunning moved to its
      // own section (#10) since it's customer-facing notifications, not
      // an integration target.
      key: 'owner-fin-integrations',
      label: 'เครื่องมือเชื่อมต่อ',
      icon: Plug,
      zone: 'fin',
      items: [
        { label: 'จัดการอุปกรณ์ (MDM)', path: '/mdm', icon: Smartphone },
        { label: 'LINE OA', path: '/settings/rich-menu', icon: MessageSquareMore },
        { label: 'การเชื่อมต่อ (PaySolutions / สรรพากร ฯลฯ)', path: '/settings/integrations', icon: Plug },
      ],
    },
    {
      // CSV §10 — separated from เครื่องมือ since this is customer comms
      key: 'owner-fin-notifications',
      label: 'การแจ้งเตือนลูกค้า',
      icon: Bell,
      zone: 'fin',
      items: [
        { label: 'Dunning (เตือนค่างวด)', path: '/settings/dunning', icon: Bell },
        // P4-SP2 — auto e-receipt config (e_receipt_auto SystemConfig key)
        { label: 'ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ', path: '/finance/e-receipt-auto', icon: FileText },
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

/* ── VIEWER — ผู้ตรวจสอบ Read-only (Owner Q4 2026-05-17) ─
 * Scope per Owner Response Q4: /accounting/*, /audit-logs, /reports/* —
 * external auditor view (CPA / สรรพากร). Backend RolesGuard gates
 * VIEWER via `viewer_role_enabled` SystemConfig flag (PR #1036). The
 * menu mirrors that scope: no SHOP zone, no settings gear, no mutating
 * action links. Pages reached via this menu serve read-only data; any
 * action button on them returns 403 via the gated @Roles().
 */
const VIEWER_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'viewer-accounting',
      label: 'บัญชี + งบการเงิน',
      icon: PieChart,
      zone: 'fin',
      items: [
        { label: 'งบดุล (Balance Sheet)', path: '/finance/balance-sheet', icon: PieChart },
        { label: 'กำไร-ขาดทุน (P&L)', path: '/profit-loss', icon: PieChart },
        { label: 'งบกระแสเงินสด', path: '/finance/cash-flow', icon: Banknote },
        { label: 'งบ Equity', path: '/finance/equity-statement', icon: BarChart3 },
      ],
    },
    {
      key: 'viewer-reports',
      label: 'รายงาน',
      icon: BarChart3,
      zone: 'fin',
      items: [
        { label: 'รายงานรวม', path: '/reports', icon: BarChart3 },
        { label: 'รายงานลูกหนี้ + Aging', path: '/finance/aging-report', icon: AlertTriangle },
        { label: 'สมุดรายวัน', path: '/finance/general-journal', icon: BookOpen },
        { label: 'สมุดแยกประเภท', path: '/finance/general-ledger', icon: BookOpen },
        { label: 'รายงานหนี้สูญ', path: '/finance/bad-debt-report', icon: TrendingDown },
        { label: 'รายงานลูกหนี้ Inter-co', path: '/finance/intercompany-report', icon: Building2 },
        { label: 'ตรวจสอบบัญชี', path: '/financial-audit', icon: ClipboardList },
      ],
    },
    {
      key: 'viewer-shop-accounting',
      label: 'บัญชีหน้าร้าน (SHOP)',
      icon: Store,
      zone: 'fin',
      items: [
        { label: 'งบทดลอง + P&L', path: '/shop/accounting', icon: PieChart },
      ],
    },
    {
      key: 'viewer-audit',
      label: 'บันทึกระบบ',
      icon: ScrollText,
      zone: 'fin',
      items: [
        { label: 'Audit Log', path: '/audit-logs', icon: ScrollText },
      ],
    },
  ],
  bottomNav: [
    { label: 'รายงาน', path: '/reports', icon: BarChart3 },
    { label: 'งบดุล', path: '/finance/balance-sheet', icon: PieChart },
    { label: 'P&L', path: '/profit-loss', icon: PieChart },
    { label: 'Audit Log', path: '/audit-logs', icon: ScrollText },
  ],
};

/* ── Config map ────────────────────────────────────── */

const MENU_CONFIG: Record<string, RoleMenuConfig> = {
  SALES: SALES_CONFIG,
  BRANCH_MANAGER: BRANCH_MANAGER_CONFIG,
  FINANCE_MANAGER: FINANCE_MANAGER_CONFIG,
  ACCOUNTANT: ACCOUNTANT_CONFIG,
  OWNER: OWNER_CONFIG,
  VIEWER: VIEWER_CONFIG,
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
  VIEWER: {
    zones: ['fin'],
    defaultZone: 'fin',
    showSettingsGear: false,
    sections: VIEWER_CONFIG.sidebar,
    bottomNav: {
      shop: [],
      fin: VIEWER_CONFIG.bottomNav,
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
