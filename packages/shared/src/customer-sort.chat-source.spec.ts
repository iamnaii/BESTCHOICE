import { describe, it, expect } from 'vitest';
import { chatSourceOf, chatSourceChannel, normalizePersonName, CHAT_SOURCE_PREFIX, chatLogoOf } from './customer-sort';

describe('ที่มาจากแชท CHAT_<ช่องทาง>', () => {
  it('ประกอบ/แยกค่าที่มาได้ครบทุกช่องทาง', () => {
    expect(CHAT_SOURCE_PREFIX).toBe('CHAT_');
    expect(chatSourceOf('LINE_SHOP')).toBe('CHAT_LINE_SHOP');
    expect(chatSourceChannel('CHAT_LINE_SHOP')).toBe('LINE_SHOP');
    expect(chatSourceChannel('CHAT_FACEBOOK')).toBe('FACEBOOK');
    expect(chatLogoOf(chatSourceChannel('CHAT_LINE_FINANCE')!)).toBe('LINE');
  });
  it('ค่าที่ไม่ใช่ CHAT_ คืน null (AI_CHAT / WALK_IN / null / ว่าง)', () => {
    expect(chatSourceChannel('AI_CHAT')).toBeNull();
    expect(chatSourceChannel('WALK_IN')).toBeNull();
    expect(chatSourceChannel(null)).toBeNull();
    expect(chatSourceChannel('CHAT_')).toBeNull();
  });
});

describe('normalizePersonName', () => {
  it('ตัดช่องว่างซ้ำ/หัวท้าย ไม่สนตัวพิมพ์', () => {
    expect(normalizePersonName('  สมชาย   ใจดี ')).toBe('สมชาย ใจดี');
    expect(normalizePersonName('Somchai JAIDEE')).toBe('somchai jaidee');
  });
  it('ตัดคำนำหน้าไทย ทั้งแบบมีและไม่มีช่องว่าง (นางสาว ต้องชนะ นาง)', () => {
    expect(normalizePersonName('นาย สมชาย ใจดี')).toBe('สมชาย ใจดี');
    expect(normalizePersonName('นางสาวสมหญิง ใจดี')).toBe('สมหญิง ใจดี');
    expect(normalizePersonName('นางฟ้า')).toBe('นางฟ้า'); // ชื่อจริงที่ขึ้นต้นเหมือนคำนำหน้าแต่ไม่มีอะไรตาม ห้ามตัด
  });
  it('ค่าว่าง/null คืนสตริงว่าง', () => {
    expect(normalizePersonName(null)).toBe('');
    expect(normalizePersonName('   ')).toBe('');
  });
});
