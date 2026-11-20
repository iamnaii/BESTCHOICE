import type { GfinTables, OverpriceApi } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { gfinProductOf, gfinQuoteAt } from '../gfinQuoteAt';
import { HAND_LABEL, rowKeyOf, type Hand, type ModelTermsRow } from './modelTerms';

export const MONTH_CHOICES = [10, 12, 15] as const;

export type ValueEdit = { mode: 'keep' } | { mode: 'set'; value: number };
export type DownEdit = { mode: 'keep' } | { mode: 'default' } | { mode: 'set'; value: number };
export type MonthsEdit = ValueEdit;
export interface RuleEdit {
  allowance: ValueEdit;
  maxMonths: MonthsEdit;
  down: DownEdit;
}

export interface BulkUpsertBody {
  items: { series: string; condition: Hand }[];
  allowance?: number;
  maxMonths?: number;
  minDownPct?: number | null;
}

const fmt = (n: number) => n.toLocaleString('th-TH');
const allowanceLabel = (r: ModelTermsRow) => (r.allowance === null ? 'ยังไม่ตั้ง' : `+${fmt(r.allowance)}`);
const monthsLabel = (r: ModelTermsRow) =>
  r.rule === null ? 'ยังไม่ตั้ง' : r.maxMonths === null ? 'ไม่จำกัด' : `${r.maxMonths} งวด`;
const downLabel = (r: ModelTermsRow) =>
  `${r.downPct}% (${r.downSource === 'MODEL' ? 'ตั้งเฉพาะรุ่น' : 'ค่ากลาง'})`;

function current(rows: ModelTermsRow[], label: (r: ModelTermsRow) => string): string {
  const values = [...new Set(rows.map(label))];
  if (values.length > 1) return `ตอนนี้ต่างกัน ${values.length} ค่า`;
  return rows.length > 1 ? `ตอนนี้ ${values[0]} ทั้ง ${rows.length} รุ่น` : `ตอนนี้ ${values[0]}`;
}

/** บรรทัด "ตอนนี้ …" ใต้แต่ละช่องของกล่องแก้ (สเปก §6.2 ข้อ 5) */
export function summarizeCurrent(rows: ModelTermsRow[]) {
  return {
    allowance: current(rows, allowanceLabel),
    maxMonths: current(rows, monthsLabel),
    down: current(rows, downLabel),
  };
}

/** มีแถวที่ยังไม่มีกติกาที่เปิดใช้ ⇒ OVER + ผ่อนสูงสุดต้องกรอก ("ไม่เปลี่ยน" กดไม่ได้) */
export const needsValues = (rows: ModelTermsRow[]) => rows.some((r) => r.rule === null);

export function validateEdit(rows: ModelTermsRow[], edit: RuleEdit): string | null {
  if (rows.length === 0) return 'ยังไม่ได้เลือกรุ่น';
  if (needsValues(rows) && edit.allowance.mode === 'keep') return 'มีแถวที่ยังไม่ตั้งเงื่อนไข — ต้องกรอก OVER';
  if (needsValues(rows) && edit.maxMonths.mode === 'keep') return 'มีแถวที่ยังไม่ตั้งเงื่อนไข — ต้องเลือกผ่อนสูงสุด';
  if (edit.allowance.mode === 'keep' && edit.maxMonths.mode === 'keep' && edit.down.mode === 'keep')
    return 'ยังไม่ได้เปลี่ยนอะไร';
  if (edit.allowance.mode === 'set') {
    const v = edit.allowance.value;
    if (!Number.isFinite(v) || v < 0) return 'OVER ต้องเป็น 0 ขึ้นไป';
    if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return 'OVER มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง';
  }
  if (edit.maxMonths.mode === 'set' && !(Number.isInteger(edit.maxMonths.value) && edit.maxMonths.value >= 1 && edit.maxMonths.value <= 36))
    return 'ผ่อนสูงสุดต้องอยู่ระหว่าง 1–36 งวด';
  if (edit.down.mode === 'set' && !(Number.isInteger(edit.down.value) && edit.down.value >= 0 && edit.down.value <= 80))
    return 'ดาวน์ต้องอยู่ระหว่าง 0–80%';
  return null;
}

