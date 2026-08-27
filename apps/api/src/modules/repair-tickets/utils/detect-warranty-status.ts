import { WarrantyStatus } from '@prisma/client';

/**
 * Converts a UTC Date to a Date representing the Asia/Bangkok calendar day
 * (UTC+7) with time zeroed out. Used for inclusive calendar-day arithmetic
 * so that, e.g., a device received at 23:00 BKK is counted as day 0 (not
 * a fractional day crossing midnight UTC).
 */
function toBkkCalendarDay(d: Date): Date {
  const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return new Date(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate());
}

export interface DetectWarrantyInput {
  contract?: { deviceReceivedAt?: Date | null; shopWarrantyEndDate?: Date | null } | null;
  /**
   * ใบขายของเครื่องเครื่องนี้ — แหล่งประกันร้านสำหรับ **ขายสด / ไฟแนนซ์นอก** ซึ่งไม่มีสัญญา
   * (คำสั่งเจ้าของ 2026-08-27; คอลัมน์คู่นี้เพิ่มบน `Sale` ใน migration 20261000200000)
   *
   * ใบขายของสัญญาผ่อนจะมีคอลัมน์นี้เป็น NULL เสมอ — ขาผ่อนเก็บประกันไว้บน Contract
   * จุดเดียวตามเดิม (ดู `SaleWriterService.resolveSaleShopWarranty`) ⇒ ส่งมาทั้งคู่พร้อมกัน
   * ได้โดยไม่ต้องกลัวชนกัน แต่ถ้าวันหนึ่งมีทั้งสองค่า **Contract ชนะ** (ดูลำดับใน
   * `shopWarrantyEndOf` ข้างล่าง) เพราะสัญญาคือเอกสารที่ลูกค้าเซ็น
   */
  sale?: { shopWarrantyEndDate?: Date | null } | null;
  product?: { warrantyExpireDate?: Date | null } | null;
}

/** วันหมดประกันร้านที่มีผล — สัญญามาก่อนใบขาย */
function shopWarrantyEndOf(input: DetectWarrantyInput): Date | null {
  return input.contract?.shopWarrantyEndDate ?? input.sale?.shopWarrantyEndDate ?? null;
}

/**
 * Determines the warranty status for a repair ticket based on contract and product dates.
 *
 * Priority:
 *   1. IN_7DAY_DEFECT  — device received ≤7 days ago (7-day return policy)
 *   2. IN_SHOP_WARRANTY — shop warranty end date still in the future
 *   3. IN_MANUFACTURER  — manufacturer warranty still active on product
 *   4. OUT_OF_WARRANTY  — all warranties expired or no dates provided
 *   5. WALK_IN          — no contract and no product linked (drop-in customer)
 */
export function detectWarrantyStatus(input: DetectWarrantyInput): WarrantyStatus {
  const now = new Date();
  const c = input.contract;
  const p = input.product;

  // No context at all → walk-in customer
  // (ใบขายอย่างเดียวก็นับว่า "มีบริบท" — ลูกค้าเงินสดไม่ใช่ walk-in)
  if (!c && !p && !input.sale) return 'WALK_IN';

  // 7-day defect window (counted from device receipt, inclusive).
  // W8: use BKK calendar-day arithmetic (UTC+7) — matches defect-exchange.service
  // convention (setDate-based window) and avoids edge cases where a device
  // received at 23:00 BKK is 0.99 days old in UTC but 1 calendar day in BKK.
  if (c?.deviceReceivedAt) {
    const daysSinceReceipt =
      (toBkkCalendarDay(now).getTime() - toBkkCalendarDay(c.deviceReceivedAt).getTime()) /
      86400_000;
    if (daysSinceReceipt <= 7) return 'IN_7DAY_DEFECT';
  }

  // Shop warranty still active (สัญญา หรือ ใบขาย — ดู shopWarrantyEndOf)
  const shopEnd = shopWarrantyEndOf(input);
  if (shopEnd && shopEnd > now) {
    return 'IN_SHOP_WARRANTY';
  }

  // Manufacturer warranty still active
  if (p?.warrantyExpireDate && p.warrantyExpireDate > now) {
    return 'IN_MANUFACTURER';
  }

  return 'OUT_OF_WARRANTY';
}

/**
 * Returns the default payer for a repair based on warranty status.
 *
 * - In-warranty (any kind) → SHOP bears the cost
 * - Out-of-warranty or walk-in → CUSTOMER pays
 */
export function defaultPayer(ws: WarrantyStatus): 'SHOP' | 'CUSTOMER' {
  if (ws === 'OUT_OF_WARRANTY' || ws === 'WALK_IN') return 'CUSTOMER';
  return 'SHOP';
}
