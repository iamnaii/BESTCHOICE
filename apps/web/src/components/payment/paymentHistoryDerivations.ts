/**
 * Pure derivations behind PaymentHistorySheet's summary cards + JE panel.
 *
 * Extracted (PR #1314 gap-fill) so the running-total, fee-total, and receipt→JE
 * selection rules can be unit-tested without rendering the sheet. The component
 * keeps the react-query wiring; these functions own the arithmetic + selection.
 */

export interface ReceiptAmountRow {
  isVoided: boolean;
  receiptType: string;
  amount: string;
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

export interface PaidPaymentRow {
  id: string;
  installmentNo: number;
  status: string;
  amountPaid: string;
  paidDate: string | null;
  dueDate: string;
  paymentMethod: string | null;
}

export interface ReceiptLinkRow {
  paymentId: string | null;
}

/**
 * แถวประวัติของงวดที่ถูกบันทึกเป็น PAID โดยไม่มีใบเสร็จในระบบ — สัญญาที่ยกยอดมาจากระบบเก่า
 * และสัญญาทดสอบที่ seed งวดจ่ายแล้วไว้ล่วงหน้า (seed-test-contracts.cli: "data-only, no JE, no receipt").
 * หน้าประวัติเรียงจากใบเสร็จ งวดพวกนี้จึงไม่เคยปรากฏทั้งที่การ์ด "งวดที่ชำระแล้ว" นับรวม
 * (เจ้าของ 2026-09-24: "ประวัติชำระอื่นๆ หายไป"). รูปร่างเดียวกับแถวใบเสร็จ + `noReceipt: true`.
 */
export interface NoReceiptHistoryRow {
  id: string;
  receiptNumber: string;
  receiptType: 'INSTALLMENT';
  amount: string;
  installmentNo: number;
  paymentId: string;
  paymentMethod: string | null;
  paymentStatus: 'PAID';
  isVoided: false;
  paidDate: string;
  issuedByName: null;
  paymentCase: 'NO_RECEIPT';
  noReceipt: true;
}

export function paidRowsWithoutReceipt(
  payments: PaidPaymentRow[],
  receipts: ReceiptLinkRow[],
): NoReceiptHistoryRow[] {
  const withReceipt = new Set(receipts.map((r) => r.paymentId).filter(Boolean));
  return payments
    .filter((p) => p.status === 'PAID' && !withReceipt.has(p.id))
    .map((p) => ({
      id: `no-receipt:${p.id}`,
      receiptNumber: '',
      receiptType: 'INSTALLMENT' as const,
      amount: p.amountPaid,
      installmentNo: p.installmentNo,
      paymentId: p.id,
      paymentMethod: p.paymentMethod,
      paymentStatus: 'PAID' as const,
      isVoided: false as const,
      paidDate: p.paidDate ?? p.dueDate,
      issuedByName: null,
      paymentCase: 'NO_RECEIPT' as const,
      noReceipt: true as const,
    }));
}

/**
 * Sum the same per-receipt fee values shown in the table. Rescheduling resets
 * Payment.lateFee, so that mutable amount cannot represent past collections.
 * computeReceiptFeeDisplay already excludes voids and handles legacy attribution.
 */
export function computeFeeTotals(fees: Iterable<{ lateFee: number; waived: number }>): {
  totalLateFee: number;
  totalWaived: number;
} {
  let totalLateFee = 0;
  let totalWaived = 0;
  for (const fee of fees) {
    totalLateFee += fee.lateFee;
    totalWaived += fee.waived;
  }
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
  /** Historical action attributed by the API to this receipt. */
  paymentCase?: string | null;
}

export interface ReceiptInstallmentAllocation {
  installmentNo: number;
  amount: string;
  kind: 'INSTALLMENT' | 'RESCHEDULE_ADVANCE';
}

export interface CasePaymentRow {
  /** งวดล้วน — EXCLUDES the late fee by schema. */
  amountDue: string;
  lateFee: string;
  lateFeeWaived: boolean;
  waivedAmount: string | null;
}

export type CaseTone = 'warning' | 'info' | 'primary' | 'success';

const PAYMENT_CASE_LABELS: Record<string, { label: string; tone: CaseTone }> = {
  NORMAL: { label: 'ตรงดิว', tone: 'success' },
  PARTIAL: { label: 'แบ่งชำระ', tone: 'info' },
  RESCHEDULE: { label: 'ปรับดิว', tone: 'warning' },
  EARLY_PAYOFF: { label: 'ปิดยอด', tone: 'warning' },
  REPOSSESSION: { label: 'คืนเครื่อง', tone: 'warning' },
  OVERPAY_ADVANCE: { label: 'ชำระล่วงหน้า', tone: 'primary' },
  OVERPAY: { label: 'ชำระเกิน', tone: 'primary' },
  UNDERPAY: { label: 'ชำระขาด', tone: 'warning' },
  /** งวด PAID ที่ไม่มีใบเสร็จ — ยกยอดมา/ทดสอบ (paidRowsWithoutReceipt) */
  NO_RECEIPT: { label: 'ชำระแล้ว (ยกมา)', tone: 'info' },
};

/**
 * Prefer the receipt's historical action: a reschedule receipt can collect both
 * the current installment and an advance for the last installment. Its total
 * alone cannot distinguish rescheduling from an ordinary overpayment.
 * Legacy responses fall back to document type, receipt status and net obligation.
 */
export function caseForReceipt(
  r: CaseReceiptRow,
  p: CasePaymentRow | undefined,
): { label: string; tone: CaseTone } {
  if (r.paymentCase && Object.prototype.hasOwnProperty.call(PAYMENT_CASE_LABELS, r.paymentCase))
    return PAYMENT_CASE_LABELS[r.paymentCase];
  if (r.receiptType === 'EARLY_PAYOFF') return { label: 'ปิดยอด', tone: 'warning' };
  if (r.receiptType === 'DOWN_PAYMENT') return { label: 'ดาวน์', tone: 'warning' };
  if (r.receiptType === 'CREDIT_NOTE') return { label: 'ใบลดหนี้', tone: 'warning' };
  if (r.receiptType === 'RESCHEDULE_FEE') return { label: 'ปรับดิว', tone: 'warning' };
  if (r.paymentStatus === 'PARTIAL') return { label: 'แบ่งชำระ', tone: 'info' };
  // Explicit null means the API could not establish this receipt's history.
  // Undefined alone keeps compatibility with responses from an older API.
  if (r.paymentCase === null) return { label: 'ไม่ระบุ', tone: 'info' };
  if (p) {
    // An explicit waivedAmount wins,
    // otherwise lateFeeWaived means the whole gross fee was waived.
    const waived =
      p.waivedAmount != null ? Number(p.waivedAmount) : p.lateFeeWaived ? Number(p.lateFee) : 0;
    const obligation = Number(p.amountDue) + (Number(p.lateFee) - waived);
    if (Number(r.amount) > obligation) return { label: 'ชำระเกิน', tone: 'primary' };
  }
  return { label: 'ตรงดิว', tone: 'success' };
}
