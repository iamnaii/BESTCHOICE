import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { AccountingService } from './accounting.service';

type GroupRow = { accountCode: string; _sum: { debit: Prisma.Decimal | null; credit: Prisma.Decimal | null } };

const d = (n: string | number) => new Prisma.Decimal(n);

function makeService(groupRows: GroupRow[]) {
  const journalLineGroupBy = jest.fn().mockResolvedValue(groupRows);
  const prisma = {
    journalLine: { groupBy: journalLineGroupBy },
  } as unknown as PrismaService;
  const companyResolver = {
    getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1'),
  } as unknown as CompanyResolverService;
  const svc = new AccountingService(prisma, {} as JournalAutoService, companyResolver);
  return { svc, journalLineGroupBy };
}

const aggregate = (svc: AccountingService, companyWide: boolean) =>
  (svc as unknown as {
    aggregateFinanceExpenses: (
      s: Date,
      e: Date,
      cw: boolean,
    ) => Promise<{
      byCategory: { category: string; totalAmount: Prisma.Decimal }[];
      sectionTotals: { selling: Prisma.Decimal; admin: Prisma.Decimal; other: Prisma.Decimal };
    }>;
  }).aggregateFinanceExpenses(new Date('2026-01-01'), new Date('2026-01-31'), companyWide);

describe('AccountingService.aggregateFinanceExpenses', () => {
  it('company-wide: section totals + curated category rollups, net = debit - credit', async () => {
    const { svc } = makeService([
      { accountCode: '52-1101', _sum: { debit: d('1000'), credit: d('0') } }, // SELL_COMMISSION
      { accountCode: '53-1101', _sum: { debit: d('30000'), credit: d('0') } }, // ADMIN_SALARY
      { accountCode: '53-1102', _sum: { debit: d('1500'), credit: d('0') } }, // ADMIN_SOCIAL_SECURITY
      { accountCode: '53-1601', _sum: { debit: d('2000'), credit: d('500') } }, // ADMIN_DEPRECIATION net 1500
      { accountCode: '51-1102', _sum: { debit: d('800'), credit: d('0') } }, // OTHER_LOSS
      { accountCode: '53-9999', _sum: { debit: d('700'), credit: d('0') } }, // unmapped → admin section only
    ]);

    const r = await aggregate(svc, true);

    expect(r.sectionTotals.selling.toFixed(2)).toBe('1000.00'); // Σ52
    expect(r.sectionTotals.admin.toFixed(2)).toBe('33700.00'); // 30000+1500+1500+700
    expect(r.sectionTotals.other.toFixed(2)).toBe('800.00'); // Σ51

    const byCat = Object.fromEntries(r.byCategory.map((c) => [c.category, c.totalAmount.toFixed(2)]));
    expect(byCat['SELL_COMMISSION']).toBe('1000.00');
    expect(byCat['ADMIN_SALARY']).toBe('30000.00');
    expect(byCat['ADMIN_SOCIAL_SECURITY']).toBe('1500.00');
    expect(byCat['ADMIN_DEPRECIATION']).toBe('1500.00'); // 2000 - 500
    expect(byCat['OTHER_LOSS']).toBe('800.00');
    expect(byCat['53-9999']).toBeUndefined(); // unmapped: no category line
  });

  it('per-branch (not company-wide): returns zeros and does NOT query the journal', async () => {
    const { svc, journalLineGroupBy } = makeService([
      { accountCode: '53-1101', _sum: { debit: d('30000'), credit: d('0') } },
    ]);

    const r = await aggregate(svc, false);

    expect(journalLineGroupBy).not.toHaveBeenCalled();
    expect(r.byCategory).toEqual([]);
    expect(r.sectionTotals.selling.toFixed(2)).toBe('0.00');
    expect(r.sectionTotals.admin.toFixed(2)).toBe('0.00');
    expect(r.sectionTotals.other.toFixed(2)).toBe('0.00');
  });
});

