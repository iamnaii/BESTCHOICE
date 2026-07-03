import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeDefaultTimeRange, toLocalDateString } from './date';

describe('lib/date — toLocalDateString', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats the LOCAL calendar day as YYYY-MM-DD (local constructor → local getters, TZ-safe)', () => {
    // Local-time constructor + local getters round-trip in ANY machine TZ, so
    // this assertion is deterministic. toISOString() would give 2026-07-02 on
    // an Asia/Bangkok machine (2026-07-03 01:30 BKK = 2026-07-02T18:30:00Z).
    expect(toLocalDateString(new Date(2026, 6, 3, 1, 30, 0))).toBe('2026-07-03');
  });

  it('zero-pads single-digit month and day', () => {
    expect(toLocalDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('defaults to now when called without an argument', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 3, 1, 30, 0));
    expect(toLocalDateString()).toBe('2026-07-03');
  });
});

describe('lib/date — computeDefaultTimeRange', () => {
  // Anchor: 2026-04-15 12:00 UTC = 2026-04-15 19:00 Asia/Bangkok (same calendar day).
  const fixedMidApril = new Date('2026-04-15T12:00:00Z');

  it("'all' returns empty strings", () => {
    const r = computeDefaultTimeRange('all', fixedMidApril);
    expect(r).toEqual({ startDate: '', endDate: '' });
  });

  it("'this_month' returns the FULL current month (owner 2026-07-02: เดือนนี้ = ทั้งเดือน)", () => {
    const r = computeDefaultTimeRange('this_month', fixedMidApril);
    expect(r).toEqual({ startDate: '2026-04-01', endDate: '2026-04-30' });
  });

  it("BKK boundary — 17:30 UTC Jun 30 is Jul 1 00:30 in Bangkok, so 'this_month' = full July", () => {
    // 2026-06-30 17:30 UTC = 2026-07-01 00:30 BKK (BKK is UTC+7).
    const lateJune = new Date('2026-06-30T17:30:00Z');
    const r = computeDefaultTimeRange('this_month', lateJune);
    expect(r).toEqual({ startDate: '2026-07-01', endDate: '2026-07-31' });
  });

  it("BKK boundary — 17:00 UTC Jul 31 is Aug 1 00:00 in Bangkok, so 'this_month' = full August", () => {
    // 2026-07-31 17:00 UTC = 2026-08-01 00:00 BKK exactly (midnight boundary).
    const bkkMidnight = new Date('2026-07-31T17:00:00Z');
    const r = computeDefaultTimeRange('this_month', bkkMidnight);
    expect(r).toEqual({ startDate: '2026-08-01', endDate: '2026-08-31' });
  });

  it("'this_month' in December returns Dec 1 → Dec 31 (year-end month wrap)", () => {
    const dec15 = new Date('2026-12-15T12:00:00Z');
    const r = computeDefaultTimeRange('this_month', dec15);
    expect(r).toEqual({ startDate: '2026-12-01', endDate: '2026-12-31' });
  });

  it("'this_month' returns 29 days for leap-year February (2028)", () => {
    const feb15Leap = new Date('2028-02-15T12:00:00Z');
    const r = computeDefaultTimeRange('this_month', feb15Leap);
    expect(r).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
  });

  it("'this_month' returns 28 days for non-leap February (2026)", () => {
    const feb15NonLeap = new Date('2026-02-15T12:00:00Z');
    const r = computeDefaultTimeRange('this_month', feb15NonLeap);
    expect(r).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' });
  });

  it("'this_month' handles 30-day months (September → Sep 30)", () => {
    const sep15 = new Date('2026-09-15T12:00:00Z');
    const r = computeDefaultTimeRange('this_month', sep15);
    expect(r).toEqual({ startDate: '2026-09-01', endDate: '2026-09-30' });
  });

  it("'last_month' returns first → last day of previous month", () => {
    const r = computeDefaultTimeRange('last_month', fixedMidApril);
    expect(r).toEqual({ startDate: '2026-03-01', endDate: '2026-03-31' });
  });

  it("'last_month' wraps January → previous-year December (31 days)", () => {
    const jan15 = new Date('2027-01-15T12:00:00Z');
    const r = computeDefaultTimeRange('last_month', jan15);
    expect(r).toEqual({ startDate: '2026-12-01', endDate: '2026-12-31' });
  });

  it("'last_month' returns 29 days for leap-year February (2024)", () => {
    const mar15Leap = new Date('2024-03-15T12:00:00Z');
    const r = computeDefaultTimeRange('last_month', mar15Leap);
    expect(r).toEqual({ startDate: '2024-02-01', endDate: '2024-02-29' });
  });

  it("'last_month' returns 28 days for non-leap February (2026)", () => {
    const mar15NonLeap = new Date('2026-03-15T12:00:00Z');
    const r = computeDefaultTimeRange('last_month', mar15NonLeap);
    expect(r).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' });
  });

  it("'last_month' handles 30-day months (April → March 31)", () => {
    // April has 30 days; March (preceding) has 31. Test that "last day of March" is 31.
    const apr10 = new Date('2026-04-10T12:00:00Z');
    const r = computeDefaultTimeRange('last_month', apr10);
    expect(r.endDate).toBe('2026-03-31');
  });

  it("BKK boundary — 23:59 UTC Dec 31 is Jan 1 in Bangkok, so 'last_month' = December previous year", () => {
    // 23:59 UTC Dec 31 2026 = 06:59 BKK Jan 1 2027 (BKK is UTC+7).
    const ny = new Date('2026-12-31T23:59:00Z');
    const r = computeDefaultTimeRange('last_month', ny);
    expect(r).toEqual({ startDate: '2026-12-01', endDate: '2026-12-31' });
  });

  // D1.3.5.1 — extended presets ('today', 'this_week')
  it("'today' returns same date for start + end (BKK)", () => {
    const r = computeDefaultTimeRange('today', fixedMidApril);
    expect(r).toEqual({ startDate: '2026-04-15', endDate: '2026-04-15' });
  });

  it("'this_week' returns Monday → today (ISO week start) for a Wednesday", () => {
    // 2026-04-15 is Wednesday; ISO Monday-of-week = 2026-04-13.
    const r = computeDefaultTimeRange('this_week', fixedMidApril);
    expect(r).toEqual({ startDate: '2026-04-13', endDate: '2026-04-15' });
  });

  it("'this_week' on Monday returns same date for start + end", () => {
    // 2026-04-13 is Monday — start === end (no prior week-days).
    const monday = new Date('2026-04-13T12:00:00Z');
    const r = computeDefaultTimeRange('this_week', monday);
    expect(r).toEqual({ startDate: '2026-04-13', endDate: '2026-04-13' });
  });

  it("'this_week' on Sunday returns previous Monday (ISO week treats Sun as day 7)", () => {
    // 2026-04-19 is Sunday — ISO Monday-of-week = 2026-04-13 (6 days back).
    const sunday = new Date('2026-04-19T12:00:00Z');
    const r = computeDefaultTimeRange('this_week', sunday);
    expect(r).toEqual({ startDate: '2026-04-13', endDate: '2026-04-19' });
  });
});
