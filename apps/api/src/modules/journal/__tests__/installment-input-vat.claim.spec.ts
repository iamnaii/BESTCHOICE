// apps/api/src/modules/journal/__tests__/installment-input-vat.claim.spec.ts
import { Decimal } from '@prisma/client/runtime/library';
import {
  claimInputVatOnActivation,
  claimPendingInputVatForReceiving,
  findActivationPostedAt,
  INPUT_VAT_PERIOD_TODO_TAG,
  markInputVatReversedIfSwept,
} from '../input-vat/installment-input-vat.claim';
import * as supplierDoc from '../../purchase-orders/services/supplier-doc.util';
import * as periodLock from '../../../utils/period-lock.util';

/** ก้อน 5 — จุดเคลม = เปิดสัญญา (เครื่องหลัก) · ใบกำกับมาทีหลัง = เคลมย้อนลงวันเปิดสัญญา (Q2) · ยกเลิก = REVERSED */
const receivingTaxInv = {
  id: 'gr-1', grNumber: 'GR-20261005-001', supplierDocType: 'TAX_INVOICE', supplierDocNumber: 'IV-9',
  supplierDocDate: new Date('2026-09-29T17:00:00Z'), taxInvoiceNumber: null, taxInvoiceDate: null,
};
const receivingDn = { ...receivingTaxInv, supplierDocType: 'DELIVERY_NOTE', supplierDocNumber: 'DN-1' };

function makeTx(over: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {
    product: { findUnique: jest.fn().mockResolvedValue({ checklistResults: null }) },
    goodsReceivingItem: { findUnique: jest.fn().mockResolvedValue({ receivedVat: new Decimal('686'), receiving: receivingTaxInv }) },
    goodsReceiving: { findUnique: jest.fn() },
    contract: { update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    journalEntry: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
    companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'fin-co' }) },
    todo: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 't1' }) },
    ...over,
  };
  return tx;
}
const template = () => ({ execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1', journalEntryId: 'je-1' }) });
const postedAt = new Date('2026-10-05T03:00:00Z');

describe('claimInputVatOnActivation', () => {
  it('เครื่องเคลมได้ → template.execute ด้วยยอด 686 ลงวัน postedAt · สัญญา CLAIMED + เลข JE', async () => {
    const tx = makeTx();
    const t = template();
    const out = await claimInputVatOnActivation(tx, t as never, { contractId: 'c1', contractNumber: 'CT-1', productId: 'p1', postedAt });
    expect(out).toMatchObject({ status: 'CLAIMED', entryNo: 'JE-1', journalEntryId: 'je-1' });
    expect(t.execute.mock.calls[0][0]).toMatchObject({
      contractId: 'c1', contractNumber: 'CT-1', productId: 'p1', receivingId: 'gr-1', grNumber: 'GR-20261005-001',
      taxInvoiceNumber: 'IV-9', taxInvoiceDate: receivingTaxInv.supplierDocDate, postedAt,
    });
    expect(t.execute.mock.calls[0][0].amount.toFixed(2)).toBe('686.00');
    expect(t.execute.mock.calls[0][1]).toBe(tx);
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { inputVatStatus: 'CLAIMED', inputVatAmount: expect.anything(), inputVatJournalEntryId: 'je-1', inputVatReason: null },
    });
  });

  it('ใบรับของเป็นใบส่งของ (ยังไม่มีใบกำกับ) → PENDING_INVOICE · ไม่มี JE · ไม่มี Todo (Q6/Q2)', async () => {
    const tx = makeTx({ goodsReceivingItem: { findUnique: jest.fn().mockResolvedValue({ receivedVat: new Decimal('686'), receiving: receivingDn }) } });
    const t = template();
    const out = await claimInputVatOnActivation(tx, t as never, { contractId: 'c1', contractNumber: 'CT-1', productId: 'p1', postedAt });
    expect(out).toMatchObject({ status: 'PENDING_INVOICE' });
    expect(t.execute).not.toHaveBeenCalled();
    expect(tx.todo.create).not.toHaveBeenCalled();
    expect(tx.contract.update.mock.calls[0][0].data).toMatchObject({ inputVatStatus: 'PENDING_INVOICE' });
  });

  it('ไม่มีใบรับของ → NOT_ELIGIBLE + เหตุผล · ไม่มี JE', async () => {
    const tx = makeTx({ goodsReceivingItem: { findUnique: jest.fn().mockResolvedValue(null) } });
    const t = template();
    const out = await claimInputVatOnActivation(tx, t as never, { contractId: 'c1', contractNumber: 'CT-1', productId: 'p1', postedAt });
    expect(out).toMatchObject({ status: 'NOT_ELIGIBLE', reason: expect.stringContaining('ไม่มีใบรับของ') });
    expect(t.execute).not.toHaveBeenCalled();
    expect(tx.contract.update.mock.calls[0][0].data).toMatchObject({ inputVatStatus: 'NOT_ELIGIBLE', inputVatReason: expect.stringContaining('ไม่มีใบรับของ') });
  });
});

