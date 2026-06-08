import { Decimal } from '@prisma/client/runtime/library';

const TOLERANCE = new Decimal('1.00');

export interface SplitReceiptInput {
  /** Cash (or customer-credit) received THIS receipt for THIS installment. */
  delta: Decimal;
  /** installmentTotal from computeInstallmentBreakdown (the 2A-accrual basis). */
  installmentTotal: Decimal;
  /** Total late fee owed on this installment (0 when none / waived). */
  lateFee: Decimal;
  /** Σ Cr 11-2103 already posted for this installment by prior receipts. */
  priorPrincipalCleared: Decimal;
  /** Σ Cr 42-1103 already posted for this installment by prior receipts. */
  priorLateFeeBooked: Decimal;
  /** Existing 21-1103 advance consumed to supplement delta (Dr 21-1103). */
  advanceConsume: Decimal;
  /** Surplus parked as new 21-1103 advance (Cr 21-1103) — excluded from allocation. */
  advanceCredit: Decimal;
  /**
   * True when this receipt is intended to CLOSE the installment. Lets a residual
   * underpay in (0, 1฿] route to 52-1104 (force-close). When false, any residual
   * stays outstanding (installment remains PARTIALLY_PAID).
   */
  isFinalReceipt: boolean;
}

export interface SplitReceiptResult {
  /** Cr 11-2103 — principal cleared this receipt (incl. an absorbed final ≤1฿ residual). */
  principalCleared: Decimal;
  /** Cr 42-1103 — late fee booked this receipt. */
  lateFeePortion: Decimal;
  /** Cr 53-1503 — overpay rounding (≥0). >1฿ signals a tolerance breach for the template. */
  overpayRounding: Decimal;
  /** Dr 52-1104 — underpay close (≥0, ≤1฿, final receipt only). */
  underpayRounding: Decimal;
  /** Outstanding principal after this receipt (0 when fully cleared). */
  principalRemainingAfter: Decimal;
}

/**
 * Pure per-receipt allocation. No Nest, no DB, no throw — tolerance/approver
 * enforcement lives in PaymentReceiptTemplate so this stays a unit-testable
 * money-math function (mirrors computeInstallmentBreakdown).
 */
export function splitReceipt(input: SplitReceiptInput): SplitReceiptResult {
  const zero = new Decimal(0);
  const principalRemaining = Decimal.max(
    input.installmentTotal.minus(input.priorPrincipalCleared),
    zero,
  );
  const lateFeeRemaining = Decimal.max(input.lateFee.minus(input.priorLateFeeBooked), zero);

  // Funds to allocate = cash delta + advance consumed − surplus parked as advance.
  const available = input.delta.plus(input.advanceConsume).minus(input.advanceCredit);

  let principalCleared = Decimal.max(Decimal.min(available, principalRemaining), zero);
  const afterPrincipal = available.minus(principalCleared);
  const lateFeePortion = Decimal.min(Decimal.max(afterPrincipal, zero), lateFeeRemaining);
  const leftover = afterPrincipal.minus(lateFeePortion); // ≥ 0 by construction

  let overpayRounding = leftover;
  let underpayRounding = zero;
  let principalRemainingAfter = principalRemaining.minus(principalCleared);

  // Final-receipt underpay close: a small residual ≤1฿ is absorbed by 52-1104 so
  // the receivable clears exactly. Only when nothing is left over (no overpay).
  if (
    input.isFinalReceipt &&
    leftover.eq(0) &&
    principalRemainingAfter.gt(0) &&
    principalRemainingAfter.lte(TOLERANCE)
  ) {
    underpayRounding = principalRemainingAfter;
    principalCleared = principalCleared.plus(principalRemainingAfter); // full clear
    principalRemainingAfter = zero;
    overpayRounding = zero;
  }

  return { principalCleared, lateFeePortion, overpayRounding, underpayRounding, principalRemainingAfter };
}
