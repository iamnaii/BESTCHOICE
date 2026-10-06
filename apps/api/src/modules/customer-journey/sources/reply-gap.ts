/** เว้นวรรคแบบไม่ตัดบรรทัด (U+00A0) — เลขกับหน่วยอยู่บรรทัดเดียวกันเสมอ (คำตัดสินเจ้าของ 2026-09-15 ข้อ 12) */
const NBSP = ' ';
const MINUTE_MS = 60_000;

/**
 * ระยะห่างของแถว "ร้านตอบครั้งแรก (หลังทัก …)" — ปัดลงทุกหน่วย · ต่ำสุด 1 นาที (ไม่แสดง "0 นาที")
 * ต่ำกว่า 60 นาที → "N นาที" · ต่ำกว่า 24 ชม. → "N ชม." · ตั้งแต่ 24 ชม. → "N วัน"
 * ผู้เรียกไม่ส่งค่าติดลบ (chat.source ไม่ออกแถวเมื่อคำตอบมาก่อนจุดเริ่ม)
 */
export function formatReplyGap(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / MINUTE_MS));
  if (minutes < 60) return `${minutes}${NBSP}นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${NBSP}ชม.`;
  return `${Math.floor(hours / 24)}${NBSP}วัน`;
}
