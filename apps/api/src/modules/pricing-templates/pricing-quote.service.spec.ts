import { Prisma } from '@prisma/client';
import { PricingQuoteService } from './pricing-quote.service';
import { PricingTemplatesService } from './pricing-templates.service';

const D = (v: string | number) => new Prisma.Decimal(v);

const tpl = (over: Record<string, unknown> = {}) => ({
  id: 't-15',
  deviceOrigin: 'UNSPECIFIED',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  cashPrice: D(25900),
  installmentBestchoicePrice: D(25900),
  installmentFinancePrice: D(25900),
  rate1DownPayment: null,
  rate1TermMonths: 12,
  rate2DownPayment: null,
  rate2TermMonths: null,
  isActive: true,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-19T03:00:00Z'),
  deletedAt: null,
  ...over,
});

const used13 = (over: Record<string, unknown> = {}) =>
  tpl({
    id: 'u13',
    model: 'iPhone 13',
    category: 'PHONE_USED',
    cashPrice: D(12500),
    installmentBestchoicePrice: D(10200),
    installmentFinancePrice: D(9600),
    ...over,
  });

function makeDb(rows: unknown[]) {
  return {
    pricingTemplate: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _max: { updatedAt: new Date('2026-11-19T03:00:00Z') } }),
    },
    // ตั้งค่าดอกเบี้ยตามชีต: 10/12 งวด 50% · ดาวน์ขั้นต่ำ 15% · คอม 10% · VAT 7% (FINANCE)
    interestConfig: {
      findFirst: jest.fn().mockResolvedValue({
        minDownPaymentPct: D('0.15'),
        storeCommissionPct: D('0.10'),
        interestRate: D('0.05'),
        minInstallmentMonths: 10,
        maxInstallmentMonths: 12,
        rates: [
          { months: 10, ratePct: D('0.50') },
          { months: 12, ratePct: D('0.50') },
        ],
      }),
    },
    companyInfo: { findFirst: jest.fn().mockResolvedValue({ vatRegistered: true, vatRate: D('0.07') }) },
    // ค่าตั้ง gfin.* ไม่มีแถว → ค่าตั้งต้น (ดาวน์ 25% · คอมมือถือ 15% · ค่าทำสัญญา 100)
    systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    gfinModelMapping: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'm1', gfinSeries: 'iPhone 15', gfinVariant: null, storage: '128GB', condition: 'HAND_1', maxPrice: D(24900), modelMatchPattern: 'iPhone 15', isActive: true },
        { id: 'm2', gfinSeries: 'iPhone 13', gfinVariant: null, storage: '128GB', condition: 'HAND_2', maxPrice: D(12900), modelMatchPattern: 'iPhone 13', isActive: true },
      ]),
    },
    gfinOverpriceRule: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'r1', label: 'มือ 1 OVER 1,000', seriesPattern: 'iPhone 15', condition: 'HAND_1', allowance: D(1000), maxMonths: 12, minDownPct: null, isActive: true },
        { id: 'r2', label: 'มือ 2 OVER 0', seriesPattern: 'iPhone 13', condition: 'HAND_2', allowance: D(0), maxMonths: 12, minDownPct: null, isActive: true },
      ]),
    },
    gfinRateFactor: {
      findMany: jest.fn().mockResolvedValue([
        { months: 12, shopCommissionPct: 15, factor: D('0.17'), feePerInstallment: D(100), isActive: true },
      ]),
    },
  };
}

function build(rows: unknown[]) {
  const db = makeDb(rows);
  return { db, service: new PricingQuoteService(db as never, new PricingTemplatesService(db as never, { log: jest.fn() } as never)) };
}

