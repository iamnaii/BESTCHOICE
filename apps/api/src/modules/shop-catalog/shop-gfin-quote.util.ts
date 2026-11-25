import Decimal from 'decimal.js';
import {
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  resolveGfinDownPct,
} from '../../utils/installment-calc.util';
import type {
  GfinCondition,
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  GfinRateFactorRow,
  ProductCategoryForGfin,
} from '../../utils/installment-calc.types';
import {
  commissionPctForCategory,
  loadGfinSettings,
  type GfinSettings,
} from '../gfin-config/gfin-settings.util';
import type { SystemConfigReader } from '../../utils/config.util';

/**
 * สูตร "เรท 2" ของหน้าร้าน (เว็บ shop) — ที่เดียวของทั้งหน้ารายละเอียดเครื่อง (`InstallmentPreviewService`)
 * และการ์ดหน้ารวม (`ShopCatalogService`) · สเปค 2026-11-25 หัวข้อ 8
 * ฟังก์ชันในไฟล์นี้ไม่อ่านฐานข้อมูล ยกเว้น `loadShopGfinContext`
 */

type Numeric = { toString(): string };

/** ข้อมูลเครื่องเท่าที่สูตรเรท 2 ใช้ */
export interface ShopGfinProduct {
  brand: string | null;
  model: string;
  storage: string | null;
  category: string;
  deviceOrigin: 'THAI' | 'IMPORTED' | null;
}

export function shopGfinCategory(category: string): ProductCategoryForGfin {
  return category === 'TABLET' ? 'TABLET' : category === 'PHONE_NEW' ? 'PHONE_NEW' : 'PHONE_USED';
}

export function toGfinMappingRows(
  rows: Array<{
    id: string;
    gfinSeries: string;
    gfinVariant: string | null;
    storage: string;
    condition: string;
    maxPrice: Numeric;
    modelMatchPattern: string;
    isActive: boolean;
  }>,
): GfinModelMappingRow[] {
  return rows.map((m) => ({
    id: m.id,
    gfinSeries: m.gfinSeries,
    gfinVariant: m.gfinVariant,
    storage: m.storage,
    condition: m.condition as GfinCondition,
    maxPrice: new Decimal(m.maxPrice.toString()),
    modelMatchPattern: m.modelMatchPattern,
    isActive: m.isActive,
  }));
}

export function toGfinRuleRows(
  rows: Array<{
    id: string;
    label: string;
    seriesPattern: string;
    condition: string;
    allowance: Numeric;
    maxMonths?: number | null;
    minDownPct?: number | null;
    isActive: boolean;
  }>,
): GfinOverpriceRuleRow[] {
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    seriesPattern: r.seriesPattern,
    condition: r.condition as GfinCondition,
    allowance: new Decimal(r.allowance.toString()),
    maxMonths: r.maxMonths ?? null,
    minDownPct: r.minDownPct ?? null,
    isActive: r.isActive,
  }));
}

export function toGfinFactorRow(row: {
  months: number;
  shopCommissionPct: number;
  factor: Numeric;
  feePerInstallment: Numeric;
  isActive: boolean;
}): GfinRateFactorRow {
  return {
    months: row.months,
    shopCommissionPct: Number(row.shopCommissionPct),
    factor: new Decimal(row.factor.toString()),
    feePerInstallment: new Decimal(row.feePerInstallment.toString()),
    isActive: row.isActive,
  };
}

/** งวดตั้งต้นที่ใช้ได้จริง: ตรงในรายการ → ใช้เลย · ไม่ตรง → งวดมากสุดที่ไม่เกิน · ไม่มีเลย → งวดแรก */
export function pickDefaultMonths(wanted: number, allowed: number[]): number {
  if (allowed.length === 0 || allowed.includes(wanted)) return wanted;
  const below = allowed.filter((m) => m <= wanted);
  return below.length > 0 ? below[below.length - 1] : allowed[0];
}

export interface ShopGfinPlan {
  ok: true;
  mapping: GfinModelMappingRow;
  rule: GfinOverpriceRuleRow;
  commissionPct: number;
  /** งวดที่จะคิด (ที่ขอมา หรืองวดตั้งต้น) */
  months: number;
  allowedMonths: number[];
  defaultMonths: number;
  /** ดาวน์ขั้นต่ำของเรท 2 เป็นสัดส่วน (0.30) */
  minDownPct: Decimal;
}

