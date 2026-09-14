import { assertCustomerHasPhone } from './contract-create-policy';

describe('assertCustomerHasPhone — ผู้สนใจจากแชทที่ยังไม่มีเบอร์ทำเอกสารไม่ได้', () => {
  it('เบอร์ null → BadRequest ข้อความบอกให้เติมเบอร์ก่อน', () => {
    expect(() => assertCustomerHasPhone({ phone: null }, 'ทำสัญญา')).toThrow('ลูกค้ายังไม่มีเบอร์โทร กรุณาเติมเบอร์ก่อนทำสัญญา');
  });
  it('เบอร์ว่าง → ปฏิเสธเหมือนกัน', () => {
    expect(() => assertCustomerHasPhone({ phone: '' }, 'เปิดใบขาย')).toThrow('ลูกค้ายังไม่มีเบอร์โทร กรุณาเติมเบอร์ก่อนเปิดใบขาย');
  });
  it('มีเบอร์ → ผ่านและคืนเบอร์ (narrow เป็น string)', () => {
    expect(assertCustomerHasPhone({ phone: '0812345678' }, 'ทำสัญญา')).toBe('0812345678');
  });
});
