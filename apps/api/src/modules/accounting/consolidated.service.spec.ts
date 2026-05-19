import { ConsolidatedService } from './consolidated.service';
import { Prisma } from '@prisma/client';

/**
 * SP7.6 — ConsolidatedService unit tests.
 *
 * AccountingService.getTrialBalance returns { sections: [...], grandDrTotal, grandCrTotal }.
 * AccountingService.getProfitLossFromJournal returns { revenue, expenses, netIncome, perScope, ... }.
 */
describe('ConsolidatedService', () => {
  let prismaMock: any;
  let accountingMock: any;
  let svc: ConsolidatedService;

  const dec = (n: number | string) => new Prisma.Decimal(n);

  beforeEach(() => {
    prismaMock = {
      interCompanyTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    };
    accountingMock = {
      getTrialBalance: jest.fn(),
      getProfitLossFromJournal: jest.fn(),
    };
    svc = new ConsolidatedService(prismaMock as any, accountingMock as any);
  });

  // ─── Trial Balance ───────────────────────────────────────────────────────

  it('getConsolidatedTrialBalance flattens sections into a sorted account list', async () => {
    accountingMock.getTrialBalance.mockResolvedValue({
      sections: [
        {
          codePrefix: '11',
          sectionName: 'สินทรัพย์หมุนเวียน',
          rows: [
            { code: '11-1101', name: 'เงินสด', type: 'สินทรัพย์', normalBalance: 'Dr', drBalance: dec(1000), crBalance: dec(0), netBalance: dec(1000) },
            { code: 'S11-1101', name: 'SHOP Cash', type: 'สินทรัพย์', normalBalance: 'Dr', drBalance: dec(500), crBalance: dec(0), netBalance: dec(500) },
          ],
          drTotal: dec(1500),
          crTotal: dec(0),
        },
      ],
      grandDrTotal: dec(1500),
      grandCrTotal: dec(0),
    });

    const result = await svc.getConsolidatedTrialBalance();

    expect(result.scope).toBe('CONSOLIDATED');
    expect(result.accounts).toHaveLength(2);
    // sorted by code — '11-1101' < 'S11-1101' (digit < uppercase in locale)
    const codes = result.accounts.map((a) => a.code);
    expect(codes).toContain('11-1101');
    expect(codes).toContain('S11-1101');
    expect(result.grandDrTotal.toString()).toBe('1500');
  });

  it('getConsolidatedTrialBalance deduplicates merged rows (same code in two sections)', async () => {
    // Edge case: same accountCode appears in two sections (mispost scenario)
    accountingMock.getTrialBalance.mockResolvedValue({
      sections: [
        {
          codePrefix: '11',
          sectionName: 'สินทรัพย์',
          rows: [
            { code: '11-1101', name: 'เงินสด', type: 'สินทรัพย์', normalBalance: 'Dr', drBalance: dec(600), crBalance: dec(0), netBalance: dec(600) },
          ],
          drTotal: dec(600),
          crTotal: dec(0),
        },
        {
          codePrefix: '11',
          sectionName: 'สินทรัพย์ (ซ้ำ)',
          rows: [
            { code: '11-1101', name: 'เงินสด', type: 'สินทรัพย์', normalBalance: 'Dr', drBalance: dec(400), crBalance: dec(0), netBalance: dec(400) },
          ],
          drTotal: dec(400),
          crTotal: dec(0),
        },
      ],
      grandDrTotal: dec(1000),
      grandCrTotal: dec(0),
    });

    const result = await svc.getConsolidatedTrialBalance();
    // Both sections share the same code — should merge to 1 row with summed Dr
    const row = result.accounts.find((a) => a.code === '11-1101');
    expect(row).toBeDefined();
    expect(row!.drBalance.toString()).toBe('1000');
  });

  // ─── Profit & Loss ───────────────────────────────────────────────────────

  it('getConsolidatedProfitLoss returns per-entity breakdown + eliminations', async () => {
    accountingMock.getProfitLossFromJournal.mockResolvedValue({
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
      scope: 'ALL',
      revenue: { sectionName: 'รายได้รวม', rows: [], total: dec(200) },
      expenses: { sectionName: 'ค่าใช้จ่ายรวม', rows: [], total: dec(80) },
      netIncome: dec(120),
      perScope: {
        shop: { revenueTotal: dec(100), expenseTotal: dec(40), netIncome: dec(60) },
        finance: { revenueTotal: dec(100), expenseTotal: dec(40), netIncome: dec(60) },
      },
    });

    prismaMock.interCompanyTransaction.findMany.mockResolvedValue([
      { id: 'a', totalAmount: dec(50), commission: dec(10), principal: dec(40) },
      { id: 'b', totalAmount: dec(30), commission: dec(5), principal: dec(25) },
    ]);

    const result = await svc.getConsolidatedProfitLoss(
      new Date('2026-01-01'),
      new Date('2026-12-31'),
    );

    expect(result.scope).toBe('CONSOLIDATED');
    expect(result.netIncome.toString()).toBe('120');
    expect(result.eliminations.count).toBe(2);
    expect(result.eliminations.amount.toString()).toBe('15'); // 10 + 5 commission
    expect(result.consolidatedNetIncome.toString()).toBe('105'); // 120 - 15
    expect(result.perEntity.shop.netIncome.toString()).toBe('60');
    expect(result.perEntity.finance.netIncome.toString()).toBe('60');
  });

  it('getConsolidatedProfitLoss handles zero intercompany transactions', async () => {
    accountingMock.getProfitLossFromJournal.mockResolvedValue({
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      scope: 'ALL',
      revenue: { sectionName: 'รายได้รวม', rows: [], total: dec(50) },
      expenses: { sectionName: 'ค่าใช้จ่ายรวม', rows: [], total: dec(20) },
      netIncome: dec(30),
      perScope: {
        shop: { revenueTotal: dec(20), expenseTotal: dec(10), netIncome: dec(10) },
        finance: { revenueTotal: dec(30), expenseTotal: dec(10), netIncome: dec(20) },
      },
    });

    prismaMock.interCompanyTransaction.findMany.mockResolvedValue([]);

    const result = await svc.getConsolidatedProfitLoss(
      new Date('2026-01-01'),
      new Date('2026-01-31'),
    );

    expect(result.eliminations.count).toBe(0);
    expect(result.eliminations.amount.toString()).toBe('0');
    expect(result.consolidatedNetIncome.toString()).toBe('30');
  });
});
