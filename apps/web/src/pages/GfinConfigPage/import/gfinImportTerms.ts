import { ImportBatchError, cellText, chunk } from '@/utils/excel-cell.util';
import type { OverpriceApi } from '@/pages/ProductDetailPage/utils/gfinQuote';
import {
  GFIN_IMPORT_BATCH_SIZE,
  canonicalSeriesMap,
  conditionOf,
  keyOf,
  normalizeGfinStorage,
  parseGfinPrice,
  trimKeys,
  type ExistingMaxPrice,
  type GfinImportItem,
  type GfinImportResult,
} from '../gfinPriceListImport';
import { HAND_LABEL, rowKeyOf, type Hand } from '../terms/modelTerms';
import type { BulkUpsertBody } from '../terms/ruleChange';

/** คอลัมน์ไม่บังคับต่อท้ายแบบฟอร์ม (สเปก §6.3 ข้อ 1) */
export const GFIN_IMPORT_TERM_HEADERS = ['OVER', 'ผ่อนสูงสุด'] as const;
export const GFIN_RULE_BATCH_SIZE = 200;
export const GFIN_CLOSE_BATCH_SIZE = 500;

const fmt = (n: number) => n.toLocaleString('th-TH');

interface ParsedRow {
  rowNumber: number;
  series: string;
  storage: string;
  condition: Hand;
  over: number | null;
  months: number | null;
}

/** แถวที่มีรุ่น · ความจุ · มือ ครบ (ไม่ดูราคา) — ใช้ตัดสินว่า "ช่องนี้อยู่ในไฟล์" */
function fileKey(raw: Record<string, unknown>) {
  const row = trimKeys(raw);
  const model = cellText(row['รุ่น']).trim();
  const storage = normalizeGfinStorage(cellText(row['ความจุ']));
  const condition = conditionOf(cellText(row['มือ 1/มือ 2']));
  return model && storage && condition ? { model, storage, condition } : null;
}

function parseRows(rows: Record<string, unknown>[]): { parsed: ParsedRow[]; warnings: string[] } {
  const parsed: ParsedRow[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, index) => {
    const key = fileKey(raw);
    if (!key) return;
    const row = trimKeys(raw);
    if (parseGfinPrice(cellText(row['ราคา'])) === null) return; // แถวราคาผิด buildGfinImportReview ข้ามและรายงานแล้ว
    const dedupeKey = keyOf(key.model, key.storage, key.condition);
    if (seen.has(dedupeKey)) return; // แถวซ้ำใช้แถวแรกที่ถูกต้อง (ตรงกับหน้าตรวจราคา)
    seen.add(dedupeKey);
    const rowNumber = index + 2;
    const overText = cellText(row['OVER']).replace(/,/g, '').trim();
    const monthsText = cellText(row['ผ่อนสูงสุด']).trim();
    let over: number | null = null;
    if (overText !== '') {
      const n = Number(overText);
      if (Number.isFinite(n) && n >= 0 && Math.abs(n * 100 - Math.round(n * 100)) <= 1e-6) over = n;
      else warnings.push(`แถว ${rowNumber}: OVER "${overText}" ไม่ใช่ตัวเลขตั้งแต่ 0 ขึ้นไป — ไม่ใช้ค่านี้`);
    }
    let months: number | null = null;
    if (monthsText !== '') {
      const n = Number(monthsText);
      if (Number.isInteger(n) && n >= 1 && n <= 36) months = n;
      else warnings.push(`แถว ${rowNumber}: ผ่อนสูงสุด "${monthsText}" ต้องเป็นจำนวนงวด 1–36 — ไม่ใช้ค่านี้`);
    }
    parsed.push({ rowNumber, series: key.model, storage: key.storage, condition: key.condition, over, months });
  });
  return { parsed, warnings };
}

// ── ราคาที่มีในระบบแต่ไม่มีในไฟล์ (สเปก §6.3 ข้อ 2) ───────────────────────────────

