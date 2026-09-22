import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GetInstallmentRatesTool, PricingTemplateRateRow } from './get-installment-rates.tool';
import { RecommendDevicesTool, storageGb } from './recommend-devices.tool';
import { TRADE_IN_NOTE } from './trade-in-estimate';

/**
 * recommend_devices — ตรรกะทั้งหมดอยู่ฝั่งเซิร์ฟเวอร์ (โมเดลเรียกครั้งเดียวจบ):
 * กรองงบ → ต้องใหม่กว่าเครื่องเดิม → นับสต็อก → เรียง → diff สเปค → nearMiss → ราคาเทิร์น
 * mock: PricingTemplate ผ่าน GetInstallmentRatesTool.listAllRates (สูตร sticker-parity
 * ถูกเทสต์แยกแล้วใน get-installment-rates.tool.spec) + Product/TradeInValuation ผ่าน prisma
 */

const tpl = (over: Partial<PricingTemplateRateRow> = {}): PricingTemplateRateRow => ({
  brand: 'Apple',
  model: 'iPhone 13',
  storage: '128GB',
  category: 'PHONE_USED',
  condition: 'มือสอง',
  hasWarranty: false,
  rate1: { downPayment: 1900, monthlyPrice: 1990, termMonths: 24 },
  rate2: { downPayment: 2500, monthlyPrice: 1758, termMonths: 12 },
  ...over,
});

interface StockFixture {
  id: string;
  model: string;
  storage: string;
  category?: string;
  color?: string | null;
  batteryHealth?: number | null;
  gallery?: string[];
}

const stock = (over: StockFixture) => ({
  category: 'PHONE_USED',
  color: 'ดำ',
  batteryHealth: 90,
  gallery: [],
  ...over,
});

const makePrisma = (opts: {
  products?: ReturnType<typeof stock>[];
  valuations?: { storage: string; basePrice: Prisma.Decimal }[];
} = {}) => {
  const product = { findMany: jest.fn().mockResolvedValue(opts.products ?? []) };
  const tradeInValuation = { findMany: jest.fn().mockResolvedValue(opts.valuations ?? []) };
  const systemConfig = { findFirst: jest.fn().mockResolvedValue(null) };
  return {
    prisma: { product, tradeInValuation, systemConfig } as unknown as PrismaService,
    product,
    tradeInValuation,
  };
};

const makeRates = (rows: PricingTemplateRateRow[]) =>
  ({ listAllRates: jest.fn().mockResolvedValue(rows) }) as unknown as GetInstallmentRatesTool;

const build = (
  rows: PricingTemplateRateRow[],
  prismaOpts: Parameters<typeof makePrisma>[0] = {},
) => {
  const p = makePrisma(prismaOpts);
  return { tool: new RecommendDevicesTool(p.prisma, makeRates(rows)), ...p };
};

