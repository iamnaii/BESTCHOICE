import {
  formatDateShort,
  formatDateMedium,
  formatDateLong,
  formatDateTime,
  formatThaiDateText,
  getThaiDateParts,
} from './thai-date.util';

// C5 regression: thai-date formatters previously used d.getDate()/getMonth()
// /getFullYear() — server-local TZ. On Cloud Run (UTC), a receipt generated
// at 06:30 BKK printed YESTERDAY's date. All formatters must extract date
// parts via Asia/Bangkok regardless of the host TZ.
describe('thai-date.util — Asia/Bangkok timezone correctness', () => {
  // Sanity: server TZ may be UTC (Cloud Run) or anything else; assertions
  // below compute against absolute UTC instants and expected BKK calendar
  // values.

  describe('formatDateShort', () => {
    it('17:30 UTC on 2026-05-13 = 00:30 BKK 2026-05-14 → returns 14/05/2569', () => {
      const utc = new Date('2026-05-13T17:30:00Z');
      expect(formatDateShort(utc)).toBe('14/05/2569');
    });

    it('00:00 UTC 2026-05-14 = 07:00 BKK same day → returns 14/05/2569', () => {
      const utc = new Date('2026-05-14T00:00:00Z');
      expect(formatDateShort(utc)).toBe('14/05/2569');
    });

    it('16:59 UTC 2026-05-13 = 23:59 BKK same day → returns 13/05/2569 (NOT 14)', () => {
      const utc = new Date('2026-05-13T16:59:00Z');
      expect(formatDateShort(utc)).toBe('13/05/2569');
    });

    it('Dec 31 23:30 UTC = Jan 1 06:30 BKK next year → wraps year+พ.ศ.', () => {
      const utc = new Date('2025-12-31T23:30:00Z');
      // 2026-01-01 06:30 BKK → พ.ศ. 2569
      expect(formatDateShort(utc)).toBe('01/01/2569');
    });
  });

  describe('formatDateMedium', () => {
    it('handles BKK-side date wrap', () => {
      const utc = new Date('2026-05-13T17:30:00Z'); // 00:30 BKK May 14
      expect(formatDateMedium(utc)).toBe('14 พ.ค. 2569');
    });
  });

  describe('formatDateLong', () => {
    it('handles BKK-side date wrap', () => {
      const utc = new Date('2026-05-13T17:30:00Z'); // 00:30 BKK May 14
      expect(formatDateLong(utc)).toBe('14 เดือน พฤษภาคม พ.ศ. 2569');
    });
  });

  describe('formatDateTime', () => {
    it('shows BKK hours+minutes, not UTC', () => {
      const utc = new Date('2026-05-13T17:30:00Z'); // 00:30 BKK May 14
      expect(formatDateTime(utc)).toBe('14/05/2569 00:30');
    });
  });

  describe('formatThaiDateText (no zero-pad)', () => {
    it('BKK natural-text form', () => {
      const utc = new Date('2026-05-13T17:30:00Z'); // 00:30 BKK May 14
      expect(formatThaiDateText(utc)).toBe('14 พ.ค. 2569');
    });
  });

  describe('getThaiDateParts', () => {
    it('returns all parts via Asia/Bangkok', () => {
      const utc = new Date('2026-05-13T17:30:00Z'); // 00:30 BKK May 14
      const parts = getThaiDateParts(utc);
      expect(parts.day).toBe('14');
      expect(parts.month).toBe('พฤษภาคม');
      expect(parts.monthShort).toBe('พ.ค.');
      expect(parts.year).toBe('2569');
    });

    it('handles invalid inputs with placeholder dashes', () => {
      const parts = getThaiDateParts('not-a-date');
      expect(parts.day).toBe('-');
      expect(parts.year).toBe('-');
    });
  });
});
