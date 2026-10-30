import { Prisma } from '@prisma/client';
import type { AttendanceDayKind, EmploymentType, PayrollDeductionSource } from '@prisma/client';
import { bangkokMidnight } from '../../../utils/date.util';
import { computeDaySummary, parseClock, roundOtMinutes, type ScheduleRules } from '../../attendance/attendance-rules';

/**
 * คณิตศาสตร์ค่าแรง OT / ทำงานวันหยุด ที่คิดจากการลงเวลา (D4 ส่วนที่ 1) — ฟังก์ชันบริสุทธิ์
 * - ฐานรายชั่วโมง = เงินเดือนทะเบียน ÷ 240 · ยอดเงินปัด HALF_UP 2 ตำแหน่ง "ครั้งเดียวต่อแถวต่อคนต่อเดือน" (รวมชั่วโมงก่อน)
 * - วันหยุด: ชั่วโมงทำงาน + OT คิดจากกติกาปัจจุบันของสาขา (ไม่ใช้ otHours ที่เก็บไว้) ⇒ ไม่จ่ายซ้ำ/ไม่ตกหล่นเมื่อกติกาเปลี่ยน
 */

export const HOURS_PER_MONTH = 240;
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const MINUTE_MS = 60_000;
const HOLIDAY_WORK_CAP_HOURS = 8;
const BREAK_MINUTES = 60;
const BREAK_THRESHOLD_MINUTES = 300;
const CUTOFF_HOUR = 18;

export function systemIncomeAmount(base: Prisma.Decimal, multiplier: Prisma.Decimal, hours: Prisma.Decimal): Prisma.Decimal {
  return base.mul(multiplier).mul(hours).div(HOURS_PER_MONTH).toDecimalPlaces(2, HALF_UP);
}

export function displayRate(base: Prisma.Decimal, multiplier: Prisma.Decimal): Prisma.Decimal {
  return base.mul(multiplier).div(HOURS_PER_MONTH).toDecimalPlaces(4, HALF_UP);
}

/**
 * ชั่วโมงทำงานวันหยุดที่จ่าย: ทับซ้อนของ [เข้า, ออก] กับ [เวลาเข้างาน, เวลาเลิกงาน] (นาทีปัดลง)
 * → พักเที่ยง (ทับซ้อน < 300 นาที ไม่หัก · ≥ 300 หัก 60 แต่ไม่ต่ำกว่า 299 ⇒ ไม่มีหน้าผา) → ปัด 15/45 → เพดาน 8 ชม. · ไม่มีเวลาออก = 0
 * - `workDate` ต้องเป็นเที่ยงคืนไทย (`fromDbDate(row.workDate)`) — ส่งค่า `@db.Date` ดิบ (เที่ยงคืน UTC) ช่วงเวลางานจะเลื่อน 7 ชม.
 */
export function holidayWorkHours(i: { workDate: Date; clockIn: Date | null; clockOut: Date | null; rules: ScheduleRules }): number {
  if (!i.clockIn || !i.clockOut) return 0;
  const startAt = i.workDate.getTime() + parseClock(i.rules.workStart) * MINUTE_MS;
  const endAt = i.workDate.getTime() + parseClock(i.rules.workEnd) * MINUTE_MS;
  const from = Math.max(i.clockIn.getTime(), startAt);
  const to = Math.min(i.clockOut.getTime(), endAt);
  const overlap = Math.max(0, Math.floor((to - from) / MINUTE_MS));
  const paid = overlap < BREAK_THRESHOLD_MINUTES ? overlap : Math.max(overlap - BREAK_MINUTES, BREAK_THRESHOLD_MINUTES - 1);
  return Math.min(roundOtMinutes(paid), HOLIDAY_WORK_CAP_HOURS);
}