export interface ShopGfinPlanFailure {
  ok: false;
  reason: 'no_gfin_mapping' | 'no_gfin_rule' | 'months_over_max';
  allowedMonths?: number[];
  defaultMonths?: number;
}

/**
 * ขั้นที่ 1 — หาราคากลาง/เงื่อนไขของรุ่น แล้วตัดสินงวดกับดาวน์ขั้นต่ำ
 * `templateMonths` = งวดเรท 2 ของราคากลาง (null = ไม่มี → ใช้เพดานงวดของรุ่น ไม่มีอีก = 12)
 */
export function resolveShopGfinPlan(input: {
  product: ShopGfinProduct;
  settings: GfinSettings;
  mappings: GfinModelMappingRow[];
  rules: GfinOverpriceRuleRow[];
  /** งวดที่มีเรทของ % คอมหมวดนี้ */
  factorMonths: number[];
  templateMonths: number | null;
  /** ไม่ส่ง = งวดตั้งต้น */
  requestedMonths?: number;
}): ShopGfinPlan | ShopGfinPlanFailure {
  const { product, settings } = input;
  const mapping = findGfinMapping(
    {
      brand: product.brand ?? '',
      model: product.model,
      storage: product.storage ?? '',
      category: shopGfinCategory(product.category),
    },
    input.mappings,
  );
  if (!mapping) return { ok: false, reason: 'no_gfin_mapping' };

  const rule = findGfinOverpriceRule(mapping, input.rules);
  // สเปก 2026-11-20 §4: มีราคาแต่ไม่มีเงื่อนไขของรุ่น = ยังคิดไม่ได้
  if (!rule) return { ok: false, reason: 'no_gfin_rule' };

  const allowedMonths = [...new Set(input.factorMonths)]
    .filter((m) => rule.maxMonths == null || m <= rule.maxMonths)
    .sort((a, b) => a - b);
  const defaultMonths = pickDefaultMonths(input.templateMonths ?? rule.maxMonths ?? 12, allowedMonths);
  const months = input.requestedMonths ?? defaultMonths;
  if (rule.maxMonths != null && months > rule.maxMonths) {
    return { ok: false, reason: 'months_over_max', allowedMonths, defaultMonths };
  }

  return {
    ok: true,
    mapping,
    rule,
    commissionPct: commissionPctForCategory(settings, product.category),
    months,
    allowedMonths,
    defaultMonths,
    minDownPct: resolveGfinDownPct(rule, new Decimal(settings.minDownPct).div(100)),
  };
}

export type ShopGfinQuoteResult =
  | { ok: true; monthlyPayment: number; downAmount: number; financedAmount: number; months: number }
  | { ok: false; reason: 'no_rate_factor' | 'invalid'; errors?: string[] };

/**
 * ขั้นที่ 2 — คิดดาวน์/ค่างวดของแผน · `factor` = เรทของ (งวดของแผน, % คอมของแผน) ผู้เรียกหามาให้
 * `downPct` เป็นสัดส่วน (0.30) — ไม่ส่ง = ดาวน์ขั้นต่ำของเรท 2 · ต่ำกว่าขั้นต่ำถูกยกขึ้น
 * ผลลัพธ์ไม่มีราคาส่ง/ส่วนลดดาวน์ (ห้ามออกหน้าร้าน)
 */
export function computeShopGfinQuote(
  plan: ShopGfinPlan,
  input: {
    product: ShopGfinProduct;
    salePrice: Decimal;
    settings: GfinSettings;
    factor: GfinRateFactorRow | null;
    downPct?: Decimal;
  },
): ShopGfinQuoteResult {
  if (!input.factor) return { ok: false, reason: 'no_rate_factor' };
  const downPct =
    input.downPct !== undefined ? Decimal.max(input.downPct, plan.minDownPct) : plan.minDownPct;

  const result = calcGfinInstallment({
    installmentPrice: input.salePrice,
    product: {
      brand: input.product.brand ?? '',
      model: input.product.model,
      storage: input.product.storage ?? '',
      category: shopGfinCategory(input.product.category),
    },
    months: plan.months,
    downPct,
    shopCommissionPct: new Decimal(plan.commissionPct),
    contractFee: new Decimal(input.settings.contractFee),
    mapping: plan.mapping,
    overpriceRule: plan.rule,
    // เรท 2 ให้ส่วนเกินราคาเต็มเฉพาะเครื่องไทย — เครื่องนอก/ยังไม่ระบุได้ครึ่งเดียว
    deviceOrigin: input.product.deviceOrigin,
    rateFactor: input.factor,
  });
  if (!result.isValid) return { ok: false, reason: 'invalid', errors: result.errors };

  return {
    ok: true,
    monthlyPayment: result.monthlyPayment.toNumber(),
    downAmount: result.downAmountActual.toNumber(),
    financedAmount: result.financedAmount.toNumber(),
    months: plan.months,
  };
}

