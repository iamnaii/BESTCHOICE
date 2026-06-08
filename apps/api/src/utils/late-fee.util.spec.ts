import { Prisma } from '@prisma/client';
import { computeCappedLateFee } from './late-fee.util';

describe('computeCappedLateFee', () => {
  const s = (d: Prisma.Decimal) => d.toString();

  it('the headline bug case: 2000฿ installment, 60 days, 50/day → capped at 5% = 100 (NOT 3000)', () => {
    const fee = computeCappedLateFee({
      daysOverdue: 60,
      feePerDay: 50,
      flatCap: 1500,
      capPct: 0.05,
      amountDue: 2000,
    });
    expect(s(fee)).toBe('100'); // min(3000, 1500, 100) = 100
  });

  it('per-day wins when it is the smallest (early overdue)', () => {
    // 2 days × 50 = 100; 5% of 2000 = 100; flat 1500 → min = 100
    expect(s(computeCappedLateFee({ daysOverdue: 2, feePerDay: 50, flatCap: 1500, capPct: 0.05, amountDue: 2000 }))).toBe('100');
    // 1 day × 50 = 50 → min(50, 1500, 100) = 50
    expect(s(computeCappedLateFee({ daysOverdue: 1, feePerDay: 50, flatCap: 1500, capPct: 0.05, amountDue: 2000 }))).toBe('50');
  });

  it('flat cap binds when amountDue is large and many days overdue', () => {
    // 100 days × 50 = 5000; 5% of 50000 = 2500; flat 1500 → min = 1500
    expect(s(computeCappedLateFee({ daysOverdue: 100, feePerDay: 50, flatCap: 1500, capPct: 0.05, amountDue: 50000 }))).toBe('1500');
  });

  it('without amountDue: only feePerDay×days and flatCap bound it (no % cap)', () => {
    // 60 × 50 = 3000, flat 1500 → 1500 (no 5% cap because amountDue omitted)
    expect(s(computeCappedLateFee({ daysOverdue: 60, feePerDay: 50, flatCap: 1500 }))).toBe('1500');
    // 5 × 50 = 250, flat 1500 → 250
    expect(s(computeCappedLateFee({ daysOverdue: 5, feePerDay: 50, flatCap: 1500 }))).toBe('250');
  });

  it('returns 0 for non-positive days (and floors fractional days)', () => {
    expect(s(computeCappedLateFee({ daysOverdue: 0, feePerDay: 50, flatCap: 1500, capPct: 0.05, amountDue: 2000 }))).toBe('0');
    expect(s(computeCappedLateFee({ daysOverdue: -3, feePerDay: 50, flatCap: 1500 }))).toBe('0');
    // 3.9 days floors to 3 → 150
    expect(s(computeCappedLateFee({ daysOverdue: 3.9, feePerDay: 50, flatCap: 1500 }))).toBe('150');
  });

  it('rounds HALF_UP to 2dp', () => {
    // 5% of 100.50 = 5.025 → 5.03 (and < 1×day fee of 50 / flat 1500)
    expect(s(computeCappedLateFee({ daysOverdue: 1, feePerDay: 50, flatCap: 1500, capPct: 0.05, amountDue: 100.5 }))).toBe('5.03');
  });
});
