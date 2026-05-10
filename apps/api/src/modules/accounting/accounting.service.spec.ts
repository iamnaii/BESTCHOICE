import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AccountingService } from './accounting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';

/**
 * AccountingService — financial reporting engine for BESTCHOICE.
 *
 * Note: legacy expense CRUD coverage was removed alongside the legacy `Expense`
 * Prisma model — see modules/expense-documents/ for the new flow + dedicated tests.
 *
 * Remaining tests focus on:
 *  - getProfitLossReport: revenue aggregation, COGS via product costPrice fallback,
 *    profitMargin zero-division guard
 *  - getComparativePL: month-boundary wrapping (Jan → Dec prev year), pctChange arithmetic
 *  - getBalanceSheet: asset/liability/equity structure, derived retainedEarnings = A - L
 *  - getCashFlowStatement: operating cash flow components, sign conventions
 *  - closeAccountingPeriod / getAccountingPeriodStatus: SystemConfig upsert
 *  - getTrialBalance / getProfitLossFromJournal / getBalanceSheetFromJournal:
 *    journal-line-based reports
 *  - getBranchIdsForCompany
 */
describe('AccountingService', () => {
  let service: AccountingService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journalAutoService: any;

  // ─── Prisma mock factory ───────────────────────────────────────────────────

  const zeroAgg = (field: string) => ({ _sum: { [field]: null } });

  const makeAgg = (field: string, value: Prisma.Decimal | number | string) => ({
    _sum: { [field]: new Prisma.Decimal(value) },
  });

  beforeEach(async () => {
    prisma = {
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest
          .fn()
          .mockResolvedValue({ key: 'accounting_period_closed_until', value: '2026-03-31' }),
      },
      user: {
        findUnique: jest.fn(),
      },
      sale: {
        aggregate: jest.fn().mockResolvedValue(zeroAgg('netAmount')),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { amountPaid: null, amountDue: null, lateFee: null } }),
      },
      financeReceivable: {
        aggregate: jest.fn().mockResolvedValue(zeroAgg('receivedAmount')),
        findMany: jest.fn().mockResolvedValue([]),
      },
      badDebtProvision: {
        aggregate: jest.fn().mockResolvedValue(zeroAgg('provisionAmount')),
      },
      product: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { costPrice: null }, _count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      contract: {
        aggregate: jest.fn().mockResolvedValue(zeroAgg('creditBalance')),
      },
      purchaseOrder: {
        aggregate: jest.fn().mockResolvedValue(zeroAgg('paidAmount')),
      },
      branch: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ companyId: null }),
      },
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      chartOfAccount: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      journalLine: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => {
        if (typeof fn === 'function') {
          return fn(prisma);
        }
        return Promise.all(fn);
      }),
    };

    journalAutoService = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountingService,
        { provide: PrismaService, useValue: prisma },
        { provide: JournalAutoService, useValue: journalAutoService },
      ],
    }).compile();

    service = module.get<AccountingService>(AccountingService);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getProfitLossReport
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getProfitLossReport', () => {
    const setupZeroPL = () => {
      prisma.sale.aggregate.mockResolvedValue(zeroAgg('netAmount'));
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.financeReceivable.aggregate.mockResolvedValue(zeroAgg('receivedAmount'));
      prisma.sale.findMany.mockResolvedValue([]);
      prisma.product.findMany.mockResolvedValue([]);
    };

    it('returns zero for all line items when there are no transactions', async () => {
      setupZeroPL();
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));

      const result = await service.getProfitLossReport('2026-01-01', '2026-01-31');
      expect(result.revenue.totalRevenue).toBe(0);
      expect(result.netProfit).toBe(0);
      expect(result.summary.profitMargin).toBe(0);
    });

    it('profitMargin is 0 (not NaN) when totalRevenue is 0', async () => {
      setupZeroPL();
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));

      const result = await service.getProfitLossReport('2026-01-01', '2026-01-31');
      expect(result.summary.profitMargin).toBe(0);
      expect(Number.isNaN(result.summary.profitMargin)).toBe(false);
    });

    it('includes cash sales in totalRevenue', async () => {
      setupZeroPL();
      prisma.sale.aggregate
        .mockResolvedValueOnce(makeAgg('netAmount', 50000))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));

      const result = await service.getProfitLossReport('2026-01-01', '2026-01-31');
      expect(result.revenue.cashSales).toBeCloseTo(50000, 4);
      expect(result.revenue.totalRevenue).toBeGreaterThanOrEqual(50000);
    });

    it('records the period in the response', async () => {
      setupZeroPL();
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));

      const result = await service.getProfitLossReport('2026-03-01', '2026-03-31');
      expect(result.period.start).toBe('2026-03-01');
      expect(result.period.end).toBe('2026-03-31');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getComparativePL
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getComparativePL', () => {
    const makeEmptyPL = () => ({
      period: { start: '', end: '' },
      revenue: {
        cashSales: 0,
        installmentDownPayments: 0,
        installmentPayments: 0,
        financeDownPayments: 0,
        financeReceived: 0,
        operatingRevenue: 0,
        lateFeeIncome: 0,
        totalRevenue: 0,
      },
      paymentBreakdown: { principalIncome: 0, interestIncome: 0, commissionIncome: 0, note: '' },
      vatOutput: { accountCode: '', label: '', amount: 0, note: '' },
      costOfSales: { cogsProduct: 0, cogsRepairParts: 0, purchaseOrderCost: 0, totalCOGS: 0 },
      grossProfit: 0,
      sellingExpenses: { commission: 0, advertising: 0, transport: 0, packaging: 0, totalSelling: 0 },
      adminExpenses: {
        salary: 0,
        socialSecurity: 0,
        rent: 0,
        utilities: 0,
        officeSupplies: 0,
        depreciation: 0,
        insurance: 0,
        taxFee: 0,
        maintenance: 0,
        travel: 0,
        telephone: 0,
        totalAdmin: 0,
      },
      operatingProfit: 0,
      otherExpenses: { interest: 0, loss: 0, fine: 0, misc: 0, totalOther: 0 },
      netProfit: 0,
      summary: { totalRevenue: 0, totalExpenses: 0, netProfit: 0, profitMargin: 0 },
    });

    it('wraps to December of prior year when month=1 (January edge case)', async () => {
      const spy = jest
        .spyOn(service, 'getProfitLossReport')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValue(makeEmptyPL() as any);

      await service.getComparativePL(2026, 1);

      const calls = spy.mock.calls;
      expect(calls[0][0]).toBe('2026-01-01');
      expect(calls[1][0]).toBe('2025-12-01');
      expect(calls[1][1]).toBe('2025-12-31');
      expect(calls[2][0]).toBe('2025-01-01');

      spy.mockRestore();
    });

    it('calculates MoM change percentage correctly', async () => {
      const currentPL = {
        ...makeEmptyPL(),
        netProfit: 120,
        revenue: { ...makeEmptyPL().revenue, totalRevenue: 200 },
        grossProfit: 150,
      };
      const prevPL = {
        ...makeEmptyPL(),
        netProfit: 100,
        revenue: { ...makeEmptyPL().revenue, totalRevenue: 200 },
        grossProfit: 100,
      };
      const yoyPL = {
        ...makeEmptyPL(),
        netProfit: 80,
        revenue: { ...makeEmptyPL().revenue, totalRevenue: 180 },
        grossProfit: 80,
      };

      jest
        .spyOn(service, 'getProfitLossReport')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValueOnce(currentPL as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValueOnce(prevPL as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValueOnce(yoyPL as any);

      const result = await service.getComparativePL(2026, 3);
      expect(result.momChange.netProfit).toBeCloseTo(20, 2);
      expect(result.yoyChange.grossProfit).toBeCloseTo(87.5, 2);
    });

    it('returns 100% change when previous period is zero and current is positive', async () => {
      const currentPL = {
        ...makeEmptyPL(),
        netProfit: 50,
        revenue: { ...makeEmptyPL().revenue, totalRevenue: 50 },
        grossProfit: 50,
      };
      const zeroPL = makeEmptyPL();

      jest
        .spyOn(service, 'getProfitLossReport')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValueOnce(currentPL as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValueOnce(zeroPL as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValueOnce(zeroPL as any);

      const result = await service.getComparativePL(2026, 3);
      expect(result.momChange.netProfit).toBe(100);
    });

    it('returns 0% change when both previous and current periods are zero', async () => {
      const zeroPL = makeEmptyPL();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service, 'getProfitLossReport').mockResolvedValue(zeroPL as any);

      const result = await service.getComparativePL(2026, 3);
      expect(result.momChange.revenue).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getBalanceSheet
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getBalanceSheet', () => {
    const setupZeroBalanceSheet = () => {
      prisma.payment.aggregate
        .mockResolvedValueOnce({ _sum: { amountPaid: null } })
        .mockResolvedValueOnce({ _sum: { amountDue: null, amountPaid: null } });
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));
      prisma.financeReceivable.aggregate
        .mockResolvedValueOnce(zeroAgg('receivedAmount'))
        .mockResolvedValueOnce(zeroAgg('expectedAmount'));
      prisma.purchaseOrder.aggregate.mockResolvedValue(zeroAgg('paidAmount'));
      prisma.badDebtProvision.aggregate.mockResolvedValue(zeroAgg('provisionAmount'));
      prisma.product.aggregate.mockResolvedValue({ _sum: { costPrice: null }, _count: 0 });
      prisma.contract.aggregate.mockResolvedValue(zeroAgg('creditBalance'));
    };

    it('returns the asOfDate in the response', async () => {
      setupZeroBalanceSheet();
      const result = await service.getBalanceSheet('2026-03-31');
      expect(result.asOfDate).toBe('2026-03-31');
    });

    it('retainedEarnings = totalAssets - totalLiabilities (always balances by definition)', async () => {
      prisma.payment.aggregate
        .mockResolvedValueOnce(makeAgg('amountPaid', 100000))
        .mockResolvedValueOnce({
          _sum: { amountDue: new Prisma.Decimal(80000), amountPaid: new Prisma.Decimal(30000) },
        });
      prisma.sale.aggregate
        .mockResolvedValueOnce(makeAgg('netAmount', 50000))
        .mockResolvedValueOnce(makeAgg('downPaymentAmount', 10000));
      prisma.financeReceivable.aggregate
        .mockResolvedValueOnce(makeAgg('receivedAmount', 5000))
        .mockResolvedValueOnce(makeAgg('expectedAmount', 2000));
      prisma.purchaseOrder.aggregate.mockResolvedValue(makeAgg('paidAmount', 15000));
      prisma.badDebtProvision.aggregate.mockResolvedValue(makeAgg('provisionAmount', 4000));
      prisma.product.aggregate.mockResolvedValue({
        _sum: { costPrice: new Prisma.Decimal(25000) },
        _count: 5,
      });
      prisma.contract.aggregate.mockResolvedValue(makeAgg('creditBalance', 500));

      const result = await service.getBalanceSheet('2026-03-31');
      const { totalAssets } = result.assets;
      const { totalLiabilities } = result.liabilities;
      const { retainedEarnings } = result.equity;

      expect(retainedEarnings).toBeCloseTo(totalAssets - totalLiabilities, 4);
    });

    it('inventory count is included in the balance sheet', async () => {
      setupZeroBalanceSheet();
      prisma.product.aggregate.mockResolvedValue({
        _sum: { costPrice: new Prisma.Decimal(12000) },
        _count: 3,
      });

      const result = await service.getBalanceSheet('2026-03-31');
      expect(result.assets.currentAssets.inventory.count).toBe(3);
      expect(result.assets.currentAssets.inventory.value).toBeCloseTo(12000, 4);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getCashFlowStatement
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getCashFlowStatement', () => {
    const setupZeroCashFlow = () => {
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: null, lateFee: null } });
      prisma.financeReceivable.aggregate.mockResolvedValue(zeroAgg('receivedAmount'));
      prisma.purchaseOrder.aggregate.mockResolvedValue(zeroAgg('paidAmount'));
    };

    it('returns period start/end in the response', async () => {
      setupZeroCashFlow();
      const result = await service.getCashFlowStatement('2026-01-01', '2026-01-31');
      expect(result.period.start).toBe('2026-01-01');
      expect(result.period.end).toBe('2026-01-31');
    });

    it('netCashChange equals netOperatingCashFlow (no investing/financing tracked)', async () => {
      prisma.sale.aggregate
        .mockResolvedValueOnce(makeAgg('netAmount', 40000))
        .mockResolvedValueOnce(makeAgg('downPaymentAmount', 10000));
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountPaid: new Prisma.Decimal(15000), lateFee: null },
      });
      prisma.financeReceivable.aggregate.mockResolvedValue(makeAgg('receivedAmount', 5000));
      prisma.purchaseOrder.aggregate.mockResolvedValue(makeAgg('paidAmount', 8000));

      const result = await service.getCashFlowStatement('2026-01-01', '2026-01-31');
      expect(result.netCashChange).toBeCloseTo(
        result.operatingActivities.netOperatingCashFlow,
        4,
      );
    });

    it('cashFromCustomers = sum of all four inflow sources', async () => {
      prisma.sale.aggregate
        .mockResolvedValueOnce(makeAgg('netAmount', 10000))
        .mockResolvedValueOnce(makeAgg('downPaymentAmount', 5000));
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountPaid: new Prisma.Decimal(8000), lateFee: null },
      });
      prisma.financeReceivable.aggregate.mockResolvedValue(makeAgg('receivedAmount', 3000));
      prisma.purchaseOrder.aggregate.mockResolvedValue(zeroAgg('paidAmount'));

      const result = await service.getCashFlowStatement('2026-01-01', '2026-01-31');
      expect(result.operatingActivities.cashFromCustomers).toBeCloseTo(26000, 4);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // closeAccountingPeriod & getAccountingPeriodStatus
  // ═══════════════════════════════════════════════════════════════════════════

  describe('closeAccountingPeriod', () => {
    it('upserts the accounting_period_closed_until config key', async () => {
      await service.closeAccountingPeriod('2026-03-31');
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'accounting_period_closed_until' },
          update: { value: '2026-03-31' },
          create: { key: 'accounting_period_closed_until', value: '2026-03-31' },
        }),
      );
    });

    it('returns the closedUntil value in the response', async () => {
      const result = await service.closeAccountingPeriod('2026-03-31');
      expect(result.closedUntil).toBe('2026-03-31');
    });
  });

  describe('getAccountingPeriodStatus', () => {
    it('returns null closedUntil when no period lock is set', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      const result = await service.getAccountingPeriodStatus();
      expect(result.closedUntil).toBeNull();
    });

    it('returns the current closedUntil value when set', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({
        key: 'accounting_period_closed_until',
        value: '2026-03-31',
      });
      const result = await service.getAccountingPeriodStatus();
      expect(result.closedUntil).toBe('2026-03-31');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T17: getTrialBalance / getProfitLossFromJournal / getBalanceSheetFromJournal
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getTrialBalance (T17)', () => {
    const makeCoaRecord = (
      code: string,
      name: string,
      type: string,
      normalBalance: string,
    ) => ({
      id: code,
      code,
      name,
      type,
      normalBalance,
      category: null,
      vatApplicable: false,
      notes: null,
      status: 'ใช้งาน',
      deletedAt: null,
    });

    const makeLineSumRow = (accountCode: string, debit: number, credit: number) => ({
      accountCode,
      _sum: { debit: new Prisma.Decimal(debit), credit: new Prisma.Decimal(credit) },
    });

    beforeEach(() => {
      prisma.chartOfAccount = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.journalLine = { groupBy: jest.fn().mockResolvedValue([]) };
    });

    it('returns isBalanced=true and zero totals when there are no journal lines', async () => {
      const result = await service.getTrialBalance();
      expect(result.isBalanced).toBe(true);
      expect(result.grandDrTotal.toNumber()).toBe(0);
      expect(result.grandCrTotal.toNumber()).toBe(0);
      expect(result.sections).toHaveLength(0);
    });

    it('returns isBalanced=true when Dr total equals Cr total', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        makeCoaRecord('11-1101', 'เงินสด FINANCE', 'สินทรัพย์', 'Dr'),
        makeCoaRecord('21-2101', 'ภาษีขาย ภ.พ.30', 'หนี้สิน', 'Cr'),
      ]);
      prisma.journalLine.groupBy.mockResolvedValue([
        makeLineSumRow('11-1101', 1000, 0),
        makeLineSumRow('21-2101', 0, 1000),
      ]);

      const result = await service.getTrialBalance();
      expect(result.isBalanced).toBe(true);
      expect(result.grandDrTotal.toNumber()).toBe(1000);
      expect(result.grandCrTotal.toNumber()).toBe(1000);
    });

    it('returns isBalanced=false when journal is unbalanced', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        makeCoaRecord('11-1101', 'เงินสด', 'สินทรัพย์', 'Dr'),
      ]);
      prisma.journalLine.groupBy.mockResolvedValue([makeLineSumRow('11-1101', 1000, 500)]);

      const result = await service.getTrialBalance();
      expect(result.isBalanced).toBe(false);
      expect(result.grandDrTotal.toNumber()).toBe(1000);
      expect(result.grandCrTotal.toNumber()).toBe(500);
    });

    it('groups accounts into correct sections by 2-digit code prefix', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        makeCoaRecord('11-1101', 'เงินสด', 'สินทรัพย์', 'Dr'),
        makeCoaRecord('21-2101', 'VAT Output', 'หนี้สิน', 'Cr'),
        makeCoaRecord('41-2101', 'รายได้เช่าซื้อ', 'รายได้', 'Cr'),
      ]);
      prisma.journalLine.groupBy.mockResolvedValue([
        makeLineSumRow('11-1101', 500, 0),
        makeLineSumRow('21-2101', 0, 300),
        makeLineSumRow('41-2101', 0, 200),
      ]);

      const result = await service.getTrialBalance();
      const prefixes = result.sections.map((s) => s.codePrefix);
      expect(prefixes).toContain('11');
      expect(prefixes).toContain('21');
      expect(prefixes).toContain('41');
    });
  });

  describe('getProfitLossFromJournal (T17)', () => {
    beforeEach(() => {
      prisma.chartOfAccount = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.journalLine = { groupBy: jest.fn().mockResolvedValue([]) };
    });

    it('returns zero revenue, expenses, and netIncome when no journal lines exist', async () => {
      const result = await service.getProfitLossFromJournal(
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );
      expect(result.revenue.total.toNumber()).toBe(0);
      expect(result.expenses.total.toNumber()).toBe(0);
      expect(result.netIncome.toNumber()).toBe(0);
    });

    it('computes revenue from 41 and 42 accounts as Cr - Dr', async () => {
      prisma.journalLine.groupBy.mockResolvedValue([
        {
          accountCode: '41-2101',
          _sum: { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(10000) },
        },
        {
          accountCode: '42-2102',
          _sum: { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(500) },
        },
      ]);
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { code: '41-2101', name: 'รายได้ขายเช่าซื้อ' },
        { code: '42-2102', name: 'ค่างวดเบี้ยปรับล่าช้า' },
      ]);

      const result = await service.getProfitLossFromJournal(
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );
      expect(result.revenue.total.toNumber()).toBe(10500);
      expect(result.expenses.total.toNumber()).toBe(0);
      expect(result.netIncome.toNumber()).toBe(10500);
    });

    it('returns periodStart and periodEnd in the result', async () => {
      const start = new Date('2026-03-01');
      const end = new Date('2026-03-31');
      const result = await service.getProfitLossFromJournal(start, end);
      expect(result.periodStart).toEqual(start);
      expect(result.periodEnd).toEqual(end);
    });
  });

  describe('getBalanceSheetFromJournal (T17)', () => {
    beforeEach(() => {
      prisma.chartOfAccount = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.journalLine = { groupBy: jest.fn().mockResolvedValue([]) };
    });

    it('returns zero totals and isBalanced=true with empty ledger', async () => {
      const result = await service.getBalanceSheetFromJournal();
      expect(result.assets.total.toNumber()).toBe(0);
      expect(result.liabilities.total.toNumber()).toBe(0);
      expect(result.equity.total.toNumber()).toBe(0);
      expect(result.isBalanced).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getBranchIdsForCompany
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getBranchIdsForCompany', () => {
    it('returns empty array when company has no branches', async () => {
      prisma.branch.findMany.mockResolvedValue([]);
      const result = await service.getBranchIdsForCompany('company-1');
      expect(result).toEqual([]);
    });

    it('returns array of branch IDs for the given company', async () => {
      prisma.branch.findMany.mockResolvedValue([
        { id: 'branch-1' },
        { id: 'branch-2' },
        { id: 'branch-3' },
      ]);
      const result = await service.getBranchIdsForCompany('company-1');
      expect(result).toEqual(['branch-1', 'branch-2', 'branch-3']);
    });

    it('queries branches with deletedAt: null', async () => {
      prisma.branch.findMany.mockResolvedValue([]);
      await service.getBranchIdsForCompany('company-1');
      const where = prisma.branch.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.companyId).toBe('company-1');
    });
  });
});
