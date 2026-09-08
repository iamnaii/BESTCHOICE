import { addBkkDays, addBkkMonths } from './date.util';

describe('Bangkok calendar arithmetic', () => {
  it('adds business days independently of server timezone', () => {
    // March 1, 00:30 BKK lies on February 28 UTC.
    const anchor = new Date('2026-02-28T17:30:00.123Z');
    expect(addBkkDays(anchor, 14).toISOString()).toBe('2026-03-14T17:30:00.123Z');
    expect(anchor.toISOString()).toBe('2026-02-28T17:30:00.123Z');
  });

  it('uses the Bangkok day and preserves time when crossing the UTC month boundary', () => {
    const anchor = new Date('2026-01-30T17:00:00.000Z'); // January 31 BKK
    expect(addBkkMonths(anchor, 1).toISOString()).toBe('2026-02-27T17:00:00.000Z');
    expect(addBkkMonths(anchor, 2).toISOString()).toBe('2026-03-30T17:00:00.000Z');
    expect(addBkkMonths(anchor, 3).toISOString()).toBe('2026-04-29T17:00:00.000Z');
    expect(anchor.toISOString()).toBe('2026-01-30T17:00:00.000Z');
  });

  it('keeps the calendar day across a year boundary', () => {
    const anchor = new Date('2026-12-10T17:00:00.000Z'); // December 11 BKK
    expect(addBkkMonths(anchor, 2).toISOString()).toBe('2027-02-10T17:00:00.000Z');
  });
});
