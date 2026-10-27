import { bangkokMidnight } from '../../../utils/date.util';
import { computeDaySummary, resolveRules, roundOtMinutes, workDateOf, type DaySummaryInput } from '../attendance-rules';

/** ก้อน 10 D3 Task 2 — กติกานับสาย/OT (สเปก §5) ตารางทอง */
const RULES = { workStart: '10:00', workEnd: '19:00', lateGraceMinutes: 15 };
const day = bangkokMidnight(2026, 9, 27); // จันทร์ 27 ต.ค. 2569 00:00 ไทย
const t = (h: number, m: number, d = day) => new Date(d.getTime() + (h * 60 + m) * 60_000);
const base: DaySummaryInput = { workDate: day, dayKind: 'WORK', clockIn: t(10, 2), clockOut: t(19, 10), rules: RULES };

describe('attendance rules', () => {
  it('R1 roundOtMinutes follows the 15/45 table (hours)', () => {
    // ตารางเจ้าของ: เศษ <15 ไม่คิด · 15–44 = 0.5 · 45–59 = 1 ⇒ 1 ชม. 50 นาที = 2 ชม. (ไม่ใช่ 1.5)
    expect([0, 14, 15, 44, 45, 59, 60, 74, 75, 104, 105, 110, 120].map(roundOtMinutes)).toEqual([0, 0, 0.5, 0.5, 1, 1, 1, 1, 1.5, 1.5, 2, 2, 2]);
  });

  it('R2 on time: in 10:02 out 19:10 → no late, OT 0, worked 548', () => {
    expect(computeDaySummary(base)).toEqual({ workedMinutes: 548, lateMinutes: 0, earlyLeaveMinutes: 0, otHours: 0, flags: [] });
  });

  it('R3 late counts from 10:00 once past the grace: 10:15 → 0, 10:16 → 16, 12:00 → 120', () => {
    expect(computeDaySummary({ ...base, clockIn: t(10, 15) }).lateMinutes).toBe(0);
    expect(computeDaySummary({ ...base, clockIn: t(10, 16) }).lateMinutes).toBe(16);
    expect(computeDaySummary({ ...base, clockIn: t(12, 0) }).lateMinutes).toBe(120);
  });

  it('R4 OT from clock-out: 19:14 → 0 · 19:15 → 0.5 · 19:45 → 1 · 20:30 → 1.5 · 20:50 → 2', () => {
    expect([t(19, 14), t(19, 15), t(19, 45), t(20, 30), t(20, 50)].map((out) => computeDaySummary({ ...base, clockOut: out }).otHours)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('R5 late and OT are kept separately: in 12:00 out 20:00 → late 120, OT 1', () => {
    expect(computeDaySummary({ ...base, clockIn: t(12, 0), clockOut: t(20, 0) })).toMatchObject({ lateMinutes: 120, otHours: 1 });
  });

  it('R6 early leave: out 18:30 → earlyLeaveMinutes 30, OT 0', () => {
    expect(computeDaySummary({ ...base, clockOut: t(18, 30) })).toMatchObject({ earlyLeaveMinutes: 30, otHours: 0 });
  });

  it('R7 clock-out after Thai midnight belongs to the IN day: in 23:50 out 00:20 → worked 30, OT 0.5 (OT counts only time actually worked after 19:00)', () => {
    const s = computeDaySummary({ ...base, clockIn: t(23, 50), clockOut: t(24, 20) });
    expect(s.workedMinutes).toBe(30);
    expect(s.otHours).toBe(0.5);
    expect(s.lateMinutes).toBe(830);
  });

  it('R7b arriving after work end: in 19:30 out 21:00 → OT 1.5 (from clock-in, not from 19:00)', () => {
    expect(computeDaySummary({ ...base, clockIn: t(19, 30), clockOut: t(21, 0) })).toMatchObject({ workedMinutes: 90, otHours: 1.5, earlyLeaveMinutes: 0 });
  });

  it('R7c a non-work day has no lateness or early leave: DAY_OFF in 13:00 out 17:00 → late 0, early 0, flag WORKED_ON_OFF_DAY', () => {
    expect(computeDaySummary({ ...base, dayKind: 'DAY_OFF', clockIn: t(13, 0), clockOut: t(17, 0) })).toEqual({ workedMinutes: 240, lateMinutes: 0, earlyLeaveMinutes: 0, otHours: 0, flags: ['WORKED_ON_OFF_DAY'] });
  });

  it('R8 workDateOf uses the Bangkok calendar: 00:20 on 28 Oct → 28 Oct; 23:59 on 27 Oct → 27 Oct; 02:00Z on 28 Oct (09:00 BKK) → 28 Oct', () => {
    expect(workDateOf(t(24, 20)).getTime()).toBe(bangkokMidnight(2026, 9, 28).getTime());
    expect(workDateOf(t(23, 59)).getTime()).toBe(day.getTime());
    expect(workDateOf(new Date('2026-10-28T02:00:00.000Z')).getTime()).toBe(bangkokMidnight(2026, 9, 28).getTime());
    expect(workDateOf(new Date('2026-10-27T18:00:00.000Z')).getTime()).toBe(bangkokMidnight(2026, 9, 28).getTime()); // 01:00 BKK 28 Oct
  });

  it('R9 worked on a DAY_OFF → WORKED_ON_OFF_DAY flag and OT still computed', () => {
    expect(computeDaySummary({ ...base, dayKind: 'DAY_OFF', clockOut: t(20, 0) })).toMatchObject({ flags: ['WORKED_ON_OFF_DAY'], otHours: 1 });
  });

  it('R10 missing clock-out → workedMinutes 0, otHours 0, earlyLeave 0 (late still counted)', () => {
    expect(computeDaySummary({ ...base, clockIn: t(10, 20), clockOut: null })).toEqual({ workedMinutes: 0, lateMinutes: 20, earlyLeaveMinutes: 0, otHours: 0, flags: [] });
  });

  it('R10b no punches at all on a non-work day → all zeros, no flags', () => {
    expect(computeDaySummary({ ...base, dayKind: 'LEAVE_SICK', clockIn: null, clockOut: null })).toEqual({ workedMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, otHours: 0, flags: [] });
  });

  it('R11 resolveRules: branch override wins, null falls back to the system rules', () => {
    expect(resolveRules(RULES, { workStart: '09:30', workEnd: null })).toEqual({ workStart: '09:30', workEnd: '19:00', lateGraceMinutes: 15 });
    expect(resolveRules(RULES, { workStart: null, workEnd: null })).toEqual(RULES);
  });
});
