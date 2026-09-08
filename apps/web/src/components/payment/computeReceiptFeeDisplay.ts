/**
 * Use the fee and waiver booked on each receipt's own journal entry.
 * Legacy first-receipt allocation is only a fallback when no receipt in the
 * installment has authoritative fee history. Mixed unknown rows stay unknown.
 */
export interface ReceiptFeeRow {
  id: string;
  receiptNumber: string;
  receiptType: string;
  paymentId: string | null;
  paidDate: string;
  isVoided: boolean;
  lateFeeCollected?: string | null;
  lateFeeWaivedThisReceipt?: string | null;
  hasReceiptFeeHistory?: boolean;
}

export interface FeeInfo {
  lateFee: number;
  waived: number;
  /** Cannot safely attribute a fee to this historical receipt. */
  unavailable?: boolean;
}

// RESCHEDULE_FEE: ปรับดิว collect receipt — carries its own fee/late-fee breakdown
// in the collect JE; must not absorb the installment-level lateFee display.
const EXCLUDED_TYPES = new Set(['CREDIT_NOTE', 'EARLY_PAYOFF', 'DOWN_PAYMENT', 'RESCHEDULE_FEE']);

export function computeReceiptFeeDisplay(
  receipts: ReceiptFeeRow[],
  feeByPaymentId: Map<string, FeeInfo>,
): Map<string, FeeInfo> {
  const result = new Map<string, FeeInfo>();
  for (const r of receipts) {
    result.set(r.id, { lateFee: 0, waived: 0 });
    // A reschedule collect has its own fee; never borrow the installment's fee.
    if (r.receiptType === 'RESCHEDULE_FEE' && !r.isVoided) {
      if (r.lateFeeCollected != null && r.lateFeeWaivedThisReceipt != null) {
        const waived = Number(r.lateFeeWaivedThisReceipt);
        result.set(r.id, { lateFee: Number(r.lateFeeCollected) + waived, waived });
      } else {
        result.set(r.id, { lateFee: 0, waived: 0, unavailable: true });
      }
    }
  }

  // Group fee-eligible receipts by installment (paymentId).
  const byPayment = new Map<string, ReceiptFeeRow[]>();
  for (const r of receipts) {
    if (!r.paymentId || r.isVoided || EXCLUDED_TYPES.has(r.receiptType)) continue;
    const list = byPayment.get(r.paymentId);
    if (list) list.push(r);
    else byPayment.set(r.paymentId, [r]);
  }

  for (const [paymentId, rows] of byPayment) {
    const hasExactFee = (row: ReceiptFeeRow) =>
      row.lateFeeCollected != null && row.lateFeeWaivedThisReceipt != null;
    if (rows.some((row) => hasExactFee(row) || row.hasReceiptFeeHistory)) {
      for (const row of rows) {
        if (hasExactFee(row)) {
          const waived = Number(row.lateFeeWaivedThisReceipt);
          result.set(row.id, { lateFee: Number(row.lateFeeCollected) + waived, waived });
        } else {
          result.set(row.id, { lateFee: 0, waived: 0, unavailable: true });
        }
      }
      continue;
    }
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
