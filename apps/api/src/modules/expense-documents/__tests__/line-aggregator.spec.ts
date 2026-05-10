import { Decimal } from '@prisma/client/runtime/library';
import { LineAggregatorService } from '../services/line-aggregator.service';

describe('LineAggregatorService', () => {
  const svc = new LineAggregatorService();

  it('exclusive VAT: qty=1, unitPrice=4500, vat=7%, wht=0%', () => {
    const r = svc.computeLine({ quantity: 1, unitPrice: 4500, discount: 0, vatPercent: 7, whtPercent: 0 }, 'EXCLUSIVE');
    expect(r.amountBeforeVat.toFixed(2)).toBe('4500.00');
    expect(r.vatAmount.toFixed(2)).toBe('315.00');
    expect(r.whtAmount.toFixed(2)).toBe('0.00');
  });

  it('inclusive VAT: lineSubtotal=1070, vat=7% → amountBeforeVat=1000, vat=70', () => {
    const r = svc.computeLine({ quantity: 1, unitPrice: 1070, discount: 0, vatPercent: 7, whtPercent: 0 }, 'INCLUSIVE');
    expect(r.amountBeforeVat.toFixed(2)).toBe('1000.00');
    expect(r.vatAmount.toFixed(2)).toBe('70.00');
  });

  it('discount applies before VAT/WHT', () => {
    const r = svc.computeLine({ quantity: 2, unitPrice: 1000, discount: 100, vatPercent: 7, whtPercent: 3 }, 'EXCLUSIVE');
    // (2 × 1000) − 100 = 1900
    expect(r.amountBeforeVat.toFixed(2)).toBe('1900.00');
    expect(r.vatAmount.toFixed(2)).toBe('133.00');
    expect(r.whtAmount.toFixed(2)).toBe('57.00');
  });

  it('WHT computed on amountBeforeVat (pre-VAT base)', () => {
    const r = svc.computeLine({ quantity: 1, unitPrice: 10000, discount: 0, vatPercent: 7, whtPercent: 3 }, 'EXCLUSIVE');
    expect(r.whtAmount.toFixed(2)).toBe('300.00'); // 10000 × 3%, NOT 10700 × 3%
  });

  it('rounding: ROUND_HALF_UP per line', () => {
    // 333.33 × 7% = 23.3331 → 23.33; 333.33 × 3% = 9.9999 → 10.00
    const r = svc.computeLine({ quantity: 1, unitPrice: 333.33, discount: 0, vatPercent: 7, whtPercent: 3 }, 'EXCLUSIVE');
    expect(r.vatAmount.toFixed(2)).toBe('23.33');
    expect(r.whtAmount.toFixed(2)).toBe('10.00');
  });

  it('aggregateLines sums per-line outputs', () => {
    const lines = [
      { amountBeforeVat: new Decimal('1000'), vatAmount: new Decimal('70'), whtAmount: new Decimal('30') },
      { amountBeforeVat: new Decimal('500'),  vatAmount: new Decimal('35'), whtAmount: new Decimal('0') },
    ];
    const t = svc.aggregateLines(lines as never);
    expect(t.subtotal.toFixed(2)).toBe('1500.00');
    expect(t.vatAmount.toFixed(2)).toBe('105.00');
    expect(t.withholdingTax.toFixed(2)).toBe('30.00');
    expect(t.totalAmount.toFixed(2)).toBe('1605.00');
    expect(t.netPayment.toFixed(2)).toBe('1575.00');
  });

  it('rejects line with negative qty/price/discount', () => {
    expect(() =>
      svc.computeLine({ quantity: -1, unitPrice: 100, discount: 0, vatPercent: 0, whtPercent: 0 }, 'EXCLUSIVE'),
    ).toThrow(/จำนวนต้องมากกว่า 0/);
  });
});
