import type { GfinTables, MaxPriceApi, OverpriceApi } from '@/pages/ProductDetailPage/utils/gfinQuote';

export type Hand = 'HAND_1' | 'HAND_2';
export const HANDS: Hand[] = ['HAND_1', 'HAND_2'];
export const HAND_LABEL: Record<Hand, string> = { HAND_1: 'มือ 1', HAND_2: 'มือ 2' };

export const rowKeyOf = (series: string, condition: Hand) => `${series}|${condition}`;
export const normalizeStorage = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** ความจุเป็น GB สำหรับเรียงคอลัมน์ — อ่านไม่ออกไปท้ายสุด */
export function storageGb(storage: string): number {
  const m = /^(\d+(?:\.\d+)?)(GB|TB)$/.exec(normalizeStorage(storage));
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]) * (m[2] === 'TB' ? 1024 : 1);
}

/** ตระกูล = ตัวเลขรุ่นของ iPhone ("iPhone 16e" → "16") หรือคำถัดจาก iPhone ("iPhone Air" → "Air") */
export function familyOf(series: string): string {
  const name = series.trim();
  const num = /^iphone\s+(\d+)/i.exec(name);
  if (num) return num[1];
  const word = /^iphone\s+(\S+)/i.exec(name);
  return word ? word[1] : name;
}

/** iPhone Air ออกพร้อมรุ่น 17 — วางระหว่าง 17 กับ 18 (สเปก §6.2 "13, 14 … Air, 18") */
const FAMILY_SORT_HINT: Record<string, number> = { Air: 17.5 };
function familySortKey(family: string): number {
  if (/^\d+$/.test(family)) return Number(family);
  return FAMILY_SORT_HINT[family] ?? Number.MAX_SAFE_INTEGER;
}
export function compareFamilies(a: string, b: string): number {
  return familySortKey(a) - familySortKey(b) || a.localeCompare(b);
}

const SUFFIX_RANK = ['', 'e', 'mini', 'plus', 'pro', 'pro max'];
function suffixRank(series: string): number {
  const suffix = series.trim().replace(/^iphone\s+(\d+|\S+)/i, '').trim().toLowerCase();
  const i = SUFFIX_RANK.indexOf(suffix);
  return i === -1 ? SUFFIX_RANK.length : i;
}

export interface PriceCell {
  /** ความจุแบบไม่มีช่องว่าง เช่น 256GB */
  storage: string;
  /** แถวราคา (เปิดหรือปิด) · null = ไม่เคยมีแถวของช่องนี้ */
  mappingId: string | null;
  /** null = ปิดอยู่หรือไม่มีราคา ⇒ แสดง "—" */
  price: number | null;
}

export interface ModelTermsRow {
  key: string;
  series: string;
  family: string;
  condition: Hand;
  cells: PriceCell[];
  /** กติกาที่เปิดใช้ของรุ่นนี้มือนี้ — ปิดใช้ = ไม่นับ (ตัวคำนวณไม่ใช้) */
  rule: OverpriceApi | null;
  allowance: number | null;
  /** null + มีกติกา = ไม่จำกัดงวด */
  maxMonths: number | null;
  /** ดาวน์ที่ใช้จริง (เต็มร้อย) */
  downPct: number;
  downSource: 'MODEL' | 'DEFAULT';
  hasActivePrice: boolean;
  /** มีราคาเปิดอยู่แต่ไม่มีเงื่อนไข ⇒ คิดผ่อน GFIN ไม่ได้ (สเปก §2) */
  needsRule: boolean;
}

export interface ModelTermsFamily {
  family: string;
  label: string;
  rows: ModelTermsRow[];
}

export interface ModelTermsView {
  storageColumns: string[];
  families: ModelTermsFamily[];
  rows: ModelTermsRow[];
  needsRuleRows: ModelTermsRow[];
}

function compareRows(a: ModelTermsRow, b: ModelTermsRow): number {
  return (
    compareFamilies(a.family, b.family) ||
    suffixRank(a.series) - suffixRank(b.series) ||
    a.series.localeCompare(b.series) ||
    a.condition.localeCompare(b.condition)
  );
}

