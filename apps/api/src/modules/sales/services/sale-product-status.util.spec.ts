import { SALE_TYPE_PRODUCT_STATUS, mainProductStatusFor } from './sale-product-status.util';

describe('sale-product-status.util — สถานะเครื่องหลักที่ใบขายแต่ละแบบตั้ง', () => {
  it('CASH → SOLD_CASH · EXTERNAL_FINANCE → SOLD_INSTALLMENT (แผนที่เดียวกับด่าน G5 ของ void)', () => {
    expect(SALE_TYPE_PRODUCT_STATUS.CASH).toBe('SOLD_CASH');
    expect(SALE_TYPE_PRODUCT_STATUS.EXTERNAL_FINANCE).toBe('SOLD_INSTALLMENT');
    expect(mainProductStatusFor('CASH')).toBe('SOLD_CASH');
    expect(mainProductStatusFor('EXTERNAL_FINANCE')).toBe('SOLD_INSTALLMENT');
  });
  it('INSTALLMENT (ขายผ่อนของเรา) ไม่อยู่ในแผนที่ → null', () => {
    expect(mainProductStatusFor('INSTALLMENT')).toBeNull();
  });
});
