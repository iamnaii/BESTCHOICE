import { AnalyticsLeaderboardService } from './analytics-leaderboard.service';
import { renderSqlCall } from '../../utils/__tests__/raw-sql-call';

/**
 * "ยอดเก็บได้เดือนนี้" ของตารางผลงานผู้ติดตาม (GET /overdue/analytics/leaderboard) ต้องเริ่ม 00:00 น. วันที่ 1 ตามเวลาไทย (2026-11-18)
 * เดิม date_trunc('month', NOW()) ตัดเดือนตาม TZ ของ session ฐานข้อมูล (prod = UTC) ⇒ เดือนเริ่ม 07:00 น. วันที่ 1
 * ยอดที่รับช่วง 00:00–06:59 น. ของวันที่ 1 หายจากเดือนใหม่ · และช่วง 00:00–06:59 น. วันที่ 1 ตารางยังโชว์ยอดของเดือนก่อน
 */
describe('AnalyticsLeaderboardService — ต้นเดือนตามเวลาไทย', () => {
  const prisma = { $queryRawUnsafe: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRawUnsafe.mockResolvedValue([]);
  });
  afterEach(() => jest.useRealTimers());

  async function monthStartAt(now: string) {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(now));
    await new AnalyticsLeaderboardService(prisma as never).getLeaderboard();
    return renderSqlCall(prisma.$queryRawUnsafe.mock.calls[0]);
  }

  it('ส่งต้นเดือนไทยเป็นพารามิเตอร์ $1 แทน date_trunc(month, NOW())', async () => {
    const { text, values } = await monthStartAt('2026-11-18T05:00:00.000Z');
    expect(text).toContain('AND p.paid_date >= $1::timestamp');
    expect(text).not.toContain("date_trunc('month', NOW())");
    expect(values).toEqual(['2026-10-31T17:00:00.000Z']); // 2026-11-01 00:00 น. ไทย
  });

  it('01:00 น. ไทยของวันที่ 1 (UTC ยังเป็นเดือนก่อน) = เดือนใหม่แล้ว', async () => {
    const { values } = await monthStartAt('2026-11-30T18:00:00.000Z'); // 2026-12-01 01:00 น. ไทย
    expect(values).toEqual(['2026-11-30T17:00:00.000Z']); // 2026-12-01 00:00 น. ไทย
  });

  it('ข้ามปี: 1 ม.ค. 07:30 น. ไทย = เดือนมกราคมของปีใหม่', async () => {
    const { values } = await monthStartAt('2027-01-01T00:30:00.000Z');
    expect(values).toEqual(['2026-12-31T17:00:00.000Z']); // 2027-01-01 00:00 น. ไทย
  });

  it('23:59 น. ไทยวันสิ้นเดือน ยังเป็นเดือนเดิม', async () => {
    const { values } = await monthStartAt('2026-11-30T16:59:00.000Z'); // 2026-11-30 23:59 น. ไทย
    expect(values).toEqual(['2026-10-31T17:00:00.000Z']);
  });
});
