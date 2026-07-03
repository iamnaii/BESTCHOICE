import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GetInstallmentRatesTool } from './get-installment-rates.tool';

/**
 * Issue #1332 — when search_products finds nothing (or priceMissing), the
 * bot answers with the shop's real installment rates instead of going
 * silent. This tool reads the SAME finance source the contract system uses
 * (InterestConfig + InterestConfigRate).
 *
 * Rate semantics (see get-rate-for-months.util.ts:9-11,
 * interest-config.service.ts + installment-preview.service.ts synthesis):
 * - `InterestConfigRate.ratePct` = TOTAL flat rate for that term
 *   (financed × ratePct = interest for the whole contract)
 * - legacy `InterestConfig.interestRate` = PER-MONTH flat rate
 *   (total for m months = interestRate × m)
 * NOT annual — an annual reading (× tenure/12) misstates every non-12-month
 * term. The 10-งวด fixtures below fail under the annual interpretation.
 *
 * Grounding contract (review #1332 Critical 2a): the result is
 * percent-and-terms ONLY — no invented baht amounts. It must never
 * contribute keys that collectGroundedPrices scans (priceThb / monthly /
 * minPrice / maxPrice), so the grounded set stays empty after this tool and
 * any baht figure the model invents is still HALLUCINATION_BLOCKED. Real
 * baht examples come later via calculate_installment on a real product.
 */

const makePrisma = (configs: unknown[]): PrismaService =>
  ({
    interestConfig: { findMany: jest.fn().mockResolvedValue(configs) },
  }) as unknown as PrismaService;

const rateRow = (months: number, ratePct: string) => ({
  months,
  ratePct: new Prisma.Decimal(ratePct),
});

const cfg = (over: Record<string, unknown> = {}) => ({
  name: 'มือ1',
  interestRate: new Prisma.Decimal('0.02'),
  minDownPaymentPct: new Prisma.Decimal('0.20'),
  minInstallmentMonths: 3,
  maxInstallmentMonths: 12,
  rates: [] as unknown[],
  ...over,
});

const GROUNDED_KEYS = ['priceThb', 'monthly', 'minPrice', 'maxPrice'];
const collectKeys = (value: unknown, into: Set<string>): void => {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, into);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    into.add(k);
    collectKeys(v, into);
  }
};

describe('GetInstallmentRatesTool.run', () => {
  it('InterestConfigRate.ratePct is the TOTAL rate for the term (10 งวด fixture — fails under annual reading)', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([cfg({ rates: [rateRow(10, '0.24')] })]),
    );
    const r: any = await tool.run({});

    // 0.24 = 24% TOTAL over 10 months (annual reading would claim 20%).
    expect(r.configs[0].terms).toEqual([
      { tenureMonths: 10, totalRatePct: 24, perMonthRatePct: 2.4 },
    ]);
  });

  it('returns per-term totals + per-month breakdown + min down payment from rate rows', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([
        cfg({ rates: [rateRow(6, '0.10'), rateRow(12, '0.30')] }),
      ]),
    );
    const r: any = await tool.run({});

    expect(r.configs).toEqual([
      {
        name: 'มือ1',
        minDownPaymentPct: 20,
        terms: [
          { tenureMonths: 6, totalRatePct: 10, perMonthRatePct: 1.67 },
          { tenureMonths: 12, totalRatePct: 30, perMonthRatePct: 2.5 },
        ],
      },
    ]);
  });

  it('legacy fallback: interestRate is PER-MONTH — total for the term = rate × months (10 งวด fixture)', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([
        cfg({
          interestRate: new Prisma.Decimal('0.02'),
          minInstallmentMonths: 3,
          maxInstallmentMonths: 10,
          rates: [],
        }),
      ]),
    );
    const r: any = await tool.run({});

    // Synthesized per allowed month (mirrors installment-preview.service.ts).
    const terms = r.configs[0].terms;
    expect(terms).toHaveLength(8); // 3..10
    expect(terms[0]).toEqual({ tenureMonths: 3, totalRatePct: 6, perMonthRatePct: 2 });
    // 10 งวด: 2%/เดือน × 10 = 20% TOTAL (the old code reported 2%).
    expect(terms[7]).toEqual({ tenureMonths: 10, totalRatePct: 20, perMonthRatePct: 2 });
  });

  it('returns ALL active configs labeled by name (มือ1/มือ2), not just the latest', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([
        cfg({ name: 'มือ1', rates: [rateRow(12, '0.30')] }),
        cfg({
          name: 'มือ2',
          minDownPaymentPct: new Prisma.Decimal('0.30'),
          rates: [rateRow(6, '0.12')],
        }),
      ]),
    );
    const r: any = await tool.run({});

    expect(r.configs).toHaveLength(2);
    expect(r.configs.map((c: any) => c.name)).toEqual(['มือ1', 'มือ2']);
    expect(r.configs[1]).toMatchObject({
      minDownPaymentPct: 30,
      terms: [{ tenureMonths: 6, totalRatePct: 12, perMonthRatePct: 2 }],
    });
  });

  it('result carries NO grounded-price keys (percent-only — invented baht stays blocked)', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([
        cfg({ rates: [rateRow(6, '0.10'), rateRow(12, '0.30')] }),
        cfg({ name: 'มือ2', rates: [] }),
      ]),
    );
    const r = await tool.run({});

    const keys = new Set<string>();
    collectKeys(r, keys);
    for (const banned of GROUNDED_KEYS) {
      expect(keys.has(banned)).toBe(false);
    }
  });

  it('returns no_active_rate_config error when no active InterestConfig exists (no silent throw)', async () => {
    const tool = new GetInstallmentRatesTool(makePrisma([]));
    expect(await tool.run({})).toEqual({ error: 'no_active_rate_config' });
  });

  it('accepts any/no input args (loose schema — bot may call with {} )', async () => {
    const tool = new GetInstallmentRatesTool(
      makePrisma([cfg({ rates: [rateRow(12, '0.30')] })]),
    );
    await expect(tool.run()).resolves.toMatchObject({
      configs: [expect.objectContaining({ minDownPaymentPct: 20 })],
    });
    await expect(tool.run({ anything: 'ignored' })).resolves.toMatchObject({
      configs: [expect.objectContaining({ minDownPaymentPct: 20 })],
    });
  });
});
