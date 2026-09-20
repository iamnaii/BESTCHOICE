import { NAV_LABELS } from './work-navigation';
import { WORK_COMPANY } from '@/lib/company-scope';
import { resolveCompanyAccess } from '@installment/shared';
import type { LucideIcon } from 'lucide-react';
import { settingsNavEntries } from './settings-access';
import type { SettingsRole } from './settings-registry';
import {
  ShoppingCart,
  Users,
  Smartphone,
  FileCheck,
  FileSearch,
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
  BadgePercent,
  Shield,
  ScrollText,
  Bell,
  MessageSquareMore,
  MoreHorizontal,
  Send,
  LayoutGrid,
  CheckSquare,
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
  // P2-SP2 — exchange requests
  ArrowLeftRight,
  Mail,
  // Unified contact party-master — สมุดผู้ติดต่อ
  ArrowLeft,
  BookUser, Camera
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────── */

export type MenuBadgeKey =
  | 'chat-unread'
  | 'asset-draft-count'
  | 'qc-pending-count'
  | 'online-orders-pending';

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
  /** 'sidebar' = เปิดลิ้นชักเมนู, 'exit-settings' = ออกจากโหมดตั้งค่า (สลับโซน + navigate)
   *  ทั้งคู่ไม่ใช่ลิงก์ — `path` เป็นแค่ sentinel ที่ไม่มีใคร navigate ไป */
  action?: 'sidebar' | 'exit-settings';
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
// Collapsed to ONE entry (2026-08-10, owner mockup) — the 7 sub-views
// (เอกสาร / ทะเบียน+NBV / สมุดรายวัน / สรุปแยกหมวด / ค่าเสื่อม / ปิดงวด / Audit)
// now live as in-page tabs (AssetHubTabs) on top of every asset page.
const assetMenuSection: MenuSection = {
  key: 'asset',
  label: 'สินทรัพย์',
  icon: Landmark,
  zone: 'fin',
  items: [
    { label: 'สินทรัพย์ถาวร', path: '/assets', icon: Landmark, badgeKey: 'asset-draft-count' },
  ],
};

/* ── SALES — พนักงานขาย ────────────────────────────── */

const SALES_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'sales-work',
      label: 'ขาย',
      icon: ShoppingCart,
      zone: 'shop',
      items: [
        { label: NAV_LABELS.sales, path: '/pos', icon: ShoppingCart },
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'ตรวจเครดิต', path: '/credit-checks', icon: ShieldCheck },
        { label: 'รับซื้อมือสอง', path: '/trade-in', icon: Smartphone },
        // route อนุญาต role นี้อยู่แล้ว แต่เดิมไม่มีในเมนู ⇒ MainLayout เด้งกลับ Dashboard
        // พร้อม toast "ไม่มีสิทธิ์" ทั้งที่มีสิทธิ์ (E2E role-access จับไว้ ปักที่ route-reachability.test.ts)
        { label: 'รายการขาย', path: '/sales', icon: TrendingUp },
      ],
    },
    {
      key: 'sales-contracts',
      label: 'สัญญา & ชำระ',
      icon: FileCheck,
      zone: 'shop',
      items: [
        { label: NAV_LABELS.contracts, path: '/contracts', icon: FileCheck },
        { label: NAV_LABELS.payments, path: '/payments', icon: HandCoins },
        { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
        { label: 'รับซ่อม/รับประกัน', path: '/insurance', icon: ShieldCheck },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: 'คำขอเปลี่ยนเครื่อง', path: '/insurance/exchange-requests', icon: ArrowLeftRight },
      ],
    },
    {
      key: 'sales-tools',
      label: 'เครื่องมือ',
      icon: Warehouse,
      zone: 'shop',
      items: [
        { label: NAV_LABELS.stock, path: '/stock', icon: Warehouse },
        { label: 'รายการสินค้า', path: '/stock/products', icon: ClipboardList },
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: NAV_LABELS.crm, path: '/crm', icon: Kanban },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
      ],
    },
  ],
  bottomNav: [
    { label: NAV_LABELS.sales, path: '/pos', icon: ShoppingCart },
    { label: 'ลูกค้า', path: '/customers', icon: Users },
    { label: 'สัญญา', path: '/contracts', icon: FileCheck },
    { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
    { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
  ],
};

/* ── BRANCH_MANAGER — ผจก.สาขา ────────────────────── */

const BRANCH_MANAGER_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'bm-overview',
      label: 'ภาพรวม',
      icon: Home,
      zone: 'shop',
      items: [
        { label: NAV_LABELS.home, path: '/', icon: Home },
        { label: 'รายการขาย', path: '/sales', icon: TrendingUp },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: 'กำไร-ขาดทุน (P&L)', path: '/profit-loss', icon: PieChart },
      ],
    },
    {
      key: 'bm-sales',
      label: 'ขาย',
      icon: ShoppingCart,
      zone: 'shop',
      items: [
        { label: NAV_LABELS.sales, path: '/pos', icon: ShoppingCart },
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'ตรวจเครดิต', path: '/credit-checks', icon: ShieldCheck },
        { label: 'รับซื้อมือสอง', path: '/trade-in', icon: Smartphone },
        { label: NAV_LABELS.contracts, path: '/contracts', icon: FileCheck },
        { label: NAV_LABELS.payments, path: '/payments', icon: HandCoins },
        { label: 'จัดการอุปกรณ์', path: '/mdm', icon: Smartphone },
        { label: 'รับซ่อม/รับประกัน', path: '/insurance', icon: ShieldCheck },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: 'คำขอเปลี่ยนเครื่อง', path: '/insurance/exchange-requests', icon: ArrowLeftRight },
      ],
    },
    {
      key: 'bm-inventory',
      label: 'คลัง & จัดซื้อ',
      icon: Warehouse,
      zone: 'shop',
      // ลำดับเดียวกับ owner-inventory: 'ภาพรวมคลัง' บนสุด แล้วค่อยไล่ตาม flow
      // (เดิมเรียงกลับหัว คือเอาปลายทาง คลัง/สติกเกอร์ ขึ้นก่อนต้นทาง PO/ผู้จัดจำหน่าย)
      // ผจก.สาขาไม่มี 'รับซื้อมือสอง' ตรงนี้ — อยู่ในหมวด "ขาย" ของ role นี้
      items: [
        { label: NAV_LABELS.stock, path: '/stock', icon: Warehouse },
        { label: 'ผู้จัดจำหน่าย', path: '/suppliers', icon: Building2 },
        { label: 'สั่งซื้อ (PO)', path: '/purchase-orders', icon: ClipboardList },
        { label: 'รอถ่ายรูป', path: '/purchase-orders/qc', icon: Camera, badgeKey: 'qc-pending-count' },
        { label: 'รายการสินค้า', path: '/stock/products', icon: ClipboardList },
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
        // route อนุญาต BRANCH_MANAGER อยู่แล้ว แต่เดิมไม่มีในเมนู ⇒ MainLayout เด้งกลับ
        // Dashboard พร้อม toast "ไม่มีสิทธิ์" ทั้งที่มีสิทธิ์ (ปักที่ route-reachability.test.ts)
        { label: 'บันทึกรายจ่าย', path: '/expenses', icon: Receipt },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: 'สินทรัพย์ถาวร', path: '/assets', icon: Landmark },
      ],
    },
    {
      key: 'bm-followup',
      label: 'ติดตาม',
      icon: AlertTriangle,
      zone: 'shop',
      items: [
        { label: 'ค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
        // คำสั่งเจ้าของ 2026-08-08: หน้าร้าน (BM) ต้องเห็นเมนูยึดคืน — API/route/branch
        // scoping รองรับ BM อยู่แล้ว (#1397: เห็นเฉพาะสาขาตัวเอง) ขาดแค่รายการเมนู
        { label: 'รับเครื่องคืน / ยึดคืน', path: '/repossessions', icon: Lock },
        { label: NAV_LABELS.crm, path: '/crm', icon: Kanban },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
      ],
    },
    {
      key: 'bm-online-shop',
      label: 'ร้านค้าออนไลน์',
      icon: ShoppingBag,
      zone: 'shop',
      items: [
        { label: 'คำสั่งซื้อออนไลน์', path: '/online-orders', icon: ShoppingBag, badgeKey: 'online-orders-pending' },
        { label: 'การจองจากเว็บ', path: '/product-holds', icon: Lock },
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
    { label: NAV_LABELS.home, path: '/', icon: Home },
    { label: 'สต็อก', path: '/stock', icon: Warehouse },
    { label: 'สัญญา', path: '/contracts', icon: FileCheck },
    { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
    { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
  ],
};

/* ── FINANCE_MANAGER — ผจก.การเงิน ───────────────── */

const FINANCE_MANAGER_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'fm-overview',
      label: 'ภาพรวม',
      icon: Home,
      zone: 'fin',
      items: [
        { label: NAV_LABELS.home, path: '/finance-portfolio', icon: CircleDollarSign },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
      ],
    },
    {
      key: 'fm-fin-daily',
      label: 'งานประจำวัน (การเงิน)',
      icon: HandCoins,
      zone: 'fin',
      items: [
        { label: NAV_LABELS.payments, path: '/payments', icon: HandCoins },
        { label: NAV_LABELS.contracts, path: '/contracts', icon: FileCheck },
        // ผจก.การเงินเข้า /inbox ได้ (App.tsx roles) และปุ่ม "สร้างลูกค้าจากแชทนี้" พาไป
        // /customers — ถ้าไม่มีรายการนี้ `resolveZoneForPath` คืน null แล้ว MainLayout
        // เด้งกลับ Dashboard พร้อม toast "ไม่มีสิทธิ์" ทั้งที่ API เปิดให้ FM อยู่แล้ว
        // (customers.controller.ts @Roles มี FINANCE_MANAGER). ปักไว้ที่
        // __tests__/cta-reachability.test.ts
        //
        // ปุ่ม "+ เพิ่มลูกค้าใหม่" บนหน้าทะเบียนถูกซ่อนจาก FM (CustomersPage
        // `canCreateCustomer`) เพราะ `POST /customers` ไม่รับ FM ⇒ FM อ่านทะเบียนได้
        // แต่ไม่มีปุ่มที่กดแล้วเด้ง
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'ตรวจเครดิต', path: '/credit-checks', icon: ShieldCheck },
      ],
    },
    {
      key: 'fm-shop-ops',
      label: 'งานหน้าร้าน',
      icon: ShoppingCart,
      zone: 'shop',
      items: [
        { label: NAV_LABELS.contracts, path: '/contracts', icon: FileCheck },
        { label: NAV_LABELS.payments, path: '/payments', icon: HandCoins },
        { label: 'จัดการอุปกรณ์', path: '/mdm', icon: Smartphone },
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
        // route อนุญาต role นี้อยู่แล้ว แต่เดิมไม่มีในเมนู ⇒ MainLayout เด้งกลับ Dashboard
        // พร้อม toast "ไม่มีสิทธิ์" ทั้งที่มีสิทธิ์ (E2E role-access จับไว้ ปักที่ route-reachability.test.ts)
        { label: NAV_LABELS.stock, path: '/stock', icon: Warehouse },
        // P3-SP5 W6 — SHOP-side accounting (visible to FM in SHOP zone for cross-side overview)
        // Standardized label + icon across all 4 role configs.
        { label: 'บัญชีหน้าร้าน (SHOP)', path: '/shop/accounting', icon: Store },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: 'รับซ่อม/รับประกัน', path: '/insurance', icon: ShieldCheck },
        { label: 'คำขอเปลี่ยนเครื่อง', path: '/insurance/exchange-requests', icon: ArrowLeftRight },
        { label: 'รายการสินค้า', path: '/stock/products', icon: ClipboardList },
      ],
    },
    {
      key: 'fm-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      zone: 'fin',
      items: [
        { label: 'ติดตามหนี้', path: '/overdue', icon: AlertTriangle },
        { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
        { label: 'รับเครื่องคืน / ยึดคืน', path: '/repossessions', icon: Lock },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: NAV_LABELS.crm, path: '/crm', icon: Kanban },
      ],
    },
    /* ── โซนบัญชีของ ผจก.การเงิน — ยกผังเดียวกับ OWNER (fin zone) มาใช้ ────────
     * เดิมเป็นกอง "บัญชี & รายงาน" 17 รายการกองเดียว และ **ขาดหน้ารายงานการเงิน 12 หน้า**
     * ที่ ProtectedRoute อนุญาต FM อยู่แล้ว (งบดุล/งบกระแสเงินสด/สมุดรายวัน/แยกประเภท/
     * อายุหนี้/หนี้สูญ/ปิดบัญชีรายเดือน ฯลฯ) ⇒ MainLayout เด้ง FM ออกจากหน้าที่ตัวเองมีสิทธิ์
     * ตอนที่ OWNER ได้ผังใหม่ตาม CSV ฝั่ง FM ไม่ได้ตามมาด้วย — รอบนี้ทำให้ตรงกัน
     * ชื่อกลุ่ม + การจัดสมาชิกยึดตาม OWNER_CONFIG เป๊ะ เพื่อให้สองบทบาทเห็นโลกเดียวกัน
     * ปักไว้ที่ __tests__/route-reachability.test.ts
     */
    {
      key: 'fm-revenue',
      label: 'รายรับ',
      icon: TrendingUp,
      zone: 'fin',
      items: [
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        { label: 'เอกสารยกเลิกสัญญา', path: '/finance/contract-cancellation', icon: FileText },
        { label: 'ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ', path: '/finance/e-receipt-auto', icon: Receipt },
      ],
    },
    {
      key: 'fm-spend',
      label: 'รายจ่าย',
      icon: Receipt,
      zone: 'fin',
      items: [
        { label: 'จ่ายให้หน้าร้าน (Inter-co)', path: '/accounting/intercompany', icon: Store },
        { label: 'ค่าใช้จ่ายดำเนินงาน', path: '/expenses', icon: Receipt },
      ],
    },
    {
      key: 'fm-closing',
      label: 'ปิดบัญชี',
      icon: CalendarDays,
      zone: 'fin',
      items: [
        { label: 'ปิดบัญชีรายเดือน', path: '/monthly-close', icon: CalendarDays },
        { label: 'ปิดบัญชีสิ้นปี', path: '/finance/year-end-closing', icon: CalendarDays },
        { label: 'ส่วนของผู้ถือหุ้น (Equity)', path: '/finance/equity', icon: Landmark },
        { label: 'ทะเบียนปันผล + ภ.ง.ด.2', path: '/finance/dividend-register', icon: Coins },
        // ไม่มี /accounting/periods — เป็น roles={['OWNER']} (ดูคอมเมนต์ทิศ B)
      ],
    },
    {
      key: 'fm-tax',
      label: 'ภาษี',
      icon: Calculator,
      zone: 'fin',
      items: [
        { label: 'ภ.พ.30 (VAT)', path: '/finance/vat', icon: Calculator },
        { label: 'ภ.ง.ด. 1/3/53 (WHT)', path: '/finance/wht', icon: Calculator },
        { label: 'ภ.ง.ด.1 เงินเดือน (รายพนักงาน)', path: '/finance/wht-report', icon: Calculator },
        { label: 'ประกันสังคม (สปส.1-10)', path: '/finance/sso-report', icon: Calculator },
        { label: 'ภ.ง.ด.1ก / ใบ 50 ทวิ (รายปี)', path: '/finance/wht-annual', icon: Calculator },
        { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
        { label: 'VAT Auto Journal', path: '/finance/vat-auto-journal', icon: Calculator },
      ],
    },
    {
      key: 'fm-statements',
      label: 'งบการเงิน',
      icon: PieChart,
      zone: 'fin',
      items: [
        { label: 'งบดุล (Balance Sheet)', path: '/finance/balance-sheet', icon: Landmark },
        { label: 'กำไร-ขาดทุน (P&L)', path: '/profit-loss', icon: PieChart },
        { label: 'งบกระแสเงินสด', path: '/finance/cash-flow', icon: TrendingUp },
        { label: 'งบ Equity', path: '/finance/equity-statement', icon: Landmark },
      ],
    },
    {
      key: 'fm-reports',
      label: 'รายงาน',
      icon: BarChart3,
      zone: 'fin',
      items: [
        { label: 'รายงานรวม', path: '/reports', icon: BarChart3 },
        // Tooltify import flow B — read-only historical sales dashboard (imported_sales table)
        { label: 'ยอดขายย้อนหลัง (Tooltify)', path: '/imported-sales', icon: History },
        { label: 'รายงานลูกหนี้ + Aging', path: '/finance/aging-report', icon: BarChart3 },
        { label: 'สมุดรายวัน', path: '/finance/general-journal', icon: BookOpen },
        { label: 'สมุดแยกประเภท', path: '/finance/general-ledger', icon: BookOpen },
        { label: 'รายงานหนี้สูญ', path: '/finance/bad-debt-report', icon: BarChart3 },
        { label: 'รายงานลูกหนี้ Inter-co', path: '/finance/intercompany-report', icon: BarChart3 },
        { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins },
        { label: 'ตรวจสอบบัญชี', path: '/financial-audit', icon: ClipboardList },
        // P3-SP3 — PEAK CSV export (deep-linked from /settings#peak-mapping which is OWNER-only)
        { label: 'ส่งออก PEAK CSV', path: '/finance/peak-export', icon: Plug },
      ],
    },
    {
      key: 'fm-bank',
      label: 'บัญชีธนาคาร/เงินสด',
      icon: Landmark,
      zone: 'fin',
      items: [
        { label: 'บัญชีเงินสด/ธนาคาร', path: '/finance/bank-accounts', icon: Landmark },
      ],
    },
    assetMenuSection,
    {
      key: 'fm-online-shop',
      label: 'ร้านค้าออนไลน์',
      icon: ShoppingBag,
      zone: 'shop',
      items: [
        { label: 'คำสั่งซื้อออนไลน์', path: '/online-orders', icon: ShoppingBag, badgeKey: 'online-orders-pending' },
        { label: 'การจองจากเว็บ', path: '/product-holds', icon: Lock },
        { label: 'คำขอผ่อนชำระ', path: '/installment-applications', icon: ClipboardCheck },
        { label: 'แผนออม', path: '/saving-plans', icon: PiggyBank },
      ],
    },
  ],
  bottomNav: [
    { label: NAV_LABELS.home, path: '/finance-portfolio', icon: CircleDollarSign },
    { label: 'ค้างชำระ', path: '/overdue', icon: AlertTriangle },
    { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
    { label: 'ชำระ', path: '/payments', icon: HandCoins },
    { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
    { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
  ],
};

/* ── ACCOUNTANT — ฝ่ายบัญชี ─────────────────────────── */

const ACCOUNTANT_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'acc-shop-accounting', label: 'บัญชีหน้าร้าน (SHOP)', icon: Store, zone: 'shop',
      items: [{ label: 'งบทดลอง + P&L', path: '/shop/accounting', icon: PieChart }],
    },
    {
      key: 'acc-daily',
      label: 'งานประจำวัน',
      icon: HandCoins,
      zone: 'fin',
      items: [
        { label: 'Dashboard การเงิน', path: '/finance-portfolio', icon: CircleDollarSign },
        { label: NAV_LABELS.payments, path: '/payments', icon: HandCoins },
        { label: 'บันทึกรายจ่าย', path: '/expenses', icon: Receipt },
        { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
        { label: 'รับเครื่องคืน / ยึดคืน', path: '/repossessions', icon: Lock },
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: 'เอกสารยกเลิกสัญญา', path: '/finance/contract-cancellation', icon: FileText },
        { label: 'ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ', path: '/finance/e-receipt-auto', icon: Receipt },
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: 'รับซ่อม/รับประกัน', path: '/insurance', icon: ShieldCheck },
      ],
    },
    {
      key: 'acc-reference',
      label: 'ข้อมูลอ้างอิง',
      icon: FileSearch,
      zone: 'fin',
      items: [
        // ProtectedRoute ของ 3 หน้านี้อนุญาต ACCOUNTANT อยู่แล้ว แต่ไม่มีในเมนู
        // ⇒ MainLayout เด้งกลับ Dashboard พร้อม toast "ไม่มีสิทธิ์" ทั้งที่มีสิทธิ์
        // (E2E role-access จับไว้ ปักที่ route-reachability.test.ts)
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: NAV_LABELS.contracts, path: '/contracts', icon: FileCheck },
        { label: NAV_LABELS.stock, path: '/stock', icon: Warehouse },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: 'รายการสินค้า', path: '/stock/products', icon: ClipboardList },
      ],
    },
    {
      key: 'acc-reports',
      label: 'รายได้ & รายงาน',
      icon: BarChart3,
      zone: 'fin',
      items: [
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
        { label: 'รายงานรวม', path: '/reports', icon: BarChart3 },
        // Tooltify import flow B — read-only historical sales dashboard (imported_sales table)
        { label: 'ยอดขายย้อนหลัง (Tooltify)', path: '/imported-sales', icon: History },
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: 'รายงานลูกหนี้ + Aging', path: '/finance/aging-report', icon: BarChart3 },
        { label: 'รายงานหนี้สูญ', path: '/finance/bad-debt-report', icon: BarChart3 },
        { label: 'รายงานลูกหนี้ Inter-co', path: '/finance/intercompany-report', icon: BarChart3 },
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
        { label: 'ส่วนของผู้ถือหุ้น (Equity)', path: '/finance/equity', icon: Landmark },
        { label: 'ทะเบียนปันผล + ภ.ง.ด.2', path: '/finance/dividend-register', icon: Coins },
        // /accounting/periods เป็น ProtectedRoute roles={['OWNER']} (เป็นแค่ redirect ไป
        // /settings#periods ซึ่งอยู่หมวด system ที่ OWNER เท่านั้น) ⇒ role นี้กดแล้วโดนปฏิเสธ
        // เสมอ จึงถอดออกจากเมนู (ปักที่ route-reachability.test.ts ทิศ B)
        { label: 'จ่ายให้หน้าร้าน (Inter-co)', path: '/accounting/intercompany', icon: ClipboardList },
        // ผังบัญชี + PEAK Sync ลบออก — ใช้ผ่าน settings › บัญชี & ภาษี (dedupe 2026-06-24)
        { label: 'ตรวจสอบบัญชี', path: '/financial-audit', icon: ClipboardList },
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
        { label: 'ภ.ง.ด.1 เงินเดือน (รายพนักงาน)', path: '/finance/wht-report', icon: Receipt },
        { label: 'ประกันสังคม (สปส.1-10)', path: '/finance/sso-report', icon: Receipt },
        { label: 'ภ.ง.ด.1ก / ใบ 50 ทวิ (รายปี)', path: '/finance/wht-annual', icon: Receipt },
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
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: 'งบดุล (Balance Sheet)', path: '/finance/balance-sheet', icon: Landmark },
        { label: 'สมุดรายวัน', path: '/finance/general-journal', icon: BookOpen },
      ],
    },
    {
      key: 'acc-bank',
      label: 'ธนาคาร',
      icon: Landmark,
      zone: 'fin',
      items: [
        { label: 'บัญชีธนาคาร', path: '/finance/bank-accounts', icon: Landmark },
      ],
    },
    // acc-doc-config section ลบออก (2026-06-24) — document-config เป็น OWNER-only page
    // (ACC คลิกแล้วเจอ "ไม่มีสิทธิ์"); config อยู่ที่เดียวใน settings (OWNER เท่านั้น)
  ],
  bottomNav: [
    { label: 'ชำระ', path: '/payments', icon: HandCoins },
    { label: 'ใบเสร็จ', path: '/payments?tab=receipts', icon: FileText },
    { label: 'รายจ่าย', path: '/expenses', icon: Receipt },
    { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
  ],
};

