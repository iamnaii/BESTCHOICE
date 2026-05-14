import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { bucketWhtByRate } from './PaymentVoucherPage';

/**
 * W7 (Round 2) — Form 50 ทวิ is a legal cert; per-row sums MUST equal
 * the line-by-line totals exactly. parseFloat + += would drift on mixed-
 * rate docs. These tests pin the Decimal-precision contract.
 */
describe('bucketWhtByRate — W7 Decimal precision', () => {
  it('mixed 3% + 5% + 1% rates → three buckets with exact per-rate sums', () => {
    // Lines that intentionally exercise float drift: 0.1, 0.2, 0.3 + irrationals
    const lines = [
      // 3% bucket
      { lineNo: 1, category: '53-1302', description: 'a', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100.10', vatAmount: '7',
        whtAmount: '3.00', whtPercent: '3' },
      { lineNo: 2, category: '53-1302', description: 'b', quantity: '1',
        unitPrice: '200', amountBeforeVat: '200.20', vatAmount: '14',
        whtAmount: '6.00', whtPercent: '3' },
      // 5% bucket
      { lineNo: 3, category: '53-1303', description: 'c', quantity: '1',
        unitPrice: '1000', amountBeforeVat: '1000.33', vatAmount: '70',
        whtAmount: '50.00', whtPercent: '5' },
      // 1% bucket
      { lineNo: 4, category: '53-1304', description: 'd', quantity: '1',
        unitPrice: '5000', amountBeforeVat: '5000.10', vatAmount: '350',
        whtAmount: '50.00', whtPercent: '1' },
    ];
    const subtotal = new Decimal('6300.73');
    const wht = new Decimal('109.00');
    const buckets = bucketWhtByRate(lines, subtotal, wht);

    expect(buckets).toHaveLength(3);
    const byRate = new Map(buckets.map((b) => [b.rate.toFixed(2), b]));

    // 3% bucket: 100.10 + 200.20 = 300.30 (exact); tax = 9.00
    expect(byRate.get('3.00')!.base.toFixed(2)).toBe('300.30');
    expect(byRate.get('3.00')!.tax.toFixed(2)).toBe('9.00');
    // 5% bucket
    expect(byRate.get('5.00')!.base.toFixed(2)).toBe('1000.33');
    expect(byRate.get('5.00')!.tax.toFixed(2)).toBe('50.00');
    // 1% bucket
    expect(byRate.get('1.00')!.base.toFixed(2)).toBe('5000.10');
    expect(byRate.get('1.00')!.tax.toFixed(2)).toBe('50.00');
  });

  it('per-bucket totals equal the line-by-line sum exactly (no float drift)', () => {
    // 100 lines @ 0.1 each = 10.00 exact (parseFloat would give 9.999...)
    const lines = Array.from({ length: 100 }, (_, i) => ({
      lineNo: i + 1, category: '53-1302', description: '', quantity: '1',
      unitPrice: '0.1', amountBeforeVat: '0.1', vatAmount: '0',
      whtAmount: '0.003', whtPercent: '3',
    }));
    const buckets = bucketWhtByRate(lines, new Decimal('10'), new Decimal('0.30'));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].base.toFixed(2)).toBe('10.00');
    expect(buckets[0].tax.toFixed(2)).toBe('0.30');
  });

  it('legacy fallback — no rated lines → single weighted-average bucket', () => {
    const buckets = bucketWhtByRate([], new Decimal('1000'), new Decimal('30'));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].rate.toFixed(2)).toBe('3.00');
    expect(buckets[0].base.toFixed(2)).toBe('1000.00');
    expect(buckets[0].tax.toFixed(2)).toBe('30.00');
  });

  it('legacy fallback — zero subtotal → zero rate (no division by zero)', () => {
    const buckets = bucketWhtByRate([], new Decimal('0'), new Decimal('0'));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].rate.toFixed(2)).toBe('0.00');
  });

  it('buckets are sorted descending by tax amount', () => {
    const lines = [
      { lineNo: 1, category: '53-1302', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '1', whtPercent: '1' },
      { lineNo: 2, category: '53-1303', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '5', whtPercent: '5' },
      { lineNo: 3, category: '53-1304', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '3', whtPercent: '3' },
    ];
    const buckets = bucketWhtByRate(lines, new Decimal('300'), new Decimal('9'));
    expect(buckets[0].rate.toFixed(2)).toBe('5.00');
    expect(buckets[1].rate.toFixed(2)).toBe('3.00');
    expect(buckets[2].rate.toFixed(2)).toBe('1.00');
  });

  it('ignores lines with whtAmount=0 or whtPercent null', () => {
    const lines = [
      { lineNo: 1, category: '53-1302', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '0', whtPercent: '3' }, // zero wht → skip
      { lineNo: 2, category: '53-1303', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '5' }, // no whtPercent → skip
      { lineNo: 3, category: '53-1304', description: '', quantity: '1',
        unitPrice: '100', amountBeforeVat: '100', vatAmount: '0',
        whtAmount: '3', whtPercent: '3' }, // included
    ];
    const buckets = bucketWhtByRate(lines, new Decimal('300'), new Decimal('3'));
    expect(buckets).toHaveLength(1);
    expect(buckets[0].base.toFixed(2)).toBe('100.00');
    expect(buckets[0].tax.toFixed(2)).toBe('3.00');
  });
});