export interface PayDay {
  /** เที่ยงคืนไทยของวันทำงาน (`fromDbDate(row.workDate)`) — ไม่ใช่ค่า `@db.Date` ดิบ (เที่ยงคืน UTC) ซึ่งเลื่อนช่วงเวลางาน 7 ชม. */
  workDate: Date;
  branchId: string;
  dayKind: AttendanceDayKind;
  clockIn: Date | null;
  clockOut: Date | null;
  otHours: Prisma.Decimal;
  lateMinutes: number;
  flags: string[];
}

export interface MonthPayHours {
  otHours: Prisma.Decimal;
  holidayHours: Prisma.Decimal;
  holidayOtHours: Prisma.Decimal;
  holidayWorkedDays: number;
}

export function monthPayHours(days: PayDay[], rulesFor: (branchId: string) => ScheduleRules): MonthPayHours {
  let ot = new Prisma.Decimal(0);
  let holidayHours = new Prisma.Decimal(0);
  let holidayOt = new Prisma.Decimal(0);
  let holidayWorkedDays = 0;
  for (const d of days) {
    if (!d.clockIn) continue;
    if (d.dayKind === 'WORK' || d.dayKind.startsWith('LEAVE_')) {
      ot = ot.add(d.otHours);
    } else if (d.dayKind === 'DAY_OFF' || d.dayKind === 'SHOP_CLOSED') {
      const rules = rulesFor(d.branchId);
      holidayWorkedDays += 1;
      holidayHours = holidayHours.add(holidayWorkHours({ workDate: d.workDate, clockIn: d.clockIn, clockOut: d.clockOut, rules }));
      holidayOt = holidayOt.add(
        computeDaySummary({ workDate: d.workDate, dayKind: d.dayKind, clockIn: d.clockIn, clockOut: d.clockOut, rules }).otHours,
      );
    }
  }
  return { otHours: ot, holidayHours, holidayOtHours: holidayOt, holidayWorkedDays };
}

