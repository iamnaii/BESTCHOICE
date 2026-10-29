import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dbDate } from '../../../attendance/attendance-rules';
import { bangkokMidnight } from '../../../../utils/date.util';
import { mergePayrollLines, type ClientPayrollLine } from '../payroll-save';
import { PayrollSystemRowsService } from '../payroll-system-rows.service';

/**
 * Payroll D4 ส่วนที่ 1 · R20 (FX1) — กติกาแถว OT ที่กรอกเองซ้ำ (MANUAL_OT_DUPLICATE) ใช้ได้เฉพาะบรรทัดที่ระบบคิด OT ให้
 * **และ** เดือนนี้มีข้อมูลลงเวลาของคนนั้น (`autoOtEligible && attendanceTracked`) — คนที่ไม่มีแถวลงเวลาในงวดเลย
 * (ไม่มีรหัสตอกบัตร · สาขาไม่มีเครื่อง · ส่วนกลาง · ก่อนเริ่มใช้) ระบบไม่คิด OT ให้ ⇒ แถวที่กรอกเองต้องรับเป็น MANUAL
 * compute ตัวจริงบน client ปลอม (ไม่มีฐานข้อมูล) → mergePayrollLines ตัวจริง
 */

const D = (v: number | string) => new Prisma.Decimal(v);
const PERIOD = '2026-10';
const NOW = new Date('2026-11-02T03:00:00.000Z'); // หลังเวลาปิดงวด — ไม่มีคำเตือน NOT_YET_CLOSABLE
const OT_CODE = 'S52-1202';

interface Fixture {
  pin: boolean;
  days: Array<{ dayKind?: 'WORK' | 'DAY_OFF' | 'LEAVE_SICK'; clockIn?: string; clockOut?: string; otHours?: number }>;
}

/** client ปลอมที่ตอบเฉพาะ query ที่ compute ใช้ · ผู้ใช้คนเดียว u1 รายเดือน เงินเดือนทะเบียน 15,000 */
function fakeClient(f: Fixture) {
  const day = bangkokMidnight(2026, 9, 5);
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(day.getTime() + (h * 60 + m) * 60_000);
  };
  return {
    accountRoleMap: {
      findMany: jest.fn().mockResolvedValue([
        { role: 'shop_payroll_holiday', accountCode: OT_CODE },
        { role: 'shop_payroll_overtime', accountCode: OT_CODE },
      ]),
    },
    attendanceDay: {
      findMany: jest.fn().mockResolvedValue(
        f.days.map((d, i) => ({
          id: `day-${i}`,
          userId: 'u1',
          branchId: 'b1',
          workDate: dbDate(day),
          dayKind: d.dayKind ?? 'WORK',
          clockIn: d.clockIn ? at(d.clockIn) : null,
          clockOut: d.clockOut ? at(d.clockOut) : null,
          otHours: D(d.otHours ?? 0),
          lateMinutes: 0,
          flags: [],
        })),
      ),
    },
    employeeProfile: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1', employmentType: 'MONTHLY', baseSalary: D(15000) }]) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', attendancePinHash: f.pin ? 'pin-hash' : null }]) },
    payrollLine: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

const settings = { getRules: jest.fn().mockResolvedValue({ workStart: '10:00', workEnd: '19:00', lateGraceMinutes: 15 }) };
const service = new PayrollSystemRowsService(settings as never);

const typedOtLine = (income: Partial<ClientPayrollLine['customIncome'][number]> = {}): ClientPayrollLine => ({
  userId: 'u1',
  employeeName: 'สมศรี มีสุข',
  employeeTaxId: null,
  baseSalary: D(15000),
  ssoEmployee: D(750),
  whtAmount: D(0),
  customIncome: [{ accountCode: OT_CODE, name: 'OT ที่กรอกเอง', amount: D(500), isTaxable: true, source: 'MANUAL', ...income }],
  customDeduction: [],
});

