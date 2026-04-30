import { isWithinBusinessHours, nextBusinessHourOpen } from './business-hours.util';

describe('business-hours.util', () => {
  describe('isWithinBusinessHours', () => {
    it('weekday 10:00 ICT — within hours', () => {
      // 2026-05-04 (Monday) 10:00 ICT = 03:00 UTC
      expect(isWithinBusinessHours(new Date('2026-05-04T03:00:00Z'), false)).toBe(true);
    });

    it('weekday 19:59 ICT — within hours', () => {
      expect(isWithinBusinessHours(new Date('2026-05-04T12:59:00Z'), false)).toBe(true);
    });

    it('weekday 20:01 ICT — outside hours', () => {
      expect(isWithinBusinessHours(new Date('2026-05-04T13:01:00Z'), false)).toBe(false);
    });

    it('weekday 07:59 ICT — outside hours', () => {
      expect(isWithinBusinessHours(new Date('2026-05-04T00:59:00Z'), false)).toBe(false);
    });

    it('weekend 17:59 ICT — within hours', () => {
      expect(isWithinBusinessHours(new Date('2026-05-09T10:59:00Z'), true)).toBe(true);
    });

    it('weekend 18:01 ICT — outside hours', () => {
      expect(isWithinBusinessHours(new Date('2026-05-09T11:01:00Z'), true)).toBe(false);
    });

    it('weekend 08:00 ICT — within hours (boundary)', () => {
      expect(isWithinBusinessHours(new Date('2026-05-09T01:00:00Z'), true)).toBe(true);
    });
  });

  describe('nextBusinessHourOpen', () => {
    it('weekday 22:00 → next day 08:00 ICT', () => {
      const result = nextBusinessHourOpen(new Date('2026-05-04T15:00:00Z'), false);
      expect(result.toISOString()).toBe('2026-05-05T01:00:00.000Z');
    });

    it('weekday 06:00 → same day 08:00 ICT', () => {
      const result = nextBusinessHourOpen(new Date('2026-05-03T23:00:00Z'), false);
      expect(result.toISOString()).toBe('2026-05-04T01:00:00.000Z');
    });
  });
});
