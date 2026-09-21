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
});
