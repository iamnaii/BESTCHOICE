import { PeakController } from './peak.controller';

/**
 * POST /peak/export — startDate/endDate 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิมใช้ new Date('YYYY-MM-DD') = 07:00 น. ไทยทั้งสองขอบ ⇒ รายการ 00:00–06:59 น. ของวันเริ่ม
 * (รายการตั้งลูกหนี้งวด / ค่าเผื่อฯ ที่ cron ลงหลังเที่ยงคืน) ไม่ถูกส่ง และทุกรายการหลัง 07:00 น. ของวันสิ้นสุดไม่ถูกส่ง
 * ขอบวันเขียนด้วย journalEntry.entryDate gte/lte ใน PeakService.exportJournalEntries (ไม่แก้ — รับ Date อยู่แล้ว)
 */
describe('PeakController.exportEntries — ช่วงวันที่', () => {
  const peakService = { exportJournalEntries: jest.fn().mockResolvedValue({ exported: 0, skipped: 0, errors: [] }) };
  const controller = new PeakController(peakService as never);

  beforeEach(() => jest.clearAllMocks());

  it('ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await controller.exportEntries({ startDate: '2026-11-01', endDate: '2026-11-17' });
    const [from, to] = peakService.exportJournalEntries.mock.calls[0];
    expect(from.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-17T16:59:59.999Z');
  });

  it('รายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await controller.exportEntries({ startDate: '2026-11-01', endDate: '2026-11-17' });
    const [from, to] = peakService.exportJournalEntries.mock.calls[0];
    const accrual = new Date('2026-11-01T00:00:00+07:00');
    const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
    expect(accrual >= from && accrual <= to).toBe(true);
    expect(nextMidnight <= to).toBe(false);
  });

  it('ค่าที่ไม่ใช่ YYYY-MM-DD (ISO เต็มที่ @IsDateString รับ) ผ่านไปตามที่ส่งมา ไม่ขยายเป็นสิ้นวัน', async () => {
    await controller.exportEntries({
      startDate: '2026-11-01T03:00:00.000Z',
      endDate: '2026-11-17T03:04:05.000Z',
    });
    const [from, to] = peakService.exportJournalEntries.mock.calls[0];
    expect(from.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-17T03:04:05.000Z');
  });
});
