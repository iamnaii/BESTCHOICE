import { describe, expect, it } from 'vitest';
import { formatRatePct, hasTermRates } from './rate-label';

describe('hasTermRates', () => {
  it('มี allowedMonths = มีตารางรายงวด', () => {
    expect(hasTermRates({ allowedMonths: [10, 12] })).toBe(true);
  });

  it('ว่าง / ไม่ส่ง / ไม่มีตั้งค่า = ไม่มีตาราง', () => {
    expect(hasTermRates({ allowedMonths: [] })).toBe(false);
    expect(hasTermRates({})).toBe(false);
    expect(hasTermRates(null)).toBe(false);
    expect(hasTermRates(undefined)).toBe(false);
  });
});

describe('formatRatePct', () => {
  it('ตัดศูนย์ท้าย ทศนิยมไม่เกิน 2 ตำแหน่ง', () => {
    expect(formatRatePct(0.5)).toBe('50%');
    expect(formatRatePct(0.425)).toBe('42.5%');
    expect(formatRatePct(0.04166667)).toBe('4.17%');
    expect(formatRatePct(0)).toBe('0%');
  });
});