// ── หน้ารวมสินค้า: อ่านตั้งค่าครั้งเดียวต่อคำขอ แล้วคิดทุกการ์ดในหน่วยความจำ ──

export interface ShopGfinContext {
  settings: GfinSettings;
  mappings: GfinModelMappingRow[];
  rules: GfinOverpriceRuleRow[];
  /** เรทที่เปิดใช้ทุก (งวด, % คอม) */
  factors: GfinRateFactorRow[];
}

type FindMany<T> = { findMany(args: { where: { deletedAt: null; isActive: true } }): Promise<T[]> };

export type ShopGfinReader = SystemConfigReader & {
  gfinModelMapping: FindMany<Parameters<typeof toGfinMappingRows>[0][number]>;
  gfinOverpriceRule: FindMany<Parameters<typeof toGfinRuleRows>[0][number]>;
  gfinRateFactor: FindMany<Parameters<typeof toGfinFactorRow>[0]>;
};

export async function loadShopGfinContext(prisma: ShopGfinReader): Promise<ShopGfinContext> {
  const where = { deletedAt: null, isActive: true } as const;
  const [settings, mappings, rules, factors] = await Promise.all([
    loadGfinSettings(prisma),
    prisma.gfinModelMapping.findMany({ where }),
    prisma.gfinOverpriceRule.findMany({ where }),
    prisma.gfinRateFactor.findMany({ where }),
  ]);
  return {
    settings,
    mappings: toGfinMappingRows(mappings),
    rules: toGfinRuleRows(rules),
    factors: factors.map(toGfinFactorRow),
  };
}

/** ราคาที่ใช้คิดเรท 2: ราคาขายเรท 2 ของเครื่องถ้ามี ไม่งั้นราคาผ่อน (กติกาเดียวกับหน้ารายละเอียด) */
export function shopGfinSalePrice(p: {
  financePrice?: Numeric | null;
  installmentPrice?: Numeric | null;
}): Decimal | null {
  const finance = p.financePrice != null ? new Decimal(p.financePrice.toString()) : null;
  if (finance && finance.gt(0)) return finance;
  const installment = p.installmentPrice != null ? new Decimal(p.installmentPrice.toString()) : null;
  return installment && installment.gt(0) ? installment : null;
}

/** แผนเรท 2 ที่การ์ดหน้ารวมแสดง — ดาวน์/ค่างวดปัดขึ้นเป็นบาทเต็ม (แบบเดียวกับเรท 1 บนการ์ด) */
export interface CardRate2 {
  down: number;
  monthly: number;
  months: number;
}

/**
 * แผนเรท 2 ของการ์ด = เรท 2 ที่ค่าตั้งต้น (งวดตั้งต้นของเครื่อง + ดาวน์ขั้นต่ำของเรท 2)
 * คือผลเดียวกับ `/shop/installment-preview?provider=GFIN` ที่ไม่ส่ง months / downPct
 */
export function quoteCardRate2(
  ctx: ShopGfinContext,
  product: ShopGfinProduct,
  salePrice: Decimal | null,
  templateMonths: number | null,
): CardRate2 | null {
  if (!salePrice) return null;
  const commissionPct = commissionPctForCategory(ctx.settings, product.category);
  const factors = ctx.factors.filter((f) => f.isActive && f.shopCommissionPct === commissionPct);
  const plan = resolveShopGfinPlan({
    product,
    settings: ctx.settings,
    mappings: ctx.mappings,
    rules: ctx.rules,
    factorMonths: factors.map((f) => f.months),
    templateMonths,
  });
  if (!plan.ok) return null;
  const quote = computeShopGfinQuote(plan, {
    product,
    salePrice,
    settings: ctx.settings,
    factor: factors.find((f) => f.months === plan.months) ?? null,
  });
  if (!quote.ok) return null;
  return {
    down: Math.ceil(quote.downAmount),
    monthly: Math.ceil(quote.monthlyPayment),
    months: quote.months,
  };
}
