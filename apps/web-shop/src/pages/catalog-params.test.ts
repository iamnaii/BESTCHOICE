import { describe, expect, it } from 'vitest';
import { buildCatalogParams, parseDownParam, parseMonthsParam } from './catalog-params';

const base = {
  filters: {},
  sort: 'popular',
  downAmount: null,
  months: null,
  freeDown: false,
  page: 1,
};

describe('buildCatalogParams', () => {
  it('ค่าเริ่มต้น: มีแค่ sort กับ page', () => {
    expect(buildCatalogParams(base).toString()).toBe('sort=popular&page=1');
  });

  it('ส่งตัวกรองเดิมครบ และเงินดาวน์ (บาท) / งวด', () => {
    const p = buildCatalogParams({
      ...base,
      filters: { deviceOrigin: 'IMPORTED', condition: 'USED', model: 'iPhone 15', minPrice: 10000, maxPrice: 15000, search: 'โปร' },
      downAmount: 5000,
      months: 12,
      page: 3,
    });
    expect(Object.fromEntries(p)).toEqual({
      deviceOrigin: 'IMPORTED',
      condition: 'USED',
      model: 'iPhone 15',
      minPrice: '10000',
      maxPrice: '15000',
      search: 'โปร',
      sort: 'popular',
      downAmount: '5000',
      months: '12',
      page: '3',
    });
  });

  it('ติ๊กฟรีดาวน์ → freeDown=true', () => {
    expect(buildCatalogParams({ ...base, freeDown: true }).get('freeDown')).toBe('true');
    expect(buildCatalogParams(base).has('freeDown')).toBe(false);
  });

  it('เว็บรุ่นนี้เลิกส่ง downPct', () => {
    expect(buildCatalogParams({ ...base, downAmount: 5000 }).has('downPct')).toBe(false);
  });

  it('ฟรีดาวน์ชนะเงินดาวน์ · เงินดาวน์ 0 ไม่ถูกส่ง', () => {
    const p = buildCatalogParams({ ...base, freeDown: true, downAmount: 5000 });
    expect(p.get('freeDown')).toBe('true');
    expect(p.has('downAmount')).toBe(false);
    expect(buildCatalogParams({ ...base, downAmount: 0 }).has('downAmount')).toBe(false);
  });
});

describe('parseDownParam', () => {
  it('รับเฉพาะจำนวนเต็มบาท ≥ 0 ไม่เกิน 7 หลัก · อย่างอื่น = null', () => {
    expect(parseDownParam('5000')).toBe(5000);
    expect(parseDownParam('0')).toBe(0);
    for (const bad of [null, '', '-1', '12.5', 'abc', '5,000', '12345678']) {
      expect(parseDownParam(bad)).toBeNull();
    }
  });
});

describe('parseMonthsParam', () => {
  it('รับเฉพาะจำนวนเต็ม 1..36 (เพดานที่ API รับ) · อย่างอื่น = null', () => {
    expect(parseMonthsParam('6')).toBe(6);
    expect(parseMonthsParam('1')).toBe(1);
    expect(parseMonthsParam('36')).toBe(36);
    for (const bad of [null, '', '0', '37', '48', '60', '99', '-3', '6.5', 'abc', '1e1', ' 6', '06x']) {
      expect(parseMonthsParam(bad)).toBeNull();
    }
  });
});