async function computeAndMerge(f: Fixture, line = typedOtLine()) {
  const system = await service.compute(fakeClient(f) as never, {
    branchId: 'b1',
    entityScope: 'SHOP',
    payrollPeriod: PERIOD,
    userIds: ['u1'],
    now: NOW,
  });
  return { system, merged: () => mergePayrollLines([line], system, NOW) };
}

describe('mergePayrollLines — typed OT when the month has no attendance data (R20 FX1)', () => {
  it('MONTHLY, no PIN, no attendance rows + typed S52-1202 → accepted as MANUAL · NO_PIN warning · summary says untracked', async () => {
    const { system, merged } = await computeAndMerge({ pin: false, days: [] });
    expect(system.rows[0]).toMatchObject({ autoOtEligible: true, attendanceTracked: false, systemIncome: [] });
    const { lines, totals } = merged();
    expect(lines[0].customIncome.map((i) => [i.source, i.accountCode, i.amount.toFixed(2)])).toEqual([['MANUAL', OT_CODE, '500.00']]);
    expect(lines[0].netPaid.toFixed(2)).toBe('14750.00'); // 15,000 + 500 − 750
    expect(lines[0].systemNotes?.warnings).toEqual([{ code: 'NO_PIN' }]);
    expect(lines[0].attendanceSummary).toMatchObject({ autoOtEligible: true, attendanceTracked: false });
    expect(totals.totalAmount.toFixed(2)).toBe('15500.00');
  });

  it('MONTHLY with a PIN but no attendance rows (e.g. a branch with no kiosk device) → accepted as MANUAL with the NO_ATTENDANCE warning', async () => {
    const { system, merged } = await computeAndMerge({ pin: true, days: [] });
    expect(system.rows[0]).toMatchObject({ autoOtEligible: true, attendanceTracked: false });
    const { lines } = merged();
    expect(lines[0].customIncome.map((i) => i.source)).toEqual(['MANUAL']);
    expect(lines[0].systemNotes?.warnings).toEqual([{ code: 'NO_ATTENDANCE' }]);
  });

  it('a user with attendance rows in the period + typed OT → still 400 MANUAL_OT_DUPLICATE (also when the rows carry no OT)', async () => {
    for (const days of [[{ clockIn: '10:00', clockOut: '20:30', otHours: 1.5 }], [{ clockIn: '10:00', clockOut: '19:00' }]]) {
      const { system, merged } = await computeAndMerge({ pin: true, days });
      expect(system.rows[0]).toMatchObject({ autoOtEligible: true, attendanceTracked: true });
      expect(system.rows[0].notes.warnings).toEqual([]);
      const err = (() => {
        try {
          merged();
        } catch (e) {
          return e;
        }
        throw new Error('expected MANUAL_OT_DUPLICATE');
      })();
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'MANUAL_OT_DUPLICATE' });
    }
  });

  it('R23: planning-only rows (DAY_OFF / LEAVE set from the schedule tab, no clock-in) do not make the month tracked → typed OT accepted as MANUAL', async () => {
    const planned = [{ dayKind: 'DAY_OFF' as const }, { dayKind: 'LEAVE_SICK' as const }];
    for (const [pin, warning] of [[false, 'NO_PIN'], [true, 'NO_ATTENDANCE']] as const) {
      const { system, merged } = await computeAndMerge({ pin, days: planned });
      expect(system.rows[0]).toMatchObject({ autoOtEligible: true, attendanceTracked: false, systemIncome: [] });
      const { lines } = merged();
      expect(lines[0].customIncome.map((i) => [i.source, i.amount.toFixed(2)])).toEqual([['MANUAL', '500.00']]);
      expect(lines[0].systemNotes?.warnings).toEqual([{ code: warning }]);
      expect(lines[0].attendanceSummary).toMatchObject({ attendanceTracked: false });
    }
  });

  it('R23: one punched day (clock-in) among planned rows makes the month tracked → typed OT refused', async () => {
    const { system, merged } = await computeAndMerge({ pin: true, days: [{ dayKind: 'DAY_OFF' }, { clockIn: '10:00' }] });
    expect(system.rows[0]).toMatchObject({ attendanceTracked: true });
    expect(system.rows[0].notes.warnings).toEqual([]);
    expect(merged).toThrow(BadRequestException);
  });

  it('a tracked user may still carry a typed OT row ticked รายการปรับปรุงงวดก่อน (ADJUSTMENT)', async () => {
    const { merged } = await computeAndMerge({ pin: true, days: [{ clockIn: '10:00', clockOut: '20:30', otHours: 1.5 }] }, typedOtLine({ source: 'ADJUSTMENT' }));
    expect(merged().lines[0].customIncome.map((i) => i.source)).toEqual(['ADJUSTMENT', 'ATTENDANCE_OT']);
  });
});

