# หน้าร้าน: ฟรีดาวน์บนการ์ด + ตัวกรองฟรีดาวน์ (รอบ 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** การ์ดสินค้าหน้าร้าน (โหมดผ่อน) แสดง "แผนเรท 2" เป็นกล่องที่สองเมื่อใช้เงินดาวน์น้อยกว่าเรท 1 (ดาวน์ 0 = "ฟรีดาวน์"), ลูกค้าติ๊กกรองเฉพาะเครื่องฟรีดาวน์ได้, และหน้ารายละเอียดเครื่องเปิดเรท 2 ที่ค่าตั้งต้นเดียวกับการ์ดพร้อมป้ายบอกความต่างของสองเรท

**Architecture:** แยกสูตรเรท 2 ของหน้าร้านออกจาก `InstallmentPreviewService.previewGfin` เป็นฟังก์ชันบริสุทธิ์สองขั้น (`resolveShopGfinPlan` → `computeShopGfinQuote`) ใน util เดียว — หน้ารายละเอียดยังอ่านฐานข้อมูลแบบเดิมแล้วเรียกสองฟังก์ชันนี้ ส่วนหน้ารวมอ่านตั้งค่าเรท 2 ครั้งเดียวต่อคำขอแล้วเรียกฟังก์ชันชุดเดียวกันต่อเครื่อง ตัวเลขสองหน้าจึงมาจากสูตรเดียว ฝั่งเว็บเพิ่ม component `PlanTiles` (กล่องราคา) และสถานะ `?freeDown=1` ใน URL

**Tech Stack:** NestJS + Prisma + decimal.js + jest (API) · React 18 + TanStack Query + Tailwind v4 + vitest/testing-library (web-shop) · สูตรผ่อนใน `packages/shared`

**Spec:** `docs/superpowers/specs/2026-11-25-web-shop-free-down-design.md` (หัวข้อ 3, 4, 5 สถานะ ①③, 7, 8, 9 รอบ 1, 10)

## Global Constraints

- ทำใน worktree `d:\BESTCHOICE APP\wt-shop-rate-labels` branch `ui/web-shop-card-rate-labels` เท่านั้น — ทุก path ในแผนนี้นับจาก root ของ worktree
- **ห้าม `git commit` / `git push` / เปิด PR จนกว่าเจ้าของจะสั่งตรง ๆ** — ทุก task จบที่ "Checkpoint" (รันเทสต์) ไม่ใช่ commit
- ห้ามบอกชื่อผู้ให้ผ่อนบนหน้าร้าน: ใช้ "เรท 1" / "เรท 2" · บนการ์ดหน้ารวมไม่มีคำว่า "เรท"
- ไม่แสดงยอดรวมจ่ายทั้งหมด และไม่แสดง % ดาวน์บนการ์ด
- บรรทัดค่างวดบนการ์ดรูปเดียว: `ผ่อน ฿2,890 × 12 งวด` บรรทัดเดียว (`whitespace-nowrap`) ทั้งคอมและมือถือ
- ห้ามส่งราคาส่ง / ส่วนลดดาวน์ของเรท 2 ออก API หน้าร้าน
- ช่องใหม่ของ API เป็น optional ทั้งสองฝั่ง (เว็บใหม่ + API เก่า ต้องไม่พัง)
- สี/ฟอนต์: ใช้โทเคนเดิมของ web-shop เท่านั้น — กล่องฟรีดาวน์ใช้ `bg-sand-50` + `ring-promo/60` + `text-sand-900` · ห้ามใส่ hex ใหม่
- ข้อความ UI ภาษาไทย · `leading-snug` เสมอ · ปุ่ม/ช่องติ๊กสูงอย่างน้อย 44px
- คำสั่งในแผนเป็น PowerShell (Windows)

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/modules/shop-catalog/shop-gfin-quote.util.ts` (สร้าง) | สูตรเรท 2 ของหน้าร้าน: แปลงแถวจากฐาน, เลือกแผน, คิดค่างวด, โหลด context ครั้งเดียว, คิด "แผนเรท 2 ของการ์ด" |
| `apps/api/src/modules/shop-catalog/shop-gfin-quote.util.spec.ts` (สร้าง) | เทสต์ฟังก์ชันบริสุทธิ์ |
| `apps/api/src/modules/shop-catalog/installment-preview.service.ts` (แก้) | `previewGfin` เรียก util แทนสูตรในตัว |
| `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` (แก้) | `rate2` ต่อรายการ, `freeDown`, `freeDownCount` |
| `apps/api/src/modules/shop-catalog/dto/list-products.dto.ts` (แก้) | query `freeDown` |
| `apps/api/src/modules/shop-catalog/shop-catalog.rate2.spec.ts` (สร้าง) | เทสต์หน้ารวม + parity กับ preview |
| `apps/web-shop/src/components/catalog/PlanTiles.tsx` (สร้าง) | กล่องราคาเรท 1 / เรท 2 ของการ์ด |
| `apps/web-shop/src/components/catalog/PlanTiles.test.tsx` (สร้าง) | เทสต์กติกากล่อง |
| `apps/web-shop/src/components/catalog/ProductCard.tsx` (แก้) | ใช้ `PlanTiles` ในโหมดผ่อน |
| `apps/web-shop/src/components/catalog/CatalogResults.tsx` (แก้) | ส่ง `freeDownOnly` |
| `apps/web-shop/src/components/catalog/FilterSidebar.tsx` (แก้) | ช่องติ๊กฟรีดาวน์ในกล่องเงินดาวน์ |
| `apps/web-shop/src/components/catalog/FilterSidebar.freeDown.test.tsx` (สร้าง) | เทสต์ช่องติ๊ก |
| `apps/web-shop/src/pages/catalog-params.ts` (สร้าง) + `.test.ts` | สร้าง query string ของหน้ารวม |
| `apps/web-shop/src/pages/CatalogPage.tsx` (แก้) | สถานะ `?freeDown=1`, ช่องติ๊กบนแถบมือถือ |
| `apps/web-shop/src/components/installment-compare.ts` (สร้าง) + `.test.ts` | ป้ายเทียบสองเรท |
| `apps/web-shop/src/components/InstallmentCalculatorCard.tsx` (แก้) + `.test.tsx` | เรท 2 ไม่ส่ง % ดาวน์จนกว่าลูกค้าจะแก้, ป้าย, หน้าตาฟรีดาวน์ |

---

### Task 0: เตรียมเครื่องมือใน worktree

**Files:** ไม่มีไฟล์ในโปรเจกต์เปลี่ยน

- [ ] **Step 1: สร้าง Prisma client และ build แพ็กเกจ shared** (worktree ติดตั้งด้วย `--ignore-scripts` จึงยังไม่มี)

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels\apps\api"
npx prisma generate
npx prisma generate --schema=prisma-finance/schema.prisma
cd ..\..
npm run build --workspace=packages/shared
```

Expected: ทั้งสามคำสั่งจบโดยไม่มี error (`✔ Generated Prisma Client` สองครั้ง)

- [ ] **Step 2: ยืนยันว่าเทสต์ปัจจุบันเขียว (baseline)**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels"
npm --prefix apps/api test -- src/modules/shop-catalog
npm --prefix apps/web-shop test
```

Expected: API — ทุก suite ใต้ `shop-catalog` PASS · web-shop — `Tests  41 passed` (หรือมากกว่า) ไม่มี FAIL
จดจำนวนเทสต์ที่ผ่านไว้เทียบตอนจบ

---

### Task 1: สูตรเรท 2 ของหน้าร้านเป็นฟังก์ชันบริสุทธิ์ + ให้หน้ารายละเอียดใช้

**Files:**
- Create: `apps/api/src/modules/shop-catalog/shop-gfin-quote.util.ts`
- Create: `apps/api/src/modules/shop-catalog/shop-gfin-quote.util.spec.ts`
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.ts` (import, ลบ `pickDefaultMonths` ในไฟล์, แทนตัว `previewGfin`)
- Test (regression, ห้ามแก้): `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts`

**Interfaces:**
- Consumes: `calcGfinInstallment`, `findGfinMapping`, `findGfinOverpriceRule`, `resolveGfinDownPct` จาก `../../utils/installment-calc.util` · types จาก `../../utils/installment-calc.types` · `commissionPctForCategory`, `GfinSettings` จาก `../gfin-config/gfin-settings.util`
- Produces (Task 2 ใช้):
  - `interface ShopGfinProduct { brand: string | null; model: string; storage: string | null; category: string; deviceOrigin: 'THAI' | 'IMPORTED' | null }`
  - `toGfinMappingRows(rows): GfinModelMappingRow[]` · `toGfinRuleRows(rows): GfinOverpriceRuleRow[]` · `toGfinFactorRow(row): GfinRateFactorRow`
  - `pickDefaultMonths(wanted: number, allowed: number[]): number`
  - `resolveShopGfinPlan(input): ShopGfinPlan | ShopGfinPlanFailure`
  - `computeShopGfinQuote(plan, input): ShopGfinQuoteResult`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `apps/api/src/modules/shop-catalog/shop-gfin-quote.util.spec.ts`:

```ts
import Decimal from 'decimal.js';
import { GFIN_SETTINGS_DEFAULTS, type GfinSettings } from '../gfin-config/gfin-settings.util';
import {
  computeShopGfinQuote,
  pickDefaultMonths,
  resolveShopGfinPlan,
  toGfinFactorRow,
  toGfinMappingRows,
  toGfinRuleRows,
  type ShopGfinProduct,
} from './shop-gfin-quote.util';

// ตัวอย่างเดียวกับ installment-preview.service.spec.ts "GFIN: returns canonical worked example"
const SETTINGS: GfinSettings = { ...GFIN_SETTINGS_DEFAULTS, minDownPct: 30 };
const PRODUCT: ShopGfinProduct = {
  brand: 'Apple',
  model: 'iPhone 14 Pro',
  storage: '128GB',
  category: 'PHONE_USED',
  deviceOrigin: 'THAI',
};
const MAPPINGS = toGfinMappingRows([
  {
    id: 'm1',
    gfinSeries: 'iPhone 14',
    gfinVariant: 'Pro',
    storage: '128GB',
    condition: 'HAND_2',
    maxPrice: '21500',
    modelMatchPattern: 'iPhone 14 Pro',
    isActive: true,
  },
]);
const rules = (over: Record<string, unknown> = {}) =>
  toGfinRuleRows([
    {
      id: 'r1',
      label: 'iPhone 14 มือ 2',
      seriesPattern: 'iPhone 14|iPhone 15',
      condition: 'HAND_2',
      allowance: '1000',
      isActive: true,
      ...over,
    },
  ]);
const FACTOR_12 = toGfinFactorRow({
  months: 12,
  shopCommissionPct: 15,
  factor: '0.179238',
  feePerInstallment: '100',
  isActive: true,
});

function plan(over: Partial<Parameters<typeof resolveShopGfinPlan>[0]> = {}) {
  return resolveShopGfinPlan({
    product: PRODUCT,
    settings: SETTINGS,
    mappings: MAPPINGS,
    rules: rules(),
    factorMonths: [12],
    templateMonths: null,
    ...over,
  });
}

describe('pickDefaultMonths', () => {
  it('ตรงในรายการ → ใช้เลย · ไม่ตรง → งวดมากสุดที่ไม่เกิน · ต่ำกว่าทุกตัว → งวดแรก', () => {
    expect(pickDefaultMonths(12, [10, 12, 15])).toBe(12);
    expect(pickDefaultMonths(15, [10, 12])).toBe(12);
    expect(pickDefaultMonths(6, [10, 12])).toBe(10);
    expect(pickDefaultMonths(12, [])).toBe(12);
  });
});

describe('resolveShopGfinPlan', () => {
  it('ไม่มีราคากลางของรุ่น → no_gfin_mapping', () => {
    const r = plan({ product: { ...PRODUCT, model: 'iPhone 8' } });
    expect(r).toEqual({ ok: false, reason: 'no_gfin_mapping' });
  });

  it('มีราคากลางแต่ไม่มีเงื่อนไขของรุ่น → no_gfin_rule', () => {
    expect(plan({ rules: [] })).toEqual({ ok: false, reason: 'no_gfin_rule' });
  });

  it('งวดตั้งต้น = งวดของราคากลาง ถ้าไม่มีใช้เพดานของรุ่น · ดาวน์ขั้นต่ำจากค่าตั้ง', () => {
    const r = plan({ factorMonths: [10, 12, 15], templateMonths: 15, rules: rules({ maxMonths: 12 }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.allowedMonths).toEqual([10, 12]);
    expect(r.defaultMonths).toBe(12);
    expect(r.months).toBe(12);
    expect(r.commissionPct).toBe(15);
    expect(r.minDownPct.toString()).toBe('0.3');
  });

  it('ขอเกินเพดานงวดของรุ่น → months_over_max พร้อมงวดที่เลือกได้', () => {
    const r = plan({ factorMonths: [10, 12, 15], rules: rules({ maxMonths: 12 }), requestedMonths: 15 });
    expect(r).toEqual({ ok: false, reason: 'months_over_max', allowedMonths: [10, 12], defaultMonths: 12 });
  });

  it('เงื่อนไขของรุ่นตั้งดาวน์ขั้นต่ำเอง → ใช้ค่านั้นแทนค่าตั้ง', () => {
    const r = plan({ rules: rules({ minDownPct: 25 }) });
    expect(r.ok && r.minDownPct.toString()).toBe('0.25');
  });
});

describe('computeShopGfinQuote', () => {
  const quote = (salePrice: string, over: Record<string, unknown> = {}) => {
    const p = plan();
    if (!p.ok) throw new Error('plan failed');
    return computeShopGfinQuote(p, {
      product: PRODUCT,
      salePrice: new Decimal(salePrice),
      settings: SETTINGS,
      factor: FACTOR_12,
      ...over,
    });
  };

  it('ตัวอย่างหลัก: ราคา 19,900 → ดาวน์ 4,200 ผ่อน 2,923 × 12', () => {
    // ราคาส่ง 22,500 · ดาวน์ตามสูตร 6,750 − ส่วนต่าง 2,600 = 4,150 → ปัดขึ้นหลักร้อย 4,200
    expect(quote('19900')).toEqual({
      ok: true,
      monthlyPayment: 2923,
      downAmount: 4200,
      financedAmount: 15750,
      months: 12,
    });
  });

  it('ส่วนต่างราคาครอบดาวน์ทั้งก้อน → ดาวน์ 0 (ฟรีดาวน์) ค่างวดเท่าเดิม', () => {
    // ราคา 15,000 → ส่วนต่าง 7,500 ≥ ดาวน์ตามสูตร 6,750
    expect(quote('15000')).toMatchObject({ ok: true, downAmount: 0, monthlyPayment: 2923, months: 12 });
  });

  it('ไม่ส่ง % ดาวน์ = ดาวน์ขั้นต่ำ · ส่งต่ำกว่าขั้นต่ำ = ยกขึ้นเป็นขั้นต่ำ', () => {
    expect(quote('19900', { downPct: new Decimal('0.10') })).toEqual(quote('19900'));
  });

  it('ส่ง % ดาวน์สูงกว่าขั้นต่ำ → ดาวน์เพิ่ม ยอดจัดลด', () => {
    const r = quote('19900', { downPct: new Decimal('0.50') });
    // ดาวน์ตามสูตร 11,250 − 2,600 = 8,650 → 8,700 · ยอดจัด 11,250
    expect(r).toMatchObject({ ok: true, downAmount: 8700, financedAmount: 11250 });
  });

  it('ไม่มีเรทของงวดนั้น → no_rate_factor', () => {
    expect(quote('19900', { factor: null })).toEqual({ ok: false, reason: 'no_rate_factor' });
  });

  it('เรทไม่ตรงงวดของแผน → invalid พร้อมข้อความ', () => {
    const r = quote('19900', { factor: { ...FACTOR_12, months: 10 } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('invalid');
    expect(!r.ok && r.errors?.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels"
npm --prefix apps/api test -- src/modules/shop-catalog/shop-gfin-quote.util.spec.ts
```