function makeFullService(groupRows: GroupRow[]) {
  const agg0 = { _sum: {} as Record<string, Prisma.Decimal | null> };
  const prisma = {
    sale: { aggregate: jest.fn().mockResolvedValue(agg0), findMany: jest.fn().mockResolvedValue([]) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    financeReceivable: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    journalLine: { groupBy: jest.fn().mockResolvedValue(groupRows) },
  } as unknown as PrismaService;
  const companyResolver = {
    getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1'),
  } as unknown as CompanyResolverService;
  return new AccountingService(prisma, {} as JournalAutoService, companyResolver);
}

describe('AccountingService.getProfitLossReport (expense wiring)', () => {
  it('company-wide: section sums drive totals; granular lines populated; basis flagged', async () => {
    const svc = makeFullService([
      { accountCode: '53-1101', _sum: { debit: d('30000'), credit: d('0') } },
      { accountCode: '52-1101', _sum: { debit: d('1000'), credit: d('0') } },
      { accountCode: '53-9999', _sum: { debit: d('700'), credit: d('0') } }, // unmapped, admin section
    ]);
    const r = await svc.getProfitLossReport('2026-01-01', '2026-01-31');

    expect(r.adminExpenses.totalAdmin).toBe(30700); // Σ53 (incl. unmapped) — from section sum
    expect(r.adminExpenses.salary).toBe(30000); // granular line
    expect(r.sellingExpenses.totalSelling).toBe(1000);
    expect(r.summary.totalExpenses).toBe(31700); // COGS 0 + 1000 + 30700 + 0
    expect((r as unknown as { expenseBasis: string }).expenseBasis).toBe('accrual-journal');
  });

  it('per-branch: expenses stay zero, journal not queried', async () => {
    const svc = makeFullService([{ accountCode: '53-1101', _sum: { debit: d('30000'), credit: d('0') } }]);
    const r = await svc.getProfitLossReport('2026-01-01', '2026-01-31', 'branch-1');

    expect(r.adminExpenses.totalAdmin).toBe(0);
    expect(r.summary.totalExpenses).toBe(0);
  });

  it('company-wide via branchIds list (OWNER / all-branches path): expenses added', async () => {
    const svc = makeFullService([{ accountCode: '53-1101', _sum: { debit: d('30000'), credit: d('0') } }]);
    const r = await svc.getProfitLossReport('2026-01-01', '2026-01-31', undefined, ['b1', 'b2']);
    expect(r.adminExpenses.totalAdmin).toBe(30000); // branchIds list = company-wide, not a single-branch isolate
  });
});

describe('AccountingService.getMonthlyPLSummary (expense wiring)', () => {
  function makeMonthlyService(lines: { entryDate: Date; debit: Prisma.Decimal; credit: Prisma.Decimal }[]) {
    const prisma = {
      sale: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      financeReceivable: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: {
        findMany: jest.fn().mockResolvedValue(
          lines.map((l) => ({ debit: l.debit, credit: l.credit, journalEntry: { entryDate: l.entryDate } })),
        ),
      },
    } as unknown as PrismaService;
    const companyResolver = {
      getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1'),
    } as unknown as CompanyResolverService;
    return new AccountingService(prisma, {} as JournalAutoService, companyResolver);
  }

  it('company-wide: per-month FINANCE expenses subtracted from revenue', async () => {
    const svc = makeMonthlyService([
      { entryDate: new Date('2026-02-10'), debit: d('5000'), credit: d('0') }, // Feb
      { entryDate: new Date('2026-02-20'), debit: d('1000'), credit: d('200') }, // Feb net 800
    ]);
    const r = await svc.getMonthlyPLSummary(2026);
    const feb = r.months.find((m) => m.month === 2)!;
    expect(feb.expenses).toBe(5800); // 5000 + 800
    expect(feb.netProfit).toBe(-5800); // revenue 0
    const jan = r.months.find((m) => m.month === 1)!;
    expect(jan.expenses).toBe(0);
  });

  it('per-branch: expenses zero, journal not queried', async () => {
    const svc = makeMonthlyService([{ entryDate: new Date('2026-02-10'), debit: d('5000'), credit: d('0') }]);
    const r = await svc.getMonthlyPLSummary(2026, 'branch-1');
    expect(r.months.every((m) => m.expenses === 0)).toBe(true);
  });
});
