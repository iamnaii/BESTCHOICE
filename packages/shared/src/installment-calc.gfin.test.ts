import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import {
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  findGfinRateFactor,
} from './installment-calc';
import { formatRateLine, gfinDownPctOptions } from './gfin-customer-summary';
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
  maxMonths: 12,
  isActive: true,
};

const factor12: GfinRateFactorRow = {
  months: 12,
  shopCommissionPct: 15,
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

// ─── 2026-09-11: ให้ตรงหน้าคำนวณสินเชื่อ/ขอสินเชื่อของ GFIN + กติกาของร้าน ────────────
const mapping15_128: GfinModelMappingRow = {
  id: 'm15',
  gfinSeries: 'iPhone 15',
  gfinVariant: null,
  storage: '128GB',
  condition: 'HAND_1',
  maxPrice: new Decimal('23000'),
  modelMatchPattern: 'iPhone 15',
  isActive: true,
};
const over15h1: GfinOverpriceRuleRow = {
  id: 'r15',
  label: 'iPhone 15 มือ 1',
  seriesPattern: 'iPhone 15',
  condition: 'HAND_1',
  allowance: new Decimal('1000'),
  maxMonths: 12,
  isActive: true,
};
const factor12c15: GfinRateFactorRow = {
  months: 12,
  shopCommissionPct: 15,
  factor: new Decimal('0.179238'),
  feePerInstallment: new Decimal('100'),
  isActive: true,
};
const productIphone15New: ProductForGfin = {
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW',
};

describe('calcGfinInstallment — GFIN portal parity (2026-09-11)', () => {
  const out = calcGfinInstallment({
    installmentPrice: new Decimal('19900'),
    product: productIphone15New,
    months: 12,
    downPct: new Decimal('0.25'),
    mapping: mapping15_128,
    overpriceRule: over15h1,
    rateFactor: factor12c15,
  });

  it('ราคาส่ง 24,000 · ส่วนลดดาวน์ 4,100 · ดาวน์ตามสูตร 6,000 · ดาวน์จริง 1,900 · ยอดจัด 18,000', () => {
    expect(out.gfinSubmitPrice.toFixed(2)).toBe('24000.00');
    expect(out.downDiscount.toFixed(2)).toBe('4100.00');
    expect(out.downAmountByFormula.toFixed(2)).toBe('6000.00');
    expect(out.downAmountActual.toFixed(2)).toBe('1900.00');
    expect(out.financedAmount.toFixed(2)).toBe('18000.00');
  });

  it('ค่างวดปัดขึ้นเป็นบาท: ceil(18000 × 0.179238 = 3226.28) = 3227 + ค่าล็อกเครื่อง 100 = 3,327', () => {
    expect(out.monthlyPayment.toFixed(2)).toBe('3327.00');
    expect(out.totalPayback.toFixed(2)).toBe('39924.00');
  });

  it('ฝั่งร้าน: คอม 15% ของยอดจัด = 2,700 · ค่าทำสัญญา 100 · โอนให้ร้าน 20,600 · ร้านรับรวม 22,500', () => {
    expect(out.shopCommissionPct.toNumber()).toBe(15);
    expect(out.shopCommissionAmount.toFixed(2)).toBe('2700.00');
    expect(out.contractFee.toFixed(2)).toBe('100.00');
    expect(out.netTransferToShop.toFixed(2)).toBe('20600.00');
    expect(out.shopTotalReceived.toFixed(2)).toBe('22500.00');
    expect(out.priceAboveSubmit).toBe(false);
    expect(out.isValid).toBe(true);
  });

  it('ภาพจริง iPhone 17e: ราคาส่ง 22,000 ดาวน์ 25% = 5,500 ยอดจัด 16,500 → คอม 2,475 · โอนให้ร้าน 18,875 · งวดละ 2,521', () => {
    const mapping17e: GfinModelMappingRow = {
      ...mapping15_128,
      id: 'm17e',
      gfinSeries: 'iPhone 17e',
      storage: '256GB',
      maxPrice: new Decimal('22000'),
      modelMatchPattern: 'iPhone 17e',
    };
    const o = calcGfinInstallment({
      installmentPrice: new Decimal('22000'),
      product: { brand: 'Apple', model: 'iPhone 17e', storage: '256GB', category: 'PHONE_NEW' },
      months: 15,
      downPct: new Decimal('0.25'),
      mapping: mapping17e,
      overpriceRule: null,
      rateFactor: {
        months: 15,
        shopCommissionPct: 15,
        factor: new Decimal('0.1467'),
        feePerInstallment: new Decimal('100'),
        isActive: true,
      },
    });
    expect(o.downAmountByFormula.toFixed(2)).toBe('5500.00');
    expect(o.financedAmount.toFixed(2)).toBe('16500.00');
    expect(o.shopCommissionAmount.toFixed(2)).toBe('2475.00');
    expect(o.netTransferToShop.toFixed(2)).toBe('18875.00');
    // ceil(16500 × 0.1467 = 2420.55) = 2421 + 100
    expect(o.monthlyPayment.toFixed(2)).toBe('2521.00');
  });

  it('ราคาผ่อนที่ต้องการสูงกว่าราคาส่งสูงสุด → ส่วนลดดาวน์ 0 และ priceAboveSubmit = true', () => {
    const o = calcGfinInstallment({
      installmentPrice: new Decimal('26000'),
      product: productIphone15New,
      months: 12,
      downPct: new Decimal('0.25'),
      mapping: mapping15_128,
      overpriceRule: over15h1,
      rateFactor: factor12c15,
    });
    expect(o.downDiscount.toFixed(2)).toBe('0.00');
    expect(o.downAmountActual.toFixed(2)).toBe('6000.00');
    expect(o.priceAboveSubmit).toBe(true);
  });

  it('ค่าทำสัญญากำหนดเองได้ และ default ดาวน์ยังเป็น 30% เมื่อไม่ส่ง downPct (ผู้เรียกเก่าไม่เปลี่ยน)', () => {
    const o = calcGfinInstallment({
      installmentPrice: new Decimal('19900'),
      product: productIphone15New,
      months: 12,
      mapping: mapping15_128,
      overpriceRule: over15h1,
      rateFactor: factor12c15,
      contractFee: new Decimal('150'),
    });
    expect(o.downPct.toString()).toBe('0.3');
    expect(o.contractFee.toFixed(2)).toBe('150.00');
    // ดาวน์ 30% ของ 24,000 = 7,200 → ยอดจัด 16,800 · คอม 2,520 · โอน = 16,800 + 2,520 − 150
    expect(o.netTransferToShop.toFixed(2)).toBe('19170.00');
  });

  it('shopCommissionPct ใน input ไม่ตรงกับเรทที่ส่งมา → isValid=false พร้อมข้อความ', () => {
    const o = calcGfinInstallment({
      installmentPrice: new Decimal('19900'),
      product: productIphone15New,
      months: 12,
      shopCommissionPct: new Decimal('5'),
      mapping: mapping15_128,
      overpriceRule: over15h1,
      rateFactor: factor12c15,
    });
    expect(o.isValid).toBe(false);
    expect(o.errors.join(' ')).toContain('คอมมิชชั่น');
  });
});

describe('findGfinRateFactor / findGfinMapping TABLET / formatRateLine / gfinDownPctOptions', () => {
  it('เลือกเรทตาม (งวด, %คอม) และข้ามแถวที่ปิดใช้งาน', () => {
    const rows: GfinRateFactorRow[] = [
      {
        months: 12,
        shopCommissionPct: 15,
        factor: new Decimal('0.18'),
        feePerInstallment: new Decimal('100'),
        isActive: true,
      },
      {
        months: 12,
        shopCommissionPct: 5,
        factor: new Decimal('0.16'),
        feePerInstallment: new Decimal('100'),
        isActive: false,
      },
    ];
    expect(findGfinRateFactor(rows, 12, 15)?.factor.toString()).toBe('0.18');
    expect(findGfinRateFactor(rows, 12, 5)).toBeNull();
    expect(findGfinRateFactor(rows, 10, 15)).toBeNull();
  });

  it('TABLET แมปเป็นสภาพ HAND_1', () => {
    const ipad: GfinModelMappingRow = {
      id: 't1',
      gfinSeries: 'iPad 10',
      gfinVariant: null,
      storage: '64GB',
      condition: 'HAND_1',
      maxPrice: new Decimal('12000'),
      modelMatchPattern: 'iPad 10',
      isActive: true,
    };
    const matched = findGfinMapping(
      { brand: 'Apple', model: 'iPad 10', storage: '64GB', category: 'TABLET' },
      [ipad],
    );
    expect(matched?.id).toBe('t1');
  });

  it('formatRateLine ใช้รูปแบบเดียวกับสติกเกอร์หน้าร้าน (ไม่มีชื่อไฟแนนซ์/ดอกเบี้ย)', () => {
    expect(formatRateLine(1, 2985, 1838.26, 12)).toBe(
      'เรทที่ 1 ดาวน์ 2,985 บาท ผ่อนเดือนละ 1,838.26 บาท 12 งวด',
    );
    expect(formatRateLine(2, 1900, 3327, 12)).toBe(
      'เรทที่ 2 ดาวน์ 1,900 บาท ผ่อนเดือนละ 3,327 บาท 12 งวด',
    );
  });

  it('gfinDownPctOptions 25 → 80 ขั้นละ 5', () => {
    expect(gfinDownPctOptions(25)).toEqual([25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]);
    expect(gfinDownPctOptions(30, 40, 5)).toEqual([30, 35, 40]);
  });
});

describe('calcGfinInstallment — OVER ตามที่มาเครื่อง (เจ้าของยืนยัน 2026-09-26)', () => {
  // ตัวเลขจริงจากลิสต์พนักงาน 26 ก.ย. (เครื่องไทย) และตารางโปรในบอท (เครื่องนอก): 16 Pro 128 มือ 2
  const mapping16Pro128: GfinModelMappingRow = {
    id: 'm16p',
    gfinSeries: 'iPhone 16',
    gfinVariant: 'Pro',
    storage: '128GB',
    condition: 'HAND_2',
    maxPrice: new Decimal('28000'),
    modelMatchPattern: 'iPhone 16 Pro',
    isActive: true,
  };
  const over16h2: GfinOverpriceRuleRow = {
    id: 'r16',
    label: 'iPhone 16, 17 มือ 2',
    seriesPattern: 'iPhone 16|iPhone 16e|iPhone 17|iPhone 17e|iPhone Air',
    condition: 'HAND_2',
    allowance: new Decimal('2000'),
    maxMonths: 15,
    isActive: true,
  };
  const factor15: GfinRateFactorRow = {
    months: 15,
    shopCommissionPct: 15,
    factor: new Decimal('0.1467'),
    feePerInstallment: new Decimal('100'),
    isActive: true,
  };
  const base = {
    product: { brand: 'Apple', model: 'iPhone 16 Pro', storage: '128GB', category: 'PHONE_USED' } as ProductForGfin,
    months: 15,
    downPct: new Decimal('0.25'),
    mapping: mapping16Pro128,
    overpriceRule: over16h2,
    rateFactor: factor15,
  };

  it('เครื่องไทย: OVER เต็ม 2,000 → ราคาส่ง 30,000 · ฟรีดาวน์ที่ราคาผ่อน 22,500 · 3,401 × 15', () => {
    const o = calcGfinInstallment({ ...base, installmentPrice: new Decimal('22500'), deviceOrigin: 'THAI' });
    expect(o.allowanceFull.toFixed(0)).toBe('2000');
    expect(o.allowanceApplied.toFixed(0)).toBe('2000');
    expect(o.gfinSubmitPrice.toFixed(0)).toBe('30000');
    expect(o.downAmountActual.toFixed(0)).toBe('0');
    expect(o.monthlyPayment.toFixed(0)).toBe('3401');
  });

  it('เครื่องนอก: OVER ครึ่งเดียว 1,000 → ราคาส่ง 29,000 · ฟรีดาวน์ที่ราคาผ่อน 21,750 · 3,291 × 15', () => {
    const o = calcGfinInstallment({ ...base, installmentPrice: new Decimal('21750'), deviceOrigin: 'IMPORTED' });
    expect(o.allowanceFactor.toString()).toBe('0.5');
    expect(o.allowanceApplied.toFixed(0)).toBe('1000');
    expect(o.gfinSubmitPrice.toFixed(0)).toBe('29000');
    expect(o.downAmountActual.toFixed(0)).toBe('0');
    expect(o.monthlyPayment.toFixed(0)).toBe('3291');
  });

  it('ยังไม่ระบุไทย/นอก (null) คิดแบบเครื่องนอก · ไม่ส่งมาเลยคงพฤติกรรมเดิม (OVER เต็ม)', () => {
    const unknown = calcGfinInstallment({ ...base, installmentPrice: new Decimal('21750'), deviceOrigin: null });
    expect(unknown.gfinSubmitPrice.toFixed(0)).toBe('29000');
    const legacy = calcGfinInstallment({ ...base, installmentPrice: new Decimal('22500') });
    expect(legacy.gfinSubmitPrice.toFixed(0)).toBe('30000');
    expect(legacy.allowanceFactor.toString()).toBe('1');
  });

  it('ไม่มีกฎ OVER: ที่มาเครื่องไม่เปลี่ยนราคาส่ง', () => {
    const o = calcGfinInstallment({ ...base, overpriceRule: null, installmentPrice: new Decimal('21000'), deviceOrigin: 'IMPORTED' });
    expect(o.allowanceApplied.toFixed(0)).toBe('0');
    expect(o.gfinSubmitPrice.toFixed(0)).toBe('28000');
  });
});

describe('findGfinOverpriceRule — กฎที่เจาะจงกว่าชนะ ไม่ขึ้นกับลำดับแถว', () => {
  const mapping15PM: GfinModelMappingRow = {
    id: 'm15pm',
    gfinSeries: 'iPhone 15 Pro Max',
    gfinVariant: null,
    storage: '256GB',
    condition: 'HAND_2',
    maxPrice: new Decimal('29000'),
    modelMatchPattern: 'iPhone 15 Pro Max',
    isActive: true,
  };
  const broad: GfinOverpriceRuleRow = {
    id: 'broad',
    label: 'iPhone 14, 15 มือ 2',
    seriesPattern: 'iPhone 14|iPhone 15|iPhone 15 Pro|iPhone 15 Pro Max',
    condition: 'HAND_2',
    allowance: new Decimal('2000'),
    maxMonths: 12,
    isActive: true,
  };
  const specific: GfinOverpriceRuleRow = {
    ...broad,
    id: 'specific',
    label: 'iPhone 15 Pro Max มือ 2',
    seriesPattern: 'iPhone 15 Pro Max',
    maxMonths: 15,
  };

  it('เลือกกฎ 15 Pro Max ของตัวเองทั้งสองลำดับ', () => {
    expect(findGfinOverpriceRule(mapping15PM, [broad, specific])?.id).toBe('specific');
    expect(findGfinOverpriceRule(mapping15PM, [specific, broad])?.id).toBe('specific');
  });

  it('รุ่นอื่นในกฎรวมยังได้กฎรวม', () => {
    expect(findGfinOverpriceRule({ ...mapping15PM, gfinSeries: 'iPhone 15 Pro' }, [specific, broad])?.id).toBe('broad');
  });
});
