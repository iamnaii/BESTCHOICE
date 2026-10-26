import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductScanService, type ScanActor } from './product-scan.service';

/**
 * ยิง QR/IMEI ที่หน้าขาย (A4 · 2026-10-22) — ค้นค่าเท่ากันแล้วตัดสิน "ขายได้ไหม เพราะอะไร"
 * ลำดับตัดสินตาม spec: ไม่พบ → ขายแล้ว/ติดสัญญา → สาขาอื่น → ติดจอง (ใบจอง/ร่างสัญญา/เว็บ/ไม่ทราบ) → พร้อมขาย → ยังไม่พร้อม
 */

const CODE = '351000000007919';
const SALES_B1: ScanActor = { role: 'SALES', branchId: 'b1' };

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Apple iPhone 15 128GB',
    brand: 'Apple',
    model: 'iPhone 15',
    imeiSerial: CODE,
    legacyProductCode: null,
    category: 'PHONE_NEW',
    status: 'IN_STOCK',
    branchId: 'b1',
    deletedAt: null,
    shopWarrantyDays: null,
    costPrice: '12000',
    prices: [],
    branch: { id: 'b1', name: 'ลาดพร้าว' },
    ...overrides,
  };
}

describe('ProductScanService.scan', () => {
  let service: ProductScanService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(null) },
      sale: { findFirst: jest.fn().mockResolvedValue(null) },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      booking: { findFirst: jest.fn().mockResolvedValue(null) },
      productReservation: { findFirst: jest.fn().mockResolvedValue(null) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const module = await Test.createTestingModule({
      providers: [ProductScanService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProductScanService);
  });

  it('ไม่พบ: ค้นค่าเท่ากันทั้ง IMEI / รหัสเดิม / id หลัง trim แล้วไม่เจอทั้งแถวที่ยังอยู่และแถวที่ถูกลบ', async () => {
    const outcome = await service.scan(`  ${CODE} `, SALES_B1);

    expect(outcome).toEqual({
      code: CODE,
      reason: 'NOT_FOUND',
      sellable: false,
      product: null,
      branch: null,
      booking: null,
      contract: null,
      sale: null,
      reservation: null,
    });
    expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      OR: [{ imeiSerial: CODE }, { legacyProductCode: CODE }, { id: CODE }],
    });
    expect(prisma.product.findFirst.mock.calls[1][0].where).toEqual({
      deletedAt: { not: null },
      OR: [{ imeiSerial: CODE }, { legacyProductCode: CODE }, { id: CODE }],
    });
  });

  it('เครื่องถูกลบแล้ว → DELETED (ไม่ส่งแถวที่ถูกลบออกไป)', async () => {
    prisma.product.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p-gone' });

    const outcome = await service.scan(CODE, SALES_B1);

    expect(outcome.reason).toBe('DELETED');
    expect(outcome.sellable).toBe(false);
    expect(outcome.product).toBeNull();
  });

  it('พร้อมขายในสาขาของพนักงาน → SELLABLE พร้อมแถวเต็ม + effectiveShopWarrantyDays + สาขา', async () => {
    prisma.product.findFirst.mockResolvedValueOnce(productRow());

    const outcome = await service.scan(CODE, SALES_B1);

    expect(outcome.reason).toBe('SELLABLE');
    expect(outcome.sellable).toBe(true);
    expect(outcome.product).toMatchObject({ id: 'p1', status: 'IN_STOCK', costPrice: '12000' });
    expect(typeof outcome.product?.effectiveShopWarrantyDays).toBe('number');
    expect(outcome.branch).toEqual({ id: 'b1', name: 'ลาดพร้าว' });
    expect(prisma.product.findFirst).toHaveBeenCalledTimes(1);
  });

  it('พนักงานสาขาอื่น (หรือบัญชีไม่มีสาขา) → OTHER_BRANCH · OWNER ข้ามสาขาได้ → SELLABLE', async () => {
    prisma.product.findFirst.mockResolvedValue(productRow());

    expect((await service.scan(CODE, { role: 'SALES', branchId: 'b2' })).reason).toBe('OTHER_BRANCH');
    expect((await service.scan(CODE, { role: 'SALES', branchId: null })).reason).toBe('OTHER_BRANCH');
    expect((await service.scan(CODE, { role: 'BRANCH_MANAGER' })).reason).toBe('OTHER_BRANCH');

    const owner = await service.scan(CODE, { role: 'OWNER', branchId: null });
    expect(owner.reason).toBe('SELLABLE');
    expect(owner.branch).toEqual({ id: 'b1', name: 'ลาดพร้าว' });
  });

  describe('RESERVED — ใครถือเครื่องอยู่', () => {
    beforeEach(() => {
      prisma.product.findFirst.mockResolvedValue(productRow({ status: 'RESERVED' }));
    });

    it('ใบจอง PAID ที่ล็อกเครื่อง → BOOKED (ชื่อลูกค้า + วันหมดอายุ ISO)', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce({
        id: 'bk1',
        bookingNumber: 'BK-20261020-0003',
        expireDate: new Date('2026-10-25T00:00:00.000Z'),
        customer: { name: 'สมหญิง' },
      });

      const outcome = await service.scan(CODE, SALES_B1);

      expect(outcome.reason).toBe('BOOKED');
      expect(outcome.booking).toEqual({
        id: 'bk1',
        bookingNumber: 'BK-20261020-0003',
        customerName: 'สมหญิง',
        expireDate: '2026-10-25T00:00:00.000Z',
      });
      expect(prisma.booking.findFirst.mock.calls[0][0].where).toEqual({
        lockedProductId: 'p1',
        status: 'PAID',
        deletedAt: null,
      });
    });

    it('ร่างสัญญาถือเครื่อง → DRAFT_CONTRACT', async () => {
      prisma.contract.findFirst.mockResolvedValueOnce({
        id: 'ct1',
        contractNumber: 'CT-20261022-0001',
        status: 'DRAFT',
        customer: { name: 'นายสมชาย' },
      });

      const outcome = await service.scan(CODE, SALES_B1);

      expect(outcome.reason).toBe('DRAFT_CONTRACT');
      expect(outcome.contract).toEqual({
        id: 'ct1',
        contractNumber: 'CT-20261022-0001',
        customerName: 'นายสมชาย',
        status: 'DRAFT',
      });
      expect(prisma.contract.findFirst.mock.calls[0][0].where).toEqual({
        productId: 'p1',
        status: 'DRAFT',
        deletedAt: null,
      });
    });

    it('จองผ่านเว็บที่ยังไม่หมดเวลา → WEB_RESERVED', async () => {
      prisma.productReservation.findFirst.mockResolvedValueOnce({
        id: 'r1',
        expiresAt: new Date('2026-10-22T10:30:00.000Z'),
      });

      const outcome = await service.scan(CODE, SALES_B1);

      expect(outcome.reason).toBe('WEB_RESERVED');
      expect(outcome.reservation).toEqual({ expiresAt: '2026-10-22T10:30:00.000Z' });
      expect(prisma.productReservation.findFirst.mock.calls[0][0].where).toEqual({
        productId: 'p1',
        status: 'ACTIVE',
        expiresAt: { gt: expect.any(Date) },
      });
    });

    it('ไม่พบเจ้าของ → RESERVED', async () => {
      const outcome = await service.scan(CODE, SALES_B1);
      expect(outcome.reason).toBe('RESERVED');
      expect(outcome.booking).toBeNull();
      expect(outcome.contract).toBeNull();
      expect(outcome.reservation).toBeNull();
    });
  });

  it('ขายผ่อนแล้ว + สัญญาที่ยังผูก → ON_CONTRACT', async () => {
    prisma.product.findFirst.mockResolvedValueOnce(productRow({ status: 'SOLD_INSTALLMENT' }));
    prisma.contract.findFirst.mockResolvedValueOnce({
      id: 'ct9',
      contractNumber: 'CT-20260901-0009',
      status: 'ACTIVE',
      customer: { name: 'สมศรี' },
    });

    const outcome = await service.scan(CODE, SALES_B1);

    expect(outcome.reason).toBe('ON_CONTRACT');
    expect(outcome.contract).toEqual({
      id: 'ct9',
      contractNumber: 'CT-20260901-0009',
      customerName: 'สมศรี',
      status: 'ACTIVE',
    });
    expect(prisma.contract.findFirst.mock.calls[0][0].where).toEqual({
      productId: 'p1',
      deletedAt: null,
      status: { notIn: ['DRAFT', 'CANCELED'] },
    });
  });

  it('ขายสดแล้ว → SOLD พร้อมใบขายล่าสุดที่ยังไม่ถูกยกเลิก', async () => {
    prisma.product.findFirst.mockResolvedValueOnce(productRow({ status: 'SOLD_CASH' }));
    prisma.sale.findFirst.mockResolvedValueOnce({
      id: 's1',
      saleNumber: 'S-20261020-0001',
      createdAt: new Date('2026-10-20T03:00:00.000Z'),
      customer: { name: 'สมปอง' },
    });

    const outcome = await service.scan(CODE, SALES_B1);

    expect(outcome.reason).toBe('SOLD');
    expect(outcome.sale).toEqual({
      id: 's1',
      saleNumber: 'S-20261020-0001',
      customerName: 'สมปอง',
      soldAt: '2026-10-20T03:00:00.000Z',
    });
    expect(prisma.sale.findFirst.mock.calls[0][0]).toMatchObject({
      where: { productId: 'p1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('ขายผ่านไฟแนนซ์นอก (SOLD_INSTALLMENT ไม่มีสัญญา) → SOLD จากใบขาย', async () => {
    prisma.product.findFirst.mockResolvedValueOnce(productRow({ status: 'SOLD_INSTALLMENT' }));
    prisma.sale.findFirst.mockResolvedValueOnce({
      id: 's2',
      saleNumber: 'S-20261021-0002',
      createdAt: new Date('2026-10-21T03:00:00.000Z'),
      customer: { name: 'สมใจ' },
    });

    const outcome = await service.scan(CODE, SALES_B1);

    expect(outcome.reason).toBe('SOLD');
    expect(outcome.contract).toBeNull();
    expect(outcome.sale?.saleNumber).toBe('S-20261021-0002');
  });

  it('เครื่องยึดที่ขายต่อโดยไม่มีแถวใบขาย → SOLD โดย sale เป็น null', async () => {
    prisma.product.findFirst.mockResolvedValueOnce(productRow({ status: 'SOLD_RESELL' }));

    const outcome = await service.scan(CODE, SALES_B1);

    expect(outcome.reason).toBe('SOLD');
    expect(outcome.sale).toBeNull();
  });

  it('ขายไปแล้วที่สาขาอื่น → SOLD ไม่ใช่ OTHER_BRANCH (ข้อเท็จจริงที่เฉพาะกว่าชนะ)', async () => {
    prisma.product.findFirst.mockResolvedValueOnce(
      productRow({ status: 'SOLD_CASH', branchId: 'b2', branch: { id: 'b2', name: 'สำนักงานใหญ่' } }),
    );

    const outcome = await service.scan(CODE, SALES_B1);

    expect(outcome.reason).toBe('SOLD');
    expect(outcome.branch).toEqual({ id: 'b2', name: 'สำนักงานใหญ่' });
  });

  it('สถานะอื่น (เช่น รอถ่ายรูป) → NOT_READY พร้อมสถานะบนแถว', async () => {
    prisma.product.findFirst.mockResolvedValueOnce(productRow({ status: 'PHOTO_PENDING' }));

    const outcome = await service.scan(CODE, SALES_B1);

    expect(outcome.reason).toBe('NOT_READY');
    expect(outcome.sellable).toBe(false);
    expect(outcome.product?.status).toBe('PHOTO_PENDING');
    expect(prisma.booking.findFirst).not.toHaveBeenCalled();
    expect(prisma.sale.findFirst).not.toHaveBeenCalled();
  });
});
