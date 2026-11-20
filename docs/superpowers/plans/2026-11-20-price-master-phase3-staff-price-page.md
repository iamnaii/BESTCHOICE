# ช่วง 3 — หน้า "ราคาและเรทผ่อน" สำหรับพนักงาน + งานเก็บตกหน้าเว็บจาก #1798 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** พนักงานทุกตำแหน่ง (รวมพนักงานขาย) เปิด `/prices` แล้วเห็นราคาเงินสด + เรท 1 + เรท 2 ของแต่ละรุ่น/ความจุ ตัวเลขเดียวกับบอทขาย แทนหน้าพนักงานของชีต MASTER — พร้อมแก้ป้ายดอกเบี้ยในหน้าสร้างสัญญา และให้ตั้งค่าดอกเบี้ยเว้นดอกเบี้ยต่อเดือนได้เมื่อใช้ตารางรายงวด

**Architecture:** หน้าเว็บอ่าน `GET /pricing-templates/quotes` (ช่วง 2 ส่งแล้ว — คิดด้วยตัวคำนวณกลางฝั่งเซิร์ฟเวอร์) อย่างเดียว ไม่คิดเลขเอง หน้า `PriceListPage.tsx` ถือสถานะ (ค้นรุ่น · มือ 1/มือ 2 · เครื่องไทย/นอก) แล้วส่งแถวให้ตาราง (จอ ≥ 1024px) หรือการ์ด (จอแคบ) ตาม `useIsMobile` · ตัวช่วยจัดรูปข้อความเป็นฟังก์ชันล้วนใน `price-list/format.ts` · เมนูเพิ่มถัดจาก "คลังสินค้า" ของ 5 ตำแหน่ง แล้วชื่อหน้าใน breadcrumb ตามเมนูเอง (`resolvePageTitle`) · งานเก็บตก 2 ข้อแก้เฉพาะหน้าเว็บ (API รับดอกเบี้ยต่อเดือน 0 อยู่แล้ว — เพิ่มแค่เทสต์ปัก)

**Tech Stack:** React 18 · Vite · Tailwind · shadcn/ui · lucide-react · @tanstack/react-query v5 · vitest + Testing Library (`apps/web`) · jest + class-validator (`apps/api`)

สเปค: `docs/superpowers/specs/2026-11-19-price-master-retire-design.md` ข้อ 3.4, 6, 10, 11 (ช่วง 3) · สัญญาร่วม: `docs/superpowers/plans/2026-11-20-price-master-contracts.md` (Phase 2 + Phase 3) ·
Mockup: `.superpowers/brainstorm/1855-1795080137/content/staff-price-page.html` (ยังไม่มีปุ่มเครื่องไทย/นอก — แผนนี้เพิ่มตามสเปคข้อ 3.4)

## Global Constraints

คัดจากสัญญาร่วม (ทุกช่วง):

- Do not change the BC installment formula, VAT, commission or schedule maths (`calcBcInstallment` body stays as is).
- Percentage-derived down payments round **up** to 100 with `roundUpToStep` / `downFromPct` (`packages/shared/src/installment-rounding.ts`).
  Down payments typed as an amount are never rounded.
- Contract installment keeps satang. Displayed and bot-quoted installments round **up** to whole baht via `displayInstallment`.
- Imported phones and phones with unknown origin get half OVER (`gfinAllowanceFactor`); Thai phones get full OVER.
- Profit is shown only to roles that can see cost. The staff price page never shows cost, profit or GFIN submit price.
- Thai UI copy, `leading-snug` on Thai text, semantic colour tokens only, no `alert`/`confirm`, lucide icons, no emoji.
- `packages/shared` is consumed by the API from `dist` — run `npm run build --workspace=packages/shared` after shared changes.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: shared `npm --prefix packages/shared test` · web `cd apps/web && npx vitest run <paths>` ·
  api `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- <paths>` ·
  types `NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh all`.
- Migrations: Prisma, add-column only, nullable, folder `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql`.

เฉพาะช่วงนี้:

- ทำบน branch `feat/price-master-rest` (worktree `.worktrees/price-master-rest`) ต่อจากช่วง 1ข และ 2 · ช่วงนี้**ไม่มี migration และไม่แตะ `packages/shared`**
- หน้า `/prices` อ่าน `GET /pricing-templates/quotes` เท่านั้น (สัญญาร่วม Phase 3) — ห้ามเรียก `/pricing-templates`, `/products` หรือคิดค่างวดเองในหน้าเว็บ · ตัวเลขที่แสดง = ตัวเลขที่ API ส่ง (API ปัดค่างวดขึ้นบาทเต็มแล้ว)
- "ทุกตำแหน่ง" ของ codebase นี้ = `OWNER`, `BRANCH_MANAGER`, `FINANCE_MANAGER`, `ACCOUNTANT`, `SALES` (ตรงกับ `@Roles` ของ `pricing-templates.controller.ts` และ `ALL_ROLES` ใน `route-reachability.test.ts`) — `VIEWER` (ผู้ตรวจสอบภายนอก) ไม่ได้รับเมนู/route นี้
- route ต้องเขียน `roles={[...]}` เป็น literal ใน `App.tsx` (เทส `route-reachability.test.ts` อ่าน literal เท่านั้น) และเมนูต้องมีครบทุก role ที่ route อนุญาต ไม่งั้นเทสนั้นแดง
- สีใช้ token เท่านั้น (`bg-card`, `bg-muted`, `text-muted-foreground`, `bg-primary/10 text-primary`) — ห้าม `bg-white`, `text-gray-*`, hex · ข้อความสถานะต้องมีไอคอนหรือคำกำกับ (ป้ายประกันมีไอคอน + คำ)
- เวลา "ราคาอัปเดตล่าสุด" แสดงตามเวลาไทย (`Asia/Bangkok`) ไม่ขึ้นกับเขตเวลาของเครื่องที่เปิด
- ไฟล์ใหม่ของหน้าอยู่ที่ `apps/web/src/pages/PriceListPage.tsx` + โฟลเดอร์ `apps/web/src/pages/price-list/` (ชื่อจากสัญญาร่วม)

## รูปแบบข้อมูลจาก API (สัญญาร่วม Phase 2 — ถือว่าส่งแล้ว)

```ts
interface PriceQuoteRow {
  key: string;                       // brand|model|storage|hasWarranty
  brand: string; model: string; storage: string;
  category: 'PHONE_NEW' | 'PHONE_USED' | 'TABLET';
  hasWarranty: boolean | null;       // null = used-phone rows with equal prices merged into one
  cashPrice: number | null;
  rate1: { downAmount: number; monthly: number /* display */; months: number } | null;
  rate2: { downAmount: number; monthly: number; months: number } | { unavailable: string };
}
interface PriceQuoteList { updatedAt: string | null; rows: PriceQuoteRow[] }
```

หน้าเว็บแสดง `rate2.unavailable` ตามที่ API ส่งมาตรง ๆ (ข้อความเป็นของเซิร์ฟเวอร์) — กรณีใบราคา GFIN ไม่มีรุ่นนี้ API ส่ง "GFIN ไม่รับรุ่นนี้" ตามสเปคข้อ 6

---

### Task 1: ชนิดข้อมูล + ตัวช่วยจัดรูปข้อความของหน้าราคา

**Files:**
- Create: `apps/web/src/pages/price-list/types.ts`
- Create: `apps/web/src/pages/price-list/format.ts`
- Create: `apps/web/src/pages/price-list/format.test.ts`

**Interfaces:**
- Consumes: `GfinDeviceOrigin` (`@installment/shared`) · `THAI_MONTHS_SHORT` (`apps/web/src/lib/date.ts`)
- Produces:
  - `PriceCategory`, `PriceListCategory`, `RateTerms`, `PriceQuoteRow`, `PriceQuoteList`
  - `RATE1_TITLE`, `RATE2_TITLE`, `RATE1_MISSING`
  - `formatBaht(amount: number): string` · `formatCash(amount: number | null): string`
  - `rowTitle(row)`, `warrantyLabel(hasWarranty)`, `rowLabel(row)`
  - `notFoundMessage(q: string, category: PriceListCategory): string` · `emptyListMessage(category): string`
  - `formatUpdatedAt(iso: string): string | null`
  - `type RateView` · `rate1View(rate)` · `rate2View(rate)`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/pages/price-list/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  RATE1_MISSING,
  emptyListMessage,
  formatBaht,
  formatCash,
  formatUpdatedAt,
  notFoundMessage,
  rate1View,
  rate2View,
  rowLabel,
  rowTitle,
  warrantyLabel,
} from './format';

describe('formatBaht / formatCash', () => {
  it('คั่นหลักพัน ไม่เติมทศนิยมให้ราคาเต็มบาท', () => {
    expect(formatBaht(25900)).toBe('25,900');
    expect(formatBaht(3139)).toBe('3,139');
    expect(formatBaht(0)).toBe('0');
    expect(formatBaht(1745.5)).toBe('1,745.5');
  });

  it('ราคาเงินสดว่าง → ขีด', () => {
    expect(formatCash(null)).toBe('—');
    expect(formatCash(8900)).toBe('8,900');
  });
});

describe('ชื่อแถว', () => {
  it('รุ่น · ความจุ (ตาม mockup) · ความจุว่าง = ชื่อรุ่นอย่างเดียว', () => {
    expect(rowTitle({ model: 'iPhone 15', storage: '128GB' })).toBe('iPhone 15 · 128GB');
    expect(rowTitle({ model: 'iPad Air', storage: ' ' })).toBe('iPad Air');
  });

  it('ป้ายประกัน: true/false มีป้าย · null (แถวที่ราคาเท่ากันรวมเป็นแถวเดียว) ไม่มีป้าย', () => {
    expect(warrantyLabel(true)).toBe('มีประกัน');
    expect(warrantyLabel(false)).toBe('ไม่มีประกัน');
    expect(warrantyLabel(null)).toBeNull();
  });

  it('ชื่อสำหรับโปรแกรมอ่านจอรวมป้ายประกัน', () => {
    expect(rowLabel({ model: 'iPhone 13', storage: '128GB', hasWarranty: true })).toBe('iPhone 13 · 128GB (มีประกัน)');
    expect(rowLabel({ model: 'iPhone 15', storage: '128GB', hasWarranty: null })).toBe('iPhone 15 · 128GB');
  });
});

describe('ข้อความไม่พบ (สเปคข้อ 6 — ตรงทุกตัวอักษร)', () => {
  it('มือ 1 → ชวนสลับเป็นมือ 2', () => {
    expect(notFoundMessage('iPhone 11', 'PHONE_NEW')).toBe(
      'ไม่พบ "iPhone 11" ในตารางราคา มือ 1 — ลองสลับเป็นมือ 2 หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้',
    );
  });

  it('มือ 2 → ชวนสลับเป็นมือ 1', () => {
    expect(notFoundMessage('iPhone 17', 'PHONE_USED')).toBe(
      'ไม่พบ "iPhone 17" ในตารางราคา มือ 2 — ลองสลับเป็นมือ 1 หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้',
    );
  });

  it('ไม่ได้ค้นและไม่มีแถวเลย', () => {
    expect(emptyListMessage('PHONE_USED')).toBe('ยังไม่มีราคามือ 2 ในตารางราคา — แจ้งเจ้าของให้เพิ่มราคา');
  });
});

