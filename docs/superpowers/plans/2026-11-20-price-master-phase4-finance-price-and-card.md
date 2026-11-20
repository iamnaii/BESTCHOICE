# ช่วง 4 — ราคาขาย GFIN รายเครื่อง (`Product.financePrice`) + การ์ด "ราคาขาย" แบบ D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เครื่องแต่ละเครื่องมีราคาขาย GFIN ของตัวเอง (เติมจากราคากลางตอนสร้าง · ตั้งใหม่ตอนระบบตั้งราคาใหม่ · เติมย้อนให้เครื่องในสต๊อกด้วยปุ่ม) ผู้คิดเรท 2 ทุกจุดอ่าน `financePrice ?? installmentPrice` และหน้าเพิ่มสินค้าใช้การ์ด "ราคาขาย" แบบ D (3 ราคา + ดาวน์ ค่างวด กำไร) แทนแถวราคาอิสระ

**Architecture:** API — คอลัมน์ใหม่ `products.finance_price` · `syncPriceRowsFromColumns` เขียนแถว "ราคาผ่อนไฟแนนซ์" (ไม่เป็นค่าเริ่มต้น) · ตัวเลือกแถวราคากลางตัวเดียว `findPricingTemplate` (`utils/pricing-template-match.util.ts`) ใช้ทั้งตัวเติมราคาเงินสด/ผ่อน และตัวเติมราคาขาย GFIN (`utils/product-finance-price.util.ts`) ซึ่งเป็นขั้นของตัวเองในทุกทางเข้า (หน้าเพิ่มสินค้า · รับของจากใบสั่งซื้อ · รับเทิร์น) · ปุ่ม "พร้อมขาย" ของเครื่องยึดและ "นำเข้าคลังพร้อมขาย" ตั้งค่าใหม่ตามราคากลางของหมวดปัจจุบัน · `POST /pricing-templates/backfill-finance-price` เติมย้อน
เว็บ — การ์ด D คิดด้วย `buildModelQuote` (ช่วง 2) ฝั่งเว็บจากตั้งค่าดอกเบี้ย (`useBcConfig`) + ตาราง GFIN (`useGfinTables`) ชุดเดียวกับการ์ดคำนวณหน้าสินค้า · ตัวคิดเรท 2 (`resolveQuotes` → การ์ดคำนวณ/สรุปลูกค้า/สติกเกอร์ · `installment-preview.service.ts` → เว็บ shop) ใช้ราคาขาย GFIN ของเครื่อง

**Tech Stack:** TypeScript · NestJS + Prisma (jest) · React 18 + Vite + Tailwind + TanStack Query (vitest + Testing Library) · `@installment/shared` (decimal.js)

สเปค: `docs/superpowers/specs/2026-11-19-price-master-retire-design.md` ข้อ 3.2, 3.4, 4.2–4.5, 5, 7.2, 7.5, 7.9, 7.10, 10, 11 (ช่วง 4) · สัญญาร่วม: `docs/superpowers/plans/2026-11-20-price-master-contracts.md` (Phase 4) · Mockup การ์ด: `.superpowers/brainstorm/1855-1795080137/content/create-page-price-card-v3.html` (repo หลัก)

## Global Constraints

(คัดจาก `2026-11-20-price-master-contracts.md` — ใช้ทุกช่วง)

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

เพิ่มเติมสำหรับช่วงนี้:

- ทำบน branch `feat/price-master-rest` (worktree `.worktrees/price-master-rest`) ต่อจากช่วง 1ข → 2 → 3 · **สมมติว่าช่วงก่อนหน้าขึ้นแล้ว**: ช่วง 1ข (`2026-11-20-price-master-phase1b-gfin-down-and-matching.md` — `OverpriceApi.minDownPct?`, ดาวน์ GFIN ปัดหลักร้อย) · ช่วง 2ก (`2026-11-20-price-master-phase2a-model-quotes-api-bot.md` — `buildModelQuote`, `ModelQuote` (`Rate1Quote` มี `allowedMonths` เพิ่ม), `ModelQuoteGfinContext`, `displayInstallment` จาก `@installment/shared` · ตัวเติมราคาเติมราคาผ่อนเสมอ + ถอยไป "ไม่ระบุ" (Task 4))
- **ไม่ย้ายค่าจากแถวราคาเดิม** — ห้ามเขียน migration/สคริปต์ที่คัดลอกแถว "ราคาผ่อนไฟแนนซ์" เดิมเข้า `finance_price` (สเปคข้อ 3.2) · ทางเดียวสำหรับเครื่องเดิมคือปุ่มเติมในหน้าตั้งราคา
- `financePrice` 3 สถานะเหมือน `cashPrice`: ไม่ส่ง = ไม่แตะ (ตอนสร้าง = เติมจากราคากลาง) · ตัวเลข ≥ 1 = ตั้ง · `null` = ไม่มี/ล้าง
- แถว "ราคาผ่อนไฟแนนซ์" **ไม่เป็นค่าเริ่มต้นเสมอ** (ค่าเริ่มต้นยังเป็นแถวเงินสด → แถวผ่อน ตามกติกาเดิมของ `syncPriceRowsFromColumns`)
- route ใหม่ทุกตัวต้องมี entry ใน `apps/api/src/modules/employee-access/access-policy.manifest.json` และ `node tools/check-access-coverage.mjs` ต้องผ่าน (รันจาก root ของ worktree · บน Windows ใช้คำสั่งครอบใน Task 5 Step 6)
- ไฟล์ทดสอบเดิมแก้ได้เฉพาะ assertion/fixture ที่ระบุใน Task — นอกนั้นถ้าล้มคือบั๊กของงานนี้

## ตัวเลขอ้างอิง (สเปคข้อ 4.5 — iPhone 15 128GB มือ 1 เครื่องไทย ทุน 25,800)

| ค่า | เงินสด | ผ่อน BESTCHOICE (เรท 1) | ผ่อน GFIN (เรท 2) |
|---|---|---|---|
| ราคาในช่อง | 25,900 | 25,900 | 25,900 |
| ดาวน์ | — | 3,900 (25,900 × 15% = 3,885 ↑) | 6,500 (25,900 × 25% = 6,475 ↑) |
| ค่างวดที่แสดง × งวด | — | 3,139 × 12 | 3,403 × 12 |
| ราคาบันทึกขาย | 25,900 | ราคา 2 = 28,100 | ราคา 3 = 28,738 |
| กำไร | 100 | 2,300 | 2,938 |

ตั้งค่าที่ใช้คิด: ดอกเบี้ย 10/12 งวด = 50% · ดาวน์ขั้นต่ำ 15% · ค่าคอม 10% · VAT 7% · ใบราคา GFIN iPhone 15 128GB มือ 1 = 24,900 · OVER 1,000 (งวดสูงสุด 12) · เรท 12 งวด คอม 15% = 0.17 + 100/งวด · GFIN ดาวน์ขั้นต่ำ 25% · ค่าทำสัญญา 100

---

### Task 1: คอลัมน์ `products.finance_price` + แถว "ราคาผ่อนไฟแนนซ์" ใน `syncPriceRowsFromColumns`

**Files:**
- Create: `apps/api/prisma/migrations/20261120900000_product_finance_price/migration.sql`
- Modify: `apps/api/prisma/schema.prisma:2258` (ต่อจากบรรทัด `installmentPrice …`)
- Modify: `apps/api/src/utils/product-price-sync.util.ts:3-5`, `:37-44`, `:89`, `:106`
- Modify: `apps/api/src/utils/product-price-sync.util.spec.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `Product.financePrice: Prisma.Decimal | null` (`finance_price DECIMAL(12,2)`)
  - `FINANCE_LABEL = 'ราคาผ่อนไฟแนนซ์'`
  - `syncPriceRowsFromColumns(tx, productId, { cashPrice?, installmentPrice?, financePrice? }): Promise<{ cashRowId: string | null; installmentRowId: string | null; financeRowId: string | null }>`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/api/src/utils/product-price-sync.util.spec.ts` — แก้บรรทัด import บรรทัดแรกของไฟล์:

```ts
import {
  syncPriceRowsFromColumns,
  CASH_LABEL,
  FINANCE_LABEL,
  INSTALLMENT_LABEL,
} from './product-price-sync.util';
```

แล้วเพิ่มท้าย `describe('syncPriceRowsFromColumns', …)` (ก่อน `});` ตัวสุดท้าย):

```ts
  // สเปค 2026-11-19 ข้อ 3.2 — คอลัมน์ financePrice เป็นตัวจริง แถว "ราคาผ่อนไฟแนนซ์" เป็นสำเนา (ไม่เป็นค่าเริ่มต้น)
  it('upsert แถว "ราคาผ่อนไฟแนนซ์" จาก financePrice — ไม่เป็นค่าเริ่มต้น และไม่แตะแถวเงินสด', async () => {
    const tx = makeTx([{ id: 'r1', label: CASH_LABEL, amount: D('18000'), isDefault: true }]);
    const result = await syncPriceRowsFromColumns(tx as any, 'p1', { financePrice: D('21000') });
    const fin = tx.state.find((r) => r.label === FINANCE_LABEL)!;
    expect(fin.amount.toString()).toBe('21000');
    expect(fin.isDefault).toBe(false);
    expect(result.financeRowId).toBe(fin.id);
    expect(tx.state.find((r) => r.id === 'r1')).toMatchObject({ label: CASH_LABEL, isDefault: true });
  });

  it('มีแถว "ราคาผ่อนไฟแนนซ์" เดิมอยู่แล้ว → อัปเดตยอดในแถวเดิม ไม่สร้างซ้ำ', async () => {
    const tx = makeTx([
      { id: 'r1', label: CASH_LABEL, amount: D('18000'), isDefault: true },
      { id: 'r2', label: FINANCE_LABEL, amount: D('900'), isDefault: false },
    ]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { financePrice: D('21000') });
    expect(tx.productPrice.create).not.toHaveBeenCalled();
    expect(tx.state.find((r) => r.id === 'r2')!.amount.toString()).toBe('21000');
  });

  it('มีแค่ financePrice และยังไม่มีแถวค่าเริ่มต้นเลย → แถวไฟแนนซ์ไม่ถูกตั้งเป็นค่าเริ่มต้น', async () => {
    const tx = makeTx([]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { financePrice: D('21000') });
    expect(tx.state).toHaveLength(1);
    expect(tx.state.filter((r) => r.isDefault)).toHaveLength(0);
  });

  it('financePrice = 0 → ปฏิบัติเหมือน null (ไม่สร้างแถว)', async () => {
    const tx = makeTx([]);
    const result = await syncPriceRowsFromColumns(tx as any, 'p1', { financePrice: D('0') });
    expect(tx.productPrice.create).not.toHaveBeenCalled();
    expect(result.financeRowId).toBeNull();
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/utils/product-price-sync.util.spec.ts`
Expected: FAIL — `FINANCE_LABEL` เป็น `undefined` และ 3 เคสแรกไม่พบแถว `ราคาผ่อนไฟแนนซ์` (`Cannot read properties of undefined (reading 'amount')`)

- [ ] **Step 3: migration + schema**

ตรวจว่าโฟลเดอร์ใหม่เรียงหลังโฟลเดอร์ทั้งหมด (รวม migration `min_down_pct` ของช่วง 1ข): `ls apps/api/prisma/migrations | sort | tail -3` — ถ้ามีโฟลเดอร์ที่ใหม่กว่า `20261120900000` ให้ใช้ timestamp ที่มากกว่านั้น

`apps/api/prisma/migrations/20261120900000_product_finance_price/migration.sql`:

```sql
-- สเปค 2026-11-19 ข้อ 3.2 — ราคาขาย GFIN ของเครื่อง (ราคาเต็ม) · ค่าว่าง = ผู้คิดเรท 2 ใช้ราคาผ่อน BESTCHOICE (พฤติกรรมเดิม)
-- เพิ่มคอลัมน์อย่างเดียว ไม่คัดลอกจากแถวราคา "ราคาผ่อนไฟแนนซ์" เดิม (ค่าเดิมเชื่อไม่ได้ว่าเป็นราคาเต็ม)
ALTER TABLE "products" ADD COLUMN "finance_price" DECIMAL(12,2);
```

`apps/api/prisma/schema.prisma` — ต่อจากบรรทัด 2258 (`installmentPrice    Decimal?  @map("installment_price") @db.Decimal(12, 2)`):

```prisma
  /// ราคาขาย GFIN ของเครื่อง (ราคาเต็ม) — ว่าง = เรท 2 ใช้ installmentPrice (สเปค 2026-11-19 ข้อ 3.2)
  financePrice        Decimal?               @map("finance_price") @db.Decimal(12, 2)
```

Run: `cd apps/api && npx prisma generate && cd ../..`
(ถ้ามีฐานข้อมูลในเครื่องที่เปิดอยู่: `cd apps/api && npx prisma migrate deploy && cd ../..`)

- [ ] **Step 4: เขียนโค้ด `product-price-sync.util.ts`**

บรรทัด 3–5 แทนด้วย:

```ts
export const CASH_LABEL = 'ราคาเงินสด';
export const INSTALLMENT_LABEL = 'ราคาผ่อน BESTCHOICE';
/** สำเนาของคอลัมน์ `Product.financePrice` (สเปค 2026-11-19 ข้อ 3.2) — ไม่เป็นค่าเริ่มต้นเสมอ */
export const FINANCE_LABEL = 'ราคาผ่อนไฟแนนซ์';
const INSTALLMENT_PREFIX = 'ราคาผ่อน';
```

บรรทัด 37–44 (signature + early return) แทนด้วย:

```ts
export async function syncPriceRowsFromColumns(
  tx: Prisma.TransactionClient,
  productId: string,
  columns: {
    cashPrice?: Prisma.Decimal | null;
    installmentPrice?: Prisma.Decimal | null;
    financePrice?: Prisma.Decimal | null;
  },
): Promise<{ cashRowId: string | null; installmentRowId: string | null; financeRowId: string | null }> {
  const hasCash = isUsablePrice(columns.cashPrice);
  const hasInstallment = isUsablePrice(columns.installmentPrice);
  const hasFinance = isUsablePrice(columns.financePrice);
  if (!hasCash && !hasInstallment && !hasFinance) {
    return { cashRowId: null, installmentRowId: null, financeRowId: null };
  }
```

ต่อจากบล็อก `if (hasInstallment) { … }` (ปิดที่บรรทัด 89) เพิ่ม:

```ts

  // แถวราคาขาย GFIN — upsert ด้วย label ตรงเท่านั้น สร้างใหม่เป็น isDefault:false และ phase 2
  // ด้านล่างไม่เคยเลือกแถวนี้เป็นค่าเริ่มต้น (POS/บอทที่ `isDefault take:1` ต้องได้เงินสดหรือผ่อน)
  let financeRowId: string | null = null;
  if (hasFinance) {
    const amount = columns.financePrice as Prisma.Decimal;
    const exact = rows.find((r) => r.label === FINANCE_LABEL);
    if (exact) {
      await tx.productPrice.update({ where: { id: exact.id }, data: { amount } });
      financeRowId = exact.id;
    } else {
      const created = await tx.productPrice.create({
        data: { productId, label: FINANCE_LABEL, amount, isDefault: false },
      });
      financeRowId = created.id;
    }
  }
```

บรรทัด 106 `return { cashRowId, installmentRowId };` แทนด้วย:

```ts
  return { cashRowId, installmentRowId, financeRowId };
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/utils/product-price-sync.util.spec.ts`
Expected: PASS (เคสเดิม 13 + ใหม่ 4)

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/migrations/20261120900000_product_finance_price apps/api/prisma/schema.prisma apps/api/src/utils/product-price-sync.util.ts apps/api/src/utils/product-price-sync.util.spec.ts
git commit -m "feat(products): add finance_price column and mirror it to the GFIN price row" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ตัวเลือกแถวราคากลางตัวเดียว + ตัวเติมราคาขาย GFIN

**ก่อนเริ่ม:** ขอบเขต "ตัวเติมราคาเดิมเติม `installmentPrice` จากราคากลางเสมอเมื่อเติมเงินสด" (สเปคข้อ 7.2) ทำแล้วในช่วง 2ก Task 4 (`docs/superpowers/plans/2026-11-20-price-master-phase2a-model-quotes-api-bot.md` — ลบค่าตั้ง `pricing_template_installment_semantics` + ถอยไปแถว "ไม่ระบุ") ตรวจก่อน:

Run: `grep -rn "resolveInstallmentSemantics\|INSTALLMENT_LOOKS_PER_MONTH\|pricing_template_installment_semantics" apps/api/src`
Expected: ไม่มีผลลัพธ์ — ถ้ามี ให้ทำช่วง 2ก Task 4 ก่อน

Task นี้ย้ายตัวเลือกแถว (`pickTemplate` + ลูปที่มาเครื่องของช่วง 2ก) ออกมาเป็น util ร่วม `findPricingTemplate` เพื่อให้ราคาขาย GFIN ใช้แถวเดียวกับราคาเงินสด/ผ่อนทุกทางเข้า · พฤติกรรมของตัวเติมราคาเดิมไม่เปลี่ยน — `product-price-autofill.util.spec.ts` (ฉบับช่วง 2ก) ต้องผ่านโดยไม่แก้

**Files:**
- Create: `apps/api/src/utils/pricing-template-match.util.ts`
- Create: `apps/api/src/utils/pricing-template-match.util.spec.ts`
- Create: `apps/api/src/utils/product-finance-price.util.ts`
- Create: `apps/api/src/utils/product-finance-price.util.spec.ts`
- Modify: `apps/api/src/utils/product-price-autofill.util.ts` (ฉบับช่วง 2ก — import 3 บรรทัดแรก · ฟังก์ชัน `pickTemplate` · บล็อกเลือกแถวใน `autofillProductPriceFromTemplate`)

**Interfaces:**
- Consumes: `syncPriceRowsFromColumns`, `FINANCE_LABEL` (Task 1) · `normalizeStorage` (`utils/device-query-normalize.util.ts`)
- Produces:
  - `pricing-template-match.util.ts`: `TemplateMatchKey`, `TemplateMatchRow`, `TEMPLATE_ORDER`, `positiveDecimal(v)`, `pickPricingTemplate(rows, key)`, `findPricingTemplate(tx, key)`
  - `product-finance-price.util.ts`: `ProductTemplateFields`, `resolveHasWarranty(p)`, `templateKeyOf(p)`, `templateFinancePrice(tx, key)`, `syncFinancePriceRow(tx, productId, price | null)`, `fillFinancePriceFromTemplate(tx, productId, key)`
  - `autofillProductPriceFromTemplate` — signature และผลลัพธ์เดิมของช่วง 2ก

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/api/src/utils/pricing-template-match.util.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { findPricingTemplate, pickPricingTemplate, positiveDecimal } from './pricing-template-match.util';

const D = (n: string) => new Prisma.Decimal(n);
const ROW = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW' as const,
  hasWarranty: false,
  deviceOrigin: 'UNSPECIFIED' as const,
  ...over,
});
const KEY = {
  brand: 'apple ',
  model: 'IPHONE 15',
  storage: '128 GB',
  category: 'PHONE_NEW' as const,
  hasWarranty: null,
  deviceOrigin: null,
};

describe('pickPricingTemplate', () => {
  it('ยี่ห้อ/รุ่นไม่สนตัวพิมพ์และช่องว่าง · ความจุ "128 GB" = "128GB" · ต้องหมวดเดียวกัน', () => {
    const rows = [ROW({ id: 'used', category: 'PHONE_USED' }), ROW({ id: 'new' })];
    expect(pickPricingTemplate(rows as never, KEY)?.id).toBe('new');
  });

  it('ไม่มีแถวความจุตรง → ใช้แถวความจุว่าง', () => {
    expect(pickPricingTemplate([ROW({ id: 'blank', storage: '' })] as never, KEY)?.id).toBe('blank');
  });

  it('เครื่องนอกไม่มีแถวของตัวเอง → ถอยไปแถว "ไม่ระบุ" (สเปคข้อ 7.1)', () => {
    const rows = [ROW({ id: 'thai', deviceOrigin: 'THAI' }), ROW({ id: 'any' })];
    expect(pickPricingTemplate(rows as never, { ...KEY, deviceOrigin: 'IMPORTED' })?.id).toBe('any');
  });

  it('มีแถวของที่มาเครื่องนั้น → ใช้ก่อนแถว "ไม่ระบุ"', () => {
    const rows = [ROW({ id: 'any' }), ROW({ id: 'thai', deviceOrigin: 'THAI' })];
    expect(pickPricingTemplate(rows as never, { ...KEY, deviceOrigin: 'THAI' })?.id).toBe('thai');
  });

  it('เครื่องยังไม่ระบุที่มา ไม่หยิบแถวเครื่องไทย/นอก', () => {
    expect(pickPricingTemplate([ROW({ deviceOrigin: 'THAI' })] as never, KEY)).toBeNull();
  });

  it('มือ 2 รู้สถานะประกัน → แถวที่ตรงเท่านั้น · ไม่รู้ → แถว "ไม่มีประกัน"', () => {
    const rows = [
      ROW({ id: 'no', category: 'PHONE_USED', hasWarranty: false }),
      ROW({ id: 'yes', category: 'PHONE_USED', hasWarranty: true }),
    ];
    const used = { ...KEY, category: 'PHONE_USED' as const };
    expect(pickPricingTemplate(rows as never, { ...used, hasWarranty: true })?.id).toBe('yes');
    expect(pickPricingTemplate(rows as never, { ...used, hasWarranty: null })?.id).toBe('no');
  });
});

describe('findPricingTemplate', () => {
  it('ไม่มียี่ห้อหรือรุ่น → null โดยไม่อ่านฐานข้อมูล', async () => {
    const tx = { pricingTemplate: { findMany: jest.fn() } };
    expect(await findPricingTemplate(tx as never, { ...KEY, brand: '' })).toBeNull();
    expect(tx.pricingTemplate.findMany).not.toHaveBeenCalled();
  });

  it('อ่านเฉพาะแถวที่เปิดใช้ ของที่มาเครื่องนั้น + "ไม่ระบุ" เรียง hasWarranty แล้ว createdAt', async () => {
    const tx = { pricingTemplate: { findMany: jest.fn().mockResolvedValue([ROW()]) } };
    await findPricingTemplate(tx as never, { ...KEY, deviceOrigin: 'THAI' });
    const args = tx.pricingTemplate.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      isActive: true,
      deletedAt: null,
      category: 'PHONE_NEW',
      deviceOrigin: { in: ['THAI', 'UNSPECIFIED'] },
    });
    expect(args.orderBy).toEqual([{ hasWarranty: 'asc' }, { createdAt: 'asc' }]);
  });
});

