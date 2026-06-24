import { describe, it, expect } from 'vitest';
import {
  visibleCategories, categoryById, visibleItems, firstVisibleCategoryId, searchSettings, findItem,
} from '../settings-access';

describe('settings-access', () => {
  it('OWNER เห็นครบ 8 หมวด', () => {
    expect(visibleCategories('OWNER').map((c) => c.id)).toHaveLength(8);
  });

  it('FINANCE_MANAGER เห็น subset ที่มี item เห็นได้ (accounting, finance, comms) ไม่เห็น company/access/ai', () => {
    const ids = visibleCategories('FINANCE_MANAGER').map((c) => c.id);
    expect(ids).not.toContain('company');  // contacts ย้ายออกแล้ว → company เป็น OWNER-only
    expect(ids).toContain('accounting');   // chart, peak-mapping
    expect(ids).toContain('finance');      // payment-methods
    expect(ids).toContain('comms');        // sms
    expect(ids).not.toContain('access');   // OWNER-only items
    expect(ids).not.toContain('ai');
  });

  it('visibleItems กรองตาม role', () => {
    const acc = categoryById('accounting')!;
    const fmItems = visibleItems(acc, 'FINANCE_MANAGER').map((i) => i.id);
    expect(fmItems).toContain('chart');
    expect(fmItems).not.toContain('vat'); // OWNER-only
  });

  it('firstVisibleCategoryId คืนหมวดแรกที่ role เห็น', () => {
    expect(firstVisibleCategoryId('OWNER')).toBe('company');
    expect(firstVisibleCategoryId('FINANCE_MANAGER')).toBe('accounting'); // company ไม่มี item ที่ FM เห็นแล้ว
  });

  it('searchSettings match label + keywords และกรอง role', () => {
    const owner = searchSettings('โหมดทดสอบ', 'OWNER');
    expect(owner.some((r) => r.item.id === 'test-mode')).toBe(true);
    // FM ไม่เห็น test-mode (OWNER-only) → ไม่อยู่ในผล
    const fm = searchSettings('โหมดทดสอบ', 'FINANCE_MANAGER');
    expect(fm.some((r) => r.item.id === 'test-mode')).toBe(false);
    // keyword match
    expect(searchSettings('otp', 'OWNER').some((r) => r.item.id === 'test-mode')).toBe(true);
  });

  it('searchSettings query ว่าง → []', () => {
    expect(searchSettings('', 'OWNER')).toEqual([]);
  });

  it('findItem คืน category+item ที่ถูกต้อง', () => {
    const r = findItem('finance', 'interest');
    expect(r?.item.id).toBe('interest');
    expect(r?.category.id).toBe('finance');
    expect(findItem('finance', 'nope')).toBeUndefined();
    expect(findItem('nope', 'interest')).toBeUndefined();
  });
});
