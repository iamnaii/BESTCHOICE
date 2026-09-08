import Decimal from 'decimal.js';

/** Keep the editable fee for this receipt separate from the cumulative obligation. */
export function computeReceiptLateFee(
  grossLateFee: Decimal.Value,
  lateFeePaid: Decimal.Value = 0,
  receiptFee?: Decimal.Value,
) {
  const paid = Decimal.max(new Decimal(lateFeePaid), 0);
  const initialRemaining = Decimal.max(new Decimal(grossLateFee).minus(paid), 0);
  const remaining = receiptFee === undefined ? initialRemaining : new Decimal(receiptFee || 0);
  return {
    paid,
    initialRemaining,
    remaining,
    gross: paid.plus(remaining),
    additional: Decimal.max(remaining.minus(initialRemaining), 0),
    reduced: remaining.lt(initialRemaining),
  };
}
