/**
 * ชื่อผู้ให้บริการของหมวด "การตลาด" ที่ทำงานจริงอยู่ ณ ตอนนี้ — แสดงให้ลูกค้าอ่านในหน้าต่างตั้งค่า
 * ห้ามใส่ชื่อที่ยังไม่ได้ติดตั้ง (TikTok / LINE รอ Task 7) · เพิ่มชื่อเมื่อไร = เปลี่ยนเนื้อหา
 * ของหมวดที่ลูกค้ายินยอมไปแล้ว ต้องขึ้น CONSENT_POLICY_VERSION ด้วย
 */
export const MARKETING_VENDOR_NAMES = ['Facebook', 'Instagram'] as const;

/** "A และ B" · "A, B, C และ D" (รูปแบบเดียวกับแบบที่เจ้าของอนุมัติ) */
export function formatThaiList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} และ ${names[names.length - 1]}`;
}

export const MARKETING_ROW_TEXT = `ใช้วัดผลโฆษณา และแสดงโฆษณาของร้านที่ตรงกับความสนใจของคุณบน ${formatThaiList(MARKETING_VENDOR_NAMES)}`;
