import { computeProductQuote, resolveProductPrices, ProductQuoteService } from './product-quote.service';
import type { PrismaService } from '../../../prisma/prisma.service';

const CONFIG_WITH_RATES = {
  minDownPaymentPct: '0.2000',
  storeCommissionPct: '0.0500',
  vatPct: '0.0700',
  interestRate: '0.0250',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  rates: [
    { months: 6, ratePct: '0.1500' },
    { months: 12, ratePct: '0.3000' },
  ],
};

describe('resolveProductPrices — columns-first แล้วค่อย fallback prices[]', () => {
  it('อ่านคอลัมน์ก่อนเสมอ', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_NEW',
        cashPrice: '32900',
        installmentPrice: '34900',
        prices: [{ label: 'ราคาเงินสด', amount: '1' }],
      }),
    ).toEqual({ cash: 32900, installment: 34900 });
  });

  it('คอลัมน์ว่าง → ใช้ label ตรงตัวก่อน แล้วค่อย prefix', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_USED',
        cashPrice: null,
        installmentPrice: null,
        prices: [
          { label: 'ราคาเงินสด', amount: '20000' },
          { label: 'ราคาผ่อน GFIN', amount: '23000' },
          { label: 'ราคาผ่อน BESTCHOICE', amount: '22000' },
        ],
      }),
    ).toEqual({ cash: 20000, installment: 22000 });
  });

  it('ไม่มีทั้งคอลัมน์และ row → null (ห้าม fallback prices[0])', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_USED',
        cashPrice: null,
        installmentPrice: null,
        prices: [{ label: 'ราคาขายต่อ (Refurbished)', amount: '9999' }],
      }),
    ).toEqual({ cash: null, installment: null });
  });
});

describe('computeProductQuote — golden (ต้องตรงกับ calcBcInstallment ทุกบาท)', () => {
  it('เลือกงวดยาวสุดในตารางอัตรา + ดาวน์ขั้นต่ำ', () => {
    // 20,000 / 12 งวด / rate 30% / down 20% / com 5% / vat 7%
    // down 4,000 → financed 16,000 → ดอกเบี้ย 4,800 → คอม 800
    // subtotal 21,600 → vat 1,512 → total 23,112 → งวดละ 1,926.00
    expect(
      computeProductQuote(
        { category: 'PHONE_NEW', cashPrice: '19500', installmentPrice: '20000' },
        CONFIG_WITH_RATES,
      ),
    ).toEqual({
      cashPrice: 19500,
      installmentPrice: 20000,
      months: 12,
      monthlyPayment: 1926,
      downAmount: 4000,
    });
  });

  it('ไม่มี InterestConfigRate → สังเคราะห์ rate ต่อเดือน × จำนวนงวด (เหมือน installment-preview)', () => {
    // rate 2.5%/เดือน × 10 งวด = 25% → financed 16,000 → ดอก 4,000 + คอม 800
    // subtotal 20,800 → vat 1,456 → total 22,256 → งวดละ 2,225.60
    expect(
      computeProductQuote(
        { category: 'PHONE_USED', cashPrice: null, installmentPrice: '20000' },
        { ...CONFIG_WITH_RATES, minInstallmentMonths: 6, maxInstallmentMonths: 10, rates: [] },
      ),
    ).toEqual({
      cashPrice: null,
      installmentPrice: 20000,
      months: 10,
      monthlyPayment: 2225.6,
      downAmount: 4000,
    });
  });

  it('ไม่มีราคาผ่อน → ไม่มีบรรทัดผ่อน (ไม่ throw)', () => {
    expect(
      computeProductQuote(
        { category: 'PHONE_NEW', cashPrice: '32900', installmentPrice: null },
        CONFIG_WITH_RATES,
      ),
    ).toEqual({
      cashPrice: 32900,
      installmentPrice: null,
      months: null,
      monthlyPayment: null,
      downAmount: null,
    });
  });

  it('ไม่มี InterestConfig ของหมวดนี้ → ไม่มีบรรทัดผ่อน', () => {
    expect(
      computeProductQuote(
        { category: 'ACCESSORY', cashPrice: '590', installmentPrice: '590' },
        null,
      ),
    ).toEqual({
      cashPrice: 590,
      installmentPrice: 590,
      months: null,
      monthlyPayment: null,
      downAmount: null,
    });
  });
});

