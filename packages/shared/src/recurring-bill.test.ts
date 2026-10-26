import { describe, expect, it } from 'vitest';
import {
  RECURRING_BILL_CATCHUP_DAYS,
  RECURRING_BILL_DEFAULT_LEAD_DAYS,
  RECURRING_BILL_NOTIFY_ROLES,
  RECURRING_BILL_TODO_TAG,
  addCalendarDays,
  bkkCalendarDate,
  calendarDayDiff,
  clampDay,
  compareCalendarDate,
  daysInMonth,
  dueDateForPeriod,
  formatCalendarDateTh,
  formatPeriodLabelTh,
  matchWindow,
  nextPeriodKey,
  periodKeyFor,
  prevPeriodKey,
  periodsFrom,
  reminderWindowOpens,
  type RecurringRule,
} from './recurring-bill';

const monthly = (day: number): RecurringRule => ({ recurrence: 'MONTHLY', recurringDay: day, recurringMonth: null });
const quarterly = (day: number, month: number): RecurringRule => ({ recurrence: 'QUARTERLY', recurringDay: day, recurringMonth: month });
const yearly = (day: number, month: number): RecurringRule => ({ recurrence: 'YEARLY', recurringDay: day, recurringMonth: month });

describe('recurring-bill constants', () => {
  it('pins the owner decisions', () => {
    expect(RECURRING_BILL_NOTIFY_ROLES).toEqual(['OWNER', 'ACCOUNTANT']);
    expect(RECURRING_BILL_TODO_TAG).toBe('recurring-bill');
    expect(RECURRING_BILL_CATCHUP_DAYS).toBe(7);
    expect(RECURRING_BILL_DEFAULT_LEAD_DAYS).toBe(3);
  });
});

describe('calendar helpers (Asia/Bangkok, TZ-free)', () => {
  it('bkkCalendarDate rolls to the next Thai day after 17:00Z', () => {
    expect(bkkCalendarDate(new Date('2026-10-26T17:30:00Z'))).toEqual({ year: 2026, month: 10, day: 27 });
    expect(bkkCalendarDate(new Date('2026-10-26T16:59:00Z'))).toEqual({ year: 2026, month: 10, day: 26 });
  });
  it('daysInMonth / clampDay handle short months and leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(clampDay(2026, 2, 31)).toBe(28);
    expect(clampDay(2026, 4, 31)).toBe(30);
    expect(clampDay(2026, 1, 31)).toBe(31);
  });
  it('compare / add / diff work across month boundaries', () => {
    expect(compareCalendarDate({ year: 2026, month: 10, day: 26 }, { year: 2026, month: 10, day: 26 })).toBe(0);
    expect(compareCalendarDate({ year: 2026, month: 9, day: 30 }, { year: 2026, month: 10, day: 1 })).toBeLessThan(0);
    expect(addCalendarDays({ year: 2026, month: 10, day: 30 }, 3)).toEqual({ year: 2026, month: 11, day: 2 });
    expect(addCalendarDays({ year: 2026, month: 11, day: 1 }, -3)).toEqual({ year: 2026, month: 10, day: 29 });
    expect(calendarDayDiff({ year: 2026, month: 10, day: 24 }, { year: 2026, month: 10, day: 26 })).toBe(2);
  });
});

describe('dueDateForPeriod', () => {
  it('MONTHLY day 31 clamps to the last day of short months', () => {
    expect(dueDateForPeriod(monthly(31), '2026-01')).toEqual({ year: 2026, month: 1, day: 31 });
    expect(dueDateForPeriod(monthly(31), '2026-02')).toEqual({ year: 2026, month: 2, day: 28 });
    expect(dueDateForPeriod(monthly(31), '2026-04')).toEqual({ year: 2026, month: 4, day: 30 });
  });
  it('QUARTERLY month 2 day 15 lands on Feb/May/Aug/Nov', () => {
    expect(dueDateForPeriod(quarterly(15, 2), '2026-Q1')).toEqual({ year: 2026, month: 2, day: 15 });
    expect(dueDateForPeriod(quarterly(15, 2), '2026-Q2')).toEqual({ year: 2026, month: 5, day: 15 });
    expect(dueDateForPeriod(quarterly(15, 2), '2026-Q3')).toEqual({ year: 2026, month: 8, day: 15 });
    expect(dueDateForPeriod(quarterly(15, 2), '2026-Q4')).toEqual({ year: 2026, month: 11, day: 15 });
  });
  it('YEARLY 29 Feb clamps on non-leap years', () => {
    expect(dueDateForPeriod(yearly(29, 2), '2026')).toEqual({ year: 2026, month: 2, day: 28 });
    expect(dueDateForPeriod(yearly(29, 2), '2028')).toEqual({ year: 2028, month: 2, day: 29 });
  });
});

