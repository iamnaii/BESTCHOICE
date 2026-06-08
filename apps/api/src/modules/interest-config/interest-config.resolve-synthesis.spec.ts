import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InterestConfigService } from './interest-config.service';

/**
 * Characterization (golden) tests for InterestConfigService.resolveConfig — the
 * interest-rate / down-payment / commission resolver that prices every installment
 * contract (interest-config.service.ts ~71-126). Wave 3 gap-fill (audit HIGH gap).
 *
 * The sibling interest-config.resolve.spec.ts already pins ONE synthesis case
 * (0.05 / min3 / max5) and ONE per-month-rows case. This file widens coverage of the
 * EXACT current behaviour. The service source is NOT modified; surprising / imprecise
 * behaviour is encoded as the golden value and flagged.
 *
 * Bands / branches this file locks:
 *  - SCALAR SYNTHESIS branch (100-117) — fired when `allowedMonths.length === 0`:
 *      * interestRate=0.03, min=6, max=24 -> allowedMonths = [6..24] (19 entries),
 *        ratePctByMonths[6]=0.18, ratePctByMonths[24]=0.72 (these products are exact).
 *      * min === max === 6 -> allowedMonths = [6], ratePctByMonths = { 6: 0.18 }.
 *      * interestRate=0.07, m=3 -> ratePctByMonths[3] = 0.07*3 = 0.21000000000000002,
 *        a raw JS-float imprecision (review finding D4: `rate * m`). Locked with
 *        toBeCloseTo to DOCUMENT — not hide — the imprecision (QUIRK).
 *      * NOTE the two parallel month lists are built DIFFERENTLY: ratePctByMonths is
 *        keyed by a `for (m = min; m <= max; m++)` loop, allowedMonths is rebuilt via
 *        Array.from({length: max-min+1}). Both span the same range; this pins they agree.
 *  - PER-MONTH RATES branch (92-98, 119-125) — fired when ≥1 non-deleted rate row:
 *      * rows present -> map path, synthesis NEVER runs; Number(Decimal('0.18')) === 0.18.
 *      * allowedMonths sorted ascending from the row months.
 *      * rates:[] (empty after the deletedAt:null include filter) -> length 0 -> FALLS
 *        THROUGH to scalar synthesis. It is NOT returned as an empty map (QUIRK: an
 *        active config row with zero live rate rows still yields a fully-priced result).
 *  - PRECEDENCE / no-match fallback (81-90):
 *      * findFirst -> null (no active, non-deleted config whose productCategories
 *        `has` the category) returns the HARD-CODED system defaults
 *        { minDownPct: 0.15, commissionPct: 0.1, vatPct: 0.07, ratePctByMonths: {},
 *          allowedMonths: [] } — independent of any stored config.
 *      * a matched active config OVERRIDES those defaults with its own stored scalars.
 *
 * Mock-only — no DB, no vitest. PrismaService is a hand-mocked stub exposing only
 * interestConfig.findFirst as a jest.fn(). The service constructor takes only
 * PrismaService (see interest-config.service.ts:7), so no other deps to stub.
 *
 * Money note: the per-month branch coerces the stored Prisma.Decimal ratePct via
 * Number(r.ratePct), so rate rows here pass REAL Prisma.Decimal values to keep that
 * coercion faithful. The scalar branch does Number(cfg.interestRate) then `rate * m`
 * in plain JS floats, so the scalar config fields are plain numbers (matching what
 * the code actually does).
 */

type ResolvedConfig = Awaited<ReturnType<InterestConfigService['resolveConfig']>>;

const makeSvc = (cfg: unknown) => {
  const findFirst = jest.fn().mockResolvedValue(cfg);
  const prisma = {
    interestConfig: { findFirst },
  } as unknown as PrismaService;
  return { svc: new InterestConfigService(prisma), findFirst };
};

