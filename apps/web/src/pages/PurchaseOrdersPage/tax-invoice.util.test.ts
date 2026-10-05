import { describe, expect, it } from 'vitest';
import { buildTaxInvoiceFormData, taxInvoiceAction, taxInvoiceBadge, taxInvoiceResultMessage } from './tax-invoice.util';
import type { GoodsReceivingRecord } from './types';

const gr = (over: Partial<GoodsReceivingRecord> = {}): GoodsReceivingRecord => ({
  id: 'gr-1', grNumber: 'GR-1', createdAt: '2026-10-05T03:00:00Z', notes: null, supplierDocType: 'DELIVERY_NOTE', supplierDocNumber: 'DN-1', supplierDocDate: '2026-10-04T17:00:00Z',
  receivedBy: { id: 'u1', name: 'ก' }, items: [], taxInvoice: null, ...over,
});

describe('taxInvoiceBadge', () => {
  it('TAX_INVOICE หรือมี taxInvoice → มีใบกำกับภาษี · จด VAT แต่ยังไม่มี → รอใบกำกับภาษี · ไม่จด VAT → ไม่มี VAT', () => {
    expect(taxInvoiceBadge(gr({ supplierDocType: 'TAX_INVOICE' }), true)).toEqual({ text: 'มีใบกำกับภาษี', variant: 'success' });
    expect(taxInvoiceBadge(gr({ taxInvoice: { number: 'IV-10', date: '2026-10-04', source: 'LATER' } }), true)).toEqual({ text: 'มีใบกำกับภาษี', variant: 'success' });
    expect(taxInvoiceBadge(gr(), true)).toEqual({ text: 'รอใบกำกับภาษี', variant: 'warning' });
    expect(taxInvoiceBadge(gr(), false)).toEqual({ text: 'ไม่มี VAT', variant: 'secondary' });
  });
});

describe('taxInvoiceAction (Q1)', () => {
  it('BM บันทึกได้เมื่อยังไม่มี · แก้ไม่ได้ · OWNER/ACCOUNTANT แก้ได้ · ไม่จด VAT / TAX_INVOICE / SALES / FM = ไม่มีปุ่ม', () => {
    expect(taxInvoiceAction(gr(), true, 'BRANCH_MANAGER')).toBe('RECORD');
    expect(taxInvoiceAction(gr({ taxInvoice: { number: 'IV', date: '2026-10-04', source: 'LATER' } }), true, 'BRANCH_MANAGER')).toBeNull();
    expect(taxInvoiceAction(gr({ taxInvoice: { number: 'IV', date: '2026-10-04', source: 'LATER' } }), true, 'OWNER')).toBe('EDIT');
    expect(taxInvoiceAction(gr({ taxInvoice: { number: 'IV', date: '2026-10-04', source: 'LATER' } }), true, 'ACCOUNTANT')).toBe('EDIT');
    expect(taxInvoiceAction(gr(), false, 'OWNER')).toBeNull();
    expect(taxInvoiceAction(gr({ supplierDocType: 'TAX_INVOICE' }), true, 'OWNER')).toBeNull();
    expect(taxInvoiceAction(gr(), true, 'SALES')).toBeNull();
    expect(taxInvoiceAction(gr(), true, 'FINANCE_MANAGER')).toBeNull();
  });
});

describe('buildTaxInvoiceFormData / taxInvoiceResultMessage', () => {
  it('FormData มี number/date และ photo เมื่อแนบ', () => {
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'iv.jpg', { type: 'image/jpeg' });
    const fd = buildTaxInvoiceFormData({ number: ' IV-10 ', date: '2026-10-04' }, photo);
    expect(fd.get('number')).toBe('IV-10');
    expect(fd.get('date')).toBe('2026-10-04');
    expect((fd.get('photo') as File).name).toBe('iv.jpg');
    expect(buildTaxInvoiceFormData({ number: 'IV', date: '2026-10-04' }, null).has('photo')).toBe(false);
  });
  it('ข้อความผลลัพธ์', () => {
    const base = { receiving: { id: 'gr-1', grNumber: 'GR-1', taxInvoice: { number: 'IV', date: '2026-10-04', source: 'LATER' as const } }, accountingNotified: false };
    expect(taxInvoiceResultMessage({ ...base, claimed: [] })).toBe('บันทึกใบกำกับภาษีแล้ว — ยังไม่มีสัญญาที่รอเคลมในใบรับของนี้');
    expect(taxInvoiceResultMessage({ ...base, claimed: [{ contractId: 'c', contractNumber: 'CT-1', journalEntryNo: 'JE-1', amount: '686.00', postedOnInvoiceDate: true }], accountingNotified: true }))
      .toBe('บันทึกใบกำกับภาษีแล้ว · เคลมภาษีซื้อย้อนให้ 1 สัญญา (CT-1) · ส่งงานแจ้งฝ่ายบัญชีแล้ว (ลงวันนี้แทนวันเปิดสัญญา)');
  });
});
