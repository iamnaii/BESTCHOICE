import { describe, it, expect } from 'vitest';
import { describeSendError, SEND_ERROR_WINDOW, SEND_ERROR_TOKEN } from './send-error';

describe('describeSendError — แปลเหตุที่ส่งล้มเป็นไทย', () => {
  it('ว่าง → null', () => {
    expect(describeSendError(undefined)).toBeNull();
    expect(describeSendError('')).toBeNull();
  });
  it('พ้นหน้าต่าง 24 ชม. (Graph #10 / subcode 2018278) ทั้งรูป JSON และรูปย่อ', () => {
    const body = '{"error":{"message":"(#10) This message is sent outside of allowed window.","code":10,"error_subcode":2018278}}';
    expect(describeSendError(body)).toBe(SEND_ERROR_WINDOW);
    expect(describeSendError('fb:10:2018278 ...')).toBe(SEND_ERROR_WINDOW);
    expect(describeSendError('Facebook API error 400: (#10) This message is sent outside of allowed window')).toBe(SEND_ERROR_WINDOW);
  });
  it('token หมดอายุ (#190)', () => {
    expect(describeSendError('{"error":{"message":"Error validating access token","code":190}}')).toBe(SEND_ERROR_TOKEN);
    expect(describeSendError('fb:190')).toBe(SEND_ERROR_TOKEN);
  });
  it('อื่น ๆ → ข้อความดิบ ตัดที่ 120 ตัวอักษร', () => {
    expect(describeSendError('boom')).toBe('boom');
    expect(describeSendError('x'.repeat(200))).toHaveLength(121);
  });
});
