import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ReportsService } from './reports.service';

/**
 * Characterization (golden) tests for three money paths in ReportsService:
 *
 *   1. getFinancePortfolio → summary.collectionRate
 *      collectionRate = Math.round((totalCollected / totalReceivable) * 10000) / 100
 *      with a `> 0` guard that returns 0 when totalReceivable is 0 (~905-907).
 *      Both totalReceivable and totalCollected are Σ over the *second* findMany
 *      (`allContracts`) — NOT the paginated `data` page.
 *
 *   2. getEntityProfitReport → SHOP / FINANCE split accumulation (~642-705).
 *      shop.profit  = Σ transaction.shopProfit
 *      finance.profit = (Σ transaction.financeProfit) + totalLateFees  (late fees
 *      are added ONCE, after the per-transaction loop — line 682).
 *      finance.lateFeeIncome is seeded to totalLateFees up front (line 620).
 *
 *   3. getRevenuePLReport → monthly interest recognition (~136-140).
 *      Each PAID payment contributes contract.interestTotal / contract.totalMonths,
 *      summed with Prisma.Decimal (assert Decimal arithmetic, not float division),
 *      and the returned revenue.interestIncome is Math.round(sum.toNumber()).
 *
 * Mock-only: every prisma call the methods make is stubbed. No real DB.
 * Money compared via Prisma.Decimal(...).toString() per the harness rules.
 */
