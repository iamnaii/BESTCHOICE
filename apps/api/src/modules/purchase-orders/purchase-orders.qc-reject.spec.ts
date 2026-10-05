import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { poJournalTestProviders } from './po-journal.test-helpers';

describe('PurchaseOrdersService.rejectQC', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const buildTx = (products: { id: string; status: string; name: string }[], bookedProductIds: string[] = []) => {
    const tx = {
      // ก้อน 2: หักมัดจำตอนรับของถามก่อนว่าเคยมัดจำไหม — spec นี้ไม่มีมัดจำ
      purchaseOrderPayment: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      product: {
        findMany: jest.fn().mockResolvedValue(products),
        updateMany: jest.fn().mockResolvedValue({ count: products.length }),
      },
      goodsReceivingItem: {
        findMany: jest.fn().mockResolvedValue(bookedProductIds.map((productId) => ({ productId }))),
      },
    };
    return tx;
  };

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }, ...poJournalTestProviders().providers],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  it('soft-deletes PHOTO_PENDING products and returns the count', async () => {
    const tx = buildTx([
      { id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone' },
      { id: 'p2', status: 'PHOTO_PENDING', name: 'iPhone 2' },
    ]);
    prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    service = await build();

    const res = await service.rejectQC(['p1', 'p2'], 'จอแตก');
    expect(res.rejected).toBe(2);
    expect(tx.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // เงื่อนไขสถานะอยู่ในคำสั่งเขียนเอง — ค่าที่อ่านไว้ก่อนหน้าอาจเก่าไปแล้วเมื่ออีกคำขอ commit ก่อน
        where: { id: { in: ['p1', 'p2'] }, status: 'PHOTO_PENDING', deletedAt: null },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects when no productIds are given', async () => {
    prisma = { $transaction: jest.fn() };
    service = await build();
    await expect(service.rejectQC([], 'x')).rejects.toThrow(BadRequestException);
  });

  it('rejects when a product is not in the photo queue (IN_STOCK, legacy QC_PENDING)', async () => {
    for (const status of ['IN_STOCK', 'QC_PENDING']) {
      const tx = buildTx([{ id: 'p1', status, name: 'Sold-in' }]);
      prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
      service = await build();
      await expect(service.rejectQC(['p1'], 'late')).rejects.toThrow(/รอถ่ายรูป/);
      expect(tx.product.updateMany).not.toHaveBeenCalled();
    }
  });

  // คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8: เครื่องที่รอถ่ายรูปยังไม่ลงบัญชี จึงตีกลับได้โดยไม่แตะบัญชี —
  // แต่เครื่องที่ลงบัญชีรับเข้าคลังไปแล้ว (เคยอยู่ในคลังแล้วถูกเปลี่ยนกลับมารอถ่ายรูป) ลบทิ้งไม่ได้
  it('ปฏิเสธเครื่องที่ลงบัญชีรับเข้าคลังแล้ว — ลบทิ้งจะเหลือสินค้าคงคลังและเจ้าหนี้ค้างโดยไม่มีเครื่อง', async () => {
    const tx = buildTx(
      [
        { id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone รอถ่ายรูป' },
        { id: 'p2', status: 'PHOTO_PENDING', name: 'iPhone เคยเข้าคลัง' },
      ],
      ['p2'],
    );
    prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    service = await build();

    await expect(service.rejectQC(['p1', 'p2'], 'จอแตก')).rejects.toThrow(/ลงบัญชีรับเข้าคลังแล้ว.*iPhone เคยเข้าคลัง/);
    expect(tx.goodsReceivingItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ productId: { in: ['p1', 'p2'] }, journalEntryId: { not: null } }) }),
    );
    // ตรวจหลังคำสั่งลบ (ถือล็อกแถวสินค้าแล้ว) — การลบถูกย้อนกลับเพราะโยนใน tx เดียวกัน (ผลตรวจทานอิสระรอบ 3)
    expect(tx.goodsReceivingItem.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.product.updateMany.mock.invocationCallOrder[0],
    );
  });

  // ผลตรวจทานอิสระ 2026-09-30: กด "ไม่รับเข้าคลัง" พร้อมกับกดยืนยันรูปครบ — ฝั่งยืนยันรูป commit ก่อน
  // (เครื่องเข้าคลัง + ลงบัญชีแล้ว) แต่ฝั่งนี้อ่านค่าเก่าไว้ว่ายังรอถ่ายรูป ⇒ คำสั่งลบต้องไม่โดนเครื่องนั้น
  it('เครื่องเพิ่งถูกยืนยันรูปเข้าคลังระหว่างทำรายการ (ลบได้ไม่ครบ) → ปฏิเสธทั้งชุด ให้รีเฟรช', async () => {
    const tx = buildTx([
      { id: 'p1', status: 'PHOTO_PENDING', name: 'iPhone' },
      { id: 'p2', status: 'PHOTO_PENDING', name: 'iPhone 2' },
    ]);
    tx.product.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    service = await build();

    const error = await service.rejectQC(['p1', 'p2'], 'จอแตก').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toMatch(/รีเฟรชหน้าจอ/);
  });
});
