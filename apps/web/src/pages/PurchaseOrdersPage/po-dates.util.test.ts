import { describe, it, expect } from 'vitest';
import { EXPECTED_DATE_ERROR, getExpectedDateError, withOrderDate } from './po-dates.util';

describe('withOrderDate — เปลี่ยนวันที่สั่งแล้วต้องเลือกวันที่คาดรับใหม่', () => {
  const form = { orderDate: '2026-09-08', expectedDate: '2026-09-09', notes: 'x' };

  it('clears expectedDate when orderDate changes', () => {
    expect(withOrderDate(form, '2026-09-13')).toEqual({ orderDate: '2026-09-13', expectedDate: '', notes: 'x' });
  });

  it('keeps expectedDate when the same orderDate is picked again', () => {
    expect(withOrderDate(form, '2026-09-08')).toEqual(form);
  });

  it('does not mutate the input form', () => {
    withOrderDate(form, '2026-09-13');
    expect(form.expectedDate).toBe('2026-09-09');
  });
});

describe('getExpectedDateError — วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่ง', () => {
  it('returns null when expectedDate is empty', () => {
    expect(getExpectedDateError('2026-09-13', '')).toBeNull();
  });

  it('returns null when orderDate is empty', () => {
    expect(getExpectedDateError('', '2026-09-07')).toBeNull();
  });

  it('returns null when expectedDate equals orderDate', () => {
    expect(getExpectedDateError('2026-09-13', '2026-09-13')).toBeNull();
  });

  it('returns null when expectedDate is after orderDate', () => {
    expect(getExpectedDateError('2026-09-13', '2026-10-01')).toBeNull();
  });

  it('returns the error when expectedDate is before orderDate', () => {
    expect(getExpectedDateError('2026-09-13', '2026-09-07')).toBe(EXPECTED_DATE_ERROR);
  });

  it('compares by calendar day across a month boundary', () => {
    expect(getExpectedDateError('2026-09-30', '2026-10-01')).toBeNull();
    expect(getExpectedDateError('2026-10-01', '2026-09-30')).toBe(EXPECTED_DATE_ERROR);
  });
});
