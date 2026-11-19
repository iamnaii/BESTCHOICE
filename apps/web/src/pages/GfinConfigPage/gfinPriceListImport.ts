import type { ImportReviewRow } from '@/components/import/ImportReviewDialog';
import { ImportBatchError, cellText, chunk } from '@/utils/excel-cell.util';

/** หัวคอลัมน์ไฟล์ใบราคา GFIN (สเปคข้อ 7.7) — สคริปต์เตรียมไฟล์จากชีตตรวจเทียบกับรายการนี้ */
export const GFIN_IMPORT_HEADERS = ['รุ่น', 'ความจุ', 'มือ 1/มือ 2', 'ราคา'] as const;

/** เซิร์ฟเวอร์รับได้ไม่เกิน 100 รายการต่อคำขอ */
export const GFIN_IMPORT_BATCH_SIZE = 100;

export interface GfinImportItem {
  model: string;
  storage: string;
  condition: 'HAND_1' | 'HAND_2';
  maxPrice: number;
}

export interface ExistingMaxPrice {
  id: string;
  gfinSeries: string;
  gfinVariant: string | null;
  storage: string;
  condition: 'HAND_1' | 'HAND_2';
  maxPrice: string | number;
  modelMatchPattern: string;
  isActive: boolean;
}

export interface GfinImportReview {
  rows: ImportReviewRow[];
  toSend: GfinImportItem[];
  /** แถวที่เปิดอยู่แบบรุ่นหลัก + รุ่นย่อย (รูปแบบเก่า) — ไฟล์นี้ไม่แตะ */
  legacyActive: number;
}

export interface GfinImportResult {
  created: number;
  updated: number;
  unchanged: number;
}

export const normalizeGfinStorage = (s: string) => s.replace(/\s+/g, '').toUpperCase();

function conditionOf(text: string): 'HAND_1' | 'HAND_2' | null {
  const t = text.replace(/\s+/g, '');
  if (t === 'มือ1') return 'HAND_1';
  if (t === 'มือ2' || t === 'มือสอง') return 'HAND_2';
  return null;
}

const keyOf = (model: string, storage: string, condition: string) =>
  `${model.trim().toLowerCase()}|${normalizeGfinStorage(storage)}|${condition}`;

/** หัวคอลัมน์ที่มีช่องว่างหัวท้ายยังอ่านได้ */
function trimKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.trim()] = v;
  return out;
}

/** หน้าตรวจก่อนยืนยัน — จับคู่แบบเดียวกับเซิร์ฟเวอร์: (ชื่อรุ่น, ความจุ, สภาพ) เฉพาะแถวที่ไม่มีรุ่นย่อย */
export function buildGfinImportReview(
  rows: Record<string, unknown>[],
  existing: ExistingMaxPrice[],
): GfinImportReview {
  const byKey = new Map(
    existing.filter((e) => !e.gfinVariant).map((e) => [keyOf(e.gfinSeries, e.storage, e.condition), e]),
  );
  const seen = new Map<string, number>();
  const review: ImportReviewRow[] = [];
  const toSend: GfinImportItem[] = [];

  rows.forEach((raw, index) => {
    const row = trimKeys(raw);
    const rowNumber = index + 2;
    const model = cellText(row['รุ่น']);
    const storageText = cellText(row['ความจุ']);
    const handText = cellText(row['มือ 1/มือ 2']);
    const priceText = cellText(row['ราคา']);
    if (!model && !storageText && !handText && !priceText) return;
    const storage = normalizeGfinStorage(storageText);
    const label = [model, storage, handText].filter(Boolean).join(' ');
    const skip = (detail: string) => review.push({ rowNumber, label, action: 'SKIP', detail });

    if (!model || !storage) return void skip('ไม่มีรุ่นหรือความจุ');
    const condition = conditionOf(handText);
    if (!condition) return void skip('ช่อง มือ 1/มือ 2 ต้องเป็น มือ 1 หรือ มือ 2');
    const price = Number(priceText.replace(/,/g, ''));
    if (!Number.isFinite(price) || !(price > 0)) return void skip('ราคาต้องเป็นตัวเลขมากกว่า 0');

    // ลงทะเบียนคีย์เฉพาะแถวที่ถูกต้อง — แถวผิดไม่บังแถวถูกที่ตามมา
    const key = keyOf(model, storage, condition);
    const duplicateOf = seen.get(key);
    if (duplicateOf !== undefined) return void skip(`ซ้ำกับแถว ${duplicateOf}`);
    seen.set(key, rowNumber);

    const item: GfinImportItem = { model, storage, condition, maxPrice: price };
    const before = byKey.get(key);
    if (!before) {
      review.push({ rowNumber, label, action: 'ADD' });
      toSend.push(item);
      return;
    }
    const changes: string[] = [];
    if (Number(before.maxPrice) !== price)
      changes.push(`ราคา ${Number(before.maxPrice).toLocaleString('th-TH')} → ${price.toLocaleString('th-TH')}`);
    if (!before.isActive) changes.push('เปิดใช้อีกครั้ง');
    if (before.modelMatchPattern !== model) changes.push(`คำจับคู่ "${before.modelMatchPattern}" → "${model}"`);
    if (changes.length === 0) return void skip('ราคาเท่าเดิม');
    review.push({ rowNumber, label, action: 'UPDATE', detail: changes.join(' · ') });
    toSend.push(item);
  });

  return { rows: review, toSend, legacyActive: existing.filter((e) => e.isActive && e.gfinVariant).length };
}

export async function sendGfinImport(
  post: (body: { items: GfinImportItem[] }) => Promise<GfinImportResult>,
  items: GfinImportItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<GfinImportResult> {
  const batches = chunk(items, GFIN_IMPORT_BATCH_SIZE);
  const total: GfinImportResult = { created: 0, updated: 0, unchanged: 0 };
  for (let i = 0; i < batches.length; i++) {
    onProgress?.(i + 1, batches.length);
    let res: GfinImportResult;
    try {
      res = await post({ items: batches[i] });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new ImportBatchError(
        `ชุดที่ ${i + 1} ส่งไม่สำเร็จ (${reason}) — บันทึกแล้ว ${total.created + total.updated} แถวจากชุดก่อนหน้า`,
      );
    }
    total.created += res.created;
    total.updated += res.updated;
    total.unchanged += res.unchanged;
  }
  return total;
}
