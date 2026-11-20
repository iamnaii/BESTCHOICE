import { Prisma, PricingDeviceOrigin, ProductCategory } from '@prisma/client';
import { normalizeStorage } from './device-query-normalize.util';

/** ข้อมูลเครื่องที่ใช้เลือกแถวราคากลาง */
export interface TemplateMatchKey {
  brand: string;
  model: string;
  storage: string | null;
  category: ProductCategory;
  /** null = ไม่รู้สถานะประกัน (เครื่องเทิร์น/รับซื้อ) */
  hasWarranty: boolean | null;
  /** ที่มาเครื่อง · null / ไม่ส่ง = ยังไม่ระบุ */
  deviceOrigin?: 'THAI' | 'IMPORTED' | null;
}

/** ช่องที่ตัวเลือกใช้ — แถวต้องเรียงตาม `TEMPLATE_ORDER` มาแล้ว (ตัวเลือกไม่เรียงเอง) */
export interface TemplateMatchRow {
  brand: string;
  model: string;
  storage: string;
  category: ProductCategory;
  hasWarranty: boolean;
  deviceOrigin: PricingDeviceOrigin;
}

/** deterministic: แถว "ไม่มีประกัน" ก่อน แล้วแถวที่สร้างก่อน */
export const TEMPLATE_ORDER: Prisma.PricingTemplateOrderByWithRelationInput[] = [
  { hasWarranty: 'asc' },
  { createdAt: 'asc' },
];

/** ราคาบวกเท่านั้น — 0 / ติดลบ / ว่าง = null (กติกาเดียวกับ `syncPriceRowsFromColumns`) */
export function positiveDecimal(
  value: Prisma.Decimal | string | number | null | undefined,
): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = new Prisma.Decimal(value.toString());
  return amount.isFinite() && amount.gt(0) ? amount : null;
}

function selectWithin<T extends TemplateMatchRow>(rows: T[], key: TemplateMatchKey): T | null {
  const wanted = normalizeStorage(key.storage);
  let candidates = rows.filter((r) => normalizeStorage(r.storage) === wanted);
  if (candidates.length === 0) candidates = rows.filter((r) => normalizeStorage(r.storage) === '');
  if (key.category === 'PHONE_USED' && key.hasWarranty !== null) {
    candidates = candidates.filter((r) => r.hasWarranty === key.hasWarranty);
  } else {
    // ไม่ใช่มือ 2 หรือไม่รู้ประกัน → แถว "ไม่มีประกัน" (ราคาต่ำกว่า — ไม่ตั้งราคาสูงเกินจริง) ถ้ามี
    const noWarranty = candidates.filter((r) => !r.hasWarranty);
    if (noWarranty.length > 0) candidates = noWarranty;
  }
  return candidates[0] ?? null;
}

/**
 * เลือกแถวราคากลางของเครื่อง — ตัวเดียวที่ใช้ทั้งตัวเติมราคาเงินสด/ผ่อน (`autofillProductPriceFromTemplate`)
 * และราคาขาย GFIN (`product-finance-price.util.ts`) ⇒ ทุกทางเข้าได้แถวเดียวกัน
 * ความจุตรงก่อน แล้วค่อยแถวความจุว่าง · ประกันแบบ deterministic ·
 * เครื่องไทย/นอกไม่พบแถวของตัวเอง → ถอยไปแถว "ไม่ระบุ" (สเปค 2026-11-19 ข้อ 7.1)
 */
export function pickPricingTemplate<T extends TemplateMatchRow>(rows: T[], key: TemplateMatchKey): T | null {
  const brand = key.brand.trim().toLowerCase();
  const model = key.model.trim().toLowerCase();
  const sameModel = rows.filter(
    (r) =>
      r.category === key.category &&
      r.brand.trim().toLowerCase() === brand &&
      r.model.trim().toLowerCase() === model,
  );
  const origin: PricingDeviceOrigin = key.deviceOrigin ?? 'UNSPECIFIED';
  const own = selectWithin(sameModel.filter((r) => r.deviceOrigin === origin), key);
  if (own || origin === 'UNSPECIFIED') return own;
  return selectWithin(sameModel.filter((r) => r.deviceOrigin === 'UNSPECIFIED'), key);
}

/** อ่านแถวที่เกี่ยวข้องจากฐานข้อมูลแล้วเลือกด้วย `pickPricingTemplate` · ไม่มียี่ห้อ/รุ่น = null */
export async function findPricingTemplate(tx: Prisma.TransactionClient, key: TemplateMatchKey) {
  if (!key.brand || !key.model) return null;
  const origin: PricingDeviceOrigin = key.deviceOrigin ?? 'UNSPECIFIED';
  const rows = await tx.pricingTemplate.findMany({
    where: {
      deviceOrigin: { in: origin === 'UNSPECIFIED' ? ['UNSPECIFIED'] : [origin, 'UNSPECIFIED'] },
      isActive: true,
      deletedAt: null,
      category: key.category,
      brand: { equals: key.brand, mode: 'insensitive' },
      model: { equals: key.model, mode: 'insensitive' },
    },
    orderBy: TEMPLATE_ORDER,
  });
  return pickPricingTemplate(rows, key);
}