describe('claimPendingInputVatForReceiving (Q2)', () => {
  const now = new Date('2026-10-05T03:00:00Z');
  const laterInv = { ...receivingDn, taxInvoiceNumber: 'IV-10', taxInvoiceDate: new Date('2026-10-03T17:00:00Z'),
    items: [{ productId: 'p1', receivedVat: new Decimal('686') }, { productId: 'p2', receivedVat: new Decimal('343') }], po: { poNumber: 'PO-1' } };

  beforeEach(() => {
    jest.spyOn(supplierDoc, 'isPeriodClosedForBackdating').mockResolvedValue(false);
    jest.spyOn(periodLock, 'validatePeriodOpen').mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('เคลมทุกสัญญา PENDING_INVOICE ของเครื่องในใบ ลงวันเปิดสัญญา (postedAt ของ 1A) · ข้ามเครื่องที่ไม่มีสัญญารอ', async () => {
    const tx = makeTx({
      goodsReceiving: { findUnique: jest.fn().mockResolvedValue(laterInv) },
      contract: {
        update: jest.fn(), findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ id: 'c1', contractNumber: 'CT-1', productId: 'p1', inputVatAmount: new Decimal('686') }]),
      },
      journalEntry: { findFirst: jest.fn().mockResolvedValue({ postedAt: new Date('2026-10-01T04:00:00Z') }), findUnique: jest.fn() },
    });
    const t = template();
    const out = await claimPendingInputVatForReceiving(tx, t as never, { receivingId: 'gr-1', now, actorId: 'u1' });
    expect(out.claimed).toEqual([{ contractId: 'c1', contractNumber: 'CT-1', journalEntryNo: 'JE-1', amount: '686.00', postedOnInvoiceDate: false }]);
    expect(out.accountingNotified).toBe(false);
    expect(t.execute.mock.calls[0][0]).toMatchObject({ contractId: 'c1', postedAt: new Date('2026-10-01T04:00:00Z'), taxInvoiceNumber: 'IV-10' });
    expect(tx.contract.findMany.mock.calls[0][0].where).toMatchObject({
      productId: { in: ['p1', 'p2'] }, inputVatStatus: 'PENDING_INVOICE', deletedAt: null, status: { notIn: ['DRAFT', 'CANCELED'] },
    });
    expect(tx.todo.create).not.toHaveBeenCalled();
  });

  it('งวดเดือนเปิดสัญญาปิดแล้ว → ลงวันนี้ + postedOnInvoiceDate + Todo MEDIUM แท็ก input-vat-period ถึงฝ่ายบัญชี (ไม่ซ้ำเมื่อมีงานค้าง)', async () => {
    jest.spyOn(supplierDoc, 'isPeriodClosedForBackdating').mockResolvedValue(true);
    const tx = makeTx({
      goodsReceiving: { findUnique: jest.fn().mockResolvedValue(laterInv) },
      contract: { update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'c1', contractNumber: 'CT-1', productId: 'p1', inputVatAmount: new Decimal('686') }]) },
      journalEntry: { findFirst: jest.fn().mockResolvedValue({ postedAt: new Date('2026-08-15T04:00:00Z') }), findUnique: jest.fn() },
    });
    const t = template();
    const out = await claimPendingInputVatForReceiving(tx, t as never, { receivingId: 'gr-1', now, actorId: 'u1' });
    expect(out.claimed[0]).toMatchObject({ postedOnInvoiceDate: true });
    expect(out.accountingNotified).toBe(true);
    expect(t.execute.mock.calls[0][0]).toMatchObject({ postedAt: now, postedOnInvoiceDate: true });
    expect(periodLock.validatePeriodOpen).toHaveBeenCalledWith(tx, now, 'fin-co');
    expect(tx.todo.create.mock.calls[0][0].data).toMatchObject({ priority: 'MEDIUM', tags: [INPUT_VAT_PERIOD_TODO_TAG, 'input-vat:CT-1'], createdById: 'u1' });
    expect(tx.todo.create.mock.calls[0][0].data.title).toContain('CT-1');
  });

  it('ใบรับของยังไม่มีใบกำกับ (บันทึกไม่ครบ) → ไม่เคลมอะไร', async () => {
    const tx = makeTx({ goodsReceiving: { findUnique: jest.fn().mockResolvedValue({ ...receivingDn, items: [], po: { poNumber: 'PO-1' } }) } });
    const t = template();
    const out = await claimPendingInputVatForReceiving(tx, t as never, { receivingId: 'gr-1', now, actorId: 'u1' });
    expect(out).toEqual({ claimed: [], accountingNotified: false });
    expect(t.execute).not.toHaveBeenCalled();
  });
});

