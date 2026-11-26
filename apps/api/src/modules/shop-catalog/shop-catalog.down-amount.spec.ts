import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ShopCatalogService } from './shop-catalog.service';
import { InstallmentPreviewService } from './installment-preview.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListProductsDto } from './dto/list-products.dto';

/**
 * สเปค 2026-11-25 รอบ 2 — เงินดาวน์เป็นบาท (สถานะ ②)
 * fixture ชุดเดียวกับ shop-catalog.rate2.spec.ts: ดาวน์ขั้นต่ำเรท 1 = 15% · เรท 2 ดาวน์ขั้นต่ำ 30%
 * ราคาส่งเรท 2 ของ iPhone 14 Pro 128GB = 22,500 → ราคาขาย 15,000 = ฟรีดาวน์ · 16,700 = ดาวน์ 1,000 · 19,900 = ดาวน์ 4,200
 */
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

// เครื่องตัวอย่าง — ดาวน์ขั้นต่ำเรท 1 = ราคาผ่อน × 15% ปัดขึ้นหลักร้อย
/** ราคาผ่อน 15,000 → เรท 1 ขั้นต่ำ 2,300 · เรท 2 ฟรีดาวน์ */
const free = () => usedUnit();
/** ราคาผ่อน 19,900 → เรท 1 ขั้นต่ำ 3,000 · เรท 2 ดาวน์ 4,200 */
const paid = () => usedUnit({ id: 'u-paid', installmentPrice: 19900, cashPrice: 18000 });
/** ราคาผ่อน 30,000 → เรท 1 ขั้นต่ำ 4,500 · ไม่มีเรท 2 (ไม่มีราคากลางของรุ่น) */
const bcOnly = () =>
  usedUnit({ id: 'u-bc', model: 'iPhone 8', installmentPrice: 30000, cashPrice: 28000 });
/** ราคาผ่อน 30,000 → เรท 1 ขั้นต่ำ 4,500 · ราคาขายเรท 2 16,700 → เรท 2 ดาวน์ 1,000 */
const low2 = () =>
  usedUnit({
    id: 'u-low2',
    installmentPrice: 30000,
    cashPrice: 28000,
    financePrice: new Prisma.Decimal('16700'),
  });
/** ไม่มีราคาผ่อน → คิดไม่ได้ทั้งสองเรท */
const noQuote = () =>
  usedUnit({ id: 'u-none', model: 'iPhone 8', installmentPrice: null, cashPrice: 9000 });
const all = () => [free(), paid(), bcOnly(), low2(), noQuote()];

