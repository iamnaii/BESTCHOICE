/**
 * ใบเสร็จรับเงินขายสด (ก้อน 4 · 2026-10-23) — ค่าคงที่ที่ API (PDF) และเว็บ (หน้าตั้งค่า) ต้องตรงกัน.
 */

/** คีย์ SystemConfig (snake_case ตาม SettingItemDto) — ข้อความเงื่อนไขประกันร้านท้ายใบเสร็จ แก้ได้ที่ ตั้งค่า › สินค้า & การขาย › ใบเสร็จขายสด */
export const RECEIPT_WARRANTY_TERMS_KEY = 'receipt_shop_warranty_terms';

/** เงื่อนไขมาตรฐานตามเจ้าของร้าน 2026-11-24; จำนวนวันจริงระบุแยกตามเครื่อง/ใบขาย */
export const DEFAULT_RECEIPT_WARRANTY_TERMS = [
  '1. ระยะเวลารับประกัน ตามระยะประกันร้านที่ระบุ นับแต่วันที่ซื้อ',
  '2. ความคุ้มครอง ความผิดปกติของตัวเครื่องที่มิได้เกิดจากการตกหล่นหรือถูกน้ำ ได้แก่ เปิดเครื่องไม่ติด ระบบสัมผัสหน้าจอทำงานผิดปกติ ชาร์จไฟไม่เข้า สัญญาณ ลำโพง ไมโครโฟน กล้อง และ Face ID/Touch ID',
  '3. แบตเตอรี่ อุปกรณ์เสริม และหน้าจอ รับประกัน 7 วัน เฉพาะความบกพร่องจากโรงงาน',
  '4. การเปลี่ยนเครื่อง เปลี่ยนเครื่องให้ภายใน 7 วันแรก เมื่อตรวจสอบยืนยันได้ว่าความผิดปกติเกิดจากตัวเครื่อง',
  '5. ข้อยกเว้นความคุ้มครอง หน้าจอหรือฝาหลังแตก เครื่องตกน้ำหรือมีความชื้น การงัดแงะหรือซ่อมเอง การรูท/เจลเบรก และการใช้งานผิดวิธี',
  '6. ระยะเวลาซ่อม 3–7 วันทำการ',
].join('\n');

/** เติมวันเฉพาะข้อความมาตรฐาน ไม่แก้เงื่อนไขที่เจ้าของปรับเอง */
export function formatDefaultWarrantyTerms(terms: string, days: number): string {
  if (terms !== DEFAULT_RECEIPT_WARRANTY_TERMS || !Number.isInteger(days) || days <= 0)
    return terms;
  return terms.replace('ตามระยะประกันร้านที่ระบุ', `${days} วัน`);
}

/** Listing defaults are projected at read time; explicit per-device terms remain authoritative. */
export function resolveListingWarrantyTerms(
  terms: string | null | undefined,
  days: number | null | undefined,
  standardTerms = DEFAULT_RECEIPT_WARRANTY_TERMS,
): string | undefined {
  if (terms?.trim()) return terms.trim();
  if (days == null || !Number.isInteger(days) || days <= 0) return undefined;
  return formatDefaultWarrantyTerms(standardTerms.trim() || DEFAULT_RECEIPT_WARRANTY_TERMS, days);
}

/** ป้ายวิธีรับเงินบนใบเสร็จ (คีย์ = Prisma enum `PaymentMethod`). */
export const PAYMENT_METHOD_RECEIPT_LABEL: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอน',
  QR_EWALLET: 'QR/e-Wallet',
  CARD: 'บัตร',
  CREDIT_BALANCE: 'เครดิตคงเหลือ',
  ONLINE_GATEWAY: 'ชำระออนไลน์',
};
