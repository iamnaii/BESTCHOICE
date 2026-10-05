import { businessSaleKey, salesBasis } from './chat-sales-attribution.service';
describe('Document attribution identity and basis', () => {
  it('uses explicit sale-contract relation and separates financial basis', () => {
    expect(businessSaleKey('SHOP', 'sale', 'contract')).toBe('SHOP:contract:contract');
    expect(businessSaleKey('SHOP', 'sale', null)).toBe('SHOP:sale:sale');
    expect(businessSaleKey('FINANCE', 'contract', null)).toBe('FINANCE:contract:contract');
    expect(salesBasis('SHOP')).toContain('netAmount');
    expect(salesBasis('FINANCE')).toContain('เงินต้น');
  });
});
