/**
 * ตัดอักษรจีน/ญี่ปุ่น/เกาหลีที่หลุดมาในคำตอบบอท (โมเดลหลุดเป็นครั้งคราว เช่น "自 iPhone 16" —
 * เจอใน bot:eval 2026-09-22) — ร้านตอบภาษาไทย/อังกฤษเท่านั้น จึงไม่มีกรณีที่ตั้งใจใช้อักษรเหล่านี้
 * อีโมจิ/ไทย/ละติน/ตัวเลขไม่ถูกแตะ · ถ้าไม่มีอะไรถูกตัด คืนข้อความเดิมทุกไบต์
 */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;

export function stripStrayForeignScript(text: string): string {
  if (!CJK_RE.test(text)) return text;
  CJK_RE.lastIndex = 0;
  return text
    .replace(CJK_RE, '')
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]{2,}/g, ' ');
}
