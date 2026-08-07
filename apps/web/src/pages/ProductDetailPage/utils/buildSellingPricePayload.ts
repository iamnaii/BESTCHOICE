export interface SellingPriceFormValues {
  cashPrice: string;
  installmentPrice: string;
}

export interface SellingPricePayload {
  cashPrice?: number;
  installmentPrice?: number;
}

/**
 * เทียบค่าฟอร์มปัจจุบันกับค่า ณ ตอนเปิด modal (`initial`) — ใส่ลง payload เฉพาะฟิลด์ที่
 * "เปลี่ยนจริง" เท่านั้น ฟิลด์ที่ว่างเปล่าหรือเท่ากับค่าตอนเปิด modal = undefined = ไม่แตะ
 * ตาม 3-state PATCH เดิมของ UpdateProductDto (undefined ไม่ส่ง / ตัวเลข = ตั้งค่า / null =
 * ล้างค่า — การล้างค่ายังไม่มี UI ในฟอร์มนี้).
 *
 * แก้บั๊ก (deferred จาก Task 7): เปิด modal เครื่องที่มีราคาคอลัมน์อยู่แล้ว แล้วกด "บันทึก"
 * โดยไม่แก้อะไรเลย — เดิม mutationFn ส่งค่าเดิมกลับไปซ้ำเสมอ (เพราะช่องไม่ว่าง) ทำให้ server
 * (presence-based touchesPrice) ตีความว่าแอดมิน "แก้ราคาด้วยมือ" แล้วเคลียร์ priceAutofilledAt
 * badge ทั้งที่ค่าไม่ได้เปลี่ยนเลย.
 */
export function buildSellingPricePayload(
  current: SellingPriceFormValues,
  initial: SellingPriceFormValues,
): SellingPricePayload {
  const payload: SellingPricePayload = {};
  if (current.cashPrice !== '' && current.cashPrice !== initial.cashPrice) {
    payload.cashPrice = parseFloat(current.cashPrice);
  }
  if (current.installmentPrice !== '' && current.installmentPrice !== initial.installmentPrice) {
    payload.installmentPrice = parseFloat(current.installmentPrice);
  }
  return payload;
}

/** payload ว่าง (ไม่มีฟิลด์ไหนเปลี่ยน) → ไม่ต้องยิง PATCH เลย */
export function isSellingPricePayloadEmpty(payload: SellingPricePayload): boolean {
  return payload.cashPrice === undefined && payload.installmentPrice === undefined;
}
