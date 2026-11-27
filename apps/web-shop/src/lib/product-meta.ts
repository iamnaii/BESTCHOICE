/**
 * title + description ของหน้าสินค้า (`/products/:id`)
 *
 * รูปแบบเดียวกับการ์ดแชร์ LINE/Facebook (`buildShareDescription` ใน
 * apps/api/src/modules/shop-catalog/share-page.util.ts) — ถ้อยคำเจ้าของอนุมัติ 27 พ.ย. 2569
 * ต่างจากการ์ดแชร์สองข้อ (ตั้งใจ):
 * - ไม่ใส่เกรด — หน้าเว็บไม่มีข้อมูลเกรดที่เชื่อถือได้
 * - ประกันร้านแสดงเฉพาะเมื่อมากกว่า 0 วัน (การ์ดแชร์พิมพ์ "0 วัน")
 *
 * สภาพ + แบตอยู่ใน title ด้วย เพื่อแยกหน้าของเครื่องรุ่นเดียวกันที่สีและความจุตรงกัน
 */
type Condition = 'NEW' | 'USED';

export interface ProductMetaInput {
  /** ยี่ห้อ รุ่น ความจุ สี ต่อกันด้วยช่องว่าง */
  name: string;
  condition: Condition;
  batteryHealth?: number | null;
  shopWarrantyDays?: number | null;
  price?: number | null;
}

const DESCRIPTION_SUFFIX = 'ผ่อนได้บัตรประชาชนใบเดียว ร้าน BESTCHOICE ลพบุรี';

function hasBattery(
  input: ProductMetaInput,
): input is ProductMetaInput & { batteryHealth: number } {
  return input.condition === 'USED' && input.batteryHealth != null;
}

export function buildProductMetaTitle(input: ProductMetaInput): string {
  if (input.condition === 'NEW') return `${input.name} มือ 1`;
  return hasBattery(input)
    ? `${input.name} มือสอง แบต ${input.batteryHealth}%`
    : `${input.name} มือสอง`;
}

export function buildProductMetaDescription(input: ProductMetaInput): string {
  const parts = [input.name, input.condition === 'NEW' ? 'เครื่องใหม่ มือ 1' : 'มือสอง'];
  if (hasBattery(input)) parts.push(`แบต ${input.batteryHealth}%`);
  if (input.shopWarrantyDays != null && input.shopWarrantyDays > 0) {
    parts.push(`ประกันร้าน ${input.shopWarrantyDays} วัน`);
  }
  // en-US ตรงกับการ์ดแชร์ — ตัวคั่นหลักพันแบบเดียวกัน ไม่ขึ้นกับ locale ของเบราว์เซอร์ที่ prerender
  parts.push(
    input.price != null && input.price > 0
      ? `฿${input.price.toLocaleString('en-US')}`
      : 'สอบถามราคา',
  );
  return `${parts.join(' · ')} — ${DESCRIPTION_SUFFIX}`;
}
