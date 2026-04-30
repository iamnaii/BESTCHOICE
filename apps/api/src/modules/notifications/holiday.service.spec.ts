import { HolidayService } from './holiday.service';

describe('HolidayService', () => {
  let service: HolidayService;
  beforeEach(() => {
    service = new HolidayService();
  });

  it('isHoliday returns true for Thai New Year 2026', () => {
    expect(service.isHoliday(new Date('2026-01-01T03:00:00Z'))).toBe(true);
  });

  it('isHoliday returns true for Songkran (April 13-15)', () => {
    expect(service.isHoliday(new Date('2026-04-13T03:00:00Z'))).toBe(true);
    expect(service.isHoliday(new Date('2026-04-14T03:00:00Z'))).toBe(true);
    expect(service.isHoliday(new Date('2026-04-15T03:00:00Z'))).toBe(true);
  });

  it('isHoliday returns false for a normal weekday', () => {
    expect(service.isHoliday(new Date('2026-05-15T03:00:00Z'))).toBe(false); // Friday
  });

  it('isHoliday returns false for a year without seed data', () => {
    expect(service.isHoliday(new Date('2030-01-01T03:00:00Z'))).toBe(false);
  });

  it('respects Asia/Bangkok day boundaries', () => {
    // 2025-12-31 23:30 UTC = 2026-01-01 06:30 ICT = New Year holiday in Thailand
    expect(service.isHoliday(new Date('2025-12-31T23:30:00Z'))).toBe(true);
  });
});
