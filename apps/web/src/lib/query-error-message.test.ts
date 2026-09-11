import { describe, expect, it } from 'vitest';
import { queryErrorMessage } from './query-error-message';

describe('query error recovery', () => {
  it.each([[401, 'เข้าสู่ระบบ'], [403, 'ไม่มีสิทธิ์'], [404, 'กลับไปตรวจสอบรายการ'], [429, 'รอสักครู่'], [503, 'ระบบขัดข้องชั่วคราว']])('explains status %s without exposing server internals', (status, expected) => {
    const error = Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { message: 'Prisma secret internals' } } });
    expect(queryErrorMessage(error)).toContain(expected);
    expect(queryErrorMessage(error)).not.toMatch(/Prisma|Request failed/);
  });
  it('explains timeouts and network recovery', () => {
    expect(queryErrorMessage({ code: 'ECONNABORTED' })).toContain('เวลาตอบกลับ');
    expect(queryErrorMessage(new Error('Network Error'))).toContain('ตรวจสอบอินเทอร์เน็ต');
  });
  it('retains intended Thai validation and application messages', () => {
    expect(queryErrorMessage({ response: { status: 400, data: { message: ['กรุณาเลือกสาขา'] } } })).toBe('กรุณาเลือกสาขา');
    expect(queryErrorMessage(new Error('เครือข่ายขัดข้อง'))).toBe('เครือข่ายขัดข้อง');
  });
});
