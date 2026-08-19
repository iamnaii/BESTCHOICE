import Decimal from 'decimal.js';

export interface NetReceiptDueInput {
  /** Base installment (principal + interest + commission + VAT). */
  amountDue: Decimal.Value;
  /** Gross late fee currently on the installment. */
  lateFee: Decimal.Value;
  /** Amount already paid toward this installment. */
  amountPaid: Decimal.Value;
  /** Late-fee waiver (Dr 52-1105). Clamped to ≤ gross lateFee. */
  waiver?: Decimal.Value;
  /** Advance balance parked in 21-1103, available to auto-consume. */
  advanceBalance?: Decimal.Value;
  /** Whether the advance balance is deducted (cashier "หักเครดิต" toggle). */
  consumeAdvance?: boolean;
  /**
   * พักงวดสุดท้าย — reschedule-fee (6a/6b) prepayment parked in 21-1103, separate
   * from `advanceBalance`. Consumable ONLY when `isLastInstallment` is true —
   * owner directive 2026-08-16 (park-at-last-installment, not FIFO-next).
   */
  rescheduleAdvanceBalance?: Decimal.Value;
  /** Whether the installment being paid is the contract's LAST installment. Gates rescheduleAdvanceBalance consumption. */
  isLastInstallment?: boolean;
}

/**
 * Single source of truth for the wizard's "full" receipt amount ("เต็มงวด").
 *
 * The net cash the customer still owes for an installment =
 *   (base amountDue) + (late fee − waiver) − (already paid) − (advance consumed)
 *
 * CRITICAL: the late fee is ALWAYS part of "full". Pre-filling only the base
 * (amountDue) let a cashier confirm a payment that silently left the late fee
 * unpaid → the installment stuck at PARTIALLY_PAID with a phantom "ค้าง".
 */
/**
 * What the customer STILL owes on the installment, BEFORE any advance/park
 * deduction: `amountDue + (lateFee − waiver) − amountPaid`.
 *
 * This is the wizard's comparison base for CaseBadge / diff — the same
 * `remaining` the server orchestrator computes before classifying a payment.
 * Comparing cash against `amountDue + netLateFee` WITHOUT subtracting
 * `amountPaid` (the pre-2026-08-18 rule) told a cashier paying off a
 * partially-paid installment in full that they were จ่ายขาด by exactly the
 * already-paid amount, while the server would have recorded a full clear.
 */
export function computeRemainingObligation(
  input: Pick<NetReceiptDueInput, 'amountDue' | 'lateFee' | 'amountPaid' | 'waiver'>,
): Decimal {
  const lateFee = new Decimal(input.lateFee);
  // Waiver reduces cash owed but can never exceed the gross late fee.
  const waiver = Decimal.min(new Decimal(input.waiver ?? 0), lateFee);
  return new Decimal(input.amountDue)
    .plus(lateFee.minus(waiver))
    .minus(new Decimal(input.amountPaid));
}

export function computeNetReceiptDue(input: NetReceiptDueInput): Decimal {
  // Single formula for "still owed" — the wizard's tiles (here, net of advance)
  // and its CaseBadge (computeRemainingObligation directly) must never drift.
  const owed = computeRemainingObligation(input);

  const advance = new Decimal(input.advanceBalance ?? 0);
  const consumeAdvance = input.consumeAdvance ?? true;
  const consumed =
    consumeAdvance && advance.gt(0)
      ? Decimal.min(advance, Decimal.max(new Decimal(0), owed))
      : new Decimal(0);

  const owedAfterGeneric = Decimal.max(new Decimal(0), owed.minus(consumed));

  // Park bucket (พักงวดสุดท้าย) — generic advance is consumed FIRST; the park
  // bucket only covers whatever gap remains, and only on the last installment.
  const park = new Decimal(input.rescheduleAdvanceBalance ?? 0);
  const parkConsumed =
    input.isLastInstallment && consumeAdvance && park.gt(0)
      ? Decimal.min(park, owedAfterGeneric)
      : new Decimal(0);

  return Decimal.max(new Decimal(0), owedAfterGeneric.minus(parkConsumed)).toDecimalPlaces(2);
}
