/**
 * JSON-LD ของหน้าสินค้า (`/products/:id`) — โครงเดียวกับหน้าการ์ดแชร์ที่ API เสิร์ฟ
 * (apps/api/src/modules/shop-catalog/share-page.util.ts) ซึ่งเด้งออกทันทีและ canonical
 * ชี้มาหน้านี้ ⇒ ข้อมูลสินค้าที่ crawler ใช้ต้องอยู่บนหน้านี้เอง
 *
 * เป้าหมายคือ product snippet (ชื่อ ราคา สถานะ) — ร้านขายผ่านแชท/หน้าร้าน ไม่มีปุ่มซื้อบนหน้า
 * จึงไม่ใช่ merchant listing. ค่าทุกตัวต้องตรงกับที่ลูกค้าเห็นบนหน้า: หน้าไม่แสดงราคา = ไม่มี offers
 */
import type { Crumb } from '@/components/catalog/Breadcrumb';
import { CANONICAL_ORIGIN } from './canonical-host';

/** URL เต็มของหน้าสินค้า — ตัวเดียวกับ canonical ที่ usePageMeta ตั้ง */
export function productPageUrl(productId: string): string {
  return `${CANONICAL_ORIGIN}/products/${encodeURIComponent(productId)}`;
}

export interface ProductJsonLdInput {
  name: string;
  description?: string;
  brand: string;
  condition: 'NEW' | 'USED';
  images: string[];
  /** URL เต็มของหน้าสินค้า (canonical) */
  url: string;
  price: number | null;
  inStock: boolean;
}

function absoluteUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${CANONICAL_ORIGIN}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function buildProductJsonLd(input: ProductJsonLdInput): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
  };
  if (input.description) jsonLd.description = input.description;
  jsonLd.brand = { '@type': 'Brand', name: input.brand };
  jsonLd.itemCondition =
    input.condition === 'NEW'
      ? 'https://schema.org/NewCondition'
      : 'https://schema.org/UsedCondition';
  if (input.images.length > 0) jsonLd.image = input.images.map(absoluteUrl);
  if (input.price != null && input.price > 0) {
    jsonLd.offers = {
      '@type': 'Offer',
      url: input.url,
      priceCurrency: 'THB',
      price: String(input.price),
      availability: input.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    };
  }
  return jsonLd;
}

/** สร้างจากรายการเดียวกับแถบเส้นทางที่มองเห็น — รายการสุดท้าย (ไม่มีลิงก์) คือหน้าปัจจุบัน */
export function buildBreadcrumbJsonLd(items: Crumb[], currentUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      item: c.to ? absoluteUrl(c.to) : currentUrl,
    })),
  };
}

/**
 * JSON ที่ฝังใน <script> — escape `<` กัน `</script>` breakout
 * (ชื่อ/รายละเอียดสินค้าเป็นข้อความที่แอดมินพิมพ์เอง) แบบเดียวกับ escapeJsonForScript ฝั่ง API
 */
export function jsonLdForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