export interface MissingPrice {
  id: string;
  series: string;
  condition: Hand;
  storage: string;
  price: number;
}
export interface MissingPrices {
  /** รุ่นที่มีในไฟล์แต่ขาดบางความจุ/มือ — ค่าตั้งต้น = ปิด */
  partial: MissingPrice[];
  /** รุ่นที่ไม่มีในไฟล์เลย — ค่าตั้งต้น = เปิดไว้ (กันไฟล์ไม่ครบปิดทั้งใบราคา) */
  absent: MissingPrice[];
}

export function findMissingPrices(rows: Record<string, unknown>[], existing: ExistingMaxPrice[]): MissingPrices {
  const fileKeys = new Set<string>();
  const fileSeries = new Set<string>();
  for (const raw of rows) {
    const key = fileKey(raw);
    if (!key) continue;
    fileKeys.add(keyOf(key.model, key.storage, key.condition));
    fileSeries.add(key.model.toLowerCase());
  }
  const out: MissingPrices = { partial: [], absent: [] };
  for (const e of existing) {
    if (!e.isActive || e.gfinVariant) continue;
    if (fileKeys.has(keyOf(e.gfinSeries, e.storage, e.condition))) continue;
    const item: MissingPrice = {
      id: e.id,
      series: e.gfinSeries.trim(),
      condition: e.condition,
      storage: normalizeGfinStorage(e.storage),
      price: Number(e.maxPrice),
    };
    (fileSeries.has(item.series.toLowerCase()) ? out.partial : out.absent).push(item);
  }
  return out;
}

export function closeIdsFor(m: MissingPrices, opt: { closePartial: boolean; closeAbsent: boolean }): string[] {
  return [...(opt.closePartial ? m.partial : []), ...(opt.closeAbsent ? m.absent : [])].map((x) => x.id);
}

export function missingLines(list: MissingPrice[]): string[] {
  const groups = new Map<string, MissingPrice[]>();
  for (const m of list) {
    const k = rowKeyOf(m.series, m.condition);
    const g = groups.get(k);
    if (g) g.push(m);
    else groups.set(k, [m]);
  }
  return [...groups.values()].map(
    (g) => `${g[0].series} · ${HAND_LABEL[g[0].condition]} · ${g.map((m) => `${m.storage} ${fmt(m.price)}`).join(' · ')}`,
  );
}

// ── เงื่อนไขจากไฟล์ (สเปก §6.3 ข้อ 2 "เงื่อนไข") ───────────────────────────────

export interface TermOption {
  value: number;
  storages: string[];
}
export type TermField =
  | { kind: 'none' }
  | { kind: 'value'; value: number }
  | { kind: 'choose'; options: TermOption[] };

export interface TermsPair {
  key: string;
  series: string;
  condition: Hand;
  /** กติกาที่เปิดใช้อยู่ — null = คู่ใหม่ */
  current: { allowance: number; maxMonths: number | null } | null;
  allowance: TermField;
  maxMonths: TermField;
  status: 'MATCH' | 'CHANGE' | 'CHOOSE' | 'NEW';
}

export interface ImportTermsReview {
  hasTermColumns: boolean;
  pairs: TermsPair[];
  warnings: string[];
}

function termField(entries: { storage: string; value: number | null }[]): TermField {
  const byValue = new Map<number, string[]>();
  for (const e of entries) {
    if (e.value === null) continue;
    const list = byValue.get(e.value);
    if (list) list.push(e.storage);
    else byValue.set(e.value, [e.storage]);
  }
  if (byValue.size === 0) return { kind: 'none' };
  const options = [...byValue.entries()]
    .map(([value, storages]) => ({ value, storages }))
    .sort((a, b) => b.storages.length - a.storages.length || b.value - a.value);
  return options.length === 1 ? { kind: 'value', value: options[0].value } : { kind: 'choose', options };
}

