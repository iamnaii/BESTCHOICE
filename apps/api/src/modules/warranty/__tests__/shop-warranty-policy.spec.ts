import {
  resolveShopWarrantyDays,
  DEFAULT_SHOP_WARRANTY_DAYS,
} from '../shop-warranty-policy';

/**
 * สูตรนี้ถูกยกออกมาจาก `WarrantyService.setShopWarranty` เพื่อให้ขาใบขาย (ขายสด/
 * ไฟแนนซ์นอก) ใช้ตัวเดียวกัน — เทสต์ชุดนี้จึงปักว่า "พฤติกรรมเดิมไม่เปลี่ยน" เป็นหลัก
 */
describe('resolveShopWarrantyDays', () => {
  const used = { category: 'PHONE_USED', shopWarrantyDays: null };
  const brandNew = { category: 'PHONE_NEW', shopWarrantyDays: null };

  it('มือสองไม่ได้ตั้งวันไว้ → ได้ default 60 วัน', () => {
    expect(resolveShopWarrantyDays(used)).toBe(DEFAULT_SHOP_WARRANTY_DAYS);
  });

  // คำตัดสินเจ้าของ 2026-08-27: เครื่องใหม่ใช้ประกันศูนย์อย่างเดียว
  it('เครื่องใหม่ที่ไม่ได้ตั้งวันไว้ → ไม่มีประกันร้าน (null)', () => {
    expect(resolveShopWarrantyDays(brandNew)).toBeNull();
  });

  it('เครื่องใหม่ที่ตั้ง shopWarrantyDays ไว้เอง → ได้ตามที่ตั้ง', () => {
    expect(resolveShopWarrantyDays({ category: 'PHONE_NEW', shopWarrantyDays: 15 })).toBe(15);
  });

  it('อุปกรณ์เสริมที่ไม่ได้ตั้งวัน → ไม่มีประกันร้าน', () => {
    expect(resolveShopWarrantyDays({ category: 'ACCESSORY', shopWarrantyDays: null })).toBeNull();
  });

  describe('SystemConfig override', () => {
    it('ทับค่าของสินค้าเสมอ (พฤติกรรมเดิม ไม่ใช่บั๊กที่เพิ่งใส่)', () => {
      expect(resolveShopWarrantyDays({ category: 'PHONE_NEW', shopWarrantyDays: 15 }, '90')).toBe(
        90,
      );
      expect(resolveShopWarrantyDays(used, '90')).toBe(90);
    });

    it('ค่าที่ parse ไม่ได้ / เป็นศูนย์ → ตกกลับไป 60 (ตรงกับ parseInt(...) || 60 ของเดิม)', () => {
      expect(resolveShopWarrantyDays(used, 'abc')).toBe(DEFAULT_SHOP_WARRANTY_DAYS);
      expect(resolveShopWarrantyDays(used, '0')).toBe(DEFAULT_SHOP_WARRANTY_DAYS);
    });

    it('ค่าว่าง/null/undefined → ไม่ทับ ใช้ค่าของสินค้า', () => {
      expect(resolveShopWarrantyDays({ category: 'PHONE_NEW', shopWarrantyDays: 15 }, '')).toBe(15);
      expect(resolveShopWarrantyDays({ category: 'PHONE_NEW', shopWarrantyDays: 15 }, null)).toBe(
        15,
      );
      expect(resolveShopWarrantyDays(brandNew, undefined)).toBeNull();
    });

    it('override ไม่ทำให้เครื่องที่ "ไม่ได้ประกัน" กลายเป็นได้ประกัน', () => {
      // ด่านชนิดสินค้ามาก่อน override เสมอ — ไม่งั้นตั้ง config ทีเดียว
      // อุปกรณ์เสริมทั้งร้านจะมีประกันร้านขึ้นมาเงียบ ๆ
      expect(resolveShopWarrantyDays(brandNew, '90')).toBeNull();
    });
  });
});
