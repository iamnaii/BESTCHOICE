# GFIN Settings Web Redesign (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 6-tab GFIN settings page with 3 tabs (เงื่อนไข & ราคา · ทดลองคำนวณ · กลุ่มไลน์ & ข้อความ) built on the per-model rules and APIs that PR 1 (#1808) shipped.

**Architecture:** Pure view-model functions (`modelTerms.ts`, `ruleChange.ts`, `gfinImportTerms.ts`, `centralTerms.ts`, `calcModel.ts`) carry every decision and are unit-tested; thin React components render them. Data comes from the existing `useGfinTables()` hook (same React Query keys as the product page). All quotes go through `resolveGfinQuote` (wrapped by `gfinQuoteAt`) — never `buildGfinQuote` directly. Desktop table and mobile cards both render; Tailwind `md:` (768px) shows one.

**Tech Stack:** React 18 + TypeScript, TanStack Query, shadcn/Radix UI, Tailwind tokens, lucide-react, decimal.js, vitest + Testing Library, `@installment/shared`.

**Spec:** `docs/superpowers/specs/2026-11-20-gfin-settings-redesign-design.md` §6 (+ §2 owner decisions). Mockup: https://claude.ai/artifact/WUyXgvXP7SXHsxGbUywcwD (boards Main · Group · PriceEdit · Import · Calc · Mobile).

## Global Constraints

- UI copy in Thai; Thai text uses `leading-snug` (never `leading-none`).
- Colors: semantic tokens only — no hex, no `text-gray-*`/`bg-gray-*`/`bg-white`, no `text-white`; text on `bg-primary` = `text-primary-foreground`; yellow text = `text-warning-strong` (never `text-warning` as text color); no arbitrary `bg-[var(--x)]` classes.
- Status is never color-only: every amber/warning state carries an icon (lucide `TriangleAlert`) and words.
- Icons: lucide-react only, `aria-hidden="true"` on decorative icons; no emoji.
- No native `<select>`/`<datalist>` (guard test `native-select.inventory.test.ts`) — use `@/components/ui/select`, `RadioGroup`, or buttons with `aria-pressed`. Numbers use `NumberInput`.
- Data: `useQuery`/`useMutation` only; API via `api` from `@/lib/api`; errors via `getErrorMessage`; notifications via `toast` from `sonner`; after every mutation invalidate the affected keys from `GFIN_QUERY_KEYS`.
- Only `OWNER` edits. Non-OWNER sees only the `line` tab (unchanged behavior).
- Never send `commissionTablet` (iPad commission is hidden, DB value untouched — spec §1 "ไม่อยู่ในรอบนี้").
- Max-months choices in the edit dialog: 10 / 12 / 15 (spec §6.2 ข้อ 5).
- Desktop ↔ mobile switch at 768px via Tailwind `md:` (spec §6.2 ข้อ 6 "< 768px").
- Quotes in this page: `gfinQuoteAt` → `resolveGfinQuote` only (spec §6.4). Never import `buildGfinQuote` into `pages/GfinConfigPage`.
- API used (all exist on main after PR 1): `GET/PATCH /gfin-config/settings` (fields `minDownPct`, `commissionPhone`, `contractFee`, `sheetVersion`, `sheetEffectiveDate`) · `GET /gfin-config/max-prices` · `POST /gfin-config/max-prices` · `PATCH /gfin-config/max-prices/:id` (`maxPrice`, `isActive`) · `POST /gfin-config/max-prices/import` (≤100 items) · `POST /gfin-config/max-prices/close` (`{ ids }` ≤500) · `GET /gfin-config/overprice-rules` · `POST /gfin-config/overprice-rules/bulk-upsert` (`{ items:[{series,condition}] ≤200, allowance?, maxMonths?, minDownPct?: number|null }` — one set of values for the whole request; pairs without an active rule need `allowance` + `maxMonths`) · `GET /gfin-config/rate-factors` (+ existing CRUD used by `RateFactorsTab`).
- A pair "has a rule" only when an **active** rule with `seriesPattern === series` exists (inactive rules are ignored by the engine).
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test command (from `apps/web`): `npx vitest run <paths>`; type check (repo root): `./tools/check-types.sh web`.

---

## File Structure

```
apps/web/src/pages/GfinConfigPage/
  index.tsx                      (rewrite — tabs bound to ?tab=)
  gfinQueryKeys.ts               (new — shared React Query keys)
  gfinQuoteAt.ts                 (new — resolveGfinQuote wrapper)
  gfinPriceListImport.ts         (modify — export helpers, drop sendGfinImport)
  RateFactorsTab.tsx             (keep — opened from a dialog)
  GfinPrecheckSettingsPanel.tsx  (keep)
  terms/
    modelTerms.ts                (new — rows/families/filter)
    ruleChange.ts                (new — bulk edit logic + preview)
    centralTerms.ts              (new — commission options, rate chips, settings patch)
    SheetVersionCard.tsx         (new)
    CentralTermsCard.tsx         (new)
    PriceCellPopover.tsx         (new)
    RuleEditDialog.tsx           (new)
    ModelTermsTable.tsx          (new — desktop)
    ModelTermsCards.tsx          (new — mobile)
    TermsTab.tsx                 (new — composition)
  import/
    gfinImportTerms.ts           (new — missing prices, terms review, run plan)
    gfinTemplate.ts              (new — template download)
    GfinImportDialog.tsx         (new)
  calc/
    calcModel.ts                 (new)
    CalcTab.tsx                  (new)
  __tests__/                     (new tests per task; delete old tab tests in Task 11)
DELETE: MaxPricesTab.tsx · OverpriceRulesTab.tsx · GfinSettingsPanel.tsx · MatchPreviewPanel.tsx
        __tests__/MaxPricesTab.import.test.tsx · __tests__/OverpriceRulesTab.test.tsx · __tests__/GfinSettingsPanel.test.tsx
MODIFY: apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts (GfinSettingsApi + sheet fields)
```

---

### Task 0: Worktree setup (controller, not a subagent)

The worktree `.worktrees/gfin-settings-web` (branch `feat/gfin-settings-web` from `origin/main` 86d5cc140) has no `node_modules`. The main checkout is 121 commits behind, so its `@installment/shared` is stale (no `NO_RULE`).

- [ ] **Step 1:** Recreate the junction layout used for PR 1: worktree root `node_modules` = junctions per entry to the main checkout's `node_modules`, except `@installment/*` pointing at this worktree's `packages/*`.
- [ ] **Step 2:** Build shared: `npm --prefix packages/shared run build`.
- [ ] **Step 3:** Baseline: `cd apps/web && npx vitest run src/pages/GfinConfigPage src/pages/ProductDetailPage/utils` → all pass. Record the result in `.superpowers/sdd/progress.md`.

---

### Task 1: Model terms view-model

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/gfinQueryKeys.ts`
- Create: `apps/web/src/pages/GfinConfigPage/terms/modelTerms.ts`
- Modify: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts` (interface `GfinSettingsApi`)
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/modelTerms.test.ts`

**Interfaces:**
- Produces: `GFIN_QUERY_KEYS`; `Hand`, `HANDS`, `HAND_LABEL`, `rowKeyOf`, `normalizeStorage`, `storageGb`, `familyOf`, `compareFamilies`, `ModelTermsRow`, `PriceCell`, `ModelTermsFamily`, `ModelTermsView`, `buildModelTermsView(tables)`, `TermsFilter`, `ALL_FAMILIES`, `filterFamilies(view, filter)`, `allowanceText(row)`, `monthsText(row)`, `downText(row)`, `selectionSummary(rows)`.

- [ ] **Step 1: Add sheet fields to the web settings type**

In `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts` replace the `GfinSettingsApi` interface with:

```ts
export interface GfinSettingsApi {
  minDownPct: number;
  maxDownPct: number;
  downStepPct: number;
  contractFee: number;
  commissionPctByCategory: { PHONE: number; TABLET: number };
  /** เวอร์ชันใบเงื่อนไข G Finn เช่น "6.5" — API รุ่นก่อน PR 1 ไม่ส่ง */
  sheetVersion?: string | null;
  /** วันเริ่มใช้ใบเงื่อนไข YYYY-MM-DD */
  sheetEffectiveDate?: string | null;
}
```

- [ ] **Step 2: Create the query keys**

`apps/web/src/pages/GfinConfigPage/gfinQueryKeys.ts`:

```ts
/** คีย์เดียวกับ useGfinTables (หน้าสินค้า) — แก้ที่หน้าตั้งค่าแล้วหน้าสินค้าเห็นค่าใหม่ทันที */
export const GFIN_QUERY_KEYS = {
  prices: ['gfin-max-prices'],
  rules: ['gfin-overprice-rules'],
  factors: ['gfin-rate-factors'],
  settings: ['gfin-settings'],
} as const;
```

- [ ] **Step 3: Write the failing test**

`apps/web/src/pages/GfinConfigPage/__tests__/modelTerms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GfinTables, MaxPriceApi, OverpriceApi } from '@/pages/ProductDetailPage/utils/gfinQuote';
import {
  ALL_FAMILIES,
  buildModelTermsView,
  familyOf,
  filterFamilies,
  selectionSummary,
  storageGb,
} from '../terms/modelTerms';

const settings = {
  minDownPct: 25,
  maxDownPct: 80,
  downStepPct: 5,
  contractFee: 100,
  commissionPctByCategory: { PHONE: 15, TABLET: 5 },
};
const price = (
  id: string,
  series: string,
  storage: string,
  condition: 'HAND_1' | 'HAND_2',
  maxPrice: number,
  isActive = true,
  gfinVariant: string | null = null,
): MaxPriceApi => ({
  id, gfinSeries: series, gfinVariant, storage, condition, maxPrice: String(maxPrice), modelMatchPattern: series, isActive,
});
const rule = (
  id: string,
  series: string,
  condition: 'HAND_1' | 'HAND_2',
  allowance: number,
  maxMonths: number | null,
  minDownPct: number | null = null,
  isActive = true,
): OverpriceApi => ({
  id, label: series, seriesPattern: series, condition, allowance: String(allowance), maxMonths, minDownPct, isActive,
});
const tables = (mappings: MaxPriceApi[], rules: OverpriceApi[]): GfinTables => ({ mappings, rules, factors: [], settings });

describe('buildModelTermsView', () => {
  it('คอลัมน์ความจุสร้างจากข้อมูล เรียง 64GB → 1TB', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('a', 'iPhone 15', '1TB', 'HAND_1', 40000),
          price('b', 'iPhone 15', '128 GB', 'HAND_1', 20000),
          price('c', 'iPhone 12', '64GB', 'HAND_2', 9000),
        ],
        [],
      ),
    );
    expect(view.storageColumns).toEqual(['64GB', '128GB', '1TB']);
  });

  it('แถวมือ N ขึ้นเฉพาะเมื่อมีราคาของมือนั้น (เปิดหรือปิด) · แถวรูปแบบเก่าที่มีรุ่นย่อยไม่ขึ้น', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('a', 'iPhone 12', '64GB', 'HAND_2', 9000),
          price('b', 'iPhone 13', '128GB', 'HAND_1', 15000, false),
          price('c', 'iPhone 14', '128GB', 'HAND_1', 18000, true, 'Pro'),
        ],
        [],
      ),
    );
    expect(view.rows.map((r) => r.key)).toEqual(['iPhone 12|HAND_2', 'iPhone 13|HAND_1']);
  });

  it('ช่องราคา: เปิด = ตัวเลข · ปิด = null แต่มี mappingId · ไม่มีแถว = mappingId null', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('open', 'iPhone 15', '128GB', 'HAND_1', 20000),
          price('closed', 'iPhone 15', '256GB', 'HAND_1', 24000, false),
          price('other', 'iPhone 16', '512GB', 'HAND_1', 30000),
        ],
        [],
      ),
    );
    const row = view.rows.find((r) => r.key === 'iPhone 15|HAND_1')!;
    expect(row.cells).toEqual([
      { storage: '128GB', mappingId: 'open', price: 20000 },
      { storage: '256GB', mappingId: 'closed', price: null },
      { storage: '512GB', mappingId: null, price: null },
    ]);
  });

  it('ดาวน์: กติกาตั้ง = MODEL · ไม่ตั้ง = ค่ากลาง · กติกาที่ปิดใช้ไม่นับ (ต้องตั้ง)', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('a', 'iPhone 17', '256GB', 'HAND_1', 30000),
          price('b', 'iPhone 17', '256GB', 'HAND_2', 25000),
          price('c', 'iPhone 16', '128GB', 'HAND_2', 20000),
          price('d', 'iPhone 12', '64GB', 'HAND_2', 9000, false),
        ],
        [
          rule('r1', 'iPhone 17', 'HAND_1', 2000, 15, 30),
          rule('r2', 'iPhone 17', 'HAND_2', 2000, 15, null),
          rule('r3', 'iPhone 16', 'HAND_2', 1000, 12, null, false),
        ],
      ),
    );
    const byKey = Object.fromEntries(view.rows.map((r) => [r.key, r]));
    expect(byKey['iPhone 17|HAND_1']).toMatchObject({ downPct: 30, downSource: 'MODEL', allowance: 2000, maxMonths: 15, needsRule: false });
    expect(byKey['iPhone 17|HAND_2']).toMatchObject({ downPct: 25, downSource: 'DEFAULT' });
    expect(byKey['iPhone 16|HAND_2']).toMatchObject({ rule: null, needsRule: true, hasActivePrice: true });
    expect(byKey['iPhone 12|HAND_2']).toMatchObject({ rule: null, needsRule: false, hasActivePrice: false });
    expect(view.needsRuleRows.map((r) => r.key)).toEqual(['iPhone 16|HAND_2']);
  });

  it('ตระกูลเรียง 12 … 17, Air, 18 · รุ่นในตระกูลเรียง ปกติ → e → Plus → Pro → Pro Max · มือ 1 ก่อนมือ 2', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('1', 'iPhone 18 Pro', '256GB', 'HAND_1', 1),
          price('2', 'iPhone Air', '256GB', 'HAND_1', 1),
          price('3', 'iPhone 17 Pro Max', '256GB', 'HAND_2', 1),
          price('4', 'iPhone 17 Pro Max', '256GB', 'HAND_1', 1),
          price('5', 'iPhone 17e', '256GB', 'HAND_1', 1),
          price('6', 'iPhone 17', '256GB', 'HAND_1', 1),
          price('7', 'iPhone 12', '64GB', 'HAND_2', 1),
        ],
        [],
      ),
    );
    expect(view.families.map((f) => f.label)).toEqual(['iPhone 12', 'iPhone 17', 'iPhone Air', 'iPhone 18']);
    expect(view.families[1].rows.map((r) => r.key)).toEqual([
      'iPhone 17|HAND_1',
      'iPhone 17e|HAND_1',
      'iPhone 17 Pro Max|HAND_1',
      'iPhone 17 Pro Max|HAND_2',
    ]);
  });
});