describe('positiveDecimal', () => {
  it('ค่าบวกเท่านั้น', () => {
    expect(positiveDecimal(D('26500'))?.toString()).toBe('26500');
    expect(positiveDecimal('0')).toBeNull();
    expect(positiveDecimal(null)).toBeNull();
    expect(positiveDecimal(undefined)).toBeNull();
  });
});
```

`apps/api/src/utils/product-finance-price.util.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import {
  fillFinancePriceFromTemplate,
  resolveHasWarranty,
  syncFinancePriceRow,
  templateKeyOf,
} from './product-finance-price.util';

const D = (n: string) => new Prisma.Decimal(n);
const TEMPLATE = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  deviceOrigin: 'UNSPECIFIED',
  cashPrice: D('25900'),
  installmentBestchoicePrice: D('25900'),
  installmentFinancePrice: D('26500'),
  ...over,
});
const PRODUCT = {
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW' as const,
  deviceOrigin: 'THAI' as const,
  warrantyExpired: null,
  warrantyExpireDate: null,
};

function makeTx(templates: unknown[]) {
  return {
    pricingTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
    product: { update: jest.fn().mockResolvedValue({}) },
    productPrice: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'row-f' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('resolveHasWarranty / templateKeyOf', () => {
  it('ไม่ใช่มือ 2 = false · มือ 2 ตามช่องประกัน · ไม่รู้ = null', () => {
    expect(resolveHasWarranty({ category: 'PHONE_NEW', warrantyExpired: null, warrantyExpireDate: null })).toBe(false);
    expect(resolveHasWarranty({ category: 'PHONE_USED', warrantyExpired: true, warrantyExpireDate: null })).toBe(false);
    expect(resolveHasWarranty({ category: 'PHONE_USED', warrantyExpired: false, warrantyExpireDate: null })).toBe(true);
    expect(resolveHasWarranty({ category: 'PHONE_USED', warrantyExpired: null, warrantyExpireDate: null })).toBeNull();
  });

  it('key ของเครื่อง = ยี่ห้อ รุ่น ความจุ หมวด ที่มา + ประกัน', () => {
    expect(templateKeyOf(PRODUCT)).toEqual({
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '128GB',
      category: 'PHONE_NEW',
      deviceOrigin: 'THAI',
      hasWarranty: false,
    });
  });
});

describe('fillFinancePriceFromTemplate', () => {
  it('เจอราคากลาง (เครื่องไทย → ถอยไปแถว "ไม่ระบุ") → เขียนคอลัมน์ + แถว "ราคาผ่อนไฟแนนซ์" ที่ไม่เป็นค่าเริ่มต้น', async () => {
    const tx = makeTx([TEMPLATE()]);
    const price = await fillFinancePriceFromTemplate(tx as never, 'p1', templateKeyOf(PRODUCT));
    expect(price?.toString()).toBe('26500');
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { financePrice: D('26500') } });
    expect(tx.productPrice.create).toHaveBeenCalledWith({
      data: { productId: 'p1', label: 'ราคาผ่อนไฟแนนซ์', amount: D('26500'), isDefault: false },
    });
  });

  it('ไม่มีราคากลาง หรือราคาขาย GFIN = 0 → ไม่เขียนอะไร', async () => {
    for (const templates of [[], [TEMPLATE({ installmentFinancePrice: D('0') })]]) {
      const tx = makeTx(templates);
      expect(await fillFinancePriceFromTemplate(tx as never, 'p1', templateKeyOf(PRODUCT))).toBeNull();
      expect(tx.product.update).not.toHaveBeenCalled();
    }
  });
});

