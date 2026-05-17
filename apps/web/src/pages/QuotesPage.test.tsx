import { describe, it, expect } from 'vitest';
import { computeQuoteTotals } from './QuotesPage';

describe('computeQuoteTotals', () => {
  it('subtotal = sum(quantity * unitPrice) per row, rounded to 2dp', () => {
    const r = computeQuoteTotals(
      [
        { quantity: 1, unitPrice: 35000 },
        { quantity: 2, unitPrice: 5990 },
      ],
      0,
      0,
    );
    expect(r.subtotal).toBe(46980);
    expect(r.total).toBe(46980);
  });

  it('applies discount and vatAmount additively (total = subtotal - discount + vat)', () => {
    const r = computeQuoteTotals(
      [{ quantity: 1, unitPrice: 1000 }],
      100,
      70, // 7% VAT on subtotal
    );
    expect(r.subtotal).toBe(1000);
    expect(r.total).toBe(970); // 1000 - 100 + 70
  });

  it('total never goes negative (discount > subtotal+vat)', () => {
    const r = computeQuoteTotals(
      [{ quantity: 1, unitPrice: 100 }],
      500,
      0,
    );
    expect(r.subtotal).toBe(100);
    expect(r.total).toBe(0);
  });
});