Expected: FAIL — `Cannot find module './shop-gfin-quote.util'`

- [ ] **Step 3: เขียน util**

สร้าง `apps/api/src/modules/shop-catalog/shop-gfin-quote.util.ts`:

```ts
import Decimal from 'decimal.js';
import {
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  resolveGfinDownPct,
} from '../../utils/installment-calc.util';
import type {
  GfinCondition,
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  GfinRateFactorRow,
  ProductCategoryForGfin,
} from '../../utils/installment-calc.types';
import { commissionPctForCategory, type GfinSettings } from '../gfin-config/gfin-settings.util';

/**
 * สูตร "เรท 2" ของหน้าร้าน (เว็บ shop) — ที่เดียวของทั้งหน้ารายละเอียดเครื่อง (`InstallmentPreviewService`)
 * และการ์ดหน้ารวม (`ShopCatalogService`) · สเปค 2026-11-25 หัวข้อ 8
 * ฟังก์ชันในไฟล์นี้ไม่อ่านฐานข้อมูล ยกเว้น `loadShopGfinContext`
 */

type Numeric = { toString(): string };

/** ข้อมูลเครื่องเท่าที่สูตรเรท 2 ใช้ */
export interface ShopGfinProduct {
  brand: string | null;
  model: string;
  storage: string | null;
  category: string;
  deviceOrigin: 'THAI' | 'IMPORTED' | null;
}

export function shopGfinCategory(category: string): ProductCategoryForGfin {
  return category === 'TABLET' ? 'TABLET' : category === 'PHONE_NEW' ? 'PHONE_NEW' : 'PHONE_USED';
}

export function toGfinMappingRows(
  rows: Array<{
    id: string;
    gfinSeries: string;
    gfinVariant: string | null;
    storage: string;
    condition: string;
    maxPrice: Numeric;
    modelMatchPattern: string;
    isActive: boolean;
  }>,
): GfinModelMappingRow[] {
  return rows.map((m) => ({
    id: m.id,
    gfinSeries: m.gfinSeries,
    gfinVariant: m.gfinVariant,
    storage: m.storage,
    condition: m.condition as GfinCondition,
    maxPrice: new Decimal(m.maxPrice.toString()),
    modelMatchPattern: m.modelMatchPattern,
    isActive: m.isActive,
  }));
}

export function toGfinRuleRows(
  rows: Array<{
    id: string;
    label: string;
    seriesPattern: string;
    condition: string;
    allowance: Numeric;
    maxMonths?: number | null;
    minDownPct?: number | null;
    isActive: boolean;
  }>,
): GfinOverpriceRuleRow[] {
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    seriesPattern: r.seriesPattern,
    condition: r.condition as GfinCondition,
    allowance: new Decimal(r.allowance.toString()),
    maxMonths: r.maxMonths ?? null,
    minDownPct: r.minDownPct ?? null,
    isActive: r.isActive,
  }));
}

export function toGfinFactorRow(row: {
  months: number;
  shopCommissionPct: number;
  factor: Numeric;
  feePerInstallment: Numeric;
  isActive: boolean;
}): GfinRateFactorRow {
  return {
    months: row.months,
    shopCommissionPct: Number(row.shopCommissionPct),
    factor: new Decimal(row.factor.toString()),
    feePerInstallment: new Decimal(row.feePerInstallment.toString()),
    isActive: row.isActive,
  };
}

/** งวดตั้งต้นที่ใช้ได้จริง: ตรงในรายการ → ใช้เลย · ไม่ตรง → งวดมากสุดที่ไม่เกิน · ไม่มีเลย → งวดแรก */
export function pickDefaultMonths(wanted: number, allowed: number[]): number {
  if (allowed.length === 0 || allowed.includes(wanted)) return wanted;
  const below = allowed.filter((m) => m <= wanted);
  return below.length > 0 ? below[below.length - 1] : allowed[0];
}

export interface ShopGfinPlan {
  ok: true;
  mapping: GfinModelMappingRow;
  rule: GfinOverpriceRuleRow;
  commissionPct: number;
  /** งวดที่จะคิด (ที่ขอมา หรืองวดตั้งต้น) */
  months: number;
  allowedMonths: number[];
  defaultMonths: number;
  /** ดาวน์ขั้นต่ำของเรท 2 เป็นสัดส่วน (0.30) */
  minDownPct: Decimal;
}

export interface ShopGfinPlanFailure {
  ok: false;
  reason: 'no_gfin_mapping' | 'no_gfin_rule' | 'months_over_max';
  allowedMonths?: number[];
  defaultMonths?: number;
}

/**
 * ขั้นที่ 1 — หาราคากลาง/เงื่อนไขของรุ่น แล้วตัดสินงวดกับดาวน์ขั้นต่ำ
 * `templateMonths` = งวดเรท 2 ของราคากลาง (null = ไม่มี → ใช้เพดานงวดของรุ่น ไม่มีอีก = 12)
 */
export function resolveShopGfinPlan(input: {
  product: ShopGfinProduct;
  settings: GfinSettings;
  mappings: GfinModelMappingRow[];
  rules: GfinOverpriceRuleRow[];
  /** งวดที่มีเรทของ % คอมหมวดนี้ */
  factorMonths: number[];
  templateMonths: number | null;
  /** ไม่ส่ง = งวดตั้งต้น */
  requestedMonths?: number;
}): ShopGfinPlan | ShopGfinPlanFailure {
  const { product, settings } = input;
  const mapping = findGfinMapping(
    {
      brand: product.brand ?? '',
      model: product.model,
      storage: product.storage ?? '',
      category: shopGfinCategory(product.category),
    },
    input.mappings,
  );
  if (!mapping) return { ok: false, reason: 'no_gfin_mapping' };

  const rule = findGfinOverpriceRule(mapping, input.rules);
  // สเปก 2026-11-20 §4: มีราคาแต่ไม่มีเงื่อนไขของรุ่น = ยังคิดไม่ได้
  if (!rule) return { ok: false, reason: 'no_gfin_rule' };

  const allowedMonths = [...new Set(input.factorMonths)]
    .filter((m) => rule.maxMonths == null || m <= rule.maxMonths)
    .sort((a, b) => a - b);
  const defaultMonths = pickDefaultMonths(input.templateMonths ?? rule.maxMonths ?? 12, allowedMonths);
  const months = input.requestedMonths ?? defaultMonths;
  if (rule.maxMonths != null && months > rule.maxMonths) {
    return { ok: false, reason: 'months_over_max', allowedMonths, defaultMonths };
  }

  return {
    ok: true,
    mapping,
    rule,
    commissionPct: commissionPctForCategory(settings, product.category),
    months,
    allowedMonths,
    defaultMonths,
    minDownPct: resolveGfinDownPct(rule, new Decimal(settings.minDownPct).div(100)),
  };
}

export type ShopGfinQuoteResult =
  | { ok: true; monthlyPayment: number; downAmount: number; financedAmount: number; months: number }
  | { ok: false; reason: 'no_rate_factor' | 'invalid'; errors?: string[] };

/**
 * ขั้นที่ 2 — คิดดาวน์/ค่างวดของแผน · `factor` = เรทของ (งวดของแผน, % คอมของแผน) ผู้เรียกหามาให้
 * `downPct` เป็นสัดส่วน (0.30) — ไม่ส่ง = ดาวน์ขั้นต่ำของเรท 2 · ต่ำกว่าขั้นต่ำถูกยกขึ้น
 * ผลลัพธ์ไม่มีราคาส่ง/ส่วนลดดาวน์ (ห้ามออกหน้าร้าน)
 */
export function computeShopGfinQuote(
  plan: ShopGfinPlan,
  input: {
    product: ShopGfinProduct;
    salePrice: Decimal;
    settings: GfinSettings;
    factor: GfinRateFactorRow | null;
    downPct?: Decimal;
  },
): ShopGfinQuoteResult {
  if (!input.factor) return { ok: false, reason: 'no_rate_factor' };
  const downPct =
    input.downPct !== undefined ? Decimal.max(input.downPct, plan.minDownPct) : plan.minDownPct;

  const result = calcGfinInstallment({
    installmentPrice: input.salePrice,
    product: {
      brand: input.product.brand ?? '',
      model: input.product.model,
      storage: input.product.storage ?? '',
      category: shopGfinCategory(input.product.category),
    },
    months: plan.months,
    downPct,
    shopCommissionPct: new Decimal(plan.commissionPct),
    contractFee: new Decimal(input.settings.contractFee),
    mapping: plan.mapping,
    overpriceRule: plan.rule,
    // เรท 2 ให้ส่วนเกินราคาเต็มเฉพาะเครื่องไทย — เครื่องนอก/ยังไม่ระบุได้ครึ่งเดียว
    deviceOrigin: input.product.deviceOrigin,
    rateFactor: input.factor,
  });
  if (!result.isValid) return { ok: false, reason: 'invalid', errors: result.errors };

  return {
    ok: true,
    monthlyPayment: result.monthlyPayment.toNumber(),
    downAmount: result.downAmountActual.toNumber(),
    financedAmount: result.financedAmount.toNumber(),
    months: plan.months,
  };
}
```

- [ ] **Step 4: รันเทสต์ util ให้ผ่าน**

```powershell
npm --prefix apps/api test -- src/modules/shop-catalog/shop-gfin-quote.util.spec.ts
```

Expected: PASS ทุกเทสต์ (12 เทสต์)

- [ ] **Step 5: ให้ `previewGfin` ใช้ util**

แก้ `apps/api/src/modules/shop-catalog/installment-preview.service.ts`:

(ก) แทน import ของ `installment-calc.util` (บรรทัด 5–11) ด้วย:

```ts
import { calcBcInstallment } from '../../utils/installment-calc.util';
```

(ข) เพิ่ม import ต่อจากบรรทัด `import { InstallmentPreviewDto } ...`:

```ts
import {
  computeShopGfinQuote,
  resolveShopGfinPlan,
  toGfinFactorRow,
  toGfinMappingRows,
  toGfinRuleRows,
} from './shop-gfin-quote.util';
```

(ค) ลบฟังก์ชัน `pickDefaultMonths` ในไฟล์นี้ทั้งก้อน (คอมเมนต์ `/** งวดตั้งต้นที่ใช้ได้จริง ... */` ถึงปีกกาปิด) — ย้ายไป util แล้ว

(ง) แทนตัวเมธอด `previewGfin` ตั้งแต่บรรทัด `// เรทของ GFIN ขึ้นกับ (จำนวนงวด, %คอมที่ร้านเลือก)` ถึงปีกกาปิดของเมธอด ด้วย:

