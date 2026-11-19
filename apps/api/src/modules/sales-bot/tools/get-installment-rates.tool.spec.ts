import type { ModelQuote } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PricingQuoteService, PriceQuoteRow } from '../../pricing-templates/pricing-quote.service';
import { GET_INSTALLMENT_RATES_TOOL, GetInstallmentRatesTool } from './get-installment-rates.tool';

/**
 * ช่วง 2 ของการเลิกใช้ชีต MASTER: ช่องราคาผ่อนของราคากลางเป็น "ราคาเต็ม" แล้ว — บอทเลิกอ่านเป็นค่างวด
 * ตัวเลขทุกตัวมาจาก PricingQuoteService (ตัวคำนวณกลางเดียวกับหน้า "ราคาและเรทผ่อน" และสัญญา)
 * คีย์ downPayment / monthlyPrice คงชื่อเดิม เพราะ collectGroundedPrices (sales-bot.service.ts) เก็บคีย์นี้
 */

const row = (over: Record<string, unknown> = {}) => ({
  deviceOrigin: 'UNSPECIFIED',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  ...over,
});

const quote = (over: Partial<ModelQuote> = {}): ModelQuote => ({
  cash: { price: 25900, profit: null },
  rate1: {
    price: 25900,
    downAmount: 3900,
    months: 12,
    monthlyContract: 3138.66,
    monthlyDisplay: 3139,
    recordedSalePrice: 28100,
    profit: null,
    allowedMonths: [10, 12],
  },
  rate2: {
    available: true,
    salePrice: 25900,
    submitPrice: 25900,
    downAmount: 6500,
    months: 12,
    monthly: 3403,
    recordedSalePrice: 28738,
    profit: null,
    originNote: false,
  },
  ...over,
});

function build(rows: unknown[], q: ModelQuote | null = quote()) {
  const prisma = { pricingTemplate: { findMany: jest.fn().mockResolvedValue(rows) } } as unknown as PrismaService;
  const quotes = {
    quoteForModel: jest.fn().mockResolvedValue(q),
    listQuotes: jest.fn().mockResolvedValue({ updatedAt: null, rows: [] }),
  };
  const tool = new GetInstallmentRatesTool(prisma, quotes as unknown as PricingQuoteService);
  const findMany = prisma.pricingTemplate.findMany as unknown as jest.Mock;
  return { tool, quotes, findMany };
}

