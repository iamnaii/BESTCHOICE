import * as Sentry from '@sentry/nestjs';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { ShopCatalogService } from './shop-catalog.service';
import { InstallmentPreviewService } from './installment-preview.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListProductsDto } from './dto/list-products.dto';

/** สเปค 2026-11-25: แผนเรท 2 บนการ์ดหน้ารวม = เรท 2 ของหน้ารายละเอียดที่ค่าตั้งต้น */
function usedUnit(over: Record<string, unknown> = {}) {
  return {
    id: 'u-free',
    brand: 'Apple',
    model: 'iPhone 14 Pro',
    storage: '128GB',
    color: 'ดำ',
    category: 'PHONE_USED',
    deviceOrigin: 'THAI',
    cashPrice: 14000,
    installmentPrice: 15000,
    financePrice: null,
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
const MAPPING_USED = {
  id: 'm1',
  gfinSeries: 'iPhone 14',
  gfinVariant: 'Pro',
  storage: '128GB',
  condition: 'HAND_2',
  maxPrice: new Prisma.Decimal('21500'),
  modelMatchPattern: 'iPhone 14 Pro',
  isActive: true,
};
const MAPPING_NEW = { ...MAPPING_USED, id: 'm2', condition: 'HAND_1' };
const RULE_USED = {
  id: 'r1',
  label: 'iPhone 14 มือ 2',
  seriesPattern: 'iPhone 14|iPhone 15',
  condition: 'HAND_2',
  allowance: new Prisma.Decimal('1000'),
  maxMonths: null,
  minDownPct: null,
  isActive: true,
};
const RULE_NEW = { ...RULE_USED, id: 'r2', label: 'iPhone 14 มือ 1', condition: 'HAND_1' };
const FACTOR = {
  months: 12,
  shopCommissionPct: 15,
  factor: new Prisma.Decimal('0.179238'),
  feePerInstallment: new Prisma.Decimal('100'),
  isActive: true,
};

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

describe('หน้ารวม: แผนเรท 2 ของการ์ด + ตัวกรองฟรีดาวน์', () => {
  let catalog: ShopCatalogService;
  let preview: InstallmentPreviewService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      interestConfig: { findFirst: jest.fn().mockResolvedValue(INTEREST_CONFIG) },
      companyInfo: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ vatRegistered: true, vatRate: new Prisma.Decimal('0.07') }),
      },
      gfinModelMapping: { findMany: jest.fn().mockResolvedValue([MAPPING_USED, MAPPING_NEW]) },
      gfinOverpriceRule: { findMany: jest.fn().mockResolvedValue([RULE_USED, RULE_NEW]) },
      gfinRateFactor: {
        findMany: jest.fn().mockResolvedValue([FACTOR]),
        findFirst: jest.fn().mockResolvedValue(FACTOR),
      },
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      // ดาวน์ขั้นต่ำเรท 2 = 30% (ตัวอย่างเดียวกับ installment-preview.service.spec.ts)
      systemConfig: {
        findFirst: jest.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(where.key === 'gfin.minDownPct' ? { value: '30' } : null),
        ),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [ShopCatalogService, InstallmentPreviewService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    catalog = mod.get(ShopCatalogService);
    preview = mod.get(InstallmentPreviewService);
  });

  it('เครื่องมือสอง: ส่วนต่างราคาครอบดาวน์ → rate2.down = 0 · ไม่ครอบ → ดาวน์จริง', async () => {
    prisma.product.findMany.mockResolvedValue([
      usedUnit(),
      usedUnit({ id: 'u-paid', installmentPrice: 19900, cashPrice: 18000 }),
    ]);
    const res = await catalog.listGroupedByModel({});
    const byId = new Map(res.data.map((d) => [d.id, d]));
    expect(byId.get('u-free')!.rate2).toEqual({ down: 0, monthly: 2923, months: 12 });
    expect(byId.get('u-paid')!.rate2).toEqual({ down: 4200, monthly: 2923, months: 12 });
    expect(res.freeDownCount).toBe(1);
  });

  it('มีราคาขายเรท 2 ของเครื่อง (financePrice) → คิดจากราคานั้น ไม่ใช่ราคาผ่อน', async () => {
    prisma.product.findMany.mockResolvedValue([
      usedUnit({ installmentPrice: 19900, financePrice: new Prisma.Decimal('15000') }),
    ]);
    const res = await catalog.listGroupedByModel({});
    expect(res.data[0].rate2).toEqual({ down: 0, monthly: 2923, months: 12 });
  });

  it('เรท 2 คิดไม่ได้ (ไม่มีราคากลางของรุ่น) → rate2 = null การ์ดยังขึ้น', async () => {
    prisma.product.findMany.mockResolvedValue([usedUnit({ model: 'iPhone 8' })]);
    const res = await catalog.listGroupedByModel({});
    expect(res.data).toHaveLength(1);
    expect(res.data[0].rate2).toBeNull();
    expect(res.freeDownCount).toBe(0);
  });

  it('ไม่มีราคาผ่อน (null / 0) แม้มี financePrice → rate2 = null · ไม่นับใน freeDownCount', async () => {
    prisma.product.findMany.mockResolvedValue([
      usedUnit({ id: 'u-null', installmentPrice: null, financePrice: new Prisma.Decimal('15000') }),
      usedUnit({ id: 'u-zero', installmentPrice: 0, financePrice: new Prisma.Decimal('15000') }),
    ]);
    const res = await catalog.listGroupedByModel({});
    for (const d of res.data) expect(d.rate2).toBeNull();
    expect(res.freeDownCount).toBe(0);
  });

  it('อ่านตั้งค่าเรท 2 ไม่ได้ → ทุกการ์ด rate2 = null แต่หน้ารวมไม่ล้ม', async () => {
    prisma.product.findMany.mockResolvedValue([usedUnit()]);
    prisma.gfinModelMapping.findMany.mockRejectedValue(new Error('db down'));
    jest.spyOn(catalog['logger'], 'warn').mockImplementation(() => undefined);
    const res = await catalog.listGroupedByModel({});
    expect(res.data[0].rate2).toBeNull();
    expect(res.data[0].monthlyPaymentFrom).not.toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { subsystem: 'shop-catalog-rate2' },
    });
  });

  it('% ดาวน์และจำนวนงวดของคำขอไม่เปลี่ยน rate2', async () => {
    prisma.product.findMany.mockResolvedValue([usedUnit({ id: 'u-paid', installmentPrice: 19900 })]);
    const base = await catalog.listGroupedByModel({});
    const changed = await catalog.listGroupedByModel({ downPct: 40, months: 12 });
    expect(changed.data[0].rate2).toEqual(base.data[0].rate2);
    expect(changed.data[0].downAmount).not.toBe(base.data[0].downAmount);
  });

  it('freeDown=true → เหลือเฉพาะเครื่องฟรีดาวน์ · กรองก่อนแบ่งหน้า · ตัวนับไม่ขึ้นกับหน้า', async () => {
    prisma.product.findMany.mockResolvedValue([
      usedUnit({ id: 'f1' }),
      usedUnit({ id: 'p1', installmentPrice: 19900 }),
      usedUnit({ id: 'f2' }),
    ]);
    const all = await catalog.listGroupedByModel({ limit: 1, page: 2 });
    expect(all.total).toBe(3);
    expect(all.freeDownCount).toBe(2);

    const free = await catalog.listGroupedByModel({ freeDown: true, limit: 1, page: 2 });
    expect(free.total).toBe(2);
    expect(free.freeDownCount).toBe(2);
    expect(free.data).toHaveLength(1);
    expect(free.data[0].rate2?.down).toBe(0);
  });

  it('การ์ดกลุ่ม (มือ 1): คิดแผนเรท 2 จากเครื่องที่การ์ดลิงก์ไป', async () => {
    prisma.product.groupBy.mockResolvedValue([
      {
        brand: 'Apple',
        model: 'iPhone 14 Pro',
        storage: '128GB',
        category: 'PHONE_NEW',
        deviceOrigin: 'THAI',
        _min: { cashPrice: new Prisma.Decimal('14000'), installmentPrice: new Prisma.Decimal('15000') },
        _max: { createdAt: new Date('2026-01-01T00:00:00Z') },
        _count: { id: 2 },
      },
    ]);
    prisma.product.findFirst.mockResolvedValue({
      id: 's1',
      gallery: [],
      conditionGrade: null,
      installmentPrice: new Prisma.Decimal('15000'),
      financePrice: null,
      warrantyExpired: null,
      warrantyExpireDate: null,
    });
    const res = await catalog.listGroupedByModel({ condition: 'NEW' });
    expect(res.data[0].kind).toBe('GROUP');
    expect(res.data[0].rate2).toEqual({ down: 0, monthly: 2923, months: 12 });
  });

  it('parity: rate2 ของการ์ด = หน้ารายละเอียดที่ไม่ส่งงวด/ดาวน์ (ปัดขึ้นเป็นบาทเต็ม)', async () => {
    prisma.product.findMany.mockResolvedValue([usedUnit({ id: 'rep', installmentPrice: 19900 })]);
    prisma.product.findFirst.mockResolvedValue({
      id: 'rep',
      installmentPrice: new Prisma.Decimal('19900'),
      financePrice: null,
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deviceOrigin: 'THAI',
      warrantyExpired: null,
      warrantyExpireDate: null,
      deletedAt: null,
    });
    const list = await catalog.listGroupedByModel({});
    const detail = await preview.preview({ productId: 'rep', provider: 'GFIN' });
    expect(detail.available).toBe(true);
    expect(list.data[0].rate2).toEqual({
      down: Math.ceil(detail.downAmount!),
      monthly: Math.ceil(detail.monthlyPayment!),
      months: detail.months,
    });
  });
});

describe('ListProductsDto.freeDown', () => {
  // ValidationPipe กลางเปิด enableImplicitConversion — สตริง "false" ต้องไม่กลายเป็น true
  const parse = (raw: Record<string, unknown>) =>
    plainToInstance(ListProductsDto, raw, { enableImplicitConversion: true }).freeDown;

  it('true / 1 = เปิด · อย่างอื่น = ปิด · ไม่ส่ง = undefined', () => {
    expect(parse({ freeDown: 'true' })).toBe(true);
    expect(parse({ freeDown: '1' })).toBe(true);
    expect(parse({ freeDown: 'false' })).toBe(false);
    expect(parse({ freeDown: '0' })).toBe(false);
    expect(parse({})).toBeUndefined();
  });
});