describe('syncFinancePriceRow', () => {
  it('null → ลบแถว "ราคาผ่อนไฟแนนซ์" ที่ไม่ใช่ค่าเริ่มต้นแบบ soft', async () => {
    const tx = makeTx([]);
    await syncFinancePriceRow(tx as never, 'p1', null);
    expect(tx.productPrice.updateMany).toHaveBeenCalledWith({
      where: { productId: 'p1', label: 'ราคาผ่อนไฟแนนซ์', isDefault: false, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/utils/pricing-template-match.util.spec.ts src/utils/product-finance-price.util.spec.ts`
Expected: FAIL — `Cannot find module './pricing-template-match.util'` และ `'./product-finance-price.util'`

- [ ] **Step 3: เขียนโค้ด — ตัวเลือกแถวและตัวเติมราคาขาย GFIN**

`apps/api/src/utils/pricing-template-match.util.ts`:

```ts
import { Prisma, PricingDeviceOrigin, ProductCategory } from '@prisma/client';
import { normalizeStorage } from './device-query-normalize.util';

/** ข้อมูลเครื่องที่ใช้เลือกแถวราคากลาง */
export interface TemplateMatchKey {
  brand: string;
  model: string;
  storage: string | null;
  category: ProductCategory;
  /** null = ไม่รู้สถานะประกัน (เครื่องเทิร์น/รับซื้อ) */
  hasWarranty: boolean | null;
  /** ที่มาเครื่อง · null / ไม่ส่ง = ยังไม่ระบุ */
  deviceOrigin?: 'THAI' | 'IMPORTED' | null;
}

/** ช่องที่ตัวเลือกใช้ — แถวต้องเรียงตาม `TEMPLATE_ORDER` มาแล้ว (ตัวเลือกไม่เรียงเอง) */
export interface TemplateMatchRow {
  brand: string;
  model: string;
  storage: string;
  category: ProductCategory;
  hasWarranty: boolean;
  deviceOrigin: PricingDeviceOrigin;
}

/** deterministic: แถว "ไม่มีประกัน" ก่อน แล้วแถวที่สร้างก่อน */
export const TEMPLATE_ORDER: Prisma.PricingTemplateOrderByWithRelationInput[] = [
  { hasWarranty: 'asc' },
  { createdAt: 'asc' },
];

/** ราคาบวกเท่านั้น — 0 / ติดลบ / ว่าง = null (กติกาเดียวกับ `syncPriceRowsFromColumns`) */
export function positiveDecimal(
  value: Prisma.Decimal | string | number | null | undefined,
): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = new Prisma.Decimal(value.toString());
  return amount.isFinite() && amount.gt(0) ? amount : null;
}

function selectWithin<T extends TemplateMatchRow>(rows: T[], key: TemplateMatchKey): T | null {
  const wanted = normalizeStorage(key.storage);
  let candidates = rows.filter((r) => normalizeStorage(r.storage) === wanted);
  if (candidates.length === 0) candidates = rows.filter((r) => normalizeStorage(r.storage) === '');
  if (key.category === 'PHONE_USED' && key.hasWarranty !== null) {
    candidates = candidates.filter((r) => r.hasWarranty === key.hasWarranty);
  } else {
    // ไม่ใช่มือ 2 หรือไม่รู้ประกัน → แถว "ไม่มีประกัน" (ราคาต่ำกว่า — ไม่ตั้งราคาสูงเกินจริง) ถ้ามี
    const noWarranty = candidates.filter((r) => !r.hasWarranty);
    if (noWarranty.length > 0) candidates = noWarranty;
  }
  return candidates[0] ?? null;
}

/**
 * เลือกแถวราคากลางของเครื่อง — ตัวเดียวที่ใช้ทั้งตัวเติมราคาเงินสด/ผ่อน (`autofillProductPriceFromTemplate`)
 * และราคาขาย GFIN (`product-finance-price.util.ts`) ⇒ ทุกทางเข้าได้แถวเดียวกัน
 * ความจุตรงก่อน แล้วค่อยแถวความจุว่าง · ประกันแบบ deterministic ·
 * เครื่องไทย/นอกไม่พบแถวของตัวเอง → ถอยไปแถว "ไม่ระบุ" (สเปค 2026-11-19 ข้อ 7.1)
 */
export function pickPricingTemplate<T extends TemplateMatchRow>(rows: T[], key: TemplateMatchKey): T | null {
  const brand = key.brand.trim().toLowerCase();
  const model = key.model.trim().toLowerCase();
  const sameModel = rows.filter(
    (r) =>
      r.category === key.category &&
      r.brand.trim().toLowerCase() === brand &&
      r.model.trim().toLowerCase() === model,
  );
  const origin: PricingDeviceOrigin = key.deviceOrigin ?? 'UNSPECIFIED';
  const own = selectWithin(sameModel.filter((r) => r.deviceOrigin === origin), key);
  if (own || origin === 'UNSPECIFIED') return own;
  return selectWithin(sameModel.filter((r) => r.deviceOrigin === 'UNSPECIFIED'), key);
}

/** อ่านแถวที่เกี่ยวข้องจากฐานข้อมูลแล้วเลือกด้วย `pickPricingTemplate` · ไม่มียี่ห้อ/รุ่น = null */
export async function findPricingTemplate(tx: Prisma.TransactionClient, key: TemplateMatchKey) {
  if (!key.brand || !key.model) return null;
  const origin: PricingDeviceOrigin = key.deviceOrigin ?? 'UNSPECIFIED';
  const rows = await tx.pricingTemplate.findMany({
    where: {
      deviceOrigin: { in: origin === 'UNSPECIFIED' ? ['UNSPECIFIED'] : [origin, 'UNSPECIFIED'] },
      isActive: true,
      deletedAt: null,
      category: key.category,
      brand: { equals: key.brand, mode: 'insensitive' },
      model: { equals: key.model, mode: 'insensitive' },
    },
    orderBy: TEMPLATE_ORDER,
  });
  return pickPricingTemplate(rows, key);
}
```

`apps/api/src/utils/product-finance-price.util.ts`:

```ts
import { Prisma, ProductCategory } from '@prisma/client';
import { FINANCE_LABEL, syncPriceRowsFromColumns } from './product-price-sync.util';
import { findPricingTemplate, positiveDecimal, type TemplateMatchKey } from './pricing-template-match.util';

/** ช่องของเครื่องที่ใช้หาแถวราคากลาง */
export interface ProductTemplateFields {
  brand: string;
  model: string;
  storage: string | null;
  category: ProductCategory;
  deviceOrigin: 'THAI' | 'IMPORTED' | null;
  warrantyExpired: boolean | null;
  warrantyExpireDate: Date | null;
}

/** สรุปสถานะประกันของเครื่องสำหรับเลือกแถวราคากลาง — null = ไม่รู้ (ย้ายมาจาก products.service.ts) */
export function resolveHasWarranty(p: {
  category: string;
  warrantyExpired: boolean | null;
  warrantyExpireDate: Date | null;
}): boolean | null {
  if (p.category !== 'PHONE_USED') return false;
  if (p.warrantyExpired === true) return false;
  if (p.warrantyExpired === false) return true;
  if (p.warrantyExpireDate) return p.warrantyExpireDate.getTime() > Date.now();
  return null;
}

export function templateKeyOf(p: ProductTemplateFields): TemplateMatchKey {
  return {
    brand: p.brand,
    model: p.model,
    storage: p.storage,
    category: p.category,
    deviceOrigin: p.deviceOrigin,
    hasWarranty: resolveHasWarranty(p),
  };
}

/** ราคาขาย GFIN จากราคากลางของรุ่น (ราคาเต็ม) · ไม่มีแถว / ราคา ≤ 0 = null */
export async function templateFinancePrice(
  tx: Prisma.TransactionClient,
  key: TemplateMatchKey,
): Promise<Prisma.Decimal | null> {
  const template = await findPricingTemplate(tx, key);
  return positiveDecimal(template?.installmentFinancePrice);
}

/**
 * แถว "ราคาผ่อนไฟแนนซ์" ตามคอลัมน์ที่เพิ่งเขียน — มีราคา = upsert (ไม่เป็นค่าเริ่มต้น) ·
 * null = ลบแถวเดิมแบบ soft (ไม่ปล่อยราคาของตอนเป็นเครื่องใหม่ค้าง) · แถวที่เป็นค่าเริ่มต้นไม่แตะ
 */
export async function syncFinancePriceRow(
  tx: Prisma.TransactionClient,
  productId: string,
  price: Prisma.Decimal | null,
): Promise<void> {
  if (price) {
    await syncPriceRowsFromColumns(tx, productId, { financePrice: price });
    return;
  }
  await tx.productPrice.updateMany({
    where: { productId, label: FINANCE_LABEL, isDefault: false, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

/**
 * ขั้นเติมราคาขาย GFIN ตอนสร้างเครื่อง (ทุกทางเข้า — สเปคข้อ 3.2) แยกจากตัวเติมราคาเงินสด
 * เพราะตัวเติมเดิมหยุดเมื่อมีราคาเงินสดแล้ว · ไม่พบราคากลาง = ไม่เขียนอะไร · ต้องเรียกใน tx ของผู้เรียก
 */
export async function fillFinancePriceFromTemplate(
  tx: Prisma.TransactionClient,
  productId: string,
  key: TemplateMatchKey,
): Promise<Prisma.Decimal | null> {
  const price = await templateFinancePrice(tx, key);
  if (!price) return null;
  await tx.product.update({ where: { id: productId }, data: { financePrice: price } });
  await syncFinancePriceRow(tx, productId, price);
  return price;
}
```

- [ ] **Step 4: ตัวเติมราคาเดิมใช้ตัวเลือกเดียวกัน (refactor — พฤติกรรมเท่าเดิม)**

`apps/api/src/utils/product-price-autofill.util.ts` (ฉบับช่วง 2ก):

1. import สามบรรทัดแรก แทนด้วย:

```ts
import { Prisma, ProductCategory } from '@prisma/client';
import { syncPriceRowsFromColumns } from './product-price-sync.util';
import { findPricingTemplate } from './pricing-template-match.util';
```

2. ลบฟังก์ชัน `pickTemplate` ทั้งตัว (รวมคอมเมนต์ `/** เลือกแถวจากชุดเดียวกัน … */` เหนือมัน) — คง `type Logger` ไว้
3. ใน `autofillProductPriceFromTemplate` แทนบล็อกตั้งแต่ `const origin = input.deviceOrigin ?? 'UNSPECIFIED';` ถึงบรรทัด `if (!template) return { filled: false, reason: 'NO_TEMPLATE' };` ที่อยู่หลังลูป `for (const o of origins)` ด้วย:

```ts
  // ตัวเลือกแถวตัวเดียวกับราคาขาย GFIN (`fillFinancePriceFromTemplate`) — ความจุ · ประกัน · ถอยไป "ไม่ระบุ" (ข้อ 7.1)
  const template = await findPricingTemplate(tx, input);
  if (!template) return { filled: false, reason: 'NO_TEMPLATE' };
  if (input.category === 'PHONE_USED' && input.hasWarranty === null) {
    logger?.log(
      `[autofill] product=${input.productId} ไม่รู้สถานะประกัน — ใช้ราคาแถว "ไม่มีประกัน" ถ้ามี (${input.brand} ${input.model} ${input.storage ?? 'ไม่ระบุความจุ'})`,
    );
  }
```

ส่วนที่เหลือ (เงินสด · ราคาผ่อนเสมอ · `product.update` · `syncPriceRowsFromColumns` · return) คงตามช่วง 2ก

- [ ] **Step 5: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/utils/pricing-template-match.util.spec.ts src/utils/product-finance-price.util.spec.ts src/utils/product-price-autofill.util.spec.ts src/modules/products/products-price-columns.service.spec.ts src/modules/purchase-orders src/modules/trade-in`
Expected: PASS ทุกไฟล์ — `product-price-autofill.util.spec.ts` ผ่านโดยไม่แก้ (ถ้าล้ม แปลว่า `findPricingTemplate` เลือกแถวต่างจากตัวเลือกของช่วง 2ก ต้องแก้ util ไม่ใช่เทสต์)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/utils/pricing-template-match.util.ts apps/api/src/utils/pricing-template-match.util.spec.ts apps/api/src/utils/product-finance-price.util.ts apps/api/src/utils/product-finance-price.util.spec.ts apps/api/src/utils/product-price-autofill.util.ts
git commit -m "feat(pricing): one template picker shared by price autofill and GFIN sale price fill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `financePrice` ใน `POST/PATCH /products` + เติมตอนสร้างทั้ง 3 ทางเข้า

**Files:**
- Modify: `apps/api/src/modules/products/dto/create-product.dto.ts:91` (ต่อท้าย `installmentPrice?: number | null;`)
- Modify: `apps/api/src/modules/products/dto/update-product.dto.ts:78` (ต่อท้าย `installmentPrice?: number | null;`)
- Modify: `apps/api/src/modules/products/products.service.ts:18`, `:30`, `:245`, `:262-267`, `:284`, `:318-341`, `:388-435`, `:898-910`
- Modify: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` (หลังบล็อก else ของ autofill ที่ปิดก่อน `// Create receiving item linked to product`)
- Modify: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts:42`, หลัง `:651`
- Modify: `apps/api/src/modules/products/products-price-columns.service.spec.ts`
- Create: `apps/api/src/modules/purchase-orders/purchase-orders.finance-price.spec.ts`
- Modify: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts`

**Interfaces:**
- Consumes: `fillFinancePriceFromTemplate`, `templateKeyOf`, `resolveHasWarranty`, `syncFinancePriceRow` (Task 2) · `syncPriceRowsFromColumns({ financePrice })` (Task 1)
- Produces: `CreateProductDto.financePrice?: number | null` · `UpdateProductDto.financePrice?: number | null` · ทุกทางเข้าที่สร้าง Product เรียก `fillFinancePriceFromTemplate` เมื่อไม่ได้ส่ง `financePrice`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน — หน้าเพิ่มสินค้า / PATCH**

`apps/api/src/modules/products/products-price-columns.service.spec.ts`:

1. ใน `beforeEach` แก้ mock `tx.product.create` ให้คืนข้อมูลที่สร้าง (ตัวเติมราคาอ่านยี่ห้อ/รุ่นจากแถวที่ได้):

```ts
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data })),
```

2. เทมเพลตใน 2 เคสเดิม (`fix round 1 [Critical]` และ `ไม่ส่งอะไรเลย…`) ต้องมี `deviceOrigin: 'UNSPECIFIED',` (ช่วง 2ก Task 4 เพิ่มไว้แล้ว — ถ้ายังไม่มีให้เพิ่มต่อจาก `id: 't1',`)
3. ในเคส `fix round 1 [Critical]` ลบบรรทัด `expect(tx.pricingTemplate.findMany).not.toHaveBeenCalled();` และคอมเมนต์เหนือมัน แทนด้วย:

```ts
    // ราคากลางถูกอ่านเพื่อหาราคาขาย GFIN (ขั้นของตัวเอง — สเปค 2026-11-19 ข้อ 3.2) แต่ราคาเงินสดต้องไม่ถูกเติมทับ
    // (เทมเพลตนี้ไม่มีราคาขาย GFIN ⇒ ไม่มี product.update เลย)
```

4. เพิ่มท้าย `describe` (ก่อน `});` ตัวสุดท้าย):

```ts
  // ── สเปค 2026-11-19 ข้อ 3.2 — ราคาขาย GFIN ของเครื่อง ──────────────────────────────
  const GFIN_TEMPLATE = {
    id: 't1', brand: 'Apple', model: '15', storage: '', category: 'PHONE_NEW',
    hasWarranty: false, deviceOrigin: 'UNSPECIFIED',
    cashPrice: new Prisma.Decimal('28900'),
    installmentBestchoicePrice: new Prisma.Decimal('29900'),
    installmentFinancePrice: new Prisma.Decimal('30900'),
  };

  it('create: กรอกราคาเงินสดเอง + ไม่ส่ง financePrice → ยังเติมราคาขาย GFIN จากราคากลาง (ขั้นของตัวเอง)', async () => {
    tx.pricingTemplate.findMany.mockResolvedValue([GFIN_TEMPLATE]);
    await service.create({
      name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
      costPrice: 15000, branchId: 'b1', cashPrice: 25000,
    } as never);
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    const data = tx.product.update.mock.calls[0][0].data;
    expect(data).toEqual({ financePrice: new Prisma.Decimal('30900') });
    expect(tx.productPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ label: 'ราคาผ่อนไฟแนนซ์', isDefault: false }) }),
    );
  });

  it('create: ส่ง financePrice มาเอง → เขียนคอลัมน์ + แถวไฟแนนซ์ ไม่อ่านราคากลาง', async () => {
    await service.create({
      name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
      costPrice: 15000, branchId: 'b1', cashPrice: 25000, financePrice: 27000,
    } as never);
    expect(tx.product.create.mock.calls[0][0].data.financePrice.toString()).toBe('27000');
    expect(tx.pricingTemplate.findMany).not.toHaveBeenCalled();
    expect(tx.productPrice.create).toHaveBeenCalledWith({
      data: { productId: 'p1', label: 'ราคาผ่อนไฟแนนซ์', amount: new Prisma.Decimal('27000'), isDefault: false },
    });
  });

  it('create: financePrice: null = ยืนยันว่าไม่มี → ไม่เติมจากราคากลาง', async () => {
    tx.pricingTemplate.findMany.mockResolvedValue([GFIN_TEMPLATE]);
    await service.create({
      name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
      costPrice: 15000, branchId: 'b1', cashPrice: 25000, financePrice: null,
    } as never);
    expect(tx.product.create.mock.calls[0][0].data.financePrice).toBeNull();
    expect(tx.pricingTemplate.findMany).not.toHaveBeenCalled();
  });

  it('update: แก้ราคาขาย GFIN → เขียนคอลัมน์ + เคลียร์ป้ายเติมอัตโนมัติ + แถวไฟแนนซ์', async () => {
    await service.update('p1', { financePrice: 31900 } as never);
    const data = tx.product.update.mock.calls[0][0].data;
    expect(data.financePrice.toString()).toBe('31900');
    expect(data.priceAutofilledAt).toBeNull();
    expect(tx.productPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ label: 'ราคาผ่อนไฟแนนซ์' }) }),
    );
  });

  it('update: financePrice: null → ล้างคอลัมน์ + ลบแถวไฟแนนซ์ (soft)', async () => {
    await service.update('p1', { financePrice: null } as never);
    expect(tx.product.update.mock.calls[0][0].data.financePrice).toBeNull();
    expect(tx.productPrice.updateMany).toHaveBeenCalledWith({
      where: { productId: 'p1', label: 'ราคาผ่อนไฟแนนซ์', isDefault: false, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });
```

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน — รับของจากใบสั่งซื้อ**

`apps/api/src/modules/purchase-orders/purchase-orders.finance-price.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { poJournalTestProviders } from './po-journal.test-helpers';

/** สเปค 2026-11-19 ข้อ 3.2 — รับของจากใบสั่งซื้อ: ราคาขาย GFIN เติมจากราคากลางแม้กรอกราคาขายมาเอง */
describe('goodsReceiving — ราคาขาย GFIN ของเครื่องที่รับเข้า', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  const TEMPLATE = {
    id: 't16', brand: 'Apple', model: 'iPhone 16', storage: '', category: 'PHONE_NEW',
    hasWarranty: false, deviceOrigin: 'UNSPECIFIED',
    cashPrice: new Prisma.Decimal('30900'),
    installmentBestchoicePrice: new Prisma.Decimal('31900'),
    installmentFinancePrice: new Prisma.Decimal('32900'),
  };

  beforeEach(async () => {
    const items = [{ id: 'poi-1', brand: 'Apple', model: 'iPhone 16', quantity: 5, receivedQty: 0, category: 'PHONE_NEW', accessoryType: null, accessoryBrand: null, color: null, storage: null, unitPrice: 30000 }];
    tx = {
      purchaseOrderPayment: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue({ id: 'po-1', status: 'APPROVED', deletedAt: null, supplierId: 'sup-1', supplier: { id: 'sup-1', name: 'Sup' }, items }),
        update: jest.fn().mockResolvedValue({}),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }), count: jest.fn().mockResolvedValue(0) },
      goodsReceivingItem: { create: jest.fn().mockResolvedValue({ id: 'gri1' }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      product: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'prod-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      productPrice: {
        create: jest.fn().mockResolvedValue({ id: 'row-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([TEMPLATE]) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      pOItem: {
        findMany: jest.fn().mockImplementation(() => Promise.resolve(items.map((i) => ({ ...i })))),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = { $transaction: jest.fn().mockImplementation(async (fn: any) => (typeof fn === 'function' ? fn(tx) : Promise.all(fn))) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }, ...poJournalTestProviders().providers],
    }).compile();
    service = module.get(PurchaseOrdersService);
  });

  const financeWrites = () =>
    tx.product.update.mock.calls.filter(([args]: [{ data: Record<string, unknown> }]) => args.data.financePrice !== undefined);

  it('กรอกราคาขายตอนรับ → ราคาเงินสดตามที่กรอก แต่ราคาขาย GFIN มาจากราคากลาง', async () => {
    await service.goodsReceiving('po-1', { items: [{ poItemId: 'poi-1', status: 'PASS', imeiSerial: 'IMEI-FIN-1', sellingPrice: 29900 }] } as never, 'user-1');
    expect(financeWrites()).toHaveLength(1);
    expect(financeWrites()[0][0]).toEqual({ where: { id: 'prod-1' }, data: { financePrice: new Prisma.Decimal('32900') } });
    const cashWrite = tx.product.update.mock.calls.find(([args]: [{ data: Record<string, unknown> }]) => args.data.cashPrice !== undefined);
    expect(cashWrite[0].data.cashPrice.toString()).toBe('29900');
  });

  it('ไม่กรอกราคา → เติมเงินสด + ผ่อนจากราคากลาง และราคาขาย GFIN อีกขั้น', async () => {
    await service.goodsReceiving('po-1', { items: [{ poItemId: 'poi-1', status: 'PASS', imeiSerial: 'IMEI-FIN-2' }] } as never, 'user-1');
    const autofill = tx.product.update.mock.calls.find(([args]: [{ data: Record<string, unknown> }]) => args.data.cashPrice !== undefined);
    expect(autofill[0].data.cashPrice.toString()).toBe('30900');
    expect(autofill[0].data.installmentPrice.toString()).toBe('31900');
    expect(financeWrites()[0][0].data.financePrice.toString()).toBe('32900');
  });
});
```

- [ ] **Step 3: เขียนเทสต์ที่ยังไม่ผ่าน — รับเทิร์น**

`apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts`:

1. ใน `makeTx()` เพิ่ม `update` ให้ `product` และเพิ่ม `productPrice` (ตัวเติมราคาเขียนแถวราคา):

```ts
    product: {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    productPrice: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'row-1' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
```

2. เพิ่มเคสต่อจาก "Test 1" ใน `describe('TradeInLifecycleService.accept() — SHOP JE wiring (Task 2)', …)`:

```ts
  // ─── สเปค 2026-11-19 ข้อ 3.2: เครื่องเทิร์นได้ราคาขาย GFIN จากราคากลางมือ 2 ─────────
  it('รับเทิร์น → เติมราคาขาย GFIN จากราคากลางมือ 2 (เครื่องนอกถอยไปแถว "ไม่ระบุ")', async () => {
    tx.tradeIn.findUnique.mockResolvedValue({
      id: 'ti-9', status: 'APPRAISED', deletedAt: null, flow: 'BUYBACK', branchId: 'br-1',
      offeredPrice: new Decimal(5000), estimatedValue: null, imei: null,
      deviceBrand: 'Apple', deviceModel: 'iPhone 12', deviceColor: null, deviceStorage: null,
      deviceCondition: 'A', notes: null,
    });
    tx.product.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'p-new', warrantyExpired: null, warrantyExpireDate: null, ...data,
    }));
    tx.pricingTemplate.findMany.mockResolvedValue([
      {
        id: 't12', brand: 'Apple', model: 'iPhone 12', storage: '', category: 'PHONE_USED',
        hasWarranty: false, deviceOrigin: 'UNSPECIFIED',
        cashPrice: new Decimal(8900), installmentBestchoicePrice: new Decimal(8900),
        installmentFinancePrice: new Decimal(9900),
      },
    ]);
    tx.tradeIn.update.mockResolvedValue({ id: 'ti-9', status: 'ACCEPTED' });
    shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1102');

    await service.accept(
      'ti-9',
      { sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS', sellerIdCardNumber: '0000000000001', serialNumber: 'TEST-SN', imeiMissingReason: 'TEST: no cellular radio', idCardVerified: true, sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==', paymentMethod: 'CASH', deviceOrigin: 'IMPORTED' } as any,
      'u-1',
    );

    const financeWrite = tx.product.update.mock.calls.find(
      ([args]: [{ data: Record<string, unknown> }]) => args.data.financePrice !== undefined,
    );
    expect(financeWrite?.[0]).toEqual({ where: { id: 'p-new' }, data: { financePrice: new Prisma.Decimal(9900) } });
  });
```

และเพิ่ม `import { Prisma } from '@prisma/client';` ใต้บรรทัด `import { Decimal } from '@prisma/client/runtime/library';`

- [ ] **Step 4: รันให้เห็นว่าล้ม**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/products/products-price-columns.service.spec.ts src/modules/purchase-orders/purchase-orders.finance-price.spec.ts src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts`
Expected: FAIL — เคสใหม่ทั้งหมดไม่พบการเขียน `financePrice` (`expect(received).toHaveLength(1)` ได้ 0 · `financeWrite` เป็น `undefined`) · เคส create ที่ส่ง `financePrice` ได้ `data.financePrice` เป็น `undefined`

- [ ] **Step 5: DTO**

`create-product.dto.ts` ต่อท้ายบรรทัด 91 และ `update-product.dto.ts` ต่อท้ายบรรทัด 78 (เหมือนกันทั้งสองไฟล์):

```ts

  /**
   * ราคาขาย GFIN ของเครื่อง (ราคาเต็ม — สเปค 2026-11-19 ข้อ 3.2) ·
   * ไม่ส่ง = สร้าง: เติมจากราคากลาง / แก้: ไม่แตะ · ตัวเลข ≥ 1 = ตั้ง · null = ไม่มี/ล้าง
   */
  @IsNumber({}, { message: 'ราคาขาย GFIN ต้องเป็นตัวเลข' })
  @Min(1, { message: 'ราคาขาย GFIN ต้องมากกว่า 0 (ถ้าต้องการล้างราคาให้ส่ง null)' })
  @IsOptional()
  financePrice?: number | null;
```

- [ ] **Step 6: `products.service.ts`**

1. หลังบรรทัด 30 (`import { autofillProductPriceFromTemplate } …`) เพิ่ม:

```ts
import {
  fillFinancePriceFromTemplate,
  resolveHasWarranty,
  syncFinancePriceRow,
  templateKeyOf,
} from '../../utils/product-finance-price.util';
```

2. ลบฟังก์ชัน `resolveHasWarranty` ท้ายไฟล์ (บรรทัด 898–910 รวมคอมเมนต์ `/** สรุปสถานะประกัน… */`) — ย้ายไป util แล้ว
3. `create()` บรรทัด 245 แทนด้วย:

```ts
    const { prices, costPrice, warrantyExpireDate, cashPrice, installmentPrice, financePrice, accessoriesIncluded, ...data } = dto;
```

ต่อจากบล็อก `const installmentDecimal = …;` (จบบรรทัด 267) เพิ่ม:

```ts
    const financeDecimal =
      financePrice === undefined ? undefined : financePrice === null ? null : new Prisma.Decimal(financePrice);
```

ใน `tx.product.create({ data: { … } })` ต่อจากบรรทัด 284 (`...(installmentDecimal !== undefined ? { installmentPrice: installmentDecimal } : {}),`) เพิ่ม:

```ts
          ...(financeDecimal !== undefined ? { financePrice: financeDecimal } : {}),
```

แทนบรรทัด 336–341 (คอมเมนต์ "B0 §2.1: write-through…" + `await syncPriceRowsFromColumns(…)`) ด้วย:

```ts
      // สเปค 2026-11-19 ข้อ 3.2: ราคาขาย GFIN เป็นขั้นของตัวเอง — เติมจากราคากลางแม้ผู้สร้างกรอกราคาเงินสดเอง
      // ไม่ส่งมา (undefined) = เติม · ส่ง null = ยืนยันว่าไม่มี ห้ามเติม
      if (financeDecimal === undefined) {
        await fillFinancePriceFromTemplate(tx, product.id, templateKeyOf(product));
      }

      // B0 §2.1: write-through คอลัมน์ → prices[] (ผู้อ่านเดิม POS/สัญญา/บอท ไม่พัง)
      // null ส่งเข้าไปได้ — util จะ "ข้ามฟิลด์นั้น" (ไม่ sync ไม่ลบแถว) ตามกติกาข้อ 4
      await syncPriceRowsFromColumns(tx, product.id, {
        cashPrice: cashDecimal ?? null,
        installmentPrice: installmentDecimal ?? null,
        financePrice: financeDecimal ?? null,
      });
```

4. `update()` บรรทัด 388–389 แทนด้วย:

```ts
    const { costPrice, warrantyExpireDate, cashPrice, installmentPrice, financePrice, accessoriesIncluded, ...data } = dto;
    const touchesPrice = cashPrice !== undefined || installmentPrice !== undefined || financePrice !== undefined;
```

ต่อจากบล็อก `const installmentDecimal = …;` ของ `update()` (จบบรรทัด 398) เพิ่ม:

```ts
    const financeDecimal =
      financePrice === undefined ? undefined : financePrice === null ? null : new Prisma.Decimal(financePrice);
```

ใน `tx.product.update({ data: { … } })` ต่อจากบรรทัด 418 (`...(installmentDecimal !== undefined ? { installmentPrice: installmentDecimal } : {}),`) เพิ่ม:

```ts
          ...(financeDecimal !== undefined ? { financePrice: financeDecimal } : {}),
```

ต่อจากบล็อก `if (touchesPrice) { await syncPriceRowsFromColumns(…) }` (ปิดบรรทัด 435) เพิ่ม:

```ts
      // แก้ราคาขาย GFIN ด้วยมือ: เขียนเฉพาะเมื่อส่งมา · null = ล้างคอลัมน์และลบแถวสำเนา
      if (financeDecimal !== undefined) {
        await syncFinancePriceRow(tx, id, financeDecimal);
      }
```

(คอลัมน์ `resolveHasWarranty(product)` ในบล็อก autofill ของ `create()` บรรทัด 329 ใช้ตัวที่ import มา ไม่ต้องแก้)

- [ ] **Step 7: รับของจากใบสั่งซื้อ + รับเทิร์น**

`po-receiving.service.ts` — import เพิ่มต่อจาก import ของ `product-price-autofill.util`:

```ts
import { fillFinancePriceFromTemplate, templateKeyOf } from '../../../utils/product-finance-price.util';
```

แทรกหลัง `}` ที่ปิดบล็อก `else { … autofill … }` (บรรทัดก่อน `// Create receiving item linked to product`):

```ts

        // สเปค 2026-11-19 ข้อ 3.2: ราคาขาย GFIN เป็นขั้นของตัวเอง — เติมแม้กรอกราคาขายตอนรับมาแล้ว
        // fail-soft เหมือนตัวเติมราคา แต่ปล่อย P2002/P2034 ขึ้นไปให้ retry loop ของ goodsReceiving()
        try {
          await fillFinancePriceFromTemplate(tx, product.id, templateKeyOf(product));
        } catch (e) {
          const code = (e as { code?: string })?.code;
          if (code === 'P2002' || code === 'P2034') throw e;
          this.logger.error(
            `[finance-price] product=${product.id} ข้ามการเติมราคาขาย GFIN (รับเข้าต่อได้ปกติ): ${e instanceof Error ? e.message : String(e)}`,
          );
        }
```

`trade-in-lifecycle.service.ts` — ต่อจากบรรทัด 42 เพิ่ม:

```ts
import { fillFinancePriceFromTemplate, templateKeyOf } from '../../../utils/product-finance-price.util';
```

แทรกหลัง `}` ที่ปิด `catch` ของ autofill (บรรทัด 651 — ก่อน `const updated = await tx.tradeIn.update(`):

```ts

      // สเปค 2026-11-19 ข้อ 3.2: ราคาขาย GFIN เป็นขั้นของตัวเอง — fail-soft เหมือนตัวเติมราคาด้านบน
      try {
        await fillFinancePriceFromTemplate(tx, product.id, templateKeyOf(product));
      } catch (e) {
        this.logger.error(
          `[finance-price] product=${product.id} ข้ามการเติมราคาขาย GFIN (รับซื้อต่อได้ปกติ): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
```

- [ ] **Step 8: รันให้ผ่าน**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/products src/modules/purchase-orders src/modules/trade-in`
Expected: PASS ทุกไฟล์ (รวมเทสต์เดิมของ products/PO/trade-in)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/products/dto/create-product.dto.ts apps/api/src/modules/products/dto/update-product.dto.ts apps/api/src/modules/products/products.service.ts apps/api/src/modules/products/products-price-columns.service.spec.ts apps/api/src/modules/purchase-orders/services/po-receiving.service.ts apps/api/src/modules/purchase-orders/purchase-orders.finance-price.spec.ts apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts
git commit -m "feat(products): accept financePrice and fill it from the price template on every create path" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ตั้งราคาขาย GFIN ใหม่เมื่อระบบตั้งราคาเครื่องใหม่ ("พร้อมขาย" ของเครื่องยึด · "นำเข้าคลังพร้อมขาย")

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts:45`, `:1267-1277`
- Modify: `apps/api/src/modules/repossessions/repossessions.service.spec.ts` (mock `prisma` ใน `beforeEach` + `describe('markReadyForSale …')`)
- Modify: `apps/api/src/modules/products/products.service.ts` (`returnToStock()` — tx ที่บรรทัด 537–560)
- Modify: `apps/api/src/modules/products/products.service.spec.ts` (`describe('ProductsService.returnToStock …')`)
- Modify: `apps/api/src/modules/products/product-enter-stock.util.ts:3`, `:178-181`
- Modify: `apps/api/src/modules/products/product-enter-stock.util.spec.ts`
- Modify: `apps/web/src/utils/getDisplayPrices.ts:5-18`
- Modify: `apps/web/src/pages/ProductDetailPage/components/ReturnToStockAction.tsx:5`, `:69-73`
- Modify: `apps/web/src/pages/ProductDetailPage/components/__tests__/ReturnToStockAction.test.tsx`

**Interfaces:**
- Consumes: `templateFinancePrice`, `templateKeyOf`, `syncFinancePriceRow` (Task 2) · `FINANCE_LABEL` (Task 1)
- Produces: `markReadyForSale` / `returnToStock` เขียน `financePrice` = ราคากลางของหมวดปัจจุบัน หรือ `null` · web `FINANCE_LABEL` + `CANONICAL_PRICE_LABELS` มี 3 label · ด่านยืนยันราคาไม่นับแถว "ราคาผ่อนไฟแนนซ์" ที่ไม่ใช่ค่าเริ่มต้นเป็นราคาค้าง

เหตุผลของด่านยืนยันราคา: เครื่องทุกเครื่องที่สร้างหลังงานนี้ (และเครื่องที่หน้าเพิ่มสินค้าเดิมเติมจากราคากลาง) มีแถว "ราคาผ่อนไฟแนนซ์" — `unconfirmedLeftoverPrices` เดิมนับแถวนี้เป็น "ราคาเก่าที่ยังไม่ยืนยัน" ⇒ ปุ่ม "นำเข้าคลังพร้อมขาย" จะถูกบล็อกทุกครั้งก่อนถึงขั้นตั้งราคาใหม่ ทั้งที่ปุ่มนี้ทับ/ลบแถวนั้นเองแล้ว

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน — API**

`repossessions.service.spec.ts` — ใน `beforeEach` เพิ่มใน object `prisma` (ต่อจาก `productPhoto: {…},`):

```ts
      // สเปค 2026-11-19 ข้อ 3.2 — "พร้อมขาย" ตั้งราคาขาย GFIN ใหม่ตามราคากลางของหมวดปัจจุบัน
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
```

เพิ่มท้าย `describe('markReadyForSale — พร้อมขาย = สองราคา + เข้าคิวรอถ่ายรูป (2026-09-07)', …)`:

```ts
    const usedProduct = {
      id: 'prod-1', prices: [], brand: 'Apple', model: 'iPhone 14', storage: '128GB',
      category: 'PHONE_USED', deviceOrigin: null, warrantyExpired: null, warrantyExpireDate: null,
    };

    it('ราคาขาย GFIN ตั้งใหม่ตามราคากลางมือ 2 (สเปค 2026-11-19 ข้อ 3.2)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(repoRow({ product: usedProduct }));
      arm();
      prisma.pricingTemplate.findMany.mockResolvedValue([
        {
          id: 't14u', brand: 'Apple', model: 'iPhone 14', storage: '128GB', category: 'PHONE_USED',
          hasWarranty: false, deviceOrigin: 'UNSPECIFIED',
          cashPrice: decimal(15900), installmentBestchoicePrice: decimal(17900), installmentFinancePrice: decimal(18500),
        },
      ]);

      await service.markReadyForSale('r1', { resellPrice: 15000, installmentPrice: 16900 });

      const priceUpdate = prisma.product.update.mock.calls.find(
        (c: [{ data: { cashPrice?: unknown } }]) => c[0].data.cashPrice !== undefined,
      );
      expect(priceUpdate[0].data.financePrice.toString()).toBe('18500');
      expect(prisma.productPrice.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ label: 'ราคาผ่อนไฟแนนซ์', isDefault: false }) }),
      );
    });

    it('ไม่มีราคากลางของหมวดปัจจุบัน → ล้างราคาขาย GFIN (ไม่ปล่อยค่าตอนเป็นเครื่องใหม่ค้าง)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(repoRow({ product: usedProduct }));
      arm();

      await service.markReadyForSale('r1', { resellPrice: 15000, installmentPrice: 16900 });

      const priceUpdate = prisma.product.update.mock.calls.find(
        (c: [{ data: { cashPrice?: unknown } }]) => c[0].data.cashPrice !== undefined,
      );
      expect(priceUpdate[0].data.financePrice).toBeNull();
      expect(prisma.productPrice.updateMany).toHaveBeenCalledWith({
        where: { productId: 'prod-1', label: 'ราคาผ่อนไฟแนนซ์', isDefault: false, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });
```

`products.service.spec.ts` — ใน `describe('ProductsService.returnToStock …')` `beforeEach` เพิ่มใน `tx` (ต่อจาก `auditLog: …`):

```ts
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
```

แล้วเพิ่มเคสท้าย `describe` นั้น:

```ts
  // สเปค 2026-11-19 ข้อ 3.2 — ระบบตั้งราคาเครื่องใหม่ ⇒ ราคาขาย GFIN ตามราคากลางของหมวดปัจจุบัน
  const usedRow = { brand: 'Apple', model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED', deviceOrigin: 'THAI', warrantyExpired: true, warrantyExpireDate: null };

  it('ราคาขาย GFIN ตั้งใหม่จากราคากลางมือ 2 ใน tx เดียวกับการเข้าคลัง', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow(usedRow));
    tx.pricingTemplate.findMany.mockResolvedValue([
      {
        id: 't13', brand: 'Apple', model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED',
        hasWarranty: false, deviceOrigin: 'UNSPECIFIED',
        cashPrice: new Prisma.Decimal('12500'), installmentBestchoicePrice: new Prisma.Decimal('10200'),
        installmentFinancePrice: new Prisma.Decimal('9600'),
      },
    ]);
    await service.returnToStock('p-1', 'user-1', dto);
    expect(tx.product.updateMany.mock.calls[0][0].data.financePrice.toString()).toBe('9600');
    expect(tx.productPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ label: 'ราคาผ่อนไฟแนนซ์', isDefault: false }) }),
    );
  });

  it('ไม่มีราคากลาง → ล้างราคาขาย GFIN และลบแถวสำเนา', async () => {
    prisma.product.findUnique.mockResolvedValue(productRow(usedRow));
    await service.returnToStock('p-1', 'user-1', dto);
    expect(tx.product.updateMany.mock.calls[0][0].data.financePrice).toBeNull();
    expect(tx.productPrice.updateMany).toHaveBeenCalledWith({
      where: { productId: 'p-1', label: 'ราคาผ่อนไฟแนนซ์', isDefault: false, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('แถว "ราคาผ่อนไฟแนนซ์" ที่ค้างอยู่ไม่บล็อกการนำเข้าคลัง (ระบบตั้งใหม่ให้เอง)', async () => {
    prisma.product.findUnique.mockResolvedValue(
      productRow({ ...usedRow, prices: [{ label: 'ราคาผ่อนไฟแนนซ์', amount: new Prisma.Decimal('21900'), isDefault: false, deletedAt: null }] }),
    );
    await expect(service.returnToStock('p-1', 'user-1', dto)).resolves.toBeDefined();
  });
```

`product-enter-stock.util.spec.ts` — เพิ่มต่อจากเคส `'แถว canonical ที่ sync ทับแน่ ๆ …'`:

```ts
  it('แถว "ราคาผ่อนไฟแนนซ์" ที่ไม่ใช่ค่าเริ่มต้นไม่นับเป็นค้าง — ปุ่มนำเข้าคลังตั้งราคาขาย GFIN ใหม่เอง (สเปค 2026-11-19 ข้อ 3.2)', () => {
    const left = unconfirmedLeftoverPrices(
      {
        cashPrice: null,
        installmentPrice: null,
        prices: [
          { label: 'ราคาเงินสด', amount: D('15900'), isDefault: true, deletedAt: null },
          { label: 'ราคาผ่อนไฟแนนซ์', amount: D('21900'), isDefault: false, deletedAt: null },
        ],
      },
      { cashPrice: D('9900'), installmentPrice: null },
    );
    expect(left.rows).toEqual([]);
  });
```

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน — เว็บ (กระจกของด่านเดียวกัน)**

`apps/web/src/pages/ProductDetailPage/components/__tests__/ReturnToStockAction.test.tsx` — เพิ่มท้าย `describe('ReturnToStockAction (fix round 3)', …)`:

```tsx
  it('แถว "ราคาผ่อนไฟแนนซ์" ค้าง (ไม่ใช่ค่าเริ่มต้น) ไม่บล็อก — ระบบตั้งราคาขาย GFIN ใหม่ตอนนำเข้าคลัง', async () => {
    const onConfirm = vi.fn();
    render(
      <ReturnToStockAction
        {...base}
        prices={[{ id: 'pr-f', label: 'ราคาผ่อนไฟแนนซ์', amount: '21900', isDefault: false }]}
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: BUTTON }));
    expect(screen.queryByText(/แถวราคา/)).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: CONFIRM }));
    expect(onConfirm).toHaveBeenCalled();
  });
```

- [ ] **Step 3: รันให้เห็นว่าล้ม**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/repossessions/repossessions.service.spec.ts src/modules/products/products.service.spec.ts src/modules/products/product-enter-stock.util.spec.ts
cd apps/web && npx vitest run src/pages/ProductDetailPage/components/__tests__/ReturnToStockAction.test.tsx && cd ../..
```
Expected: FAIL — `priceUpdate[0].data.financePrice` เป็น `undefined` · `updateMany.mock.calls[0][0].data.financePrice` เป็น `undefined` · `left.rows` ได้ `['แถวราคา "ราคาผ่อนไฟแนนซ์" 21900']` · เว็บเจอข้อความ `แถวราคา "ราคาผ่อนไฟแนนซ์" 21900`

- [ ] **Step 4: เขียนโค้ด — API**

`repossessions.service.ts` ต่อจากบรรทัด 45 เพิ่ม:

```ts
import { syncFinancePriceRow, templateFinancePrice, templateKeyOf } from '../../utils/product-finance-price.util';
```

แทนบรรทัด 1267–1277 (`// B0 §2.1: คอลัมน์ราคาเป็นแหล่งจริง …` ถึง `});` ของ `syncPriceRowsFromColumns`) ด้วย:

```ts
      // B0 §2.1: คอลัมน์ราคาเป็นแหล่งจริง — write-through สร้าง/อัปเดตแถว ProductPrice ให้เอง
      // สเปค 2026-11-19 ข้อ 3.2: ราคาขาย GFIN = ราคากลางของหมวดปัจจุบัน (มือ 2 — เปลี่ยนตอนยึด) · ไม่มี = ล้าง
      const cashPrice = new Prisma.Decimal(resellPrice);
      const installment = new Prisma.Decimal(installmentPrice);
      const financePrice = await templateFinancePrice(tx, templateKeyOf(repo.product));
      await tx.product.update({
        where: { id: repo.product.id },
        data: { cashPrice, installmentPrice: installment, financePrice },
      });
      await syncPriceRowsFromColumns(tx, repo.product.id, {
        cashPrice,
        installmentPrice: installment,
      });
      await syncFinancePriceRow(tx, repo.product.id, financePrice);
```

`products.service.ts` — import ใน Task 3 Step 6 เพิ่ม `templateFinancePrice` เข้าไปในรายการเดียวกัน แล้วใน `returnToStock()` ภายใน `this.prisma.$transaction(async (tx) => {` (บรรทัด 537) แทรกเป็นบรรทัดแรก:

```ts
      // สเปค 2026-11-19 ข้อ 3.2: ระบบตั้งราคาเครื่องใหม่ → ราคาขาย GFIN ตามราคากลางของหมวดปัจจุบัน · ไม่มี = ล้าง
      const financePrice = await templateFinancePrice(tx, templateKeyOf(product));
```

ใน `data` ของ `tx.product.updateMany` ต่อจากบรรทัด `...(installmentDecimal ? { installmentPrice: installmentDecimal } : {}),` เพิ่ม:

```ts
          financePrice,
```

ต่อจาก `await syncPriceRowsFromColumns(tx, id, { cashPrice: cashDecimal, installmentPrice: installmentDecimal });` (ปิดบรรทัด 560) เพิ่ม:

```ts
      await syncFinancePriceRow(tx, id, financePrice);
```

`product-enter-stock.util.ts` บรรทัด 3 แทนด้วย:

```ts
import { CASH_LABEL, FINANCE_LABEL, INSTALLMENT_LABEL } from '../../utils/product-price-sync.util';
```

ต่อจากบล็อก `if (confirmed.installmentPrice) { … }` (ปิดบรรทัด 181) เพิ่ม:

```ts
  // สเปค 2026-11-19 ข้อ 3.2: ปุ่มนำเข้าคลังตั้งราคาขาย GFIN ใหม่จากราคากลางเสมอ (`syncFinancePriceRow`) ⇒
  // แถว "ราคาผ่อนไฟแนนซ์" ที่ไม่ใช่ค่าเริ่มต้นถูกระบบทับ/ลบ ไม่ใช่ราคาที่ต้องให้คนยืนยัน
  const financeIdx = rows.findIndex((r) => r.label === FINANCE_LABEL && !r.isDefault);
  if (financeIdx >= 0) overwritten.add(financeIdx);
```

- [ ] **Step 5: เขียนโค้ด — เว็บ**

`apps/web/src/utils/getDisplayPrices.ts` บรรทัด 7–18 (คอมเมนต์ + 3 const) แทนด้วย:

```ts
/**
 * Canonical `ProductPrice.label` values — the labels `syncPriceRowsFromColumns`
 * (apps/api) write-through targets when `Product.cashPrice` / `installmentPrice` /
 * `financePrice` (columns, source of truth) change. A price row with one of these
 * labels is not an independent editable row — it mirrors a column and must be
 * edited via `PATCH /products/:id` instead of the generic `/products/:id/prices`
 * CRUD (Task 13, StockPage PriceManagementModal column-awareness).
 */
export const CASH_LABEL = 'ราคาเงินสด';
export const INSTALLMENT_LABEL = 'ราคาผ่อน BESTCHOICE';
/** สำเนาของ `Product.financePrice` — ราคาขาย GFIN (สเปค 2026-11-19 ข้อ 3.2) */
export const FINANCE_LABEL = 'ราคาผ่อนไฟแนนซ์';
export const CANONICAL_PRICE_LABELS = [CASH_LABEL, INSTALLMENT_LABEL, FINANCE_LABEL] as const;
```

`ReturnToStockAction.tsx` บรรทัด 5 แทนด้วย `import { CASH_LABEL, FINANCE_LABEL, INSTALLMENT_LABEL } from '@/utils/getDisplayPrices';` และต่อจากบล็อก `if (confirmed.installment !== undefined) { … }` (ปิดบรรทัด 73) เพิ่ม:

```ts
  // กระจกของ API: ปุ่มนี้ตั้งราคาขาย GFIN ใหม่เอง ⇒ แถว "ราคาผ่อนไฟแนนซ์" ที่ไม่ใช่ค่าเริ่มต้นไม่ต้องยืนยัน
  const financeIdx = rows.findIndex((r) => r.label === FINANCE_LABEL && !r.isDefault);
  if (financeIdx >= 0) overwritten.add(financeIdx);
```

- [ ] **Step 6: รันให้ผ่าน**

Run: คำสั่งเดียวกับ Step 3
Expected: PASS ทุกไฟล์

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/repossessions/repossessions.service.ts apps/api/src/modules/repossessions/repossessions.service.spec.ts apps/api/src/modules/products/products.service.ts apps/api/src/modules/products/products.service.spec.ts apps/api/src/modules/products/product-enter-stock.util.ts apps/api/src/modules/products/product-enter-stock.util.spec.ts apps/web/src/utils/getDisplayPrices.ts apps/web/src/pages/ProductDetailPage/components/ReturnToStockAction.tsx apps/web/src/pages/ProductDetailPage/components/__tests__/ReturnToStockAction.test.tsx
git commit -m "feat(products): reset GFIN sale price from the template when the system re-prices a unit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: เติมราคาขาย GFIN ให้เครื่องในสต๊อก — `POST /pricing-templates/backfill-finance-price` + ปุ่มในหน้าตั้งราคา

**Files:**
- Modify: `apps/api/src/modules/pricing-templates/pricing-templates.service.ts` (import + เมธอดใหม่ต่อจาก `lookup()`)
- Modify: `apps/api/src/modules/pricing-templates/pricing-templates.controller.ts` (เมธอดใหม่ต่อจาก `bulkImport()`)
- Create: `apps/api/src/modules/pricing-templates/pricing-templates.backfill.spec.ts`
- Modify: `apps/api/src/modules/employee-access/access-policy.manifest.json:953` (แทรกก่อน `"PricingTemplatesController.bulkImport"`)
- Create: `apps/web/src/pages/pricing-templates/FinancePriceBackfillButton.tsx`
- Create: `apps/web/src/pages/pricing-templates/FinancePriceBackfillButton.test.tsx`
- Modify: `apps/web/src/pages/PricingTemplatesPage.tsx:12`, `:284`

**Interfaces:**
- Consumes: `pickPricingTemplate`, `positiveDecimal`, `TEMPLATE_ORDER` (Task 2) · `templateKeyOf`, `syncFinancePriceRow` (Task 2)
- Produces:
  - `FINANCE_BACKFILL_STATUSES: ProductStatus[] = ['IN_STOCK', 'RESERVED', 'PHOTO_PENDING']`
  - `PricingTemplatesService.backfillFinancePrice({ dryRun, userId }): Promise<{ count: number }>`
  - `POST /pricing-templates/backfill-finance-price[?dryRun=true]` → `{ count }` · OWNER เท่านั้น
  - `FinancePriceBackfillButton` (ไม่มี props)

"เครื่องพร้อมขาย" (สเปคข้อ 3.2) ในแผนนี้ = ยังไม่ขาย และมีราคาขายแล้ว: `IN_STOCK` · `RESERVED` · `PHOTO_PENDING` (เครื่องมือ 2 รอถ่ายรูปจะเข้าคลังเองเมื่อถ่ายครบ) — ดูคำถามเจ้าของท้ายแผน

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน — API**

`apps/api/src/modules/pricing-templates/pricing-templates.backfill.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { PricingTemplatesService } from './pricing-templates.service';

const D = (v: string) => new Prisma.Decimal(v);
const TEMPLATE = (over: Record<string, unknown> = {}) => ({
  id: 't15', brand: 'Apple', model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW',
  hasWarranty: false, deviceOrigin: 'UNSPECIFIED',
  cashPrice: D('25900'), installmentBestchoicePrice: D('25900'), installmentFinancePrice: D('26500'),
  ...over,
});
const UNIT = (id: string, over: Record<string, unknown> = {}) => ({
  id, brand: 'Apple', model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW',
  deviceOrigin: 'THAI', warrantyExpired: null, warrantyExpireDate: null,
  ...over,
});

describe('PricingTemplatesService.backfillFinancePrice — เติมราคาขาย GFIN ให้เครื่องในสต๊อก (สเปค 2026-11-19 ข้อ 3.2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let service: PricingTemplatesService;

  beforeEach(() => {
    db = {
      product: {
        findMany: jest.fn().mockResolvedValue([
          UNIT('p15'),
          UNIT('p12', { model: 'iPhone 12' }),
          UNIT('pX', { brand: 'Samsung', model: 'Galaxy S24' }),
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pricingTemplate: {
        findMany: jest.fn().mockResolvedValue([
          TEMPLATE(),
          TEMPLATE({ id: 't12', model: 'iPhone 12', installmentFinancePrice: D('0') }),
        ]),
      },
      productPrice: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'row-f' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (work: (tx: unknown) => unknown) => work(db)),
    };
    service = new PricingTemplatesService(db as never);
  });

  it('อ่านเฉพาะเครื่องพร้อมขายที่ช่องว่าง', async () => {
    await service.backfillFinancePrice({ dryRun: true, userId: 'owner-1' });
    expect(db.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          financePrice: null,
          status: { in: ['IN_STOCK', 'RESERVED', 'PHOTO_PENDING'] },
        }),
      }),
    );
  });

  it('dryRun นับเฉพาะเครื่องที่รุ่นมีราคาขาย GFIN ในราคากลาง และไม่เขียนอะไร', async () => {
    await expect(service.backfillFinancePrice({ dryRun: true, userId: 'owner-1' })).resolves.toEqual({ count: 1 });
    expect(db.product.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('เติม: เขียนคอลัมน์โดยมีเงื่อนไข financePrice: null (ไม่ทับค่าที่มี) + แถวไฟแนนซ์ + audit', async () => {
    await expect(service.backfillFinancePrice({ dryRun: false, userId: 'owner-1' })).resolves.toEqual({ count: 1 });
    expect(db.product.updateMany).toHaveBeenCalledTimes(1);
    const args = db.product.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'p15', financePrice: null, deletedAt: null });
    expect(args.data.financePrice.toString()).toBe('26500');
    expect(db.productPrice.create).toHaveBeenCalledWith({
      data: { productId: 'p15', label: 'ราคาผ่อนไฟแนนซ์', amount: D('26500'), isDefault: false },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'owner-1',
        action: 'PRODUCT_FINANCE_PRICE_BACKFILLED',
        entity: 'product',
        entityId: 'batch',
        newValue: { count: 1, productIds: ['p15'] },
      }),
    });
  });

  it('มีคนตั้งราคาระหว่างนั้น (updateMany ได้ 0 แถว) → ไม่ทับ ไม่นับ', async () => {
    db.product.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.backfillFinancePrice({ dryRun: false, userId: 'owner-1' })).resolves.toEqual({ count: 0 });
    expect(db.productPrice.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน — ปุ่ม**

`apps/web/src/pages/pricing-templates/FinancePriceBackfillButton.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import api from '@/lib/api';
import { FinancePriceBackfillButton } from './FinancePriceBackfillButton';

vi.mock('@/lib/api', () => ({ default: { post: vi.fn() }, getErrorMessage: () => 'ผิดพลาด' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FinancePriceBackfillButton />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('FinancePriceBackfillButton', () => {
  it('แสดงจำนวนเครื่องก่อนยืนยัน (dry run) แล้วเติมเมื่อกดยืนยันใน dialog', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { count: 7 } });
    const user = userEvent.setup();
    renderButton();

    await user.click(await screen.findByRole('button', { name: 'เติมราคาขาย GFIN ให้เครื่องในสต๊อก (7 เครื่อง)' }));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/pricing-templates/backfill-finance-price?dryRun=true');
    expect(await screen.findByText(/ให้เครื่องในสต๊อกที่ยังว่าง 7 เครื่อง/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'เติม 7 เครื่อง' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pricing-templates/backfill-finance-price'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('เติมราคาขาย GFIN แล้ว 7 เครื่อง'));
  });

  it('ไม่มีเครื่องให้เติม → ปุ่มกดไม่ได้', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { count: 0 } });
    renderButton();
    expect(
      await screen.findByRole('button', { name: 'เติมราคาขาย GFIN ให้เครื่องในสต๊อก (0 เครื่อง)' }),
    ).toBeDisabled();
  });
});
```

- [ ] **Step 3: รันให้เห็นว่าล้ม**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates/pricing-templates.backfill.spec.ts
cd apps/web && npx vitest run src/pages/pricing-templates/FinancePriceBackfillButton.test.tsx && cd ../..
```
Expected: FAIL — `service.backfillFinancePrice is not a function` · `Failed to resolve import "./FinancePriceBackfillButton"`