export function buildImportTermsReview(
  rows: Record<string, unknown>[],
  existing: ExistingMaxPrice[],
  rules: OverpriceApi[],
): ImportTermsReview {
  const { parsed, warnings } = parseRows(rows);
  const hasTermColumns = rows.some((r) => {
    const t = trimKeys(r);
    return GFIN_IMPORT_TERM_HEADERS.some((h) => h in t);
  });
  const seriesName = canonicalSeriesMap(rows, existing);
  const groups = new Map<string, { series: string; condition: Hand; rows: ParsedRow[] }>();
  for (const p of parsed) {
    // จัดกลุ่มไม่สนตัวพิมพ์ (เหมือน keyOf ของหน้าตรวจราคา) · ชื่อตามระบบถ้ามี ไม่งั้นใช้การสะกดของแถวแรก
    const lower = p.series.toLowerCase();
    const groupKey = `${lower}|${p.condition}`;
    const g = groups.get(groupKey);
    if (!g) groups.set(groupKey, { series: seriesName.get(lower) ?? p.series, condition: p.condition, rows: [p] });
    else g.rows.push(p); // parseRows ตัดแถวซ้ำแล้ว
  }
  const differs = (f: TermField, cur: number | null) => f.kind === 'value' && f.value !== cur;
  const pairs = [...groups.values()]
    .map((g): TermsPair => {
      const rule = rules.find((r) => r.isActive && r.seriesPattern.trim() === g.series && r.condition === g.condition);
      const current = rule ? { allowance: Number(rule.allowance), maxMonths: rule.maxMonths ?? null } : null;
      const allowance = termField(g.rows.map((r) => ({ storage: r.storage, value: r.over })));
      const maxMonths = termField(g.rows.map((r) => ({ storage: r.storage, value: r.months })));
      const status = !current
        ? 'NEW'
        : allowance.kind === 'choose' || maxMonths.kind === 'choose'
          ? 'CHOOSE'
          : differs(allowance, current.allowance) || differs(maxMonths, current.maxMonths)
            ? 'CHANGE'
            : 'MATCH';
      return { key: rowKeyOf(g.series, g.condition), series: g.series, condition: g.condition, current, allowance, maxMonths, status };
    })
    .sort((a, b) => a.series.localeCompare(b.series) || a.condition.localeCompare(b.condition));
  return { hasTermColumns, pairs, warnings };
}

export type TermChoices = Record<string, { allowance?: number; maxMonths?: number }>;

export interface RuleChange {
  series: string;
  condition: Hand;
  allowance?: number;
  maxMonths?: number;
}

export const isValidAllowance = (n: number) => Number.isFinite(n) && n >= 0 && Math.abs(n * 100 - Math.round(n * 100)) <= 1e-6;
export const isValidMaxMonths = (n: number) => Number.isInteger(n) && n >= 1 && n <= 36;

/** ค่าที่ผู้ใช้เลือก/กรอกต้องใช้ได้ ไม่งั้นนับว่ายังไม่เลือก (ตกไปใช้ค่าจากไฟล์ ถ้ามี) */
const pick = (f: TermField, choice: number | undefined, valid: (n: number) => boolean): number | undefined =>
  choice !== undefined && valid(choice)
    ? choice
    : f.kind === 'value'
      ? f.value
      : f.kind === 'choose'
        ? f.options[0].value
        : undefined;

/** ค่าที่จะส่ง — คู่เดิมส่งเฉพาะฟิลด์ที่ต่างจากระบบ · คู่ใหม่ต้องมีทั้ง OVER และผ่อนสูงสุด ไม่งั้นอยู่ใน missing */
export function resolveTermsPlan(review: ImportTermsReview, choices: TermChoices) {
  const changes: RuleChange[] = [];
  const missing: string[] = [];
  for (const pair of review.pairs) {
    const allowance = pick(pair.allowance, choices[pair.key]?.allowance, isValidAllowance);
    const maxMonths = pick(pair.maxMonths, choices[pair.key]?.maxMonths, isValidMaxMonths);
    if (!pair.current) {
      if (allowance === undefined || maxMonths === undefined) missing.push(pair.key);
      else changes.push({ series: pair.series, condition: pair.condition, allowance, maxMonths });
      continue;
    }
    const change: RuleChange = { series: pair.series, condition: pair.condition };
    if (allowance !== undefined && allowance !== pair.current.allowance) change.allowance = allowance;
    if (maxMonths !== undefined && maxMonths !== pair.current.maxMonths) change.maxMonths = maxMonths;
    if (change.allowance !== undefined || change.maxMonths !== undefined) changes.push(change);
  }
  return { changes, missing };
}

