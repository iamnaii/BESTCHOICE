import { bkkBusinessDate } from './bkk-business-date.util';

describe('bkkBusinessDate', () => {
  it('maps a mid-day UTC instant to noon BKK (05:00:00.000Z) of the same date', () => {
    // 2026-06-09 09:00 UTC = 2026-06-09 16:00 BKK → same BKK calendar day.
    const out = bkkBusinessDate(new Date('2026-06-09T09:00:00.000Z'));
    expect(out.toISOString()).toBe('2026-06-09T05:00:00.000Z');
  });

  it('rolls to the NEXT BKK calendar day for a UTC instant at/after 17:00 UTC', () => {
    // 2026-06-09 18:30 UTC = 2026-06-10 01:30 BKK → next BKK calendar day.
    const out = bkkBusinessDate(new Date('2026-06-09T18:30:00.000Z'));
    expect(out.toISOString()).toBe('2026-06-10T05:00:00.000Z');
  });

  it('always pins the time to noon BKK = 05:00:00.000Z', () => {
    const out = bkkBusinessDate(new Date('2026-12-31T23:59:59.999Z'));
    // 23:59 UTC Dec 31 = 06:59 BKK Jan 1 → noon BKK Jan 1.
    expect(out.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });
});
