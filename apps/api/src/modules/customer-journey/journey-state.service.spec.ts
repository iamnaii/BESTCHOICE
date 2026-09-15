import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CUSTOMER_BOUGHT_CONTRACT_STATUSES, CUSTOMER_BOUGHT_SALE_TYPES } from '@installment/shared';
import { JourneyStateService } from './journey-state.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

/** การแบ่งชุดและ keyset — ตัว SQL พิสูจน์ใน journey-state.service.db.spec.ts */
describe('JourneyStateService (unit)', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function build(customers: string[] = []) {
    const prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      customerJourneyState: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      customer: {
        findMany: jest.fn(async (args: { where: { id?: { gt: string } }; take: number }) => {
          const after = args.where.id?.gt;
          return customers
            .filter((id) => !after || id > after)
            .slice(0, args.take)
            .map((id) => ({ id }));
        }),
      },
    };
    return { prisma, service: new JourneyStateService(prisma as never) };
  }

  it('recompute: ตัด id ว่าง/ซ้ำ · ทีละ 500 · ส่งรายการสถานะซื้อจาก shared + เวลาคำนวณ ISO · ลบแคชของคนที่ถูกลบในชุดเดียวกัน', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `c${String(i).padStart(4, '0')}`);
    const { prisma, service } = build();

    await service.recompute([...ids, ids[0], '']);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    const [sql, batch, statuses, saleTypes, computedAt] = prisma.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('INSERT INTO customer_journey_states');
    expect(batch).toHaveLength(500);
    expect(statuses).toEqual([...CUSTOMER_BOUGHT_CONTRACT_STATUSES]);
    expect(saleTypes).toEqual([...CUSTOMER_BOUGHT_SALE_TYPES]);
    expect(new Date(computedAt).toISOString()).toBe(computedAt);
    expect(prisma.$executeRawUnsafe.mock.calls[2][1]).toEqual(['c1000']);
    expect(prisma.customerJourneyState.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { customerId: { in: batch }, customer: { deletedAt: { not: null } } },
    });
  });

  it('recompute([]) ไม่ยิงฐาน', async () => {
    const { prisma, service } = build();
    await service.recompute([]);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.customerJourneyState.deleteMany).not.toHaveBeenCalled();
  });

  it('recompute: ชุดใดล้ม → โยน error ทันที ไม่ทำชุดถัดไป (ผู้เรียกที่ต้องรู้ผล: รวมผู้สนใจ / summary)', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `c${String(i).padStart(4, '0')}`);
    const { prisma, service } = build();
    prisma.$executeRawUnsafe.mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(service.recompute(ids)).rejects.toThrow('deadlock detected');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('recomputeContinuing: ชุดกลางล้ม → นับ failedBatches · log/Sentry มีแค่ id ต้น/ท้าย · ทำชุดถัดไปต่อ', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `c${String(i).padStart(4, '0')}`);
    const { prisma, service } = build();
    prisma.$executeRawUnsafe.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(service.recomputeContinuing(ids)).resolves.toEqual({ recomputed: 1001, failedBatches: 1 });

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    expect(prisma.$executeRawUnsafe.mock.calls[2][1]).toEqual(['c1000']);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'deadlock detected' }), {
      tags: { kind: 'cron-job', cron: 'journey:recompute' },
      extra: { firstId: 'c0500', lastId: 'c0999', size: 500 },
    });
  });

  it('recomputeAll เดิน keyset ตาม id ทีละ 500 จนหมด · คืนจำนวนทั้งหมด · กวาดแคชของลูกค้าที่ถูกลบครั้งเดียวท้ายรอบ', async () => {
    const customers = Array.from({ length: 1200 }, (_, i) => `c${String(i).padStart(4, '0')}`);
    const { prisma, service } = build(customers);

    await expect(service.recomputeAll()).resolves.toEqual({ recomputed: 1200, failedBatches: 0 });

    expect(prisma.customer.findMany.mock.calls.map(([args]) => args.where.id?.gt ?? null)).toEqual([null, 'c0499', 'c0999']);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    const sweeps = prisma.customerJourneyState.deleteMany.mock.calls.filter(([args]) => !('customerId' in args.where));
    expect(sweeps).toEqual([[{ where: { customer: { deletedAt: { not: null } } } }]]);
    // กวาดหลังชุดสุดท้าย — แถวที่ recompute ชุดท้ายเขียนแทรกก็ถูกเก็บ
    const lastCall = prisma.customerJourneyState.deleteMany.mock.calls.length - 1;
    expect(prisma.customerJourneyState.deleteMany.mock.calls[lastCall][0]).toEqual({ where: { customer: { deletedAt: { not: null } } } });
  });

  it('recomputeAll: ชุดล้ม → ไปต่อจนจบ · การกวาดแคชล้ม → นับเป็น failedBatches ไม่โยน', async () => {
    const customers = Array.from({ length: 1200 }, (_, i) => `c${String(i).padStart(4, '0')}`);
    const { prisma, service } = build(customers);
    prisma.$executeRawUnsafe.mockRejectedValueOnce(new Error('deadlock detected'));
    prisma.customerJourneyState.deleteMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (!('customerId' in args.where)) throw new Error('sweep down');
      return { count: 0 };
    });

    await expect(service.recomputeAll()).resolves.toEqual({ recomputed: 1200, failedBatches: 2 });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
  });
});
