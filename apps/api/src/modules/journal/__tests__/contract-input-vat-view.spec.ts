import { Decimal } from '@prisma/client/runtime/library';
import { buildContractInputVatView } from '../input-vat/contract-input-vat-view';
import { decorateReceivingForRole } from '../input-vat/input-vat-visibility.util';

/** ก้อน 5 — response หน้าสัญญา/ใบรับของ: ยอดเห็นเฉพาะ OWNER/FM/ACCOUNTANT (Q5) · สถานะ+เหตุผลเห็นทุก role */
const receiving = {
  id: 'gr-1', grNumber: 'GR-1', supplierDocType: 'TAX_INVOICE' as const, supplierDocNumber: 'IV-9', supplierDocDate: new Date('2026-03-31T17:00:00Z'),
  taxInvoiceNumber: null, taxInvoiceDate: null, po: { id: 'po-1', poNumber: 'PO-1' },
};
const client = (item: unknown, je: unknown = { entryNumber: 'JE-202610-00009' }) => ({
  goodsReceivingItem: { findUnique: jest.fn().mockResolvedValue(item) },
  journalEntry: { findUnique: jest.fn().mockResolvedValue(je) },
});
const claimed = { productId: 'p1', inputVatStatus: 'CLAIMED' as const, inputVatAmount: new Decimal('686'), inputVatJournalEntryId: 'je-1', inputVatReason: null };
const now = new Date('2026-10-05T03:00:00Z');

describe('buildContractInputVatView', () => {
  it('CLAIMED + OWNER → amount 686.00 · JE no · ใบกำกับ+อายุ 6 เดือน · ใบรับของ/PO', async () => {
    const out = await buildContractInputVatView(client({ receiving }) as never, claimed, 'OWNER', now);
    expect(out).toEqual({
      status: 'CLAIMED', amount: '686.00', journalEntryNo: 'JE-202610-00009',
      taxInvoice: { number: 'IV-9', date: '2026-04-01', ageMonths: 6 },
      grNumber: 'GR-1', receivingId: 'gr-1', poId: 'po-1', poNumber: 'PO-1', reason: null,
    });
  });
  it('BRANCH_MANAGER → amount null แต่สถานะ/ใบกำกับ/ใบรับของยังเห็น', async () => {
    const out = await buildContractInputVatView(client({ receiving }) as never, claimed, 'BRANCH_MANAGER', now);
    expect(out.amount).toBeNull();
    expect(out).toMatchObject({ status: 'CLAIMED', grNumber: 'GR-1', taxInvoice: { number: 'IV-9' } });
  });
  it('PENDING_INVOICE → taxInvoice null · journalEntryNo null · ยังชี้ใบรับของ', async () => {
    const out = await buildContractInputVatView(client({ receiving: { ...receiving, supplierDocType: 'DELIVERY_NOTE' } }) as never,
      { ...claimed, inputVatStatus: 'PENDING_INVOICE', inputVatJournalEntryId: null }, 'ACCOUNTANT', now);
    expect(out).toMatchObject({ status: 'PENDING_INVOICE', amount: '686.00', journalEntryNo: null, taxInvoice: null, grNumber: 'GR-1' });
  });
  it('NOT_ELIGIBLE ไม่มีใบรับของ → ทุกช่อง null ยกเว้น status + reason · ไม่ query JE', async () => {
    const c = client(null);
    const out = await buildContractInputVatView(c as never, { ...claimed, inputVatStatus: 'NOT_ELIGIBLE', inputVatAmount: null, inputVatJournalEntryId: null, inputVatReason: 'ไม่มีใบรับของ (ยอดยกมา / เพิ่มด้วยมือ)' }, 'OWNER', now);
    expect(out).toEqual({ status: 'NOT_ELIGIBLE', amount: null, journalEntryNo: null, taxInvoice: null, grNumber: null, receivingId: null, poId: null, poNumber: null, reason: 'ไม่มีใบรับของ (ยอดยกมา / เพิ่มด้วยมือ)' });
    expect(c.journalEntry.findUnique).not.toHaveBeenCalled();
  });
  it('แถว/mock ที่ไม่มี inputVatStatus เลย (undefined) → ถือเป็น NONE ไม่ query อะไร (spec เดิมของ ContractsService ใช้ mock แบบนี้)', async () => {
    const c = client(null);
    const out = await buildContractInputVatView(c as never, { productId: 'p1' } as never, 'OWNER', now);
    expect(out).toMatchObject({ status: 'NONE', amount: null });
    expect(c.goodsReceivingItem.findUnique).not.toHaveBeenCalled();
  });
  it('NONE (สัญญาก่อนก้อน 5) → status NONE ไม่ query อะไร', async () => {
    const c = client(null);
    const out = await buildContractInputVatView(c as never, { ...claimed, inputVatStatus: 'NONE', inputVatAmount: null, inputVatJournalEntryId: null }, 'OWNER', now);
    expect(out.status).toBe('NONE');
    expect(c.goodsReceivingItem.findUnique).not.toHaveBeenCalled();
  });
});

describe('decorateReceivingForRole', () => {
  const gr = { ...receiving, items: [{ id: 'i1', receivedVat: new Decimal('686') }, { id: 'i2', receivedVat: null }] };
  it('OWNER → taxInvoice จากเอกสารเดิม (RECEIVING) · receivedVat คงอยู่', () => {
    const out = decorateReceivingForRole(gr, 'OWNER');
    expect(out.taxInvoice).toEqual({ number: 'IV-9', date: '2026-04-01', source: 'RECEIVING' });
    expect(out.items[0].receivedVat).toEqual(new Decimal('686'));
  });
  it('BRANCH_MANAGER → receivedVat ทุกหน่วย null · taxInvoice ยังเห็น', () => {
    const out = decorateReceivingForRole(gr, 'BRANCH_MANAGER');
    expect(out.items.map((i) => i.receivedVat)).toEqual([null, null]);
    expect(out.taxInvoice?.number).toBe('IV-9');
  });
  it('ใบส่งของที่บันทึกใบกำกับทีหลัง → source LATER · ไม่มี = null', () => {
    expect(decorateReceivingForRole({ ...gr, supplierDocType: 'DELIVERY_NOTE', taxInvoiceNumber: 'IV-10', taxInvoiceDate: new Date('2026-10-03T17:00:00Z') }, 'OWNER').taxInvoice)
      .toEqual({ number: 'IV-10', date: '2026-10-04', source: 'LATER' });
    expect(decorateReceivingForRole({ ...gr, supplierDocType: 'DELIVERY_NOTE' }, 'OWNER').taxInvoice).toBeNull();
  });
});
