/** Mirror ของ apps/api/src/modules/shop-home/shop-home.types.ts (GET /shop-home) */
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
  detail: string | null;
  /** null เมื่อ server ตัดต้นทุนออก (SALES) */
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
    sales: { count: number; netAmount: number; cash: number; installment: number; externalFinance: number };
    cashDrawer: { balance: number; closedToday: boolean; lastClosedAt: string | null };
    bookingsExpiringToday: { count: number; depositTotal: number; reservedUnits: number };
    afterSales: { waitingPickup: number; overdue: number };
  };
  watch: ShopHomeWatchItem[];
  /** 1–6 เดือน เก่า→ใหม่ */
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
  slowMovers: { name: string; days: number; costPrice?: number }[];
  stockAging: { label: string; count: number }[];
}