```ts
    // เรท 2 ขึ้นกับ (จำนวนงวด, %คอมที่ร้านเลือก) — เว็บร้านใช้คอมตั้งต้นตามหมวด (มือถือ 15 · iPad 5)
    const settings = await loadGfinSettings(this.prisma);
    const commissionPct = commissionPctForCategory(settings, product.category);

    const [mappings, rules, factorMonths] = await Promise.all([
      this.prisma.gfinModelMapping.findMany({
        where: { deletedAt: null, isActive: true },
      }),
      this.prisma.gfinOverpriceRule.findMany({
        where: { deletedAt: null, isActive: true },
      }),
      this.prisma.gfinRateFactor.findMany({
        where: { shopCommissionPct: commissionPct, deletedAt: null, isActive: true },
        select: { months: true },
      }),
    ]);

    // งวดตั้งต้น = งวดเรท 2 ของราคากลาง ไม่มีแล้วเพดานของรุ่น (สูตรเดียวกับหน้า "ราคาและเรทผ่อน" / บอท / สติกเกอร์)
    const terms = (
      await loadTemplateTerms(this.prisma, [{ ...product, brand: product.brand ?? '' }])
    ).get(product.id);
    const templateMonths =
      terms?.rate2TermMonths && terms.rate2TermMonths > 0 ? terms.rate2TermMonths : null;

    const plan = resolveShopGfinPlan({
      product,
      settings,
      mappings: toGfinMappingRows(mappings),
      rules: toGfinRuleRows(rules),
      factorMonths: factorMonths.map((f) => f.months),
      templateMonths,
      requestedMonths: dto.months,
    });
    if (!plan.ok) {
      return plan.allowedMonths
        ? {
            available: false,
            reason: plan.reason,
            allowedMonths: plan.allowedMonths,
            defaultMonths: plan.defaultMonths,
          }
        : { available: false, reason: plan.reason };
    }
    const termInfo = { allowedMonths: plan.allowedMonths, defaultMonths: plan.defaultMonths };

    const factor = await this.prisma.gfinRateFactor.findFirst({
      where: { months: plan.months, shopCommissionPct: commissionPct, deletedAt: null, isActive: true },
    });

    // เว็บ shop ส่ง % เดียวกับเรท 1 มาได้ — เรท 2 ไม่รับดาวน์ต่ำกว่าขั้นต่ำ จึงยกขึ้นเป็นขั้นต่ำ (ใน computeShopGfinQuote)
    const quote = computeShopGfinQuote(plan, {
      product,
      salePrice: installmentPrice,
      settings,
      factor: factor ? toGfinFactorRow(factor) : null,
      downPct: dto.downPct !== undefined ? new Decimal(dto.downPct) : undefined,
    });
    if (!quote.ok) {
      return quote.errors
        ? { available: false, reason: quote.reason, errors: quote.errors, ...termInfo }
        : { available: false, reason: quote.reason, ...termInfo };
    }

    return {
      available: true,
      provider: 'GFIN',
      monthlyPayment: quote.monthlyPayment,
      downAmount: quote.downAmount,
      financedAmount: quote.financedAmount,
      months: quote.months,
      ...termInfo,
      // ราคาส่ง / ส่วนลดดาวน์ไม่ออกเว็บร้าน
    };
  }
```

หมายเหตุ: พารามิเตอร์ของเมธอด (`product`, `installmentPrice`, `dto`) ไม่เปลี่ยน · ตัวแปร `gfinCategory` ในเมธอดเดิมไม่ใช้แล้ว ให้ลบ

- [ ] **Step 6: รันเทสต์เดิมของหน้ารายละเอียด — ต้องผ่านโดยไม่แก้เทสต์**

```powershell
npm --prefix apps/api test -- src/modules/shop-catalog/installment-preview.service.spec.ts src/modules/shop-catalog/shop-catalog.installment-parity.spec.ts
```

Expected: PASS ทุกเทสต์ จำนวนเท่า baseline (ห้ามแก้ไฟล์ spec สองไฟล์นี้ — ถ้าแดง แปลว่าการย้ายเปลี่ยนพฤติกรรม ให้แก้ service)

- [ ] **Step 7: ตรวจ type**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels\apps\api"; npx tsc --noEmit -p tsconfig.json; cd ..\..
```

Expected: ไม่มี error

- [ ] **Step 8: Checkpoint** — รายงานผล Step 4, 6, 7 · ไม่ commit

---

### Task 2: หน้ารวมคิด "แผนเรท 2" ต่อการ์ด + กรองฟรีดาวน์

**Files:**
- Modify: `apps/api/src/modules/shop-catalog/shop-gfin-quote.util.ts` (เพิ่มท้ายไฟล์)
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`
- Modify: `apps/api/src/modules/shop-catalog/dto/list-products.dto.ts`
- Create: `apps/api/src/modules/shop-catalog/shop-catalog.rate2.spec.ts`

**Interfaces:**
- Consumes (Task 1): `resolveShopGfinPlan`, `computeShopGfinQuote`, `toGfinMappingRows`, `toGfinRuleRows`, `toGfinFactorRow`, `ShopGfinProduct`
- Produces (Task 3–4 ใช้ผ่าน HTTP `GET /api/shop/products`):
  - รายการทุกแบบมี `rate2: { down: number; monthly: number; months: number } | null`
  - คำตอบมี `freeDownCount: number`
  - query `freeDown=true` (หรือ `1`) → เหลือเฉพาะรายการที่ `rate2.down === 0`
- Produces (ในโค้ด): `interface CardRate2 { down: number; monthly: number; months: number }` · `loadShopGfinContext(prisma)` · `quoteCardRate2(ctx, product, salePrice, templateMonths)` · `shopGfinSalePrice(p)`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `apps/api/src/modules/shop-catalog/shop-catalog.rate2.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { ShopCatalogService } from './shop-catalog.service';
import { InstallmentPreviewService } from './installment-preview.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListProductsDto } from './dto/list-products.dto';

/** สเปค 2026-11-25: แผนเรท 2 บนการ์ดหน้ารวม = เรท 2 ของหน้ารายละเอียดที่ค่าตั้งต้น */
function usedUnit(over: Record<string, unknown> = {}) {
  return {
    id: 'u-free',
    brand: 'Apple',
    model: 'iPhone 14 Pro',
    storage: '128GB',
    color: 'ดำ',
    category: 'PHONE_USED',
    deviceOrigin: 'THAI',
    cashPrice: 14000,
    installmentPrice: 15000,
    financePrice: null,
    conditionGrade: 'A',
    batteryHealth: null,
    hasBox: null,
    warrantyExpireDate: null,
    warrantyExpired: null,
    stockInDate: null,
    imeiSerial: null,
    gallery: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

const INTEREST_CONFIG = {
  id: 'c1',
  minDownPaymentPct: new Prisma.Decimal('0.15'),
  storeCommissionPct: new Prisma.Decimal('0.10'),
  vatPct: new Prisma.Decimal('0.07'),
  minInstallmentMonths: 5,
  maxInstallmentMonths: 12,
  interestRate: new Prisma.Decimal('0.0417'),
  rates: [{ months: 12, ratePct: new Prisma.Decimal('0.50'), deletedAt: null }],
};
const MAPPING_USED = {
  id: 'm1',
  gfinSeries: 'iPhone 14',
  gfinVariant: 'Pro',
  storage: '128GB',
  condition: 'HAND_2',
  maxPrice: new Prisma.Decimal('21500'),
  modelMatchPattern: 'iPhone 14 Pro',
  isActive: true,
};
const MAPPING_NEW = { ...MAPPING_USED, id: 'm2', condition: 'HAND_1' };
const RULE_USED = {
  id: 'r1',
  label: 'iPhone 14 มือ 2',
  seriesPattern: 'iPhone 14|iPhone 15',
  condition: 'HAND_2',
  allowance: new Prisma.Decimal('1000'),
  maxMonths: null,
  minDownPct: null,
  isActive: true,
};
const RULE_NEW = { ...RULE_USED, id: 'r2', label: 'iPhone 14 มือ 1', condition: 'HAND_1' };
const FACTOR = {
  months: 12,
  shopCommissionPct: 15,
  factor: new Prisma.Decimal('0.179238'),
  feePerInstallment: new Prisma.Decimal('100'),
  isActive: true,
};

describe('หน้ารวม: แผนเรท 2 ของการ์ด + ตัวกรองฟรีดาวน์', () => {
  let catalog: ShopCatalogService;
  let preview: InstallmentPreviewService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      interestConfig: { findFirst: jest.fn().mockResolvedValue(INTEREST_CONFIG) },
      companyInfo: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ vatRegistered: true, vatRate: new Prisma.Decimal('0.07') }),
      },
      gfinModelMapping: { findMany: jest.fn().mockResolvedValue([MAPPING_USED, MAPPING_NEW]) },
      gfinOverpriceRule: { findMany: jest.fn().mockResolvedValue([RULE_USED, RULE_NEW]) },
      gfinRateFactor: {
        findMany: jest.fn().mockResolvedValue([FACTOR]),
        findFirst: jest.fn().mockResolvedValue(FACTOR),
      },
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      // ดาวน์ขั้นต่ำเรท 2 = 30% (ตัวอย่างเดียวกับ installment-preview.service.spec.ts)
      systemConfig: {
        findFirst: jest.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(where.key === 'gfin.minDownPct' ? { value: '30' } : null),
        ),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [ShopCatalogService, InstallmentPreviewService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    catalog = mod.get(ShopCatalogService);
    preview = mod.get(InstallmentPreviewService);
  });

  it('เครื่องมือสอง: ส่วนต่างราคาครอบดาวน์ → rate2.down = 0 · ไม่ครอบ → ดาวน์จริง', async () => {
    prisma.product.findMany.mockResolvedValue([
      usedUnit(),
      usedUnit({ id: 'u-paid', installmentPrice: 19900, cashPrice: 18000 }),
    ]);
    const res = await catalog.listGroupedByModel({});
    const byId = new Map(res.data.map((d) => [d.id, d]));
    expect(byId.get('u-free')!.rate2).toEqual({ down: 0, monthly: 2923, months: 12 });
    expect(byId.get('u-paid')!.rate2).toEqual({ down: 4200, monthly: 2923, months: 12 });
    expect(res.freeDownCount).toBe(1);
  });

  it('มีราคาขายเรท 2 ของเครื่อง (financePrice) → คิดจากราคานั้น ไม่ใช่ราคาผ่อน', async () => {
    prisma.product.findMany.mockResolvedValue([
      usedUnit({ installmentPrice: 19900, financePrice: new Prisma.Decimal('15000') }),
    ]);
    const res = await catalog.listGroupedByModel({});
    expect(res.data[0].rate2).toEqual({ down: 0, monthly: 2923, months: 12 });
  });

  it('เรท 2 คิดไม่ได้ (ไม่มีราคากลางของรุ่น) → rate2 = null การ์ดยังขึ้น', async () => {
    prisma.product.findMany.mockResolvedValue([usedUnit({ model: 'iPhone 8' })]);
    const res = await catalog.listGroupedByModel({});
    expect(res.data).toHaveLength(1);
    expect(res.data[0].rate2).toBeNull();
    expect(res.freeDownCount).toBe(0);
  });

  it('อ่านตั้งค่าเรท 2 ไม่ได้ → ทุกการ์ด rate2 = null แต่หน้ารวมไม่ล้ม', async () => {
    prisma.product.findMany.mockResolvedValue([usedUnit()]);
    prisma.gfinModelMapping.findMany.mockRejectedValue(new Error('db down'));
    const res = await catalog.listGroupedByModel({});
    expect(res.data[0].rate2).toBeNull();
    expect(res.data[0].monthlyPaymentFrom).not.toBeNull();
  });

  it('% ดาวน์และจำนวนงวดของคำขอไม่เปลี่ยน rate2', async () => {
    prisma.product.findMany.mockResolvedValue([usedUnit({ id: 'u-paid', installmentPrice: 19900 })]);
    const base = await catalog.listGroupedByModel({});
    const changed = await catalog.listGroupedByModel({ downPct: 40, months: 12 });
    expect(changed.data[0].rate2).toEqual(base.data[0].rate2);
    expect(changed.data[0].downAmount).not.toBe(base.data[0].downAmount);
  });

  it('freeDown=true → เหลือเฉพาะเครื่องฟรีดาวน์ · กรองก่อนแบ่งหน้า · ตัวนับไม่ขึ้นกับหน้า', async () => {
    prisma.product.findMany.mockResolvedValue([
      usedUnit({ id: 'f1' }),
      usedUnit({ id: 'p1', installmentPrice: 19900 }),
      usedUnit({ id: 'f2' }),
    ]);
    const all = await catalog.listGroupedByModel({ limit: 1, page: 2 });
    expect(all.total).toBe(3);
    expect(all.freeDownCount).toBe(2);

    const free = await catalog.listGroupedByModel({ freeDown: true, limit: 1, page: 2 });
    expect(free.total).toBe(2);
    expect(free.freeDownCount).toBe(2);
    expect(free.data).toHaveLength(1);
    expect(free.data[0].rate2?.down).toBe(0);
  });

  it('การ์ดกลุ่ม (มือ 1): คิดแผนเรท 2 จากเครื่องที่การ์ดลิงก์ไป', async () => {
    prisma.product.groupBy.mockResolvedValue([
      {
        brand: 'Apple',
        model: 'iPhone 14 Pro',
        storage: '128GB',
        category: 'PHONE_NEW',
        deviceOrigin: 'THAI',
        _min: { cashPrice: new Prisma.Decimal('14000'), installmentPrice: new Prisma.Decimal('15000') },
        _max: { createdAt: new Date('2026-01-01T00:00:00Z') },
        _count: { id: 2 },
      },
    ]);
    prisma.product.findFirst.mockResolvedValue({
      id: 's1',
      gallery: [],
      conditionGrade: null,
      installmentPrice: new Prisma.Decimal('15000'),
      financePrice: null,
      warrantyExpired: null,
      warrantyExpireDate: null,
    });
    const res = await catalog.listGroupedByModel({ condition: 'NEW' });
    expect(res.data[0].kind).toBe('GROUP');
    expect(res.data[0].rate2).toEqual({ down: 0, monthly: 2923, months: 12 });
  });

  it('parity: rate2 ของการ์ด = หน้ารายละเอียดที่ไม่ส่งงวด/ดาวน์ (ปัดขึ้นเป็นบาทเต็ม)', async () => {
    prisma.product.findMany.mockResolvedValue([usedUnit({ id: 'rep', installmentPrice: 19900 })]);
    prisma.product.findFirst.mockResolvedValue({
      id: 'rep',
      installmentPrice: new Prisma.Decimal('19900'),
      financePrice: null,
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deviceOrigin: 'THAI',
      warrantyExpired: null,
      warrantyExpireDate: null,
      deletedAt: null,
    });
    const list = await catalog.listGroupedByModel({});
    const detail = await preview.preview({ productId: 'rep', provider: 'GFIN' });
    expect(detail.available).toBe(true);
    expect(list.data[0].rate2).toEqual({
      down: Math.ceil(detail.downAmount!),
      monthly: Math.ceil(detail.monthlyPayment!),
      months: detail.months,
    });
  });
});

describe('ListProductsDto.freeDown', () => {
  // ValidationPipe กลางเปิด enableImplicitConversion — สตริง "false" ต้องไม่กลายเป็น true
  const parse = (raw: Record<string, unknown>) =>
    plainToInstance(ListProductsDto, raw, { enableImplicitConversion: true }).freeDown;

  it('true / 1 = เปิด · อย่างอื่น = ปิด · ไม่ส่ง = undefined', () => {
    expect(parse({ freeDown: 'true' })).toBe(true);
    expect(parse({ freeDown: '1' })).toBe(true);
    expect(parse({ freeDown: 'false' })).toBe(false);
    expect(parse({ freeDown: '0' })).toBe(false);
    expect(parse({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

```powershell
npm --prefix apps/api test -- src/modules/shop-catalog/shop-catalog.rate2.spec.ts
```

Expected: FAIL — `rate2` เป็น `undefined`, `freeDownCount` เป็น `undefined`, TypeScript ฟ้อง `freeDown` ไม่มีใน type

- [ ] **Step 3: เพิ่มส่วนโหลด context + แผนของการ์ดใน util**

ต่อท้าย `apps/api/src/modules/shop-catalog/shop-gfin-quote.util.ts`:

```ts
// ── หน้ารวมสินค้า: อ่านตั้งค่าครั้งเดียวต่อคำขอ แล้วคิดทุกการ์ดในหน่วยความจำ ──

