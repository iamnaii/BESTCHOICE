import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ReportsService } from './reports.service';

/**
 * Wave 3 MED gap-fill — characterization (golden) tests for the remaining
 * in-JS aggregation paths in ReportsService that the existing
 * portfolio / gating / aging / aging-boundaries specs do NOT cover.
 *
 * Pins CURRENT behaviour of shipped code (no source changes). Covered here:
 *
 *   - getRevenuePLReport       (136-152) interest recognition + lateFee aggregate WHERE
 *   - getHighRiskCustomers     (240-261) totalOutstanding (lateFee INCLUDED) + daysOverdue clamp
 *   - getSalesComparisonReport (289-311) per-staff sums, overdueRate, sort
 *   - getDailyPaymentSummary   (434-472) totalAmount rounding, byMethod/byBranch, null->'CASH'
 *   - getBranchComparisonReport(346-392) payments-by-branch reduce + empty-group zeros
 *   - resolveCompanyBranches   (22-31)   branchId / companyId / empty / neither
 *   - getQuarterlyReport       (926-941) quarter -> date window + BadRequest guard
 *       (NOTE: endDate is TZ-shifted one day under UTC+7 — pinned as a quirk below)
 *
 * Mock-only: a hand-mocked PrismaService + a stubbed AccountingService cover
 * every injected dependency (see the 2-arg ReportsService constructor). No real DB.
 * Money is Prisma.Decimal where the code does Decimal ops; plain numbers where it
 * does Number(x). Decimal comparisons go through Prisma.Decimal(...).toFixed/toString.
 */
