import { AdminAnalyticsService } from './admin-analytics.service';

/**
 * กราฟรายวันของ analytics/date-range ต้องแบ่งวันตามเวลาไทย (2026-11-18) — เดิม date_trunc('day', created_at)
 * ตัดตาม UTC ⇒ ข้อความ 00:00–06:59 น. ไทยถูกนับเป็นวันก่อนหน้า และเมื่อขอบเริ่มเป็นเที่ยงคืนไทย
 * แท่งแรกจะชื่อเป็นวันก่อนวันเริ่ม
 */
describe('AdminAnalyticsService.getDateRangeStats — แบ่งวันตามเวลาไทย', () => {
  const start = new Date('2026-04-30T17:00:00.000Z');
  const end = new Date('2026-05-31T16:59:59.999Z');
  const prisma = {
    $queryRaw: jest.fn(),
    chatMessage: { aggregate: jest.fn() },
    chatRoom: { count: jest.fn() },
  };
  const service = new AdminAnalyticsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.chatMessage.aggregate.mockResolvedValue({ _sum: { costUsd: null } });
    prisma.chatRoom.count.mockResolvedValue(0);
  });

  it('SQL กราฟรายวันแบ่งวันด้วย AT TIME ZONE Asia/Bangkok ทั้งใน SELECT และ GROUP BY', async () => {
    await service.getDateRangeStats(start, end);

    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [readonly string[], ...unknown[]];
    const sql = strings.join('?');
    expect(sql.match(/AT TIME ZONE 'Asia\/Bangkok'/g)).toHaveLength(2);
    expect(values).toEqual([start, end]);
  });

  it('ป้ายวันของแต่ละแท่งมาจากวันไทยที่ SQL คืนมา (timestamp ไม่มี timezone)', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { date: new Date('2026-05-01T00:00:00.000Z'), messages: BigInt(3), cost: 0.5 },
      { date: new Date('2026-05-02T00:00:00.000Z'), messages: BigInt(2), cost: 0.25 },
    ]);

    const res = await service.getDateRangeStats(start, end);

    expect(res.dailyStats).toEqual([
      { date: '2026-05-01', messages: 3, cost: 0.5 },
      { date: '2026-05-02', messages: 2, cost: 0.25 },
    ]);
    expect(res.totalMessages).toBe(5);
  });

  it('ขอบ gte/lte เดียวกันถูกส่งให้ aggregate และนับ handoff', async () => {
    await service.getDateRangeStats(start, end);

    expect(prisma.chatMessage.aggregate.mock.calls[0][0].where.createdAt).toEqual({ gte: start, lte: end });
    expect(prisma.chatRoom.count.mock.calls[0][0].where.handoffTaggedAt).toEqual({ gte: start, lte: end });
  });
});
