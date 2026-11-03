import { NOT_SENT_REASON_TEXT, describeSendOutcome } from './send-outcome';
import { isWithinBusinessHours } from '../../utils/business-hours.util';

/**
 * Task 34 รีวิว M2 — ข้อความเหตุผลต้องตรงกติกาจริงและชี้ทางที่ทำได้วันนี้ (coding-standards "ข้อความ error ต้องชี้ทางที่ทำได้จริงวันนี้")
 */
describe('send-outcome — ข้อความเหตุผล', () => {
  it('HOLIDAY_BLOCK ตรงกติกาเวลาวันหยุดจริง (ส่งได้ 08:00–18:00 น. — business-hours.util) ไม่บอกว่าวันหยุดส่งไม่ได้เลย', () => {
    // วันหยุด 10:00 น. ไทย = ในเวลา · 18:00 น. = นอกเวลา (กติกาที่ข้อความต้องตรง)
    expect(isWithinBusinessHours(new Date('2026-11-08T03:00:00Z'), true)).toBe(true);
    expect(isWithinBusinessHours(new Date('2026-11-08T11:00:00Z'), true)).toBe(false);
    expect(NOT_SENT_REASON_TEXT.HOLIDAY_BLOCK).toContain('08:00–18:00 น.');
    expect(NOT_SENT_REASON_TEXT.HOLIDAY_BLOCK).not.toContain('ส่งใหม่ได้ในวันทำการ');
  });

  it('BLOCKED (เหตุผลอื่น เช่นแม่แบบถูกปิดใช้) บอกทางต่อที่มีจริง — โทรหาลูกค้า (ปุ่มโทร/บันทึกการโทรมีในคิวทวงถามและ inbox)', () => {
    const outcome = describeSendOutcome({ status: 'BLOCKED', blockReason: 'TEMPLATE_INACTIVE' });
    expect(outcome).toEqual({
      sent: false,
      reason: 'BLOCKED',
      reasonText: NOT_SENT_REASON_TEXT.BLOCKED,
    });
    expect(NOT_SENT_REASON_TEXT.BLOCKED).toMatch(/^ไม่ได้ส่ง — .+ · ติดต่อลูกค้าทางโทรศัพท์แทน$/);
  });

  it('ไม่มีความยินยอม — ไม่ผูกกับช่องทาง LINE (canSend ระงับทาง SMS ด้วย)', () => {
    expect(NOT_SENT_REASON_TEXT.NO_CONSENT).not.toContain('ทาง LINE');
  });
});