describe('helpers', () => {
  it('familyOf / storageGb', () => {
    expect(familyOf('iPhone 16e')).toBe('16');
    expect(familyOf('iPhone 17 Pro Max')).toBe('17');
    expect(familyOf('iPhone Air')).toBe('Air');
    expect(storageGb('1 TB')).toBe(1024);
    expect(storageGb('64GB')).toBe(64);
  });

  it('filterFamilies: ค้นหา · ตระกูล · มือ · เฉพาะแถวที่ต้องดู', () => {
    const view = buildModelTermsView(
      tables(
        [
          price('a', 'iPhone 12', '64GB', 'HAND_2', 9000),
          price('b', 'iPhone 17 Pro', '256GB', 'HAND_1', 30000),
          price('c', 'iPhone 17 Pro', '256GB', 'HAND_2', 25000),
        ],
        [rule('r', 'iPhone 17 Pro', 'HAND_1', 2000, 15), rule('s', 'iPhone 17 Pro', 'HAND_2', 2000, 15)],
      ),
    );
    const keys = (f: Parameters<typeof filterFamilies>[1]) =>
      filterFamilies(view, f).flatMap((fam) => fam.rows.map((r) => r.key));
    const base = { search: '', family: ALL_FAMILIES, hand: 'ALL' as const, onlyAttention: false };
    expect(keys(base)).toHaveLength(3);
    expect(keys({ ...base, search: 'pro' })).toEqual(['iPhone 17 Pro|HAND_1', 'iPhone 17 Pro|HAND_2']);
    expect(keys({ ...base, family: '12' })).toEqual(['iPhone 12|HAND_2']);
    expect(keys({ ...base, hand: 'HAND_1' })).toEqual(['iPhone 17 Pro|HAND_1']);
    expect(keys({ ...base, onlyAttention: true })).toEqual(['iPhone 12|HAND_2']);
  });

  it('selectionSummary', () => {
    const view = buildModelTermsView(
      tables([price('a', 'iPhone 17', '256GB', 'HAND_1', 1), price('b', 'iPhone 17', '256GB', 'HAND_2', 1)], []),
    );
    expect(selectionSummary([view.rows[1]])).toBe('เลือก 1 แถว · มือ 2');
    expect(selectionSummary(view.rows)).toBe('เลือก 2 แถว · มือ 1 และมือ 2');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/modelTerms.test.ts`
Expected: FAIL — cannot resolve `../terms/modelTerms`.

- [ ] **Step 5: Implement**

`apps/web/src/pages/GfinConfigPage/terms/modelTerms.ts`:

```ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/modelTerms.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/gfinQueryKeys.ts apps/web/src/pages/GfinConfigPage/terms/modelTerms.ts apps/web/src/pages/GfinConfigPage/__tests__/modelTerms.test.ts apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts
git commit -m "feat(gfin-web): view-model ตารางราคาและเงื่อนไขรายรุ่น

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Quote wrapper + bulk-edit logic

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/gfinQuoteAt.ts`
- Create: `apps/web/src/pages/GfinConfigPage/terms/ruleChange.ts`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/ruleChange.test.ts`

**Interfaces:**
- Consumes: `ModelTermsRow`, `Hand`, `HAND_LABEL`, `rowKeyOf`, `buildModelTermsView` (Task 1); `resolveGfinQuote`, `GfinOverrides`, `GfinTables`, `GfinQuoteInput`, `ResolvedGfin` (gfinQuote.ts).
- Produces:
  - `gfinProductOf(series, storage, condition, deviceOrigin): GfinQuoteInput['product']`
  - `gfinQuoteAt(tables, product, salePrice: number | null, overrides?: Partial<GfinOverrides>): ResolvedGfin`
  - `RuleEdit`, `MonthsEdit`, `DownEdit`, `BulkUpsertBody`, `MONTH_CHOICES = [10, 12, 15]`
  - `summarizeCurrent(rows) → { allowance; maxMonths; down }` (strings)
  - `needsValues(rows): boolean`, `validateEdit(rows, edit): string | null`
  - `toBulkUpsertBody(rows, edit): BulkUpsertBody`
  - `describeEdit(rows, edit, defaultDownPct): string[]`
  - `applyEditToTables(tables, rows, edit): GfinTables`
  - `previewExample(tables, rows, edit) → { label; before: ExampleQuote | null; after: ExampleQuote | null } | null` with `ExampleQuote = { salePrice; down; monthly; months }`

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/GfinConfigPage/__tests__/ruleChange.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { buildModelTermsView } from '../terms/modelTerms';
import {
  describeEdit,
  needsValues,
  previewExample,
  summarizeCurrent,
  toBulkUpsertBody,
  validateEdit,
  type RuleEdit,
} from '../terms/ruleChange';

const settings = {
  minDownPct: 25,
  maxDownPct: 80,
  downStepPct: 5,
  contractFee: 100,
  commissionPctByCategory: { PHONE: 15, TABLET: 5 },
};
const tables: GfinTables = {
  mappings: [
    { id: 'm1', gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '38900', modelMatchPattern: 'iPhone 17 Pro Max', isActive: true },
    { id: 'm2', gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '512GB', condition: 'HAND_2', maxPrice: '41900', modelMatchPattern: 'iPhone 17 Pro Max', isActive: true },
    { id: 'm3', gfinSeries: 'iPhone 17', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '25000', modelMatchPattern: 'iPhone 17', isActive: true },
    { id: 'm4', gfinSeries: 'iPhone 12', gfinVariant: null, storage: '64GB', condition: 'HAND_2', maxPrice: '9000', modelMatchPattern: 'iPhone 12', isActive: true },
  ],
  rules: [
    { id: 'r1', label: 'iPhone 17 Pro Max มือ 2', seriesPattern: 'iPhone 17 Pro Max', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true },
    { id: 'r2', label: 'iPhone 17 มือ 2', seriesPattern: 'iPhone 17', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true },
  ],
  factors: [
    { id: 'f10', months: 10, shopCommissionPct: 15, factor: '0.1286', feePerInstallment: '100', isActive: true },
    { id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.1105', feePerInstallment: '100', isActive: true },
    { id: 'f15', months: 15, shopCommissionPct: 15, factor: '0.0921', feePerInstallment: '100', isActive: true },
  ],
  settings,
};
const view = buildModelTermsView(tables);
const row = (key: string) => view.rows.find((r) => r.key === key)!;
const pm = row('iPhone 17 Pro Max|HAND_2');
const base = row('iPhone 17|HAND_2');
const noRule = row('iPhone 12|HAND_2');
const KEEP: RuleEdit = { allowance: { mode: 'keep' }, maxMonths: { mode: 'keep' }, down: { mode: 'keep' } };

describe('summarizeCurrent', () => {
  it('ค่าเดียวกันทุกแถว → "ตอนนี้ X ทั้ง N รุ่น"', () => {
    expect(summarizeCurrent([pm, base])).toEqual({
      allowance: 'ตอนนี้ +2,000 ทั้ง 2 รุ่น',
      maxMonths: 'ตอนนี้ 15 งวด ทั้ง 2 รุ่น',
      down: 'ตอนนี้ 30% (ตั้งเฉพาะรุ่น) ทั้ง 2 รุ่น',
    });
  });
  it('ต่างกัน → "ตอนนี้ต่างกัน N ค่า" · แถวเดียว ไม่มีคำว่า ทั้ง', () => {
    expect(summarizeCurrent([pm, noRule]).allowance).toBe('ตอนนี้ต่างกัน 2 ค่า');
    expect(summarizeCurrent([noRule]).down).toBe('ตอนนี้ 25% (ค่ากลาง)');
  });
});

describe('validateEdit / toBulkUpsertBody', () => {
  it('แถวที่ยังไม่ตั้งเงื่อนไขต้องกรอก OVER และผ่อนสูงสุด', () => {
    expect(needsValues([pm, noRule])).toBe(true);
    expect(validateEdit([noRule], { ...KEEP, down: { mode: 'default' } })).toBe(
      'มีแถวที่ยังไม่ตั้งเงื่อนไข — ต้องกรอก OVER',
    );
    expect(validateEdit([noRule], { ...KEEP, allowance: { mode: 'set', value: 0 } })).toBe(
      'มีแถวที่ยังไม่ตั้งเงื่อนไข — ต้องเลือกผ่อนสูงสุด',
    );
  });
  it('ไม่เปลี่ยนอะไรเลย = บันทึกไม่ได้ · ค่าผิดช่วง = บอกเหตุ', () => {
    expect(validateEdit([pm], KEEP)).toBe('ยังไม่ได้เปลี่ยนอะไร');
    expect(validateEdit([pm], { ...KEEP, allowance: { mode: 'set', value: -1 } })).toBe('OVER ต้องเป็น 0 ขึ้นไป');
    expect(validateEdit([pm], { ...KEEP, down: { mode: 'set', value: 90 } })).toBe('ดาวน์ต้องอยู่ระหว่าง 0–80%');
  });
  it('body: ฟิลด์ "ไม่เปลี่ยน" ไม่ส่ง · ค่ากลาง = minDownPct null', () => {
    expect(toBulkUpsertBody([pm, base], { ...KEEP, down: { mode: 'default' } })).toEqual({
      items: [
        { series: 'iPhone 17 Pro Max', condition: 'HAND_2' },
        { series: 'iPhone 17', condition: 'HAND_2' },
      ],
      minDownPct: null,
    });
    expect(
      toBulkUpsertBody([noRule], { allowance: { mode: 'set', value: 0 }, maxMonths: { mode: 'set', value: 12 }, down: { mode: 'set', value: 30 } }),
    ).toEqual({ items: [{ series: 'iPhone 12', condition: 'HAND_2' }], allowance: 0, maxMonths: 12, minDownPct: 30 });
  });
});

describe('describeEdit / previewExample', () => {
  it('สรุป "จะเปลี่ยน"', () => {
    expect(describeEdit([pm, base], { allowance: { mode: 'set', value: 1500 }, maxMonths: { mode: 'keep' }, down: { mode: 'default' } }, 25)).toEqual([
      'OVER +2,000 → +1,500',
      'ดาวน์ 30% (ตั้งเฉพาะรุ่น) → 25% (ค่ากลาง)',
    ]);
  });
  it('ตัวอย่างเครื่องแรก (ความจุต่ำสุด · ขายเท่าราคาส่ง): ดาวน์ 30% → 25%', () => {
    const p = previewExample(tables, [pm, base], { ...KEEP, down: { mode: 'default' } });
    expect(p).toEqual({
      label: 'iPhone 17 Pro Max 256GB มือ 2',
      before: { salePrice: 40900, down: 12300, monthly: 2737, months: 15 },
      after: { salePrice: 40900, down: 10300, monthly: 2926, months: 15 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/ruleChange.test.ts`
Expected: FAIL — cannot resolve `../terms/ruleChange`.

- [ ] **Step 3: Implement the quote wrapper**

`apps/web/src/pages/GfinConfigPage/gfinQuoteAt.ts`:

```ts
import {
  resolveGfinQuote,
  type GfinOverrides,
  type GfinQuoteInput,
  type GfinTables,
  type ResolvedGfin,
} from '@/pages/ProductDetailPage/utils/gfinQuote';
import type { Hand } from './terms/modelTerms';

const NO_OVERRIDES: GfinOverrides = { months: null, downPct: null, commissionPct: null, templateMonths: null };

/** เครื่องสมมติจากแถวในใบราคา — มือ 1 = PHONE_NEW · มือ 2 = PHONE_USED (สเปก §6.4) */
export function gfinProductOf(
  series: string,
  storage: string,
  condition: Hand,
  deviceOrigin: 'THAI' | 'IMPORTED',
): GfinQuoteInput['product'] {
  return {
    brand: 'Apple',
    model: series,
    storage,
    category: condition === 'HAND_1' ? 'PHONE_NEW' : 'PHONE_USED',
    deviceOrigin,
  };
}

/**
 * ใบเสนอ GFIN ของหน้าตั้งค่า — ผ่าน resolveGfinQuote ตัวเดียวกับหน้าสินค้า (สเปก §6.4 ห้ามเรียก buildGfinQuote ตรง)
 * salePrice null = ขายเท่าราคาส่ง: รอบแรกหา gfinSubmitPrice (ไม่ขึ้นกับราคาขาย) แล้วคิดใหม่ด้วยราคานั้น
 */
export function gfinQuoteAt(
  tables: GfinTables,
  product: GfinQuoteInput['product'],
  salePrice: number | null,
  overrides: Partial<GfinOverrides> = {},
): ResolvedGfin {
  const o: GfinOverrides = { ...NO_OVERRIDES, ...overrides };
  if (salePrice !== null) return resolveGfinQuote(tables, product, salePrice, o);
  const first = resolveGfinQuote(tables, product, 0, o);
  if (!first.quote.available) return first;
  return resolveGfinQuote(tables, product, first.quote.result.gfinSubmitPrice.toNumber(), o);
}
```

- [ ] **Step 4: Implement the bulk-edit logic**

`apps/web/src/pages/GfinConfigPage/terms/ruleChange.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/ruleChange.test.ts`
Expected: PASS (7 tests). If `previewExample` numbers differ, recompute by hand from `calcGfinInstallment` (submit 40,900 · 30% → 12,270 → ปัด 12,300 · ยอดจัด 28,630 × 0.0921 = 2,636.82 → 2,637 + 100) before touching the expectation.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/gfinQuoteAt.ts apps/web/src/pages/GfinConfigPage/terms/ruleChange.ts apps/web/src/pages/GfinConfigPage/__tests__/ruleChange.test.ts
git commit -m "feat(gfin-web): ตรรกะแก้เงื่อนไขหลายรุ่น + ตัวอย่างค่างวดก่อน/หลัง

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Import — missing prices, terms review, run plan

**Files:**
- Modify: `apps/web/src/pages/GfinConfigPage/gfinPriceListImport.ts` (export helpers, remove `sendGfinImport`)
- Modify: `apps/web/src/pages/GfinConfigPage/__tests__/gfinPriceListImport.test.ts` (remove the `sendGfinImport` describe block and its imports)
- Create: `apps/web/src/pages/GfinConfigPage/import/gfinImportTerms.ts`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/gfinImportTerms.test.ts`

**Interfaces:**
- Consumes: `conditionOf`, `keyOf`, `trimKeys`, `normalizeGfinStorage`, `GFIN_IMPORT_BATCH_SIZE`, `GfinImportItem`, `GfinImportResult`, `ExistingMaxPrice` (gfinPriceListImport.ts); `rowKeyOf`, `Hand`, `HAND_LABEL` (Task 1); `BulkUpsertBody` (Task 2); `OverpriceApi`.
- Produces:
  - `GFIN_IMPORT_TERM_HEADERS = ['OVER', 'ผ่อนสูงสุด']`
  - `MissingPrice`, `MissingPrices { partial; absent }`, `findMissingPrices(rows, existing)`, `closeIdsFor(missing, { closePartial, closeAbsent })`, `missingLines(list): string[]`
  - `TermField`, `TermOption`, `TermsPair`, `ImportTermsReview { hasTermColumns; pairs; warnings }`, `buildImportTermsReview(rows, existing, rules)`
  - `TermChoices = Record<string, { allowance?: number; maxMonths?: number }>`, `RuleChange`, `resolveTermsPlan(review, choices) → { changes; missing }`, `ruleChangeText(change, pair)`
  - `buildRuleUpsertBatches(changes): BulkUpsertBody[]`
  - `GfinImportSender`, `GfinImportPlan`, `GfinImportOutcome`, `runGfinImport(sender, plan, onProgress?, describeError?)`

- [ ] **Step 1: Export the row helpers and drop the old sender**

In `apps/web/src/pages/GfinConfigPage/gfinPriceListImport.ts`:
- change `function conditionOf(` → `export function conditionOf(`
- change `const keyOf =` → `export const keyOf =`
- change `function trimKeys(` → `export function trimKeys(`
- delete the whole `export async function sendGfinImport(…) { … }` function and drop `ImportBatchError` and `chunk` from the `@/utils/excel-cell.util` import (keep `cellText`).

In `apps/web/src/pages/GfinConfigPage/__tests__/gfinPriceListImport.test.ts` delete the `describe('sendGfinImport', …)` block, and remove `sendGfinImport`, `ImportBatchError` and `GfinImportItem` from the imports if they become unused.

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/gfinPriceListImport.test.ts` → PASS.

- [ ] **Step 2: Write the failing test**

`apps/web/src/pages/GfinConfigPage/__tests__/gfinImportTerms.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ImportBatchError } from '@/utils/excel-cell.util';
import type { OverpriceApi } from '@/pages/ProductDetailPage/utils/gfinQuote';
import type { ExistingMaxPrice } from '../gfinPriceListImport';
import {
  buildImportTermsReview,
  buildRuleUpsertBatches,
  closeIdsFor,
  findMissingPrices,
  missingLines,
  resolveTermsPlan,
  ruleChangeText,
  runGfinImport,
} from '../import/gfinImportTerms';

const row = (model: string, storage: string, hand: string, price: number, over?: unknown, months?: unknown) => ({
  'รุ่น': model,
  'ความจุ': storage,
  'มือ 1/มือ 2': hand,
  'ราคา': price,
  ...(over !== undefined ? { OVER: over } : {}),
  ...(months !== undefined ? { 'ผ่อนสูงสุด': months } : {}),
});
const ex = (id: string, series: string, storage: string, condition: 'HAND_1' | 'HAND_2', maxPrice: number, isActive = true): ExistingMaxPrice => ({
  id, gfinSeries: series, gfinVariant: null, storage, condition, maxPrice: String(maxPrice), modelMatchPattern: series, isActive,
});
const rule = (series: string, condition: 'HAND_1' | 'HAND_2', allowance: number, maxMonths: number | null, isActive = true): OverpriceApi => ({
  id: `${series}-${condition}`, label: series, seriesPattern: series, condition, allowance: String(allowance), maxMonths, minDownPct: null, isActive,
});

describe('findMissingPrices', () => {
  const existing = [
    ex('a', 'iPhone 14 Pro', '128GB', 'HAND_2', 20000),
    ex('b', 'iPhone 14 Pro', '1TB', 'HAND_2', 28000),
    ex('c', 'iPhone 12', '64GB', 'HAND_2', 9000),
    ex('d', 'iPhone 12', '128GB', 'HAND_2', 10000),
    ex('e', 'iPhone 11', '64GB', 'HAND_2', 7000, false),
  ];
  const rows = [row('iPhone 14 Pro', '128GB', 'มือ 2', 20000)];

  it('รุ่นที่มีในไฟล์แต่ขาดบางช่อง = partial · รุ่นที่ไม่มีในไฟล์เลย = absent · ราคาที่ปิดอยู่ไม่นับ', () => {
    const m = findMissingPrices(rows, existing);
    expect(m.partial.map((x) => x.id)).toEqual(['b']);
    expect(m.absent.map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('ค่าตั้งต้น: ปิด partial · เปิด absent ไว้ (ไฟล์ 2 แถวไม่ปิดราคาอื่นถ้าไม่ติ๊ก)', () => {
    const m = findMissingPrices(rows, existing);
    expect(closeIdsFor(m, { closePartial: true, closeAbsent: false })).toEqual(['b']);
    expect(closeIdsFor(m, { closePartial: true, closeAbsent: true })).toEqual(['b', 'c', 'd']);
  });

  it('missingLines รวมตามรุ่น·มือ', () => {
    expect(missingLines(findMissingPrices(rows, existing).absent)).toEqual(['iPhone 12 · มือ 2 · 64GB 9,000 · 128GB 10,000']);
  });
});

describe('buildImportTermsReview', () => {
  const existing = [ex('a', 'iPhone 14 Pro', '128GB', 'HAND_2', 20000)];

  it('OVER ต่างกันตามความจุ → CHOOSE (ค่าที่ใช้มากสุดก่อน)', () => {
    const review = buildImportTermsReview(
      [
        row('iPhone 14 Pro', '128GB', 'มือ 2', 20000, 2000, 15),
        row('iPhone 14 Pro', '256GB', 'มือ 2', 22000, 2000, 15),
        row('iPhone 14 Pro', '1TB', 'มือ 2', 28000, 0, 15),
      ],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15)],
    );
    expect(review.hasTermColumns).toBe(true);
    const pair = review.pairs[0];
    expect(pair.status).toBe('CHOOSE');
    expect(pair.allowance).toEqual({
      kind: 'choose',
      options: [
        { value: 2000, storages: ['128GB', '256GB'] },
        { value: 0, storages: ['1TB'] },
      ],
    });
    expect(pair.maxMonths).toEqual({ kind: 'value', value: 15 });
  });

  it('ตรงกับระบบ = MATCH · ต่าง = CHANGE · ชื่อรุ่นตามระบบแม้ไฟล์พิมพ์ตัวเล็ก', () => {
    const review = buildImportTermsReview(
      [row('iphone 14 pro', '128GB', 'มือ 2', 20000, 2000, 12), row('iPhone 15', '128GB', 'มือ 1', 25000, 1000, 15)],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15), rule('iPhone 15', 'HAND_1', 1000, 15)],
    );
    const byKey = Object.fromEntries(review.pairs.map((p) => [p.key, p.status]));
    expect(byKey).toEqual({ 'iPhone 14 Pro|HAND_2': 'CHANGE', 'iPhone 15|HAND_1': 'MATCH' });
  });

  it('ไฟล์ไม่มีคอลัมน์เงื่อนไข → hasTermColumns false · คู่เดิมไม่เปลี่ยน · คู่ใหม่ต้องกรอก', () => {
    const review = buildImportTermsReview(
      [row('iPhone 14 Pro', '128GB', 'มือ 2', 20000), row('iPhone 18 Pro', '256GB', 'มือ 2', 45000)],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15)],
    );
    expect(review.hasTermColumns).toBe(false);
    const plan = resolveTermsPlan(review, {});
    expect(plan.changes).toEqual([]);
    expect(plan.missing).toEqual(['iPhone 18 Pro|HAND_2']);
    const filled = resolveTermsPlan(review, { 'iPhone 18 Pro|HAND_2': { allowance: 2000, maxMonths: 15 } });
    expect(filled).toEqual({
      changes: [{ series: 'iPhone 18 Pro', condition: 'HAND_2', allowance: 2000, maxMonths: 15 }],
      missing: [],
    });
  });

  it('กติกาที่ปิดใช้ = ยังไม่มีเงื่อนไข (NEW) · ค่าในไฟล์ผิดรูป = คำเตือน ไม่ใช้ค่านั้น', () => {
    const review = buildImportTermsReview(
      [row('iPhone 14 Pro', '128GB', 'มือ 2', 20000, 'abc', 15)],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15, false)],
    );
    expect(review.pairs[0].status).toBe('NEW');
    expect(review.warnings).toEqual(['แถว 2: OVER "abc" ไม่ใช่ตัวเลขตั้งแต่ 0 ขึ้นไป — ไม่ใช้ค่านี้']);
    expect(resolveTermsPlan(review, {}).missing).toEqual(['iPhone 14 Pro|HAND_2']);
  });

  it('resolveTermsPlan: CHOOSE ใช้ค่าแรกถ้าไม่เลือก · ส่งเฉพาะฟิลด์ที่ต่างจากระบบ · ruleChangeText', () => {
    const review = buildImportTermsReview(
      [row('iPhone 14 Pro', '128GB', 'มือ 2', 20000, 2000, 12), row('iPhone 14 Pro', '1TB', 'มือ 2', 28000, 0, 12)],
      existing,
      [rule('iPhone 14 Pro', 'HAND_2', 2000, 15)],
    );
    expect(resolveTermsPlan(review, {}).changes).toEqual([{ series: 'iPhone 14 Pro', condition: 'HAND_2', maxMonths: 12 }]);
    const chosen = resolveTermsPlan(review, { 'iPhone 14 Pro|HAND_2': { allowance: 0 } });
    expect(chosen.changes).toEqual([{ series: 'iPhone 14 Pro', condition: 'HAND_2', allowance: 0, maxMonths: 12 }]);
    expect(ruleChangeText(chosen.changes[0], review.pairs[0])).toBe('iPhone 14 Pro มือ 2: OVER +2,000 → +0 · ผ่อนสูงสุด 15 → 12 งวด');
  });
});

describe('buildRuleUpsertBatches', () => {
  it('รวมคู่ที่ค่าเหมือนกันเป็นคำขอเดียว', () => {
    expect(
      buildRuleUpsertBatches([
        { series: 'A', condition: 'HAND_1', allowance: 2000, maxMonths: 15 },
        { series: 'B', condition: 'HAND_2', maxMonths: 12 },
        { series: 'C', condition: 'HAND_1', allowance: 2000, maxMonths: 15 },
      ]),
    ).toEqual([
      { items: [{ series: 'A', condition: 'HAND_1' }, { series: 'C', condition: 'HAND_1' }], allowance: 2000, maxMonths: 15 },
      { items: [{ series: 'B', condition: 'HAND_2' }], maxMonths: 12 },
    ]);
  });
});

describe('runGfinImport', () => {
  const items = Array.from({ length: 150 }, (_, i) => ({ model: `M${i}`, storage: '128GB', condition: 'HAND_1' as const, maxPrice: 1000 }));

  it('ลำดับ ราคา(ชุดละ 100) → ปิด → เงื่อนไข · แจ้งความคืบหน้าทุกชุด', async () => {
    const calls: string[] = [];
    const sender = {
      importPrices: vi.fn(async (b: { items: unknown[] }) => (calls.push(`price:${b.items.length}`), { created: b.items.length, updated: 0, unchanged: 0 })),
      closePrices: vi.fn(async (ids: string[]) => (calls.push(`close:${ids.length}`), { closed: ids.length })),
      upsertRules: vi.fn(async (b: { items: unknown[] }) => (calls.push(`rules:${b.items.length}`), {})),
    };
    const progress: string[] = [];
    const out = await runGfinImport(
      sender,
      { prices: items, closeIds: ['x', 'y'], ruleBatches: [{ items: [{ series: 'A', condition: 'HAND_1' }], maxMonths: 12 }] },
      (d, t) => progress.push(`${d}/${t}`),
    );
    expect(calls).toEqual(['price:100', 'price:50', 'close:2', 'rules:1']);
    expect(progress).toEqual(['0/4', '1/4', '2/4', '3/4', '4/4']);
    expect(out).toEqual({ prices: { created: 150, updated: 0, unchanged: 0 }, closed: 2, rulesSaved: 1 });
  });

  it('พลาดกลางทาง → บอกว่าบันทึกไปแล้วกี่ชุด + นำเข้าไฟล์เดิมซ้ำได้', async () => {
    const sender = {
      importPrices: vi.fn(async () => ({ created: 1, updated: 0, unchanged: 0 })),
      closePrices: vi.fn(async () => {
        throw new Error('boom');
      }),
      upsertRules: vi.fn(),
    };
    await expect(runGfinImport(sender, { prices: items.slice(0, 1), closeIds: ['x'], ruleBatches: [] })).rejects.toEqual(
      new ImportBatchError('ชุดที่ 2/2 ส่งไม่สำเร็จ (boom) — บันทึกแล้ว 1/2 ชุด · นำเข้าไฟล์เดิมซ้ำได้ ชุดที่บันทึกแล้วจะนับเป็น "เท่าเดิม"'),
    );
    expect(sender.upsertRules).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/gfinImportTerms.test.ts`
Expected: FAIL — cannot resolve `../import/gfinImportTerms`.

- [ ] **Step 4: Implement**

`apps/web/src/pages/GfinConfigPage/import/gfinImportTerms.ts`:

```ts
import { ImportBatchError, cellText, chunk } from '@/utils/excel-cell.util';
import type { OverpriceApi } from '@/pages/ProductDetailPage/utils/gfinQuote';
import {
  GFIN_IMPORT_BATCH_SIZE,
  conditionOf,
  keyOf,
  normalizeGfinStorage,
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
  rows.forEach((raw, index) => {
    const key = fileKey(raw);
    if (!key) return;
    const row = trimKeys(raw);
    const price = Number(cellText(row['ราคา']).replace(/,/g, ''));
    if (!Number.isFinite(price) || !(price > 0)) return; // แถวราคาผิด buildGfinImportReview รายงานแล้ว
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
  const seriesName = new Map(
    existing.filter((e) => !e.gfinVariant).map((e) => [e.gfinSeries.trim().toLowerCase(), e.gfinSeries.trim()]),
  );
  const groups = new Map<string, { series: string; condition: Hand; rows: ParsedRow[] }>();
  for (const p of parsed) {
    const series = seriesName.get(p.series.toLowerCase()) ?? p.series;
    const key = rowKeyOf(series, p.condition);
    const g = groups.get(key);
    if (!g) groups.set(key, { series, condition: p.condition, rows: [p] });
    else if (!g.rows.some((r) => r.storage === p.storage)) g.rows.push(p); // แถวซ้ำใช้แถวแรก (ตรงกับหน้าตรวจราคา)
  }
  const differs = (f: TermField, cur: number | null) => f.kind === 'value' && f.value !== cur;
  const pairs = [...groups.entries()]
    .map(([key, g]): TermsPair => {
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
      return { key, series: g.series, condition: g.condition, current, allowance, maxMonths, status };
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

const pick = (f: TermField, choice: number | undefined): number | undefined =>
  choice ?? (f.kind === 'value' ? f.value : f.kind === 'choose' ? f.options[0].value : undefined);

/** ค่าที่จะส่ง — คู่เดิมส่งเฉพาะฟิลด์ที่ต่างจากระบบ · คู่ใหม่ต้องมีทั้ง OVER และผ่อนสูงสุด ไม่งั้นอยู่ใน missing */
export function resolveTermsPlan(review: ImportTermsReview, choices: TermChoices) {
  const changes: RuleChange[] = [];
  const missing: string[] = [];
  for (const pair of review.pairs) {
    const allowance = pick(pair.allowance, choices[pair.key]?.allowance);
    const maxMonths = pick(pair.maxMonths, choices[pair.key]?.maxMonths);
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
```

- [ ] **Step 5: Run tests**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/gfinImportTerms.test.ts src/pages/GfinConfigPage/__tests__/gfinPriceListImport.test.ts`
Expected: PASS. If `ImportBatchError` equality fails because the class carries extra fields, assert with `rejects.toThrow('<same message>')` and `rejects.toBeInstanceOf(ImportBatchError)` instead.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/gfinPriceListImport.ts apps/web/src/pages/GfinConfigPage/__tests__/gfinPriceListImport.test.ts apps/web/src/pages/GfinConfigPage/import/gfinImportTerms.ts apps/web/src/pages/GfinConfigPage/__tests__/gfinImportTerms.test.ts
git commit -m "feat(gfin-web): ตรวจใบราคา — ราคาที่ไม่มีในไฟล์ · เงื่อนไขจากไฟล์ · ลำดับบันทึก

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Version card + central settings

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/terms/centralTerms.ts`
- Create: `apps/web/src/pages/GfinConfigPage/terms/SheetVersionCard.tsx`
- Create: `apps/web/src/pages/GfinConfigPage/terms/CentralTermsCard.tsx`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/centralTerms.test.tsx`

**Interfaces:**
- Consumes: `GfinTables`, `GfinSettingsApi`, `RateFactorApi`; `GFIN_QUERY_KEYS`; `RateFactorsTab`.
- Produces: `commissionOptions(factors): number[]`, `rateChips(factors, pct): { months; monthly }[]`, `formatSheetDate(iso): string`, `sheetVersionText(settings): string`, `settingsPatch(settings, form) → { ok: true; body } | { ok: false; message }`; components `<SheetVersionCard settings canEdit />`, `<CentralTermsCard tables canEdit />`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/GfinConfigPage/__tests__/centralTerms.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { GfinTables, RateFactorApi } from '@/pages/ProductDetailPage/utils/gfinQuote';

const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { patch: (...a: unknown[]) => apiPatch(...a), get: vi.fn(() => Promise.resolve({ data: [] })) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { commissionOptions, formatSheetDate, rateChips, settingsPatch, sheetVersionText } from '../terms/centralTerms';
import { CentralTermsCard } from '../terms/CentralTermsCard';
import { SheetVersionCard } from '../terms/SheetVersionCard';

const factor = (months: number, pct: number, f: string, isActive = true): RateFactorApi => ({
  id: `${months}-${pct}`, months, shopCommissionPct: pct, factor: f, feePerInstallment: '100', isActive,
});
const settings = {
  minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100,
  commissionPctByCategory: { PHONE: 15, TABLET: 5 }, sheetVersion: '6.5', sheetEffectiveDate: '2026-10-16',
};
const tables: GfinTables = {
  mappings: [], rules: [], settings,
  factors: [factor(12, 15, '0.1105'), factor(10, 15, '0.1286'), factor(12, 12, '0.1080'), factor(15, 10, '0.09', false)],
};
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('centralTerms helpers', () => {
  it('commissionOptions = % ที่มีตารางค่างวดเปิดอยู่ เรียงน้อย→มาก', () => {
    expect(commissionOptions(tables.factors)).toEqual([12, 15]);
  });
  it('rateChips = ceil(10,000 × factor) + ค่าธรรมเนียม เรียงตามงวด', () => {
    expect(rateChips(tables.factors, 15)).toEqual([
      { months: 10, monthly: 1386 },
      { months: 12, monthly: 1205 },
    ]);
  });
  it('sheetVersionText / formatSheetDate', () => {
    expect(formatSheetDate('2026-10-16')).toBe('16/10/2026');
    expect(sheetVersionText(settings)).toBe('ใบเงื่อนไข G Finn Version 6.5 · ใช้ตั้งแต่ 16/10/2026');
    expect(sheetVersionText({ ...settings, sheetVersion: null, sheetEffectiveDate: null })).toBe('ยังไม่ได้ระบุเวอร์ชันใบเงื่อนไข');
  });
  it('settingsPatch ส่งเฉพาะช่องที่เปลี่ยน · ไม่ส่งค่าคอม iPad เด็ดขาด', () => {
    expect(settingsPatch(settings, { minDownPct: '25', commissionPhone: '12', contractFee: '100' })).toEqual({
      ok: true, body: { commissionPhone: 12 },
    });
    expect(settingsPatch(settings, { minDownPct: '85', commissionPhone: '15', contractFee: '100' })).toEqual({
      ok: false, message: 'ดาวน์ขั้นต่ำต้องเป็นจำนวนเต็ม 0–80%',
    });
    expect(settingsPatch(settings, { minDownPct: '25', commissionPhone: '15', contractFee: '100' })).toEqual({
      ok: false, message: 'ยังไม่ได้เปลี่ยนอะไร',
    });
  });
});

describe('CentralTermsCard / SheetVersionCard', () => {
  beforeEach(() => apiPatch.mockReset().mockResolvedValue({ data: settings }));

  it('แสดงชิปค่างวดของคอมที่เลือก · แก้ดาวน์แล้วบันทึก = PATCH เฉพาะ minDownPct', async () => {
    render(<CentralTermsCard tables={tables} canEdit />, { wrapper: wrap });
    expect(screen.getByText('1,386')).toBeInTheDocument();
    const down = screen.getByLabelText('เงินดาวน์ขั้นต่ำ (%)');
    await userEvent.clear(down);
    await userEvent.type(down, '30');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกค่ากลาง' }));
    expect(apiPatch).toHaveBeenCalledWith('/gfin-config/settings', { minDownPct: 30 });
  });

  it('ไม่ใช่เจ้าของ = อ่านอย่างเดียว ไม่มีปุ่มบันทึก', () => {
    render(<CentralTermsCard tables={tables} canEdit={false} />, { wrapper: wrap });
    expect(screen.queryByRole('button', { name: 'บันทึกค่ากลาง' })).toBeNull();
  });

  it('การ์ดเวอร์ชัน: แสดงเวอร์ชัน · เปลี่ยนเวอร์ชันใหม่ส่ง sheetVersion + sheetEffectiveDate', async () => {
    render(<SheetVersionCard settings={settings} canEdit />, { wrapper: wrap });
    expect(screen.getByText('ใบเงื่อนไข G Finn Version 6.5 · ใช้ตั้งแต่ 16/10/2026')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นเวอร์ชันใหม่' }));
    const v = screen.getByLabelText('เวอร์ชัน');
    await userEvent.clear(v);
    await userEvent.type(v, '6.6');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกเวอร์ชัน' }));
    expect(apiPatch).toHaveBeenCalledWith('/gfin-config/settings', { sheetVersion: '6.6', sheetEffectiveDate: '2026-10-16' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/centralTerms.test.tsx`
Expected: FAIL — cannot resolve `../terms/centralTerms`.

- [ ] **Step 3: Implement helpers**

`apps/web/src/pages/GfinConfigPage/terms/centralTerms.ts`:

```ts
import Decimal from 'decimal.js';
import type { GfinSettingsApi, RateFactorApi } from '@/pages/ProductDetailPage/utils/gfinQuote';

/** % ค่าคอมที่เลือกได้ = % ที่มีตารางค่างวดเปิดอยู่ (สเปก §2 — ไม่งั้น GFIN คิดผ่อนไม่ได้ทุกเครื่อง) */
export function commissionOptions(factors: RateFactorApi[]): number[] {
  return [...new Set(factors.filter((f) => f.isActive).map((f) => f.shopCommissionPct))].sort((a, b) => a - b);
}

/** ชิปค่างวดของยอดจัด 10,000 บาท (ใบข้อ 4) — สูตรเดียวกับ GFIN: ceil(ยอดจัด × เรท) + ค่าธรรมเนียม */
export function rateChips(factors: RateFactorApi[], pct: number): { months: number; monthly: number }[] {
  return factors
    .filter((f) => f.isActive && f.shopCommissionPct === pct)
    .sort((a, b) => a.months - b.months)
    .map((f) => ({
      months: f.months,
      monthly: new Decimal(10000).mul(f.factor).ceil().add(f.feePerInstallment).toNumber(),
    }));
}

export function formatSheetDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function sheetVersionText(s: Pick<GfinSettingsApi, 'sheetVersion' | 'sheetEffectiveDate'>): string {
  if (!s.sheetVersion) return 'ยังไม่ได้ระบุเวอร์ชันใบเงื่อนไข';
  const date = s.sheetEffectiveDate ? ` · ใช้ตั้งแต่ ${formatSheetDate(s.sheetEffectiveDate)}` : '';
  return `ใบเงื่อนไข G Finn Version ${s.sheetVersion}${date}`;
}

export interface CentralForm {
  minDownPct: string;
  commissionPhone: string;
  contractFee: string;
}
export interface SettingsBody {
  minDownPct?: number;
  commissionPhone?: number;
  contractFee?: number;
}

/** ส่งเฉพาะช่องที่เปลี่ยน — ค่าคอม iPad ไม่อยู่ในฟอร์มนี้ (สเปก §1 ไม่อยู่ในรอบนี้) */
export function settingsPatch(
  s: GfinSettingsApi,
  form: CentralForm,
): { ok: true; body: SettingsBody } | { ok: false; message: string } {
  const down = Number(form.minDownPct);
  const commission = Number(form.commissionPhone);
  const fee = Number(form.contractFee);
  if (!(Number.isInteger(down) && down >= 0 && down <= 80))
    return { ok: false, message: 'ดาวน์ขั้นต่ำต้องเป็นจำนวนเต็ม 0–80%' };
  if (!Number.isFinite(fee) || fee < 0) return { ok: false, message: 'ค่าทำสัญญาต้องเป็น 0 บาทขึ้นไป' };
  const body: SettingsBody = {};
  if (down !== s.minDownPct) body.minDownPct = down;
  if (commission !== s.commissionPctByCategory.PHONE) body.commissionPhone = commission;
  if (fee !== s.contractFee) body.contractFee = fee;
  if (Object.keys(body).length === 0) return { ok: false, message: 'ยังไม่ได้เปลี่ยนอะไร' };
  return { ok: true, body };
}
```

- [ ] **Step 4: Implement the version card**

`apps/web/src/pages/GfinConfigPage/terms/SheetVersionCard.tsx`:

```tsx
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { GfinSettingsApi } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { GFIN_QUERY_KEYS } from '../gfinQueryKeys';
import { sheetVersionText } from './centralTerms';

export function SheetVersionCard({ settings, canEdit }: { settings: GfinSettingsApi; canEdit: boolean }) {
  const qc = useQueryClient();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [date, setDate] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.patch('/gfin-config/settings', { sheetVersion: version.trim(), sheetEffectiveDate: date }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: GFIN_QUERY_KEYS.settings });
      toast.success('บันทึกเวอร์ชันใบเงื่อนไขแล้ว');
      setOpen(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const openDialog = () => {
    setVersion(settings.sheetVersion ?? '');
    setDate(settings.sheetEffectiveDate ?? '');
    setOpen(true);
  };

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-medium leading-snug">{sheetVersionText(settings)}</p>
          <p className="text-sm text-muted-foreground leading-snug">
            ป้ายเลขข้อ (ใบข้อ 2, 3 …) ตรงกับใบของ GFIN · ไล่เทียบกับใบได้ทีละข้อ
          </p>
        </div>
      </div>
      {canEdit && (
        <Button variant="outline" onClick={openDialog}>
          เปลี่ยนเป็นเวอร์ชันใหม่
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !save.isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เวอร์ชันใบเงื่อนไข G Finn</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label htmlFor={`${id}-v`} className="text-sm font-medium leading-snug">
                เวอร์ชัน
              </label>
              <Input id={`${id}-v`} value={version} maxLength={20} onChange={(e) => setVersion(e.target.value)} placeholder="เช่น 6.5" />
            </div>
            <div>
              <label htmlFor={`${id}-d`} className="text-sm font-medium leading-snug">
                ใช้ตั้งแต่
              </label>
              <ThaiDateInput id={`${id}-d`} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
              ยกเลิก
            </Button>
            <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || !version.trim()}>
              บันทึกเวอร์ชัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
```

- [ ] **Step 5: Implement the central card**

`apps/web/src/pages/GfinConfigPage/terms/CentralTermsCard.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { RateFactorsTab } from '../RateFactorsTab';
import { GFIN_QUERY_KEYS } from '../gfinQueryKeys';
import { commissionOptions, rateChips, settingsPatch, type CentralForm } from './centralTerms';

const SheetTag = ({ no }: { no: number }) => (
  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">ใบข้อ {no}</span>
);

export function CentralTermsCard({ tables, canEdit }: { tables: GfinTables; canEdit: boolean }) {
  const qc = useQueryClient();
  const s = tables.settings;
  const [edits, setEdits] = useState<Partial<CentralForm>>({});
  const [ratesOpen, setRatesOpen] = useState(false);
  const form: CentralForm = {
    minDownPct: edits.minDownPct ?? String(s.minDownPct),
    commissionPhone: edits.commissionPhone ?? String(s.commissionPctByCategory.PHONE),
    contractFee: edits.contractFee ?? String(s.contractFee),
  };
  const options = commissionOptions(tables.factors);
  const currentCommission = Number(form.commissionPhone);
  const chips = rateChips(tables.factors, currentCommission);
  const fees = [...new Set(tables.factors.filter((f) => f.isActive && f.shopCommissionPct === currentCommission).map((f) => Number(f.feePerInstallment)))];

  const save = useMutation({
    mutationFn: (body: object) => api.patch('/gfin-config/settings', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: GFIN_QUERY_KEYS.settings });
      setEdits({});
      toast.success('บันทึกค่ากลางแล้ว');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const onSave = () => {
    const result = settingsPatch(s, form);
    if (!result.ok) return void toast.error(result.message);
    save.mutate(result.body);
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold leading-snug">ค่ากลาง</h2>
        <p className="text-sm text-muted-foreground leading-snug">ใช้กับทุกรุ่น เว้นแต่ตั้งเฉพาะรุ่นในตารางด้านล่าง</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="gfin-min-down" className="text-sm font-medium leading-snug">
            เงินดาวน์ขั้นต่ำ (%)
            <SheetTag no={2} />
          </label>
          <NumberInput
            id="gfin-min-down"
            min="0"
            max="80"
            step="1"
            value={form.minDownPct}
            disabled={!canEdit}
            onChange={(e) => setEdits((p) => ({ ...p, minDownPct: e.target.value }))}
          />
          <p className="mt-1 text-xs text-muted-foreground leading-snug">
            ลูกค้าเลือกเพิ่มได้ ขั้นละ {s.downStepPct}% ถึง {s.maxDownPct}%
          </p>
        </div>
        <div>
          <label htmlFor="gfin-commission" className="text-sm font-medium leading-snug">
            ค่าคอมมิชชั่น iPhone
            <SheetTag no={3} />
          </label>
          <Select
            value={form.commissionPhone}
            onValueChange={(v) => setEdits((p) => ({ ...p, commissionPhone: v }))}
            disabled={!canEdit}
          >
            <SelectTrigger id="gfin-commission">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o} value={String(o)}>
                  {o}% · มีตารางค่างวดแล้ว
                </SelectItem>
              ))}
              {!options.includes(currentCommission) && (
                <SelectItem value={String(currentCommission)} disabled>
                  {currentCommission}% — ยังไม่มีตารางค่างวด
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground leading-snug">
            เลือกได้เฉพาะ % ที่มีตารางค่างวด · ไม่งั้น GFIN คิดผ่อนไม่ได้ทุกเครื่อง
          </p>
        </div>
        <div>
          <label htmlFor="gfin-contract-fee" className="text-sm font-medium leading-snug">
            ค่าทำสัญญาต่อเคส (บาท)
          </label>
          <NumberInput
            id="gfin-contract-fee"
            min="0"
            step="0.01"
            value={form.contractFee}
            disabled={!canEdit}
            onChange={(e) => setEdits((p) => ({ ...p, contractFee: e.target.value }))}
          />
          <p className="mt-1 text-xs text-muted-foreground leading-snug">GFIN หักจากยอดโอนให้ร้าน</p>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium leading-snug">
          ค่างวด GFIN คอม {currentCommission}% · ยอดจัด 10,000 บาท ผ่อนเดือนละ
          <SheetTag no={4} />
        </p>
        {chips.length === 0 ? (
          <p className="text-sm text-warning-strong leading-snug">ยังไม่มีตารางค่างวดของคอม {currentCommission}%</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="ค่างวดต่อยอดจัด 10,000 บาท">
            {chips.map((c) => (
              <li key={c.months} className="rounded-md border border-border px-3 py-1.5 text-center">
                <span className="block text-xs text-muted-foreground">{c.months} งวด</span>
                <span className="font-medium tabular-nums">{c.monthly.toLocaleString('th-TH')}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground leading-snug">
          ตัวเลขบนสุดคือจำนวนงวด{fees.length === 1 ? ` · รวมค่าธรรมเนียม ${fees[0].toLocaleString('th-TH')} บาท/งวดแล้ว` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button variant="primary" onClick={onSave} disabled={save.isPending}>
            บันทึกค่ากลาง
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" onClick={() => setRatesOpen(true)}>
            แก้ตารางค่างวด
          </Button>
        )}
      </div>
      <Dialog open={ratesOpen} onOpenChange={setRatesOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>ตารางค่างวด GFIN</DialogTitle>
          </DialogHeader>
          <RateFactorsTab />
        </DialogContent>
      </Dialog>
    </section>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/centralTerms.test.tsx`
Expected: PASS (7 tests). `ThaiDateInput`'s visible text is Thai-formatted; the test only checks the PATCH body.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/terms/centralTerms.ts apps/web/src/pages/GfinConfigPage/terms/SheetVersionCard.tsx apps/web/src/pages/GfinConfigPage/terms/CentralTermsCard.tsx apps/web/src/pages/GfinConfigPage/__tests__/centralTerms.test.tsx
git commit -m "feat(gfin-web): การ์ดเวอร์ชันใบเงื่อนไข + ค่ากลาง (ดาวน์ · ค่าคอม · ค่าทำสัญญา · ค่างวด)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Price cell popover

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/terms/PriceCellPopover.tsx`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/PriceCellPopover.test.tsx`

**Interfaces:**
- Consumes: `ModelTermsRow`, `PriceCell`, `HAND_LABEL` (Task 1); `GFIN_QUERY_KEYS`.
- Produces: `<PriceCellPopover row cell canEdit />` — trigger shows price or "—".

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/GfinConfigPage/__tests__/PriceCellPopover.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiPatch = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { patch: (...a: unknown[]) => apiPatch(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PriceCellPopover } from '../terms/PriceCellPopover';
import type { ModelTermsRow } from '../terms/modelTerms';

const row: ModelTermsRow = {
  key: 'iPhone 17 Pro Max|HAND_1', series: 'iPhone 17 Pro Max', family: '17', condition: 'HAND_1',
  cells: [], rule: null, allowance: 2000, maxMonths: 15, downPct: 30, downSource: 'MODEL', hasActivePrice: true, needsRule: false,
};
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('PriceCellPopover', () => {
  beforeEach(() => {
    apiPatch.mockReset().mockResolvedValue({ data: {} });
    apiPost.mockReset().mockResolvedValue({ data: {} });
  });

  it('แก้ราคา: บรรทัดราคาส่ง = ราคา + OVER · บันทึก = PATCH maxPrice + isActive', async () => {
    render(<PriceCellPopover row={row} cell={{ storage: '1TB', mappingId: 'm1', price: 59900 }} canEdit />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: /iPhone 17 Pro Max 1TB มือ 1 ราคา 59,900/ }));
    expect(screen.getByText('ราคาส่ง GFIN = ราคานี้ + OVER 2,000 = 61,900')).toBeInTheDocument();
    const input = screen.getByLabelText('ราคาสูงสุดที่ GFIN รับ (บาท)');
    await userEvent.clear(input);
    await userEvent.type(input, '58900');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(apiPatch).toHaveBeenCalledWith('/gfin-config/max-prices/m1', { maxPrice: 58900, isActive: true });
  });

  it('GFIN ไม่รับแล้ว (ปิด) = PATCH isActive false', async () => {
    render(<PriceCellPopover row={row} cell={{ storage: '1TB', mappingId: 'm1', price: 59900 }} canEdit />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: /ราคา 59,900/ }));
    await userEvent.click(screen.getByRole('button', { name: 'GFIN ไม่รับแล้ว (ปิด)' }));
    expect(apiPatch).toHaveBeenCalledWith('/gfin-config/max-prices/m1', { isActive: false });
  });

  it('ช่อง "—" ที่ไม่เคยมีแถว = POST แถวใหม่', async () => {
    render(<PriceCellPopover row={row} cell={{ storage: '2TB', mappingId: null, price: null }} canEdit />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: /2TB มือ 1 ไม่มีราคา/ }));
    await userEvent.type(screen.getByLabelText('ราคาสูงสุดที่ GFIN รับ (บาท)'), '69900');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(apiPost).toHaveBeenCalledWith('/gfin-config/max-prices', {
      gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '2TB', condition: 'HAND_1',
      maxPrice: 69900, modelMatchPattern: 'iPhone 17 Pro Max', isActive: true,
    });
  });

  it('ไม่ใช่เจ้าของ = ข้อความเฉย ๆ ไม่มีปุ่ม', () => {
    render(<PriceCellPopover row={row} cell={{ storage: '1TB', mappingId: 'm1', price: 59900 }} canEdit={false} />, { wrapper: wrap });
    expect(screen.getByText('59,900')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/PriceCellPopover.test.tsx`
Expected: FAIL — cannot resolve `../terms/PriceCellPopover`.

- [ ] **Step 3: Implement**

`apps/web/src/pages/GfinConfigPage/terms/PriceCellPopover.tsx`:

```tsx
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GFIN_QUERY_KEYS } from '../gfinQueryKeys';
import { HAND_LABEL, type ModelTermsRow, type PriceCell } from './modelTerms';

const fmt = (n: number) => n.toLocaleString('th-TH');

/** กดช่องราคา → แก้ราคา / ปิด / เปิดคืน / ใส่ราคาช่องว่าง (สเปก §6.2 ข้อ 4) */
export function PriceCellPopover({ row, cell, canEdit }: { row: ModelTermsRow; cell: PriceCell; canEdit: boolean }) {
  const qc = useQueryClient();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const hand = HAND_LABEL[row.condition];
  const shown = cell.price === null ? '—' : fmt(cell.price);

  const save = useMutation({
    mutationFn: (body: { maxPrice?: number; isActive: boolean }) =>
      cell.mappingId
        ? api.patch(`/gfin-config/max-prices/${cell.mappingId}`, body)
        : api.post('/gfin-config/max-prices', {
            gfinSeries: row.series,
            gfinVariant: null,
            storage: cell.storage,
            condition: row.condition,
            maxPrice: body.maxPrice,
            modelMatchPattern: row.series,
            isActive: true,
          }),
    onSuccess: (_d, body) => {
      void qc.invalidateQueries({ queryKey: GFIN_QUERY_KEYS.prices });
      toast.success(
        body.isActive ? `บันทึกราคา ${row.series} ${cell.storage} ${hand} แล้ว` : `ปิดราคา ${row.series} ${cell.storage} ${hand} แล้ว`,
      );
      setOpen(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (!canEdit) return <span className="tabular-nums">{shown}</span>;

  const price = Number(value);
  const validPrice = value !== '' && Number.isFinite(price) && price > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(cell.price === null ? '' : String(cell.price));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded px-1 tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${row.series} ${cell.storage} ${hand} ${cell.price === null ? 'ไม่มีราคา' : `ราคา ${shown}`}`}
        >
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3">
        <p className="font-medium leading-snug">
          {row.series} · {cell.storage} · {hand}
        </p>
        <div>
          <label htmlFor={id} className="text-sm leading-snug">
            ราคาสูงสุดที่ GFIN รับ (บาท)
          </label>
          <NumberInput id={id} min="1" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <p className="text-sm text-muted-foreground leading-snug">
          {row.allowance === null
            ? 'ยังไม่ตั้งเงื่อนไข — ราคาส่งยังคิดไม่ได้'
            : validPrice
              ? `ราคาส่ง GFIN = ราคานี้ + OVER ${fmt(row.allowance)} = ${fmt(price + row.allowance)}`
              : `ราคาส่ง GFIN = ราคานี้ + OVER ${fmt(row.allowance)}`}
        </p>
        <div className="flex flex-wrap justify-between gap-2">
          {cell.price !== null ? (
            <Button variant="outline" size="sm" onClick={() => save.mutate({ isActive: false })} disabled={save.isPending}>
              GFIN ไม่รับแล้ว (ปิด)
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={save.isPending}>
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => save.mutate({ maxPrice: price, isActive: true })}
              disabled={save.isPending || !validPrice}
            >
              บันทึก
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          ปิดแล้วช่องนี้เป็น "—" · กดช่อง "—" เพื่อเปิดคืนหรือใส่ราคาใหม่ · ทุกการแก้เก็บประวัติ
        </p>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/PriceCellPopover.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/terms/PriceCellPopover.tsx apps/web/src/pages/GfinConfigPage/__tests__/PriceCellPopover.test.tsx
git commit -m "feat(gfin-web): กดช่องราคาเพื่อแก้ · ปิด · เปิดคืน · ใส่ราคาช่องว่าง

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rule edit dialog (1 row or many)

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/terms/RuleEditDialog.tsx`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/RuleEditDialog.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`ModelTermsRow`, `HAND_LABEL`), Task 2 (`RuleEdit`, `MONTH_CHOICES`, `summarizeCurrent`, `needsValues`, `validateEdit`, `toBulkUpsertBody`, `describeEdit`, `previewExample`); `GFIN_QUERY_KEYS`.
- Produces: `<RuleEditDialog rows tables onRemove(key) onClose() />`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/GfinConfigPage/__tests__/RuleEditDialog.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RuleEditDialog } from '../terms/RuleEditDialog';
import { buildModelTermsView } from '../terms/modelTerms';

const tables: GfinTables = {
  mappings: [
    { id: 'm1', gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '38900', modelMatchPattern: 'iPhone 17 Pro Max', isActive: true },
    { id: 'm2', gfinSeries: 'iPhone 12', gfinVariant: null, storage: '64GB', condition: 'HAND_2', maxPrice: '9000', modelMatchPattern: 'iPhone 12', isActive: true },
  ],
  rules: [{ id: 'r1', label: 'x', seriesPattern: 'iPhone 17 Pro Max', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true }],
  factors: [{ id: 'f15', months: 15, shopCommissionPct: 15, factor: '0.0921', feePerInstallment: '100', isActive: true }],
  settings: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } },
};
const view = buildModelTermsView(tables);
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('RuleEditDialog', () => {
  beforeEach(() => apiPost.mockReset().mockResolvedValue({ data: { created: 0, updated: 1 } }));

  it('ดาวน์ → ใช้ค่ากลาง: สรุป + ตัวอย่างก่อน→หลัง · บันทึก = bulk-upsert minDownPct null', async () => {
    const onClose = vi.fn();
    render(<RuleEditDialog rows={[view.rows[0]]} tables={tables} onRemove={vi.fn()} onClose={onClose} />, { wrapper: wrap });
    expect(screen.getByText('ตอนนี้ 30% (ตั้งเฉพาะรุ่น)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /ใช้ค่ากลาง · 25%/ }));
    expect(screen.getByText('ดาวน์ 30% (ตั้งเฉพาะรุ่น) → 25% (ค่ากลาง)')).toBeInTheDocument();
    expect(screen.getByText(/ดาวน์ลูกค้า 12,300 → 10,300/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก 1 รุ่น' }));
    expect(apiPost).toHaveBeenCalledWith('/gfin-config/overprice-rules/bulk-upsert', {
      items: [{ series: 'iPhone 17 Pro Max', condition: 'HAND_2' }],
      minDownPct: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('มีแถวที่ยังไม่ตั้ง: "ไม่เปลี่ยน" ของ OVER/ผ่อนสูงสุดกดไม่ได้ · ต้องกรอกก่อนบันทึก', async () => {
    const noRule = view.rows.find((r) => r.key === 'iPhone 12|HAND_2')!;
    render(<RuleEditDialog rows={[noRule]} tables={tables} onRemove={vi.fn()} onClose={vi.fn()} />, { wrapper: wrap });
    expect(screen.getAllByRole('radio', { name: 'ไม่เปลี่ยน' })[0]).toBeDisabled();
    const save = screen.getByRole('button', { name: 'บันทึก 1 รุ่น' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('OVER (บาท)'), '0');
    await userEvent.click(screen.getByRole('radio', { name: '12 งวด' }));
    await userEvent.click(save);
    expect(apiPost).toHaveBeenCalledWith('/gfin-config/overprice-rules/bulk-upsert', {
      items: [{ series: 'iPhone 12', condition: 'HAND_2' }],
      allowance: 0,
      maxMonths: 12,
    });
  });

  it('ชิปรุ่นกดเอาออกได้', async () => {
    const onRemove = vi.fn();
    render(<RuleEditDialog rows={view.rows} tables={tables} onRemove={onRemove} onClose={vi.fn()} />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: 'เอา iPhone 12 มือ 2 ออก' }));
    expect(onRemove).toHaveBeenCalledWith('iPhone 12|HAND_2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/RuleEditDialog.test.tsx`
Expected: FAIL — cannot resolve `../terms/RuleEditDialog`.

- [ ] **Step 3: Implement**

`apps/web/src/pages/GfinConfigPage/terms/RuleEditDialog.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { GFIN_QUERY_KEYS } from '../gfinQueryKeys';
import { HAND_LABEL, type ModelTermsRow } from './modelTerms';
import {
  MONTH_CHOICES,
  describeEdit,
  needsValues,
  previewExample,
  summarizeCurrent,
  toBulkUpsertBody,
  validateEdit,
  type RuleEdit,
} from './ruleChange';

const fmt = (n: number) => n.toLocaleString('th-TH');

interface Props {
  rows: ModelTermsRow[];
  tables: GfinTables;
  onRemove: (key: string) => void;
  onClose: () => void;
}

/** กล่องแก้เงื่อนไข 1 แถวหรือหลายแถว (สเปก §6.2 ข้อ 5) — บันทึกทั้งชุดในคำขอเดียว */
export function RuleEditDialog({ rows, tables, onRemove, onClose }: Props) {
  const qc = useQueryClient();
  const required = needsValues(rows);
  const [allowanceMode, setAllowanceMode] = useState<'keep' | 'set'>(required ? 'set' : 'keep');
  const [allowanceValue, setAllowanceValue] = useState('');
  const [months, setMonths] = useState<string>('keep');
  const [downMode, setDownMode] = useState<'keep' | 'default' | 'set'>('keep');
  const [downValue, setDownValue] = useState('');

  const edit: RuleEdit = {
    allowance:
      allowanceMode === 'set' && allowanceValue !== ''
        ? { mode: 'set', value: Number(allowanceValue) }
        : { mode: 'keep' },
    maxMonths: months === 'keep' ? { mode: 'keep' } : { mode: 'set', value: Number(months) },
    down:
      downMode === 'default'
        ? { mode: 'default' }
        : downMode === 'set' && downValue !== ''
          ? { mode: 'set', value: Number(downValue) }
          : { mode: 'keep' },
  };
  const error = validateEdit(rows, edit);
  const now = summarizeCurrent(rows);
  const lines = error ? [] : describeEdit(rows, edit, tables.settings.minDownPct);
  const example = error ? null : previewExample(tables, rows, edit);
  const hands = [...new Set(rows.map((r) => HAND_LABEL[r.condition]))].join(' และ ');

  const save = useMutation({
    mutationFn: () => api.post('/gfin-config/overprice-rules/bulk-upsert', toBulkUpsertBody(rows, edit)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: GFIN_QUERY_KEYS.rules });
      toast.success(`บันทึกเงื่อนไข ${rows.length} รุ่นแล้ว`);
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            แก้เงื่อนไข{rows.length > 1 ? 'พร้อมกัน' : ''} · {rows.length} รุ่น · {hands}
          </DialogTitle>
          <DialogDescription className="leading-snug">
            ช่องที่เลือก "ไม่เปลี่ยน" แต่ละรุ่นคงค่าเดิมของตัวเอง
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium leading-snug">รุ่นที่จะแก้</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-sm">
                  {r.series} <span className="text-muted-foreground">{HAND_LABEL[r.condition]}</span>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="rounded-full p-0.5 hover:bg-accent"
                      aria-label={`เอา ${r.series} ${HAND_LABEL[r.condition]} ออก`}
                      onClick={() => onRemove(r.key)}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium leading-snug">OVER (บวกเพิ่มจากราคาใบ) · ข้อ 7</legend>
            <p className="text-xs text-muted-foreground leading-snug">{now.allowance}</p>
            <RadioGroup value={allowanceMode} onValueChange={(v) => setAllowanceMode(v as 'keep' | 'set')}>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="keep" disabled={required} /> ไม่เปลี่ยน
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="set" /> ตั้งเป็น
                <NumberInput
                  aria-label="OVER (บาท)"
                  className="w-32"
                  min="0"
                  step="0.01"
                  value={allowanceValue}
                  onFocus={() => setAllowanceMode('set')}
                  onChange={(e) => setAllowanceValue(e.target.value)}
                />
                บาท
              </label>
            </RadioGroup>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium leading-snug">ผ่อนสูงสุด · ข้อ 4</legend>
            <p className="text-xs text-muted-foreground leading-snug">{now.maxMonths}</p>
            <RadioGroup value={months} onValueChange={setMonths} className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="keep" disabled={required} /> ไม่เปลี่ยน
              </label>
              {MONTH_CHOICES.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={String(m)} /> {m} งวด
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium leading-snug">เงินดาวน์ขั้นต่ำ · ข้อ 2</legend>
            <p className="text-xs text-muted-foreground leading-snug">{now.down}</p>
            <RadioGroup value={downMode} onValueChange={(v) => setDownMode(v as 'keep' | 'default' | 'set')}>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="keep" /> ไม่เปลี่ยน
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="default" /> ใช้ค่ากลาง · {tables.settings.minDownPct}%
                <span className="text-xs text-muted-foreground">ถ้าวันหลังเปลี่ยนค่ากลาง รุ่นพวกนี้เปลี่ยนตาม</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="set" /> กำหนดเฉพาะรุ่นพวกนี้
                <NumberInput
                  aria-label="ดาวน์เฉพาะรุ่น (%)"
                  className="w-24"
                  min="0"
                  max="80"
                  step="1"
                  value={downValue}
                  onFocus={() => setDownMode('set')}
                  onChange={(e) => setDownValue(e.target.value)}
                />
                %
              </label>
            </RadioGroup>
          </fieldset>

          {lines.length > 0 && (
            <div className="rounded-lg border border-border bg-muted p-3 text-sm leading-snug">
              <p className="font-medium">จะเปลี่ยน:</p>
              <ul className="list-disc pl-5">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {example?.before && example.after && (
                <p className="mt-2 text-muted-foreground">
                  ตัวอย่าง {example.label} ขาย {fmt(example.after.salePrice)} · ดาวน์ลูกค้า {fmt(example.before.down)} →{' '}
                  {fmt(example.after.down)} · ผ่อน {fmt(example.before.monthly)} → {fmt(example.after.monthly)} ×{' '}
                  {example.after.months}
                </p>
              )}
            </div>
          )}
          {error && error !== 'ยังไม่ได้เปลี่ยนอะไร' && (
            <p className="text-sm text-warning-strong leading-snug">{error}</p>
          )}
          <p className="text-xs text-muted-foreground leading-snug">
            บันทึกทั้ง {rows.length} แถวพร้อมกัน — พลาดแถวเดียวไม่บันทึกเลย · แก้แถวเดิมของรุ่นนั้น ไม่สร้างซ้ำ · เก็บประวัติ
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            ยกเลิก
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || error !== null}>
            บันทึก {rows.length} รุ่น
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/RuleEditDialog.test.tsx`
Expected: PASS (3 tests). If clicking the radio's wrapping `<label>` text does not move Radix focus in jsdom, keep `getByRole('radio', …)` clicks as written (they target the button directly).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/terms/RuleEditDialog.tsx apps/web/src/pages/GfinConfigPage/__tests__/RuleEditDialog.test.tsx
git commit -m "feat(gfin-web): กล่องแก้เงื่อนไข 1 แถวหรือหลายแถว + ตัวอย่างก่อน/หลัง

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Desktop table + mobile cards

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/terms/ModelTermsTable.tsx`
- Create: `apps/web/src/pages/GfinConfigPage/terms/ModelTermsCards.tsx`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/ModelTermsTable.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`ModelTermsFamily`, `ModelTermsRow`, `Hand`, `HANDS`, `HAND_LABEL`, `allowanceText`, `monthsText`, `downText`), Task 5 (`PriceCellPopover`).
- Produces (both components share these props):

```ts
export interface TermsListProps {
  families: ModelTermsFamily[];
  storageColumns: string[];
  selected: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  canEdit: boolean;
  onToggleRow: (key: string) => void;
  onSelectFamilyHand: (family: ModelTermsFamily, hand: Hand) => void;
  onToggleFamily: (family: string) => void;
  onEdit: (keys: string[]) => void;
}
```

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/GfinConfigPage/__tests__/ModelTermsTable.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';

vi.mock('@/lib/api', () => ({ __esModule: true, default: {}, getErrorMessage: String }));

import { ModelTermsTable } from '../terms/ModelTermsTable';
import { ModelTermsCards } from '../terms/ModelTermsCards';
import { buildModelTermsView } from '../terms/modelTerms';

const tables: GfinTables = {
  mappings: [
    { id: 'a', gfinSeries: 'iPhone 17', gfinVariant: null, storage: '256GB', condition: 'HAND_1', maxPrice: '30000', modelMatchPattern: 'iPhone 17', isActive: true },
    { id: 'b', gfinSeries: 'iPhone 17', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '25000', modelMatchPattern: 'iPhone 17', isActive: true },
    { id: 'c', gfinSeries: 'iPhone 12', gfinVariant: null, storage: '64GB', condition: 'HAND_2', maxPrice: '9000', modelMatchPattern: 'iPhone 12', isActive: true },
  ],
  rules: [
    { id: 'r1', label: 'x', seriesPattern: 'iPhone 17', condition: 'HAND_1', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true },
    { id: 'r2', label: 'y', seriesPattern: 'iPhone 17', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: null, isActive: true },
  ],
  factors: [],
  settings: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } },
};
const view = buildModelTermsView(tables);
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
const props = () => ({
  families: view.families,
  storageColumns: view.storageColumns,
  selected: new Set<string>(['iPhone 17|HAND_2']),
  collapsed: new Set<string>(),
  canEdit: true,
  onToggleRow: vi.fn(),
  onSelectFamilyHand: vi.fn(),
  onToggleFamily: vi.fn(),
  onEdit: vi.fn(),
});

describe('ModelTermsTable', () => {
  it('หัวคอลัมน์ความจุ + ดาวน์ตั้งเฉพาะรุ่นตัวหนา / ค่ากลางสีเทา + ช่องส้มของแถวที่ยังไม่ตั้ง', async () => {
    const p = props();
    render(<ModelTermsTable {...p} />, { wrapper: wrap });
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: '64GB' })).toBeInTheDocument();
    expect(within(table).getByText('30%')).toHaveClass('font-semibold');
    expect(within(table).getByText('25%')).toHaveClass('text-muted-foreground');
    expect(within(table).getByText('ยังไม่ตั้งเงื่อนไข · ยังคิดผ่อนไม่ได้')).toBeInTheDocument();
    await userEvent.click(within(table).getByRole('button', { name: 'ตั้งเงื่อนไข iPhone 12 มือ 2' }));
    expect(p.onEdit).toHaveBeenCalledWith(['iPhone 12|HAND_2']);
  });

  it('เลือกแถว · เลือกมือ 2 ทั้งตระกูล · พับตระกูล', async () => {
    const p = props();
    render(<ModelTermsTable {...p} />, { wrapper: wrap });
    expect(screen.getByRole('checkbox', { name: 'เลือก iPhone 17 มือ 2' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'เลือก iPhone 17 มือ 1' }));
    expect(p.onToggleRow).toHaveBeenCalledWith('iPhone 17|HAND_1');
    await userEvent.click(screen.getByRole('button', { name: 'เลือกมือ 2 ทั้งตระกูล iPhone 17' }));
    expect(p.onSelectFamilyHand).toHaveBeenCalledWith(view.families[1], 'HAND_2');
    await userEvent.click(screen.getByRole('button', { name: 'พับ iPhone 17' }));
    expect(p.onToggleFamily).toHaveBeenCalledWith('17');
  });
});

describe('ModelTermsCards', () => {
  it('การ์ดทีละรุ่น บล็อกมือ 1/มือ 2 + ปุ่มแก้', async () => {
    const p = props();
    render(<ModelTermsCards {...p} />, { wrapper: wrap });
    const card = screen.getByRole('article', { name: 'iPhone 17' });
    expect(within(card).getByText('มือ 1')).toBeInTheDocument();
    expect(within(card).getByText('OVER +2,000 · ผ่อน 15 งวด · ดาวน์')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'แก้ iPhone 17 มือ 1' }));
    expect(p.onEdit).toHaveBeenCalledWith(['iPhone 17|HAND_1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/ModelTermsTable.test.tsx`
Expected: FAIL — cannot resolve `../terms/ModelTermsTable`.

- [ ] **Step 3: Implement the table**

`apps/web/src/pages/GfinConfigPage/terms/ModelTermsTable.tsx`:

```tsx
import { ChevronDown, ChevronRight, Pencil, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PriceCellPopover } from './PriceCellPopover';
import {
  HANDS,
  HAND_LABEL,
  allowanceText,
  downText,
  monthsText,
  type Hand,
  type ModelTermsFamily,
  type ModelTermsRow,
} from './modelTerms';

export interface TermsListProps {
  families: ModelTermsFamily[];
  storageColumns: string[];
  selected: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  canEdit: boolean;
  onToggleRow: (key: string) => void;
  onSelectFamilyHand: (family: ModelTermsFamily, hand: Hand) => void;
  onToggleFamily: (family: string) => void;
  onEdit: (keys: string[]) => void;
}

const Tag = ({ children }: { children: string }) => (
  <span className="ml-1 rounded bg-muted px-1 text-[0.7rem] font-normal text-muted-foreground">{children}</span>
);

export function TermsCells({ row, canEdit, onEdit }: { row: ModelTermsRow; canEdit: boolean; onEdit: (keys: string[]) => void }) {
  if (row.rule === null) {
    return row.needsRule ? (
      <td colSpan={3} className="bg-warning/10 px-3 py-2 text-sm text-warning-strong">
        <span className="inline-flex items-center gap-1.5 leading-snug">
          <TriangleAlert className="size-4" aria-hidden="true" />
          ยังไม่ตั้งเงื่อนไข · ยังคิดผ่อนไม่ได้
        </span>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            aria-label={`ตั้งเงื่อนไข ${row.series} ${HAND_LABEL[row.condition]}`}
            onClick={() => onEdit([row.key])}
          >
            ตั้งเงื่อนไข
          </Button>
        )}
      </td>
    ) : (
      <td colSpan={3} className="px-3 py-2 text-sm text-muted-foreground leading-snug">
        ยังไม่ตั้งเงื่อนไข
      </td>
    );
  }
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{allowanceText(row)}</td>
      <td className="px-3 py-2 text-right">{monthsText(row)}</td>
      <td className="px-3 py-2 text-right">
        <span className={row.downSource === 'MODEL' ? 'font-semibold' : 'text-muted-foreground'}>{downText(row)}</span>
      </td>
    </>
  );
}

export function ModelTermsTable(p: TermsListProps) {
  const colCount = 3 + p.storageColumns.length + 3 + 1;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
            <th rowSpan={2} className="px-3 py-2 font-medium">
              <span className="sr-only">เลือก</span>
            </th>
            <th rowSpan={2} className="px-3 py-2 font-medium">รุ่น</th>
            <th rowSpan={2} className="px-3 py-2 font-medium">สภาพ</th>
            <th colSpan={p.storageColumns.length} className="px-3 py-1 text-center font-medium">
              ราคาสูงสุดที่ GFIN รับ (บาท)
            </th>
            <th colSpan={3} className="px-3 py-1 text-center font-medium">เงื่อนไข</th>
            <th rowSpan={2} className="px-3 py-2 font-medium">
              <span className="sr-only">แก้ไข</span>
            </th>
          </tr>
          <tr>
            {p.storageColumns.map((s) => (
              <th key={s} className="px-3 py-1 text-right font-medium">{s}</th>
            ))}
            <th className="px-3 py-1 text-right font-medium">OVER<Tag>ข้อ 7</Tag></th>
            <th className="px-3 py-1 text-right font-medium">ผ่อนสูงสุด<Tag>ข้อ 4</Tag></th>
            <th className="px-3 py-1 text-right font-medium">ดาวน์<Tag>ข้อ 2</Tag></th>
          </tr>
        </thead>
        {p.families.map((fam) => {
          const isCollapsed = p.collapsed.has(fam.family);
          const hands = HANDS.filter((h) => fam.rows.some((r) => r.condition === h));
          return (
            <tbody key={fam.family} className="border-t border-border">
              <tr className="bg-card">
                <td colSpan={colCount} className="px-3 py-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-semibold hover:underline"
                      aria-label={`${isCollapsed ? 'เปิด' : 'พับ'} ${fam.label}`}
                      aria-expanded={!isCollapsed}
                      onClick={() => p.onToggleFamily(fam.family)}
                    >
                      {isCollapsed ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
                      {fam.label}
                    </button>
                    {p.canEdit &&
                      hands.map((h) => (
                        <Button
                          key={h}
                          variant="ghost"
                          size="sm"
                          aria-label={`เลือก${HAND_LABEL[h]} ทั้งตระกูล ${fam.label}`}
                          onClick={() => p.onSelectFamilyHand(fam, h)}
                        >
                          {`เลือก${HAND_LABEL[h]} ทั้งตระกูล`}
                        </Button>
                      ))}
                  </div>
                </td>
              </tr>
              {!isCollapsed &&
                fam.rows.map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <td className="px-3 py-2">
                      {p.canEdit && (
                        <Checkbox
                          aria-label={`เลือก ${row.series} ${HAND_LABEL[row.condition]}`}
                          checked={p.selected.has(row.key)}
                          onCheckedChange={() => p.onToggleRow(row.key)}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium leading-snug">{row.series}</td>
                    <td className="px-3 py-2">{HAND_LABEL[row.condition]}</td>
                    {row.cells.map((cell) => (
                      <td key={cell.storage} className="px-3 py-2 text-right">
                        <PriceCellPopover row={row} cell={cell} canEdit={p.canEdit} />
                      </td>
                    ))}
                    <TermsCells row={row} canEdit={p.canEdit} onEdit={p.onEdit} />
                    <td className="px-3 py-2">
                      {p.canEdit && row.rule !== null && (
                        <Button
                          variant="ghost"
                          size="sm"
                          mode="icon"
                          aria-label={`แก้ไข ${row.series} ${HAND_LABEL[row.condition]}`}
                          onClick={() => p.onEdit([row.key])}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
```


- [ ] **Step 4: Implement the mobile cards**

`apps/web/src/pages/GfinConfigPage/terms/ModelTermsCards.tsx`:

```tsx
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PriceCellPopover } from './PriceCellPopover';
import { HAND_LABEL, allowanceText, downText, monthsText, type ModelTermsRow } from './modelTerms';
import type { TermsListProps } from './ModelTermsTable';

function bySeries(rows: ModelTermsRow[]): ModelTermsRow[][] {
  const out: ModelTermsRow[][] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last[0].series === r.series) last.push(r);
    else out.push([r]);
  }
  return out;
}

/** มือถือ (< 768px): การ์ดทีละรุ่น · บล็อกมือ 1/มือ 2 (สเปก §6.2 ข้อ 6) */
export function ModelTermsCards(p: TermsListProps) {
  return (
    <div className="space-y-4">
      {p.families.map((fam) => (
        <section key={fam.family} aria-label={fam.label} className="space-y-2">
          <h3 className="font-semibold leading-snug">{fam.label}</h3>
          {bySeries(fam.rows).map((rows) => (
            <article key={rows[0].series} aria-label={rows[0].series} className="space-y-2 rounded-lg border border-border bg-card p-3">
              <h4 className="font-medium leading-snug">{rows[0].series}</h4>
              {rows.map((row) => (
                <div key={row.key} className="space-y-1.5 border-t border-border pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      {p.canEdit && (
                        <Checkbox
                          aria-label={`เลือก ${row.series} ${HAND_LABEL[row.condition]}`}
                          checked={p.selected.has(row.key)}
                          onCheckedChange={() => p.onToggleRow(row.key)}
                        />
                      )}
                      {HAND_LABEL[row.condition]}
                    </label>
                    {p.canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`แก้ ${row.series} ${HAND_LABEL[row.condition]}`}
                        onClick={() => p.onEdit([row.key])}
                      >
                        แก้
                      </Button>
                    )}
                  </div>
                  <ul className="flex flex-wrap gap-1.5 text-sm">
                    {row.cells
                      .filter((c) => c.mappingId !== null)
                      .map((c) => (
                        <li key={c.storage} className="rounded border border-border px-2 py-0.5">
                          <span className="text-muted-foreground">{c.storage} </span>
                          <PriceCellPopover row={row} cell={c} canEdit={p.canEdit} />
                        </li>
                      ))}
                  </ul>
                  {row.rule === null ? (
                    <p className={`flex items-center gap-1.5 text-sm leading-snug ${row.needsRule ? 'text-warning-strong' : 'text-muted-foreground'}`}>
                      {row.needsRule && <TriangleAlert className="size-4" aria-hidden="true" />}
                      {row.needsRule ? 'ยังไม่ตั้งเงื่อนไข · ยังคิดผ่อนไม่ได้' : 'ยังไม่ตั้งเงื่อนไข'}
                    </p>
                  ) : (
                    <p className="text-sm leading-snug">
                      <span>{`OVER ${allowanceText(row)} · ผ่อน ${monthsText(row)} · ดาวน์`}</span>{' '}
                      <span className={row.downSource === 'MODEL' ? 'font-semibold' : 'text-muted-foreground'}>{downText(row)}</span>
                    </p>
                  )}
                </div>
              ))}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/ModelTermsTable.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/terms/ModelTermsTable.tsx apps/web/src/pages/GfinConfigPage/terms/ModelTermsCards.tsx apps/web/src/pages/GfinConfigPage/__tests__/ModelTermsTable.test.tsx
git commit -m "feat(gfin-web): ตารางราคาและเงื่อนไขรายรุ่น (จอใหญ่) + การ์ดรายรุ่น (มือถือ)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Import review dialog + template

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/import/gfinTemplate.ts`
- Create: `apps/web/src/pages/GfinConfigPage/import/GfinImportDialog.tsx`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/GfinImportDialog.test.tsx`

**Interfaces:**
- Consumes: Task 3 (everything in `gfinImportTerms.ts`), `GfinImportReview` (gfinPriceListImport.ts), `MONTH_CHOICES` (Task 2), `HAND_LABEL`.
- Produces: `downloadGfinTemplate(): Promise<void>`; `<GfinImportDialog fileName prices missing terms pending progress onCancel onConfirm({ closeIds, changes }) />`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/GfinConfigPage/__tests__/GfinImportDialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GfinImportDialog } from '../import/GfinImportDialog';
import { buildImportTermsReview, findMissingPrices } from '../import/gfinImportTerms';
import { buildGfinImportReview, type ExistingMaxPrice } from '../gfinPriceListImport';

const ex = (id: string, series: string, storage: string, price: number): ExistingMaxPrice => ({
  id, gfinSeries: series, gfinVariant: null, storage, condition: 'HAND_2', maxPrice: String(price), modelMatchPattern: series, isActive: true,
});
const existing = [ex('p1', 'iPhone 14 Pro', '128GB', 20000), ex('p2', 'iPhone 14 Pro', '1TB', 28000), ex('o1', 'iPhone 12', '64GB', 9000)];
const rows = [
  { 'รุ่น': 'iPhone 14 Pro', 'ความจุ': '128GB', 'มือ 1/มือ 2': 'มือ 2', 'ราคา': 20000 },
  { 'รุ่น': 'iPhone 18 Pro', 'ความจุ': '256GB', 'มือ 1/มือ 2': 'มือ 2', 'ราคา': 45000 },
];
const rules = [{ id: 'r', label: 'x', seriesPattern: 'iPhone 14 Pro', condition: 'HAND_2' as const, allowance: '2000', maxMonths: 15, minDownPct: null, isActive: true }];

function setup(onConfirm = vi.fn()) {
  render(
    <GfinImportDialog
      fileName="ใบราคา.xlsx"
      prices={buildGfinImportReview(rows, existing)}
      missing={findMissingPrices(rows, existing)}
      terms={buildImportTermsReview(rows, existing, rules)}
      pending={false}
      progress={null}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe('GfinImportDialog', () => {
  it('ค่าตั้งต้น: ปิดราคาที่ขาดของรุ่นในไฟล์ · เปิดรุ่นที่ไม่มีในไฟล์ไว้', () => {
    setup();
    expect(screen.getByRole('radio', { name: /ปิดราคาพวกนี้ \(รุ่นที่มีในไฟล์/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /เปิดไว้เหมือนเดิม \(รุ่นที่ไม่มีในไฟล์/ })).toBeChecked();
    expect(screen.getByText('iPhone 12 · มือ 2 · 64GB 9,000')).toBeInTheDocument();
  });

  it('รุ่นใหม่ที่ไม่มี OVER/ผ่อนสูงสุด ต้องกรอกก่อน ยืนยันจึงกดได้', async () => {
    const onConfirm = setup();
    const confirm = screen.getByRole('button', { name: 'ยืนยันนำเข้า' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('OVER ของ iPhone 18 Pro มือ 2 (บาท)'), '2000');
    await userEvent.click(screen.getByRole('radio', { name: 'iPhone 18 Pro มือ 2 ผ่อนสูงสุด 15 งวด' }));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      closeIds: ['p2'],
      changes: [{ series: 'iPhone 18 Pro', condition: 'HAND_2', allowance: 2000, maxMonths: 15 }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/GfinImportDialog.test.tsx`
Expected: FAIL — cannot resolve `../import/GfinImportDialog`.

- [ ] **Step 3: Implement the template download**

`apps/web/src/pages/GfinConfigPage/import/gfinTemplate.ts`:

```ts
import { downloadExcelBuffer } from '@/utils/excel.util';
import { GFIN_IMPORT_HEADERS } from '../gfinPriceListImport';
import { GFIN_IMPORT_TERM_HEADERS } from './gfinImportTerms';

/** แบบฟอร์มใบราคา: รุ่น · ความจุ · มือ · ราคา + OVER · ผ่อนสูงสุด (ไม่บังคับ — สเปก §6.2 ข้อ 3) */
export async function downloadGfinTemplate(): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ใบราคา GFIN');
  const headers = [...GFIN_IMPORT_HEADERS, ...GFIN_IMPORT_TERM_HEADERS];
  ws.columns = headers.map((header) => ({ header, key: header, width: header === 'รุ่น' ? 22 : 14 }));
  ws.addRows([
    { 'รุ่น': 'iPhone 17 Pro Max', 'ความจุ': '256GB', 'มือ 1/มือ 2': 'มือ 1', 'ราคา': 44900, OVER: 2000, 'ผ่อนสูงสุด': 15 },
    { 'รุ่น': 'iPhone 13', 'ความจุ': '128GB', 'มือ 1/มือ 2': 'มือ 2', 'ราคา': 12900, OVER: 1000, 'ผ่อนสูงสุด': 12 },
  ]);
  downloadExcelBuffer(await wb.xlsx.writeBuffer(), 'แบบฟอร์มใบราคา-GFIN.xlsx');
}
```

- [ ] **Step 4: Implement the dialog**

`apps/web/src/pages/GfinConfigPage/import/GfinImportDialog.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { GfinImportReview } from '../gfinPriceListImport';
import { HAND_LABEL } from '../terms/modelTerms';
import { MONTH_CHOICES } from '../terms/ruleChange';
import {
  closeIdsFor,
  missingLines,
  resolveTermsPlan,
  ruleChangeText,
  type ImportTermsReview,
  type MissingPrices,
  type RuleChange,
  type TermChoices,
  type TermField,
  type TermsPair,
} from './gfinImportTerms';

const fmt = (n: number) => n.toLocaleString('th-TH');

interface Props {
  fileName: string;
  prices: GfinImportReview;
  missing: MissingPrices;
  terms: ImportTermsReview;
  pending: boolean;
  progress: string | null;
  onCancel: () => void;
  onConfirm: (decision: { closeIds: string[]; changes: RuleChange[] }) => void;
}

function MissingGroup(props: {
  title: string;
  lines: string[];
  close: boolean;
  onChange: (close: boolean) => void;
  groupName: string;
}) {
  if (props.lines.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <p className="text-sm font-medium leading-snug">{props.title}</p>
      <ul className="text-sm text-muted-foreground leading-snug">
        {props.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <RadioGroup value={props.close ? 'close' : 'keep'} onValueChange={(v) => props.onChange(v === 'close')} className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="close" aria-label={`ปิดราคาพวกนี้ (${props.groupName})`} /> ปิดราคาพวกนี้ (GFIN ไม่รับแล้ว)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="keep" aria-label={`เปิดไว้เหมือนเดิม (${props.groupName})`} /> เปิดไว้เหมือนเดิม
        </label>
      </RadioGroup>
    </div>
  );
}

function ChooseField(props: {
  pair: TermsPair;
  field: 'allowance' | 'maxMonths';
  value: TermField;
  choice: number | undefined;
  onChoose: (v: number) => void;
}) {
  if (props.value.kind !== 'choose') return null;
  const label = props.field === 'allowance' ? 'OVER' : 'ผ่อนสูงสุด';
  const show = (v: number) => (props.field === 'allowance' ? `+${fmt(v)}` : `${v} งวด`);
  return (
    <div className="space-y-1">
      <p className="text-sm leading-snug">
        {props.pair.series} · {HAND_LABEL[props.pair.condition]} — {label} ไม่เท่ากันทุกความจุ
      </p>
      <RadioGroup
        value={String(props.choice ?? props.value.options[0].value)}
        onValueChange={(v) => props.onChoose(Number(v))}
      >
        {props.value.options.map((o, i) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={String(o.value)} /> ใช้ {show(o.value)}
            {i === 0 ? ' (ค่าที่ใช้มากสุด)' : ''} — {o.storages.join(' / ')}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

/** หน้าตรวจใบราคาก่อนนำเข้า (สเปก §6.3) */
export function GfinImportDialog(p: Props) {
  const [closePartial, setClosePartial] = useState(true);
  const [closeAbsent, setCloseAbsent] = useState(false);
  const [choices, setChoices] = useState<TermChoices>({});
  const plan = useMemo(() => resolveTermsPlan(p.terms, choices), [p.terms, choices]);
  const closeIds = closeIdsFor(p.missing, { closePartial, closeAbsent });
  const set = (key: string, field: 'allowance' | 'maxMonths', v: number | undefined) =>
    setChoices((c) => ({ ...c, [key]: { ...c[key], [field]: v } }));

  const count = (action: 'ADD' | 'UPDATE') => p.prices.rows.filter((r) => r.action === action).length;
  const same = p.prices.rows.filter((r) => r.action === 'SKIP' && r.detail === 'ราคาเท่าเดิม').length;
  const skipped = p.prices.rows.filter((r) => r.action === 'SKIP' && r.detail !== 'ราคาเท่าเดิม');
  const pairs = p.terms.pairs;
  const byStatus = (s: TermsPair['status']) => pairs.filter((x) => x.status === s);
  const pairOf = (c: RuleChange) => pairs.find((x) => x.series === c.series && x.condition === c.condition)!;
  const nothing = p.prices.toSend.length === 0 && closeIds.length === 0 && plan.changes.length === 0;
  const canConfirm = !p.pending && plan.missing.length === 0 && !nothing;

  return (
    <Dialog open onOpenChange={(o) => !o && !p.pending && p.onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>ตรวจใบราคาก่อนนำเข้า</DialogTitle>
          <DialogDescription className="leading-snug">{p.fileName}</DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="font-medium leading-snug">ราคา</h3>
          <p className="text-sm leading-snug">
            เพิ่มใหม่ {count('ADD')} · ราคาเปลี่ยน {count('UPDATE')} · เท่าเดิม {same} · มีในระบบ ไม่มีในไฟล์{' '}
            {p.missing.partial.length + p.missing.absent.length}
          </p>
          {skipped.length > 0 && (
            <ul className="text-sm text-warning-strong leading-snug">
              {skipped.map((r) => (
                <li key={r.rowNumber} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  แถว {r.rowNumber} {r.label}: {r.detail}
                </li>
              ))}
            </ul>
          )}
          <MissingGroup
            title="รุ่นที่มีในไฟล์ แต่ขาดบางความจุ/มือ"
            groupName="รุ่นที่มีในไฟล์"
            lines={missingLines(p.missing.partial)}
            close={closePartial}
            onChange={setClosePartial}
          />
          <MissingGroup
            title="รุ่นที่ไม่มีในไฟล์เลย"
            groupName="รุ่นที่ไม่มีในไฟล์"
            lines={missingLines(p.missing.absent)}
            close={closeAbsent}
            onChange={setCloseAbsent}
          />
          {(p.missing.partial.length > 0 || p.missing.absent.length > 0) && (
            <p className="text-xs text-muted-foreground leading-snug">ปิดแล้วไม่หาย กดเปิดคืนได้จากช่องราคา</p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium leading-snug">เงื่อนไขจากไฟล์ (OVER · ผ่อนสูงสุด)</h3>
          <p className="text-xs text-muted-foreground leading-snug">
            {p.terms.hasTermColumns
              ? 'ระบบเก็บได้ 1 ค่าต่อรุ่นต่อมือ · ดาวน์ไม่อยู่ในใบราคา ใช้ค่าเดิม (หรือค่ากลางถ้าเป็นรุ่นใหม่)'
              : 'ไฟล์ไม่มีคอลัมน์ OVER / ผ่อนสูงสุด — เงื่อนไขเดิมไม่เปลี่ยน กรอกเฉพาะรุ่นใหม่'}
          </p>
          <p className="text-sm leading-snug">
            ตรงกับระบบ {byStatus('MATCH').length} · จะเปลี่ยน {byStatus('CHANGE').length} · ต้องเลือก {byStatus('CHOOSE').length} ·
            รุ่นใหม่ {byStatus('NEW').length}
          </p>
          {p.terms.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-sm text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {w}
            </p>
          ))}
          {byStatus('CHOOSE').map((pair) => (
            <div key={pair.key} className="space-y-2 rounded-lg border border-border p-3">
              <ChooseField pair={pair} field="allowance" value={pair.allowance} choice={choices[pair.key]?.allowance} onChoose={(v) => set(pair.key, 'allowance', v)} />
              <ChooseField pair={pair} field="maxMonths" value={pair.maxMonths} choice={choices[pair.key]?.maxMonths} onChoose={(v) => set(pair.key, 'maxMonths', v)} />
              {pair.current && (
                <p className="text-xs text-muted-foreground leading-snug">
                  ระบบตอนนี้ +{fmt(pair.current.allowance)} · {pair.current.maxMonths ?? 'ไม่จำกัด'} งวด
                </p>
              )}
            </div>
          ))}
          {byStatus('NEW').map((pair) => {
            const name = `${pair.series} ${HAND_LABEL[pair.condition]}`;
            return (
              <div key={pair.key} className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-sm font-medium leading-snug">รุ่นใหม่ · {name}</p>
                {pair.allowance.kind === 'none' ? (
                  <label className="flex items-center gap-2 text-sm">
                    OVER
                    <NumberInput
                      aria-label={`OVER ของ ${name} (บาท)`}
                      className="w-32"
                      min="0"
                      step="0.01"
                      value={choices[pair.key]?.allowance === undefined ? '' : String(choices[pair.key]?.allowance)}
                      onChange={(e) => set(pair.key, 'allowance', e.target.value === '' ? undefined : Number(e.target.value))}
                    />
                    บาท
                  </label>
                ) : pair.allowance.kind === 'value' ? (
                  <p className="text-sm leading-snug">OVER +{fmt(pair.allowance.value)} (จากไฟล์)</p>
                ) : (
                  <ChooseField pair={pair} field="allowance" value={pair.allowance} choice={choices[pair.key]?.allowance} onChoose={(v) => set(pair.key, 'allowance', v)} />
                )}
                {pair.maxMonths.kind === 'none' ? (
                  <RadioGroup
                    value={choices[pair.key]?.maxMonths === undefined ? '' : String(choices[pair.key]?.maxMonths)}
                    onValueChange={(v) => set(pair.key, 'maxMonths', Number(v))}
                    className="flex flex-wrap gap-4"
                  >
                    <span className="text-sm">ผ่อนสูงสุด</span>
                    {MONTH_CHOICES.map((m) => (
                      <label key={m} className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value={String(m)} aria-label={`${name} ผ่อนสูงสุด ${m} งวด`} /> {m} งวด
                      </label>
                    ))}
                  </RadioGroup>
                ) : pair.maxMonths.kind === 'value' ? (
                  <p className="text-sm leading-snug">ผ่อนสูงสุด {pair.maxMonths.value} งวด (จากไฟล์)</p>
                ) : (
                  <ChooseField pair={pair} field="maxMonths" value={pair.maxMonths} choice={choices[pair.key]?.maxMonths} onChoose={(v) => set(pair.key, 'maxMonths', v)} />
                )}
              </div>
            );
          })}
          {plan.changes.length > 0 && (
            <ul className="list-disc pl-5 text-sm leading-snug">
              {plan.changes.map((c) => (
                <li key={`${c.series}|${c.condition}`}>{ruleChangeText(c, pairOf(c))}</li>
              ))}
            </ul>
          )}
          {plan.missing.length > 0 && (
            <p className="flex items-start gap-1.5 text-sm text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ต้องกรอก OVER และผ่อนสูงสุดของรุ่นใหม่ก่อนกดยืนยัน — ระบบไม่เดาให้
            </p>
          )}
        </section>

        <div className="rounded-lg bg-muted p-3 text-sm leading-snug">
          ราคา: เพิ่ม {count('ADD')} · แก้ {count('UPDATE')} · ปิด {closeIds.length} · เงื่อนไข: บันทึก {plan.changes.length} รุ่น
          {p.progress && <p className="mt-1 font-medium">{p.progress}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            ส่งทีละ 100 แถว · ถ้าพลาดกลางทาง จะบอกว่าบันทึกไปแล้วกี่ชุด · นำเข้าไฟล์เดิมซ้ำได้
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={p.onCancel} disabled={p.pending}>
            ยกเลิก
          </Button>
          <Button variant="primary" disabled={!canConfirm} onClick={() => p.onConfirm({ closeIds, changes: plan.changes })}>
            ยืนยันนำเข้า
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/GfinImportDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/import/gfinTemplate.ts apps/web/src/pages/GfinConfigPage/import/GfinImportDialog.tsx apps/web/src/pages/GfinConfigPage/__tests__/GfinImportDialog.test.tsx
git commit -m "feat(gfin-web): หน้าตรวจใบราคา — ปิดราคาที่ไม่มีในไฟล์ · เงื่อนไขจากไฟล์ · รุ่นใหม่ต้องกรอก

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Terms tab composition

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/terms/TermsTab.tsx`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/TermsTab.test.tsx`

**Interfaces:**
- Consumes: `useGfinTables` (`@/pages/ProductDetailPage/hooks/useGfinTables`), Tasks 1–8, `buildGfinImportReview`, `importFromExcel` (`@/utils/excel.util`), `ImportBatchError` (`@/utils/excel-cell.util`), `QueryBoundary`-style loading/error text, `useAuth`.
- Produces: `<TermsTab />` — reads `?edit=<rowKey>` from the URL to open the edit dialog (used by Task 10).

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/GfinConfigPage/__tests__/TermsTab.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const authState = vi.hoisted(() => ({ role: 'OWNER' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: authState.role } }) }));
const data: Record<string, unknown> = {
  '/gfin-config/max-prices': [
    { id: 'a', gfinSeries: 'iPhone 17', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '25000', modelMatchPattern: 'iPhone 17', isActive: true },
    { id: 'b', gfinSeries: 'iPhone 17 Pro', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '30000', modelMatchPattern: 'iPhone 17 Pro', isActive: true },
    { id: 'c', gfinSeries: 'iPhone 12', gfinVariant: null, storage: '64GB', condition: 'HAND_2', maxPrice: '9000', modelMatchPattern: 'iPhone 12', isActive: true },
  ],
  '/gfin-config/overprice-rules': [
    { id: 'r1', label: 'x', seriesPattern: 'iPhone 17', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true },
    { id: 'r2', label: 'y', seriesPattern: 'iPhone 17 Pro', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true },
  ],
  '/gfin-config/rate-factors': [{ id: 'f', months: 15, shopCommissionPct: 15, factor: '0.0921', feePerInstallment: '100', isActive: true }],
  '/gfin-config/settings': { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 }, sheetVersion: '6.5', sheetEffectiveDate: '2026-10-16' },
};
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (url: string) => Promise.resolve({ data: data[url] }), post: vi.fn(), patch: vi.fn() },
  getErrorMessage: String,
}));

import { TermsTab } from '../terms/TermsTab';

function renderAt(url = '/settings/finance/gfin?tab=terms') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<TermsTab />, { wrapper: wrap });
}

describe('TermsTab', () => {
  beforeEach(() => {
    authState.role = 'OWNER';
  });

  it('แถบส้มบอกแถวที่มีราคาแต่ยังไม่ตั้งเงื่อนไข + ปุ่มกรองเฉพาะแถวที่ต้องดู', async () => {
    renderAt();
    expect(await screen.findByText('1 แถวมีราคาแต่ยังไม่ตั้งเงื่อนไข — iPhone 12 มือ 2')).toBeInTheDocument();
    const table = screen.getByTestId('terms-table');
    expect(within(table).getAllByRole('checkbox')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'ดูเฉพาะแถวที่ต้องดู' }));
    expect(within(table).getAllByRole('checkbox')).toHaveLength(1);
  });

  it('เลือกมือ 2 ทั้งตระกูล → แถบเลือก → แก้เงื่อนไขพร้อมกัน เปิดกล่องพร้อมรุ่นที่เลือก', async () => {
    renderAt();
    const table = await screen.findByTestId('terms-table');
    await userEvent.click(within(table).getByRole('button', { name: 'เลือกมือ 2 ทั้งตระกูล iPhone 17' }));
    expect(screen.getByText('เลือก 2 แถว · มือ 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'แก้เงื่อนไขพร้อมกัน' }));
    expect(screen.getByRole('dialog', { name: /แก้เงื่อนไขพร้อมกัน · 2 รุ่น/ })).toBeInTheDocument();
  });

  it('?edit=<แถว> เปิดกล่องแก้ของแถวนั้น', async () => {
    renderAt('/settings/finance/gfin?tab=terms&edit=' + encodeURIComponent('iPhone 12|HAND_2'));
    expect(await screen.findByRole('dialog', { name: /แก้เงื่อนไข · 1 รุ่น · มือ 2/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/TermsTab.test.tsx`
Expected: FAIL — cannot resolve `../terms/TermsTab`.

- [ ] **Step 3: Implement**

`apps/web/src/pages/GfinConfigPage/terms/TermsTab.tsx`:

```tsx
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, TriangleAlert, Upload } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { importFromExcel } from '@/utils/excel.util';
import { ImportBatchError } from '@/utils/excel-cell.util';
import { useGfinTables } from '@/pages/ProductDetailPage/hooks/useGfinTables';
import { GFIN_QUERY_KEYS } from '../gfinQueryKeys';
import { buildGfinImportReview, type GfinImportReview } from '../gfinPriceListImport';
import {
  buildImportTermsReview,
  buildRuleUpsertBatches,
  findMissingPrices,
  runGfinImport,
  type GfinImportSender,
  type ImportTermsReview,
  type MissingPrices,
  type RuleChange,
} from '../import/gfinImportTerms';
import { GfinImportDialog } from '../import/GfinImportDialog';
import { downloadGfinTemplate } from '../import/gfinTemplate';
import { CentralTermsCard } from './CentralTermsCard';
import { ModelTermsCards } from './ModelTermsCards';
import { ModelTermsTable } from './ModelTermsTable';
import { RuleEditDialog } from './RuleEditDialog';
import { SheetVersionCard } from './SheetVersionCard';
import {
  ALL_FAMILIES,
  HAND_LABEL,
  buildModelTermsView,
  filterFamilies,
  selectionSummary,
  type Hand,
  type ModelTermsFamily,
  type ModelTermsRow,
  type TermsFilter,
} from './modelTerms';

interface ImportState {
  fileName: string;
  prices: GfinImportReview;
  missing: MissingPrices;
  terms: ImportTermsReview;
}

const sender: GfinImportSender = {
  importPrices: async (body) => (await api.post('/gfin-config/max-prices/import', body)).data,
  closePrices: async (ids) => (await api.post('/gfin-config/max-prices/close', { ids })).data,
  upsertRules: async (body) => (await api.post('/gfin-config/overprice-rules/bulk-upsert', body)).data,
};

const Chip = (p: { pressed: boolean; onClick: () => void; children: string }) => (
  <Button variant={p.pressed ? 'primary' : 'outline'} size="sm" aria-pressed={p.pressed} onClick={p.onClick}>
    {p.children}
  </Button>
);

/** แท็บ "เงื่อนไข & ราคา" (สเปก §6.2) */
export function TermsTab() {
  const { user } = useAuth();
  const canEdit = user?.role === 'OWNER';
  const qc = useQueryClient();
  const { tables, isLoading, isError, retry } = useGfinTables();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = useMemo(() => (tables ? buildModelTermsView(tables) : null), [tables]);
  const [filter, setFilter] = useState<TermsFilter>({ search: '', family: ALL_FAMILIES, hand: 'ALL', onlyAttention: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editKeys, setEditKeys] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const editParam = canEdit ? searchParams.get('edit') : null;
  const editing = editKeys ?? (editParam ? [editParam] : null);
  const editRows: ModelTermsRow[] =
    view && editing ? editing.map((k) => view.rows.find((r) => r.key === k)).filter((r): r is ModelTermsRow => !!r) : [];

  const closeEdit = () => {
    setEditKeys(null);
    if (searchParams.has('edit')) {
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    }
  };

  const runImport = useMutation({
    mutationFn: (d: { closeIds: string[]; changes: RuleChange[] }) =>
      runGfinImport(
        sender,
        { prices: importState!.prices.toSend, closeIds: d.closeIds, ruleBatches: buildRuleUpsertBatches(d.changes) },
        (done, total) => setProgress(`บันทึกแล้ว ${done}/${total} ชุด`),
        getErrorMessage,
      ),
    onSuccess: (out) => {
      toast.success(
        `นำเข้าใบราคาแล้ว — เพิ่ม ${out.prices.created} · แก้ ${out.prices.updated} · เท่าเดิม ${out.prices.unchanged} · ปิด ${out.closed} · เงื่อนไข ${out.rulesSaved} รุ่น`,
      );
      setImportState(null);
    },
    onError: (err) => toast.error(err instanceof ImportBatchError ? err.message : getErrorMessage(err)),
    onSettled: () => {
      setProgress(null);
      for (const key of Object.values(GFIN_QUERY_KEYS)) void qc.invalidateQueries({ queryKey: key });
    },
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file || !tables) return;
    try {
      const rows = await importFromExcel(file);
      const prices = buildGfinImportReview(rows, tables.mappings);
      if (prices.rows.length === 0) {
        toast.error('ไม่พบข้อมูลที่ถูกต้อง กรุณาตรวจสอบหัวคอลัมน์ (รุ่น · ความจุ · มือ 1/มือ 2 · ราคา)');
        return;
      }
      setImportState({
        fileName: file.name,
        prices,
        missing: findMissingPrices(rows, tables.mappings),
        terms: buildImportTermsReview(rows, tables.mappings, tables.rules),
      });
    } catch {
      toast.error('ไม่สามารถอ่านไฟล์ได้ กรุณาใช้ไฟล์ .xlsx');
    }
  };

  if (isLoading) return <div className="p-4 text-muted-foreground leading-snug">กำลังโหลด...</div>;
  if (isError || !tables || !view)
    return (
      <div className="space-y-2 p-4">
        <p className="text-destructive leading-snug">โหลดข้อมูล GFIN ไม่สำเร็จ</p>
        <Button variant="outline" onClick={retry}>
          ลองใหม่
        </Button>
      </div>
    );

  const families = filterFamilies(view, filter);
  const familyKeys = view.families.map((f) => f.family);
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const selectFamilyHand = (fam: ModelTermsFamily, hand: Hand) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const r of fam.rows) if (r.condition === hand) next.add(r.key);
      return next;
    });
  const selectedRows = view.rows.filter((r) => selected.has(r.key));
  const listProps = {
    families,
    storageColumns: view.storageColumns,
    selected,
    collapsed,
    canEdit,
    onToggleRow: (key: string) => setSelected((s) => toggle(s, key)),
    onSelectFamilyHand: selectFamilyHand,
    onToggleFamily: (family: string) => setCollapsed((s) => toggle(s, family)),
    onEdit: (keys: string[]) => setEditKeys(keys),
  };

  return (
    <div className="space-y-4">
      <SheetVersionCard settings={tables.settings} canEdit={canEdit} />
      <CentralTermsCard tables={tables} canEdit={canEdit} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold leading-snug">ราคาและเงื่อนไขรายรุ่น</h2>
            <p className="text-sm text-muted-foreground leading-snug">
              1 แถว = 1 รุ่น 1 สภาพ · ราคาส่ง GFIN = ราคาในตาราง + OVER ของแถวนั้น · กดราคาเพื่อแก้หรือปิด · ดาวน์ตัวหนา = ตั้งเฉพาะรุ่น ·
              สีเทา = ใช้ค่ากลาง · — = ไม่มีราคา (GFIN ไม่รับ)
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => downloadGfinTemplate().catch(() => toast.error('สร้างไฟล์แบบฟอร์มไม่สำเร็จ กรุณาลองใหม่'))}>
                <Download className="size-4" aria-hidden="true" />
                ดาวน์โหลดแบบฟอร์ม
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={runImport.isPending}>
                <Upload className="size-4" aria-hidden="true" />
                นำเข้าใบราคาจาก GFIN (Excel)
              </Button>
              <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onFile} />
            </div>
          )}
        </div>

        {view.needsRuleRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <div className="flex items-start gap-2 text-sm text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  {view.needsRuleRows.length} แถวมีราคาแต่ยังไม่ตั้งเงื่อนไข —{' '}
                  {view.needsRuleRows.map((r) => `${r.series} ${HAND_LABEL[r.condition]}`).join(', ')}
                </p>
                <p>แถวนี้ยังคิดผ่อน GFIN ไม่ได้จนกว่าจะตั้ง · ตั้งเงื่อนไข หรือปิดราคาที่ GFIN ไม่รับแล้ว</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={filter.onlyAttention}
              onClick={() => setFilter((f) => ({ ...f, onlyAttention: !f.onlyAttention }))}
            >
              ดูเฉพาะแถวที่ต้องดู
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="ค้นหารุ่น"
            placeholder="ค้นหารุ่น..."
            className="max-w-xs"
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          />
          <div className="flex flex-wrap gap-1" role="group" aria-label="ตระกูล">
            <Chip pressed={filter.family === ALL_FAMILIES} onClick={() => setFilter((f) => ({ ...f, family: ALL_FAMILIES }))}>
              ทั้งหมด
            </Chip>
            {familyKeys.map((fk) => (
              <Chip key={fk} pressed={filter.family === fk} onClick={() => setFilter((f) => ({ ...f, family: fk }))}>
                {view.families.find((f) => f.family === fk)!.label.replace(/^iPhone /, '')}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="สภาพ">
            <Chip pressed={filter.hand === 'ALL'} onClick={() => setFilter((f) => ({ ...f, hand: 'ALL' }))}>
              ทั้ง 2 มือ
            </Chip>
            <Chip pressed={filter.hand === 'HAND_1'} onClick={() => setFilter((f) => ({ ...f, hand: 'HAND_1' }))}>
              มือ 1
            </Chip>
            <Chip pressed={filter.hand === 'HAND_2'} onClick={() => setFilter((f) => ({ ...f, hand: 'HAND_2' }))}>
              มือ 2
            </Chip>
          </div>
        </div>

        {families.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-snug">ไม่พบรุ่นที่ตรงกับตัวกรอง</p>
        ) : (
          <>
            <div className="hidden md:block" data-testid="terms-table">
              <ModelTermsTable {...listProps} />
            </div>
            <div className="md:hidden" data-testid="terms-cards">
              <ModelTermsCards {...listProps} />
            </div>
          </>
        )}

        {canEdit && selectedRows.length > 0 && (
          <div
            role="region"
            aria-label="แถวที่เลือก"
            className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-foreground px-4 py-2 text-background"
          >
            <span className="text-sm leading-snug">{selectionSummary(selectedRows)}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditKeys(selectedRows.map((r) => r.key))}>
                แก้เงื่อนไขพร้อมกัน
              </Button>
              <Button variant="ghost" size="sm" className="text-background hover:text-foreground" onClick={() => setSelected(new Set())}>
                ล้างที่เลือก
              </Button>
            </div>
          </div>
        )}
      </section>

      {canEdit && editRows.length > 0 && (
        <RuleEditDialog
          rows={editRows}
          tables={tables}
          onRemove={(key) => {
            const remaining = editRows.filter((r) => r.key !== key).map((r) => r.key);
            if (remaining.length === 0) closeEdit();
            else setEditKeys(remaining);
          }}
          onClose={() => {
            closeEdit();
            setSelected(new Set());
          }}
        />
      )}

      {importState && (
        <GfinImportDialog
          fileName={importState.fileName}
          prices={importState.prices}
          missing={importState.missing}
          terms={importState.terms}
          pending={runImport.isPending}
          progress={progress}
          onCancel={() => setImportState(null)}
          onConfirm={(d) => runImport.mutate(d)}
        />
      )}
    </div>
  );
}
```


- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/TermsTab.test.tsx`
Expected: PASS (3 tests). The dialog's accessible name comes from `DialogTitle`; if Radix exposes it via `aria-labelledby` the regex queries match.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/terms/TermsTab.tsx apps/web/src/pages/GfinConfigPage/__tests__/TermsTab.test.tsx
git commit -m "feat(gfin-web): แท็บเงื่อนไข & ราคา — ตัวกรอง · แถบส้ม · เลือกหลายแถว · นำเข้าใบราคา

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Calculator tab

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/calc/calcModel.ts`
- Create: `apps/web/src/pages/GfinConfigPage/calc/CalcTab.tsx`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/calcModel.test.ts`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/CalcTab.test.tsx`

**Interfaces:**
- Consumes: `gfinQuoteAt`, `gfinProductOf` (Task 2); `buildModelTermsView`, `HAND_LABEL`, `rowKeyOf`, `Hand` (Task 1); `useGfinTables`; `ResolvedGfin`, `GfinTables`.
- Produces: `CalcSeriesOption`, `calcSeriesOptions(tables)`, `CalcLine`, `buildCalcLines(input, resolved, defaultDownPct)`, `unavailableText(resolved)`; `<CalcTab />`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/pages/GfinConfigPage/__tests__/calcModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { gfinProductOf, gfinQuoteAt } from '../gfinQuoteAt';
import { buildCalcLines, calcSeriesOptions, unavailableText } from '../calc/calcModel';

export const calcTables: GfinTables = {
  mappings: [
    { id: 'm1', gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '38900', modelMatchPattern: 'iPhone 17 Pro Max', isActive: true },
    { id: 'm2', gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '512GB', condition: 'HAND_2', maxPrice: '41900', modelMatchPattern: 'iPhone 17 Pro Max', isActive: false },
    { id: 'm3', gfinSeries: 'iPhone 12', gfinVariant: null, storage: '64GB', condition: 'HAND_2', maxPrice: '9000', modelMatchPattern: 'iPhone 12', isActive: true },
  ],
  rules: [{ id: 'r1', label: 'x', seriesPattern: 'iPhone 17 Pro Max', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true }],
  factors: [
    { id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.1105', feePerInstallment: '100', isActive: true },
    { id: 'f15', months: 15, shopCommissionPct: 15, factor: '0.0921', feePerInstallment: '100', isActive: true },
  ],
  settings: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } },
};
const input = { series: 'iPhone 17 Pro Max', storage: '256GB', condition: 'HAND_2' as const, deviceOrigin: 'THAI' as const };
const product = gfinProductOf(input.series, input.storage, input.condition, input.deviceOrigin);

describe('calcSeriesOptions', () => {
  it('เฉพาะความจุที่มีราคาเปิดอยู่ แยกตามมือ', () => {
    expect(calcSeriesOptions(calcTables)).toEqual([
      { series: 'iPhone 12', hands: { HAND_2: ['64GB'] } },
      { series: 'iPhone 17 Pro Max', hands: { HAND_2: ['256GB'] } },
    ]);
  });
});

describe('buildCalcLines', () => {
  it('ขายเท่าราคาส่ง: ทุกบรรทัดบอกที่มา', () => {
    const lines = buildCalcLines(input, gfinQuoteAt(calcTables, product, null), calcTables.settings.minDownPct);
    expect(lines.map((l) => [l.label, l.amount])).toEqual([
      ['ราคาสูงสุดในใบราคา', 38900],
      ['+ OVER', 2000],
      ['= ราคาส่ง GFIN', 40900],
      ['ดาวน์ขั้นต่ำ 30% ของราคาส่ง', 12270],
      ['= ดาวน์ลูกค้า (ปัดขึ้นเป็นหลักร้อย)', 12300],
      ['ยอดจัด (ราคาส่ง − ดาวน์ขั้นต่ำ)', 28630],
    ]);
    expect(lines[0].source).toBe('ใบราคา · iPhone 17 Pro Max · 256GB · มือ 2');
    expect(lines[1].source).toBe('ข้อ 7 · iPhone 17 Pro Max · มือ 2 · เครื่องไทยได้ OVER เต็ม (เครื่องนอกได้ครึ่ง)');
    expect(lines[1].editKey).toBe('iPhone 17 Pro Max|HAND_2');
    expect(lines[3].source).toBe('ข้อ 2 · 30% ตั้งเฉพาะรุ่น iPhone 17 Pro Max · มือ 2 · ค่ากลางคือ 25%');
  });

  it('ขายต่ำกว่าราคาส่ง → บรรทัดส่วนต่างที่ร้านช่วยออก', () => {
    const lines = buildCalcLines(input, gfinQuoteAt(calcTables, product, 38000), calcTables.settings.minDownPct);
    expect(lines.find((l) => l.label.startsWith('− ส่วนต่าง'))).toEqual({
      label: '− ส่วนต่างที่ร้านช่วยออก (40,900 − 38,000)', amount: 2900,
    });
    expect(lines.find((l) => l.label.startsWith('= ดาวน์ลูกค้า'))!.amount).toBe(9400);
  });
});

describe('unavailableText', () => {
  it('ไม่มีเงื่อนไข / ไม่มีราคา', () => {
    const noRule = gfinQuoteAt(calcTables, gfinProductOf('iPhone 12', '64GB', 'HAND_2', 'THAI'), null);
    expect(unavailableText(noRule)).toBe('ยังไม่ตั้งเงื่อนไข GFIN ของรุ่นนี้ — ตั้งในแท็บ เงื่อนไข & ราคา');
    const noPrice = gfinQuoteAt(calcTables, gfinProductOf('iPhone 17 Pro Max', '512GB', 'HAND_2', 'THAI'), null);
    expect(unavailableText(noPrice)).toBe('ไม่มีราคาของรุ่น ความจุ และมือนี้ในใบราคา');
  });
});
```

`apps/web/src/pages/GfinConfigPage/__tests__/CalcTab.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/pages/ProductDetailPage/hooks/useGfinTables', async () => {
  const { calcTables } = await import('./calcModel.test');
  return { useGfinTables: () => ({ tables: calcTables, isLoading: false, isError: false, retry: vi.fn() }) };
});

import { CalcTab } from '../calc/CalcTab';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.search}</p>;
}
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/settings/finance/gfin?tab=calc']}>
      {children}
      <Where />
    </MemoryRouter>
  </QueryClientProvider>
);

describe('CalcTab', () => {
  it('เลือกรุ่นที่มีเงื่อนไข → ดาวน์ลูกค้า + ตารางค่างวดไม่เกินผ่อนสูงสุด', async () => {
    render(<CalcTab />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: 'iPhone 17 Pro Max' }));
    expect(screen.getByText('12,300')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '15 งวด' })).toBeInTheDocument();
  });

  it('รุ่นที่ยังไม่ตั้งเงื่อนไข → เหตุผล + ลิงก์แก้รุ่นนี้ ไปแท็บเงื่อนไขพร้อม edit', async () => {
    render(<CalcTab />, { wrapper: wrap });
    await userEvent.click(screen.getByRole('button', { name: 'iPhone 12' }));
    expect(screen.getByText('ยังไม่ตั้งเงื่อนไข GFIN ของรุ่นนี้ — ตั้งในแท็บ เงื่อนไข & ราคา')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'แก้รุ่นนี้' }));
    expect(screen.getByTestId('where').textContent).toBe('?tab=terms&edit=iPhone+12%7CHAND_2');
  });
});
```

The series picker uses one button per series (`aria-pressed`) instead of a Radix Select so it is testable and works the same on mobile (≤ ~50 series).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/calcModel.test.ts src/pages/GfinConfigPage/__tests__/CalcTab.test.tsx`
Expected: FAIL — cannot resolve `../calc/calcModel`.

- [ ] **Step 3: Implement the model**

`apps/web/src/pages/GfinConfigPage/calc/calcModel.ts`:

```ts
import type { GfinTables, ResolvedGfin } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { HAND_LABEL, buildModelTermsView, rowKeyOf, type Hand } from '../terms/modelTerms';

const fmt = (n: number) => n.toLocaleString('th-TH');

export interface CalcSeriesOption {
  series: string;
  hands: Partial<Record<Hand, string[]>>;
}

/** รุ่นที่เลือกได้ = รุ่นที่มีราคาเปิดอยู่อย่างน้อย 1 ช่อง · ความจุตามช่องที่มีราคาเปิด */
export function calcSeriesOptions(tables: GfinTables): CalcSeriesOption[] {
  const out = new Map<string, CalcSeriesOption>();
  for (const row of buildModelTermsView(tables).rows) {
    const storages = row.cells.filter((c) => c.price !== null).map((c) => c.storage);
    if (storages.length === 0) continue;
    const opt = out.get(row.series) ?? { series: row.series, hands: {} };
    opt.hands[row.condition] = storages;
    out.set(row.series, opt);
  }
  return [...out.values()].sort((a, b) => a.series.localeCompare(b.series, 'en', { numeric: true }));
}

export interface CalcInput {
  series: string;
  storage: string;
  condition: Hand;
  deviceOrigin: 'THAI' | 'IMPORTED';
}

export interface CalcLine {
  label: string;
  amount: number;
  source?: string;
  /** แถวในแท็บเงื่อนไขที่บรรทัดนี้มาจาก — ใช้ทำลิงก์ "แก้รุ่นนี้" */
  editKey?: string;
}

/** บรรทัดคำนวณพร้อมที่มา (สเปก §6.4) — null เมื่อคิดไม่ได้ */
export function buildCalcLines(input: CalcInput, resolved: ResolvedGfin, defaultDownPct: number): CalcLine[] {
  const q = resolved.quote;
  if (!q.available) return [];
  const r = q.result;
  const hand = HAND_LABEL[input.condition];
  const key = rowKeyOf(input.series, input.condition);
  const modelDown = q.rule?.minDownPct ?? null;
  const lines: CalcLine[] = [
    {
      label: 'ราคาสูงสุดในใบราคา',
      amount: Number(q.mapping.maxPrice),
      source: `ใบราคา · ${input.series} · ${input.storage} · ${hand}`,
    },
    {
      label: '+ OVER',
      amount: r.allowanceApplied.toNumber(),
      source: `ข้อ 7 · ${input.series} · ${hand} · ${
        input.deviceOrigin === 'THAI' ? 'เครื่องไทยได้ OVER เต็ม (เครื่องนอกได้ครึ่ง)' : 'เครื่องนอกได้ OVER ครึ่งเดียว'
      }`,
      editKey: key,
    },
    { label: '= ราคาส่ง GFIN', amount: r.gfinSubmitPrice.toNumber() },
    {
      label: `ดาวน์ขั้นต่ำ ${resolved.downPct}% ของราคาส่ง`,
      amount: r.downAmountByFormula.toNumber(),
      source:
        modelDown !== null
          ? `ข้อ 2 · ${modelDown}% ตั้งเฉพาะรุ่น ${input.series} · ${hand} · ค่ากลางคือ ${defaultDownPct}%`
          : `ข้อ 2 · ค่ากลาง ${resolved.downPct}%`,
      editKey: key,
    },
  ];
  if (r.downDiscount.gt(0))
    lines.push({
      label: `− ส่วนต่างที่ร้านช่วยออก (${fmt(r.gfinSubmitPrice.toNumber())} − ${fmt(r.gfinSubmitPrice.sub(r.downDiscount).toNumber())})`,
      amount: r.downDiscount.toNumber(),
    });
  lines.push(
    { label: '= ดาวน์ลูกค้า (ปัดขึ้นเป็นหลักร้อย)', amount: r.downAmountActual.toNumber() },
    { label: 'ยอดจัด (ราคาส่ง − ดาวน์ขั้นต่ำ)', amount: r.financedAmount.toNumber() },
  );
  return lines;
}

export function unavailableText(resolved: ResolvedGfin): string | null {
  const q = resolved.quote;
  if (q.available) return null;
  switch (q.reason) {
    case 'no_mapping':
      return 'ไม่มีราคาของรุ่น ความจุ และมือนี้ในใบราคา';
    case 'no_rule':
      return 'ยังไม่ตั้งเงื่อนไข GFIN ของรุ่นนี้ — ตั้งในแท็บ เงื่อนไข & ราคา';
    case 'no_factor':
      return `ไม่มีตารางค่างวดของคอม ${resolved.commissionPct}% — แก้ตารางค่างวดในแท็บ เงื่อนไข & ราคา`;
    default:
      return 'หมวดสินค้านี้ GFIN ไม่รับ';
  }
}
```


- [ ] **Step 4: Implement the tab**

`apps/web/src/pages/GfinConfigPage/calc/CalcTab.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { useGfinTables } from '@/pages/ProductDetailPage/hooks/useGfinTables';
import { gfinProductOf, gfinQuoteAt } from '../gfinQuoteAt';
import { HAND_LABEL, HANDS, rowKeyOf, type Hand } from '../terms/modelTerms';
import { buildCalcLines, calcSeriesOptions, unavailableText } from './calcModel';

const fmt = (n: number) => n.toLocaleString('th-TH');

const Toggle = (p: { pressed: boolean; disabled?: boolean; onClick: () => void; children: string }) => (
  <Button variant={p.pressed ? 'primary' : 'outline'} size="sm" aria-pressed={p.pressed} disabled={p.disabled} onClick={p.onClick}>
    {p.children}
  </Button>
);

/** แท็บ "ทดลองคำนวณ" (สเปก §6.4) — สูตรเดียวกับหน้าสินค้า (resolveGfinQuote) */
export function CalcTab() {
  const { tables, isLoading, isError, retry } = useGfinTables();
  const [, setSearchParams] = useSearchParams();
  const options = useMemo(() => (tables ? calcSeriesOptions(tables) : []), [tables]);
  const [series, setSeries] = useState<string | null>(null);
  const [hand, setHand] = useState<Hand>('HAND_2');
  const [storage, setStorage] = useState<string | null>(null);
  const [origin, setOrigin] = useState<'THAI' | 'IMPORTED'>('THAI');
  const [sale, setSale] = useState('');

  if (isLoading) return <div className="p-4 text-muted-foreground leading-snug">กำลังโหลด...</div>;
  if (isError || !tables)
    return (
      <div className="space-y-2 p-4">
        <p className="text-destructive leading-snug">โหลดข้อมูล GFIN ไม่สำเร็จ</p>
        <Button variant="outline" onClick={retry}>
          ลองใหม่
        </Button>
      </div>
    );
  if (options.length === 0) return <p className="p-4 text-muted-foreground leading-snug">ยังไม่มีราคาในใบราคา GFIN</p>;

  const opt = options.find((o) => o.series === series) ?? options[0];
  const handNow: Hand = opt.hands[hand] ? hand : HANDS.find((h) => opt.hands[h])!;
  const storages = opt.hands[handNow]!;
  const storageNow = storage && storages.includes(storage) ? storage : storages[0];
  const salePrice = sale === '' ? null : Number(sale);
  const resolved = gfinQuoteAt(tables, gfinProductOf(opt.series, storageNow, handNow, origin), salePrice);
  const input = { series: opt.series, storage: storageNow, condition: handNow, deviceOrigin: origin };
  const lines = buildCalcLines(input, resolved, tables.settings.minDownPct);
  const reason = unavailableText(resolved);
  const editKey = rowKeyOf(opt.series, handNow);
  const goEdit = () => setSearchParams(new URLSearchParams({ tab: 'terms', edit: editKey }));
  const q = resolved.quote;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-semibold leading-snug">เครื่องที่จะลองคิด</h2>
        <div className="space-y-1">
          <p className="text-sm font-medium">รุ่น</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="รุ่น">
            {options.map((o) => (
              <Toggle key={o.series} pressed={o.series === opt.series} onClick={() => setSeries(o.series)}>
                {o.series}
              </Toggle>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">สภาพ</p>
          <div className="flex gap-1" role="group" aria-label="สภาพ">
            {HANDS.map((h) => (
              <Toggle key={h} pressed={h === handNow} disabled={!opt.hands[h]} onClick={() => setHand(h)}>
                {HAND_LABEL[h]}
              </Toggle>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">ความจุ</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="ความจุ">
            {storages.map((s) => (
              <Toggle key={s} pressed={s === storageNow} onClick={() => setStorage(s)}>
                {s}
              </Toggle>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">เครื่องไทย / เครื่องนอก</p>
          <div className="flex gap-1" role="group" aria-label="ที่มาเครื่อง">
            <Toggle pressed={origin === 'THAI'} onClick={() => setOrigin('THAI')}>
              ไทย
            </Toggle>
            <Toggle pressed={origin === 'IMPORTED'} onClick={() => setOrigin('IMPORTED')}>
              นอก
            </Toggle>
          </div>
        </div>
        <div>
          <label htmlFor="gfin-calc-sale" className="text-sm font-medium leading-snug">
            ราคาขาย GFIN ของร้าน (บาท)
          </label>
          <NumberInput id="gfin-calc-sale" min="0" step="0.01" value={sale} placeholder="เว้นว่าง = ขายเท่าราคาส่ง" onChange={(e) => setSale(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground leading-snug">
            ราคาที่จะตั้งขายลูกค้าผ่อน GFIN · ต่ำกว่าราคาส่ง = ร้านช่วยออกดาวน์ส่วนต่าง
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-live="polite">
        {!q.available ? (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {reason}
            </p>
            {q.reason !== 'no_mapping' && (
              <Button variant="outline" size="sm" onClick={goEdit}>
                แก้รุ่นนี้
              </Button>
            )}
          </div>
        ) : (
          <>
            <div>
              <p className="text-sm text-muted-foreground leading-snug">ผลคำนวณ · ดาวน์ลูกค้า</p>
              <p className="text-3xl font-semibold tabular-nums">
                {fmt(q.result.downAmountActual.toNumber())} <span className="text-base font-normal">บาท</span>
              </p>
              <p className="text-sm leading-snug">
                ผ่อนสูงสุด {resolved.months} งวด · เดือนละ {fmt(q.result.monthlyPayment.toNumber())} บาท
              </p>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.label} className="border-t border-border align-top">
                    <td className="py-1.5 pr-2 leading-snug">
                      {l.label}
                      {l.source && <span className="block text-xs text-muted-foreground">{l.source}</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(l.amount)}</td>
                    <td className="py-1.5 pl-2 text-right">
                      {l.editKey && l.label === '+ OVER' && (
                        <Button variant="ghost" size="sm" onClick={goEdit}>
                          แก้รุ่นนี้
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 text-left font-medium">จำนวนงวด</th>
                    <th className="py-1 text-right font-medium">ผ่อนเดือนละ</th>
                  </tr>
                </thead>
                <tbody>
                  {q.monthsOptions.map((o) => (
                    <tr key={o.months} className={o.months === resolved.months ? 'font-semibold' : ''}>
                      <td className="py-1">{o.months} งวด</td>
                      <td className="py-1 text-right tabular-nums">{fmt(o.monthly)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-muted-foreground leading-snug">
                ข้อ 4 · ตารางค่างวด คอม {resolved.commissionPct}% · รวมค่าธรรมเนียม {fmt(q.result.feePerInstallment.toNumber())} บาท/งวด ·
                ตัวเลขชุดเดียวกับหน้าเพิ่มสินค้าและหน้าสินค้า
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
```

In `CalcTab.test.tsx` the "แก้รุ่นนี้" button in the available state appears once (OVER line); in the `no_rule` state once (reason block) — the test uses the `no_rule` path.

- [ ] **Step 5: Run tests**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/calcModel.test.ts src/pages/GfinConfigPage/__tests__/CalcTab.test.tsx`
Expected: PASS (5 tests). `calcModel.test.ts` exports `calcTables` for the tab test; vitest still runs it as a test file.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/calc apps/web/src/pages/GfinConfigPage/__tests__/calcModel.test.ts apps/web/src/pages/GfinConfigPage/__tests__/CalcTab.test.tsx
git commit -m "feat(gfin-web): แท็บทดลองคำนวณ — สูตรเดียวกับหน้าสินค้า + บอกที่มาทุกบรรทัด

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Page shell — 3 tabs on the URL + remove old tabs

**Files:**
- Modify (rewrite): `apps/web/src/pages/GfinConfigPage/index.tsx`
- Delete: `apps/web/src/pages/GfinConfigPage/MaxPricesTab.tsx`, `OverpriceRulesTab.tsx`, `GfinSettingsPanel.tsx`, `MatchPreviewPanel.tsx`, `__tests__/MaxPricesTab.import.test.tsx`, `__tests__/OverpriceRulesTab.test.tsx`, `__tests__/GfinSettingsPanel.test.tsx`
- Test: `apps/web/src/pages/GfinConfigPage/__tests__/GfinConfigPage.test.tsx`

**Interfaces:**
- Consumes: `TermsTab` (Task 9), `CalcTab` (Task 10), `GfinPrecheckSettingsPanel`.
- Produces: default export page; tab values `terms` · `calc` · `line` on `?tab=`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/GfinConfigPage/__tests__/GfinConfigPage.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

const authState = vi.hoisted(() => ({ role: 'OWNER' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: authState.role } }) }));
vi.mock('../terms/TermsTab', () => ({ TermsTab: () => <p>terms-tab</p> }));
vi.mock('../calc/CalcTab', () => ({ CalcTab: () => <p>calc-tab</p> }));
vi.mock('../GfinPrecheckSettingsPanel', () => ({ GfinPrecheckSettingsPanel: () => <p>line-tab</p> }));

import GfinConfigPage from '../index';

function Where() {
  return <p data-testid="where">{useLocation().search}</p>;
}
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <GfinConfigPage />
      <Where />
    </MemoryRouter>,
  );

describe('GfinConfigPage', () => {
  beforeEach(() => {
    authState.role = 'OWNER';
  });

  it('เจ้าของเปิดครั้งแรก = แท็บเงื่อนไข & ราคา · มี 3 แท็บ', () => {
    renderAt('/settings/finance/gfin');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['เงื่อนไข & ราคา', 'ทดลองคำนวณ', 'กลุ่มไลน์ & ข้อความ']);
    expect(screen.getByText('terms-tab')).toBeInTheDocument();
  });

  it('?tab=calc เปิดแท็บทดลองคำนวณ · กดแท็บแล้ว URL เปลี่ยน', async () => {
    renderAt('/settings/finance/gfin?tab=calc');
    expect(screen.getByText('calc-tab')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'กลุ่มไลน์ & ข้อความ' }));
    expect(screen.getByTestId('where').textContent).toBe('?tab=line');
  });

  it('ไม่ใช่เจ้าของ เห็นเฉพาะกลุ่มไลน์ แม้ส่ง ?tab=terms', () => {
    authState.role = 'FINANCE_MANAGER';
    renderAt('/settings/finance/gfin?tab=terms');
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByText('line-tab')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/GfinConfigPage.test.tsx`
Expected: FAIL — old page renders 6 tabs.

- [ ] **Step 3: Rewrite the page**

`apps/web/src/pages/GfinConfigPage/index.tsx`:

```tsx
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { GfinPrecheckSettingsPanel } from './GfinPrecheckSettingsPanel';
import { TermsTab } from './terms/TermsTab';
import { CalcTab } from './calc/CalcTab';

type TabKey = 'terms' | 'calc' | 'line';
const OWNER_TABS: TabKey[] = ['terms', 'calc', 'line'];
const OTHER_TABS: TabKey[] = ['line'];

/** ตั้งค่า GFIN — 3 แท็บผูกกับ ?tab= (ลิงก์ตรงได้ · กดย้อนกลับได้ — สเปก §6.1) */
export default function GfinConfigPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [searchParams, setSearchParams] = useSearchParams();
  const allowed = isOwner ? OWNER_TABS : OTHER_TABS;
  const requested = searchParams.get('tab') as TabKey | null;
  const tab: TabKey = requested && allowed.includes(requested) ? requested : allowed[0];

  const onTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    next.delete('edit');
    setSearchParams(next);
  };

  return (
    <div className="container mx-auto space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold leading-snug">ตั้งค่า GFIN</h1>
        <p className="text-sm text-muted-foreground leading-snug">
          {isOwner
            ? 'ราคาและเงื่อนไขตามใบ G Finn รายรุ่น · ทดลองคำนวณด้วยสูตรเดียวกับหน้าสินค้า · กลุ่มไลน์และแม่แบบชุดเช็ค'
            : 'กลุ่มไลน์ที่รับชุดเช็ค GFIN และแม่แบบข้อความ 12 ข้อ'}
        </p>
      </div>
      <Tabs value={tab} onValueChange={onTab}>
        <TabsList>
          {isOwner && <TabsTrigger value="terms">เงื่อนไข &amp; ราคา</TabsTrigger>}
          {isOwner && <TabsTrigger value="calc">ทดลองคำนวณ</TabsTrigger>}
          <TabsTrigger value="line">กลุ่มไลน์ &amp; ข้อความ</TabsTrigger>
        </TabsList>
        {isOwner && (
          <TabsContent value="terms" className="mt-4">
            <TermsTab />
          </TabsContent>
        )}
        {isOwner && (
          <TabsContent value="calc" className="mt-4">
            <CalcTab />
          </TabsContent>
        )}
        <TabsContent value="line" className="mt-4">
          <GfinPrecheckSettingsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 4: Delete the old tabs**

```bash
git rm apps/web/src/pages/GfinConfigPage/MaxPricesTab.tsx apps/web/src/pages/GfinConfigPage/OverpriceRulesTab.tsx apps/web/src/pages/GfinConfigPage/GfinSettingsPanel.tsx apps/web/src/pages/GfinConfigPage/MatchPreviewPanel.tsx apps/web/src/pages/GfinConfigPage/__tests__/MaxPricesTab.import.test.tsx apps/web/src/pages/GfinConfigPage/__tests__/OverpriceRulesTab.test.tsx apps/web/src/pages/GfinConfigPage/__tests__/GfinSettingsPanel.test.tsx
```

Then confirm nothing still imports them:
Run: `grep -rn "MaxPricesTab\|OverpriceRulesTab\|GfinSettingsPanel\|MatchPreviewPanel\|sendGfinImport" apps/web/src` → no output.

- [ ] **Step 5: Run the whole folder + type check**

Run: `cd apps/web && npx vitest run src/pages/GfinConfigPage src/pages/ProductDetailPage src/components/ui/native-select.inventory.test.ts src/components/ui/field-guards.inventory.test.ts`
Expected: PASS (inventory tests may already fail on this Windows checkout because of CRLF — compare with the Task 0 baseline; a failure is acceptable only if it also failed in the baseline).
Run (repo root): `./tools/check-types.sh web`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/index.tsx apps/web/src/pages/GfinConfigPage/__tests__/GfinConfigPage.test.tsx
git commit -m "feat(gfin-web): หน้าตั้งค่า GFIN 3 แท็บผูกกับ URL · ลบแท็บเดิม 4 แท็บ

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Visual check (controller)

- [ ] **Step 1:** Run API + web locally against the dev DB (seeded GFIN data, or import the template file through the new dialog), log in as `admin@bestchoice.com`.
- [ ] **Step 2:** Playwright screenshots of `/settings/finance/gfin?tab=terms`, `?tab=calc`, the edit dialog (select 2 rows), the price popover, and the import review dialog at 1280 px and 390 px. Check: no horizontal page scroll at 390 px (the table only renders ≥ 768 px), Thai vowels not clipped, amber states have icon + words, dark mode readable.
- [ ] **Step 3:** Fix anything found, re-run Task 11 Step 5, commit.

---

## Self-Review

**Spec coverage (§6):**
- 6.1 tabs on `?tab=`, roles, default `terms`, old tabs removed, RateFactorsTab in a dialog → Tasks 4, 11.
- 6.2.1 version card → Task 4. 6.2.2 central values + commission select + rate chips + "แก้ตารางค่างวด" → Task 4.
- 6.2.3 template/import buttons, amber banner + attention filter, search/family/hand filters, family groups + collapse + select-hand-per-family, columns from data, hand rows only when priced, gray/bold down, amber 3-col cell + "ตั้งเงื่อนไข", selection bar → Tasks 1, 7, 9.
- 6.2.4 price popover (edit/close/reopen/new, submit-price line) → Task 5.
- 6.2.5 edit dialog (chips removable, keep/set, 10/12/15, keep/default/set down, "ตอนนี้ …", required for no-rule rows, summary + example before→after, bulk-upsert) → Tasks 2, 6.
- 6.2.6 mobile cards + sticky selection bar → Tasks 7, 9.
- 6.3 import (optional OVER/months columns, missing-in-file two groups with defaults, terms aggregation MATCH/CHANGE/CHOOSE/NEW, required inputs, no-term-columns case, order prices → close → rules, progress + resume message) → Tasks 3, 8, 9.
- 6.4 calculator (inputs, `resolveGfinQuote` only, product from series/storage/hand/origin, source per line, "แก้รุ่นนี้", months table with max highlighted, unavailable reasons) → Tasks 2, 10.
- §7 web tests list (`buildModelTermsRows` → `buildModelTermsView`, import review cases, tabs by role and `?tab=`) → Tasks 1, 3, 11. Playwright 1280 + 390 → Task 12.

**Known deviations (decided, flag to owner in the PR):**
- Calculator series picker = buttons, not a dropdown (testable, same on mobile).
- Mockup's "ดูแถวนี้ในตาราง" link dropped — spec §6.4 lists only "แก้รุ่นนี้".
- `buildGfinQuote` already returns `mapping`/`rule` objects, so no new `mappingId`/`ruleId` fields (spec §6.4 bullet satisfied by the objects).

**Type consistency:** `rowKeyOf` / `ModelTermsRow.key` (`series|HAND_N`) is the URL `edit` value (Tasks 9, 10). `BulkUpsertBody` is defined in Task 2 and reused by Task 3. `buildCalcLines(input, resolved, defaultDownPct)` — same 3-argument form in code and tests.
