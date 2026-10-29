import type { AttendanceDay, AttendanceDayKind } from '@prisma/client';
import { bangkokCalendarParts, bangkokMidnight } from '../../utils/date.util';

/**
 * กติกานับสาย/OT ของการลงเวลา (ก้อน 10 D3 · สเปก §5) — ฟังก์ชันบริสุทธิ์ตัวเดียว
 * ใช้ร่วมกันโดย kiosk (ตอนตอก) · cron ปิดวัน · การแก้ไขย้อนหลัง ⇒ preview === posted
 *
 * - เวลางานของวัน = วันไทย (bangkokMidnight) + 'HH:mm' ของกติกา · ไม่รับ timestamp จากอุปกรณ์
 * - สาย: นับนาทีจากเวลาเข้างาน (ไม่ใช่จากขอบผ่อนผัน) เฉพาะเมื่อเข้าช้ากว่า เวลาเข้างาน + ผ่อนผัน
 * - OT: นาทีหลังเวลาเลิกงาน ปัดตามตาราง <15 ไม่คิด · 15–44 = 0.5 ชม. · 45–59 = 1 ชม. (เจ้าของ 27/10)
 * - สายกับ OT เก็บแยกกัน ไม่หักกลบ (การหักกลบเป็นเรื่องของ D4 ตอนคิดเงิน)
 * - ค่าเงิน OT (1.5 × เงินเดือน÷30÷8) ไม่อยู่ที่นี่ — ก้อน D4
 */

export interface ScheduleRules {
  /** 'HH:mm' เวลาไทย */
  workStart: string;
  /** 'HH:mm' เวลาไทย */
  workEnd: string;
  /** นาทีผ่อนผันก่อนนับว่าสาย (ค่าเริ่มต้น 15) */
  lateGraceMinutes: number;
}

export interface DaySummaryInput {
  /** เที่ยงคืนไทยของวันทำงาน (ผลจาก `workDateOf`) */
  workDate: Date;
  dayKind: AttendanceDayKind;
  clockIn: Date | null;
  clockOut: Date | null;
  rules: ScheduleRules;
}

export interface DaySummary {
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** 0, 0.5, 1, 1.5 … */
  otHours: number;
  /** WORKED_ON_OFF_DAY เมื่อมีการตอกในวันที่ไม่ใช่วันทำงาน · MISSING_OUT ไม่ใส่ที่นี่ (cron ปิดวันเป็นคนใส่) */
  flags: string[];
}

export const WORKED_ON_OFF_DAY = 'WORKED_ON_OFF_DAY';

const MINUTE_MS = 60_000;

/** ปัดนาทีเกินเวลาเลิกงานเป็นชั่วโมง OT ตามตาราง 15/45 */
export function roundOtMinutes(minutesPastEnd: number): number {
  if (minutesPastEnd < 15) return 0;
  const whole = Math.floor(minutesPastEnd / 60);
  const rest = minutesPastEnd - whole * 60;
  const fraction = rest < 15 ? 0 : rest < 45 ? 0.5 : 1;
  return whole + fraction;
}

/** วันไทยที่ `at` อยู่ — คืนเป็นเที่ยงคืนไทย (ใช้เป็น `AttendanceDay.workDate`) */
export function workDateOf(at: Date): Date {
  const { year, month, day } = bangkokCalendarParts(at);
  return bangkokMidnight(year, month, day);
}

/**
 * `AttendanceDay.workDate` เป็น `@db.Date` — Prisma เก็บ "วันที่ในเขต UTC" ของ Date ที่ส่งไป
 * ⇒ ห้ามส่งเที่ยงคืนไทย (= 17:00Z ของวันก่อน จะถูกเก็บเป็นวันก่อน) · ส่ง/เทียบด้วย `dbDate()` และอ่านกลับด้วย `fromDbDate()` เสมอ
 */
export function dbDate(workDate: Date): Date {
  const { year, month, day } = bangkokCalendarParts(workDate);
  return new Date(Date.UTC(year, month, day));
}

/** ค่าที่ Prisma คืนจาก `@db.Date` (เที่ยงคืน UTC ของวันปฏิทิน) → เที่ยงคืนไทยของวันนั้น สำหรับคำนวณ */
export function fromDbDate(stored: Date): Date {
  return bangkokMidnight(stored.getUTCFullYear(), stored.getUTCMonth(), stored.getUTCDate());
}

