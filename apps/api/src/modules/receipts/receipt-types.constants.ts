/**
 * Receipt types that represent actual installment money (ค่างวด) — the single
 * source of truth for every "receipts of this installment" query.
 *
 * 'INSTALLMENT' = current writer; 'PAYMENT' = legacy rows predating the
 * receiptType split (column default). Everything else sharing a
 * paymentId/installmentNo (CREDIT_NOTE reversals, RESCHEDULE_FEE collects,
 * EARLY_PAYOFF, DOWN_PAYMENT) is a different document class and must not be
 * counted into partial sequences, cumulative amounts, or first-receipt
 * fee-display decisions. Mirrors EXCLUDED_TYPES in the web's
 * computeReceiptFeeDisplay.ts (inverse formulation).
 */
export const INSTALLMENT_MONEY_RECEIPT_TYPES = ['INSTALLMENT', 'PAYMENT'] as const;
