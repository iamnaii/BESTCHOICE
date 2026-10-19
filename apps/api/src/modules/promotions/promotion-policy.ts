import { BadRequestException } from '@nestjs/common';
import { Prisma, ProductCategory, PromotionType } from '@prisma/client';

export type PromotionDefinition = {
  type: string;
  discountValue?: Prisma.Decimal | number | null;
  specialInterestRate?: Prisma.Decimal | number | null;
  conditions?: unknown;
  startDate: Date;
  endDate: Date;
  maxUsageCount?: number | null;
};
export type PromotionConditions = {
  minPurchase?: number;
  productIds?: string[];
  categories?: string[];
  accessoryProductIds?: string[];
};
const fail = (): never => {
  throw new BadRequestException('เงื่อนไขโปรโมชันไม่รองรับ กรุณาให้เจ้าของแก้ไข');
};
export function validatePromotion(p: PromotionDefinition): PromotionConditions {
  if (!Object.values(PromotionType).includes(p.type as PromotionType)) fail();
  if (
    !Number.isFinite(p.startDate.getTime()) ||
    !Number.isFinite(p.endDate.getTime()) ||
    p.startDate > p.endDate
  )
    fail();
  if (p.maxUsageCount != null && (!Number.isSafeInteger(p.maxUsageCount) || p.maxUsageCount <= 0))
    fail();
  const amount = p.discountValue == null ? null : Number(p.discountValue);
  const rate = p.specialInterestRate == null ? null : Number(p.specialInterestRate);
  if (p.type === 'PERCENTAGE_DISCOUNT' || p.type === 'FIXED_DISCOUNT') {
    if (
      amount === null ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 9999999999.99 ||
      (Math.round(amount * 100) !== amount * 100 &&
        Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) ||
      rate !== null
    )
      fail();
    if (p.type === 'PERCENTAGE_DISCOUNT' && amount! > 100) fail();
  } else if (p.type === 'SPECIAL_RATE') {
    if (
      amount !== null ||
      rate === null ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 9.9999 ||
      !new Prisma.Decimal(rate).eq(new Prisma.Decimal(rate).toDecimalPlaces(4))
    )
      fail();
  } else if (amount !== null || rate !== null) fail();
  const conditions = p.conditions ?? {};
  if (typeof conditions !== 'object' || Array.isArray(conditions)) fail();
  const c = conditions as Record<string, unknown>;
  if (
    Object.keys(c).some(
      (k) => !['minPurchase', 'productIds', 'categories', 'accessoryProductIds'].includes(k),
    )
  )
    fail();
  if (
    c.minPurchase !== undefined &&
    (typeof c.minPurchase !== 'number' ||
      !Number.isFinite(c.minPurchase) ||
      c.minPurchase < 0 ||
      c.minPurchase > 9999999999.99 ||
      Math.abs(c.minPurchase * 100 - Math.round(c.minPurchase * 100)) > 1e-6)
  )
    fail();
  for (const key of ['productIds', 'categories', 'accessoryProductIds']) {
    if (c[key] === undefined) continue;
    const values = c[key];
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > 100 ||
      values.some((v) => typeof v !== 'string' || !v.trim()) ||
      new Set(values).size !== values.length
    )
      fail();
  }
  if (
    c.categories &&
    (c.categories as string[]).some(
      (v) => !Object.values(ProductCategory).includes(v as ProductCategory),
    )
  )
    fail();
  if (p.type === 'FREE_ACCESSORY' ? !c.accessoryProductIds : c.accessoryProductIds !== undefined)
    fail();
  return c as PromotionConditions;
}
export function promotionSupport(p: PromotionDefinition) {
  try {
    validatePromotion(p);
  } catch {
    return { status: 'UNSUPPORTED_CONDITIONS', reason: 'กรุณาให้เจ้าของแก้ไขเงื่อนไขโปรโมชัน' };
  }
  return p.type === 'SPECIAL_RATE'
    ? { status: 'CONTRACT_FLOW_REQUIRED', reason: 'โปรอัตราดอกเบี้ยต้องใช้ผ่านขั้นตอนสัญญา' }
    : { status: 'SUPPORTED', reason: null };
}
export function promotionProjection(
  p: PromotionDefinition & {
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
  },
) {
  // Conditions contain global product keys, not linked Product/customer expansions.
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    type: p.type,
    discountValue: p.discountValue,
    specialInterestRate: p.specialInterestRate,
    conditions: p.conditions,
    startDate: p.startDate,
    endDate: p.endDate,
    isActive: p.isActive,
    maxUsageCount: p.maxUsageCount,
    ...promotionSupport(p),
  };
}

type Price = { id: string; label: string; amount: Prisma.Decimal };
export function promotionBaseline(
  product: {
    cashPrice: Prisma.Decimal | null;
    installmentPrice: Prisma.Decimal | null;
    prices: Price[];
  },
  saleType: string,
  priceId?: string,
) {
  if (priceId) {
    const row = product.prices.find((p) => p.id === priceId);
    if (!row || !row.amount.isPositive()) throw new BadRequestException('ไม่พบราคาสินค้าที่เลือก');
    return { source: `price:${row.id}`, amount: row.amount };
  }
  const pick = (column: 'cashPrice' | 'installmentPrice', exact: string, prefix: string) => {
    if (product[column]?.isPositive())
      return { source: `column:${column}`, amount: product[column]! };
    const exactRows = product.prices.filter((p) => p.label === exact);
    const rows = exactRows.length
      ? exactRows
      : product.prices.filter((p) => p.label.startsWith(prefix));
    if (rows.length > 1) throw new BadRequestException('ราคาสินค้าไม่ชัดเจน กรุณาเลือก priceId');
    return rows[0]?.amount.isPositive()
      ? { source: `price:${rows[0].id}`, amount: rows[0].amount }
      : null;
  };
  const baseline =
    (saleType === 'EXTERNAL_FINANCE'
      ? pick('installmentPrice', 'ราคาผ่อน BESTCHOICE', 'ราคาผ่อน')
      : null) ?? pick('cashPrice', 'ราคาเงินสด', 'ราคาเงินสด');
  if (!baseline) throw new BadRequestException('ยังไม่ได้ตั้งราคาสินค้าที่ใช้ได้');
  return baseline;
}
