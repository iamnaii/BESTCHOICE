import { productWriteCapabilities } from './access-shop-price-capabilities';

describe('productWriteCapabilities — สิทธิ์เพิ่มของการเขียนสินค้า (พนักงานแบบจัดการสิทธิ์)', () => {
  it.each(['cashPrice', 'installmentPrice', 'prices', 'financePrice'])(
    'create/update ที่ส่ง %s ต้องมี pricing.update',
    (key) => {
      expect(productWriteCapabilities('update', { [key]: 1 })).toContain('pricing.update');
      expect(productWriteCapabilities('create', { [key]: 1 })).toContain('pricing.update');
    },
  );

  it('financePrice: null (ล้างราคาขาย GFIN) ก็ต้องมี pricing.update', () => {
    expect(productWriteCapabilities('update', { financePrice: null })).toEqual(['pricing.update']);
  });

  it('เส้นราคาแถว (add/update/removePrice) ต้องมี pricing.update', () => {
    for (const method of ['addPrice', 'updatePrice', 'removePrice']) {
      expect(productWriteCapabilities(method, {})).toEqual(['pricing.update']);
    }
  });

  it('costPrice ต้องมี products.cost.update · แก้ชื่ออย่างเดียวไม่ต้องมีสิทธิ์เพิ่ม', () => {
    expect(productWriteCapabilities('update', { costPrice: 1 })).toEqual(['products.cost.update']);
    expect(productWriteCapabilities('update', { name: 'x' })).toEqual([]);
    expect(productWriteCapabilities('update', undefined)).toEqual([]);
  });
});
