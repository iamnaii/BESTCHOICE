/** ค่าเซลล์จาก exceljs → ข้อความ (สูตรใช้ผลลัพธ์ · rich text ต่อกัน · ลิงก์ใช้ข้อความ) */
export function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    const v = value as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (v.result !== undefined) return cellText(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((part) => part.text).join('').trim();
    if (v.text !== undefined) return cellText(v.text);
    return '';
  }
  return String(value).trim();
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** เซิร์ฟเวอร์ปฏิเสธชุดนำเข้า — ข้อความภาษาไทยแสดงให้ผู้ใช้ได้ตรง ๆ */
export class ImportBatchError extends Error {}
