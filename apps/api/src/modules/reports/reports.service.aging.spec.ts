import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';

/**
 * Characterization (golden) test for ReportsService.getAgingReport.
 *
 * Locks the in-JS aging-bucket aggregation: overdue payments are sorted into
 * 1-30 / 31-60 / 61-90 / 90+ day buckets by `calculateDaysElapsed(dueDate, now)`
 * (= floor((now - dueDate)/day)), and each bucket's `count`, `totalOutstanding`
 * (Σ amountDue − amountPaid) and `totalLateFees` (Σ lateFee) are computed with
 * Prisma.Decimal arithmetic.
 *
 * Mock-only: prisma.payment.findMany returns a fixed dataset. No real DB.
 * Due dates are derived from the wall clock at call time (the service builds
 * `now = new Date()` internally) minus exact day multiples plus a 12h cushion
 * so the floor lands deterministically inside the intended bucket regardless of
 * the hour the test runs.
 */
describe('ReportsService.getAgingReport (characterization)', () => {
  let service: ReportsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const DAY = 24 * 60 * 60 * 1000;
  const HALF_DAY = 12 * 60 * 60 * 1000;

  // dueDate `days` whole days in the past, +12h cushion below the boundary so
  // floor((now - dueDate)/day) === days reliably (never `days - 1`).
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY - HALF_DAY);

  const mkPayment = (
    id: string,
    days: number,
    amountDue: number,
    amountPaid: number,
    lateFee: number,
  ) => ({
    id,
    dueDate: daysAgo(days),
    amountDue: new Prisma.Decimal(amountDue),
    amountPaid: new Prisma.Decimal(amountPaid),
    lateFee: new Prisma.Decimal(lateFee),
    contract: {
      contractNumber: `BC-${id}`,
      customer: { name: `ลูกค้า ${id}`, phone: '0800000000' },
      branch: { name: 'สาขาทดสอบ' },
    },
  });

  // Fixed dataset spanning every bucket:
  //  A,B → 1-30   | C → 31-60 | D → 61-90 | E → 90+
  const overduePayments = [
    mkPayment('A', 15, 1000, 200, 50),   // outstanding 800,  lateFee 50
    mkPayment('B', 25, 2000, 0, 100),    // outstanding 2000, lateFee 100
    mkPayment('C', 45, 1500, 500, 75),   // outstanding 1000, lateFee 75
    mkPayment('D', 75, 3000, 1000, 200), // outstanding 2000, lateFee 200
    mkPayment('E', 120, 5000, 0, 500),   // outstanding 5000, lateFee 500
  ];

  beforeEach(async () => {
    prisma = {
      payment: {
        findMany: jest.fn().mockResolvedValue(overduePayments),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccountingService, useValue: {} },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('buckets the 1-30 day group: count 2, outstanding 2800, late fees 150', async () => {
    const report = await service.getAgingReport();

    // A (15d) + B (25d) → both in 1-30
    expect(report['1-30'].count).toBe(2);
    // (1000-200) + (2000-0) = 800 + 2000 = 2800
    expect(new Prisma.Decimal(report['1-30'].totalOutstanding).toFixed(2)).toBe('2800.00');
    // 50 + 100 = 150
    expect(new Prisma.Decimal(report['1-30'].totalLateFees).toFixed(2)).toBe('150.00');
  });

  it('buckets 31-60 (C), 61-90 (D), and 90+ (E) each with one payment', async () => {
    const report = await service.getAgingReport();

    expect(report['31-60'].count).toBe(1);
    // 1500 - 500 = 1000
    expect(new Prisma.Decimal(report['31-60'].totalOutstanding).toFixed(2)).toBe('1000.00');
    expect(new Prisma.Decimal(report['31-60'].totalLateFees).toFixed(2)).toBe('75.00');

    expect(report['61-90'].count).toBe(1);
    // 3000 - 1000 = 2000
    expect(new Prisma.Decimal(report['61-90'].totalOutstanding).toFixed(2)).toBe('2000.00');
    expect(new Prisma.Decimal(report['61-90'].totalLateFees).toFixed(2)).toBe('200.00');

    expect(report['90+'].count).toBe(1);
    // 5000 - 0 = 5000
    expect(new Prisma.Decimal(report['90+'].totalOutstanding).toFixed(2)).toBe('5000.00');
    expect(new Prisma.Decimal(report['90+'].totalLateFees).toFixed(2)).toBe('500.00');
  });

  it('total row sums every payment: count 5, outstanding 10800, late fees 925', async () => {
    const report = await service.getAgingReport();

    expect(report.total.count).toBe(5);
    // 800 + 2000 + 1000 + 2000 + 5000 = 10800
    expect(new Prisma.Decimal(report.total.totalOutstanding).toFixed(2)).toBe('10800.00');
    // 50 + 100 + 75 + 200 + 500 = 925
    expect(new Prisma.Decimal(report.total.totalLateFees).toFixed(2)).toBe('925.00');
  });

  it('filters by branch via the contract relation when branchId is supplied', async () => {
    await service.getAgingReport('branch-42');
    const where = prisma.payment.findMany.mock.calls[0][0].where;
    // branch filter is applied through the contract relation, not a flat branchId
    expect(where.contract).toEqual({ branchId: 'branch-42', deletedAt: null });
    // only still-owed installment statuses are pulled into the aging report
    expect(where.status).toEqual({ in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] });
  });
});
