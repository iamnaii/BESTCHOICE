import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import { calcBcInstallment } from './installment-calc';
import type { BcConfig } from './installment-calc.types';

const DEFAULT_CONFIG: BcConfig = {
  minDownPct: new Decimal('0.15'),
  commissionPct: new Decimal('0.10'),
  vatPct: new Decimal('0.07'),
  ratePctByMonths: new Map<number, Decimal>([
    [5, new Decimal('0.40')],
    [6, new Decimal('0.40')],
    [7, new Decimal('0.50')],
    [8, new Decimal('0.50')],
    [10, new Decimal('0.50')],
    [12, new Decimal('0.50')],
  ]),
  allowedMonths: [5, 6, 7, 8, 10, 12],
};

describe('calcBcInstallment — canonical worked example (iPhone 14 Pro 128GB, 19,900, 12 mo, 15% down)', () => {
  const out = calcBcInstallment({
    installmentPrice: new Decimal('19900'),
    months: 12,
    config: DEFAULT_CONFIG,
  });

  it('isValid true with no errors', () => {
    expect(out.isValid).toBe(true);
    expect(out.errors).toEqual([]);
  });

  it('downAmount = 2,985', () => {
    expect(out.downAmount.toFixed(2)).toBe('2985.00');
  });

  it('financedAmount = 16,915', () => {
    expect(out.financedAmount.toFixed(2)).toBe('16915.00');
  });

  it('interestAmount = 8,457.50', () => {
    expect(out.interestAmount.toFixed(2)).toBe('8457.50');
  });

  it('commissionAmount = 1,691.50', () => {
    expect(out.commissionAmount.toFixed(2)).toBe('1691.50');
  });

  it('subtotal = 27,064.00', () => {
    expect(out.subtotal.toFixed(2)).toBe('27064.00');
  });

  it('vatAmount = 1,894.48', () => {
    expect(out.vatAmount.toFixed(2)).toBe('1894.48');
  });

  it('totalWithVat = 28,958.48', () => {
    expect(out.totalWithVat.toFixed(2)).toBe('28958.48');
  });

  it('monthlyPayment = 2,413.21', () => {
    expect(out.monthlyPayment.toFixed(2)).toBe('2413.21');
  });

  it('financeToShop = 18,606.50', () => {
    expect(out.financeToShop.toFixed(2)).toBe('18606.50');
  });
});
