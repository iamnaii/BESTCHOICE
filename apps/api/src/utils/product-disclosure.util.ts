import { DeviceOrigin, PartsHistory, Prisma } from '@prisma/client';
import {
  isPartsHistoryValue,
  PARTS_HISTORY_LABEL,
  partsHistoryLabel,
  partsHistoryText,
} from '@installment/shared';
import { resolveShopWarrantyDays } from '../modules/warranty/shop-warranty-policy';

export interface ProductDisclosure {
  version: 1;
  deviceOrigin: DeviceOrigin | null;
  shopWarrantyDays: number;
  warrantyTerms: string | null;
  /**
   * ประวัติอะไหล่ ณ วันขาย (เพิ่ม 2026-09-26) — สำเนาเก่าที่เก็บก่อนหน้านี้ไม่มีคีย์นี้
   * อ่านเป็น null = "ไม่มีข้อมูล ณ วันขาย" ห้ามเดาจากค่าปัจจุบันของสินค้า
   */
  partsHistory?: PartsHistory | null;
  partsHistoryNote?: string | null;
}

// ป้าย/ข้อความประวัติอะไหล่อยู่ที่ packages/shared ชุดเดียว — เอกสาร บอท และหน้าเว็บพูดตรงกัน
export { PARTS_HISTORY_LABEL, partsHistoryLabel, partsHistoryText };

export function captureProductDisclosure(product: {
  category: string; deviceOrigin?: DeviceOrigin | null;
  shopWarrantyDays?: number | null; warrantyTerms?: string | null;
  partsHistory?: PartsHistory | null; partsHistoryNote?: string | null;
}, warrantyDefault?: string | null): ProductDisclosure & Prisma.InputJsonObject {
  return {
    version: 1,
    deviceOrigin: product.deviceOrigin ?? null,
    shopWarrantyDays: resolveShopWarrantyDays(product, warrantyDefault) ?? 0,
    warrantyTerms: product.warrantyTerms?.trim() || null,
    // ใส่คีย์เฉพาะเมื่อระบุแล้ว — เครื่องที่ยังไม่ระบุได้สำเนาหน้าตาเดิมทุกไบต์
    ...(product.partsHistory
      ? { partsHistory: product.partsHistory, partsHistoryNote: product.partsHistoryNote?.trim() || null }
      : {}),
  };
}

/** Do not infer a past agreement from today's editable product fields. */
export function readProductDisclosure(value: unknown): ProductDisclosure | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as ProductDisclosure;
  if (p.version !== 1 || !Number.isInteger(p.shopWarrantyDays) || p.shopWarrantyDays < 0) return null;
  if (p.deviceOrigin !== null && p.deviceOrigin !== 'THAI' && p.deviceOrigin !== 'IMPORTED') return null;
  if (p.warrantyTerms !== null && typeof p.warrantyTerms !== 'string') return null;
  // คีย์ใหม่ไม่บังคับ (สำเนาเก่าไม่มี) แต่ถ้ามีต้องถูกชนิด — ค่าแปลกปลอมทิ้งเฉพาะคีย์นั้น ไม่ทิ้งทั้งสำเนา
  const { partsHistory: rawHistory, partsHistoryNote: rawNote, ...base } = p;
  if (!isPartsHistoryValue(rawHistory)) return base;
  return {
    ...base,
    partsHistory: rawHistory,
    partsHistoryNote: typeof rawNote === 'string' && rawNote.trim() ? rawNote : null,
  };
}

export function disclosureText(value: unknown): string {
  const p = readProductDisclosure(value);
  if (!p) return '';
  return [p.deviceOrigin === 'THAI' ? 'เครื่องไทย' : p.deviceOrigin === 'IMPORTED' ? 'เครื่องนอก' : 'ยังไม่ระบุไทย/นอก',
    p.shopWarrantyDays > 0 ? `ประกันร้าน ${p.shopWarrantyDays} วัน` : 'ไม่มีประกันร้าน',
    partsHistoryText(p.partsHistory, p.partsHistoryNote), p.warrantyTerms].filter(Boolean).join(' · ');
}
