import { NAV_LABELS } from '@/config/work-navigation';

/**
 * ชื่อหน้าใน breadcrumb ของแถบบน (TopBar) — exact match ก่อน แล้วค่อย prefix
 * หน้ารายละเอียดสินค้าอยู่ที่ `/products/:id` (route เดิม) แต่เมนูคือ "สต็อก" — ไม่ใส่ไว้ก็จะโชว์ UUID
 */
export const PAGE_TITLE_MAP: Record<string, string> = {
  '/': NAV_LABELS.home,
  '/pos': NAV_LABELS.sales,
  '/customers': 'ลูกค้า',
  '/contracts': NAV_LABELS.contracts,
  '/payments': NAV_LABELS.payments,
  '/stock': NAV_LABELS.stock,
  '/products': NAV_LABELS.stock,
  '/crm': NAV_LABELS.crm,
  '/inbox': NAV_LABELS.chat,
  '/credit-checks': 'ตรวจเครดิต',
  '/shop/daily-cash': 'สรุปเงินรายวัน',
  '/overdue': 'ค้างชำระ',
  '/settings': 'ตั้งค่า',
  '/users': 'ผู้ใช้',
  '/branches': 'สาขา',
  '/suppliers': 'ผู้จำหน่าย',
  '/commissions': 'คอมมิชชัน',
  '/receipts': 'ใบเสร็จ',
  '/audit-logs': 'Audit Logs',
  '/notifications': 'แจ้งเตือน',
};

export function resolvePageTitle(pathname: string): string {
  const exactMatch = PAGE_TITLE_MAP[pathname];
  if (exactMatch) return exactMatch;
  const prefix = Object.keys(PAGE_TITLE_MAP).find(
    (k) => k !== '/' && (pathname === k || pathname.startsWith(`${k}/`)),
  );
  if (prefix) return PAGE_TITLE_MAP[prefix];
  return pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 'Dashboard';
}
