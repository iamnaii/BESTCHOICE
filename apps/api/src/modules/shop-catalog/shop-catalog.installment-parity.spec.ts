import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ShopCatalogService } from './shop-catalog.service';
import { InstallmentPreviewService } from './installment-preview.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Red line §10: หน้ารายการกับหน้ารายละเอียดต้องอ้างเลขเดียวกัน
 * ถ้าใครแก้ config resolution หรือ input ของ calcBcInstallment ข้างใดข้างหนึ่ง
 * เทสต์นี้จะแดงทันที
 */
describe('ผ่อนเริ่มต้นหน้ารายการ === InstallmentPreviewService ที่ input เดียวกัน', () => {
  const INTEREST_CONFIG = {
    id: 'c1',
    minDownPaymentPct: new Prisma.Decimal('0.15'),
    storeCommissionPct: new Prisma.Decimal('0.10'),
    vatPct: new Prisma.Decimal('0.07'),
    minInstallmentMonths: 5,
    maxInstallmentMonths: 12,
    interestRate: new Prisma.Decimal('0.0417'),
    rates: [{ months: 12, ratePct: new Prisma.Decimal('0.50'), deletedAt: null }],
  };

  let catalog: ShopCatalogService;
  let preview: InstallmentPreviewService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        groupBy: jest.fn(),
        findUnique: jest.fn(),
      },
      interestConfig: { findFirst: jest.fn().mockResolvedValue(INTEREST_CONFIG) },
      gfinModelMapping: { findMany: jest.fn() },
      gfinOverpriceRule: { findMany: jest.fn() },
      gfinRateFactor: { findFirst: jest.fn() },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ShopCatalogService,
        InstallmentPreviewService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    catalog = mod.get(ShopCatalogService);
    preview = mod.get(InstallmentPreviewService);
  });

  it('คืนค่างวดจาก installmentPrice + InterestConfig (ไม่ใช่ rate ปลอม 0.0099)', async () => {
    prisma.product.groupBy.mockResolvedValue([
      {
        brand: 'Apple',
        model: 'iPhone 14 Pro',
        storage: '128GB',
        category: 'PHONE_USED',
        _min: { cashPrice: 17900, installmentPrice: 19900 },
        _count: { id: 2 },
      },
    ]);
    // Deviation from brief's literal mock: InstallmentPreviewService.preview() calls
    // prisma.product.findFirst (not findUnique — verified by reading the untouched service).
    // listGroupedByModel's "sample" lookup ALSO calls product.findFirst, so both consumers
    // share this one mock — the returned object is a superset covering both call sites'
    // field needs (id/gallery/conditionGrade for the catalog sample; installmentPrice/prices/
    // category/brand/model/storage/deletedAt for the preview lookup).
    prisma.product.findFirst.mockResolvedValue({
      id: 'rep',
      gallery: [],
      conditionGrade: 'A',
      installmentPrice: new Prisma.Decimal('19900'),
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deletedAt: null,
    });

    const list = await catalog.listGroupedByModel({});
    const p = await preview.preview({ productId: 'rep', provider: 'BC', months: 12 });

    expect(p.available).toBe(true);
    expect(list.data[0].monthlyPaymentFrom).toBe(Math.ceil(p.monthlyPayment!));
    // golden: 19,900 / 12 งวด / ดาวน์ 15% → 2,413.21 → ปัดขึ้นเป็น 2,414
    expect(list.data[0].monthlyPaymentFrom).toBe(2414);
  });

  it('คืน null เมื่อกลุ่มไม่มี installmentPrice (หน้าเว็บจะไม่แสดงบรรทัดผ่อน)', async () => {
    prisma.product.groupBy.mockResolvedValue([
      {
        brand: 'Apple',
        model: 'iPhone 12',
        storage: '64GB',
        category: 'PHONE_USED',
        _min: { cashPrice: 9900, installmentPrice: null },
        _count: { id: 1 },
      },
    ]);
    prisma.product.findFirst.mockResolvedValue({ id: 'rep2', gallery: [], conditionGrade: 'B' });

    const list = await catalog.listGroupedByModel({});
    expect(list.data[0].monthlyPaymentFrom).toBeNull();
    expect(list.data[0].minPrice).toBe(9900);
  });

  it('คืน null เมื่อไม่มี InterestConfig ที่ใช้ได้ — ไม่เดาเลขเอง', async () => {
    prisma.interestConfig.findFirst.mockResolvedValue(null);
    prisma.product.groupBy.mockResolvedValue([
      {
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '128GB',
        category: 'PHONE_NEW',
        _min: { cashPrice: 29900, installmentPrice: 32900 },
        _count: { id: 1 },
      },
    ]);
    prisma.product.findFirst.mockResolvedValue({ id: 'rep3', gallery: [], conditionGrade: null });

    const list = await catalog.listGroupedByModel({});
    expect(list.data[0].monthlyPaymentFrom).toBeNull();
  });

  it('resolve InterestConfig ไม่เกิน 1 ครั้งต่อ category ต่อ 1 request', async () => {
    prisma.product.groupBy.mockResolvedValue([
      {
        brand: 'Apple',
        model: 'A',
        storage: '128GB',
        category: 'PHONE_USED',
        _min: { cashPrice: 1, installmentPrice: 19900 },
        _count: { id: 1 },
      },
      {
        brand: 'Apple',
        model: 'B',
        storage: '128GB',
        category: 'PHONE_USED',
        _min: { cashPrice: 2, installmentPrice: 19900 },
        _count: { id: 1 },
      },
      {
        brand: 'Apple',
        model: 'C',
        storage: '256GB',
        category: 'PHONE_NEW',
        _min: { cashPrice: 3, installmentPrice: 19900 },
        _count: { id: 1 },
      },
    ]);
    prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'A' });

    await catalog.listGroupedByModel({});
    expect(prisma.interestConfig.findFirst).toHaveBeenCalledTimes(2);
  });
});
