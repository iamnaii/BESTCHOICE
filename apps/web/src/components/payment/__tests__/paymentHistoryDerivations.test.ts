import { describe, it, expect } from 'vitest';
import {
  computeCumulativePaid,
  computeFeeTotals,
  jesForReceipt,
  receiptLabelsForJes,
  caseForReceipt,
  type ReceiptAmountRow,
  type FeePaymentRow,
  type JeRef,
  type JeForLabel,
  type ReceiptForLabel,
  type CaseReceiptRow,
  type CasePaymentRow,
} from '../paymentHistoryDerivations';

const rec = (over: Partial<ReceiptAmountRow>): ReceiptAmountRow => ({
  isVoided: false,
  receiptType: 'INSTALLMENT',
  amount: '0',
  ...over,
});

const pay = (over: Partial<FeePaymentRow>): FeePaymentRow => ({
  status: 'PENDING',
  amountPaid: '0',
  lateFee: '0',
  waivedAmount: null,
  lateFeeWaived: false,
  ...over,
});

const je = (over: Partial<JeRef>): JeRef => ({
  id: 'je',
  paymentId: null,
  flow: null,
  originalEntryId: null,
  ...over,
});

describe('computeCumulativePaid', () => {
  it('sums non-voided, non-CREDIT_NOTE receipt amounts', () => {
    const receipts = [
      rec({ receiptType: 'INSTALLMENT', amount: '1500' }),
      rec({ receiptType: 'EARLY_PAYOFF', amount: '500' }),
    ];
    expect(computeCumulativePaid(receipts)).toBe(2000);
  });

  it('excludes voided receipts and CREDIT_NOTE rows (a CN carries the original positive amount)', () => {
    const receipts = [
      rec({ receiptType: 'INSTALLMENT', amount: '1500' }),
      rec({ receiptType: 'INSTALLMENT', amount: '1000', isVoided: true }), // voided original
      rec({ receiptType: 'CREDIT_NOTE', amount: '1000' }), // the void's CN row
    ];
    expect(computeCumulativePaid(receipts)).toBe(1500);
  });

  it('returns 0 when every receipt is either voided or a credit note', () => {
    const receipts = [
      rec({ receiptType: 'INSTALLMENT', amount: '1000', isVoided: true }),
      rec({ receiptType: 'CREDIT_NOTE', amount: '1000' }),
    ];
    expect(computeCumulativePaid(receipts)).toBe(0);
  });
});

describe('computeFeeTotals', () => {
  it('counts the fee once collection has started via amountPaid > 0 (even if status is OVERDUE)', () => {
    // Simulates the midnight cron flipping a base-touched PARTIALLY_PAID row back to
    // OVERDUE — the fee must NOT vanish because amountPaid > 0.
    const payments = [pay({ status: 'OVERDUE', amountPaid: '2000', lateFee: '100' })];
    expect(computeFeeTotals(payments)).toEqual({ totalLateFee: 100, totalWaived: 0 });
  });

  it('counts the fee for a PAID installment', () => {
    const payments = [pay({ status: 'PAID', amountPaid: '3671', lateFee: '77' })];
    expect(computeFeeTotals(payments).totalLateFee).toBe(77);
  });

  it('excludes pure accruals (amountPaid 0 and not PAID) so untouched overdue rows do not inflate the card', () => {
    const payments = [
      pay({ status: 'OVERDUE', amountPaid: '0', lateFee: '100' }), // untouched → excluded
      pay({ status: 'PAID', amountPaid: '1000', lateFee: '50' }), // included
    ];
    expect(computeFeeTotals(payments).totalLateFee).toBe(50);
  });

  it('prefers waivedAmount, falling back to full lateFee when lateFeeWaived is set', () => {
    const payments = [
      pay({ status: 'PAID', amountPaid: '1', lateFee: '100', waivedAmount: '40' }), // explicit partial waiver
      pay({
        status: 'PAID',
        amountPaid: '1',
        lateFee: '80',
        waivedAmount: null,
        lateFeeWaived: true,
      }), // full waive
    ];
    expect(computeFeeTotals(payments)).toEqual({ totalLateFee: 180, totalWaived: 120 });
  });
});

