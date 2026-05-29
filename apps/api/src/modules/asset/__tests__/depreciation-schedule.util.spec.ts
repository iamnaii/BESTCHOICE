import { describe, it, expect } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/library';
import {
  buildDepreciationSchedule,
  depreciationForPeriod,
} from '../depreciation-schedule.util';

const sum = (rows: { amount: Decimal }[]) =>
  rows.reduce((s, r) => s.plus(r.amount), new Decimal(0));

describe('buildDepreciationSchedule — daily straight-line', () => {
  describe('R2: first-period day count (start to month-end inclusive)', () => {
    it('start on last day of month → 1 day', () => {
      const { rows } = buildDepreciationSchedule({
        purchaseCost: 100000,
        residualValue: 0,
        usefulLifeMonths: 60,
        startDate: new Date('2026-04-30'),
      });
      expect(rows[0].period).toBe('2026-04');
      expect(rows[0].days).toBe(1);
    });

    it('start mid-month → remaining days of that month inclusive', () => {
      const { rows } = buildDepreciationSchedule({
        purchaseCost: 100000,
        residualValue: 0,
        usefulLifeMonths: 60,
        startDate: new Date('2026-04-15'),
      });
      expect(rows[0].period).toBe('2026-04');
      expect(rows[0].days).toBe(16); // 15..30 Apr inclusive
    });

    it('first-period amount = dailyDepr × days', () => {
      const sched = buildDepreciationSchedule({
        purchaseCost: 100000,
        residualValue: 0,
        usefulLifeMonths: 60,
        startDate: new Date('2026-04-15'),
      });
      const expected = sched.dailyDepr
        .times(16)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      expect(sched.rows[0].amount.toString()).toBe(expected.toString());
    });
  });

  describe('R3: daily rate uses fixed 365-day year', () => {
    it('totalDays = months/12 × 365 and dailyDepr = base/totalDays (4dp)', () => {
      const sched = buildDepreciationSchedule({
        purchaseCost: 10000,
        residualValue: 0,
        usefulLifeMonths: 12,
        startDate: new Date('2026-01-01'),
      });
      expect(sched.totalDays).toBe(365);
      // 10000 / 365 = 27.39726… → 27.3973
      expect(sched.dailyDepr.toString()).toBe('27.3973');
    });

    it('full 31-day month posts dailyDepr × 31 (HALF_UP)', () => {
      const { rows } = buildDepreciationSchedule({
        purchaseCost: 10000,
        residualValue: 0,
        usefulLifeMonths: 12,
        startDate: new Date('2026-01-01'),
      });
      // 27.3973 × 31 = 849.3163 → 849.32
      expect(rows[0].period).toBe('2026-01');
      expect(rows[0].days).toBe(31);
      expect(rows[0].amount.toString()).toBe('849.32');
    });
  });

  describe('R1: rounding + forced exact final period', () => {
    it('Σ amounts equals (cost − salvage) exactly, no residue', () => {
      const { rows } = buildDepreciationSchedule({
        purchaseCost: 30000,
        residualValue: 0,
        usefulLifeMonths: 36,
        startDate: new Date('2026-01-01'),
      });
      expect(sum(rows).toString()).toBe('30000');
    });

    it('final period is flagged and final NBV = salvage value', () => {
      const { rows } = buildDepreciationSchedule({
        purchaseCost: 100000,
        residualValue: 10000,
        usefulLifeMonths: 60,
        startDate: new Date('2026-04-15'),
      });
      const last = rows[rows.length - 1];
      expect(last.isFinal).toBe(true);
      expect(rows.filter((r) => r.isFinal)).toHaveLength(1);
      expect(last.netBookValue.toString()).toBe('10000');
      expect(sum(rows).toString()).toBe('90000'); // depreciable base
    });

    it('accumulated is monotonic and never exceeds the depreciable base', () => {
      const { rows } = buildDepreciationSchedule({
        purchaseCost: 55555,
        residualValue: 1234,
        usefulLifeMonths: 24,
        startDate: new Date('2026-07-20'),
      });
      let prev = new Decimal(-1);
      for (const r of rows) {
        expect(r.accumulated.gt(prev)).toBe(true);
        expect(r.accumulated.lte(new Decimal(55555 - 1234))).toBe(true);
        prev = r.accumulated;
      }
      expect(rows[rows.length - 1].accumulated.toString()).toBe(
        new Decimal(55555 - 1234).toString(),
      );
    });
  });

  describe('R4: disposal stops depreciation (no force-fill to salvage)', () => {
    it('disposal month counts actual days and keeps remaining NBV', () => {
      const { rows } = buildDepreciationSchedule({
        purchaseCost: 12000,
        residualValue: 0,
        usefulLifeMonths: 12, // totalDays 365, dailyDepr 32.8767
        startDate: new Date('2026-01-01'),
        disposalDate: new Date('2026-03-15'),
      });
      expect(rows).toHaveLength(3);
      const last = rows[2];
      expect(last.period).toBe('2026-03');
      expect(last.days).toBe(15); // 1..15 Mar inclusive
      expect(last.isFinal).toBe(true);
      // 32.8767 × 15 = 493.1505 → 493.15
      expect(last.amount.toString()).toBe('493.15');
      // Early disposal: NBV is NOT driven to salvage.
      expect(last.netBookValue.gt(new Decimal(0))).toBe(true);
    });

    it('disposal before start date yields an empty schedule', () => {
      const { rows } = buildDepreciationSchedule({
        purchaseCost: 12000,
        residualValue: 0,
        usefulLifeMonths: 12,
        startDate: new Date('2026-05-01'),
        disposalDate: new Date('2026-04-01'),
      });
      expect(rows).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('zero/negative depreciable base → empty schedule', () => {
      expect(
        buildDepreciationSchedule({
          purchaseCost: 1000,
          residualValue: 1000,
          usefulLifeMonths: 12,
          startDate: new Date('2026-01-01'),
        }).rows,
      ).toHaveLength(0);
    });

    it('usefulLifeMonths = 0 → empty schedule', () => {
      expect(
        buildDepreciationSchedule({
          purchaseCost: 1000,
          residualValue: 0,
          usefulLifeMonths: 0,
          startDate: new Date('2026-01-01'),
        }).rows,
      ).toHaveLength(0);
    });
  });

  describe('depreciationForPeriod lookup', () => {
    it('returns the row matching a period, else null', () => {
      const input = {
        purchaseCost: 30000,
        residualValue: 0,
        usefulLifeMonths: 36,
        startDate: new Date('2026-01-01'),
      };
      expect(depreciationForPeriod(input, '2026-05')?.period).toBe('2026-05');
      expect(depreciationForPeriod(input, '2025-12')).toBeNull();
      expect(depreciationForPeriod(input, '2099-01')).toBeNull();
    });
  });
});