export function buildModelTermsView(tables: GfinTables): ModelTermsView {
  const priced = tables.mappings.filter((m) => m.gfinVariant === null);
  const storageColumns = [...new Set(priced.map((m) => normalizeStorage(m.storage)))].sort(
    (a, b) => storageGb(a) - storageGb(b),
  );

  const groups = new Map<string, MaxPriceApi[]>();
  for (const m of priced) {
    const key = rowKeyOf(m.gfinSeries.trim(), m.condition);
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }

  const rows = [...groups.entries()]
    .map(([key, list]): ModelTermsRow => {
      const series = list[0].gfinSeries.trim();
      const condition = list[0].condition;
      const cells = storageColumns.map((storage): PriceCell => {
        const inStorage = list.filter((m) => normalizeStorage(m.storage) === storage);
        const active = inStorage.find((m) => m.isActive);
        const any = active ?? inStorage[0];
        return { storage, mappingId: any?.id ?? null, price: active ? Number(active.maxPrice) : null };
      });
      const rule =
        tables.rules.find((r) => r.isActive && r.seriesPattern.trim() === series && r.condition === condition) ?? null;
      const hasActivePrice = cells.some((c) => c.price !== null);
      const modelDown = rule?.minDownPct ?? null;
      return {
        key,
        series,
        family: familyOf(series),
        condition,
        cells,
        rule,
        allowance: rule ? Number(rule.allowance) : null,
        maxMonths: rule?.maxMonths ?? null,
        downPct: modelDown ?? tables.settings.minDownPct,
        downSource: modelDown !== null ? 'MODEL' : 'DEFAULT',
        hasActivePrice,
        needsRule: hasActivePrice && rule === null,
      };
    })
    .sort(compareRows);

  const families: ModelTermsFamily[] = [];
  for (const row of rows) {
    const last = families[families.length - 1];
    if (last && last.family === row.family) last.rows.push(row);
    else
      families.push({
        family: row.family,
        label: /^iphone\s/i.test(row.series) ? `iPhone ${row.family}` : row.family,
        rows: [row],
      });
  }

  return { storageColumns, families, rows, needsRuleRows: rows.filter((r) => r.needsRule) };
}

export const ALL_FAMILIES = 'ALL';

export interface TermsFilter {
  search: string;
  /** `ALL_FAMILIES` หรือรหัสตระกูล */
  family: string;
  hand: 'ALL' | Hand;
  onlyAttention: boolean;
}

export function filterFamilies(view: ModelTermsView, f: TermsFilter): ModelTermsFamily[] {
  const q = f.search.trim().toLowerCase();
  return view.families
    .filter((fam) => f.family === ALL_FAMILIES || fam.family === f.family)
    .map((fam) => ({
      ...fam,
      rows: fam.rows.filter(
        (r) =>
          (!q || r.series.toLowerCase().includes(q)) &&
          (f.hand === 'ALL' || r.condition === f.hand) &&
          (!f.onlyAttention || r.needsRule),
      ),
    }))
    .filter((fam) => fam.rows.length > 0);
}

const fmt = (n: number) => n.toLocaleString('th-TH');
export const allowanceText = (row: ModelTermsRow) => (row.allowance === null ? '—' : `+${fmt(row.allowance)}`);
export const monthsText = (row: ModelTermsRow) =>
  row.rule === null ? '—' : row.maxMonths === null ? 'ไม่จำกัด' : `${row.maxMonths} งวด`;
export const downText = (row: ModelTermsRow) => `${row.downPct}%`;

export function selectionSummary(rows: ModelTermsRow[]): string {
  const hands = new Set(rows.map((r) => r.condition));
  const handText = hands.size === 2 ? 'มือ 1 และมือ 2' : HAND_LABEL[[...hands][0] ?? 'HAND_1'];
  return `เลือก ${rows.length} แถว · ${handText}`;
}