describe('RecommendDevicesTool.run', () => {
  it('(1) กรองดาวน์/ผ่อน: เลือกเรทที่เข้างบทั้งคู่ — ผ่านทั้ง 2 เรทเลือกที่ผ่อนต่ำกว่า', async () => {
    const { tool } = build([
      // เรท 1 ดาวน์ 1,900/ผ่อน 1,990 (ผ่อนเกิน 1,800) · เรท 2 ดาวน์ 2,500/ผ่อน 1,758 → เข้า
      tpl({ model: 'iPhone 13' }),
      // ทั้ง 2 เรทเข้างบ → ต้องเลือกเรทที่ผ่อนต่ำกว่า (เรท 1 = 1,500)
      tpl({
        model: 'iPhone 14',
        rate1: { downPayment: 2000, monthlyPrice: 1500, termMonths: 24 },
        rate2: { downPayment: 3000, monthlyPrice: 1700, termMonths: 12 },
      }),
      // ไม่เข้างบเลย (ดาวน์ 5,000)
      tpl({
        model: 'iPhone 15',
        rate1: { downPayment: 5000, monthlyPrice: 2500, termMonths: 24 },
        rate2: { downPayment: 6000, monthlyPrice: 2300, termMonths: 12 },
      }),
    ]);
    const r = await tool.run({ downBudget: 3000, monthlyBudget: 1800 });

    expect(r.current).toBeNull();
    expect(r.budget).toEqual({ down: 3000, monthly: 1800 });
    expect(r.recommended.map((d) => [d.model, d.rateLabel, d.downPayment, d.monthlyPrice])).toEqual([
      // ไม่มีสต็อกทั้งคู่ → generation ใหม่กว่ามาก่อน
      ['iPhone 14', 'เรทที่ 1', 2000, 1500],
      ['iPhone 13', 'เรทที่ 2', 2500, 1758],
    ]);
    expect(r.recommended[0].termMonths).toBe(24);
    expect(r.recommended[0].condition).toBe('มือสอง');
    expect(r.recommended.every((d) => d.downPayment <= 3000 && d.monthlyPrice <= 1800)).toBe(true);
    // ครบ 2 แล้ว → ไม่มี nearMiss, ไม่มี reason
    expect(r.nearMiss).toEqual([]);
    expect(r.reason).toBeUndefined();
  });

  it('(1b) condition มาจาก category ไม่ใช่ hasWarranty — PHONE_NEW = มือ 1, มือสองมีประกัน = มือสอง', async () => {
    const { tool } = build([
      tpl({ model: 'iPhone 16', category: 'PHONE_NEW', hasWarranty: false }),
      tpl({ model: 'iPhone 15', category: 'PHONE_USED', hasWarranty: true }),
    ]);
    const r = await tool.run({ downBudget: 99_999, monthlyBudget: 99_999 });
    expect(r.recommended.map((d) => [d.model, d.condition, d.hasWarranty])).toEqual([
      ['iPhone 16', 'มือ 1', false],
      ['iPhone 15', 'มือสอง', true],
    ]);
  });

  it('(2) ตัดรุ่นที่ไม่ใหม่กว่าเครื่องที่ใช้อยู่ (generation ≤ current) + มี diff สเปคจริง', async () => {
    const { tool } = build([
      tpl({ model: 'iPhone 11' }), // เท่าเดิม → ตัด
      tpl({ model: 'iPhone XR' }), // เก่ากว่า → ตัด
      tpl({ model: 'iPhone 11 Pro Max' }), // generation เดียวกัน → ตัด (ต้อง "ใหม่กว่า")
      tpl({ model: 'iPhone 13' }),
    ]);
    const r = await tool.run({ currentModel: 'ใช้ 11 อยู่', downBudget: 99_999, monthlyBudget: 99_999 });

    expect(r.current).toEqual({ model: 'iPhone 11', recognized: true });
    expect(r.recommended.map((d) => d.model)).toEqual(['iPhone 13']);
    const d = r.recommended[0];
    expect(d.generationGap).toBe(2);
    expect(d.betterThanCurrent.length).toBeGreaterThanOrEqual(3);
    expect(d.betterThanCurrent.join(' ')).toContain('5G');
    expect(d.worseThanCurrent).toEqual([]);
  });

  it('(2b) ใหม่กว่าไม่มีเลย → recommended ว่าง + reason ระบุรุ่น', async () => {
    const { tool } = build([tpl({ model: 'iPhone 13' }), tpl({ model: 'iPhone 14' })]);
    const r = await tool.run({ currentModel: 'iPhone 15 Pro Max', downBudget: 99_999, monthlyBudget: 99_999 });
    expect(r.recommended).toEqual([]);
    expect(r.nearMiss).toEqual([]);
    expect(r.reason).toBe('ไม่มีรุ่นที่ใหม่กว่า iPhone 15 Pro Max ในตารางราคา');
  });

  it('(3) inStock เรียงก่อน generation: 13 ที่มีของชนะ 14 ที่ไม่มี + sampleUnit = แบตสูงสุด + where เหมือน search_products', async () => {
    const { tool, product } = build(
      [tpl({ model: 'iPhone 13' }), tpl({ model: 'iPhone 14' })],
      {
        products: [
          stock({ id: 'p13-low', model: 'iPhone 13', storage: '128GB', batteryHealth: 84, color: 'ขาว' }),
          stock({ id: 'p13-hi', model: 'iPhone 13', storage: '128GB', batteryHealth: 92, color: 'ดำ', gallery: ['https://cdn/x.jpg'] }),
          // ความจุไม่ตรง template (256GB) → ไม่นับ
          stock({ id: 'p13-256', model: 'iPhone 13', storage: '256GB', batteryHealth: 99 }),
          // contains 'iPhone 13' แต่เป็นคนละรุ่น → ไม่นับ
          stock({ id: 'p13pm', model: 'iPhone 13 Pro Max', storage: '128GB', batteryHealth: 99 }),
          // รุ่นตรงแต่ category มือ 1 ≠ template มือสอง → ไม่นับ
          stock({ id: 'p13-new', model: 'iPhone 13', storage: '128GB', category: 'PHONE_NEW' }),
        ],
      },
    );
    const r = await tool.run({ currentModel: 'iPhone 11', downBudget: 99_999, monthlyBudget: 99_999 });

    expect(r.recommended.map((d) => [d.model, d.inStock, d.unitCount])).toEqual([
      ['iPhone 13', true, 2],
      ['iPhone 14', false, 0],
    ]);
    expect(r.recommended[0].sampleUnit).toEqual({
      productId: 'p13-hi',
      batteryHealth: 92,
      color: 'ดำ',
      photoUrl: 'https://cdn/x.jpg',
    });
    expect(r.recommended[1].sampleUnit).toBeUndefined();

    // where ต้องเป็นชุดเดียวกับ search_products (สต็อกที่บอทเห็น = สต็อกที่เว็บเห็น)
    expect(product.findMany).toHaveBeenCalledTimes(1);
    const where = product.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.isOnlineVisible).toBe(true);
    expect(where.status).toEqual({ in: ['IN_STOCK', 'RESERVED'] });
    expect(where.NOT).toBeUndefined(); // flag ไม่มีแถว → ไม่กรอง [DEMO] (เหมือนเว็บ)
    expect(where.OR).toEqual([
      { model: { contains: 'iPhone 13', mode: 'insensitive' } },
      { model: { contains: 'iPhone 14', mode: 'insensitive' } },
    ]);
  });

  it('(4) nearMiss: เมื่อแนะนำได้ไม่ครบ 2 คืนตัวที่ใหม่กว่าและเกินงบน้อยที่สุด พร้อม overBy', async () => {
    const { tool } = build([
      tpl({ model: 'iPhone 13' }), // เรท 2 ดาวน์ 2,500 ผ่อน 1,758 → เข้า
      // เกินงบ: เรท 2 ดาวน์ 3,200 (เกิน 200) ผ่อน 1,980 (เกิน 180) = 380 → ใกล้สุด
      tpl({
        model: 'iPhone 14',
        rate1: { downPayment: 4000, monthlyPrice: 2200, termMonths: 24 },
        rate2: { downPayment: 3200, monthlyPrice: 1980, termMonths: 12 },
      }),
      // เกินเยอะกว่า
      tpl({
        model: 'iPhone 15',
        rate1: { downPayment: 5000, monthlyPrice: 2500, termMonths: 24 },
        rate2: { downPayment: 6000, monthlyPrice: 2300, termMonths: 12 },
      }),
      // เก่ากว่า → ไม่เป็น nearMiss แม้จะถูก
      tpl({
        model: 'iPhone XR',
        rate1: { downPayment: 3100, monthlyPrice: 900, termMonths: 24 },
        rate2: { downPayment: 3100, monthlyPrice: 900, termMonths: 12 },
      }),
    ]);
    const r = await tool.run({ currentModel: 'iPhone 11', downBudget: 3000, monthlyBudget: 1800 });

    expect(r.recommended.map((d) => d.model)).toEqual(['iPhone 13']);
    expect(r.nearMiss).toHaveLength(1);
    expect(r.nearMiss[0]).toMatchObject({
      model: 'iPhone 14',
      rateLabel: 'เรทที่ 2',
      downPayment: 3200,
      monthlyPrice: 1980,
      overBy: { down: 200, monthly: 180 },
      generationGap: 3,
    });
    expect(r.reason).toBeUndefined();
  });

  it('(4b) ไม่เข้างบเลย → recommended ว่าง + reason "ในงบนี้" + nearMiss 1 ตัว', async () => {
    const { tool } = build([
      tpl({
        model: 'iPhone 13',
        rate1: { downPayment: 4000, monthlyPrice: 2200, termMonths: 24 },
        rate2: { downPayment: 3500, monthlyPrice: 2100, termMonths: 12 },
      }),
    ]);
    const r = await tool.run({ currentModel: '11', downBudget: 1000, monthlyBudget: 1000 });
    expect(r.recommended).toEqual([]);
    expect(r.nearMiss.map((d) => d.model)).toEqual(['iPhone 13']);
    expect(r.reason).toBe('ไม่มีรุ่นที่ใหม่กว่า iPhone 11 ในงบนี้');
  });

  it('(5) tradeIn: เกรด A ของรุ่นที่ใช้อยู่ — ไม่บอกความจุ → ราคาความจุต่ำสุด (conservative); บอกความจุ → แถวนั้น', async () => {
    const valuations = [
      { storage: '64GB', basePrice: new Prisma.Decimal('3500') },
      { storage: '128GB', basePrice: new Prisma.Decimal('4000') },
      { storage: '256GB', basePrice: new Prisma.Decimal('4500') },
    ];
    const { tool, tradeInValuation } = build([tpl({ model: 'iPhone 14' })], { valuations });

    const r = await tool.run({ currentModel: 'ใช้ 12 อยู่', downBudget: 99_999, monthlyBudget: 99_999 });
    expect(r.tradeIn).toEqual({ model: 'iPhone 12', estimateThb: 3500, note: TRADE_IN_NOTE });
    expect(tradeInValuation.findMany.mock.calls[0][0].where).toEqual({
      brand: { equals: 'Apple', mode: 'insensitive' },
      OR: [{ model: { equals: 'iPhone 12', mode: 'insensitive' } }],
      condition: 'A',
      deletedAt: null,
    });

    const r2 = await tool.run({ currentModel: 'iPhone 12 64GB', downBudget: 99_999, monthlyBudget: 99_999 });
    expect(r2.tradeIn?.estimateThb).toBe(3500);
    // ความจุที่ไม่มีแถว → ไม่รู้จริง → ราคาต่ำสุด
    const r3 = await tool.run({ currentModel: 'iPhone 12 512GB', downBudget: 99_999, monthlyBudget: 99_999 });
    expect(r3.tradeIn?.estimateThb).toBe(3500);
  });

  it('(5b) ไม่มีแถวรับซื้อ / ไม่รู้รุ่น → tradeIn null (ห้ามเดาราคาเทิร์น)', async () => {
    const { tool, tradeInValuation } = build([tpl({ model: 'iPhone 13' })]);
    expect((await tool.run({ currentModel: 'iPhone 12', downBudget: 99_999, monthlyBudget: 99_999 })).tradeIn).toBeNull();
    expect((await tool.run({ currentModel: 'Samsung S20', downBudget: 99_999, monthlyBudget: 99_999 })).tradeIn).toBeNull();
    // นโยบายร้านรับเทิร์น iPhone 12 ขึ้นไป → 11 ไม่เสนอราคาแม้มีแถว · ไม่รับ Mini
    expect((await tool.run({ currentModel: 'iPhone 13 mini', downBudget: 99_999, monthlyBudget: 99_999 })).tradeIn).toBeNull();
    expect((await tool.run({ currentModel: 'iPhone 11', downBudget: 99_999, monthlyBudget: 99_999 })).tradeIn).toBeNull();
    expect((await tool.run({ downBudget: 99_999, monthlyBudget: 99_999 })).tradeIn).toBeNull();
    // ไม่รู้รุ่น → ไม่ยิง query เทิร์นเลย
    expect(tradeInValuation.findMany).toHaveBeenCalledTimes(1);
  });

  it('(6) currentModel ไม่รู้จัก → recognized:false แต่ยังแนะนำตามงบได้ (ไม่มี diff)', async () => {
    const { tool } = build([tpl({ model: 'iPhone 13' }), tpl({ model: 'iPhone 12' })]);
    const r = await tool.run({ currentModel: 'Samsung S20', downBudget: 3000, monthlyBudget: 2000 });

    expect(r.current).toEqual({ model: 'Samsung S20', recognized: false });
    expect(r.recommended.map((d) => d.model)).toEqual(['iPhone 13', 'iPhone 12']);
    for (const d of r.recommended) {
      expect(d.betterThanCurrent).toEqual([]);
      expect(d.worseThanCurrent).toEqual([]);
      expect(d.generationGap).toBeNull();
    }
    expect(r.tradeIn).toBeNull();
  });

  it('(7) preferStorage: เก็บเฉพาะความจุ ≥ ที่ต้องการ', async () => {
    const { tool } = build([
      tpl({ model: 'iPhone 13', storage: '64GB' }),
      tpl({ model: 'iPhone 13', storage: '128GB' }),
      tpl({ model: 'iPhone 13', storage: '256GB' }),
      tpl({ model: 'iPhone 14', storage: '' }), // ไม่รู้ความจุ → ตัดเมื่อระบุ preferStorage
    ]);
    const r = await tool.run({ currentModel: 'iPhone 11', preferStorage: '128GB', downBudget: 99_999, monthlyBudget: 99_999 });
    expect(r.recommended.map((d) => [d.model, d.storage])).toEqual([
      ['iPhone 13', '128GB'],
      ['iPhone 13', '256GB'],
    ]);
  });

  it('(8) ตารางราคาว่าง / ไม่ใช่มือถือ → reason ไม่มีตารางราคา', async () => {
    const { tool } = build([tpl({ model: 'AirPods Pro', category: 'ACCESSORY', storage: '' })]);
    const r = await tool.run({ downBudget: 3000 });
    expect(r.recommended).toEqual([]);
    expect(r.reason).toBe('ยังไม่มีตารางราคาในระบบ');
  });
});

describe('storageGb', () => {
  it('แปลงความจุเป็น GB (TB ×1024), ว่าง/ไม่ใช่ตัวเลข → null', () => {
    expect(storageGb('128GB')).toBe(128);
    expect(storageGb('128 gb')).toBe(128);
    expect(storageGb('1TB')).toBe(1024);
    expect(storageGb('')).toBeNull();
    expect(storageGb(null)).toBeNull();
    expect(storageGb('N/A')).toBeNull();
  });
});
