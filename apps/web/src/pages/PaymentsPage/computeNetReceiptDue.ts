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
export function computeNetReceiptDue(input: NetReceiptDueInput): Decimal {
  const amountDue = new Decimal(input.amountDue);
  const lateFee = new Decimal(input.lateFee);
  const amountPaid = new Decimal(input.amountPaid);

  // Waiver reduces cash owed but can never exceed the gross late fee.
  const waiver = Decimal.min(new Decimal(input.waiver ?? 0), lateFee);
  const netLateFee = lateFee.minus(waiver);

  const owed = amountDue.plus(netLateFee).minus(amountPaid);

  const advance = new Decimal(input.advanceBalance ?? 0);
  const consumed =
    (input.consumeAdvance ?? true) && advance.gt(0)
      ? Decimal.min(advance, Decimal.max(new Decimal(0), owed))
      : new Decimal(0);

  return Decimal.max(new Decimal(0), owed.minus(consumed)).toDecimalPlaces(2);
}
