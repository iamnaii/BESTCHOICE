import { describe, expect, it } from 'vitest';
import { getReportDateRange } from './date';

describe('Bangkok report periods', () => {
  it.each([
    ['this_month', '2026-09-30T17:00:00Z', '2026-10-01', '2026-10-01'],
    ['this_year', '2026-12-31T17:00:00Z', '2027-01-01', '2027-01-01'],
    ['this_month', '2028-02-29T16:59:59Z', '2028-02-01', '2028-02-29'],
    ['last_three_months', '2026-05-31T03:00:00Z', '2026-02-28', '2026-05-31'],
    ['last_three_months', '2028-05-31T03:00:00Z', '2028-02-29', '2028-05-31'],
    ['last_three_months', '2026-01-31T03:00:00Z', '2025-10-31', '2026-01-31'],
  ] as const)('%s at %s', (preset, instant, startDate, endDate) => {
    expect(getReportDateRange(preset, new Date(instant))).toEqual({ startDate, endDate });
  });
});
