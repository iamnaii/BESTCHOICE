import { describe, it, expect } from 'vitest';
import { formatNumericText, normalizeNumericText } from './numericText';

describe('numeric display', () => {
  it.each([
    [1234567, '1,234,567'], ['-1234567.50', '-1,234,567.50'],
    ['9007199254740993.0123', '9,007,199,254,740,993.0123'],
    ['−1234.50', '-1,234.50'], ['-0.50', '-0.50'],
    [0, '0'], ['0.00', '0.00'], ['-', '-'], ['—', '—'], [null, '-'], [undefined, '-'],
    ['', ''], ['1,234.50', '1,234.50'], ['12,34', '12,34'], ['not a number', 'not a number'],
  ])('formats %s without losing its precision, sign or placeholder', (value, expected) => {
    expect(formatNumericText(value)).toBe(expected);
  });
  it('parses only complete decimal values and valid grouping', () => {
    expect(normalizeNumericText('-1,234.50')).toBe('-1234.50');
    expect(normalizeNumericText('123abc')).toBeNull();
    expect(normalizeNumericText('-')).toBeNull();
    expect(normalizeNumericText('1,25')).toBeNull();
  });
});