- [ ] **Step 4: เขียนโค้ด — API**

`pricing-templates.service.ts` — บรรทัด import `@prisma/client` แทนด้วย:

```ts
import { Prisma, ProductCategory, ProductStatus, PricingDeviceOrigin } from '@prisma/client';
import { pickPricingTemplate, positiveDecimal, TEMPLATE_ORDER } from '../../utils/pricing-template-match.util';
import { syncFinancePriceRow, templateKeyOf } from '../../utils/product-finance-price.util';

/** "เครื่องในสต๊อก" ของปุ่มเติมราคาขาย GFIN — ยังไม่ขาย และมีราคาขายแล้ว (สเปค 2026-11-19 ข้อ 3.2) */
export const FINANCE_BACKFILL_STATUSES: ProductStatus[] = ['IN_STOCK', 'RESERVED', 'PHOTO_PENDING'];
const FINANCE_BACKFILL_CATEGORIES: ProductCategory[] = ['PHONE_NEW', 'PHONE_USED', 'TABLET'];
/** เขียนทีละชุด — tx เดียวทั้งสต๊อกอาจเกินเวลาของ interactive transaction */
const FINANCE_BACKFILL_CHUNK = 50;
```

ต่อจากเมธอด `lookup()` เพิ่ม:

```ts
  /**
   * ปุ่ม "เติมราคาขาย GFIN ให้เครื่องในสต๊อก" (สเปค 2026-11-19 ข้อ 3.2 / 7.5) — กลไกเดียวสำหรับเครื่องเดิม
   * เติมเฉพาะเครื่องพร้อมขายที่ช่องว่างและรุ่นมีราคาขาย GFIN ในราคากลาง (ตัวเลือกแถวเดียวกับตอนสร้างเครื่อง)
   * ไม่ทับค่าที่มี: เงื่อนไข `financePrice: null` อยู่ใน WHERE ของการเขียนเอง (มีคนตั้งราคาระหว่างนั้น = ข้าม)
   * เส้นทางนี้ OWNER เท่านั้น (ไม่มี access boundary) ⇒ ใช้ `this.base` ตรง
   */
  async backfillFinancePrice({
    dryRun,
    userId,
  }: {
    dryRun: boolean;
    userId: string | null;
  }): Promise<{ count: number }> {
    const [products, templates] = await Promise.all([
      this.base.product.findMany({
        where: {
          deletedAt: null,
          financePrice: null,
          status: { in: FINANCE_BACKFILL_STATUSES },
          category: { in: FINANCE_BACKFILL_CATEGORIES },
        },
        select: {
          id: true,
          brand: true,
          model: true,
          storage: true,
          category: true,
          deviceOrigin: true,
          warrantyExpired: true,
          warrantyExpireDate: true,
        },
        orderBy: { id: 'asc' },
      }),
      this.base.pricingTemplate.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: TEMPLATE_ORDER,
      }),
    ]);

    const fills = products.flatMap((p) => {
      const price = positiveDecimal(pickPricingTemplate(templates, templateKeyOf(p))?.installmentFinancePrice);
      return price ? [{ id: p.id, price }] : [];
    });
    if (dryRun || fills.length === 0) return { count: fills.length };

    const written: string[] = [];
    for (let i = 0; i < fills.length; i += FINANCE_BACKFILL_CHUNK) {
      const chunk = fills.slice(i, i + FINANCE_BACKFILL_CHUNK);
      await this.base.$transaction(async (tx) => {
        for (const fill of chunk) {
          const updated = await tx.product.updateMany({
            where: { id: fill.id, financePrice: null, deletedAt: null },
            data: { financePrice: fill.price },
          });
          if (updated.count !== 1) continue;
          await syncFinancePriceRow(tx, fill.id, fill.price);
          written.push(fill.id);
        }
      });
    }

    if (userId && written.length > 0) {
      await this.base.auditLog.create({
        data: {
          userId,
          action: 'PRODUCT_FINANCE_PRICE_BACKFILLED',
          entity: 'product',
          entityId: 'batch',
          newValue: { count: written.length, productIds: written },
        },
      });
    }
    return { count: written.length };
  }
```

`pricing-templates.controller.ts` — import เพิ่มต่อจาก `import { Roles } …`:

```ts
import { CurrentUser } from '../auth/decorators/current-user.decorator';
```

ต่อจากเมธอด `bulkImport()` เพิ่ม (ลำดับ decorator ต้องเป็น `@Post` แล้ว `@Roles` ตามนี้ — ค่า `surface` ใน manifest คิดจากลำดับนี้):

```ts
  /** สเปค 2026-11-19 ข้อ 3.2 — เติมราคาขาย GFIN ให้เครื่องในสต๊อกที่ช่องว่าง · ?dryRun=true = นับอย่างเดียว */
  @Post('backfill-finance-price')
  @Roles('OWNER')
  backfillFinancePrice(@Query('dryRun') dryRun: string | undefined, @CurrentUser() user: { id: string }) {
    return this.service.backfillFinancePrice({ dryRun: dryRun === 'true', userId: user?.id ?? null });
  }
```

`access-policy.manifest.json` — แทรกบรรทัดนี้ก่อนบรรทัด `"PricingTemplatesController.bulkImport": …` (ค่า `surface` คิดด้วยสูตรของ `tools/check-access-coverage.mjs` จาก `Controller('pricing-templates')` · `UseGuards(JwtAuthGuard, RolesGuard)` · `Post('backfill-finance-price')` · `Roles('OWNER')`):

```json
  "PricingTemplatesController.backfillFinancePrice": {"classification":"staff","permission":"pricing-templates.update","resource":"domain","company":"resolved-source","file":"apps/api/src/modules/pricing-templates/pricing-templates.controller.ts","transport":"Post('backfill-finance-price')","surface":"75bf43cfa7807f179cff","resolution":"collection"},
```

ไม่เพิ่ม route นี้ใน `STICKER_PRICING_ROUTES` (`access-sticker-pricing-boundaries.ts`): เจ้าของที่ไม่มี boundary ผ่าน `assertAccess(…, { company: 'SHOP' })` ตามปกติ (`access-policy.ts:48`) และผู้ใช้อื่นถูก `@Roles('OWNER')` กันอยู่แล้ว

- [ ] **Step 5: เขียนโค้ด — ปุ่ม**

`apps/web/src/pages/pricing-templates/FinancePriceBackfillButton.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const BACKFILL_URL = '/pricing-templates/backfill-finance-price';
/** ขึ้นต้นด้วย 'pricing-templates' ⇒ แก้/นำเข้าราคากลางแล้วจำนวนนับใหม่เอง (หน้าตั้งราคา invalidate prefix นี้) */
export const FINANCE_BACKFILL_COUNT_KEY = ['pricing-templates', 'finance-backfill-count'] as const;

/**
 * ปุ่ม "เติมราคาขาย GFIN ให้เครื่องในสต๊อก (N เครื่อง)" — สเปค 2026-11-19 ข้อ 3.2 / 7.5
 * นับก่อนด้วย dry run แล้วยืนยันใน dialog · เติมเฉพาะเครื่องพร้อมขายที่ช่องว่าง ไม่ทับค่าที่มี
 */
export function FinancePriceBackfillButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const countQuery = useQuery({
    queryKey: FINANCE_BACKFILL_COUNT_KEY,
    queryFn: async () => (await api.post<{ count: number }>(`${BACKFILL_URL}?dryRun=true`)).data.count,
  });

  const fill = useMutation({
    mutationFn: async () => (await api.post<{ count: number }>(BACKFILL_URL)).data.count,
    onSuccess: (count) => {
      toast.success(`เติมราคาขาย GFIN แล้ว ${count.toLocaleString('th-TH')} เครื่อง`);
      queryClient.invalidateQueries({ queryKey: FINANCE_BACKFILL_COUNT_KEY });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const count = countQuery.data;
  const countText = count === undefined ? '' : count.toLocaleString('th-TH');
  const label =
    count === undefined
      ? 'เติมราคาขาย GFIN ให้เครื่องในสต๊อก'
      : `เติมราคาขาย GFIN ให้เครื่องในสต๊อก (${countText} เครื่อง)`;

  return (
    <>
      <button
        data-ui-control="button"
        type="button"
        onClick={() => setOpen(true)}
        disabled={!count || fill.isPending}
        className="px-3 py-2 text-sm whitespace-nowrap text-muted-foreground border border-input rounded-lg hover:bg-muted/50 disabled:opacity-50"
      >
        {fill.isPending ? 'กำลังเติมราคา...' : label}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="เติมราคาขาย GFIN"
        description={`เติมราคาขาย GFIN จากตารางราคากลางให้เครื่องในสต๊อกที่ยังว่าง ${countText} เครื่อง · เครื่องที่มีราคาขาย GFIN อยู่แล้วไม่ถูกแก้`}
        confirmLabel={`เติม ${countText} เครื่อง`}
        loading={fill.isPending}
        onConfirm={() => fill.mutate()}
      />
    </>
  );
}
```

