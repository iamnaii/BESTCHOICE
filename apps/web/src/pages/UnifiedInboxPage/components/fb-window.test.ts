import { describe, it, expect } from 'vitest';
import { fbWindowState, fbWindowHoursLeft, fbWindowLeftText, fbWindowFor } from './fb-window';

const NOW = new Date('2026-09-05T12:00:00Z');

describe('fbWindowState — หน้าต่าง 24 ชม. ของ Facebook', () => {
  it('ไม่มีข้อความลูกค้า / วันที่เพี้ยน → open (ไม่เตือนมั่ว)', () => {
    expect(fbWindowState(null, NOW)).toBe('open');
    expect(fbWindowState(undefined, NOW)).toBe('open');
    expect(fbWindowState('nope', NOW)).toBe('open');
  });
  it('เหลือมากกว่า 3 ชม. → open', () => {
    expect(fbWindowState('2026-09-05T08:00:00Z', NOW)).toBe('open');
  });
  it('เหลือไม่เกิน 3 ชม. → closing', () => {
    expect(fbWindowState('2026-09-04T14:30:00Z', NOW)).toBe('closing');
    expect(fbWindowState('2026-09-04T15:00:00Z', NOW)).toBe('closing');
  });
  it('พ้น 24 ชม. → closed', () => {
    expect(fbWindowState('2026-09-04T11:59:00Z', NOW)).toBe('closed');
    expect(fbWindowState('2026-05-13T02:11:39Z', NOW)).toBe('closed');
  });
});

describe('fbWindowHoursLeft / fbWindowLeftText', () => {
  it('ปัดขึ้นเป็นชั่วโมง และไม่ติดลบ', () => {
    expect(fbWindowHoursLeft('2026-09-04T14:30:00Z', NOW)).toBe(3);
    expect(fbWindowHoursLeft('2026-09-04T11:00:00Z', NOW)).toBe(0);
    expect(fbWindowHoursLeft(null, NOW)).toBe(0);
  });
  it('ข้อความ: ต่ำกว่าชั่วโมงเป็นนาที', () => {
    expect(fbWindowLeftText('2026-09-04T12:10:00Z', NOW)).toBe('10 นาที');
    expect(fbWindowLeftText('2026-09-04T14:30:00Z', NOW)).toBe('3 ชม.');
    expect(fbWindowLeftText('2026-09-04T11:00:00Z', NOW)).toBe('0 นาที');
  });
});

describe('fbWindowFor — เฉพาะ FACEBOOK เท่านั้นที่มีหน้าต่าง', () => {
  it('LINE ที่ลูกค้าทักเมื่อ 3 วันก่อน ยัง open', () => {
    expect(fbWindowFor({ channel: 'LINE_FINANCE', lastCustomerAt: '2026-09-02T12:00:00Z' }, NOW)).toBe('open');
  });
  it('FACEBOOK ใช้กฎปกติ', () => {
    expect(fbWindowFor({ channel: 'FACEBOOK', lastCustomerAt: '2026-09-02T12:00:00Z' }, NOW)).toBe('closed');
  });
});
