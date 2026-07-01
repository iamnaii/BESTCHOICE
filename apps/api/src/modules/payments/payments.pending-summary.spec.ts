import { Prisma } from '@prisma/client';
import { PaymentQueryService } from './services/payment-query.service';

/**
 * getPendingSummary powers the 6 KPI cards on the redesigned รับชำระค่างวด page.
 * The figures feed straight into a collector's decisions + map to ledger codes,
 * so the Decimal math (esp. outstandingPrincipal = Σ amountDue − Σ amountPaid)
 * must be exact and never drift to IEEE-754 float.
 */
describe('PaymentQueryService — getPendingSummary', () => {
  /**
   * Build a service whose prisma.payment.aggregate routes by which _sum keys
   * the method requested (pending vs waived vs collected bucket), and whose
   * count answers the overdue-60 bucket. Captures the `where` of each call so
   * tests can assert the due-date window was applied.
   */
  function makeService(buckets: {
    pending?: { _count: number; _sum: { amountDue: unknown; amountPaid: unknown; lateFee: unknown } };
    waived?: { _sum: { waivedAmount: unknown } };
    collected?: { _count: number; _sum: { amountPaid: unknown } };
    overdue60?: number;
    pendingRows?: Array<{ dueDate: Date; amountDue: Prisma.Decimal; lateFeeWaived: boolean }>;
  }) {
    const D = (v: string) => new Prisma.Decimal(v);
    const calls: { pending?: any; waived?: any; collected?: any; overdue60?: any; pendingRows?: any } = {};

    const aggregate = jest.fn((args: any) => {
      const sum = args._sum ?? {};
      if (sum.amountDue) {
        calls.pending = args.where;
        return Promise.resolve(
          buckets.pending ?? { _count: 0, _sum: { amountDue: D('0'), amountPaid: D('0'), lateFee: D('0') } },
        );
      }
      if (sum.waivedAmount) {
        calls.waived = args.where;
        return Promise.resolve(buckets.waived ?? { _sum: { waivedAmount: D('0') } });
      }
      calls.collected = args.where;
      return Promise.resolve(buckets.collected ?? { _count: 0, _sum: { amountPaid: D('0') } });
    });

    const count = jest.fn((args: any) => {
      calls.overdue60 = args.where;
      return Promise.resolve(buckets.overdue60 ?? 0);
    });

    const findMany = jest.fn((args: any) => {
      calls.pendingRows = args.where;
      return Promise.resolve(buckets.pendingRows ?? []);
    });

    const systemConfig = {
      findUnique: jest.fn(({ where: { key } }: { where: { key: string } }) => {
        const map: Record<string, string> = {
          late_fee_mode: 'PER_DAY',
          late_fee_per_day_rate: '20',
          late_fee_max_amount: '500',
          late_fee_cap_pct: '5',
        };
        return Promise.resolve(map[key] ? { value: map[key] } : null);
      }),
    };

    const prisma = { payment: { aggregate, count, findMany }, systemConfig };
    const service = new PaymentQueryService(prisma as any);
    return { service, calls, aggregate, count };
  }

  it('computes all 6 KPI figures with Decimal-safe math (matches mockup)', async () => {
    const D = (v: string) => new Prisma.Decimal(v);
    const { service } = makeService({
      pending: { _count: 50, _sum: { amountDue: D('60000.00'), amountPaid: D('3624.00'), lateFee: D('2150.00') } },
      waived: { _sum: { waivedAmount: D('675.00') } },
      overdue60: 3,
      collected: { _count: 8, _sum: { amountPaid: D('12580.00') } },
      // one 30-day-overdue installment; PER_DAY min(30×20=600, 500, 5%×6000=300) = 300
      pendingRows: [{ dueDate: new Date(Date.now() - 30 * 86_400_000), amountDue: D('6000'), lateFeeWaived: false }],
    });

    const result = await service.getPendingSummary({});

    expect(result).toEqual({
      pendingCount: 50,
      outstandingPrincipal: 56376, // 60000.00 − 3624.00, "เฉพาะค่างวด" (no late fee)
      outstandingLateFee: 300, // live: 5% × 6000 (cap binds)
      waivedLateFee: 675, // → Dr 52-1105 (อนุโลม)
      overdue60Count: 3, // → trigger 21-2103 VAT
      collectedAmount: 12580,
      collectedCount: 8,
    });
  });

  it('keeps satang precision (no float drift across the subtraction)', async () => {
    const D = (v: string) => new Prisma.Decimal(v);
    const { service } = makeService({
      pending: { _count: 3, _sum: { amountDue: D('4547.49'), amountPaid: D('1515.83'), lateFee: D('99.17') } },
      // 30 days overdue, PER_DAY cap binds: 5% × 1983.40 = 99.17
      pendingRows: [{ dueDate: new Date(Date.now() - 30 * 86_400_000), amountDue: D('1983.40'), lateFeeWaived: false }],
    });

    const result = await service.getPendingSummary({});
    expect(result.outstandingPrincipal).toBe(3031.66); // 4547.49 − 1515.83
    expect(result.outstandingLateFee).toBe(99.17);
  });

  it('never reports a negative outstanding (overpaid edge clamps to 0)', async () => {
    const D = (v: string) => new Prisma.Decimal(v);
    const { service } = makeService({
      pending: { _count: 1, _sum: { amountDue: D('100.00'), amountPaid: D('150.00'), lateFee: D('0') } },
    });

    const result = await service.getPendingSummary({});
    expect(result.outstandingPrincipal).toBe(0);
  });

  it('"ทั้งหมด" (no range) applies no dueDate filter to any bucket', async () => {
    const { service, calls } = makeService({});
    await service.getPendingSummary({});

    expect(calls.pending.dueDate).toBeUndefined();
    expect(calls.waived.dueDate).toBeUndefined();
    expect(calls.collected.dueDate).toBeUndefined();
    // overdue-60 always carries its cutoff, even with no period selected
    expect(calls.overdue60.dueDate.lte).toBeInstanceOf(Date);
  });

  it('applies an inclusive due-date window when dueFrom/dueTo are given', async () => {
    const { service, calls } = makeService({});
    await service.getPendingSummary({ dueFrom: '2026-05-01', dueTo: '2026-05-31' });

    expect(calls.pending.dueDate.gte).toEqual(new Date(2026, 4, 1));
    // inclusive end → start of the next day (1 Jun)
    expect(calls.pending.dueDate.lt).toEqual(new Date(2026, 5, 1));
    // overdue-60 keeps the window's lower bound AND the 60-day cutoff
    expect(calls.overdue60.dueDate.gte).toEqual(new Date(2026, 4, 1));
    expect(calls.overdue60.dueDate.lte).toBeInstanceOf(Date);
  });

  it('scopes every bucket to APPROVED contracts of the requested branch', async () => {
    const { service, calls } = makeService({});
    await service.getPendingSummary({ branchId: 'branch-1' });

    for (const where of [calls.pending, calls.waived, calls.collected, calls.overdue60]) {
      expect(where.contract).toMatchObject({ workflowStatus: 'APPROVED', deletedAt: null, branchId: 'branch-1' });
      expect(where.deletedAt).toBeNull();
    }
  });
});
