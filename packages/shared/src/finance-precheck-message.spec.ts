import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRECHECK_TEMPLATE, buildPrecheckMessage, precheckMissingFields,
  computeAgeYears, formatThaiMobile, renderHand,
} from './finance-precheck-message';

const values = {
  customerName: 'สมหญิง ใจดี', occupation: 'พนักงานบริษัท', model: 'iPhone 13 Pro Max 256GB',
  hand: '2' as const, imei: '355908667841899', phone: '0937581095', age: 28,
  staffName: 'ป๊อปคอร์น', fileCount: 19, link: 'https://bestchoicephone.app/api/g/abc',
};

describe('buildPrecheckMessage', () => {
  it('renders the shop template byte-for-byte with dashes on items 8-12', () => {
    expect(buildPrecheckMessage(DEFAULT_PRECHECK_TEMPLATE, values)).toBe(
`รายละเอียดที่ต้องแจ้งเช็คค่ะ
1.ชื่อลูกค้า : สมหญิง ใจดี
2.ทำอาชีพ : พนักงานบริษัท
3.สนใจโทรศัพท์รุ่น : iPhone 13 Pro Max 256GB
4.มือ1/2 : 2
5.เลขอีมี่ : 355908667841899
6.เบอร์ลูกค้า : 093 758 1095
7.อายุ : 28 ปี
8.แบตเปลี่ยนมาหรือไม่? : -
9.แบตแท้หรือไม่แท้? : -
10.ลูกค้าทราบเรื่องแบตแล้วใช่ไหม? : -
11.มีกล่องหรือไม่? : -
12.มีสายชาร์จหรือไม่? : -
ส่งโดย ป๊อปคอร์น · BESTCHOICE
เอกสารทั้งหมด 19 ไฟล์: https://bestchoicephone.app/api/g/abc`);
  });
  it('leaves unknown placeholders untouched and never throws on nulls', () => {
    const text = buildPrecheckMessage('x {{nope}} {{customerName}}', { ...values, customerName: null });
    expect(text).toBe('x {{nope}} ');
  });
});
describe('precheckMissingFields', () => {
  it('lists the missing auto-filled fields in template order', () => {
    expect(precheckMissingFields({ ...values, occupation: null, age: null, phone: '' })).toEqual(['occupation', 'phone', 'age']);
    expect(precheckMissingFields(values)).toEqual([]);
  });
});
describe('helpers', () => {
  it('computeAgeYears handles birthday not yet reached this year', () => {
    expect(computeAgeYears('1997-12-27', new Date('2026-09-24T00:00:00Z'))).toBe(28);
    expect(computeAgeYears('1997-09-24', new Date('2026-09-24T00:00:00Z'))).toBe(29);
    expect(computeAgeYears(null)).toBeNull();
    expect(computeAgeYears('not-a-date')).toBeNull();
  });
  it('formatThaiMobile groups 3-3-4 and passes odd values through', () => {
    expect(formatThaiMobile('0937581095')).toBe('093 758 1095');
    expect(formatThaiMobile('+66937581095')).toBe('093 758 1095');
    expect(formatThaiMobile('12345')).toBe('12345');
    expect(formatThaiMobile(null)).toBe('');
  });
  it('renderHand maps PHONE_USED to 2, everything else to 1', () => {
    expect(renderHand('PHONE_USED')).toBe('2');
    expect(renderHand('PHONE_NEW')).toBe('1');
    expect(renderHand('TABLET')).toBe('1');
    expect(renderHand(null)).toBe('1');
  });
});
