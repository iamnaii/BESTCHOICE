import { payrollCutoff } from '../payroll-pay';
import { payrollGateConflict } from '../payroll-post-gate.service';

/**
 * Payroll D4 ส่วนที่ 1 · R8 — วันที่ในข้อความเวลาปิดงวดมี พ.ศ. ("1 พ.ย. 2569") ตาม mockup
 * ⇒ งวด ธ.ค. ปิด "1 ม.ค. 2570" ไม่กำกวมว่าเป็นมกราคมปีไหน
 */
describe('payrollGateConflict — cutoff copy carries the Buddhist year', () => {
  const body = (e: { getResponse(): unknown }) => e.getResponse() as { code: string; closableAt: string; message: string };

  it.each([
    ['2026-10', '2026-11-01T11:00:00.000Z', '1 พ.ย. 2569'],
    ['2026-12', '2027-01-01T11:00:00.000Z', '1 ม.ค. 2570'],
  ])('period %s → closableAt %s · "%s 18:00" in SUBMIT_CUTOFF and POST_CUTOFF', (period, closableAt, thaiDate) => {
    const cutoff = payrollCutoff(period);
    expect(body(payrollGateConflict.submitCutoff(cutoff))).toEqual({
      code: 'PAYROLL_SUBMIT_CUTOFF',
      closableAt,
      message: `ส่งขออนุมัติได้ตั้งแต่ ${thaiDate} 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน ระหว่างนี้บันทึกร่างไว้ได้`,
    });
    expect(body(payrollGateConflict.postCutoff(cutoff))).toEqual({
      code: 'PAYROLL_CUTOFF',
      closableAt,
      message: `ลงบัญชีได้ตั้งแต่ ${thaiDate} 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน`,
    });
  });
});
