/**
 * นโยบาย "ประกันร้าน" — แหล่งเดียวของสูตร ใช้ร่วมกันทั้งขาสัญญาผ่อนและขาใบขาย
 *
 * เดิมสูตรนี้ฝังอยู่ใน `WarrantyService.setShopWarranty` ที่รับ `contractId` อย่างเดียว
 * (`warranty.service.ts`) ⇒ ขายสด/ไฟแนนซ์นอกซึ่งไม่มีสัญญา จึงไม่เคยมีวันประกันเลย
 * ตอนนี้ใบขายมีคอลัมน์ของตัวเองแล้ว ทั้งสองขาต้องคิดวันด้วยสูตรเดียวกัน — ถ้าแยกกันคำนวณ
 * ลูกค้าคนเดียวกันจะได้คำตอบต่างกันแล้วแต่ว่าซื้อแบบผ่อนหรือสด
 *
 * **คำตัดสินเจ้าของ 2026-08-27:** เครื่องใหม่ที่ขายสด/ไฟแนนซ์นอก **ไม่ให้ประกันร้าน**
 * ใช้ประกันศูนย์ (`Product.warrantyExpireDate`) อย่างเดียว — ตรงกับพฤติกรรมเดิมของ
 * `setShopWarranty` พอดี จึงไม่ต้องแยกสูตรตามชนิดการขาย
 */

export const DEFAULT_SHOP_WARRANTY_DAYS = 60;

/** SystemConfig key ที่ override จำนวนวันประกันร้านทั้งระบบ */
export const SHOP_WARRANTY_DAYS_CONFIG_KEY = 'warranty.shopWarrantyDays';

export interface ShopWarrantyProductInput {
  /** ProductCategory — 'PHONE_USED' คือมือสอง */
  category: string;
  shopWarrantyDays: number | null;
}

/**
 * คืนจำนวนวันประกันร้าน หรือ `null` ถ้าสินค้าชิ้นนี้ไม่ได้ประกันร้าน
 *
 * ลำดับ (คงพฤติกรรมเดิมของ setShopWarranty ทุกประการ):
 *   1. ไม่ใช่มือสอง **และ** ไม่ได้ตั้ง `shopWarrantyDays` ไว้ → ไม่มีประกันร้าน (คืน null)
 *   2. ตั้งต้นที่ `product.shopWarrantyDays ?? 60`
 *   3. ถ้ามีค่าใน SystemConfig `warranty.shopWarrantyDays` → **ทับทุกกรณี**
 *      (รวมสินค้าที่ตั้ง shopWarrantyDays มาเองด้วย — พฤติกรรมเดิม ไม่ใช่บั๊กที่เพิ่งใส่)
 *      ค่าที่ parse ไม่ได้ / เป็น 0 → ตกกลับไปที่ 60 ตามของเดิม (`parseInt(...) || 60`)
 */
export function resolveShopWarrantyDays(
  product: ShopWarrantyProductInput,
  configValue?: string | null,
): number | null {
  const isUsed = product.category === 'PHONE_USED';
  if (!isUsed && !product.shopWarrantyDays) return null;

  let days = product.shopWarrantyDays ?? DEFAULT_SHOP_WARRANTY_DAYS;
  if (configValue) {
    days = parseInt(configValue, 10) || DEFAULT_SHOP_WARRANTY_DAYS;
  }
  return days;
}
