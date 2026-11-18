import { CsatController } from './csat.controller';

/**
 * GET /csat/stats รับ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18) — เดิม new Date('YYYY-MM-DD') = 07:00 น. ไทย
 * ⇒ คะแนนที่ให้ 00:00–06:59 น. ของวันเริ่ม และหลัง 07:00 น. ของวันสิ้นสุดไม่ถูกนับ
 */
describe('CsatController.getStats — วันที่ตามเวลาไทย', () => {
  const csat = { getStats: jest.fn() };
  const controller = new CsatController(csat as never);
  const iso = (d: Date | undefined) => d?.toISOString();

  beforeEach(() => jest.clearAllMocks());

  it('ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await controller.getStats('2026-11-01', '2026-11-17');
    const [start, end] = csat.getStats.mock.calls[0];
    expect(iso(start)).toBe('2026-10-31T17:00:00.000Z');
    expect(iso(end)).toBe('2026-11-17T16:59:59.999Z');
  });

  it('ขอบ: คะแนน 00:00 น. ไทยของวันเริ่มอยู่ในช่วง · 00:00 น. ของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await controller.getStats('2026-11-01', '2026-11-17');
    const [start, end] = csat.getStats.mock.calls[0] as [Date, Date];
    const firstInstant = new Date('2026-11-01T00:00:00+07:00').getTime();
    const nextDayMidnight = new Date('2026-11-18T00:00:00+07:00').getTime();
    expect(firstInstant >= start.getTime() && firstInstant <= end.getTime()).toBe(true);
    expect(nextDayMidnight <= end.getTime()).toBe(false);
  });

  it('ไม่ส่งวันที่ = undefined ทั้งคู่ (service ใช้ 30 วันย้อนหลังเอง) ตามเดิม', async () => {
    await controller.getStats();
    expect(csat.getStats).toHaveBeenCalledWith(undefined, undefined);
  });

  it('ค่า ISO เต็ม (ไม่ใช่ YYYY-MM-DD) ใช้ตามเดิม', async () => {
    await controller.getStats('2026-11-01T03:00:00.000Z', '2026-11-17T10:00:00.000Z');
    const [start, end] = csat.getStats.mock.calls[0];
    expect(iso(start)).toBe('2026-11-01T03:00:00.000Z');
    expect(iso(end)).toBe('2026-11-17T10:00:00.000Z');
  });
});
