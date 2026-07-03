import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CalculateInstallmentTool } from './calculate-installment.tool';
import { InstallmentPreviewService } from '../../shop-catalog/installment-preview.service';

/**
 * Characterization tests for the sales-bot installment quote (Wave 3 backfill,
 * corrected under #1335).
 *
 * #1335 — the goldens below used to PIN the old (WRONG) behaviour: this tool
 * treated `InterestConfig.interestRate` as an ANNUAL rate and prorated it by
 * `tenureMonths / 12` (`financed × ratePct/100 × tenure/12`). The real
 * semantics — confirmed against `get-rate-for-months.util.ts`,
 * `interest-config.service.ts:100-105`, and
 * `installment-preview.service.ts:75-80` — are that `interestRate` is a
 * PER-MONTH rate and the TOTAL contract rate is `rate × months` (no ÷12);
 * `InterestConfigRate.ratePct` (per-term row, read via `getRateForMonths`)
 * is already the TOTAL rate for that term. Under the old formula, short
 * tenures were quoted at up to ~12× too little interest — real money quoted
 * to customers on Facebook/LINE. The fixtures below now assert the CORRECT
 * total-rate math; see the `getRateForMonths` parity + `installment-preview.service`
 * comparison tests at the bottom for direct proof against the contract engine.
 */

const makePrisma = (product: unknown, cfg: { id: string; interestRate: Prisma.Decimal } | null): PrismaService =>
  ({
    product: { findFirst: jest.fn().mockResolvedValue(product) },
    interestConfig: {
      findFirst: jest.fn().mockResolvedValue(cfg),
      // getRateForMonths' legacy fallback path re-reads the config by id.
      findUnique: jest.fn().mockResolvedValue(cfg),
    },
    interestConfigRate: { findUnique: jest.fn().mockResolvedValue(null) },
  }) as unknown as PrismaService;

const productAt = (price: string) => ({
  name: 'iPhone 15',
  prices: [{ amount: new Prisma.Decimal(price) }],
});
const cfgAt = (rateFraction: string) => ({
  id: 'ic-test',
  interestRate: new Prisma.Decimal(rateFraction),
});

describe('CalculateInstallmentTool.run', () => {
  const prevFlag = process.env.USE_NEW_RATE_LOOKUP;
  afterEach(() => {
    process.env.USE_NEW_RATE_LOOKUP = prevFlag;
  });

  it('quotes a 12-month deal using the TOTAL rate for the term (rate × months, not ÷12)', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productAt('10000'), cfgAt('0.30')));
    const r = await tool.run({ productId: 'p1', downPct: 20, tenureMonths: 12 });

    // financed 8000; TOTAL rate for 12 months = 0.30 × 12 = 3.6 (not 0.30 alone)
    // interest = round(8000 * 3.6) = 28800
    expect(r).toEqual({
      productName: 'iPhone 15',
      priceThb: 10000,
      downAmountThb: 2000, // round(10000 * 0.20)
      financedThb: 8000,
      tenureMonths: 12,
      ratePct: 360, // (0.30 * 12) * 100
      monthlyThb: 3067, // round((8000 + 28800) / 12)
      totalPaidThb: 38800, // 2000 + 36800
    });
  });

  it('defaults down payment to 20% when downPct is omitted', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productAt('10000'), cfgAt('0.30')));
    const r = await tool.run({ productId: 'p1', tenureMonths: 12 });
    expect(r).toMatchObject({ downAmountThb: 2000, financedThb: 8000 });
  });

  // TDD regression fixture (#1335): a non-12-month tenure that FAILS under the
  // old annual/12 interpretation. Under the old (wrong) formula:
  //   ratePct = 30, interest = round(8000 * 0.30 * (6/12)) = 1200, monthly = 1533
  // Under the correct TOTAL-rate formula (rate × months, no ÷12):
  //   totalRate = 0.30 * 6 = 1.8, interest = round(8000 * 1.8) = 14400, monthly = 3733
  it('does NOT prorate by tenure/12 — 6-month interest is rate × 6, not rate × 0.5 (#1335)', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productAt('10000'), cfgAt('0.30')));
    const r = await tool.run({ productId: 'p1', downPct: 20, tenureMonths: 6 });

    expect(r).toMatchObject({
      financedThb: 8000,
      monthlyThb: 3733, // round((8000 + 14400) / 6) — WOULD be 1533 under the old annual bug
      totalPaidThb: 24400, // 2000 + 22400
    });
  });

  it('reads InterestConfigRate per-term row when USE_NEW_RATE_LOOKUP=true (#1335)', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'true';
    const prisma = makePrisma(productAt('10000'), cfgAt('0.30')) as unknown as {
      interestConfigRate: { findUnique: jest.Mock };
    };
    // Per-term row overrides the legacy rate × months synthesis — this is the
    // TOTAL rate for exactly this term, straight from InterestConfigRate.
    prisma.interestConfigRate.findUnique.mockResolvedValue({
      ratePct: new Prisma.Decimal('0.5'),
      deletedAt: null,
    });
    const tool = new CalculateInstallmentTool(prisma as unknown as PrismaService);
    const r = await tool.run({ productId: 'p1', downPct: 20, tenureMonths: 6 });

    // financed 8000, TOTAL rate = 0.5 (from the per-term row, NOT 0.30*6=1.8)
    expect(r).toMatchObject({
      financedThb: 8000,
      ratePct: 50,
      monthlyThb: 2000, // round((8000 + 4000) / 6)
    });
  });

  it('uses rate 0 when no active InterestConfig matches the tenure', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productAt('10000'), null));
    const r = await tool.run({ productId: 'p1', downPct: 20, tenureMonths: 10 });

    expect(r).toMatchObject({
      ratePct: 0,
      monthlyThb: 800, // round(8000 / 10), no interest
      totalPaidThb: 10000,
    });
  });

  it('returns product_not_found when the product is missing', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(null, cfgAt('0.30')));
    expect(await tool.run({ productId: 'nope', tenureMonths: 12 })).toEqual({
      error: 'product_not_found',
    });
  });

  it('returns price_not_configured when the product has no default price', async () => {
    const tool = new CalculateInstallmentTool(
      makePrisma({ name: 'iPhone 15', prices: [] }, cfgAt('0.30')),
    );
    expect(await tool.run({ productId: 'p1', tenureMonths: 12 })).toEqual({
      error: 'price_not_configured',
    });
  });
});

