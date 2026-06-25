import { computeBracketLateFee, computePerDayLateFee, resolveLateFee, type LateFeeConfig } from './late-fee.util';

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
