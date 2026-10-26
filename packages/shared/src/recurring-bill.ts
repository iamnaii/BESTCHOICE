/**
 * บิลประจำ (recurring bills) — กติกางวด/วันครบกำหนดที่ API และเว็บใช้ร่วมกัน
 *
 * ทุกฟังก์ชันเป็น pure function บน "วันปฏิทินไทย" (`CalendarDate` = เลข Gregorian ใน
 * Asia/Bangkok) ไม่ขึ้นกับ TZ ของโปรเซส — ตัวเดียวที่แตะ `Date` คือ `bkkCalendarDate`
 * ซึ่งแปลงผ่าน `Intl` ด้วย timeZone คงที่ (precedent `appointment-confirmation.ts`).
 *
 * Spec: docs/superpowers/specs/2026-10-26-recurring-bill-reminders-design.md §6, §15
 */

export type RecurrenceKind = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type RecurringBillStatus = 'PENDING' | 'PAID' | 'SKIPPED';
export type RecurringBillViewStatus =
  | 'UPCOMING'
  | 'PENDING'
  | 'DUE_TODAY'
  | 'OVERDUE'
  | 'PAID'
  | 'PAID_UNPOSTED'
  | 'SKIPPED';

export interface RecurringRule {
  recurrence: RecurrenceKind;
  /** วันที่ของเดือน 1–31 — เดือนที่มีไม่ถึงใช้วันสุดท้าย */
  recurringDay: number;
  /** QUARTERLY: 1–3 (เดือนที่เท่าไรของไตรมาส) · YEARLY: 1–12 · MONTHLY: null */
  recurringMonth: number | null;
}

/** วันปฏิทิน (Gregorian) ในเขตเวลาไทย — ไม่มีเวลา ไม่มี TZ */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export const RECURRING_BILL_NOTIFY_ROLES = ['OWNER', 'ACCOUNTANT'] as const;
export const RECURRING_BILL_TODO_TAG = 'recurring-bill';
export const RECURRING_BILL_CATCHUP_DAYS = 7;
export const RECURRING_BILL_DEFAULT_LEAD_DAYS = 3;
export const RECURRING_BILL_LEAD_DAYS_MAX = 30;
export const RECURRING_BILL_SKIP_REASON = { min: 5, max: 200 } as const;
export const RECURRING_BILL_PAID_NOTE_MAX = 200;
/** `startsOn` ย้อนหลังได้ไม่เกินนี้ (กันไล่สร้างงวด SKIPPED ย้อนหลังเป็นสิบแถว) */
export const RECURRING_BILL_STARTS_ON_MAX_PAST_DAYS = 90;
export const RECURRING_BILL_STARTS_ON_MAX_FUTURE_DAYS = 365;

export const RECURRING_BILL_ERROR = {
  NOT_PENDING: 'งวดนี้ไม่ได้อยู่ในสถานะรอจ่าย',
  STATE_CHANGED: 'สถานะของงวดเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่',
  TEMPLATE_DELETED: 'แม่แบบบิลนี้ถูกลบแล้ว — บันทึกว่าจ่ายแล้ว หรือข้ามงวดนี้แทน',
  DRAFT_EXISTS: 'งวดนี้มีร่างใบรายจ่ายอยู่แล้ว',
  PAID_BY_DOCUMENT: (number: string) =>
    `งวดนี้จ่ายผ่านใบ ${number} แล้ว — ถ้ายกเลิกใบนั้น ระบบจะเปิดงวดให้เองในรอบตรวจถัดไป`,
} as const;

