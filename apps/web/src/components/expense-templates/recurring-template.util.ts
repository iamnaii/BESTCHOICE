import {
  bkkCalendarDate,
  compareCalendarDate,
  dueDateForPeriod,
  formatCalendarDateTh,
  periodKeyFor,
  periodsFrom,
  reminderWindowOpens,
  type CalendarDate,
  type RecurrenceKind,
  type RecurringRule,
} from '@installment/shared';

/** ฟิลด์กติกาบนแม่แบบ (ชื่อเดียวกับ ExpenseTemplate ฝั่ง API) */
export interface RecurringRuleFields {
  recurrence: RecurrenceKind | null;
  recurringDay: number | null;
  recurringMonth: number | null;
}

export const MONTH_ABBR_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const MONTH_NAMES_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
/** ราย 3 เดือน: เดือนที่ n ของไตรมาส → 4 เดือนที่ตก */
export const QUARTER_MONTHS_TH: ReadonlyArray<readonly string[]> = [
  ['ม.ค.', 'เม.ย.', 'ก.ค.', 'ต.ค.'],
  ['ก.พ.', 'พ.ค.', 'ส.ค.', 'พ.ย.'],
  ['มี.ค.', 'มิ.ย.', 'ก.ย.', 'ธ.ค.'],
];
const pad2 = (n: number) => String(n).padStart(2, '0');

export function ruleOfTemplate(t: RecurringRuleFields): RecurringRule | null {
  if (!t.recurrence || !t.recurringDay) return null;
  if (t.recurrence !== 'MONTHLY' && !t.recurringMonth) return null;
  return { recurrence: t.recurrence, recurringDay: t.recurringDay, recurringMonth: t.recurrence === 'MONTHLY' ? null : t.recurringMonth };
}

export function recurrenceText(rule: RecurringRule): string {
  switch (rule.recurrence) {
    case 'MONTHLY':
      return 'รายเดือน';
    case 'QUARTERLY':
      return `ราย 3 เดือน (${(QUARTER_MONTHS_TH[(rule.recurringMonth ?? 1) - 1] ?? QUARTER_MONTHS_TH[0]).join('/')})`;
    case 'YEARLY':
      return `รายปี (${MONTH_ABBR_TH[(rule.recurringMonth ?? 1) - 1] ?? ''})`;
  }
}

export function calendarKey(d: CalendarDate): string {
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

export function monthKeyOf(d: CalendarDate): string {
  return `${d.year}-${pad2(d.month)}`;
}

/** วันปฏิทินไทยของ ISO (null/ไม่ถูกต้อง → null) */
export function calendarOfIso(iso: string | null | undefined): CalendarDate | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : bkkCalendarDate(d);
}

export interface UpcomingPeriod {
  key: string;
  due: CalendarDate;
  windowOpens: CalendarDate;
}

/**
 * งวดที่จะถูกนับต่อจากนี้: ครบกำหนด ≥ max(startsOn, วันนี้) — งวดที่ผ่านไปแล้วไม่ถูกสร้างย้อนหลัง (สเปก §4)
 * (ความจริง cron ยังเก็บงวดที่เพิ่งผ่านไม่เกิน 7 วันเป็น "เกินกำหนด" ด้วย — แต่ "งวดถัดไป" ของการ์ด/พรีวิวหมายถึงอนาคต)
 */
export function upcomingPeriods(rule: RecurringRule, leadDays: number, startsOn: CalendarDate | null, now: Date, count = 3): UpcomingPeriod[] {
  const today = bkkCalendarDate(now);
  const start = startsOn && compareCalendarDate(startsOn, today) > 0 ? startsOn : today;
  return periodsFrom(rule, start, count).map((key) => ({
    key,
    due: dueDateForPeriod(rule, key),
    windowOpens: reminderWindowOpens(rule, key, Math.max(0, leadDays)),
  }));
}

/** บรรทัดบนการ์ดรายการโปรด: "ทุกวันที่ 24 · รายเดือน · เตือนล่วงหน้า 3 วัน · งวดถัดไป 24 พ.ย. 69" */
export function recurringCardLine(t: RecurringRuleFields & { reminderLeadDays: number; startsOn: string | null }, now: Date): string | null {
  const rule = ruleOfTemplate(t);
  if (!rule) return null;
  const [next] = upcomingPeriods(rule, t.reminderLeadDays, calendarOfIso(t.startsOn), now, 1);
  return `ทุกวันที่ ${rule.recurringDay} · ${recurrenceText(rule)} · เตือนล่วงหน้า ${t.reminderLeadDays} วัน · งวดถัดไป ${formatCalendarDateTh(next.due)}`;
}

/**
 * เดือน (YYYY-MM) ที่ปุ่ม "เปิดร่างงวดนี้" ควรเปิด = งวดที่ครอบวันนี้ (ครบกำหนดไปแล้วในเดือนนี้ = งวดที่ค้าง หรือกำลังจะถึง)
 * ถ้างวดนั้นอยู่ก่อน startsOn (ตั้งบิลหลังวันครบกำหนด) ระบบไม่เคยสร้าง → ใช้งวดถัดไป (รีวิว I4)
 */
export function billMonthKey(t: RecurringRuleFields & { reminderLeadDays: number; startsOn: string | null }, now: Date): string | null {
  const rule = ruleOfTemplate(t);
  if (!rule) return null;
  const today = bkkCalendarDate(now);
  const startsOn = calendarOfIso(t.startsOn);
  const current = dueDateForPeriod(rule, periodKeyFor(rule, today));
  if (!startsOn || compareCalendarDate(current, startsOn) >= 0) return monthKeyOf(current);
  const [next] = upcomingPeriods(rule, t.reminderLeadDays, startsOn, now, 1);
  return monthKeyOf(next.due);
}

/** พรีวิวในกล่อง: "งวดถัดไป: 24 พ.ย. 2569 · ระบบจะสร้างร่างและเตือนวันที่ 21 พ.ย. · ถัดไป 24 ธ.ค. 69 · 24 ม.ค. 70" */
export function recurringPreviewText(rule: RecurringRule, leadDays: number, startsOn: CalendarDate | null, now: Date): string {
  const [p1, p2, p3] = upcomingPeriods(rule, leadDays, startsOn, now, 3);
  const dayMonth = (d: CalendarDate) => `${d.day} ${MONTH_ABBR_TH[d.month - 1]}`;
  return `งวดถัดไป: ${formatCalendarDateTh(p1.due, 'full')} · ระบบจะสร้างร่างและเตือนวันที่ ${dayMonth(p1.windowOpens)} · ถัดไป ${formatCalendarDateTh(p2.due)} · ${formatCalendarDateTh(p3.due)}`;
}
