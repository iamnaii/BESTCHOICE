import type { ImportReviewRow } from '@/components/import/ImportReviewDialog';
import { ImportBatchError, cellText, chunk } from '@/utils/excel-cell.util';

/** ชื่อหัวคอลัมน์ของไฟล์นำเข้าราคากลาง (สเปคข้อ 7.4) */
export const PRICING_HEADER = {
  brand: 'ยี่ห้อ',
  model: 'รุ่น',
  storage: 'ความจุ',
  origin: 'เครื่องไทย/นอก',
  category: 'ประเภท',
  warranty: 'ประกัน',
  cash: 'ราคาเงินสด',
  bc: 'ราคาผ่อน BESTCHOICE (ราคาเต็ม)',
  finance: 'ราคาขาย GFIN (ราคาเต็ม)',
  rate1Term: 'งวดเรท 1',
  rate1Down: 'ดาวน์เรท 1',
  rate2Term: 'งวดเรท 2',
} as const;

/** ลำดับคอลัมน์ในแบบฟอร์ม — สคริปต์เตรียมไฟล์จากชีตตรวจเทียบกับรายการนี้ */
export const PRICING_IMPORT_HEADERS = [
  'ยี่ห้อ',
  'รุ่น',
  'ความจุ',
  'เครื่องไทย/นอก',
  'ประเภท',
  'ประกัน',
  'ราคาเงินสด',
  'ราคาผ่อน BESTCHOICE (ราคาเต็ม)',
  'ราคาขาย GFIN (ราคาเต็ม)',
  'งวดเรท 1',
  'ดาวน์เรท 1',
  'งวดเรท 2',
] as const;

/** หัวคอลัมน์ของแบบฟอร์มเก่า (ก่อนสเปคข้อ 3.1) */
const LEGACY_HEADER: Partial<Record<string, string>> = {
  [PRICING_HEADER.bc]: 'ราคาผ่อน BESTCHOICE',
  [PRICING_HEADER.finance]: 'ราคาผ่อนไฟแนนซ์',
};

export const IMPORT_BATCH_SIZE = 100;

export type PricingOrigin = 'UNSPECIFIED' | 'THAI' | 'IMPORTED';

export interface PricingImportItem {
  brand: string;
  model: string;
  storage?: string;
  deviceOrigin: PricingOrigin;
  category: 'PHONE_NEW' | 'PHONE_USED';
  hasWarranty: boolean;
  cashPrice: number;
  installmentBestchoicePrice: number;
  installmentFinancePrice: number;
  rate1TermMonths: number | null;
  rate1DownPayment: number | null;
  rate2TermMonths: number | null;
}

/** รูปแถวจาก GET /pricing-templates (Decimal มาเป็นข้อความ) */
export interface ExistingPricingTemplate {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  category: string;
  hasWarranty: boolean | null;
  deviceOrigin?: string;
  cashPrice: string | number;
  installmentBestchoicePrice: string | number;
  installmentFinancePrice: string | number;
  rate1DownPayment: string | number | null;
  rate1TermMonths: number | null;
  rate2TermMonths: number | null;
}

export interface PricingImportReview {
  rows: ImportReviewRow[];
  toSend: PricingImportItem[];
  missingActive: ExistingPricingTemplate[];
}

const ORIGINS: Record<string, PricingOrigin> = {
  '': 'UNSPECIFIED',
  'ยังไม่ระบุ': 'UNSPECIFIED',
  'ไม่ระบุ': 'UNSPECIFIED',
  'เครื่องไทย': 'THAI',
  'เครื่องนอก': 'IMPORTED',
  UNSPECIFIED: 'UNSPECIFIED',
  THAI: 'THAI',
  IMPORTED: 'IMPORTED',
};

function cell(row: Record<string, unknown>, header: string): string {
  const own = cellText(row[header]);
  const legacy = LEGACY_HEADER[header];
  return own !== '' || !legacy ? own : cellText(row[legacy]);
}

/** ว่าง → null · ไม่ใช่ตัวเลข → NaN */
function amount(text: string): number | null {
  if (text === '') return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? n : Number.NaN;
}

const badTerm = (v: number | null) => v !== null && !(Number.isInteger(v) && v >= 1 && v <= 60);