/** 'YYYY-MM-DD' ของวันปฏิทินไทยที่ `workDate` (เที่ยงคืนไทย) แทน */
export function workDateString(workDate: Date): string {
  const { year, month, day } = bangkokCalendarParts(workDate);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 'HH:mm' → นาทีนับจากเที่ยงคืน · รูปแบบผิดโยน (ค่าตั้งค่าต้องถูกตรวจตั้งแต่ตอนบันทึก) */
export function parseClock(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) throw new Error(`invalid clock '${value}' (expected HH:mm)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** สาขาตั้งทับได้ · null = ใช้ค่าระบบ */
export function resolveRules(systemDefaults: ScheduleRules, branch: { workStart: string | null; workEnd: string | null }): ScheduleRules {
  return {
    workStart: branch.workStart ?? systemDefaults.workStart,
    workEnd: branch.workEnd ?? systemDefaults.workEnd,
    lateGraceMinutes: systemDefaults.lateGraceMinutes,
  };
}

const minutesBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / MINUTE_MS);

export function computeDaySummary(input: DaySummaryInput): DaySummary {
  const { workDate, dayKind, clockIn, clockOut, rules } = input;
  const flags: string[] = [];
  if (!clockIn) return { workedMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, otHours: 0, flags };

  const startAt = new Date(workDate.getTime() + parseClock(rules.workStart) * MINUTE_MS);
  const endAt = new Date(workDate.getTime() + parseClock(rules.workEnd) * MINUTE_MS);

  // วันที่ไม่ใช่วันทำงาน (หยุด/ลา/ร้านปิด) ไม่มีเวลาเข้างานที่ต้องตรง ⇒ ไม่นับสาย/ออกก่อน (มีแต่ธง WORKED_ON_OFF_DAY)
  const scheduled = dayKind === 'WORK';
  const minutesAfterStart = minutesBetween(startAt, clockIn);
  const lateMinutes = scheduled && minutesAfterStart > rules.lateGraceMinutes ? minutesAfterStart : 0;

  let workedMinutes = 0;
  let earlyLeaveMinutes = 0;
  let otHours = 0;
  if (clockOut) {
    workedMinutes = Math.max(0, minutesBetween(clockIn, clockOut));
    // OT = เวลาที่ทำจริงหลังเลิกงาน ⇒ นับจาก max(เวลาเลิกงาน, เวลาเข้า) — เข้าหลังเลิกงานไม่ได้ OT ย้อนไปถึง 19:00
    const otFrom = clockIn.getTime() > endAt.getTime() ? clockIn : endAt;
    const pastEnd = minutesBetween(endAt, clockOut);
    if (pastEnd >= 0) otHours = roundOtMinutes(Math.max(0, minutesBetween(otFrom, clockOut)));
    else if (scheduled) earlyLeaveMinutes = -pastEnd;
  }

  if (dayKind !== 'WORK') flags.push(WORKED_ON_OFF_DAY);
  return { workedMinutes, lateMinutes, earlyLeaveMinutes, otHours, flags };
}

/** ธงที่ cron ปิดวันใส่: ตอกเข้าแต่ไม่มีเวลาออก */
export const FLAG_MISSING_OUT = 'MISSING_OUT';
/** ธงที่ cron ปิดวันใส่: วันทำงานที่ไม่มีตอกเพราะเครื่องของสาขาใช้ไม่ได้ (ไม่นับว่าขาด) */
export const FLAG_DEVICE_UNAVAILABLE = 'DEVICE_UNAVAILABLE';

export type TodayStatus = 'ON_TIME' | 'LATE' | 'NOT_IN' | 'DAY_OFF' | 'LEAVE' | 'SHOP_CLOSED' | 'MISSING_OUT' | 'NO_PIN';
export type CellStatus = TodayStatus | 'ABSENT' | 'UNAVAILABLE' | 'NONE';

const LEAVE_KINDS: AttendanceDayKind[] = ['LEAVE_SICK', 'LEAVE_PERSONAL', 'LEAVE_OTHER'];

/** สถานะของแถววัน (ไม่มีแถว = ยังไม่มา) — หน้าลงเวลา "วันนี้" */
export function todayStatusOf(day: Pick<AttendanceDay, 'dayKind' | 'clockIn' | 'lateMinutes' | 'flags'> | null | undefined): TodayStatus {
  if (!day) return 'NOT_IN';
  if (day.clockIn) {
    if (day.flags.includes(FLAG_MISSING_OUT)) return 'MISSING_OUT';
    return day.lateMinutes > 0 ? 'LATE' : 'ON_TIME';
  }
  if (day.dayKind === 'DAY_OFF') return 'DAY_OFF';
  if (day.dayKind === 'SHOP_CLOSED') return 'SHOP_CLOSED';
  if (LEAVE_KINDS.includes(day.dayKind)) return 'LEAVE';
  return 'NOT_IN';
}

/**
 * สถานะช่องรายเดือน — แหล่งเดียวของ ABSENT / LEAVE ที่ `summarizeAttendanceMonth` นับ
 * ใช้ร่วมกันโดยหน้าลงเวลา (`AttendanceService.month/me`) และสรุปที่เก็บในใบเงินเดือน (`PayrollSystemRowsService`)
 * `today` = เที่ยงคืนไทยของวันนี้ (`workDateOf(now)`) — วันทำงานที่ไม่มีตอกก่อนวันนี้ = ขาด
 */
export function cellStatusOf(day: Pick<AttendanceDay, 'dayKind' | 'clockIn' | 'lateMinutes' | 'flags' | 'workDate'>, today: Date): CellStatus {
  const base = todayStatusOf(day);
  if (base !== 'NOT_IN') return base;
  if (day.flags.includes(FLAG_DEVICE_UNAVAILABLE)) return 'UNAVAILABLE';
  return fromDbDate(day.workDate).getTime() < today.getTime() ? 'ABSENT' : 'NONE';
}

export interface MonthSummary {
  workDays: number;
  lateCount: number;
  lateMinutes: number;
  absent: number;
  leave: number;
  otHours: number;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));

/** สรุปรายเดือนของพนักงานหนึ่งคน จากช่องรายวัน — ใช้ร่วมกันโดยหน้าลงเวลา (`AttendanceService.month/me`) */
export function summarizeAttendanceMonth(
  cells: Array<{ status: string; clockIn: Date | null; lateMinutes: number; otHours: unknown }>,
): MonthSummary {
  return cells.reduce<MonthSummary>(
    (acc, c) => ({
      workDays: acc.workDays + (c.clockIn ? 1 : 0),
      lateCount: acc.lateCount + (c.lateMinutes > 0 ? 1 : 0),
      lateMinutes: acc.lateMinutes + c.lateMinutes,
      absent: acc.absent + (c.status === 'ABSENT' ? 1 : 0),
      leave: acc.leave + (c.status === 'LEAVE' ? 1 : 0),
      otHours: Math.round((acc.otHours + num(c.otHours)) * 10) / 10,
    }),
    { workDays: 0, lateCount: 0, lateMinutes: 0, absent: 0, leave: 0, otHours: 0 },
  );
}
