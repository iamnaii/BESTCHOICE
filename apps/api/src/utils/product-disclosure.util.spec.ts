import { captureProductDisclosure, readProductDisclosure, disclosureText } from './product-disclosure.util';

describe('product disclosure snapshot', () => {
  it('freezes per-unit terms including explicit no warranty', () => {
    const product = { category: 'PHONE_USED', deviceOrigin: 'IMPORTED' as const, shopWarrantyDays: 0, warrantyTerms: ' shop terms ' };
    const snapshot = captureProductDisclosure(product, '90');
    product.shopWarrantyDays = 30;
    product.warrantyTerms = 'new terms';
    expect(readProductDisclosure(snapshot)).toEqual({ version: 1, deviceOrigin: 'IMPORTED', shopWarrantyDays: 0, warrantyTerms: 'shop terms' });
    expect(disclosureText(snapshot)).toContain('shop terms');
  });
  it('captures effective defaults and leaves legacy origin unknown', () => {
    expect(captureProductDisclosure({ category: 'PHONE_USED' }, '45')).toEqual({ version: 1, deviceOrigin: null, shopWarrantyDays: 45, warrantyTerms: null });
    expect(readProductDisclosure(null)).toBeNull();
    expect(readProductDisclosure({ version: 99 })).toBeNull();
  });
  it('freezes parts history for the customer and ignores later edits', () => {
    const product = {
      category: 'PHONE_USED', deviceOrigin: 'THAI' as const, shopWarrantyDays: 60, warrantyTerms: null,
      partsHistory: 'BATTERY_NON_GENUINE' as const, partsHistoryNote: ' เปลี่ยนแบต 26 ก.ย. 2569 ',
    };
    const snapshot = captureProductDisclosure(product, '60');
    product.partsHistory = 'ORIGINAL' as never;
    expect(readProductDisclosure(snapshot)).toMatchObject({ partsHistory: 'BATTERY_NON_GENUINE', partsHistoryNote: 'เปลี่ยนแบต 26 ก.ย. 2569' });
    expect(disclosureText(snapshot)).toBe(
      'เครื่องไทย · ประกันร้าน 60 วัน · ประวัติอะไหล่: เปลี่ยนแบตใหม่ (ไม่ใช่แบตแท้ Apple) · เปลี่ยนแบต 26 ก.ย. 2569',
    );
  });
  it('omits parts history when not specified and drops a malformed value without losing the snapshot', () => {
    const snapshot = captureProductDisclosure({ category: 'PHONE_USED', partsHistory: null, partsHistoryNote: 'ignored' }, '60');
    expect(snapshot).not.toHaveProperty('partsHistory');
    expect(disclosureText(snapshot)).not.toContain('ประวัติอะไหล่');
    const tampered = readProductDisclosure({ version: 1, deviceOrigin: null, shopWarrantyDays: 0, warrantyTerms: null, partsHistory: 'MADE_UP' });
    expect(tampered).toEqual({ version: 1, deviceOrigin: null, shopWarrantyDays: 0, warrantyTerms: null });
  });
});