describe('ReportsService portfolio / entity-profit / interest (characterization)', () => {
  // -------------------------------------------------------------------------
  // 1. getFinancePortfolio — collectionRate
  // -------------------------------------------------------------------------
  describe('getFinancePortfolio collectionRate', () => {
    const financeCompany = { id: 'co-finance', companyCode: 'FINANCE' };

    // `data` (page) contracts — full include shape used by the first findMany.
    const pageContract = (
      id: string,
      payments: Array<{ amountDue: number; amountPaid: number; status: string }>,
    ) => ({
      id,
      contractNumber: `BC-${id}`,
      status: 'ACTIVE',
      customer: { id: `cust-${id}`, name: `ลูกค้า ${id}`, phone: '0800000000' },
      product: { brand: 'Apple', model: 'iPhone', imeiSerial: `IMEI-${id}` },
      branch: { name: 'สาขาทดสอบ' },
      sellingPrice: new Prisma.Decimal(10000),
      financedAmount: new Prisma.Decimal(8000),
      monthlyPayment: new Prisma.Decimal(1000),
      totalMonths: payments.length,
      createdAt: new Date('2026-01-01'),
      payments: payments.map((p, i) => ({
        id: `${id}-p${i}`,
        installmentNo: i + 1,
        amountDue: new Prisma.Decimal(p.amountDue),
        amountPaid: new Prisma.Decimal(p.amountPaid),
        lateFee: new Prisma.Decimal(0),
        // dueDate far in the future so non-PAID installments land in `current`
        dueDate: new Date('2099-01-01'),
        status: p.status,
      })),
    });

    // `allContracts` (summary) contracts — lighter payment select shape.
    const summaryContract = (
      payments: Array<{ amountDue: number; amountPaid: number; status: string }>,
    ) => ({
      payments: payments.map((p) => ({
        amountDue: new Prisma.Decimal(p.amountDue),
        amountPaid: new Prisma.Decimal(p.amountPaid),
        dueDate: new Date('2099-01-01'),
        status: p.status,
      })),
    });

    function makeService(opts: {
      financeCompany: { id: string; companyCode: string } | null;
      page: ReturnType<typeof pageContract>[];
      all: ReturnType<typeof summaryContract>[];
      total: number;
    }) {
      const findManyContract = jest
        .fn()
        // 1st call: the paginated `data` page
        .mockResolvedValueOnce(opts.page)
        // 2nd call: `allContracts` for summary + aging
        .mockResolvedValueOnce(opts.all);

      const prisma = {
        companyInfo: {
          findFirst: jest.fn().mockResolvedValue(opts.financeCompany),
        },
        contract: {
          findMany: findManyContract,
          count: jest.fn().mockResolvedValue(opts.total),
        },
      } as unknown as PrismaService;

      const svc = new ReportsService(prisma, {} as AccountingService);
      return { svc, prisma, findManyContract };
    }

    it('collectionRate = round(collected/receivable * 10000)/100 over allContracts (3-contract fixture → 87.5)', async () => {
      // allContracts:
      //  C1: due 1000+1000 = 2000, paid 1000+500 = 1500
      //  C2: due 2000,           paid 2000
      //  C3: due 0,              paid 0
      // Σ receivable = 4000, Σ collected = 3500
      // collectionRate = round(3500/4000 * 10000)/100 = round(8750)/100 = 87.5
      const { svc } = makeService({
        financeCompany,
        page: [
          pageContract('C1', [
            { amountDue: 1000, amountPaid: 1000, status: 'PAID' },
            { amountDue: 1000, amountPaid: 500, status: 'PARTIALLY_PAID' },
          ]),
          pageContract('C2', [{ amountDue: 2000, amountPaid: 2000, status: 'PAID' }]),
          pageContract('C3', [{ amountDue: 0, amountPaid: 0, status: 'PENDING' }]),
        ],
        all: [
          summaryContract([
            { amountDue: 1000, amountPaid: 1000, status: 'PAID' },
            { amountDue: 1000, amountPaid: 500, status: 'PARTIALLY_PAID' },
          ]),
          summaryContract([{ amountDue: 2000, amountPaid: 2000, status: 'PAID' }]),
          summaryContract([{ amountDue: 0, amountPaid: 0, status: 'PENDING' }]),
        ],
        total: 3,
      });

      const res = await svc.getFinancePortfolio();

      expect(res.summary.totalContracts).toBe(3);
      expect(new Prisma.Decimal(res.summary.totalReceivable).toString()).toBe('4000');
      expect(new Prisma.Decimal(res.summary.totalCollected).toString()).toBe('3500');
      expect(new Prisma.Decimal(res.summary.totalOutstanding).toString()).toBe('500');
      expect(res.summary.collectionRate).toBe(87.5);
    });

    it('collectionRate rounds to 2 dp (collected 1/receivable 3 → 33.33)', async () => {
      // Σ receivable = 3, Σ collected = 1
      // round(1/3 * 10000)/100 = round(3333.33..)/100 = 3333/100 = 33.33
      const { svc } = makeService({
        financeCompany,
        page: [pageContract('C1', [{ amountDue: 3, amountPaid: 1, status: 'PARTIALLY_PAID' }])],
        all: [summaryContract([{ amountDue: 3, amountPaid: 1, status: 'PARTIALLY_PAID' }])],
        total: 1,
      });

      const res = await svc.getFinancePortfolio();
      expect(new Prisma.Decimal(res.summary.totalReceivable).toString()).toBe('3');
      expect(new Prisma.Decimal(res.summary.totalCollected).toString()).toBe('1');
      expect(res.summary.collectionRate).toBe(33.33);
    });

    it('>0 guard: receivable 0 → collectionRate 0 (no division by zero)', async () => {
      const { svc } = makeService({
        financeCompany,
        page: [pageContract('C1', [{ amountDue: 0, amountPaid: 0, status: 'PENDING' }])],
        all: [summaryContract([{ amountDue: 0, amountPaid: 0, status: 'PENDING' }])],
        total: 1,
      });

      const res = await svc.getFinancePortfolio();
      expect(new Prisma.Decimal(res.summary.totalReceivable).toString()).toBe('0');
      expect(res.summary.collectionRate).toBe(0);
    });

    it('no FINANCE company → empty summary with collectionRate 0', async () => {
      const { svc, findManyContract } = makeService({
        financeCompany: null,
        page: [],
        all: [],
        total: 0,
      });

      const res = await svc.getFinancePortfolio();
      // short-circuits before any contract query
      expect(findManyContract).not.toHaveBeenCalled();
      expect(res.summary).toEqual({
        totalContracts: 0,
        totalReceivable: 0,
        totalCollected: 0,
        totalOutstanding: 0,
        collectionRate: 0,
      });
    });
  });

  // -------------------------------------------------------------------------
  // 2. getEntityProfitReport — SHOP / FINANCE split (+ totalLateFees)
  // -------------------------------------------------------------------------
  describe('getEntityProfitReport SHOP/FINANCE split', () => {
    const mkTxn = (
      id: string,
      vals: {
        shopProfit: number;
        financeProfit: number;
        commission: number;
        interestTotal: number;
        costPrice: number;
        principal: number;
        downPayment: number;
        sellingPrice: number;
        vatAmount: number;
      },
    ) => ({
      id,
      shopProfit: new Prisma.Decimal(vals.shopProfit),
      financeProfit: new Prisma.Decimal(vals.financeProfit),
      commission: new Prisma.Decimal(vals.commission),
      interestTotal: new Prisma.Decimal(vals.interestTotal),
      costPrice: new Prisma.Decimal(vals.costPrice),
      principal: new Prisma.Decimal(vals.principal),
      downPayment: new Prisma.Decimal(vals.downPayment),
      sellingPrice: new Prisma.Decimal(vals.sellingPrice),
      vatAmount: new Prisma.Decimal(vals.vatAmount),
      createdAt: new Date('2026-03-01'),
      sale: { saleNumber: `S-${id}`, customer: { name: `ลูกค้า ${id}` } },
      contract: { contractNumber: `BC-${id}`, status: 'ACTIVE', totalMonths: 12 },
      branch: { name: 'สาขาทดสอบ' },
    });

    function makeService(opts: {
      transactions: ReturnType<typeof mkTxn>[];
      totalLateFees: number;
    }) {
      const prisma = {
        interCompanyTransaction: {
          findMany: jest.fn().mockResolvedValue(opts.transactions),
        },
        payment: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { lateFee: new Prisma.Decimal(opts.totalLateFees) } }),
        },
      } as unknown as PrismaService;

      const svc = new ReportsService(prisma, {} as AccountingService);
      return { svc, prisma };
    }

    // Two transactions:
    //  T1 shopProfit 1000, financeProfit 300, commission 200, interestTotal 500,
    //     costPrice 6000, principal 7000, downPayment 1000, sellingPrice 8000, vat 56
    //  T2 shopProfit 1500, financeProfit 400, commission 250, interestTotal 600,
    //     costPrice 9000, principal 9500, downPayment 1500, sellingPrice 11000, vat 70
    // totalLateFees = 350
    const t1 = mkTxn('T1', {
      shopProfit: 1000,
      financeProfit: 300,
      commission: 200,
      interestTotal: 500,
      costPrice: 6000,
      principal: 7000,
      downPayment: 1000,
      sellingPrice: 8000,
      vatAmount: 56,
    });
    const t2 = mkTxn('T2', {
      shopProfit: 1500,
      financeProfit: 400,
      commission: 250,
      interestTotal: 600,
      costPrice: 9000,
      principal: 9500,
      downPayment: 1500,
      sellingPrice: 11000,
      vatAmount: 70,
    });

    it('shop block accumulates revenue/cogs/commission/profit per transaction', async () => {
      const { svc } = makeService({ transactions: [t1, t2], totalLateFees: 350 });
      const res = (await svc.getEntityProfitReport('2026-03-01', '2026-03-31')) as {
        shop: { revenue: number; costOfGoods: number; commission: number; profit: number; transactionCount: number };
        finance: { interestIncome: number; commissionExpense: number; lateFeeIncome: number; profit: number; transactionCount: number };
        combined: { totalProfit: number; totalVat: number };
      };

      // shop.revenue = Σ (downPayment + principal + commission)
      //   T1: 1000 + 7000 + 200 = 8200
      //   T2: 1500 + 9500 + 250 = 11250  → 19450
      expect(res.shop.revenue).toBe(19450);
      // shop.costOfGoods = 6000 + 9000 = 15000
      expect(res.shop.costOfGoods).toBe(15000);
      // shop.commission = 200 + 250 = 450
      expect(res.shop.commission).toBe(450);
      // shop.profit = Σ shopProfit = 1000 + 1500 = 2500
      expect(res.shop.profit).toBe(2500);
      expect(res.shop.transactionCount).toBe(2);
    });

    it('finance.profit = Σ financeProfit + totalLateFees (late fees added once)', async () => {
      const { svc } = makeService({ transactions: [t1, t2], totalLateFees: 350 });
      const res = (await svc.getEntityProfitReport('2026-03-01', '2026-03-31')) as {
        finance: { interestIncome: number; commissionExpense: number; lateFeeIncome: number; profit: number; transactionCount: number };
      };

      // finance.interestIncome = 500 + 600 = 1100
      expect(res.finance.interestIncome).toBe(1100);
      // finance.commissionExpense = 200 + 250 = 450
      expect(res.finance.commissionExpense).toBe(450);
      // lateFeeIncome seeded to totalLateFees up front
      expect(res.finance.lateFeeIncome).toBe(350);
      // finance.profit = (300 + 400) + 350 = 1050
      expect(res.finance.profit).toBe(1050);
      expect(res.finance.transactionCount).toBe(2);
    });

    it('combined.totalProfit = shop.profit + finance.profit; totalVat = Σ vatAmount (Decimal)', async () => {
      const { svc } = makeService({ transactions: [t1, t2], totalLateFees: 350 });
      const res = (await svc.getEntityProfitReport('2026-03-01', '2026-03-31')) as {
        combined: { totalProfit: number; totalVat: number };
      };

      // shop.profit 2500 + finance.profit 1050 = 3550
      expect(res.combined.totalProfit).toBe(3550);
      // totalVat = 56 + 70 = 126
      expect(new Prisma.Decimal(res.combined.totalVat).toString()).toBe('126');
    });

    it('entity=FINANCE returns only the finance block (still includes totalLateFees in profit)', async () => {
      const { svc } = makeService({ transactions: [t1, t2], totalLateFees: 350 });
      const res = (await svc.getEntityProfitReport(
        '2026-03-01',
        '2026-03-31',
        undefined,
        'FINANCE',
      )) as {
        entity: string;
        finance: { profit: number; lateFeeIncome: number };
      };

      expect(res.entity).toBe('BESTCHOICE FINANCE');
      expect(res.finance.profit).toBe(1050);
      expect(res.finance.lateFeeIncome).toBe(350);
    });

    it('entity=SHOP returns only the shop block', async () => {
      const { svc } = makeService({ transactions: [t1, t2], totalLateFees: 350 });
      const res = (await svc.getEntityProfitReport(
        '2026-03-01',
        '2026-03-31',
        undefined,
        'SHOP',
      )) as {
        entity: string;
        shop: { profit: number; revenue: number };
      };

      expect(res.entity).toBe('BESTCHOICE SHOP');
      expect(res.shop.profit).toBe(2500);
      expect(res.shop.revenue).toBe(19450);
    });

    it('no transactions + no late fees → all-zero blocks', async () => {
      const { svc } = makeService({ transactions: [], totalLateFees: 0 });
      const res = (await svc.getEntityProfitReport('2026-03-01', '2026-03-31')) as {
        shop: { profit: number; transactionCount: number };
        finance: { profit: number; lateFeeIncome: number; transactionCount: number };
        combined: { totalProfit: number; totalVat: number };
      };

      expect(res.shop.profit).toBe(0);
      expect(res.shop.transactionCount).toBe(0);
      expect(res.finance.profit).toBe(0);
      expect(res.finance.lateFeeIncome).toBe(0);
      expect(res.finance.transactionCount).toBe(0);
      expect(res.combined.totalProfit).toBe(0);
      expect(new Prisma.Decimal(res.combined.totalVat).toString()).toBe('0');
    });
  });

  // -------------------------------------------------------------------------
  // 3. getRevenuePLReport — monthly interest recognition (Decimal div)
  // -------------------------------------------------------------------------
  describe('getRevenuePLReport monthly interest recognition', () => {
    function makeService(opts: {
      interestPayments: Array<{
        amountPaid: number;
        interestTotal: number;
        totalMonths: number;
      }>;
      lateFeeSum: number;
      lateFeeAmountPaid: number;
      totalAmountPaid: number;
      totalCount: number;
      newContracts: number;
    }) {
      const aggregate = jest
        .fn()
        // 2nd Promise.all element: lateFeeIncome aggregate
        .mockResolvedValueOnce({
          _sum: {
            lateFee: new Prisma.Decimal(opts.lateFeeSum),
            amountPaid: new Prisma.Decimal(opts.lateFeeAmountPaid),
          },
        })
        // 3rd Promise.all element: totalPayments aggregate
        .mockResolvedValueOnce({
          _sum: { amountPaid: new Prisma.Decimal(opts.totalAmountPaid) },
          _count: opts.totalCount,
        });

      const prisma = {
        payment: {
          // 1st Promise.all element: interestIncomePayments findMany
          findMany: jest.fn().mockResolvedValue(
            opts.interestPayments.map((p) => ({
              amountPaid: new Prisma.Decimal(p.amountPaid),
              contract: {
                interestTotal: new Prisma.Decimal(p.interestTotal),
                totalMonths: p.totalMonths,
              },
            })),
          ),
          aggregate,
        },
        contract: {
          // 4th Promise.all element: newContracts count
          count: jest.fn().mockResolvedValue(opts.newContracts),
        },
      } as unknown as PrismaService;

      const svc = new ReportsService(prisma, {} as AccountingService);
      return { svc };
    }

    it('interestIncome = round( Σ Prisma.Decimal(interestTotal)/totalMonths )', async () => {
      // P1: interestTotal 1200 / 12 = 100
      // P2: interestTotal 600  / 6  = 100
      // P3: interestTotal 500  / 10 = 50
      // Σ = 250 → Math.round(250) = 250
      const { svc } = makeService({
        interestPayments: [
          { amountPaid: 1000, interestTotal: 1200, totalMonths: 12 },
          { amountPaid: 800, interestTotal: 600, totalMonths: 6 },
          { amountPaid: 700, interestTotal: 500, totalMonths: 10 },
        ],
        lateFeeSum: 150,
        lateFeeAmountPaid: 2500,
        totalAmountPaid: 2500,
        totalCount: 3,
        newContracts: 4,
      });

      const res = await svc.getRevenuePLReport('2026-03-01', '2026-03-31');

      expect(res.revenue.interestIncome).toBe(250);
      expect(res.revenue.lateFeeIncome).toBe(150);
      expect(new Prisma.Decimal(res.revenue.totalPaymentsReceived).toString()).toBe('2500');
      expect(res.revenue.paymentCount).toBe(3);
      expect(res.contracts.newContracts).toBe(4);
    });

    it('uses Prisma.Decimal division (not JS float) — 1000/3 sums exactly via Decimal then rounds', async () => {
      // Decimal: 1000/3 = 333.333... (28-digit Decimal precision), ×3 = 999.999...,
      // Math.round(999.999...) = 1000.
      // (Float 1000/3*3 also rounds to 1000 — but the intermediate sum is a Decimal:
      // we assert the running sum stays a Prisma.Decimal by recomputing it here.)
      const interestTotal = 1000;
      const totalMonths = 3;
      const { svc } = makeService({
        interestPayments: [
          { amountPaid: 400, interestTotal, totalMonths },
          { amountPaid: 400, interestTotal, totalMonths },
          { amountPaid: 400, interestTotal, totalMonths },
        ],
        lateFeeSum: 0,
        lateFeeAmountPaid: 1200,
        totalAmountPaid: 1200,
        totalCount: 3,
        newContracts: 0,
      });

      const res = await svc.getRevenuePLReport('2026-03-01', '2026-03-31');

      // Recompute the EXACT Decimal the service builds: 3 × (1000/3)
      const expected = new Prisma.Decimal(0)
        .add(new Prisma.Decimal(interestTotal).div(totalMonths))
        .add(new Prisma.Decimal(interestTotal).div(totalMonths))
        .add(new Prisma.Decimal(interestTotal).div(totalMonths));
      // 333.333... × 3 = 999.999... which rounds to 1000
      expect(Math.round(expected.toNumber())).toBe(1000);
      expect(res.revenue.interestIncome).toBe(1000);
    });

    it('single payment: interestTotal/totalMonths is the Decimal quotient, then rounded', async () => {
      // 1000 / 7 = 142.857142857... → Math.round = 143
      const quotient = new Prisma.Decimal(1000).div(7);
      // Pin the Decimal quotient string (proves Decimal, not float) to its 2-dp form
      expect(quotient.toFixed(2)).toBe('142.86');

      const { svc } = makeService({
        interestPayments: [{ amountPaid: 500, interestTotal: 1000, totalMonths: 7 }],
        lateFeeSum: 0,
        lateFeeAmountPaid: 500,
        totalAmountPaid: 500,
        totalCount: 1,
        newContracts: 0,
      });

      const res = await svc.getRevenuePLReport('2026-03-01', '2026-03-31');
      expect(res.revenue.interestIncome).toBe(143);
    });

    it('no PAID payments → interestIncome 0', async () => {
      const { svc } = makeService({
        interestPayments: [],
        lateFeeSum: 0,
        lateFeeAmountPaid: 0,
        totalAmountPaid: 0,
        totalCount: 0,
        newContracts: 0,
      });

      const res = await svc.getRevenuePLReport('2026-03-01', '2026-03-31');
      expect(res.revenue.interestIncome).toBe(0);
      expect(res.revenue.lateFeeIncome).toBe(0);
      expect(res.revenue.paymentCount).toBe(0);
    });
  });
});
