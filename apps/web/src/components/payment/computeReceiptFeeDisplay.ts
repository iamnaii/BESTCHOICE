/**
 * Attribute an installment's late fee / waiver to its FIRST receipt only.
 *
 * When an installment is split across several partial receipts, the late fee is
 * a single per-installment charge — showing the installment-level `lateFee` on
 * EVERY receipt row made it look charged N times ("ใบที่ 2 มีค่าปรับซ้ำ").
 *
 * Owner decision (display convention, not ledger): show the full late fee on the
 * FIRST receipt of the installment and 0 on the rest. "First" = earliest by
 * paidDate, tie-broken by the sequential receiptNumber. Voided receipts and
 * non-payment receipts (credit note / early payoff / down payment) never carry
 * the fee.
 */
export interface ReceiptFeeRow {
  id: string;
  receiptNumber: string;
  receiptType: string;
  paymentId: string | null;
  paidDate: string;
  isVoided: boolean;
}

export interface FeeInfo {
  lateFee: number;
  waived: number;
}

const EXCLUDED_TYPES = new Set(['CREDIT_NOTE', 'EARLY_PAYOFF', 'DOWN_PAYMENT']);

export function computeReceiptFeeDisplay(
  receipts: ReceiptFeeRow[],
  feeByPaymentId: Map<string, FeeInfo>,
): Map<string, FeeInfo> {
  const result = new Map<string, FeeInfo>();
  // Default every receipt to no fee.
  for (const r of receipts) result.set(r.id, { lateFee: 0, waived: 0 });

  // Group fee-eligible receipts by installment (paymentId).
  const byPayment = new Map<string, ReceiptFeeRow[]>();
  for (const r of receipts) {
    if (!r.paymentId || r.isVoided || EXCLUDED_TYPES.has(r.receiptType)) continue;
    const list = byPayment.get(r.paymentId);
    if (list) list.push(r);
    else byPayment.set(r.paymentId, [r]);
  }

  for (const [paymentId, rows] of byPayment) {
    const fee = feeByPaymentId.get(paymentId);
    if (!fee || (fee.lateFee <= 0 && fee.waived <= 0)) continue;
    const first = [...rows].sort(
      (a, b) =>
        new Date(a.paidDate).getTime() - new Date(b.paidDate).getTime() ||
        a.receiptNumber.localeCompare(b.receiptNumber),
    )[0];
    result.set(first.id, { lateFee: fee.lateFee, waived: fee.waived });
  }

  return result;
}
