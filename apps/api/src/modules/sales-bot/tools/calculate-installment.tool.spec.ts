import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CalculateInstallmentTool } from './calculate-installment.tool';

/**
 * Characterization tests for the sales-bot installment quote (Wave 3 backfill).
 * `CalculateInstallmentTool.run` had no spec yet quotes regulated installment
 * money to customers via the bot. It currently does the math in raw JS
 * `Number()` + `Math.round` (review finding D4) — these goldens LOCK that
 * behaviour so a Decimal refactor is a deliberate, reviewed change (update the
 * goldens then), not a silent drift.
 */

const makePrisma = (
  product: unknown,
  cfg: unknown,
): PrismaService =>
  ({
    product: { findFirst: jest.fn().mockResolvedValue(product) },
    interestConfig: { findFirst: jest.fn().mockResolvedValue(cfg) },
  }) as unknown as PrismaService;

const productAt = (price: string) => ({
  name: 'iPhone 15',
  prices: [{ amount: new Prisma.Decimal(price) }],
});
const cfgAt = (rateFraction: string) => ({ interestRate: new Prisma.Decimal(rateFraction) });

describe('CalculateInstallmentTool.run', () => {
  it('quotes a 12-month deal: 20% down, 30% flat over full year', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productAt('10000'), cfgAt('0.30')));
    const r = await tool.run({ productId: 'p1', downPct: 20, tenureMonths: 12 });

    expect(r).toEqual({
      productName: 'iPhone 15',
      priceThb: 10000,
      downAmountThb: 2000, // round(10000 * 0.20)
      financedThb: 8000,
      tenureMonths: 12,
      ratePct: 30, // 0.30 * 100
      monthlyThb: 867, // round((8000 + 2400) / 12)
      totalPaidThb: 12400, // 2000 + 10400
    });
  });

  it('defaults down payment to 20% when downPct is omitted', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productAt('10000'), cfgAt('0.30')));
    const r = await tool.run({ productId: 'p1', tenureMonths: 12 });
    expect(r).toMatchObject({ downAmountThb: 2000, financedThb: 8000 });
  });

  it('prorates interest by tenure/12 (6 months = half a year)', async () => {
    const tool = new CalculateInstallmentTool(makePrisma(productAt('10000'), cfgAt('0.30')));
    const r = await tool.run({ productId: 'p1', downPct: 20, tenureMonths: 6 });

    // financed 8000, interest = round(8000 * 0.30 * 0.5) = 1200
    expect(r).toMatchObject({
      financedThb: 8000,
      monthlyThb: 1533, // round((8000 + 1200) / 6)
      totalPaidThb: 11200,
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