export function ruleChangeText(change: RuleChange, pair: TermsPair): string {
  const parts: string[] = [];
  if (change.allowance !== undefined)
    parts.push(
      pair.current
        ? `OVER +${fmt(pair.current.allowance)} → +${fmt(change.allowance)}`
        : `OVER +${fmt(change.allowance)}`,
    );
  if (change.maxMonths !== undefined)
    parts.push(
      pair.current
        ? `ผ่อนสูงสุด ${pair.current.maxMonths ?? 'ไม่จำกัด'} → ${change.maxMonths} งวด`
        : `ผ่อนสูงสุด ${change.maxMonths} งวด`,
    );
  return `${pair.series} ${HAND_LABEL[pair.condition]}: ${parts.join(' · ')}`;
}

/** bulk-upsert รับค่าชุดเดียวต่อคำขอ ⇒ รวมคู่ที่ค่าเหมือนกัน แล้วแบ่งชุดละ 200 */
export function buildRuleUpsertBatches(changes: RuleChange[]): BulkUpsertBody[] {
  const groups = new Map<string, RuleChange[]>();
  for (const c of changes) {
    const k = `${c.allowance ?? '-'}|${c.maxMonths ?? '-'}`;
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  return [...groups.values()].flatMap((g) =>
    chunk(g, GFIN_RULE_BATCH_SIZE).map((part) => {
      const body: BulkUpsertBody = { items: part.map((c) => ({ series: c.series, condition: c.condition })) };
      if (part[0].allowance !== undefined) body.allowance = part[0].allowance;
      if (part[0].maxMonths !== undefined) body.maxMonths = part[0].maxMonths;
      return body;
    }),
  );
}

// ── บันทึก (สเปก §6.3 ข้อ 3) ───────────────────────────────────────────────

export interface GfinImportSender {
  importPrices: (body: { items: GfinImportItem[] }) => Promise<GfinImportResult>;
  closePrices: (ids: string[]) => Promise<{ closed: number }>;
  upsertRules: (body: BulkUpsertBody) => Promise<unknown>;
}
export interface GfinImportPlan {
  prices: GfinImportItem[];
  closeIds: string[];
  ruleBatches: BulkUpsertBody[];
}
export interface GfinImportOutcome {
  prices: GfinImportResult;
  closed: number;
  rulesSaved: number;
}

/** ราคา (ชุดละ 100) → ปิดราคา → เงื่อนไข — ราคาก่อนเพราะ bulk-upsert ต้องมีแถวราคาของรุ่นก่อน */
export async function runGfinImport(
  sender: GfinImportSender,
  plan: GfinImportPlan,
  onProgress?: (done: number, total: number) => void,
  describeError: (e: unknown) => string = (e) => (e instanceof Error ? e.message : String(e)),
): Promise<GfinImportOutcome> {
  const out: GfinImportOutcome = { prices: { created: 0, updated: 0, unchanged: 0 }, closed: 0, rulesSaved: 0 };
  const steps: Array<() => Promise<void>> = [
    ...chunk(plan.prices, GFIN_IMPORT_BATCH_SIZE).map((items) => async () => {
      const r = await sender.importPrices({ items });
      out.prices.created += r.created;
      out.prices.updated += r.updated;
      out.prices.unchanged += r.unchanged;
    }),
    ...chunk(plan.closeIds, GFIN_CLOSE_BATCH_SIZE).map((ids) => async () => {
      out.closed += (await sender.closePrices(ids)).closed;
    }),
    ...plan.ruleBatches.map((body) => async () => {
      await sender.upsertRules(body);
      out.rulesSaved += body.items.length;
    }),
  ];
  onProgress?.(0, steps.length);
  for (let i = 0; i < steps.length; i++) {
    try {
      await steps[i]();
    } catch (e) {
      throw new ImportBatchError(
        `ชุดที่ ${i + 1}/${steps.length} ส่งไม่สำเร็จ (${describeError(e)}) — บันทึกแล้ว ${i}/${steps.length} ชุด · นำเข้าไฟล์เดิมซ้ำได้ ชุดที่บันทึกแล้วจะนับเป็น "เท่าเดิม"`,
      );
    }
    onProgress?.(i + 1, steps.length);
  }
  return out;
}
