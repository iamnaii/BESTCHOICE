import { DeviceOrigin, Prisma } from '@prisma/client';
import { resolveShopWarrantyDays } from '../modules/warranty/shop-warranty-policy';

export interface ProductDisclosure {
  version: 1;
  deviceOrigin: DeviceOrigin | null;
  shopWarrantyDays: number;
  warrantyTerms: string | null;
}

export function captureProductDisclosure(product: {
  category: string; deviceOrigin?: DeviceOrigin | null;
  shopWarrantyDays?: number | null; warrantyTerms?: string | null;
}, warrantyDefault?: string | null): ProductDisclosure & Prisma.InputJsonObject {
  return {
    version: 1,
    deviceOrigin: product.deviceOrigin ?? null,
    shopWarrantyDays: resolveShopWarrantyDays(product, warrantyDefault) ?? 0,
    warrantyTerms: product.warrantyTerms?.trim() || null,
  };
}

/** Do not infer a past agreement from today's editable product fields. */
export function readProductDisclosure(value: unknown): ProductDisclosure | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as ProductDisclosure;
  if (p.version !== 1 || !Number.isInteger(p.shopWarrantyDays) || p.shopWarrantyDays < 0) return null;
  if (p.deviceOrigin !== null && p.deviceOrigin !== 'THAI' && p.deviceOrigin !== 'IMPORTED') return null;
  if (p.warrantyTerms !== null && typeof p.warrantyTerms !== 'string') return null;
  return p;
}

export function disclosureText(value: unknown): string {
  const p = readProductDisclosure(value);
  if (!p) return '';
  return [p.deviceOrigin === 'THAI' ? 'เครื่องไทย' : p.deviceOrigin === 'IMPORTED' ? 'เครื่องนอก' : 'ยังไม่ระบุไทย/นอก',
    p.shopWarrantyDays > 0 ? `ประกันร้าน ${p.shopWarrantyDays} วัน` : 'ไม่มีประกันร้าน', p.warrantyTerms].filter(Boolean).join(' · ');
}
