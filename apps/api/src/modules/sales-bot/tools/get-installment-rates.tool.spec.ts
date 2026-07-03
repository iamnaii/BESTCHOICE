import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GetInstallmentRatesTool } from './get-installment-rates.tool';

/**
 * Issue #1332 — when search_products finds nothing (or priceMissing), the
 * bot needs to answer with the shop's real installment rates instead of
 * going silent. This tool reads the SAME finance source as
 * CalculateInstallmentTool (InterestConfig) so every number it returns is
 * real, not invented.
 *
 * Grounding-guard contract (see SalesBotService.collectGroundedPrices):
 * the `example.priceThb` / `example.monthly` fields use the EXACT key names
 * the guard already scans for, so a reply that quotes the illustrative
 * example passes guardGrounding without any change to the guard itself.
 */

const makePrisma = (cfg: unknown): PrismaService =>
  ({
    interestConfig: { findFirst: jest.fn().mockResolvedValue(cfg) },
  }) as unknown as PrismaService;

const rateRow = (months: number, ratePct: string) => ({
  months,
  ratePct: new Prisma.Decimal(ratePct),
});

describe('GetInstallmentRatesTool.run', () => {
  it('returns active per-term rates + min down payment from InterestConfigRate rows', async () => {
    const cfg = {
      interestRate: new Prisma.Decimal('0.30'),
      minDownPaymentPct: new Prisma.Decimal('0.20'),
      minInstallmentMonths: 3,
      maxInstallmentMonths: 12,
      rates: [rateRow(3, '0.05'), rateRow(6, '0.10'), rateRow(12, '0.30')],
    };
    const tool = new GetInstallmentRatesTool(makePrisma(cfg));
    const r = await tool.run({});

    expect(r).toMatchObject({
      activeTerms: [
        { tenureMonths: 3, ratePct: 5 },
        { tenureMonths: 6, ratePct: 10 },
        { tenureMonths: 12, ratePct: 30 },
      ],
      minDownPaymentPct: 20,
    });
  });

  it('example calculation uses grounded key names (priceThb/monthly) so guardGrounding accepts them', async () => {
    const cfg = {
      interestRate: new Prisma.Decimal('0.30'),
      minDownPaymentPct: new Prisma.Decimal('0.20'),
      minInstallmentMonths: 3,
      maxInstallmentMonths: 12,
      rates: [rateRow(12, '0.30')],
    };
    const tool = new GetInstallmentRatesTool(makePrisma(cfg));
    const r: any = await tool.run({});

    // Reference example: 10,000 THB illustrative price, 20% down, 12mo,
    // flat 30% interest over the full year (matches CalculateInstallmentTool
    // math): financed 8000, interest round(8000*0.30*1)=2400, monthly
    // round(10400/12)=867.
    expect(r.example).toEqual({
      priceThb: 10000,
      downPct: 20,
      tenureMonths: 12,
      monthly: 867,
    });
    // Exact key names collectGroundedPrices scans for — regression guard so
    // a future rename silently breaks the grounding contract.
    expect(Object.keys(r.example)).toEqual(
      expect.arrayContaining(['priceThb', 'monthly']),
    );
  });

  it('falls back to the flat top-level interestRate when no InterestConfigRate rows exist', async () => {
    const cfg = {
      interestRate: new Prisma.Decimal('0.25'),
      minDownPaymentPct: new Prisma.Decimal('0.20'),
      minInstallmentMonths: 3,
      maxInstallmentMonths: 10,
      rates: [],
    };
    const tool = new GetInstallmentRatesTool(makePrisma(cfg));
    const r = await tool.run({});

    expect(r).toMatchObject({
      activeTerms: [{ tenureMonths: 10, ratePct: 25 }],
      minDownPaymentPct: 20,
    });
  });

  it('returns no_active_rate_config error when there is no active InterestConfig row (no silent throw)', async () => {
    const tool = new GetInstallmentRatesTool(makePrisma(null));
    const r = await tool.run({});
    expect(r).toEqual({ error: 'no_active_rate_config' });
  });

  it('accepts any/no input args (loose schema — bot may call with {} )', async () => {
    const cfg = {
      interestRate: new Prisma.Decimal('0.30'),
      minDownPaymentPct: new Prisma.Decimal('0.20'),
      minInstallmentMonths: 3,
      maxInstallmentMonths: 12,
      rates: [rateRow(12, '0.30')],
    };
    const tool = new GetInstallmentRatesTool(makePrisma(cfg));
    await expect(tool.run()).resolves.toMatchObject({ minDownPaymentPct: 20 });
    await expect(tool.run({ anything: 'ignored' })).resolves.toMatchObject({
      minDownPaymentPct: 20,
    });
  });
});
