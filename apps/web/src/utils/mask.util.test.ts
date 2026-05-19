import { describe, it, expect } from 'vitest';
import { maskNationalId, formatNationalId, maskPhone, maskAccountNumber } from './mask.util';

describe('mask.util — PDPA masking', () => {
  describe('maskNationalId', () => {
    it('masks a 13-digit ID showing first + 10th/11th + last digit', () => {
      // Format: {first}-xxxx-xxxxx-{digits[9..11]}-{last}
      // For 1234567890123 → 1,0 (idx 9) + 1 (idx 10) + 3 (idx 12)
      expect(maskNationalId('1234567890123')).toBe('1-xxxx-xxxxx-01-3');
    });

    it('passes through the original value when shorter than 13 chars', () => {
      expect(maskNationalId('12345')).toBe('12345');
    });

    it('returns "-" for empty input', () => {
      expect(maskNationalId('')).toBe('-');
    });

    it('returns the original input when digit count is not exactly 13', () => {
      // Enough characters but wrong digit count → fall through.
      const input = '12345abc67890xx';
      expect(maskNationalId(input)).toBe(input);
    });

    it('strips non-digit separators before masking', () => {
      expect(maskNationalId('1-2345-67890-12-3')).toBe('1-xxxx-xxxxx-01-3');
    });
  });

  describe('formatNationalId', () => {
    it('formats a 13-digit ID with dashes', () => {
      expect(formatNationalId('1234567890123')).toBe('1-2345-67890-12-3');
    });

    it('returns "-" for empty input', () => {
      expect(formatNationalId('')).toBe('-');
    });
  });

  describe('maskPhone', () => {
    it('shows the last 4 digits only', () => {
      expect(maskPhone('0812345678')).toBe('xxx-xxx-5678');
    });

    it('strips non-digit characters before taking the last 4', () => {
      expect(maskPhone('081-234-5678')).toBe('xxx-xxx-5678');
    });

    it('returns "-" for empty input', () => {
      expect(maskPhone('')).toBe('-');
    });

    it('passes through very short numbers as-is', () => {
      expect(maskPhone('123')).toBe('123');
    });
  });

  describe('maskAccountNumber', () => {
    it('keeps last 5 digits, masks others, preserves separators', () => {
      expect(maskAccountNumber('123-4-56789-0')).toBe('xxx-x-x6789-0');
    });

    it('handles plain 10-digit account number', () => {
      expect(maskAccountNumber('1234567890')).toBe('xxxxx67890');
    });

    it('returns short numbers unchanged (<=5 digits)', () => {
      expect(maskAccountNumber('12345')).toBe('12345');
    });

    it('returns "-" for null/empty input', () => {
      expect(maskAccountNumber(null)).toBe('-');
      expect(maskAccountNumber('')).toBe('-');
    });
  });
});