export interface ShopGfinContext {
  settings: GfinSettings;
  mappings: GfinModelMappingRow[];
  rules: GfinOverpriceRuleRow[];
  /** เรทที่เปิดใช้ทุก (งวด, % คอม) */
  factors: GfinRateFactorRow[];
}

type FindMany<T> = { findMany(args: { where: { deletedAt: null; isActive: true } }): Promise<T[]> };

export interface ShopGfinReader {
  systemConfig: Parameters<typeof loadGfinSettings>[0]['systemConfig'];
  gfinModelMapping: FindMany<Parameters<typeof toGfinMappingRows>[0][number]>;
  gfinOverpriceRule: FindMany<Parameters<typeof toGfinRuleRows>[0][number]>;
  gfinRateFactor: FindMany<Parameters<typeof toGfinFactorRow>[0]>;
}

export async function loadShopGfinContext(prisma: ShopGfinReader): Promise<ShopGfinContext> {
  const where = { deletedAt: null, isActive: true } as const;
  const [settings, mappings, rules, factors] = await Promise.all([
    loadGfinSettings(prisma),
    prisma.gfinModelMapping.findMany({ where }),
    prisma.gfinOverpriceRule.findMany({ where }),
    prisma.gfinRateFactor.findMany({ where }),
  ]);
  return {
    settings,
    mappings: toGfinMappingRows(mappings),
    rules: toGfinRuleRows(rules),
    factors: factors.map(toGfinFactorRow),
  };
}

/** ราคาที่ใช้คิดเรท 2: ราคาขายเรท 2 ของเครื่องถ้ามี ไม่งั้นราคาผ่อน (กติกาเดียวกับหน้ารายละเอียด) */
export function shopGfinSalePrice(p: {
  financePrice?: Numeric | null;
  installmentPrice?: Numeric | null;
}): Decimal | null {
  const finance = p.financePrice != null ? new Decimal(p.financePrice.toString()) : null;
  if (finance && finance.gt(0)) return finance;
  const installment = p.installmentPrice != null ? new Decimal(p.installmentPrice.toString()) : null;
  return installment && installment.gt(0) ? installment : null;
}

/** แผนเรท 2 ที่การ์ดหน้ารวมแสดง — ดาวน์/ค่างวดปัดขึ้นเป็นบาทเต็ม (แบบเดียวกับเรท 1 บนการ์ด) */
export interface CardRate2 {
  down: number;
  monthly: number;
  months: number;
}

/**
 * แผนเรท 2 ของการ์ด = เรท 2 ที่ค่าตั้งต้น (งวดตั้งต้นของเครื่อง + ดาวน์ขั้นต่ำของเรท 2)
 * คือผลเดียวกับ `/shop/installment-preview?provider=GFIN` ที่ไม่ส่ง months / downPct
 */
