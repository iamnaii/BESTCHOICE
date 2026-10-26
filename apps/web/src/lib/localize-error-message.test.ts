import { describe, expect, it } from 'vitest';
import { localizeErrorMessage } from './localize-error-message';

describe('localizeErrorMessage', () => {
  it('preserves actionable Thai messages and identifiers', () => {
    expect(localizeErrorMessage('IMEI 000123 ซ้ำในระบบ', 400)).toBe('IMEI 000123 ซ้ำในระบบ');
    expect(localizeErrorMessage([null, 'กรุณาระบุยอดเงิน', 'กรุณาระบุวันที่'], 400)).toBe('กรุณาระบุยอดเงิน');
  });
  it('translates a known configuration error rather than hiding the cause', () => {
    expect(localizeErrorMessage('FINANCE company not configured', 500)).toContain('ยังไม่ได้ตั้งค่าบริษัทงานการเงิน');
  });
  it('does not expose English validation or server internals to the operator', () => {
    expect(localizeErrorMessage(['amount must be a number'], 400)).toContain('ตรวจสอบช่องกรอก');
    expect(localizeErrorMessage('PrismaClientKnownRequestError', 500)).toContain('ตรวจสอบรายการก่อนทำซ้ำ');
  });
  it.each([401, 403, 404, 409, 422, 500])('handles missing or malformed messages for status %s', (status) => {
    expect(localizeErrorMessage({ message: 'unexpected' }, status)).toMatch(/[ก-๙]/);
  });
  it.each(['constructor', 'toString', '__proto__'])('treats %s as text, not an inherited property', (message) => {
    expect(localizeErrorMessage(message, 400)).toBe('ข้อมูลไม่ถูกต้องหรือไม่ครบถ้วน กรุณาตรวจสอบช่องกรอก');
  });
});
