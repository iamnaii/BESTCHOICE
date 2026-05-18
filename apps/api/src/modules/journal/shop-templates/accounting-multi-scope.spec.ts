import { Prisma } from '@prisma/client';
import { AccountingService } from '../../accounting/accounting.service';

/**
 * P3-SP5 DEEP review C5 — multi-scope balance check unit tests.
 *
 * These tests exercise getTrialBalance + getProfitLossFromJournal to prove:
 *  - per-scope subtotals are emitted (shop + finance always present)
 *  - isAllBalanced is STRICTER than combined Dr=Cr — both halves must
 *    balance independently
 *  - companyId filter (W7 defense-in-depth) is wired through to the
 *    JournalLine.where clause when scope !== 'ALL'
 */
describe('AccountingService — multi-scope reports', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildService(opts: {
    tbRows: {
      accountCode: string;
      _sum: { debit: string; credit: string };
    }[];
    accounts?: { code: string; name?: string; normalBalance: string; type: string }[];
  }) {
    const baseAccounts: { code: string; name?: string; normalBalance: string; type: string }[] =
      opts.accounts ??
      opts.tbRows.map((r) => ({
        code: r.accountCode,
        normalBalance: 'Dr',
        type: 'สินทรัพย์',
      }));
    const accountRecords = baseAccounts.map((a) => ({
      code: a.code,
      name: a.name ?? `Name ${a.code}`,
      normalBalance: a.normalBalance,
      type: a.type,
      status: 'ใช้งาน',
    }));

    const findManyCalls: unknown[] = [];
    const groupByCalls: unknown[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma: any = {
      chartOfAccount: {
        findMany: jest.fn().mockImplementation(async (args: unknown) => {
          findManyCalls.push(args);
          return accountRecords;
        }),
      },
      journalLine: {
        groupBy: jest.fn().mockImplementation(async (args: unknown) => {
          groupByCalls.push(args);
          return opts.tbRows.map((r) => ({
            accountCode: r.accountCode,
            _sum: {
              debit: new Prisma.Decimal(r._sum.debit),
              credit: new Prisma.Decimal(r._sum.credit),
            },
          }));
        }),
      },
    };

    const resolver = {
      getShopCompanyId: jest.fn().mockResolvedValue('shop-co-id'),
      getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-id'),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new AccountingService(prisma, {} as any, resolver as any);
    return { svc, prisma, resolver, groupByCalls, findManyCalls };
  }

  describe('getTrialBalance', () => {
    it('scope=ALL — emits per-scope subtotals + isAllBalanced when both halves balance', async () => {
      const { svc } = buildService({
        tbRows: [
          // FINANCE: 1000 Dr / 1000 Cr ✓
          { accountCode: '11-1101', _sum: { debit: '1000', credit: '0' } },
          { accountCode: '21-1101', _sum: { debit: '0', credit: '1000' } },
          // SHOP: 500 Dr / 500 Cr ✓
          { accountCode: 'S11-1101', _sum: { debit: '500', credit: '0' } },
          { accountCode: 'S21-1101', _sum: { debit: '0', credit: '500' } },
        ],
      });
      const tb = await svc.getTrialBalance(undefined, 'ALL');
      expect(tb.perScope.shop.isBalanced).toBe(true);
      expect(tb.perScope.finance.isBalanced).toBe(true);
      expect(tb.isAllBalanced).toBe(true);
      expect(tb.perScope.shop.drTotal.toFixed(2)).toBe('500.00');
      expect(tb.perScope.finance.drTotal.toFixed(2)).toBe('1000.00');
    });

    it('scope=ALL — isAllBalanced=false when SHOP unbalanced even if combined Dr=Cr', async () => {
      const { svc } = buildService({
        tbRows: [
          // FINANCE unbalanced opposite of SHOP — combined Dr=Cr=1500
          { accountCode: '11-1101', _sum: { debit: '1100', credit: '0' } },
          { accountCode: '21-1101', _sum: { debit: '0', credit: '1000' } },
          { accountCode: 'S11-1101', _sum: { debit: '400', credit: '0' } },
          { accountCode: 'S21-1101', _sum: { debit: '0', credit: '500' } },
        ],
      });
      const tb = await svc.getTrialBalance(undefined, 'ALL');
      expect(tb.isBalanced).toBe(true); // combined dr=cr=1500
      expect(tb.perScope.shop.isBalanced).toBe(false);
      expect(tb.perScope.finance.isBalanced).toBe(false);
      expect(tb.isAllBalanced).toBe(false); // STRICT — both halves required
    });

    it('scope=SHOP — applies companyId filter (W7 defense-in-depth)', async () => {
      const { svc, groupByCalls, resolver } = buildService({
        tbRows: [
          { accountCode: 'S11-1101', _sum: { debit: '500', credit: '0' } },
          { accountCode: 'S21-1101', _sum: { debit: '0', credit: '500' } },
        ],
      });
      await svc.getTrialBalance(undefined, 'SHOP');
      expect(resolver.getShopCompanyId).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = groupByCalls[0] as any;
      expect(call.where.journalEntry.companyId).toBe('shop-co-id');
      expect(call.where.accountCode).toEqual({ startsWith: 'S' });
    });

    it('scope=FINANCE — applies FINANCE companyId filter', async () => {
      const { svc, groupByCalls, resolver } = buildService({
        tbRows: [
          { accountCode: '11-1101', _sum: { debit: '1000', credit: '0' } },
          { accountCode: '21-1101', _sum: { debit: '0', credit: '1000' } },
        ],
      });
      await svc.getTrialBalance(undefined, 'FINANCE');
      expect(resolver.getFinanceCompanyId).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = groupByCalls[0] as any;
      expect(call.where.journalEntry.companyId).toBe('finance-co-id');
    });

    it('scope=ALL — NO companyId filter (cross-company view)', async () => {
      const { svc, groupByCalls } = buildService({ tbRows: [] });
      await svc.getTrialBalance(undefined, 'ALL');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = groupByCalls[0] as any;
      expect(call.where.journalEntry.companyId).toBeUndefined();
    });
  });

  describe('getProfitLossFromJournal', () => {
    it('scope=ALL — per-scope netIncome split correctly', async () => {
      const { svc } = buildService({
        tbRows: [
          // FINANCE rev 1000 / exp 300 → 700
          { accountCode: '41-1101', _sum: { debit: '0', credit: '1000' } },
          { accountCode: '52-1101', _sum: { debit: '300', credit: '0' } },
          // SHOP rev 500 / exp 200 → 300
          { accountCode: 'S41-1101', _sum: { debit: '0', credit: '500' } },
          { accountCode: 'S52-1101', _sum: { debit: '200', credit: '0' } },
        ],
      });
      const pl = await svc.getProfitLossFromJournal(
        new Date('2026-01-01'),
        new Date('2026-12-31'),
        undefined,
        'ALL',
      );
      expect(pl.netIncome.toFixed(2)).toBe('1000.00');
      expect(pl.perScope.shop.netIncome.toFixed(2)).toBe('300.00');
      expect(pl.perScope.finance.netIncome.toFixed(2)).toBe('700.00');
    });

    it('scope=SHOP — passes shop companyId filter', async () => {
      const { svc, groupByCalls, resolver } = buildService({
        tbRows: [
          { accountCode: 'S41-1101', _sum: { debit: '0', credit: '500' } },
        ],
      });
      await svc.getProfitLossFromJournal(
        new Date('2026-01-01'),
        new Date('2026-12-31'),
        undefined,
        'SHOP',
      );
      expect(resolver.getShopCompanyId).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = groupByCalls[0] as any;
      expect(call.where.journalEntry.companyId).toBe('shop-co-id');
    });

    it('explicit companyId override skips resolver lookup', async () => {
      const { svc, groupByCalls, resolver } = buildService({
        tbRows: [],
      });
      await svc.getProfitLossFromJournal(
        new Date('2026-01-01'),
        new Date('2026-12-31'),
        'explicit-co-id',
        'SHOP',
      );
      expect(resolver.getShopCompanyId).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = groupByCalls[0] as any;
      expect(call.where.journalEntry.companyId).toBe('explicit-co-id');
    });
  });
});
