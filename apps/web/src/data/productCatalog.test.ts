import { describe, it, expect } from 'vitest';
import { productCatalog } from './productCatalog';

const apple = productCatalog.find((b) => b.brand === 'Apple')!;

describe('productCatalog — iPhone 18 Pro (ก.ย. 2026)', () => {
  it.each(['iPhone 18 Pro Max', 'iPhone 18 Pro'])('%s: สีตาม apple.com · ความจุตามชีต MASTER', (name) => {
    expect(apple.models.find((m) => m.name === name)).toEqual({
      name,
      category: 'PHONE_NEW',
      colors: ['Black', 'Silver', 'Glacier', 'Burgundy'],
      storage: ['256GB', '512GB', '1TB', '2TB'],
    });
  });

  it('รุ่นใหม่สุดอยู่บนสุด (ปุ่ม "รุ่นล่าสุด" ของใบสั่งซื้อเรียงตามรายการนี้)', () => {
    expect(apple.models.slice(0, 3).map((m) => m.name)).toEqual([
      'iPhone 18 Pro Max',
      'iPhone 18 Pro',
      'iPhone 17 Pro Max',
    ]);
  });

  it('ชื่อรุ่นไม่ซ้ำ', () => {
    const names = apple.models.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
