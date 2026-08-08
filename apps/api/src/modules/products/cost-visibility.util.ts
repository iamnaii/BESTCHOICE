/**
 * จุดเดียวที่ตัดสินว่าใครเห็น "ราคาทุน" — owner decision 2026-08-04 §1.4:
 * SALES ต้องไม่เห็นราคาทุน/กำไร และต้องบังคับที่ฝั่ง server (การซ่อนใน DOM
 * อย่างเดียวเปิด response ดิบดูได้). Mirror ของ precedent per-field redaction
 * ที่ staff-chat.controller.ts:126-135 (SALES → nationalId: null).
 *
 * ตั้งใจเขียนเป็น deny-list (`role !== 'SALES'`) ไม่ใช่ allow-list — role ใหม่
 * ที่เพิ่มเข้าระบบในอนาคตจะ "เห็นทุน" โดย default ทันทีที่ไม่ใช่ SALES โดยไม่ต้อง
 * แก้ไฟล์นี้. ถ้ามี role ใหม่ที่ควรถูกซ่อนทุนเหมือน SALES (เช่น role
 * part-time/intern ในอนาคต) ต้องกลับมาทบทวนเงื่อนไขนี้ให้เป็น list หรือ set
 * แทนการเทียบสตริงเดียว.
 */
export function canSeeCost(role: string | undefined | null): boolean {
  return role !== 'SALES';
}

/** ตัดคีย์ costPrice ออกจาก row (ไม่แตะฟิลด์อื่น) */
export function omitCostPrice<T extends { costPrice?: unknown }>(row: T): Omit<T, 'costPrice'> {
  const { costPrice: _costPrice, ...rest } = row;
  return rest;
}

/**
 * summary ของ getStock มี totalValue = ผลรวม costPrice ของสาขา — เป็นข้อมูลทุน
 * เช่นกัน. คืน null (ไม่ใช่ 0) เพื่อให้ UI แยกออกระหว่าง "ไม่มีสิทธิ์ดู" กับ
 * "มูลค่าเป็นศูนย์จริง".
 */
export function redactStockSummary<T extends { totalValue: number }>(
  rows: T[],
): (Omit<T, 'totalValue'> & { totalValue: number | null })[] {
  return rows.map(({ totalValue: _totalValue, ...rest }) => ({ ...rest, totalValue: null }));
}
