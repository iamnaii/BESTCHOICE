import { describe, it, expect } from 'vitest';
import {
  catalogEntries,
  searchCatalog,
  latestModels,
  storageRange,
  resolveCategory,
  itemLabel,
} from './po-catalog.util';

describe('catalogEntries', () => {
  it('flattens the catalog with the brand on each entry, catalog order preserved', () => {
    const all = catalogEntries();
    expect(all[0]).toMatchObject({ brand: 'Apple', name: 'iPhone 17 Pro Max', category: 'PHONE_NEW' });
    expect(all.length).toBeGreaterThan(40);
  });
});

describe('searchCatalog — พิมพ์ค้นหารุ่น', () => {
  it('matches every token case-insensitively, shortest name first', () => {
    expect(searchCatalog('16 pro').map((e) => e.name).slice(0, 2)).toEqual(['iPhone 16 Pro', 'iPhone 16 Pro Max']);
  });

  it('matches with spaces removed ("16pro")', () => {
    expect(searchCatalog('16pro').map((e) => e.name)).toContain('iPhone 16 Pro');
  });

  it('filters by kind', () => {
    const tablets = searchCatalog('air', 'TABLET');
    expect(tablets.length).toBeGreaterThan(0);
    expect(tablets.every((e) => e.category === 'TABLET')).toBe(true);
    expect(searchCatalog('air', 'PHONE').map((e) => e.name)).toEqual(['iPhone Air']);
  });

  it('returns the whole kind in catalog order when the query is empty', () => {
    const phones = searchCatalog('', 'PHONE');
    expect(phones[0].name).toBe('iPhone 17 Pro Max');
    expect(phones.every((e) => e.category === 'PHONE_NEW')).toBe(true);
  });

  it('caps results at the limit', () => {
    expect(searchCatalog('iphone', 'PHONE', 5)).toHaveLength(5);
  });

  it('returns nothing for a query that matches no model', () => {
    expect(searchCatalog('galaxy')).toEqual([]);
  });
});

describe('latestModels', () => {
  it('returns the first n of a kind in catalog order (newest first)', () => {
    expect(latestModels('PHONE', 3).map((e) => e.name)).toEqual(['iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone Air']);
    expect(latestModels('TABLET', 1)[0].category).toBe('TABLET');
  });
});

describe('storageRange', () => {
  it('shows min – max when there are several sizes', () => {
    expect(storageRange(['256GB', '512GB', '1TB'])).toBe('256GB – 1TB');
  });
  it('shows the single size as is', () => {
    expect(storageRange(['64GB'])).toBe('64GB');
  });
  it('is empty when there are none', () => {
    expect(storageRange([])).toBe('');
  });
});

describe('resolveCategory', () => {
  const phone = { brand: 'Apple', name: 'iPhone 16', category: 'PHONE_NEW' as const, colors: [], storage: [] };
  const tablet = { brand: 'Apple', name: 'iPad (10th gen)', category: 'TABLET' as const, colors: [], storage: [] };
  it('phones take the chosen new/used mode', () => {
    expect(resolveCategory(phone, 'PHONE_NEW')).toBe('PHONE_NEW');
    expect(resolveCategory(phone, 'PHONE_USED')).toBe('PHONE_USED');
  });
  it('tablets are always TABLET', () => {
    expect(resolveCategory(tablet, 'PHONE_USED')).toBe('TABLET');
  });
});

describe('itemLabel', () => {
  const base = { brand: '', category: '', model: '', color: '', storage: '', quantity: '1', unitPrice: '', accessoryType: '', accessoryBrand: '' };
  it('device: brand model color storage', () => {
    expect(itemLabel({ ...base, brand: 'Apple', model: 'iPhone 16', color: 'Black', storage: '256GB', category: 'PHONE_NEW' })).toBe('Apple iPhone 16 Black 256GB');
  });
  it('accessory for models', () => {
    expect(itemLabel({ ...base, category: 'ACCESSORY', accessoryType: 'เคส', accessoryBrand: 'Spigen', model: 'iPhone 16, iPhone 16 Pro' })).toBe('เคส Spigen สำหรับ iPhone 16, iPhone 16 Pro');
  });
  it('charger: type brand connector', () => {
    expect(itemLabel({ ...base, category: 'ACCESSORY', accessoryType: 'ชุดชาร์จ', accessoryBrand: 'Anker', model: 'Type-C' })).toBe('ชุดชาร์จ Anker Type-C');
  });
  it('หูฟัง / อื่นๆ: type brand model without "สำหรับ"', () => {
    expect(itemLabel({ ...base, category: 'ACCESSORY', accessoryType: 'หูฟัง', accessoryBrand: 'Apple', model: 'AirPods Pro 2' })).toBe('หูฟัง Apple AirPods Pro 2');
    expect(itemLabel({ ...base, category: 'ACCESSORY', accessoryType: 'อื่นๆ', accessoryBrand: '', model: 'สายชาร์จ 1 ม.' })).toBe('อื่นๆ สายชาร์จ 1 ม.');
  });
  it('re-ordered existing product (code in accessoryType): the stored name wins', () => {
    expect(itemLabel({ ...base, category: 'ACCESSORY', accessoryType: 'F1601', accessoryBrand: 'iStar', model: 'ฟิล์มกระจก iPhone 16 - iStar', sourceName: 'ฟิล์มกระจก iPhone 16 - iStar' })).toBe('ฟิล์มกระจก iPhone 16 - iStar');
  });
});
