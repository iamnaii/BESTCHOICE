import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CalculateInstallmentTool } from './calculate-installment.tool';
import { InstallmentPreviewService } from '../../shop-catalog/installment-preview.service';

/**
 * B3 §5 — tool นี้ต้องคิดเลขด้วย `calcBcInstallment` ตัวเดียวกับ preview/สัญญาจริง
 * (#1335 เคยควอตค่างวดต่ำกว่าความจริงหลายเท่าเพราะคิดสูตรเอง — ห้ามกลับไปทางนั้น)
 */

const D = (v: string) => new Prisma.Decimal(v);

const productRow = (over: Record<string, unknown> = {}) => ({
  id: 'prd-1',
  name: 'iPhone 15 Pro Max 256GB',
  category: 'PHONE_USED',
  cashPrice: D('32900'),
  installmentPrice: D('35900'),
  gallery: ['https://cdn.example.com/p1.jpg'],
  prices: [],
  ...over,
});

const cfgRow = (over: Record<string, unknown> = {}) => ({
  id: 'ic-1',
  minDownPaymentPct: D('0.20'),
  storeCommissionPct: D('0'),
  vatPct: D('0'),
  interestRate: D('0.10'),
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  rates: [],
  ...over,
});

const makePrisma = (product: unknown, cfg: unknown) =>
  ({
    product: { findFirst: jest.fn().mockResolvedValue(product) },
    interestConfig: { findFirst: jest.fn().mockResolvedValue(cfg) },
  }) as unknown as PrismaService;

describe('CalculateInstallmentTool.run', () => {
  const prevBase = process.env.SHOP_BASE_URL;
  beforeEach(() => {
    process.env.SHOP_BASE_URL = 'https://shop.example.com';
  });
  afterEach(() => {
    if (prevBase === undefined) delete process.env.SHOP_BASE_URL;
    else process.env.SHOP_BASE_URL = prevBase;
  });

  it('คิดจาก installmentPrice (ไม่ใช่ราคาเงินสด) และคืนคีย์ครบตามสัญญา', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    const r = (await tool.run({ productId: 'prd-1', downPct: 20, tenureMonths: 12 })) as Record<
      string,
      unknown
    >;
    expect(r.priceThb).toBe(35900); // ฐานผ่อน
    expect(r.cashPriceThb).toBe(32900); // ราคาเงินสดไว้อ้างอิง
    expect(Object.keys(r).sort()).toEqual(
      [
        'cashPriceThb',
        'downAmountThb',
        'downPct',
        'financedThb',
        'monthlyThb',
        'photoUrl',
        'priceThb',
        'productId',
        'productName',
        'ratePct',
        'tenureMonths',
        'totalPaidThb',
        'webUrl',
      ].sort(),
    );
  });

  it('ค่างวดตรงกับสูตร calcBcInstallment (commission/VAT = 0, rate สังเคราะห์ 0.10 × 12)', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    const r = (await tool.run({ productId: 'prd-1', downPct: 20, tenureMonths: 12 })) as unknown as Record<
      string,
      number
    >;
    // down = 35900 × 0.20 = 7180; financed = 28720; rate12 = 1.2; interest = 34464
    // subtotal = 63184; monthly = 63184 / 12 = 5265.33; total = 7180 + 63184 = 70364
    expect(r.downAmountThb).toBe(7180);
    expect(r.financedThb).toBe(28720);
    expect(r.ratePct).toBe(120);
    expect(r.monthlyThb).toBeCloseTo(5265.33, 2);
    expect(r.totalPaidThb).toBeCloseTo(70364, 2);
  });

  it('ไม่ส่ง downPct → ใช้ minDownPaymentPct ของ InterestConfig (เลิก hardcode 20%)', async () => {
    const tool = new CalculateInstallmentTool(
      makePrisma(productRow(), cfgRow({ minDownPaymentPct: D('0.30') })),
    );
    const r = (await tool.run({ productId: 'prd-1', tenureMonths: 12 })) as unknown as Record<
      string,
      number
    >;
    expect(r.downPct).toBe(30);
    expect(r.downAmountThb).toBe(10770); // 35900 × 0.30
  });

  it('fallback ไป prices[] label ราคาผ่อน เมื่อคอลัมน์ยังว่าง (parity กับ preview)', async () => {
    const tool = new CalculateInstallmentTool(
      makePrisma(
        productRow({
          installmentPrice: null,
          prices: [{ label: 'ราคาผ่อน BESTCHOICE', amount: D('35900') }],
        }),
        cfgRow(),
      ),
    );
    const r = (await tool.run({ productId: 'prd-1', tenureMonths: 12 })) as unknown as Record<
      string,
      number
    >;
    expect(r.priceThb).toBe(35900);
  });

  it('ไม่มีราคาผ่อนเลย → price_not_configured', async () => {
    const tool = new CalculateInstallmentTool(
      makePrisma(productRow({ installmentPrice: null, prices: [] }), cfgRow()),
    );
    expect(await tool.run({ productId: 'prd-1', tenureMonths: 12 })).toEqual({
      error: 'price_not_configured',
    });
  });

  it('ไม่พบ InterestConfig ของหมวดนี้ → rate_not_configured', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), null));
    expect(await tool.run({ productId: 'prd-1', tenureMonths: 12 })).toEqual({
      error: 'rate_not_configured',
    });
  });

  it('จำนวนงวดนอกตาราง → rate_not_configured (ไม่ throw, persona พา handoff เอง)', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    expect(await tool.run({ productId: 'prd-1', tenureMonths: 36 })).toEqual({
      error: 'rate_not_configured',
    });
  });

  it('ดาวน์ต่ำกว่าขั้นต่ำ → invalid_installment พร้อมเหตุผลภาษาไทย', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    const r = (await tool.run({ productId: 'prd-1', downPct: 5, tenureMonths: 12 })) as {
      error: string;
      reasons: string[];
    };
    expect(r.error).toBe('invalid_installment');
    expect(r.reasons.join(' ')).toContain('เงินดาวน์');
  });

  it('ไม่พบสินค้า → product_not_found', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(null, cfgRow()));
    expect(await tool.run({ productId: 'nope', tenureMonths: 12 })).toEqual({
      error: 'product_not_found',
    });
  });

  it('คืน photoUrl/webUrl ไว้ให้ SalesBotService แนบเป็น attachment', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productRow(), cfgRow()));
    const r = (await tool.run({ productId: 'prd-1', tenureMonths: 12 })) as Record<string, unknown>;
    expect(r.photoUrl).toBe('https://cdn.example.com/p1.jpg');
    expect(r.webUrl).toBe('https://shop.example.com/products/prd-1');
  });
});

