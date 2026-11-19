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

  it('downAmount = 3,000 (2,985 ปัดขึ้นหลักร้อย)', () => {
    expect(out.downAmount.toFixed(2)).toBe('3000.00');
  });

  it('financedAmount = 16,900', () => {
    expect(out.financedAmount.toFixed(2)).toBe('16900.00');
  });

  it('interestAmount = 8,450.00', () => {
    expect(out.interestAmount.toFixed(2)).toBe('8450.00');
  });

  it('commissionAmount = 1,690.00', () => {
    expect(out.commissionAmount.toFixed(2)).toBe('1690.00');
  });

  it('subtotal = 27,040.00', () => {
    expect(out.subtotal.toFixed(2)).toBe('27040.00');
  });

  it('vatAmount = 1,892.80', () => {
    expect(out.vatAmount.toFixed(2)).toBe('1892.80');
  });

  it('totalWithVat = 28,932.80', () => {
    expect(out.totalWithVat.toFixed(2)).toBe('28932.80');
  });

  it('monthlyPayment = 2,411.06', () => {
    expect(out.monthlyPayment.toFixed(2)).toBe('2411.06');
  });

  it('financeToShop = 18,590.00', () => {
    expect(out.financeToShop.toFixed(2)).toBe('18590.00');
  });
});

describe('calcBcInstallment — edge cases', () => {
  it('returns error when months not in allowed list', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 9,                                  // not in 5,6,7,8,10,12
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(false);
    expect(out.errors.some(e => e.includes('9'))).toBe(true);
  });

  it('returns error when down < minDown', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 12,
      downPct: new Decimal('0.10'),
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(false);
    expect(out.errors.some(e => e.includes('ต่ำกว่าขั้นต่ำ'))).toBe(true);
  });

  it('returns error when down >= price', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 12,
      customDownAmount: new Decimal('20000'),
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(false);
    expect(out.errors.some(e => e.includes('ต้องน้อยกว่าราคาขาย'))).toBe(true);
  });

  it('accepts custom down higher than min (50% down at 12 mo)', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 12,
      downPct: new Decimal('0.50'),
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(true);
    expect(out.downAmount.toFixed(2)).toBe('10000.00');
    expect(out.financedAmount.toFixed(2)).toBe('9900.00');
  });

  it('handles 5-mo with 40% rate', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 5,
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(true);
    expect(out.interestPct.toFixed(2)).toBe('0.40');
    // financed = 16900, interest = 16900 × 0.40 = 6760
    expect(out.interestAmount.toFixed(2)).toBe('6760.00');
  });

  it('handles 7-mo with 50% rate (transition boundary)', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 7,
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(true);
    expect(out.interestPct.toFixed(2)).toBe('0.50');
  });

  it('customDownAmount overrides downPct correctly', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 12,
      customDownAmount: new Decimal('5000'),
      config: DEFAULT_CONFIG,
    });
    expect(out.downAmount.toFixed(2)).toBe('5000.00');
    expect(out.financedAmount.toFixed(2)).toBe('14900.00');
  });

  it('ดาวน์ที่ส่งเป็นจำนวนเงินไม่ถูกปัด (2,985 คง 2,985)', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 12,
      customDownAmount: new Decimal('2985'),
      config: DEFAULT_CONFIG,
    });
    expect(out.downAmount.toFixed(2)).toBe('2985.00');
    expect(out.monthlyPayment.toFixed(2)).toBe('2413.20');
  });

  it('ดาวน์ขั้นต่ำที่ปัดแล้วยังผ่านการตรวจ % ขั้นต่ำ', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('25900'),
      months: 12,
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(true);
    expect(out.downAmount.toFixed(2)).toBe('3900.00');
    expect(out.financedAmount.toFixed(2)).toBe('22000.00');
    expect(out.monthlyPayment.toFixed(2)).toBe('3138.66');
  });

  it('ราคาต่ำมาก: ดาวน์ไม่ถูกปัดจนเท่าหรือเกินราคา', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('90'),
      months: 12,
      downPct: new Decimal('0.30'),
      config: DEFAULT_CONFIG,
    });
    expect(out.downAmount.toFixed(2)).toBe('27.00');
    expect(out.errors.some((e) => e.includes('ต้องน้อยกว่าราคาขาย'))).toBe(false);
  });
});

  it('quotes the same CPA rounded installment as the accounting ledger', () => {
    const out = calcBcInstallment({ installmentPrice: new Decimal(12500), customDownAmount: new Decimal(2500), months: 12,
      config: { ...DEFAULT_CONFIG, ratePctByMonths: new Map([[12, new Decimal('0.6')]]) } });
    expect(out.totalWithVat.toFixed(2)).toBe('18190.00');
    expect(out.monthlyPayment.toFixed(2)).toBe('1515.83');
  });

  it('keeps separate CPA rounding when the gross monthly total would add one satang', () => {
    const out = calcBcInstallment({ installmentPrice: new Decimal(10000), customDownAmount: new Decimal(2000), months: 12,
      config: { ...DEFAULT_CONFIG, ratePctByMonths: new Map([[12, new Decimal('0.3')]]) } });
    expect(out.monthlyPayment.toFixed(2)).toBe('998.66');
  });
