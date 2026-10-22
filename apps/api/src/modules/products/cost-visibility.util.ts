import type { ShopHomeResponse } from '../shop-home/shop-home.types';

/**
 * จุดเดียวที่ตัดสินว่าใครเห็น "ราคาทุน" — owner decision 2026-08-04 §1.4:
 * SALES ต้องไม่เห็นราคาทุน/กำไร และต้องบังคับที่ฝั่ง server (การซ่อนใน DOM
 * อย่างเดียวเปิด response ดิบดูได้). Mirror ของ precedent per-field redaction
 * ที่ staff-chat.controller.ts:126-135 (SALES → nationalId: null).
 *
 * ตั้งใจเขียนเป็น deny-list (`role !== 'SALES'`) ไม่ใช่ allow-list — role ใหม่
 * ที่เพิ่มเข้าระบบในอนาคตจะ "เห็นทุน" โดย default ทันทีที่ไม่ใช่ SALES โดยไม่ต้อง
 * แก้ไฟล์นี้. ถ้ามี role ใหม่ที่ควรถูกซ่อนทุนเหมือน SALES (เช่น role
 * part-time/intern ในอนาคต) ต้องกลับมาทบทวนเงื่อนไขนี้ให้เป็น list หรือ set
 * แทนการเทียบสตริงเดียว.
 */
export function canSeeCost(role: string | undefined | null): boolean {
  return role !== 'SALES';
}

/** ตัดคีย์ costPrice ออกจาก row (ไม่แตะฟิลด์อื่น) */
export function omitCostPrice<T extends { costPrice?: unknown }>(row: T): Omit<T, 'costPrice'> {
  const { costPrice: _costPrice, ...rest } = row;
  return rest;
}

/**
 * summary ของ getStock มี totalValue = ผลรวม costPrice ของสาขา — เป็นข้อมูลทุน
 * เช่นกัน. คืน null (ไม่ใช่ 0) เพื่อให้ UI แยกออกระหว่าง "ไม่มีสิทธิ์ดู" กับ
 * "มูลค่าเป็นศูนย์จริง".
 */
export function redactStockSummary<T extends { totalValue: number }>(
  rows: T[],
): (Omit<T, 'totalValue'> & { totalValue: number | null })[] {
  return rows.map(({ totalValue: _totalValue, ...rest }) => ({ ...rest, totalValue: null }));
}

type ValueRow = { value: number };
type RedactedValueRow<T extends ValueRow> = Omit<T, 'value'> & { value: number | null };

const nullValue = <T extends ValueRow>(rows: T[]): RedactedValueRow<T>[] =>
  rows.map(({ value: _value, ...rest }) => ({ ...rest, value: null }));

/**
 * GET /products/stock/dashboard — ทุกตัวเลขที่คิดจาก costPrice ต้องหายไปสำหรับ
 * SALES: `value` ของ aging/status/breakdown (= Σ costPrice), `costPrice` ของ
 * slowMovers และ marginOverview ทั้งก้อน (ทุน/กำไร). count/วัน/การเคลื่อนไหว
 * คงไว้ครบ. ใช้ null ไม่ใช่ 0 ด้วยเหตุผลเดียวกับ redactStockSummary.
 */
export function redactStockDashboard<
  T extends {
    stockAging: ValueRow[];
    valueByStatus: ValueRow[];
    byCategory: ValueRow[];
    byBrand: ValueRow[];
    byColor: ValueRow[];
    byStorage: ValueRow[];
    slowMovers: { costPrice?: unknown }[];
    marginOverview: unknown;
  },
>(dashboard: T) {
  return {
    ...dashboard,
    stockAging: nullValue(dashboard.stockAging),
    valueByStatus: nullValue(dashboard.valueByStatus),
    byCategory: nullValue(dashboard.byCategory),
    byBrand: nullValue(dashboard.byBrand),
    byColor: nullValue(dashboard.byColor),
    byStorage: nullValue(dashboard.byStorage),
    slowMovers: dashboard.slowMovers.map(omitCostPrice),
    marginOverview: null,
  };
}

/**
 * GET /shop-home — หน้าหลักหน้าร้านมีต้นทุน/กำไรซ่อนอยู่ 4 จุด:
 * watch[].costValue (ทุนจมของเครื่องค้าง 90+ วัน), monthly[].cost/grossProfit,
 * thisMonth (ทุกช่องยกเว้นยอดขาย) และ slowMovers[].costPrice.
 * คืน object ใหม่ ไม่แตะต้นฉบับ.
 */
export function redactShopHome(r: ShopHomeResponse): ShopHomeResponse {
  return {
    ...r,
    watch: r.watch.map((w) => ({ ...w, costValue: null })),
    monthly: r.monthly.map((m) => ({ ...m, cost: null, grossProfit: null })),
    thisMonth: {
      sales: r.thisMonth.sales,
      salesMomPct: r.thisMonth.salesMomPct,
      cost: null,
      grossProfit: null,
      grossMarginPct: null,
      grossProfitMomPct: null,
    },
    slowMovers: r.slowMovers.map(omitCostPrice),
  };
}
