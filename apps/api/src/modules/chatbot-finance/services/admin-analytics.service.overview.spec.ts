import { AdminAnalyticsService } from './admin-analytics.service';

/**
 * getOverview (2026-11-18): กราฟ "ข้อความ 7 วันย้อนหลัง" ต้องแบ่งวันตามเวลาไทย และหน้าต่างเวลาต้องไม่ขึ้นกับ TZ ของโปรเซส —
 * เดิม date_trunc('day', created_at) บนคอลัมน์ timestamp ไม่มี timezone (เก็บ UTC) ตัดวันตาม UTC และ
 * setHours(0,0,0,0) ขึ้นกับ TZ เครื่อง
 */
describe('AdminAnalyticsService.getOverview — แบ่งวันตามเวลาไทย', () => {
  // 2026-12-01 01:00 เวลาไทย
  const now = new Date('2026-11-30T18:00:00.000Z');
  const startOfToday = new Date('2026-11-30T17:00:00.000Z');
  const sevenDaysAgo = new Date('2026-11-24T17:00:00.000Z');
  const prisma = {
    $queryRaw: jest.fn(),
    chatRoom: { count: jest.fn() },
    chatMessage: { count: jest.fn(), aggregate: jest.fn() },
    customerLineLink: { count: jest.fn() },
    chatKnowledgeBase: { count: jest.fn() },
  };
  const service = new AdminAnalyticsService(prisma as never);

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.chatRoom.count.mockResolvedValue(0);
    prisma.chatMessage.count.mockResolvedValue(0);
    prisma.chatMessage.aggregate.mockResolvedValue({ _sum: { costUsd: null } });
    prisma.customerLineLink.count.mockResolvedValue(0);
    prisma.chatKnowledgeBase.count.mockResolvedValue(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('SQL กราฟ 7 วันแบ่งวันด้วย AT TIME ZONE Asia/Bangkok ทั้งใน SELECT และ GROUP BY', async () => {
    await service.getOverview();

    const [strings] = prisma.$queryRaw.mock.calls[1] as [readonly string[], ...unknown[]];
    const sql = strings.join('?');
    expect(sql).toContain('date_trunc');
    expect(sql.match(/\(cm\.created_at AT TIME ZONE 'UTC'\) AT TIME ZONE 'Asia\/Bangkok'/g)).toHaveLength(2);
  });

  it('ขอบ "วันนี้" และ "7 วันย้อนหลัง" เป็นเที่ยงคืนไทย (ค่า ISO คงที่)', async () => {
    await service.getOverview();

    expect(prisma.chatRoom.count.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(startOfToday.toISOString());
    const [, topIntentsStart] = prisma.$queryRaw.mock.calls[0] as [unknown, Date];
    const [, recentStart] = prisma.$queryRaw.mock.calls[1] as [unknown, Date];
    expect(topIntentsStart.toISOString()).toBe(sevenDaysAgo.toISOString());
    expect(recentStart.toISOString()).toBe(sevenDaysAgo.toISOString());
  });

  it('ป้ายวันมาจากวันไทยที่ SQL คืนมา', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ date: new Date('2026-11-30T00:00:00.000Z'), count: BigInt(4) }]);

    const res = await service.getOverview();

    expect(res.recentDays).toEqual([{ date: '2026-11-30', messages: 4 }]);
  });
});
