import { OverdueAnalyticsService } from './analytics.service';
import { renderSqlCall } from '../../utils/__tests__/raw-sql-call';

/**
 * GET /overdue/analytics (แท็บวิเคราะห์ของหน้าติดตามหนี้) ต้องแบ่งสัปดาห์/วัน/เดือนตามเวลาไทย (2026-11-18)
 * เดิม date_trunc บนคอลัมน์ timestamp (เก็บ UTC) ตรง ๆ ⇒ รายการ 00:00–06:59 น. ไทยถูกนับเข้าวันก่อนหน้า
 * (คืนวันอาทิตย์ → สัปดาห์ก่อน · คืนสิ้นเดือน → เดือนก่อน)
 */
const BKK = (expr: string) => `((${expr} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')`;

describe('OverdueAnalyticsService — แบ่งช่วงตามเวลาไทย', () => {
  const prisma = { $queryRaw: jest.fn() };
  let service: OverdueAnalyticsService;
  // ตอนนี้ = 2026-11-18 12:00 น. ไทย ⇒ since (30d) = เที่ยงคืนไทยของ 2026-11-18 ย้อน 30 วัน = 2026-10-19 00:00 น. ไทย
  const SINCE_30D = new Date('2026-10-18T17:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T05:00:00.000Z'));
    prisma.$queryRaw.mockResolvedValue([]);
    service = new OverdueAnalyticsService(prisma as never);
  });
  afterEach(() => jest.useRealTimers());

  const queryOf = (table: string) => {
    const found = prisma.$queryRaw.mock.calls.map(renderSqlCall).find((c) => c.text.includes(`FROM ${table}`));
    if (!found) throw new Error(`ไม่พบ query ของ ${table}`);
    return found;
  };

  it('อัตราเก็บเงินรายสัปดาห์: สัปดาห์ของ paid_date ตามเวลาไทย ทั้ง SELECT และ GROUP BY', async () => {
    await service.getAnalytics({ range: '30d' });
    const { text, values } = queryOf('payments p');
    expect(text).toContain(`date_trunc('week', ${BKK('p.paid_date')})::date AS week_start`);
    expect(text).toContain(`GROUP BY date_trunc('week', ${BKK('p.paid_date')})`);
    expect(text).not.toContain("date_trunc('week', p.paid_date)");
    expect(values).toEqual([SINCE_30D]);
  });

  it('นัดชำระ ตามนัด/ผิดนัด: สัปดาห์ของ COALESCE(broken_at, settlement_date) ตามเวลาไทย', async () => {
    await service.getAnalytics({ range: '30d' });
    const { text, values } = queryOf('call_logs');
    expect(text).toContain(`date_trunc('week', ${BKK('COALESCE(broken_at, settlement_date)')})::date AS week_start`);
    expect(text).toContain(`GROUP BY date_trunc('week', ${BKK('COALESCE(broken_at, settlement_date)')})`);
    expect(values).toEqual([SINCE_30D]);
  });

  it('การทวงถามรายวัน: วันของ dunning_actions.created_at ตามเวลาไทย', async () => {
    await service.getAnalytics({ range: '30d' });
    const { text, values } = queryOf('dunning_actions');
    expect(text).toContain(`date_trunc('day', ${BKK('created_at')})::date AS day`);
    expect(text).toContain(`GROUP BY date_trunc('day', ${BKK('created_at')})`);
    expect(values).toEqual([SINCE_30D]);
  });

  it('หนังสือที่ส่งรายเดือน: เดือนของ dispatched_at ตามเวลาไทย', async () => {
    await service.getAnalytics({ range: '30d' });
    const { text, values } = queryOf('contract_letters');
    expect(text).toContain(`date_trunc('month', ${BKK('dispatched_at')})::date AS month`);
    expect(text).toContain(`GROUP BY letter_type, date_trunc('month', ${BKK('dispatched_at')})`);
    expect(values).toEqual([SINCE_30D]);
  });

  it('คำขอล็อกเครื่องรายวัน: วันของ proposed_at ตามเวลาไทย', async () => {
    await service.getAnalytics({ range: '30d' });
    const { text, values } = queryOf('mdm_lock_requests');
    expect(text).toContain(`date_trunc('day', ${BKK('proposed_at')})::date AS day`);
    expect(text).toContain(`GROUP BY date_trunc('day', ${BKK('proposed_at')})`);
    expect(values).toEqual([SINCE_30D]);
  });

  it('ป้ายช่วงที่ส่งให้เว็บยังเป็นสตริงวันที่จากค่า date ที่ SQL คืน (รูปเดิม)', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ week_start: new Date('2026-11-16T00:00:00.000Z'), paid_count: BigInt(4), due_count: BigInt(5) }])
      .mockResolvedValueOnce([{ week_start: new Date('2026-11-16T00:00:00.000Z'), kept: BigInt(1), broken: BigInt(2) }])
      .mockResolvedValueOnce([{ day: new Date('2026-11-17T00:00:00.000Z'), sent: BigInt(3), failed: BigInt(0) }])
      .mockResolvedValueOnce([{ letter_type: 'RETURN_DEVICE_45D', month: new Date('2026-11-01T00:00:00.000Z'), cnt: BigInt(2) }])
      .mockResolvedValueOnce([{ day: new Date('2026-11-17T00:00:00.000Z'), proposed: BigInt(1), approved: BigInt(1) }]);

    const res = await service.getAnalytics({ range: '30d' });

    expect(res.weeklyCollectionRate).toEqual([{ weekStart: '2026-11-16', paidCount: 4, dueCount: 5, rate: 0.8 }]);
    expect(res.promiseKeptTrend).toEqual([{ weekStart: '2026-11-16', kept: 1, broken: 2 }]);
    expect(res.dunningActionVolume).toEqual([{ date: '2026-11-17', sent: 3, failed: 0 }]);
    expect(res.letterDispatchByType).toEqual([{ type: 'RETURN_DEVICE_45D', month: '2026-11', count: 2 }]);
    expect(res.mdmLockVolume).toEqual([{ date: '2026-11-17', proposed: 1, approved: 1 }]);
  });
});