`PricingTemplatesPage.tsx` — ต่อจากบรรทัด 12 (`import { ConfirmDialog } …`) เพิ่ม:

```ts
import { FinancePriceBackfillButton } from './pricing-templates/FinancePriceBackfillButton';
```

ใน `action` ของ `PageHeader` แทรกเป็นลูกตัวแรกของ `<div className="flex flex-wrap gap-2">` (บรรทัด 284):

```tsx
            <FinancePriceBackfillButton />
```

- [ ] **Step 6: รันให้ผ่าน + ตรวจ manifest**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/pricing-templates src/modules/employee-access/access-policy
cd apps/web && npx vitest run src/pages/pricing-templates src/pages/settings && cd ../..
```
Expected: PASS

ตรวจทะเบียนสิทธิ์ (Linux/macOS/CI): `node tools/check-access-coverage.mjs` → Expected: `Access inventory: … classified entrypoints …` ไม่มี error (ถ้าขึ้น `Changed authorization/route surface requires review: PricingTemplatesController.backfillFinancePrice` แปลว่าลำดับ/ข้อความ decorator ไม่ตรง Step 4)
บน Windows (git bash) — `path.relative` ให้ `\` ไม่ตรงกับ manifest จึงต้องครอบ:

```bash
node -e "import('node:path').then(p=>{const r=p.default.relative;p.default.relative=(a,b)=>r(a,b).split(p.default.sep).join('/');return import('./tools/check-access-coverage.mjs')})" 2>&1 | grep -E "PricingTemplatesController|Unclassified|Stale"
```
Expected (Windows): ไม่มีผลลัพธ์ (รายการที่ฟ้องบน Windows ซึ่งเป็น decorator หลายบรรทัดของ controller อื่นไม่เกี่ยว)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/pricing-templates/pricing-templates.service.ts apps/api/src/modules/pricing-templates/pricing-templates.controller.ts apps/api/src/modules/pricing-templates/pricing-templates.backfill.spec.ts apps/api/src/modules/employee-access/access-policy.manifest.json apps/web/src/pages/pricing-templates/FinancePriceBackfillButton.tsx apps/web/src/pages/pricing-templates/FinancePriceBackfillButton.test.tsx apps/web/src/pages/PricingTemplatesPage.tsx
git commit -m "feat(pricing): owner button to backfill GFIN sale price for units in stock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ผู้คิดเรท 2 ใช้ `financePrice ?? installmentPrice`

ผู้อ่านเรท 2 ทั้ง 4 จุด (สเปคข้อ 4.3 + 3.2):

| จุด | ไฟล์ |
|---|---|
| การ์ดคำนวณหน้าสินค้า (+ สรุปส่งลูกค้า) | `ProductDetailPage/index.tsx:200` → `resolveQuotes.ts` → `InstallmentCalculatorCard.tsx` / `GfinPanel.tsx` |
| สติกเกอร์ | `stickers.service.ts` (ข้อมูล) → `StickerPrintPage/index.tsx` `toQuotable` → `useStickerQuotes.ts:71` → `resolveQuotes.ts` |
| เว็บ shop | `shop-catalog/installment-preview.service.ts` `preview()` → `previewGfin()` |
| แถวราคาในหน้าสต๊อก (แก้คอลัมน์) | `StockPage/components/PriceManagementModal.tsx` (label "ราคาผ่อนไฟแนนซ์" แก้ผ่านคอลัมน์ `financePrice`) |

**Files:**
- Modify: `apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.ts:2`, `:14-21`, `:42-48`, `:67-71`, `:74`, `:92`, `:109`, `:123`, `:134`
- Modify: `apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.test.ts`
- Modify: `apps/web/src/pages/ProductDetailPage/components/InstallmentCalculatorCard.tsx:109`, `:183-186`
- Modify: `apps/web/src/pages/ProductDetailPage/index.tsx:95`
- Modify: `apps/api/src/modules/stickers/stickers.service.ts:35-36`, `:62-63`, `:190-192`
- Modify: `apps/api/src/modules/stickers/stickers.service.spec.ts:41-42`, `:70-71`
- Modify: `apps/web/src/pages/StickerPrintPage/stickerView.ts:25`
- Modify: `apps/web/src/pages/StickerPrintPage/index.tsx:88`
- Modify: `apps/web/src/pages/StockPage/types.ts:16`
- Modify: `apps/web/src/pages/StockPage/components/PriceManagementModal.tsx:6`, `:20-22`, `:67`
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.ts:50-66`
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts`

**Interfaces:**
- Consumes: `Product.financePrice` (Task 1) · `FINANCE_LABEL` เว็บ (Task 4)
- Produces: `ProductForQuotes.financePrice?: string | number | null` · `ResolvedQuotes.gfinSalePrice: number | null` · `StickerProductData.financePrice` (API: `string | null` · เว็บ: optional) · `StockProduct.financePrice?: string | null`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`resolveQuotes.test.ts` — เพิ่มท้าย `describe('resolveQuotes', …)`:

```ts
  // สเปค 2026-11-19 ข้อ 3.2 — ราคาขาย GFIN ของเครื่องใช้กับเรท 2 เท่านั้น · ว่าง = ราคาผ่อน (พฤติกรรมเดิม)
  // ราคาส่ง GFIN = 23,000 + OVER 1,000 = 24,000 · ดาวน์ขั้นต่ำ 25% = 6,000
  it('financePrice → เรท 2 คิดจากราคาขาย GFIN · เรท 1 ยังคิดจากราคาผ่อน', () => {
    const r = resolveQuotes({ product: { ...product, financePrice: '21000' }, state: INITIAL_CALC_STATE, bcConfig, gfinTables });
    expect(r.installmentPrice).toBe(19900);
    expect(r.gfinSalePrice).toBe(21000);
    expect(r.bc!.downAmount).toBe(3000);
    // ส่วนลดดาวน์ = 24,000 − 21,000 = 3,000 ⇒ ดาวน์ลูกค้า 6,000 − 3,000 = 3,000
    expect(r.gfin!.quote.available && r.gfin!.quote.result.downAmountActual.toNumber()).toBe(3000);
  });

  it('financePrice ว่าง → เรท 2 ใช้ราคาผ่อน BESTCHOICE', () => {
    const r = resolveQuotes({ product: { ...product, financePrice: null }, state: INITIAL_CALC_STATE, bcConfig, gfinTables });
    expect(r.gfinSalePrice).toBe(19900);
    // ส่วนลดดาวน์ = 24,000 − 19,900 = 4,100 ⇒ 6,000 − 4,100 = 1,900
    expect(r.gfin!.quote.available && r.gfin!.quote.result.downAmountActual.toNumber()).toBe(1900);
  });
```

`stickers.service.spec.ts` — `baseProduct` ต่อจากบรรทัด 42 (`installmentPrice: new Decimal(19900),`) เพิ่ม `financePrice: new Decimal(20900),` และใน object ที่คาดหวัง ต่อจากบรรทัด 71 (`installmentPrice: '19900',`) เพิ่ม `financePrice: '20900',` · ในเคส `'เครื่องที่ยังไม่ตั้งราคา…'` (บรรทัด 125–141) object เครื่องต่อจาก `installmentPrice: null,` เพิ่ม `financePrice: null,`

`installment-preview.service.spec.ts` — เพิ่มต่อจากเคส `'GFIN: returns canonical worked example monthly payment 2,923.00'`:

```ts
  // สเปค 2026-11-19 ข้อ 3.2 — เว็บ shop คิดเรท 2 จากราคาขาย GFIN ของเครื่อง
  it('GFIN: มี financePrice → ส่วนลดดาวน์คิดจากราคาขาย GFIN (ไม่ใช่ราคาผ่อน)', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'p1',
      installmentPrice: new Prisma.Decimal('19900'),
      financePrice: new Prisma.Decimal('21500'),
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deviceOrigin: 'THAI',
      deletedAt: null,
    });
    prisma.gfinModelMapping.findMany.mockResolvedValue([
      { id: 'm1', gfinSeries: 'iPhone 14', gfinVariant: 'Pro', storage: '128GB', condition: 'HAND_2', maxPrice: new Prisma.Decimal('21500'), modelMatchPattern: 'iPhone 14 Pro', isActive: true },
    ]);
    prisma.gfinOverpriceRule.findMany.mockResolvedValue([
      { id: 'r1', label: 'iPhone 14 มือ 2', seriesPattern: 'iPhone 14|iPhone 15', condition: 'HAND_2', allowance: new Prisma.Decimal('1000'), isActive: true },
    ]);
    prisma.gfinRateFactor.findFirst.mockResolvedValue({
      months: 12, shopCommissionPct: 15, factor: new Prisma.Decimal('0.179238'), feePerInstallment: new Prisma.Decimal('100'), isActive: true,
    });
    prisma.systemConfig.findFirst.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === 'gfin.minDownPct' ? { value: '30' } : null),
    );

    const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12 });
    expect(result.available).toBe(true);
    // ราคาส่ง 22,500 · ดาวน์ 30% = 6,750 · ส่วนลด 22,500 − 21,500 = 1,000 ⇒ 5,750 → ปัดขึ้นหลักร้อย (ช่วง 1ข) 5,800
    expect(result.downAmount).toBe(5800);
    expect(result.monthlyPayment).toBeCloseTo(2923.0, 2);
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run:
```bash
cd apps/web && npx vitest run src/pages/ProductDetailPage/utils/resolveQuotes.test.ts && cd ../..
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/stickers/stickers.service.spec.ts src/modules/shop-catalog/installment-preview.service.spec.ts
```
Expected: FAIL — `r.gfinSalePrice` เป็น `undefined` และดาวน์ GFIN ได้ 1,900 แทน 3,000 · สติกเกอร์ไม่มีคีย์ `financePrice` · shop ได้ `downAmount` 4,200 แทน 5,800

- [ ] **Step 3: `resolveQuotes.ts`**

- บรรทัด 2 แทนด้วย `import { getPositiveDisplayPrices, normalizePositive, type ProductForDisplay } from '@/utils/getDisplayPrices';`
- ใน `interface ProductForQuotes` ต่อจาก `deviceOrigin?: …;` เพิ่ม:

```ts
  /** ราคาขาย GFIN ของเครื่อง (ราคาเต็ม — สเปค 2026-11-19 ข้อ 3.2) · ว่าง/ไม่บวก = เรท 2 ใช้ราคาผ่อน BESTCHOICE */
  financePrice?: string | number | null;
```

- ใน `interface ResolvedQuotes` ต่อจาก `installmentPrice: number | null;` เพิ่ม:

```ts
  /** ราคาที่เรท 2 ใช้คิด = financePrice ?? ราคาผ่อน (null = ไม่มีทั้งคู่) */
  gfinSalePrice: number | null;
```

- บรรทัด 67–71 (`const { installment } = …` ถึงปิด `if (installmentPrice == null) { return … }`) แทนด้วย:

```ts
  const { installment } = getPositiveDisplayPrices(product);
  const installmentPrice = installment ?? null;
  const gfinSalePrice = normalizePositive(product.financePrice) ?? installmentPrice;
  if (installmentPrice == null && gfinSalePrice == null) {
    return { installmentPrice: null, gfinSalePrice: null, bc: null, gfin: null, gfinAvailable: false };
  }
```

- บรรทัด 74 `if (bcConfig && bcConfig.allowedMonths && bcConfig.allowedMonths.length > 0) {` แทนด้วย `if (installmentPrice != null && bcConfig && bcConfig.allowedMonths && bcConfig.allowedMonths.length > 0) {`
- บรรทัด 92 `if (gfinTables) {` แทนด้วย `if (gfinTables && gfinSalePrice != null) {`
- ในการเรียก `buildGfinQuote(gfinTables, { … })` ทั้งสองครั้ง (บรรทัด 109 และ 123) แทนบรรทัด `installmentPrice,` ด้วย `installmentPrice: gfinSalePrice,`
- บรรทัด 134 `return { installmentPrice, bc, gfin, gfinAvailable };` แทนด้วย `return { installmentPrice, gfinSalePrice, bc, gfin, gfinAvailable };`

(เลขบรรทัดเป็นของ commit `6bd607ab8` — ถ้าช่วง 1ข/2 แก้ไฟล์นี้แล้ว ให้หาบรรทัดด้วยข้อความที่ยกมา)

`InstallmentCalculatorCard.tsx`:
- บรรทัด 109 (prop ของ `<GfinPanel`) `installmentPrice={installmentPrice}` แทนด้วย `installmentPrice={quotes.gfinSalePrice ?? installmentPrice}`
- บรรทัด 183–186 แทนด้วย:

```tsx
        <span className="text-xs text-muted-foreground leading-snug">
          {fin === 'gfin' && quotes.gfinSalePrice != null ? 'คิดจากราคาขาย GFIN' : 'คิดจากราคาผ่อน'}{' '}
          <span className="font-mono tabular-nums">
            {formatBaht(fin === 'gfin' && quotes.gfinSalePrice != null ? quotes.gfinSalePrice : installmentPrice)}
          </span>{' '}
          ฿
        </span>
```

`ProductDetailPage/index.tsx` ต่อจากบรรทัด 95 (`installmentPrice: string | null;`) เพิ่ม `financePrice: string | null;`

- [ ] **Step 4: สติกเกอร์ · สต๊อก · เว็บ shop**

`stickers.service.ts`:
- ต่อจากบรรทัด 36 (`installmentPrice: string | null;` ใน `StickerProductData`) เพิ่ม `/** ราคาขาย GFIN ของเครื่อง — ค่างวดเรท 2 บนดวงคิดจากราคานี้ (ว่าง = ราคาผ่อน) */` และ `financePrice: string | null;`
- ต่อจากบรรทัด 63 (`installmentPrice: true,` ใน `select`) เพิ่ม `financePrice: true,`
- ต่อจากบรรทัด 192 (ปิด `installmentPrice: …toString() : null,`) เพิ่ม:

```ts
      financePrice: product.financePrice != null ? product.financePrice.toString() : null,
```

`stickerView.ts` ต่อจากบรรทัด 25 (`installmentPrice: string | null;`) เพิ่ม:

```ts
  /** ราคาขาย GFIN — optional เพราะ API รุ่นก่อนช่วง 4 ไม่ส่ง */
  financePrice?: string | null;
```

`StockPage/types.ts` ต่อจากบรรทัด 16 (`installmentPrice: string | null;`) เพิ่ม `financePrice?: string | null;`

`StickerPrintPage/index.tsx` ใน `toQuotable` ต่อจากบรรทัด 88 (`installmentPrice: product.installmentPrice,`) เพิ่ม `financePrice: product.financePrice ?? null,`

`PriceManagementModal.tsx`:
- บรรทัด 6 แทนด้วย `import { CANONICAL_PRICE_LABELS, CASH_LABEL, FINANCE_LABEL } from '@/utils/getDisplayPrices';`
- บรรทัด 20–22 แทนด้วย:

```ts
function canonicalLabelToField(label: string): 'cashPrice' | 'installmentPrice' | 'financePrice' {
  const trimmed = label.trim();
  if (trimmed === CASH_LABEL) return 'cashPrice';
  if (trimmed === FINANCE_LABEL) return 'financePrice';
  return 'installmentPrice';
}
```

- บรรทัด 67 (`field: 'cashPrice' | 'installmentPrice';` ในชนิดของ `columnPriceMutation`) แทนด้วย `field: 'cashPrice' | 'installmentPrice' | 'financePrice';`

`installment-preview.service.ts` บรรทัด 59–66 (`if (!installmentPriceRaw) { … }` ถึงปิด `return this.previewGfin(…)`) แทนด้วย:

```ts
    if (dto.provider === 'BC') {
      if (!installmentPriceRaw) return { available: false, reason: 'no_installment_price' };
      return this.previewBc(product, new Decimal(installmentPriceRaw.toString()), dto);
    }

    // สเปค 2026-11-19 ข้อ 3.2: เรท 2 คิดจากราคาขาย GFIN ของเครื่อง · ว่าง = ราคาผ่อน BESTCHOICE (พฤติกรรมเดิม)
    const gfinSaleRaw =
      product.financePrice != null && product.financePrice.gt(0) ? product.financePrice : installmentPriceRaw;
    if (!gfinSaleRaw) return { available: false, reason: 'no_installment_price' };
    return this.previewGfin(product, new Decimal(gfinSaleRaw.toString()), dto);
```

(ถ้าช่วง 2 ปรับโครง `preview()` ไปแล้ว: กติกาคือ BC อ่าน `installmentPriceRaw` เหมือนเดิม · GFIN อ่าน `financePrice` ที่เป็นบวกก่อน แล้วค่อย `installmentPriceRaw`)

- [ ] **Step 5: รันให้ผ่าน**

Run:
```bash
cd apps/web && npx vitest run src/pages/ProductDetailPage src/pages/StickerPrintPage src/pages/StockPage && cd ../..
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- src/modules/stickers src/modules/shop-catalog
```
Expected: PASS ทุกไฟล์

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.ts apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.test.ts apps/web/src/pages/ProductDetailPage/components/InstallmentCalculatorCard.tsx apps/web/src/pages/ProductDetailPage/index.tsx apps/api/src/modules/stickers/stickers.service.ts apps/api/src/modules/stickers/stickers.service.spec.ts apps/web/src/pages/StickerPrintPage/stickerView.ts apps/web/src/pages/StickerPrintPage/index.tsx apps/web/src/pages/StockPage/types.ts apps/web/src/pages/StockPage/components/PriceManagementModal.tsx apps/api/src/modules/shop-catalog/installment-preview.service.ts apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts
git commit -m "feat(pricing): GFIN quotes use the unit's finance price before the BESTCHOICE price" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: หน้ารายละเอียดสินค้า — ช่อง "ราคาขาย GFIN" ในส่วนแก้ราคา

**Files:**
- Modify (เขียนทับทั้งไฟล์): `apps/web/src/pages/ProductDetailPage/utils/buildSellingPricePayload.ts`
- Modify: `apps/web/src/pages/ProductDetailPage/utils/buildSellingPricePayload.test.ts`
- Modify (เขียนทับทั้งไฟล์): `apps/web/src/pages/ProductDetailPage/components/EditSellingPriceModal.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/__tests__/EditSellingPriceModal.test.tsx`
- Modify: `apps/web/src/pages/ProductDetailPage/index.tsx:47-51`, `:131-133`, `:379-389`, `:560-567`

**Interfaces:**
- Consumes: `PATCH /products/:id` รับ `financePrice` (Task 3)
- Produces: `SellingPriceFormValues.financePrice?: string` · `SellingPricePayload.financePrice?: number` · `EditSellingPriceModal` props `{ isOpen, onClose, values, onChange, onSubmit, isPending }`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`buildSellingPricePayload.test.ts` — เพิ่มท้าย `describe('buildSellingPricePayload', …)`:

```ts
  it('แก้เฉพาะราคาขาย GFIN → payload มีแค่ financePrice', () => {
    const initial = { cashPrice: '15900', installmentPrice: '19900', financePrice: '' };
    const current = { cashPrice: '15900', installmentPrice: '19900', financePrice: '20900' };
    const payload = buildSellingPricePayload(current, initial);
    expect(payload).toEqual({ financePrice: 20900 });
    expect(isSellingPricePayloadEmpty(payload)).toBe(false);
  });

  it('ราคาขาย GFIN เท่าเดิม → payload ว่าง', () => {
    const values = { cashPrice: '15900', installmentPrice: '19900', financePrice: '20900' };
    expect(isSellingPricePayloadEmpty(buildSellingPricePayload(values, { ...values }))).toBe(true);
  });
```

`components/__tests__/EditSellingPriceModal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import EditSellingPriceModal from '../EditSellingPriceModal';

describe('EditSellingPriceModal', () => {
  it('มีช่อง "ราคาขาย GFIN" — พิมพ์แล้วส่งค่าทั้งสามช่องกลับ', async () => {
    const onChange = vi.fn();
    render(
      <EditSellingPriceModal
        isOpen
        onClose={vi.fn()}
        values={{ cashPrice: '15900', installmentPrice: '19900', financePrice: '' }}
        onChange={onChange}
        onSubmit={vi.fn()}
        isPending={false}
      />,
    );
    expect(screen.getByText(/ว่างอยู่ = ใช้ราคาผ่อน BESTCHOICE/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('ราคาขาย GFIN (บาท)'), '2');
    expect(onChange).toHaveBeenLastCalledWith({ cashPrice: '15900', installmentPrice: '19900', financePrice: '2' });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/ProductDetailPage/utils/buildSellingPricePayload.test.ts src/pages/ProductDetailPage/components/__tests__/EditSellingPriceModal.test.tsx && cd ../..`
Expected: FAIL — payload ได้ `{}` แทน `{ financePrice: 20900 }` · `Unable to find a label with the text of: ราคาขาย GFIN (บาท)`

- [ ] **Step 3: เขียนโค้ด**

เขียนทับ `buildSellingPricePayload.ts`:

