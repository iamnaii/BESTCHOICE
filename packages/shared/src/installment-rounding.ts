import Decimal from 'decimal.js';

/** ดาวน์ที่คิดจาก % ปัดขึ้นเป็นหลักนี้ (คำตัดสินเจ้าของ 2026-11-19 — ตามชีต MASTER ช่อง "ปัดเงินดาวน์ขึ้นเป็นหลัก") */
export const DOWN_PAYMENT_STEP = 100;

export function roundUpToStep(amount: Decimal, step: number = DOWN_PAYMENT_STEP): Decimal {
  return amount.div(step).ceil().mul(step);
}

/**
 * ดาวน์จาก % ของราคา — ปัดขึ้นหลักร้อย
 * ราคาต่ำมากจนค่าที่ปัดแล้วไม่น้อยกว่าราคา (เช่น อุปกรณ์เสริม 90 บาท) ใช้ค่าก่อนปัด
 * เพื่อไม่ให้ดาวน์ ≥ ราคาขายเพราะการปัดอย่างเดียว
 */
export function downFromPct(price: Decimal, pct: Decimal): Decimal {
  const raw = price.mul(pct).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const rounded = roundUpToStep(raw);
  return rounded.lt(price) ? rounded : raw;
}

/** รูปแบบ number ของ `downFromPct` สำหรับหน้าเว็บที่เก็บราคาเป็น number */
export function minDownAmountFromPct(price: number, pct: number): number {
  return downFromPct(new Decimal(price), new Decimal(pct)).toNumber();
}
