import Decimal from 'decimal.js';
import {
  calcBcInstallment,
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
} from './installment-calc.util';
import type {
  BcConfig,
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  GfinRateFactorRow,
  ProductForGfin,
} from './installment-calc.types';

/**
 * Characterization (golden-value) tests for the BC + GFIN installment money math.
 *
 * Wave 3 test-backfill: this util had ZERO spec yet computes financed amount,
 * interest, commission, VAT, monthly payment and GFIN payback — all customer-
 * facing regulated money. These tests LOCK the CURRENT behaviour (including the
 * module-level `Decimal.set({ rounding: ROUND_HALF_UP })`) so a refactor can't
 * silently change a price. They intentionally do NOT assert what the numbers
 * "should" be per accounting policy — if the ROUND_HALF_UP vs ROUND_DOWN policy
 * question (see CODE_QUALITY review D6) is resolved, update the goldens here.
 */

const d = (n: Decimal.Value) => new Decimal(n);

describe('calcBcInstallment', () => {
  const config: BcConfig = {
    minDownPct: d('0.20'),
    commissionPct: d('0.10'),
    vatPct: d('0.07'),
    ratePctByMonths: new Map([
      [6, d('0.18')],
      [10, d('0.30')],
      [12, d('0.36')],
    ]),
    allowedMonths: [6, 10, 12],
  };

  it('computes the full BC breakdown for a valid 20%-down / 10-month contract', () => {
    const r = calcBcInstallment({
      installmentPrice: d('10000'),
      months: 10,
      downPct: d('0.20'),
      config,
    });

    expect(r.isValid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.downPct.toFixed(2)).toBe('0.20');
    expect(r.downAmount.toFixed(2)).toBe('2000.00');
    expect(r.financedAmount.toFixed(2)).toBe('8000.00');
    expect(r.interestPct.toFixed(2)).toBe('0.30');
    expect(r.interestAmount.toFixed(2)).toBe('2400.00');
    expect(r.commissionPct.toFixed(2)).toBe('0.10');
    expect(r.commissionAmount.toFixed(2)).toBe('800.00');
    expect(r.subtotal.toFixed(2)).toBe('11200.00');
    expect(r.vatAmount.toFixed(2)).toBe('784.00');
    expect(r.totalWithVat.toFixed(2)).toBe('11984.00');
    expect(r.monthlyPayment.toFixed(2)).toBe('1198.40');
    expect(r.financeToShop.toFixed(2)).toBe('8800.00');
  });

  it('derives downPct from an explicit customDownAmount', () => {
    const r = calcBcInstallment({
      installmentPrice: d('10000'),
      months: 10,
      customDownAmount: d('2500'),
      config,
    });

    expect(r.isValid).toBe(true);
    expect(r.downPct.toFixed(2)).toBe('0.25'); // 2500 / 10000
    expect(r.downAmount.toFixed(2)).toBe('2500.00');
    expect(r.financedAmount.toFixed(2)).toBe('7500.00');
    expect(r.interestAmount.toFixed(2)).toBe('2250.00');
    expect(r.commissionAmount.toFixed(2)).toBe('750.00');
    expect(r.subtotal.toFixed(2)).toBe('10500.00');
    expect(r.vatAmount.toFixed(2)).toBe('735.00');
    expect(r.totalWithVat.toFixed(2)).toBe('11235.00');
    expect(r.monthlyPayment.toFixed(2)).toBe('1123.50');
    expect(r.financeToShop.toFixed(2)).toBe('8250.00');
  });

  it('flags an out-of-table month and a below-minimum down payment, with rate 0', () => {
    const r = calcBcInstallment({
      installmentPrice: d('10000'),
      months: 9, // not in allowedMonths
      downPct: d('0.10'), // below minDownPct 0.20
      config,
    });

    expect(r.isValid).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain('จำนวนงวด 9');
    expect(r.errors[1]).toContain('20%');
    expect(r.interestPct.toFixed(2)).toBe('0.00'); // ratePctByMonths.get(9) ?? 0
    expect(r.interestAmount.toFixed(2)).toBe('0.00');
  });

  it('rejects a down payment that meets or exceeds the selling price', () => {
    const r = calcBcInstallment({
      installmentPrice: d('10000'),
      months: 10,
      customDownAmount: d('10000'),
      config,
    });

    expect(r.isValid).toBe(false);
    expect(r.errors.some((e) => e.includes('เงินดาวน์ต้องน้อยกว่าราคาขาย'))).toBe(true);
  });

  it('returns a zero monthly payment when months is 0 (no divide-by-zero)', () => {
    const r = calcBcInstallment({
      installmentPrice: d('10000'),
      months: 0,
      downPct: d('0.20'),
      config,
    });
    expect(r.monthlyPayment.toFixed(2)).toBe('0.00');
  });
});