describe('PricingQuoteService.listQuotes', () => {
  it('คิดแถวด้วยตัวคำนวณกลาง — iPhone 15 128GB มือ 1 เครื่องไทย = ตัวเลขชีต', async () => {
    const { service } = build([tpl()]);
    const result = await service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI' });
    expect(result).toEqual({
      updatedAt: '2026-11-19T03:00:00.000Z',
      rows: [
        {
          key: 'Apple|iPhone 15|128GB|null',
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          category: 'PHONE_NEW',
          hasWarranty: null,
          cashPrice: 25900,
          rate1: { downAmount: 3900, monthly: 3139, months: 12 },
          rate2: { downAmount: 6500, monthly: 3403, months: 12 },
        },
      ],
    });
  });

  it('ไม่ส่งทุน กำไร ราคาส่ง GFIN หรือราคาบันทึกขายออกไป', async () => {
    const { service } = build([tpl()]);
    const text = JSON.stringify(await service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI' }));
    expect(text).not.toMatch(/profit|submit|cost|recordedSalePrice|salePrice/i);
  });

  it('ค้นแถวของที่มาเครื่องนั้น + "ไม่ระบุ" · มีทั้งคู่ → ใช้แถวของที่มาเครื่อง', async () => {
    const { db, service } = build([
      tpl({ id: 'u', deviceOrigin: 'UNSPECIFIED', cashPrice: D(25900) }),
      tpl({ id: 'th', deviceOrigin: 'THAI', cashPrice: D(26900) }),
    ]);
    const result = await service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI' });
    expect(db.pricingTemplate.findMany.mock.calls[0][0].where).toMatchObject({
      category: 'PHONE_NEW',
      isActive: true,
      deletedAt: null,
      deviceOrigin: { in: ['THAI', 'UNSPECIFIED'] },
    });
    expect(result.rows.map((r) => r.cashPrice)).toEqual([26900]);
  });

  it('เครื่องนอก → เรท 2 คิด OVER ครึ่ง', async () => {
    const { service } = build([tpl()]);
    const result = await service.listQuotes({ category: 'PHONE_NEW', origin: 'IMPORTED' });
    expect(result.rows[0].rate2).toEqual({ downAmount: 6400, monthly: 3339, months: 12 });
  });

  it('มือ 1 / แท็บเล็ต → hasWarranty = null (ไม่มีป้ายประกัน — สเปคข้อ 6 ป้ายมีแค่มือ 2 ที่ราคาต่าง)', async () => {
    const neu = await build([tpl()]).service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI' });
    expect(neu.rows.map((r) => [r.hasWarranty, r.key])).toEqual([[null, 'Apple|iPhone 15|128GB|null']]);
    const tab = await build([tpl({ id: 'ipad', model: 'iPad Air M1', storage: '64GB', category: 'TABLET' })]).service.listQuotes({
      category: 'TABLET',
      origin: 'THAI',
    });
    expect(tab.rows.map((r) => r.hasWarranty)).toEqual([null]);
  });

  it('มือ 2 แถวเดียว (ไม่มีแฝด) → คงค่าประกันของแถว', async () => {
    const { service } = build([used13({ hasWarranty: false })]);
    const result = await service.listQuotes({ category: 'PHONE_USED', origin: 'THAI' });
    expect(result.rows.map((r) => r.hasWarranty)).toEqual([false]);
  });

  it('มือ 2 มีประกัน / ไม่มีประกันตัวเลขเท่ากัน → แถวเดียว hasWarranty = null', async () => {
    const { service } = build([used13({ hasWarranty: false }), used13({ id: 'u13w', hasWarranty: true })]);
    const result = await service.listQuotes({ category: 'PHONE_USED', origin: 'THAI' });
    expect(result.rows).toEqual([
      {
        key: 'Apple|iPhone 13|128GB|null',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        category: 'PHONE_USED',
        hasWarranty: null,
        cashPrice: 12500,
        rate1: { downAmount: 1600, monthly: 1227, months: 12 },
        rate2: { downAmount: 0, monthly: 1745, months: 12 },
      },
    ]);
  });

  it('มือ 2 ราคาต่างกัน → สองแถว ไม่มีประกันก่อน', async () => {
    const { service } = build([
      used13({ id: 'w', hasWarranty: true, cashPrice: D(13500) }),
      used13({ hasWarranty: false }),
    ]);
    const result = await service.listQuotes({ category: 'PHONE_USED', origin: 'THAI' });
    expect(result.rows.map((r) => [r.hasWarranty, r.cashPrice])).toEqual([
      [false, 12500],
      [true, 13500],
    ]);
  });

  it('GFIN ไม่มีใบราคาของรุ่น → rate2 บอกเหตุผล', async () => {
    const { service } = build([used13({ model: 'iPhone 12', storage: '64GB' })]);
    const result = await service.listQuotes({ category: 'PHONE_USED', origin: 'THAI' });
    expect(result.rows[0].rate2).toEqual({ unavailable: 'GFIN ไม่รับรุ่นนี้' });
  });

  it('คำค้นที่มีความจุ → ค้นชื่อรุ่นไม่รวมความจุ แล้วกรองความจุ', async () => {
    const { db, service } = build([tpl(), tpl({ id: 't256', storage: '256GB' })]);
    const result = await service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI', q: 'iPhone 15 256GB' });
    expect(db.pricingTemplate.findMany.mock.calls[0][0].where.OR).toEqual([
      { model: { contains: 'iPhone 15', mode: 'insensitive' } },
      { brand: { contains: 'iPhone 15', mode: 'insensitive' } },
    ]);
    expect(result.rows.map((r) => r.storage)).toEqual(['256GB']);
  });

  it('เรียงรุ่นแบบตัวเลขธรรมชาติ แล้วความจุจากน้อยไปมาก', async () => {
    const { service } = build([
      tpl({ id: 'a', model: 'iPhone 16', storage: '128GB' }),
      tpl({ id: 'b', model: 'iPhone 15', storage: '1TB' }),
      tpl({ id: 'c', model: 'iPhone 15', storage: '256GB' }),
    ]);
    const result = await service.listQuotes({ category: 'PHONE_NEW', origin: 'THAI' });
    expect(result.rows.map((r) => `${r.model} ${r.storage}`)).toEqual([
      'iPhone 15 256GB',
      'iPhone 15 1TB',
      'iPhone 16 128GB',
    ]);
  });
});

describe('PricingQuoteService.quoteForModel', () => {
  it('ค้นราคากลางด้วย lookup (ถอยไป "ไม่ระบุ") แล้วคืน ModelQuote เต็ม', async () => {
    const { db, service } = build([]);
    db.pricingTemplate.findFirst.mockImplementation(async ({ where }: { where: { deviceOrigin: string } }) =>
      where.deviceOrigin === 'UNSPECIFIED' ? tpl() : null,
    );
    const quote = await service.quoteForModel({
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '128GB',
      category: 'PHONE_NEW',
      origin: 'THAI',
    });
    expect(quote?.rate1).toMatchObject({ downAmount: 3900, monthlyDisplay: 3139, months: 12, allowedMonths: [10, 12] });
    expect(quote?.rate2).toMatchObject({ available: true, downAmount: 6500, monthly: 3403 });
  });

  it('ไม่มีราคากลางของรุ่น → null', async () => {
    const { service } = build([]);
    expect(
      await service.quoteForModel({ brand: 'Apple', model: 'Nokia', storage: '', category: 'PHONE_NEW', origin: 'THAI' }),
    ).toBeNull();
  });
});
