import { describe, it, expect } from 'vitest';
import { computePoTotals } from './poTotals';

describe('computePoTotals — mirrors po-lifecycle.service.create()', () => {
  it('no-VAT supplier: net = subtotal - discount, no VAT line', () => {
    const t = computePoTotals({
      items: [{ quantity: '2', unitPrice: '1000' }, { quantity: '1', unitPrice: '500' }],
      discount: '300',
      discountAfterVat: '999', // must be ignored when !hasVat
      supplierHasVat: false,
    });
    expect(t.subtotal).toBe(2500);
    expect(t.discountNum).toBe(300);
    expect(t.subtotalAfterDiscount).toBe(2200);
    expect(t.vatAmount).toBe(0);
    expect(t.totalWithVat).toBe(2200);
    expect(t.discountAfterVatNum).toBe(0);
    expect(t.netAmount).toBe(2200);
  });

  it('VAT supplier: VAT = subtotalAfterDiscount * 0.07 ROUND_HALF_UP (half-satang rounds up)', () => {
    // 1050 * 0.07 = 73.5 -> HALF_UP -> 73.5 (exact); use a value that lands on a half-satang
    // 107.35 * 0.07 = 7.5145 -> 7.51 ; choose 100.50 -> 7.035 -> 7.04 (HALF_UP at 3rd dp 5)
    const t = computePoTotals({
      items: [{ quantity: '1', unitPrice: '100.50' }],
      discount: '0',
      discountAfterVat: '0',
      supplierHasVat: true,
    });
    expect(t.subtotalAfterDiscount).toBe(100.5);
    expect(t.vatAmount).toBe(7.04); // 7.035 rounds HALF_UP to 7.04
    expect(t.totalWithVat).toBe(107.54);
    expect(t.netAmount).toBe(107.54);
  });

  it('VAT supplier with both discounts: net = (sub-disc) + vat - discAfterVat', () => {
    const t = computePoTotals({
      items: [{ quantity: '10', unitPrice: '1000' }], // 10000
      discount: '1000',                                // -> 9000
      discountAfterVat: '500',
      supplierHasVat: true,
    });
    expect(t.subtotalAfterDiscount).toBe(9000);
    expect(t.vatAmount).toBe(630);        // 9000 * 0.07
    expect(t.totalWithVat).toBe(9630);
    expect(t.discountAfterVatNum).toBe(500);
    expect(t.netAmount).toBe(9130);
  });

  it('clamps discount to subtotal and discountAfterVat to totalWithVat', () => {
    const t = computePoTotals({
      items: [{ quantity: '1', unitPrice: '100' }],
      discount: '999',          // clamps to 100
      discountAfterVat: '999',  // clamps to totalWithVat
      supplierHasVat: true,
    });
    expect(t.discountNum).toBe(100);
    expect(t.subtotalAfterDiscount).toBe(0);
    expect(t.vatAmount).toBe(0);
    expect(t.totalWithVat).toBe(0);
    expect(t.discountAfterVatNum).toBe(0);
    expect(t.netAmount).toBe(0);
  });

  it('treats empty/NaN quantity & price as 0', () => {
    const t = computePoTotals({
      items: [{ quantity: '', unitPrice: '' }, { quantity: '2', unitPrice: '50' }],
      discount: '',
      discountAfterVat: '',
      supplierHasVat: false,
    });
    expect(t.subtotal).toBe(100);
    expect(t.netAmount).toBe(100);
  });
});
