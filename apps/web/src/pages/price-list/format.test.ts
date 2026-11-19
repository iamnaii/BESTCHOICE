import { describe, expect, it } from 'vitest';
import {
  RATE1_MISSING,
  emptyListMessage,
  formatBaht,
  formatCash,
  formatUpdatedAt,
  notFoundMessage,
  rate1View,
  rate2View,
  rowLabel,
  rowTitle,
  warrantyLabel,
} from './format';

describe('formatBaht / formatCash', () => {
  it('คั่นหลักพัน ไม่เติมทศนิยมให้ราคาเต็มบาท', () => {
    expect(formatBaht(25900)).toBe('25,900');
    expect(formatBaht(3139)).toBe('3,139');
    expect(formatBaht(0)).toBe('0');
    expect(formatBaht(1745.5)).toBe('1,745.5');
  });

  it('ราคาเงินสดว่าง → ขีด', () => {
    expect(formatCash(null)).toBe('—');
    expect(formatCash(8900)).toBe('8,900');
  });
});

describe('ชื่อแถว', () => {
  it('รุ่น · ความจุ (ตาม mockup) · ความจุว่าง = ชื่อรุ่นอย่างเดียว', () => {
    expect(rowTitle({ model: 'iPhone 15', storage: '128GB' })).toBe('iPhone 15 · 128GB');
    expect(rowTitle({ model: 'iPad Air', storage: ' ' })).toBe('iPad Air');
  });

  it('ป้ายประกัน: true/false มีป้าย · null (แถวที่ราคาเท่ากันรวมเป็นแถวเดียว) ไม่มีป้าย', () => {
    expect(warrantyLabel(true)).toBe('มีประกัน');
    expect(warrantyLabel(false)).toBe('ไม่มีประกัน');
    expect(warrantyLabel(null)).toBeNull();
  });

  it('ชื่อสำหรับโปรแกรมอ่านจอรวมป้ายประกัน', () => {
    expect(rowLabel({ model: 'iPhone 13', storage: '128GB', hasWarranty: true })).toBe('iPhone 13 · 128GB (มีประกัน)');
    expect(rowLabel({ model: 'iPhone 15', storage: '128GB', hasWarranty: null })).toBe('iPhone 15 · 128GB');
  });
});

describe('ข้อความไม่พบ (สเปคข้อ 6 — ตรงทุกตัวอักษร)', () => {
  it('มือ 1 → ชวนสลับเป็นมือ 2', () => {
    expect(notFoundMessage('iPhone 11', 'PHONE_NEW')).toBe(
      'ไม่พบ "iPhone 11" ในตารางราคา มือ 1 — ลองสลับเป็นมือ 2 หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้',
    );
  });

  it('มือ 2 → ชวนสลับเป็นมือ 1', () => {
    expect(notFoundMessage('iPhone 17', 'PHONE_USED')).toBe(
      'ไม่พบ "iPhone 17" ในตารางราคา มือ 2 — ลองสลับเป็นมือ 1 หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้',
    );
  });

  it('ไม่ได้ค้นและไม่มีแถวเลย', () => {
    expect(emptyListMessage('PHONE_USED')).toBe('ยังไม่มีราคามือ 2 ในตารางราคา — แจ้งเจ้าของให้เพิ่มราคา');
  });
});

describe('formatUpdatedAt', () => {
  it('แสดงเวลาไทย วัน เดือนย่อ ปี พ.ศ.', () => {
    expect(formatUpdatedAt('2026-10-16T07:30:00.000Z')).toBe('16 ต.ค. 2569 14:30 น.');
  });

  it('ข้ามวันตามเวลาไทย ไม่ใช่ UTC (17:30Z = 00:30 ของวันถัดไป)', () => {
    expect(formatUpdatedAt('2026-10-15T17:30:00.000Z')).toBe('16 ต.ค. 2569 00:30 น.');
  });

  it('ค่าเสีย → null', () => {
    expect(formatUpdatedAt('not-a-date')).toBeNull();
  });
});

describe('rate views', () => {
  const terms = { downAmount: 3900, monthly: 3139, months: 12 };

  it('เรท 1 มีค่า / ว่าง', () => {
    expect(rate1View(terms)).toEqual({ ok: true, terms });
    expect(rate1View(null)).toEqual({ ok: false, text: RATE1_MISSING });
  });

  it('เรท 2 ไม่รับ → ใช้ข้อความจาก API ตรง ๆ', () => {
    expect(rate2View({ unavailable: 'GFIN ไม่รับรุ่นนี้' })).toEqual({ ok: false, text: 'GFIN ไม่รับรุ่นนี้' });
    expect(rate2View(terms)).toEqual({ ok: true, terms });
  });
});
