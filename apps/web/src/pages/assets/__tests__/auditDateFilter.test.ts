import { describe, it, expect } from 'vitest';
import { isAuditLogInDayRange } from '../utils/auditDateFilter';

/**
 * ตัวกรองวันที่ฝั่ง client ของหน้าประวัติสินทรัพย์รายตัว (/assets/:id/audit) — วันที่จากช่องเลือกเป็น 'YYYY-MM-DD'
 * = วันตามปฏิทินไทย เทียบกับวันไทยของ createdAt (ไม่ขึ้นกับ TZ ของเบราว์เซอร์)
 * เดิม: new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ รายการ 00:00–06:59 น. ของวันเริ่มถูกซ่อน
 * และขอบสิ้นสุดใช้ setHours ตาม TZ ของเบราว์เซอร์
 */
describe('isAuditLogInDayRange', () => {
  it('รายการ 00:30 น. ไทยของวันเริ่มอยู่ในช่วง (เดิมถูกซ่อน)', () => {
    expect(isAuditLogInDayRange('2026-11-01T00:30:00+07:00', '2026-11-01', '')).toBe(true);
    expect(isAuditLogInDayRange('2026-10-31T17:30:00.000Z', '2026-11-01', '')).toBe(true);
  });

  it('รายการ 23:59:59.999 น. ไทยของวันก่อนวันเริ่มอยู่นอกช่วง', () => {
    expect(isAuditLogInDayRange('2026-10-31T23:59:59.999+07:00', '2026-11-01', '')).toBe(false);
  });

  it('รายการ 23:30 น. ไทยของวันสิ้นสุดอยู่ในช่วง · 00:00 น. ไทยของวันถัดไปอยู่นอกช่วง', () => {
    expect(isAuditLogInDayRange('2026-11-17T23:30:00+07:00', '', '2026-11-17')).toBe(true);
    expect(isAuditLogInDayRange('2026-11-18T00:00:00+07:00', '', '2026-11-17')).toBe(false);
  });

  it('วันเดียว (เริ่ม = สิ้นสุด) ได้ทั้งวันไทย', () => {
    expect(isAuditLogInDayRange('2026-11-17T00:00:00+07:00', '2026-11-17', '2026-11-17')).toBe(true);
    expect(isAuditLogInDayRange('2026-11-17T23:59:59.999+07:00', '2026-11-17', '2026-11-17')).toBe(true);
    expect(isAuditLogInDayRange('2026-11-18T00:00:00+07:00', '2026-11-17', '2026-11-17')).toBe(false);
  });

  it('ไม่เลือกวันที่ = ผ่านทั้งหมด', () => {
    expect(isAuditLogInDayRange('2026-11-17T12:00:00+07:00', '', '')).toBe(true);
  });

  it('ไม่เลือกวันทั้งสองช่อง → true โดยไม่แตะ createdAt (createdAt ผิดรูปไม่พัง)', () => {
    expect(() => isAuditLogInDayRange('not-a-date', '', '')).not.toThrow();
    expect(isAuditLogInDayRange('not-a-date', '', '')).toBe(true);
  });
});