/**
 * Direct comparison against `installment-preview.service` (the contract
 * engine's own quote preview) for the SAME product/config/months — the
 * acceptance criterion from #1335. commissionPct/vatPct are set to 0 here to
 * isolate the rate-resolution semantics under test (calculate_installment
 * has no commission/VAT fields — see result key contract in #1338); with
 * both zeroed, `calcBcInstallment`'s subtotal/totalWithVat collapse to
 * exactly financed+interest, so the two services' monthly figures must match
 * bit-for-bit once the rate math agrees.
 */
describe('CalculateInstallmentTool.run vs InstallmentPreviewService (#1335 parity)', () => {
  it('monthlyThb matches installment-preview.service.preview() monthlyPayment for identical inputs', async () => {
    const productId = 'p1';
    const installmentPrice = '24900';
    const months = 10;
    const configId = 'ic-002';
    const interestRate = new Prisma.Decimal('0.10'); // per-month, legacy path

    const calcTool = new CalculateInstallmentTool(
      ({
        product: {
          findFirst: jest.fn().mockResolvedValue({
            name: 'iPhone 13',
            prices: [{ amount: new Prisma.Decimal(installmentPrice) }],
          }),
        },
        interestConfig: {
          findFirst: jest.fn().mockResolvedValue({ id: configId, interestRate }),
          findUnique: jest.fn().mockResolvedValue({ id: configId, interestRate, deletedAt: null }),
        },
        interestConfigRate: { findUnique: jest.fn().mockResolvedValue(null) },
      } as unknown) as PrismaService,
    );

    const previewSvc = new InstallmentPreviewService(
      ({
        product: {
          findUnique: jest.fn().mockResolvedValue({
            id: productId,
            deletedAt: null,
            category: 'PHONE_USED',
            installmentPrice: new Prisma.Decimal(installmentPrice),
            prices: [],
          }),
        },
        interestConfig: {
          findFirst: jest.fn().mockResolvedValue({
            id: configId,
            interestRate,
            minDownPaymentPct: new Prisma.Decimal('0.20'),
            storeCommissionPct: new Prisma.Decimal('0'),
            vatPct: new Prisma.Decimal('0'),
            minInstallmentMonths: 6,
            maxInstallmentMonths: 10,
            rates: [],
          }),
        },
      } as unknown) as PrismaService,
    );

    const calcResult = await calcTool.run({ productId, downPct: 20, tenureMonths: months });
    const previewResult = await previewSvc.preview({
      productId,
      provider: 'BC',
      months,
      downPct: 0.2,
    } as never);

    expect(previewResult.available).toBe(true);
    expect((calcResult as { monthlyThb: number }).monthlyThb).toBe(previewResult.monthlyPayment);
  });
});
