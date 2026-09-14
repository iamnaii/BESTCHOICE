import { describe, expect, it } from 'vitest';
import { callResultLabel } from '../utils/callResultLabels';

describe('callResultLabel', () => {
  it('ค่าที่เขียนลง CallLog.result ได้ป้ายไทย', () => {
    expect(['ANSWERED', 'NO_ANSWER', 'PROMISED', 'REFUSED', 'WRONG_NUMBER', 'OTHER'].map(callResultLabel)).toEqual([
      'รับสาย', 'ไม่รับสาย', 'นัดชำระ', 'ปฏิเสธ', 'เบอร์ผิด', 'อื่น ๆ',
    ]);
  });
  it('ค่าของ enum CallResult ใช้ป้ายเดียวกับชิปหน้าติดตามหนี้', () => {
    expect(['BUSY', 'DEVICE_OFF', 'UNREACHABLE'].map(callResultLabel)).toEqual(['สายไม่ว่าง', 'ปิดเครื่อง', 'เบอร์ไม่ติดต่อ']);
  });
  it('ค่าที่ไม่รู้จัก → "อื่น ๆ" ไม่โชว์ enum ดิบ', () => {
    expect(callResultLabel('CALLBACK_LATER')).toBe('อื่น ๆ');
    expect(callResultLabel('')).toBe('อื่น ๆ');
  });
});