```ts
export interface SellingPriceFormValues {
  cashPrice: string;
  installmentPrice: string;
  /** ราคาขาย GFIN (สเปค 2026-11-19 ข้อ 3.2) — optional ให้ฟิกซ์เจอร์เดิมที่มีสองช่องยังใช้ได้ (ไม่ส่ง = '') */
  financePrice?: string;
}

export interface SellingPricePayload {
  cashPrice?: number;
  installmentPrice?: number;
  financePrice?: number;
}

/**
 * เทียบค่าฟอร์มปัจจุบันกับค่า ณ ตอนเปิด modal (`initial`) — ใส่ลง payload เฉพาะฟิลด์ที่
 * "เปลี่ยนจริง" เท่านั้น ฟิลด์ที่ว่างเปล่าหรือเท่ากับค่าตอนเปิด modal = undefined = ไม่แตะ
 * ตาม 3-state PATCH เดิมของ UpdateProductDto (undefined ไม่ส่ง / ตัวเลข = ตั้งค่า / null =
 * ล้างค่า — การล้างค่ายังไม่มี UI ในฟอร์มนี้).
 *
 * แก้บั๊ก (deferred จาก Task 7): เปิด modal เครื่องที่มีราคาคอลัมน์อยู่แล้ว แล้วกด "บันทึก"
 * โดยไม่แก้อะไรเลย — เดิม mutationFn ส่งค่าเดิมกลับไปซ้ำเสมอ (เพราะช่องไม่ว่าง) ทำให้ server
 * (presence-based touchesPrice) ตีความว่าแอดมิน "แก้ราคาด้วยมือ" แล้วเคลียร์ priceAutofilledAt
 * badge ทั้งที่ค่าไม่ได้เปลี่ยนเลย.
 */
export function buildSellingPricePayload(
  current: SellingPriceFormValues,
  initial: SellingPriceFormValues,
): SellingPricePayload {
  const payload: SellingPricePayload = {};
  if (current.cashPrice !== '' && current.cashPrice !== initial.cashPrice) {
    payload.cashPrice = parseFloat(current.cashPrice);
  }
  if (current.installmentPrice !== '' && current.installmentPrice !== initial.installmentPrice) {
    payload.installmentPrice = parseFloat(current.installmentPrice);
  }
  const finance = current.financePrice ?? '';
  if (finance !== '' && finance !== (initial.financePrice ?? '')) {
    payload.financePrice = parseFloat(finance);
  }
  return payload;
}

/** payload ว่าง (ไม่มีฟิลด์ไหนเปลี่ยน) → ไม่ต้องยิง PATCH เลย */
export function isSellingPricePayloadEmpty(payload: SellingPricePayload): boolean {
  return (
    payload.cashPrice === undefined &&
    payload.installmentPrice === undefined &&
    payload.financePrice === undefined
  );
}
```

เขียนทับ `EditSellingPriceModal.tsx`:

```tsx
import { NumberInput } from '@/components/ui/NumberInput';
import Modal from '@/components/ui/Modal';
import { useId as useUiFieldId } from 'react';
import type { SellingPriceFormValues } from '../utils/buildSellingPricePayload';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  values: SellingPriceFormValues;
  onChange: (next: SellingPriceFormValues) => void;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
}

export default function EditSellingPriceModal({ isOpen, onClose, values, onChange, onSubmit, isPending }: Props) {
  const uiFieldId = useUiFieldId();
  const set = (patch: Partial<SellingPriceFormValues>) =>
    onChange({ cashPrice: values.cashPrice, installmentPrice: values.installmentPrice, financePrice: values.financePrice ?? '', ...patch });
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="แก้ราคาขาย">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor={`${uiFieldId}-1`} className="block text-sm font-medium text-foreground mb-1 leading-snug">
            ราคาเงินสด (บาท)
          </label>
          <NumberInput unstyled id={`${uiFieldId}-1`}
            step="0.01"
            min="1"
            value={values.cashPrice}
            onChange={(e) => set({ cashPrice: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <div>
          <label htmlFor={`${uiFieldId}-2`} className="block text-sm font-medium text-foreground mb-1 leading-snug">
            ราคาผ่อน — ราคาตั้งต้นสำหรับคำนวณค่างวด (บาท)
          </label>
          <NumberInput unstyled id={`${uiFieldId}-2`}
            step="0.01"
            min="1"
            value={values.installmentPrice}
            onChange={(e) => set({ installmentPrice: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <div>
          <label htmlFor={`${uiFieldId}-3`} className="block text-sm font-medium text-foreground mb-1 leading-snug">
            ราคาขาย GFIN (บาท)
          </label>
          <NumberInput unstyled id={`${uiFieldId}-3`}
            step="0.01"
            min="1"
            value={values.financePrice ?? ''}
            aria-describedby={`${uiFieldId}-3-hint`}
            onChange={(e) => set({ financePrice: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
          <p id={`${uiFieldId}-3-hint`} className="mt-1 text-xs text-muted-foreground leading-snug">
            ราคาที่ใช้คิดผ่อน GFIN (เรท 2) · ว่างอยู่ = ใช้ราคาผ่อน BESTCHOICE
          </p>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          ราคานี้คือแหล่งเดียวที่เว็บลูกค้า/บอท/เครื่องคิดค่างวดใช้ — เว้นว่าง = ไม่แก้ไขค่านี้
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <button data-ui-control="button" type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">
            ยกเลิก
          </button>
          <button data-ui-control="button"
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

`ProductDetailPage/index.tsx`:
- บรรทัด 47–51 (import จาก `./utils/buildSellingPricePayload`) เพิ่ม `type SellingPriceFormValues,` ในรายการ
- บรรทัด 131 และ 133 แทนด้วย:

```ts
  const [sellingPriceForm, setSellingPriceForm] = useState<SellingPriceFormValues>({ cashPrice: '', installmentPrice: '', financePrice: '' });
```
```ts
  const [sellingPriceInitial, setSellingPriceInitial] = useState<SellingPriceFormValues>({ cashPrice: '', installmentPrice: '', financePrice: '' });
```

- บรรทัด 379–389 (`openSellingPriceModal` ตั้งแต่ `const rawCash` ถึง `setSellingPriceInitial({…});`) แทนด้วย:

```ts
    const rawCash = normalizePositive(product.cashPrice);
    const rawInstallment = normalizePositive(product.installmentPrice);
    const rawFinance = normalizePositive(product.financePrice);
    const financeText = rawFinance != null ? String(rawFinance) : '';
    setSellingPriceForm({
      cashPrice: displayCashPrice != null ? String(displayCashPrice) : '',
      installmentPrice: displayInstallmentPrice != null ? String(displayInstallmentPrice) : '',
      financePrice: financeText,
    });
    setSellingPriceInitial({
      cashPrice: rawCash != null ? String(rawCash) : '',
      installmentPrice: rawInstallment != null ? String(rawInstallment) : '',
      financePrice: financeText,
    });
```

- บรรทัด 563–565 (props `cashPrice=` · `installmentPrice=` · `onChange=` ของ `<EditSellingPriceModal`) แทนด้วย:

```tsx
        values={sellingPriceForm}
        onChange={setSellingPriceForm}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/ProductDetailPage && cd ../..`
Expected: PASS ทุกไฟล์

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ProductDetailPage/utils/buildSellingPricePayload.ts apps/web/src/pages/ProductDetailPage/utils/buildSellingPricePayload.test.ts apps/web/src/pages/ProductDetailPage/components/EditSellingPriceModal.tsx apps/web/src/pages/ProductDetailPage/components/__tests__/EditSellingPriceModal.test.tsx apps/web/src/pages/ProductDetailPage/index.tsx
git commit -m "feat(web): edit the GFIN sale price on the product detail page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: ตัวคิดของการ์ด D (`utils/priceCard.ts`) — คิดด้วย `buildModelQuote` ฝั่งเว็บ

**Files:**
- Modify: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts` (import + ฟังก์ชันใหม่ท้ายไฟล์)
- Create: `apps/web/src/pages/ProductCreatePage/utils/priceCard.ts`
- Create: `apps/web/src/pages/ProductCreatePage/utils/priceCard.test.ts`

**Interfaces:**
- Consumes: `buildModelQuote`, `ModelQuote`, `ModelQuoteGfinContext` (ช่วง 2, `@installment/shared`) · `toBcConfig` (`ProductDetailPage/utils/bcQuote.ts`) · `gfinCategoryOf`, `defaultCommissionPct`, `GfinTables` (`gfinQuote.ts`)
- Produces:
  - `toModelQuoteGfinContext(tables: GfinTables, category: string): ModelQuoteGfinContext`
  - `PriceKey = 'cash' | 'bc' | 'finance'` · `PriceFields` · `EMPTY_PRICE_FIELDS` · `PriceTemplate`
  - `templateFields(t)` · `editedKeys(fields, template)` · `mergeTemplate(current, previous, next)` · `templateLabelOf(form)`
  - `computeCardQuote(input): ModelQuote | null` · `gfinBlocked(quote)` · `accessoryProfit(cash, cost)`
  - `toPricePayload(category, fields, { gfinBlocked }): PricePayload` · `hasAnyPrice(payload)`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`apps/web/src/pages/ProductCreatePage/utils/priceCard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BcConfigJson } from '@installment/shared';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';
import {
  accessoryProfit,
  computeCardQuote,
  editedKeys,
  gfinBlocked,
  hasAnyPrice,
  mergeTemplate,
  templateFields,
  templateLabelOf,
  toPricePayload,
  type CardQuoteInput,
  type PriceTemplate,
} from './priceCard';

// ตัวเลขชีต (สเปคข้อ 4.5) — iPhone 15 128GB มือ 1
const bcConfig: BcConfigJson = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 10: 0.5, 12: 0.5 },
  allowedMonths: [10, 12],
};
const gfinTables: GfinTables = {
  mappings: [
    { id: 'm15', gfinSeries: 'iPhone 15', gfinVariant: null, storage: '128GB', condition: 'HAND_1', maxPrice: '24900', modelMatchPattern: 'iPhone 15', isActive: true },
  ],
  rules: [
    { id: 'r15', label: 'iPhone 15 มือ 1', seriesPattern: 'iPhone 15', condition: 'HAND_1', allowance: '1000', maxMonths: 12, isActive: true },
  ],
  factors: [{ id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.17', feePerInstallment: '100', isActive: true }],
  settings: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } },
};
const TEMPLATE: PriceTemplate = {
  cashPrice: '25900.00',
  installmentBestchoicePrice: '25900.00',
  installmentFinancePrice: '25900.00',
  rate1TermMonths: null,
  rate1DownPayment: null,
  rate2TermMonths: null,
};
const INPUT: CardQuoteInput = {
  category: 'PHONE_NEW',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  deviceOrigin: 'THAI',
  fields: { cash: '25900', bc: '25900', finance: '25900' },
  template: TEMPLATE,
  costPrice: '25800',
  bcConfig,
  gfinTables,
};

describe('ช่องราคาของการ์ด', () => {
  it('templateFields: ทศนิยมจาก API → ตัวเลขล้วน · 0 = ว่าง', () => {
    expect(templateFields(TEMPLATE)).toEqual({ cash: '25900', bc: '25900', finance: '25900' });
    expect(templateFields({ ...TEMPLATE, installmentFinancePrice: '0.00' })?.finance).toBe('');
    expect(templateFields(null)).toBeNull();
  });

  it('editedKeys: เทียบเป็นตัวเลข · ราคากลางช่องนั้นว่าง = ไม่นับ', () => {
    const tpl = { cash: '25900', bc: '25900', finance: '' };
    expect(editedKeys({ cash: '25900.00', bc: '27000', finance: '9999' }, tpl)).toEqual(['bc']);
    expect(editedKeys({ cash: '', bc: '25900', finance: '' }, tpl)).toEqual(['cash']);
    expect(editedKeys({ cash: '1', bc: '1', finance: '1' }, null)).toEqual([]);
  });

  it('mergeTemplate: ช่องว่าง/ยังเป็นราคากลางเดิม → ตามชุดใหม่ · ช่องที่แก้เอง → คงไว้ · ไม่พบ → ล้างเฉพาะช่องอัตโนมัติ', () => {
    const prev = { cash: '25900', bc: '25900', finance: '25900' };
    const next = { cash: '29900', bc: '29900', finance: '30500' };
    const current = { cash: '25900', bc: '27000', finance: '' };
    expect(mergeTemplate(current, prev, next)).toEqual({ cash: '29900', bc: '27000', finance: '30500' });
    expect(mergeTemplate(current, prev, null)).toEqual({ cash: '', bc: '27000', finance: '' });
    expect(mergeTemplate({ cash: '', bc: '', finance: '' }, null, next)).toEqual(next);
  });

  it('templateLabelOf: รุ่น ความจุ มือ', () => {
    expect(templateLabelOf({ model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW' })).toBe('iPhone 15 128GB มือ 1');
    expect(templateLabelOf({ model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED' })).toBe('iPhone 13 128GB มือ 2');
  });
});

describe('computeCardQuote — ตัวคำนวณกลางตัวเดียวกับหน้าราคา (สเปคข้อ 4.5)', () => {
  it('iPhone 15 128GB มือ 1 เครื่องไทย ทุน 25,800 → ตรงชีตทุกบาท', () => {
    const q = computeCardQuote(INPUT)!;
    expect(q.cash?.profit).toBe(100);
    expect(q.rate1).toMatchObject({ downAmount: 3900, monthlyDisplay: 3139, months: 12, recordedSalePrice: 28100, profit: 2300 });
    expect(q.rate2).toMatchObject({ available: true, downAmount: 6500, monthly: 3403, months: 12, submitPrice: 25900, recordedSalePrice: 28738, profit: 2938, originNote: false });
  });

  it('ยังไม่เลือกไทย/นอก → OVER ครึ่งเดียว + originNote', () => {
    const q = computeCardQuote({ ...INPUT, deviceOrigin: '' })!;
    expect(q.rate2).toMatchObject({ available: true, submitPrice: 25400, originNote: true });
  });

  it('ดาวน์กำหนดเองของรุ่นใช้เฉพาะเมื่อราคาผ่อนยังเป็นราคากลาง', () => {
    const template = { ...TEMPLATE, rate1DownPayment: '5000' };
    expect(computeCardQuote({ ...INPUT, template })!.rate1?.downAmount).toBe(5000);
    const edited = computeCardQuote({ ...INPUT, template, fields: { ...INPUT.fields, bc: '26000' } })!;
    expect(edited.rate1?.downAmount).toBe(3900);
  });

  it('ไม่มีทุน → ไม่มีกำไร', () => {
    const q = computeCardQuote({ ...INPUT, costPrice: '' })!;
    expect(q.cash?.profit).toBeNull();
    expect(q.rate1?.profit).toBeNull();
  });

  it('รุ่นที่ไม่มีใบราคา GFIN → gfinBlocked', () => {
    const q = computeCardQuote({ ...INPUT, model: 'iPhone 12', storage: '64GB' });
    expect(q?.rate2).toMatchObject({ available: false, reason: 'NO_PRICE_LIST' });
    expect(gfinBlocked(q)).toBe(true);
    expect(gfinBlocked(computeCardQuote(INPUT))).toBe(false);
  });

  it('อุปกรณ์เสริม / ยังไม่เลือกรุ่น → null', () => {
    expect(computeCardQuote({ ...INPUT, category: 'ACCESSORY' })).toBeNull();
    expect(computeCardQuote({ ...INPUT, model: '' })).toBeNull();
  });
});

describe('payload ของหน้าเพิ่มสินค้า', () => {
  it('มือถือ: 3 คอลัมน์ · ช่องว่าง = null · GFIN ไม่รับรุ่นนี้ = null', () => {
    const fields = { cash: '25900', bc: '', finance: '25900' };
    expect(toPricePayload('PHONE_NEW', fields, { gfinBlocked: false })).toEqual({ cashPrice: 25900, installmentPrice: null, financePrice: 25900 });
    expect(toPricePayload('PHONE_NEW', fields, { gfinBlocked: true }).financePrice).toBeNull();
  });

  it('อุปกรณ์เสริม: เฉพาะ cashPrice', () => {
    expect(toPricePayload('ACCESSORY', { cash: '290', bc: '5', finance: '5' }, { gfinBlocked: false })).toEqual({ cashPrice: 290 });
  });

  it('hasAnyPrice: ต้องมีอย่างน้อย 1 ช่อง', () => {
    expect(hasAnyPrice({ cashPrice: null, installmentPrice: null, financePrice: null })).toBe(false);
    expect(hasAnyPrice({ cashPrice: null, installmentPrice: 9000, financePrice: null })).toBe(true);
  });

  it('accessoryProfit: ราคาขาย − ทุน · ไม่มีทุนหรือราคา = null', () => {
    expect(accessoryProfit('290', '25')).toBe(265);
    expect(accessoryProfit('290', '')).toBeNull();
    expect(accessoryProfit('', '25')).toBeNull();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/ProductCreatePage/utils/priceCard.test.ts && cd ../..`
Expected: FAIL — `Failed to resolve import "./priceCard"`

- [ ] **Step 3: เขียนโค้ด**

`gfinQuote.ts` — ในบล็อก import จาก `@installment/shared` เพิ่ม `type ModelQuoteGfinContext,` แล้วต่อท้ายไฟล์:

```ts

/**
 * ตาราง GFIN ของเว็บ → บริบทของ `buildModelQuote` (สเปค 2026-11-19 ข้อ 5 — การ์ดราคาขายหน้าเพิ่มสินค้า)
 * ดาวน์ขั้นต่ำของตั้งค่าเป็น % เต็ม (25) → สัดส่วน (0.25) · คอมตามหมวด (มือถือ 15 · iPad 5)
 */
export function toModelQuoteGfinContext(tables: GfinTables, category: string): ModelQuoteGfinContext {
  return {
    mappings: tables.mappings.map(toMappingRow),
    rules: tables.rules.map(toRuleRow),
    rateFactors: tables.factors.map(toFactorRow),
    settingMinDownPct: new Decimal(tables.settings.minDownPct).div(100),
    commissionPct: defaultCommissionPct(tables.settings, category),
    contractFee: new Decimal(tables.settings.contractFee),
  };
}
```

`apps/web/src/pages/ProductCreatePage/utils/priceCard.ts`:

```ts
import { buildModelQuote, type BcConfigJson, type ModelQuote } from '@installment/shared';
import { toBcConfig } from '@/pages/ProductDetailPage/utils/bcQuote';
import { gfinCategoryOf, toModelQuoteGfinContext, type GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';

/** ช่องราคาของการ์ด D: เงินสด · ผ่อน BESTCHOICE (เรท 1) · ราคาขาย GFIN (เรท 2) */
export type PriceKey = 'cash' | 'bc' | 'finance';
export type PriceFields = Record<PriceKey, string>;
export const PRICE_KEYS: PriceKey[] = ['cash', 'bc', 'finance'];
export const EMPTY_PRICE_FIELDS: PriceFields = { cash: '', bc: '', finance: '' };

/** แถวราคากลางจาก `GET /pricing-templates/lookup` (Decimal มาเป็น string) */
export interface PriceTemplate {
  cashPrice: string | number;
  installmentBestchoicePrice: string | number;
  installmentFinancePrice: string | number;
  rate1TermMonths: number | null;
  rate1DownPayment: string | number | null;
  rate2TermMonths: number | null;
}

function positive(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asField(value: string | number | null | undefined): string {
  const n = positive(value);
  return n == null ? '' : String(n);
}

/** ราคากลาง → ค่าในช่อง ("25900.00" → "25900") · ราคา 0 = ช่องว่าง */
export function templateFields(template: PriceTemplate | null): PriceFields | null {
  if (!template) return null;
  return {
    cash: asField(template.cashPrice),
    bc: asField(template.installmentBestchoicePrice),
    finance: asField(template.installmentFinancePrice),
  };
}

/** ช่องที่ผู้ใช้แก้ไปจากราคากลาง — เทียบเป็นตัวเลข · ราคากลางช่องนั้นว่าง = ไม่นับ */
export function editedKeys(fields: PriceFields, template: PriceFields | null): PriceKey[] {
  if (!template) return [];
  return PRICE_KEYS.filter((k) => template[k] !== '' && positive(fields[k]) !== positive(template[k]));
}

/**
 * ได้ราคากลางชุดใหม่ (เปลี่ยนรุ่น / ความจุ / ประกัน / ไทย-นอก) หรือไม่พบ (`next` = null):
 * ช่องที่ว่างหรือยังเป็นราคากลางชุดก่อน → เปลี่ยนตามชุดใหม่ · ช่องที่ผู้ใช้แก้เอง → คงไว้
 */
export function mergeTemplate(current: PriceFields, previous: PriceFields | null, next: PriceFields | null): PriceFields {
  const out = { ...current };
  for (const k of PRICE_KEYS) {
    const untouched = current[k] === '' || (previous !== null && positive(current[k]) === positive(previous[k]));
    if (untouched) out[k] = next ? next[k] : '';
  }
  return out;
}

const CATEGORY_SHORT: Record<string, string> = { PHONE_NEW: 'มือ 1', PHONE_USED: 'มือ 2', TABLET: 'แท็บเล็ต' };

/** หัวการ์ด "ตามตารางราคากลาง · iPhone 15 128GB มือ 1" */
export function templateLabelOf(form: { model: string; storage: string; category: string }): string {
  return [form.model, form.storage, CATEGORY_SHORT[form.category]].filter(Boolean).join(' ');
}

export interface CardQuoteInput {
  category: string;
  brand: string;
  model: string;
  storage: string;
  /** ค่าของช่อง "เครื่องไทย / เครื่องนอก" ในฟอร์ม ('' = ยังไม่ระบุ) */
  deviceOrigin: string;
  fields: PriceFields;
  template: PriceTemplate | null;
  /** ช่อง "ราคาทุน" ของฟอร์มนี้ — ว่าง = ไม่มีกำไร */
  costPrice: string;
  bcConfig?: BcConfigJson;
  gfinTables?: GfinTables;
}

/**
 * ดาวน์ / ค่างวด / กำไรของการ์ด — `buildModelQuote` ตัวเดียวกับหน้า "ราคาและเรทผ่อน" และบอทขาย
 * อุปกรณ์เสริม / ยังไม่เลือกยี่ห้อหรือรุ่น = null
 */
export function computeCardQuote(input: CardQuoteInput): ModelQuote | null {
  const category = gfinCategoryOf(input.category);
  if (!category || !input.brand || !input.model) return null;
  const tpl = templateFields(input.template);
  const bcUntouched = tpl !== null && tpl.bc !== '' && positive(input.fields.bc) === positive(tpl.bc);
  const cost = input.costPrice === '' ? null : Number(input.costPrice);
  return buildModelQuote({
    product: { brand: input.brand, model: input.model, storage: input.storage, category },
    deviceOrigin: input.deviceOrigin === 'THAI' || input.deviceOrigin === 'IMPORTED' ? input.deviceOrigin : null,
    cashPrice: positive(input.fields.cash),
    bcPrice: positive(input.fields.bc),
    financePrice: positive(input.fields.finance),
    rate1TermMonths: input.template?.rate1TermMonths ?? null,
    // ดาวน์กำหนดเองของรุ่นผูกกับราคาผ่อนของรุ่น — แก้ราคาผ่อนแล้วกลับไปใช้ดาวน์ขั้นต่ำ
    rate1DownPayment: bcUntouched ? positive(input.template?.rate1DownPayment) : null,
    rate2TermMonths: input.template?.rate2TermMonths ?? null,
    bcConfig: input.bcConfig ? toBcConfig(input.bcConfig) : null,
    gfin: input.gfinTables ? toModelQuoteGfinContext(input.gfinTables, input.category) : null,
    costPrice: cost != null && Number.isFinite(cost) ? cost : null,
  });
}

/** GFIN ไม่มีใบราคาของรุ่นนี้ → ช่องราคาขาย GFIN ปิด และบันทึกเป็นค่าว่าง */
export function gfinBlocked(quote: ModelQuote | null): boolean {
  return quote !== null && !quote.rate2.available && quote.rate2.reason === 'NO_PRICE_LIST';
}

/** อุปกรณ์เสริม: กำไร = ราคาขาย − ทุน (ไม่มีผ่อน) */
export function accessoryProfit(cash: string, costPrice: string): number | null {
  const price = positive(cash);
  if (price == null || costPrice === '') return null;
  const cost = Number(costPrice);
  return Number.isFinite(cost) ? price - cost : null;
}

export interface PricePayload {
  cashPrice: number | null;
  installmentPrice?: number | null;
  financePrice?: number | null;
}

/**
 * ราคาที่หน้าเพิ่มสินค้าส่ง (สเปคข้อ 5) — คอลัมน์ล้วน ระบบสร้างแถวราคาและค่าเริ่มต้นเอง
 * ส่งค่าตามที่เห็นบนการ์ด: ช่องว่าง = null (ไม่ให้เซิร์ฟเวอร์เติมจากราคากลางซ้ำ) · อุปกรณ์เสริมส่งเฉพาะเงินสด
 */
export function toPricePayload(category: string, fields: PriceFields, opts: { gfinBlocked: boolean }): PricePayload {
  if (category === 'ACCESSORY') return { cashPrice: positive(fields.cash) };
  return {
    cashPrice: positive(fields.cash),
    installmentPrice: positive(fields.bc),
    financePrice: opts.gfinBlocked ? null : positive(fields.finance),
  };
}

/** ต้องมีราคาอย่างน้อย 1 ช่องจึงบันทึกได้ (เท่ากติกาเดิม) */
export function hasAnyPrice(payload: PricePayload): boolean {
  return [payload.cashPrice, payload.installmentPrice, payload.financePrice].some((v) => v != null);
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/ProductCreatePage/utils/priceCard.test.ts src/pages/ProductDetailPage/utils && cd ../..`
Expected: PASS ทุกไฟล์ — ถ้าเคส "ตรงชีตทุกบาท" ล้ม ให้เทียบกับ golden test ของ `buildModelQuote` ในช่วง 2 ก่อน (ตัวเลขชุดเดียวกับสเปคข้อ 4.5) ห้ามแก้ค่าคาดหวัง

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts apps/web/src/pages/ProductCreatePage/utils/priceCard.ts apps/web/src/pages/ProductCreatePage/utils/priceCard.test.ts
git commit -m "feat(web): price card quote helpers for the product create page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: การ์ด "ราคาขาย" แบบ D + ต่อเข้าหน้าเพิ่มสินค้า