function parsePeriod(period: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error(`invalid payroll period '${period}' (expected YYYY-MM)`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** 18:00 เวลาไทยของวันที่ 1 เดือนถัดจากงวด ('YYYY-MM') */
export function payrollCutoff(period: string): Date {
  const { year, month } = parsePeriod(period);
  const next = bangkokMidnight(year, month, 1); // month0 = month (1-based) ⇒ เดือนถัดไป
  return new Date(next.getTime() + CUTOFF_HOUR * 60 * 60 * 1000);
}

/** เที่ยงคืนไทยของวันที่ 1 ของงวด ('YYYY-MM') — คนที่ลาออกตั้งแต่วันนี้ยังอยู่ในใบเงินเดือนงวดนี้ได้ */
export function payrollPeriodStart(period: string): Date {
  const { year, month } = parsePeriod(period);
  return bangkokMidnight(year, month - 1, 1);
}

/** ล็อกงวดของสาขา + ฝั่ง — ตัวที่สองในลำดับ `post:${docId}` → นี่ → `payroll-attendance:*` */
export function payrollDocumentLockKey(branchId: string, period: string, scope: 'SHOP' | 'FINANCE'): string {
  return `payroll:${branchId}:${period}:${scope}`;
}

export function payrollAttendanceLockKey(userId: string, period: string): string {
  return `payroll-attendance:${userId}:${period}`;
}

/**
 * ล็อกค่าคอม/หักคืนค่าคอมของพนักงานขาย (D4 ส่วนที่ 2 · P2-R1) — ตัวสุดท้ายในลำดับ
 * `post:${docId}` → `payroll:…` → `payroll-attendance:*` → นี่ (บันทึก / ส่ง / อนุมัติ / ลงบัญชี) · กลับรายการ: `post:` → นี่
 * ไม่มีงวด: ใบงวด ต.ค. กับ พ.ย. แย่งค่าคอมตัวเดียวกันได้ (period ≤ งวด) · ผู้เขียนหักคืน (helper / cron / ยกเลิกใบขาย) ไม่ถือล็อกนี้
 */
export function payrollClawbackLockKey(userId: string): string {
  return `payroll-clawback:${userId}`;
}

export function isAutoOtEligible(p: { employmentType: EmploymentType; baseSalary: Prisma.Decimal | null } | null): boolean {
  return !!p && p.employmentType === 'MONTHLY' && !!p.baseSalary && p.baseSalary.gt(0);
}

/**
 * ฐานภาษี ภ.ง.ด.1 ของแถวเงินเดือน (D4 ส่วนที่ 2 · P2-R18) = ฐาน + รายได้ที่เสียภาษี − หักคืนค่าคอม (ขั้นต่ำ 0)
 * - รายการหักมือ (MANUAL) ไม่กระทบฐาน · หักคืนค่าคอมคือการเรียกคืนค่าคอมที่เคยจ่าย/เสียภาษีไปแล้ว
 * - นับเฉพาะแถวที่ `source === 'COMMISSION_CLAWBACK'` (ต้องส่ง `source` มาเสมอ)
 */
export function payrollTaxableGross(line: {
  baseSalary: Prisma.Decimal;
  customIncome?: Array<{ amount: Prisma.Decimal; isTaxable?: boolean }> | null;
  customDeduction?: Array<{ amount: Prisma.Decimal; source: PayrollDeductionSource }> | null;
}): Prisma.Decimal {
  const income = (line.customIncome ?? []).reduce(
    (s, r) => (r.isTaxable !== false ? s.add(r.amount) : s),
    new Prisma.Decimal(0),
  );
  const clawback = (line.customDeduction ?? []).reduce(
    (s, r) => (r.source === 'COMMISSION_CLAWBACK' ? s.add(r.amount) : s),
    new Prisma.Decimal(0),
  );
  const gross = line.baseSalary.add(income).sub(clawback);
  return gross.lt(0) ? new Prisma.Decimal(0) : gross;
}

/**
 * หัก ณ ที่จ่ายค่าคอม (คำตัดสินเจ้าของ 2026-10-29) = 3% ของ (ค่าคอมงวดนี้ − หักคืนค่าคอมในบรรทัดเดียวกัน) ไม่ต่ำกว่า 0 ·
 * HALF_UP 2 ตำแหน่งครั้งเดียวต่อบรรทัด · แยกแถวจากภาษีเงินเดือน (`whtAmount`) แต่ยื่น ภ.ง.ด.1 ใบเดียวกัน (`payrollLineWithheld`)
 */
export const COMMISSION_WHT_RATE = new Prisma.Decimal('0.03');
export const COMMISSION_WHT_NAME = 'หัก ณ ที่จ่ายค่าคอม 3%';

export function commissionWithholding(commission: Prisma.Decimal, clawback: Prisma.Decimal): Prisma.Decimal {
  const base = commission.minus(clawback);
  return base.lte(0) ? new Prisma.Decimal(0) : base.mul(COMMISSION_WHT_RATE).toDecimalPlaces(2, HALF_UP);
}

/**
 * ภาษีหัก ณ ที่จ่ายของแถวเงินเดือนที่ยื่น ภ.ง.ด.1 / 50 ทวิ / นำส่ง = ภาษีเงินเดือน + รายการหัก `COMMISSION_WHT`
 * (ต้องส่ง `source` ของรายการหักมาเสมอ — หักคืนค่าคอม/รายการหักมือไม่ใช่ภาษี)
 */
export function payrollLineWithheld(line: {
  whtAmount: Prisma.Decimal;
  customDeduction?: Array<{ amount: Prisma.Decimal; source: PayrollDeductionSource }> | null;
}): Prisma.Decimal {
  return (line.customDeduction ?? []).reduce(
    (s, r) => (r.source === 'COMMISSION_WHT' ? s.add(r.amount) : s),
    new Prisma.Decimal(line.whtAmount.toString()),
  );
}
