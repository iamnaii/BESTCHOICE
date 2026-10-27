import { payrollCutoff } from '../payroll-pay';
import { PayrollPostGateService, payrollGateConflict } from '../payroll-post-gate.service';
import type { PayrollSystemRowsService } from '../payroll-system-rows.service';

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

/**
 * Task 8 fix round 1 (R15.2) — วันติดธงพาสาขาของวันนั้นไปด้วย ให้หน้าเว็บลิงก์ไปหน้าลงเวลาของสาขานั้นได้
 * (หน้ารายละเอียด `payrollGate.deviceConflicts` และ 409 `days` ใช้ชนิดเดียวกัน)
 */
describe('PayrollGateDay carries the day branch', () => {
  it('inspect() returns branchId with each device-conflict day', async () => {
    const client = {
      payrollDetail: {
        findUnique: jest.fn().mockResolvedValue({
          payrollPeriod: '2026-10',
          entityScope: 'SHOP',
          document: { branchId: 'doc-branch' },
          lines: [{ userId: 'u1', employeeName: 'สมศรี มีสุข', customIncome: [] }],
        }),
      },
      attendanceDay: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'd1', userId: 'u1', workDate: new Date(Date.UTC(2026, 9, 16)), branchId: 'day-branch' }]),
      },
    };
    const gate = new PayrollPostGateService({} as PayrollSystemRowsService);
    const view = await gate.inspect(client as never, 'pr-1', new Date('2026-11-02T00:00:00.000Z'));
    expect(view).toEqual({
      closableAt: null,
      deviceConflicts: [{ dayId: 'd1', userId: 'u1', employeeName: 'สมศรี มีสุข', date: '2026-10-16', branchId: 'day-branch' }],
    });
    expect(client.attendanceDay.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ branchId: true }) }),
    );
  });

  it('the 409 PAYROLL_DEVICE_CONFLICT body keeps branchId in `days` and the copy unchanged', () => {
    const days = [{ dayId: 'd1', userId: 'u1', employeeName: 'สมศรี มีสุข', date: '2026-10-16', branchId: 'day-branch' }];
    expect(payrollGateConflict.deviceConflict(days).getResponse()).toEqual({
      code: 'PAYROLL_DEVICE_CONFLICT',
      days,
      message:
        'อนุมัติไม่ได้ — มีวันที่ติดธง เครื่องถูกใช้ซ้อน 1 วัน (สมศรี มีสุข · 16 ต.ค.) ให้เจ้าของตรวจที่เมนู ลงเวลา แล้วกด "ตรวจแล้ว ล้างธง"',
    });
  });
});
