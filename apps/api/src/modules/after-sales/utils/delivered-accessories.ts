/**
 * M3 (final review PR5, 2026-10-13) — อุปกรณ์ที่ส่งมอบพร้อมเครื่องทดแทนของเคสขายสด เก็บบน
 * `AfterSalesCase.deliveredAccessories` แบบโครงสร้าง (ใบส่งมอบอ่านจากตรงนี้) · note ของ event DELIVERED
 * ยังมีข้อความ "อุปกรณ์: …" ไว้ให้คนอ่าน และเป็นทางถอยของเคสก่อน M3 ที่คอลัมน์เป็น null
 */
export interface DeliveredAccessories {
  box?: boolean;
  charger?: boolean;
  case?: boolean;
  other?: string | null;
}

/** รูปที่เก็บลงฐาน — ทุกคีย์มีค่าเสมอ (บูลีน + other เป็นข้อความหรือ null) */
export function normalizeDeliveredAccessories(a: DeliveredAccessories): Required<DeliveredAccessories> {
  return { box: !!a.box, charger: !!a.charger, case: !!a.case, other: a.other?.trim() || null };
}

export function deliveredAccessoriesText(a?: DeliveredAccessories | null): string | null {
  if (!a) return null;
  const parts = [
    a.box && 'กล่อง',
    a.charger && 'สายชาร์จ',
    a.case && 'เคส',
    a.other?.trim() && `อื่น ๆ — ${a.other.trim()}`,
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(', ') : null;
}