describe('GetInstallmentRatesTool.run', () => {
  it('ตอบด้วยตัวเลขจากตัวคำนวณกลาง: เรท 1 ค่างวดที่แสดง (ปัดขึ้น) · เรท 2 GFIN · งวดที่เลือกได้', async () => {
    const { tool, quotes } = build([row()]);
    const r = await tool.run({ query: 'iPhone 15 128GB' });
    expect(r.templates).toEqual([
      {
        deviceOrigin: 'UNSPECIFIED',
        condition: 'มือ 1',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '128GB',
        hasWarranty: false,
        rate1: { downPayment: 3900, monthlyPrice: 3139, termMonths: 12 },
        rate2: { downPayment: 6500, monthlyPrice: 3403, termMonths: 12 },
        allowedTerms: [10, 12],
      },
    ]);
    expect(quotes.quoteForModel).toHaveBeenCalledWith({
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '128GB',
      category: 'PHONE_NEW',
      hasWarranty: false,
      origin: 'THAI',
    });
  });

  it('GFIN ไม่รับรุ่นนี้ → rate2 = null พร้อมเหตุผล', async () => {
    const { tool } = build(
      [row()],
      quote({ rate2: { available: false, reason: 'NO_PRICE_LIST', message: 'GFIN ไม่รับรุ่นนี้' } }),
    );
    const r = await tool.run({ query: 'iPhone 15' });
    expect(r.templates[0].rate2).toBeNull();
    expect(r.templates[0].rate2Unavailable).toBe('GFIN ไม่รับรุ่นนี้');
  });

  it('ลูกค้าบอกเครื่องนอก → คิดแบบเครื่องนอก และค้นแถวเครื่องนอก + "ไม่ระบุ"', async () => {
    const { tool, quotes, findMany } = build([row()]);
    await tool.run({ query: 'iPhone 15', deviceOrigin: 'IMPORTED' });
    expect(findMany.mock.calls[0][0].where.deviceOrigin).toEqual({ in: ['IMPORTED', 'UNSPECIFIED'] });
    expect(quotes.quoteForModel.mock.calls[0][0].origin).toBe('IMPORTED');
  });

  it('แถวแฝดของเครื่องไทยกับ "ไม่ระบุ" → คิดครั้งเดียว', async () => {
    const { tool, quotes } = build([row({ deviceOrigin: 'THAI' }), row()]);
    const r = await tool.run({ query: 'iPhone 15', deviceOrigin: 'THAI' });
    expect(r.templates).toHaveLength(1);
    expect(quotes.quoteForModel).toHaveBeenCalledTimes(1);
  });

  it('ราคากลางหาไม่เจอตอนคิด (null) → ข้ามแถวนั้น', async () => {
    const { tool } = build([row()], null);
    expect(await tool.run({ query: 'iPhone 15' })).toEqual({ templates: [] });
  });

  it('ตัดคำความจุออกจากคำค้นรุ่น แล้วใช้ความจุเป็นตัวแคบผล', async () => {
    const { tool, findMany } = build([row({ storage: '128GB' }), row({ storage: '256GB' })]);
    const r = await tool.run({ query: 'iPhone 15 256 gb' });
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).not.toContain('256');
    expect(r.templates.map((t) => t.storage)).toEqual(['256GB']);
  });

  it('ความจุที่ขอไม่มีในตาราง → ไม่ทิ้งผลทั้งหมด', async () => {
    const { tool } = build([row({ storage: '128GB' })]);
    expect((await tool.run({ query: 'iPhone 15 1TB' })).templates).toHaveLength(1);
  });

  it('ได้ไม่เกิน 3 แถว', async () => {
    const { tool } = build(['128GB', '256GB', '512GB', '1TB'].map((storage) => row({ storage })));
    expect((await tool.run({ query: 'iPhone 15' })).templates).toHaveLength(3);
  });

  it('ไม่มีแถว / คำค้นว่าง → templates ว่าง', async () => {
    expect(await build([]).tool.run({ query: 'Nokia 3310' })).toEqual({ templates: [] });
    const { tool, findMany } = build([row()]);
    expect(await tool.run({ query: '' })).toEqual({ templates: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('condition → where: มือ 1 = PHONE_NEW · มือสอง/มือ 2 = ไม่ใช่ PHONE_NEW · อื่น = ไม่กรอง', async () => {
    const { tool, findMany } = build([row()]);
    await tool.run({ query: 'iPhone 15', condition: 'มือ 1' });
    expect(findMany.mock.calls[0][0].where.category).toBe('PHONE_NEW');
    await tool.run({ query: 'iPhone 15', condition: 'มือ 2' });
    expect(findMany.mock.calls[1][0].where.category).toEqual({ not: 'PHONE_NEW' });
    await tool.run({ query: 'iPhone 15', condition: 'ใหม่' });
    expect(findMany.mock.calls[2][0].where.category).toBeUndefined();
  });

  it('ที่มาเครื่อง THAI รวมแถว "ไม่ระบุ" · ไม่ส่ง = ไม่กรอง', async () => {
    const { tool, findMany } = build([row()]);
    await tool.run({ query: 'iPhone 15', deviceOrigin: 'THAI' });
    expect(findMany.mock.calls[0][0].where.deviceOrigin).toEqual({ in: ['THAI', 'UNSPECIFIED'] });
    await tool.run({ query: 'iPhone 15' });
    expect(findMany.mock.calls[1][0].where.deviceOrigin).toBeUndefined();
  });

  it('เรียงแถวแฝด มือ 1 ก่อนมือสอง (category ก่อน hasWarranty)', async () => {
    const { tool, findMany } = build([row()]);
    await tool.run({ query: 'iPhone 15' });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { brand: 'asc' },
      { model: 'asc' },
      { storage: 'asc' },
      { category: 'asc' },
      { hasWarranty: 'asc' },
    ]);
  });

  it('คีย์ที่ด่านตรวจตัวเลขเก็บ (downPayment, monthlyPrice) อยู่ในผล', async () => {
    const { tool } = build([row()]);
    const text = JSON.stringify(await tool.run({ query: 'iPhone 15' }));
    expect(text).toContain('"downPayment"');
    expect(text).toContain('"monthlyPrice"');
  });
});

describe('ข้อมูลภายในต้องไม่หลุดถึงลูกค้า (บอทคุยกับลูกค้า)', () => {
  const FORBIDDEN = /submitPrice|recordedSalePrice|profit|cost/i;

  it('run(): ผลที่ส่งให้โมเดลไม่มี submitPrice / recordedSalePrice / profit / cost', async () => {
    const { tool } = build([row()], quote({ cash: { price: 25900, profit: 1234 } }));
    const text = JSON.stringify(await tool.run({ query: 'iPhone 15' }));
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).toContain('"monthlyPrice":3139');
  });

  it('listAllRates(): ผลที่ส่งให้ recommend_devices ไม่มีฟิลด์ภายใน', async () => {
    const { tool, quotes } = build([]);
    quotes.listQuotes.mockResolvedValue({
      updatedAt: null,
      rows: [
        {
          key: 'k',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          category: 'PHONE_NEW',
          hasWarranty: null,
          cashPrice: 12500,
          rate1: { downAmount: 1600, monthly: 1227, months: 12 },
          rate2: { downAmount: 2000, monthly: 1300, months: 12 },
        },
      ],
    });
    expect(JSON.stringify(await tool.listAllRates())).not.toMatch(FORBIDDEN);
  });
});