export function pricingKey(t: {
  brand: string;
  model: string;
  storage?: string | null;
  category: string;
  hasWarranty: boolean | null;
  deviceOrigin?: string;
}): string {
  const warranty = t.category === 'PHONE_USED' ? String(t.hasWarranty === true) : 'false';
  return [t.brand, t.model, t.storage ?? '', t.category, warranty, t.deviceOrigin ?? 'UNSPECIFIED'].join('|');
}

type ParsedRow = { label: string; item: PricingImportItem } | { label: string; error: string } | null;

export function parsePricingRow(row: Record<string, unknown>): ParsedRow {
  const brand = cell(row, PRICING_HEADER.brand);
  const model = cell(row, PRICING_HEADER.model);
  const storage = cell(row, PRICING_HEADER.storage);
  const categoryText = cell(row, PRICING_HEADER.category).replace(/\s+/g, ' ');
  const warrantyText = cell(row, PRICING_HEADER.warranty);
  const originText = cell(row, PRICING_HEADER.origin);
  const cashText = cell(row, PRICING_HEADER.cash);
  if (!brand && !model && !cashText) return null;
  const label = [brand, model, storage, categoryText, warrantyText, originText].filter(Boolean).join(' ');

  if (!brand || !model) return { label, error: 'ไม่มียี่ห้อหรือรุ่น' };
  if (!(originText in ORIGINS))
    return { label, error: 'เครื่องไทย/นอก ต้องเป็น เครื่องไทย · เครื่องนอก · หรือเว้นว่าง' };
  const compact = categoryText.replace(/\s+/g, '');
  const category = compact === 'มือ1' ? 'PHONE_NEW' : compact === 'มือ2' ? 'PHONE_USED' : null;
  if (!category) return { label, error: 'ประเภทต้องเป็น มือ 1 หรือ มือ 2' };
  let hasWarranty = false;
  if (category === 'PHONE_USED') {
    if (warrantyText !== 'มีประกัน' && warrantyText !== 'ไม่มีประกัน')
      return { label, error: 'มือ 2 ต้องระบุ มีประกัน หรือ ไม่มีประกัน' };
    hasWarranty = warrantyText === 'มีประกัน';
  }

  const cash = amount(cashText);
  const bc = amount(cell(row, PRICING_HEADER.bc));
  const finance = amount(cell(row, PRICING_HEADER.finance));
  if (cash === null || !(cash > 0)) return { label, error: 'ราคาเงินสด ต้องเป็นตัวเลขมากกว่า 0' };
  if (bc === null || !(bc > 0)) return { label, error: 'ราคาผ่อน BESTCHOICE ต้องเป็นตัวเลขมากกว่า 0' };
  if (finance === null || !(finance > 0)) return { label, error: 'ราคาขาย GFIN ต้องเป็นตัวเลขมากกว่า 0' };

  const rate1Term = amount(cell(row, PRICING_HEADER.rate1Term));
  const rate1Down = amount(cell(row, PRICING_HEADER.rate1Down));
  const rate2Term = amount(cell(row, PRICING_HEADER.rate2Term));
  if (badTerm(rate1Term)) return { label, error: 'งวดเรท 1 ต้องเป็นจำนวนเต็ม 1–60 หรือเว้นว่าง' };
  if (badTerm(rate2Term)) return { label, error: 'งวดเรท 2 ต้องเป็นจำนวนเต็ม 1–60 หรือเว้นว่าง' };
  if (rate1Down !== null && !(rate1Down > 0 && rate1Down < bc))
    return { label, error: 'ดาวน์เรท 1 ต้องมากกว่า 0 และน้อยกว่าราคาผ่อน BESTCHOICE' };

  return {
    label,
    item: {
      brand,
      model,
      storage: storage || undefined,
      deviceOrigin: ORIGINS[originText],
      category,
      hasWarranty,
      cashPrice: cash,
      installmentBestchoicePrice: bc,
      installmentFinancePrice: finance,
      rate1TermMonths: rate1Term,
      rate1DownPayment: rate1Down,
      rate2TermMonths: rate2Term,
    },
  };
}

