import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import {
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  findGfinRateFactor,
  resolveGfinDownPct,
} from './installment-calc';
import type {
  GfinCondition,
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  GfinRateFactorRow,
  ProductForGfin,
} from './installment-calc.types';

/**
 * ชุดตรวจเรท 2 จากชีต MASTER (2026-11-19) — แท็บ "ใบราคา G-Finn" + "ข้อมูลหลัก มือ 1/2" · กรณีเครื่องไทย
 * ใบราคาตั้งชื่อแบบนำเข้าใหม่ (สเปค 7.7): gfinSeries = modelMatchPattern = ชื่อรุ่นเต็ม
 * กติกา OVER ตามสเปคข้อ 8 · ดาวน์ขั้นต่ำ 30% เฉพาะกลุ่ม iPhone 17 / 18 / Air มือ 1 (คอลัมน์ AJ ของชีต)
 */
function price(model: string, storage: string, condition: GfinCondition, maxPrice: number): GfinModelMappingRow {
  return {
    id: `${model} ${storage} ${condition}`,
    gfinSeries: model,
    gfinVariant: null,
    storage,
    condition,
    maxPrice: new Decimal(maxPrice),
    modelMatchPattern: model,
    isActive: true,
  };
}

function rule(
  id: string,
  condition: GfinCondition,
  allowance: number,
  maxMonths: number,
  series: string[],
  minDownPct: number | null = null,
): GfinOverpriceRuleRow {
  return {
    id,
    label: id,
    seriesPattern: series.join('|'),
    condition,
    allowance: new Decimal(allowance),
    maxMonths,
    minDownPct,
    isActive: true,
  };
}

const mappings: GfinModelMappingRow[] = [
  price('iPhone 13', '128GB', 'HAND_1', 14900),
  price('iPhone 13', '128GB', 'HAND_2', 12900),
  price('iPhone 13 Pro', '128GB', 'HAND_2', 15900),
  price('iPhone 14 Pro', '128GB', 'HAND_2', 18900),
  price('iPhone 15', '128GB', 'HAND_1', 24900),
  price('iPhone 16', '128GB', 'HAND_1', 26900),
  price('iPhone 16 Plus', '128GB', 'HAND_2', 23900),
  price('iPhone 17', '256GB', 'HAND_1', 29900),
  price('iPhone 17 Pro', '256GB', 'HAND_1', 39900),
];

const rules: GfinOverpriceRuleRow[] = [
  rule('h1-12', 'HAND_1', 1000, 12, ['iPhone 13', 'iPhone 14', 'iPhone 14 Plus', 'iPhone 15', 'iPhone 15 Plus']),
  rule('h1-15', 'HAND_1', 1000, 15, ['iPhone 15 Pro', 'iPhone 15 Pro Max']),
  rule('h1-16', 'HAND_1', 2000, 15, ['iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max']),
  rule(
    'h1-17',
    'HAND_1',
    2000,
    15,
    ['iPhone 17', 'iPhone 17 Pro', 'iPhone 17 Pro Max', 'iPhone Air', 'iPhone 18 Pro', 'iPhone 18 Pro Max'],
    30,
  ),
  rule('h2-13', 'HAND_2', 0, 12, ['iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max']),
  // iPhone 14 Pro 128GB มือ 2 ในชีต = OVER 2,000 (ความจุอื่นยังเป็นคำถามเปิดข้อ 3 ของสเปค)
  rule('h2-14', 'HAND_2', 2000, 12, [
    'iPhone 14',
    'iPhone 14 Plus',
    'iPhone 14 Pro',
    'iPhone 14 Pro Max',
    'iPhone 15',
    'iPhone 15 Plus',
    'iPhone 15 Pro',
  ]),
  rule('h2-15', 'HAND_2', 2000, 15, [
    'iPhone 15 Pro Max',
    'iPhone 16',
    'iPhone 16 Plus',
    'iPhone 16 Pro',
    'iPhone 16 Pro Max',
    'iPhone 17',
    'iPhone 17 Pro',
    'iPhone 17 Pro Max',
    'iPhone Air',
  ]),
];

const factors: GfinRateFactorRow[] = [
  { months: 10, shopCommissionPct: 15, factor: new Decimal('0.201'), feePerInstallment: new Decimal('100'), isActive: true },
  { months: 12, shopCommissionPct: 15, factor: new Decimal('0.17'), feePerInstallment: new Decimal('100'), isActive: true },
  { months: 15, shopCommissionPct: 15, factor: new Decimal('0.1467'), feePerInstallment: new Decimal('100'), isActive: true },
];

/** ทางเดียวกับผู้เรียกจริง: จับใบราคา → กติกา OVER → งวดสูงสุดของกติกา → ดาวน์ขั้นต่ำ (ค่าตั้ง 25%) */
function quote(model: string, storage: string, category: ProductForGfin['category'], salePrice: number) {
  const product: ProductForGfin = { brand: 'Apple', model, storage, category };
  const mapping = findGfinMapping(product, mappings);
  if (!mapping) return null;
  const overpriceRule = findGfinOverpriceRule(mapping, rules);
  const months = overpriceRule?.maxMonths ?? 12;
  const rateFactor = findGfinRateFactor(factors, months, 15);
  if (!rateFactor) throw new Error(`no rate for ${months}`);
  const out = calcGfinInstallment({
    installmentPrice: new Decimal(salePrice),
    product,
    months,
    downPct: resolveGfinDownPct(overpriceRule, new Decimal('0.25')),
    shopCommissionPct: new Decimal(15),
    contractFee: new Decimal(100),
    mapping,
    overpriceRule,
    rateFactor,
    deviceOrigin: 'THAI',
  });
  return { down: out.downAmountActual.toNumber(), monthly: out.monthlyPayment.toNumber(), months };
}

describe('เรท 2 ตรงชีต MASTER ทุกบาท (สเปค 4.5 + 10)', () => {
  it.each([
    ['iPhone 15', '128GB', 'PHONE_NEW', 25900, 6500, 3403, 12],
    ['iPhone 16', '128GB', 'PHONE_NEW', 28900, 7300, 3280, 15],
    ['iPhone 17', '256GB', 'PHONE_NEW', 31900, 9600, 3376, 15],
    ['iPhone 17 Pro', '256GB', 'PHONE_NEW', 39000, 9700, 4403, 15],
    ['iPhone 13', '128GB', 'PHONE_USED', 9600, 0, 1745, 12],
    ['iPhone 13 Pro', '128GB', 'PHONE_USED', 11900, 0, 2128, 12],
    ['iPhone 14 Pro', '128GB', 'PHONE_USED', 15600, 0, 2765, 12],
    ['iPhone 16 Plus', '128GB', 'PHONE_USED', 22300, 2900, 2950, 15],
  ] as const)('%s %s %s ราคาขาย %d → ดาวน์ %d · %d × %d', (model, storage, category, sale, down, monthly, months) => {
    expect(quote(model, storage, category, sale)).toEqual({ down, monthly, months });
  });

  it('iPhone 12 64GB มือ 2 = GFIN ไม่รับ (ไม่มีในใบราคา)', () => {
    expect(quote('iPhone 12', '64GB', 'PHONE_USED', 6700)).toBeNull();
  });

  it('iPhone 13 Pro 128GB มือ 1 = GFIN ไม่รับ ทั้งที่มี iPhone 13 128GB มือ 1', () => {
    expect(quote('iPhone 13 Pro', '128GB', 'PHONE_NEW', 14900)).toBeNull();
  });
});
