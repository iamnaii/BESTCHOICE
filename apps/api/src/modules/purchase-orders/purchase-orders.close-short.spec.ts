import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { poJournalTestProviders } from './po-journal.test-helpers';

/**
 * ปิดใบ รับไม่ครบ — คำตัดสินเจ้าของ 2026-10-11 (เคาะตาม mockup 4 ข้อ):
 *  1. OWNER/BM ปิดได้เฉพาะใบ "รับบางส่วน"  2. ปิดแล้วแก้ไม่ได้ (สถานะใหม่ไม่อยู่ใน allow-list รับของ/ยกเลิก)
 *  3. ยอดสุทธิคงเดิม เพดานจ่าย = ของที่รับจริง (ดู supplier-payment.util.spec)  4. หายจากการ์ดรับบางส่วน/เลยกำหนด (นับตามสถานะ)
 */
describe('PurchaseOrdersService.closeShort — ปิดใบ รับไม่ครบ', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const build = async (prisma: any) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }, ...poJournalTestProviders().providers],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  type Line = { accountCode: string; debit: string; credit: string };
  const makePrisma = (status: string, opts: { photoPending?: number; depositLines?: Line[]; entries?: { metadata: { flow: string }; lines: Line[] }[]; rows?: { kind: string; amount: string; voidedAt: null }[] } = {}) => {
    const po = {
      id: 'po-1', poNumber: 'PO-2026-10-007', status, deletedAt: null, netAmount: '15000', supplierId: 's1', paidAmount: '0',
      supplier: { id: 's1', name: 'S' },
      items: [{ id: 'i1', quantity: 5, receivedQty: 2 }, { id: 'i2', quantity: 1, receivedQty: 1 }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma: any = {
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue(po),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...po, ...data })),
      },
      product: { count: jest.fn().mockResolvedValue(opts.photoPending ?? 0) },
      purchaseOrderPayment: {
        findFirst: jest.fn().mockResolvedValue(opts.depositLines ? { id: 'pay-1' } : null),
        findMany: jest.fn().mockResolvedValue(opts.rows ?? (opts.depositLines ? [{ kind: 'DEPOSIT', amount: '3000', voidedAt: null }] : [])),
      },
      journalEntry: { findMany: jest.fn().mockResolvedValue(opts.entries ?? (opts.depositLines ? [{ lines: opts.depositLines }] : [])) },
      todo: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));
    return prisma;
  };

  it('ใบรับบางส่วน ไม่มีมัดจำค้าง → CLOSED_SHORT พร้อมผู้ปิด/เวลา/เหตุผล · นับของที่ไม่รับ · ปิดงานตีกลับที่ค้าง', async () => {
    const prisma = makePrisma('PARTIALLY_RECEIVED');
    const service = await build(prisma);
    const result = await service.closeShort('po-1', 'bm-1', { reason: 'ผู้จัดจำหน่ายแจ้งว่าของหมด ไม่ส่งที่เหลือ' });
    expect(result.status).toBe('CLOSED_SHORT');
    expect(result.depositClosed).toBeNull();
    expect(result.unreceivedQty).toBe(3);
    expect(result.todosClosed).toBe(1);
    const data = prisma.purchaseOrder.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ status: 'CLOSED_SHORT', closedById: 'bm-1', closeReason: 'ผู้จัดจำหน่ายแจ้งว่าของหมด ไม่ส่งที่เหลือ' }));
    expect(data.closedAt).toBeInstanceOf(Date);
    // ผู้ตรวจอิสระ 2026-10-11 ข้อ 2: คอลัมน์สรุปคิดใหม่ด้วยเพดานของสถานะใหม่ใน tx เดียวกัน
    expect(prisma.purchaseOrder.update).toHaveBeenCalledTimes(2);
    expect(prisma.purchaseOrder.update.mock.calls[1][0].data).toEqual({ paidAmount: expect.anything(), paymentStatus: 'UNPAID' });
    expect(prisma.todo.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tags: { hasEvery: ['po-deposit-reject', 'po:po-1'] } }), data: { status: 'DONE' } }),
    );
  });

  it('รับของ 6,000 (จาก 15,000) และจ่ายครบ 6,000 แล้ว → หลังปิดใบ paymentStatus = FULLY_PAID (หลุดจากเจ้าหนี้ค้าง)', async () => {
    const prisma = makePrisma('PARTIALLY_RECEIVED', {
      rows: [{ kind: 'SETTLEMENT', amount: '6000', voidedAt: null }],
      entries: [
        { metadata: { flow: 'shop-goods-receiving' }, lines: [{ accountCode: 'S11-2001', debit: '6000', credit: '0' }, { accountCode: 'S21-1101', debit: '0', credit: '6000' }] },
        { metadata: { flow: 'shop-supplier-payment' }, lines: [{ accountCode: 'S21-1101', debit: '6000', credit: '0' }, { accountCode: 'S11-1202', debit: '0', credit: '6000' }] },
      ],
    });
    const service = await build(prisma);
    await service.closeShort('po-1', 'owner-1', { reason: 'ของหมด' });
    const summary = prisma.purchaseOrder.update.mock.calls[1][0].data;
    expect(summary.paymentStatus).toBe('FULLY_PAID');
    expect(summary.paidAmount.toFixed(2)).toBe('6000.00');
  });

  it('เหตุผลว่าง → 400 ไม่แตะฐานข้อมูล', async () => {
    const prisma = makePrisma('PARTIALLY_RECEIVED');
    const service = await build(prisma);
    await expect(service.closeShort('po-1', 'bm-1', { reason: '   ' })).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['ORDERED', 'FULLY_RECEIVED', 'CANCELLED', 'CLOSED_SHORT', 'DRAFT'])('สถานะ %s → 400 (ปิดได้เฉพาะรับบางส่วน)', async (status) => {
    const prisma = makePrisma(status);
    const service = await build(prisma);
    await expect(service.closeShort('po-1', 'owner-1', { reason: 'x' })).rejects.toThrow(/รับบางส่วน/);
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('มีเครื่องของใบรอถ่ายรูปอยู่ → 400 ให้ยืนยันรูป/ตีกลับให้ครบก่อน (หน่วยเหล่านั้นยังไม่ลงบัญชี มัดจำอาจเป็นของมัน)', async () => {
    const prisma = makePrisma('PARTIALLY_RECEIVED', { photoPending: 2 });
    const service = await build(prisma);
    await expect(service.closeShort('po-1', 'owner-1', { reason: 'x' })).rejects.toThrow(/รอถ่ายรูปอยู่ 2 ชิ้น/);
    expect(prisma.product.count).toHaveBeenCalledWith({ where: { poId: 'po-1', status: 'PHOTO_PENDING', deletedAt: null } });
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('สถานะเปลี่ยนระหว่างอ่านกับเขียน (TOCTOU) → ปฏิเสธใน tx ไม่เขียนทับ', async () => {
    const prisma = makePrisma('PARTIALLY_RECEIVED');
    prisma.purchaseOrder.findUnique
      .mockResolvedValueOnce({ id: 'po-1', status: 'PARTIALLY_RECEIVED', deletedAt: null, supplier: { id: 's1', name: 'S' }, items: [{ id: 'i1', quantity: 5, receivedQty: 2 }] })
      .mockResolvedValueOnce({ id: 'po-1', status: 'FULLY_RECEIVED', items: [{ quantity: 5, receivedQty: 5 }] });
    const service = await build(prisma);
    await expect(service.closeShort('po-1', 'owner-1', { reason: 'x' })).rejects.toThrow(/เปลี่ยนสถานะ/);
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('มีมัดจำค้างแต่ไม่ระบุผล → 400 ข้อความบอก "ก่อนปิดใบ" ไม่ใช่ "ก่อนยกเลิก"', async () => {
    const prisma = makePrisma('PARTIALLY_RECEIVED', {
      depositLines: [{ accountCode: 'S11-4201', debit: '3000', credit: '0' }, { accountCode: 'S11-1202', debit: '0', credit: '3000' }],
    });
    const service = await build(prisma);
    await expect(service.closeShort('po-1', 'owner-1', { reason: 'x' })).rejects.toThrow(/มัดจำค้าง 3000\.00 บาท.*ก่อนปิดใบ/);
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
  });
});
