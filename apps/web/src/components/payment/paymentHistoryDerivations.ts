/**
 * Pure derivations behind PaymentHistorySheet's summary cards + JE panel.
 *
 * Extracted (PR #1314 gap-fill) so the running-total, fee-total, and receipt→JE
 * selection rules can be unit-tested without rendering the sheet. The component
 * keeps the react-query wiring; these functions own the arithmetic + selection.
 * Logic is byte-identical to the previous inline implementation.
 */

export interface ReceiptAmountRow {
  isVoided: boolean;
  receiptType: string;
  amount: string;
}

export interface FeePaymentRow {
  status: string;
  amountPaid: string;
  lateFee: string;
  waivedAmount: string | null;
  lateFeeWaived: boolean;
}

export interface ReceiptRef {
  receiptType: string;
  paymentId: string | null;
}

export interface JeRef {
  id: string;
  paymentId: string | null;
  flow: string | null;
  originalEntryId: string | null;
}

/**
 * Money collected = Σ non-voided receipt amounts EXCLUDING credit notes. A CN row
 * carries the ORIGINAL's positive amount, so counting it would keep a voided
 * payment in the total.
 */
export function computeCumulativePaid(receipts: ReceiptAmountRow[]): number {
  return receipts
    .filter((r) => !r.isVoided && r.receiptType !== 'CREDIT_NOTE')
    .reduce((s, r) => s + Number(r.amount), 0);
}

/**
 * Late-fee / waiver totals for the summary card. Counted on installments where
 * collection has STARTED (status PAID or amountPaid > 0) — amountPaid-based rather
 * than status so the fee doesn't vanish when the midnight cron flips a
 * PARTIALLY_PAID overdue row back to OVERDUE; pure accruals on untouched overdue
 * rows stay excluded.
 */
export function computeFeeTotals(payments: FeePaymentRow[]): {
  totalLateFee: number;
  totalWaived: number;
} {
  const feePayments = payments.filter((p) => p.status === 'PAID' || Number(p.amountPaid) > 0);
  const totalLateFee = feePayments.reduce((s, p) => s + Number(p.lateFee), 0);
  const totalWaived = feePayments.reduce(
    (s, p) =>
      s + (p.waivedAmount != null ? Number(p.waivedAmount) : p.lateFeeWaived ? Number(p.lateFee) : 0),
    0,
  );
  return { totalLateFee, totalWaived };
}

/**
 * The posted JEs shown under a receipt row.
 *   - EARLY_PAYOFF receipt (paymentId null) → matched by flow 'early-payoff'.
 *   - CREDIT_NOTE row IS the void event → show the REVERSAL mirrors (pointing back
 *     at this payment's originals), falling back to the originals if no mirror exists.
 *   - otherwise → every JE sharing the receipt's paymentId (N partial receipts share one).
 * Generic so the caller keeps its richer JE type on the way out.
 */
export function jesForReceipt<J extends JeRef>(r: ReceiptRef, journalEntries: J[]): J[] {
  if (r.receiptType === 'EARLY_PAYOFF')
    return journalEntries.filter((j) => j.flow === 'early-payoff');
  if (!r.paymentId) return [];
  const paymentJes = journalEntries.filter((j) => j.paymentId === r.paymentId);
  if (r.receiptType === 'CREDIT_NOTE') {
    const originalIds = new Set(paymentJes.map((j) => j.id));
    const reversalJes = journalEntries.filter(
      (j) => j.originalEntryId !== null && originalIds.has(j.originalEntryId),
    );
    return reversalJes.length ? reversalJes : paymentJes;
  }
  return paymentJes;
}
