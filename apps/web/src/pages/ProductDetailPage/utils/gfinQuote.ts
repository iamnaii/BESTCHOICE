import Decimal from 'decimal.js';
import {
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  findGfinRateFactor,
  type GfinCalcOutput,
  type GfinModelMappingRow,
  type GfinOverpriceRuleRow,
  type GfinRateFactorRow,
  type ProductCategoryForGfin,
} from '@installment/shared';
import type { MonthOption } from './monthsOptions';

// ── shapes ของ API ตั้งค่า GFIN (GET /gfin-config/*) ──────────────────────────────
export interface MaxPriceApi {
  id: string;
  gfinSeries: string;
  gfinVariant: string | null;
  storage: string;
  condition: 'HAND_1' | 'HAND_2';
  maxPrice: string;
  modelMatchPattern: string;
  isActive: boolean;
}
export interface OverpriceApi {
  id: string;
  label: string;
  seriesPattern: string;
  condition: 'HAND_1' | 'HAND_2';
  allowance: string;
  maxMonths?: number | null;
  isActive: boolean;
}
export interface RateFactorApi {
  id: string;
  months: number;
  shopCommissionPct: number;
  factor: string;
  feePerInstallment: string;
  isActive: boolean;
}
export interface GfinSettingsApi {
  minDownPct: number;
  maxDownPct: number;
  downStepPct: number;
  contractFee: number;
  commissionPctByCategory: { PHONE: number; TABLET: number };
}
export interface GfinTables {
  mappings: MaxPriceApi[];
  rules: OverpriceApi[];
  factors: RateFactorApi[];
  settings: GfinSettingsApi;
}

export interface GfinQuoteInput {
  product: { brand: string; model: string; storage: string | null; category: string };
  installmentPrice: number;
  months: number;
  /** % ดาวน์ที่แจ้ง GFIN เช่น 25 */
  downPct: number;
  /** % คอมมิชชั่นที่ร้านเลือก เช่น 15 */
  commissionPct: number;
}

export type GfinQuote =
  | {
      available: false;
      reason: 'unsupported_category' | 'no_mapping' | 'no_factor';
      maxMonths: number | null;
      monthsOptions: MonthOption[];
    }
  | {
      available: true;
      result: GfinCalcOutput;
      mapping: MaxPriceApi;
      rule: OverpriceApi | null;
      /** เรทที่ใช้ (งวด + %คอม ที่เลือก) — โชว์ในรายละเอียดการคำนวณ */
      factor: RateFactorApi;
      maxMonths: number | null;
      monthsOptions: MonthOption[];
    };

/** หมวดสินค้าของเรา → หมวดที่ GFIN รับ (มือถือใหม่/มือสอง/iPad) · อื่น ๆ = ไม่รับ */
export function gfinCategoryOf(category: string): ProductCategoryForGfin | null {
  if (category === 'PHONE_NEW' || category === 'PHONE_USED' || category === 'TABLET') {
    return category;
  }
  return null;
}

/** % คอมมิชชั่นตั้งต้นตามหมวด — iPad ใช้ค่า TABLET, ที่เหลือใช้ค่ามือถือ */
export function defaultCommissionPct(settings: GfinSettingsApi, category: string): number {
  return category === 'TABLET'
    ? settings.commissionPctByCategory.TABLET
    : settings.commissionPctByCategory.PHONE;
}

function toMappingRow(m: MaxPriceApi): GfinModelMappingRow {
  return { ...m, maxPrice: new Decimal(m.maxPrice) };
}
function toRuleRow(r: OverpriceApi): GfinOverpriceRuleRow {
  return { ...r, allowance: new Decimal(r.allowance), maxMonths: r.maxMonths ?? null };
}
function toFactorRow(f: RateFactorApi): GfinRateFactorRow {
  return {
    months: f.months,
    shopCommissionPct: f.shopCommissionPct,
    factor: new Decimal(f.factor),
    feePerInstallment: new Decimal(f.feePerInstallment),
    isActive: f.isActive,
  };
}

/**
 * ค่างวด GFIN ของเครื่องนี้ตามค่าที่เลือก (งวด · % ดาวน์ · % คอม) + ตัวเลือกงวดทั้งหมดพร้อมค่างวด
 * (ใช้ทำ dropdown "N งวด · ผ่อนเดือนละ X" แบบหน้าขอสินเชื่อของ GFIN)
 * งวดที่เกิน "ผ่อนสูงสุด" ของซีรีส์/สภาพ (กฎ OVER) ไม่โผล่ในตัวเลือก
 */
export function buildGfinQuote(tables: GfinTables, input: GfinQuoteInput): GfinQuote {
  const category = gfinCategoryOf(input.product.category);
  if (!category) {
    return { available: false, reason: 'unsupported_category', maxMonths: null, monthsOptions: [] };
  }
  const product = {
    brand: input.product.brand,
    model: input.product.model,
    storage: input.product.storage ?? '',
    category,
  };
  const mappingRows = tables.mappings.map(toMappingRow);
  const mappingRow = findGfinMapping(product, mappingRows);
  if (!mappingRow) {
    return { available: false, reason: 'no_mapping', maxMonths: null, monthsOptions: [] };
  }
  const mapping = tables.mappings.find((m) => m.id === mappingRow.id)!;
  const ruleRow = findGfinOverpriceRule(mappingRow, tables.rules.map(toRuleRow));
  const rule = ruleRow ? (tables.rules.find((r) => r.id === ruleRow.id) ?? null) : null;
  const maxMonths = ruleRow?.maxMonths ?? null;

  const factorRows = tables.factors.map(toFactorRow);
  const installmentPrice = new Decimal(input.installmentPrice);
  const downPct = new Decimal(input.downPct).div(100);
  const shopCommissionPct = new Decimal(input.commissionPct);
  const contractFee = new Decimal(tables.settings.contractFee);

  const quoteFor = (months: number, rateFactor: GfinRateFactorRow) =>
    calcGfinInstallment({
      installmentPrice,
      product,
      months,
      downPct,
      shopCommissionPct,
      contractFee,
      mapping: mappingRow,
      overpriceRule: ruleRow,
      rateFactor,
    });

  const monthsOptions: MonthOption[] = factorRows
    .filter(
      (f) =>
        f.isActive &&
        f.shopCommissionPct === input.commissionPct &&
        (maxMonths == null || f.months <= maxMonths),
    )
    .sort((a, b) => a.months - b.months)
    .map((f) => ({ months: f.months, monthly: quoteFor(f.months, f).monthlyPayment.toNumber() }));

  const selected = findGfinRateFactor(factorRows, input.months, input.commissionPct);
  if (!selected || (maxMonths != null && input.months > maxMonths)) {
    return { available: false, reason: 'no_factor', maxMonths, monthsOptions };
  }

  const factor = tables.factors.find(
    (f) => f.isActive && f.months === input.months && f.shopCommissionPct === input.commissionPct,
  )!;
  return {
    available: true,
    result: quoteFor(input.months, selected),
    mapping,
    rule,
    factor,
    maxMonths,
    monthsOptions,
  };
}