/* ── OWNER — เจ้าของ (ทุกเมนู) ─────────────────────── */

const OWNER_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'owner-overview',
      label: 'ภาพรวม',
      icon: CircleDollarSign,
      zone: 'fin',
      items: [
        { label: NAV_LABELS.home, path: '/finance-portfolio', icon: CircleDollarSign },
      ],
    },
    {
      key: 'owner-inventory',
      label: 'คลัง & จัดซื้อ',
      icon: Warehouse,
      zone: 'shop',
      // 'ภาพรวมคลัง' อยู่บนสุดเสมอ (คำสั่งเจ้าของ) — เป็นหน้าที่เปิดบ่อยที่สุดของหมวดนี้
      // ที่เหลือเรียงตาม flow ของจริง: ตั้งคู่ค้า → ของเข้า 2 ทาง → ด่านก่อนขึ้นขาย → ของในคลัง
      // 'รอถ่ายรูป' ต้องอยู่ "หลัง" ทั้ง PO และรับซื้อมือสอง เพราะเป็นปลายทาง
      // ร่วมของทั้งสองทาง (po-receiving.service.ts:185 และ trade-in-lifecycle.service.ts:432
      // ต่างก็เขียนสถานะ PHOTO_PENDING) — อย่าย้ายไปแทรกกลาง
      items: [
        { label: NAV_LABELS.stock, path: '/stock', icon: Warehouse },
        { label: 'ผู้จัดจำหน่าย', path: '/suppliers', icon: Building2 },
        { label: 'สั่งซื้อ (PO)', path: '/purchase-orders', icon: ClipboardList },
        { label: 'รับซื้อมือสอง', path: '/trade-in', icon: Smartphone },
        { label: 'รอถ่ายรูป', path: '/purchase-orders/qc', icon: Camera, badgeKey: 'qc-pending-count' },
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
        { label: 'ตรวจเครดิต', path: '/credit-checks', icon: ShieldCheck },
        { label: NAV_LABELS.sales, path: '/pos', icon: ShoppingCart },
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: NAV_LABELS.contracts, path: '/contracts', icon: FileCheck },
        // route อนุญาต role นี้อยู่แล้ว แต่เดิมไม่มีในเมนู ⇒ MainLayout เด้งกลับ Dashboard
        // พร้อม toast "ไม่มีสิทธิ์" ทั้งที่มีสิทธิ์ (E2E role-access จับไว้ ปักที่ route-reachability.test.ts)
        { label: 'รายการขาย', path: '/sales', icon: TrendingUp },
      ],
    },
    {
      key: 'owner-aftersales',
      label: 'หลังการขาย',
      icon: Shield,
      zone: 'shop',
      items: [
        { label: 'รับซ่อม/รับประกัน', path: '/insurance', icon: ShieldCheck },
        { label: 'คำขอเปลี่ยนเครื่อง', path: '/insurance/exchange-requests', icon: ArrowLeftRight },
        // คำสั่งเจ้าของ 2026-08-29: ยึดคืนอยู่ zone ไฟแนนซ์ที่เดียว (owner-fin-revenue)
        // — กลับคำสั่งเดิม 2026-08-08 ที่ให้ duplicate ไว้ทั้งสอง zone.
        // OWNER ยังเข้าถึงได้ปกติ: resolveZoneForPath เจอ /repossessions ใน zone fin
        // แล้ว MainLayout สลับ sidebar ให้เอง (ไม่เด้ง — เด้งเฉพาะตอนไม่เจอเลยสัก zone)
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
        { label: NAV_LABELS.payments, path: '/payments', icon: HandCoins },
        { label: 'ติดตามลูกค้าค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
        { label: 'ล็อคเครื่อง (MDM)', path: '/mdm', icon: Lock },
        { label: 'รับเครื่องคืน / ยึดคืน', path: '/repossessions', icon: Lock },
        // CSV §2 placeholder — owner-flagged ✏ "ต้องสร้าง"
        { label: 'เอกสารยกเลิกสัญญา', path: '/finance/contract-cancellation', icon: FileText },
        { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
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
      ],
    },
    assetMenuSection,
    {
      key: 'owner-period-close',
      label: 'ปิดบัญชี',
      icon: CalendarDays,
      zone: 'fin',
      items: [
        { label: 'ปิดบัญชีรายเดือน', path: '/monthly-close', icon: CalendarDays },
        { label: 'ปิดบัญชีสิ้นปี', path: '/finance/year-end-closing', icon: CalendarDays },
        { label: 'ส่วนของผู้ถือหุ้น (Equity)', path: '/finance/equity', icon: Landmark },
        { label: 'ทะเบียนปันผล + ภ.ง.ด.2', path: '/finance/dividend-register', icon: Coins },
        { label: 'งวดบัญชี', path: '/accounting/periods', icon: CalendarDays },
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
        { label: 'ภ.ง.ด.1 เงินเดือน (รายพนักงาน)', path: '/finance/wht-report', icon: Receipt },
        { label: 'ประกันสังคม (สปส.1-10)', path: '/finance/sso-report', icon: Receipt },
        { label: 'ภ.ง.ด.1ก / ใบ 50 ทวิ (รายปี)', path: '/finance/wht-annual', icon: Receipt },
        { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
        { label: 'VAT Auto Journal', path: '/finance/vat-auto-journal', icon: Calculator },
      ],
    },
    {
      key: 'owner-accounting',
      label: 'งบการเงิน',
      icon: PieChart,
      zone: 'fin',
      items: [
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
        // Tooltify import flow B — read-only historical sales dashboard (imported_sales table)
        { label: 'ยอดขายย้อนหลัง (Tooltify)', path: '/imported-sales', icon: History },
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
      label: 'บัญชีธนาคาร/เงินสด',
      icon: Landmark,
      zone: 'fin',
      items: [
        // ผังบัญชี ลบออก — ใช้ผ่าน settings › บัญชี & ภาษี › ผังบัญชี (dedupe 2026-06-24)
        // SP6 — Bank/Cash account directory (mirrors CoA 11-1101..1203)
        { label: 'บัญชีเงินสด/ธนาคาร', path: '/finance/bank-accounts', icon: Landmark },
      ],
    },
    {
      // ตั้งค่าเอกสาร section ลบออก (2026-06-24) — เป็น config ย้ายไปอยู่ที่เดียวใน
      // settings › บัญชี & ภาษี › เลขที่/รูปแบบเอกสาร (/settings/document-config,
      // หน้ามีแท็บราย doc type ในตัว). ไม่ซ้ำใน fin zone อีก.
      key: 'owner-online-shop',
      label: 'ร้านค้าออนไลน์',
      icon: ShoppingBag,
      zone: 'shop',
      items: [
        { label: 'คำสั่งซื้อออนไลน์', path: '/online-orders', icon: ShoppingBag, badgeKey: 'online-orders-pending' },
        { label: 'การจองจากเว็บ', path: '/product-holds', icon: Lock },
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
        // route อนุญาต role นี้อยู่แล้ว แต่เมนูไม่มี ⇒ MainLayout เด้ง (route-reachability.test.ts)
        { label: NAV_LABELS.crm, path: '/crm', icon: Kanban },
      ],
    },
    {
      // CSV §10 — customer comms.
      // (เครื่องมือเชื่อมต่อ section removed 2026-06-24 — both items were dups of the
      // settings submenu: LINE OA → /settings/rich-menu = settings › สื่อสารลูกค้า › Rich Menu;
      // การเชื่อมต่อ → /settings/integrations/hub = settings › เชื่อมต่อ. Single source now.)
      key: 'owner-fin-notifications',
      label: 'การแจ้งเตือนลูกค้า',
      icon: Bell,
      zone: 'fin',
      items: [
        // Dunning ลบออก — ใช้ผ่าน settings › สื่อสารลูกค้า › Dunning (dedupe 2026-06-24)
        // P4-SP2 — auto e-receipt config (e_receipt_auto SystemConfig key)
        { label: 'ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ', path: '/finance/e-receipt-auto', icon: FileText },
      ],
    },
  ],
  bottomNav: [
    { label: NAV_LABELS.home, path: '/finance-portfolio', icon: CircleDollarSign },
    { label: 'รายงาน', path: '/reports', icon: BarChart3 },
    { label: 'Collection', path: '/overdue', icon: AlertTriangle },
    { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
    { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' as const },
    { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' as const },
  ],
};

/* ── VIEWER — ผู้ตรวจสอบ Read-only (Owner Q4 2026-05-17) ─
 * Scope per Owner Response Q4: /accounting/*, /audit-logs, /reports/* —
 * external auditor view (CPA / สรรพากร). Backend RolesGuard gates
 * VIEWER via `viewer_role_enabled` SystemConfig flag (PR #1036). The
 * menu mirrors that scope: company-specific reports, no settings gear, no mutating
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
      zone: 'shop',
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
      shop: [
        { label: NAV_LABELS.home, path: '/', icon: Home },
        { label: NAV_LABELS.stock, path: '/stock', icon: Warehouse },
        { label: NAV_LABELS.contracts, path: '/contracts', icon: FileCheck },
        { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      fin: [
        { label: NAV_LABELS.home, path: '/finance-portfolio', icon: CircleDollarSign },
        { label: 'ค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
        { label: 'ชำระ', path: '/payments', icon: HandCoins },
        { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      // settings-zone mobile bar — aligned with FM/ACC (dedupe 2026-06-24): dropped the
      // config shortcuts (users/entities/branches/ตั้งค่า) that duplicate the settings
      // submenu. Full settings nav via เพิ่มเติม → drawer (รายชื่อผู้ติดต่อ + 9 หมวด).
      settings: [
        // ทางออกต้องอยู่บนบาร์ล่าง ไม่ใช่ซ่อนในลิ้นชัก — บนมือถือลิ้นชักคือที่ที่ต้องเปิดก่อนถึงจะเห็น
        { label: 'ออกจากตั้งค่า', path: '#exit-settings', icon: ArrowLeft, action: 'exit-settings' },
        { label: 'ผู้ติดต่อ', path: '/contacts', icon: BookUser },
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
        { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
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
    showSettingsGear: true,
    sections: FINANCE_MANAGER_CONFIG.sidebar,
    bottomNav: {
      shop: [
        { label: NAV_LABELS.home, path: '/', icon: Home },
        { label: 'สัญญา', path: '/contracts', icon: FileCheck },
        { label: 'ชำระ', path: '/payments', icon: HandCoins },
        { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      fin: FINANCE_MANAGER_CONFIG.bottomNav,
      settings: [
        // ทางออกต้องอยู่บนบาร์ล่าง ไม่ใช่ซ่อนในลิ้นชัก — บนมือถือลิ้นชักคือที่ที่ต้องเปิดก่อนถึงจะเห็น
        { label: 'ออกจากตั้งค่า', path: '#exit-settings', icon: ArrowLeft, action: 'exit-settings' },
        { label: 'ผู้ติดต่อ', path: '/contacts', icon: BookUser },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
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
    zones: ['shop', 'fin'],
    defaultZone: 'fin',
    showSettingsGear: true,
    sections: ACCOUNTANT_CONFIG.sidebar,
    bottomNav: {
      shop: [
        { label: 'บัญชีหน้าร้าน', path: '/shop/accounting', icon: Store },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      fin: ACCOUNTANT_CONFIG.bottomNav,
      settings: [
        // ทางออกต้องอยู่บนบาร์ล่าง ไม่ใช่ซ่อนในลิ้นชัก — บนมือถือลิ้นชักคือที่ที่ต้องเปิดก่อนถึงจะเห็น
        { label: 'ออกจากตั้งค่า', path: '#exit-settings', icon: ArrowLeft, action: 'exit-settings' },
        { label: 'ผู้ติดต่อ', path: '/contacts', icon: BookUser },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
    },
  },
  VIEWER: {
    zones: ['shop', 'fin'],
    defaultZone: 'fin',
    showSettingsGear: false,
    sections: VIEWER_CONFIG.sidebar,
    bottomNav: {
      shop: [
        { label: 'บัญชีหน้าร้าน', path: '/shop/accounting', icon: Store },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      fin: VIEWER_CONFIG.bottomNav,
      settings: [],
    },
  },
};

/** Build the settings-zone sidebar from the registry (role-filtered categories).
 *  "รายชื่อผู้ติดต่อ" (the /contacts party-master page) sits as the first item inside
 *  the "ตั้งค่าระบบ" submenu, above the registry categories. */
function buildSettingsZoneSections(role: string): MenuSection[] {
  // ลำดับ + เนื้อหามาจาก settingsNavEntries ชุดเดียวกับที่ Sidebar ใช้วาดเมนูจัดกลุ่ม
  // (/contacts มาก่อน แล้วตามด้วยหมวดตาม registry) — แก้ที่เดียว ไม่มีทางเรียงไม่ตรงกัน
  const entries = settingsNavEntries(role as SettingsRole);
  if (entries.length === 0) return [];
  const settings: MenuSection = {
    key: 'settings',
    label: 'ตั้งค่าระบบ',
    icon: Settings,
    zone: 'settings' as const,
    items: entries.map((e) => ({ label: e.label, path: e.path, icon: e.icon })),
  };
  return [settings];
}

/**
 * Filter sections for the role's current zone.
 * Returns empty array if role/zone combo invalid (caller handles fallback).
 */
export function getSidebarForRole(role: string, currentZone: Zone): MenuSection[] {
  const config = ZONE_CONFIG[role];
  if (!config) return [];
  if (currentZone === 'settings') {
    return config.showSettingsGear ? buildSettingsZoneSections(role) : [];
  }
  if (!config.zones.includes(currentZone)) return [];
  return config.sections.filter((s) => s.zone === currentZone);
}

/** Order zones are searched when resolving which zone owns a path. */
const ZONE_LOOKUP_ORDER: Zone[] = ['shop', 'fin', 'settings'];

/**
 * Find which zone a path belongs to for a role. HASH-AWARE: a menu path like
 * '/settings/accounting#vat' matches on the route pathname (react-router's
 * pathname never includes the hash). Returns null if the path isn't in any of
 * the role's accessible zones (caller decides pass-through vs redirect).
 */
export function resolveZoneForPath(role: string, path: string, preferredZone?: Zone): Zone | null {
  if (path === '/settings' || path.startsWith('/settings/') || path.startsWith('/settings#')) {
    const cfg = ZONE_CONFIG[role];
    if (cfg?.showSettingsGear) return 'settings';
  }
  const matches = (menuPath: string) => menuPath === path || menuPath.split('#')[0] === path;
  // Shared pages stay in the chosen company; a fixed /shop or /finance page wins.
  const fixedZone = path.startsWith('/shop/') ? 'shop' : path.startsWith('/finance/') || path === '/finance-portfolio' ? 'fin' : undefined;
  const first = fixedZone ?? preferredZone;
  for (const z of [...(first ? [first] : []), ...ZONE_LOOKUP_ORDER.filter(z => z !== first)]) {
    const sections = getSidebarForRole(role, z);
    const found = sections.some((s) =>
      s.items.some(
        (item) => matches(item.path) || (item.children ?? []).some((c) => matches(c.path)),
      ),
    );
    if (found) return z;
  }
  return null;
}

/**
 * Returns the RoleZoneConfig for a role (or undefined). Used by Sidebar to check pills/gear visibility.
 *
 * ห้ามเช็ค "ยังไม่ตั้งค่าบริษัท" ด้วย `!companies` — array ว่างเป็น truthy ใน JS ทุกคนที่ยังไม่ถูก
 * backfill จึงถูกกรองโซนทิ้งหมดแล้วเจอหน้าจอ "ยังไม่มีสิทธิ์เข้าถึงบริษัท" (เหตุการณ์ 2026-09-08)
 * กฎ "ว่าง = ยังไม่ตั้งค่า → ใช้ค่า default ของ role" อยู่ที่ resolveCompanyAccess ตัวเดียว
 * ซึ่งฝั่ง API (JwtStrategy/EntityScope) เรียกตัวเดียวกัน ทั้งสองฝั่งจึงตัดสินเหมือนกันเสมอ
 */
export function getZoneConfigForRole(role: string, companies?: readonly string[]): RoleZoneConfig | undefined {
  const config = ZONE_CONFIG[role];
  // role ที่ไม่มีเมนูเลย = ไม่มีอะไรให้แสดง — คนละเรื่องกับ "ยังไม่ตั้งค่าบริษัท" จึงยังคืน undefined
  if (!config) return undefined;
  const granted = resolveCompanyAccess(role, companies).accessible;
  // conjunct `sections.some(...)` ห้ามตัดออก: BRANCH_MANAGER มีสิทธิ์ตามบริษัทก็จริงแต่ไม่มี
  // section โซน fin เลย ถ้าตัดจะได้ pill 'งานการเงิน' ที่กดแล้วเจอ sidebar ว่าง
  const zones = config.zones.filter(z => z !== 'settings' &&
    config.sections.some(section => section.zone === z) &&
    granted.includes(WORK_COMPANY[z]));
  return { ...config, zones, defaultZone: zones.includes(config.defaultZone) ? config.defaultZone : zones[0] ?? config.defaultZone };
}

/** Landing route for each zone — used by LoginPage + PillSwitcher to pick where to navigate. */
export const ZONE_LANDING: Record<Zone, string> = {
  shop: '/',
  fin: '/finance-portfolio',
  settings: '/settings',
};

/** Store the work company on the destination so shared routes survive Back/Forward. */
export function getWorkZoneHref(path: string, zone: 'shop' | 'fin'): string {
  const url = new URL(path, 'http://workspace.invalid');
  url.searchParams.set('zone', zone);
  url.searchParams.delete('company');
  return url.pathname + url.search + url.hash;
}

/** Landing path for a role on first login — based on the role's defaultZone. */
export function getLandingPathForRole(role: string): string {
  const config = ZONE_CONFIG[role];
  if (!config) return '/';
  // ผ่าน getZoneEntryPathForRole ไม่ใช่ ZONE_LANDING ตรง ๆ — VIEWER มี defaultZone = 'fin'
  // แต่ไม่มี '/finance-portfolio' ในเมนูตัวเอง (และ route ก็ไม่อนุญาต) ⇒ ล็อกอินเสร็จจะเจอ
  // toast 'คุณไม่มีสิทธิ์เข้าถึงหน้านี้' แล้วถูกเด้งกลับ '/'
  // ACCOUNTANT เคยมีอาการเดียวกันแต่แก้ที่ต้นเหตุแล้ว (เพิ่ม /finance-portfolio เข้าเมนู
  // acc-daily) — route อนุญาต ACC อยู่แล้ว ทางเลี่ยงนี้จึงเหลือไว้เพื่อ VIEWER
  return getZoneEntryPathForRole(role, config.defaultZone);
}

/**
 * Paths ที่ทุก role เข้าถึงได้และไม่สังกัดโซนไหน (Dashboard) — ใช้ร่วมกันระหว่าง
 * MainLayout (กัน toast "ไม่มีสิทธิ์" ผี) และ getZoneEntryPathForRole (เลือกปลายทางที่ปลอดภัย).
 * ต้องเป็นแหล่งเดียว ไม่งั้นสองที่เชื่อคนละเรื่องแล้วผู้ใช้โดนเด้ง.
 */
export const COMMON_PATHS = new Set<string>(['/']);

/**
 * ปลายทางที่ "ปลอดภัย" เมื่อพา role กลับเข้าโซนหนึ่ง.
 *
 * ห้ามใช้ ZONE_LANDING ตรง ๆ: ACCOUNTANT มี defaultZone = 'fin' แต่ '/finance-portfolio'
 * ไม่ได้อยู่ในเมนูของ ACCOUNTANT ⇒ resolveZoneForPath คืน null, role อื่นมีหน้านี้
 * ⇒ MainLayout ยิง toast 'คุณไม่มีสิทธิ์เข้าถึงหน้านี้' แล้วเด้งกลับ '/' ทั้งที่ router
 * อนุญาตจริง. เลือกจากเมนูของ role เองแทนเมื่อ landing ใช้ไม่ได้.
 */
export function getZoneEntryPathForRole(role: string, zone: Zone): string {
  if (zone === 'shop' && (role === 'ACCOUNTANT' || role === 'VIEWER')) return '/shop/accounting';
  const landing = ZONE_LANDING[zone];
  if (COMMON_PATHS.has(landing) || resolveZoneForPath(role, landing) === zone) return landing;
  const first = getSidebarForRole(role, zone)[0]?.items[0];
  return first ? first.path.split('#')[0] : landing;
}

/* ── Chat visibility per role ──────────────────────── */

const CHAT_VISIBLE_ROLES = new Set(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']);

export function isChatVisibleForRole(role: string): boolean {
  return CHAT_VISIBLE_ROLES.has(role);
}