describe('periodKeyFor / nextPeriodKey', () => {
  it('derives keys per recurrence', () => {
    expect(periodKeyFor(monthly(5), { year: 2026, month: 10, day: 26 })).toBe('2026-10');
    expect(periodKeyFor(quarterly(15, 2), { year: 2026, month: 11, day: 3 })).toBe('2026-Q4');
    expect(periodKeyFor(yearly(1, 3), { year: 2026, month: 11, day: 3 })).toBe('2026');
  });
  it('steps forward including year rollover', () => {
    expect(nextPeriodKey(monthly(5), '2026-12')).toBe('2027-01');
    expect(nextPeriodKey(quarterly(15, 2), '2026-Q4')).toBe('2027-Q1');
    expect(nextPeriodKey(yearly(1, 3), '2026')).toBe('2027');
  });
  it('steps backward including year rollover', () => {
    expect(prevPeriodKey(monthly(5), '2027-01')).toBe('2026-12');
    expect(prevPeriodKey(quarterly(15, 2), '2027-Q1')).toBe('2026-Q4');
    expect(prevPeriodKey(yearly(1, 3), '2027')).toBe('2026');
  });
});

describe('periodsFrom (first period = first due date on/after start)', () => {
  it('skips a due day already passed in the start month', () => {
    expect(periodsFrom(monthly(25), { year: 2026, month: 10, day: 26 }, 2)).toEqual(['2026-11', '2026-12']);
  });
  it('keeps the start month when the due day is still ahead or is today', () => {
    expect(periodsFrom(monthly(28), { year: 2026, month: 10, day: 26 }, 1)).toEqual(['2026-10']);
    expect(periodsFrom(monthly(26), { year: 2026, month: 10, day: 26 }, 1)).toEqual(['2026-10']);
  });
  it('works for quarterly/yearly rules', () => {
    expect(periodsFrom(quarterly(15, 2), { year: 2026, month: 11, day: 20 }, 2)).toEqual(['2027-Q1', '2027-Q2']);
    expect(periodsFrom(yearly(1, 3), { year: 2026, month: 11, day: 20 }, 1)).toEqual(['2027']);
  });
});

describe('reminder window', () => {
  it('opens leadDays before the due date, lead 0 = due day', () => {
    expect(reminderWindowOpens(monthly(28), '2026-10', 3)).toEqual({ year: 2026, month: 10, day: 25 });
    expect(reminderWindowOpens(monthly(28), '2026-10', 0)).toEqual({ year: 2026, month: 10, day: 28 });
  });
  it('matchWindow spans from this window to the next window (day 1, lead 3 ⇒ 29 Oct .. 27 Nov)', () => {
    const w = matchWindow(monthly(1), '2026-11', 3);
    expect(w.from).toEqual({ year: 2026, month: 10, day: 29 });
    expect(w.to).toEqual({ year: 2026, month: 11, day: 28 });
    expect(compareCalendarDate({ year: 2026, month: 10, day: 30 }, w.from)).toBeGreaterThanOrEqual(0);
    expect(compareCalendarDate({ year: 2026, month: 10, day: 30 }, w.to)).toBeLessThan(0);
  });
});

describe('Thai labels', () => {
  it('formats period labels and short dates in Thai', () => {
    expect(formatPeriodLabelTh(monthly(1), '2026-10')).toBe('ต.ค. 2569');
    expect(formatPeriodLabelTh(quarterly(1, 1), '2026-Q4')).toBe('ไตรมาส 4/2569');
    expect(formatPeriodLabelTh(yearly(1, 1), '2026')).toBe('ปี 2569');
    expect(formatCalendarDateTh({ year: 2026, month: 10, day: 28 })).toBe('28 ต.ค. 69');
    expect(formatCalendarDateTh({ year: 2027, month: 1, day: 5 }, 'full')).toBe('5 ม.ค. 2570');
  });
});
