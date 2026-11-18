import { ChatbotFinanceAdminController } from './chatbot-finance-admin.controller';

/**
 * analytics/date-range และ learning/feedback-stats รับ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ ข้อความ 00:00–06:59 น. ของวันเริ่ม และทุกอย่างหลัง 07:00 น.
 * ของวันสิ้นสุดตกนอกช่วง (ทั้งจำนวนข้อความ ค่าใช้จ่าย และจำนวน handoff)
 */
describe('ChatbotFinanceAdminController — วันที่ของ analytics/date-range และ feedback-stats', () => {
  const START = '2026-04-30T17:00:00.000Z'; // 2026-05-01 00:00:00.000 น. ไทย
  const END = '2026-05-31T16:59:59.999Z'; // 2026-05-31 23:59:59.999 น. ไทย
  const analytics = { getDateRangeStats: jest.fn() };
  const feedback = { getStats: jest.fn() };
  const controller = new ChatbotFinanceAdminController(
    analytics as never,
    {} as never,
    {} as never,
    feedback as never,
  );
  const iso = (d: Date) => d.toISOString();

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it('analytics/date-range: ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await controller.getDateRangeStats('2026-05-01', '2026-05-31');
    const [start, end] = analytics.getDateRangeStats.mock.calls[0];
    expect(iso(start)).toBe(START);
    expect(iso(end)).toBe(END);
  });

  it('ขอบ: ข้อความ 00:00 น. ไทยของวันเริ่มอยู่ในช่วง · 00:00 น. ของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await controller.getDateRangeStats('2026-05-01', '2026-05-31');
    const [start, end] = analytics.getDateRangeStats.mock.calls[0] as [Date, Date];
    const firstInstant = new Date('2026-05-01T00:00:00+07:00').getTime();
    const nextDayMidnight = new Date('2026-06-01T00:00:00+07:00').getTime();
    expect(firstInstant >= start.getTime() && firstInstant <= end.getTime()).toBe(true);
    expect(nextDayMidnight <= end.getTime()).toBe(false);
  });

  it('วันเดียว (start = end) ได้ช่วงเต็มวัน 24 ชั่วโมง', async () => {
    await controller.getDateRangeStats('2026-11-18', '2026-11-18');
    const [start, end] = analytics.getDateRangeStats.mock.calls[0] as [Date, Date];
    expect(iso(start)).toBe('2026-11-17T17:00:00.000Z');
    expect(iso(end)).toBe('2026-11-18T16:59:59.999Z');
  });

  it('ค่า ISO เต็ม (ไม่ใช่ YYYY-MM-DD) ใช้ตามเดิม', async () => {
    await controller.getDateRangeStats('2026-05-01T03:00:00.000Z', '2026-05-31T10:00:00.000Z');
    const [start, end] = analytics.getDateRangeStats.mock.calls[0] as [Date, Date];
    expect(iso(start)).toBe('2026-05-01T03:00:00.000Z');
    expect(iso(end)).toBe('2026-05-31T10:00:00.000Z');
  });

  it('ไม่ส่งวันที่ = 30 วันย้อนหลังถึงตอนนี้ ตามเดิม', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T05:00:00.000Z'));
    await controller.getDateRangeStats();
    const [start, end] = analytics.getDateRangeStats.mock.calls[0] as [Date, Date];
    expect(iso(start)).toBe('2026-10-19T05:00:00.000Z');
    expect(iso(end)).toBe('2026-11-18T05:00:00.000Z');
  });

  it('learning/feedback-stats: ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await controller.getFeedbackStats('2026-05-01', '2026-05-31');
    const [start, end] = feedback.getStats.mock.calls[0] as [Date, Date];
    expect(iso(start)).toBe(START);
    expect(iso(end)).toBe(END);
  });
});
