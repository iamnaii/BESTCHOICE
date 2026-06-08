import { pickEnum, clampInt, clampFloat, parseStringArray } from './settings-flag-parsers.util';

describe('settings-flag-parsers', () => {
  describe('pickEnum', () => {
    const allowed = ['all', 'none', 'overdue_only'] as const;

    it('returns the raw value when it is in the whitelist', () => {
      expect(pickEnum('none', allowed, 'overdue_only')).toBe('none');
      expect(pickEnum('all', allowed, 'overdue_only')).toBe('all');
    });

    it('returns the fallback when the raw value is not whitelisted', () => {
      expect(pickEnum('bogus', allowed, 'overdue_only')).toBe('overdue_only');
    });

    it('returns the fallback for null / undefined / empty', () => {
      expect(pickEnum(null, allowed, 'overdue_only')).toBe('overdue_only');
      expect(pickEnum(undefined, allowed, 'overdue_only')).toBe('overdue_only');
      expect(pickEnum('', allowed, 'overdue_only')).toBe('overdue_only');
    });

    it('treats the fallback value itself as a valid pass-through when whitelisted', () => {
      expect(pickEnum('overdue_only', allowed, 'overdue_only')).toBe('overdue_only');
    });
  });

  describe('clampInt', () => {
    it('accepts an integer within [min, max] inclusive', () => {
      expect(clampInt(15, 0, 30, 0)).toBe(15);
      expect(clampInt(0, 0, 30, 99)).toBe(0); // min boundary
      expect(clampInt(30, 0, 30, 99)).toBe(30); // max boundary
    });

    it('falls back when out of range', () => {
      expect(clampInt(-1, 0, 30, 7)).toBe(7);
      expect(clampInt(31, 0, 30, 7)).toBe(7);
    });

    it('falls back for non-integers and NaN', () => {
      expect(clampInt(3.5, 0, 30, 2)).toBe(2);
      expect(clampInt(NaN, 0, 30, 2)).toBe(2);
    });
  });

  describe('clampFloat', () => {
    it('accepts a finite value within [min, max] and floors it', () => {
      expect(clampFloat(30, 5, 300, 30)).toBe(30);
      expect(clampFloat(59.9, 5, 300, 30)).toBe(59); // floored
      expect(clampFloat(5, 5, 300, 99)).toBe(5); // min boundary
      expect(clampFloat(300, 5, 300, 99)).toBe(300); // max boundary
    });

    it('falls back when out of range', () => {
      expect(clampFloat(4, 5, 300, 30)).toBe(30);
      expect(clampFloat(301, 5, 300, 30)).toBe(30);
    });

    it('falls back for NaN and Infinity', () => {
      expect(clampFloat(NaN, 5, 300, 30)).toBe(30);
      expect(clampFloat(Infinity, 5, 300, 30)).toBe(30);
    });
  });

  describe('parseStringArray', () => {
    it('parses a JSON array and keeps only string elements', () => {
      expect(parseStringArray('["a","b"]', [])).toEqual(['a', 'b']);
      expect(parseStringArray('["a",1,"b",null]', [])).toEqual(['a', 'b']);
    });

    it('returns the (possibly empty) filtered array when requireNonEmpty is off', () => {
      expect(parseStringArray('[]', ['X'])).toEqual([]);
      expect(parseStringArray('[1,2]', ['X'])).toEqual([]);
    });

    it('falls back on an empty result when requireNonEmpty is on', () => {
      expect(parseStringArray('[]', ['PAYROLL'], { requireNonEmpty: true })).toEqual(['PAYROLL']);
      expect(parseStringArray('[1,2]', ['PAYROLL'], { requireNonEmpty: true })).toEqual([
        'PAYROLL',
      ]);
      expect(parseStringArray('["EXPENSE"]', ['PAYROLL'], { requireNonEmpty: true })).toEqual([
        'EXPENSE',
      ]);
    });

    it('falls back for null, non-array JSON, and invalid JSON', () => {
      expect(parseStringArray(null, ['d'])).toEqual(['d']);
      expect(parseStringArray('', ['d'])).toEqual(['d']);
      expect(parseStringArray('5', ['d'])).toEqual(['d']);
      expect(parseStringArray('{"a":1}', ['d'])).toEqual(['d']);
      expect(parseStringArray('not json', ['d'])).toEqual(['d']);
    });
  });
});
