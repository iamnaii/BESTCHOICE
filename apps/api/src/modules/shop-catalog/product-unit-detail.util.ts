/**
 * ตัวแปลงคอลัมน์ Json ของ Product ให้เป็นข้อมูลที่หน้าเว็บลูกค้าแสดงได้
 *
 * checklistResults ถูกเขียนด้วย 2 รูปแบบที่ไม่เข้ากัน:
 *  - PO receiving  → ChecklistResultDto[] = {item, category, passed, note}[]
 *  - trade-in      → object {source:'trade-in', tradeInId, agreedPrice, ...}
 * จึงต้องตรวจรูปร่างก่อนเสมอ ห้าม cast ตรง ๆ
 */

export interface QcCheckItem {
  item: string;
  passed: boolean;
}

const MAX_QC_ITEMS = 20;

export function parseQcChecklist(raw: unknown): QcCheckItem[] {
  if (!Array.isArray(raw)) return [];
  const out: QcCheckItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.item !== 'string' || typeof rec.passed !== 'boolean') continue;
    out.push({ item: rec.item, passed: rec.passed });
    if (out.length >= MAX_QC_ITEMS) break;
  }
  return out;
}

export function parseAccessories(raw: unknown, hasBox: boolean | null | undefined): string[] {
  const listed = Array.isArray(raw)
    ? raw
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
    : [];
  if (hasBox && !listed.includes('กล่อง')) return ['กล่อง', ...listed];
  return listed;
}
