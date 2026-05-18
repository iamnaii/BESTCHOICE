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
        findFirst: jest.fn().mockResolvedValue(null),
      },
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalLine: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      fixedAsset: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { purchaseCost: null } }),
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

  // ═══════════════════════════════════════════════════════════════════════════
  // SP2: getCashFlowFromJournal (Indirect Method)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getCashFlowFromJournal (SP2)', () => {
    beforeEach(() => {
      prisma.journalLine.groupBy.mockResolvedValue([]);
      prisma.journalEntry.findMany.mockResolvedValue([]);
      prisma.fixedAsset.aggregate.mockResolvedValue({ _sum: { purchaseCost: null } });
    });

    it('returns all zeros for empty period and isReconciled=true', async () => {
      const result = await service.getCashFlowFromJournal(
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );
      expect(result.method).toBe('indirect');
      expect(result.operating.netIncome).toBe(0);
      expect(result.operating.depreciation).toBe(0);
      expect(result.operating.netOperating).toBe(0);
      expect(result.investing.netInvesting).toBe(0);
      expect(result.financing.netFinancing).toBe(0);
      expect(result.netChange).toBe(0);
      expect(result.openingCash).toBe(0);
      expect(result.closingCash).toBe(0);
      expect(result.actualCashChange).toBe(0);
      expect(result.drift).toBe(0);
      expect(result.isReconciled).toBe(true);
    });

    it('adds depreciation (Dr 53-16) back to net income in operating section', async () => {
      // First call: getProfitLossFromJournal (revenue + expense lines)
      // We return one expense line in 53-16: Dr 5000 → net income = -5000
      // Subsequent calls: sumDebitInPeriod for 53-16 returns Dr 5000
      // All other balance calls return empty.
      let callCount = 0;
      prisma.journalLine.groupBy.mockImplementation(() => {
        callCount += 1;
        // Call 1: getProfitLossFromJournal — return 53-16 expense
        // Call 2: sumDebitInPeriod for '53-16' — return Dr 5000 net
        if (callCount <= 2) {
          return Promise.resolve([
            {
              accountCode: '53-1601',
              _sum: { debit: new Prisma.Decimal(5000), credit: new Prisma.Decimal(0) },
            },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { code: '53-1601', name: 'ค่าเสื่อม' },
      ]);

      const result = await service.getCashFlowFromJournal(
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );
      expect(result.operating.netIncome).toBeCloseTo(-5000, 2);
      expect(result.operating.depreciation).toBeCloseTo(5000, 2);
      // netOperating = NI + depreciation = -5000 + 5000 = 0
      expect(result.operating.netOperating).toBeCloseTo(0, 2);
    });

    // SP2 Critical #1-#3 — known PPE/Disposal accounting gaps (deferred A.5)
    //
    // These tests assert the CURRENT (buggy-by-design) behavior so any future
    // fix surfaces as a test diff. Per .claude/rules/accounting.md, PPE +
    // depreciation is "DEFERRED to Phase A.5" — the cash flow report ships
    // with documented caveats rather than blocking on a full A.5 build-out.
    //
    // When Phase A.5 lands disposal handling, update these tests to assert the
    // corrected behavior (and remove the warning banner from CashFlowPage).

    it('CASH FLOW KNOWN GAP: ppePurchases is NOT companyId-scoped (FixedAsset lacks companyId)', async () => {
      // 100k FixedAsset purchase posted in period — same number returned
      // regardless of companyId filter passed by caller.
      prisma.fixedAsset.aggregate.mockResolvedValue({
        _sum: { purchaseCost: new Prisma.Decimal(100_000) },
      });

      const resultNoCo = await service.getCashFlowFromJournal(
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );
      const resultWithCo = await service.getCashFlowFromJournal(
        new Date('2026-01-01'),
        new Date('2026-01-31'),
        'co-FINANCE',
      );

      // KNOWN GAP — passing companyId has zero effect on PPE aggregate.
      // Phase A.5: must add FixedAsset.companyId scope + assert difference.
      expect(resultNoCo.investing.ppePurchases).toBe(100_000);
      expect(resultWithCo.investing.ppePurchases).toBe(100_000);
      expect(resultWithCo.investing.ppePurchases).toBe(resultNoCo.investing.ppePurchases);

      // Verify the aggregate was called WITHOUT companyId in the where clause
      // (proves the leak — confirming the gap is structural, not a typo).
      const aggregateCalls = prisma.fixedAsset.aggregate.mock.calls;
      for (const call of aggregateCalls) {
        expect(call[0].where).not.toHaveProperty('companyId');
      }
    });

    it('CASH FLOW KNOWN GAP: disposal proceeds use JE metadata only — no reversal of gain/loss in operating section', async () => {
      // Asset disposal with 30k proceeds via metadata.disposalProceeds
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          metadata: { flow: 'asset-disposal', disposalProceeds: '30000' },
        },
      ]);

      const result = await service.getCashFlowFromJournal(
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );

      // Net Investing reflects disposal proceeds — good.
      expect(result.investing.ppeDisposals).toBe(30_000);

      // KNOWN GAP — gain/loss from the disposal flows into netIncome via P&L
      // (because asset-disposal JE credits 41-12XX gain or debits 51-XX loss),
      // but the indirect-method operating section does NOT reverse it out.
      // This creates a double-count when both operating gain AND investing
      // proceeds are presented. Phase A.5 must add a "reverse gain/loss on
      // disposal" line in the operating section.
      // For now, document by asserting reverseDisposalGain field is missing.
      expect(result.operating).not.toHaveProperty('reverseDisposalGain');
      expect(result.operating).not.toHaveProperty('reverseDisposalLoss');
    });

    it('flags isReconciled=false when computed netChange drifts > 1 THB from actual cash Δ', async () => {
      // Make the cash account show a different delta than the indirect computation.
      // We seed cash account opening 0 and closing 100 (asActualCashChange=100),
      // but leave all operating/investing/financing at 0 → netChange=0 → drift=100.
      let groupByCall = 0;
      prisma.journalLine.groupBy.mockImplementation((args) => {
        groupByCall += 1;
        // Identify the cash-prefix balance lookups by their OR filter on '11-11' or '11-12'.
        const where = (args as { where?: { OR?: Array<{ accountCode?: { startsWith: string } }> } })
          .where;
        const codes = where?.OR?.map((o) => o.accountCode?.startsWith);
        const isCash =
          codes && codes.length === 2 && codes.includes('11-11') && codes.includes('11-12');
        if (isCash) {
          // 2 cash calls: opening (startMinusOne) then closing (periodEnd).
          // We track that the second cash call returns 100.
          return Promise.resolve([
            {
              accountCode: '11-1101',
              _sum: {
                debit: new Prisma.Decimal(groupByCall % 2 === 0 ? 100 : 0),
                credit: new Prisma.Decimal(0),
              },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.getCashFlowFromJournal(
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );
      expect(result.actualCashChange).not.toBe(0);
      expect(result.drift).not.toBe(0);
      expect(result.isReconciled).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SP2: getEquityStatementFromJournal
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getEquityStatementFromJournal (SP2)', () => {
    beforeEach(() => {
      prisma.journalLine.groupBy.mockResolvedValue([]);
      prisma.journalLine.findMany.mockResolvedValue([]);
      prisma.chartOfAccount.findMany.mockResolvedValue([]);
    });

    it('returns empty matrix + zero currentYearProfit + caveat when no movements', async () => {
      const result = await service.getEquityStatementFromJournal(
        new Date('2026-01-01'),
        new Date('2026-03-31'),
      );
      expect(result.rows).toHaveLength(4);
      expect(result.rows[0].opening).toBe(0);
      expect(result.rows[0].closing).toBe(0);
      expect(result.rows[0].increases).toEqual([]);
      expect(result.rows[0].decreases).toEqual([]);
      expect(result.currentYearProfit).toBe(0);
      expect(result.caveat).toMatch(/ค่าประมาณ.*ยังไม่ปิดบัญชี/);
      expect(result.totalOpening).toBe(0);
      expect(result.totalClosing).toBe(0);
    });

    it('records Cr movements as increases on 31-1101 and updates closing balance', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { code: '31-1101', name: 'หุ้นสามัญ' },
        { code: '31-1102', name: 'ส่วนเกินมูลค่าหุ้น' },
        { code: '32-1101', name: 'กำไรสะสม' },
        { code: '33-1101', name: 'กำไรประจำปี' },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([
        {
          accountCode: '31-1101',
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(50000),
          description: 'เพิ่มทุน',
          journalEntry: {
            entryDate: new Date('2026-02-10'),
            entryNumber: 'JE-202602-00001',
            description: 'Capital injection',
          },
        },
      ]);

      const result = await service.getEquityStatementFromJournal(
        new Date('2026-01-01'),
        new Date('2026-03-31'),
      );
      const row = result.rows.find((r) => r.accountCode === '31-1101')!;
      expect(row.increases).toHaveLength(1);
      expect(row.increases[0].amount).toBeCloseTo(50000, 2);
      expect(row.totalIncrease).toBeCloseTo(50000, 2);
      expect(row.totalDecrease).toBe(0);
      expect(row.closing).toBeCloseTo(50000, 2);
      expect(result.totalClosing).toBeCloseTo(50000, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SP2: getGeneralLedger
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getGeneralLedger (SP2)', () => {
    beforeEach(() => {
      prisma.journalLine.groupBy.mockResolvedValue([]);
      prisma.journalLine.findMany.mockResolvedValue([]);
    });

    it('throws NotFoundException when accountCode is not in CoA', async () => {
      prisma.chartOfAccount.findFirst.mockResolvedValue(null);
      await expect(
        service.getGeneralLedger(
          '99-9999',
          new Date('2026-01-01'),
          new Date('2026-01-31'),
        ),
      ).rejects.toThrow(/ไม่พบรหัสบัญชี/);
    });

    it('returns opening + zero lines + closing=opening for an account with no period activity', async () => {
      prisma.chartOfAccount.findFirst.mockResolvedValue({
        code: '11-1201',
        name: 'ธนาคาร KBank',
        normalBalance: 'Dr',
      });
      // sumAccountBalances for opening — return Dr 1000 - Cr 0 = 1000
      prisma.journalLine.groupBy.mockResolvedValue([
        {
          accountCode: '11-1201',
          _sum: { debit: new Prisma.Decimal(1000), credit: new Prisma.Decimal(0) },
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([]);

      const result = await service.getGeneralLedger(
        '11-1201',
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );
      expect(result.accountCode).toBe('11-1201');
      expect(result.accountName).toBe('ธนาคาร KBank');
      expect(result.normalBalance).toBe('Dr');
      expect(result.opening).toBeCloseTo(1000, 2);
      expect(result.closing).toBeCloseTo(1000, 2);
      expect(result.lines).toHaveLength(0);
    });

    it('computes running balance for a Dr-normal account across multiple lines', async () => {
      prisma.chartOfAccount.findFirst.mockResolvedValue({
        code: '11-1201',
        name: 'ธนาคาร KBank',
        normalBalance: 'Dr',
      });
      // Opening 500
      prisma.journalLine.groupBy.mockResolvedValue([
        {
          accountCode: '11-1201',
          _sum: { debit: new Prisma.Decimal(500), credit: new Prisma.Decimal(0) },
        },
      ]);
      // Two lines in period: +200 (Dr) then -100 (Cr)
      prisma.journalLine.findMany.mockResolvedValue([
        {
          debit: new Prisma.Decimal(200),
          credit: new Prisma.Decimal(0),
          description: 'รับเงิน',
          journalEntry: {
            entryDate: new Date('2026-01-05'),
            entryNumber: 'JE-202601-00001',
            description: 'รับชำระงวด',
            referenceType: 'AUTO',
            referenceId: 'pay-1',
          },
        },
        {
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(100),
          description: 'จ่ายเงิน',
          journalEntry: {
            entryDate: new Date('2026-01-15'),
            entryNumber: 'JE-202601-00002',
            description: 'จ่ายค่าใช้จ่าย',
            referenceType: 'AUTO',
            referenceId: 'exp-1',
          },
        },
      ]);

      const result = await service.getGeneralLedger(
        '11-1201',
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );
      expect(result.opening).toBeCloseTo(500, 2);
      expect(result.lines[0].runningBalance).toBeCloseTo(700, 2);
      expect(result.lines[1].runningBalance).toBeCloseTo(600, 2);
      expect(result.closing).toBeCloseTo(600, 2);
      expect(result.totalDebit).toBeCloseTo(200, 2);
      expect(result.totalCredit).toBeCloseTo(100, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // P3-SP3: exportJournalWithPeakCodes
  // ═══════════════════════════════════════════════════════════════════════════

  describe('exportJournalWithPeakCodes', () => {
    const startDate = new Date('2026-05-01');
    const endDate = new Date('2026-05-31');

    beforeEach(() => {
      // Two CoA rows — one mapped, one unmapped.
      prisma.chartOfAccount.findMany.mockImplementation(({ where }: { where?: { peakCode?: { not?: null } } }) => {
        if (where?.peakCode?.not === null) {
          return Promise.resolve([
            { code: '11-1101', name: 'เงินสด - สุทธินีย์', peakCode: '1110-01' },
          ]);
        }
        return Promise.resolve([
          { code: '11-1101', name: 'เงินสด - สุทธินีย์' },
          { code: '11-2103', name: 'ลูกหนี้ค้างชำระ' },
        ]);
      });
    });

    it('rejects a range longer than 6 months', async () => {
      await expect(
        service.exportJournalWithPeakCodes(new Date('2026-01-01'), new Date('2026-12-31')),
      ).rejects.toThrow(/ไม่เกิน 6 เดือน/);
    });

    it('rejects when end is before start', async () => {
      await expect(
        service.exportJournalWithPeakCodes(new Date('2026-05-31'), new Date('2026-05-01')),
      ).rejects.toThrow(/ไม่อยู่ก่อนวันเริ่มต้น/);
    });

    it('returns CSV with header + mapped rows, skips unmapped accounts', async () => {
      prisma.journalLine.findMany.mockResolvedValue([
        {
          accountCode: '11-1101',
          debit: new Prisma.Decimal('1000.50'),
          credit: new Prisma.Decimal(0),
          description: 'รับชำระงวด 1',
          journalEntry: {
            entryNumber: 'JE-202605-0001',
            entryDate: new Date('2026-05-10'),
            description: 'ชำระเงิน',
            referenceType: 'PAYMENT',
            referenceId: 'pay-uuid-1',
          },
        },
        {
          accountCode: '11-2103', // unmapped — should be skipped
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal('1000.50'),
          description: 'รับชำระงวด 1',
          journalEntry: {
            entryNumber: 'JE-202605-0001',
            entryDate: new Date('2026-05-10'),
            description: 'ชำระเงิน',
            referenceType: 'PAYMENT',
            referenceId: 'pay-uuid-1',
          },
        },
      ]);

      const result = await service.exportJournalWithPeakCodes(startDate, endDate);

      expect(result.skippedLineCount).toBe(1);
      expect(result.rowCount).toBe(1);
      // First char is BOM, then header
      expect(result.csv).toContain('entryDate,entryNumber,peakCode');
      // Mapped line is present
      expect(result.csv).toContain('1110-01');
      expect(result.csv).toContain('11-1101');
      // Money values preserved as string (not Number())
      expect(result.csv).toContain('1000.5');
    });

    it('returns 0 rows when nothing in range matches', async () => {
      prisma.journalLine.findMany.mockResolvedValue([]);
      const result = await service.exportJournalWithPeakCodes(startDate, endDate);
      expect(result.rowCount).toBe(0);
      expect(result.skippedLineCount).toBe(0);
      // Still has header + BOM
      expect(result.csv.startsWith('﻿entryDate,')).toBe(true);
    });
  });
});
