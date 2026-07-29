import { Decimal } from '@prisma/client/runtime/library';

export type ExchangeTier = 'AUTO' | 'REVIEW' | 'ESCALATE';

export interface ExchangeTierInput {
  buyback: Decimal;
  /** NCV = GL(11-2101) − GL(11-2106) ของสัญญาเก่า ณ เวลาคำนวณ */
  ncv: Decimal;
  /** ราคากลางจาก TradeInValuation (null = ไม่มี row ของรุ่น/สภาพนั้น) */
  basePrice: Decimal | null;
  /** SystemConfig exchange_market_check_pct (default 15) */
  marketCheckPct: number;
}

/**
 * Approval matrix (spec §6, แก้ความกำกวม workbook Case 2C แล้ว):
 *   ESCALATE : buyback < 70% × NCV                      (OWNER เท่านั้น)
 *   REVIEW   : 70%×NCV ≤ buyback < NCV                  (BRANCH_MANAGER+)
 *              หรือ ≥ NCV แต่ตก market check / ไม่มีราคากลาง
 *              หรือ buyback > basePrice × (1 + pct/100)  ← overpay เกินราคากลาง (symmetric ±pct)
 *   AUTO     : buyback ≥ NCV และ marketMin ≤ buyback ≤ marketMax
 *
 * marketMax (2026-07-29 final review I5): AUTO tier ต้องผ่านกรอบราคากลางทั้ง 2 ด้าน —
 * จ่ายแพงเกิน (เช่นเอื้อลูกค้า/พนักงาน) ต้องผ่านคนอนุมัติเหมือนจ่ายถูกเกิน
 * (symmetric ±marketCheckPct ตาม rationale ของ D3; pending owner confirmation)
 */
export function computeExchangeTier(input: ExchangeTierInput): ExchangeTier {
  const { buyback, ncv, basePrice, marketCheckPct } = input;
  if (buyback.lt(ncv.times('0.70'))) return 'ESCALATE';
  if (buyback.lt(ncv)) return 'REVIEW';
  if (basePrice === null) return 'REVIEW';
  const marketMin = basePrice.times(new Decimal(100).minus(marketCheckPct).div(100));
  if (buyback.lt(marketMin)) return 'REVIEW';
  const marketMax = basePrice.times(new Decimal(100).plus(marketCheckPct).div(100));
  if (buyback.gt(marketMax)) return 'REVIEW';
  return 'AUTO';
}
