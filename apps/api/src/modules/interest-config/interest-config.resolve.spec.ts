import { PrismaService } from '../../prisma/prisma.service';
import { InterestConfigService } from './interest-config.service';

/**
 * Characterization tests for InterestConfigService.resolveConfig (Wave 3 backfill).
 *
 * resolveConfig is the interest-rate / down-payment / commission resolver that
 * prices every installment contract, yet the existing spec only covered CRUD —
 * resolveConfig had no test (review finding D7). These lock: the system-default
 * fallback when no config matches, the per-month rate map (sorted allowedMonths),
 * and the scalar→per-month synthesis (rate × months) used before the per-month
 * backfill runs.
 *
 * NOTE: the synthesis path multiplies rates in raw JS floats (review finding D4 —
 * `rate * m`), so e.g. 0.05 × 3 is 0.150000000000000…; asserted with toBeCloseTo
 * to document, not hide, that imprecision.
 */

const makeSvc = (cfg: unknown) => {
  const prisma = {
    interestConfig: { findFirst: jest.fn().mockResolvedValue(cfg) },
  } as unknown as PrismaService;
  return new InterestConfigService(prisma);
};

describe('InterestConfigService.resolveConfig', () => {
  it('returns system defaults when no config matches the category', async () => {
    const r = await makeSvc(null).resolveConfig('PHONE_NEW');
    expect(r).toEqual({
      minDownPct: 0.15,
      commissionPct: 0.1,
      vatPct: 0.07,
      ratePctByMonths: {},
      allowedMonths: [],
    });
  });

  it('builds the per-month rate map and sorts allowedMonths', async () => {
    const r = await makeSvc({
      minDownPaymentPct: 0.2,
      storeCommissionPct: 0.1,
      vatPct: 0.07,
      interestRate: 0.03,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 12,
      rates: [
        { months: 12, ratePct: 0.36, deletedAt: null },
        { months: 6, ratePct: 0.18, deletedAt: null },
      ],
    }).resolveConfig('PHONE_NEW');

    expect(r.minDownPct).toBe(0.2);
    expect(r.commissionPct).toBe(0.1);
    expect(r.vatPct).toBe(0.07);
    expect(r.allowedMonths).toEqual([6, 12]); // sorted ascending
    expect(r.ratePctByMonths).toEqual({ 6: 0.18, 12: 0.36 });
  });

  it('synthesises per-month rates from the scalar interestRate when no per-month rows exist', async () => {
    const r = await makeSvc({
      minDownPaymentPct: 0.15,
      storeCommissionPct: 0.1,
      vatPct: 0.07,
      interestRate: 0.05, // scalar monthly rate
      minInstallmentMonths: 3,
      maxInstallmentMonths: 5,
      rates: [],
    }).resolveConfig('PHONE_NEW');

    expect(r.allowedMonths).toEqual([3, 4, 5]);
    expect(r.minDownPct).toBe(0.15);
    // rate × months (raw JS float)
    expect(r.ratePctByMonths[3]).toBeCloseTo(0.15, 10);
    expect(r.ratePctByMonths[4]).toBeCloseTo(0.2, 10);
    expect(r.ratePctByMonths[5]).toBeCloseTo(0.25, 10);
  });
});
