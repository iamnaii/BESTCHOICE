import { Prisma } from '@prisma/client';
import { computeCommissionAmount } from './commission.util';

describe('computeCommissionAmount', () => {
  it('exact half-up where float Math.round drops a satang (5.50 × 0.03 = 0.165 → 0.17)', () => {
    // Current float `Math.round(5.5 * 0.03 * 100) / 100` yields 0.16 — one satang short.
    expect(computeCommissionAmount(5.5, 0.03).toFixed(2)).toBe('0.17');
  });

  it('33.50 × 0.03 = 1.005 → 1.01 (float yields 1.00)', () => {
    expect(computeCommissionAmount(33.5, 0.03).toFixed(2)).toBe('1.01');
  });

  it('normal case is unchanged (10000 × 0.03 = 300.00)', () => {
    expect(computeCommissionAmount(10000, 0.03).toFixed(2)).toBe('300.00');
  });

  it('accepts Prisma.Decimal inputs (rate stored as Decimal)', () => {
    expect(
      computeCommissionAmount(new Prisma.Decimal('1675'), new Prisma.Decimal('0.03')).toFixed(2),
    ).toBe('50.25');
  });

  it('returns a Prisma.Decimal', () => {
    expect(computeCommissionAmount(1000, 0.03)).toBeInstanceOf(Prisma.Decimal);
  });
});
