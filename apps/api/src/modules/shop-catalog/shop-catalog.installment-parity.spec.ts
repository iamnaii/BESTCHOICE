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
/**
 * Second-hand no longer groups (owner rule 2026-08-21) — it comes back from a
 * findMany of individual devices. These specs are about the ผ่อน figure, so the
 * shape moved but the assertions did not.
 */
function usedUnit(over: Record<string, unknown> = {}) {
  return {
    id: 'rep',
    brand: 'Apple',
    model: 'iPhone 14 Pro',
    storage: '128GB',
    color: 'ดำ',
    category: 'PHONE_USED',
    cashPrice: 17900,
    installmentPrice: 19900,
    conditionGrade: 'A',
    batteryHealth: null,
    hasBox: null,
    warrantyExpireDate: null,
    warrantyExpired: null,
    stockInDate: null,
    imeiSerial: null,
    gallery: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

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
        // listGroupedByModel now issues BOTH a groupBy (new stock) and a
        // findMany (second-hand devices) on every call — default each to empty
        // so a test only has to mock the half it cares about.
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
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
    prisma.product.findMany.mockResolvedValue([usedUnit()]);
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

  // review round 1 [Important]: fixture เดิมมี tenure เดียว — mutation เลือก allowedMonths[0]
  // (งวดสั้นสุด) รอดทุกเทสต์; เคสนี้ pin กติกา spec §6 "งวดยาวสุดที่มีเรตชนะ" ด้วย config 2 tenure
  it('config มีหลาย tenure → ใช้งวดยาวสุด (spec §6) ไม่ใช่งวดสั้นสุด', async () => {
    prisma.interestConfig.findFirst.mockResolvedValue({
      ...INTEREST_CONFIG,
      rates: [
        { months: 6, ratePct: new Prisma.Decimal('0.25'), deletedAt: null },
        { months: 12, ratePct: new Prisma.Decimal('0.50'), deletedAt: null },
      ],
    });
    prisma.product.findMany.mockResolvedValue([usedUnit()]);
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
    const at12 = await preview.preview({ productId: 'rep', provider: 'BC', months: 12 });
    const at6 = await preview.preview({ productId: 'rep', provider: 'BC', months: 6 });

    expect(at12.available).toBe(true);
    expect(at6.available).toBe(true);
    expect(list.data[0].monthlyPaymentFrom).toBe(Math.ceil(at12.monthlyPayment!));
    expect(list.data[0].monthlyPaymentFrom).not.toBe(Math.ceil(at6.monthlyPayment!));
  });

  it('คืน null เมื่อกลุ่มไม่มี installmentPrice (หน้าเว็บจะไม่แสดงบรรทัดผ่อน)', async () => {
    prisma.product.findMany.mockResolvedValue([
      usedUnit({ id: 'rep2', model: 'iPhone 12', storage: '64GB', cashPrice: 9900, installmentPrice: null, conditionGrade: 'B' }),
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
        _max: { createdAt: new Date('2026-01-01T00:00:00Z') },
      },
    ]);
    prisma.product.findFirst.mockResolvedValue({ id: 'rep3', gallery: [], conditionGrade: null });

    const list = await catalog.listGroupedByModel({});
    expect(list.data[0].monthlyPaymentFrom).toBeNull();
  });

  // final-review minor (T6): edge guards ใน monthlyFrom ถูกต้องแต่ไม่เคยมีเทสต์
  it('installmentPrice ติดลบ/ศูนย์ → monthlyPaymentFrom = null (ไม่ throw ไม่เดา)', async () => {
    prisma.product.findMany.mockResolvedValue([
      usedUnit({ id: 'x', model: 'X', storage: '64GB', cashPrice: 100, installmentPrice: -5 }),
      usedUnit({ id: 'y', model: 'Y', storage: '64GB', cashPrice: 100, installmentPrice: 0 }),
    ]);
    prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'A' });
    const list = await catalog.listGroupedByModel({});
    expect(list.data[0].monthlyPaymentFrom).toBeNull();
    expect(list.data[1].monthlyPaymentFrom).toBeNull();
  });

  it('config มีแต่ rates ที่ถูกลบ (allowedMonths ว่าง) → null', async () => {
    // min > max → loop สังเคราะห์เรตไม่รัน → allowedMonths ว่าง (ratePctByMonths ว่าง)
    prisma.interestConfig.findFirst.mockResolvedValue({
      ...INTEREST_CONFIG,
      minInstallmentMonths: 5,
      maxInstallmentMonths: 4,
      rates: [],
    });
    prisma.product.findMany.mockResolvedValue([
      usedUnit({ id: 'z', model: 'Z', storage: '64GB', cashPrice: 100 }),
    ]);
    prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'A' });
    const list = await catalog.listGroupedByModel({});
    expect(list.data[0].monthlyPaymentFrom).toBeNull();
  });

  it('resolve InterestConfig ไม่เกิน 1 ครั้งต่อ category ต่อ 1 request', async () => {
    prisma.product.findMany.mockResolvedValue([
      usedUnit({ id: 'a', model: 'A', cashPrice: 1 }),
      usedUnit({ id: 'b', model: 'B', cashPrice: 2 }),
    ]);
    prisma.product.groupBy.mockResolvedValue([
      {
        brand: 'Apple',
        model: 'C',
        storage: '256GB',
        category: 'PHONE_NEW',
        _min: { cashPrice: 3, installmentPrice: 19900 },
        _count: { id: 1 },
        _max: { createdAt: new Date('2026-01-02T00:00:00Z') },
      },
    ]);
    prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'A' });

    await catalog.listGroupedByModel({});
    expect(prisma.interestConfig.findFirst).toHaveBeenCalledTimes(2);
  });
});
