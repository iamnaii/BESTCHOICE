import type { AttendanceDayKind } from '@prisma/client';
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

  const minutesAfterStart = minutesBetween(startAt, clockIn);
  const lateMinutes = minutesAfterStart > rules.lateGraceMinutes ? minutesAfterStart : 0;

  let workedMinutes = 0;
  let earlyLeaveMinutes = 0;
  let otHours = 0;
  if (clockOut) {
    workedMinutes = Math.max(0, minutesBetween(clockIn, clockOut));
    const pastEnd = minutesBetween(endAt, clockOut);
    if (pastEnd >= 0) otHours = roundOtMinutes(pastEnd);
    else earlyLeaveMinutes = -pastEnd;
  }

  if (dayKind !== 'WORK') flags.push(WORKED_ON_OFF_DAY);
  return { workedMinutes, lateMinutes, earlyLeaveMinutes, otHours, flags };
}
