import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { AccountingService } from './accounting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CreateExpenseDto } from './dto/expense.dto';

/**
 * AccountingService handles the core financial reporting engine for BESTCHOICE.
 * It aggregates expenses, generates P&L statements, balance sheets, and cash flow
 * statements from raw transactional data (no general ledger).
 *
 * Tests focus on:
 *  - getExpenseSummary: aggregation by accountType/category, excluding VOIDED/REJECTED
 *  - voidExpense: OWNER-only rule for PAID expenses, reason validation, re-void guard
 *  - getProfitLossReport (getProfitAndLoss): revenue aggregation, expense mapping,
 *    gross/operating/net profit chain, profitMargin zero-division guard
 *  - getComparativePL: month-boundary wrapping (Jan → Dec prev year), pctChange arithmetic
 *  - getBalanceSheet: asset/liability/equity structure, derived retainedEarnings = A - L
 *  - getCashFlowStatement: operating cash flow components, sign conventions
 *  - validatePeriodOpen (via closeAccountingPeriod + createExpense path): period lock throws
 *  - closeAccountingPeriod: upsert behaviour, status query
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
        upsert: jest.fn().mockResolvedValue({ key: 'accounting_period_closed_until', value: '2026-03-31' }),
      },
      expense: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue(zeroAgg('totalAmount')),
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
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: null, amountDue: null, lateFee: null } }),
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
      $transaction: jest.fn().mockImplementation(async (fn) => {
        if (typeof fn === 'function') {
          return fn(prisma);
        }
        return Promise.all(fn);
      }),
    };

    journalAutoService = {
      createExpenseJournal: jest.fn().mockResolvedValue(undefined),
    };

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
  // getExpenseSummary
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getExpenseSummary', () => {
    it('returns zero totals when no expenses exist', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      const result = await service.getExpenseSummary({});
      expect(result.totalAmount).toBe(0);
      expect(result.totalCount).toBe(0);
      expect(result.pendingCount).toBe(0);
    });

    it('aggregates totalAmount across multiple expense records', async () => {
      prisma.expense.findMany.mockResolvedValue([
        { accountType: 'ADMINISTRATIVE_EXPENSE', category: 'ADMIN_RENT', totalAmount: new Prisma.Decimal(5000), status: 'PAID' },
        { accountType: 'SELLING_EXPENSE', category: 'SELL_COMMISSION', totalAmount: new Prisma.Decimal(2500), status: 'APPROVED' },
      ]);

      const result = await service.getExpenseSummary({});
      expect(result.totalAmount).toBeCloseTo(7500, 4);
      expect(result.totalCount).toBe(2);
    });

    it('groups totals correctly by accountType', async () => {
      prisma.expense.findMany.mockResolvedValue([
        { accountType: 'ADMINISTRATIVE_EXPENSE', category: 'ADMIN_RENT', totalAmount: new Prisma.Decimal(3000), status: 'PAID' },
        { accountType: 'ADMINISTRATIVE_EXPENSE', category: 'ADMIN_SALARY', totalAmount: new Prisma.Decimal(7000), status: 'PAID' },
        { accountType: 'SELLING_EXPENSE', category: 'SELL_COMMISSION', totalAmount: new Prisma.Decimal(1000), status: 'PAID' },
      ]);

      const result = await service.getExpenseSummary({});
      expect(result.byAccountType['ADMINISTRATIVE_EXPENSE']).toBeCloseTo(10000, 4);
      expect(result.byAccountType['SELLING_EXPENSE']).toBeCloseTo(1000, 4);
    });

    it('counts DRAFT and PENDING_APPROVAL as pending', async () => {
      prisma.expense.findMany.mockResolvedValue([
        { accountType: 'ADMINISTRATIVE_EXPENSE', category: 'ADMIN_RENT', totalAmount: new Prisma.Decimal(1000), status: 'DRAFT' },
        { accountType: 'ADMINISTRATIVE_EXPENSE', category: 'ADMIN_SALARY', totalAmount: new Prisma.Decimal(2000), status: 'PENDING_APPROVAL' },
        { accountType: 'SELLING_EXPENSE', category: 'SELL_COMMISSION', totalAmount: new Prisma.Decimal(500), status: 'PAID' },
      ]);

      const result = await service.getExpenseSummary({});
      expect(result.pendingCount).toBe(2);
    });

    it('excludes VOIDED and REJECTED from the query (where clause check)', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      await service.getExpenseSummary({ branchId: 'branch-1', startDate: '2026-01-01', endDate: '2026-01-31' });

      const where = prisma.expense.findMany.mock.calls[0][0].where;
      expect(where.status.notIn).toEqual(expect.arrayContaining(['VOIDED', 'REJECTED']));
      expect(where.branchId).toBe('branch-1');
      expect(where.deletedAt).toBeNull();
    });

    it('applies date range filter on expenseDate', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      await service.getExpenseSummary({ startDate: '2026-01-01', endDate: '2026-01-31' });

      const where = prisma.expense.findMany.mock.calls[0][0].where;
      expect(where.expenseDate.gte).toEqual(new Date('2026-01-01'));
      // endDate should have time set to 23:59:59
      expect(where.expenseDate.lte.getHours()).toBe(23);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // voidExpense
  // ═══════════════════════════════════════════════════════════════════════════

  describe('voidExpense', () => {
    it('throws BadRequestException when voidReason is empty', async () => {
      await expect(service.voidExpense('exp-1', 'user-1', '')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException when voidReason is only whitespace', async () => {
      await expect(service.voidExpense('exp-1', 'user-1', '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFoundException when expense does not exist', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);
      await expect(service.voidExpense('missing-id', 'user-1', 'wrong entry')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException when expense is already VOIDED', async () => {
      prisma.expense.findFirst.mockResolvedValue({ id: 'exp-1', status: 'VOIDED' });
      await expect(service.voidExpense('exp-1', 'user-1', 'reason')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('allows OWNER to void a PAID expense', async () => {
      prisma.expense.findFirst.mockResolvedValue({ id: 'exp-1', status: 'PAID' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-owner', role: 'OWNER' });
      prisma.expense.update.mockResolvedValue({ id: 'exp-1', status: 'VOIDED' });

      const result = await service.voidExpense('exp-1', 'user-owner', 'accounting error');
      expect(prisma.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'VOIDED', voidReason: 'accounting error' }),
        }),
      );
      expect(result.status).toBe('VOIDED');
    });

    it('blocks non-OWNER from voiding a PAID expense', async () => {
      prisma.expense.findFirst.mockResolvedValue({ id: 'exp-1', status: 'PAID' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-mgr', role: 'BRANCH_MANAGER' });

      await expect(service.voidExpense('exp-1', 'user-mgr', 'reason')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('allows any authenticated user to void a DRAFT expense (no role check)', async () => {
      prisma.expense.findFirst.mockResolvedValue({ id: 'exp-1', status: 'DRAFT' });
      prisma.expense.update.mockResolvedValue({ id: 'exp-1', status: 'VOIDED' });

      // No user.findUnique should be called for non-PAID expenses
      await service.voidExpense('exp-1', 'user-sales', 'duplicate entry');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.expense.update).toHaveBeenCalled();
    });

    it('trims whitespace from voidReason before saving', async () => {
      prisma.expense.findFirst.mockResolvedValue({ id: 'exp-1', status: 'DRAFT' });
      prisma.expense.update.mockResolvedValue({ id: 'exp-1', status: 'VOIDED' });

      await service.voidExpense('exp-1', 'user-1', '  duplicate  ');
      const updateCall = prisma.expense.update.mock.calls[0][0];
      expect(updateCall.data.voidReason).toBe('duplicate');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getProfitLossReport (getProfitAndLoss)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getProfitLossReport', () => {
    // Set up "all zeros" baseline so individual tests only override what they need
    const setupZeroPL = () => {
      prisma.sale.aggregate.mockResolvedValue(zeroAgg('netAmount'));
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.financeReceivable.aggregate.mockResolvedValue(zeroAgg('receivedAmount'));
      prisma.expense.findMany.mockResolvedValue([]);
      prisma.sale.findMany.mockResolvedValue([]);
      prisma.product.findMany.mockResolvedValue([]);
    };

    it('returns zero for all line items when there are no transactions', async () => {
      setupZeroPL();
      // sale.aggregate is called multiple times (CASH, INSTALLMENT, EXTERNAL_FINANCE)
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
        .mockResolvedValueOnce(makeAgg('netAmount', 50000))    // CASH
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))   // INSTALLMENT
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));  // EXTERNAL_FINANCE

      const result = await service.getProfitLossReport('2026-01-01', '2026-01-31');
      expect(result.revenue.cashSales).toBeCloseTo(50000, 4);
      expect(result.revenue.totalRevenue).toBeGreaterThanOrEqual(50000);
    });

    it('accumulates installmentPayments from paidPayments using stored breakdowns', async () => {
      setupZeroPL();
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));
      prisma.payment.findMany.mockResolvedValue([
        {
          amountPaid: new Prisma.Decimal(3000),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          monthlyPrincipal: new Prisma.Decimal(2500),
          monthlyInterest: new Prisma.Decimal(300),
          monthlyCommission: new Prisma.Decimal(200),
          vatAmount: new Prisma.Decimal(0),
          contract: { interestTotal: new Prisma.Decimal(3600), totalMonths: 12 },
        },
      ]);

      const result = await service.getProfitLossReport('2026-01-01', '2026-01-31');
      // installmentPayments = amountPaid = 3000
      expect(result.revenue.installmentPayments).toBeCloseTo(3000, 4);
      // paymentBreakdown fields are informational only (not additive)
      expect(result.paymentBreakdown.principalIncome).toBeCloseTo(2500, 4);
      expect(result.paymentBreakdown.interestIncome).toBeCloseTo(300, 4);
      expect(result.paymentBreakdown.commissionIncome).toBeCloseTo(200, 4);
    });

    it('uses legacy fallback (amountPaid) when monthlyPrincipal is null', async () => {
      setupZeroPL();
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));
      prisma.payment.findMany.mockResolvedValue([
        {
          amountPaid: new Prisma.Decimal(4000),
          lateFee: new Prisma.Decimal(0),
          lateFeeWaived: false,
          monthlyPrincipal: null,
          monthlyInterest: null,
          monthlyCommission: null,
          vatAmount: null,
          contract: { interestTotal: new Prisma.Decimal(2400), totalMonths: 12 },
        },
      ]);

      const result = await service.getProfitLossReport('2026-01-01', '2026-01-31');
      expect(result.revenue.installmentPayments).toBeCloseTo(4000, 4);
      // Legacy path adds amountPaid to principalIncome + estimated interest per month
      expect(result.paymentBreakdown.interestIncome).toBeCloseTo(200, 4); // 2400 / 12
    });

    it('adds non-waived lateFee to totalRevenue as separate additive income', async () => {
      setupZeroPL();
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));
      prisma.payment.findMany.mockResolvedValue([
        {
          amountPaid: new Prisma.Decimal(3000),
          lateFee: new Prisma.Decimal(500),
          lateFeeWaived: false,
          monthlyPrincipal: new Prisma.Decimal(3000),
          monthlyInterest: new Prisma.Decimal(0),
          monthlyCommission: new Prisma.Decimal(0),
          vatAmount: new Prisma.Decimal(0),
          contract: { interestTotal: new Prisma.Decimal(0), totalMonths: 12 },
        },
      ]);

      const result = await service.getProfitLossReport('2026-01-01', '2026-01-31');
      expect(result.revenue.lateFeeIncome).toBeCloseTo(500, 4);
    });

    it('does NOT add waived lateFee to revenue', async () => {
      setupZeroPL();
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));
      prisma.payment.findMany.mockResolvedValue([
        {
          amountPaid: new Prisma.Decimal(3000),
          lateFee: new Prisma.Decimal(500),
          lateFeeWaived: true,
          monthlyPrincipal: new Prisma.Decimal(3000),
          monthlyInterest: new Prisma.Decimal(0),
          monthlyCommission: new Prisma.Decimal(0),
          vatAmount: new Prisma.Decimal(0),
          contract: { interestTotal: new Prisma.Decimal(0), totalMonths: 12 },
        },
      ]);

      const result = await service.getProfitLossReport('2026-01-01', '2026-01-31');
      expect(result.revenue.lateFeeIncome).toBe(0);
    });

    it('maps ADMIN_RENT expense to adminExpenses.rent and reduces operatingProfit', async () => {
      setupZeroPL();
      prisma.sale.aggregate
        .mockResolvedValueOnce(makeAgg('netAmount', 100000))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));
      prisma.expense.findMany.mockResolvedValue([
        { category: 'ADMIN_RENT', totalAmount: new Prisma.Decimal(20000) },
      ]);

      const result = await service.getProfitLossReport('2026-01-01', '2026-01-31');
      expect(result.adminExpenses.rent).toBeCloseTo(20000, 4);
      expect(result.operatingProfit).toBeCloseTo(80000, 4); // 100000 - 20000
    });

    it('grossProfit = operatingRevenue - totalCOGS (excludes lateFee and other expenses)', async () => {
      setupZeroPL();
      prisma.sale.aggregate
        .mockResolvedValueOnce(makeAgg('netAmount', 50000))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));
      // COGS expense
      prisma.expense.findMany.mockResolvedValue([
        { category: 'COGS_PRODUCT', totalAmount: new Prisma.Decimal(30000) },
      ]);

      const result = await service.getProfitLossReport('2026-01-01', '2026-01-31');
      expect(result.grossProfit).toBeCloseTo(20000, 4); // 50000 - 30000
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
      revenue: { cashSales: 0, installmentDownPayments: 0, installmentPayments: 0,
        financeDownPayments: 0, financeReceived: 0, operatingRevenue: 0,
        lateFeeIncome: 0, totalRevenue: 0 },
      paymentBreakdown: { principalIncome: 0, interestIncome: 0, commissionIncome: 0, note: '' },
      vatOutput: { accountCode: '', label: '', amount: 0, note: '' },
      costOfSales: { cogsProduct: 0, cogsRepairParts: 0, purchaseOrderCost: 0, totalCOGS: 0 },
      grossProfit: 0,
      sellingExpenses: { commission: 0, advertising: 0, transport: 0, packaging: 0, totalSelling: 0 },
      adminExpenses: { salary: 0, socialSecurity: 0, rent: 0, utilities: 0, officeSupplies: 0,
        depreciation: 0, insurance: 0, taxFee: 0, maintenance: 0, travel: 0, telephone: 0, totalAdmin: 0 },
      operatingProfit: 0,
      otherExpenses: { interest: 0, loss: 0, fine: 0, misc: 0, totalOther: 0 },
      netProfit: 0,
      summary: { totalRevenue: 0, totalExpenses: 0, netProfit: 0, profitMargin: 0 },
    });

    it('wraps to December of prior year when month=1 (January edge case)', async () => {
      // Spy on getProfitLossReport to capture the date strings passed
      const spy = jest
        .spyOn(service, 'getProfitLossReport')
        .mockResolvedValue(makeEmptyPL() as any);

      await service.getComparativePL(2026, 1);

      // Three calls: current (Jan 2026), previous (Dec 2025), YoY (Jan 2025)
      const calls = spy.mock.calls;
      expect(calls[0][0]).toBe('2026-01-01'); // current start
      expect(calls[1][0]).toBe('2025-12-01'); // prev month start (Dec 2025)
      expect(calls[1][1]).toBe('2025-12-31'); // prev month end
      expect(calls[2][0]).toBe('2025-01-01'); // YoY start (Jan 2025)

      spy.mockRestore();
    });

    it('calculates MoM change percentage correctly', async () => {
      const currentPL = { ...makeEmptyPL(), netProfit: 120, revenue: { ...makeEmptyPL().revenue, totalRevenue: 200 }, grossProfit: 150 };
      const prevPL = { ...makeEmptyPL(), netProfit: 100, revenue: { ...makeEmptyPL().revenue, totalRevenue: 200 }, grossProfit: 100 };
      const yoyPL = { ...makeEmptyPL(), netProfit: 80, revenue: { ...makeEmptyPL().revenue, totalRevenue: 180 }, grossProfit: 80 };

      jest.spyOn(service, 'getProfitLossReport')
        .mockResolvedValueOnce(currentPL as any)
        .mockResolvedValueOnce(prevPL as any)
        .mockResolvedValueOnce(yoyPL as any);

      const result = await service.getComparativePL(2026, 3);

      // MoM netProfit: (120 - 100) / 100 * 100 = 20%
      expect(result.momChange.netProfit).toBeCloseTo(20, 2);
      // YoY grossProfit: (150 - 80) / 80 * 100 = 87.5%
      expect(result.yoyChange.grossProfit).toBeCloseTo(87.5, 2);
    });

    it('returns 100% change when previous period is zero and current is positive', async () => {
      const currentPL = { ...makeEmptyPL(), netProfit: 50, revenue: { ...makeEmptyPL().revenue, totalRevenue: 50 }, grossProfit: 50 };
      const zeroPL = makeEmptyPL();

      jest.spyOn(service, 'getProfitLossReport')
        .mockResolvedValueOnce(currentPL as any)
        .mockResolvedValueOnce(zeroPL as any)
        .mockResolvedValueOnce(zeroPL as any);

      const result = await service.getComparativePL(2026, 3);
      expect(result.momChange.netProfit).toBe(100);
    });

    it('returns 0% change when both previous and current periods are zero', async () => {
      const zeroPL = makeEmptyPL();
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
        .mockResolvedValueOnce({ _sum: { amountPaid: null } })   // paymentsReceived
        .mockResolvedValueOnce({ _sum: { amountDue: null, amountPaid: null } }); // hpReceivables
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))              // cashSalesTotal
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));     // downPaymentsTotal
      prisma.financeReceivable.aggregate
        .mockResolvedValueOnce(zeroAgg('receivedAmount'))         // financeReceivedTotal
        .mockResolvedValueOnce(zeroAgg('expectedAmount'));        // pendingFinance
      prisma.expense.aggregate
        .mockResolvedValueOnce(zeroAgg('totalAmount'))            // expensesPaid
        .mockResolvedValueOnce(zeroAgg('withholdingTax'))         // whtPayable
        .mockResolvedValueOnce(zeroAgg('totalAmount'));           // accruedExpenses
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
      // Inject non-trivial amounts to verify the balancing equation holds
      prisma.payment.aggregate
        .mockResolvedValueOnce(makeAgg('amountPaid', 100000))          // paymentsReceived
        .mockResolvedValueOnce({ _sum: { amountDue: new Prisma.Decimal(80000), amountPaid: new Prisma.Decimal(30000) } });
      prisma.sale.aggregate
        .mockResolvedValueOnce(makeAgg('netAmount', 50000))
        .mockResolvedValueOnce(makeAgg('downPaymentAmount', 10000));
      prisma.financeReceivable.aggregate
        .mockResolvedValueOnce(makeAgg('receivedAmount', 5000))
        .mockResolvedValueOnce(makeAgg('expectedAmount', 2000));
      prisma.expense.aggregate
        .mockResolvedValueOnce(makeAgg('totalAmount', 20000))          // expensesPaid outflow
        .mockResolvedValueOnce(makeAgg('withholdingTax', 1500))
        .mockResolvedValueOnce(makeAgg('totalAmount', 3000));          // accrued
      prisma.purchaseOrder.aggregate.mockResolvedValue(makeAgg('paidAmount', 15000));
      prisma.badDebtProvision.aggregate.mockResolvedValue(makeAgg('provisionAmount', 4000));
      prisma.product.aggregate.mockResolvedValue({ _sum: { costPrice: new Prisma.Decimal(25000) }, _count: 5 });
      prisma.contract.aggregate.mockResolvedValue(makeAgg('creditBalance', 500));

      const result = await service.getBalanceSheet('2026-03-31');
      const { totalAssets } = result.assets;
      const { totalLiabilities } = result.liabilities;
      const { retainedEarnings } = result.equity;

      expect(retainedEarnings).toBeCloseTo(totalAssets - totalLiabilities, 4);
    });

    it('cashAndBank = totalInflows - totalOutflows', async () => {
      prisma.payment.aggregate
        .mockResolvedValueOnce(makeAgg('amountPaid', 30000))
        .mockResolvedValueOnce({ _sum: { amountDue: null, amountPaid: null } });
      prisma.sale.aggregate
        .mockResolvedValueOnce(makeAgg('netAmount', 20000))
        .mockResolvedValueOnce(makeAgg('downPaymentAmount', 5000));
      prisma.financeReceivable.aggregate
        .mockResolvedValueOnce(makeAgg('receivedAmount', 10000))
        .mockResolvedValueOnce(zeroAgg('expectedAmount'));
      prisma.expense.aggregate
        .mockResolvedValueOnce(makeAgg('totalAmount', 8000))     // cash out
        .mockResolvedValueOnce(zeroAgg('withholdingTax'))
        .mockResolvedValueOnce(zeroAgg('totalAmount'));
      prisma.purchaseOrder.aggregate.mockResolvedValue(makeAgg('paidAmount', 7000));
      prisma.badDebtProvision.aggregate.mockResolvedValue(zeroAgg('provisionAmount'));
      prisma.product.aggregate.mockResolvedValue({ _sum: { costPrice: null }, _count: 0 });
      prisma.contract.aggregate.mockResolvedValue(zeroAgg('creditBalance'));

      const result = await service.getBalanceSheet('2026-03-31');
      // inflows = 30000 + 20000 + 5000 + 10000 = 65000
      // outflows = 8000 + 7000 = 15000
      // cashAndBank = 50000
      expect(result.assets.currentAssets.cashAndBank).toBeCloseTo(50000, 4);
    });

    it('inventory count is included in the balance sheet', async () => {
      setupZeroBalanceSheet();
      // Re-mock to include inventory after setupZeroBalanceSheet sets it to 0
      // (setupZeroBalanceSheet runs mockResolvedValue which is the default for future calls)
      prisma.product.aggregate.mockResolvedValue({ _sum: { costPrice: new Prisma.Decimal(12000) }, _count: 3 });

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
      prisma.expense.aggregate.mockResolvedValue(zeroAgg('totalAmount'));
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
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: new Prisma.Decimal(15000), lateFee: null } });
      prisma.financeReceivable.aggregate.mockResolvedValue(makeAgg('receivedAmount', 5000));
      prisma.expense.aggregate.mockResolvedValue(makeAgg('totalAmount', 12000));
      prisma.purchaseOrder.aggregate.mockResolvedValue(makeAgg('paidAmount', 8000));

      const result = await service.getCashFlowStatement('2026-01-01', '2026-01-31');
      expect(result.netCashChange).toBeCloseTo(result.operatingActivities.netOperatingCashFlow, 4);
    });

    it('cashPaidForExpenses is negative in the response (cash outflow sign convention)', async () => {
      prisma.sale.aggregate
        .mockResolvedValueOnce(zeroAgg('netAmount'))
        .mockResolvedValueOnce(zeroAgg('downPaymentAmount'));
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: null, lateFee: null } });
      prisma.financeReceivable.aggregate.mockResolvedValue(zeroAgg('receivedAmount'));
      prisma.expense.aggregate.mockResolvedValue(makeAgg('totalAmount', 5000));
      prisma.purchaseOrder.aggregate.mockResolvedValue(zeroAgg('paidAmount'));

      const result = await service.getCashFlowStatement('2026-01-01', '2026-01-31');
      expect(result.operatingActivities.cashPaidForExpenses).toBeLessThan(0);
      expect(result.operatingActivities.cashPaidForExpenses).toBeCloseTo(-5000, 4);
    });

    it('cashPaidForInventory is negative in the response (cash outflow sign convention)', async () => {
      setupZeroCashFlow();
      prisma.purchaseOrder.aggregate.mockResolvedValue(makeAgg('paidAmount', 20000));

      const result = await service.getCashFlowStatement('2026-01-01', '2026-01-31');
      expect(result.operatingActivities.cashPaidForInventory).toBeCloseTo(-20000, 4);
    });

    it('cashFromCustomers = sum of all four inflow sources', async () => {
      prisma.sale.aggregate
        .mockResolvedValueOnce(makeAgg('netAmount', 10000))          // cash sales
        .mockResolvedValueOnce(makeAgg('downPaymentAmount', 5000));  // down payments
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: new Prisma.Decimal(8000), lateFee: null } });
      prisma.financeReceivable.aggregate.mockResolvedValue(makeAgg('receivedAmount', 3000));
      prisma.expense.aggregate.mockResolvedValue(zeroAgg('totalAmount'));
      prisma.purchaseOrder.aggregate.mockResolvedValue(zeroAgg('paidAmount'));

      const result = await service.getCashFlowStatement('2026-01-01', '2026-01-31');
      // 10000 + 5000 + 8000 + 3000 = 26000
      expect(result.operatingActivities.cashFromCustomers).toBeCloseTo(26000, 4);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // validatePeriodOpen (via period-lock.util — tested through createExpense path)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('validatePeriodOpen (period lock enforcement)', () => {
    it('throws BadRequestException when expense date falls in a closed period', async () => {
      // Period closed until 2026-03-31
      prisma.systemConfig.findUnique.mockResolvedValue({
        key: 'accounting_period_closed_until',
        value: '2026-03-31',
      });

      // Attempt to create an expense for 2026-03-15 (before closed-until date)
      const dto: CreateExpenseDto = {
        branchId: 'branch-1',
        accountType: 'ADMINISTRATIVE_EXPENSE',
        category: 'ADMIN_RENT',
        description: 'มีนาคม',
        amount: 5000,
        expenseDate: '2026-03-15',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
      };

      await expect(service.createExpense(dto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows expense creation after the closed-until date', async () => {
      // Period closed until 2026-03-31 — April is open
      prisma.systemConfig.findUnique.mockResolvedValue({
        key: 'accounting_period_closed_until',
        value: '2026-03-31',
      });
      // Mock the transaction to resolve without error
      prisma.$transaction.mockImplementationOnce(async () => ({ id: 'exp-new', expenseNumber: 'EXP-202604-0001' }));

      const dto: CreateExpenseDto = {
        branchId: 'branch-1',
        accountType: 'ADMINISTRATIVE_EXPENSE',
        category: 'ADMIN_RENT',
        description: 'เมษายน',
        amount: 5000,
        expenseDate: '2026-04-01',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
      };

      await expect(service.createExpense(dto, 'user-1')).resolves.toBeDefined();
    });

    it('allows expense creation when no period lock is set', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementationOnce(async () => ({ id: 'exp-new', expenseNumber: 'EXP-202601-0001' }));

      const dto: CreateExpenseDto = {
        branchId: 'branch-1',
        accountType: 'ADMINISTRATIVE_EXPENSE',
        category: 'ADMIN_RENT',
        description: 'ไม่มีการล็อครอบบัญชี',
        amount: 1000,
        expenseDate: '2026-01-01',
        paymentMethod: PaymentMethod.CASH,
      };

      await expect(service.createExpense(dto, 'user-1')).resolves.toBeDefined();
    });

    // ── AccountingPeriod model checks ──────────────────────────────────────

    it('throws BadRequestException when AccountingPeriod is CLOSED for the expense month', async () => {
      // Branch belongs to company-1
      prisma.branch.findUnique.mockResolvedValue({ companyId: 'company-1' });
      // AccountingPeriod for 2026-04 is CLOSED
      prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });
      // No legacy lock
      prisma.systemConfig.findUnique.mockResolvedValue(null);

      const dto: CreateExpenseDto = {
        branchId: 'branch-1',
        accountType: 'ADMINISTRATIVE_EXPENSE',
        category: 'ADMIN_RENT',
        description: 'เมษายน (ปิดงวด)',
        amount: 2000,
        expenseDate: '2026-04-10',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
      };

      await expect(service.createExpense(dto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when AccountingPeriod is SYNCED for the expense month', async () => {
      prisma.branch.findUnique.mockResolvedValue({ companyId: 'company-1' });
      prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'SYNCED' });
      prisma.systemConfig.findUnique.mockResolvedValue(null);

      const dto: CreateExpenseDto = {
        branchId: 'branch-1',
        accountType: 'ADMINISTRATIVE_EXPENSE',
        category: 'ADMIN_RENT',
        description: 'มีนาคม (ซิงค์แล้ว)',
        amount: 3000,
        expenseDate: '2026-03-20',
        paymentMethod: PaymentMethod.CASH,
      };

      await expect(service.createExpense(dto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows expense creation when AccountingPeriod is REVIEW (not fully locked)', async () => {
      prisma.branch.findUnique.mockResolvedValue({ companyId: 'company-1' });
      prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'REVIEW' });
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementationOnce(async () => ({ id: 'exp-review', expenseNumber: 'EXP-202604-0002' }));

      const dto: CreateExpenseDto = {
        branchId: 'branch-1',
        accountType: 'ADMINISTRATIVE_EXPENSE',
        category: 'ADMIN_RENT',
        description: 'ระหว่างตรวจสอบ',
        amount: 1500,
        expenseDate: '2026-04-05',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
      };

      await expect(service.createExpense(dto, 'user-1')).resolves.toBeDefined();
    });

    it('allows expense creation when no AccountingPeriod record exists for the month', async () => {
      prisma.branch.findUnique.mockResolvedValue({ companyId: 'company-1' });
      prisma.accountingPeriod.findUnique.mockResolvedValue(null); // no record = OPEN
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementationOnce(async () => ({ id: 'exp-open', expenseNumber: 'EXP-202605-0001' }));

      const dto: CreateExpenseDto = {
        branchId: 'branch-1',
        accountType: 'ADMINISTRATIVE_EXPENSE',
        category: 'ADMIN_RENT',
        description: 'พฤษภาคม (ยังไม่ปิดงวด)',
        amount: 1200,
        expenseDate: '2026-05-01',
        paymentMethod: PaymentMethod.CASH,
      };

      await expect(service.createExpense(dto, 'user-1')).resolves.toBeDefined();
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