const num = (v: string | number | null): number | null => (v === null || v === '' ? null : Number(v));
const show = (v: number | null) => (v === null ? 'ว่าง' : v.toLocaleString('th-TH'));

function changesOf(before: ExistingPricingTemplate, after: PricingImportItem): string[] {
  const pairs: [string, number | null, number | null][] = [
    ['เงินสด', num(before.cashPrice), after.cashPrice],
    ['ราคาผ่อน BESTCHOICE', num(before.installmentBestchoicePrice), after.installmentBestchoicePrice],
    ['ราคาขาย GFIN', num(before.installmentFinancePrice), after.installmentFinancePrice],
    ['งวดเรท 1', before.rate1TermMonths, after.rate1TermMonths],
    ['ดาวน์เรท 1', num(before.rate1DownPayment), after.rate1DownPayment],
    ['งวดเรท 2', before.rate2TermMonths, after.rate2TermMonths],
  ];
  return pairs.filter(([, a, b]) => a !== b).map(([name, a, b]) => `${name} ${show(a)} → ${show(b)}`);
}

/** หน้าตรวจก่อนยืนยัน (สเปคข้อ 7.4) — เทียบไฟล์กับแถวที่เปิดใช้อยู่ (GET /pricing-templates) */
export function buildPricingImportReview(
  rows: Record<string, unknown>[],
  existing: ExistingPricingTemplate[],
): PricingImportReview {
  const byKey = new Map(existing.map((t) => [pricingKey(t), t]));
  const seen = new Map<string, number>();
  const review: ImportReviewRow[] = [];
  const toSend: PricingImportItem[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // แถว 1 = หัวคอลัมน์
    const parsed = parsePricingRow(row);
    if (!parsed) return;
    if ('error' in parsed) {
      review.push({ rowNumber, label: parsed.label, action: 'SKIP', detail: parsed.error });
      return;
    }
    const key = pricingKey(parsed.item);
    const duplicateOf = seen.get(key);
    if (duplicateOf !== undefined) {
      review.push({ rowNumber, label: parsed.label, action: 'SKIP', detail: `ซ้ำกับแถว ${duplicateOf}` });
      return;
    }
    seen.set(key, rowNumber);
    const before = byKey.get(key);
    if (!before) {
      review.push({ rowNumber, label: parsed.label, action: 'ADD' });
      toSend.push(parsed.item);
      return;
    }
    const changes = changesOf(before, parsed.item);
    if (changes.length === 0) {
      review.push({ rowNumber, label: parsed.label, action: 'SKIP', detail: 'ราคาเท่าเดิม' });
      return;
    }
    review.push({ rowNumber, label: parsed.label, action: 'UPDATE', detail: changes.join(' · ') });
    toSend.push(parsed.item);
  });

  return { rows: review, toSend, missingActive: existing.filter((t) => !seen.has(pricingKey(t))) };
}

export interface PricingImportResponse {
  success: number;
  skipped: number;
  errors: string[];
  deactivated?: number;
}

/** ส่งชุดละ 100 ตามลำดับ · deactivateIds ไปกับชุดสุดท้าย (สเปคข้อ 7.4) */
export async function sendPricingImport(
  post: (body: { items: PricingImportItem[]; deactivateIds?: string[] }) => Promise<PricingImportResponse>,
  items: PricingImportItem[],
  deactivateIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ saved: number; deactivated: number }> {
  if (items.length === 0 && deactivateIds.length === 0) return { saved: 0, deactivated: 0 };
  const batches = chunk(items, IMPORT_BATCH_SIZE);
  if (batches.length === 0) batches.push([]);
  let saved = 0;
  let deactivated = 0;
  for (let i = 0; i < batches.length; i++) {
    onProgress?.(i + 1, batches.length);
    const last = i === batches.length - 1;
    const res = await post({
      items: batches[i],
      ...(last && deactivateIds.length > 0 ? { deactivateIds } : {}),
    });
    if (res.errors.length > 0)
      throw new ImportBatchError(
        `ชุดที่ ${i + 1} ถูกปฏิเสธ (${res.errors.join(', ')}) — บันทึกแล้ว ${saved} แถวจากชุดก่อนหน้า`,
      );
    saved += res.success;
    deactivated += res.deactivated ?? 0;
  }
  return { saved, deactivated };
}
