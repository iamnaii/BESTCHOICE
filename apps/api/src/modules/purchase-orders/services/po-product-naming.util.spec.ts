import { buildProductName } from './po-product-naming.util';

/**
 * Product name given to units received from a PO line (owner-approved accessory design,
 * 2026-09-06): ฟิล์ม/เคส fit a phone model → "type brand สำหรับ model"; ชุดชาร์จ → connector;
 * หูฟัง/อื่นๆ are products in their own right → "type brand model" (no "สำหรับ"); a line
 * re-ordered from an EXISTING product carries that product's code in accessoryType and its
 * exact name in model → the received unit keeps the same name.
 */
describe('buildProductName — accessories', () => {
  it('ฟิล์ม / เคส: "type brand สำหรับ model"', () => {
    expect(buildProductName({ accessoryType: 'เคส', accessoryBrand: 'Spigen', model: 'iPhone 16 Pro' }, 'ACCESSORY')).toBe('เคส Spigen สำหรับ iPhone 16 Pro');
    expect(buildProductName({ accessoryType: 'ฟิล์ม', accessoryBrand: 'Hoco', model: 'iPhone 16 Pro, iPhone 17 Pro' }, 'ACCESSORY')).toBe('ฟิล์ม Hoco สำหรับ iPhone 16 Pro, iPhone 17 Pro');
  });

  it('ชุดชาร์จ: connector without "สำหรับ"', () => {
    expect(buildProductName({ accessoryType: 'ชุดชาร์จ', accessoryBrand: 'Anker', model: 'Type-C' }, 'ACCESSORY')).toBe('ชุดชาร์จ Anker Type-C');
  });

  it('หูฟัง / อื่นๆ: "type brand model" without "สำหรับ"', () => {
    expect(buildProductName({ accessoryType: 'หูฟัง', accessoryBrand: 'Apple', model: 'AirPods Pro 2' }, 'ACCESSORY')).toBe('หูฟัง Apple AirPods Pro 2');
    expect(buildProductName({ accessoryType: 'อื่นๆ', accessoryBrand: '', model: 'สายชาร์จ 1 ม.' }, 'ACCESSORY')).toBe('อื่นๆ สายชาร์จ 1 ม.');
  });

  it('re-ordered existing product (code in accessoryType): keeps the existing name held in model', () => {
    expect(buildProductName({ accessoryType: 'F1601', accessoryBrand: 'iStar', model: 'ฟิล์มกระจก iPhone 16 - iStar' }, 'ACCESSORY')).toBe('ฟิล์มกระจก iPhone 16 - iStar');
  });

  it('existing product without a stored name falls back to code + brand', () => {
    expect(buildProductName({ accessoryType: 'F1601', accessoryBrand: 'iStar', model: '' }, 'ACCESSORY')).toBe('F1601 iStar');
  });

  it('devices are unchanged: brand model color storage', () => {
    expect(buildProductName({ brand: 'Apple', model: 'iPhone 16 Pro', color: 'Black Titanium', storage: '256GB' }, 'PHONE_NEW')).toBe('Apple iPhone 16 Pro Black Titanium 256GB');
  });
});
