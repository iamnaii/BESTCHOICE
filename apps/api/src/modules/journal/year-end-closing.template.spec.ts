import { Prisma } from '@prisma/client';
import { YearEndClosingTemplate } from './cpa-templates/year-end-closing.template';

/**
 * Unit tests for the YearEndClosingTemplate helpers (jest — placed outside the
 * cpa-templates/ directory because jest's `testPathIgnorePatterns` excludes
 * that path; cpa-templates specs are vitest-integration tests run separately).
 *
 * Avoids real DB — exercises:
 *  - bkkYearBounds: correct UTC instants for Asia/Bangkok year window
 *  - getYearAccountActivity: revenue/expense classification + zero-skip
 *  - prefix filter: 55-XXXX and other prefixes ignored
 *  - netIncome sign for profit vs loss
 */
describe('YearEndClosingTemplate (unit)', () => {
  describe('bkkYearBounds', () => {
    it('returns Jan 1 00:00 BKK as start for the year', () => {
      const { start } = YearEndClosingTemplate.bkkYearBounds(2026);
      // 00:00 BKK = 17:00 prev day UTC (BKK = UTC+7, no DST)
      expect(start.toISOString()).toBe('2025-12-31T17:00:00.000Z');
    });

    it('returns Dec 31 23:59:59.999 BKK as end for the year', () => {
      const { end } = YearEndClosingTemplate.bkkYearBounds(2026);
      expect(end.toISOString()).toBe('2026-12-31T16:59:59.999Z');
    });

    it('window covers exactly one calendar year (~365 days)', () => {
      const { start, end } = YearEndClosingTemplate.bkkYearBounds(2027);
      const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      expect(days).toBeGreaterThan(364.999);
      expect(days).toBeLessThan(365.001);
    });
  });

  describe('getYearAccountActivity', () => {
    function buildTemplate(
      rows: Array<{ accountCode: string; _sum: { debit: string; credit: string } }>,
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prisma: any = {
        journalLine: {
          groupBy: jest.fn().mockResolvedValue(
            rows.map((r) => ({
              accountCode: r.accountCode,
              _sum: {
                debit: new Prisma.Decimal(r._sum.debit),
                credit: new Prisma.Decimal(r._sum.credit),
              },
            })),
          ),
        },
        chartOfAccount: {
          findMany: jest.fn().mockResolvedValue(
            rows.map((r) => ({ code: r.accountCode, name: `Name ${r.accountCode}` })),
          ),
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new YearEndClosingTemplate({} as any, prisma);
    }

    it('classifies 41-XXXX / 42-XXXX as revenue (Cr-normal)', async () => {
      const t = buildTemplate([
        { accountCode: '41-1101', _sum: { debit: '0', credit: '100000' } },
        { accountCode: '42-1102', _sum: { debit: '0', credit: '5000' } },
      ]);
      const out = await t.getYearAccountActivity(2026);
      expect(out.revenues).toHaveLength(2);
      expect(out.revenueTotal.toFixed(2)).toBe('105000.00');
      expect(out.expenses).toHaveLength(0);
    });

    it('classifies 51/52/53/54-XXXX as expense (Dr-normal)', async () => {
      const t = buildTemplate([
        { accountCode: '51-1101', _sum: { debit: '10000', credit: '0' } },
        { accountCode: '52-1104', _sum: { debit: '500', credit: '0' } },
        { accountCode: '53-1503', _sum: { debit: '200', credit: '0' } },
        { accountCode: '54-1101', _sum: { debit: '300', credit: '0' } },
      ]);
      const out = await t.getYearAccountActivity(2026);
      expect(out.expenses).toHaveLength(4);
      expect(out.expenseTotal.toFixed(2)).toBe('11000.00');
    });

    it('skips accounts with zero net balance', async () => {
      const t = buildTemplate([
        { accountCode: '41-1101', _sum: { debit: '100', credit: '100' } }, // net 0 — skip
        { accountCode: '41-1102', _sum: { debit: '0', credit: '500' } }, // keep
      ]);
      const out = await t.getYearAccountActivity(2026);
      expect(out.revenues).toHaveLength(1);
      expect(out.revenues[0].code).toBe('41-1102');
    });

    it('IGNORES non-rev/non-exp prefixes (11-XXXX assets, 55-XXXX, 21-XXXX liab)', async () => {
      const t = buildTemplate([
        { accountCode: '11-2101', _sum: { debit: '999999', credit: '0' } },
        { accountCode: '55-1101', _sum: { debit: '12345', credit: '0' } },
        { accountCode: '21-2101', _sum: { debit: '0', credit: '500' } },
        { accountCode: '41-1101', _sum: { debit: '0', credit: '100' } },
      ]);
      const out = await t.getYearAccountActivity(2026);
      expect(out.revenues).toHaveLength(1);
      expect(out.expenses).toHaveLength(0);
      expect(out.revenueTotal.toFixed(2)).toBe('100.00');
    });

    it('netIncome = revenue - expense (profit case)', async () => {
      const t = buildTemplate([
        { accountCode: '41-1101', _sum: { debit: '0', credit: '100000' } },
        { accountCode: '51-1101', _sum: { debit: '30000', credit: '0' } },
      ]);
      const out = await t.getYearAccountActivity(2026);
      expect(out.netIncome.toFixed(2)).toBe('70000.00');
    });

    it('netIncome < 0 for loss case', async () => {
      const t = buildTemplate([
        { accountCode: '41-1101', _sum: { debit: '0', credit: '10000' } },
        { accountCode: '51-1101', _sum: { debit: '50000', credit: '0' } },
      ]);
      const out = await t.getYearAccountActivity(2026);
      expect(out.netIncome.toFixed(2)).toBe('-40000.00');
    });
  });
});
