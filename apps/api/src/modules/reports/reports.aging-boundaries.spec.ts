import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ReportsService } from './reports.service';

/**
 * Characterization (golden) tests — Wave 3 gap-fill (audit HIGH gap).
 *
 * The repo's TWO aging implementations have DIFFERENT bucket semantics, and the
 * existing specs (reports.service.aging.spec.ts, reports.service.portfolio.spec.ts)
 * only use mid-bucket / year-2099 dates, so the bucket EDGES are never exercised.
 * This file pins the exact day-diff boundary behaviour of both impls by setting
 * dueDate so `floor((now - dueDate) / 86400000)` lands precisely on each edge.
 *
 * Both impls floor whole days the same way; the cushion `- HALF_DAY` keeps the
 * floor on the intended integer regardless of the hour the suite runs (the
 * service builds `now = new Date()` internally, so dueDate is relative to NOW).
 *
 * Branches this file LOCKS:
 *
 *  A. getFinancePortfolio aging loop (reports.service.ts ~863-914) — HAS a
 *     'current' bucket, ALL edges use `<=`:
 *        diff  0 -> current      (diffDays <= 0)
 *        diff  1 -> days1to30
 *        diff 30 -> days1to30    (<= 30 inclusive)
 *        diff 31 -> days31to60
 *        diff 60 -> days31to60   (<= 60 inclusive)
 *        diff 61 -> days61to90
 *        diff 90 -> days61to90   (<= 90 inclusive)
 *        diff 91 -> over90       (else)
 *     QUIRK (locked, not fixed): a `status === 'PAID'` installment that is ALSO
 *     past its dueDate is `continue`d BEFORE bucketing — so it contributes to
 *     NONE of the 5 aging buckets, yet it has ALREADY been added to BOTH
 *     sumReceivable AND sumCollected (lines 867-868, above the skip on 871).
 *     A negative diff (future dueDate) also lands in `current` via `<= 0`.
 *
 *  B. getAgingReport bucket loop (reports.service.ts ~59-86) — NO 'current'
 *     bucket; a 0-day row falls into '1-30'. All edges use `<=`:
 *        days  0 -> '1-30'       (days <= 30)
 *        days 30 -> '1-30'
 *        days 31 -> '31-60'
 *        days 60 -> '31-60'
 *        days 61 -> '61-90'
 *        days 90 -> '61-90'
 *        days 91 -> '90+'        (else)
 *
 * Mock-only — no DB, no vitest. PrismaService is a hand-mocked stub exposing only
 * the methods each method touches. Money is Prisma.Decimal in production, so all
 * amount fields are passed as real Prisma.Decimal and assertions compare via
 * Prisma.Decimal(...).toString() per the harness rules.
 */

const DAY = 24 * 60 * 60 * 1000;
const HALF_DAY = 12 * 60 * 60 * 1000;

/**
 * dueDate that floors to exactly `diff` whole days behind NOW.
 *   floor((now - dueDate) / DAY) === diff
 * The `- HALF_DAY` keeps the floor on `diff` (never `diff - 1`) for diff >= 0.
 * For diff < 0 (future dueDate) the +HALF_DAY analog isn't needed — a plain
 * future offset already floors negative; we pass the exact ms below.
 */
const dueAtDiff = (diff: number) => new Date(Date.now() - diff * DAY - HALF_DAY);

