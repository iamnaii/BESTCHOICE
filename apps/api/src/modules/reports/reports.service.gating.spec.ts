import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ReportsService } from './reports.service';

// Locks the company/branch gate that decides whether a /reports P&L includes the
// central FINANCE 51-54 expenses. A wrong gate is what leaked company expenses onto
// a single branch / SHOP view in the first cut (PR review blockers).
describe('ReportsService.shouldIncludeFinanceExpenses', () => {
  function make(companyCode?: 'SHOP' | 'FINANCE') {
    const findUnique = jest.fn().mockResolvedValue(companyCode ? { companyCode } : null);
    const prisma = { companyInfo: { findUnique } } as unknown as PrismaService;
    const svc = new ReportsService(prisma, {} as AccountingService);
    return { svc, findUnique };
  }

  it('BRANCH_MANAGER is always excluded (restricted to one branch)', async () => {
    const { svc, findUnique } = make('FINANCE');
    expect(await svc.shouldIncludeFinanceExpenses('BRANCH_MANAGER', undefined, 'co-finance')).toBe(false);
    expect(findUnique).not.toHaveBeenCalled(); // short-circuits before the company lookup
  });

  it('a specific branchId is isolated → excluded (per-branch expenses await SHOP accounting)', async () => {
    const { svc } = make('FINANCE');
    expect(await svc.shouldIncludeFinanceExpenses('OWNER', 'branch-1', undefined)).toBe(false);
  });

  it('companyId = SHOP → excluded (FINANCE central expenses do not belong on the SHOP view)', async () => {
    const { svc, findUnique } = make('SHOP');
    expect(await svc.shouldIncludeFinanceExpenses('OWNER', undefined, 'co-shop')).toBe(false);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'co-shop' }, select: { companyCode: true } });
  });

  it('companyId = FINANCE → included', async () => {
    const { svc } = make('FINANCE');
    expect(await svc.shouldIncludeFinanceExpenses('OWNER', undefined, 'co-finance')).toBe(true);
  });

  it('no branch + no company (whole-business view) → included', async () => {
    const { svc } = make();
    expect(await svc.shouldIncludeFinanceExpenses('OWNER', undefined, undefined)).toBe(true);
  });

  it('FINANCE_MANAGER + SHOP filter → excluded (role does not override company)', async () => {
    const { svc } = make('SHOP');
    expect(await svc.shouldIncludeFinanceExpenses('FINANCE_MANAGER', undefined, 'co-shop')).toBe(false);
  });
});
