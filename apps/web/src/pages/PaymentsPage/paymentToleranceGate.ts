import Decimal from 'decimal.js';

export type ToleranceAction = 'block' | 'confirm' | 'proceed';

export interface ToleranceGateResult {
  action: ToleranceAction;
  /** |amount − remaining| rounded to 2dp (0 for the intentional-diff bypass). */
  absDiff: number;
}

/**
 * Tolerance gate for recording a payment against a single installment.
 *
 * The ±1฿ rounding tolerance only applies to payments that INTEND to settle the
 * installment in full (NORMAL / OVERPAY / UNDERPAY). แบ่งชำระ (PARTIAL) and
 * ล่วงหน้า (OVERPAY_ADVANCE) intentionally differ from the exact remaining by
 * more than 1฿ — the backend books them as PARTIALLY_PAID / advance — so they
 * must bypass the gate entirely. Before this exemption, the gate blocked every
 * partial/advance payment with "ส่วนต่างเกิน 1 ฿ ... ไม่สามารถอนุมัติได้".
 *
 * For full-settlement cases:
 *   |diff| > 1฿   → 'block'   (cashier must fix the amount)
 *   0.01–1฿       → 'confirm' (≤1฿ tolerance; needs an approver — 52-1104/53-1503)
 *   < 0.01฿       → 'proceed' (exact)
 */
export function paymentToleranceGate(
  paymentCase: string,
  amount: number,
  remaining: number,
): ToleranceGateResult {
  if (paymentCase === 'PARTIAL' || paymentCase === 'OVERPAY_ADVANCE') {
    return { action: 'proceed', absDiff: 0 };
  }
  const absDiff = new Decimal(amount).sub(remaining).abs().toDecimalPlaces(2).toNumber();
  if (absDiff > 1.0) return { action: 'block', absDiff };
  if (absDiff >= 0.01) return { action: 'confirm', absDiff };
  return { action: 'proceed', absDiff };
}
