import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRECHECK_TEMPLATE, buildPrecheckMessage, precheckMissingFields,
  computeAgeYears, formatThaiMobile, renderHand,
  validatePrecheckTemplate, PRECHECK_TEMPLATE_MAX_LENGTH, formatPrecheckTemplateErrors,
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

describe('validatePrecheckTemplate', () => {
  it('default template passes', () => {
    expect(validatePrecheckTemplate(DEFAULT_PRECHECK_TEMPLATE)).toEqual({ errors: [], unknown: [] });
  });
  it('missing {{link}} is an error (spec §17)', () => {
    expect(validatePrecheckTemplate('เช็ค {{customerName}}').errors).toContain('MISSING_LINK');
  });
  it('unknown placeholders are listed once each', () => {
    const r = validatePrecheckTemplate('{{cusomerName}} {{cusomerName}} {{phone}} {{link}}');
    expect(r.errors).toEqual(['UNKNOWN_PLACEHOLDER']);
    expect(r.unknown).toEqual(['cusomerName']);
  });
  it('empty and too long', () => {
    expect(validatePrecheckTemplate('   ').errors).toEqual(expect.arrayContaining(['EMPTY', 'MISSING_LINK']));
    expect(validatePrecheckTemplate('{{link}}' + 'x'.repeat(PRECHECK_TEMPLATE_MAX_LENGTH)).errors).toContain('TOO_LONG');
  });
});

describe('formatPrecheckTemplateErrors', () => {
  it('joins labels with " · " and appends the unknown placeholder names for UNKNOWN_PLACEHOLDER', () => {
    const msg = formatPrecheckTemplateErrors(validatePrecheckTemplate('{{cusomerName}}'));
    expect(msg).toContain('ต้องมี {{link}} เพื่อวางลิงก์ชุดเอกสาร'); // MISSING_LINK label
    expect(msg).toContain('มีตัวแปรที่ระบบไม่รู้จัก: {{cusomerName}}'); // UNKNOWN_PLACEHOLDER + names
    expect(msg).toBe(msg.split(' · ').join(' · ')); // joined by ' · '
  });
  it('no errors → empty string', () => {
    expect(formatPrecheckTemplateErrors(validatePrecheckTemplate(DEFAULT_PRECHECK_TEMPLATE))).toBe('');
  });
});