describe('formatUpdatedAt', () => {
  it('แสดงเวลาไทย วัน เดือนย่อ ปี พ.ศ.', () => {
    expect(formatUpdatedAt('2026-10-16T07:30:00.000Z')).toBe('16 ต.ค. 2569 14:30 น.');
  });

  it('ข้ามวันตามเวลาไทย ไม่ใช่ UTC (17:30Z = 00:30 ของวันถัดไป)', () => {
    expect(formatUpdatedAt('2026-10-15T17:30:00.000Z')).toBe('16 ต.ค. 2569 00:30 น.');
  });

  it('ค่าเสีย → null', () => {
    expect(formatUpdatedAt('not-a-date')).toBeNull();
  });
});

describe('rate views', () => {
  const terms = { downAmount: 3900, monthly: 3139, months: 12 };

  it('เรท 1 มีค่า / ว่าง', () => {
    expect(rate1View(terms)).toEqual({ ok: true, terms });
    expect(rate1View(null)).toEqual({ ok: false, text: RATE1_MISSING });
  });

  it('เรท 2 ไม่รับ → ใช้ข้อความจาก API ตรง ๆ', () => {
    expect(rate2View({ unavailable: 'GFIN ไม่รับรุ่นนี้' })).toEqual({ ok: false, text: 'GFIN ไม่รับรุ่นนี้' });
    expect(rate2View(terms)).toEqual({ ok: true, terms });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/price-list/format.test.ts`
Expected: FAIL — `Failed to resolve import "./format"`

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/pages/price-list/types.ts`:

```ts
import type { GfinDeviceOrigin } from '@installment/shared';

/**
 * คำตอบของ `GET /pricing-templates/quotes` — ตรงกับสัญญาร่วม Phase 2
 * (`docs/superpowers/plans/2026-11-20-price-master-contracts.md`) · API ไม่ส่งทุน กำไร หรือราคาส่ง GFIN
 */
export type PriceCategory = 'PHONE_NEW' | 'PHONE_USED' | 'TABLET';

/** หมวดที่หน้า "ราคาและเรทผ่อน" สลับได้ (สเปคข้อ 6: มือ 1 / มือ 2) */
export type PriceListCategory = Extract<PriceCategory, 'PHONE_NEW' | 'PHONE_USED'>;

export type PriceOrigin = GfinDeviceOrigin;

/** ดาวน์ · ค่างวดที่แสดง (ปัดขึ้นบาทเต็มโดย API) · จำนวนงวด */
export interface RateTerms {
  downAmount: number;
  monthly: number;
  months: number;
}

export interface PriceQuoteRow {
  /** brand|model|storage|hasWarranty */
  key: string;
  brand: string;
  model: string;
  storage: string;
  category: PriceCategory;
  /** null = มือ 2 ที่ราคามีประกัน / ไม่มีประกันเท่ากัน รวมเป็นแถวเดียว (หรือเครื่องมือ 1) */
  hasWarranty: boolean | null;
  cashPrice: number | null;
  rate1: RateTerms | null;
  rate2: RateTerms | { unavailable: string };
}

export interface PriceQuoteList {
  /** วันที่แก้ราคากลางล่าสุด (ISO) · null = ยังไม่มีราคากลาง */
  updatedAt: string | null;
  rows: PriceQuoteRow[];
}
```

`apps/web/src/pages/price-list/format.ts`:

```ts
import { THAI_MONTHS_SHORT } from '@/lib/date';
import type { PriceListCategory, PriceQuoteRow, RateTerms } from './types';

export const RATE1_TITLE = 'เรท 1 · ผ่อนกับ BESTCHOICE';
export const RATE2_TITLE = 'เรท 2 · ผ่อนกับ GFIN';
/** เรท 1 ว่าง = รุ่นนี้ไม่มีราคาผ่อน BESTCHOICE หรือหมวดนี้ยังไม่มีตั้งค่าดอกเบี้ย (`buildModelQuote` → `rate1 = null`) */
export const RATE1_MISSING = 'ยังไม่ได้ตั้งราคาผ่อน BESTCHOICE';

const BANGKOK = 'Asia/Bangkok';
const baht = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

export function formatBaht(amount: number): string {
  return baht.format(amount);
}

export function formatCash(amount: number | null): string {
  return amount == null ? '—' : formatBaht(amount);
}

/** "iPhone 15 · 128GB" (ตาม mockup) */
export function rowTitle(row: Pick<PriceQuoteRow, 'model' | 'storage'>): string {
  const storage = row.storage.trim();
  return storage ? `${row.model} · ${storage}` : row.model;
}

export function warrantyLabel(hasWarranty: boolean | null): string | null {
  if (hasWarranty === null) return null;
  return hasWarranty ? 'มีประกัน' : 'ไม่มีประกัน';
}

/** ชื่อแถวสำหรับโปรแกรมอ่านจอ — แถวมือ 2 ที่แยกตามประกันต้องแยกชื่อกันได้ */
export function rowLabel(row: Pick<PriceQuoteRow, 'model' | 'storage' | 'hasWarranty'>): string {
  const warranty = warrantyLabel(row.hasWarranty);
  return warranty ? `${rowTitle(row)} (${warranty})` : rowTitle(row);
}

/** [มือที่ดูอยู่, มือที่ชวนสลับไป] */
const HAND: Record<PriceListCategory, [number, number]> = {
  PHONE_NEW: [1, 2],
  PHONE_USED: [2, 1],
};

/** ข้อความไม่พบ — สเปคข้อ 6 ตรงทุกตัวอักษร */
export function notFoundMessage(q: string, category: PriceListCategory): string {
  const [hand, other] = HAND[category];
  return `ไม่พบ "${q}" ในตารางราคา มือ ${hand} — ลองสลับเป็นมือ ${other} หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้`;
}

/** ไม่ได้ค้นอะไรแต่หมวดนี้ไม่มีแถวเลย */
export function emptyListMessage(category: PriceListCategory): string {
  return `ยังไม่มีราคามือ ${HAND[category][0]} ในตารางราคา — แจ้งเจ้าของให้เพิ่มราคา`;
}

/** "16 ต.ค. 2569 14:30 น." ตามเวลาไทย · ค่าเสีย = null */
export function formatUpdatedAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const month = THAI_MONTHS_SHORT[Number(part('month')) - 1];
  return `${Number(part('day'))} ${month} ${Number(part('year')) + 543} ${part('hour')}:${part('minute')} น.`;
}

export type RateView = { ok: true; terms: RateTerms } | { ok: false; text: string };

export function rate1View(rate: PriceQuoteRow['rate1']): RateView {
  return rate ? { ok: true, terms: rate } : { ok: false, text: RATE1_MISSING };
}

export function rate2View(rate: PriceQuoteRow['rate2']): RateView {
  return 'unavailable' in rate ? { ok: false, text: rate.unavailable } : { ok: true, terms: rate };
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/price-list/format.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/price-list/types.ts apps/web/src/pages/price-list/format.ts apps/web/src/pages/price-list/format.test.ts
git commit -m "feat(web): price list types and text helpers for the staff price page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: หน้า `PriceListPage` — ค้นรุ่น · มือ 1/มือ 2 · เครื่องไทย/นอก · ตาราง/การ์ด

**Files:**
- Create: `apps/web/src/pages/price-list/usePriceQuotes.ts`
- Create: `apps/web/src/pages/price-list/SegmentedToggle.tsx`
- Create: `apps/web/src/pages/price-list/parts.tsx`
- Create: `apps/web/src/pages/price-list/PriceQuoteCards.tsx`
- Create: `apps/web/src/pages/price-list/PriceQuoteTable.tsx`
- Create: `apps/web/src/pages/PriceListPage.tsx`
- Create: `apps/web/src/pages/price-list/__tests__/PriceListPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 ทั้งหมด · `GET /pricing-templates/quotes?category=&origin=&q=` → `PriceQuoteList` ·
  `PageHeader` (`@/components/ui/PageHeader`) · `QueryBoundary` (`@/components/QueryBoundary`) · `formControlClass` (`@/components/ui/form-styles`) ·
  `Table*` (`@/components/ui/table`) · `useDebounce` · `useDocumentTitle` · `useIsMobile` (`< 1024px` = การ์ด) · `NAV_LABELS.prices` (เพิ่มใน Task 3 — Task นี้ใช้ค่าคงที่ของตัวเองจนกว่า Task 3 ดูข้อหมายเหตุใน Step 3)
- Produces:
  - `usePriceQuotes(params: { category: PriceListCategory; origin: GfinDeviceOrigin; q: string })` (react-query, key `['price-quotes', category, origin, q]`)
  - `SegmentedToggle<T extends string>({ label, options, value, onChange })` · `type SegmentOption<T>`
  - `WarrantyBadge`, `RateBlock` · `PriceQuoteCards({ rows })` · `PriceQuoteTable({ rows })`
  - `default export PriceListPage`

หมายเหตุลำดับงาน: `NAV_LABELS.prices` ถูกเพิ่มใน Task 3 — เพื่อให้ Task 2 จบได้เองโดยไม่พึ่ง Task 3 หน้านี้ใช้ค่าคงที่ `PRICE_LIST_TITLE` ของตัวเอง แล้ว Task 3 Step 3 เปลี่ยนเป็น `NAV_LABELS.prices`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/pages/price-list/__tests__/PriceListPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PriceListPage from '../../PriceListPage';
import type { PriceQuoteRow } from '../types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), mobile: false }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: () => 'โหลดไม่สำเร็จ',
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.mobile }));

const URL = '/pricing-templates/quotes';
const UPDATED_AT = '2026-10-16T07:30:00.000Z'; // 14:30 เวลาไทย

function row(
  o: Partial<PriceQuoteRow> & Pick<PriceQuoteRow, 'model' | 'storage' | 'category'>,
): PriceQuoteRow {
  return {
    key: `Apple|${o.model}|${o.storage}|${String(o.hasWarranty ?? null)}`,
    brand: 'Apple',
    hasWarranty: null,
    cashPrice: null,
    rate1: null,
    rate2: { unavailable: 'GFIN ไม่รับรุ่นนี้' },
    ...o,
  };
}

// ตัวเลขจาก mockup staff-price-page.html — หน้าเว็บแสดงตามที่ API ส่ง ไม่คิดเอง
// (แถวเครื่องนอก + iPhone 13 ไม่มีประกัน เป็นตัวเลขสมมุติสำหรับเทสต์)
const DATA: Record<string, PriceQuoteRow[]> = {
  'PHONE_NEW|THAI': [
    row({
      model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW', cashPrice: 25900,
      rate1: { downAmount: 3900, monthly: 3139, months: 12 },
      rate2: { downAmount: 6500, monthly: 3403, months: 12 },
    }),
    row({
      model: 'iPhone 17 Pro', storage: '256GB', category: 'PHONE_NEW', cashPrice: 39000,
      rate1: { downAmount: 15000, monthly: 3424, months: 12 },
      rate2: { downAmount: 9700, monthly: 4403, months: 15 },
    }),
  ],
  'PHONE_NEW|IMPORTED': [
    row({
      model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW', cashPrice: 25900,
      rate1: { downAmount: 3900, monthly: 3139, months: 12 },
      rate2: { downAmount: 7400, monthly: 3330, months: 12 },
    }),
  ],
  'PHONE_USED|THAI': [
    row({
      model: 'iPhone 12', storage: '64GB', category: 'PHONE_USED', cashPrice: 8900,
      rate1: { downAmount: 1100, monthly: 1011, months: 10 },
      rate2: { unavailable: 'GFIN ไม่รับรุ่นนี้' },
    }),
    row({
      model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED', hasWarranty: true, cashPrice: 12500,
      rate1: { downAmount: 1600, monthly: 1227, months: 12 },
      rate2: { downAmount: 0, monthly: 1745, months: 12 },
    }),
    row({
      model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED', hasWarranty: false, cashPrice: 11900,
      rate1: { downAmount: 1500, monthly: 1168, months: 12 },
      rate2: { downAmount: 0, monthly: 1662, months: 12 },
    }),
  ],
};

function serve() {
  mocks.get.mockImplementation(async (url: string, options?: { params?: Record<string, string> }) => {
    if (url !== URL) throw new Error(`unexpected ${url}`);
    const p = options?.params ?? {};
    const q = (p.q ?? '').toLowerCase();
    const rows = (DATA[`${p.category}|${p.origin}`] ?? []).filter(
      (r) => !q || r.model.toLowerCase().includes(q),
    );
    return { data: { updatedAt: UPDATED_AT, rows } };
  });
}

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PriceListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** ข้อความในทุกช่อง `<td>` ของแถวตารางที่มีชื่อรุ่นนี้ */
function cellsOf(title: string) {
  const tr = within(screen.getByRole('table')).getByText(title).closest('tr');
  if (!tr) throw new Error(`no row for ${title}`);
  return Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim());
}