describe('calcGfinInstallment', () => {
  const rateFactor12: GfinRateFactorRow = {
    months: 12,
    factor: d('0.05'),
    feePerInstallment: d('50'),
    isActive: true,
  };
  const mapping: GfinModelMappingRow = {
    id: 'm1',
    gfinSeries: 'iPhone 14',
    gfinVariant: null,
    storage: '128GB',
    condition: 'HAND_1',
    maxPrice: d('11000'),
    modelMatchPattern: 'iPhone 14 Pro',
    isActive: true,
  };
  const overpriceRule: GfinOverpriceRuleRow = {
    id: 'o1',
    label: 'iPhone 14 series',
    seriesPattern: 'iPhone 14|iPhone 15',
    condition: 'HAND_1',
    allowance: d('500'),
    isActive: true,
  };
  const product: ProductForGfin = {
    brand: 'Apple',
    model: 'iPhone 14 Pro',
    storage: '128GB',
    category: 'PHONE_NEW',
  };

  it('computes submit price, down discount and monthly payback for a valid GFIN deal', () => {
    const r = calcGfinInstallment({
      installmentPrice: d('10000'),
      product,
      months: 12,
      downPct: d('0.30'),
      mapping,
      overpriceRule,
      rateFactor: rateFactor12,
    });

    expect(r.isValid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.gfinSubmitPrice.toFixed(2)).toBe('11500.00'); // 11000 + 500
    expect(r.downDiscount.toFixed(2)).toBe('1500.00'); // max(11500 - 10000, 0)
    expect(r.downPct.toFixed(2)).toBe('0.30');
    expect(r.downAmountByFormula.toFixed(2)).toBe('3450.00'); // 11500 * 0.30
    expect(r.downAmountActual.toFixed(2)).toBe('1950.00'); // max(3450 - 1500, 0)
    expect(r.financedAmount.toFixed(2)).toBe('8050.00'); // 11500 - 3450
    expect(r.monthlyPayment.toFixed(2)).toBe('452.50'); // 0.05 * 8050 + 50
    expect(r.totalPayback.toFixed(2)).toBe('5430.00'); // 452.50 * 12
    expect(r.feePerInstallment.toFixed(2)).toBe('50.00');
  });

  it('defaults downPct to 0.30 and handles a null overprice rule (no discount)', () => {
    const r = calcGfinInstallment({
      installmentPrice: d('12000'),
      product,
      months: 10,
      mapping: { ...mapping, maxPrice: d('12000') },
      overpriceRule: null,
      rateFactor: { months: 10, factor: d('0.04'), feePerInstallment: d('0'), isActive: true },
    });

    expect(r.isValid).toBe(true);
    expect(r.downPct.toFixed(2)).toBe('0.30'); // default
    expect(r.gfinSubmitPrice.toFixed(2)).toBe('12000.00');
    expect(r.downDiscount.toFixed(2)).toBe('0.00');
    expect(r.downAmountByFormula.toFixed(2)).toBe('3600.00');
    expect(r.downAmountActual.toFixed(2)).toBe('3600.00');
    expect(r.financedAmount.toFixed(2)).toBe('8400.00');
    expect(r.monthlyPayment.toFixed(2)).toBe('336.00'); // 0.04 * 8400 + 0
    expect(r.totalPayback.toFixed(2)).toBe('3360.00');
  });

  it('flags a rate-factor month mismatch and an inactive rate', () => {
    const r = calcGfinInstallment({
      installmentPrice: d('10000'),
      product,
      months: 12,
      mapping,
      overpriceRule,
      rateFactor: { months: 10, factor: d('0.05'), feePerInstallment: d('50'), isActive: false },
    });

    expect(r.isValid).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain('12');
    expect(r.errors.some((e) => e.includes('ปิดใช้งาน'))).toBe(true);
  });
});