describe('ReportsService aggregations (Wave 3 characterization)', () => {
  // -------------------------------------------------------------------------
  // getRevenuePLReport — interest recognition + lateFee aggregate WHERE (136-152)
  // -------------------------------------------------------------------------
  describe('getRevenuePLReport', () => {
    function make(opts: {
      interestPayments: Array<{ interestTotal: number; totalMonths: number }>;
      lateFeeSum: number | null;
      totalAmountPaidSum: number | null;
      paymentCount: number;
      newContracts: number;
    }) {
      const paymentFindMany = jest.fn().mockResolvedValue(
        opts.interestPayments.map((p) => ({
          amountPaid: new Prisma.Decimal(0),
          contract: {
            interestTotal: new Prisma.Decimal(p.interestTotal),
            totalMonths: p.totalMonths,
          },
        })),
      );
      // aggregate is called twice (lateFee aggregate, then totals aggregate) —
      // first call resolves the lateFee sum, second the amountPaid sum + count.
      const paymentAggregate = jest
        .fn()
        .mockResolvedValueOnce({
          _sum: {
            lateFee: opts.lateFeeSum === null ? null : new Prisma.Decimal(opts.lateFeeSum),
            amountPaid: new Prisma.Decimal(0),
          },
        })
        .mockResolvedValueOnce({
          _sum: {
            amountPaid:
              opts.totalAmountPaidSum === null
                ? null
                : new Prisma.Decimal(opts.totalAmountPaidSum),
          },
          _count: opts.paymentCount,
        });
      const contractCount = jest.fn().mockResolvedValue(opts.newContracts);

      const prisma = {
        payment: { findMany: paymentFindMany, aggregate: paymentAggregate },
        contract: { count: contractCount },
      } as unknown as PrismaService;

      const svc = new ReportsService(prisma, {} as AccountingService);
      return { svc, paymentFindMany, paymentAggregate, contractCount };
    }

    it('interestIncome = Math.round(Σ interestTotal/totalMonths over PAID)', async () => {
      // 12000/12 = 1000.0000 ; 5000/3 = 1666.6667 ; sum = 2666.6667 -> round 2667
      const { svc } = make({
        interestPayments: [
          { interestTotal: 12000, totalMonths: 12 },
          { interestTotal: 5000, totalMonths: 3 },
        ],
        lateFeeSum: 300,
        totalAmountPaidSum: 9000,
        paymentCount: 2,
        newContracts: 4,
      });

      const report = await svc.getRevenuePLReport('2026-01-01', '2026-01-31');

      expect(report.revenue.interestIncome).toBe(2667);
      expect(report.revenue.lateFeeIncome).toBe(300);
      expect(report.revenue.totalPaymentsReceived).toBe(9000);
      expect(report.revenue.paymentCount).toBe(2);
      expect(report.contracts.newContracts).toBe(4);
      expect(report.period).toEqual({ start: '2026-01-01', end: '2026-01-31' });
    });

    it('lateFee aggregate WHERE filters status=PAID AND lateFeeWaived=false (waived excluded)', async () => {
      const { svc, paymentAggregate } = make({
        interestPayments: [],
        lateFeeSum: 0,
        totalAmountPaidSum: 0,
        paymentCount: 0,
        newContracts: 0,
      });

      await svc.getRevenuePLReport('2026-01-01', '2026-01-31');

      // 1st aggregate call = the lateFee aggregation
      const lateFeeWhere = paymentAggregate.mock.calls[0][0].where;
      expect(lateFeeWhere.status).toBe('PAID');
      expect(lateFeeWhere.lateFeeWaived).toBe(false);
      // 2nd aggregate call = totals — has NO lateFeeWaived clause
      const totalsWhere = paymentAggregate.mock.calls[1][0].where;
      expect(totalsWhere.status).toBe('PAID');
      expect(totalsWhere).not.toHaveProperty('lateFeeWaived');
    });

    it('null aggregate sums coalesce to 0 and empty interest list yields 0', async () => {
      const { svc } = make({
        interestPayments: [],
        lateFeeSum: null,
        totalAmountPaidSum: null,
        paymentCount: 0,
        newContracts: 0,
      });

      const report = await svc.getRevenuePLReport('2026-02-01', '2026-02-28');

      expect(report.revenue.interestIncome).toBe(0);
      expect(report.revenue.lateFeeIncome).toBe(0);
      expect(report.revenue.totalPaymentsReceived).toBe(0);
      expect(report.revenue.paymentCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getHighRiskCustomers — totalOutstanding (lateFee INCLUDED) + daysOverdue clamp (240-261)
  // -------------------------------------------------------------------------
  describe('getHighRiskCustomers', () => {
    const DAY = 24 * 60 * 60 * 1000;

    function make(contracts: unknown[], total = contracts.length) {
      const findMany = jest.fn().mockResolvedValue(contracts);
      const count = jest.fn().mockResolvedValue(total);
      const prisma = {
        contract: { findMany, count },
      } as unknown as PrismaService;
      const svc = new ReportsService(prisma, {} as AccountingService);
      return { svc, findMany, count };
    }

    it('totalOutstanding sums (amountDue - amountPaid + lateFee) — late fee INCLUDED', async () => {
      const { svc } = make([
        {
          contractNumber: 'BC-1',
          status: 'OVERDUE',
          customer: { id: 'c1', name: 'ลูกค้า 1', phone: '08', lineIdFinance: null, lineIdShop: null },
          branch: { name: 'สาขา A' },
          payments: [
            {
              // 2000 - 500 + 100 = 1600
              amountDue: new Prisma.Decimal(2000),
              amountPaid: new Prisma.Decimal(500),
              lateFee: new Prisma.Decimal(100),
              dueDate: new Date(Date.now() - 10 * DAY),
            },
          ],
        },
      ]);

      const res = await svc.getHighRiskCustomers();

      expect(res.data[0].totalOutstanding).toBe(1600);
      expect(res.data[0].overdueInstallments).toBe(1);
      expect(res.data[0].branch).toBe('สาขา A');
    });

    it('daysOverdue clamps to 0 when the oldest due date is in the future', async () => {
      const { svc } = make([
        {
          contractNumber: 'BC-2',
          status: 'OVERDUE',
          customer: { id: 'c2', name: 'ลูกค้า 2', phone: '08', lineIdFinance: null, lineIdShop: null },
          branch: { name: 'สาขา B' },
          payments: [
            {
              amountDue: new Prisma.Decimal(1000),
              amountPaid: new Prisma.Decimal(0),
              lateFee: new Prisma.Decimal(0),
              // future due date — calculateDaysOverdue clamps at 0
              dueDate: new Date(Date.now() + 30 * DAY),
            },
          ],
        },
      ]);

      const res = await svc.getHighRiskCustomers();
      expect(res.data[0].daysOverdue).toBe(0);
    });

    it('queries only OVERDUE/DEFAULT contracts and pulls still-owed installment statuses', async () => {
      const { svc, findMany } = make([], 0);
      const res = await svc.getHighRiskCustomers('branch-9', 1, 50);

      const args = findMany.mock.calls[0][0];
      expect(args.where.status).toEqual({ in: ['OVERDUE', 'DEFAULT'] });
      expect(args.where.deletedAt).toBeNull();
      expect(args.where.branchId).toBe('branch-9');
      expect(args.include.payments.where.status).toEqual({
        in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'],
      });
      expect(res.data).toEqual([]);
      expect(res.total).toBe(0);
    });

    it('clamps limit to 100 (safeLimit) and reflects it in the response + take/skip', async () => {
      const { svc, findMany } = make([], 0);
      const res = await svc.getHighRiskCustomers(undefined, 2, 500);

      expect(res.limit).toBe(100);
      expect(res.page).toBe(2);
      const args = findMany.mock.calls[0][0];
      expect(args.take).toBe(100);
      expect(args.skip).toBe(100); // (page-1) * safeLimit = 1 * 100
    });
  });

  // -------------------------------------------------------------------------
  // getSalesComparisonReport — per-staff sums, overdueRate, sort (289-311)
  // -------------------------------------------------------------------------
  describe('getSalesComparisonReport', () => {
    function make(contracts: unknown[]) {
      const findMany = jest.fn().mockResolvedValue(contracts);
      const prisma = { contract: { findMany } } as unknown as PrismaService;
      const svc = new ReportsService(prisma, {} as AccountingService);
      return { svc, findMany };
    }

    const contract = (
      salespersonId: string,
      name: string,
      branch: string,
      sellingPrice: number,
      status: string,
    ) => ({
      salespersonId,
      salesperson: { id: salespersonId, name },
      branch: { name: branch },
      sellingPrice: new Prisma.Decimal(sellingPrice),
      status,
    });

    it('overdueRate "33.3" for 1 of 3, sums totalSales, sorts highest totalSales first', async () => {
      const { svc } = make([
        // staff S1: 3 contracts, 1 OVERDUE -> overdueRate 33.3 ; totalSales 8000
        contract('S1', 'สมชาย', 'สาขา A', 3000, 'ACTIVE'),
        contract('S1', 'สมชาย', 'สาขา A', 2000, 'OVERDUE'),
        contract('S1', 'สมชาย', 'สาขา A', 3000, 'ACTIVE'),
        // staff S2: 2 contracts, 0 overdue -> overdueRate 0.0 ; totalSales 11000
        contract('S2', 'สมหญิง', 'สาขา B', 5000, 'ACTIVE'),
        contract('S2', 'สมหญิง', 'สาขา B', 6000, 'COMPLETED'),
      ]);

      const res = await svc.getSalesComparisonReport('2026-01-01', '2026-01-31');

      // sorted by totalSales desc -> S2 (11000) first, S1 (8000) second
      expect(res.data.map((d) => d.salespersonId)).toEqual(['S2', 'S1']);

      const s1 = res.data.find((d) => d.salespersonId === 'S1')!;
      expect(s1.totalContracts).toBe(3);
      expect(s1.overdueCount).toBe(1);
      expect(s1.overdueRate).toBe('33.3');
      expect(new Prisma.Decimal(s1.totalSales).toFixed(2)).toBe('8000.00');

      const s2 = res.data.find((d) => d.salespersonId === 'S2')!;
      expect(s2.totalContracts).toBe(2);
      expect(s2.overdueCount).toBe(0);
      expect(s2.overdueRate).toBe('0.0');
      expect(new Prisma.Decimal(s2.totalSales).toFixed(2)).toBe('11000.00');

      expect(res.total).toBe(2);
    });

    it('DEFAULT also counts toward overdueCount; combined totalSales is Decimal-summed', async () => {
      const { svc } = make([
        contract('S3', 'ก', 'สาขา C', 1000, 'DEFAULT'),
        contract('S3', 'ก', 'สาขา C', 1000, 'ACTIVE'),
      ]);
      const res = await svc.getSalesComparisonReport('2026-01-01', '2026-01-31');
      const s3 = res.data[0];
      expect(s3.overdueCount).toBe(1);
      expect(s3.overdueRate).toBe('50.0');
      expect(new Prisma.Decimal(s3.totalSales).toFixed(2)).toBe('2000.00');
    });

    it('empty contract set -> empty data and total 0', async () => {
      const { svc } = make([]);
      const res = await svc.getSalesComparisonReport('2026-01-01', '2026-01-31');
      expect(res.data).toEqual([]);
      expect(res.total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getDailyPaymentSummary — totalAmount round, byMethod/byBranch, null->'CASH' (434-472)
  // -------------------------------------------------------------------------
  describe('getDailyPaymentSummary', () => {
    function make(
      payments: unknown[],
      total: number,
      aggregateSum: number | null,
    ) {
      const findMany = jest.fn().mockResolvedValue(payments);
      const count = jest.fn().mockResolvedValue(total);
      const aggregate = jest.fn().mockResolvedValue({
        _sum: { amountPaid: aggregateSum === null ? null : new Prisma.Decimal(aggregateSum) },
      });
      const prisma = {
        payment: { findMany, count, aggregate },
      } as unknown as PrismaService;
      const svc = new ReportsService(prisma, {} as AccountingService);
      return { svc, findMany, count, aggregate };
    }

    const payment = (
      id: string,
      method: string | null,
      branch: string,
      amountPaid: number,
    ) => ({
      id,
      paymentMethod: method,
      installmentNo: 1,
      amountPaid: new Prisma.Decimal(amountPaid),
      paidDate: new Date('2026-03-10T09:00:00Z'),
      recordedBy: { name: 'แอดมิน' },
      contract: {
        contractNumber: `BC-${id}`,
        customer: { name: `ลูกค้า ${id}` },
        branch: { name: branch },
      },
    });

    it('totalAmount = Math.round(Σ aggregate); byMethod/byBranch derived from the page', async () => {
      const payments = [
        payment('1', 'CASH', 'สาขา A', 1000),
        payment('2', 'TRANSFER', 'สาขา A', 2000),
        payment('3', 'CASH', 'สาขา B', 1500),
      ];
      // aggregate sum is computed across ALL matching rows (not just page) -> use a
      // fractional sum to prove Math.round on totalAmount.
      const { svc } = make(payments, 3, 4500.4);

      const res = await svc.getDailyPaymentSummary('2026-03-10');

      expect(res.totalAmount).toBe(4500); // Math.round(4500.4)
      expect(res.totalPayments).toBe(3);

      // byMethod: CASH = 2 rows / 2500, TRANSFER = 1 row / 2000
      expect(res.byMethod.CASH.count).toBe(2);
      expect(new Prisma.Decimal(res.byMethod.CASH.total).toFixed(2)).toBe('2500.00');
      expect(res.byMethod.TRANSFER.count).toBe(1);
      expect(new Prisma.Decimal(res.byMethod.TRANSFER.total).toFixed(2)).toBe('2000.00');

      // byBranch: สาขา A = 2 / 3000, สาขา B = 1 / 1500
      expect(res.byBranch['สาขา A'].count).toBe(2);
      expect(new Prisma.Decimal(res.byBranch['สาขา A'].total).toFixed(2)).toBe('3000.00');
      expect(res.byBranch['สาขา B'].count).toBe(1);
      expect(new Prisma.Decimal(res.byBranch['สาขา B'].total).toFixed(2)).toBe('1500.00');
    });

    it('null paymentMethod buckets into "CASH"', async () => {
      const { svc } = make([payment('9', null, 'สาขา A', 700)], 1, 700);
      const res = await svc.getDailyPaymentSummary('2026-03-10');

      expect(res.byMethod.CASH.count).toBe(1);
      expect(new Prisma.Decimal(res.byMethod.CASH.total).toFixed(2)).toBe('700.00');
      // but the row's own `method` field is left as the raw null (only the bucket key coalesces)
      expect(res.data[0].method).toBeNull();
    });

    it('null aggregate sum -> totalAmount 0; empty page -> empty byMethod/byBranch', async () => {
      const { svc } = make([], 0, null);
      const res = await svc.getDailyPaymentSummary('2026-03-10');
      expect(res.totalAmount).toBe(0);
      expect(res.byMethod).toEqual({});
      expect(res.byBranch).toEqual({});
      expect(res.data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getBranchComparisonReport — payments-by-branch reduce + empty-group zeros (346-392)
  // -------------------------------------------------------------------------
  describe('getBranchComparisonReport', () => {
    it('two contracts in one branch sum paymentsReceived to 3000; empty groups -> 0', async () => {
      const branches = [
        { id: 'b1', name: 'สาขา A' },
        { id: 'b2', name: 'สาขา B' },
      ];
      const branchFindMany = jest.fn().mockResolvedValue(branches);

      const contractGroupBy = jest
        .fn()
        // newByBranch
        .mockResolvedValueOnce([{ branchId: 'b1', _count: 5 }])
        // activeByBranch
        .mockResolvedValueOnce([{ branchId: 'b1', _count: 3 }])
        // overdueByBranch
        .mockResolvedValueOnce([{ branchId: 'b1', _count: 1 }]);

      // paymentsByBranch: two contracts c1+c2 both under branch b1, paying 1000 + 2000
      const paymentGroupBy = jest.fn().mockResolvedValue([
        { contractId: 'c1', _sum: { amountPaid: new Prisma.Decimal(1000) } },
        { contractId: 'c2', _sum: { amountPaid: new Prisma.Decimal(2000) } },
      ]);
      const contractFindMany = jest.fn().mockResolvedValue([
        { id: 'c1', branchId: 'b1' },
        { id: 'c2', branchId: 'b1' },
      ]);
      const productGroupBy = jest
        .fn()
        .mockResolvedValue([{ branchId: 'b1', _count: 7 }]);

      const prisma = {
        branch: { findMany: branchFindMany },
        contract: { groupBy: contractGroupBy, findMany: contractFindMany },
        payment: { groupBy: paymentGroupBy },
        product: { groupBy: productGroupBy },
      } as unknown as PrismaService;

      const svc = new ReportsService(prisma, {} as AccountingService);
      const res = await svc.getBranchComparisonReport('2026-01-01', '2026-01-31');

      const b1 = res.find((r) => r.branchId === 'b1')!;
      expect(b1.newContracts).toBe(5);
      expect(b1.activeContracts).toBe(3);
      expect(b1.overdueContracts).toBe(1);
      expect(b1.paymentsReceived).toBe(3000); // 1000 + 2000 reduced into branch b1
      expect(b1.inStockProducts).toBe(7);

      // b2 had no rows in any group -> every metric defaults to 0
      const b2 = res.find((r) => r.branchId === 'b2')!;
      expect(b2).toEqual({
        branchId: 'b2',
        branchName: 'สาขา B',
        newContracts: 0,
        activeContracts: 0,
        overdueContracts: 0,
        paymentsReceived: 0,
        inStockProducts: 0,
      });
    });

    it('no payment groups -> paymentsReceived stays 0 and the contract lookup is skipped', async () => {
      const branches = [{ id: 'b1', name: 'สาขา A' }];
      const branchFindMany = jest.fn().mockResolvedValue(branches);
      const contractGroupBy = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const paymentGroupBy = jest.fn().mockResolvedValue([]); // empty -> early return new Map()
      const contractFindMany = jest.fn();
      const productGroupBy = jest.fn().mockResolvedValue([]);

      const prisma = {
        branch: { findMany: branchFindMany },
        contract: { groupBy: contractGroupBy, findMany: contractFindMany },
        payment: { groupBy: paymentGroupBy },
        product: { groupBy: productGroupBy },
      } as unknown as PrismaService;

      const svc = new ReportsService(prisma, {} as AccountingService);
      const res = await svc.getBranchComparisonReport('2026-01-01', '2026-01-31');

      expect(res[0].paymentsReceived).toBe(0);
      // groups.length === 0 short-circuits before fetching the contract->branch map
      expect(contractFindMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // resolveCompanyBranches (22-31)
  // -------------------------------------------------------------------------
  describe('resolveCompanyBranches', () => {
    function make(branchRows: Array<{ id: string }>) {
      const findMany = jest.fn().mockResolvedValue(branchRows);
      const prisma = { branch: { findMany } } as unknown as PrismaService;
      const svc = new ReportsService(prisma, {} as AccountingService);
      return { svc, findMany };
    }

    it('branchId supplied -> [branchId], no DB hit', async () => {
      const { svc, findMany } = make([]);
      await expect(svc.resolveCompanyBranches('co-1', 'branch-7')).resolves.toEqual(['branch-7']);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('companyId with branches -> those branch ids', async () => {
      const { svc, findMany } = make([{ id: 'b1' }, { id: 'b2' }]);
      await expect(svc.resolveCompanyBranches('co-shop')).resolves.toEqual(['b1', 'b2']);
      expect(findMany).toHaveBeenCalledWith({
        where: { companyId: 'co-shop', deletedAt: null },
        select: { id: true },
      });
    });

    it('companyId with zero branches (FINANCE) -> [] (signals "no data")', async () => {
      const { svc } = make([]);
      await expect(svc.resolveCompanyBranches('co-finance')).resolves.toEqual([]);
    });

    it('neither companyId nor branchId -> undefined (no filter)', async () => {
      const { svc, findMany } = make([]);
      await expect(svc.resolveCompanyBranches(undefined, undefined)).resolves.toBeUndefined();
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getQuarterlyReport — quarter -> date window + BadRequest guard (926-941)
  // -------------------------------------------------------------------------
  describe('getQuarterlyReport', () => {
    function make() {
      const getProfitLossReport = jest.fn().mockResolvedValue({ ok: true });
      const accounting = { getProfitLossReport } as unknown as AccountingService;
      const svc = new ReportsService({} as PrismaService, accounting);
      return { svc, getProfitLossReport };
    }

    // QUIRK: endDate = new Date(year, endMonth, 0).toISOString().split('T')[0].
    // `new Date(y, m, 0)` is LOCAL midnight of the quarter's last day; .toISOString()
    // converts to UTC. On the Bangkok (UTC+7, production) TZ this rolls back 7h to the
    // PREVIOUS calendar day, so the recognized endDate is the SECOND-to-last day of the
    // quarter (Q1 -> 03-30 not 03-31). The startDate is a literal template string with no
    // Date round-trip, so it is exact. Goldens below pin the ACTUAL (UTC+7) behaviour.
    it('Q1 2026 -> start 2026-01-01, end 2026-03-30 (TZ-shifted, see quirk)', async () => {
      const { svc, getProfitLossReport } = make();
      await svc.getQuarterlyReport(2026, 1);
      const [start, end] = getProfitLossReport.mock.calls[0];
      expect(start).toBe('2026-01-01');
      expect(end).toBe('2026-03-30');
    });

    it('Q4 2026 -> start 2026-10-01, end 2026-12-30 (TZ-shifted, see quirk)', async () => {
      const { svc, getProfitLossReport } = make();
      await svc.getQuarterlyReport(2026, 4);
      const [start, end] = getProfitLossReport.mock.calls[0];
      expect(start).toBe('2026-10-01');
      expect(end).toBe('2026-12-30');
    });

    it('delegates branch args + includeFinanceExpenses through to AccountingService', async () => {
      const { svc, getProfitLossReport } = make();
      await svc.getQuarterlyReport(2026, 2, 'branch-3', ['branch-3', 'branch-4'], true);
      expect(getProfitLossReport).toHaveBeenCalledWith(
        '2026-04-01',
        '2026-06-29', // Q2 last day 06-30 shifted back to 06-29 under UTC+7
        'branch-3',
        ['branch-3', 'branch-4'],
        true,
      );
    });

    it('quarter 0 -> BadRequestException (no delegation)', async () => {
      const { svc, getProfitLossReport } = make();
      await expect(svc.getQuarterlyReport(2026, 0)).rejects.toBeInstanceOf(BadRequestException);
      expect(getProfitLossReport).not.toHaveBeenCalled();
    });

    it('quarter 5 -> BadRequestException', async () => {
      const { svc } = make();
      await expect(svc.getQuarterlyReport(2026, 5)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
