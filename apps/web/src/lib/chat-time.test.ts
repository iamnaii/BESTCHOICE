import { describe, it, expect } from 'vitest';
import { formatChatTimestamp, formatDateSeparator, formatWaitDuration } from './chat-time';

const NOW = new Date('2026-06-25T12:00:00');

describe('formatChatTimestamp', () => {
  it('returns "" for null/invalid', () => {
    expect(formatChatTimestamp(null, NOW)).toBe('');
    expect(formatChatTimestamp('not-a-date', NOW)).toBe('');
  });
  it('clamps just-now and future to เมื่อสักครู่', () => {
    expect(formatChatTimestamp(new Date('2026-06-25T11:59:40'), NOW)).toBe('เมื่อสักครู่');
    expect(formatChatTimestamp(new Date('2026-06-25T12:05:00'), NOW)).toBe('เมื่อสักครู่');
  });
  it('shows minutes under an hour', () => {
    expect(formatChatTimestamp(new Date('2026-06-25T11:45:00'), NOW)).toBe('15 นาที');
  });
  it('shows hours for earlier the same day', () => {
    expect(formatChatTimestamp(new Date('2026-06-25T09:00:00'), NOW)).toBe('3 ชม.');
  });
  it('shows เมื่อวาน for the previous calendar day', () => {
    expect(formatChatTimestamp(new Date('2026-06-24T23:00:00'), NOW)).toBe('เมื่อวาน');
  });
  it('shows d MMM for older this year', () => {
    expect(formatChatTimestamp(new Date('2026-06-10T10:00:00'), NOW)).toMatch(/10/);
  });
  it('shows d MMM yy for a previous year', () => {
    expect(formatChatTimestamp(new Date('2025-12-31T10:00:00'), NOW)).toMatch(/25$/);
  });
});

describe('formatDateSeparator', () => {
  it('วันนี้ / เมื่อวาน / dated', () => {
    expect(formatDateSeparator(new Date('2026-06-25T08:00:00'), NOW)).toBe('วันนี้');
    expect(formatDateSeparator(new Date('2026-06-24T08:00:00'), NOW)).toBe('เมื่อวาน');
    expect(formatDateSeparator(new Date('2026-06-01T08:00:00'), NOW)).toMatch(/1/);
    expect(formatDateSeparator(new Date('2025-06-01T08:00:00'), NOW)).toMatch(/2025/);
  });
});

describe('formatWaitDuration — ป้าย "รอ …" ในแถวคิว', () => {
  const NOW2 = new Date('2026-09-05T12:00:00');
  it('ว่าง/ไม่ใช่วันที่ → ""', () => {
    expect(formatWaitDuration(null, NOW2)).toBe('');
    expect(formatWaitDuration('x', NOW2)).toBe('');
  });
  it('ต่ำกว่า 1 ชม. → นาที (อนาคตเล็กน้อยปัดเป็น 0)', () => {
    expect(formatWaitDuration(new Date('2026-09-05T11:35:00'), NOW2)).toBe('25 นาที');
    expect(formatWaitDuration(new Date('2026-09-05T12:00:30'), NOW2)).toBe('0 นาที');
  });
  it('ต่ำกว่า 48 ชม. → ชั่วโมง', () => {
    expect(formatWaitDuration(new Date('2026-09-05T09:00:00'), NOW2)).toBe('3 ชม.');
    expect(formatWaitDuration(new Date('2026-09-03T13:00:00'), NOW2)).toBe('47 ชม.');
  });
  it('ตั้งแต่ 48 ชม. → วัน', () => {
    expect(formatWaitDuration(new Date('2026-09-03T12:00:00'), NOW2)).toBe('2 วัน');
    expect(formatWaitDuration('2026-08-30T12:00:00', NOW2)).toBe('6 วัน');
  });
});
