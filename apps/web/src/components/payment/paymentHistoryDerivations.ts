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
      s +
      (p.waivedAmount != null ? Number(p.waivedAmount) : p.lateFeeWaived ? Number(p.lateFee) : 0),
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

export interface ReceiptForLabel {
  receiptNumber: string;
  receiptType: string;
  paymentId: string | null;
}

export interface JeForLabel {
  id: string;
  entryNumber: string;
  paymentId: string | null;
  tag: string | null;
  flow: string | null;
  originalEntryId: string | null;
}

export interface JeReceiptLabel {
  receiptNumber: string;
  /** ลำดับใบในงวด (1-based) */
  seq: number;
  /** จำนวนใบทั้งหมดของงวด */
  total: number;
}

/**
 * จับคู่ forward JE ของ payment เข้ากับใบเสร็จของมัน — ใช้ติดป้ายใน dialog JE
 * ว่าแต่ละใบ JE เป็นของใบเสร็จใบไหน (กรณีแบ่งชำระ N ใบต่องวด ทุกใบแชร์
 * paymentId เดียวกัน จึงเคยดูไม่ออกว่าค่าปรับลงใบไหน — คำสั่งเจ้าของ 2026-08-16).
 *
 * กลไก: JE metadata ไม่มี receiptId — จับคู่ตามลำดับเวลาแทน. ใบเสร็จแต่ละใบ
 * โพสต์ forward JE หนึ่งใบ ณ ตอนออกใบ ดังนั้นเรียง receiptNumber (รันตามลำดับ
 * ออกใบ) คู่กับ entryNumber (รันตามลำดับโพสต์) แบบ index ต่อ index จึงตรงกัน.
 * REVERSAL mirrors (void) และแถว CREDIT_NOTE ไม่ใช่การเก็บเงิน — ถูกกรองออก.
 * กรณี legacy (JE สะสมใบเดียวคลุมหลายใบเสร็จ — ก่อน PR-843) จำนวนไม่เท่ากัน →
 * คืน map ว่าง (ไม่เดา ไม่ติดป้ายผิด).
 */
export function receiptLabelsForJes(
  journalEntries: JeForLabel[],
  receipts: ReceiptForLabel[],
  paymentId: string | null,
): Map<string, JeReceiptLabel> {
  const labels = new Map<string, JeReceiptLabel>();
  if (!paymentId) return labels;

  const paymentReceipts = receipts
    .filter((r) => r.paymentId === paymentId && r.receiptType !== 'CREDIT_NOTE')
    .sort((a, b) => a.receiptNumber.localeCompare(b.receiptNumber));

  const forwardJes = journalEntries
    .filter(
      (j) =>
        j.paymentId === paymentId &&
        j.originalEntryId === null &&
        j.tag !== 'REVERSAL' &&
        j.flow !== 'receipt-void',
    )
    .sort((a, b) => a.entryNumber.localeCompare(b.entryNumber));

  if (paymentReceipts.length === 0 || paymentReceipts.length !== forwardJes.length) return labels;

  forwardJes.forEach((je, i) => {
    labels.set(je.id, {
      receiptNumber: paymentReceipts[i].receiptNumber,
      seq: i + 1,
      total: paymentReceipts.length,
    });
  });
  return labels;
}

export interface CaseReceiptRow {
  receiptType: string;
  amount: string;
  paymentStatus: string | null;
}

export interface CasePaymentRow {
  /** งวดล้วน — EXCLUDES the late fee by schema. */
  amountDue: string;
  lateFee: string;
  lateFeeWaived: boolean;
  waivedAmount: string | null;
}

export type CaseTone = 'warning' | 'info' | 'primary' | 'success';

/**
 * The derived CASE label for one receipt row (no persisted `case` field).
 *
 * OVER means the customer handed over MORE than this installment obliged them
 * to. The obligation is `amountDue + NET late fee` (gross − waived) — the same
 * figure `PaymentReceiptOrchestrator` calls `remaining` when it decides whether
 * an overage becomes a 21-1103 advance credit. Comparing against `amountDue`
 * alone (the pre-2026-08-18 rule) labelled every correctly-collected fee as an
 * overpay, and hid the genuine ones: on prod contract TEST-20260809-004, งวด 1
 * paid exactly 3,671 + 100 read "OVER" while งวด 3 — which was 29฿ SHORT in
 * cash and closed by an advance credit — read "OVER" too.
 */
export function caseForReceipt(
  r: CaseReceiptRow,
  p: CasePaymentRow | undefined,
): { label: string; tone: CaseTone } {
  if (r.receiptType === 'EARLY_PAYOFF') return { label: 'ปิดยอด', tone: 'warning' };
  if (r.receiptType === 'DOWN_PAYMENT') return { label: 'ดาวน์', tone: 'warning' };
  if (r.receiptType === 'CREDIT_NOTE') return { label: 'ใบลดหนี้', tone: 'warning' };
  if (r.receiptType === 'RESCHEDULE_FEE') return { label: 'ปรับดิว', tone: 'warning' };
  if (r.paymentStatus === 'PARTIAL') return { label: 'PARTIAL', tone: 'info' };
  if (p) {
    // Same waiver convention as computeFeeTotals: an explicit waivedAmount wins,
    // otherwise lateFeeWaived means the whole gross fee was waived.
    const waived =
      p.waivedAmount != null ? Number(p.waivedAmount) : p.lateFeeWaived ? Number(p.lateFee) : 0;
    const obligation = Number(p.amountDue) + (Number(p.lateFee) - waived);
    if (Number(r.amount) > obligation) return { label: 'OVER', tone: 'primary' };
  }
  return { label: 'NORMAL', tone: 'success' };
}
