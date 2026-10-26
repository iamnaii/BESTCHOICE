/**
 * ใบเสร็จรับเงินขายสด (ก้อน 4 · 2026-10-23) — ค่าคงที่ที่ API (PDF) และเว็บ (หน้าตั้งค่า) ต้องตรงกัน.
 */

/** คีย์ SystemConfig (snake_case ตาม SettingItemDto) — ข้อความเงื่อนไขประกันร้านท้ายใบเสร็จ แก้ได้ที่ ตั้งค่า › สินค้า & การขาย › ใบเสร็จขายสด */
export const RECEIPT_WARRANTY_TERMS_KEY = 'receipt_shop_warranty_terms';

/**
 * ค่าเริ่มต้นเมื่อไม่มีแถวตั้งค่า — ข้อความตาม mockup ที่เจ้าของเคาะ 2026-10-22 แต่ไม่ฝังจำนวนวัน
 * (จำนวนวันจริงมาจาก `warranty.shopWarrantyDays` และพิมพ์แยกบรรทัดพร้อมวันเริ่ม–สิ้นสุดของใบขาย).
 */
export const DEFAULT_RECEIPT_WARRANTY_TERMS =
  'เปลี่ยนเครื่องรุ่นเดิมได้เมื่อมีตำหนิจากการผลิตภายในระยะประกันร้าน นับจากวันรับเครื่อง · ไม่รวมตก น้ำเข้า จอแตก · ประกันศูนย์ตามเงื่อนไขผู้ผลิต';

/** ป้ายวิธีรับเงินบนใบเสร็จ (คีย์ = Prisma enum `PaymentMethod`). */
export const PAYMENT_METHOD_RECEIPT_LABEL: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอน',
  QR_EWALLET: 'QR/e-Wallet',
  CARD: 'บัตร',
  CREDIT_BALANCE: 'เครดิตคงเหลือ',
  ONLINE_GATEWAY: 'ชำระออนไลน์',
};
