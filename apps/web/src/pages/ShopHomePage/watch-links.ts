import type { ShopHomeSeverity, ShopHomeWatchKey } from './types';

const OWNER_OR_BM = new Set(['OWNER', 'BRANCH_MANAGER']);

/**
 * ปลายทางของแถวงานค้าง — เป็นลิงก์เฉพาะเมื่อบทบาทนั้นเปิดหน้าได้จริง (ProtectedRoute ใน App.tsx):
 * /stock/alerts · /purchase-orders/qc · /stock/transfers = OWNER, BM เท่านั้น; /purchase-orders ไม่ใช่ SALES
 */
export function watchHref(key: ShopHomeWatchKey, role: string): string | null {
  switch (key) {
    case 'LOW_STOCK':
      return OWNER_OR_BM.has(role) ? '/stock/alerts' : null;
    case 'AGING_90':
      // หน้ารายการสินค้ายังไม่มีตัวกรองอายุ → เรียงเก่าสุดก่อนแทน
      return '/stock/products?sortBy=stockInDate&sortDirection=asc';
    case 'QC_PHOTO':
      return OWNER_OR_BM.has(role) ? '/purchase-orders/qc' : null;
    case 'TRANSFER_PENDING':
      return OWNER_OR_BM.has(role) ? '/stock/transfers' : null;
    case 'REPOSSESSED':
      // status ใช้ได้เฉพาะเมื่อ view=all (ไม่งั้นหน้าล็อก IN_STOCK)
      return '/stock/products?view=all&status=REPOSSESSED';
    case 'PO_APPROVAL':
      return role === 'SALES' ? null : '/purchase-orders';
  }
}

export const WATCH_LABEL: Record<ShopHomeWatchKey, string> = {
  LOW_STOCK: 'สินค้าใกล้หมด',
  AGING_90: 'ค้างสต๊อกเกิน 90 วัน',
  QC_PHOTO: 'รอ QC / รอถ่ายรูป',
  TRANSFER_PENDING: 'โอนระหว่างสาขาค้างรับ',
  REPOSSESSED: 'เครื่องยึดคืนรอตีราคา',
  PO_APPROVAL: 'ใบสั่งซื้อรออนุมัติ',
};

/** คำกำกับความเร่งด่วนบนชิป — ต้องมีเสมอ ไม่สื่อด้วยสีอย่างเดียว */
export const SEVERITY_LABEL: Record<ShopHomeSeverity, string> = {
  urgent: 'ด่วน',
  wait: 'รอ',
  info: 'แจ้ง',
};

export const SEVERITY_CHIP_CLASS: Record<ShopHomeSeverity, string> = {
  urgent: 'bg-destructive/15 text-destructive',
  wait: 'bg-warning/15 text-warning-strong',
  info: 'bg-muted text-muted-foreground',
};