// =============================================================================
// A. getFinancePortfolio — 'current' + 4 overdue buckets, '<=' on every edge
// =============================================================================
describe('getFinancePortfolio aging boundaries (characterization)', () => {
  const financeCompany = { id: 'co-finance', companyCode: 'FINANCE' };

  /** allContracts (summary) payment shape: only the 4 selected fields. */
  const summaryPayment = (
    diff: number,
    amountDue: number,
    amountPaid: number,
    status: string,
  ) => ({
    amountDue: new Prisma.Decimal(amountDue),
    amountPaid: new Prisma.Decimal(amountPaid),
    dueDate: dueAtDiff(diff),
    status,
  });

  /** Build a service whose 2nd contract.findMany returns `allContracts`. */
  function makeService(allContracts: Array<{ payments: ReturnType<typeof summaryPayment>[] }>) {
    const findManyContract = jest
      .fn()
      // 1st call: the paginated `data` page — irrelevant to aging, return []
      .mockResolvedValueOnce([])
      // 2nd call: allContracts (drives summary + aging)
      .mockResolvedValueOnce(allContracts);

    const prisma = {
      companyInfo: { findFirst: jest.fn().mockResolvedValue(financeCompany) },
      contract: {
        findMany: findManyContract,
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService;

    return new ReportsService(prisma, {} as AccountingService);
  }

  /** One contract wrapping the given payments. */
  const contractWith = (payments: ReturnType<typeof summaryPayment>[]) => ({ payments });

  it('diff 0 -> current; diff -2 (future dueDate) -> current via <= 0', async () => {
    const svc = makeService([
      contractWith([
        summaryPayment(0, 1000, 0, 'PENDING'),
        // future dueDate: floor((now - future)/DAY) is negative -> still current
        { amountDue: new Prisma.Decimal(500), amountPaid: new Prisma.Decimal(0), dueDate: new Date(Date.now() + 2 * DAY), status: 'PENDING' },
      ]),
    ]);

    const res = await svc.getFinancePortfolio();
    expect(res.aging.current.count).toBe(2);
    // outstanding: (1000-0) + (500-0) = 1500
    expect(new Prisma.Decimal(res.aging.current.amount).toString()).toBe('1500');
    expect(res.aging.days1to30.count).toBe(0);
  });

  it('diff 1 and diff 30 both -> days1to30 (lower edge 1, upper edge 30 inclusive)', async () => {
    const svc = makeService([
      contractWith([
        summaryPayment(1, 100, 0, 'PENDING'),
        summaryPayment(30, 200, 0, 'OVERDUE'),
      ]),
    ]);

    const res = await svc.getFinancePortfolio();
    expect(res.aging.current.count).toBe(0);
    expect(res.aging.days1to30.count).toBe(2);
    expect(new Prisma.Decimal(res.aging.days1to30.amount).toString()).toBe('300');
    expect(res.aging.days31to60.count).toBe(0);
  });

  it('diff 31 -> days31to60 (just over the 30 edge)', async () => {
    const svc = makeService([contractWith([summaryPayment(31, 400, 100, 'OVERDUE')])]);

    const res = await svc.getFinancePortfolio();
    expect(res.aging.days1to30.count).toBe(0);
    expect(res.aging.days31to60.count).toBe(1);
    // outstanding 400-100 = 300
    expect(new Prisma.Decimal(res.aging.days31to60.amount).toString()).toBe('300');
  });

  it('diff 60 -> days31to60 (upper edge inclusive); diff 61 -> days61to90', async () => {
    const svc = makeService([
      contractWith([
        summaryPayment(60, 500, 0, 'OVERDUE'),
        summaryPayment(61, 700, 0, 'OVERDUE'),
      ]),
    ]);

    const res = await svc.getFinancePortfolio();
    expect(res.aging.days31to60.count).toBe(1);
    expect(new Prisma.Decimal(res.aging.days31to60.amount).toString()).toBe('500');
    expect(res.aging.days61to90.count).toBe(1);
    expect(new Prisma.Decimal(res.aging.days61to90.amount).toString()).toBe('700');
  });

  it('diff 90 -> days61to90 (upper edge inclusive); diff 91 -> over90', async () => {
    const svc = makeService([
      contractWith([
        summaryPayment(90, 800, 0, 'OVERDUE'),
        summaryPayment(91, 900, 0, 'DEFAULT'),
      ]),
    ]);

    const res = await svc.getFinancePortfolio();
    expect(res.aging.days61to90.count).toBe(1);
    expect(new Prisma.Decimal(res.aging.days61to90.amount).toString()).toBe('800');
    expect(res.aging.over90.count).toBe(1);
    expect(new Prisma.Decimal(res.aging.over90.amount).toString()).toBe('900');
  });

  it('QUIRK: a PAID-but-overdue installment is skipped from ALL buckets yet still adds to sumReceivable AND sumCollected', async () => {
    // diff 45 (would be days31to60) but status PAID -> `continue` before bucketing.
    const svc = makeService([
      contractWith([
        summaryPayment(45, 1000, 1000, 'PAID'), // fully paid, overdue -> skipped from buckets
        summaryPayment(45, 2000, 500, 'OVERDUE'), // bucketed in days31to60
      ]),
    ]);

    const res = await svc.getFinancePortfolio();

    // Buckets see ONLY the OVERDUE row: outstanding 2000-500 = 1500
    expect(res.aging.current.count).toBe(0);
    expect(res.aging.days1to30.count).toBe(0);
    expect(res.aging.days31to60.count).toBe(1);
    expect(new Prisma.Decimal(res.aging.days31to60.amount).toString()).toBe('1500');
    expect(res.aging.days61to90.count).toBe(0);
    expect(res.aging.over90.count).toBe(0);

    // ...but sums INCLUDE the skipped PAID row:
    // receivable = 1000 + 2000 = 3000 ; collected = 1000 + 500 = 1500
    expect(new Prisma.Decimal(res.summary.totalReceivable).toString()).toBe('3000');
    expect(new Prisma.Decimal(res.summary.totalCollected).toString()).toBe('1500');
    expect(new Prisma.Decimal(res.summary.totalOutstanding).toString()).toBe('1500');
  });
});

// =============================================================================
// B. getAgingReport — NO 'current' bucket; 0-day row falls into '1-30'
// =============================================================================
describe('getAgingReport bucket boundaries (characterization)', () => {
  const mkPayment = (diff: number, amountDue: number, amountPaid: number, lateFee: number) => ({
    id: `p${diff}`,
    dueDate: dueAtDiff(diff),
    amountDue: new Prisma.Decimal(amountDue),
    amountPaid: new Prisma.Decimal(amountPaid),
    lateFee: new Prisma.Decimal(lateFee),
    contract: {
      contractNumber: `BC-${diff}`,
      customer: { name: 'ลูกค้า', phone: '0800000000' },
      branch: { name: 'สาขาทดสอบ' },
    },
  });

  function makeService(payments: ReturnType<typeof mkPayment>[]) {
    const prisma = {
      payment: { findMany: jest.fn().mockResolvedValue(payments) },
    } as unknown as PrismaService;
    return new ReportsService(prisma, {} as AccountingService);
  }

  it("days 0 and days 30 both -> '1-30' (no 'current' bucket; upper edge inclusive)", async () => {
    const svc = makeService([
      mkPayment(0, 1000, 0, 10),
      mkPayment(30, 2000, 500, 20),
    ]);

    const report = await svc.getAgingReport();
    expect(report['1-30'].count).toBe(2);
    // outstanding (1000-0) + (2000-500) = 1000 + 1500 = 2500
    expect(new Prisma.Decimal(report['1-30'].totalOutstanding).toString()).toBe('2500');
    // lateFees 10 + 20 = 30
    expect(new Prisma.Decimal(report['1-30'].totalLateFees).toString()).toBe('30');
    expect(report['31-60'].count).toBe(0);
  });

  it("days 31 -> '31-60'; days 60 -> '31-60' (upper edge inclusive)", async () => {
    const svc = makeService([
      mkPayment(31, 400, 0, 5),
      mkPayment(60, 600, 100, 7),
    ]);

    const report = await svc.getAgingReport();
    expect(report['1-30'].count).toBe(0);
    expect(report['31-60'].count).toBe(2);
    // (400-0) + (600-100) = 400 + 500 = 900
    expect(new Prisma.Decimal(report['31-60'].totalOutstanding).toString()).toBe('900');
    expect(new Prisma.Decimal(report['31-60'].totalLateFees).toString()).toBe('12');
    expect(report['61-90'].count).toBe(0);
  });

  it("days 61 -> '61-90'; days 90 -> '61-90' (upper edge inclusive)", async () => {
    const svc = makeService([
      mkPayment(61, 800, 0, 3),
      mkPayment(90, 1200, 200, 4),
    ]);

    const report = await svc.getAgingReport();
    expect(report['31-60'].count).toBe(0);
    expect(report['61-90'].count).toBe(2);
    // (800-0) + (1200-200) = 800 + 1000 = 1800
    expect(new Prisma.Decimal(report['61-90'].totalOutstanding).toString()).toBe('1800');
    expect(new Prisma.Decimal(report['61-90'].totalLateFees).toString()).toBe('7');
    expect(report['90+'].count).toBe(0);
  });

  it("days 91 -> '90+' (just over the 90 edge → else branch)", async () => {
    const svc = makeService([mkPayment(91, 5000, 1000, 500)]);

    const report = await svc.getAgingReport();
    expect(report['61-90'].count).toBe(0);
    expect(report['90+'].count).toBe(1);
    // 5000 - 1000 = 4000
    expect(new Prisma.Decimal(report['90+'].totalOutstanding).toString()).toBe('4000');
    expect(new Prisma.Decimal(report['90+'].totalLateFees).toString()).toBe('500');
  });

  it('total row sums every bucket regardless of edge placement', async () => {
    const svc = makeService([
      mkPayment(0, 1000, 0, 10), // 1-30
      mkPayment(30, 2000, 0, 20), // 1-30
      mkPayment(31, 400, 0, 5), // 31-60
      mkPayment(61, 800, 0, 3), // 61-90
      mkPayment(91, 5000, 0, 500), // 90+
    ]);

    const report = await svc.getAgingReport();
    expect(report.total.count).toBe(5);
    // 1000 + 2000 + 400 + 800 + 5000 = 9200
    expect(new Prisma.Decimal(report.total.totalOutstanding).toString()).toBe('9200');
    // 10 + 20 + 5 + 3 + 500 = 538
    expect(new Prisma.Decimal(report.total.totalLateFees).toString()).toBe('538');
  });
});