const THAI_MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const BKK_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** วันปฏิทินไทยของ instant นั้น (17:00Z = เที่ยงคืนไทยของวันถัดไป) */
export function bkkCalendarDate(date: Date): CalendarDate {
  const [y, m, d] = BKK_FORMATTER.format(date).split('-').map((n) => parseInt(n, 10));
  return { year: y, month: m, day: d };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function clampDay(year: number, month: number, day: number): number {
  return Math.min(Math.max(1, Math.floor(day)), daysInMonth(year, month));
}

function toOrdinal(d: CalendarDate): number {
  return Math.round(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000);
}

function fromOrdinal(n: number): CalendarDate {
  const dt = new Date(n * 86_400_000);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function compareCalendarDate(a: CalendarDate, b: CalendarDate): number {
  return toOrdinal(a) - toOrdinal(b);
}

export function addCalendarDays(d: CalendarDate, days: number): CalendarDate {
  return fromOrdinal(toOrdinal(d) + days);
}

/** จำนวนวันจาก `from` ถึง `to` (บวก = `to` อยู่หลัง) */
export function calendarDayDiff(from: CalendarDate, to: CalendarDate): number {
  return toOrdinal(to) - toOrdinal(from);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function quarterOf(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

/** periodKey ของงวดที่ครอบวันนั้น — MONTHLY `YYYY-MM` · QUARTERLY `YYYY-Qn` · YEARLY `YYYY` */
export function periodKeyFor(rule: RecurringRule, date: CalendarDate): string {
  switch (rule.recurrence) {
    case 'MONTHLY':
      return `${date.year}-${pad2(date.month)}`;
    case 'QUARTERLY':
      return `${date.year}-Q${quarterOf(date.month)}`;
    case 'YEARLY':
      return String(date.year);
  }
}

function parsePeriodKey(rule: RecurringRule, periodKey: string): { year: number; unit: number } {
  const m =
    rule.recurrence === 'MONTHLY'
      ? /^(\d{4})-(\d{2})$/.exec(periodKey)
      : rule.recurrence === 'QUARTERLY'
        ? /^(\d{4})-Q([1-4])$/.exec(periodKey)
        : /^(\d{4})$/.exec(periodKey);
  if (!m) throw new Error(`periodKey ไม่ตรงรูปแบบของ ${rule.recurrence}: ${periodKey}`);
  return { year: parseInt(m[1], 10), unit: m[2] ? parseInt(m[2], 10) : 1 };
}

/** วันครบกำหนดของงวด (วัน clamp ตามจำนวนวันของเดือนนั้น) */
export function dueDateForPeriod(rule: RecurringRule, periodKey: string): CalendarDate {
  const { year, unit } = parsePeriodKey(rule, periodKey);
  let month: number;
  switch (rule.recurrence) {
    case 'MONTHLY':
      month = unit;
      break;
    case 'QUARTERLY':
      month = (unit - 1) * 3 + Math.min(3, Math.max(1, rule.recurringMonth ?? 1));
      break;
    case 'YEARLY':
      month = Math.min(12, Math.max(1, rule.recurringMonth ?? 1));
      break;
  }
  return { year, month, day: clampDay(year, month, rule.recurringDay) };
}

export function nextPeriodKey(rule: RecurringRule, periodKey: string): string {
  const { year, unit } = parsePeriodKey(rule, periodKey);
  switch (rule.recurrence) {
    case 'MONTHLY':
      return unit === 12 ? `${year + 1}-01` : `${year}-${pad2(unit + 1)}`;
    case 'QUARTERLY':
      return unit === 4 ? `${year + 1}-Q1` : `${year}-Q${unit + 1}`;
    case 'YEARLY':
      return String(year + 1);
  }
}

/** `count` งวดแรกที่วันครบกำหนด ≥ `start` (วันเดียวกันนับ) */
export function periodsFrom(rule: RecurringRule, start: CalendarDate, count: number): string[] {
  const out: string[] = [];
  let key = periodKeyFor(rule, start);
  // กันลูปไม่รู้จบถ้า count ผิดปกติ — ไล่ได้ไม่เกิน 2 เท่าของที่ขอ + 2
  for (let guard = 0; out.length < count && guard < count * 2 + 2; guard++) {
    if (compareCalendarDate(dueDateForPeriod(rule, key), start) >= 0) out.push(key);
    key = nextPeriodKey(rule, key);
  }
  return out;
}

/** วันที่หน้าต่างเตือนของงวดเปิด = วันครบกำหนด − leadDays */
export function reminderWindowOpens(rule: RecurringRule, periodKey: string, leadDays: number): CalendarDate {
  return addCalendarDays(dueDateForPeriod(rule, periodKey), -Math.max(0, Math.floor(leadDays)));
}

/**
 * ช่วงวันที่เอกสารที่ "นับเป็นของงวดนี้" = [หน้าต่างงวดนี้เปิด, หน้าต่างงวดถัดไปเปิด)
 * ใช้จับคู่ใบรายจ่ายที่คนสร้างเองจากแม่แบบเดียวกัน (สเปก §15.3)
 */
export function matchWindow(
  rule: RecurringRule,
  periodKey: string,
  leadDays: number,
): { from: CalendarDate; to: CalendarDate } {
  return {
    from: reminderWindowOpens(rule, periodKey, leadDays),
    to: reminderWindowOpens(rule, nextPeriodKey(rule, periodKey), leadDays),
  };
}

export function formatPeriodLabelTh(rule: RecurringRule, periodKey: string): string {
  const { year, unit } = parsePeriodKey(rule, periodKey);
  const thaiYear = year + 543;
  switch (rule.recurrence) {
    case 'MONTHLY':
      return `${THAI_MONTH_ABBR[unit - 1]} ${thaiYear}`;
    case 'QUARTERLY':
      return `ไตรมาส ${unit}/${thaiYear}`;
    case 'YEARLY':
      return `ปี ${thaiYear}`;
  }
}

/** `28 ต.ค. 69` (short) หรือ `28 ต.ค. 2569` (full) */
export function formatCalendarDateTh(d: CalendarDate, year: 'short' | 'full' = 'short'): string {
  const thaiYear = d.year + 543;
  const y = year === 'full' ? String(thaiYear) : pad2(thaiYear % 100);
  return `${d.day} ${THAI_MONTH_ABBR[d.month - 1]} ${y}`;
}
