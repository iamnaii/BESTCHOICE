import { bangkokDateRange } from './date.util';

describe('Bangkok date-only range', () => {
  it('uses Thai midnight with an exclusive next-day upper bound independent of process TZ', () => {
    expect(bangkokDateRange('2026-09-01', '2026-09-30')).toEqual({
      gte: new Date('2026-08-31T17:00:00Z'), lt: new Date('2026-09-30T17:00:00Z'),
    });
    expect(bangkokDateRange('2024-02-29', '2024-02-29')).toEqual({
      gte: new Date('2024-02-28T17:00:00Z'), lt: new Date('2024-02-29T17:00:00Z'),
    });
    expect(bangkokDateRange(undefined, '2026-01-01')).toEqual({ lt: new Date('2026-01-01T17:00:00Z') });
    expect(bangkokDateRange()).toEqual({});
  });
  it.each(['2026-02-30', '2026-13-01', '2026-2-01', 'invalid', '2026-09-01T00:00:00Z'])('rejects invalid date %s', value => {
    expect(() => bangkokDateRange(value)).toThrow();
  });
  it('rejects reversed bounds', () => {
    expect(() => bangkokDateRange('2026-09-30', '2026-09-01')).toThrow();
  });
});
