import { Decimal } from '@prisma/client/runtime/library';
import {
  INPUT_VAT_REASON,
  invoiceAgeMonths,
  receivingTaxInvoice,
  resolveInputVatEligibility,
} from '../input-vat/input-vat-eligibility';
import { canSeeInputVat } from '../input-vat/input-vat-visibility.util';

/** ก้อน 5 — เครื่อง "เคลมได้" = receivedVat > 0 และใบรับของมีใบกำกับภาษี (ตอนรับ หรือบันทึกภายหลัง) · Q5 สิทธิ์เห็นยอด · Q6 เหตุผล */
const gr = (over: Partial<Parameters<typeof receivingTaxInvoice>[0]> = {}) => ({
  id: 'gr-1',
  grNumber: 'GR-20261005-001',
  supplierDocType: 'DELIVERY_NOTE' as const,
  supplierDocNumber: 'DN-1',
  supplierDocDate: new Date('2026-09-30T17:00:00Z'),
  taxInvoiceNumber: null,
  taxInvoiceDate: null,
  ...over,
});
const item = (receivedVat: string | null, receiving = gr()) => ({ receivedVat: receivedVat === null ? null : new Decimal(receivedVat), receiving });

describe('receivingTaxInvoice', () => {
  it('รับด้วย TAX_INVOICE → ใบกำกับ = เอกสารเดิม (source RECEIVING)', () => {
    expect(receivingTaxInvoice(gr({ supplierDocType: 'TAX_INVOICE', supplierDocNumber: 'IV-9' }))).toEqual({
      number: 'IV-9', date: new Date('2026-09-30T17:00:00Z'), source: 'RECEIVING',
    });
  });
  it('รับด้วยใบส่งของแล้วบันทึกใบกำกับทีหลัง → source LATER', () => {
    expect(receivingTaxInvoice(gr({ taxInvoiceNumber: 'IV-10', taxInvoiceDate: new Date('2026-10-04T17:00:00Z') }))).toEqual({
      number: 'IV-10', date: new Date('2026-10-04T17:00:00Z'), source: 'LATER',
    });
  });
  it('ไม่มีทั้งสองทาง → null', () => {
    expect(receivingTaxInvoice(gr())).toBeNull();
    expect(receivingTaxInvoice(gr({ supplierDocType: 'CASH_BILL' }))).toBeNull();
  });
});

describe('invoiceAgeMonths (ปฏิทินไทย)', () => {
  it('05/10/2569 เทียบใบกำกับ 30/09/2569 = 0 เดือน · 05/04/2569 = 6 เดือน · 06/04/2569 = 5 เดือน (ยังไม่ครบวัน)', () => {
    const asOf = new Date('2026-10-05T03:00:00Z');
    expect(invoiceAgeMonths(new Date('2026-09-29T17:00:00Z'), asOf)).toBe(0);
    expect(invoiceAgeMonths(new Date('2026-04-04T17:00:00Z'), asOf)).toBe(6);
    expect(invoiceAgeMonths(new Date('2026-04-05T17:00:00Z'), asOf)).toBe(5);
  });
  it('ใบกำกับลงวันในอนาคต → 0 (ไม่ติดลบ)', () => {
    expect(invoiceAgeMonths(new Date('2026-12-01T00:00:00Z'), new Date('2026-10-05T00:00:00Z'))).toBe(0);
  });
});

describe('resolveInputVatEligibility', () => {
  it('ไม่มีใบรับของ (ยอดยกมา/เพิ่มด้วยมือ) → NOT_ELIGIBLE', () => {
    expect(resolveInputVatEligibility({ checklistResults: null, receivingItem: null })).toEqual({
      kind: 'NOT_ELIGIBLE', reason: INPUT_VAT_REASON.NO_RECEIVING,
    });
  });
  it('มือสองรับซื้อ/รับเทิร์น (checklistResults.source = trade-in) → NOT_ELIGIBLE แม้มีใบรับของ', () => {
    expect(resolveInputVatEligibility({ checklistResults: { source: 'trade-in', tradeInId: 't1' }, receivingItem: item('686') }))
      .toEqual({ kind: 'NOT_ELIGIBLE', reason: INPUT_VAT_REASON.TRADE_IN });
  });
  it('receivedVat null (รับก่อนก้อน 5) → NOT_ELIGIBLE เหตุผล "รับก่อนระบบ…"', () => {
    expect(resolveInputVatEligibility({ checklistResults: null, receivingItem: item(null) }))
      .toEqual({ kind: 'NOT_ELIGIBLE', reason: INPUT_VAT_REASON.BEFORE_FEATURE });
  });
  it('receivedVat 0 (ผู้จัดจำหน่ายไม่จด VAT / บิลเงินสด) → NOT_ELIGIBLE', () => {
    expect(resolveInputVatEligibility({ checklistResults: null, receivingItem: item('0', gr({ supplierDocType: 'CASH_BILL' })) }))
      .toEqual({ kind: 'NOT_ELIGIBLE', reason: INPUT_VAT_REASON.NO_VAT });
  });
  it('receivedVat 686 + TAX_INVOICE → ELIGIBLE พร้อมเลข/วันที่ใบกำกับ', () => {
    const out = resolveInputVatEligibility({
      checklistResults: null,
      receivingItem: item('686', gr({ supplierDocType: 'TAX_INVOICE', supplierDocNumber: 'IV-9' })),
    });
    expect(out.kind).toBe('ELIGIBLE');
    if (out.kind !== 'ELIGIBLE') throw new Error('unreachable');
    expect(out.amount.toFixed(2)).toBe('686.00');
    expect(out.receivingId).toBe('gr-1');
    expect(out.grNumber).toBe('GR-20261005-001');
    expect(out.taxInvoice).toEqual({ number: 'IV-9', date: new Date('2026-09-30T17:00:00Z'), source: 'RECEIVING' });
  });
  it('receivedVat 686 + ใบส่งของ (ยังไม่มีใบกำกับ) → PENDING_INVOICE', () => {
    const out = resolveInputVatEligibility({ checklistResults: null, receivingItem: item('686') });
    expect(out).toMatchObject({ kind: 'PENDING_INVOICE', receivingId: 'gr-1', grNumber: 'GR-20261005-001' });
    if (out.kind !== 'PENDING_INVOICE') throw new Error('unreachable');
    expect(out.amount.toFixed(2)).toBe('686.00');
  });
});

describe('canSeeInputVat (Q5)', () => {
  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('%s เห็น', (r) => expect(canSeeInputVat(r)).toBe(true));
  it.each(['BRANCH_MANAGER', 'SALES', undefined, null, 'UNKNOWN'])('%s ไม่เห็น', (r) => expect(canSeeInputVat(r as never)).toBe(false));
});