const params = (p: Record<string, string>) => expect.objectContaining({ params: p });

describe('PriceListPage — หน้า "ราคาและเรทผ่อน"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mobile = false;
  });

  it('ค่าเริ่มต้น มือ 1 + เครื่องไทย · หัวหน้า · ราคาอัปเดตล่าสุดตามเวลาไทย', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    expect(mocks.get).toHaveBeenCalledWith(URL, params({ category: 'PHONE_NEW', origin: 'THAI' }));
    expect(screen.getByRole('heading', { level: 1, name: 'ราคาและเรทผ่อน' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'มือ 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'เครื่องไทย' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('ราคาอัปเดตล่าสุด 16 ต.ค. 2569 14:30 น.')).toBeInTheDocument();
  });

  it('จอกว้าง: ตาราง หนึ่งแถวต่อรุ่น + ความจุ — เงินสด · เรท 1 · เรท 2', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    expect(cellsOf('iPhone 15 · 128GB')).toEqual([
      'iPhone 15 · 128GB', '25,900', '3,900', '3,139', '12', '6,500', '3,403', '12',
    ]);
    expect(cellsOf('iPhone 17 Pro · 256GB')).toEqual([
      'iPhone 17 Pro · 256GB', '39,000', '15,000', '3,424', '12', '9,700', '4,403', '15',
    ]);
  });

  it('ไม่แสดงทุน กำไร หรือราคาส่ง GFIN', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    expect(document.body).not.toHaveTextContent(/ทุน|กำไร|ราคาส่ง/);
  });

  it('มือ 2: รุ่นที่ GFIN ไม่รับ · แยกแถวมีประกัน / ไม่มีประกันพร้อมป้าย', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
    await screen.findByText('iPhone 12 · 64GB');
    expect(mocks.get).toHaveBeenLastCalledWith(URL, params({ category: 'PHONE_USED', origin: 'THAI' }));
    expect(screen.getByRole('button', { name: 'มือ 2' })).toHaveAttribute('aria-pressed', 'true');

    expect(cellsOf('iPhone 12 · 64GB')).toEqual([
      'iPhone 12 · 64GB', '8,900', '1,100', '1,011', '10', 'GFIN ไม่รับรุ่นนี้',
    ]);
    const tr12 = within(screen.getByRole('table')).getByText('iPhone 12 · 64GB').closest('tr')!;
    expect(tr12).not.toHaveTextContent(/ประกัน/);

    const rows13 = within(screen.getByRole('table'))
      .getAllByText('iPhone 13 · 128GB')
      .map((el) => el.closest('tr')!);
    expect(rows13).toHaveLength(2);
    expect(rows13[0]).toHaveTextContent('มีประกัน');
    expect(rows13[0]).not.toHaveTextContent('ไม่มีประกัน');
    expect(rows13[0]).toHaveTextContent('12,500');
    expect(rows13[1]).toHaveTextContent('ไม่มีประกัน');
    expect(rows13[1]).toHaveTextContent('11,900');
  });

  it('เครื่องนอก: ขอ API ด้วย origin=IMPORTED แล้วเรท 2 เปลี่ยน', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    fireEvent.click(screen.getByRole('button', { name: 'เครื่องนอก' }));
    await waitFor(() =>
      expect(cellsOf('iPhone 15 · 128GB')).toEqual([
        'iPhone 15 · 128GB', '25,900', '3,900', '3,139', '12', '7,400', '3,330', '12',
      ]),
    );
    expect(mocks.get).toHaveBeenLastCalledWith(URL, params({ category: 'PHONE_NEW', origin: 'IMPORTED' }));
    expect(screen.getByRole('button', { name: 'เครื่องนอก' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ค้นรุ่นไม่พบ → ข้อความตามสเปคข้อ 6 ทั้งมือ 1 และมือ 2', async () => {
    serve();
    open();
    await screen.findByText('iPhone 15 · 128GB');
    fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหารุ่น' }), { target: { value: 'iPhone 11' } });
    expect(
      await screen.findByText(
        'ไม่พบ "iPhone 11" ในตารางราคา มือ 1 — ลองสลับเป็นมือ 2 หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้',
      ),
    ).toBeInTheDocument();
    expect(mocks.get).toHaveBeenLastCalledWith(
      URL,
      params({ category: 'PHONE_NEW', origin: 'THAI', q: 'iPhone 11' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
    expect(
      await screen.findByText(
        'ไม่พบ "iPhone 11" ในตารางราคา มือ 2 — ลองสลับเป็นมือ 1 หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้',
      ),
    ).toBeInTheDocument();
  });

  it('จอแคบ: การ์ดแทนตาราง แต่ละการ์ดมีเงินสดและสองเรท', async () => {
    mocks.mobile = true;
    serve();
    open();
    const card = await screen.findByRole('article', { name: 'iPhone 15 · 128GB' });
    expect(screen.queryByRole('table')).toBeNull();
    expect(card).toHaveTextContent('เงินสด 25,900');
    expect(within(card).getByRole('group', { name: 'เรท 1 · ผ่อนกับ BESTCHOICE' })).toHaveTextContent(
      'ดาวน์ 3,900 · ผ่อน 3,139 × 12 งวด',
    );
    expect(within(card).getByRole('group', { name: 'เรท 2 · ผ่อนกับ GFIN' })).toHaveTextContent(
      'ดาวน์ 6,500 · ผ่อน 3,403 × 12 งวด',
    );
  });

  it('จอแคบ มือ 2: การ์ดแยกตามประกันมีชื่อไม่ซ้ำ และรุ่นที่ GFIN ไม่รับบอกในช่องเรท 2', async () => {
    mocks.mobile = true;
    serve();
    open();
    await screen.findByRole('article', { name: 'iPhone 15 · 128GB' });
    fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
    const withWarranty = await screen.findByRole('article', { name: 'iPhone 13 · 128GB (มีประกัน)' });
    expect(withWarranty).toHaveTextContent('เงินสด 12,500');
    expect(screen.getByRole('article', { name: 'iPhone 13 · 128GB (ไม่มีประกัน)' })).toHaveTextContent('เงินสด 11,900');
    const card12 = screen.getByRole('article', { name: 'iPhone 12 · 64GB' });
    expect(within(card12).getByRole('group', { name: 'เรท 2 · ผ่อนกับ GFIN' })).toHaveTextContent('GFIN ไม่รับรุ่นนี้');
  });

  it('กำลังโหลดครั้งแรก → skeleton', () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    open();
    expect(screen.getByRole('status', { name: 'กำลังโหลด' })).toBeInTheDocument();
  });

  it('โหลดไม่สำเร็จ → ข้อความ + ปุ่มลองใหม่ที่โหลดได้จริง', async () => {
    mocks.get.mockRejectedValueOnce({ response: { status: 500 } });
    open();
    expect(await screen.findByText('โหลดราคาไม่สำเร็จ')).toBeInTheDocument();
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(await screen.findByText('iPhone 15 · 128GB')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/price-list/__tests__/PriceListPage.test.tsx`
Expected: FAIL — `Failed to resolve import "../../PriceListPage"`

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/pages/price-list/usePriceQuotes.ts`:

```ts
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { GfinDeviceOrigin } from '@installment/shared';
import api from '@/lib/api';
import type { PriceListCategory, PriceQuoteList } from './types';

export interface PriceQuoteParams {
  category: PriceListCategory;
  origin: GfinDeviceOrigin;
  /** คำค้นที่ trim แล้ว · ว่าง = ไม่ส่ง q */
  q: string;
}

/** `GET /pricing-templates/quotes` — คงแถวชุดเดิมไว้ระหว่างโหลดชุดใหม่ (สลับปุ่ม/พิมพ์ค้นแล้วหน้าไม่กระพริบ) */
export function usePriceQuotes({ category, origin, q }: PriceQuoteParams) {
  return useQuery({
    queryKey: ['price-quotes', category, origin, q],
    queryFn: async ({ signal }) =>
      (
        await api.get<PriceQuoteList>('/pricing-templates/quotes', {
          params: { category, origin, ...(q ? { q } : {}) },
          signal,
        })
      ).data,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
```

`apps/web/src/pages/price-list/SegmentedToggle.tsx`:

```tsx
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * ปุ่มสลับแบบแบ่งช่อง — หน้าตาเดียวกับ `CustomerViewSwitch` (`pages/CustomersPage/components/CustomerViewSwitch.tsx`):
 * สูง 44px · รางสี muted · ช่องที่เลือกเป็นพื้น card ตัวหนังสือ primary · บอกสถานะด้วย `aria-pressed`
 */
export default function SegmentedToggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-h-11 gap-1 rounded-lg bg-muted/50 ring-1 ring-inset ring-border/80"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            data-ui-control="button"
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-11 min-w-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on
                ? 'bg-card font-semibold text-primary shadow-xs ring-1 ring-inset ring-primary/35'
                : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

`apps/web/src/pages/price-list/parts.tsx`:

```tsx
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBaht, warrantyLabel, type RateView } from './format';

/** ป้ายประกันของแถวมือ 2 ที่ราคาต่างกัน — ไอคอน + คำ (ไม่บอกด้วยสีอย่างเดียว) · null = ไม่มีป้าย */
export function WarrantyBadge({ hasWarranty }: { hasWarranty: boolean | null }) {
  const label = warrantyLabel(hasWarranty);
  if (!label) return null;
  const Icon = hasWarranty ? ShieldCheck : ShieldOff;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium leading-snug',
        hasWarranty ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

/** กล่องเรทหนึ่งเรทในการ์ด (จอแคบ) — "ดาวน์ 3,900 · ผ่อน 3,139 × 12 งวด" หรือข้อความเมื่อไม่มีเรท */
export function RateBlock({ title, view }: { title: string; view: RateView }) {
  return (
    <div
      role="group"
      aria-label={title}
      className={cn('rounded-lg bg-muted/50 px-3 py-2 tabular-nums', !view.ok && 'text-muted-foreground')}
    >
      <p className="text-xs leading-snug text-muted-foreground">{title}</p>
      {view.ok ? (
        <p className="text-sm leading-snug text-foreground">
          ดาวน์ <span className="text-base font-semibold">{formatBaht(view.terms.downAmount)}</span> · ผ่อน <span className="text-base font-semibold">{formatBaht(view.terms.monthly)}</span> × {view.terms.months} งวด
        </p>
      ) : (
        <p className="text-sm leading-snug">{view.text}</p>
      )}
    </div>
  );
}
```

(บรรทัด "ดาวน์ … งวด" ต้องอยู่บรรทัดเดียวตามนี้ — ช่องว่างรอบ `·` และ `×` มาจากข้อความในบรรทัดเดียวกับ `<span>` ถ้าตัดบรรทัด JSX จะกินช่องว่าง)

`apps/web/src/pages/price-list/PriceQuoteCards.tsx`:

```tsx
import { RATE1_TITLE, RATE2_TITLE, formatCash, rate1View, rate2View, rowLabel, rowTitle } from './format';
import { RateBlock, WarrantyBadge } from './parts';
import type { PriceQuoteRow } from './types';

/** จอแคบกว่า 1024px — การ์ดละรุ่น + ความจุ (ตาม mockup staff-price-page.html) */
export default function PriceQuoteCards({ rows }: { rows: PriceQuoteRow[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key}>
          <article
            aria-label={rowLabel(row)}
            className="rounded-xl border border-border bg-card p-3 shadow-card"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold leading-snug text-foreground">
                <span>{rowTitle(row)}</span>
                <WarrantyBadge hasWarranty={row.hasWarranty} />
              </h2>
              <p className="text-sm leading-snug text-muted-foreground tabular-nums">
                เงินสด <span className="text-base font-semibold text-foreground">{formatCash(row.cashPrice)}</span>
              </p>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <RateBlock title={RATE1_TITLE} view={rate1View(row.rate1)} />
              <RateBlock title={RATE2_TITLE} view={rate2View(row.rate2)} />
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
```

`apps/web/src/pages/price-list/PriceQuoteTable.tsx`:

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  RATE1_TITLE,
  RATE2_TITLE,
  formatBaht,
  formatCash,
  rate1View,
  rate2View,
  rowTitle,
  type RateView,
} from './format';
import { WarrantyBadge } from './parts';
import type { PriceQuoteRow } from './types';

const MONEY = 'text-right font-mono tabular-nums';

const SUB_HEADERS = [
  ['r1-down', 'ดาวน์'],
  ['r1-monthly', 'ค่างวด'],
  ['r1-months', 'งวด'],
  ['r2-down', 'ดาวน์'],
  ['r2-monthly', 'ค่างวด'],
  ['r2-months', 'งวด'],
] as const;

/** 3 ช่องของเรทหนึ่งเรท · ไม่มีเรท = ช่องเดียวกว้าง 3 คอลัมน์พร้อมข้อความ */
function RateCells({ view }: { view: RateView }) {
  if (!view.ok) {
    return (
      <TableCell colSpan={3} className="text-center text-sm leading-snug text-muted-foreground">
        {view.text}
      </TableCell>
    );
  }
  return (
    <>
      <TableCell className={MONEY}>{formatBaht(view.terms.downAmount)}</TableCell>
      <TableCell className={cn(MONEY, 'font-semibold')}>{formatBaht(view.terms.monthly)}</TableCell>
      <TableCell className={MONEY}>{view.terms.months}</TableCell>
    </>
  );
}

/** จอ ≥ 1024px — หนึ่งแถวต่อรุ่น + ความจุ */
export default function PriceQuoteTable({ rows }: { rows: PriceQuoteRow[] }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead rowSpan={2}>รุ่น · ความจุ</TableHead>
            <TableHead rowSpan={2} className="text-right">
              เงินสด
            </TableHead>
            <TableHead colSpan={3} className="text-center">
              {RATE1_TITLE}
            </TableHead>
            <TableHead colSpan={3} className="text-center">
              {RATE2_TITLE}
            </TableHead>
          </TableRow>
          <TableRow className="bg-muted/50">
            {SUB_HEADERS.map(([key, label]) => (
              <TableHead key={key} className="text-right">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2 leading-snug">
                  <span className="font-medium text-foreground">{rowTitle(row)}</span>
                  <WarrantyBadge hasWarranty={row.hasWarranty} />
                </div>
              </TableCell>
              <TableCell className={cn(MONEY, 'font-semibold')}>{formatCash(row.cashPrice)}</TableCell>
              <RateCells view={rate1View(row.rate1)} />
              <RateCells view={rate2View(row.rate2)} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

`apps/web/src/pages/PriceListPage.tsx`:

```tsx
import { useState } from 'react';
import { Search, SearchX } from 'lucide-react';
import type { GfinDeviceOrigin } from '@installment/shared';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { formControlClass } from '@/components/ui/form-styles';
import { useDebounce } from '@/hooks/useDebounce';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import PriceQuoteCards from './price-list/PriceQuoteCards';
import PriceQuoteTable from './price-list/PriceQuoteTable';
import SegmentedToggle, { type SegmentOption } from './price-list/SegmentedToggle';
import { emptyListMessage, formatUpdatedAt, notFoundMessage } from './price-list/format';
import type { PriceListCategory } from './price-list/types';
import { usePriceQuotes } from './price-list/usePriceQuotes';

const PRICE_LIST_TITLE = 'ราคาและเรทผ่อน';

const CATEGORY_OPTIONS: SegmentOption<PriceListCategory>[] = [
  { value: 'PHONE_NEW', label: 'มือ 1' },
  { value: 'PHONE_USED', label: 'มือ 2' },
];

const ORIGIN_OPTIONS: SegmentOption<GfinDeviceOrigin>[] = [
  { value: 'THAI', label: 'เครื่องไทย' },
  { value: 'IMPORTED', label: 'เครื่องนอก' },
];

/**
 * หน้า "ราคาและเรทผ่อน" (`/prices`) — สเปค 2026-11-19 ข้อ 6 · แทนหน้าพนักงานของชีต MASTER
 * ทุกตำแหน่งที่ทำงานหน้าร้านเปิดได้ (รวมพนักงานขาย) · อ่าน `GET /pricing-templates/quotes` อย่างเดียว —
 * API คิดด้วยตัวคำนวณกลางตัวเดียวกับบอทขาย และไม่ส่งทุน กำไร หรือราคาส่ง GFIN มาเลย
 * เครื่องไทย / เครื่องนอก มีผลกับเรท 2 เท่านั้น (สเปคข้อ 3.4 — เครื่องนอกได้ OVER ครึ่งเดียว)
 */
export default function PriceListPage() {
  useDocumentTitle(PRICE_LIST_TITLE);
  const isMobile = useIsMobile();
  const [category, setCategory] = useState<PriceListCategory>('PHONE_NEW');
  const [origin, setOrigin] = useState<GfinDeviceOrigin>('THAI');
  const [search, setSearch] = useState('');
  const q = useDebounce(search.trim(), 300);

  const quotes = usePriceQuotes({ category, origin, q });
  const rows = quotes.data?.rows ?? [];
  const updatedText = quotes.data?.updatedAt ? formatUpdatedAt(quotes.data.updatedAt) : null;
  const stale = quotes.isPlaceholderData;

  return (
    <div>
      <PageHeader
        title={PRICE_LIST_TITLE}
        subtitle="ราคาเงินสดและเรทผ่อนของแต่ละรุ่น สำหรับตอบลูกค้า"
        action={
          updatedText ? (
            <p className="text-xs leading-snug text-muted-foreground">ราคาอัปเดตล่าสุด {updatedText}</p>
          ) : undefined
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 basis-full sm:min-w-64 sm:flex-1 sm:basis-auto">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            aria-label="ค้นหารุ่น"
            placeholder="ค้นหารุ่น เช่น iPhone 15"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(formControlClass, 'pl-9')}
          />
        </div>
        <SegmentedToggle label="มือ 1 หรือ มือ 2" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
        <SegmentedToggle label="เครื่องไทย หรือ เครื่องนอก" options={ORIGIN_OPTIONS} value={origin} onChange={setOrigin} />
      </div>
      <p className="mb-4 text-xs leading-snug text-muted-foreground">
        เครื่องไทย / เครื่องนอก มีผลกับเรท 2 (GFIN) เท่านั้น · ค่างวดปัดขึ้นเป็นบาทเต็ม
      </p>

      <QueryBoundary
        isLoading={quotes.isLoading}
        isError={quotes.isError}
        error={quotes.error}
        onRetry={() => void quotes.refetch()}
        errorTitle="โหลดราคาไม่สำเร็จ"
      >
        <div aria-busy={stale} className={cn('transition-opacity', stale && 'opacity-60')}>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <SearchX className="size-12 text-muted-foreground" aria-hidden="true" />
              <p className="max-w-md text-sm leading-snug text-muted-foreground">
                {q ? notFoundMessage(q, category) : emptyListMessage(category)}
              </p>
            </div>
          ) : isMobile ? (
            <PriceQuoteCards rows={rows} />
          ) : (
            <PriceQuoteTable rows={rows} />
          )}
        </div>
      </QueryBoundary>
    </div>
  );
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/price-list`
Expected: PASS (format 13 + page 10 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/PriceListPage.tsx apps/web/src/pages/price-list/usePriceQuotes.ts apps/web/src/pages/price-list/SegmentedToggle.tsx apps/web/src/pages/price-list/parts.tsx apps/web/src/pages/price-list/PriceQuoteCards.tsx apps/web/src/pages/price-list/PriceQuoteTable.tsx apps/web/src/pages/price-list/__tests__/PriceListPage.test.tsx
git commit -m "feat(web): staff price page with model search, hand and origin toggles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: route `/prices` + เมนูถัดจาก "คลังสินค้า" + ค้นหาด่วน

**Files:**
- Modify: `apps/web/src/config/work-navigation.ts` (`NAV_LABELS` — ต่อจาก `stock: 'คลังสินค้า',`)
- Modify: `apps/web/src/config/menu.ts` (5 กลุ่ม: `sales-tools` :287 · `bm-inventory` :353 · `fm-shop-ops` :444 · `acc-reference` :573 · `owner-inventory` :619)
- Modify: `apps/web/src/App.tsx` (lazy import ต่อจาก `InventoryWorkflowPage` :115 · route ต่อจากบรรทัด `/stock/branch-receiving` :457)
- Modify: `apps/web/src/pages/PriceListPage.tsx` (ใช้ `NAV_LABELS.prices`)
- Modify: `apps/web/src/components/CommandPalette.tsx` (import `BadgePercent` + รายการต่อจาก `/stock` :69)
- Modify: `apps/web/e2e/page-smoke.spec.ts` (ต่อจาก `/stock/workflow` :74) · `apps/web/e2e/page-health-check.spec.ts` (ต่อจาก `/stock/workflow` :78)
- Create: `apps/web/src/config/__tests__/menu.prices.test.ts`

**Interfaces:**
- Consumes: `getSidebarForRole`, `resolveZoneForPath` (`config/menu.ts`) · `App.tsx?raw` (แบบเดียวกับ `route-reachability.test.ts`)
- Produces: `NAV_LABELS.prices = 'ราคาและเรทผ่อน'` · route `/prices` (5 ตำแหน่ง) · เมนูทุก role ที่ route อนุญาต · ชื่อ breadcrumb ได้เองจากเมนู (`resolvePageTitle` อ่านเมนูทุก role)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/config/__tests__/menu.prices.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// `?raw` ของ Vite — อ่านซอร์สจริง แบบเดียวกับ route-reachability.test.ts
import appSource from '../../App.tsx?raw';
import { resolvePageTitle } from '@/components/layout/resolvePageTitle';
import { getSidebarForRole, resolveZoneForPath } from '../menu';
import { NAV_LABELS } from '../work-navigation';

/**
 * ช่วง 3 (สเปค 2026-11-19 ข้อ 6) — หน้า "ราคาและเรทผ่อน" ทุกตำแหน่งที่ทำงานหน้าร้านเปิดได้ (รวมพนักงานขาย)
 * เมนูอยู่ถัดจาก "คลังสินค้า" ในกลุ่มเดียวกัน · ACCOUNTANT ไม่มีกลุ่มคลังในโซนร้าน — คลังของบัญชีอยู่ "ข้อมูลอ้างอิง" โซนการเงิน
 */
const ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'];
const PATH = '/prices';

describe('เมนู ราคาและเรทผ่อน', () => {
  it('ชื่อเมนูกลาง', () => {
    expect(NAV_LABELS.prices).toBe('ราคาและเรทผ่อน');
  });

  it.each(ROLES)('%s เห็นเมนูถัดจากคลังสินค้าในกลุ่มเดียวกัน', (role) => {
    const zone = resolveZoneForPath(role, PATH);
    expect(zone).toBe(role === 'ACCOUNTANT' ? 'fin' : 'shop');
    const section = getSidebarForRole(role, zone!).find((s) => s.items.some((i) => i.path === PATH));
    expect(section).toBeDefined();
    const paths = section!.items.map((i) => i.path);
    expect(paths.indexOf(PATH)).toBe(paths.indexOf('/stock') + 1);
    expect(section!.items.find((i) => i.path === PATH)?.label).toBe(NAV_LABELS.prices);
  });

  it('VIEWER (ผู้ตรวจสอบภายนอก) ไม่มีเมนูนี้', () => {
    expect(resolveZoneForPath('VIEWER', PATH)).toBeNull();
  });

  it('route /prices อนุญาต 5 ตำแหน่งเดียวกับเมนู และเปิด PriceListPage', () => {
    const block = appSource.split('path="/prices"')[1]?.split('<Route')[0] ?? '';
    expect(block).toContain('<PriceListPage />');
    const roles = [...(block.match(/roles=\{\[([^\]]*)\]\}/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect([...roles].sort()).toEqual([...ROLES].sort());
  });

  it('breadcrumb ใช้ชื่อเดียวกับเมนู', () => {
    expect(resolvePageTitle(PATH)).toBe('ราคาและเรทผ่อน');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/config/__tests__/menu.prices.test.ts`
Expected: FAIL — `NAV_LABELS.prices` เป็น `undefined` · `resolveZoneForPath(...)` ได้ `null` · ไม่พบ `path="/prices"` ใน App.tsx · breadcrumb ได้ `'รายละเอียด'`

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/config/work-navigation.ts` — ใน `NAV_LABELS` ต่อจากบรรทัด `stock: 'คลังสินค้า',`:

```ts
  stock: 'คลังสินค้า',
  // หน้า "ราคาและเรทผ่อน" (สเปค 2026-11-19 ข้อ 6) — เมนู · ค้นหาด่วน · หัวหน้า ใช้ชื่อนี้ชื่อเดียว
  prices: 'ราคาและเรทผ่อน',
```

`apps/web/src/config/menu.ts` — เพิ่มบรรทัดนี้ **ต่อจากบรรทัด `{ label: NAV_LABELS.stock, path: '/stock', icon: Warehouse },` ใน 5 กลุ่ม** (`sales-tools`, `bm-inventory`, `fm-shop-ops`, `acc-reference`, `owner-inventory` — ไม่แตะ `bottomNav` และ `VIEWER_CONFIG`) · `BadgePercent` import อยู่แล้วที่บรรทัด 37:

```ts
        { label: NAV_LABELS.prices, path: '/prices', icon: BadgePercent },
```

ตัวอย่างกลุ่ม `sales-tools` หลังแก้:

```ts
      items: [
        { label: NAV_LABELS.stock, path: '/stock', icon: Warehouse },
        { label: NAV_LABELS.prices, path: '/prices', icon: BadgePercent },
        { label: 'รายการสินค้า', path: '/stock/products', icon: ClipboardList },
```

`apps/web/src/App.tsx` — lazy import ต่อจาก `const InventoryWorkflowPage = lazy(() => import('@/pages/InventoryWorkflowPage'));`:

```tsx
const PriceListPage = lazy(() => import('@/pages/PriceListPage'));
```

route ต่อจากบรรทัด `<Route path="/stock/branch-receiving" element={<Navigate to="/stock/transfers?view=incoming" replace />} />` (ก่อน `{/* ตรวจสอบสินค้า (Inspections) */}`) — roles ต้องเป็น literal:

```tsx

          {/* ราคาและเรทผ่อน — ทุกตำแหน่งที่ทำงานหน้าร้าน รวมพนักงานขาย (สเปค 2026-11-19 ข้อ 6) */}
          <Route
            path="/prices"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']}>
                <PriceListPage />
              </ProtectedRoute>
            }
          />
```

`apps/web/src/pages/PriceListPage.tsx` — เลิกใช้ค่าคงที่ของตัวเอง:

- เพิ่ม import `import { NAV_LABELS } from '@/config/work-navigation';`
- ลบบรรทัด `const PRICE_LIST_TITLE = 'ราคาและเรทผ่อน';`
- แทน `PRICE_LIST_TITLE` สองที่ (`useDocumentTitle(...)` และ `title={...}`) ด้วย `NAV_LABELS.prices`

`apps/web/src/components/CommandPalette.tsx`:

- ในบล็อก import จาก `lucide-react` เพิ่ม `BadgePercent,` ต่อจาก `Coins,`
- ใน `pages` ต่อจากบรรทัด `{ label: NAV_LABELS.stock, path: '/stock', ... },`:

```tsx
  { label: NAV_LABELS.prices, path: '/prices', icon: BadgePercent, keywords: 'price rate ราคา เรท ผ่อน ดาวน์ ค่างวด gfin', roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'] },
```

`apps/web/e2e/page-smoke.spec.ts` และ `apps/web/e2e/page-health-check.spec.ts` — ต่อจากบรรทัด `{ url: '/stock/workflow', name: 'Inventory Workflow' },` ในทั้งสองไฟล์:

```ts
  { url: '/prices', name: 'ราคาและเรทผ่อน' },
```

- [ ] **Step 4: รันให้ผ่าน (รวมเทสเมนู/route เดิมที่ต้องไม่แดง)**

Run: `cd apps/web && npx vitest run src/config src/components/layout src/components/CommandPalette.test.tsx src/pages/price-list`
Expected: PASS — รวม `route-reachability.test.ts` (A/B ไม่มีช่องว่างใหม่), `menu.test.ts` (ACCOUNTANT/VIEWER โซนร้านเท่าเดิม), `resolvePageTitle.test.ts` (ชื่อหน้าตามเมนูทุก role)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/config/work-navigation.ts apps/web/src/config/menu.ts apps/web/src/App.tsx apps/web/src/pages/PriceListPage.tsx apps/web/src/components/CommandPalette.tsx apps/web/e2e/page-smoke.spec.ts apps/web/e2e/page-health-check.spec.ts apps/web/src/config/__tests__/menu.prices.test.ts
git commit -m "feat(web): /prices route and menu entry next to stock for all shop roles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: หน้าสร้างสัญญา — ป้ายดอกเบี้ยของหมวดที่มีตารางรายงวด (เก็บตก #1798 ก)

ปัญหา: หมวดที่มีแถวรายงวด สัญญาคิดดอกเบี้ยรวมทั้งสัญญาจากแถว (`getRateForMonths`) แต่ป้ายบนสุดของขั้นวางแผนยังโชว์ `4.17% | … | 6-12 เดือน`
(ดอกเบี้ยต่อเดือนที่หารกลับจาก `quote.interestRate` + ช่วงงวดที่เลือกไม่ได้จริง) และแถวรายละเอียดโชว์ `ดอกเบี้ย (4.17% × 12 เดือน)` ·
ใบเสนอราคาของเซิร์ฟเวอร์มี `ratePct` (ดอกเบี้ยรวมทั้งสัญญา — `contract-quote.service.ts:102`) อยู่แล้ว ⇒ ใช้ค่านั้น และใช้ `monthOptions` (งวดที่มีแถว) แทนช่วงต่ำสุด–สูงสุด
หมวดที่ไม่มีตารางรายงวดแสดงแบบเดิมทุกตัวอักษร

**Files:**
- Create: `apps/web/src/pages/ContractCreatePage/rate-label.ts`
- Create: `apps/web/src/pages/ContractCreatePage/rate-label.test.ts`
- Create: `apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.rates.test.tsx`
- Modify: `apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx` (props :34–64 · ป้าย :147–153 · แถวดอกเบี้ย :326–329)
- Modify: `apps/web/src/pages/ContractCreatePage/components/ContractSummaryPanel.tsx` (props · ช่องดอกเบี้ย :41)
- Modify: `apps/web/src/pages/ContractCreatePage/components/ContractSummaryPanel.test.tsx` (ต่อท้ายไฟล์)
- Modify: `apps/web/src/pages/ContractCreatePage/index.tsx` (ส่ง `contractRatePct` ให้ 2 คอมโพเนนต์ :204, :275)

**Interfaces:**
- Consumes: `ContractQuote.ratePct: string` (`packages/shared/src/contract-quote.ts:29`) · `InterestConfig.allowedMonths?: number[]` (`ContractCreatePage/types.ts:48`)
- Produces:
  - `hasTermRates(config: Pick<InterestConfig, 'allowedMonths'> | null | undefined): boolean`
  - `formatRatePct(fraction: number): string`
  - prop ใหม่ `contractRatePct?: number` (เศษส่วน · ค่าเริ่มต้น 0) ใน `PlanDetailsStepProps` และ `ContractSummaryPanelProps`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/pages/ContractCreatePage/rate-label.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatRatePct, hasTermRates } from './rate-label';

describe('hasTermRates', () => {
  it('มี allowedMonths = มีตารางรายงวด', () => {
    expect(hasTermRates({ allowedMonths: [10, 12] })).toBe(true);
  });

  it('ว่าง / ไม่ส่ง / ไม่มีตั้งค่า = ไม่มีตาราง', () => {
    expect(hasTermRates({ allowedMonths: [] })).toBe(false);
    expect(hasTermRates({})).toBe(false);
    expect(hasTermRates(null)).toBe(false);
    expect(hasTermRates(undefined)).toBe(false);
  });
});

describe('formatRatePct', () => {
  it('ตัดศูนย์ท้าย ทศนิยมไม่เกิน 2 ตำแหน่ง', () => {
    expect(formatRatePct(0.5)).toBe('50%');
    expect(formatRatePct(0.425)).toBe('42.5%');
    expect(formatRatePct(0.04166667)).toBe('4.17%');
    expect(formatRatePct(0)).toBe('0%');
  });
});
```

`apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.rates.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InterestConfig } from '../types';
import { PlanDetailsStep, type PlanDetailsStepProps } from './PlanDetailsStep';

const config = (allowedMonths: number[]): InterestConfig => ({
  id: 'ic-1',
  name: 'มือถือมือ 1',
  productCategories: ['PHONE_NEW'],
  interestRate: allowedMonths.length > 0 ? '0' : '0.0417',
  minDownPaymentPct: '0.15',
  storeCommissionPct: '0.10',
  vatPct: '0.07',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  allowedMonths,
});

const props = (cfg: InterestConfig): PlanDetailsStepProps => ({
  selectedProduct: null,
  interestConfig: cfg,
  selectedCustomer: null,
  sellingPrice: 25900,
  downPayment: 3900,
  totalMonths: 12,
  notes: '',
  paymentDueDay: 5,
  minDownPct: 0.15,
  minMonths: 6,
  maxMonths: 12,
  // ค่าจากใบเสนอราคา: interestRate = ratePct ÷ งวด (contract-quote.service.ts:99) · ratePct = ดอกเบี้ยรวมทั้งสัญญา
  interestRate: 0.0417,
  contractRatePct: 0.5,
  storeCommPct: 0.1,
  vatPct: 0.07,
  principal: 22000,
  storeCommission: 2200,
  interestTotal: 11000,
  vatAmount: 2464,
  financedAmount: 37664,
  monthlyPayment: 3138.67,
  monthOptions: (cfg.allowedMonths ?? []).length > 0 ? cfg.allowedMonths! : [6, 7, 8, 9, 10, 11, 12],
  setDownPayment: vi.fn(),
  setDownPaymentTouched: vi.fn(),
  setTotalMonths: vi.fn(),
  setNotes: vi.fn(),
  setPaymentDueDay: vi.fn(),
});

describe('PlanDetailsStep — ป้ายดอกเบี้ย', () => {
  it('มีตารางรายงวด → ดอกเบี้ยรวมทั้งสัญญา + งวดที่เลือกได้ ไม่โชว์ต่อเดือน / ช่วงงวด', async () => {
    await act(async () => {
      render(<PlanDetailsStep {...props(config([10, 12]))} />);
    });
    expect(
      screen.getByText('(ดอกเบี้ย 50% ทั้งสัญญา | ดาวน์ขั้นต่ำ 15% | เลือกได้ 10, 12 เดือน)'),
    ).toBeInTheDocument();
    expect(screen.getByText('+ ดอกเบี้ย (50% ทั้งสัญญา 12 เดือน)')).toBeInTheDocument();
    expect(screen.queryByText(/6-12 เดือน/)).toBeNull();
    expect(screen.queryByText(/4\.17%/)).toBeNull();
  });

  it('ไม่มีตารางรายงวด → แบบเดิม (ต่อเดือน × งวด)', async () => {
    await act(async () => {
      render(<PlanDetailsStep {...props(config([]))} />);
    });
    expect(screen.getByText('(4.17% | ดาวน์ขั้นต่ำ 15% | 6-12 เดือน)')).toBeInTheDocument();
    expect(screen.getByText('+ ดอกเบี้ย (4.17% × 12 เดือน)')).toBeInTheDocument();
  });
});
```

ต่อท้าย `apps/web/src/pages/ContractCreatePage/components/ContractSummaryPanel.test.tsx`:

```tsx

describe('ContractSummaryPanel — ดอกเบี้ย', () => {
  it('มีตารางรายงวด → ดอกเบี้ยรวมทั้งสัญญาของงวดที่เลือก', () => {
    render(
      <ContractSummaryPanel
        {...base}
        totalMonths={12}
        interestRate={0.0417}
        contractRatePct={0.5}
        interestConfig={{
          id: 'ic-1', name: 'มือถือมือ 1', productCategories: ['PHONE_NEW'], interestRate: '0',
          minDownPaymentPct: '0.15', storeCommissionPct: '0.10', vatPct: '0.07',
          minInstallmentMonths: 6, maxInstallmentMonths: 12, allowedMonths: [10, 12],
        }}
      />,
    );
    expect(screen.getByText('50% ทั้งสัญญา (12 เดือน) (มือถือมือ 1)')).toBeInTheDocument();
  });

  it('ไม่มีตาราง → ต่อเดือนแบบเดิม', () => {
    render(<ContractSummaryPanel {...base} />);
    expect(screen.getByText('1.00%')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/ContractCreatePage/rate-label.test.ts src/pages/ContractCreatePage/components/PlanDetailsStep.rates.test.tsx src/pages/ContractCreatePage/components/ContractSummaryPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./rate-label"` · ป้ายยังเป็น `(4.17% | ดาวน์ขั้นต่ำ 15% | 6-12 เดือน)` · สรุปยังเป็น `4.17% (มือถือมือ 1)`

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/pages/ContractCreatePage/rate-label.ts`:

```ts
import type { InterestConfig } from './types';

/**
 * หมวดนี้มีตารางดอกเบี้ยรายงวด (`allowedMonths` ไม่ว่าง) — สัญญาคิดดอกเบี้ยรวมทั้งสัญญาจากแถวของงวด
 * (`getRateForMonths`) ไม่ใช่ดอกเบี้ยต่อเดือน × งวด ⇒ ป้ายต้องโชว์ % ทั้งสัญญาและงวดที่มีแถว
 */
export function hasTermRates(config: Pick<InterestConfig, 'allowedMonths'> | null | undefined): boolean {
  return (config?.allowedMonths?.length ?? 0) > 0;
}

/** เศษส่วน → เปอร์เซ็นต์ ทศนิยมไม่เกิน 2 ตำแหน่ง ตัดศูนย์ท้าย: 0.5 → "50%" · 0.04166667 → "4.17%" */
export function formatRatePct(fraction: number): string {
  return `${Number((fraction * 100).toFixed(2))}%`;
}
```

`apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx`:

1. import ต่อจาก `import { contractPlanSchema, type ContractPlanFormData } from '@/lib/schemas';`:

```tsx
import { formatRatePct, hasTermRates } from '../rate-label';
```

2. ใน `PlanDetailsStepProps` ต่อจาก `interestRate: number;`:

```tsx
  /** ดอกเบี้ยรวมทั้งสัญญาจากใบเสนอราคาของเซิร์ฟเวอร์ (`ContractQuote.ratePct` เศษส่วน: 0.5 = 50%) */
  contractRatePct?: number;
```

3. ใน destructuring ของ `PlanDetailsStep({ ... })` ต่อจาก `interestRate,`:

```tsx
  contractRatePct = 0,
```

4. ต่อจากบรรทัด `const dueDayInputId = useId();`:

```tsx
  const termRates = hasTermRates(interestConfig);
```

5. แทนบล็อกป้าย (เดิม :147–153):

```tsx
        {/* Interest Config Badge */}
        {quoteReady && interestConfig && (
          <div className="bg-primary/5 border border-primary/30 rounded-lg p-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-primary">ใช้ดอกเบี้ยตาม:</span>
            <span className="text-sm font-medium text-primary">{interestConfig.name}</span>
            <span className="text-xs leading-snug text-primary">
              {termRates
                ? `(ดอกเบี้ย ${formatRatePct(contractRatePct)} ทั้งสัญญา | ดาวน์ขั้นต่ำ ${(minDownPct * 100).toFixed(0)}% | เลือกได้ ${monthOptions.join(', ')} เดือน)`
                : `(${(interestRate * 100).toFixed(2)}% | ดาวน์ขั้นต่ำ ${(minDownPct * 100).toFixed(0)}% | ${minMonths}-${maxMonths} เดือน)`}
            </span>
          </div>
        )}
```

6. แทนแถวดอกเบี้ยในรายละเอียดการคำนวณ (เดิม `<span className="text-muted-foreground">+ ดอกเบี้ย ({(interestRate * 100).toFixed(2)}% × {totalMonths} เดือน)</span>`):

```tsx
                    <span className="text-muted-foreground">
                      {termRates
                        ? `+ ดอกเบี้ย (${formatRatePct(contractRatePct)} ทั้งสัญญา ${totalMonths} เดือน)`
                        : `+ ดอกเบี้ย (${(interestRate * 100).toFixed(2)}% × ${totalMonths} เดือน)`}
                    </span>
```

`apps/web/src/pages/ContractCreatePage/components/ContractSummaryPanel.tsx`:

1. บรรทัดแรกเพิ่ม import:

```tsx
import { formatRatePct, hasTermRates } from '../rate-label';
```

2. ใน `ContractSummaryPanelProps` ต่อจาก `interestRate: number;`:

```tsx
  /** ดอกเบี้ยรวมทั้งสัญญาจากใบเสนอราคา (`ContractQuote.ratePct` เศษส่วน) — ใช้เมื่อหมวดมีตารางรายงวด */
  contractRatePct?: number;
```

3. ใน destructuring ต่อจาก `interestRate,`:

```tsx
  contractRatePct = 0,
```

4. ก่อน `return (` เพิ่ม:

```tsx
  const rateText = hasTermRates(interestConfig)
    ? `${formatRatePct(contractRatePct)} ทั้งสัญญา (${totalMonths} เดือน)`
    : `${(interestRate * 100).toFixed(2)}%`;
```

5. ในช่อง "ดอกเบี้ย" แทน `{(interestRate * 100).toFixed(2)}%{interestConfig ? ` (${interestConfig.name})` : ''}` ด้วย:

```tsx
{rateText}{interestConfig ? ` (${interestConfig.name})` : ''}
```

`apps/web/src/pages/ContractCreatePage/index.tsx`:

- ใน `<PlanDetailsStep …>` แทน

```tsx
            interestRate={calculation.interestRate}
            storeCommPct={calculation.storeCommPct}
```

ด้วย

```tsx
            interestRate={calculation.interestRate}
            contractRatePct={Number(quote?.ratePct ?? 0)}
            storeCommPct={calculation.storeCommPct}
```

- ใน `<ContractSummaryPanel …>` แทน

```tsx
              interestRate={calculation.interestRate}
              interestConfig={data.interestConfig}
```

ด้วย

```tsx
              interestRate={calculation.interestRate}
              contractRatePct={Number(quote?.ratePct ?? 0)}
              interestConfig={data.interestConfig}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/ContractCreatePage`
Expected: PASS — รวมเทสต์เดิม (`PlanDetailsStep.payday.test.tsx`, `ContractQuoteFlow.test.tsx`, `useContractCalculation.test.ts`) ไม่แดง

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ContractCreatePage/rate-label.ts apps/web/src/pages/ContractCreatePage/rate-label.test.ts apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.rates.test.tsx apps/web/src/pages/ContractCreatePage/components/ContractSummaryPanel.tsx apps/web/src/pages/ContractCreatePage/components/ContractSummaryPanel.test.tsx apps/web/src/pages/ContractCreatePage/index.tsx
git commit -m "fix(web): contract plan shows whole-contract interest and allowed terms for per-term rates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ตั้งค่าดอกเบี้ย — เว้นดอกเบี้ยต่อเดือน (0/ว่าง) ได้เมื่อมีตารางรายงวด (เก็บตก #1798 ข)

ตรวจฝั่ง API แล้ว: `CreateInterestConfigDto.interestRate` / `UpdateInterestConfigDto.interestRate` เป็น `@Min(0)` (`apps/api/src/modules/interest-config/dto/interest-config.dto.ts`)
และ `InterestConfigService.create/update` ไม่ตรวจเพิ่ม ⇒ **API รับ 0 อยู่แล้ว ไม่ต้องแก้โค้ด API** · ผู้อ่านดอกเบี้ยทุกตัว (`getRateForMonths`, `toBcConfig`, `resolve-bc-config.ts`) ใช้แถวรายงวดก่อน แล้วค่อยใช้ต่อเดือน × งวดเมื่อไม่มีแถว
ช่องว่างของ NumberInput ส่ง `''` → `Number('')` = 0 จึงครอบทั้ง "0" และ "ว่าง"

**Files:**
- Modify: `apps/web/src/pages/interest-config/rate-rows.ts` (เพิ่ม `hasUsableRateRows` ต่อท้ายไฟล์)
- Modify: `apps/web/src/pages/interest-config/rate-rows.test.ts` (import + ต่อท้ายไฟล์)
- Modify: `apps/web/src/pages/InterestConfigPage.tsx` (import :16–21 · `validateForm` :75 · คำอธิบายใต้ช่อง :573 · เงื่อนไขตัวอย่างคำนวณ :650)
- Create: `apps/web/src/pages/InterestConfigPage.monthly-optional.test.tsx`
- Modify: `apps/api/src/modules/interest-config/dto/interest-config.dto.spec.ts` (เทสต์ปักพฤติกรรม — ไม่แก้ DTO)

**Interfaces:**
- Consumes: `validateRateRows(rows, minMonths, maxMonths)` (`rate-rows.ts`)
- Produces: `hasUsableRateRows(rows: RateRowForm[], minMonths: number, maxMonths: number): boolean`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/pages/interest-config/rate-rows.test.ts` — แก้บรรทัด import เป็น:

```ts
import { hasUsableRateRows, previewBcConfig, previewMonths, totalInterestPct, validateRateRows } from './rate-rows';
```

แล้วต่อท้ายไฟล์:

```ts

describe('hasUsableRateRows', () => {
  it('มีอย่างน้อย 1 แถวและผ่านกติกา → true', () => {
    expect(hasUsableRateRows([{ months: 12, ratePct: 50 }], 6, 12)).toBe(true);
  });

  it('ตารางว่าง → false', () => {
    expect(hasUsableRateRows([], 6, 12)).toBe(false);
  });

  it('มีแถวแต่ผิดกติกา (ดอกเบี้ย 0 / นอกช่วง) → false', () => {
    expect(hasUsableRateRows([{ months: 12, ratePct: 0 }], 6, 12)).toBe(false);
    expect(hasUsableRateRows([{ months: 15, ratePct: 60 }], 6, 12)).toBe(false);
  });
});
```

`apps/web/src/pages/InterestConfigPage.monthly-optional.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InterestConfigPage from './InterestConfigPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, put: mocks.put, patch: mocks.patch, delete: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));

const configWithRates = {
  id: 'ic-1',
  name: 'มือ 2',
  productCategories: ['PHONE_USED'],
  interestRate: '0.05',
  minDownPaymentPct: '0.15',
  storeCommissionPct: '0.10',
  vatPct: '0.07',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  rates: [
    { months: 10, ratePct: '0.5' },
    { months: 12, ratePct: '0.5' },
  ],
};

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <InterestConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function editConfig() {
  open();
  await screen.findByText('มือ 2');
  // ปุ่ม "แก้ไข" ตัวแรกเป็นของค่าตั้งต้นระบบ — ตัวที่สองคือการ์ดตั้งค่านี้ (แบบเดียวกับ InterestConfigPage.rates.test.tsx)
  fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[1]);
  await screen.findAllByLabelText('จำนวนงวด');
}

describe('InterestConfigPage — ดอกเบี้ยต่อเดือนเว้นได้เมื่อมีตารางรายงวด', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/settings') return { data: [] };
      if (url === '/interest-configs') return { data: [configWithRates] };
      if (url === '/companies')
        return { data: [{ id: 'f', companyCode: 'FINANCE', vatRegistered: true, vatRate: '0.0700' }] };
      throw new Error(`unexpected ${url}`);
    });
    mocks.put.mockResolvedValue({ data: configWithRates });
  });

  it('มีตาราง + ดอกเบี้ยต่อเดือน 0 → บันทึกได้ ส่ง interestRate 0 พร้อมแถวเดิม', async () => {
    await editConfig();
    fireEvent.change(screen.getByLabelText('ดอกเบี้ยต่อเดือน (%)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(mocks.put.mock.calls[0][1]).toMatchObject({
      interestRate: 0,
      rates: [
        { months: 10, ratePct: 0.5 },
        { months: 12, ratePct: 0.5 },
      ],
    });
  });

  it('มีตาราง + ช่องว่าง → บันทึกเป็น 0', async () => {
    await editConfig();
    fireEvent.change(screen.getByLabelText('ดอกเบี้ยต่อเดือน (%)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(mocks.put.mock.calls[0][1].interestRate).toBe(0);
  });

  it('มีตาราง + ดอกเบี้ยต่อเดือน 0 → ตัวอย่างคำนวณในฟอร์มยังแสดง (ตามแถว 12 งวด 50%)', async () => {
    await editConfig();
    fireEvent.change(screen.getByLabelText('ดอกเบี้ยต่อเดือน (%)'), { target: { value: '0' } });
    // การ์ด 1 ที่ + ตัวอย่างในฟอร์ม 1 ที่
    expect(screen.getAllByText('1,555.06 ฿').length).toBeGreaterThan(1);
  });

  it('ไม่มีตาราง + ดอกเบี้ยต่อเดือน 0 → ข้อความ และไม่บันทึก', async () => {
    await editConfig();
    fireEvent.click(screen.getByRole('button', { name: 'ลบแถว 10 งวด' }));
    fireEvent.click(screen.getByRole('button', { name: 'ลบแถว 12 งวด' }));
    fireEvent.change(screen.getByLabelText('ดอกเบี้ยต่อเดือน (%)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(
      await screen.findByText('ดอกเบี้ยต่อเดือนต้องมากกว่า 0 — หรือใส่ตารางดอกเบี้ยรายงวดอย่างน้อย 1 แถว'),
    ).toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
```

`apps/api/src/modules/interest-config/dto/interest-config.dto.spec.ts` — แก้บรรทัด import เป็น:

```ts
import { CreateInterestConfigDto, UpdateInterestConfigDto } from './interest-config.dto';
```

แล้วต่อท้ายไฟล์:

```ts

describe('ดอกเบี้ยต่อเดือน 0 (ใช้ตารางรายงวดอย่างเดียว) — ปักพฤติกรรมเดิมของ DTO', () => {
  it('CreateInterestConfigDto รับ interestRate 0 พร้อมแถวรายงวด', async () => {
    const dto = plainToInstance(CreateInterestConfigDto, {
      name: 'มือถือมือ 1',
      productCategories: ['PHONE_NEW'],
      interestRate: 0,
      minDownPaymentPct: 0.15,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 12,
      rates: [
        { months: 10, ratePct: 0.5 },
        { months: 12, ratePct: 0.5 },
      ],
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('UpdateInterestConfigDto รับ interestRate 0', async () => {
    expect(await validate(plainToInstance(UpdateInterestConfigDto, { interestRate: 0 }))).toEqual([]);
  });

  it('ยังปฏิเสธค่าติดลบ', async () => {
    expect((await validate(plainToInstance(UpdateInterestConfigDto, { interestRate: -0.01 }))).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม (ฝั่งเว็บ) และผ่าน (ฝั่ง API — ปักของเดิม)**

Run: `cd apps/web && npx vitest run src/pages/interest-config/rate-rows.test.ts src/pages/InterestConfigPage.monthly-optional.test.tsx`
Expected: FAIL — `hasUsableRateRows is not a function` · เทสต์ 0/ว่าง: `put` ไม่ถูกเรียก (ฟอร์มขึ้น "ดอกเบี้ยต้องมากกว่า 0") · ตัวอย่างคำนวณในฟอร์มหาย (เจอ `1,555.06 ฿` ที่การ์ดที่เดียว) · ข้อความใหม่ยังไม่มี

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/interest-config/dto/interest-config.dto.spec.ts`
Expected: PASS (6 tests) — DTO รับ 0 อยู่แล้ว เทสต์นี้กันไม่ให้ใครเปลี่ยนเป็น `@IsPositive` ภายหลัง · ถ้าแดงแปลว่า DTO ปฏิเสธ 0 จริง ให้หยุดแล้วรายงาน (แผนนี้ตั้งอยู่บนผลตรวจว่า DTO เป็น `@Min(0)`)

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/pages/interest-config/rate-rows.ts` — ต่อท้ายไฟล์:

```ts

/**
 * ตารางรายงวดใช้งานได้ (มีอย่างน้อย 1 แถวและผ่านกติกา) — สัญญา/หน้าราคาจะใช้แถวเหล่านี้ทั้งหมด
 * ดอกเบี้ยต่อเดือนจึงเว้นเป็น 0 ได้ (ใช้เฉพาะเมื่อไม่มีตาราง — `getRateForMonths`, `toBcConfig`)
 */
export function hasUsableRateRows(rows: RateRowForm[], minMonths: number, maxMonths: number): boolean {
  return rows.length > 0 && validateRateRows(rows, minMonths, maxMonths) === null;
}
```

`apps/web/src/pages/InterestConfigPage.tsx`:

1. import จาก `./interest-config/rate-rows` เพิ่ม `hasUsableRateRows`:

```tsx
import {
  hasUsableRateRows,
  previewBcConfig,
  previewMonths,
  validateRateRows,
  type RateRowForm,
} from './interest-config/rate-rows';
```

2. ใน `validateForm` แทนบรรทัด `if (form.interestRate <= 0) errors.interestRate = 'ดอกเบี้ยต้องมากกว่า 0';` ด้วย:

```tsx
  // มีตารางรายงวดที่ใช้ได้ = สัญญาใช้แถวทั้งหมด ดอกเบี้ยต่อเดือนเว้นเป็น 0 ได้ (ช่องว่าง = 0)
  const termRatesUsable = hasUsableRateRows(form.rates, form.minInstallmentMonths, form.maxInstallmentMonths);
  if (!(form.interestRate >= 0)) errors.interestRate = 'ดอกเบี้ยต่อเดือนต้องไม่ติดลบ';
  else if (form.interestRate === 0 && !termRatesUsable) {
    errors.interestRate = 'ดอกเบี้ยต่อเดือนต้องมากกว่า 0 — หรือใส่ตารางดอกเบี้ยรายงวดอย่างน้อย 1 แถว';
  }
```

3. คำอธิบายใต้ช่องดอกเบี้ยต่อเดือน แทน `<p className="mt-1 text-xs leading-snug text-muted-foreground">ใช้เมื่อไม่มีตารางดอกเบี้ยรายงวด</p>` ด้วย:

```tsx
                <p className="mt-1 text-xs leading-snug text-muted-foreground">ใช้เมื่อไม่มีตารางดอกเบี้ยรายงวด · มีตารางแล้วเว้นเป็น 0 ได้</p>
```

4. เงื่อนไขตัวอย่างคำนวณในฟอร์ม แทนบรรทัด `if (!form.name || !(form.interestRate > 0) || !(form.minDownPaymentPct > 0)) return null;` ด้วย:

```tsx
              if (!form.name || !(form.minDownPaymentPct > 0)) return null;
              if (
                !(form.interestRate > 0) &&
                !hasUsableRateRows(form.rates, form.minInstallmentMonths, form.maxInstallmentMonths)
              ) return null;
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/interest-config src/pages/InterestConfigPage.rates.test.tsx src/pages/InterestConfigPage.vat.test.tsx src/pages/InterestConfigPage.monthly-optional.test.tsx`
Expected: PASS — เทสต์เดิมของหน้าตั้งค่าดอกเบี้ยไม่แดง

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/interest-config`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/interest-config/rate-rows.ts apps/web/src/pages/interest-config/rate-rows.test.ts apps/web/src/pages/InterestConfigPage.tsx apps/web/src/pages/InterestConfigPage.monthly-optional.test.tsx apps/api/src/modules/interest-config/dto/interest-config.dto.spec.ts
git commit -m "fix(web): interest settings allow a zero monthly rate when per-term rates are set" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ตรวจรวมทั้งช่วง

**Files:** ไม่มีไฟล์ใหม่

- [ ] **Step 1: ตรวจชนิด + เทสต์**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh all
cd apps/web && npx vitest run && cd ../..
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/interest-config src/modules/pricing-templates
```
Expected: TypeScript 0 errors ทั้ง api และ web · เว็บ PASS ทั้งชุด · API PASS
ถ้ามีเทสต์เว็บแดงนอกไฟล์ใน Task 1–5: ดูก่อนว่าเป็นเทสต์ที่ปักรายการเมนู/ป้ายดอกเบี้ยตายตัวหรือไม่ — แก้ได้เฉพาะ assertion ที่ปักรายการเมนูทั้งชุดของ 5 role (เพิ่ม `/prices` ถัดจาก `/stock`) นอกนั้นคือบั๊กของงานนี้ แก้โค้ด ไม่แก้เทสต์

- [ ] **Step 2: ตรวจบนหน้าจอจริง (local · ต้องมี API ช่วง 2 ที่มี `GET /pricing-templates/quotes`)**

เปิด API + เว็บ (`npm run dev` — API ตั้ง `NODE_OPTIONS=--max-old-space-size=8192`) ใส่ราคากลางอย่างน้อย 2 รุ่นมือ 1 และ 2 รุ่นมือ 2 (หนึ่งรุ่นมีราคามีประกัน/ไม่มีประกันต่างกัน) แล้วตรวจทีละข้อ · สลับธีมด้วยปุ่ม "สลับธีม" บนแถบบน · ความกว้างจอใช้ Chrome DevTools (iPhone SE 375px และ 1280px)

หน้า `/prices`:

1. เข้าด้วยบัญชีพนักงานขาย (SALES): เมนู "ราคาและเรทผ่อน" อยู่ใต้ "คลังสินค้า" ในกลุ่ม "เครื่องมือ" · กดแล้วเปิดได้ ไม่โดนเด้ง · breadcrumb/แท็บเบราว์เซอร์ = "ราคาและเรทผ่อน"
2. เข้าด้วย OWNER / ผจก.สาขา / ผจก.การเงิน / บัญชี: เมนูอยู่ถัดจาก "คลังสินค้า" ทุกคน (บัญชีอยู่กลุ่ม "ข้อมูลอ้างอิง" โซนการเงิน)
3. 1280px จอสว่าง: ตาราง หัวสองชั้น (เรท 1 / เรท 2 คลุม 3 คอลัมน์) ตัวเลขชิดขวา · มุมขวาบน "ราคาอัปเดตล่าสุด …" เป็นเวลาไทย
4. 1280px จอมืด: พื้นตาราง/การ์ด/ปุ่มสลับอ่านออก ไม่มีพื้นขาวหลงเหลือ ป้าย "มีประกัน" (เขียวอ่อน) และ "ไม่มีประกัน" (เทา) อ่านออก
5. 375px จอสว่างและจอมืด: เป็นการ์ด (ไม่มีตาราง) · ไม่มีแถบเลื่อนแนวนอนของทั้งหน้า · ช่องค้นเต็มความกว้าง ปุ่มสลับสองชุดตัดบรรทัดได้ ไม่ล้นจอ · ปุ่มสูง ≥ 44px
6. สลับ มือ 1 → มือ 2: รุ่นที่ราคามีประกันต่างกันขึ้นสองแถวพร้อมป้าย · รุ่นที่ราคาเท่ากันขึ้นแถวเดียวไม่มีป้าย · รุ่นที่ GFIN ไม่รับขึ้น "GFIN ไม่รับรุ่นนี้" ในช่องเรท 2
7. สลับ เครื่องไทย → เครื่องนอก: เงินสดและเรท 1 เท่าเดิม · เรท 2 เปลี่ยน (ดาวน์สูงขึ้นหรือเท่าเดิม)
8. พิมพ์ค้น "iPhone 11" (หรือรุ่นที่ไม่มีในตาราง): ขึ้น `ไม่พบ "iPhone 11" ในตารางราคา มือ 1 — ลองสลับเป็นมือ 2 หรือแจ้งเจ้าของให้เพิ่มราคารุ่นนี้` · สลับเป็นมือ 2 ข้อความเปลี่ยนเลขมือ
9. เทียบตัวเลขกับบอทขาย: ถามบอทค่างวดรุ่นเดียวกันแบบเครื่องไทย — ค่างวด/ดาวน์/งวด ตรงกับหน้านี้ (สเปคข้อ 10)
10. ทั้งหน้าไม่มีคำว่า ทุน / กำไร / ราคาส่ง และไม่มีตัวเลขทุน (ดู Network: คำตอบ `/pricing-templates/quotes` ไม่มีช่องทุน)
11. ปิด API ชั่วคราวแล้วรีเฟรช: ขึ้น "โหลดราคาไม่สำเร็จ" + ปุ่ม "ลองใหม่" · เปิด API แล้วกดลองใหม่ได้ข้อมูล

หน้าสร้างสัญญา + ตั้งค่าดอกเบี้ย:

12. ตั้งค่าดอกเบี้ยของหมวดมือถือมือ 1 ให้มีแถว 10 และ 12 งวด (50%) แล้วแก้ "ดอกเบี้ยต่อเดือน" เป็น 0 → บันทึกได้ · ลบแถวทั้งหมดแล้วบันทึกด้วย 0 → ขึ้นข้อความ ไม่บันทึก
13. สร้างสัญญาเครื่องมือ 1 ขั้นวางแผน: ป้ายบนสุดเป็น `(ดอกเบี้ย 50% ทั้งสัญญา | ดาวน์ขั้นต่ำ …% | เลือกได้ 10, 12 เดือน)` · "รายละเอียดการคำนวณ (ภายใน)" เป็น `+ ดอกเบี้ย (50% ทั้งสัญญา 12 เดือน)` · "สรุปสัญญาก่อนยืนยัน" ช่องดอกเบี้ยเป็น `50% ทั้งสัญญา (12 เดือน) (ชื่อตั้งค่า)` · ทั้งจอสว่าง/จอมืด และ 375px ป้ายตัดบรรทัดได้ไม่ล้น
14. หมวดที่ไม่มีแถวรายงวด: ป้ายและรายละเอียดเป็นแบบเดิม (`x.xx% | … | 6-12 เดือน` และ `x.xx% × N เดือน`)

บันทึกผลแต่ละข้อ (ผ่าน / ไม่ผ่าน พร้อมภาพหรือตัวเลขที่เห็น) ไว้ใช้ในข้อความ PR ของ branch `feat/price-master-rest`

---

## สิ่งที่แผนนี้ไม่ทำ

- แท็บเล็ต (`TABLET`): API ช่วง 2 รองรับ แต่หน้าราคามีแค่ มือ 1 / มือ 2 ตามสเปคข้อ 6 — รอเจ้าของตัดสิน
- ปุ่มคัดลอกข้อความตอบลูกค้า (เจ้าของสั่งตัด — สเปคข้อ 1)
- ด่านฝั่ง API ที่บังคับ "ดอกเบี้ยต่อเดือน > 0 เมื่อไม่มีแถวรายงวด" — เดิมก็ไม่มี (DTO `@Min(0)`) หน้าเว็บกันไว้ชั้นเดียวตามเดิม
- `Product.financePrice` · การ์ดราคาขายแบบ D (ช่วง 4)