describe('หน้ารวม: เงินดาวน์เป็นบาท (สถานะ ②)', () => {
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
      systemConfig: {
        findFirst: jest.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(where.key === 'gfin.minDownPct' ? { value: '30' } : null),
        ),
      },
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

  const ids = (res: { data: Array<{ id: string }> }) => res.data.map((d) => d.id).sort();

  it('ไม่ส่ง downAmount → รายการและตัวเลขเท่าเดิม · overBudgetCount 0 · nextDownFrom null', async () => {
    prisma.product.findMany.mockResolvedValue(all());
    const res = await catalog.listGroupedByModel({});
    const byId = new Map(res.data.map((d) => [d.id, d]));
    expect(res.total).toBe(5);
    expect(res.overBudgetCount).toBe(0);
    expect(res.nextDownFrom).toBeNull();
    expect(byId.get('u-free')!.downAmount).toBe(2300);
    expect(byId.get('u-paid')!.downAmount).toBe(3000);
    expect(byId.get('u-bc')!.downAmount).toBe(4500);
    expect(byId.get('u-low2')!.rate2).toEqual({ down: 1000, monthly: 2923, months: 12 });
    expect(byId.get('u-none')!.monthlyPaymentFrom).toBeNull();
    expect(byId.get('u-none')!.rate2).toBeNull();
  });

  it('downAmount ≥ ดาวน์ขั้นต่ำเรท 1 → ดาวน์เท่าที่ส่ง ค่างวดลดลง', async () => {
    prisma.product.findMany.mockResolvedValue([paid()]);
    const base = await catalog.listGroupedByModel({});
    const res = await catalog.listGroupedByModel({ downAmount: 5000 });
    expect(res.data[0].downAmount).toBe(5000);
    expect(res.data[0].installmentMonths).toBe(12);
    expect(res.data[0].monthlyPaymentFrom).toBeLessThan(base.data[0].monthlyPaymentFrom!);
    expect(res.overBudgetCount).toBe(0);
  });

  it('เท่าดาวน์ขั้นต่ำพอดี → ได้เรท 1 เท่ากับตอนไม่ใส่อะไร · ต่ำกว่า 1 บาท → ไม่มีเรท 1 (ช่องเป็น null)', async () => {
    prisma.product.findMany.mockResolvedValue([free()]);
    const base = await catalog.listGroupedByModel({});
    const exact = await catalog.listGroupedByModel({ downAmount: 2300 });
    expect(exact.data[0].downAmount).toBe(2300);
    expect(exact.data[0].monthlyPaymentFrom).toBe(base.data[0].monthlyPaymentFrom);

    // เครื่องนี้ฟรีดาวน์ จึงยังอยู่ในรายการแม้เงินไม่พอเรท 1
    const under = await catalog.listGroupedByModel({ downAmount: 2299 });
    expect(under.data).toHaveLength(1);
    expect(under.data[0].monthlyPaymentFrom).toBeNull();
    expect(under.data[0].downAmount).toBeNull();
    expect(under.data[0].installmentMonths).toBeNull();
    expect(under.data[0].rate2).toEqual({ down: 0, monthly: 2923, months: 12 });
  });

  it('เกินเพดาน → ตรึงที่ 90% ของราคาผ่อน (ปัดลงเป็นบาทเต็ม)', async () => {
    prisma.product.findMany.mockResolvedValue([paid()]);
    const res = await catalog.listGroupedByModel({ downAmount: 50000 });
    expect(res.data[0].downAmount).toBe(17910);
    expect(res.data[0].monthlyPaymentFrom).not.toBeNull();
  });

  it('เงินไม่พอเรท 1 แต่ดาวน์ของแผนเรท 2 ≤ เงิน → ยังอยู่ในรายการ', async () => {
    prisma.product.findMany.mockResolvedValue([low2()]);
    const res = await catalog.listGroupedByModel({ downAmount: 2000 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].monthlyPaymentFrom).toBeNull();
    expect(res.data[0].downAmount).toBeNull();
    expect(res.data[0].rate2).toEqual({ down: 1000, monthly: 2923, months: 12 });
    expect(res.overBudgetCount).toBe(0);
    expect(res.nextDownFrom).toBeNull();
  });

  it('ไม่พอทั้งสองเรท → ตัดออก + นับ · nextDownFrom = ค่าน้อยสุดของ min(เรท 1, เรท 2) · เครื่องที่คิดไม่ได้เลยไม่แสดงและไม่นับ', async () => {
    prisma.product.findMany.mockResolvedValue(all());
    const low = await catalog.listGroupedByModel({ downAmount: 500 });
    expect(ids(low)).toEqual(['u-free']);
    expect(low.total).toBe(1);
    expect(low.overBudgetCount).toBe(3); // u-paid (3,000) · u-bc (4,500) · u-low2 (1,000)
    expect(low.nextDownFrom).toBe(1000);

    const mid = await catalog.listGroupedByModel({ downAmount: 2500 });
    expect(ids(mid)).toEqual(['u-free', 'u-low2']);
    expect(mid.overBudgetCount).toBe(2);
    expect(mid.nextDownFrom).toBe(3000);
    expect(new Map(mid.data.map((d) => [d.id, d])).get('u-free')!.downAmount).toBe(2500);
  });

  it('ตัวนับไม่ขึ้นกับการแบ่งหน้า · freeDownCount นับก่อนตัดเงิน', async () => {
    prisma.product.findMany.mockResolvedValue(all());
    const res = await catalog.listGroupedByModel({ downAmount: 2500, limit: 1, page: 2 });
    expect(res.data).toHaveLength(1);
    expect(res.total).toBe(2);
    expect(res.overBudgetCount).toBe(2);
    expect(res.nextDownFrom).toBe(3000);
    expect(res.freeDownCount).toBe(1);
  });

  it('freeDown=true ชนะ downAmount · downAmount=0 = freeDown=true', async () => {
    prisma.product.findMany.mockResolvedValue(all());
    const both = await catalog.listGroupedByModel({ freeDown: true, downAmount: 500 });
    expect(ids(both)).toEqual(['u-free']);
    expect(both.overBudgetCount).toBe(0);
    expect(both.nextDownFrom).toBeNull();
    expect(both.data[0].downAmount).toBe(2300); // ไม่ใช้เงิน 500 กับเรท 1

    const zero = await catalog.listGroupedByModel({ downAmount: 0 });
    expect(ids(zero)).toEqual(['u-free']);
    expect(zero.overBudgetCount).toBe(0);
    expect(zero.nextDownFrom).toBeNull();
  });

  it('ส่งทั้ง downAmount และ downPct → downAmount ชนะ · ไม่ส่ง downAmount → downPct เดิมยังใช้ได้', async () => {
    prisma.product.findMany.mockResolvedValue([paid()]);
    const both = await catalog.listGroupedByModel({ downAmount: 5000, downPct: 40 });
    expect(both.data[0].downAmount).toBe(5000);
    const legacy = await catalog.listGroupedByModel({ downPct: 40 });
    expect(legacy.data[0].downAmount).toBe(8000); // 19,900 × 40% = 7,960 → ปัดขึ้นหลักร้อย
    expect(legacy.overBudgetCount).toBe(0);
  });

  it('parity: เรท 1 ที่เงินดาวน์ X = หน้ารายละเอียดที่ส่ง customDownAmount X', async () => {
    prisma.product.findMany.mockResolvedValue([paid()]);
    prisma.product.findFirst.mockResolvedValue({
      id: 'u-paid',
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
    const list = await catalog.listGroupedByModel({ downAmount: 5000, months: 12 });
    const detail = await preview.preview({
      productId: 'u-paid',
      provider: 'BC',
      months: 12,
      customDownAmount: 5000,
    });
    expect(detail.available).toBe(true);
    expect(list.data[0].downAmount).toBe(5000);
    expect(list.data[0].downAmount).toBe(Math.ceil(detail.downAmount!));
    expect(list.data[0].monthlyPaymentFrom).toBe(Math.ceil(detail.monthlyPayment!));
    expect(list.data[0].installmentMonths).toBe(detail.months);
  });

  it('การ์ดกลุ่ม (มือ 1): เรท 1 คิดจากราคาผ่อนต่ำสุดของกลุ่ม · เงินไม่พอเรท 1 แต่ฟรีดาวน์ → ยังอยู่', async () => {
    prisma.product.groupBy.mockResolvedValue([
      {
        brand: 'Apple',
        model: 'iPhone 14 Pro',
        storage: '128GB',
        category: 'PHONE_NEW',
        deviceOrigin: 'THAI',
        _min: {
          cashPrice: new Prisma.Decimal('14000'),
          installmentPrice: new Prisma.Decimal('15000'),
        },
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
    const under = await catalog.listGroupedByModel({ condition: 'NEW', downAmount: 2000 });
    expect(under.data).toHaveLength(1);
    expect(under.data[0].kind).toBe('GROUP');
    expect(under.data[0].downAmount).toBeNull();
    expect(under.data[0].rate2?.down).toBe(0);

    const enough = await catalog.listGroupedByModel({ condition: 'NEW', downAmount: 2300 });
    expect(enough.data[0].downAmount).toBe(2300);
    expect(enough.data[0].monthlyPaymentFrom).not.toBeNull();
  });

  it('ไม่ส่งตัวเลขภายใน (ดาวน์ขั้นต่ำที่ใช้ตัดรายการ · ราคาส่ง / ส่วนลดดาวน์ของเรท 2) ออกในคำตอบ', async () => {
    prisma.product.findMany.mockResolvedValue(all());
    const res = await catalog.listGroupedByModel({ downAmount: 2500 });
    for (const item of res.data) expect(Object.keys(item)).not.toContain('rate1MinDown');
    expect(JSON.stringify(res)).not.toMatch(/gfinSubmitPrice|downDiscount|maxPrice/);
  });
});

describe('ListProductsDto.downAmount', () => {
  // ValidationPipe กลางเปิด enableImplicitConversion — จำลองแบบเดียวกัน
  const parse = (raw: Record<string, unknown>) =>
    plainToInstance(ListProductsDto, raw, { enableImplicitConversion: true });
  const messages = (raw: Record<string, unknown>) =>
    validateSync(parse(raw))
      .filter((e) => e.property === 'downAmount')
      .flatMap((e) => Object.values(e.constraints ?? {}));

  it('สตริงตัวเลข → จำนวนเต็มบาท · ไม่ส่ง / สตริงว่าง → undefined (ไม่ใช่ 0 ซึ่งแปลว่าฟรีดาวน์)', () => {
    expect(parse({ downAmount: '5000' }).downAmount).toBe(5000);
    expect(parse({ downAmount: '0' }).downAmount).toBe(0);
    expect(parse({ downAmount: '' }).downAmount).toBeUndefined();
    expect(parse({}).downAmount).toBeUndefined();
    expect(parse({ downAmount: ' ' }).downAmount).toBeUndefined();
    expect(parse({ downAmount: '  5000 ' }).downAmount).toBe(5000);
    expect(messages({ downAmount: '5000' })).toEqual([]);
    expect(messages({ downAmount: '' })).toEqual([]);
    expect(messages({ downAmount: ' ' })).toEqual([]);
  });

  it('ติดลบ / ทศนิยม / ไม่ใช่ตัวเลข / เกินเพดาน → ปฏิเสธด้วยข้อความไทย', () => {
    expect(messages({ downAmount: '-1' })).toContain('เงินดาวน์ต้องไม่ติดลบ');
    expect(messages({ downAmount: '12.5' })).toContain('เงินดาวน์ต้องเป็นจำนวนเต็มบาท');
    expect(messages({ downAmount: 'abc' })).toContain('เงินดาวน์ต้องเป็นจำนวนเต็มบาท');
    expect(messages({ downAmount: '10000000' })).toContain('เงินดาวน์เกินจำนวนที่รับได้');
  });
});
