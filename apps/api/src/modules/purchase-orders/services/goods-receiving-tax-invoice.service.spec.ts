import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GoodsReceivingTaxInvoiceService } from './goods-receiving-tax-invoice.service';
import * as claim from '../../journal/input-vat/installment-input-vat.claim';

/** ก้อน 5 Q1 — ใบกำกับที่มาทีหลัง: OWNER/BM/ACCOUNTANT บันทึก · เลขที่+วันที่บังคับ รูปไม่บังคับ · บันทึกครั้งเดียว แก้ได้เฉพาะ OWNER/ACCOUNTANT */
const receiving = (over: Record<string, unknown> = {}) => ({
  id: 'gr-1', poId: 'po-1', grNumber: 'GR-20261005-001', supplierDocType: 'DELIVERY_NOTE', supplierDocNumber: 'DN-1',
  supplierDocDate: new Date('2026-09-29T17:00:00Z'), taxInvoiceNumber: null, taxInvoiceDate: null, deletedAt: null,
  po: { id: 'po-1', poNumber: 'PO-1', supplier: { id: 's1', name: 'ร้าน A', hasVat: true } },
  ...over,
});

function build(row = receiving()) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'gr-1' }]),
    goodsReceiving: { findFirst: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue({ ...row, taxInvoiceNumber: 'IV-10' }) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = { goodsReceiving: { findFirst: jest.fn().mockResolvedValue(row) }, $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)) };
  const storage = { upload: jest.fn().mockResolvedValue('ok'), delete: jest.fn() };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const template = { execute: jest.fn() };
  const service = new GoodsReceivingTaxInvoiceService(prisma, template as never, storage as never, audit as never);
  return { service, tx, prisma, storage, audit };
}
const dto = { number: 'IV-10', date: '2026-10-04' };
const owner = { id: 'u-owner', role: 'OWNER' };
const bm = { id: 'u-bm', role: 'BRANCH_MANAGER' };