export function toBulkUpsertBody(rows: ModelTermsRow[], edit: RuleEdit): BulkUpsertBody {
  const body: BulkUpsertBody = { items: rows.map((r) => ({ series: r.series, condition: r.condition })) };
  if (edit.allowance.mode === 'set') body.allowance = edit.allowance.value;
  if (edit.maxMonths.mode === 'set') body.maxMonths = edit.maxMonths.value;
  if (edit.down.mode === 'default') body.minDownPct = null;
  if (edit.down.mode === 'set') body.minDownPct = edit.down.value;
  return body;
}

function before(rows: ModelTermsRow[], label: (r: ModelTermsRow) => string): string {
  const values = [...new Set(rows.map(label))];
  return values.length === 1 ? values[0] : 'หลายค่า';
}

/** กล่องสรุป "จะเปลี่ยน:" */
export function describeEdit(rows: ModelTermsRow[], edit: RuleEdit, defaultDownPct: number): string[] {
  const lines: string[] = [];
  if (edit.allowance.mode === 'set')
    lines.push(`OVER ${before(rows, allowanceLabel)} → +${fmt(edit.allowance.value)}`);
  if (edit.maxMonths.mode === 'set')
    lines.push(`ผ่อนสูงสุด ${before(rows, monthsLabel)} → ${edit.maxMonths.value} งวด`);
  if (edit.down.mode === 'default')
    lines.push(`ดาวน์ ${before(rows, downLabel)} → ${defaultDownPct}% (ค่ากลาง)`);
  if (edit.down.mode === 'set') lines.push(`ดาวน์ ${before(rows, downLabel)} → ${edit.down.value}% (ตั้งเฉพาะรุ่น)`);
  return lines;
}

/** ตารางที่เหมือนบันทึกแล้ว — ใช้คิดตัวอย่าง "หลัง" ด้วยสูตรเดียวกับหน้าสินค้า */
export function applyEditToTables(tables: GfinTables, rows: ModelTermsRow[], edit: RuleEdit): GfinTables {
  const patched = new Map<string, OverpriceApi>();
  for (const r of rows) {
    const base: OverpriceApi = r.rule ?? {
      id: `preview-${rowKeyOf(r.series, r.condition)}`,
      label: `${r.series} ${HAND_LABEL[r.condition]}`,
      seriesPattern: r.series,
      condition: r.condition,
      allowance: '0',
      maxMonths: null,
      minDownPct: null,
      isActive: true,
    };
    patched.set(base.id, {
      ...base,
      isActive: true,
      allowance: edit.allowance.mode === 'set' ? String(edit.allowance.value) : base.allowance,
      maxMonths: edit.maxMonths.mode === 'set' ? edit.maxMonths.value : base.maxMonths,
      minDownPct:
        edit.down.mode === 'default' ? null : edit.down.mode === 'set' ? edit.down.value : (base.minDownPct ?? null),
    });
  }
  const rules = tables.rules.map((r) => patched.get(r.id) ?? r);
  for (const [id, r] of patched) if (!tables.rules.some((x) => x.id === id)) rules.push(r);
  return { ...tables, rules };
}

export interface ExampleQuote {
  salePrice: number;
  down: number;
  monthly: number;
  months: number;
}

function example(tables: GfinTables, row: ModelTermsRow, storage: string): ExampleQuote | null {
  const r = gfinQuoteAt(tables, gfinProductOf(row.series, storage, row.condition, 'THAI'), null);
  if (!r.quote.available || r.months === null) return null;
  return {
    salePrice: r.quote.result.gfinSubmitPrice.toNumber(),
    down: r.quote.result.downAmountActual.toNumber(),
    monthly: r.quote.result.monthlyPayment.toNumber(),
    months: r.months,
  };
}

/** ตัวอย่าง 1 เครื่อง: แถวแรก · ความจุต่ำสุดที่มีราคาเปิด · เครื่องไทย · ขายเท่าราคาส่ง (สเปก §6.2 ข้อ 5) */
export function previewExample(tables: GfinTables, rows: ModelTermsRow[], edit: RuleEdit) {
  const row = rows.find((r) => r.cells.some((c) => c.price !== null));
  if (!row) return null;
  const cell = row.cells.find((c) => c.price !== null)!;
  return {
    label: `${row.series} ${cell.storage} ${HAND_LABEL[row.condition]}`,
    before: example(tables, row, cell.storage),
    after: example(applyEditToTables(tables, rows, edit), row, cell.storage),
  };
}