**Files:**
- Modify (เขียนทับทั้งไฟล์): `apps/web/src/pages/ProductCreatePage/components/PriceCard.tsx`
- Create: `apps/web/src/pages/ProductCreatePage/__tests__/PriceCard.test.tsx`
- Modify: `apps/web/src/pages/ProductCreatePage/index.tsx:2`, `:14`, `:49-51`, `:87-122`, `:161-167`, `:180-201`, `:321-324`, `:381-386`
- Create: `apps/web/src/pages/ProductCreatePage/__tests__/ProductCreatePage.prices.test.tsx`
- Modify: `apps/web/src/pages/ProductCreatePage/__tests__/ProductCreatePage.combobox.test.tsx:30-39`, `:81`
- Modify: `apps/web/src/pages/__tests__/touchTargets.test.ts:53`

**Interfaces:**
- Consumes: ทุกตัวจาก Task 8 · `useBcConfig` (`ProductDetailPage/hooks/useBcConfig.ts`) · `useGfinTables` (`ProductDetailPage/hooks/useGfinTables.ts`) · `GET /pricing-templates/lookup`
- Produces: `PriceCard` (default export) props `PriceCardProps` · `GFIN_ORIGIN_NOTE` · `POST /products` จากหน้านี้ส่ง `cashPrice` / `installmentPrice` / `financePrice` (มือถือ/แท็บเล็ต) หรือ `cashPrice` (อุปกรณ์เสริม) ไม่มี `prices`

ข้อความหมายเหตุไทย/นอก (สเปคข้อ 3.4 — ชุดเดียวกับ `GfinPanel.tsx:85` เปลี่ยนท่อนชี้ทาง):
`ยังไม่ระบุเครื่องไทย/เครื่องนอก — คิด OVER ครึ่งเดียวไว้ก่อน (ราคาส่งที่ GFIN รับแน่นอน) · ถ้าเป็นเครื่องไทย เลือกเครื่องไทยในฟอร์มนี้ ราคาส่งจะได้ OVER เต็ม`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน — การ์ด**

`apps/web/src/pages/ProductCreatePage/__tests__/PriceCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ModelQuote } from '@installment/shared';
import PriceCard, { type PriceCardProps } from '../components/PriceCard';
import type { PriceFields } from '../utils/priceCard';

const TPL: PriceFields = { cash: '25900', bc: '25900', finance: '25900' };
const QUOTE: ModelQuote = {
  cash: { price: 25900, profit: 100 },
  // `allowedMonths` — ช่วง 2ก เพิ่มใน Rate1Quote (บอทบอกงวดที่เลือกได้)
  rate1: { price: 25900, downAmount: 3900, months: 12, monthlyContract: 3138.66, monthlyDisplay: 3139, recordedSalePrice: 28100, profit: 2300, allowedMonths: [10, 12] },
  rate2: { available: true, salePrice: 25900, submitPrice: 25900, downAmount: 6500, months: 12, monthly: 3403, recordedSalePrice: 28738, profit: 2938, originNote: false },
};
const paragraph = (text: string) => (_: string, el: Element | null) => el?.tagName === 'P' && el.textContent === text;

function renderCard(over: Partial<PriceCardProps> = {}) {
  const props: PriceCardProps = {
    category: 'PHONE_NEW',
    fields: TPL,
    onFieldChange: vi.fn(),
    templatePrices: TPL,
    templateLabel: 'iPhone 15 128GB มือ 1',
    templateNotFound: false,
    onUseTemplate: vi.fn(),
    quote: QUOTE,
    bcConfigMissing: false,
    accessoryProfit: null,
    costEntered: true,
    ...over,
  };
  render(<PriceCard {...props} />);
  return props;
}

describe('PriceCard (แบบ D)', () => {
  it('ตามราคากลาง: ป้ายหัวการ์ด + 3 แถวพร้อมดาวน์ / ค่างวด / กำไร', () => {
    renderCard();
    expect(screen.getByText('ตามตารางราคากลาง · iPhone 15 128GB มือ 1')).toBeInTheDocument();
    expect(screen.getByLabelText('ราคาเงินสด')).toHaveValue('25,900');
    expect(screen.getByText(paragraph('ดาวน์ 3,900 · ผ่อน 3,139 × 12 งวด'))).toBeInTheDocument();
    expect(screen.getByText(paragraph('ยอดจัด 22,000'))).toBeInTheDocument();
    expect(screen.getByText(paragraph('ดาวน์ 6,500 · ผ่อน 3,403 × 12 งวด'))).toBeInTheDocument();
    expect(screen.getByText(paragraph('ส่ง GFIN 25,900'))).toBeInTheDocument();
    for (const t of ['กำไร 100', 'กำไร 2,300', 'กำไร 2,938']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ใช้ราคากลางทั้งหมด' })).not.toBeInTheDocument();
  });

  it('แก้ราคาเอง: กรอบเตือน + "ราคากลาง X" + ปุ่ม "ใช้ราคากลางทั้งหมด"', async () => {
    const props = renderCard({ fields: { ...TPL, bc: '27000' } });
    const bc = screen.getByLabelText('ราคาผ่อน BESTCHOICE');
    expect(bc.className).toContain('border-warning');
    expect(screen.getByText('ราคากลาง 25,900')).toBeInTheDocument();
    expect(screen.getByText('แก้ 1 ราคาจากตารางราคากลาง')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ใช้ราคากลางทั้งหมด' }));
    expect(props.onUseTemplate).toHaveBeenCalled();
  });

  it('พิมพ์ราคา → แจ้งช่องที่แก้', async () => {
    const props = renderCard({ fields: { cash: '', bc: '', finance: '' } });
    await userEvent.type(screen.getByLabelText('ราคาเงินสด'), '9');
    expect(props.onFieldChange).toHaveBeenLastCalledWith('cash', '9');
  });

  it('ขาดทุน: ป้าย "ขาดทุน X" มีไอคอน + คำ', () => {
    renderCard({ quote: { ...QUOTE, cash: { price: 25900, profit: -500 } } });
    const badge = screen.getByText('ขาดทุน 500');
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('GFIN ไม่รับรุ่นนี้: ช่องปิด ว่าง + ข้อความ', () => {
    renderCard({
      quote: { ...QUOTE, rate2: { available: false, reason: 'NO_PRICE_LIST', message: 'GFIN ไม่รับรุ่นนี้' } },
    });
    const finance = screen.getByLabelText('ราคาขาย GFIN');
    expect(finance).toBeDisabled();
    expect(finance).toHaveValue('');
    expect(screen.getByText('GFIN ไม่รับรุ่นนี้ — ขายได้แค่เงินสดและผ่อน BESTCHOICE')).toBeInTheDocument();
  });

  it('ยังไม่เลือกเครื่องไทย/นอก: หมายเหตุใต้แถว GFIN (สเปคข้อ 3.4)', () => {
    renderCard({ quote: { ...QUOTE, rate2: { ...(QUOTE.rate2 as Extract<ModelQuote['rate2'], { available: true }>), originNote: true } } });
    expect(
      screen.getByText(
        'ยังไม่ระบุเครื่องไทย/เครื่องนอก — คิด OVER ครึ่งเดียวไว้ก่อน (ราคาส่งที่ GFIN รับแน่นอน) · ถ้าเป็นเครื่องไทย เลือกเครื่องไทยในฟอร์มนี้ ราคาส่งจะได้ OVER เต็ม',
      ),
    ).toBeInTheDocument();
  });

  it('ไม่พบรุ่นในราคากลาง: ช่องว่างให้กรอกเอง + ข้อความ · ไม่มีป้ายราคากลาง', () => {
    renderCard({
      fields: { cash: '', bc: '', finance: '' },
      templatePrices: null,
      templateNotFound: true,
      quote: { cash: null, rate1: null, rate2: { available: false, reason: 'NO_PRICE', message: 'กรอกราคาขาย GFIN หรือราคาผ่อน' } },
    });
    expect(screen.getByText('ไม่พบรุ่นนี้ในตารางราคากลาง — กรอกราคาเอง')).toBeInTheDocument();
    expect(screen.getByLabelText('ราคาเงินสด')).toHaveValue('');
    expect(screen.queryByText(/ตามตารางราคากลาง/)).not.toBeInTheDocument();
  });

  it('อุปกรณ์เสริม: แถวเดียว "ราคาขาย"', () => {
    renderCard({ category: 'ACCESSORY', fields: { cash: '290', bc: '', finance: '' }, templatePrices: null, quote: null, accessoryProfit: 265 });
    expect(screen.getByLabelText('ราคาขาย')).toHaveValue('290');
    expect(screen.queryByLabelText('ราคาผ่อน BESTCHOICE')).not.toBeInTheDocument();
    expect(screen.getByText('กำไร 265')).toBeInTheDocument();
  });

  it('ยังไม่กรอกทุน → ไม่มีป้ายกำไร + บอกให้กรอกทุน', () => {
    renderCard({
      costEntered: false,
      quote: {
        cash: { price: 25900, profit: null },
        rate1: { ...QUOTE.rate1!, profit: null },
        rate2: { ...(QUOTE.rate2 as Extract<ModelQuote['rate2'], { available: true }>), profit: null },
      },
    });
    expect(screen.queryByText(/^กำไร /)).not.toBeInTheDocument();
    expect(screen.getByText('กรอกราคาทุนเพื่อดูกำไร')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน — หน้าเพิ่มสินค้า**

`apps/web/src/pages/ProductCreatePage/__tests__/ProductCreatePage.prices.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import api from '@/lib/api';
import { pickComboOption } from '@/test/combobox';
import ProductCreatePage from '../index';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TEMPLATE = {
  cashPrice: '25900.00',
  installmentBestchoicePrice: '25900.00',
  installmentFinancePrice: '25900.00',
  rate1TermMonths: null,
  rate1DownPayment: null,
  rate2TermMonths: null,
};
let template: unknown = TEMPLATE;

beforeEach(() => {
  vi.clearAllMocks();
  template = TEMPLATE;
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/branches') return { data: [{ id: 'branch-1', name: 'สาขาหลัก' }] };
    if (url === '/suppliers') return { data: { data: [] } };
    if (url.startsWith('/pricing-templates/lookup?')) return { data: template };
    if (url.startsWith('/interest-configs/resolved?')) {
      return { data: { minDownPct: 0.15, commissionPct: 0.1, vatPct: 0.07, ratePctByMonths: { 10: 0.5, 12: 0.5 }, allowedMonths: [10, 12] } };
    }
    if (url === '/gfin-config/max-prices') {
      return { data: [{ id: 'm15', gfinSeries: 'iPhone 15', gfinVariant: null, storage: '128GB', condition: 'HAND_1', maxPrice: '24900', modelMatchPattern: 'iPhone 15', isActive: true }] };
    }
    if (url === '/gfin-config/overprice-rules') {
      return { data: [{ id: 'r15', label: 'iPhone 15 มือ 1', seriesPattern: 'iPhone 15', condition: 'HAND_1', allowance: '1000', maxMonths: 12, minDownPct: null, isActive: true }] };
    }
    if (url === '/gfin-config/rate-factors') {
      return { data: [{ id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.17', feePerInstallment: '100', isActive: true }] };
    }
    if (url === '/gfin-config/settings') {
      return { data: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'product-1' } });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ProductCreatePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** ตัวอย่างจากชีต (สเปคข้อ 4.5): iPhone 15 128GB มือ 1 เครื่องไทย ทุน 25,800 */
async function fillIphone15(user: UserEvent) {
  await user.selectOptions(await screen.findByLabelText('ยี่ห้อ *'), 'Apple');
  await pickComboOption(user, 'รุ่น *', 'iPhone 15');
  await user.click(screen.getByRole('button', { name: '128GB' }));
  await user.selectOptions(screen.getByLabelText('เครื่องไทย / เครื่องนอก'), 'THAI');
  await user.selectOptions(screen.getByLabelText('สาขา *'), 'branch-1');
  await user.type(screen.getByLabelText('ราคาทุน (บาท) *'), '25800');
}

const paragraph = (text: string) => (_: string, el: Element | null) => el?.tagName === 'P' && el.textContent === text;
const BADGE = 'ตามตารางราคากลาง · iPhone 15 128GB มือ 1';

describe('ProductCreatePage — การ์ดราคาขาย (แบบ D)', () => {
  it('เลือกรุ่น + ความจุ → เติม 3 ราคาจากราคากลาง และขึ้นดาวน์ / ค่างวด / กำไรตามชีต', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    expect(await screen.findByText(BADGE)).toBeInTheDocument();
    expect(screen.getByLabelText('ราคาเงินสด')).toHaveValue('25,900');
    expect(screen.getByLabelText('ราคาผ่อน BESTCHOICE')).toHaveValue('25,900');
    expect(screen.getByLabelText('ราคาขาย GFIN')).toHaveValue('25,900');
    expect(await screen.findByText(paragraph('ดาวน์ 3,900 · ผ่อน 3,139 × 12 งวด'))).toBeInTheDocument();
    expect(screen.getByText(paragraph('ดาวน์ 6,500 · ผ่อน 3,403 × 12 งวด'))).toBeInTheDocument();
    for (const t of ['กำไร 100', 'กำไร 2,300', 'กำไร 2,938']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.queryByText('+ เพิ่มราคา')).not.toBeInTheDocument();
    expect(screen.queryByText('ค่าเริ่มต้น')).not.toBeInTheDocument();
  });

  it('บันทึก → ส่งราคาเป็นคอลัมน์ cashPrice / installmentPrice / financePrice ไม่ส่ง prices[]', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    await screen.findByText(BADGE);
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, payload] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/products');
    expect(payload).toMatchObject({ cashPrice: 25900, installmentPrice: 25900, financePrice: 25900, deviceOrigin: 'THAI' });
    expect(payload).not.toHaveProperty('prices');
  });

  it('แก้ราคาเอง → คิดใหม่ทันที · กรอบเตือน + "ราคากลาง X" · "ใช้ราคากลางทั้งหมด" กลับไปราคากลาง', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    await screen.findByText(BADGE);
    const bc = screen.getByLabelText('ราคาผ่อน BESTCHOICE');
    await user.clear(bc);
    await user.type(bc, '27000');
    expect(await screen.findByText('ราคากลาง 25,900')).toBeInTheDocument();
    expect(screen.getByText('แก้ 1 ราคาจากตารางราคากลาง')).toBeInTheDocument();
    // 27,000 × 15% = 4,050 → 4,100 · ยอดจัด 22,900 → (22,900 + 2,290 + 11,450) × 1.07 / 12 = 3,267.07 → 3,268
    expect(screen.getByText(paragraph('ดาวน์ 4,100 · ผ่อน 3,268 × 12 งวด'))).toBeInTheDocument();
    // ราคา 2 = 4,100 + 22,900 × 1.1 = 29,290 − ทุน 25,800
    expect(screen.getByText('กำไร 3,490')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ใช้ราคากลางทั้งหมด' }));
    expect(bc).toHaveValue('25,900');
    expect(screen.queryByText('ราคากลาง 25,900')).not.toBeInTheDocument();
  });

  it('ไม่พบรุ่นในราคากลาง → ช่องว่าง + ข้อความ · ไม่กรอกราคาเลย → บันทึกไม่ได้', async () => {
    template = '';
    const user = userEvent.setup();
    renderPage();
    await fillIphone15(user);
    expect(await screen.findByText('ไม่พบรุ่นนี้ในตารางราคากลาง — กรอกราคาเอง')).toBeInTheDocument();
    expect(screen.getByLabelText('ราคาเงินสด')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));
    expect(toast.error).toHaveBeenCalledWith('กรุณากรอกราคาขายอย่างน้อย 1 ราคา');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('อุปกรณ์เสริม → ช่องเดียว "ราคาขาย" ส่งเฉพาะ cashPrice', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText('ประเภท *'), 'ACCESSORY');
    await user.selectOptions(screen.getByLabelText('ประเภทอุปกรณ์ *'), 'ฟิล์ม');
    await user.selectOptions(screen.getByLabelText('สาขา *'), 'branch-1');
    await user.type(screen.getByLabelText('ราคาทุน (บาท) *'), '25');
    await user.type(screen.getByLabelText('ราคาขาย'), '290');
    expect(screen.queryByLabelText('ราคาผ่อน BESTCHOICE')).not.toBeInTheDocument();
    expect(await screen.findByText('กำไร 265')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.post).mock.calls[0][1];
    expect(payload).toMatchObject({ category: 'ACCESSORY', cashPrice: 290 });
    expect(payload).not.toHaveProperty('installmentPrice');
    expect(payload).not.toHaveProperty('financePrice');
  });
});
```

`ProductCreatePage.combobox.test.tsx`:
- ใน `mockImplementation` (บรรทัด 30–39) แทรกก่อน `throw new Error(…)`:

```ts
    if (url.startsWith('/interest-configs/resolved?')) {
      return { data: { minDownPct: 0.15, commissionPct: 0.1, vatPct: 0.07, ratePctByMonths: { 12: 0.5 }, allowedMonths: [12] } };
    }
    if (url === '/gfin-config/max-prices' || url === '/gfin-config/overprice-rules' || url === '/gfin-config/rate-factors') {
      return { data: [] };
    }
    if (url === '/gfin-config/settings') {
      return { data: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } } };
    }
```

- บรรทัด 81 `await user.type(screen.getByLabelText('จำนวนเงินราคา 1'), '30000');` แทนด้วย `await user.type(screen.getByLabelText('ราคาเงินสด'), '30000');`

`apps/web/src/pages/__tests__/touchTargets.test.ts` บรรทัด 53 แทนด้วย:

```ts
  ['ProductCreatePage/components/PriceCard.tsx', 'ใช้ราคากลางทั้งหมด', {}],
```

- [ ] **Step 3: รันให้เห็นว่าล้ม**

Run: `cd apps/web && npx vitest run src/pages/ProductCreatePage src/pages/__tests__/touchTargets.test.ts && cd ../..`
Expected: FAIL — `PriceCard` ไม่มี `ราคาเงินสด` / ป้ายราคากลาง · หน้าเพิ่มสินค้าส่ง `prices` · touchTargets `anchor not found in ProductCreatePage/components/PriceCard.tsx: ใช้ราคากลางทั้งหมด`

- [ ] **Step 4: เขียนการ์ด**

เขียนทับ `apps/web/src/pages/ProductCreatePage/components/PriceCard.tsx`:

```tsx
import { useId, type ReactNode } from 'react';
import { CheckCircle2, Info, PencilLine, TrendingDown, TrendingUp } from 'lucide-react';
import { formatBahtPlain, type ModelQuote } from '@installment/shared';
import { NumberInput } from '@/components/ui/NumberInput';
import { formControlClass } from '@/components/ui/form-styles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { editedKeys, gfinBlocked, type PriceFields, type PriceKey } from '../utils/priceCard';

/** สเปคข้อ 3.4 — ชุดเดียวกับ GfinPanel ของหน้าสินค้า ท่อนชี้ทางชี้มาที่ฟอร์มนี้ */
export const GFIN_ORIGIN_NOTE =
  'ยังไม่ระบุเครื่องไทย/เครื่องนอก — คิด OVER ครึ่งเดียวไว้ก่อน (ราคาส่งที่ GFIN รับแน่นอน) · ถ้าเป็นเครื่องไทย เลือกเครื่องไทยในฟอร์มนี้ ราคาส่งจะได้ OVER เต็ม';
const NO_GFIN = 'GFIN ไม่รับรุ่นนี้ — ขายได้แค่เงินสดและผ่อน BESTCHOICE';
const NOT_FOUND = 'ไม่พบรุ่นนี้ในตารางราคากลาง — กรอกราคาเอง';

