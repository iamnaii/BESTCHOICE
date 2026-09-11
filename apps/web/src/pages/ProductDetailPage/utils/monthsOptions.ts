export interface MonthOption {
  months: number;
  /** ค่างวดต่อเดือนของตัวเลือกนี้ คิดจากดาวน์/คอมที่เลือกอยู่ */
  monthly: number;
}

/**
 * งวดตั้งต้นของ dropdown: 12 ถ้ามี · ไม่มีก็งวดที่ใหญ่สุดที่ไม่เกิน 12 · ไม่มีเลยก็ตัวแรก · ว่าง → null
 * (การ์ดเดิม BcCalculatorCard ใช้ 12-or-first — คงพฤติกรรมนั้นและเพิ่มกรณีเพดานงวดของ GFIN)
 */
export function pickDefaultMonths(months: number[], preferred = 12): number | null {
  if (months.length === 0) return null;
  const sorted = [...months].sort((a, b) => a - b);
  if (sorted.includes(preferred)) return preferred;
  const below = sorted.filter((m) => m < preferred);
  return below.length > 0 ? below[below.length - 1] : sorted[0];
}
