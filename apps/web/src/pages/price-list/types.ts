import type { GfinDeviceOrigin } from '@installment/shared';

/**
 * คำตอบของ `GET /pricing-templates/quotes` — ตรงกับสัญญาร่วม Phase 2
 * (`docs/superpowers/plans/2026-11-20-price-master-contracts.md`) · API ไม่ส่งทุน กำไร หรือราคาส่ง GFIN
 */
export type PriceCategory = 'PHONE_NEW' | 'PHONE_USED' | 'TABLET';

/** หมวดที่หน้า "ราคาและเรทผ่อน" สลับได้ (สเปคข้อ 6: มือ 1 / มือ 2) */
export type PriceListCategory = Extract<PriceCategory, 'PHONE_NEW' | 'PHONE_USED'>;

export type PriceOrigin = GfinDeviceOrigin;

/** ดาวน์ · ค่างวดที่แสดง (ปัดขึ้นบาทเต็มโดย API) · จำนวนงวด */
export interface RateTerms {
  downAmount: number;
  monthly: number;
  months: number;
}

export interface PriceQuoteRow {
  /** brand|model|storage|hasWarranty */
  key: string;
  brand: string;
  model: string;
  storage: string;
  category: PriceCategory;
  /** null = มือ 2 ที่ราคามีประกัน / ไม่มีประกันเท่ากัน รวมเป็นแถวเดียว (หรือเครื่องมือ 1) */
  hasWarranty: boolean | null;
  cashPrice: number | null;
  rate1: RateTerms | null;
  rate2: RateTerms | { unavailable: string };
}

export interface PriceQuoteList {
  /** วันที่แก้ราคากลางล่าสุด (ISO) · null = ยังไม่มีราคากลาง */
  updatedAt: string | null;
  rows: PriceQuoteRow[];
}
