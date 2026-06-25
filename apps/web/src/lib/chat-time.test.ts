import { describe, it, expect } from 'vitest';
import { formatChatTimestamp, formatDateSeparator } from './chat-time';

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
