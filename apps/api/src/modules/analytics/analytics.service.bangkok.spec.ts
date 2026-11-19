import { AnalyticsService } from './analytics.service';
import { renderSqlCall } from '../../utils/__tests__/raw-sql-call';

/**
 * หน้า "วิเคราะห์ภาพรวม" (/analytics — cohort · คาดการณ์รายได้ · ความหนาแน่นยอดขาย) ต้องแบ่งเดือน/วันในสัปดาห์/ชั่วโมงตามเวลาไทย (2026-11-18)
 * เดิม DATE_TRUNC / EXTRACT บนคอลัมน์ timestamp (เก็บ UTC) ตรง ๆ ⇒ ชั่วโมงขายเร็วไป 7 ชั่วโมง (ขาย 10:00 น. ไปอยู่ช่อง 3 โมง)
 * ยอดขายช่วง 00:00–06:59 น. ไปอยู่วันก่อนหน้า และยอดรับชำระคืนวันที่ 1 ช่วงนั้นไปอยู่เดือนก่อน
 */
const BKK = (expr: string) => `((${expr} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')`;

describe('AnalyticsService — เดือน/วัน/ชั่วโมงตามเวลาไทย', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new AnalyticsService(prisma as never);
  const lastSql = () => renderSqlCall(prisma.$queryRaw.mock.calls[0]);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
  });

  it('cohort: เดือนของสัญญาแรกและเดือนที่ชำระ ตัดตามเวลาไทย', async () => {
    await service.getCohortAnalysis();
    const { text, values } = lastSql();
    expect(text).toContain(`DATE_TRUNC('month', MIN(${BKK('c.created_at')})) AS cohort_month`);
    expect(text).toContain(`DATE_TRUNC('month', ${BKK('p.paid_date')}) AS activity_month`);
    expect(text).not.toContain("DATE_TRUNC('month', p.paid_date)");
    expect(values).toEqual([]);
  });

  it('cohort ของสาขา: สาขายังเป็นพารามิเตอร์', async () => {
    await service.getCohortAnalysis('b1');
    expect(lastSql().values).toEqual(['b1']);
  });

  it('คาดการณ์รายได้: เดือนของ paid_date ตามเวลาไทย ทั้ง SELECT และ GROUP BY', async () => {
    await service.getRevenueForecast();
    const { text } = lastSql();
    expect(text).toContain(`TO_CHAR(DATE_TRUNC('month', ${BKK('p.paid_date')}), 'YYYY-MM') AS month`);
    expect(text).toContain(`GROUP BY DATE_TRUNC('month', ${BKK('p.paid_date')})`);
  });

  it('ความหนาแน่นยอดขาย: วันในสัปดาห์และชั่วโมงของ sales.created_at ตามเวลาไทย', async () => {
    await service.getSalesHeatmap('b1', 3);
    const { text, values } = lastSql();
    expect(text).toContain(`EXTRACT(DOW FROM ${BKK('s.created_at')})::int AS day`);
    expect(text).toContain(`EXTRACT(HOUR FROM ${BKK('s.created_at')})::int AS hour`);
    expect(text).not.toContain('EXTRACT(HOUR FROM s.created_at)');
    expect(values).toEqual([3, 'b1']);
  });

  it('ความหนาแน่นยอดขาย: ค่าวัน/ชั่วโมงจาก SQL ส่งต่อให้เว็บตามเดิม (ชั่วโมงไทย 0–23)', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { day: 1, hour: 10, count: '4', amount: '20000' },
      { day: 6, hour: 18, count: '9', amount: '45000' },
    ]);
    const res = await service.getSalesHeatmap();
    expect(res.heatmap).toEqual([
      { day: 1, hour: 10, count: 4, amount: 20000 },
      { day: 6, hour: 18, count: 9, amount: 45000 },
    ]);
    expect(res.peakDay).toEqual({ day: 6, name: 'เสาร์' });
    expect(res.peakHour).toBe(18);
  });
});

/**
 * คาดการณ์รายได้ใช้ 6 เดือนเต็มตามปฏิทินไทยก่อนเดือนนี้ (2026-11-19)
 * เดิม paid_date >= NOW() - 6 เดือน ⇒ เดือนแรกได้แค่บางส่วน + เดือนปัจจุบัน (ยังไม่จบ) ถูกนับเป็นประวัติ ⇒ เส้นแนวโน้มเอียงลง
 * และเดือนที่ไม่มีการรับชำระหายจากแถว ⇒ ลำดับเดือน (x) ในการถดถอยเลื่อน
 */
describe('AnalyticsService.getRevenueForecast — 6 เดือนเต็มก่อนเดือนนี้', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new AnalyticsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-30T18:00:00.000Z')); // 1 ธ.ค. 2026 01:00 น. ไทย
  });
  afterEach(() => jest.useRealTimers());

  it('ช่วงข้อมูล = [00:00 น. ไทย 1 มิ.ย., 00:00 น. ไทย 1 ธ.ค.) ส่งเป็น ::timestamp · ไม่ใช้ NOW()', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await service.getRevenueForecast();
    const { text, values } = renderSqlCall(prisma.$queryRaw.mock.calls[0]);
    expect(text).not.toContain('NOW()');
    expect(text).toContain('AND p.paid_date >= ?::timestamp');
    expect(text).toContain('AND p.paid_date < ?::timestamp');
    expect(values).toEqual(['2026-05-31T17:00:00.000Z', '2026-11-30T17:00:00.000Z']);
  });

  it('เดือนที่ไม่มีการรับชำระเติม 0 · ประวัติครบ 6 เดือน (มิ.ย.–พ.ย.) · คาดการณ์เริ่มเดือนนี้ (ธ.ค.)', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { month: '2026-06', amount: '1000' },
      { month: '2026-08', amount: '3000' },
      { month: '2026-11', amount: '6000' },
    ]);
    const res = await service.getRevenueForecast();
    expect(res.historical).toEqual([
      { month: '2026-06', amount: 1000 },
      { month: '2026-07', amount: 0 },
      { month: '2026-08', amount: 3000 },
      { month: '2026-09', amount: 0 },
      { month: '2026-10', amount: 0 },
      { month: '2026-11', amount: 6000 },
    ]);
    expect(res.forecast.map((f) => f.month)).toEqual(['2026-12', '2027-01', '2027-02']);
  });

  it('ยังมีเดือนที่รับชำระน้อยกว่า 2 เดือน → ไม่พยากรณ์ (ข้อความเดิม)', async () => {
    prisma.$queryRaw.mockResolvedValue([{ month: '2026-11', amount: '6000' }]);
    const res = await service.getRevenueForecast();
    expect(res.forecast).toEqual([]);
    expect(res.note).toBe('ข้อมูลไม่เพียงพอสำหรับการพยากรณ์ (ต้องการอย่างน้อย 2 เดือน)');
  });
});
