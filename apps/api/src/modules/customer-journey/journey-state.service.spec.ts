import { CUSTOMER_BOUGHT_CONTRACT_STATUSES, CUSTOMER_BOUGHT_SALE_TYPES } from '@installment/shared';
import { JourneyStateService } from './journey-state.service';

/** การแบ่งชุดและ keyset — ตัว SQL พิสูจน์ใน journey-state.service.db.spec.ts */
describe('JourneyStateService (unit)', () => {
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

  it('recomputeAll เดิน keyset ตาม id ทีละ 500 จนหมด และคืนจำนวนทั้งหมด', async () => {
    const customers = Array.from({ length: 1200 }, (_, i) => `c${String(i).padStart(4, '0')}`);
    const { prisma, service } = build(customers);

    await expect(service.recomputeAll()).resolves.toBe(1200);

    expect(prisma.customer.findMany.mock.calls.map(([args]) => args.where.id?.gt ?? null)).toEqual([null, 'c0499', 'c0999']);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
  });
});
