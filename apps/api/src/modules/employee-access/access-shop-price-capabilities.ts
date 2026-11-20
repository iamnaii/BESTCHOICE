import type { PermissionKey } from '@installment/shared';

/**
 * ช่องราคาขายใน body ของ POST/PATCH /products — ส่งช่องใดช่องหนึ่ง (รวม null = ล้าง) ต้องมี `pricing.update`
 * `financePrice` (ราคาขาย GFIN) คุมดาวน์/ค่างวดเรท 2 บนสติกเกอร์ การ์ดสินค้า เว็บร้าน และบอท ⇒ ด่านเดียวกับราคาอื่น
 */
const PRICE_BODY_KEYS = ['cashPrice', 'installmentPrice', 'financePrice', 'prices'] as const;

const PRICE_ROW_METHODS = ['addPrice', 'updatePrice', 'removePrice'];

/**
 * สิทธิ์เพิ่มที่การเขียนสินค้าของพนักงานแบบจัดการสิทธิ์ต้องมี (นอกจากสิทธิ์ของ route เอง)
 * ต้นทุน → `products.cost.update` · ราคาขาย/แถวราคา → `pricing.update`
 */
export function productWriteCapabilities(method: string, body: Record<string, unknown> | undefined): PermissionKey[] {
  const extra: PermissionKey[] = [];
  if (['create', 'update'].includes(method) && body?.costPrice !== undefined) extra.push('products.cost.update');
  if (PRICE_ROW_METHODS.includes(method) || PRICE_BODY_KEYS.some((key) => body?.[key] !== undefined)) {
    extra.push('pricing.update');
  }
  return extra;
}
