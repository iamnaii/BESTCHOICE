import { describe, it, expect, afterEach } from 'vitest';
import {
  formatDateShort,
  formatDateMedium,
  formatDateLong,
  formatMonthName,
  formatDateShortThai,
  formatDateTime,
  formatDateTimeSeconds,
  formatNumber,
  formatNumberDecimal,
  applyFormat,
  setDefaultDecimalPlaces,
} from './formatters';

// D1.2.3.4 — `formatNumberDecimal` reads from a module-level pref when the
// 2nd argument is omitted. Reset to 2 after each test to keep blocks
// independent.
afterEach(() => {
  setDefaultDecimalPlaces(2);
});

// 3 มีนาคม 2026 14:30:05 local time
const sampleDate = new Date(2026, 2, 3, 14, 30, 5);

describe('formatters — dates', () => {
  describe('formatDateShort (date:s)', () => {
    it('formats a Date object as DD/MM/YYYY พ.ศ.', () => {
      expect(formatDateShort(sampleDate)).toBe('03/03/2569');
    });

    it('zero-pads single-digit day and month', () => {
      expect(formatDateShort(new Date(2026, 0, 5, 12, 0))).toBe('05/01/2569');
    });

    it('returns the original string when the input cannot be parsed', () => {
      expect(formatDateShort('not-a-date')).toBe('not-a-date');
    });

    it('returns the original input when given an empty string', () => {
      expect(formatDateShort('')).toBe('');
    });
  });

  describe('formatDateMedium (date:m)', () => {
    it('formats using abbreviated Thai month names', () => {
      expect(formatDateMedium(sampleDate)).toBe('03 มี.ค. 2569');
    });
  });

  describe('formatDateLong (date:l)', () => {
    it('formats as a long Thai date sentence', () => {
      expect(formatDateLong(sampleDate)).toBe('3 เดือน มีนาคม พ.ศ. 2569');
    });
  });

  describe('formatMonthName', () => {
    it('returns the full Thai month name', () => {
      expect(formatMonthName(sampleDate)).toBe('มีนาคม');
    });
  });

  describe('formatDateShortThai (date:st)', () => {
    it('omits the year', () => {
      expect(formatDateShortThai(sampleDate)).toBe('3 มี.ค.');
    });
  });

  describe('formatDateTime (date:dt)', () => {
    it('includes HH:mm with Buddhist year', () => {
      expect(formatDateTime(sampleDate)).toBe('03/03/2569 14:30');
    });
  });

  describe('formatDateTimeSeconds (date:dts)', () => {
    it('includes seconds', () => {
      expect(formatDateTimeSeconds(sampleDate)).toBe('03/03/2569 14:30:05');
    });
  });
});

describe('formatters — numbers', () => {
  describe('formatNumber', () => {
    it('applies Thai locale grouping', () => {
      expect(formatNumber(21468)).toBe('21,468');
    });

    it('accepts numeric strings', () => {
      expect(formatNumber('1000000')).toBe('1,000,000');
    });

    it('returns the original string for non-numeric input', () => {
      expect(formatNumber('abc')).toBe('abc');
    });
  });

  describe('formatNumberDecimal', () => {
    it('defaults to two decimal places', () => {
      expect(formatNumberDecimal(21468.4)).toBe('21,468.40');
    });

    it('respects a custom decimal count', () => {
      expect(formatNumberDecimal(1.23456, 3)).toBe('1.235');
    });

    it('rounds via the default locale behaviour', () => {
      expect(formatNumberDecimal(1.005, 2)).toMatch(/^1\.0[01]$/);
    });
  });
});

describe('applyFormat', () => {
  it('returns an empty string for null or undefined', () => {
    expect(applyFormat(null, 'num')).toBe('');
    expect(applyFormat(undefined, 'num')).toBe('');
  });

  it.each([
    ['date:s', '03/03/2569'],
    ['date:m', '03 มี.ค. 2569'],
    ['date:st', '3 มี.ค.'],
    ['date:month_name', 'มีนาคม'],
    ['date:dt', '03/03/2569 14:30'],
  ])('dispatches date format "%s" to its formatter', (fmt, expected) => {
    expect(applyFormat(sampleDate, fmt)).toBe(expected);
  });

  it('dispatches bare "num" to formatNumber', () => {
    expect(applyFormat(21468, 'num')).toBe('21,468');
  });

  it('dispatches "num:N" to formatNumberDecimal', () => {
    expect(applyFormat(21468, 'num:2')).toBe('21,468.00');
    expect(applyFormat(1.23456, 'num:3')).toBe('1.235');
  });

  it('falls back to String(value) for unknown formats', () => {
    expect(applyFormat(42, 'wat')).toBe('42');
  });

  it('trims whitespace from the format string', () => {
    expect(applyFormat(21468, ' num ')).toBe('21,468');
  });
});

// D1.2.3.4 — decimal_places module-level default
describe('formatters — decimal_places default (D1.2.3.4)', () => {
  it('default 2: formatNumberDecimal(value) uses 2 digits when omitted', () => {
    expect(formatNumberDecimal(21468.4)).toBe('21,468.40');
  });

  it('override 0: formatNumberDecimal(value) uses 0 digits when pref=0', () => {
    setDefaultDecimalPlaces(0);
    expect(formatNumberDecimal(21468.4)).toBe('21,468');
    expect(formatNumberDecimal(21468.6)).toBe('21,469'); // ROUND_HALF_UP
  });

  it('override 4: formatNumberDecimal(value) uses 4 digits when pref=4', () => {
    setDefaultDecimalPlaces(4);
    expect(formatNumberDecimal(1.23456)).toBe('1.2346'); // ROUND_HALF_UP
  });

  it('out-of-range pref (5) falls back to default 2', () => {
    setDefaultDecimalPlaces(5);
    expect(formatNumberDecimal(21468.4)).toBe('21,468.40');
  });

  it('explicit 2nd arg always wins over the pref', () => {
    setDefaultDecimalPlaces(0);
    expect(formatNumberDecimal(21468.4, 2)).toBe('21,468.40');
    expect(formatNumberDecimal(1.23456, 3)).toBe('1.235');
  });

  it('ROUND_HALF_UP applied: representable 0.5 boundaries round UP not banker', () => {
    // 0.5 → 1 with ROUND_HALF_UP (banker would give 0). Representable exactly.
    expect(formatNumberDecimal(0.5, 0)).toBe('1');
    // 1.5 → 2 (banker would give 2 anyway — odd half-up matches)
    expect(formatNumberDecimal(1.5, 0)).toBe('2');
    // 2.5 → 3 with ROUND_HALF_UP (banker would give 2 here — divergence proves the rule)
    expect(formatNumberDecimal(2.5, 0)).toBe('3');
    // Note: 1.005 → "1.00" is unavoidable in IEEE 754 (`1.005` is really
    // 1.0049999…). For correct half-up on string sources, callers should
    // pass the string form unchanged (parseFloat is the lossy step).
  });
});
