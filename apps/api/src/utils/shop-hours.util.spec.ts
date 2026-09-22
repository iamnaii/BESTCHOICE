import { bangkokHour, isShopOpen } from './shop-hours.util';

describe('shop-hours.util', () => {
  it('ใช้เวลาไทย (UTC+7) ไม่ขึ้นกับ timezone เครื่อง', () => {
    expect(bangkokHour(new Date('2026-09-22T03:00:00Z'))).toBe(10);
    expect(bangkokHour(new Date('2026-09-22T19:10:00Z'))).toBe(2);
  });

  it('เปิด 10:00 ถึงก่อน 19:00', () => {
    expect(isShopOpen(new Date('2026-09-22T02:59:00Z'))).toBe(false); // 09:59
    expect(isShopOpen(new Date('2026-09-22T03:00:00Z'))).toBe(true); // 10:00
    expect(isShopOpen(new Date('2026-09-22T11:59:00Z'))).toBe(true); // 18:59
    expect(isShopOpen(new Date('2026-09-22T12:00:00Z'))).toBe(false); // 19:00
  });
});