describe('findGfinMapping', () => {
  const base = {
    gfinVariant: null,
    condition: 'HAND_1' as const,
    maxPrice: new Decimal('0'),
    isActive: true,
  };
  const mappings: GfinModelMappingRow[] = [
    { ...base, id: 'a', gfinSeries: 'iPhone 14', storage: '128GB', modelMatchPattern: 'iPhone 14 Pro', maxPrice: d('20000') },
    { ...base, id: 'b', gfinSeries: 'iPhone 14', storage: '128 GB', modelMatchPattern: 'iPhone 14 Pro Max', maxPrice: d('25000') },
  ];

  it('prefers the longer (more specific) pattern when both could match', () => {
    const r = findGfinMapping(
      { brand: 'Apple', model: 'iPhone 14 Pro Max', storage: '128GB', category: 'PHONE_NEW' },
      mappings,
    );
    expect(r?.id).toBe('b'); // "iPhone 14 Pro Max" beats "iPhone 14 Pro"
  });

  it('falls back to the shorter pattern when the long one does not apply', () => {
    const r = findGfinMapping(
      { brand: 'Apple', model: 'iPhone 14 Pro', storage: '128GB', category: 'PHONE_NEW' },
      mappings,
    );
    expect(r?.id).toBe('a');
  });

  it('does not match on a partial word boundary (Pro vs ProMax)', () => {
    const r = findGfinMapping(
      { brand: 'Apple', model: 'iPhone 14 ProMax', storage: '128GB', category: 'PHONE_NEW' },
      mappings,
    );
    expect(r).toBeNull();
  });

  it('returns null when the condition (new vs used) does not match', () => {
    const r = findGfinMapping(
      { brand: 'Apple', model: 'iPhone 14 Pro', storage: '128GB', category: 'PHONE_USED' },
      mappings,
    );
    expect(r).toBeNull();
  });
});

describe('findGfinOverpriceRule', () => {
  const rule: GfinOverpriceRuleRow = {
    id: 'r1',
    label: 'iPhone 14/15',
    seriesPattern: 'iPhone 14 | iPhone 15',
    condition: 'HAND_1',
    allowance: new Decimal('500'),
    isActive: true,
  };
  const mapping: GfinModelMappingRow = {
    id: 'm', gfinSeries: 'iPhone 14', gfinVariant: null, storage: '128GB',
    condition: 'HAND_1', maxPrice: new Decimal('0'), modelMatchPattern: 'iPhone 14', isActive: true,
  };

  it('matches when the mapping series is in the pipe-delimited (trimmed) pattern', () => {
    expect(findGfinOverpriceRule(mapping, [rule])?.id).toBe('r1');
  });

  it('returns null when the series is not listed', () => {
    expect(findGfinOverpriceRule({ ...mapping, gfinSeries: 'iPhone 13' }, [rule])).toBeNull();
  });

  it('skips inactive rules and condition mismatches', () => {
    expect(findGfinOverpriceRule(mapping, [{ ...rule, isActive: false }])).toBeNull();
    expect(findGfinOverpriceRule({ ...mapping, condition: 'HAND_2' }, [rule])).toBeNull();
  });
});
