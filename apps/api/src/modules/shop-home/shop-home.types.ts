/**
 * Response ของ GET /shop-home — หน้าหลักหน้าร้าน (spec:
 * docs/superpowers/specs/2026-10-22-shop-home-dashboard-design.md §5).
 * Service ประกอบก้อนเต็มเสมอ; controller ตัดต้นทุน/กำไรด้วย
 * `redactShopHome()` เมื่อผู้เรียกไม่มีสิทธิ์ดูต้นทุน (SALES).
 */
export type ShopHomeWatchKey =
  | 'LOW_STOCK'
  | 'AGING_90'
  | 'QC_PHOTO'
  | 'TRANSFER_PENDING'
  | 'REPOSSESSED'
  | 'PO_APPROVAL';

export type ShopHomeSeverity = 'urgent' | 'wait' | 'info';

export interface ShopHomeWatchItem {
  key: ShopHomeWatchKey;
  count: number;
  severity: ShopHomeSeverity;
  /** ข้อความสั้นที่ server ประกอบแล้ว (ชื่อ SKU, เลข PO) */
  detail: string | null;
  /** เฉพาะ AGING_90 = Σ costPrice ของเครื่องค้าง 90+ วัน; null เมื่อไม่มีสิทธิ์ดูต้นทุน */
  costValue: number | null;
}

export interface ShopHomeMonth {
  /** 'YYYY-MM' */
  month: string;
  sales: number;
  cost: number | null;
  grossProfit: number | null;
}

export interface ShopHomeResponse {
  generatedAt: string;
  branch: { id: string | null; name: string };
  today: {
    /** นับบิลตาม saleType (daily-summary ไม่แยกวิธีรับเงิน) */
    sales: { count: number; netAmount: number; cash: number; installment: number; externalFinance: number };
    cashDrawer: { balance: number; closedToday: boolean; lastClosedAt: string | null };
    /** ใบจองเปิดอยู่ที่ expireDate = วันนี้ (Booking ไม่มีวันนัดรับ) */
    bookingsExpiringToday: { count: number; depositTotal: number; reservedUnits: number };
    afterSales: { waitingPickup: number; overdue: number };
  };
  /** เฉพาะรายการที่ count > 0 เรียง urgent → wait → info */
  watch: ShopHomeWatchItem[];
  /** 1–6 เดือน เก่า→ใหม่ ตัดเดือนนำหน้าที่ sales=0 และ cost=0 ออก (คงเดือนปัจจุบันเสมอ) */
  monthly: ShopHomeMonth[];
  thisMonth: {
    sales: number;
    salesMomPct: number | null;
    cost: number | null;
    grossProfit: number | null;
    grossMarginPct: number | null;
    grossProfitMomPct: number | null;
  };
  topSellers30d: {
    byModel: { name: string; count: number }[];
    byCategory: { name: string; count: number }[];
  };
  /** สูงสุด 5 เฉพาะ ≥ 30 วัน; costPrice หายไปเมื่อไม่มีสิทธิ์ดูต้นทุน */
  slowMovers: { name: string; days: number; costPrice?: number }[];
  stockAging: { label: string; count: number }[];
}
