import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProductPhotosService } from './product-photos.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Phase 5 fix round 2 [Important 1] — `completePhotos` เป็นประตูที่สามที่พาเครื่องเข้า
 * `IN_STOCK` (เส้นทางธรรมชาติของเครื่องมือสอง: ถ่ายรูป 6 มุมก่อนขาย) จึงต้องผ่านด่าน
 * ราคา + เขียน AuditLog ชุดเดียวกับปุ่ม "นำเข้าคลังพร้อมขาย" และ PATCH
 */
describe('ProductPhotosService.completePhotos — ด่านเข้าคลัง (Phase 5 fix round 2)', () => {
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

  it('PHOTO_PENDING → IN_STOCK ที่ยังไม่มีราคาขาย → reject (ประตูนี้เคยเข้าคลังได้เงียบ ๆ)', async () => {
    tx.product.findUnique.mockResolvedValue(
      productRow({ cashPrice: null, installmentPrice: null, prices: [] }),
    );

    await expect(service.completePhotos('p-1', 'user-9')).rejects.toThrow(BadRequestException);
    await expect(service.completePhotos('p-1', 'user-9')).rejects.toThrow(/ราคาขาย/);
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('ราคาที่ถูก soft-delete ใน prices[] ไม่นับ → ยัง reject', async () => {
    tx.product.findUnique.mockResolvedValue(
      productRow({
        cashPrice: null,
        installmentPrice: null,
        prices: [{ amount: '9900', deletedAt: new Date() }],
      }),
    );

    await expect(service.completePhotos('p-1', 'user-9')).rejects.toThrow(/ราคาขาย/);
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
  });

  it('สถานะ IN_STOCK/RESERVED (ยืนยันรูปเฉย ๆ) ไม่โดนด่านราคา และไม่เขียน audit เข้าคลัง', async () => {
    tx.product.findUnique.mockResolvedValue(
      productRow({ status: 'RESERVED', cashPrice: null, installmentPrice: null }),
    );

    const res = await service.completePhotos('p-1', 'user-9');

    expect(res.status).toBe('RESERVED');
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
