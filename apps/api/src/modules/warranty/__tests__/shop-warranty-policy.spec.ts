import { resolveShopWarrantyDays } from '../shop-warranty-policy';
describe('warranty priority', () => {
  it.each(['PHONE_NEW', 'PHONE_USED', 'ACCESSORY'])('respects explicit days and zero for %s', category => {
    expect(resolveShopWarrantyDays({ category, shopWarrantyDays: 15 }, '90')).toBe(15);
    expect(resolveShopWarrantyDays({ category, shopWarrantyDays: 0 }, '90')).toBeNull();
  });
  it('only uses defaults for used phones without per-unit terms', () => {
    expect(resolveShopWarrantyDays({ category: 'PHONE_USED' }, '90')).toBe(90);
    expect(resolveShopWarrantyDays({ category: 'PHONE_USED' }, '0')).toBeNull();
    expect(resolveShopWarrantyDays({ category: 'PHONE_NEW' }, '90')).toBeNull();
    expect(resolveShopWarrantyDays({ category: 'ACCESSORY' }, '90')).toBeNull();
  });
  it.each([undefined, null, '', 'abc', '-1', '1.5', '90days'])('uses 60 days for invalid/missing default %s', value => {
    expect(resolveShopWarrantyDays({ category: 'PHONE_USED', shopWarrantyDays: null }, value)).toBe(60);
  });
});
