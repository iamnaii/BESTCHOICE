/**
 * ประวัติอะไหล่/การซ่อมของเครื่อง (Product.partsHistory) — บันทึกไว้แจ้งลูกค้าเท่านั้น
 * ไม่มีผลกับ OVER หรือค่างวดใด ๆ (คำตัดสินเจ้าของ 2026-09-26)
 * ข้อความชุดเดียวใช้ทั้งเอกสารสัญญา/ใบเสร็จ (API), บอทขาย และหน้าเว็บ
 */
export type PartsHistoryValue =
  | 'ORIGINAL'
  | 'GENUINE_REPLACED'
  | 'BATTERY_NON_GENUINE'
  | 'NON_GENUINE_PARTS';

export const PARTS_HISTORY_LABEL: Record<PartsHistoryValue, string> = {
  ORIGINAL: 'ของเดิมทั้งหมด ไม่เคยซ่อม',
  GENUINE_REPLACED: 'เคยเปลี่ยนอะไหล่แท้ หรือจอแท้ศูนย์',
  BATTERY_NON_GENUINE: 'เปลี่ยนแบตใหม่ (ไม่ใช่แบตแท้ Apple)',
  NON_GENUINE_PARTS: 'หน้าจอ กล้อง หรืออะไหล่อื่นไม่แท้',
};

/** ป้ายสั้นสำหรับชิปบนการ์ดสินค้า (พนักงานเห็น) — ข้อความเต็มใช้ PARTS_HISTORY_LABEL */
export const PARTS_HISTORY_SHORT_LABEL: Record<PartsHistoryValue, string> = {
  ORIGINAL: 'อะไหล่เดิมทั้งหมด',
  GENUINE_REPLACED: 'เคยเปลี่ยนอะไหล่แท้',
  BATTERY_NON_GENUINE: 'เปลี่ยนแบต (ไม่ใช่แบตแท้)',
  NON_GENUINE_PARTS: 'มีอะไหล่ไม่แท้',
};

export const PARTS_HISTORY_VALUES = Object.keys(PARTS_HISTORY_LABEL) as PartsHistoryValue[];

export function isPartsHistoryValue(value: unknown): value is PartsHistoryValue {
  return typeof value === 'string' && (PARTS_HISTORY_VALUES as string[]).includes(value);
}

/** "<ป้าย> · <รายละเอียด>" ไม่มีคำนำหน้า (ใช้ตอบลูกค้าในแชท) · ยังไม่ระบุ = สตริงว่าง */
export function partsHistoryLabel(
  partsHistory: PartsHistoryValue | null | undefined,
  note?: string | null,
): string {
  if (!partsHistory) return '';
  const detail = note?.trim();
  return `${PARTS_HISTORY_LABEL[partsHistory]}${detail ? ` · ${detail}` : ''}`;
}

/** "ประวัติอะไหล่: …" สำหรับเอกสารลูกค้า · ยังไม่ระบุ = สตริงว่าง (ไม่พิมพ์บรรทัดนี้) */
export function partsHistoryText(
  partsHistory: PartsHistoryValue | null | undefined,
  note?: string | null,
): string {
  const label = partsHistoryLabel(partsHistory, note);
  return label ? `ประวัติอะไหล่: ${label}` : '';
}
