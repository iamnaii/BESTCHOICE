import { LATE_PAYMENT_SQL } from './payment-watch-risk.util';

/**
 * "ชำระล่าช้า" ของ watch list = จ่ายในวันตามปฏิทินไทยที่หลังวันครบกำหนดตามปฏิทินไทย (2026-11-18)
 * เดิม p.paid_date::date > p.due_date::date ตัดวันตาม UTC — due_date เก็บเที่ยงคืนไทย (= 17:00Z ของวันก่อน)
 * ⇒ วันครบกำหนดถูกนับเป็นวันก่อนหน้า และจ่ายตรงวันครบกำหนดหลัง 07:00 น. ถูกนับว่าล่าช้า
 */
describe('LATE_PAYMENT_SQL', () => {
  it('เทียบวันไทยของ paid_date กับวันไทยของ due_date (alias p) ไม่มีพารามิเตอร์', () => {
    expect(LATE_PAYMENT_SQL.sql).toBe(
      "p.paid_date IS NOT NULL AND ((p.paid_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date > ((p.due_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date",
    );
    expect(LATE_PAYMENT_SQL.values).toEqual([]);
  });
});
