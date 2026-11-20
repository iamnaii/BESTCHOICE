import {
  resolveGfinQuote,
  type GfinOverrides,
  type GfinQuoteInput,
  type GfinTables,
  type ResolvedGfin,
} from '@/pages/ProductDetailPage/utils/gfinQuote';
import type { Hand } from './terms/modelTerms';

const NO_OVERRIDES: GfinOverrides = { months: null, downPct: null, commissionPct: null, templateMonths: null };

/** เครื่องสมมติจากแถวในใบราคา — มือ 1 = PHONE_NEW · มือ 2 = PHONE_USED (สเปก §6.4) */
export function gfinProductOf(
  series: string,
  storage: string,
  condition: Hand,
  deviceOrigin: 'THAI' | 'IMPORTED',
): GfinQuoteInput['product'] {
  return {
    brand: 'Apple',
    model: series,
    storage,
    category: condition === 'HAND_1' ? 'PHONE_NEW' : 'PHONE_USED',
    deviceOrigin,
  };
}

/**
 * ใบเสนอ GFIN ของหน้าตั้งค่า — ผ่าน resolveGfinQuote ตัวเดียวกับหน้าสินค้า (สเปก §6.4 ห้ามเรียก buildGfinQuote ตรง)
 * salePrice null = ขายเท่าราคาส่ง: รอบแรกหา gfinSubmitPrice (ไม่ขึ้นกับราคาขาย) แล้วคิดใหม่ด้วยราคานั้น
 */
export function gfinQuoteAt(
  tables: GfinTables,
  product: GfinQuoteInput['product'],
  salePrice: number | null,
  overrides: Partial<GfinOverrides> = {},
): ResolvedGfin {
  const o: GfinOverrides = { ...NO_OVERRIDES, ...overrides };
  if (salePrice !== null) return resolveGfinQuote(tables, product, salePrice, o);
  const first = resolveGfinQuote(tables, product, 0, o);
  if (!first.quote.available) return first;
  return resolveGfinQuote(tables, product, first.quote.result.gfinSubmitPrice.toNumber(), o);
}
