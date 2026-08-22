import { Test, TestingModule } from '@nestjs/testing';
import { ProductPhotosService } from './product-photos.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Phase 5 fix round 2 [Important 1] — `completePhotos` เป็นประตูที่สามที่พาเครื่องเข้า
 * `IN_STOCK` (เส้นทางธรรมชาติของเครื่องมือสอง: ถ่ายรูป 6 มุมก่อนขาย) จึงต้องผ่านด่าน
 * ราคา + เขียน AuditLog ชุดเดียวกับปุ่ม "นำเข้าคลังพร้อมขาย" และ PATCH
 *
 * Phase 5 fix round 3 [Minor 4] — ด่านนั้นเป็น **soft gate** ไม่ใช่ hard block:
 * `trade-in` สร้างเครื่องรับซื้อเป็น `PHOTO_PENDING` **ไม่มีราคาขาย** แล้ว autofill
 * จาก template แบบ fail-soft ⇒ template ไม่ match เมื่อไร พนักงาน `SALES` ที่อัปโหลด
 * รูปครบจะได้ 400 และตั้งราคาเองไม่ได้ (PATCH/prices เป็น OWNER/BM) = flow หน้าร้านตัน
 * ⇒ งานของ endpoint นี้ (บันทึกว่ารูปครบ) ต้องสำเร็จเสมอ ส่วนการ **เลื่อนเป็น IN_STOCK**
 * เกิดเฉพาะเมื่อราคาผ่านด่าน
 */
describe('ProductPhotosService.completePhotos — ด่านเข้าคลัง (Phase 5 fix round 2 + 3)', () => {
  let service: ProductPhotosService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  const ALL_ANGLES = {
    front: 'a',
    back: 'b',
    left: 'c',
    right: 'd',
    top: 'e',
    screen: 'f',
  };

  const productRow = (over: Record<string, unknown> = {}) => ({
    id: 'p-1',
    status: 'PHOTO_PENDING',
    category: 'PHONE_USED',
    deletedAt: null,
    cashPrice: '15900',
    installmentPrice: null,
    prices: [],
    ...over,
  });

  beforeEach(async () => {
    tx = {
      product: {
        findUnique: jest.fn().mockResolvedValue(productRow()),
        update: jest.fn().mockResolvedValue({}),
      },
      productPhoto: {
        findUnique: jest.fn().mockResolvedValue({ productId: 'p-1', ...ALL_ANGLES }),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductPhotosService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ProductPhotosService>(ProductPhotosService);
  });

  it('ยังไม่มีราคาขาย → บันทึกรูปครบสำเร็จ แต่ค้างที่ PHOTO_PENDING (ไม่ throw, SALES ไม่ตัน)', async () => {
    tx.product.findUnique.mockResolvedValue(
      productRow({ cashPrice: null, installmentPrice: null, prices: [] }),
    );

    const res = await service.completePhotos('p-1', 'user-9');

    // งานของ endpoint นี้ต้องเสร็จเสมอ
    expect(tx.productPhoto.update).toHaveBeenCalledWith({
      where: { productId: 'p-1' },
      data: { isCompleted: true },
    });
    expect(res.isCompleted).toBe(true);
    // แต่ไม่เลื่อนสถานะ และไม่มี audit เข้าคลัง
    expect(res.status).toBe('PHOTO_PENDING');
    expect(res.enteredStock).toBe(false);
    expect(res.message).toMatch(/ตั้งราคาขาย/);
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('ราคาที่ถูก soft-delete ใน prices[] ไม่นับ → ยังค้างที่ PHOTO_PENDING', async () => {
    tx.product.findUnique.mockResolvedValue(
      productRow({
        cashPrice: null,
        installmentPrice: null,
        prices: [{ amount: '9900', deletedAt: new Date() }],
      }),
    );

    const res = await service.completePhotos('p-1', 'user-9');

    expect(res.enteredStock).toBe(false);
    expect(res.status).toBe('PHOTO_PENDING');
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('มีราคา → เข้าคลังได้ + stockInDate + AuditLog PRODUCT_RETURNED_TO_STOCK (via PHOTO_COMPLETE)', async () => {
    const res = await service.completePhotos('p-1', 'user-9');

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: expect.objectContaining({ status: 'IN_STOCK', stockInDate: expect.any(Date) }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-9',
        action: 'PRODUCT_RETURNED_TO_STOCK',
        entity: 'product',
        entityId: 'p-1',
        oldValue: expect.objectContaining({ status: 'PHOTO_PENDING', cashPrice: '15900' }),
        newValue: expect.objectContaining({ status: 'IN_STOCK', via: 'PHOTO_COMPLETE' }),
      }),
    });
    expect(res.status).toBe('IN_STOCK');
    expect(res.enteredStock).toBe(true);
  });

  it('ราคาอยู่ในแถว prices[] อย่างเดียว (เครื่องยุคก่อนคอลัมน์) → เข้าคลังได้', async () => {
    tx.product.findUnique.mockResolvedValue(
      productRow({
        cashPrice: null,
        installmentPrice: null,
        prices: [{ amount: '9900', deletedAt: null }],
      }),
    );

    const res = await service.completePhotos('p-1', 'user-9');

    expect(res.enteredStock).toBe(true);
    expect(res.status).toBe('IN_STOCK');
  });

  it('สถานะ IN_STOCK/RESERVED (ยืนยันรูปเฉย ๆ) ไม่โดนด่านราคา และไม่เขียน audit เข้าคลัง', async () => {
    tx.product.findUnique.mockResolvedValue(
      productRow({ status: 'RESERVED', cashPrice: null, installmentPrice: null }),
    );

    const res = await service.completePhotos('p-1', 'user-9');

    expect(res.status).toBe('RESERVED');
    expect(res.enteredStock).toBe(false);
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
