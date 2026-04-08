import { describe, it, expect, beforeEach } from 'vitest';
import { getErrorMessage, getAccessToken, setAccessToken } from './api';

describe('lib/api', () => {
  describe('getAccessToken / setAccessToken', () => {
    beforeEach(() => {
      setAccessToken(null);
    });

    it('starts out null when nothing has been set', () => {
      expect(getAccessToken()).toBeNull();
    });

    it('stores and returns the token set via setAccessToken', () => {
      setAccessToken('jwt-abc');
      expect(getAccessToken()).toBe('jwt-abc');
    });

    it('clears the token when setAccessToken(null) is called', () => {
      setAccessToken('jwt-abc');
      expect(getAccessToken()).toBe('jwt-abc');
      setAccessToken(null);
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('getErrorMessage', () => {
    it('returns the timeout message for ECONNABORTED', () => {
      expect(getErrorMessage({ code: 'ECONNABORTED' })).toBe(
        'เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่',
      );
    });

    it('returns the network-down message when there is no response object', () => {
      expect(getErrorMessage({ code: 'ERR_NETWORK' })).toBe(
        'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้',
      );
    });

    it('returns the rate-limit message on HTTP 429', () => {
      expect(
        getErrorMessage({ response: { status: 429, data: {} } }),
      ).toBe('คำขอถี่เกินไป กรุณารอสักครู่');
    });

    it('returns the server-provided message when data.message is a string', () => {
      expect(
        getErrorMessage({
          response: { status: 400, data: { message: 'กรุณาระบุชื่อ' } },
        }),
      ).toBe('กรุณาระบุชื่อ');
    });

    it('returns the first element when data.message is an array of validation errors', () => {
      expect(
        getErrorMessage({
          response: {
            status: 400,
            data: { message: ['กรุณาระบุชื่อ', 'กรุณาระบุเบอร์โทร'] },
          },
        }),
      ).toBe('กรุณาระบุชื่อ');
    });

    it('falls back to the generic Thai error for an unexpected shape', () => {
      expect(getErrorMessage({ response: { status: 500, data: {} } })).toBe(
        'เกิดข้อผิดพลาด',
      );
      expect(getErrorMessage(undefined)).toBe('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
      expect(getErrorMessage(null)).toBe('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    });

    it('prioritises ECONNABORTED over 429 when both are present', () => {
      // Real axios never sends both but we want the precedence to be explicit.
      expect(
        getErrorMessage({
          code: 'ECONNABORTED',
          response: { status: 429, data: {} },
        }),
      ).toBe('เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่');
    });
  });
});