describe('markInputVatReversedIfSwept', () => {
  it('CLAIMED + JE ถูกกวาด (metadata.reversed) → REVERSED', async () => {
    const tx = makeTx({
      contract: { findUnique: jest.fn().mockResolvedValue({ inputVatStatus: 'CLAIMED', inputVatJournalEntryId: 'je-1' }), update: jest.fn(), findMany: jest.fn() },
      journalEntry: { findUnique: jest.fn().mockResolvedValue({ metadata: { reversed: true } }), findFirst: jest.fn() },
    });
    await expect(markInputVatReversedIfSwept(tx, 'c1')).resolves.toBe('REVERSED');
    expect(tx.contract.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { inputVatStatus: 'REVERSED' } });
  });
  it('CLAIMED แต่ JE ยังไม่ถูกกวาด → UNCHANGED (ไม่แก้สถานะเอง)', async () => {
    const tx = makeTx({
      contract: { findUnique: jest.fn().mockResolvedValue({ inputVatStatus: 'CLAIMED', inputVatJournalEntryId: 'je-1' }), update: jest.fn(), findMany: jest.fn() },
      journalEntry: { findUnique: jest.fn().mockResolvedValue({ metadata: { reversed: false } }), findFirst: jest.fn() },
    });
    await expect(markInputVatReversedIfSwept(tx, 'c1')).resolves.toBe('UNCHANGED');
    expect(tx.contract.update).not.toHaveBeenCalled();
  });
  it('PENDING_INVOICE → REVERSED พร้อมเหตุผล (ยกเลิกก่อนได้ใบกำกับ — ห้ามเคลมย้อนภายหลัง)', async () => {
    const tx = makeTx({ contract: { findUnique: jest.fn().mockResolvedValue({ inputVatStatus: 'PENDING_INVOICE', inputVatJournalEntryId: null }), update: jest.fn(), findMany: jest.fn() } });
    await expect(markInputVatReversedIfSwept(tx, 'c1')).resolves.toBe('REVERSED');
    expect(tx.contract.update.mock.calls[0][0].data).toMatchObject({ inputVatStatus: 'REVERSED', inputVatReason: 'สัญญาถูกยกเลิกก่อนได้ใบกำกับภาษี' });
  });
  it('NONE / NOT_ELIGIBLE → UNCHANGED', async () => {
    const tx = makeTx({ contract: { findUnique: jest.fn().mockResolvedValue({ inputVatStatus: 'NOT_ELIGIBLE', inputVatJournalEntryId: null }), update: jest.fn(), findMany: jest.fn() } });
    await expect(markInputVatReversedIfSwept(tx, 'c1')).resolves.toBe('UNCHANGED');
  });
});

describe('findActivationPostedAt', () => {
  it('อ่าน postedAt ของ 1A (tag 1A) หรือ A.1 ของเปลี่ยนเครื่อง (flow exchange-new-contract-1a) ที่ contractId ตรง · ไม่มี = null', async () => {
    const tx = makeTx({ journalEntry: { findFirst: jest.fn().mockResolvedValue({ postedAt: new Date('2026-10-01T04:00:00Z') }), findUnique: jest.fn() } });
    await expect(findActivationPostedAt(tx, 'c1')).resolves.toEqual(new Date('2026-10-01T04:00:00Z'));
    const where = tx.journalEntry.findFirst.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"1A"');
    expect(JSON.stringify(where)).toContain('exchange-new-contract-1a');
    tx.journalEntry.findFirst.mockResolvedValue(null);
    await expect(findActivationPostedAt(tx, 'c1')).resolves.toBeNull();
  });
});
