import { describe, expect, it } from 'vitest';
import { showsMobileBottomNav } from '../mobile-nav-visibility';

describe('showsMobileBottomNav', () => {
  it.each(['/inbox', '/inbox/room-1', '/expenses/new'])('ซ่อนที่ %s', (path) => {
    expect(showsMobileBottomNav(path)).toBe(false);
  });
  it.each(['/', '/expenses', '/expenses/abc', '/expenses/newsletter', '/inboxes'])('แสดงที่ %s', (path) => {
    expect(showsMobileBottomNav(path)).toBe(true);
  });
});