/**
 * RED LINE (spec §10): เลขที่ลูกค้าเห็นในแชท ต้องเท่ากับเลขที่เว็บ/สัญญาคิด
 * เทสต์นี้เรียกทั้ง 2 บริการด้วย input เดียวกัน แล้วเทียบผลตรง ๆ
 */
describe('golden parity: calculate_installment === InstallmentPreviewService', () => {
  it.each([
    { months: 6, downPct: 20 },
    { months: 12, downPct: 30 },
  ])('ตรงกันทุกบาทที่ %o', async ({ months, downPct }) => {
    const installmentPrice = '35900';
    const cfg = {
      id: 'ic-1',
      minDownPaymentPct: D('0.20'),
      storeCommissionPct: D('0.05'),
      vatPct: D('0.07'),
      interestRate: D('0.10'),
      minInstallmentMonths: 6,
      maxInstallmentMonths: 12,
      rates: [],
    };

    const tool = new CalculateInstallmentTool(
      makePrisma(
        {
          id: 'prd-1',
          name: 'iPhone 15 Pro Max',
          category: 'PHONE_USED',
          cashPrice: D('32900'),
          installmentPrice: D(installmentPrice),
          gallery: [],
          prices: [],
        },
        cfg,
      ),
    );

    const preview = new InstallmentPreviewService(
      ({
        // InstallmentPreviewService.preview() reads via `product.findFirst`
        // (not findUnique) — see installment-preview.service.ts:37-41.
        product: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'prd-1',
            deletedAt: null,
            category: 'PHONE_USED',
            installmentPrice: D(installmentPrice),
            prices: [],
          }),
        },
        interestConfig: { findFirst: jest.fn().mockResolvedValue(cfg) },
      } as unknown) as PrismaService,
    );

    const fromBot = (await tool.run({
      productId: 'prd-1',
      downPct,
      tenureMonths: months,
    })) as unknown as Record<string, number>;
    const fromWeb = await preview.preview({
      productId: 'prd-1',
      provider: 'BC',
      months,
      downPct: downPct / 100,
    } as never);

    expect(fromWeb.available).toBe(true);
    expect(fromBot.monthlyThb).toBe(fromWeb.monthlyPayment);
    expect(fromBot.downAmountThb).toBe(fromWeb.downAmount);
    expect(fromBot.financedThb).toBe(fromWeb.financedAmount);
  });
});