describe('InterestConfigService.resolveConfig — scalar synthesis branch (100-117)', () => {
  it('spans min..max inclusive: 0.03 / min6 / max24 -> 19 months, endpoints 0.18 & 0.72', async () => {
    const { svc } = makeSvc({
      minDownPaymentPct: 0.2,
      storeCommissionPct: 0.1,
      vatPct: 0.07,
      interestRate: 0.03,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 24,
      rates: [],
    });

    const r: ResolvedConfig = await svc.resolveConfig('PHONE_NEW');

    // allowedMonths = Array.from({length: 24-6+1=19}, ...) = [6,7,...,24]
    expect(r.allowedMonths).toHaveLength(19);
    expect(r.allowedMonths).toEqual([
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);

    // ratePctByMonths keyed by the for-loop over the same range — endpoints exact
    expect(r.ratePctByMonths[6]).toBe(0.18); // 0.03 * 6
    expect(r.ratePctByMonths[24]).toBe(0.72); // 0.03 * 24

    // ratePctByMonths keys agree with allowedMonths (the two parallel builders)
    expect(Object.keys(r.ratePctByMonths).map(Number).sort((a, b) => a - b)).toEqual(
      r.allowedMonths,
    );

    // scalar config fields pass through via Number()
    expect(r.minDownPct).toBe(0.2);
    expect(r.commissionPct).toBe(0.1);
    expect(r.vatPct).toBe(0.07);
  });

  it('min === max === 6 -> single-month allowedMonths [6], ratePctByMonths { 6: 0.18 }', async () => {
    const { svc } = makeSvc({
      minDownPaymentPct: 0.15,
      storeCommissionPct: 0.1,
      vatPct: 0.07,
      interestRate: 0.03,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 6,
      rates: [],
    });

    const r: ResolvedConfig = await svc.resolveConfig('PHONE_NEW');

    expect(r.allowedMonths).toEqual([6]); // length = 6-6+1 = 1
    expect(r.ratePctByMonths).toEqual({ 6: 0.18 });
  });

  it('QUIRK: 0.07 * 3 synthesises a raw-float imprecision 0.21000000000000002', async () => {
    const { svc } = makeSvc({
      minDownPaymentPct: 0.15,
      storeCommissionPct: 0.1,
      vatPct: 0.07,
      interestRate: 0.07, // scalar monthly rate
      minInstallmentMonths: 3,
      maxInstallmentMonths: 3,
      rates: [],
    });

    const r: ResolvedConfig = await svc.resolveConfig('PHONE_NEW');

    expect(r.allowedMonths).toEqual([3]);
    // 0.07 * 3 is NOT exactly 0.21 in IEEE-754 — locked with toBeCloseTo to document
    // the documented imprecision (review finding D4). The raw value is 0.21000000000000002.
    expect(r.ratePctByMonths[3]).toBeCloseTo(0.21, 10);
    expect(r.ratePctByMonths[3]).not.toBe(0.21); // pins the imprecision EXISTS
    expect(r.ratePctByMonths[3]).toBe(0.07 * 3); // === the exact raw float the code stores
  });
});

describe('InterestConfigService.resolveConfig — per-month rates branch (92-98, 119-125)', () => {
  it('uses the row map (synthesis never runs) and coerces Decimal ratePct via Number()', async () => {
    const { svc } = makeSvc({
      minDownPaymentPct: 0.2,
      storeCommissionPct: 0.1,
      vatPct: 0.07,
      // these scalars would synthesise [6..12] if the rows were absent — they must be ignored
      interestRate: 0.03,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 12,
      rates: [
        { months: 12, ratePct: new Prisma.Decimal('0.36'), deletedAt: null },
        { months: 6, ratePct: new Prisma.Decimal('0.18'), deletedAt: null },
      ],
    });

    const r: ResolvedConfig = await svc.resolveConfig('PHONE_NEW');

    // sorted ascending from the row months — NOT the synthesised [6..12]
    expect(r.allowedMonths).toEqual([6, 12]);
    // Number(Decimal('0.18')) === 0.18, Number(Decimal('0.36')) === 0.36
    expect(r.ratePctByMonths).toEqual({ 6: 0.18, 12: 0.36 });
    expect(r.minDownPct).toBe(0.2);
  });

  it('QUIRK: rates:[] (empty after deletedAt filter) FALLS THROUGH to scalar synthesis', async () => {
    // The include `rates: { where: { deletedAt: null } }` can yield an EMPTY array even
    // for an active config (all rate rows soft-deleted). length === 0 => synthesis runs.
    const { svc } = makeSvc({
      minDownPaymentPct: 0.25,
      storeCommissionPct: 0.12,
      vatPct: 0.07,
      interestRate: 0.05,
      minInstallmentMonths: 3,
      maxInstallmentMonths: 5,
      rates: [],
    });

    const r: ResolvedConfig = await svc.resolveConfig('PHONE_NEW');

    // NOT returned as an empty map — a fully-priced synthesised result instead
    expect(r.allowedMonths).toEqual([3, 4, 5]);
    expect(Object.keys(r.ratePctByMonths)).toHaveLength(3);
    expect(r.ratePctByMonths[3]).toBeCloseTo(0.15, 10); // 0.05 * 3
    expect(r.ratePctByMonths[4]).toBeCloseTo(0.2, 10); // 0.05 * 4
    expect(r.ratePctByMonths[5]).toBeCloseTo(0.25, 10); // 0.05 * 5
    // synthesised scalars come from the config row, not the system defaults
    expect(r.minDownPct).toBe(0.25);
    expect(r.commissionPct).toBe(0.12);
  });
});

describe('InterestConfigService.resolveConfig — precedence / no-match fallback (81-90)', () => {
  it('returns hard-coded system defaults when no active config matches the category', async () => {
    const { svc, findFirst } = makeSvc(null);

    const r: ResolvedConfig = await svc.resolveConfig('UNKNOWN_CATEGORY');

    expect(r).toEqual({
      minDownPct: 0.15,
      commissionPct: 0.1,
      vatPct: 0.07,
      ratePctByMonths: {},
      allowedMonths: [],
    });

    // pin the match key: has(category) + deletedAt:null + isActive:true, include live rates
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        productCategories: { has: 'UNKNOWN_CATEGORY' },
        deletedAt: null,
        isActive: true,
      },
      include: { rates: { where: { deletedAt: null } } },
    });
  });

  it('a matched active config OVERRIDES the hard-coded defaults with its own scalars', async () => {
    // distinct from every default value (0.15 / 0.1 / 0.07) to prove the override path
    const { svc } = makeSvc({
      minDownPaymentPct: 0.3,
      storeCommissionPct: 0.08,
      vatPct: 0.0,
      interestRate: 0.04,
      minInstallmentMonths: 10,
      maxInstallmentMonths: 10,
      rates: [],
    });

    const r: ResolvedConfig = await svc.resolveConfig('PHONE_NEW');

    expect(r.minDownPct).toBe(0.3); // not 0.15
    expect(r.commissionPct).toBe(0.08); // not 0.1
    expect(r.vatPct).toBe(0.0); // not 0.07
    expect(r.allowedMonths).toEqual([10]);
    expect(r.ratePctByMonths).toEqual({ 10: 0.04 * 10 });
  });
});
