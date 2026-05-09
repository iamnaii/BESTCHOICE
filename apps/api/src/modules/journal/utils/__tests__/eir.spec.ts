import { describe, it, expect } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { solveMonthlyEIR, buildEIRSchedule, allocateInterestEIR } from '../eir';

describe('EIR Solver (TFRS 15 §60-65)', () => {
  describe('solveMonthlyEIR', () => {
    it('solves for standard 12-month contract (11K principal, 1416.66/mo, 12 periods)', () => {
      const r = solveMonthlyEIR(new Decimal(11000), new Decimal(1416.66), 12);
      // Expected ≈ 0.074 (7.4% monthly)
      expect(r.toNumber()).toBeCloseTo(0.074, 3);
    });

    it('verifies solution by reconstructing principal', () => {
      const r = solveMonthlyEIR(new Decimal(11000), new Decimal(1416.66), 12);
      const rNum = r.toNumber();
      // P = PMT × (1 - (1+r)^-n) / r
      const reconstructed = (1416.66 * (1 - Math.pow(1 + rNum, -12))) / rNum;
      expect(reconstructed).toBeCloseTo(11000, 1);
    });

    it('throws when totalPayments <= principal', () => {
      expect(() => solveMonthlyEIR(new Decimal(10000), new Decimal(800), 12)).toThrow();
    });

    it('throws on invalid inputs', () => {
      expect(() => solveMonthlyEIR(new Decimal(0), new Decimal(100), 12)).toThrow();
      expect(() => solveMonthlyEIR(new Decimal(100), new Decimal(0), 12)).toThrow();
      expect(() => solveMonthlyEIR(new Decimal(100), new Decimal(50), 0)).toThrow();
    });
  });

  describe('buildEIRSchedule', () => {
    it('builds 12-period schedule for standard contract', () => {
      const schedule = buildEIRSchedule(new Decimal(11000), new Decimal(1416.66), 12);
      expect(schedule).toHaveLength(12);

      // Period 1 starts with full principal
      expect(schedule[0].openingPrincipal.toNumber()).toBe(11000);

      // Period 12 closes at 0
      expect(schedule[11].closingPrincipal.toNumber()).toBe(0);

      // Interest declines over time
      expect(schedule[0].interest.gt(schedule[11].interest)).toBe(true);
    });

    it('total principal payments sum to principal', () => {
      const schedule = buildEIRSchedule(new Decimal(11000), new Decimal(1416.66), 12);
      const sumPrincipal = schedule.reduce((s, p) => s.add(p.principalPayment), new Decimal(0));
      expect(sumPrincipal.toNumber()).toBeCloseTo(11000, 2);
    });

    it('first period interest is highest (principal × r)', () => {
      const schedule = buildEIRSchedule(new Decimal(11000), new Decimal(1416.66), 12);
      const r = solveMonthlyEIR(new Decimal(11000), new Decimal(1416.66), 12);
      const expectedFirst = new Decimal(11000).mul(r).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      expect(schedule[0].interest.toString()).toBe(expectedFirst.toString());
    });
  });

  describe('allocateInterestEIR', () => {
    it('allocates totalInterest=6000 over 12 periods, final adjusted', () => {
      const interests = allocateInterestEIR(new Decimal(11000), new Decimal(6000), 12);
      expect(interests).toHaveLength(12);

      // Sum = exactly 6000
      const sum = interests.reduce((a, b) => a.add(b), new Decimal(0));
      expect(sum.toString()).toBe('6000');

      // Period 1 highest, period 12 lowest
      expect(interests[0].gt(interests[11])).toBe(true);

      // Period 1 ≈ 11000 × 7.4% ≈ 814 (vs straight-line 500 — note +62.8% deviation)
      expect(interests[0].toNumber()).toBeGreaterThan(700);
      expect(interests[0].toNumber()).toBeLessThan(900);
    });

    it('handles totalMonths=1 edge case', () => {
      const interests = allocateInterestEIR(new Decimal(1000), new Decimal(100), 1);
      expect(interests).toHaveLength(1);
      expect(interests[0].toString()).toBe('100');
    });
  });
});