export function quoteCardRate2(
  ctx: ShopGfinContext,
  product: ShopGfinProduct,
  salePrice: Decimal | null,
  templateMonths: number | null,
): CardRate2 | null {
  if (!salePrice) return null;
  const commissionPct = commissionPctForCategory(ctx.settings, product.category);
  const factors = ctx.factors.filter((f) => f.isActive && f.shopCommissionPct === commissionPct);
  const plan = resolveShopGfinPlan({
    product,
    settings: ctx.settings,
    mappings: ctx.mappings,
    rules: ctx.rules,
    factorMonths: factors.map((f) => f.months),
    templateMonths,
  });
  if (!plan.ok) return null;
  const quote = computeShopGfinQuote(plan, {
    product,
    salePrice,
    settings: ctx.settings,
    factor: factors.find((f) => f.months === plan.months) ?? null,
  });
  if (!quote.ok) return null;
  return {
    down: Math.ceil(quote.downAmount),
    monthly: Math.ceil(quote.monthlyPayment),
    months: quote.months,
  };
}
```

และแก้ import ของ gfin-settings ที่หัวไฟล์เป็น:

```ts
import {
  commissionPctForCategory,
  loadGfinSettings,
  type GfinSettings,
} from '../gfin-config/gfin-settings.util';
```

ถ้า TypeScript ฟ้อง type ของ `ShopGfinReader.systemConfig` ให้เปลี่ยนบรรทัดนั้นเป็น `import type { SystemConfigReader } from '../../utils/config.util';` แล้วประกาศ `export type ShopGfinReader = SystemConfigReader & { gfinModelMapping: ...; gfinOverpriceRule: ...; gfinRateFactor: ... }` (type เดียวกับที่ `loadGfinSettings` รับ)

- [ ] **Step 4: DTO รับ `freeDown`**

แก้ `apps/api/src/modules/shop-catalog/dto/list-products.dto.ts`:

บรรทัด import แรก เพิ่ม `IsBoolean`:

```ts
import { IsOptional, IsString, IsInt, Min, Max, MaxLength, IsEnum, IsIn, IsBoolean } from 'class-validator';
import { Transform, Type } from 'class-transformer';
```

เพิ่มช่องต่อท้ายคลาส (หลังช่อง `months`):

```ts
  /**
   * true = เฉพาะเครื่องที่แผนเรท 2 ไม่ต้องวางดาวน์ (ฟรีดาวน์)
   * อ่านจากค่าดิบ (`obj`) เพราะ ValidationPipe กลางเปิด enableImplicitConversion —
   * ถ้าปล่อยให้แปลงเอง สตริง "false" จะกลายเป็น true
   */
  @IsOptional()
  @Transform(({ obj }) => {
    const raw = (obj as { freeDown?: unknown }).freeDown;
    return raw === undefined ? undefined : raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  freeDown?: boolean;
```

- [ ] **Step 5: service คิด `rate2` + กรอง + นับ**

แก้ `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`:

(ก) import — เปลี่ยน `import { Injectable } from '@nestjs/common';` เป็น `import { Injectable, Logger } from '@nestjs/common';` แล้วเพิ่มต่อจาก import ของ `./catalog-item.util`:

```ts
import { loadTemplateTerms } from '../../utils/pricing-template-terms.util';
import {
  loadShopGfinContext,
  quoteCardRate2,
  shopGfinSalePrice,
  type CardRate2,
} from './shop-gfin-quote.util';
```

(ข) ใน `interface ProductGroup` เพิ่มหลังช่อง `monthlyPaymentFrom`:

```ts
  /** แผนเรท 2 ที่ค่าตั้งต้นของเครื่อง (ดาวน์ 0 = ฟรีดาวน์) · null = คิดไม่ได้ */
  rate2: CardRate2 | null;
```

(ค) ในคลาส เพิ่ม logger ใต้ constructor:

```ts
  private readonly logger = new Logger(ShopCatalogService.name);
```

(ง) ใน type ของ `filters` ของ `listGroupedByModel` เพิ่มหลัง `months?: number;`:

```ts
    /** true = เฉพาะการ์ดที่แผนเรท 2 ไม่ต้องวางดาวน์ */
    freeDown?: boolean;
```

และใน type ที่คืน เพิ่มหลัง `monthsOptions: number[];`:

```ts
    /** จำนวนการ์ดฟรีดาวน์ตามตัวกรองอื่น — ไม่ขึ้นกับ freeDown และการแบ่งหน้า */
    freeDownCount: number;
```

(จ) ใน `select` ของ `product.findMany` (เครื่องมือสอง) เพิ่ม `financePrice: true,` ใต้ `installmentPrice: true,`

(ฉ) ใน `select` ของ `rawSamples` (`findFirst` ของการ์ดกลุ่ม) เปลี่ยนเป็น:

```ts
            select: {
              id: true,
              gallery: true,
              conditionGrade: true,
              installmentPrice: true,
              financePrice: true,
              warrantyExpired: true,
              warrantyExpireDate: true,
            },
```

(ช) หลังบรรทัด `const samples = new Map(...)` เพิ่ม:

```ts
    // แผนเรท 2 ของทุกการ์ด — อ่านตั้งค่าครั้งเดียวต่อคำขอ (สเปค 2026-11-25 หัวข้อ 8)
    const rate2For = await this.rate2Quoter([
      ...unitRows.map((u: any) => ({
        id: u.id as string,
        brand: u.brand as string | null,
        model: u.model as string,
        storage: (u.storage ?? null) as string | null,
        category: u.category,
        deviceOrigin: (u.deviceOrigin ?? null) as 'THAI' | 'IMPORTED' | null,
        warrantyExpired: (u.warrantyExpired ?? null) as boolean | null,
        warrantyExpireDate: (u.warrantyExpireDate ?? null) as Date | null,
        installmentPrice: u.installmentPrice,
        financePrice: u.financePrice,
      })),
      ...groups.flatMap((g: any, index: number) => {
        const sample = samples.get(rawSamples[index]?.id ?? '');
        if (!sample) return [];
        return [
          {
            id: sample.id as string,
            brand: g.brand as string | null,
            model: g.model as string,
            storage: (g.storage ?? null) as string | null,
            category: g.category,
            deviceOrigin: (g.deviceOrigin ?? null) as 'THAI' | 'IMPORTED' | null,
            warrantyExpired: ((sample as any).warrantyExpired ?? null) as boolean | null,
            warrantyExpireDate: ((sample as any).warrantyExpireDate ?? null) as Date | null,
            installmentPrice: (sample as any).installmentPrice,
            financePrice: (sample as any).financePrice,
          },
        ];
      }),
    ]);
```

(ซ) ในออบเจกต์ `item` ของการ์ดกลุ่ม เพิ่มใต้ `installmentMonths: quote?.months ?? null,`:

```ts
              rate2: sample ? rate2For(sample.id) : null,
```

และใน `item` ของเครื่องมือสอง เพิ่มใต้ `installmentMonths: quote?.months ?? null,`:

```ts
          rate2: rate2For(u.id),
```

(ฌ) แทนสองบรรทัด

```ts
    const total = merged.length;
    const data: ProductGroup[] = merged.slice((page - 1) * limit, page * limit).map((m) => m.item);
```

ด้วย:

```ts
    const isFreeDown = (card: SortableCard) => card.item.rate2?.down === 0;
    const freeDownCount = merged.filter(isFreeDown).length;
    const visible = filters.freeDown ? merged.filter(isFreeDown) : merged;

    const total = visible.length;
    const data: ProductGroup[] = visible.slice((page - 1) * limit, page * limit).map((m) => m.item);
```

และแก้บรรทัด return เป็น:

```ts
    return { data, total, page, limit, minDownPct, monthsOptions, freeDownCount };
```

(ญ) ใน `listRelated` ออบเจกต์รายการที่มี `installmentMonths: quote?.months ?? null,` (จุดที่สาม ราวบรรทัด 491) เพิ่มบรรทัด `rate2: null,` (ส่วนเครื่องใกล้เคียงไม่อยู่ในขอบเขตรอบนี้)

(ฎ) เพิ่มเมธอด private ก่อน `private installmentFor(`:

```ts
  /**
   * ตัวคิด "แผนเรท 2" ของการ์ดในคำขอนี้ · เรท 2 เป็นส่วนเสริมของการ์ด —
   * ถ้าอ่านตั้งค่าไม่ได้ การ์ดต้องยังขึ้น (ไม่มีกล่องล่าง) หน้ารวมห้ามล้มเพราะเรื่องนี้
   */
  private async rate2Quoter(
    products: Array<{
      id: string;
      brand: string | null;
      model: string;
      storage: string | null;
      category: any;
      deviceOrigin: 'THAI' | 'IMPORTED' | null;
      warrantyExpired: boolean | null;
      warrantyExpireDate: Date | null;
      installmentPrice: unknown;
      financePrice: unknown;
    }>,
  ): Promise<(id: string) => CardRate2 | null> {
    if (products.length === 0) return () => null;
    try {
      const [ctx, terms] = await Promise.all([
        loadShopGfinContext(this.prisma),
        loadTemplateTerms(
          this.prisma,
          products.map((p) => ({ ...p, brand: p.brand ?? '' })),
        ),
      ]);
      const byId = new Map<string, CardRate2 | null>();
      for (const p of products) {
        const t = terms.get(p.id);
        const templateMonths = t?.rate2TermMonths && t.rate2TermMonths > 0 ? t.rate2TermMonths : null;
        byId.set(
          p.id,
          quoteCardRate2(
            ctx,
            p,
            shopGfinSalePrice(p as { financePrice?: any; installmentPrice?: any }),
            templateMonths,
          ),
        );
      }
      return (id) => byId.get(id) ?? null;
    } catch (err) {
      this.logger.warn(
        `แผนเรท 2 ของหน้ารวมคิดไม่ได้ในคำขอนี้: ${err instanceof Error ? err.message : String(err)}`,
      );
      return () => null;
    }
  }
```

- [ ] **Step 6: รันเทสต์ใหม่ให้ผ่าน**

```powershell
npm --prefix apps/api test -- src/modules/shop-catalog/shop-catalog.rate2.spec.ts
```

Expected: PASS ทุกเทสต์ (9 เทสต์)
ถ้าเทสต์การ์ดกลุ่มได้ `rate2: null`: ตรวจว่า fixture `MAPPING_NEW` / `RULE_NEW` เป็น `HAND_1` และ `findGfinMapping` ใน `packages/shared/src/installment-calc.ts` จับ `PHONE_NEW` เป็น `HAND_1` (เป็นอยู่แล้ว)

- [ ] **Step 7: รันเทสต์ทั้งโมดูล — ของเดิมต้องไม่แดง**

```powershell
npm --prefix apps/api test -- src/modules/shop-catalog
cd apps/api; npx tsc --noEmit -p tsconfig.json; cd ..\..
```

Expected: ทุก suite PASS (รวม `shop-catalog.service.spec.ts` 1,039 บรรทัดเดิม — mock ของไฟล์นั้นไม่มีตารางเรท 2 จึงเข้าทาง catch แล้ว `rate2 = null`; ถ้ามีเทสต์เดิมใช้ `toEqual` กับรายการทั้งก้อนแล้วแดงเพราะมีช่อง `rate2: null` เพิ่ม ให้เติม `rate2: null` ในค่าที่คาดของเทสต์นั้น — เป็นการเพิ่มช่อง ไม่ใช่เปลี่ยนพฤติกรรม) · `tsc` ไม่มี error

- [ ] **Step 8: Checkpoint** — รายงานผล Step 6–7 · ไม่ commit

---

### Task 3: กล่องราคาสองกล่องบนการ์ด (`PlanTiles`)

**Files:**
- Create: `apps/web-shop/src/components/catalog/PlanTiles.tsx`
- Create: `apps/web-shop/src/components/catalog/PlanTiles.test.tsx`
- Modify: `apps/web-shop/src/components/catalog/ProductCard.tsx`

**Interfaces:**
- Consumes (Task 2, ผ่าน API): `rate2?: { down: number; monthly: number; months: number } | null` บนรายการ
- Produces (Task 4 ใช้):
  - `ProductGroup.rate2?: { down: number; monthly: number; months: number } | null`
  - prop ใหม่ของ `ProductCard`: `freeDownOnly?: boolean`
  - `PlanTiles({ rate1, rate2, freeDownOnly })`, `showsRate2Tile(rate1, rate2)`, `interface PlanQuote { down: number; monthly: number; months: number | null }`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `apps/web-shop/src/components/catalog/PlanTiles.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PlanTiles, showsRate2Tile } from './PlanTiles';
import { ProductCard, type ProductGroup } from './ProductCard';

const rate1 = { down: 4485, monthly: 2890, months: 12 };

describe('showsRate2Tile', () => {
  it('ขึ้นเมื่อเรท 2 ใช้เงินดาวน์น้อยกว่าเรท 1 หรือไม่มีเรท 1', () => {
    expect(showsRate2Tile(rate1, { down: 0, monthly: 4061, months: 15 })).toBe(true);
    expect(showsRate2Tile(rate1, { down: 1000, monthly: 3450, months: 15 })).toBe(true);
    expect(showsRate2Tile(null, { down: 5900, monthly: 4821, months: 15 })).toBe(true);
  });
  it('ไม่ขึ้นเมื่อดาวน์เท่ากันหรือมากกว่า หรือไม่มีแผนเรท 2', () => {
    expect(showsRate2Tile(rate1, { down: 4485, monthly: 2500, months: 15 })).toBe(false);
    expect(showsRate2Tile(rate1, { down: 5900, monthly: 2500, months: 15 })).toBe(false);
    expect(showsRate2Tile(rate1, null)).toBe(false);
  });
});

describe('PlanTiles', () => {
  it('เรท 1 + ฟรีดาวน์: สองกล่อง ดาวน์เป็นบาท บรรทัดค่างวดรูป "ผ่อน ฿X × N งวด"', () => {
    const { container } = render(
      <PlanTiles rate1={rate1} rate2={{ down: 0, monthly: 4061, months: 15 }} />,
    );
    expect(screen.getByText('฿4,485')).toBeInTheDocument();
    expect(screen.getByText('ฟรีดาวน์')).toBeInTheDocument();
    const lines = Array.from(container.querySelectorAll('[data-plan-line]')).map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(lines).toEqual(['ผ่อน ฿2,890 × 12 งวด', 'ผ่อน ฿4,061 × 15 งวด']);
    for (const el of container.querySelectorAll('[data-plan-line]')) {
      expect(el.className).toContain('whitespace-nowrap');
    }
    expect(container.textContent).not.toContain('%');
    expect(container.textContent).not.toContain('เรท');
  });

  it('เรท 2 ดาวน์น้อยกว่าแต่ไม่ถึง 0: กล่องล่างเขียนดาวน์เป็นบาท ไม่ใช่ "ฟรีดาวน์"', () => {
    const { container } = render(
      <PlanTiles rate1={rate1} rate2={{ down: 1000, monthly: 3450, months: 15 }} />,
    );
    expect(screen.getByText('฿1,000')).toBeInTheDocument();
    expect(screen.queryByText('ฟรีดาวน์')).not.toBeInTheDocument();
    expect(container.querySelector('[data-plan="rate2"]')).not.toBeNull();
    expect(container.querySelector('[data-plan="free-down"]')).toBeNull();
  });

  it('เรท 2 ดาวน์ไม่น้อยกว่า: กล่องเดียว', () => {
    const { container } = render(
      <PlanTiles rate1={rate1} rate2={{ down: 5900, monthly: 2500, months: 15 }} />,
    );
    expect(container.querySelectorAll('[data-plan]')).toHaveLength(1);
  });

  it('freeDownOnly: ไม่มีกล่องเรท 1 เหลือกล่องฟรีดาวน์กล่องเดียว', () => {
    const { container } = render(
      <PlanTiles rate1={rate1} rate2={{ down: 0, monthly: 4061, months: 15 }} freeDownOnly />,
    );
    expect(screen.queryByText('฿4,485')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-plan]')).toHaveLength(1);
    expect(screen.getByText('ฟรีดาวน์')).toBeInTheDocument();
  });

  it('ไม่มีทั้งสองแผน: "สอบถามค่างวด"', () => {
    render(<PlanTiles rate1={null} rate2={null} />);
    expect(screen.getByText('สอบถามค่างวด')).toBeInTheDocument();
  });
});

describe('ProductCard โหมดผ่อน', () => {
  const unit: ProductGroup = {
    id: 'u1',
    kind: 'UNIT',
    brand: 'Apple',
    model: 'iPhone 16 Pro Max',
    storage: '256GB',
    condition: 'USED',
    minPrice: 29900,
    stockCount: 1,
    monthlyPaymentFrom: 2890,
    downAmount: 4485,
    installmentMonths: 12,
    rate2: { down: 0, monthly: 4061, months: 15 },
    stock: { display: 'พร้อมขาย', tone: 'normal' },
    images: [],
    tags: [],
  };
  const show = (props: Partial<Parameters<typeof ProductCard>[0]> = {}) =>
    render(
      <MemoryRouter>
        <ProductCard product={unit} priceMode="installment" {...props} />
      </MemoryRouter>,
    );

  it('แสดงสองกล่องจากข้อมูลของ API', () => {
    show();
    expect(screen.getByText('฿4,485')).toBeInTheDocument();
    expect(screen.getByText('ฟรีดาวน์')).toBeInTheDocument();
  });

  it('API รุ่นเก่าไม่มี rate2 → กล่องเดียว ไม่พัง', () => {
    show({ product: { ...unit, rate2: undefined } });
    expect(screen.getByText('฿4,485')).toBeInTheDocument();
    expect(screen.queryByText('ฟรีดาวน์')).not.toBeInTheDocument();
  });

  it('โหมดซื้อสดไม่มีกล่องผ่อน', () => {
    show({ priceMode: 'cash' });
    expect(screen.queryByText('ฟรีดาวน์')).not.toBeInTheDocument();
    expect(screen.getByText('฿29,900')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels\apps\web-shop"; npx vitest run src/components/catalog/PlanTiles.test.tsx; cd ..\..
```

Expected: FAIL — `Failed to resolve import "./PlanTiles"`

- [ ] **Step 3: เขียน `PlanTiles`**

สร้าง `apps/web-shop/src/components/catalog/PlanTiles.tsx`:

```tsx
import { cn } from '@/lib/utils';

/** หนึ่งทางผ่อนบนการ์ด: วางดาวน์เท่าไร ผ่อนเดือนละเท่าไร กี่งวด */
export interface PlanQuote {
  down: number;
  monthly: number;
  months: number | null;
}

/**
 * กล่องล่างมีไว้บอก "ทางที่ใช้เงินดาวน์น้อยกว่า" (เจ้าของ 2026-11-25 ข้อ ก1) —
 * ดาวน์เท่ากันหรือมากกว่ากล่องบนจึงไม่ขึ้น (เทียบค่างวดได้ในหน้ารายละเอียด)
 */
export function showsRate2Tile(rate1: PlanQuote | null, rate2: PlanQuote | null): boolean {
  if (!rate2) return false;
  return !rate1 || rate2.down < rate1.down;
}

const TILE = 'rounded-2xl px-2 py-2 sm:px-3';
const BIG = 'num text-xl md:text-2xl font-bold leading-tight whitespace-nowrap';

function InstallmentLine({ plan }: { plan: PlanQuote }) {
  return (
    <p
      data-plan-line
      className="num mt-0.5 text-xs text-muted-foreground leading-snug whitespace-nowrap"
    >
      ผ่อน <span className="font-semibold text-primary">฿{plan.monthly.toLocaleString()}</span>
      {plan.months ? ` × ${plan.months} งวด` : ' ต่อเดือน'}
    </p>
  );
}

function DownTile({ plan, kind }: { plan: PlanQuote; kind: 'rate1' | 'rate2' }) {
  return (
    <div data-plan={kind} className={cn(TILE, 'bg-muted')}>
      <div className="font-head text-xs font-medium text-muted-foreground leading-snug">ดาวน์</div>
      <div className={cn(BIG, 'text-primary')}>฿{plan.down.toLocaleString()}</div>
      <InstallmentLine plan={plan} />
    </div>
  );
}

interface Props {
  /** ทางที่ลูกค้าตั้งดาวน์เอง (เรท 1) — null = คิดไม่ได้ */
  rate1: PlanQuote | null;
  /** แผนเรท 2 ที่ค่าตั้งต้นของเครื่อง — null = คิดไม่ได้ */
  rate2: PlanQuote | null;
  /** ลูกค้าติ๊กฟรีดาวน์: ไม่มีเงินดาวน์ จึงไม่แสดงกล่องเรท 1 */
  freeDownOnly?: boolean;
}

/** กล่องราคาโหมดผ่อนของการ์ดหน้ารวม — บนการ์ดไม่มีคำว่า "เรท" และไม่มี % (สเปค 2026-11-25 หัวข้อ 4) */
export function PlanTiles({ rate1, rate2, freeDownOnly = false }: Props) {
  const top = freeDownOnly ? null : rate1;
  const bottom = showsRate2Tile(top, rate2) ? rate2 : null;

  if (!top && !bottom) {
    return <span className="text-sm font-medium text-muted-foreground">สอบถามค่างวด</span>;
  }

  return (
    <div className="space-y-1.5">
      {top && <DownTile plan={top} kind="rate1" />}
      {bottom &&
        (bottom.down === 0 ? (
          // เหลืองสงวนให้โปรจริง — ฟรีดาวน์เข้าข่าย · มีคำกำกับเสมอ ไม่บอกด้วยสีอย่างเดียว
          <div data-plan="free-down" className={cn(TILE, 'bg-sand-50 ring-1 ring-inset ring-promo/60')}>
            <div className={cn(BIG, 'font-head text-sand-900')}>ฟรีดาวน์</div>
            <InstallmentLine plan={bottom} />
          </div>
        ) : (
          <DownTile plan={bottom} kind="rate2" />
        ))}
    </div>
  );
}
```

- [ ] **Step 4: ให้ `ProductCard` ใช้ `PlanTiles`**

แก้ `apps/web-shop/src/components/catalog/ProductCard.tsx`:

(ก) import เพิ่มใต้ `import { deviceOriginLabel, ... }`:

```tsx
import { PlanTiles } from './PlanTiles';
```

(ข) ใน `interface ProductGroup` เพิ่มหลัง `installmentMonths?: number | null;`:

```tsx
  /** แผนเรท 2 ที่ค่าตั้งต้นของเครื่อง (ดาวน์ 0 = ฟรีดาวน์). ไม่มีใน API รุ่นเก่า. */
  rate2?: { down: number; monthly: number; months: number } | null;
```

(ค) ใน `interface Props` เพิ่ม:

```tsx
  /** ลูกค้าติ๊ก "ฟรีดาวน์" ในตัวกรอง — การ์ดแสดงเฉพาะกล่องฟรีดาวน์ */
  freeDownOnly?: boolean;
```

และเปลี่ยนบรรทัดประกาศ component เป็น:

```tsx
export function ProductCard({ product: p, priceMode = 'combined', freeDownOnly = false }: Props) {
```

(ง) ในโซนราคา แทนทั้งกิ่ง `priceMode === 'installment' ? ( hasQuote ? ( <> ... </> ) : ( <span ...>สอบถามค่างวด</span> ) )` (ตั้งแต่ `) : priceMode === 'installment' ? (` ถึงก่อน `) : priceMode === 'cash' ? (`) ด้วย:

```tsx
            ) : priceMode === 'installment' ? (
              <PlanTiles
                rate1={
                  hasQuote && p.downAmount != null
                    ? {
                        down: p.downAmount,
                        monthly: p.monthlyPaymentFrom!,
                        months: p.installmentMonths ?? null,
                      }
                    : null
                }
                rate2={p.rate2 ?? null}
                freeDownOnly={freeDownOnly}
              />
```

(กิ่ง `p.minPrice == null`, `cash`, และ `combined` ไม่แตะ)

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels\apps\web-shop"; npx vitest run src/components/catalog; npx tsc --noEmit -p .; cd ..\..
```

Expected: ทุกไฟล์ใต้ `components/catalog` PASS (รวม `ProductCard.tags.test.tsx` และ `CatalogResults.test.tsx` เดิม) · `tsc` ไม่มี error

- [ ] **Step 6: Checkpoint** — รายงานผล Step 5 · ไม่ commit

---

### Task 4: ช่องติ๊ก "ฟรีดาวน์" ในตัวกรอง + `?freeDown=1`

**Files:**
- Create: `apps/web-shop/src/pages/catalog-params.ts`
- Create: `apps/web-shop/src/pages/catalog-params.test.ts`
- Create: `apps/web-shop/src/components/catalog/FilterSidebar.freeDown.test.tsx`
- Modify: `apps/web-shop/src/components/catalog/FilterSidebar.tsx`
- Modify: `apps/web-shop/src/components/catalog/CatalogResults.tsx`
- Modify: `apps/web-shop/src/pages/CatalogPage.tsx`

**Interfaces:**
- Consumes (Task 2): คำตอบ `freeDownCount?: number`, query `freeDown=true` · (Task 3): prop `freeDownOnly` ของ `ProductCard`
- Produces:
  - `buildCatalogParams(q: CatalogQuery): URLSearchParams`
  - `PlanControls` เพิ่ม `freeDown: boolean; freeDownCount: number; onFreeDown: (v: boolean) => void`
  - prop `freeDownOnly?: boolean` ของ `CatalogResults`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน (สองไฟล์)**

สร้าง `apps/web-shop/src/pages/catalog-params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCatalogParams } from './catalog-params';

const base = { filters: {}, sort: 'popular', downPct: null, months: null, freeDown: false, page: 1 };

describe('buildCatalogParams', () => {
  it('ค่าเริ่มต้น: มีแค่ sort กับ page', () => {
    expect(buildCatalogParams(base).toString()).toBe('sort=popular&page=1');
  });

  it('ส่งตัวกรองเดิมครบ และ % ดาวน์ / งวด', () => {
    const p = buildCatalogParams({
      ...base,
      filters: { deviceOrigin: 'IMPORTED', condition: 'USED', model: 'iPhone 15', minPrice: 10000, maxPrice: 15000, search: 'โปร' },
      downPct: 20,
      months: 12,
      page: 3,
    });
    expect(Object.fromEntries(p)).toEqual({
      deviceOrigin: 'IMPORTED',
      condition: 'USED',
      model: 'iPhone 15',
      minPrice: '10000',
      maxPrice: '15000',
      search: 'โปร',
      sort: 'popular',
      downPct: '20',
      months: '12',
      page: '3',
    });
  });

  it('ติ๊กฟรีดาวน์ → freeDown=true', () => {
    expect(buildCatalogParams({ ...base, freeDown: true }).get('freeDown')).toBe('true');
    expect(buildCatalogParams(base).has('freeDown')).toBe(false);
  });
});
```

สร้าง `apps/web-shop/src/components/catalog/FilterSidebar.freeDown.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterSidebar, type PlanControls } from './FilterSidebar';

function plan(over: Partial<PlanControls> = {}): PlanControls {
  return {
    downPct: 15,
    months: null,
    minDownPct: 15,
    monthsOptions: [10, 12],
    onDownPct: vi.fn(),
    onMonths: vi.fn(),
    freeDown: false,
    freeDownCount: 12,
    onFreeDown: vi.fn(),
    ...over,
  };
}
const show = (p: PlanControls) =>
  render(<FilterSidebar filters={{}} onChange={vi.fn()} models={[]} plan={p} />);

describe('ช่องติ๊กฟรีดาวน์ในกล่องเงินดาวน์', () => {
  it('แสดงพร้อมจำนวนเครื่อง และกดแล้วแจ้งกลับ', () => {
    const p = plan();
    show(p);
    const box = screen.getByRole('checkbox', { name: /ฟรีดาวน์/ });
    expect(box).not.toBeChecked();
    expect(screen.getByText('12 เครื่อง')).toBeInTheDocument();
    fireEvent.click(box);
    expect(p.onFreeDown).toHaveBeenCalledWith(true);
  });

  it('ไม่มีเครื่องฟรีดาวน์และไม่ได้ติ๊ก → ไม่แสดงช่องติ๊ก', () => {
    show(plan({ freeDownCount: 0 }));
    expect(screen.queryByRole('checkbox', { name: /ฟรีดาวน์/ })).not.toBeInTheDocument();
  });

  it('ติ๊กอยู่ → ยังแสดงแม้นับได้ 0 · ช่องดาวน์และแถบเลื่อนใช้ไม่ได้ · เอาติ๊กออกได้', () => {
    const p = plan({ freeDown: true, freeDownCount: 0 });
    show(p);
    const box = screen.getByRole('checkbox', { name: /ฟรีดาวน์/ });
    expect(box).toBeChecked();
    expect(screen.getByLabelText('เงินดาวน์')).toBeDisabled();
    expect(screen.getByLabelText('เลื่อนปรับเงินดาวน์')).toBeDisabled();
    expect(screen.getByText(/กำลังแสดงเฉพาะเครื่องที่ไม่ต้องวางดาวน์/)).toBeInTheDocument();
    fireEvent.click(box);
    expect(p.onFreeDown).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels\apps\web-shop"; npx vitest run src/pages/catalog-params.test.ts src/components/catalog/FilterSidebar.freeDown.test.tsx; cd ..\..
```

Expected: FAIL — ไม่พบ `./catalog-params` และ `PlanControls` ไม่มี `freeDown`

- [ ] **Step 3: `catalog-params.ts`**

สร้าง `apps/web-shop/src/pages/catalog-params.ts`:

```ts
import type { CatalogFilters } from '@/components/catalog/FilterSidebar';

export interface CatalogQuery {
  filters: CatalogFilters;
  sort: string;
  /** % ดาวน์ที่ลูกค้าเลือก (15 = 15%) — null = ให้ API ใช้ขั้นต่ำ */
  downPct: number | null;
  months: number | null;
  /** ติ๊ก "ฟรีดาวน์" — ขอเฉพาะเครื่องที่ไม่ต้องวางดาวน์ */
  freeDown: boolean;
  page: number;
}

/** query string ของ GET /api/shop/products — ที่เดียว ให้หน้ารวมกับเทสต์ใช้ร่วมกัน */
export function buildCatalogParams(q: CatalogQuery): URLSearchParams {
  const { filters } = q;
  const params = new URLSearchParams();
  if (filters.deviceOrigin) params.set('deviceOrigin', filters.deviceOrigin);
  if (filters.condition) params.set('condition', filters.condition);
  if (filters.model) params.set('model', filters.model);
  if (filters.conditionGrade) params.set('conditionGrade', filters.conditionGrade);
  if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
  if (filters.search) params.set('search', filters.search);
  params.set('sort', q.sort);
  if (q.downPct != null) params.set('downPct', String(q.downPct));
  if (q.months != null) params.set('months', String(q.months));
  if (q.freeDown) params.set('freeDown', 'true');
  params.set('page', String(q.page));
  return params;
}
```

- [ ] **Step 4: ช่องติ๊กใน `FilterSidebar`**

แก้ `apps/web-shop/src/components/catalog/FilterSidebar.tsx`:

(ก) ใน `interface PlanControls` เพิ่มท้าย:

```tsx
  /** ลูกค้าติ๊ก "ฟรีดาวน์" อยู่ */
  freeDown: boolean;
  /** จำนวนเครื่องฟรีดาวน์ตามตัวกรองอื่น */
  freeDownCount: number;
  onFreeDown: (v: boolean) => void;
```

(ข) ใน `PlanBlock` — ช่องตัวเลข `id="filter-down-num"` เพิ่ม attribute `disabled={plan.freeDown}` และต่อ class `disabled:opacity-50` ในสตริงแรกของ `cn(` (ให้เป็น `'num w-20 h-11 rounded-lg bg-card px-2 text-right text-base font-bold leading-snug disabled:opacity-50'`)

(ค) แถบเลื่อน `aria-label="เลื่อนปรับเงินดาวน์"` เพิ่ม `disabled={plan.freeDown}` และเปลี่ยน className เป็น `"mt-2 w-full accent-emerald-600 disabled:opacity-50"`

(ง) แทนย่อหน้า `<p id="filter-down-hint" ...> ... </p>` ทั้งก้อนด้วย:

```tsx
      <p
        id="filter-down-hint"
        className={cn(
          'mt-1.5 text-xs leading-snug',
          belowMin && !plan.freeDown ? 'text-orange-700 font-medium' : 'text-emerald-800/70',
        )}
      >
        {plan.freeDown
          ? 'กำลังแสดงเฉพาะเครื่องที่ไม่ต้องวางดาวน์ — เอาติ๊กออกเพื่อตั้งเงินดาวน์เอง'
          : belowMin
            ? `ดาวน์ขั้นต่ำ ${plan.minDownPct}% — จะปรับขึ้นให้เมื่อออกจากช่อง`
            : `พิมพ์ตัวเลขเองได้ ขั้นต่ำ ${plan.minDownPct}%`}
      </p>

      {(plan.freeDownCount > 0 || plan.freeDown) && (
        <label
          className={cn(
            'mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm leading-snug',
            plan.freeDown
              ? 'bg-sand-50 font-semibold text-sand-900 ring-1 ring-inset ring-promo/60'
              : 'bg-card text-emerald-900',
          )}
        >
          <input
            type="checkbox"
            checked={plan.freeDown}
            onChange={(e) => plan.onFreeDown(e.target.checked)}
            className="size-5 shrink-0 accent-emerald-600"
          />
          ฟรีดาวน์
          <span className="num ml-auto text-xs font-normal text-muted-foreground">
            {plan.freeDownCount} เครื่อง
          </span>
        </label>
      )}
```

(ป้าย `<label htmlFor="filter-down-num">เงินดาวน์</label>` เดิมคงไว้ — เทสต์อ้าง `getByLabelText('เงินดาวน์')` ซึ่งต้องจับได้ช่องเดียว; ช่องติ๊กมีชื่อ "ฟรีดาวน์ 12 เครื่อง" ไม่ชนกัน)

- [ ] **Step 5: `CatalogResults` ส่ง `freeDownOnly`**

แก้ `apps/web-shop/src/components/catalog/CatalogResults.tsx`:

ใน `interface Props` เพิ่มหลัง `priceMode: 'cash' | 'installment';`:

```tsx
  /** ลูกค้าติ๊ก "ฟรีดาวน์" — การ์ดแสดงเฉพาะกล่องฟรีดาวน์ */
  freeDownOnly?: boolean;
```

ในรายการ destructure ของ `CatalogResults({ ... })` เพิ่ม `freeDownOnly = false,` หลัง `priceMode,` และเปลี่ยนบรรทัด render การ์ดเป็น:

```tsx
                <ProductCard product={product} priceMode={priceMode} freeDownOnly={freeDownOnly} />
```

- [ ] **Step 6: `CatalogPage` — สถานะใน URL, คำขอ, ช่องติ๊กบนมือถือ**

แก้ `apps/web-shop/src/pages/CatalogPage.tsx`:

(ก) import เพิ่ม:

```tsx
import { buildCatalogParams } from './catalog-params';
```

(ข) ใน `interface CatalogResponse` เพิ่ม:

```tsx
  /** จำนวนเครื่องฟรีดาวน์ตามตัวกรองอื่น. ไม่มีใน API รุ่นเก่า. */
  freeDownCount?: number;
```

(ค) แทนฟังก์ชัน `setPriceMode` ทั้งก้อน แล้วเพิ่ม `freeDown` ต่อท้าย:

```tsx
  function setPriceMode(next: PriceMode) {
    const sp = new URLSearchParams(searchParams);
    if (next === 'cash') {
      sp.set('mode', 'cash');
      sp.delete('freeDown'); // ฟรีดาวน์เป็นเรื่องผ่อนอย่างเดียว
    } else sp.delete('mode');
    setSearchParams(sp, { replace: true });
  }

  // ฟรีดาวน์อยู่ใน URL เหมือนโหมดราคา — ลิงก์โฆษณาเปิดมาที่หน้าที่ติ๊กไว้แล้วได้
  const freeDown = priceMode === 'installment' && searchParams.get('freeDown') === '1';
  function setFreeDown(next: boolean) {
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set('freeDown', '1');
    else sp.delete('freeDown');
    setSearchParams(sp, { replace: true });
  }
```

(ง) ใน `useInfiniteQuery` เปลี่ยน `queryKey` และ `queryFn` เป็น:

```tsx
    queryKey: ['shop', 'catalog', filters, sort, committedDown, months, freeDown],
    queryFn: ({ pageParam }) => {
      const params = buildCatalogParams({
        filters,
        sort,
        downPct: committedDown,
        months,
        freeDown,
        page: pageParam as number,
      });
      return api.get(`/api/shop/products?${params}`).then((r) => r.data);
    },
```

(จ) ใต้ `const monthsOptions = first?.monthsOptions ?? [];` เพิ่ม:

```tsx
  const freeDownCount = first?.freeDownCount ?? 0;
  const showFreeDown = priceMode === 'installment' && (freeDownCount > 0 || freeDown);
```

(ฉ) ในออบเจกต์ `plan` เพิ่มสามช่องหลัง `onMonths: setMonths,`:

```tsx
          freeDown,
          freeDownCount,
          onFreeDown: setFreeDown,
```

(ช) ในแถบเครื่องมือ ต่อจาก `</div>` ปิดของกลุ่ม `<div className="flex lg:hidden gap-2">` (ปุ่ม ทั้งหมด/มือ 1/มือ 2) เพิ่ม:

```tsx
              {/* มือถือไม่มีแถบข้าง — ติ๊กฟรีดาวน์ได้เลยโดยไม่ต้องเปิดแผงตัวกรอง */}
              {showFreeDown && (
                <label
                  className={cn(
                    'lg:hidden inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 font-head text-sm leading-snug whitespace-nowrap',
                    freeDown
                      ? 'bg-sand-50 font-semibold text-sand-900 ring-1 ring-inset ring-promo/60'
                      : 'bg-card text-accent-foreground ring-1 ring-inset ring-border',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={freeDown}
                    onChange={(e) => setFreeDown(e.target.checked)}
                    className="size-4 shrink-0 accent-emerald-600"
                  />
                  ฟรีดาวน์
                  <span className="num text-xs font-normal text-muted-foreground">{freeDownCount}</span>
                </label>
              )}
```

(ซ) ที่ `<CatalogResults ... />` เปลี่ยน `resultKey` และเพิ่ม prop:

```tsx
              resultKey={JSON.stringify([filters, sort, committedDown, months, freeDown])}
              priceMode={priceMode}
              freeDownOnly={freeDown}
```

- [ ] **Step 7: รันเทสต์ + ตรวจ type**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels\apps\web-shop"; npx vitest run; npx tsc --noEmit -p .; cd ..\..
```

Expected: ทุกไฟล์ PASS · `tsc` ไม่มี error

- [ ] **Step 8: Checkpoint** — รายงานผล Step 7 · ไม่ commit

---

### Task 5: หน้ารายละเอียด — เรท 2 เปิดที่ค่าตั้งต้น, ป้ายเทียบสองเรท, หน้าตาฟรีดาวน์

**Files:**
- Create: `apps/web-shop/src/components/installment-compare.ts`
- Create: `apps/web-shop/src/components/installment-compare.test.ts`
- Modify: `apps/web-shop/src/components/InstallmentCalculatorCard.tsx`
- Modify: `apps/web-shop/src/components/InstallmentCalculatorCard.test.tsx` (เพิ่มเทสต์ท้าย `describe` — ไม่แก้เทสต์เดิม)

**Interfaces:**
- Consumes: `/api/shop/installment-preview` (provider `GFIN` ที่ไม่ส่ง `downPct` = ค่าตั้งต้นของเรท 2 — พฤติกรรมเดิมของ API)
- Produces: `compareBadges(mine, other): string[]`, `isFreeDown(result): boolean`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `apps/web-shop/src/components/installment-compare.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compareBadges, isFreeDown } from './installment-compare';

const q = (downAmount: number, monthlyPayment: number, months: number) => ({
  available: true,
  downAmount,
  monthlyPayment,
  months,
});

describe('compareBadges', () => {
  it('บอกเฉพาะข้อที่ดีกว่าอีกเรทจริง', () => {
    const rate1 = q(6000, 4848, 12);
    const rate2 = q(5900, 4821, 15);
    expect(compareBadges(rate1, rate2)).toEqual(['ผ่อนจบเร็วกว่า']);
    expect(compareBadges(rate2, rate1)).toEqual(['ดาวน์น้อยกว่า', 'ค่างวดต่ำกว่า']);
  });

  it('ดาวน์ 0 ใช้ป้าย "ฟรีดาวน์" แทน "ดาวน์น้อยกว่า"', () => {
    expect(compareBadges(q(0, 4061, 15), q(4485, 2890, 12))).toEqual(['ฟรีดาวน์']);
    expect(compareBadges(q(4485, 2890, 12), q(0, 4061, 15))).toEqual(['ค่างวดต่ำกว่า', 'ผ่อนจบเร็วกว่า']);
  });

  it('เทียบค่างวดหลังปัดขึ้นเป็นบาทเต็ม — ต่างกันแค่เศษสตางค์ไม่ขึ้นป้าย', () => {
    expect(compareBadges(q(3000, 1234.2, 12), q(3000, 1234.9, 12))).toEqual([]);
  });

  it('อีกเรทคิดไม่ได้ → ไม่มีป้ายเปรียบเทียบ (เหลือแต่ฟรีดาวน์ถ้าดาวน์ 0)', () => {
    expect(compareBadges(q(3000, 2000, 12), { available: false })).toEqual([]);
    expect(compareBadges(q(0, 2000, 12), undefined)).toEqual(['ฟรีดาวน์']);
    expect(compareBadges({ available: false }, q(3000, 2000, 12))).toEqual([]);
  });
});

describe('isFreeDown', () => {
  it('จริงเมื่อคิดได้และดาวน์เป็น 0', () => {
    expect(isFreeDown(q(0, 4061, 15))).toBe(true);
    expect(isFreeDown(q(100, 4061, 15))).toBe(false);
    expect(isFreeDown({ available: false })).toBe(false);
    expect(isFreeDown(undefined)).toBe(false);
  });
});
```

เพิ่มท้าย `describe('installment quote interactions', ...)` ใน `apps/web-shop/src/components/InstallmentCalculatorCard.test.tsx` (ก่อนปีกกาปิดของ describe):

```tsx
  // สเปค 2026-11-25 หัวข้อ 7 — เรท 2 เปิดที่ค่าตั้งต้นของมัน (ตรงกับการ์ดหน้ารวม) จนกว่าลูกค้าจะแก้ช่องเงินดาวน์
  it('เรท 2: คำขอแรกไม่ส่ง % ดาวน์ · ลูกค้าแก้ช่องเงินดาวน์แล้วส่งทั้งสองเรท', async () => {
    setup();
    const [bc, gfin] = requests;
    expect(bc.params.get('downPct')).toBe('0.15');
    expect(gfin.params.has('downPct')).toBe(false);
    expect(gfin.params.has('customDownAmount')).toBe(false);
    await answer(requests.slice(), 1290);
    const amount = screen.getByLabelText('เงินดาวน์ เป็นบาท');
    fireEvent.change(amount, { target: { value: '4567' } });
    fireEvent.blur(amount);
    const after = requests.slice(-2);
    expect(after.map(provider)).toEqual(['BC', 'GFIN']);
    expect(after.every((r) => r.params.get('downPct') === '0.23')).toBe(true);
  });

  it('เรท 2 ดาวน์ 0 → ป้าย "ฟรีดาวน์" และบรรทัด "ไม่ต้องวางดาวน์"', async () => {
    setup();
    await answer([requests[0]], 2890, { downAmount: 4485 });
    await answer([requests[1]], 4061, { downAmount: 0, months: 15, allowedMonths: [12, 15], defaultMonths: 15 });
    expect(await screen.findByText('ฟรีดาวน์')).toBeInTheDocument();
    expect(screen.getByText('ไม่ต้องวางดาวน์ · 15 งวด')).toBeInTheDocument();
    expect(screen.getByText('ค่างวดต่ำกว่า')).toBeInTheDocument();
    expect(screen.getByText('ผ่อนจบเร็วกว่า')).toBeInTheDocument();
    expect(screen.queryByText('ดาวน์น้อยกว่า')).not.toBeInTheDocument();
  });

  it('สองเรทต่างกัน → ป้ายบอกความต่างตามตัวเลขจริง ไม่มีชื่อผู้ให้ผ่อน ไม่มียอดรวม', async () => {
    const { container } = setup();
    await answer([requests[0]], 4848, { downAmount: 6000 });
    await answer([requests[1]], 4821, { downAmount: 5900, months: 15, allowedMonths: [12, 15], defaultMonths: 15 });
    expect(await screen.findByText('ดาวน์น้อยกว่า')).toBeInTheDocument();
    expect(screen.getByText('ค่างวดต่ำกว่า')).toBeInTheDocument();
    expect(screen.getByText('ผ่อนจบเร็วกว่า')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/GFIN|BESTCHOICE|รวมจ่าย/);
  });
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels\apps\web-shop"; npx vitest run src/components/installment-compare.test.ts src/components/InstallmentCalculatorCard.test.tsx; cd ..\..
```

Expected: FAIL — ไม่พบ `./installment-compare` · เทสต์ใหม่ 3 ตัวของ calculator แดง (เทสต์เดิม 10 ตัวยังเขียว)

- [ ] **Step 3: `installment-compare.ts`**

สร้าง `apps/web-shop/src/components/installment-compare.ts`:

```ts
import { displayInstallment } from '@installment/shared';

/** ผลคิดของหนึ่งเรทเท่าที่ใช้เปรียบเทียบ */
export interface ComparableQuote {
  available: boolean;
  downAmount?: number;
  monthlyPayment?: number;
  months?: number;
}

export const FREE_DOWN_BADGE = 'ฟรีดาวน์';

export function isFreeDown(quote: ComparableQuote | undefined): boolean {
  return !!quote?.available && (quote.downAmount ?? 0) === 0;
}

/**
 * ป้ายบอกว่าเรทนี้ดีกว่าอีกเรทตรงไหน — คิดจากตัวเลขจริงของเครื่องนั้น (เจ้าของ 2026-11-25:
 * ไม่บอกว่าเป็นของใคร ไม่โชว์ยอดรวมจ่าย) · เท่ากัน = ไม่ขึ้นป้าย
 */
export function compareBadges(
  mine: ComparableQuote | undefined,
  other: ComparableQuote | undefined,
): string[] {
  if (!mine?.available) return [];
  const badges: string[] = [];
  const free = isFreeDown(mine);
  if (free) badges.push(FREE_DOWN_BADGE);
  if (!other?.available) return badges;

  if (!free && (mine.downAmount ?? 0) < (other.downAmount ?? 0)) badges.push('ดาวน์น้อยกว่า');
  if (displayInstallment(mine.monthlyPayment ?? 0) < displayInstallment(other.monthlyPayment ?? 0)) {
    badges.push('ค่างวดต่ำกว่า');
  }
  if ((mine.months ?? 0) < (other.months ?? 0)) badges.push('ผ่อนจบเร็วกว่า');
  return badges;
}
```

- [ ] **Step 4: แก้ `InstallmentCalculatorCard.tsx`**

(ก) import เพิ่ม:

```tsx
import { cn } from '@/lib/utils';
import { compareBadges, FREE_DOWN_BADGE, isFreeDown } from './installment-compare';
```

(ข) `DownPaymentInput` — เพิ่ม prop `onUserEdit` (ลูกค้าพิมพ์เอง ต่างจากการปรับขึ้นอัตโนมัติ):

ในรายการ destructure เพิ่ม `onUserEdit,` หลัง `onCommitAmount,` และใน type เพิ่ม:

```tsx
  /** ลูกค้าพิมพ์ในช่องเอง (ไม่รวมการปรับขึ้นเป็นขั้นต่ำอัตโนมัติ) */
  onUserEdit: () => void;
```

ช่อง `aria-label="เงินดาวน์ เป็นเปอร์เซ็นต์"` เปลี่ยน `onChange` เป็น:

```tsx
            onChange={(e) => {
              onUserEdit();
              setPctRaw(e.target.value);
            }}
```

ช่อง `aria-label="เงินดาวน์ เป็นบาท"` เปลี่ยน `onChange` เป็น:

```tsx
            onChange={(e) => {
              onUserEdit();
              setAmtRaw(e.target.value);
            }}
```

(ค) `QuoteOption` — เพิ่ม prop `badges` และหน้าตาฟรีดาวน์:

ใน props type เพิ่ม `badges: string[];` และ destructure `badges` ด้วย · เพิ่มบรรทัดต่อจาก `const result = query.data;`:

```tsx
  const settled = !query.isFetching && !query.isPending && !query.isError;
  const freeDown = settled && isFreeDown(result);
```

เปลี่ยน className ของ `<div>` นอกสุดเป็น:

```tsx
    <div
      className={cn(
        'relative min-h-36 overflow-hidden rounded-xl border p-4',
        freeDown ? 'border-promo/60 bg-sand-50' : 'border-border bg-card',
      )}
    >
```

แทน `<h3 className="text-sm font-semibold text-primary leading-snug">{label}</h3>` ด้วย:

```tsx
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-sm font-semibold text-primary leading-snug">{label}</h3>
          {settled &&
            badges.map((badge) => (
              <span
                key={badge}
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold leading-snug whitespace-nowrap',
                  badge === FREE_DOWN_BADGE
                    ? 'bg-promo text-promo-foreground'
                    : 'bg-muted text-accent-foreground',
                )}
              >
                {badge}
              </span>
            ))}
        </div>
```

แทนบรรทัด `ดาวน์ ฿{formatTHB(result.downAmount ?? 0)} · {result.months} งวด` ด้วย:

```tsx
              {freeDown
                ? `ไม่ต้องวางดาวน์ · ${result.months} งวด`
                : `ดาวน์ ฿${formatTHB(result.downAmount ?? 0)} · ${result.months} งวด`}
```

(ง) `InstallmentCalculator` — สถานะ "ลูกค้าแก้ช่องเงินดาวน์แล้ว":

เพิ่มใต้ `const [minDownPct, setMinDownPct] = useState(DEFAULT_DOWN_PCT);`:

```tsx
  // เรท 2 เปิดที่ค่าตั้งต้นของมัน (ตรงกับการ์ดหน้ารวม) จนกว่าลูกค้าจะแก้ช่องเงินดาวน์ในหน้านี้เอง
  // downTyped = ลูกค้าพิมพ์แล้ว · downEdited = ค่าที่พิมพ์ถูก commit แล้ว (ไม่ยิงคำขอเรท 2 ตั้งแต่ตัวอักษรแรก)
  const downTyped = useRef(false);
  const [downEdited, setDownEdited] = useState(false);
  const markDownTyped = useCallback(() => {
    downTyped.current = true;
  }, []);
```

แล้วแก้ `commitPct` และ `commitAmount` เดิมให้ตั้ง `downEdited` เมื่อ commit นั้นมาจากการพิมพ์ของลูกค้า (การปรับขึ้นเป็นขั้นต่ำอัตโนมัติหลังคำตอบเรท 1 ไม่นับ):

```tsx
  const commitPct = useCallback((value: number) => {
    if (downTyped.current) setDownEdited(true);
    setDownMode('PCT');
    setDownPct(value);
    setDownAmountInput(null);
  }, []);
  const commitAmount = useCallback(
    (value: number) => {
      if (downTyped.current) setDownEdited(true);
      setDownMode('AMOUNT');
      setDownAmountInput(value);
      setDownPct(Math.round((value / installmentPrice) * 100));
    },
    [installmentPrice],
  );
```

ใน `useQueries` แทนตั้งแต่ `const term = ...` ถึงปิด `queryFn` ด้วย:

```tsx
      const term = provider === 'BC' ? months : gfinMonths;
      // เรท 1 ใช้เงินดาวน์ในช่องเสมอ · เรท 2 ใช้เมื่อลูกค้าแก้ช่องแล้วเท่านั้น
      const sendDown = provider === 'BC' || downEdited;
      return {
        queryKey: [
          'shop-installment-options',
          productId,
          installmentPrice,
          provider,
          term,
          sendDown ? downPct : null,
          sendDown ? downMode : null,
          sendDown ? downAmountInput : null,
        ],
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          // Endpoint expects a fraction; exact baht are also sent to BOTH providers once edited.
          const params = new URLSearchParams({ productId, provider });
          if (sendDown) {
            params.set('downPct', String(downPct / 100));
            if (downMode === 'AMOUNT' && downAmountInput != null)
              params.set('customDownAmount', String(downAmountInput));
          }
          if (term != null) params.set('months', String(term));
          const { data } = await api.get<PreviewResponse>(
            `/api/shop/installment-preview?${params}`,
            {
              signal,
            },
          );
          return data;
        },
        retry: false,
      };
```

ที่ `<DownPaymentInput ... />` เพิ่ม prop:

```tsx
            onUserEdit={markDownTyped}
```

ที่ `<QuoteOption label={PROVIDER_LABEL.BC} ...` เพิ่ม `badges={compareBadges(bcResult, gfinResult)}` และที่ `<QuoteOption label={PROVIDER_LABEL.GFIN} ...` เพิ่ม `badges={compareBadges(gfinResult, bcResult)}`

หมายเหตุลำดับพารามิเตอร์: เดิม `downPct` ถูกใส่ใน `URLSearchParams` ก่อน `months` — เทสต์เดิมอ่านด้วย `.get()` จึงไม่ขึ้นกับลำดับ

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels\apps\web-shop"; npx vitest run src/components/installment-compare.test.ts src/components/InstallmentCalculatorCard.test.tsx; npx tsc --noEmit -p .; cd ..\..
```

Expected: `installment-compare` 5 เทสต์ PASS · calculator 13 เทสต์ PASS (เดิม 10 + ใหม่ 3) · `tsc` ไม่มี error

- [ ] **Step 6: Checkpoint** — รายงานผล Step 5 · ไม่ commit

---

### Task 6: ตรวจรวม + ดูด้วยตา

**Files:** ไม่มีไฟล์ใหม่ (แก้เฉพาะสิ่งที่การตรวจพบ)

- [ ] **Step 1: รันเทสต์ทั้งหมดของสองฝั่ง + type + lint**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels"
npm --prefix apps/api test -- src/modules/shop-catalog
npm --prefix apps/web-shop test
cd apps/api; npx tsc --noEmit -p tsconfig.json; cd ..\web-shop; npx tsc --noEmit -p .; npx eslint "src/components/catalog/PlanTiles.tsx" "src/components/installment-compare.ts" "src/pages/catalog-params.ts" "src/pages/CatalogPage.tsx" "src/components/catalog/FilterSidebar.tsx" "src/components/InstallmentCalculatorCard.tsx"; cd ..\..
```

Expected: API ทุก suite PASS (มากกว่า baseline 21 เทสต์: util 12 + rate2 9) · web-shop PASS (มากกว่า baseline: PlanTiles 10 + catalog-params 3 + FilterSidebar 3 + compare 5 + calculator 3) · `tsc` สองฝั่งไม่มี error · eslint ไม่มี error

- [ ] **Step 2: ค้นคำต้องห้ามในโค้ดหน้าร้านที่แก้**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels\apps\web-shop\src"
Select-String -Path components\catalog\PlanTiles.tsx,components\catalog\ProductCard.tsx,components\catalog\FilterSidebar.tsx,pages\CatalogPage.tsx -Pattern "GFIN|BESTCHOICE FINANCE|รวมจ่าย|#[0-9A-Fa-f]{6}"
```

Expected: ไม่มีผลลัพธ์ที่เป็นข้อความแสดงผลหรือสี hex ใหม่ (ชื่อแบรนด์ `BESTCHOICE` ในรูป/alt เดิมไม่นับ)

- [ ] **Step 3: ดูหน้าจริง (ต้องมี API + ฐานข้อมูล local ตาม `CLAUDE.md` หัวข้อ Development)**

```powershell
cd "d:\BESTCHOICE APP\wt-shop-rate-labels"; npm run dev
```

เปิด web-shop ที่พอร์ตที่ Vite แจ้ง แล้วตรวจที่ความกว้างจอ 360px และ 1280px:

1. `/products` โหมดผ่อน — การ์ดที่ API คืน `rate2.down = 0` มีกล่องเหลือง "ฟรีดาวน์" ใต้กล่องดาวน์ · บรรทัด "ผ่อน ฿… × … งวด" ไม่ตกบรรทัด · ปุ่ม "ดูเครื่องนี้" ของการ์ดในแถวเดียวกันอยู่ระดับเดียวกัน
2. ติ๊ก "ฟรีดาวน์" (แถบข้างบนจอกว้าง / แถบบนบนมือถือ) — URL มี `?freeDown=1` · เหลือเฉพาะเครื่องฟรีดาวน์ · การ์ดเหลือกล่องเดียว · แถบเลื่อนดาวน์ใช้ไม่ได้ · เอาติ๊กออกกลับเป็นปกติ
3. สลับ "ซื้อสด" — ช่องติ๊กหาย `freeDown` หลุดจาก URL การ์ดโชว์ราคาเงินสดเหมือนเดิม
4. เปิด `/products?freeDown=1` ตรง ๆ — หน้าเปิดมาในสถานะติ๊กแล้ว
5. กดการ์ดฟรีดาวน์เข้าไป — กล่อง "เรท 2" พื้นเหลืองอ่อน ป้าย "ฟรีดาวน์" เขียน "ไม่ต้องวางดาวน์ · N งวด" และค่างวดตรงกับการ์ด · แก้ช่องเงินดาวน์ → ทั้งสองเรทคิดใหม่
6. ฟอนต์ สี มุมมนของการ์ดและตัวกรองเหมือนหน้าเดิม (เทียบกับ prod)

ถ้าไม่มีฐานข้อมูล local ให้รายงานว่าข้อนี้ยังไม่ได้ทำ — ห้ามอ้างว่าผ่าน

- [ ] **Step 4: เทียบค่างวดฟรีดาวน์กับตารางโปรของบอท (สเปค หัวข้อ 11)**

เลือก 3 รุ่นที่การ์ดขึ้น "ฟรีดาวน์" บนข้อมูลจริง เทียบ "ผ่อน ฿X × N งวด" กับตารางโปรในคลังความรู้ของบอท (เช่น 16 Pro Max 4,061 × 15) แล้วรายงานเป็นตาราง รุ่น | เว็บ | บอท | ตรง/ไม่ตรง
ถ้าไม่ตรงหรือยังไม่มีข้อมูลจริงให้เทียบ: รายงานตามจริง ให้เจ้าของตัดสิน — ห้ามแก้ตัวเลขเอง

- [ ] **Step 5: Checkpoint สุดท้าย** — สรุปให้เจ้าของ: ไฟล์ที่เปลี่ยน (`git status --short`), ผลเทสต์ทุกชุด, ผลดูด้วยตา, ผลเทียบกับบอท, สิ่งที่ยังไม่ได้ตรวจ · **รอเจ้าของสั่งก่อน commit / push / เปิด PR** · เตือน: deploy API ก่อนหรือพร้อมเว็บ

---

## Self-Review (ทำแล้วตอนเขียนแผน)

**Spec coverage (รอบ 1 ตามหัวข้อ 9 ของสเปค):**

| ข้อในสเปค | Task |
|---|---|
| util คิดเรท 2 ตัวเดียว · `previewGfin` ใช้ | 1 |
| หน้ารวมอ่าน `financePrice` · `rate2` ต่อรายการ (รวมการ์ดกลุ่ม) · `freeDown=true` · `freeDownCount` · ตัวนับไม่ขึ้นกับหน้า · parity | 2 |
| กล่องราคาสองกล่อง · กติกากล่องล่าง · "ฟรีดาวน์" / "ดาวน์ ฿X" · บรรทัด "ผ่อน ฿X × N งวด" · ไม่มี % ไม่มีคำว่าเรท | 3 |
| ช่องติ๊กในกล่องเงินดาวน์ (แถบเลื่อนใช้ไม่ได้ตอนติ๊ก) · ช่องติ๊กบนแถบมือถือ · `?freeDown=1` · สลับซื้อสดล้างค่า · สถานะ ③ การ์ดกล่องเดียว | 4 |
| เรท 2 ไม่ส่ง % ดาวน์ตอนเปิด · ป้ายเทียบสองเรท · หน้าตาฟรีดาวน์ | 5 |
| ตาดู 360/1280 · เทียบกับบอทก่อนปล่อย | 6 |
| ป้าย "มือ 2" + "เรท 1/เรท 2" | ทำแล้วในสาขานี้ก่อนแผน |

รอบ 2 (เงินดาวน์เป็นบาท, ปุ่มกดแทนดรอปดาวน์, เอาสภาพเครื่องออก, `?down=`, `overBudgetCount` / `nextDownFrom`) **ไม่อยู่ในแผนนี้** — เขียนแผนแยกหลังรอบ 1 ผ่าน

**Type consistency:** `CardRate2 { down, monthly, months }` (API) = `ProductGroup.rate2` (web) = `PlanQuote` ที่ `months` เป็น `number | null` (รับ `rate2` ได้) · `freeDown` (query/DTO/filters/`PlanControls`) · `freeDownCount` (คำตอบ/`CatalogResponse`/`PlanControls`) · `freeDownOnly` (`CatalogResults` → `ProductCard` → `PlanTiles`) · `compareBadges` / `isFreeDown` / `FREE_DOWN_BADGE` ใช้ชื่อเดียวกันทั้ง Task 5

**จุดที่ผู้ลงมือต้องระวัง:**
- Task 1 Step 6 และ Task 2 Step 7 คือด่านกันถอยหลัง — เทสต์เดิมของ `installment-preview.service.spec.ts` ห้ามแก้
- Task 2 Step 3: type ของ `ShopGfinReader` อาจต้องปรับตาม `SystemConfigReader` จริง (มีทางแก้เขียนไว้ในขั้นนั้น)
- เว็บใหม่ + API เก่า: ไม่มี `rate2` / `freeDownCount` → ไม่มีกล่องล่างและไม่มีช่องติ๊ก (ทดสอบแล้วใน Task 3)