describe('jesForReceipt', () => {
  it('EARLY_PAYOFF receipt matches JEs by flow (paymentId is null on the JP4 receipt)', () => {
    const jes = [
      je({ id: 'a', flow: 'early-payoff' }),
      je({ id: 'b', flow: null, paymentId: 'p1' }),
    ];
    const out = jesForReceipt({ receiptType: 'EARLY_PAYOFF', paymentId: null }, jes);
    expect(out.map((j) => j.id)).toEqual(['a']);
  });

  it('normal receipt returns every JE sharing its paymentId (N partial receipts share one)', () => {
    const jes = [
      je({ id: 'a', paymentId: 'p1' }),
      je({ id: 'b', paymentId: 'p1' }),
      je({ id: 'c', paymentId: 'p2' }),
    ];
    const out = jesForReceipt({ receiptType: 'INSTALLMENT', paymentId: 'p1' }, jes);
    expect(out.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('CREDIT_NOTE row shows the REVERSAL mirrors (matched via originalEntryId), not the money-in originals', () => {
    const jes = [
      je({ id: 'orig', paymentId: 'p1' }), // the money-in original
      je({ id: 'rev', originalEntryId: 'orig', flow: 'receipt-void' }), // its mirror
    ];
    const out = jesForReceipt({ receiptType: 'CREDIT_NOTE', paymentId: 'p1' }, jes);
    expect(out.map((j) => j.id)).toEqual(['rev']);
  });

  it('CREDIT_NOTE falls back to the originals when no reversal mirror is present', () => {
    const jes = [je({ id: 'orig', paymentId: 'p1' })];
    const out = jesForReceipt({ receiptType: 'CREDIT_NOTE', paymentId: 'p1' }, jes);
    expect(out.map((j) => j.id)).toEqual(['orig']);
  });

  it('non-early-payoff receipt with a null paymentId returns nothing', () => {
    const jes = [je({ id: 'a', paymentId: 'p1' })];
    expect(jesForReceipt({ receiptType: 'INSTALLMENT', paymentId: null }, jes)).toEqual([]);
  });
});

describe('receiptLabelsForJes (คำสั่งเจ้าของ 2026-08-16 — ป้ายบอกว่า JE เป็นของใบเสร็จใบไหน)', () => {
  const jeL = (over: Partial<JeForLabel>): JeForLabel => ({
    id: 'je',
    entryNumber: 'JE-202608-00001',
    paymentId: null,
    tag: null,
    flow: null,
    originalEntryId: null,
    ...over,
  });
  const recL = (over: Partial<ReceiptForLabel>): ReceiptForLabel => ({
    receiptNumber: 'RT-202608-00001',
    receiptType: 'INSTALLMENT',
    paymentId: null,
    ...over,
  });

  it('งวดแบ่งชำระ 2 ใบ — JE แรก (มีค่าปรับ) จับคู่ใบเสร็จใบแรก ตามลำดับเลขที่', () => {
    // เคสจริงจาก screenshot: RT-00006 (1,771 + ค่าปรับ) → JE-00042, RT-00007 (2,000) → JE-00044
    const receipts = [
      recL({ receiptNumber: 'RT-202608-00007', paymentId: 'p1' }),
      recL({ receiptNumber: 'RT-202608-00006', paymentId: 'p1' }),
    ];
    const jes = [
      jeL({ id: 'j-fee', entryNumber: 'JE-202608-00042', paymentId: 'p1' }),
      jeL({ id: 'j-close', entryNumber: 'JE-202608-00044', paymentId: 'p1' }),
    ];
    const labels = receiptLabelsForJes(jes, receipts, 'p1');
    expect(labels.get('j-fee')).toEqual({
      receiptNumber: 'RT-202608-00006',
      seq: 1,
      total: 2,
    });
    expect(labels.get('j-close')).toEqual({
      receiptNumber: 'RT-202608-00007',
      seq: 2,
      total: 2,
    });
  });

  it('REVERSAL mirror และ receipt-void ถูกกรองออกจากการจับคู่', () => {
    const receipts = [
      recL({ receiptNumber: 'RT-1', paymentId: 'p1' }),
      recL({ receiptNumber: 'RT-2', paymentId: 'p1' }),
    ];
    const jes = [
      jeL({ id: 'j1', entryNumber: 'JE-1', paymentId: 'p1' }),
      jeL({ id: 'j-rev', entryNumber: 'JE-2', paymentId: 'p1', tag: 'REVERSAL' }),
      jeL({ id: 'j-void', entryNumber: 'JE-3', paymentId: 'p1', flow: 'receipt-void' }),
      jeL({ id: 'j-mirror', entryNumber: 'JE-4', paymentId: 'p1', originalEntryId: 'j1' }),
      jeL({ id: 'j2', entryNumber: 'JE-5', paymentId: 'p1' }),
    ];
    const labels = receiptLabelsForJes(jes, receipts, 'p1');
    expect(labels.size).toBe(2);
    expect(labels.get('j1')?.receiptNumber).toBe('RT-1');
    expect(labels.get('j2')?.receiptNumber).toBe('RT-2');
    expect(labels.has('j-rev')).toBe(false);
    expect(labels.has('j-mirror')).toBe(false);
  });

  it('CREDIT_NOTE ไม่นับเป็นใบเก็บเงิน', () => {
    const receipts = [
      recL({ receiptNumber: 'RT-1', paymentId: 'p1' }),
      recL({ receiptNumber: 'RT-9', paymentId: 'p1', receiptType: 'CREDIT_NOTE' }),
    ];
    const jes = [jeL({ id: 'j1', entryNumber: 'JE-1', paymentId: 'p1' })];
    const labels = receiptLabelsForJes(jes, receipts, 'p1');
    expect(labels.get('j1')?.total).toBe(1);
  });

  it('legacy — จำนวน JE ไม่เท่าจำนวนใบเสร็จ → ไม่ติดป้าย (map ว่าง)', () => {
    const receipts = [
      recL({ receiptNumber: 'RT-1', paymentId: 'p1' }),
      recL({ receiptNumber: 'RT-2', paymentId: 'p1' }),
    ];
    const jes = [jeL({ id: 'j-cumulative', entryNumber: 'JE-1', paymentId: 'p1' })];
    expect(receiptLabelsForJes(jes, receipts, 'p1').size).toBe(0);
  });

  it('paymentId null → map ว่าง', () => {
    expect(receiptLabelsForJes([], [], null).size).toBe(0);
  });
});

/* ─── caseForReceipt ───────────────────────────────────
 * The CASE column used to compare a receipt against `Payment.amountDue`, which
 * EXCLUDES the late fee by schema. Every receipt that correctly collected งวด +
 * ค่าปรับ therefore read "OVER" (prod contract TEST-20260809-004: งวด 1 paid
 * exactly 3,671 + 100 and was labelled OVER). The obligation is งวด + NET late
 * fee (gross − waived); only a receipt above THAT is genuinely an overpay.
 */
const caseRcpt = (over: Partial<CaseReceiptRow>): CaseReceiptRow => ({
  receiptType: 'INSTALLMENT',
  amount: '0',
  paymentStatus: 'PAID',
  ...over,
});

const casePay = (over: Partial<CasePaymentRow>): CasePaymentRow => ({
  amountDue: '3671',
  lateFee: '0',
  lateFeeWaived: false,
  waivedAmount: null,
  ...over,
});

describe('caseForReceipt', () => {
  it('paying งวด + ค่าปรับ exactly is NORMAL, not OVER', () => {
    const r = caseRcpt({ amount: '3771' });
    const p = casePay({ lateFee: '100' });
    expect(caseForReceipt(r, p).label).toBe('NORMAL');
  });

  it('paying above งวด + ค่าปรับ is OVER', () => {
    const r = caseRcpt({ amount: '3800' });
    const p = casePay({ lateFee: '100' });
    expect(caseForReceipt(r, p).label).toBe('OVER');
  });

  it('cash short of the obligation (credit covered the rest) is NORMAL, not OVER', () => {
    const r = caseRcpt({ amount: '3742' });
    const p = casePay({ lateFee: '100' });
    expect(caseForReceipt(r, p).label).toBe('NORMAL');
  });

  it('a waived late fee lowers the obligation back to the installment', () => {
    const r = caseRcpt({ amount: '3700' });
    const p = casePay({ lateFee: '100', lateFeeWaived: true, waivedAmount: '100' });
    expect(caseForReceipt(r, p).label).toBe('OVER');
  });

  it('a partially waived late fee uses the NET fee as the threshold', () => {
    // งวด 3,671 + net fee (100 − 40 = 60) = 3,731 is the exact obligation.
    const p = casePay({ lateFee: '100', waivedAmount: '40' });
    expect(caseForReceipt(caseRcpt({ amount: '3731' }), p).label).toBe('NORMAL');
    expect(caseForReceipt(caseRcpt({ amount: '3732' }), p).label).toBe('OVER');
  });

  it('PARTIAL wins over the amount comparison', () => {
    const r = caseRcpt({ amount: '2000', paymentStatus: 'PARTIAL' });
    expect(caseForReceipt(r, casePay({ lateFee: '100' })).label).toBe('PARTIAL');
  });

  it('document receipt types keep their own labels', () => {
    expect(caseForReceipt(caseRcpt({ receiptType: 'CREDIT_NOTE' }), undefined).label).toBe('ใบลดหนี้');
    expect(caseForReceipt(caseRcpt({ receiptType: 'RESCHEDULE_FEE' }), undefined).label).toBe('ปรับดิว');
    expect(caseForReceipt(caseRcpt({ receiptType: 'DOWN_PAYMENT' }), undefined).label).toBe('ดาวน์');
    expect(caseForReceipt(caseRcpt({ receiptType: 'EARLY_PAYOFF' }), undefined).label).toBe('ปิดยอด');
  });

  it('falls back to NORMAL when the receipt has no linked installment', () => {
    expect(caseForReceipt(caseRcpt({ amount: '9999' }), undefined).label).toBe('NORMAL');
  });
});