describe('GetInstallmentRatesTool.listAllRates (recommend_devices)', () => {
  it('อ่านใบเสนอราคาเครื่องไทยของมือ 1 และมือ 2 จาก listQuotes', async () => {
    const used: PriceQuoteRow = {
      key: 'Apple|iPhone 13|128GB|null',
      brand: 'Apple',
      model: 'iPhone 13',
      storage: '128GB',
      category: 'PHONE_USED',
      hasWarranty: null,
      cashPrice: 12500,
      rate1: { downAmount: 1600, monthly: 1227, months: 12 },
      rate2: { unavailable: 'GFIN ไม่รับรุ่นนี้' },
    };
    const { tool, quotes } = build([]);
    quotes.listQuotes.mockImplementation(async ({ category }: { category: string }) => ({
      updatedAt: null,
      rows: category === 'PHONE_USED' ? [used] : [],
    }));
    const rows = await tool.listAllRates();
    expect(quotes.listQuotes.mock.calls.map(([q]) => q)).toEqual([
      { category: 'PHONE_NEW', origin: 'THAI' },
      { category: 'PHONE_USED', origin: 'THAI' },
    ]);
    expect(rows).toEqual([
      {
        category: 'PHONE_USED',
        condition: 'มือสอง',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        hasWarranty: false,
        rate1: { downPayment: 1600, monthlyPrice: 1227, termMonths: 12 },
        rate2: null,
        rate2Unavailable: 'GFIN ไม่รับรุ่นนี้',
      },
    ]);
  });
});

describe('GET_INSTALLMENT_RATES_TOOL description', () => {
  const d = GET_INSTALLMENT_RATES_TOOL.description;

  it('ไม่มีผล → ห้ามเดาเรท ห้ามถามงบ', () => {
    expect(d).toContain("do NOT ask for the customer's budget");
    expect(d).toContain('retry once with the plain English model name');
  });

  it('ป้ายภายในห้ามพิมพ์ · UNSPECIFIED = ตารางปกติ · ห้ามใช้กับโปรฟรีดาวน์เครื่องนอก', () => {
    expect(d).toContain('never print THAI/IMPORTED/UNSPECIFIED');
    expect(d).toContain("UNSPECIFIED rows are the shop's regular (Thai) table");
    expect(d).toContain('Never quote these rows for the imported free-down promo');
  });

  it('บอกว่าเลขปัดเป็นบาทแล้ว · rate2 ว่างได้ · ของวดอื่นให้บอก allowedTerms', () => {
    expect(d).toContain('whole baht');
    expect(d).toContain('rate2Unavailable');
    expect(d).toContain('allowedTerms');
  });

  it('enum condition ของ input คงเดิม', () => {
    expect(GET_INSTALLMENT_RATES_TOOL.input_schema.properties.condition.enum).toEqual(['มือ 1', 'มือสอง']);
  });
});
