import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import { calcGfinInstallment, findGfinMapping, findGfinOverpriceRule } from './installment-calc';
import type {
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  GfinRateFactorRow,
  ProductForGfin,
} from './installment-calc.types';

const mapping14Pro128: GfinModelMappingRow = {
  id: 'm1',
  gfinSeries: 'iPhone 14',
  gfinVariant: 'Pro',
  storage: '128GB',
  condition: 'HAND_2',
  maxPrice: new Decimal('21500'),
  modelMatchPattern: 'iPhone 14 Pro',
  isActive: true,
};

const overpriceIphone14Hand2: GfinOverpriceRuleRow = {
  id: 'r1',
  label: 'iPhone 14 มือ 2',
  seriesPattern: 'iPhone 14|iPhone 15',
  condition: 'HAND_2',
  allowance: new Decimal('1000'),
  isActive: true,
};

const factor12: GfinRateFactorRow = {
  months: 12,
  factor: new Decimal('0.179238'),
  feePerInstallment: new Decimal('100'),
  isActive: true,
};

const productIphone14Pro128Used: ProductForGfin = {
  brand: 'Apple',
  model: 'iPhone 14 Pro',
  storage: '128GB',
  category: 'PHONE_USED',
};

describe('calcGfinInstallment — canonical worked example', () => {
  const out = calcGfinInstallment({
    installmentPrice: new Decimal('19900'),
    product: productIphone14Pro128Used,
    months: 12,
    mapping: mapping14Pro128,
    overpriceRule: overpriceIphone14Hand2,
    rateFactor: factor12,
  });

  it('gfinSubmitPrice = 22,500', () => {
    expect(out.gfinSubmitPrice.toFixed(2)).toBe('22500.00');
  });

  it('downDiscount = 2,600', () => {
    expect(out.downDiscount.toFixed(2)).toBe('2600.00');
  });

  it('downAmountByFormula = 6,750', () => {
    expect(out.downAmountByFormula.toFixed(2)).toBe('6750.00');
  });

  it('downAmountActual = 4,150', () => {
    expect(out.downAmountActual.toFixed(2)).toBe('4150.00');
  });

  it('financedAmount = 15,750', () => {
    expect(out.financedAmount.toFixed(2)).toBe('15750.00');
  });

  it('monthlyPayment = 2,923.00', () => {
    expect(out.monthlyPayment.toFixed(2)).toBe('2923.00');
  });

  it('totalPayback = 35,076.00', () => {
    expect(out.totalPayback.toFixed(2)).toBe('35076.00');
  });
});

describe('findGfinMapping', () => {
  const allMappings: GfinModelMappingRow[] = [
    mapping14Pro128,
    { ...mapping14Pro128, id: 'm2', modelMatchPattern: 'iPhone 14 Pro Max', maxPrice: new Decimal('23500') },
    { ...mapping14Pro128, id: 'm3', storage: '256GB', maxPrice: new Decimal('22500') },
  ];

  it('matches iPhone 14 Pro vs iPhone 14 Pro Max correctly', () => {
    const proMax: ProductForGfin = { ...productIphone14Pro128Used, model: 'iPhone 14 Pro Max' };
    const matched = findGfinMapping(proMax, allMappings);
    expect(matched?.id).toBe('m2');
  });

  it('matches storage exactly', () => {
    const used256: ProductForGfin = { ...productIphone14Pro128Used, storage: '256GB' };
    const matched = findGfinMapping(used256, allMappings);
    expect(matched?.id).toBe('m3');
  });

  it('normalizes storage whitespace', () => {
    const padded: ProductForGfin = { ...productIphone14Pro128Used, storage: '128 GB' };
    const matched = findGfinMapping(padded, allMappings);
    expect(matched?.id).toBe('m1');
  });

  it('returns null when no row matches', () => {
    const samsung: ProductForGfin = { brand: 'Samsung', model: 'Galaxy S24', storage: '256GB', category: 'PHONE_USED' };
    expect(findGfinMapping(samsung, allMappings)).toBeNull();
  });

  it('returns null for inactive mapping', () => {
    const inactive = [{ ...mapping14Pro128, isActive: false }];
    expect(findGfinMapping(productIphone14Pro128Used, inactive)).toBeNull();
  });
});

describe('findGfinOverpriceRule', () => {
  const rules: GfinOverpriceRuleRow[] = [
    overpriceIphone14Hand2,
    { ...overpriceIphone14Hand2, id: 'r2', seriesPattern: 'iPhone 15|iPhone 16|iPhone 17', condition: 'HAND_1', allowance: new Decimal('2000') },
  ];

  it('matches series + condition correctly', () => {
    const rule = findGfinOverpriceRule(mapping14Pro128, rules);
    expect(rule?.id).toBe('r1');
  });

  it('returns null when no rule matches series', () => {
    const samsungMapping: GfinModelMappingRow = { ...mapping14Pro128, gfinSeries: 'iPhone 12' };
    expect(findGfinOverpriceRule(samsungMapping, rules)).toBeNull();
  });
});

describe('calcGfinInstallment — no overprice rule', () => {
  const out = calcGfinInstallment({
    installmentPrice: new Decimal('20500'),       // same as max — no discount
    product: productIphone14Pro128Used,
    months: 12,
    mapping: mapping14Pro128,
    overpriceRule: null,                          // not eligible for overprice
    rateFactor: factor12,
  });

  it('gfinSubmitPrice = maxPrice (no overprice added)', () => {
    expect(out.gfinSubmitPrice.toFixed(2)).toBe('21500.00');
  });

  it('downDiscount = 21500 - 20500 = 1,000', () => {
    expect(out.downDiscount.toFixed(2)).toBe('1000.00');
  });
});
