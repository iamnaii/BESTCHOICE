import { ContractQueryService } from './contract-query.service';

/**
 * getMilestonesSummary — "เดือนนี้" = เดือนปฏิทินไทย (2026-11-18) ไม่ขึ้นกับ TZ ของโปรเซส
 * ปั้น prisma ด้วยมือ · จำลองเวลาเฉพาะ Date
 */
const FAKE_DATE_ONLY = [
  'nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance',
] as const;

function make() {
  const prisma = {
    contract: { findMany: jest.fn().mockResolvedValue([]) },
    payment: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new ContractQueryService(prisma as never) };
}

describe('ContractQueryService.getMilestonesSummary — เดือนปฏิทินไทย', () => {
  afterEach(() => jest.useRealTimers());

  it('กลางเดือน: 03:30 น. ไทยของ 18 พ.ย. → [2026-11-01 00:00, 2026-11-30 23:59:59.999] เวลาไทย', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T20:30:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    const { prisma, service } = make();

    await service.getMilestonesSummary();

    const range = {
      gte: new Date('2026-10-31T17:00:00.000Z'),
      lte: new Date('2026-11-30T16:59:59.999Z'),
    };
    expect(prisma.contract.findMany.mock.calls[0][0].where.createdAt).toEqual(range);
    expect(prisma.payment.findMany.mock.calls[0][0].where.dueDate).toEqual(range);
  });

  it('ข้ามเดือน: 01:00 น. ไทยของ 1 ธ.ค. (= 18:00Z ของ 30 พ.ย.) → เดือน ธ.ค. ไม่ใช่ พ.ย.', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-30T18:00:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    const { prisma, service } = make();

    await service.getMilestonesSummary();

    expect(prisma.contract.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-11-30T17:00:00.000Z'), // 2026-12-01 00:00 น. ไทย
      lte: new Date('2026-12-31T16:59:59.999Z'), // 2026-12-31 23:59:59.999 น. ไทย
    });
  });
});