// Fix round 1 [C1]: guard ราคา 0/ติดลบ — a column or prices[] row that is
// non-positive must be treated as "no price", never as a real value that
// short-circuits past the label-chain fallback. Reproduces the reviewer's
// repro (cashPrice: '0' with a real ฿15,000 row) and its mirror on the
// prices[] side (a 0-amount row must be skipped, not surfaced).
describe('resolveProductPrices — Fix round 1 [C1]: positive-only guard, both layers', () => {
  it('คอลัมน์เป็น 0 → ถือว่าไม่มีราคา → fallback ไปแถวจริง (reviewer repro)', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_NEW',
        cashPrice: '0',
        installmentPrice: null,
        prices: [{ label: 'ราคาเงินสด', amount: '15000' }],
      }),
    ).toEqual({ cash: 15000, installment: null });
  });

  it('คอลัมน์ติดลบ → ถือว่าไม่มีราคาเช่นกัน → fallback ไปแถวจริง', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_NEW',
        cashPrice: '-100',
        installmentPrice: null,
        prices: [{ label: 'ราคาเงินสด', amount: '15000' }],
      }),
    ).toEqual({ cash: 15000, installment: null });
  });

  it('แถว prices[] เป็น 0 และไม่มีแถวอื่น → null (ห้ามให้แถว 0 ชนะ)', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_USED',
        cashPrice: null,
        installmentPrice: null,
        prices: [{ label: 'ราคาเงินสด', amount: '0' }],
      }),
    ).toEqual({ cash: null, installment: null });
  });

  it('แถว prices[] เป็น 0 ปนกับแถวจริง (prefix match) → ข้ามแถว 0 ไปแถวถัดไปที่ใช้ได้', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_USED',
        cashPrice: null,
        installmentPrice: null,
        prices: [
          { label: 'ราคาเงินสด', amount: '0' },
          { label: 'ราคาเงินสดพิเศษ', amount: '12000' },
        ],
      }),
    ).toEqual({ cash: 12000, installment: null });
  });
});

describe('computeProductQuote — Fix round 1 [C1]: installmentPrice 0/negative never quotes', () => {
  it('installmentPrice คอลัมน์เป็น 0 + ไม่มีแถว prices[] → ไม่มีบรรทัดผ่อน (ไม่ throw)', () => {
    expect(
      computeProductQuote(
        { category: 'PHONE_NEW', cashPrice: '19500', installmentPrice: '0' },
        CONFIG_WITH_RATES,
      ),
    ).toEqual({
      cashPrice: 19500,
      installmentPrice: null,
      months: null,
      monthlyPayment: null,
      downAmount: null,
    });
  });
});

// Fix round 1 [I1]: getQuotes/getQuote had zero coverage — a mutation that
// swaps first-wins for last-wins, or that queries per-item instead of once
// per batch, left the 7 pure-function golden tests green. These lock the
// class-level contract with a mocked PrismaService.
describe('ProductQuoteService', () => {
  const CONFIG_OLDEST = {
    id: 'cfg-old',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    productCategories: ['PHONE_NEW'],
    minDownPaymentPct: '0.1000',
    storeCommissionPct: '0.0500',
    vatPct: '0.0700',
    interestRate: '0.0200',
    minInstallmentMonths: 6,
    maxInstallmentMonths: 6,
    rates: [{ months: 6, ratePct: '0.1000' }],
  };
  const CONFIG_NEWEST = {
    id: 'cfg-new',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    productCategories: ['PHONE_NEW'],
    minDownPaymentPct: '0.5000',
    storeCommissionPct: '0.5000',
    vatPct: '0.5000',
    interestRate: '0.5000',
    minInstallmentMonths: 3,
    maxInstallmentMonths: 3,
    rates: [{ months: 3, ratePct: '0.9000' }],
  };

  const makeService = (configs: unknown[]) => {
    const findMany = jest.fn().mockResolvedValue(configs);
    const prisma = { interestConfig: { findMany } } as unknown as PrismaService;
    return { service: new ProductQuoteService(prisma), findMany };
  };

  it('2 config ใน category เดียว → เลือกตัว createdAt เก่าสุด (first-wins, catches a first/last-wins swap)', async () => {
    // Prisma's `orderBy: { createdAt: 'asc' }` means the mocked findMany
    // response is already in that order — oldest first, as the real query
    // would return it.
    const { service } = makeService([CONFIG_OLDEST, CONFIG_NEWEST]);

    const [quote] = await service.getQuotes([
      { category: 'PHONE_NEW', cashPrice: null, installmentPrice: '10000' },
    ]);

    // CONFIG_OLDEST → 6 months; CONFIG_NEWEST → 3 months. If first-wins were
    // ever flipped to last-wins, this would assert months: 3 and fail.
    expect(quote.months).toBe(6);
  });

  it('getQuotes กับ 3 inputs → query InterestConfig ครั้งเดียว (catches N+1)', async () => {
    const { service, findMany } = makeService([CONFIG_OLDEST]);

    await service.getQuotes([
      { category: 'PHONE_NEW', cashPrice: '1000', installmentPrice: null },
      { category: 'PHONE_NEW', cashPrice: '2000', installmentPrice: null },
      { category: 'PHONE_USED', cashPrice: '3000', installmentPrice: null },
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        productCategories: { hasSome: ['PHONE_NEW', 'PHONE_USED'] },
        deletedAt: null,
        isActive: true,
      },
      include: { rates: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('getQuotes([]) → [] ทันที ไม่ query DB เลย', async () => {
    const { service, findMany } = makeService([]);

    await expect(service.getQuotes([])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('getQuote delegate ไปยัง getQuotes([input]) แล้วคืนตัวแรก', async () => {
    const { service, findMany } = makeService([CONFIG_OLDEST]);
    const getQuotesSpy = jest.spyOn(service, 'getQuotes');

    const quote = await service.getQuote({
      category: 'PHONE_NEW',
      cashPrice: '19500',
      installmentPrice: '20000',
    });

    expect(getQuotesSpy).toHaveBeenCalledWith([
      { category: 'PHONE_NEW', cashPrice: '19500', installmentPrice: '20000' },
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(quote.cashPrice).toBe(19500);
    expect(quote.installmentPrice).toBe(20000);
    expect(quote.months).toBe(6);
  });
});