export interface PriceCardProps {
  category: string;
  fields: PriceFields;
  onFieldChange: (key: PriceKey, value: string) => void;
  /** ราคากลางที่ใช้เติม — null = ยังไม่เลือกรุ่น / ไม่พบ */
  templatePrices: PriceFields | null;
  /** "iPhone 15 128GB มือ 1" — แสดงเมื่อมีราคากลาง */
  templateLabel: string;
  templateNotFound: boolean;
  onUseTemplate: () => void;
  /** null = อุปกรณ์เสริม / ยังไม่เลือกยี่ห้อและรุ่น */
  quote: ModelQuote | null;
  /** หมวดนี้ไม่มีตั้งค่าดอกเบี้ย (เช่น แท็บเล็ต) — เรท 1 คิดไม่ได้ */
  bcConfigMissing: boolean;
  accessoryProfit: number | null;
  costEntered: boolean;
}

function ProfitBadge({ profit }: { profit: number | null }) {
  if (profit == null) return null;
  const loss = profit < 0;
  const Icon = loss ? TrendingDown : TrendingUp;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium leading-snug tabular-nums',
        loss ? 'bg-destructive/10 text-destructive dark:bg-destructive/15' : 'bg-success/10 text-success dark:bg-success/15',
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {loss ? `ขาดทุน ${formatBahtPlain(-profit)}` : `กำไร ${formatBahtPlain(profit)}`}
    </span>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-snug text-muted-foreground">{children}</p>;
}

function Plan({ down, monthly, months }: { down: number; monthly: number; months: number }) {
  return (
    <p className="leading-snug">
      ดาวน์ <b className="font-semibold">{formatBahtPlain(down)}</b> · ผ่อน{' '}
      <b className="font-semibold">{formatBahtPlain(monthly)}</b> × {months} งวด
    </p>
  );
}

function PriceRow({
  id,
  label,
  sub,
  ariaLabel,
  value,
  onChange,
  disabled = false,
  placeholder,
  edited,
  templateValue,
  profit,
  children,
}: {
  id: string;
  label: string;
  sub?: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  edited: boolean;
  templateValue?: string;
  profit: number | null | undefined;
  children: ReactNode;
}) {
  const hintId = `${id}-template`;
  const showHint = edited && !!templateValue;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)] items-start gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3 last:border-b-0 sm:grid-cols-[9.5rem_10rem_minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <label htmlFor={id} className="pt-2.5 text-sm font-medium leading-snug text-foreground sm:pt-0">
        {label}
        {sub && <span className="block text-xs font-normal text-muted-foreground">{sub}</span>}
      </label>
      <div className="min-w-0">
        <NumberInput
          unstyled
          id={id}
          aria-label={ariaLabel}
          aria-describedby={showHint ? hintId : undefined}
          min={1}
          step="0.01"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            formControlClass,
            'text-right tabular-nums',
            edited && 'border-warning ring-1 ring-warning/30',
            disabled && 'cursor-not-allowed bg-muted text-muted-foreground',
          )}
        />
        {showHint && (
          <p id={hintId} className="mt-1 text-right text-xs leading-snug text-warning-strong">
            ราคากลาง {formatBahtPlain(Number(templateValue))}
          </p>
        )}
      </div>
      <div className="col-span-2 min-w-0 space-y-0.5 text-[13px] tabular-nums text-foreground sm:col-span-1">{children}</div>
      <div className="col-span-2 sm:col-span-1 sm:justify-self-end">
        <ProfitBadge profit={profit ?? null} />
      </div>
    </div>
  );
}

/**
 * การ์ด "ราคาขาย" แบบ D (สเปค 2026-11-19 ข้อ 5) — มือถือ/แท็บเล็ต 3 แถวตายตัว · อุปกรณ์เสริมแถวเดียว
 * ค่าที่คิดให้มาจาก `buildModelQuote` (ส่งมาเป็น `quote`) · กำไรแสดงเมื่อกรอกทุนในฟอร์มนี้
 */
export default function PriceCard({
  category,
  fields,
  onFieldChange,
  templatePrices,
  templateLabel,
  templateNotFound,
  onUseTemplate,
  quote,
  bcConfigMissing,
  accessoryProfit,
  costEntered,
}: PriceCardProps) {
  const baseId = useId();
  const accessory = category === 'ACCESSORY';
  const blocked = gfinBlocked(quote);
  const edited = editedKeys(fields, templatePrices).filter((k) => !(blocked && k === 'finance'));
  const isEdited = (k: PriceKey) => edited.includes(k);
  const rate1 = quote?.rate1 ?? null;
  const rate2 = quote?.rate2 ?? null;
  const waiting = <Muted>เลือกยี่ห้อและรุ่นก่อน ระบบจะเติมราคาให้</Muted>;

  return (
    <Card>
      <CardHeader className="flex-wrap gap-2">
        <CardTitle>ราคาขาย</CardTitle>
        {!accessory && templatePrices && (
          <div className="flex flex-wrap items-center gap-2">
            {edited.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-xs leading-snug text-success dark:bg-success/15">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                ตามตารางราคากลาง · {templateLabel}
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs leading-snug text-warning-strong dark:bg-warning/15">
                  <PencilLine className="size-3.5 shrink-0" aria-hidden="true" />
                  แก้ {edited.length} ราคาจากตารางราคากลาง
                </span>
                <button
                  type="button"
                  onClick={onUseTemplate}
                  className="inline-flex items-center text-xs font-medium text-primary underline-offset-2 hover:underline max-lg:min-h-11 lg:min-h-8"
                >
                  ใช้ราคากลางทั้งหมด
                </button>
              </>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {accessory ? (
          <PriceRow
            id={`${baseId}-cash`}
            label="ราคาขาย"
            sub="อุปกรณ์เสริม"
            ariaLabel="ราคาขาย"
            value={fields.cash}
            onChange={(v) => onFieldChange('cash', v)}
            edited={false}
            profit={accessoryProfit}
          >
            <Muted>มีช่องเดียว ไม่มีผ่อน</Muted>
          </PriceRow>
        ) : (
          <>
            <PriceRow
              id={`${baseId}-cash`}
              label="เงินสด"
              ariaLabel="ราคาเงินสด"
              value={fields.cash}
              onChange={(v) => onFieldChange('cash', v)}
              edited={isEdited('cash')}
              templateValue={templatePrices?.cash}
              profit={quote?.cash?.profit}
            >
              <Muted>{templateNotFound ? NOT_FOUND : 'จ่ายครั้งเดียว'}</Muted>
            </PriceRow>
            <PriceRow
              id={`${baseId}-bc`}
              label="ผ่อน BESTCHOICE"
              sub="เรท 1"
              ariaLabel="ราคาผ่อน BESTCHOICE"
              value={fields.bc}
              onChange={(v) => onFieldChange('bc', v)}
              edited={isEdited('bc')}
              templateValue={templatePrices?.bc}
              profit={rate1?.profit}
            >
              {!quote ? (
                waiting
              ) : rate1 ? (
                <>
                  <Plan down={rate1.downAmount} monthly={rate1.monthlyDisplay} months={rate1.months} />
                  <Muted>ยอดจัด {formatBahtPlain(rate1.price - rate1.downAmount)}</Muted>
                </>
              ) : (
                <Muted>
                  {bcConfigMissing ? 'ยังไม่มีตั้งค่าดอกเบี้ยของหมวดนี้ — คิดค่างวดไม่ได้' : 'กรอกราคาเพื่อดูดาวน์และค่างวด'}
                </Muted>
              )}
            </PriceRow>
            <PriceRow
              id={`${baseId}-finance`}
              label="ผ่อน GFIN"
              sub="เรท 2 · ราคาขาย"
              ariaLabel="ราคาขาย GFIN"
              value={blocked ? '' : fields.finance}
              onChange={(v) => onFieldChange('finance', v)}
              disabled={blocked}
              placeholder={blocked ? undefined : 'เท่าราคาผ่อน'}
              edited={isEdited('finance')}
              templateValue={templatePrices?.finance}
              profit={rate2?.available ? rate2.profit : null}
            >
              {!quote || !rate2 ? (
                waiting
              ) : blocked ? (
                <Muted>{NO_GFIN}</Muted>
              ) : rate2.available ? (
                <>
                  <Plan down={rate2.downAmount} monthly={rate2.monthly} months={rate2.months} />
                  <Muted>ส่ง GFIN {formatBahtPlain(rate2.submitPrice)}</Muted>
                  {rate2.originNote && (
                    <p className="flex items-start gap-1.5 pt-1 text-xs leading-snug text-info">
                      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <span>{GFIN_ORIGIN_NOTE}</span>
                    </p>
                  )}
                </>
              ) : (
                <Muted>{rate2.message}</Muted>
              )}
            </PriceRow>
          </>
        )}
        <p className="border-t border-border/60 bg-muted/40 px-4 py-2.5 text-xs leading-snug text-muted-foreground sm:px-5">
          {costEntered ? 'กำไรคิดจากช่อง "ราคาทุน" ในฟอร์มนี้ · เห็นเฉพาะคนที่เห็นทุน' : 'กรอกราคาทุนเพื่อดูกำไร'}
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: ต่อเข้าหน้าเพิ่มสินค้า (`ProductCreatePage/index.tsx`)**

1. บรรทัด 2 แทนด้วย `import { useState, useRef, useEffect, useMemo } from 'react';`
2. บรรทัด 14 แทนด้วย:

```ts
import PriceCard from './components/PriceCard';
import { useBcConfig } from '@/pages/ProductDetailPage/hooks/useBcConfig';
import { useGfinTables } from '@/pages/ProductDetailPage/hooks/useGfinTables';
import {
  EMPTY_PRICE_FIELDS,
  accessoryProfit,
  computeCardQuote,
  gfinBlocked,
  hasAnyPrice,
  mergeTemplate,
  templateFields,
  templateLabelOf,
  toPricePayload,
  type PriceFields,
  type PriceKey,
  type PriceTemplate,
} from './utils/priceCard';
```

3. บรรทัด 49–51 (`const [prices, setPrices] = useState<PriceRow[]>([…]);`) แทนด้วย:

```ts
  const [priceFields, setPriceFields] = useState<PriceFields>(EMPTY_PRICE_FIELDS);
```

4. บรรทัด 87–122 (คอมเมนต์ "Ignore stale requests…" ถึงปิด `useEffect`) แทนด้วย:

```ts
  // --- การ์ดราคาขาย (แบบ D) — เติมจากตารางราคากลางเมื่อเลือกยี่ห้อ + รุ่น (+ ความจุ / ประกัน / ไทย-นอก) ---
  const accessory = form.category === 'ACCESSORY';
  const lookupQuery =
    !accessory && form.brand && form.model
      ? new URLSearchParams({
          brand: form.brand,
          model: form.model,
          category: form.category,
          deviceOrigin: form.deviceOrigin || 'UNSPECIFIED',
          ...(form.storage ? { storage: form.storage } : {}),
          ...(form.category === 'PHONE_USED' ? { hasWarranty: String(!form.warrantyExpired) } : {}),
        }).toString()
      : null;
  const templateQuery = useQuery<PriceTemplate | null>({
    queryKey: ['pricing-template-lookup', lookupQuery],
    queryFn: async () => {
      const { data } = await api.get(`/pricing-templates/lookup?${lookupQuery}`);
      return data || null;
    },
    enabled: lookupQuery !== null,
    retry: false,
  });
  // undefined = ยังรอคำตอบ (ไม่แตะช่อง) · null = ไม่มีราคากลาง (ยังไม่เลือกรุ่น / ไม่พบ / ค้นไม่สำเร็จ — กรอกเองได้)
  const template: PriceTemplate | null | undefined =
    lookupQuery === null
      ? null
      : templateQuery.isSuccess
        ? templateQuery.data
        : templateQuery.isError
          ? null
          : undefined;
  const templatePrices = useMemo(() => (template === undefined ? undefined : templateFields(template)), [template]);
  // ราคากลางชุดที่เติมล่าสุด — ช่องที่ยังเท่าชุดนี้ถือว่า "อัตโนมัติ" เปลี่ยนตามรุ่นได้ ช่องที่แก้เองคงไว้
  const appliedTemplate = useRef<PriceFields | null>(null);
  useEffect(() => {
    if (templatePrices === undefined) return;
    const previous = appliedTemplate.current;
    appliedTemplate.current = templatePrices;
    setPriceFields((current) => mergeTemplate(current, previous, templatePrices));
  }, [templatePrices]);

  const bcConfigQuery = useBcConfig(form.category, !accessory);
  const gfinTables = useGfinTables(!accessory);
  const quote = useMemo(
    () =>
      computeCardQuote({
        category: form.category,
        brand: form.brand,
        model: form.model,
        storage: form.storage,
        deviceOrigin: form.deviceOrigin,
        fields: priceFields,
        template: template ?? null,
        costPrice: form.costPrice,
        bcConfig: bcConfigQuery.data,
        gfinTables: gfinTables.tables,
      }),
    [form.category, form.brand, form.model, form.storage, form.deviceOrigin, form.costPrice, priceFields, template, bcConfigQuery.data, gfinTables.tables],
  );
```

5. ใน `createMutation.mutationFn` บรรทัด 161–167 (`prices: prices.filter(…).map(…),`) แทนด้วย:

```ts
        ...toPricePayload(form.category, priceFields, { gfinBlocked: gfinBlocked(quote) }),
```

6. ลบบรรทัด 180–201 (`// --- Price handlers ---` ถึงปิด `updatePrice`)
7. ใน `handleSubmit` บรรทัด 321–324 แทนด้วย:

```ts
    if (!hasAnyPrice(toPricePayload(form.category, priceFields, { gfinBlocked: gfinBlocked(quote) }))) {
      toast.error('กรุณากรอกราคาขายอย่างน้อย 1 ราคา');
      return;
    }
```

8. บรรทัด 381–386 (`<PriceCard … />`) แทนด้วย:

```tsx
          <PriceCard
            category={form.category}
            fields={priceFields}
            onFieldChange={(key: PriceKey, value: string) => setPriceFields((f) => ({ ...f, [key]: value }))}
            templatePrices={templatePrices ?? null}
            templateLabel={templateLabelOf(form)}
            templateNotFound={lookupQuery !== null && template === null}
            onUseTemplate={() => {
              if (templatePrices) setPriceFields(templatePrices);
            }}
            quote={quote}
            bcConfigMissing={!accessory && bcConfigQuery.data === undefined && !bcConfigQuery.isFetching}
            accessoryProfit={accessory ? accessoryProfit(priceFields.cash, form.costPrice) : null}
            costEntered={form.costPrice !== ''}
          />
```

- [ ] **Step 6: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/ProductCreatePage src/pages/__tests__/touchTargets.test.ts && cd ../..`
Expected: PASS ทุกไฟล์ (combobox 3 · prices 5 · PriceCard 9 · priceCard util · touchTargets)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/ProductCreatePage/components/PriceCard.tsx apps/web/src/pages/ProductCreatePage/__tests__/PriceCard.test.tsx apps/web/src/pages/ProductCreatePage/index.tsx apps/web/src/pages/ProductCreatePage/__tests__/ProductCreatePage.prices.test.tsx apps/web/src/pages/ProductCreatePage/__tests__/ProductCreatePage.combobox.test.tsx apps/web/src/pages/__tests__/touchTargets.test.ts
git commit -m "feat(web): price card D on the product create page with down payment, installment and profit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: ตรวจรวมทั้งช่วง

**Files:** ไม่มีไฟล์ใหม่

- [ ] **Step 1: ตรวจว่าไม่มีผู้อ่านเรท 2 หลุด**

Run:
```bash
grep -rn "calcGfinInstallment(\|buildGfinQuote(\|resolveQuotes(" apps --include=*.ts --include=*.tsx | grep -v "\.test\.\|\.spec\.\|node_modules"
grep -rn "resolveInstallmentSemantics\|SEMANTICS_CONFIG_KEY\|INSTALLMENT_LOOKS_PER_MONTH" apps/api/src
grep -rn "จำนวนเงินราคา\|+ เพิ่มราคา\|PriceRow }" apps/web/src
```
Expected: บรรทัดแรกเหลือเฉพาะ `installment-preview.service.ts` · `gfinQuote.ts` · `resolveQuotes.ts` · `ProductDetailPage/index.tsx` · `useStickerQuotes.ts` (+ `installment-calc.util.ts` ที่ re-export) และ (ถ้าช่วง 2 เพิ่ม) `pricing-quote.service.ts` ที่ใช้ราคากลาง ไม่ใช่ราคาเครื่อง · บรรทัดที่ 2 และ 3 ไม่มีผลลัพธ์

- [ ] **Step 2: รันชุดทดสอบทั้งหมด + ชนิด + manifest**

Run:
```bash
npm --prefix packages/shared test
NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test
cd apps/web && npx vitest run && cd ../..
NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh all
```
Expected: PASS ทั้งหมด · TypeScript 0 errors
ทะเบียนสิทธิ์: คำสั่งเดียวกับ Task 5 Step 6 (Linux/macOS/CI หรือแบบครอบบน Windows) → ไม่มี error ของ `PricingTemplatesController`
ถ้ามีเทสต์ล้มนอกไฟล์ที่ระบุใน Task 1–9: คือบั๊กของงานนี้ ต้องแก้โค้ด ไม่ใช่แก้ค่าคาดหวัง

- [ ] **Step 3: ตรวจบนหน้าจอจริง (local)**

เปิด API + เว็บ (`npm run dev` — API ต้องตั้ง `NODE_OPTIONS=--max-old-space-size=8192`) ล็อกอิน `admin@bestchoice.com` เตรียมข้อมูล: ตั้งค่าดอกเบี้ยมือ 1 แถวรายงวด 10/12 = 50% ดาวน์ 15% คอม 10% · ราคากลาง iPhone 15 128GB มือ 1 = 25,900 / 25,900 / 25,900 · ใบราคา GFIN iPhone 15 128GB มือ 1 = 24,900 · OVER iPhone 15 มือ 1 = 1,000 งวดสูงสุด 12 · เรท 12 งวด คอม 15% = 0.17 + 100

ตรวจทุกข้อทั้ง **จอสว่าง และจอมืด** และทั้ง **จอกว้าง (≥ 1280px) และมือถือ (390px)**:

1. หน้าเพิ่มสินค้า เลือก Apple · iPhone 15 · 128GB · เครื่องไทย · ทุน 25,800 → การ์ดขึ้น "ตามตารางราคากลาง · iPhone 15 128GB มือ 1" · ดาวน์/ค่างวด/กำไรตรงตาราง "ตัวเลขอ้างอิง" · บนมือถือแต่ละแถวเป็น ชื่อ + ช่อง แล้วค่าที่คิดให้อยู่บรรทัดล่าง ไม่มีเลื่อนแนวนอน
2. แก้ราคาผ่อนเป็น 27,000 → กรอบเตือน + "ราคากลาง 25,900" + ป้าย "แก้ 1 ราคา…" + ปุ่ม "ใช้ราคากลางทั้งหมด" (กดได้ด้วยนิ้ว — สูง 44px บนมือถือ) · กดแล้วกลับ 25,900
3. ใส่ทุน 30,000 → ป้าย "ขาดทุน …" มีไอคอนลูกศรลง อ่านออกทั้งสองโหมดสี · บันทึกได้
4. ช่องเครื่องไทย/นอกเป็น "ยังไม่ระบุ" → หมายเหตุใต้แถว GFIN ตามข้อความสเปคข้อ 3.4 · ราคาส่ง 25,400
5. เลือกรุ่นที่ไม่มีใบราคา GFIN → ช่อง GFIN ปิด + "GFIN ไม่รับรุ่นนี้ — ขายได้แค่เงินสดและผ่อน BESTCHOICE"
6. เลือกรุ่นที่ไม่มีราคากลาง → ช่องว่าง + "ไม่พบรุ่นนี้ในตารางราคากลาง — กรอกราคาเอง" · ไม่กรอกอะไรแล้วบันทึก → toast "กรุณากรอกราคาขายอย่างน้อย 1 ราคา"
7. ประเภทอุปกรณ์เสริม → แถวเดียว "ราคาขาย" · บันทึกแล้วหน้าสินค้ามีราคาเงินสดอย่างเดียว
8. บันทึกเครื่องข้อ 1 → หน้าสินค้า: แถวราคามี "ราคาเงินสด" (ค่าเริ่มต้น) · "ราคาผ่อน BESTCHOICE" · "ราคาผ่อนไฟแนนซ์" · การ์ดคำนวณฝั่ง GFIN หัวการ์ดบอก "คิดจากราคาขาย GFIN 25,900" · หน้าสร้างสัญญาเลือกเครื่องนี้ได้ราคาผ่อน BESTCHOICE 25,900
9. หน้าสินค้า → "แก้ราคา" → ช่อง "ราคาขาย GFIN (บาท)" แก้เป็น 26,500 → การ์ดคำนวณ GFIN ดาวน์เปลี่ยน · สติกเกอร์ของเครื่องนี้ค่างวดเรท 2 ตรงการ์ด
10. ตั้งค่า › สินค้า › ตั้งราคา → ปุ่ม "เติมราคาขาย GFIN ให้เครื่องในสต๊อก (N เครื่อง)" · กดแล้ว dialog บอกจำนวน · ยืนยัน → toast · ปุ่มเหลือ (0 เครื่อง) และกดไม่ได้ · เครื่องที่มีราคาขาย GFIN อยู่แล้วค่าไม่เปลี่ยน
11. เครื่องยึด → "พร้อมขาย" → หน้าสินค้าเครื่องนั้นราคาขาย GFIN = ราคากลางมือ 2 (หรือว่างถ้าไม่มีราคากลาง) · เครื่อง REFURBISHED → "นำเข้าคลังพร้อมขาย" ไม่ถูกบล็อกด้วยแถว "ราคาผ่อนไฟแนนซ์"

บันทึกผลแต่ละข้อ (ผ่าน / ไม่ผ่าน พร้อมตัวเลขที่เห็น และโหมดสี/ขนาดจอที่ตรวจ) ไว้ส่งต่อให้เจ้าของ

---

## สิ่งที่แผนนี้ไม่ทำ

- ย้ายค่าจากแถว "ราคาผ่อนไฟแนนซ์" เดิมเข้าคอลัมน์ (สเปคข้อ 3.2 ห้าม) — เครื่องเดิมใช้ปุ่มเติมเท่านั้น
- บรรทัด "ใบราคา X + OVER Y · ยอดจัด" ของแถว GFIN ใน mockup — `Rate2Quote` ของสัญญาร่วมไม่มีใบราคา/OVER/ยอดจัด การ์ดแสดง "ส่ง GFIN X" แทน
- การลงบัญชีขายผ่าน GFIN ตาม "ราคา 3" (สเปคข้อ 1 "ไม่อยู่ในรอบนี้")
- แสดงราคาขาย GFIN ในการ์ด "ราคาขาย" ของหน้าสินค้า (แก้ได้ในหน้าต่าง "แก้ราคาขาย" อย่างเดียว)
