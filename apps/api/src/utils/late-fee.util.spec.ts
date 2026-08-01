import { computeBracketLateFee, resolveLateFee, resolveLivePaymentLateFee, type LateFeeConfig } from './late-fee.util';

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

// resolveLateFee historically dispatched by `late_fee_mode` (PER_DAY vs BRACKET).
// CPA ยืนยันขั้นบันไดถาวร 2026-08-01 — PER_DAY was retired and BRACKET is now
// the only formula, so resolveLateFee is a thin pass-through to
// computeBracketLateFee (kept as a named export so call sites don't need to
// import computeBracketLateFee directly).
describe('resolveLateFee — flat-bracket pass-through', () => {
  const cfg: LateFeeConfig = { tier1Amount: 50, tier2Amount: 100, tier2MinDays: 3 };
  it('1 day → tier1 (50)', () => {
    expect(s(resolveLateFee(cfg, 1))).toBe('50');
  });
  it('10 days → tier2 (100, at >=3 days)', () => {
    expect(s(resolveLateFee(cfg, 10))).toBe('100');
  });
});

describe('resolveLivePaymentLateFee — display-side live late fee (flat-bracket)', () => {
  const cfg: LateFeeConfig = { tier1Amount: 50, tier2Amount: 100, tier2MinDays: 3 };
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const now = () => new Date();

  it('waived installment → 0 regardless of days overdue', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(30), amountDue: 3671, lateFeeWaived: true },
        cfg,
        now(),
      ).toNumber(),
    ).toBe(0);
  });

  it('future due date (not yet overdue) → 0', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(-2), amountDue: 3671, lateFeeWaived: false },
        cfg,
        now(),
      ).toNumber(),
    ).toBe(0);
  });

  it('due today (0 whole days overdue) → 0', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: now(), amountDue: 3671, lateFeeWaived: false },
        cfg,
        now(),
      ).toNumber(),
    ).toBe(0);
  });

  it('1 day overdue → tier1 (50)', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(1), amountDue: 3671, lateFeeWaived: false },
        cfg,
        now(),
      ).toNumber(),
    ).toBe(50);
  });

  it('30 days overdue → still flat tier2 (100 — does not grow with days or amountDue)', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(30), amountDue: 3671, lateFeeWaived: false },
        cfg,
        now(),
      ).toNumber(),
    ).toBe(100);
  });
});
