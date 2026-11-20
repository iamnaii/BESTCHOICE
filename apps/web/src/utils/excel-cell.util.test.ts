import { describe, it, expect } from 'vitest';
import { cellText, chunk } from './excel-cell.util';

describe('cellText', () => {
  it('ตัวเลข / ข้อความ / ว่าง', () => {
    expect(cellText(25900)).toBe('25900');
    expect(cellText('  มือ 1 ')).toBe('มือ 1');
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });

  it('เซลล์สูตรใช้ผลลัพธ์ · rich text ต่อกัน', () => {
    expect(cellText({ formula: 'E3', result: 25900 })).toBe('25900');
    expect(cellText({ richText: [{ text: 'iPhone ' }, { text: '15' }] })).toBe('iPhone 15');
    expect(cellText({ text: 'ลิงก์', hyperlink: 'https://x' })).toBe('ลิงก์');
  });
});

describe('chunk', () => {
  it('แบ่งเป็นชุดตามขนาด', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 100)).toEqual([]);
  });
});
