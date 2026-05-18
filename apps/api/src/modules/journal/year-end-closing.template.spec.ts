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

    it('preserves negative balance for revenue with net DEBIT position', async () => {
      // Revenue Cr-normal but ended year with Dr > Cr (refunds > sales)
      const t = buildTemplate([
        { accountCode: '41-1101', _sum: { debit: '5000', credit: '1000' } },
      ]);
      const out = await t.getYearAccountActivity(2026);
      expect(out.revenues).toHaveLength(1);
      // cr - dr = 1000 - 5000 = -4000 (kept negative; execute() flips side)
      expect(out.revenues[0].balance.toFixed(2)).toBe('-4000.00');
    });

    it('preserves negative balance for expense with net CREDIT position', async () => {
      // Expense Dr-normal but ended year with Cr > Dr (refunds/recoveries)
      const t = buildTemplate([
        { accountCode: '51-1101', _sum: { debit: '500', credit: '2000' } },
      ]);
      const out = await t.getYearAccountActivity(2026);
      expect(out.expenses).toHaveLength(1);
      // dr - cr = 500 - 2000 = -1500
      expect(out.expenses[0].balance.toFixed(2)).toBe('-1500.00');
    });
  });

  describe('execute (negative-balance JE flip)', () => {
    function buildTemplateWithJournal(
      rows: Array<{ accountCode: string; _sum: { debit: string; credit: string } }>,
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const journalCalls: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const journal: any = {
        createAndPost: jest.fn().mockImplementation((dto: any) => {
          journalCalls.push(dto);
          return Promise.resolve({
            id: `je-${journalCalls.length}`,
            entryNumber: `JE-${journalCalls.length}`,
          });
        }),
      };
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
        // Pass through $transaction so execute() can run without a real DB
        $transaction: jest.fn().mockImplementation(async (fn: any) => fn(prisma)),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = new YearEndClosingTemplate(journal as any, prisma as any);
      return { template, journal, journalCalls };
    }

    it('flips revenue Dr/Cr when balance is negative (refunds > sales)', async () => {
      // 41-1101 has Dr 5000 + Cr 1000 → net -4000 (abnormal Dr position)
      // 51-1101 normal Dr 1000 → expense 1000
      // Net income = -4000 - 1000 = -5000 (loss)
      const { template, journalCalls } = buildTemplateWithJournal([
        { accountCode: '41-1101', _sum: { debit: '5000', credit: '1000' } },
        { accountCode: '51-1101', _sum: { debit: '1000', credit: '0' } },
      ]);

      await template.execute(2026);

      // Step 1 = close revenue. Find the 41-1101 line in step 1.
      const step1 = journalCalls[0];
      const revenueLine = step1.lines.find(
        (l: { accountCode: string }) => l.accountCode === '41-1101',
      );
      // Abnormal negative balance must post as Cr (not negative Dr)
      expect(revenueLine.dr.toString()).toBe('0');
      expect(revenueLine.cr.toString()).toBe('4000');

      // Income Summary side must mirror to keep entry balanced
      const iscLine = step1.lines.find(
        (l: { accountCode: string }) => l.accountCode === '39-9999',
      );
      // Net revenue total is -4000 (abnormal). Cr revenue 4000 + Dr ISC 4000.
      expect(iscLine.dr.toString()).toBe('4000');
      expect(iscLine.cr.toString()).toBe('0');

      // Verify the entry is still balanced (Dr total = Cr total)
      const drTotal = step1.lines.reduce(
        (acc: Prisma.Decimal, l: { dr: Prisma.Decimal }) => acc.add(l.dr),
        new Prisma.Decimal(0),
      );
      const crTotal = step1.lines.reduce(
        (acc: Prisma.Decimal, l: { cr: Prisma.Decimal }) => acc.add(l.cr),
        new Prisma.Decimal(0),
      );
      expect(drTotal.toString()).toBe(crTotal.toString());
    });

    it('flips expense Dr/Cr when balance is negative (recoveries > expense)', async () => {
      const { template, journalCalls } = buildTemplateWithJournal([
        { accountCode: '41-1101', _sum: { debit: '0', credit: '10000' } },
        // 51-1101 abnormal Cr position: Dr 200 + Cr 800 → net -600
        { accountCode: '51-1101', _sum: { debit: '200', credit: '800' } },
      ]);

      await template.execute(2026);

      // Step 2 = close expenses
      const step2 = journalCalls[1];
      const expenseLine = step2.lines.find(
        (l: { accountCode: string }) => l.accountCode === '51-1101',
      );
      // Abnormal negative balance must post as Dr (not negative Cr)
      expect(expenseLine.dr.toString()).toBe('600');
      expect(expenseLine.cr.toString()).toBe('0');

      const iscLine = step2.lines.find(
        (l: { accountCode: string }) => l.accountCode === '39-9999',
      );
      // Net expense total is -600 (abnormal). Dr expense 600 + Cr ISC 600.
      expect(iscLine.dr.toString()).toBe('0');
      expect(iscLine.cr.toString()).toBe('600');

      // Balance check
      const drTotal = step2.lines.reduce(
        (acc: Prisma.Decimal, l: { dr: Prisma.Decimal }) => acc.add(l.dr),
        new Prisma.Decimal(0),
      );
      const crTotal = step2.lines.reduce(
        (acc: Prisma.Decimal, l: { cr: Prisma.Decimal }) => acc.add(l.cr),
        new Prisma.Decimal(0),
      );
      expect(drTotal.toString()).toBe(crTotal.toString());
    });

    it('normal-side path unchanged for positive balances (no regression)', async () => {
      const { template, journalCalls } = buildTemplateWithJournal([
        { accountCode: '41-1101', _sum: { debit: '0', credit: '10000' } },
        { accountCode: '51-1101', _sum: { debit: '3000', credit: '0' } },
      ]);

      await template.execute(2026);

      const step1 = journalCalls[0];
      const revenueLine = step1.lines.find(
        (l: { accountCode: string }) => l.accountCode === '41-1101',
      );
      // Normal Cr-normal revenue → close with Dr <balance>
      expect(revenueLine.dr.toString()).toBe('10000');
      expect(revenueLine.cr.toString()).toBe('0');
    });
  });
});
