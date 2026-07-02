import { computeBracketLateFee, computePerDayLateFee, resolveLateFee, resolveLivePaymentLateFee, type LateFeeConfig } from './late-fee.util';

const s = (d: { toString(): string }) => d.toString();

describe('computeBracketLateFee — flat brackets (no per-day, no cap)', () => {
  const cfg = { tier1Amount: 50, tier2Amount: 100, tier2MinDays: 3 };

  it('0 days overdue → 0', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 0, ...cfg }))).toBe('0');
  });
  it('1 day → tier1 (50)', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 1, ...cfg }))).toBe('50');
  });
  it('2 days → tier1 (50)', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 2, ...cfg }))).toBe('50');
  });
  it('3 days → tier2 (100)', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 3, ...cfg }))).toBe('100');
  });
  it('100 days → still flat tier2 (100, does not grow)', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 100, ...cfg }))).toBe('100');
  });
  it('floors fractional days (2.9 → 2 → tier1)', () => {
    expect(s(computeBracketLateFee({ daysOverdue: 2.9, ...cfg }))).toBe('50');
  });
  it('negative days → 0', () => {
    expect(s(computeBracketLateFee({ daysOverdue: -5, ...cfg }))).toBe('0');
  });
});

const sd = (d: { toString(): string }) => d.toString();

describe('computePerDayLateFee — min(days×rate, maxAmount, 5%×installment)', () => {
  const base = { perDayRate: 20, maxAmount: 500, capPct: 5 };
  it('0 days → 0', () => {
    expect(sd(computePerDayLateFee({ daysOverdue: 0, installmentGross: 1515.83, ...base }))).toBe('0');
  });
  it('per-day wins when small: 2 days × 20 = 40 (< maxAmount 500, < 5% 75.79)', () => {
    expect(sd(computePerDayLateFee({ daysOverdue: 2, installmentGross: 1515.83, ...base }))).toBe('40');
  });
  it('5% cap binds: 10 days × 20 = 200, but 5% × 1515.83 = 75.79 → 75.79', () => {
    expect(sd(computePerDayLateFee({ daysOverdue: 10, installmentGross: 1515.83, ...base }))).toBe('75.79');
  });
  it('absolute maxAmount binds when below 5%: rate 200/day, 5 days = 1000, maxAmount 500, 5% of 20000 = 1000 → 500', () => {
    expect(sd(computePerDayLateFee({ daysOverdue: 5, installmentGross: 20000, perDayRate: 200, maxAmount: 500, capPct: 5 }))).toBe('500');
  });
});

describe('resolveLateFee — mode dispatch', () => {
  const perDayCfg: LateFeeConfig = { mode: 'PER_DAY', tier1Amount: 50, tier2Amount: 100, tier2MinDays: 3, perDayRate: 20, maxAmount: 500, capPct: 5 };
  const bracketCfg: LateFeeConfig = { ...perDayCfg, mode: 'BRACKET' };
  it('PER_DAY mode → per-day formula (5% cap) ', () => {
    expect(sd(resolveLateFee(perDayCfg, 10, 1515.83))).toBe('75.79');
  });
  it('BRACKET mode → flat bracket (tier2 at >=3 days)', () => {
    expect(sd(resolveLateFee(bracketCfg, 10, 1515.83))).toBe('100');
  });
});

describe('resolveLivePaymentLateFee — display-side live late fee', () => {
  const perDay: LateFeeConfig = {
    mode: 'PER_DAY',
    tier1Amount: 50,
    tier2Amount: 100,
    tier2MinDays: 3,
    perDayRate: 20,
    maxAmount: 500,
    capPct: 5,
  };
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const now = () => new Date();

  it('waived installment → 0 regardless of days overdue', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(30), amountDue: 3671, lateFeeWaived: true },
        perDay,
        now(),
      ).toNumber(),
    ).toBe(0);
  });

  it('future due date (not yet overdue) → 0', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(-2), amountDue: 3671, lateFeeWaived: false },
        perDay,
        now(),
      ).toNumber(),
    ).toBe(0);
  });

  it('due today (0 whole days overdue) → 0', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: now(), amountDue: 3671, lateFeeWaived: false },
        perDay,
        now(),
      ).toNumber(),
    ).toBe(0);
  });

  it('PER_DAY ramp: 5 days × 20 = 100 (below the 5% cap of 183.55)', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(5), amountDue: 3671, lateFeeWaived: false },
        perDay,
        now(),
      ).toNumber(),
    ).toBe(100);
  });

  it('PER_DAY cap binds: 30 days → 5% × 3671 = 183.55', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(30), amountDue: 3671, lateFeeWaived: false },
        perDay,
        now(),
      ).toNumber(),
    ).toBe(183.55);
  });

  it('BRACKET mode: 30 days → flat tier2 (100)', () => {
    const bracket: LateFeeConfig = { ...perDay, mode: 'BRACKET' };
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(30), amountDue: 3671, lateFeeWaived: false },
        bracket,
        now(),
      ).toNumber(),
    ).toBe(100);
  });
});