/**
 * คำตัดสินเจ้าของ 2026-10-29 — ใบจากปุ่มใช้แม่แบบ (สร้างทันทีไม่ผ่านฟอร์ม ไม่มีโอกาสลบแถวเอง) ตัดแถว OT ที่กรอกเองของบรรทัดที่ระบบคิด OT ให้
 * ออกเอง + คำเตือน TYPED_OT_REMOVED บนบรรทัดนั้น · ทางฟอร์มยังปฏิเสธ MANUAL_OT_DUPLICATE ตามเดิม
 */
describe('mergePayrollLines — stripTypedOt (use template)', () => {
  const tracked = { pin: true, days: [{ clockIn: '10:00', clockOut: '20:30', otHours: 1.5 }] };

  it('tracked user + typed OT on an attendance account → typed rows removed, system OT kept, TYPED_OT_REMOVED {count, amount} on that line', async () => {
    const line: ClientPayrollLine = {
      ...typedOtLine(),
      customIncome: [
        { accountCode: OT_CODE, name: 'OT ที่กรอกเอง', amount: D(500), isTaxable: true, source: 'MANUAL' },
        { accountCode: OT_CODE, name: 'OT วันหยุด', amount: D(250.5), isTaxable: true, source: 'MANUAL' },
        { accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: D(300), isTaxable: true, source: 'MANUAL' },
        { accountCode: OT_CODE, name: 'ปรับ OT เดือนก่อน', amount: D(100), isTaxable: true, source: 'ADJUSTMENT' },
      ],
    };
    const { system } = await computeAndMerge(tracked, line);
    const { lines, totals } = mergePayrollLines([line], system, NOW, { stripTypedOt: true });
    expect(lines[0].customIncome.map((i) => [i.source, i.name])).toEqual([
      ['MANUAL', 'เบี้ยขยัน'],
      ['ADJUSTMENT', 'ปรับ OT เดือนก่อน'],
      ['ATTENDANCE_OT', expect.any(String)],
    ]);
    expect(lines[0].systemNotes?.warnings).toEqual([{ code: 'TYPED_OT_REMOVED', count: 2, amount: '750.50' }]);
    const systemOt = lines[0].customIncome.find((i) => i.source === 'ATTENDANCE_OT')!.amount;
    expect(totals.totalAmount.toFixed(2)).toBe(D(15000).plus(300).plus(100).plus(systemOt).toFixed(2));
  });

  it('untracked user keeps the typed OT as MANUAL (nothing to strip, no TYPED_OT_REMOVED)', async () => {
    const { system } = await computeAndMerge({ pin: true, days: [] });
    const { lines } = mergePayrollLines([typedOtLine()], system, NOW, { stripTypedOt: true });
    expect(lines[0].customIncome.map((i) => [i.source, i.amount.toFixed(2)])).toEqual([['MANUAL', '500.00']]);
    expect(lines[0].systemNotes?.warnings).toEqual([{ code: 'NO_ATTENDANCE' }]);
  });

  it('without the option the same tracked line is still refused MANUAL_OT_DUPLICATE', async () => {
    const { merged } = await computeAndMerge(tracked);
    expect(merged).toThrow(BadRequestException);
  });
});