describe('GoodsReceivingTaxInvoiceService.record', () => {
  let claimSpy: jest.SpyInstance;
  beforeEach(() => {
    claimSpy = jest.spyOn(claim, 'claimPendingInputVatForReceiving').mockResolvedValue({
      claimed: [{ contractId: 'c1', contractNumber: 'CT-1', journalEntryNo: 'JE-1', amount: '686.00', postedOnInvoiceDate: false }],
      accountingNotified: false,
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('บันทึกเลข/วันที่ (เที่ยงคืนไทย) + ผู้บันทึก → เคลมย้อนสัญญาที่รอ · คืน claimed · audit RECORDED หลัง commit', async () => {
    const { service, tx, audit, storage } = build();
    const out = await service.record('po-1', 'gr-1', dto, undefined, bm);
    expect(tx.goodsReceiving.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'gr-1' },
      data: { taxInvoiceNumber: 'IV-10', taxInvoiceDate: new Date('2026-10-03T17:00:00Z'), taxInvoiceRecordedById: 'u-bm', taxInvoicePhotoKey: null },
    });
    expect(claimSpy).toHaveBeenCalledWith(tx, expect.anything(), expect.objectContaining({ receivingId: 'gr-1', actorId: 'u-bm' }));
    expect(out).toMatchObject({ receiving: { id: 'gr-1', grNumber: 'GR-20261005-001', taxInvoice: { number: 'IV-10', date: '2026-10-04', source: 'LATER' } }, claimed: [{ contractNumber: 'CT-1' }], accountingNotified: false });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'GOODS_RECEIVING_TAX_INVOICE_RECORDED', entity: 'goods_receiving', entityId: 'gr-1', userId: 'u-bm' }));
  });

  it('แนบรูป JPEG → อัปโหลด key goods-receivings/tax-invoices/<yyyymmdd>/<uuid>.jpg แล้วเก็บ key', async () => {
    const { service, tx, storage } = build();
    const photo = { originalname: 'iv.jpg', mimetype: 'image/jpeg', size: 20, buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) } as Express.Multer.File;
    await service.record('po-1', 'gr-1', dto, photo, owner);
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.upload.mock.calls[0][0]).toMatch(/^goods-receivings\/tax-invoices\/\d{8}\/[0-9a-f-]{36}\.jpg$/);
    expect(tx.goodsReceiving.update.mock.calls[0][0].data.taxInvoicePhotoKey).toBe(storage.upload.mock.calls[0][0]);
  });

  it('รูปไม่ใช่ภาพ → 400 ไม่อัปโหลด ไม่เขียน', async () => {
    const { service, tx, storage } = build();
    const bad = { originalname: 'x.pdf', mimetype: 'application/pdf', size: 20, buffer: Buffer.alloc(20) } as Express.Multer.File;
    await expect(service.record('po-1', 'gr-1', dto, bad, owner)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(tx.goodsReceiving.update).not.toHaveBeenCalled();
  });

  it('ใบรับของรับด้วย TAX_INVOICE อยู่แล้ว → 400', async () => {
    const { service } = build(receiving({ supplierDocType: 'TAX_INVOICE', supplierDocNumber: 'IV-9' }));
    await expect(service.record('po-1', 'gr-1', dto, undefined, owner)).rejects.toThrow('ใบรับของนี้รับด้วยใบกำกับภาษีอยู่แล้ว');
  });

  it('ผู้จัดจำหน่ายไม่จด VAT → 400', async () => {
    const { service } = build(receiving({ po: { id: 'po-1', poNumber: 'PO-1', supplier: { id: 's1', name: 'ร้าน B', hasVat: false } } }));
    await expect(service.record('po-1', 'gr-1', dto, undefined, owner)).rejects.toThrow('ผู้จัดจำหน่ายไม่จด VAT');
  });

  it('เคยบันทึกแล้ว: BM แก้ไม่ได้ (403) · OWNER แก้ได้ และ audit เป็น UPDATED พร้อม oldValue', async () => {
    const recorded = receiving({ taxInvoiceNumber: 'IV-OLD', taxInvoiceDate: new Date('2026-10-01T17:00:00Z') });
    const bmCase = build(recorded);
    await expect(bmCase.service.record('po-1', 'gr-1', dto, undefined, bm)).rejects.toBeInstanceOf(ForbiddenException);
    const ownerCase = build(recorded);
    await ownerCase.service.record('po-1', 'gr-1', dto, undefined, owner);
    expect(ownerCase.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'GOODS_RECEIVING_TAX_INVOICE_UPDATED', oldValue: expect.objectContaining({ taxInvoiceNumber: 'IV-OLD' }) }));
  });

  it('กดพร้อมกัน: SELECT … FOR UPDATE ใต้ Serializable โยน P2010 (40001) หรือ P2034 → 409 Conflict ไม่ใช่ error ดิบ (Review Focus 1)', async () => {
    const { Prisma } = await import('@prisma/client');
    const { ConflictException } = await import('@nestjs/common');
    const raw = new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `40001`', { code: 'P2010', clientVersion: 'test', meta: { code: '40001', message: 'could not serialize access due to concurrent update' } });
    const a = build(); a.tx.$queryRaw.mockRejectedValue(raw);
    await expect(a.service.record('po-1', 'gr-1', dto, undefined, owner)).rejects.toBeInstanceOf(ConflictException);
    const ssi = new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: 'test' });
    const b = build(); b.tx.$queryRaw.mockRejectedValue(ssi);
    await expect(b.service.record('po-1', 'gr-1', dto, undefined, owner)).rejects.toBeInstanceOf(ConflictException);
    // error อื่น (เช่น P2010 รหัสอื่น) ผ่านออกไปตามเดิม
    const other = new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `42P01`', { code: 'P2010', clientVersion: 'test', meta: { code: '42P01' } });
    const c = build(); c.tx.$queryRaw.mockRejectedValue(other);
    await expect(c.service.record('po-1', 'gr-1', dto, undefined, owner)).rejects.toBe(other);
  });

  it('เลขที่ว่าง / วันที่อนาคต → 400 จาก normalizeSupplierDoc · ใบรับของไม่พบ → 404', async () => {
    const { service } = build();
    await expect(service.record('po-1', 'gr-1', { number: '  ', date: '2026-10-04' }, undefined, owner)).rejects.toThrow('กรุณากรอกเลขที่เอกสาร');
    await expect(service.record('po-1', 'gr-1', { number: 'IV-1', date: '2999-01-01' }, undefined, owner)).rejects.toBeInstanceOf(BadRequestException);
    const missing = build(); missing.prisma.goodsReceiving.findFirst.mockResolvedValue(null);
    await expect(missing.service.record('po-1', 'gr-x', dto, undefined, owner)).rejects.toBeInstanceOf(NotFoundException);
  });
});
