# B0 — ราคาเดียว + เกรด + เงื่อนไขขึ้นเว็บ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้ "ราคาต่อเครื่อง" มีแหล่งเดียวคือคอลัมน์ `Product.cashPrice` / `Product.installmentPrice` (มี writer จริงทุกทางเข้า + write-through กลับไป `prices[]` ให้ผู้อ่านเดิมไม่พัง), ให้ `Product.conditionGrade` มี production writer, และให้ "ขึ้นเว็บ" ตัดสินจาก readiness fragment ตัวเดียวที่ผู้อ่านทุกตัวใช้ร่วมกัน — spec: `docs/superpowers/specs/2026-08-04-product-answering-readiness-design.md` §2 (2.1–2.4)

**Architecture:** ตรรกะใหม่ทั้งหมดอยู่ใน **pure util ที่รับ `Prisma.TransactionClient`** (`apps/api/src/utils/*.util.ts`) ไม่ใช่ injectable service — เพราะจุด hook สำคัญที่สุด (`PoReceivingService`) เป็น **plain class ที่ถูก `new` ด้วย prisma ตัวเดียว** (`purchase-orders.service.ts:25`) จะ inject service เข้าไปไม่ได้ถ้าไม่รื้อ facade. util 4 ตัว: `product-price-sync` (คอลัมน์ → prices[]), `product-price-autofill` (PricingTemplate → คอลัมน์), `product-readiness` (Prisma where fragment + checklist), `device-query-normalize` (คำค้นไทย → brand/model/storage/color)

**Tech Stack:** NestJS + Prisma (apps/api), React + vitest (apps/web), React (apps/web-shop), Postgres migration `20260982000000`

## Global Constraints

- **Branch:** `feat/pa-b0-price-grade-readiness` (แตกจาก `spec/product-answering-readiness`)
- **Migration:** `20260982000000_product_price_grade_readiness` — ตรวจแล้ว max ปัจจุบันบน main = `20260981000000_add_credit_note_source_fields` → `20260982000000` ว่างจริง. ถ้า merge ช้าและมี migration ใหม่แทรก ให้ `ls apps/api/prisma/migrations | sort | tail -3` ก่อน แล้วเลื่อนเลข
- **เงิน = `Prisma.Decimal` เท่านั้น** — ห้าม `Number()` ในเส้นทางเขียนราคา; `Number()` ใช้ได้เฉพาะตอนแปลงออก response ให้ JSON
- **Red line:** ห้ามแตะ accounting/finance JE templates, ห้ามแตะ `journal/`, `accounting/`, `payments/`. Task 1 เป็น golden test ของเครื่องคิดเงินสัญญา — **ต้องเขียวก่อน** ถึงจะแตะ `getSellingPrice`. Task 8 แตะ `repossessions.service.markReadyForSale` ซึ่งอยู่ในไฟล์เดียวกับ JP5 — **แก้เฉพาะบล็อก 708-726 เท่านั้น ห้ามแตะ `create()`/JP5 และห้ามแตะบล็อก costPrice 694-707**
- **Runner ฝั่ง api = jest**: `cd apps/api && npx jest src/utils/product-readiness.util.spec.ts` (config อยู่ใน `apps/api/package.json:145`, `rootDir: src`, `testRegex .*\.spec\.ts$`) หรือ `npm run test --workspace=apps/api -- <pattern>`
- **⚠️ Runner ฝั่ง web = vitest ไม่ใช่ jest**: `apps/web/vitest.config.ts` (`include: ['src/**/*.{test,spec}.{ts,tsx}']`, jsdom, globals). รันด้วย `cd apps/web && npx vitest run src/pages/ContractCreatePage/hooks/useContractCalculation.pricesource.test.ts`. ถ้าเห็นคำสั่ง `npx jest` ในงานฝั่ง web ที่ไหน = ผิด
- **ห้ามใช้ vitest ฝั่ง api นอก `journal/cpa-templates/`** (jest ignore glob + CI แยก step)
- **UI copy ภาษาไทย**, error message ภาษาไทย (convention `.claude/rules/backend.md`)
- **Type check:** `./tools/check-types.sh api` (= `cd apps/api && npx tsc --noEmit`) / `./tools/check-types.sh web` / `cd apps/web-shop && npx tsc --noEmit` → 0 error (baseline วันนี้: web-shop tsc = 0 error)
- **⚠️ `apps/api/scripts/` อยู่นอก `include` ของ `apps/api/tsconfig.json` (`["src/**/*","prisma/**/*"]`)** → ไฟล์ใน `scripts/` **ไม่ถูก tsc ตรวจ และ lint ไม่ได้** (`npx eslint scripts/x.ts` = `Parsing error: parserOptions.project ... file was not found in any of the provided project(s)`). Task 6/9 ที่เขียนสคริปต์จึงตรวจด้วยการ **รันจริง** เท่านั้น
- **Lint (คำสั่งที่ใช้ได้จริง — ยืนยันแล้ว 2026-08-04):**
  - api: `cd apps/api && npx eslint src/<path ที่แก้>` (เฉพาะไฟล์ใน `src/`) และ gate ของ CI คือ `npm run lint --workspace=apps/api` (= `eslint "{src,test}/**/*.ts" --fix`)
    ⚠️ **ห้ามใช้ `cd apps/api && npx eslint .` เป็น gate** — วันนี้มี **34 error ค้างอยู่ก่อน B0** ล้วนเป็น `Parsing error` ของไฟล์นอก tsconfig (`e2e/*.e2e-spec.ts`, `scripts/*.ts`, `eslint.config.mjs`) และ `npx eslint "src/**/*.ts"` มี **1 error ค้าง** (`src/cli/backfill-expense-vendor-fk.cli.ts:289 prefer-const` — `--fix` ของ CI แก้ให้เอง) → เป้าหมายคือ **ไม่เพิ่ม error ใหม่** ไม่ใช่ 0 สัมบูรณ์
  - web: `cd apps/web && npx eslint .` → **0 error จริง** (513 warning ค้าง — ปล่อยได้)
  - web-shop: **ไม่มี eslint config ในโปรเจกต์นี้** (`npx eslint "src/**/*.{ts,tsx}"` ตอบ `ESLint couldn't find an eslint.config.(js|mjs|cjs) file`) → gate เดียวของ web-shop คือ `npx tsc --noEmit`
- ทุก commit ลงท้าย `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- QA เบราว์เซอร์ทำบน **local env เท่านั้น** (prod ปฏิเสธ seed accounts — ดู memory `qa-prod-creds-and-purchasing-v2-result`)
- **Task 6 เป็น gate ที่ต้องรอ owner ตอบ** — Task 7 (autofill) implement ต่อได้ทันทีในสาขา `PER_MONTH` (default) แต่สาขา `TOTAL` จะ verify ได้ต่อเมื่อ owner ยืนยัน

---

## File Structure

**สร้างใหม่ (apps/api)**
| ไฟล์ | หน้าที่ |
|---|---|
| `src/utils/device-query-normalize.util.ts` (+`.spec.ts`) | คำค้นไทย/ย่อ → `{brand, model, storage, color}`; export `normalizeStorage`/`extractStorageToken` ที่ util อื่นใช้ต่อ |
| `src/utils/product-price-sync.util.ts` (+`.spec.ts`) | write-through: คอลัมน์ราคา → แถว `ProductPrice` (update row isDefault เดิม + upsert 'ราคาผ่อน BESTCHOICE' + บังคับ default เดียว) ใน tx ของ caller |
| `src/utils/product-price-autofill.util.ts` (+`.spec.ts`) | `PricingTemplate` → `cashPrice` (+`installmentPrice` ตาม semantics flag) + stamp `priceAutofilledAt` |
| `src/utils/product-readiness.util.ts` (+`.spec.ts`) | `productReadinessWhere()` → `{AND:[...]}` AND-composable + `evaluateReadiness()` → checklist |
| `scripts/survey-pricing-templates.ts` | read-only survey ให้ owner ตัดสินความหมาย `installmentBestchoicePrice` |
| `prisma/migrations/20260982000000_product_price_grade_readiness/migration.sql` | 3 คอลัมน์ใหม่บน `products` |

**สร้างใหม่ (apps/web)**
| ไฟล์ | หน้าที่ |
|---|---|
| `src/pages/ContractCreatePage/hooks/useContractCalculation.pricesource.test.ts` | golden test ปักหมุดเลขเครื่องคิดเงินสัญญาก่อน/หลังเปลี่ยนเป็น columns-first |

**แก้ไข**
| ไฟล์ | แก้อะไร |
|---|---|
| `apps/api/prisma/schema.prisma` (model Product ~1622-1736) | +`accessoriesIncluded Json?`, `cosmeticNotes String?`, `priceAutofilledAt DateTime?` |
| `apps/api/src/modules/products/dto/create-product.dto.ts` / `update-product.dto.ts` | +6 ฟิลด์ (ราคา 2 + เกรด/ประกัน 2 + อุปกรณ์/ตำหนิ 2) |
| `apps/api/src/modules/products/products.service.ts` (`create` :79-103, `update` :105-118) | `create`/`update` เขียนคอลัมน์ + write-through + เคลียร์ `priceAutofilledAt` + autofill |
| `apps/api/src/modules/products/products.controller.ts:137-141` | +`GET :id/readiness` (แทรก**ก่อน** `@Get(':id')` บรรทัด 143 ไม่งั้น `:id` จะกลืน route) |
| `apps/api/src/modules/products/products-online-listing.service.ts:38-51` | ปลด invariant (toggle กดได้เสมอ) |
| `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:171-207` | sellingPrice → `cashPrice` + write-through + autofill เมื่อไม่ได้กรอกราคา |
| `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts:416-437` | autofill หลัง `tx.product.create` |
| `apps/api/src/modules/repossessions/repossessions.service.ts:708-726` | resellPrice → `cashPrice` + write-through (แทนโค้ด price-row มือ) |
| `apps/api/src/modules/quality-control/inspections.service.ts` (`completeInspection` :184-190, `overrideGrade` :195-206) | เขียน `conditionGrade` 2 จุด |
| `apps/api/src/modules/shop-catalog/shop-catalog.service.ts:51-63, 225-233, 237-248, 251-254` | ใช้ readiness fragment 3 จุด + เลิก `?? 0` |
| `apps/api/src/modules/shop-reservation/shop-reservation.service.ts:22-24` | reserve() ใช้ readiness fragment |
| `apps/api/src/modules/shop-cart/shop-cart.service.ts:29-43` | เลิก `?? 0` |
| `apps/api/src/modules/shop-installment-apply/shop-installment-apply.service.ts:44` | ไม่มีราคา → `BadRequestException` |
| `apps/api/scripts/backfill-product-prices.ts` | fallback isDefault ทุก label + log per-label + dry-run |
| `apps/api/package.json` | +3 npm scripts (`survey:pricing-templates`, `backfill:product-prices`, `backfill:product-prices:help`) |
| `apps/web/src/pages/ContractCreatePage/types.ts:1-11` | `Product` +`cashPrice`/`installmentPrice` |
| `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts:35-43` | `getSellingPrice` → columns-first |
| `apps/web-shop/src/pages/ProductDetailPage.tsx:146,177,312` | ไม่ track ราคา 0 + null-safe |

**แก้ไข — spec เดิมที่ "จะแดง" เพราะพฤติกรรมเปลี่ยน (ตรวจกับโค้ดจริงแล้ว — ห้ามข้าม)**
| ไฟล์ spec | เคสที่ต้องแก้ | Task |
|---|---|---|
| `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts` | :25 `hard-filters…`, :162 `filters by exact model…`, :180 `listAvailableModels…`, :257 `returns null when the resolved id is not an iPhone…`, :339 `listRelated…` — ทั้ง 5 เคส assert `brand`/`category`/`status`/`isOnlineVisible` ที่ **top-level ของ where** ซึ่งย้ายเข้า `AND[...]` แล้ว | 11 |
| `apps/api/src/modules/shop-reservation/shop-reservation.service.spec.ts` | 5 เคสใน `describe('reserve')` — mock `prisma.product.findUnique` แต่โค้ดใหม่ใช้ `findFirst`; และ `rejects if product not in stock` เปลี่ยนจาก `ConflictException` → `NotFoundException` | 11 |
| `apps/api/src/modules/shop-cart/shop-cart.service.spec.ts` | :48 `falls back to installmentPrice when cashPrice is not set` — ต้องยังเขียว (จึงต้อง**คง fallback** `cashPrice ?? installmentPrice`) | 12 |
| `apps/api/src/modules/quality-control/inspections.grade-mapping.spec.ts` | :178-181 assert `productUpdate` ถูกเรียกด้วย `data: { status: 'QC_PENDING' }` **เป๊ะ** → ต้องเป็น `{ status:'QC_PENDING', conditionGrade:'A' }` | 13 |
| `apps/api/src/modules/quality-control/inspections.override-grade.spec.ts` | `makePrisma` ไม่มี `products` ใน inspection และไม่มี `product.update` → ลูปใหม่จะ throw (`products` undefined ไม่ iterable) ใน 3 เคสที่ `isCompleted: true` | 13 |
| `apps/api/src/modules/products/products-online-listing.service.spec.ts` | **4 เคส** (:57, :62, :72, :92) ที่ยืนยัน invariant เดิม | 13 |
| `apps/api/src/modules/purchase-orders/purchase-orders.service.spec.ts` | tx mock ขาด `pricingTemplate`/`systemConfig`/`product.update`/`productPrice.findMany,update,updateMany` | 7 |
| `apps/api/src/modules/purchase-orders/purchase-orders.direct-receive.spec.ts` | เหมือนข้างบน (dto มี `sellingPrice: 39900` → เดินสาย `tx.product.update` + write-through) | 7 |
| `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts` | `makeTx()` ขาด `pricingTemplate.findMany` | 7 |
| `apps/api/src/modules/repossessions/repossessions.service.spec.ts` | เพิ่มเคส `markReadyForSale` (ใช้ mock ของไฟล์เดิม) | 8 |

---

### Task 1: Golden test เครื่องคิดเงินสัญญา + เปลี่ยน `getSellingPrice` เป็น columns-first

> **นี่คือ red line ของ batch** — ต้องมีเทสต์ที่ปักหมุดเลขเดิมก่อน แล้วค่อยเปลี่ยนโค้ด

**Files:**
- Create: `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.pricesource.test.ts`
- Modify: `apps/web/src/pages/ContractCreatePage/types.ts` (interface `Product` บรรทัด 1-11)
- Modify: `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts` (บรรทัด 35-43 = บล็อก `getSellingPrice` ทั้งก้อน)

**Interfaces:**
- Consumes: `getDisplayPrices(product: ProductForDisplay): { cash: number | null; installment: number | null }` จาก `apps/web/src/utils/getDisplayPrices.ts:26` — columns-first อยู่แล้ว (อ่าน `product.cashPrice`/`installmentPrice` ก่อน แล้วค่อย fallback label)
- Consumes: `calcBcInstallment` จาก `@installment/shared` (ผ่าน hook เดิม — ไม่แตะ)
- Produces (พฤติกรรมใหม่ของ `getSellingPrice`): `installment(column|label) ?? cash(column|label) ?? isDefault row ?? prices[0] ?? 0`

- [ ] **Step 1:** เพิ่มคอลัมน์ราคาเข้า type `Product` ใน `apps/web/src/pages/ContractCreatePage/types.ts` (แก้ interface บรรทัด 1-11 ให้เป็น):

```ts
export interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  status: string;
  branchId: string;
  branch: { id: string; name: string };
  /** B0: แหล่งราคาจริง (คอลัมน์) — API ส่งเป็น string เพราะ Prisma.Decimal serialize เป็น string */
  cashPrice?: string | null;
  installmentPrice?: string | null;
  prices: { id: string; label: string; amount: string; isDefault: boolean }[];
}
```

- [ ] **Step 2:** เขียน golden test (ยังไม่แตะ hook) — สร้างไฟล์ `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.pricesource.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useContractCalculation } from './useContractCalculation';
import type { Product, InterestConfig } from '../types';

/**
 * GOLDEN — B0 §2.1 red line.
 *
 * getSellingPrice กำลังถูกเปลี่ยนจาก "prices[] label ก่อน" เป็น "คอลัมน์ก่อน".
 * เทสต์ชุด A-E ปักหมุดว่า **ข้อมูลจริงที่มีอยู่ทุกแบบต้องได้เลขเท่าเดิมทุกบาท**
 * (prod วันนี้คอลัมน์เป็น null ทั้งกระดาน → เดินสาย fallback เดิมเป๊ะ)
 * ชุด F-G คือพฤติกรรมใหม่ที่ตั้งใจ (คอลัมน์ชนะเมื่อมีค่า)
 */

const CONFIG = {
  interestRate: '0.015',      // 1.5%/เดือน flat → ratePct(12) = 0.18
  minDownPaymentPct: '0.20',
  storeCommissionPct: '0.10',
  vatPct: '0.07',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 24,
} as unknown as InterestConfig;

const makeProduct = (over: Partial<Product>): Product =>
  ({
    id: 'p1',
    name: 'iPhone 15',
    brand: 'Apple',
    model: '15',
    category: 'PHONE_NEW',
    status: 'IN_STOCK',
    branchId: 'b1',
    branch: { id: 'b1', name: 'สาขาลาดพร้าว' },
    prices: [],
    ...over,
  }) as Product;

function setup(product: Product | null, initialDown = 4000) {
  return renderHook(() => {
    const [downPayment, setDownPayment] = useState(initialDown);
    const [totalMonths, setTotalMonths] = useState(12);
    return useContractCalculation({
      selectedProduct: product,
      interestConfig: CONFIG,
      posConfig: undefined,
      downPayment,
      setDownPayment,
      totalMonths,
      setTotalMonths,
    });
  });
}

describe('useContractCalculation — แหล่งราคา (B0 golden)', () => {
  it('A: คอลัมน์ + label ตรงกัน → 20,000 และเลขปลายทางตรงทุกบาท', () => {
    const { result } = setup(
      makeProduct({
        installmentPrice: '20000',
        prices: [{ id: 'r1', label: 'ราคาผ่อน BESTCHOICE', amount: '20000', isDefault: true }],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
    // ดาวน์ 4,000 → ต้น 16,000 / คอม 1,600 / ดอก 2,880 / VAT 1,433.60 / รวม 21,913.60 / งวด 1,826.13
    expect(result.current.principal).toBe(16000);
    expect(result.current.storeCommission).toBe(1600);
    expect(result.current.interestTotal).toBe(2880);
    expect(result.current.vatAmount).toBe(1433.6);
    expect(result.current.financedAmount).toBe(21913.6);
    expect(result.current.monthlyPayment).toBe(1826.13);
  });

  it('B: มีแต่ prices[] label "ราคาผ่อน BESTCHOICE" (คอลัมน์ null) → 20,000 เท่าเดิม', () => {
    const { result } = setup(
      makeProduct({
        cashPrice: null,
        installmentPrice: null,
        prices: [{ id: 'r1', label: 'ราคาผ่อน BESTCHOICE', amount: '20000', isDefault: true }],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
    expect(result.current.monthlyPayment).toBe(1826.13);
  });

  it('C: มีแต่ row label "ราคาขาย" ที่ isDefault (PO receive) → ใช้ค่านั้นเหมือนเดิม', () => {
    const { result } = setup(
      makeProduct({
        prices: [{ id: 'r1', label: 'ราคาขาย', amount: '20000', isDefault: true }],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
  });

  it('D: ไม่มี label ที่รู้จักและไม่มี isDefault → ใช้ prices[0] เหมือนเดิม', () => {
    const { result } = setup(
      makeProduct({
        prices: [
          { id: 'r1', label: 'ราคาขายต่อ (Refurbished)', amount: '20000', isDefault: false },
          { id: 'r2', label: 'อื่นๆ', amount: '99', isDefault: false },
        ],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
  });

  it('E: ไม่มีราคาเลย → 0 และตัวเลขทุกช่องเป็น 0', () => {
    const { result } = setup(makeProduct({ prices: [] }), 0);
    expect(result.current.sellingPrice).toBe(0);
    expect(result.current.monthlyPayment).toBe(0);
  });

  it('F: คอลัมน์ต่างจาก row เดิม → คอลัมน์ชนะ (พฤติกรรมใหม่)', () => {
    const { result } = setup(
      makeProduct({
        installmentPrice: '20000',
        prices: [{ id: 'r1', label: 'ราคาผ่อน BESTCHOICE', amount: '19000', isDefault: true }],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
  });

  it('G: มีแต่ cashPrice คอลัมน์ (ไม่มี label ผ่อน) → ใช้ cashPrice (พฤติกรรมใหม่)', () => {
    const { result } = setup(
      makeProduct({
        cashPrice: '20000',
        prices: [{ id: 'r1', label: 'ราคาขาย', amount: '17000', isDefault: true }],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
  });

  // H ปักหมุดพฤติกรรมที่ "เปลี่ยนโดยไม่ตั้งใจได้ง่ายที่สุด": ไม่มีคอลัมน์เลย
  // แต่มีแถว label 'ราคาเงินสด' ที่ **ไม่ใช่ isDefault** ควบกับแถว isDefault คนละ label
  //   เดิม: getSellingPrice → ไม่เจอ 'ราคาผ่อน*' → เอาแถว isDefault ('ราคาขาย' 17000)
  //   ใหม่: getDisplayPrices อ่าน label 'ราคาเงินสด' ได้ (20000) → cash ชนะ
  // นี่คือ diff เดียวที่ไม่ได้มาจากคอลัมน์ — ตั้งใจให้เกิด (label ราคาเงินสดตรงกว่า
  // 'ราคาขาย' ซึ่งเป็น label ที่ PO receive สร้างทิ้งไว้) จึงต้องมีเทสต์คุมไว้
  it('H: ไม่มีคอลัมน์ แต่มีแถว label "ราคาเงินสด" (ไม่ default) + แถว isDefault คนละ label → ใช้ราคาเงินสด (พฤติกรรมใหม่)', () => {
    const { result } = setup(
      makeProduct({
        prices: [
          { id: 'r1', label: 'ราคาขาย', amount: '17000', isDefault: true },
          { id: 'r2', label: 'ราคาเงินสด', amount: '20000', isDefault: false },
        ],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
  });
});
```

- [ ] **Step 3:** รันให้เห็นสถานะ RED เฉพาะ F/G/H: `cd apps/web && npx vitest run src/pages/ContractCreatePage/hooks/useContractCalculation.pricesource.test.ts`
  → คาดหวัง: **A-E ผ่าน** (พิสูจน์ว่า golden ที่ปักหมุดตรงกับพฤติกรรมปัจจุบัน), **F ล้ม (ได้ 19000)**, **G ล้ม (ได้ 17000)**, **H ล้ม (ได้ 17000)**
  → ถ้า A-E ล้ม = golden เขียนผิด ต้องแก้ตัวเลขให้ตรงของจริงก่อน ห้ามแตะ hook
  > หมายเหตุกลไก: hook มี effect auto-set `downPayment = ceil(sellingPrice × minDownPct)` เมื่อยังไม่ touched (`useContractCalculation.ts:56-60`) — เคส A ตั้ง initialDown 4000 = 20% ของ 20000 พอดี เลขจึงนิ่ง; `calcBcInstallment` ปัด `round2` ทุกขั้น (`packages/shared/src/installment-calc.ts:44-51`) ค่าที่ได้จึงเป็น 2 ตำแหน่งเป๊ะ ใช้ `toBe` ได้ ไม่ต้อง `toBeCloseTo`

- [ ] **Step 4:** เปลี่ยน `getSellingPrice` ใน `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts` — แทนบรรทัด 35-43 ทั้งบล็อกด้วย:

```ts
  const getSellingPrice = () => {
    if (!selectedProduct) return 0;
    // B0 §2.1: columns-first ผ่าน getDisplayPrices (มัน fallback ไป prices[] label ให้อยู่แล้ว)
    const { cash, installment } = getDisplayPrices({
      cashPrice: selectedProduct.cashPrice ?? null,
      installmentPrice: selectedProduct.installmentPrice ?? null,
      prices: selectedProduct.prices,
    });
    if (installment != null) return installment;
    if (cash != null) return cash;
    // legacy tail ที่ getDisplayPrices ไม่ครอบ: row isDefault ที่ label ไม่ตรงชุดไหนเลย
    // ('ราคาขาย' จาก PO receive / 'ราคาขายต่อ (Refurbished)' จากยึดเครื่อง)
    const row =
      selectedProduct.prices.find((p) => p.isDefault) || selectedProduct.prices[0];
    return row ? parseFloat(row.amount) : 0;
  };
```

  และเพิ่ม import ที่หัวไฟล์ (ต่อจากบรรทัด 4):

```ts
import { getDisplayPrices } from '@/utils/getDisplayPrices';
```

- [ ] **Step 5:** รันให้เขียวทั้งชุด + ชุดเดิมไม่พัง:

```bash
cd apps/web && npx vitest run src/pages/ContractCreatePage/hooks/
```
  → คาดหวัง: ไฟล์ใหม่ 8/8 ผ่าน + `useContractCalculation.test.ts` เดิม **16/16 ผ่าน** (นับแล้ว 16 `it` — เคสที่เสี่ยงที่สุดคือ `uses "ราคาผ่อน BESTCHOICE" price when present` :81 ที่มีทั้ง 'ราคาเงินสด' 20000 + 'ราคาผ่อน BESTCHOICE' 25000 → ต้องยังได้ **25000** เพราะ installment ชนะ cash)

- [ ] **Step 6:** `./tools/check-types.sh web` → 0 error; `cd apps/web && npx eslint src/pages/ContractCreatePage src/utils/getDisplayPrices.ts` → 0 error
- [ ] **Step 7:** Commit: `feat(b0): เครื่องคิดเงินสัญญาอ่านคอลัมน์ราคาก่อน + golden test ปักหมุดเลขเดิม`

---

### Task 2: Schema + migration `20260982000000`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Product` — แทรกต่อจากบล็อก `=== Online shop additions (Phase 1) ===` ~บรรทัด 1700-1712)
- Create: `apps/api/prisma/migrations/20260982000000_product_price_grade_readiness/migration.sql`

**Interfaces:**
- Produces: `Product.accessoriesIncluded Json?` (`{ charger?: boolean; cable?: boolean; box?: boolean; earphone?: boolean; other?: string }`), `Product.cosmeticNotes String?` (จำกัด 500 ที่ DTO), `Product.priceAutofilledAt DateTime?` (null = ราคาเซ็ตมือ / ยังไม่มีราคา)

- [ ] **Step 1:** เช็คเลข migration ล่าสุดจริงก่อน: `ls apps/api/prisma/migrations | sort | tail -3` → ต้องเห็น `20260981000000_add_credit_note_source_fields` เป็นตัวท้าย; ถ้าไม่ใช่ให้เลื่อนเลขใหม่แล้วอัปเดตทุกที่ในแผนนี้
- [ ] **Step 2:** เพิ่ม 3 ฟิลด์ใน `model Product` ต่อท้ายบล็อก online shop (ก่อน `// === Online shop additions (Phase 3) ===`):

```prisma
  /// B0: อุปกรณ์ที่แถมมากับเครื่อง — { charger, cable, box, earphone, other }
  accessoriesIncluded Json?     @map("accessories_included")
  /// B0: ตำหนิ/รอยที่ต้องบอกลูกค้าก่อนซื้อ (≤500 ตัวอักษร บังคับที่ DTO)
  cosmeticNotes       String?   @map("cosmetic_notes")
  /// B0: เวลาที่ราคาถูกเติมอัตโนมัติจากตารางราคากลาง — เคลียร์เป็น null เมื่อมีคนแก้ราคามือ
  priceAutofilledAt   DateTime? @map("price_autofilled_at")
```

- [ ] **Step 3:** สร้าง migration แบบ create-only แล้วตรวจ SQL:

```bash
cd apps/api && npx prisma migrate dev --name product_price_grade_readiness --create-only
```
  แล้วเปลี่ยนชื่อโฟลเดอร์ให้เป็น `20260982000000_product_price_grade_readiness` (prisma จะตั้ง timestamp ปัจจุบันมา — ต้อง rename ให้ตรง convention repo) และตรวจว่า SQL ที่ได้เป็น:

```sql
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "accessories_included" JSONB,
ADD COLUMN     "cosmetic_notes" TEXT,
ADD COLUMN     "price_autofilled_at" TIMESTAMP(3);
```

- [ ] **Step 4:** apply + regenerate: `cd apps/api && npx prisma migrate dev && npx prisma generate` แล้ว `./tools/check-types.sh api` → 0 error
- [ ] **Step 5:** Commit: `feat(b0): schema — accessoriesIncluded / cosmeticNotes / priceAutofilledAt`

---

### Task 3: `device-query-normalize.util.ts` — คำค้นไทย + normalizeStorage ที่ util อื่นใช้ต่อ

> ทำก่อนงานราคา เพราะ autofill (Task 7) ต้องใช้ `normalizeStorage` จากไฟล์นี้

**Files:**
- Create: `apps/api/src/utils/device-query-normalize.util.ts`
- Create: `apps/api/src/utils/device-query-normalize.util.spec.ts`

**Interfaces:**
- Consumes: ต้นฉบับตรรกะ = `apps/api/src/modules/sales-bot/tools/get-installment-rates.tool.ts:76-85` (`extractStorageToken` regex `/(\d+)\s*(gb|tb)\b/i`, `normalizeStorage` = upper + ตัดช่องว่าง) — **คัดลอกมาแบบพฤติกรรมเดียวกันเป๊ะ** (B3 จะ re-point tool มาใช้ไฟล์นี้; B0 ไม่แตะ tool)
- Produces:
```ts
export function normalizeStorage(storage: string | null | undefined): string;
export function extractStorageToken(text: string): string | null;
export function stripStorageToken(text: string): string;
export interface DeviceQuery { brand: string | null; model: string | null; storage: string | null; color: string | null; rest: string }
export function parseDeviceQuery(utterance: string): DeviceQuery;
```

- [ ] **Step 1:** เขียน spec ที่ล้มก่อน — สร้าง `apps/api/src/utils/device-query-normalize.util.spec.ts`:

```ts
import {
  normalizeStorage,
  extractStorageToken,
  stripStorageToken,
  parseDeviceQuery,
} from './device-query-normalize.util';

describe('normalizeStorage', () => {
  it('upper-case + ตัดช่องว่าง (parity กับ get-installment-rates.tool)', () => {
    expect(normalizeStorage('128 gb')).toBe('128GB');
    expect(normalizeStorage('1Tb')).toBe('1TB');
  });
  it('null/undefined/ว่าง → สตริงว่าง (ตรงกับ PricingTemplate.storage default "")', () => {
    expect(normalizeStorage(null)).toBe('');
    expect(normalizeStorage(undefined)).toBe('');
    expect(normalizeStorage('   ')).toBe('');
  });
});

describe('extractStorageToken', () => {
  it('ดึง token ความจุออกจากข้อความอิสระ', () => {
    expect(extractStorageToken('ไอโฟน 15 โปรแม็กซ์ 256 gb')).toBe('256GB');
    expect(extractStorageToken('ip15 1tb')).toBe('1TB');
  });
  it('ไม่มีความจุ → null', () => {
    expect(extractStorageToken('ไอโฟน 15')).toBeNull();
  });
  it('stripStorageToken ตัด token ออกและบีบช่องว่าง', () => {
    expect(stripStorageToken('iPhone 15 Pro Max 256GB')).toBe('iPhone 15 Pro Max');
  });
});

describe('parseDeviceQuery', () => {
  it('ไอโฟน → Apple + รุ่นตัวเลข', () => {
    const q = parseDeviceQuery('ไอโฟน 15');
    expect(q.brand).toBe('Apple');
    expect(q.model).toBe('iPhone 15');
  });
  it('รองรับ ip15 / 15pm ย่อ', () => {
    expect(parseDeviceQuery('ip15').model).toBe('iPhone 15');
    expect(parseDeviceQuery('15pm').model).toBe('iPhone 15 Pro Max');
  });
  it('โปรแม็กซ์ / พลัส / โปร ภาษาไทย', () => {
    expect(parseDeviceQuery('ไอโฟน 15 โปรแม็กซ์').model).toBe('iPhone 15 Pro Max');
    expect(parseDeviceQuery('ไอโฟน 14 พลัส').model).toBe('iPhone 14 Plus');
    expect(parseDeviceQuery('ไอโฟน 13 โปร').model).toBe('iPhone 13 Pro');
  });
  it('ดึงความจุ + สีไทยออกมาแยก', () => {
    const q = parseDeviceQuery('ไอโฟน 15 โปร 256gb สีดำ');
    expect(q.model).toBe('iPhone 15 Pro');
    expect(q.storage).toBe('256GB');
    expect(q.color).toBe('ดำ');
  });
  it('เลขรุ่นเปล่า + สี ("15pm สีดำ") → ยังจับเป็น iPhone ได้', () => {
    const q = parseDeviceQuery('15pm สีดำ');
    expect(q.brand).toBe('Apple');
    expect(q.model).toBe('iPhone 15 Pro Max');
    expect(q.color).toBe('ดำ');
  });
  it('น้ำเงิน ต้องไม่ถูกจับเป็น "เงิน"', () => {
    expect(parseDeviceQuery('ไอโฟน 15 สีน้ำเงิน').color).toBe('น้ำเงิน');
  });
  it('ข้อความที่ไม่ใช่มือถือ / มีตัวเลขปนแต่ไม่ใช่รุ่น → brand/model เป็น null แต่ไม่ throw', () => {
    expect(parseDeviceQuery('สวัสดีครับ').brand).toBeNull();
    expect(parseDeviceQuery('สวัสดีครับ').model).toBeNull();
    // BARE_MODEL_RE ต้อง anchor ทั้งข้อความ ไม่งั้น 'ผ่อน 12 งวด' จะกลายเป็น iPhone 12
    expect(parseDeviceQuery('ผ่อน 12 งวด').model).toBeNull();
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/utils/device-query-normalize.util.spec.ts` → `Cannot find module './device-query-normalize.util'`
- [ ] **Step 3:** implement — สร้าง `apps/api/src/utils/device-query-normalize.util.ts`:

```ts
/**
 * B0 §2.4 — แปลง utterance ลูกค้า (ไทย/ย่อ/สลับ) เป็นคีย์ค้นสินค้า
 *
 * ต้นฉบับ normalizeStorage/extractStorageToken ยกมาจาก
 * `modules/sales-bot/tools/get-installment-rates.tool.ts:76-85` แบบพฤติกรรม
 * เดียวกันเป๊ะ เพื่อให้ B3 re-point tool มาที่นี่ได้โดยผลลัพธ์ไม่เปลี่ยน
 */

const STORAGE_RE = /(\d+)\s*(gb|tb)\b/i;

export function normalizeStorage(storage: string | null | undefined): string {
  return (storage ?? '').toUpperCase().replace(/\s+/g, '');
}

export function extractStorageToken(text: string): string | null {
  const m = text.match(STORAGE_RE);
  if (!m) return null;
  return `${m[1]}${m[2].toUpperCase()}`;
}

export function stripStorageToken(text: string): string {
  return text.replace(STORAGE_RE, ' ').replace(/\s+/g, ' ').trim();
}

export interface DeviceQuery {
  brand: string | null;
  model: string | null;
  storage: string | null;
  color: string | null;
  /** ข้อความที่เหลือหลังตัด brand/model/storage/color ออก (ใช้ค้นต่อได้) */
  rest: string;
}

/**
 * คำเรียก iPhone ในภาษาลูกค้า — **ไม่ใส่ ไอแพด/ipad** เพราะ util นี้คืน model
 * เป็นสตริง `iPhone <n>` เสมอ ถ้ารับ ipad เข้ามาจะได้ model ผิดชนิด
 * (และเว็บ/แคตตาล็อกขายเฉพาะ iPhone อยู่แล้ว — spec §0)
 */
const APPLE_TOKENS = ['ไอโฟน', 'ไอโฟ', 'iphone', 'ip'];
/**
 * ลูกค้าพิมพ์เลขรุ่นเปล่าๆ พ่วง variant: '15pm', '14 plus', '13' — ไม่มีคำว่า
 * ไอโฟน/ip เลย. อนุญาตเฉพาะรูปแบบ "ทั้งข้อความ = เลข 1-2 หลัก + variant"
 * เพื่อไม่ให้ข้อความทั่วไปที่บังเอิญมีเลข (เช่น 'ผ่อน 12 งวด') ถูกตีเป็น iPhone
 */
const BARE_MODEL_RE = /^\d{1,2}\s*(pm|promax|pro\s*max|pro|plus|\+|mini|p)?$/i;
/** ต่อท้ายรุ่น: เรียงยาว→สั้น เพราะ 'โปรแม็กซ์' ต้องชนะ 'โปร' */
const VARIANTS: { tokens: string[]; suffix: string }[] = [
  { tokens: ['โปรแม็กซ์', 'โปรแมกซ์', 'promax', 'pro max', 'pm'], suffix: ' Pro Max' },
  { tokens: ['โปร', 'pro', 'p'], suffix: ' Pro' },
  { tokens: ['พลัส', 'plus', '+'], suffix: ' Plus' },
  { tokens: ['มินิ', 'mini'], suffix: ' mini' },
];
/** เรียงยาว→สั้นตรงคู่ที่ซ้อนกัน: 'น้ำเงิน' ต้องมาก่อน 'เงิน' ไม่งั้น find() คืน 'เงิน' */
const COLORS = [
  'น้ำเงิน', 'ดำ', 'ขาว', 'ทอง', 'เงิน', 'ฟ้า', 'ม่วง', 'ชมพู', 'เขียว', 'แดง', 'เหลือง', 'ส้ม', 'เทา',
];

export function parseDeviceQuery(utterance: string): DeviceQuery {
  const raw = (utterance ?? '').trim();
  if (!raw) return { brand: null, model: null, storage: null, color: null, rest: '' };

  const storage = extractStorageToken(raw);
  let workingText = stripStorageToken(raw);
  const lower = workingText.toLowerCase();

  // ตัดคำว่า 'สี' นำหน้าออกด้วย ('สีดำ' → ตัดทั้งก้อน) ไม่งั้นเหลือเศษ 'สี'
  // ค้างใน workingText แล้วทำให้ '15pm สีดำ' ไม่เข้า BARE_MODEL_RE
  const color = COLORS.find((c) => workingText.includes(c)) ?? null;
  if (color) {
    workingText = workingText
      .replace(new RegExp(`(?:สี)?\\s*${color}`), ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const isApple = APPLE_TOKENS.some((t) => lower.includes(t)) || BARE_MODEL_RE.test(workingText);
  if (!isApple) {
    return { brand: null, model: null, storage, color, rest: workingText };
  }

  // เลขรุ่นตัวแรกที่ไม่ใช่ความจุ (ตัดออกไปแล้ว) เช่น 'ไอโฟน 15' / 'ip15' / '15pm'
  const numMatch = workingText.match(/(\d{1,2})/);
  if (!numMatch) {
    return { brand: 'Apple', model: null, storage, color, rest: workingText };
  }
  const num = numMatch[1];

  // ข้อความหลังเลขรุ่น = ที่อยู่ของ variant ('15pm', 'ไอโฟน 15 โปรแม็กซ์')
  const after = workingText.slice(numMatch.index! + num.length).toLowerCase();
  const variant = VARIANTS.find((v) => v.tokens.some((t) => after.includes(t)));

  return {
    brand: 'Apple',
    model: `iPhone ${num}${variant ? variant.suffix : ''}`,
    storage,
    color,
    rest: workingText,
  };
}
```

- [ ] **Step 4:** รันให้ผ่าน: `cd apps/api && npx jest src/utils/device-query-normalize.util.spec.ts` → คาดหวัง **12/12** ผ่าน (normalizeStorage 2 + extractStorageToken 3 + parseDeviceQuery 7)
- [ ] **Step 5:** `./tools/check-types.sh api` → 0; `cd apps/api && npx eslint src/utils/device-query-normalize.util.ts src/utils/device-query-normalize.util.spec.ts` → ไม่มี error ใหม่
- [ ] **Step 6:** Commit: `feat(b0): device-query-normalize util — คำค้นไทย/ย่อ + normalizeStorage ร่วม`

---

### Task 4: `product-price-sync.util.ts` — write-through คอลัมน์ → `prices[]`

**Files:**
- Create: `apps/api/src/utils/product-price-sync.util.ts`
- Create: `apps/api/src/utils/product-price-sync.util.spec.ts`

**Interfaces:**
- Consumes: `Prisma.TransactionClient` ของ caller (ห้ามเปิด tx เอง — ทุก call site อยู่ใน tx อยู่แล้ว)
- Pattern อ้างอิง: `ProductsPricingService.addPrice/updatePrice` (`products-pricing.service.ts:16-56`) — unset-other-defaults ด้วย `updateMany` ใน tx เดียว
- Produces:
```ts
export const CASH_LABEL = 'ราคาเงินสด';
export const INSTALLMENT_LABEL = 'ราคาผ่อน BESTCHOICE';

export async function syncPriceRowsFromColumns(
  tx: Prisma.TransactionClient,
  productId: string,
  columns: { cashPrice?: Prisma.Decimal | null; installmentPrice?: Prisma.Decimal | null },
): Promise<{ cashRowId: string | null; installmentRowId: string | null }>;
```

**กติกา (ต้องตรงเป๊ะ — กัน `isDefault` 2 แถวที่ทำผู้อ่าน `take:1` เพี้ยน):**
1. `cashPrice` ที่ส่งมา (ไม่ใช่ `undefined`) → หาแถวเป้าหมายตามลำดับ: (a) แถว label ตรง `'ราคาเงินสด'` → (b) แถว `isDefault` ปัจจุบันที่ label **ไม่ขึ้นต้นด้วย** `'ราคาผ่อน'` (relabel เป็น `'ราคาเงินสด'`) → (c) create ใหม่
2. `installmentPrice` ที่ส่งมา → upsert แถว label ตรง `'ราคาผ่อน BESTCHOICE'` (ไม่ยุ่งกับ isDefault ของแถวอื่น)
3. หลังเขียนเสร็จ: ถ้ามีแถว cash → `isDefault=true` ที่แถวนั้น แล้ว `updateMany` แถวอื่นทั้งหมด `isDefault=false`; ถ้าไม่มีแถว cash แต่ยังไม่มี default ใดเลย → ตั้งแถว installment เป็น default
4. `null` = ล้างราคา → **ไม่ลบแถว** (แถวเก่าเป็นประวัติ) แต่ข้ามการ sync ฟิลด์นั้น

- [ ] **Step 1:** เขียน spec ที่ล้มก่อน — `apps/api/src/utils/product-price-sync.util.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { syncPriceRowsFromColumns, CASH_LABEL, INSTALLMENT_LABEL } from './product-price-sync.util';

type Row = { id: string; label: string; amount: Prisma.Decimal; isDefault: boolean };

function makeTx(rows: Row[]) {
  const state = [...rows];
  let seq = 0;
  return {
    state,
    calls: { updateMany: [] as unknown[] },
    productPrice: {
      findMany: jest.fn(async () => state.map((r) => ({ ...r }))),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: Row = {
          id: `new-${++seq}`,
          label: data.label,
          amount: data.amount,
          isDefault: data.isDefault ?? false,
        };
        state.push(row);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of state) {
          if (where.id?.not && r.id === where.id.not) continue;
          if (where.isDefault !== undefined && r.isDefault !== where.isDefault) continue;
          Object.assign(r, data);
          count++;
        }
        return { count };
      }),
    },
  };
}

const D = (n: string) => new Prisma.Decimal(n);

describe('syncPriceRowsFromColumns', () => {
  it('update แถว isDefault เดิม + relabel เป็น "ราคาเงินสด" (ไม่ create ซ้อน)', async () => {
    const tx = makeTx([{ id: 'r1', label: 'ราคาขาย', amount: D('17000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { cashPrice: D('18000') });
    expect(tx.productPrice.create).not.toHaveBeenCalled();
    expect(tx.state).toHaveLength(1);
    expect(tx.state[0]).toMatchObject({ id: 'r1', label: CASH_LABEL, isDefault: true });
    expect(tx.state[0].amount.toString()).toBe('18000');
  });

  it('ไม่ relabel แถว isDefault ที่เป็นราคาผ่อน — สร้างแถวเงินสดแยก', async () => {
    const tx = makeTx([{ id: 'r1', label: INSTALLMENT_LABEL, amount: D('20000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { cashPrice: D('18000') });
    expect(tx.state).toHaveLength(2);
    const cash = tx.state.find((r) => r.label === CASH_LABEL)!;
    const inst = tx.state.find((r) => r.label === INSTALLMENT_LABEL)!;
    expect(cash.isDefault).toBe(true);
    expect(inst.isDefault).toBe(false);
    expect(inst.amount.toString()).toBe('20000'); // ของเดิมไม่ถูกทับ
  });

  it('upsert แถว "ราคาผ่อน BESTCHOICE" จาก installmentPrice', async () => {
    const tx = makeTx([{ id: 'r1', label: CASH_LABEL, amount: D('18000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { installmentPrice: D('20000') });
    const inst = tx.state.find((r) => r.label === INSTALLMENT_LABEL)!;
    expect(inst.amount.toString()).toBe('20000');
    expect(inst.isDefault).toBe(false);
  });

  it('เขียนทั้งสองราคาพร้อมกัน → เหลือ isDefault แถวเดียว (แถวเงินสด)', async () => {
    const tx = makeTx([]);
    await syncPriceRowsFromColumns(tx as any, 'p1', {
      cashPrice: D('18000'),
      installmentPrice: D('20000'),
    });
    expect(tx.state.filter((r) => r.isDefault)).toHaveLength(1);
    expect(tx.state.find((r) => r.isDefault)!.label).toBe(CASH_LABEL);
  });

  it('มีแต่ราคาผ่อนและยังไม่มี default เลย → แถวผ่อนกลายเป็น default', async () => {
    const tx = makeTx([]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { installmentPrice: D('20000') });
    expect(tx.state.filter((r) => r.isDefault)).toHaveLength(1);
    expect(tx.state.find((r) => r.isDefault)!.label).toBe(INSTALLMENT_LABEL);
  });

  it('ไม่ส่งราคามาเลย → ไม่แตะอะไร', async () => {
    const tx = makeTx([{ id: 'r1', label: 'ราคาขาย', amount: D('17000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', {});
    expect(tx.productPrice.update).not.toHaveBeenCalled();
    expect(tx.productPrice.create).not.toHaveBeenCalled();
    expect(tx.state[0].label).toBe('ราคาขาย');
  });

  it('null = ไม่ sync ฟิลด์นั้น และไม่ลบแถวเดิม', async () => {
    const tx = makeTx([{ id: 'r1', label: CASH_LABEL, amount: D('18000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { cashPrice: null, installmentPrice: null });
    expect(tx.state).toHaveLength(1);
    expect(tx.state[0].amount.toString()).toBe('18000');
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/utils/product-price-sync.util.spec.ts`
- [ ] **Step 3:** implement — `apps/api/src/utils/product-price-sync.util.ts`:

```ts
import { Prisma } from '@prisma/client';

export const CASH_LABEL = 'ราคาเงินสด';
export const INSTALLMENT_LABEL = 'ราคาผ่อน BESTCHOICE';
const INSTALLMENT_PREFIX = 'ราคาผ่อน';

/**
 * B0 §2.1 — write-through ทางเดียว: คอลัมน์ราคา → แถว ProductPrice
 *
 * ผู้อ่าน prices[] ที่ยัง load-bearing: POS, เครื่องคิดเงินสัญญา, stock-overview
 * margin, บอท (`where:{isDefault:true} take:1` **ไม่มี orderBy**) — จึงต้องรับประกัน
 * ว่าหลังเขียนเสร็จมีแถว isDefault **แถวเดียว** เสมอ ไม่งั้น take:1 ได้แถวสุ่ม
 *
 * ต้องเรียกภายใน tx ของ caller เท่านั้น (atomic กับการเขียนคอลัมน์)
 */
export async function syncPriceRowsFromColumns(
  tx: Prisma.TransactionClient,
  productId: string,
  columns: { cashPrice?: Prisma.Decimal | null; installmentPrice?: Prisma.Decimal | null },
): Promise<{ cashRowId: string | null; installmentRowId: string | null }> {
  const hasCash = columns.cashPrice !== undefined && columns.cashPrice !== null;
  const hasInstallment =
    columns.installmentPrice !== undefined && columns.installmentPrice !== null;
  if (!hasCash && !hasInstallment) return { cashRowId: null, installmentRowId: null };

  const rows = await tx.productPrice.findMany({
    where: { productId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  let cashRowId: string | null = null;
  let installmentRowId: string | null = null;

  if (hasCash) {
    const amount = columns.cashPrice as Prisma.Decimal;
    const exact = rows.find((r) => r.label === CASH_LABEL);
    const defaultRow = rows.find((r) => r.isDefault && !r.label.startsWith(INSTALLMENT_PREFIX));
    const target = exact ?? defaultRow;
    if (target) {
      await tx.productPrice.update({
        where: { id: target.id },
        data: { amount, label: CASH_LABEL, isDefault: true },
      });
      cashRowId = target.id;
    } else {
      const created = await tx.productPrice.create({
        data: { productId, label: CASH_LABEL, amount, isDefault: true },
      });
      cashRowId = created.id;
    }
  }

  if (hasInstallment) {
    const amount = columns.installmentPrice as Prisma.Decimal;
    const exact = rows.find((r) => r.label === INSTALLMENT_LABEL);
    if (exact) {
      await tx.productPrice.update({ where: { id: exact.id }, data: { amount } });
      installmentRowId = exact.id;
    } else {
      const created = await tx.productPrice.create({
        data: { productId, label: INSTALLMENT_LABEL, amount, isDefault: false },
      });
      installmentRowId = created.id;
    }
  }

  // บังคับ default เดียว: แถวเงินสดชนะ; ถ้าไม่มีเงินสดและยังไม่มี default ใดเลย ใช้แถวผ่อน
  const keepDefaultId =
    cashRowId ??
    (rows.some((r) => r.isDefault) ? null : installmentRowId);

  if (keepDefaultId) {
    await tx.productPrice.updateMany({
      where: { productId, isDefault: true, id: { not: keepDefaultId }, deletedAt: null },
      data: { isDefault: false },
    });
    await tx.productPrice.update({ where: { id: keepDefaultId }, data: { isDefault: true } });
  }

  return { cashRowId, installmentRowId };
}
```

- [ ] **Step 4:** รันให้ผ่าน: `cd apps/api && npx jest src/utils/product-price-sync.util.spec.ts` → คาดหวัง 7/7 ผ่าน
- [ ] **Step 5:** `./tools/check-types.sh api` → 0; `cd apps/api && npx eslint src/utils/product-price-sync.util.ts src/utils/product-price-sync.util.spec.ts` → ไม่มี error ใหม่
- [ ] **Step 6:** Commit: `feat(b0): product-price-sync util — write-through คอลัมน์ราคา → prices[] (default แถวเดียว)`

---

### Task 5: DTO + `ProductsService.create/update` เขียนคอลัมน์ราคา/เกรด/ฟิลด์ใหม่

**Files:**
- Modify: `apps/api/src/modules/products/dto/create-product.dto.ts` (บรรทัด 45-46 คือ `costPrice`; เพิ่มต่อจากนั้น)
- Modify: `apps/api/src/modules/products/dto/update-product.dto.ts` (บรรทัด 36-38 คือ `costPrice`; เพิ่มต่อจากนั้น)
- Modify: `apps/api/src/modules/products/products.service.ts` (`create` :79-103, `update` :105-118)
- Create: `apps/api/src/modules/products/products-price-columns.service.spec.ts`

**Interfaces:**
- Consumes: `syncPriceRowsFromColumns(tx, productId, columns)` (Task 4)
- Produces: `CreateProductDto`/`UpdateProductDto` +`cashPrice?: number`, `installmentPrice?: number`, `conditionGrade?: string` (จำกัดค่าด้วย `@IsIn(['A','B','C','D'])` — **ไม่ใช่ union type** เพราะ Prisma `Product.conditionGrade` เป็น `String?` ไม่ใช่ enum, schema:1700), `shopWarrantyDays?: number`, `accessoriesIncluded?: Record<string, unknown>`, `cosmeticNotes?: string`
- `products.service.ts` มี dep เดียว (`constructor(private prisma: PrismaService)` :25) → spec ใหม่ provide แค่ `PrismaService` พอ
- **สิทธิ์:** `POST /products` + `PATCH /products/:id` เป็น `@Roles('OWNER','BRANCH_MANAGER')` อยู่แล้ว (`products.controller.ts:150,156`) → ไม่ต้องแก้ controller
- **ลำดับใน tx ที่ตั้งใจ:** `tx.product.create` สร้างแถว `dto.prices[]` (nested create) ก่อน → `syncPriceRowsFromColumns` ค่อย `findMany` เห็นแถวพวกนั้น → ถ้าผู้เรียกส่งทั้ง `prices[]` และ `cashPrice` มาพร้อมกัน แถว `isDefault` ที่ผู้เรียกส่งมา (label อะไรก็ตามที่ไม่ขึ้นต้น 'ราคาผ่อน') **จะถูก relabel เป็น 'ราคาเงินสด' + ทับ amount ด้วยค่าคอลัมน์** — นี่คือพฤติกรรมที่ต้องการ (คอลัมน์ = แหล่งจริง spec §2.1) แต่ต้องระบุใน PR description เพราะเป็น surprise ได้สำหรับ integration ที่ส่งทั้งสองอย่าง

- [ ] **Step 1:** เพิ่มฟิลด์ใน `create-product.dto.ts` — แทรกต่อจาก `costPrice` (บรรทัด 46):

```ts
  /** B0: ราคาเงินสดต่อเครื่อง — แหล่งราคาจริง (เขียน prices[] ให้อัตโนมัติ) */
  @IsNumber({}, { message: 'ราคาเงินสดต้องเป็นตัวเลข' })
  @Min(0, { message: 'ราคาเงินสดต้องไม่ติดลบ' })
  @IsOptional()
  cashPrice?: number;

  /** B0: ราคาตั้งต้นสำหรับคำนวณผ่อน (ยอดเต็ม ไม่ใช่ค่างวด) */
  @IsNumber({}, { message: 'ราคาผ่อนต้องเป็นตัวเลข' })
  @Min(0, { message: 'ราคาผ่อนต้องไม่ติดลบ' })
  @IsOptional()
  installmentPrice?: number;

  @IsIn(['A', 'B', 'C', 'D'], { message: 'เกรดเครื่องต้องเป็น A, B, C หรือ D' })
  @IsOptional()
  conditionGrade?: string;

  @IsInt({ message: 'จำนวนวันประกันร้านต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'จำนวนวันประกันร้านต้องไม่ติดลบ' })
  @IsOptional()
  shopWarrantyDays?: number;

  @IsObject({ message: 'อุปกรณ์ที่แถมต้องเป็นอ็อบเจกต์' })
  @IsOptional()
  accessoriesIncluded?: Record<string, unknown>;

  @IsString()
  @MaxLength(500, { message: 'ตำหนิ/สภาพภายนอกยาวเกิน 500 ตัวอักษร' })
  @IsOptional()
  cosmeticNotes?: string;
```

  และแก้ import บรรทัด 1 เป็น:

```ts
import { IsString, IsOptional, IsNumber, IsIn, IsArray, ValidateNested, IsBoolean, IsInt, IsObject, Min, MaxLength } from 'class-validator';
```

- [ ] **Step 2:** เพิ่มฟิลด์ชุดเดียวกันใน `update-product.dto.ts` (แทรกต่อจาก `costPrice` บรรทัด 38) + แก้ import บรรทัด 1 เป็น:

```ts
import { IsString, IsOptional, IsNumber, IsArray, IsBoolean, IsIn, IsInt, IsObject, Min, MaxLength } from 'class-validator';
```

- [ ] **Step 3:** เขียน spec ที่ล้มก่อน — สร้าง `apps/api/src/modules/products/products-price-columns.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ProductsService — คอลัมน์ราคา (B0)', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(async () => {
    tx = {
      product: {
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', deletedAt: null }),
      },
      productPrice: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'row-1' }),
        update: jest.fn().mockResolvedValue({ id: 'row-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', deletedAt: null }) },
    };
    const module = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProductsService);
  });

  it('create: เขียน cashPrice/installmentPrice เป็น Decimal ลงคอลัมน์', async () => {
    await service.create({
      name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
      costPrice: 15000, branchId: 'b1', cashPrice: 18000, installmentPrice: 20000,
    } as never);
    const data = tx.product.create.mock.calls[0][0].data;
    expect(data.cashPrice).toBeInstanceOf(Prisma.Decimal);
    expect(data.cashPrice.toString()).toBe('18000');
    expect(data.installmentPrice.toString()).toBe('20000');
  });

  it('create: write-through สร้างแถว ProductPrice ให้อัตโนมัติ', async () => {
    await service.create({
      name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
      costPrice: 15000, branchId: 'b1', cashPrice: 18000,
    } as never);
    expect(tx.productPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ label: 'ราคาเงินสด', isDefault: true }),
      }),
    );
  });

  it('update: แก้ราคามือ → เคลียร์ priceAutofilledAt เป็น null', async () => {
    await service.update('p1', { cashPrice: 19000 } as never);
    const data = tx.product.update.mock.calls[0][0].data;
    expect(data.priceAutofilledAt).toBeNull();
    expect(data.cashPrice.toString()).toBe('19000');
  });

  it('update: ไม่แตะราคา → ไม่เคลียร์ priceAutofilledAt', async () => {
    await service.update('p1', { cosmeticNotes: 'มีรอยขอบล่าง' } as never);
    const data = tx.product.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('priceAutofilledAt');
    expect(tx.productPrice.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/products/products-price-columns.service.spec.ts`
- [ ] **Step 5:** implement — แทน `create` (บรรทัด 79-103) และ `update` (บรรทัด 105-118) ใน `products.service.ts` ด้วย:

```ts
  async create(dto: CreateProductDto) {
    const { prices, costPrice, warrantyExpireDate, cashPrice, installmentPrice, ...data } = dto;

    const isInStock = !data.status || data.status === 'IN_STOCK';
    const cashDecimal = cashPrice !== undefined ? new Prisma.Decimal(cashPrice) : undefined;
    const installmentDecimal =
      installmentPrice !== undefined ? new Prisma.Decimal(installmentPrice) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          ...data,
          costPrice,
          ...(cashDecimal !== undefined ? { cashPrice: cashDecimal } : {}),
          ...(installmentDecimal !== undefined ? { installmentPrice: installmentDecimal } : {}),
          warrantyExpireDate: warrantyExpireDate ? new Date(warrantyExpireDate) : null,
          ...(isInStock ? { stockInDate: new Date() } : {}),
          ...(prices && prices.length > 0
            ? {
                prices: {
                  create: prices.map((p, i) => ({
                    label: p.label,
                    amount: p.amount,
                    isDefault: p.isDefault ?? (i === 0),
                  })),
                },
              }
            : {}),
        } as Prisma.ProductUncheckedCreateInput,
      });

      // B0 §2.1: write-through คอลัมน์ → prices[] (ผู้อ่านเดิม POS/สัญญา/บอท ไม่พัง)
      await syncPriceRowsFromColumns(tx, product.id, {
        cashPrice: cashDecimal ?? null,
        installmentPrice: installmentDecimal ?? null,
      });

      return tx.product.findUnique({ where: { id: product.id }, include: productInclude });
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    const { costPrice, warrantyExpireDate, cashPrice, installmentPrice, ...data } = dto;
    const touchesPrice = cashPrice !== undefined || installmentPrice !== undefined;
    const cashDecimal = cashPrice !== undefined ? new Prisma.Decimal(cashPrice) : undefined;
    const installmentDecimal =
      installmentPrice !== undefined ? new Prisma.Decimal(installmentPrice) : undefined;

    return this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...data,
          ...(costPrice !== undefined ? { costPrice } : {}),
          ...(cashDecimal !== undefined ? { cashPrice: cashDecimal } : {}),
          ...(installmentDecimal !== undefined ? { installmentPrice: installmentDecimal } : {}),
          // แก้ราคามือ = เลิกเป็นราคาที่เติมอัตโนมัติ (badge ฝั่ง B1 อ่านฟิลด์นี้)
          ...(touchesPrice ? { priceAutofilledAt: null } : {}),
          ...(warrantyExpireDate !== undefined
            ? { warrantyExpireDate: warrantyExpireDate ? new Date(warrantyExpireDate) : null }
            : {}),
        } as Prisma.ProductUncheckedUpdateInput,
      });

      if (touchesPrice) {
        await syncPriceRowsFromColumns(tx, id, {
          cashPrice: cashDecimal ?? null,
          installmentPrice: installmentDecimal ?? null,
        });
      }

      return tx.product.findUnique({ where: { id }, include: productInclude });
    });
  }
```

  และเพิ่ม import ที่หัวไฟล์ (ต่อจากบรรทัด 7):

```ts
import { syncPriceRowsFromColumns } from '../../utils/product-price-sync.util';
```

- [ ] **Step 6:** รันให้ผ่าน + spec เดิมไม่พัง: `cd apps/api && npx jest src/modules/products/` → คาดหวัง products-price-columns 4/4 + `products.service.spec.ts` (มีแค่ `describe('ProductsService.transferOwnership')` — ไม่แตะ create/update จึงต้องเขียวโดยไม่ต้องแก้) + `products-online-listing.service.spec.ts` เดิมผ่านทั้งหมด (Task 13 ถึงจะแก้ไฟล์นั้น)
- [ ] **Step 7:** `./tools/check-types.sh api` → 0; `cd apps/api && npx eslint src/modules/products` → ไม่มี error ใหม่
- [ ] **Step 8:** Commit: `feat(b0): DTO + ProductsService เขียนคอลัมน์ราคา/เกรด/อุปกรณ์/ตำหนิ + write-through`

---

### Task 6: Gate ก่อน autofill — survey `PricingTemplate` จริง + SystemConfig semantics

> **Task นี้จบด้วย "คำถามที่ส่งให้ owner" ไม่ใช่โค้ดที่เปลี่ยนพฤติกรรม** — spec §9.1 ระบุว่านี่คือ gate ของ B0 autofill

**Files:**
- Create: `apps/api/scripts/survey-pricing-templates.ts`
- Modify: `apps/api/package.json` (บล็อก `scripts` — เพิ่มถัดจาก `"backfill:user-companies"` บรรทัด 58)

**Interfaces:**
- Consumes: `PrismaClient.pricingTemplate` — **read-only เท่านั้น** (ห้ามมี `update`/`create`/`delete` ในไฟล์นี้)
- Produces: JSON สรุปบน stdout + SystemConfig key ที่ owner จะตั้ง: `pricing_template_installment_semantics` ∈ `PER_MONTH` (default) | `TOTAL`

- [ ] **Step 1:** สร้าง `apps/api/scripts/survey-pricing-templates.ts`:

```ts
/**
 * READ-ONLY survey — B0 gate (spec §9.1)
 *
 * คำถามที่ต้องตอบ: `PricingTemplate.installmentBestchoicePrice` คือ
 *   (ก) ค่างวดต่อเดือน  — sticker/บอทตีความแบบนี้ (StickerPrintPage.tsx:152 render 'X ฿ × N ด.')
 *   (ข) ราคาเต็มสำหรับผ่อน — import help ฝั่ง admin สื่อแบบนี้
 * ตัวชี้: อัตราส่วน installmentBestchoicePrice / cashPrice
 *   ~0.05-0.25  → เกือบแน่ว่าเป็น "ต่อเดือน"
 *   ~1.0-1.6    → เกือบแน่ว่าเป็น "ราคารวม"
 * เช็คซ้ำ: installmentBestchoicePrice × rate1TermMonths + rate1DownPayment ≈ กี่เท่าของ cashPrice
 *
 * รัน: DATABASE_URL=... npm --prefix apps/api run survey:pricing-templates
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.pricingTemplate.findMany({
    where: { deletedAt: null },
    orderBy: [{ brand: 'asc' }, { model: 'asc' }, { storage: 'asc' }],
  });

  const buckets = { perMonthLike: 0, nearCash: 0, totalLike: 0, unusable: 0 };
  const samples: Record<string, unknown>[] = [];

  for (const t of rows) {
    const cash = Number(t.cashPrice);
    const inst = Number(t.installmentBestchoicePrice);
    if (!(cash > 0) || !(inst > 0)) {
      buckets.unusable++;
      continue;
    }
    const ratio = inst / cash;
    if (ratio < 0.5) buckets.perMonthLike++;
    else if (ratio <= 1.05) buckets.nearCash++;
    else buckets.totalLike++;

    if (samples.length < 12) {
      const term = t.rate1TermMonths ?? null;
      const down = t.rate1DownPayment != null ? Number(t.rate1DownPayment) : null;
      samples.push({
        brand: t.brand,
        model: t.model,
        storage: t.storage,
        category: t.category,
        hasWarranty: t.hasWarranty,
        cashPrice: cash,
        installmentBestchoicePrice: inst,
        ratio: Number(ratio.toFixed(4)),
        rate1TermMonths: term,
        rate1DownPayment: down,
        impliedTotalIfPerMonth:
          term != null ? Number((inst * term + (down ?? 0)).toFixed(2)) : null,
        impliedTotalOverCash:
          term != null ? Number(((inst * term + (down ?? 0)) / cash).toFixed(4)) : null,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        totalRows: rows.length,
        activeRows: rows.filter((r) => r.isActive).length,
        buckets,
        verdictHint:
          buckets.perMonthLike > buckets.totalLike
            ? 'ส่วนใหญ่ดูเป็น "ค่างวดต่อเดือน" (PER_MONTH)'
            : 'ส่วนใหญ่ดูเป็น "ราคารวม" (TOTAL)',
        samples,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2:** เพิ่ม npm script ใน `apps/api/package.json` (ต่อจากบรรทัด `"backfill:user-companies": ...`):

```json
    "survey:pricing-templates": "tsx scripts/survey-pricing-templates.ts",
```

- [ ] **Step 3:** รันบน local (seed data) เพื่อพิสูจน์ว่าไม่ crash: `cd apps/api && npm run survey:pricing-templates` → ต้องได้ JSON ที่มีคีย์ `buckets` + `samples` (ถ้า local ไม่มีข้อมูล จะได้ `totalRows: 0` ก็ถือว่าผ่าน)
- [ ] **Step 4:** เขียนคำถาม owner ลง `docs/superpowers/plans/2026-08-04-b0-owner-questions.md` (ไฟล์ใหม่สั้นๆ) ด้วยเนื้อความ:

```markdown
# B0 — คำถามที่ต้องได้คำตอบจากเจ้าของ (gate ของ autofill)

**คำถาม:** ในตารางราคากลาง (`PricingTemplate`) ช่อง `installmentBestchoicePrice`
พี่กรอกเป็น **"ค่างวดต่อเดือน"** หรือ **"ราคาเต็มที่ใช้ตั้งต้นคำนวณผ่อน"** ครับ?

**ข้อมูลประกอบ:** รันคำสั่งนี้บน prod (read-only) แล้วส่งผลให้ผมดู
`DATABASE_URL=<prod> npm --prefix apps/api run survey:pricing-templates`

**ผลของคำตอบ:**
- ตอบ "ต่อเดือน" → ตั้ง SystemConfig `pricing_template_installment_semantics = 'PER_MONTH'`
  (ค่าเริ่มต้นในโค้ด) → autofill เติมเฉพาะ **ราคาเงินสด** ราคาผ่อนต้องกรอกเอง
- ตอบ "ราคารวม" → ตั้งเป็น `'TOTAL'` → autofill เติม **ทั้งราคาเงินสดและราคาผ่อน**

ตั้งค่าได้ด้วย SQL:
`INSERT INTO system_config (id, key, value, label) VALUES (gen_random_uuid(), 'pricing_template_installment_semantics', 'TOTAL', 'ความหมายช่องราคาผ่อนในตารางราคากลาง') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`
```

- [ ] **Step 5:** **ไม่ต้อง lint/tsc ไฟล์นี้** — ยืนยันแล้วว่า `apps/api/scripts/` อยู่นอก `include` ของ `tsconfig.json` → `npx eslint scripts/survey-pricing-templates.ts` จะตอบ `Parsing error: "parserOptions.project" ... file was not found in any of the provided project(s)` (ไฟล์ `scripts/*.ts` เดิมทุกไฟล์ก็เป็นแบบเดียวกัน) และ `npx tsc --noEmit` ไม่แตะมัน. gate เดียวคือ Step 3 (รันจริงแล้วได้ JSON)
- [ ] **Step 6:** Commit: `feat(b0): survey script ตารางราคากลาง (read-only) + คำถาม gate ให้เจ้าของ`

---

### Task 7: `product-price-autofill.util.ts` + hook 3 ทางเข้า

**Files:**
- Create: `apps/api/src/utils/product-price-autofill.util.ts`
- Create: `apps/api/src/utils/product-price-autofill.util.spec.ts`
- Modify: `apps/api/src/modules/products/products.service.ts` (`create` — หลัง `tx.product.create`)
- Modify: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` (บรรทัด 197-207)
- Modify: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts` (หลังบรรทัด 436)

**Interfaces:**
- Consumes: `normalizeStorage` (Task 3), `syncPriceRowsFromColumns` (Task 4), `readStringFlag(prisma, key, fallback)` จาก `apps/api/src/utils/config.util.ts:113` — param type คือ `SystemConfigReader` (`config.util.ts:15`, ไม่ export แต่ `Prisma.TransactionClient` assignable ตรงๆ **ไม่ต้อง cast**); อ่านผ่าน `systemConfig.findFirst({ where:{key, deletedAt:null}, select:{value:true} })` และ swallow error → mock ใน spec ต้องเป็น `systemConfig.findFirst`
- Consumes: `PricingTemplate` (schema:1775) — ฟิลด์ที่ใช้: `brand/model/storage(String, default "")/category/hasWarranty/cashPrice/installmentBestchoicePrice/isActive/deletedAt`
- Produces:
```ts
export type TemplateInstallmentSemantics = 'PER_MONTH' | 'TOTAL';
export const SEMANTICS_CONFIG_KEY = 'pricing_template_installment_semantics';

export interface AutofillResult {
  filled: boolean;
  reason: 'FILLED' | 'ALREADY_PRICED' | 'NO_TEMPLATE' | 'AMBIGUOUS_WARRANTY' | 'ZERO_PRICE';
  templateId?: string;
  cashPrice?: Prisma.Decimal;
  installmentPrice?: Prisma.Decimal;
}

export async function autofillProductPriceFromTemplate(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    brand: string;
    model: string;
    storage: string | null;
    category: ProductCategory;
    /** null = ไม่รู้ว่ามีประกันไหม → ถ้าเทมเพลตมีทั้ง 2 แบบให้ข้าม */
    hasWarranty: boolean | null;
    currentCashPrice: Prisma.Decimal | null;
  },
  logger?: { warn: (m: string) => void; log: (m: string) => void },
): Promise<AutofillResult>;
```

**ทำไม hook แค่ 3 จุด ทั้งที่ spec §2.1 ลิสต์ 5 (ตรวจโค้ดแล้ว — ไม่ใช่ของตกหล่น):**
- **buyback ใช้ทางเดียวกับ trade-in** — ทั้ง `flow === 'EXCHANGE'` (เทิร์น) และ BUYBACK/รับซื้อ ลง `TradeInLifecycleService.accept()` → `tx.product.create` จุดเดียว (:417-436) → hook #3 ครอบทั้งคู่
- **direct-receive ไม่ต้อง hook แยก** — `directReceive` (:294) delegate เข้า `runReceiveInTx` (:385) → hook #2 ครอบให้แล้ว
- **repossession refurb ไม่ต้อง autofill** — `markReadyForSale` บังคับ `resellPrice > 0` ตั้งแต่ :683-685 (throw ถ้าไม่มี) → มีราคาเสมอ, autofill จะออกที่ `ALREADY_PRICED` ทันที; Task 8 จึงเขียนคอลัมน์ตรงๆ พอ

**อัลกอริทึม (ต้องตรงเป๊ะ):**
1. `currentCashPrice != null && > 0` → `ALREADY_PRICED` (ราคาที่กรอกมือ/PO ชนะเสมอ)
2. `tx.pricingTemplate.findMany({ where: { isActive: true, deletedAt: null, category, brand: {equals, mode:'insensitive'}, model: {equals, mode:'insensitive'} } })`
3. เลือกตามความจุ: match `normalizeStorage(row.storage) === normalizeStorage(input.storage)` ก่อน → ถ้าไม่เจอ ใช้แถว `storage === ''` (fallback แบบเดียวกับ `PricingTemplatesService.lookup:45-57`)
4. เลือกตามประกัน: `category !== 'PHONE_USED'` → เอาแถว `hasWarranty === false`; `PHONE_USED` + `hasWarranty` ระบุมา → filter ตามนั้น; `PHONE_USED` + `null` → เหลือ 1 แถวใช้เลย, เหลือ >1 แถว → `AMBIGUOUS_WARRANTY` + log (ไม่เขียนอะไร)
5. ไม่เหลือแถว → `NO_TEMPLATE`; `cashPrice <= 0` → `ZERO_PRICE`
6. `semantics = await readStringFlag(tx, SEMANTICS_CONFIG_KEY, 'PER_MONTH')` — เขียน `installmentPrice` **เฉพาะเมื่อ `TOTAL`**
7. `tx.product.update({ cashPrice, [installmentPrice], priceAutofilledAt: new Date() })` แล้วเรียก `syncPriceRowsFromColumns`

- [ ] **Step 1:** เขียน spec ที่ล้มก่อน — `apps/api/src/utils/product-price-autofill.util.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { autofillProductPriceFromTemplate } from './product-price-autofill.util';

const D = (n: string) => new Prisma.Decimal(n);

const TPL = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  cashPrice: D('28900'),
  installmentBestchoicePrice: D('2500'),
  ...over,
});

function makeTx(templates: unknown[], semantics: string | null = null) {
  return {
    pricingTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
    product: { update: jest.fn().mockResolvedValue({ id: 'p1' }) },
    productPrice: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'row-1' }),
      update: jest.fn().mockResolvedValue({ id: 'row-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    systemConfig: {
      findFirst: jest.fn().mockResolvedValue(semantics ? { value: semantics } : null),
    },
  };
}

const BASE = {
  productId: 'p1',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128 GB',
  category: 'PHONE_NEW' as const,
  hasWarranty: null,
  currentCashPrice: null,
};

describe('autofillProductPriceFromTemplate', () => {
  it('มีราคาอยู่แล้ว → ไม่ทับ', async () => {
    const tx = makeTx([TPL()]);
    const r = await autofillProductPriceFromTemplate(tx as never, {
      ...BASE,
      currentCashPrice: D('27000'),
    });
    expect(r).toEqual({ filled: false, reason: 'ALREADY_PRICED' });
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('normalize ความจุ "128 GB" ↔ "128GB" แล้วเติม cashPrice', async () => {
    const tx = makeTx([TPL()]);
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r.filled).toBe(true);
    expect(r.reason).toBe('FILLED');
    const data = tx.product.update.mock.calls[0][0].data;
    expect(data.cashPrice.toString()).toBe('28900');
    expect(data.priceAutofilledAt).toBeInstanceOf(Date);
  });

  it('semantics PER_MONTH (default) → ไม่เติม installmentPrice', async () => {
    const tx = makeTx([TPL()]);
    await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(tx.product.update.mock.calls[0][0].data).not.toHaveProperty('installmentPrice');
  });

  it('semantics TOTAL → เติม installmentPrice ด้วย', async () => {
    const tx = makeTx([TPL({ installmentBestchoicePrice: D('31900') })], 'TOTAL');
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r.installmentPrice?.toString()).toBe('31900');
    expect(tx.product.update.mock.calls[0][0].data.installmentPrice.toString()).toBe('31900');
  });

  it('ไม่มีแถวความจุตรง → ใช้แถว storage ว่าง (fallback)', async () => {
    const tx = makeTx([TPL({ storage: '', cashPrice: D('27500') })]);
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r.cashPrice?.toString()).toBe('27500');
  });

  it('PHONE_USED + ไม่รู้ประกัน + มีทั้ง 2 แถว → ข้าม + log', async () => {
    const warn = jest.fn();
    const tx = makeTx([
      TPL({ id: 'a', category: 'PHONE_USED', hasWarranty: false, cashPrice: D('20000') }),
      TPL({ id: 'b', category: 'PHONE_USED', hasWarranty: true, cashPrice: D('22000') }),
    ]);
    const r = await autofillProductPriceFromTemplate(
      tx as never,
      { ...BASE, category: 'PHONE_USED', hasWarranty: null },
      { warn, log: jest.fn() },
    );
    expect(r).toEqual({ filled: false, reason: 'AMBIGUOUS_WARRANTY' });
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('PHONE_USED + ไม่รู้ประกัน + มีแถวเดียว → ใช้แถวนั้นได้', async () => {
    const tx = makeTx([TPL({ category: 'PHONE_USED', hasWarranty: true, cashPrice: D('22000') })]);
    const r = await autofillProductPriceFromTemplate(tx as never, {
      ...BASE,
      category: 'PHONE_USED',
      hasWarranty: null,
    });
    expect(r.cashPrice?.toString()).toBe('22000');
  });

  it('ไม่มีเทมเพลตเลย → NO_TEMPLATE', async () => {
    const tx = makeTx([]);
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r).toEqual({ filled: false, reason: 'NO_TEMPLATE' });
  });

  it('เทมเพลตราคา 0 → ZERO_PRICE ไม่เขียน', async () => {
    const tx = makeTx([TPL({ cashPrice: D('0') })]);
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r).toEqual({ filled: false, reason: 'ZERO_PRICE' });
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('เติมสำเร็จ → write-through สร้างแถว ProductPrice ด้วย', async () => {
    const tx = makeTx([TPL()]);
    await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(tx.productPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ label: 'ราคาเงินสด' }) }),
    );
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/utils/product-price-autofill.util.spec.ts`
- [ ] **Step 3:** implement — `apps/api/src/utils/product-price-autofill.util.ts`:

```ts
import { Prisma, ProductCategory } from '@prisma/client';
import { normalizeStorage } from './device-query-normalize.util';
import { syncPriceRowsFromColumns } from './product-price-sync.util';
import { readStringFlag } from './config.util';

export type TemplateInstallmentSemantics = 'PER_MONTH' | 'TOTAL';
export const SEMANTICS_CONFIG_KEY = 'pricing_template_installment_semantics';

export interface AutofillResult {
  filled: boolean;
  reason: 'FILLED' | 'ALREADY_PRICED' | 'NO_TEMPLATE' | 'AMBIGUOUS_WARRANTY' | 'ZERO_PRICE';
  templateId?: string;
  cashPrice?: Prisma.Decimal;
  installmentPrice?: Prisma.Decimal;
}

export interface AutofillInput {
  productId: string;
  brand: string;
  model: string;
  storage: string | null;
  category: ProductCategory;
  /** null = ไม่รู้สถานะประกันของเครื่อง (เช่น เทิร์นเข้ามา) */
  hasWarranty: boolean | null;
  currentCashPrice: Prisma.Decimal | null;
}

/**
 * B0 §2.1 — เติมราคาตั้งต้นจากตารางราคากลางตอนสร้าง Product
 *
 * เงื่อนไข: เติมเฉพาะเมื่อยังไม่มี cashPrice (ราคาที่คนกรอกชนะเสมอ),
 * normalize ความจุ null↔''↔'128 GB', เลือกแถว hasWarranty แบบ deterministic
 * (กำกวม = ข้าม + log ไม่เดา), stamp priceAutofilledAt เพื่อให้ UI ติดป้ายได้
 *
 * ต้องเรียกภายใน tx ของ caller
 */
export async function autofillProductPriceFromTemplate(
  tx: Prisma.TransactionClient,
  input: AutofillInput,
  logger?: { warn: (m: string) => void; log: (m: string) => void },
): Promise<AutofillResult> {
  if (input.currentCashPrice != null && input.currentCashPrice.greaterThan(0)) {
    return { filled: false, reason: 'ALREADY_PRICED' };
  }

  const rows = await tx.pricingTemplate.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      category: input.category,
      brand: { equals: input.brand, mode: 'insensitive' },
      model: { equals: input.model, mode: 'insensitive' },
    },
  });
  if (rows.length === 0) return { filled: false, reason: 'NO_TEMPLATE' };

  // 1) ความจุ: ตรงก่อน แล้วค่อย fallback แถว storage ว่าง
  const wanted = normalizeStorage(input.storage);
  let candidates = rows.filter((r) => normalizeStorage(r.storage) === wanted);
  if (candidates.length === 0) candidates = rows.filter((r) => normalizeStorage(r.storage) === '');
  if (candidates.length === 0) return { filled: false, reason: 'NO_TEMPLATE' };

  // 2) ประกัน: deterministic เท่านั้น
  if (input.category !== 'PHONE_USED') {
    const noWarranty = candidates.filter((r) => r.hasWarranty === false);
    if (noWarranty.length > 0) candidates = noWarranty;
  } else if (input.hasWarranty !== null) {
    candidates = candidates.filter((r) => r.hasWarranty === input.hasWarranty);
  } else if (candidates.length > 1) {
    logger?.warn(
      `[autofill] ข้ามการเติมราคา product=${input.productId} — ไม่รู้สถานะประกันและตารางราคากลางมีทั้งมี/ไม่มีประกัน (${input.brand} ${input.model} ${wanted || 'ไม่ระบุความจุ'})`,
    );
    return { filled: false, reason: 'AMBIGUOUS_WARRANTY' };
  }
  if (candidates.length === 0) return { filled: false, reason: 'NO_TEMPLATE' };

  const template = candidates[0];
  const cashPrice = new Prisma.Decimal(template.cashPrice.toString());
  if (!cashPrice.greaterThan(0)) return { filled: false, reason: 'ZERO_PRICE' };

  // 3) ความหมายของ installmentBestchoicePrice — gate ของ owner (spec §9.1)
  // readStringFlag รับ Prisma.TransactionClient ได้ตรงๆ ไม่ต้อง cast —
  // precedent: expense-document-lifecycle.service.ts:866-872 ส่ง tx เข้าไปแบบเดียวกัน
  const semantics = (await readStringFlag(
    tx,
    SEMANTICS_CONFIG_KEY,
    'PER_MONTH',
  )) as TemplateInstallmentSemantics;
  const installmentPrice =
    semantics === 'TOTAL'
      ? new Prisma.Decimal(template.installmentBestchoicePrice.toString())
      : undefined;
  if (semantics !== 'TOTAL') {
    logger?.log(
      `[autofill] product=${input.productId} เติมเฉพาะราคาเงินสด (semantics=${semantics}) — ราคาผ่อนต้องกรอกเอง`,
    );
  }

  await tx.product.update({
    where: { id: input.productId },
    data: {
      cashPrice,
      ...(installmentPrice ? { installmentPrice } : {}),
      priceAutofilledAt: new Date(),
    },
  });

  await syncPriceRowsFromColumns(tx, input.productId, {
    cashPrice,
    installmentPrice: installmentPrice ?? null,
  });

  return { filled: true, reason: 'FILLED', templateId: template.id, cashPrice, installmentPrice };
}
```

- [ ] **Step 4:** รันให้ผ่าน: `cd apps/api && npx jest src/utils/product-price-autofill.util.spec.ts` → คาดหวัง 10/10 ผ่าน
- [ ] **Step 5:** hook #1 — `products.service.ts` `create`: แทรกก่อนบรรทัด `await syncPriceRowsFromColumns(...)` ใน tx:

```ts
      // B0 §2.1: ไม่ได้กรอกราคาเงินสดมา → ลองเติมจากตารางราคากลาง
      if (cashDecimal === undefined) {
        await autofillProductPriceFromTemplate(
          tx,
          {
            productId: product.id,
            brand: product.brand,
            model: product.model,
            storage: product.storage,
            category: product.category,
            hasWarranty: resolveHasWarranty(product),
            currentCashPrice: null,
          },
          this.logger,
        );
      }
```

  พร้อมเพิ่ม helper ท้ายไฟล์ `products.service.ts` (นอกคลาส) + import:

```ts
/** สรุปสถานะประกันของเครื่องสำหรับเลือกแถวตารางราคากลาง — null = ไม่รู้ */
function resolveHasWarranty(p: {
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
```
```ts
import { autofillProductPriceFromTemplate } from '../../utils/product-price-autofill.util';
```

- [ ] **Step 6:** hook #2 — `po-receiving.service.ts` แทนบล็อกบรรทัด 197-207 (`// Create selling price if provided` … `}`) ด้วย:

```ts
        // B0 §2.1: ราคาขายที่กรอกตอนรับเข้า = ราคาเงินสดของเครื่อง (คอลัมน์คือแหล่งจริง)
        if (item.sellingPrice && item.sellingPrice > 0) {
          const cashPrice = new Prisma.Decimal(item.sellingPrice);
          await tx.product.update({ where: { id: product.id }, data: { cashPrice } });
          await syncPriceRowsFromColumns(tx, product.id, { cashPrice });
        } else {
          // ไม่ได้กรอกราคา → เติมจากตารางราคากลาง (ครอบ direct-receive ที่ delegate เข้ามาที่นี่)
          await autofillProductPriceFromTemplate(tx, {
            productId: product.id,
            brand: product.brand,
            model: product.model,
            storage: product.storage,
            category: product.category,
            hasWarranty:
              productCategory !== 'PHONE_USED'
                ? false
                : item.warrantyExpired === true
                  ? false
                  : item.warrantyExpired === false
                    ? true
                    : null,
            currentCashPrice: null,
          });
        }
```

  + import ที่หัวไฟล์ (ต่อจากบรรทัด 6):

```ts
import { syncPriceRowsFromColumns } from '../../../utils/product-price-sync.util';
import { autofillProductPriceFromTemplate } from '../../../utils/product-price-autofill.util';
```

- [ ] **Step 7:** hook #3 — `trade-in-lifecycle.service.ts` แทรกหลังบรรทัด 436 (`});` ปิด `tx.product.create`):

```ts
      // B0 §2.1: เครื่องเทิร์น/รับซื้อยังไม่มีราคาขาย — เติมจากตารางราคากลาง (มือสอง)
      // สถานะประกันของเครื่องเทิร์นไม่มีข้อมูล → ส่ง null (util จะข้ามถ้าเทมเพลตกำกวม)
      await autofillProductPriceFromTemplate(tx, {
        productId: product.id,
        brand: product.brand,
        model: product.model,
        storage: product.storage,
        category: 'PHONE_USED',
        hasWarranty: null,
        currentCashPrice: null,
      });
```

  + import ที่หัวไฟล์:

```ts
import { autofillProductPriceFromTemplate } from '../../../utils/product-price-autofill.util';
```

- [ ] **Step 8:** **เติม mock ที่ spec เดิมขาด (บังคับ — ตรวจกับโค้ดจริงแล้วว่าจะแดงแน่นอน ห้ามถอด hook ออกแทน):**

  a) `apps/api/src/modules/purchase-orders/purchase-orders.service.spec.ts` — tx mock (บรรทัด ~21-43 และ tx ตัวที่สองใน `describe('goodsReceiving — IMEI duplicate guard')` ~68-79). `passUnits()` ไม่มี `sellingPrice` → เดิน**สาย else (autofill)**:

```ts
      product: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `prod-${Math.random()}`, ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),          // ← เพิ่ม
      },
      productPrice: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),         // ← เพิ่ม
        update: jest.fn().mockResolvedValue({}),           // ← เพิ่ม
        updateMany: jest.fn().mockResolvedValue({ count: 0 }), // ← เพิ่ม
      },
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },   // ← เพิ่ม (ไม่มี → TypeError)
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },   // ← เพิ่ม
```

  b) `apps/api/src/modules/purchase-orders/purchase-orders.direct-receive.spec.ts` — `makeTx()` (บรรทัด ~46-51) เติมชุดเดียวกัน. dto มี `sellingPrice: 39900` → เดิน**สาย if** ซึ่งเรียก `tx.product.update` + `syncPriceRowsFromColumns` → ถ้าไม่เติม `product.update` / `productPrice.findMany` จะ TypeError. เคส `creates an isDirectReceive PO…` assert `created.product[0]` จาก `product.create` เท่านั้น จึงยังเขียว; **ถ้าจะเพิ่ม assertion ให้ตรวจว่า `created.price` มี label `'ราคาเงินสด'` แทน `'ราคาขาย'`**

  c) `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts` — `makeTx()` (บรรทัด 11-22) เติม `pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) }` (คืน `[]` → autofill ออกที่ `NO_TEMPLATE` ก่อนแตะ `product.update`/`systemConfig` จึงพอแค่ตัวเดียว)

- [ ] **Step 9:** รัน spec ที่เกี่ยวข้องทั้งหมดให้เขียว:

```bash
cd apps/api && npx jest src/utils src/modules/products src/modules/purchase-orders src/modules/trade-in
```
  → คาดหวัง: ทุก suite ผ่าน

- [ ] **Step 10:** `./tools/check-types.sh api` → 0; `cd apps/api && npx eslint src/utils src/modules/products src/modules/purchase-orders src/modules/trade-in` → ไม่มี error ใหม่
- [ ] **Step 11:** Commit: `feat(b0): autofill ราคาจากตารางราคากลาง 3 ทางเข้า (products.create / PO receive / trade-in accept)`

---

### Task 8: Redirect writer เดิม — ยึดเครื่อง refurb เขียนคอลัมน์

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts` (บรรทัด 708-726 เท่านั้น)
- Modify: `apps/api/src/modules/repossessions/repossessions.service.spec.ts` (เพิ่ม 1 เคส)

**Interfaces:**
- Consumes: `syncPriceRowsFromColumns` (Task 4)
- Produces: `markReadyForSale(id, resellPrice)` เขียน `Product.cashPrice = resellPrice` แล้วให้ util สร้าง/อัปเดตแถว `'ราคาเงินสด'` (แทน label เดิม `'ราคาขายต่อ (Refurbished)'` ที่ทำให้ผู้อ่านทุกตัวต้องรู้ label พิเศษ — grep ยืนยันแล้วว่า label นี้ถูกเขียนที่ `:715` และ `:721` เท่านั้น ไม่มีผู้อ่านไหน match ชื่อมันตรงๆ)
- **Red line:** ไฟล์นี้มี JP5 (`create()`) — **แก้เฉพาะบรรทัด 708-726**; ห้ามแตะบล็อก `costPrice`/`status: 'REFURBISHED'` ที่ 694-707 และห้ามแตะ `create()`; ไม่มี JE ใดถูกแก้
- **กลไกที่ต้องรู้ก่อนเขียนเทสต์:** `markReadyForSale` เรียก `this.findOne(id)` ซึ่งอ่านผ่าน **`this.prisma.repossession.findUnique`** (`:258-275`) **ไม่ใช่ tx** → mock ต้องอยู่ที่ `prisma` ไม่ใช่ object ที่ส่งเข้า `$transaction`. และ `$transaction` mock ของไฟล์ spec เดิม (`:171-174`) ส่ง **`prisma` ตัวเดียวกัน** เข้าไปเป็น tx อยู่แล้ว → ใช้ของเดิม เติมเฉพาะ delegate ที่ขาด

- [ ] **Step 1:** เพิ่มเคสที่ล้มก่อนใน `repossessions.service.spec.ts` (วางในไฟล์เดิม ท้ายสุดก่อนปิด outer `describe('RepossessionsService')`) — ใช้ mock `prisma` ของ `beforeEach` เดิม (`:127-175`) แล้วเติม delegate ที่ขาด:

```ts
  describe('markReadyForSale — B0 เขียนคอลัมน์ราคา', () => {
    it('set Product.cashPrice = resellPrice และสร้างแถวราคาเงินสด', async () => {
      // findOne() อ่านจาก this.prisma (ไม่ใช่ tx) — mock ที่นี่
      prisma.repossession.findUnique.mockResolvedValue({
        id: 'r1',
        status: 'REPOSSESSED',
        appraisalPrice: null,
        product: { id: 'prod-1', prices: [] },
        deletedAt: null,
      });
      prisma.repossession.update.mockResolvedValue({ id: 'r1', status: 'READY_FOR_SALE' });
      prisma.product.update.mockResolvedValue({ id: 'prod-1' });
      // beforeEach เดิมมีแค่ productPrice.{findFirst,create,update} — util ใช้ findMany + updateMany
      prisma.productPrice.findMany = jest.fn().mockResolvedValue([]);
      prisma.productPrice.updateMany = jest.fn().mockResolvedValue({ count: 0 });
      prisma.productPrice.create.mockResolvedValue({ id: 'row-1' });

      await service.markReadyForSale('r1', 21000);

      // product.update ถูกเรียก 2 ครั้ง: (1) status/costPrice เดิม (2) cashPrice ของ B0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const priceUpdate = prisma.product.update.mock.calls.find(
        (c: any[]) => c[0].data.cashPrice !== undefined,
      );
      expect(priceUpdate).toBeDefined();
      expect(priceUpdate[0].data.cashPrice.toString()).toBe('21000');
      expect(prisma.productPrice.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ label: 'ราคาเงินสด' }) }),
      );
    });
  });
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/repossessions/repossessions.service.spec.ts -t "markReadyForSale"`
- [ ] **Step 3:** แทนบล็อกบรรทัด 708-726 ใน `repossessions.service.ts` ด้วย:

```ts
      // B0 §2.1: ราคาขายต่อ = ราคาเงินสดของเครื่อง (คอลัมน์เป็นแหล่งจริง)
      // write-through สร้าง/อัปเดตแถว ProductPrice ให้เอง — เลิก label เฉพาะกิจ
      // 'ราคาขายต่อ (Refurbished)' ที่ผู้อ่านทุกตัวต้องรู้จักเป็นพิเศษ
      const cashPrice = new Prisma.Decimal(resellPrice);
      await tx.product.update({
        where: { id: repo.product.id },
        data: { cashPrice },
      });
      await syncPriceRowsFromColumns(tx, repo.product.id, { cashPrice });
```

  + import ที่หัวไฟล์:

```ts
import { syncPriceRowsFromColumns } from '../../utils/product-price-sync.util';
```

- [ ] **Step 4:** รันให้ผ่าน + suite เดิมทั้งไฟล์ไม่พัง: `cd apps/api && npx jest src/modules/repossessions/` → คาดหวังเขียวทั้งหมด (โดยเฉพาะเคส JP5 เดิม — ถ้าล้ม แปลว่าเผลอแตะบรรทัดนอกช่วง)
- [ ] **Step 5:** `./tools/check-types.sh api` → 0; `cd apps/api && npx eslint src/modules/repossessions` → ไม่มี error ใหม่
- [ ] **Step 6:** Commit: `feat(b0): ยึดเครื่อง refurb เขียน Product.cashPrice + write-through (เลิก label เฉพาะกิจ)`

---

### Task 9: Backfill script v2 — fallback isDefault ทุก label + log per-label + dry-run

**Files:**
- Modify: `apps/api/scripts/backfill-product-prices.ts` (เขียนทับทั้งไฟล์)
- Modify: `apps/api/package.json` (เพิ่ม npm script)

**Interfaces:**
- Produces: JSON บน stdout — `{ mode, scanned, updated, skipped, bySource: { <label>: n }, samples[] }`
- **พฤติกรรมใหม่:** dry-run เป็น default (`APPLY=true` ถึงจะเขียน); ลำดับหาราคาเงินสด = `'ราคาเงินสด'` → `startsWith('ราคาเงินสด')` → **แถว `isDefault` ไม่ว่า label อะไร** (ครอบ `'ราคาขาย'` จาก PO receive และ `'ราคาขายต่อ (Refurbished)'` จากยึดเครื่อง) → `prices[0]`; ราคาผ่อนคงลำดับเดิม (`'ราคาผ่อน BESTCHOICE'` → `startsWith('ราคาผ่อน')`)
- **ห้ามทับคอลัมน์ที่มีค่าแล้ว** (forward-fix; เครื่องที่ B0 เขียนไว้แล้วต้องไม่ถูก backfill ทับ)

- [ ] **Step 1:** เขียนทับ `apps/api/scripts/backfill-product-prices.ts` ทั้งไฟล์ด้วย:

```ts
/**
 * B0 §2.1 — Backfill Product.cashPrice / installmentPrice จากแถว ProductPrice เดิม
 *
 * ต้องรัน **ใน deploy เดียวกันกับ readiness filter** และรันให้จบก่อนเปิด filter
 * ไม่งั้นเครื่องที่มีราคาอยู่แล้ว (แต่คอลัมน์ยังว่าง) จะหายจากเว็บทั้งกระดาน
 *
 * default = DRY RUN (แค่รายงาน). เขียนจริงต้อง APPLY=true
 * รัน: DATABASE_URL=... [APPLY=true] npm --prefix apps/api run backfill:product-prices
 */
import { PrismaClient, Prisma } from '@prisma/client';

const APPLY = process.env.APPLY === 'true';
const INSTALLMENT_EXACT = 'ราคาผ่อน BESTCHOICE';
const INSTALLMENT_PREFIX = 'ราคาผ่อน';
const CASH_EXACT = 'ราคาเงินสด';

type PriceRow = { label: string; amount: Prisma.Decimal; isDefault: boolean };

function pickInstallment(rows: PriceRow[]): { amount: Prisma.Decimal; source: string } | null {
  const exact = rows.find((r) => r.label === INSTALLMENT_EXACT);
  if (exact) return { amount: exact.amount, source: INSTALLMENT_EXACT };
  const prefix = rows.find((r) => r.label.startsWith(INSTALLMENT_PREFIX));
  if (prefix) return { amount: prefix.amount, source: `prefix:${prefix.label}` };
  return null;
}

function pickCash(rows: PriceRow[]): { amount: Prisma.Decimal; source: string } | null {
  const exact = rows.find((r) => r.label === CASH_EXACT);
  if (exact) return { amount: exact.amount, source: CASH_EXACT };
  const prefix = rows.find((r) => r.label.startsWith(CASH_EXACT));
  if (prefix) return { amount: prefix.amount, source: `prefix:${prefix.label}` };
  // B0: ครอบ default row ทุก label — 'ราคาขาย' (PO receive) /
  // 'ราคาขายต่อ (Refurbished)' (ยึดเครื่อง) / 'ราคาผ่อน' (หน้า create)
  const def = rows.find((r) => r.isDefault);
  if (def) return { amount: def.amount, source: `isDefault:${def.label}` };
  if (rows.length > 0) return { amount: rows[0].amount, source: `first:${rows[0].label}` };
  return null;
}

async function main() {
  const prisma = new PrismaClient();
  const startedAt = Date.now();

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      cashPrice: true,
      installmentPrice: true,
      prices: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { label: true, amount: true, isDefault: true },
      },
    },
  });

  let updated = 0;
  let skippedNoRows = 0;
  let skippedAlreadySet = 0;
  const bySource: Record<string, number> = {};
  const samples: Record<string, unknown>[] = [];

  for (const p of products) {
    // forward-fix: คอลัมน์ที่มีค่าแล้ว (B0 เขียน / autofill) ห้ามทับ
    if (p.cashPrice != null && p.installmentPrice != null) {
      skippedAlreadySet++;
      continue;
    }
    if (p.prices.length === 0) {
      skippedNoRows++;
      continue;
    }

    const cash = p.cashPrice == null ? pickCash(p.prices) : null;
    const installment = p.installmentPrice == null ? pickInstallment(p.prices) : null;
    if (!cash && !installment) {
      skippedNoRows++;
      continue;
    }

    if (cash) bySource[`cash:${cash.source}`] = (bySource[`cash:${cash.source}`] ?? 0) + 1;
    if (installment)
      bySource[`installment:${installment.source}`] =
        (bySource[`installment:${installment.source}`] ?? 0) + 1;

    if (samples.length < 20) {
      samples.push({
        id: p.id,
        name: p.name,
        cashFrom: cash?.source ?? '(คงเดิม)',
        cashAmount: cash?.amount.toString() ?? null,
        installmentFrom: installment?.source ?? '(คงเดิม)',
        installmentAmount: installment?.amount.toString() ?? null,
      });
    }

    if (APPLY) {
      await prisma.product.update({
        where: { id: p.id },
        data: {
          ...(cash ? { cashPrice: cash.amount } : {}),
          ...(installment ? { installmentPrice: installment.amount } : {}),
        },
      });
    }
    updated++;
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'APPLY' : 'DRY_RUN',
        scanned: products.length,
        updated,
        skippedAlreadySet,
        skippedNoRows,
        bySource,
        samples,
        elapsedMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2:** เพิ่ม npm script ใน `apps/api/package.json` (ต่อจาก `"survey:pricing-templates"`):

```json
    "backfill:product-prices": "tsx scripts/backfill-product-prices.ts",
    "backfill:product-prices:help": "echo 'DRY-RUN default. เขียนจริง: APPLY=true DATABASE_URL=<db> npm --prefix apps/api run backfill:product-prices — ต้องรันก่อนเปิด readiness filter ใน deploy เดียวกัน'",
```

- [ ] **Step 3:** ทดสอบบน local: `cd apps/api && npm run backfill:product-prices` → ต้องได้ `"mode": "DRY_RUN"` และ `bySource` มีคีย์ที่บอกที่มาราคา; ตรวจว่าไม่มีแถวไหนถูกเขียน (`SELECT count(*) FROM products WHERE cash_price IS NOT NULL;` ก่อน/หลังต้องเท่ากัน)
- [ ] **Step 4:** รันจริงบน local: `cd apps/api && APPLY=true npm run backfill:product-prices` → `"mode": "APPLY"`, `updated > 0` (ถ้า local มี seed products)
- [ ] **Step 5:** Commit: `feat(b0): backfill ราคา v2 — fallback isDefault ทุก label + log per-label + dry-run default`

---

### Task 10: `product-readiness.util.ts` + `GET /products/:id/readiness`

**Files:**
- Create: `apps/api/src/utils/product-readiness.util.ts`
- Create: `apps/api/src/utils/product-readiness.util.spec.ts`
- Modify: `apps/api/src/modules/products/products.service.ts` (เพิ่ม method `getReadiness`)
- Modify: `apps/api/src/modules/products/products.controller.ts` (เพิ่ม route ถัดจาก `:id/workflow` บรรทัด 137-141)

**Interfaces:**
- Produces:
```ts
export const SHOP_BRAND = 'Apple';
export const SHOP_PHONE_CATEGORIES = ['PHONE_NEW', 'PHONE_USED'] as const;
export const DEMO_NAME_PREFIX = '[DEMO]';

/** fragment ที่ AND-composable — ใช้คีย์ `AND` อย่างเดียว ไม่แตะ `OR` ระดับบนสุด */
export function productReadinessWhere(opts?: { requireInStock?: boolean }): Prisma.ProductWhereInput;

export interface ReadinessCheck { key: string; label: string; ok: boolean; hint?: string }
export interface ReadinessResult { ready: boolean; checks: ReadinessCheck[] }
export function evaluateReadiness(p: ReadinessProductShape): ReadinessResult;
```
- **ข้อบังคับ:** fragment ต้อง**ไม่ใช้คีย์ `OR` ที่ระดับบนสุด** เพราะ `listGroupedByModel` assign `where.OR` เองสำหรับ search (`shop-catalog.service.ts:96-99`) — เงื่อนไข "มือสองต้องมีเกรด" จึงห่ออยู่ใน `AND[...]` เป็น `{ OR: [...] }` ซ้อนชั้นใน
- `requireInStock: false` ใช้ที่ **head query ของ `getProductDetail` เท่านั้น** — spec §0 ยืนยันว่า `/products/:id` ของเครื่องที่ขายแล้วต้องยัง render หน้ารุ่นได้ (permalink ของ B4)

- [ ] **Step 1:** เขียน spec ที่ล้มก่อน — `apps/api/src/utils/product-readiness.util.spec.ts`:

```ts
import { productReadinessWhere, evaluateReadiness } from './product-readiness.util';

describe('productReadinessWhere', () => {
  it('ใช้คีย์ AND อย่างเดียวที่ระดับบนสุด (ไม่ชนกับ where.OR ของ search)', () => {
    const w = productReadinessWhere() as Record<string, unknown>;
    expect(Object.keys(w)).toEqual(['AND']);
    expect(w).not.toHaveProperty('OR');
  });

  it('บังคับ IN_STOCK + ราคา > 0 + มีรูปขึ้นเว็บ + ไม่ถูกลบ + เปิดแสดง', () => {
    const and = (productReadinessWhere() as { AND: Record<string, unknown>[] }).AND;
    expect(and).toContainEqual({ deletedAt: null });
    expect(and).toContainEqual({ isOnlineVisible: true });
    expect(and).toContainEqual({ status: 'IN_STOCK' });
    expect(and).toContainEqual({ cashPrice: { gt: 0 } });
    expect(and).toContainEqual({ gallery: { isEmpty: false } });
  });

  it('กรอง [DEMO] แบบไม่ผูกกับ NODE_ENV', () => {
    const and = (productReadinessWhere() as { AND: Record<string, unknown>[] }).AND;
    expect(and).toContainEqual({ NOT: { name: { startsWith: '[DEMO]' } } });
  });

  it('มือสองต้องมีเกรด — ห่ออยู่ใน AND ไม่ใช่ OR ระดับบนสุด', () => {
    const and = (productReadinessWhere() as { AND: Record<string, unknown>[] }).AND;
    expect(and).toContainEqual({
      OR: [
        { category: { not: 'PHONE_USED' } },
        { AND: [{ conditionGrade: { not: null } }, { conditionGrade: { not: '' } }] },
      ],
    });
  });

  it('requireInStock:false ตัดเฉพาะเงื่อนไขสถานะ (permalink เครื่องที่ขายแล้ว)', () => {
    const and = (productReadinessWhere({ requireInStock: false }) as { AND: Record<string, unknown>[] }).AND;
    expect(and).not.toContainEqual({ status: 'IN_STOCK' });
    expect(and).toContainEqual({ cashPrice: { gt: 0 } });
  });
});

describe('evaluateReadiness', () => {
  const ok = {
    name: 'iPhone 15 128GB',
    brand: 'Apple',
    category: 'PHONE_NEW',
    status: 'IN_STOCK',
    cashPrice: '28900',
    gallery: ['https://cdn/x.jpg'],
    conditionGrade: null,
    isOnlineVisible: true,
    deletedAt: null,
  };

  it('ครบทุกข้อ → ready = true', () => {
    const r = evaluateReadiness(ok as never);
    expect(r.ready).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it('ไม่มีราคา → ไม่ ready และมี check ราคาเป็น false', () => {
    const r = evaluateReadiness({ ...ok, cashPrice: null } as never);
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.key === 'cashPrice')?.ok).toBe(false);
  });

  it('มือสองไม่มีเกรด → ไม่ ready', () => {
    const r = evaluateReadiness({ ...ok, category: 'PHONE_USED', conditionGrade: null } as never);
    expect(r.checks.find((c) => c.key === 'conditionGrade')?.ok).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('แบรนด์นอก shop gate → เตือนว่าเว็บไม่รับ', () => {
    const r = evaluateReadiness({ ...ok, brand: 'Samsung' } as never);
    expect(r.checks.find((c) => c.key === 'shopGate')?.ok).toBe(false);
    expect(r.checks.find((c) => c.key === 'shopGate')?.hint).toContain('iPhone');
  });

  it('ชื่อขึ้นต้น [DEMO] → ไม่ ready', () => {
    const r = evaluateReadiness({ ...ok, name: '[DEMO] iPhone 15' } as never);
    expect(r.checks.find((c) => c.key === 'notDemo')?.ok).toBe(false);
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/utils/product-readiness.util.spec.ts`
- [ ] **Step 3:** implement — `apps/api/src/utils/product-readiness.util.ts`:

```ts
import { Prisma } from '@prisma/client';

export const SHOP_BRAND = 'Apple';
export const SHOP_PHONE_CATEGORIES = ['PHONE_NEW', 'PHONE_USED'] as const;
export const DEMO_NAME_PREFIX = '[DEMO]';

/**
 * B0 §2.3 — เงื่อนไข "ข้อมูลครบพอขึ้นเว็บ" ชุดเดียวของทั้งระบบ
 *
 * คืน fragment ที่ **ใช้คีย์ `AND` อย่างเดียวที่ระดับบนสุด** — จำเป็น เพราะ
 * `ShopCatalogService.listGroupedByModel` assign `where.OR` เองสำหรับ search
 * (shop-catalog.service.ts:96-99) ถ้า fragment ใช้ `OR` ระดับบนสุดจะโดนทับเงียบๆ
 *
 * `requireInStock:false` ใช้เฉพาะ head query ของ getProductDetail — เครื่องที่
 * ขายแล้วต้องยังเปิดหน้ารุ่นได้ (permalink; spec §0)
 */
export function productReadinessWhere(opts?: {
  requireInStock?: boolean;
}): Prisma.ProductWhereInput {
  const requireInStock = opts?.requireInStock ?? true;
  const and: Prisma.ProductWhereInput[] = [
    { deletedAt: null },
    { isOnlineVisible: true },
    ...(requireInStock ? [{ status: 'IN_STOCK' } as Prisma.ProductWhereInput] : []),
    { brand: SHOP_BRAND },
    { category: { in: [...SHOP_PHONE_CATEGORIES] } },
    { cashPrice: { gt: 0 } },
    { gallery: { isEmpty: false } },
    // ไม่ผูกกับ NODE_ENV — QA local ต้องเห็นพฤติกรรมเดียวกับ prod
    { NOT: { name: { startsWith: DEMO_NAME_PREFIX } } },
    {
      OR: [
        { category: { not: 'PHONE_USED' } },
        { AND: [{ conditionGrade: { not: null } }, { conditionGrade: { not: '' } }] },
      ],
    },
  ];
  return { AND: and };
}

export interface ReadinessProductShape {
  name: string;
  brand: string;
  category: string;
  status: string;
  cashPrice: Prisma.Decimal | string | null;
  gallery: string[];
  conditionGrade: string | null;
  isOnlineVisible: boolean;
  deletedAt: Date | null;
}

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  hint?: string;
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
}

/** checklist รายข้อสำหรับหน้าสินค้า admin (B1 กิน endpoint นี้) */
export function evaluateReadiness(p: ReadinessProductShape): ReadinessResult {
  const cash = p.cashPrice != null ? Number(p.cashPrice) : 0;
  const isUsed = p.category === 'PHONE_USED';
  const inShopGate =
    p.brand === SHOP_BRAND &&
    (SHOP_PHONE_CATEGORIES as readonly string[]).includes(p.category);

  const checks: ReadinessCheck[] = [
    {
      key: 'notDeleted',
      label: 'ยังไม่ถูกลบ',
      ok: p.deletedAt == null,
    },
    {
      key: 'shopGate',
      label: 'อยู่ในหมวดที่เว็บขาย',
      ok: inShopGate,
      hint: inShopGate ? undefined : 'เว็บขายเฉพาะ iPhone (มือ 1 / มือ 2) — สินค้านี้จะไม่ขึ้นเว็บ',
    },
    {
      key: 'inStock',
      label: 'อยู่ในสต็อก',
      ok: p.status === 'IN_STOCK',
      hint: p.status === 'IN_STOCK' ? undefined : `สถานะปัจจุบัน: ${p.status}`,
    },
    {
      key: 'cashPrice',
      label: 'มีราคาเงินสด',
      ok: cash > 0,
      hint: cash > 0 ? undefined : 'กรอกราคาเงินสดในส่วนราคา หรือกรอกตารางราคากลางให้ครบ',
    },
    {
      key: 'gallery',
      label: 'มีรูปขึ้นเว็บอย่างน้อย 1 รูป',
      ok: p.gallery.length > 0,
      hint: p.gallery.length > 0 ? undefined : 'เลือกรูปจากรูปสินค้าในระบบมาเป็นรูปขึ้นเว็บ',
    },
    {
      key: 'conditionGrade',
      label: 'มีเกรดเครื่อง (เฉพาะมือสอง)',
      ok: !isUsed || !!(p.conditionGrade && p.conditionGrade.trim().length > 0),
      hint: !isUsed ? 'ไม่บังคับสำหรับเครื่องมือ 1' : undefined,
    },
    {
      key: 'notDemo',
      label: 'ไม่ใช่สินค้าตัวอย่าง [DEMO]',
      ok: !p.name.startsWith(DEMO_NAME_PREFIX),
    },
    {
      key: 'isOnlineVisible',
      label: 'เปิดแสดงบนเว็บ',
      ok: p.isOnlineVisible === true,
      hint: p.isOnlineVisible ? undefined : 'ถูกปิดจากเว็บด้วยมือ — เปิดได้ที่สวิตช์แสดงบนเว็บ',
    },
  ];

  return { ready: checks.every((c) => c.ok), checks };
}
```

- [ ] **Step 4:** รันให้ผ่าน: `cd apps/api && npx jest src/utils/product-readiness.util.spec.ts` → คาดหวัง 10/10 ผ่าน
- [ ] **Step 5:** เพิ่ม method ใน `products.service.ts` (วางต่อจาก `getBrands()` ก่อนปิดคลาส):

```ts
  /** B0 §2.3 — checklist "พร้อมขึ้นเว็บ" รายข้อ (หน้าสินค้า admin ใน B1 กินอันนี้) */
  async getReadiness(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: {
        id: true, name: true, brand: true, category: true, status: true,
        cashPrice: true, installmentPrice: true, gallery: true,
        conditionGrade: true, isOnlineVisible: true, deletedAt: true,
        priceAutofilledAt: true,
      },
    });
    if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า');
    const result = evaluateReadiness(product);
    return {
      productId: product.id,
      ready: result.ready,
      checks: result.checks,
      priceAutofilledAt: product.priceAutofilledAt,
      hasInstallmentPrice: product.installmentPrice != null,
    };
  }
```

  + import:

```ts
import { evaluateReadiness } from '../../utils/product-readiness.util';
```

- [ ] **Step 6:** เพิ่ม route ใน `products.controller.ts` (แทรกต่อจาก `getWorkflowStatus` บรรทัด 141):

```ts
  @Get(':id/readiness')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'เช็คว่าสินค้าข้อมูลครบพอขึ้นเว็บหรือยัง (checklist รายข้อ)' })
  getReadiness(@Param('id') id: string) {
    return this.productsService.getReadiness(id);
  }
```

- [ ] **Step 7:** รัน + type + lint: `cd apps/api && npx jest src/utils/product-readiness.util.spec.ts src/modules/products/` → เขียว; `./tools/check-types.sh api` → 0; `cd apps/api && npx eslint src/utils/product-readiness.util.ts src/modules/products` → ไม่มี error ใหม่
  > route order: `@Get(':id/readiness')` ต้องอยู่**ก่อน** `@Get(':id')` (บรรทัด 143) — Nest จับคู่ตามลำดับประกาศ ถ้าวางหลัง `:id` จะกลืน path แล้ว `id` กลายเป็นสตริง `'<id>/readiness'`
- [ ] **Step 8:** Commit: `feat(b0): product-readiness util (AND-composable) + GET /products/:id/readiness`

---

### Task 11: ใช้ readiness fragment กับผู้อ่านทุกตัว

**Files:**
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` (const :51-52, `shopBaseWhere` :55-63, `getProductDetail` head :225-233 + units :237-248)
- Modify: `apps/api/src/modules/shop-reservation/shop-reservation.service.ts` (:22-24)
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts` (**5 เคส** ที่ตรวจ where เดิม + 1 เคสใหม่)
- Modify: `apps/api/src/modules/shop-reservation/shop-reservation.service.spec.ts` (**5 เคส** ใน `describe('reserve')`)

**Interfaces:**
- Consumes: `productReadinessWhere(opts?)` (Task 10)
- **จุดที่ต้องระวัง:** `listGroupedByModel` ยังทำ `where.category = ...` (:86), `where.model = ...` (:88), `where.conditionGrade = ...` (:89), `where.cashPrice = {...}` (:90-93), `where.OR = [...]` (:94-100) ที่ระดับบนสุด — Prisma AND-รวม field ระดับบนสุดกับคีย์ `AND[]` ให้อัตโนมัติ **ไม่ต้องแก้บรรทัดพวกนั้น** (เช่น `where.cashPrice = {gte:X}` จะ AND กับ `AND[{cashPrice:{gt:0}}]` ได้ถูกต้อง)
- **ผู้อ่านที่ได้ fragment ฟรี** (ไม่ต้องแก้เพิ่ม): `listAvailableModels` (:169) และ `listRelated` (:178, :181) เพราะเรียก `shopBaseWhere()` อยู่แล้ว

- [ ] **Step 1:** แทน `shopBaseWhere` (บรรทัด 55-63) ใน `shop-catalog.service.ts`:

```ts
function shopBaseWhere(): Record<string, any> {
  // B0 §2.3: เงื่อนไขขึ้นเว็บมาจาก util ตัวเดียว (brand/category/สถานะ/ราคา/รูป/เกรด/[DEMO])
  // fragment ใช้คีย์ `AND` เท่านั้น → ปลอดภัยกับ where.OR ที่ listGroupedByModel assign เอง
  return { ...productReadinessWhere() };
}
```

  **ลบ `const SHOP_BRAND` (บรรทัด 51) และ `const PHONE_CATEGORIES` (บรรทัด 52) ทิ้งไปเลย** — หลัง Step 2 ทั้งคู่ไม่มีผู้ใช้เหลือ (grep ยืนยัน: ใช้แค่ที่ :60-61 ใน `shopBaseWhere` และ :230-231 ใน `getProductDetail` ซึ่งถูกแทนทั้งคู่). **ไม่ต้อง import `SHOP_BRAND`/`SHOP_PHONE_CATEGORIES` จาก util** — import แค่ตัวเดียว:

```ts
import { productReadinessWhere } from '../../utils/product-readiness.util';
```

- [ ] **Step 2:** แทน head query ของ `getProductDetail` (บรรทัด 225-233):

```ts
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        // ไม่บังคับ IN_STOCK — เครื่องที่ขายแล้วต้องยังเปิดหน้ารุ่นได้ (permalink)
        ...productReadinessWhere({ requireInStock: false }),
      },
    });
```

- [ ] **Step 3:** แทน units query (บรรทัด 237-248):

```ts
    // Get all units (same brand+model+storage+category, พร้อมขายจริง)
    const allUnits = await this.prisma.product.findMany({
      where: {
        model: product.model,
        storage: product.storage,
        category: product.category,
        ...productReadinessWhere(),
      },
      orderBy: { cashPrice: 'asc' },
    });
```
  (ตัด `brand: product.brand` ออกได้เพราะ fragment บังคับ `brand: SHOP_BRAND` อยู่แล้ว — head query ผ่าน fragment เดียวกันจึงการันตีว่า `product.brand === SHOP_BRAND`)

- [ ] **Step 4:** แก้ `shop-reservation.service.ts` บรรทัด 22-24:

```ts
    // B0 §2.3: จองได้เฉพาะเครื่องที่ "พร้อมขึ้นเว็บ" จริง — เดิมจองเครื่องไม่มีราคาได้
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, ...productReadinessWhere() },
      select: { id: true, status: true },
    });
    if (!product) throw new NotFoundException('สินค้านี้ไม่พร้อมจำหน่ายบนเว็บ');
```
  + import:

```ts
import { productReadinessWhere } from '../../utils/product-readiness.util';
```
  บรรทัด 24 เดิม `if (product.status !== 'IN_STOCK') throw new ConflictException(...)` **ลบทิ้ง** — fragment ครอบแล้ว.
  ⚠️ **คง import `ConflictException` ไว้** — ยังถูกใช้ที่ `:43` (`'เครื่องนี้ถูกจองโดยลูกค้ารายอื่นอยู่ — รอ 15 นาที'`) ตรวจแล้ว ห้ามลบ
  ⚠️ **พฤติกรรมที่เปลี่ยนโดยตั้งใจ:** เครื่องที่ขายไปแล้วเคยตอบ `409 ConflictException('สินค้านี้ไม่อยู่ในสต็อกแล้ว')` ตอนนี้ตอบ `404 NotFoundException('สินค้านี้ไม่พร้อมจำหน่ายบนเว็บ')` — ฝั่ง web-shop แสดง `e.response?.data?.message` ตรงๆ (`ProductDetailPage.tsx:153-155`) จึงไม่พังแต่ข้อความเปลี่ยน ต้องระบุใน PR description

- [ ] **Step 5:** แก้ `shop-reservation.service.spec.ts` — **ทั้ง 5 เคสใน `describe('reserve')` ใช้ `prisma.product.findUnique` ซึ่งโค้ดใหม่ไม่เรียกแล้ว**:
  a) ใน `beforeEach` เปลี่ยน `product: { findUnique: jest.fn() }` (บรรทัด 12) → `product: { findFirst: jest.fn() }`
  b) แทน `prisma.product.findUnique.mockResolvedValue(...)` ทุกจุด (:28, :44, :49, :54, :59, :70) ด้วย `prisma.product.findFirst.mockResolvedValue(...)` — สังเกตว่าโค้ดใหม่ `select: { id, status }` เท่านั้น ค่า mock จึงเหลือ `{ id: 'p1', status: 'IN_STOCK' }` พอ
  c) เคส `'rejects if product not in stock'` (:48-51) และ `'rejects if product not online visible'` (:53-56) **รวมเป็นเคสเดียว** — ทั้งคู่ตอนนี้คือ "fragment ไม่ match → findFirst คืน null":

```ts
    it('rejects (404) เมื่อเครื่องไม่ผ่าน readiness — ขายแล้ว / ปิดจากเว็บ / ไม่มีราคา / ไม่มีรูป', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(
        NotFoundException,
      );
      // fragment ถูกส่งเข้า query จริง (ไม่ได้จองเครื่องไม่มีราคาได้อีก)
      const where = prisma.product.findFirst.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ cashPrice: { gt: 0 } }]));
    });
```
  d) ถ้าหลังรวมเคสแล้ว `ConflictException` ยังถูก import ใน spec ให้เก็บไว้ — เคส `'rejects if already reserved by another session'` (:58-67) ยังใช้

- [ ] **Step 6:** แก้ `shop-catalog.service.spec.ts` — **5 เคสที่ assert field ระดับบนสุดของ where** (ตรวจกับไฟล์จริงแล้ว ทั้งหมดจะแดง เพราะ field ย้ายเข้า `AND[]`):

  a) `:25 'hard-filters to iPhone only (brand=Apple AND category in phone set)'` →

```ts
    it('hard-filters ผ่าน readiness fragment (brand/category/สถานะ/ราคา/รูป/[DEMO])', async () => {
      prisma.product.groupBy.mockResolvedValue([]);

      await service.listGroupedByModel({});

      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { brand: 'Apple' },
          { category: { in: ['PHONE_NEW', 'PHONE_USED'] } },
          { isOnlineVisible: true },
          { status: 'IN_STOCK' },
          { deletedAt: null },
          { cashPrice: { gt: 0 } },
          { gallery: { isEmpty: false } },
          { NOT: { name: { startsWith: '[DEMO]' } } },
        ]),
      );
    });
```

  b) `:162 'filters by exact model while keeping the iPhone-only base'` → `model` ยังอยู่ top-level, ที่เหลือย้ายเข้า AND:

```ts
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.model).toBe('iPhone 16');
      expect(where.AND).toEqual(
        expect.arrayContaining([{ brand: 'Apple' }, { status: 'IN_STOCK' }]),
      );
```

  c) `:180 'returns distinct models with counts, iPhone-only base, sorted by count desc'` → เปลี่ยน block `where: expect.objectContaining({ brand: 'Apple', category: …, isOnlineVisible: true, status: …, deletedAt: null })` เป็น
     `where: expect.objectContaining({ AND: expect.arrayContaining([{ brand: 'Apple' }, { status: 'IN_STOCK' }, { deletedAt: null }]) })`

  d) `:257 'returns null when the resolved id is not an iPhone (brand/category guard on the initial lookup)'` → head query ไม่มี `status: 'IN_STOCK'` (permalink) แต่มี brand/category ใน AND:

```ts
      const where = prisma.product.findFirst.mock.calls[0][0].where;
      expect(where.id).toBe('non-iphone-id');
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { brand: 'Apple' },
          { category: { in: ['PHONE_NEW', 'PHONE_USED'] } },
        ]),
      );
      // permalink: ไม่บังคับ IN_STOCK ที่ head query
      expect(where.AND).not.toContainEqual({ status: 'IN_STOCK' });
```

  e) `:339 'returns other models (iPhone-only base, excludes current model, limit 6)'` → เปลี่ยน `where: expect.objectContaining({ brand: 'Apple', model: { not: 'iPhone 16' } })` เป็น
     `where: expect.objectContaining({ model: { not: 'iPhone 16' }, AND: expect.arrayContaining([{ brand: 'Apple' }]) })`

  > เคสที่ **ไม่ต้องแตะ** (ยืนยันแล้วว่ายังเขียว): `:44`/`:51` `narrows category…` (อ่าน `where.category` top-level ซึ่งยังถูก assign อยู่), `:140` search (`where.OR` top-level), `:155` blank search, `:209` `scopes units to the SAME category` (ใช้ `objectContaining({ category: 'PHONE_USED' })` ซึ่งยังอยู่ top-level ของ units query)

- [ ] **Step 7:** เพิ่มเคสใหม่ต่อท้าย describe `listGroupedByModel` — พิสูจน์ว่า search ไม่ทับ fragment:

```ts
    it('search assign where.OR แล้ว readiness fragment ยังอยู่ครบ (ไม่โดนทับ)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: 'iphone 15' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.OR).toHaveLength(2);
      expect(where.AND).toEqual(expect.arrayContaining([{ cashPrice: { gt: 0 } }]));
    });
```

- [ ] **Step 8:** รันให้เขียว: `cd apps/api && npx jest src/modules/shop-catalog src/modules/shop-reservation` → ทุก suite ผ่าน
- [ ] **Step 9:** `./tools/check-types.sh api` → 0; `cd apps/api && npx eslint src/modules/shop-catalog src/modules/shop-reservation` → ไม่มี error ใหม่
- [ ] **Step 10:** Commit: `feat(b0): readiness fragment คุมทุกผู้อ่าน (catalog 3 จุด + reserve)`

---

### Task 12: เลิก null→0 ครบ 4 จุด

**Files:**
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` (:251-271 ลูปสร้าง tiers)
- Modify: `apps/api/src/modules/shop-cart/shop-cart.service.ts` (:29-43)
- Modify: `apps/api/src/modules/shop-installment-apply/shop-installment-apply.service.ts` (:44)
- Modify: `apps/web-shop/src/pages/ProductDetailPage.tsx` (:146 `value: selectedUnit?.cashPrice ?? 0`, :177 `const price = selectedUnit?.cashPrice ?? 0`, :312 `{price > 0 ? (`)
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts` (+1 เคสใหม่, Step 5)

**Interfaces:**
- **ไม่เปลี่ยน type สาธารณะ**: `CartItem.product.sellingPrice` คงเป็น `number` (CheckoutPage บวก `shippingFee` ตรงๆ ที่ `CheckoutPage.tsx:91` — เปลี่ยนเป็น nullable จะลามไป 4 ไฟล์). แทนที่จะโชว์ ฿0 ให้ **ตัดรายการที่ไม่มีราคาออกจากตะกร้า** (จองใหม่ทำไม่ได้อยู่แล้วหลัง Task 11 — เหลือแค่ hold ค้างจากก่อน B0)
- `ProductUnit.cashPrice` ยังเป็น `number` — units ที่ไม่มีราคาถูก readiness fragment กรองออกก่อนแล้ว จึง `continue` ทิ้งได้อย่างปลอดภัย
- ฝั่ง web-shop `ProductUnit.cashPrice` ประกาศเป็น `number` (non-null) ที่ `apps/web-shop/src/types/product.ts:19` → `selectedUnit?.cashPrice ?? null` ให้ type `number | null` และ `track(event, params?: Record<string, unknown>)` (`src/lib/analytics.ts:108`) รับ `undefined` ได้ ไม่ต้องแก้ signature. `price` ถูกใช้แค่ 2 จุด (:312 เงื่อนไข, :314 `price.toLocaleString()`) → narrowing ด้วย `price != null && price > 0` ครอบพอ

- [ ] **Step 1:** `shop-catalog.service.ts` ลูป tiers — แทนบรรทัด 251-254 (`for (const u of allUnits) { ... const price = ...`) ด้วย:

```ts
    for (const u of allUnits) {
      // B0: readiness fragment กรอง cashPrice > 0 มาแล้ว — ถ้ายังเจอ null แปลว่า
      // ข้อมูลไม่ครบ ให้ตกจากรายการแทนการโชว์ ฿0 (เคยหลอกลูกค้าว่าเครื่องฟรี)
      if (u.cashPrice == null) continue;
      const grade = u.conditionGrade ?? 'unknown';
      if (!tiers[grade]) tiers[grade] = { minPrice: Infinity, maxPrice: 0, units: [] };
      const price = Number(u.cashPrice);
```

- [ ] **Step 2:** `shop-cart.service.ts` — แทนบรรทัด 29-43 (`return reservations.filter(...).map(...)`) ด้วย:

```ts
    return reservations
      .filter((r) => r.expiresAt.getTime() > now)
      // B0: ห้ามโชว์ ฿0 — จองใหม่ต้องผ่าน readiness (มีราคาแน่นอน);
      // hold ค้างจากก่อน B0 ที่ไม่มีราคาให้ตกจากตะกร้าแทนคิดเงินเป็นศูนย์
      // ⚠️ คง fallback `cashPrice ?? installmentPrice` ไว้ตามพฤติกรรมเดิม (:39)
      //    spec เดิม `falls back to installmentPrice when cashPrice is not set`
      //    (shop-cart.service.spec.ts:48) ยืนยันไว้ — ตัดออกจะทำให้แดง
      .filter((r) => Number(r.product.cashPrice ?? r.product.installmentPrice ?? 0) > 0)
      .map((r) => ({
        reservationId: r.id,
        productId: r.productId,
        expiresAt: r.expiresAt,
        secondsRemaining: Math.max(0, Math.floor((r.expiresAt.getTime() - now) / 1000)),
        product: {
          id: r.product.id,
          name: r.product.name,
          sellingPrice: Number(r.product.cashPrice ?? r.product.installmentPrice ?? 0),
          gallery: r.product.gallery,
          conditionGrade: r.product.conditionGrade,
        },
      }));
```

- [ ] **Step 3:** `shop-installment-apply.service.ts` — แทนบรรทัด 44:

```ts
    // B0: ห้ามคำนวณแผนผ่อนบนราคา 0 (เดิม ?? 0 → ลูกค้าได้ค่างวด 0 บาท)
    const priceSource = product.installmentPrice ?? product.cashPrice;
    if (priceSource == null || Number(priceSource) <= 0) {
      throw new BadRequestException('สินค้านี้ยังไม่มีราคาผ่อน กรุณาติดต่อร้านเพื่อสอบถามราคา');
    }
    const price = Number(priceSource);
```
  (`BadRequestException` import อยู่แล้วบรรทัด 1)

- [ ] **Step 4:** `apps/web-shop/src/pages/ProductDetailPage.tsx` — บรรทัด 146 ในบล็อก `track('AddToCart', ...)`:

```tsx
          value: selectedUnit?.cashPrice ?? undefined,
```
  บรรทัด 177:

```tsx
  const price = selectedUnit?.cashPrice ?? null;
```
  บรรทัด 312 (เงื่อนไข render ราคา):

```tsx
                {price != null && price > 0 ? (
```
  (สาขา else เดิมที่ render `สอบถามราคาทางไลน์` ถูกอยู่แล้ว — **ห้ามแก้ copy**)

- [ ] **Step 5:** เพิ่มเคสยืนยันใน `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts` (ท้าย describe `getProductDetail` หรือสร้างใหม่ถ้าไม่มี):

```ts
  describe('getProductDetail — ราคา null (B0)', () => {
    it('ตัด unit ที่ไม่มี cashPrice ออกแทนการโชว์ 0', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1', brand: 'Apple', model: 'iPhone 15', storage: '128GB',
        category: 'PHONE_NEW', color: null, onlineDescription: null,
        gallery: ['g'], gallery360: [], cashPrice: '28900', installmentPrice: null,
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'u1', conditionGrade: null, cashPrice: '28900', installmentPrice: null, gallery: [], gallery360: [], imeiSerial: null, batteryHealth: null, hasBox: null, color: null, shopWarrantyDays: null },
        { id: 'u2', conditionGrade: null, cashPrice: null, installmentPrice: null, gallery: [], gallery360: [], imeiSerial: null, batteryHealth: null, hasBox: null, color: null, shopWarrantyDays: null },
      ]);

      const detail = await service.getProductDetail('p1');
      const units = Object.values(detail!.tiers).flatMap((t) => t.units);
      expect(units.map((u) => u.id)).toEqual(['u1']);
    });
  });
```

- [ ] **Step 6:** รันให้เขียว: `cd apps/api && npx jest src/modules/shop-catalog src/modules/shop-cart src/modules/shop-installment-apply`
  → ต้องยังเขียวโดย**ไม่แก้** `shop-cart.service.spec.ts:48` (`falls back to installmentPrice…`, คาด 14000) และ `shop-installment-apply.service.spec.ts:87` (`falls back to cashPrice when installmentPrice is unset`, คาดใช้ 18000) — ถ้าแดง แปลว่าเผลอตัด fallback ออก
- [ ] **Step 7:** `./tools/check-types.sh api` → 0; `cd apps/web-shop && npx tsc --noEmit` → 0; `cd apps/api && npx eslint src/modules/shop-catalog src/modules/shop-cart src/modules/shop-installment-apply` → ไม่มี error ใหม่
  (web-shop **ไม่มี eslint config** — ข้าม lint ฝั่งนั้น ใช้ `tsc --noEmit` เป็น gate เดียว)
- [ ] **Step 8:** Commit: `fix(b0): เลิกแปลงราคา null เป็น 0 ครบ 4 จุด (catalog/cart/installment-apply/web-shop)`

---

### Task 13: เขียน `Product.conditionGrade` 2 จุด + ปลด invariant `isOnlineVisible`

**Files:**
- Modify: `apps/api/src/modules/quality-control/inspections.service.ts` (`completeInspection` ลูป :184-190, `overrideGrade` :195-206)
- Modify: `apps/api/src/modules/quality-control/inspections.grade-mapping.spec.ts` (assertion `productUpdate` ที่ :178-181)
- Modify: `apps/api/src/modules/quality-control/inspections.override-grade.spec.ts` (`makePrisma` :30-37 — ขาด `products` + `product.update`)
- Modify: `apps/api/src/modules/products/products-online-listing.service.ts` (บรรทัด 38-51)
- Modify: `apps/api/src/modules/products/products-online-listing.service.spec.ts` (**4 เคส** ที่ยืนยัน invariant เดิม: :57, :62, :72, :92)
- Create: `apps/api/src/modules/quality-control/inspections.product-grade.spec.ts` (ตั้งชื่อตาม convention ของโมดูลนี้ — `inspections.<topic>.spec.ts` เหมือน `inspections.calculate-grade` / `inspections.grade-mapping` / `inspections.override-grade`)

**Interfaces:**
- Consumes: `InspectionsService.calculateGrade(inspectionId): Promise<'A'|'B'|'C'|'D'>` (private, มีอยู่แล้ว :210) — **อ่าน `this.prisma.inspectionResult.findMany` และ `this.prisma.systemConfig.findMany`** → mock ใน spec ต้องมีทั้งสองตัว ไม่งั้น TypeError
- Consumes: `OverrideGradeDto { grade: string; reason: string }` (`dto/inspection.dto.ts`)
- Produces: หลัง `completeInspection` → ทุก product ที่ผูกกับ inspection ได้ `conditionGrade = overallGrade`; หลัง `overrideGrade` → ได้ `conditionGrade = dto.grade`
- **เหตุผลที่ต้อง 2 จุด:** `overrideGrade` เรียกได้หลัง `complete` เท่านั้น (`:197` throw ถ้ายังไม่ complete) → ตอน complete ค่า `gradeOverride` เป็น null เสมอ ตรรกะจุดเดียวจึงไม่พอ

- [ ] **Step 1:** เขียน spec ที่ล้มก่อน — `apps/api/src/modules/quality-control/inspections.product-grade.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { InspectionsService } from './inspections.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('InspectionsService — เขียนเกรดลง Product (B0)', () => {
  let service: InspectionsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const inspection = {
    id: 'i1',
    isCompleted: false,
    products: [{ id: 'p1' }, { id: 'p2' }],
    template: { items: [] },
    results: [],
  };

  beforeEach(async () => {
    prisma = {
      inspection: {
        findUnique: jest.fn().mockResolvedValue(inspection),
        update: jest.fn().mockResolvedValue({ id: 'i1' }),
      },
      inspectionResult: { findMany: jest.fn().mockResolvedValue([]) },
      // calculateGrade อ่าน grade_a/b/c_threshold จาก SystemConfig — ไม่ mock = TypeError
      systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
      product: { update: jest.fn().mockResolvedValue({ id: 'p1' }) },
    };
    const module = await Test.createTestingModule({
      providers: [InspectionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(InspectionsService);
  });

  it('completeInspection: เขียน conditionGrade ลงทุกเครื่องที่ผูกอยู่', async () => {
    // results ว่าง → totalWeight 0 → percentage 0 → เกรด 'D' (ดู calculateGrade :256-266)
    await service.completeInspection('i1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gradeWrites = prisma.product.update.mock.calls.filter(
      (c: any[]) => c[0].data.conditionGrade !== undefined,
    );
    expect(gradeWrites).toHaveLength(2);
    expect(gradeWrites[0][0].data.status).toBe('QC_PENDING');
    expect(gradeWrites[0][0].data.conditionGrade).toBe('D');
  });

  it('overrideGrade: อัปเดตเกรดเครื่องตาม dto.grade ด้วย', async () => {
    prisma.inspection.findUnique.mockResolvedValue({ ...inspection, isCompleted: true });
    await service.overrideGrade('i1', { grade: 'C', reason: 'จอมีรอย' });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ conditionGrade: 'C' }) }),
    );
    expect(prisma.product.update).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/quality-control/inspections.product-grade.spec.ts`
- [ ] **Step 3:** แก้ `completeInspection` — แทนบรรทัด 184-190 (คอมเมนต์ + ลูป) ของ `inspections.service.ts`:

```ts
    // Update all linked products' grade and status
    // B0 §2.2: conditionGrade ไม่เคยมี production writer มาก่อน — publish gate
    // (products-online-listing.service.ts:48) จึงบล็อกเครื่องมือสองทุกเครื่อง
    for (const product of inspection.products) {
      await this.prisma.product.update({
        where: { id: product.id },
        data: { status: 'QC_PENDING', conditionGrade: grade },
      });
    }
```

- [ ] **Step 4:** แก้ `overrideGrade` — แทนบรรทัด 195-206:

```ts
  async overrideGrade(id: string, dto: OverrideGradeDto) {
    const inspection = await this.findOneInspection(id);
    if (!inspection.isCompleted) throw new BadRequestException('กรุณาตรวจให้เสร็จก่อน');

    await this.prisma.inspection.update({
      where: { id },
      data: { gradeOverride: dto.grade as 'A' | 'B' | 'C' | 'D', overrideReason: dto.reason },
    });

    // B0 §2.2: override เกิดหลัง complete เสมอ → ต้องเขียนทับเกรดเครื่องด้วย
    // ไม่งั้นเครื่องค้างเกรด auto ที่ QC ตีกลับไปแล้ว
    for (const product of inspection.products) {
      await this.prisma.product.update({
        where: { id: product.id },
        data: { conditionGrade: dto.grade },
      });
    }

    return this.findOneInspection(id);
  }
```

- [ ] **Step 5:** แก้ spec เดิมของ QC ที่จะแดง (ตรวจกับไฟล์จริงแล้ว):

  a) `inspections.grade-mapping.spec.ts:178-181` — assert `productUpdate` ถูกเรียกด้วย `data: { status: 'QC_PENDING' }` **เป๊ะ** (ไม่ใช่ objectContaining) → เปลี่ยนเป็น:

```ts
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { status: 'QC_PENDING', conditionGrade: 'A' },
    });
```

  b) `inspections.override-grade.spec.ts` — `makePrisma` (:30-37) ไม่มี `products` ใน inspection และไม่มี `product` delegate → ลูปใหม่จะ throw ใน 3 เคสที่ `isCompleted: true` (:61, :79, :90). แก้ helper เป็น:

```ts
const makePrisma = (
  before: { isCompleted: boolean; products?: { id: string }[] },
  after: Record<string, unknown> = {},
) => {
  const findUnique = jest
    .fn()
    .mockResolvedValueOnce({ products: [], ...before })
    .mockResolvedValueOnce(after);
  const update = jest.fn().mockResolvedValue({});
  const productUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    inspection: { findUnique, update },
    product: { update: productUpdate },
  } as unknown as PrismaService;
  return { prisma, findUnique, update, productUpdate };
};
```
  เคส `:72` ที่ assert `expect(update).toHaveBeenCalledTimes(1)` ยังถูก — `update` คือ `inspection.update` คนละตัวกับ `product.update`. เพิ่ม 1 เคสใหม่ต่อท้ายไฟล์:

```ts
  it('B0: เขียน conditionGrade ลงทุกเครื่องที่ผูกกับใบตรวจ', async () => {
    const { prisma, productUpdate } = makePrisma({
      isCompleted: true,
      products: [{ id: 'prod-1' }, { id: 'prod-2' }],
    });
    const svc = new InspectionsService(prisma);
    await svc.overrideGrade('insp-1', dto('C', 'จอมีรอย'));
    expect(productUpdate).toHaveBeenCalledTimes(2);
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'prod-2' },
      data: { conditionGrade: 'C' },
    });
  });
```

- [ ] **Step 6:** ปลด invariant ใน `products-online-listing.service.ts` — **ลบบรรทัด 38-51 ทั้งก้อน** (`const effectiveGallery` + คอมเมนต์ + `const nextVisible` + `if (nextVisible === true) {...}`) แล้วใส่คอมเมนต์แทน:

```ts
    // B0 §2.3: สวิตช์นี้กลายเป็น "ปิดจากเว็บ" ล้วนๆ — การขึ้นเว็บจริงตัดสินที่
    // readiness fragment (product-readiness.util) ไม่ใช่ที่นี่ ดังนั้นกดเปิดได้เสมอ
    // เครื่องที่เปิดไว้แต่ข้อมูลไม่ครบจะไม่ปรากฏบนเว็บอยู่ดี (GET /products/:id/readiness บอกเหตุผล)
```
  `effectiveGallery` ไม่มีผู้ใช้อื่น (บล็อก `product.update` ที่ :53-60 ใช้ `dto.gallery` ตรงๆ) → ลบได้สะอาด ไม่ต้อง `void`. บล็อก validate `dto.gallery` (subset + duplicate, :24-36) **ห้ามแตะ**

- [ ] **Step 7:** แก้ **4 เคส** ใน `products-online-listing.service.spec.ts` ที่ยืนยัน invariant เดิม (ตรวจแล้ว — ไม่ใช่ 2):

```ts
    // แทน :57 'blocks turning isOnlineVisible on when gallery is empty'
    it('B0: เปิด isOnlineVisible ได้แม้ยังไม่มีรูป (readiness เป็นคนตัดสินการขึ้นเว็บ)', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, gallery: [] });
      await expect(
        service.updateOnlineListing('p1', { isOnlineVisible: true }),
      ).resolves.toBeDefined();
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isOnlineVisible: true }) }),
      );
    });

    // แทน :62 'blocks turning on for PHONE_USED without conditionGrade'
    it('B0: เปิด isOnlineVisible ได้แม้มือสองยังไม่มีเกรด', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, conditionGrade: null });
      await expect(
        service.updateOnlineListing('p1', { isOnlineVisible: true }),
      ).resolves.toBeDefined();
    });

    // แทน :72 'validates against the INCOMING gallery when both provided (turn on with empty list = reject)'
    it('B0: เปิดพร้อมส่ง gallery ว่าง ไม่ throw แล้ว (บันทึก gallery ว่าง + เปิดสวิตช์)', async () => {
      await expect(
        service.updateOnlineListing('p1', { isOnlineVisible: true, gallery: [] }),
      ).resolves.toBeDefined();
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ gallery: [], isOnlineVisible: true }),
        }),
      );
    });

    // แทน :92 'rejects PATCH { gallery: [] } on a product that is already visible'
    it('B0: PATCH { gallery: [] } บนเครื่องที่เปิดอยู่ = ล้างรูปได้ (เครื่องจะหลุดจากเว็บเองด้วย readiness)', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...baseProduct, isOnlineVisible: true });
      await expect(service.updateOnlineListing('p1', { gallery: [] })).resolves.toBeDefined();
    });
```
  เคสที่ **ห้ามแตะ** (ยังต้องเขียวเดิม): :43 subset reorder, :50 non-subset reject, :67 non-PHONE_USED, :78 turning OFF, :83 NotFound, :101 duplicate URLs, และทั้ง describe `promotePhoto`

- [ ] **Step 8:** รันให้เขียว: `cd apps/api && npx jest src/modules/quality-control src/modules/products` → ทุก suite ผ่าน (รวม `inspections.calculate-grade.spec.ts` + `inspections.service.spec.ts` ที่ไม่ได้แก้)
- [ ] **Step 9:** `./tools/check-types.sh api` → 0; `cd apps/api && npx eslint src/modules/quality-control src/modules/products` → ไม่มี error ใหม่
- [ ] **Step 10:** Commit: `feat(b0): เขียน conditionGrade จาก QC 2 จุด + ปลด invariant สวิตช์แสดงบนเว็บ`

---

### Task 14: ตรวจรวบยอด + QA บน local

**Files:** ไม่มีการแก้โค้ดใหม่ (ถ้าเจอปัญหาให้กลับไปแก้ที่ Task ต้นทางแล้วรันใหม่)

- [ ] **Step 0 (ทำ*ก่อน*เริ่ม Task 1 — บันทึก baseline ไว้เทียบ):** รันชุดเทสต์บน `main` ก่อนแตะโค้ด แล้วเก็บ output ไว้:

```bash
git stash -u   # ถ้ามีงานค้าง
npm run test --workspace=apps/api  2>&1 | tail -40 > /tmp/b0-baseline-api.txt
(cd apps/web && npx vitest run)    2>&1 | tail -20 > /tmp/b0-baseline-web.txt
git stash pop
```
  → ใช้ไฟล์นี้เป็นหลักฐานว่า suite ไหน "แดงอยู่ก่อน B0" — ห้ามอ้าง pre-existing โดยไม่มี baseline

- [ ] **Step 1:** เทสต์ทั้ง 2 แอปที่มีเทสต์ (web-shop ไม่มีชุดเทสต์):

```bash
npm run test --workspace=apps/api   # = jest --runInBand --forceExit
cd apps/web && npx vitest run
```
  → คาดหวัง: api ทุก suite ผ่าน, web ผ่านทั้งหมด — เทียบกับ `/tmp/b0-baseline-*.txt` ต้อง **ไม่มี suite ที่เพิ่งเปลี่ยนจากเขียวเป็นแดง**

- [ ] **Step 2:** Type check 3 แอป:

```bash
./tools/check-types.sh api && ./tools/check-types.sh web && (cd apps/web-shop && npx tsc --noEmit)
```
  → ทั้งหมด 0 error (baseline วันนี้ทั้ง 3 = 0)

- [ ] **Step 2b:** Lint — **ใช้คำสั่งที่ใช้ได้จริง อย่าใช้ `eslint .` ฝั่ง api**:

```bash
# web — gate จริง 0 error
(cd apps/web && npx eslint .)
# api — gate ของ CI (deploy-gcp.yml:111)
npm run lint --workspace=apps/api
# api — ตรวจเฉพาะไฟล์ที่ B0 แตะ (ไม่มี --fix เพื่อไม่ให้ซ่อน error)
(cd apps/api && npx eslint \
  src/utils/device-query-normalize.util.ts src/utils/device-query-normalize.util.spec.ts \
  src/utils/product-price-sync.util.ts src/utils/product-price-sync.util.spec.ts \
  src/utils/product-price-autofill.util.ts src/utils/product-price-autofill.util.spec.ts \
  src/utils/product-readiness.util.ts src/utils/product-readiness.util.spec.ts \
  src/modules/products src/modules/quality-control src/modules/purchase-orders \
  src/modules/trade-in src/modules/repossessions src/modules/shop-catalog \
  src/modules/shop-cart src/modules/shop-reservation src/modules/shop-installment-apply)
```
  → **เกณฑ์ผ่าน = ไม่มี error ใหม่** (baseline: `npx eslint "src/**/*.ts"` มี 1 error ค้าง `src/cli/backfill-expense-vendor-fk.cli.ts:289 prefer-const` ซึ่งไม่อยู่ในรายการข้างบน; `npx eslint .` มี 34 error ค้างจาก parsing ของ `e2e/`+`scripts/`+`eslint.config.mjs` — **ไม่นับ**)
  → **ข้าม lint ฝั่ง web-shop**: โปรเจกต์นั้นไม่มี `eslint.config.*` (`npx eslint` ตอบ `ESLint couldn't find an eslint.config.(js|mjs|cjs) file`) — gate เดียวคือ `tsc --noEmit` ใน Step 2
  → **ข้าม lint ไฟล์ `apps/api/scripts/*.ts`**: อยู่นอก tsconfig → lint ไม่ได้ (Parsing error) และ tsc ไม่แตะ; ตรวจด้วยการรันจริงใน Step 3

- [ ] **Step 3:** เตรียม local DB: `./tools/db-reset.sh` แล้ว `cd apps/api && npx prisma migrate dev` (ตรวจว่า `20260982000000` apply ผ่าน) แล้วรัน `APPLY=true npm run backfill:product-prices` → ดู `bySource`
- [ ] **Step 4:** QA เบราว์เซอร์ (local เท่านั้น — prod ปฏิเสธ seed accounts). ล็อกอิน `admin@bestchoice.com / admin1234` แล้วเช็ค 6 ข้อ:
  1. `/stock` → เปิดสินค้า 1 ตัว → `PATCH` ราคาเงินสด → รีเฟรช เห็นราคาใหม่ทั้งในคอลัมน์และตาราง prices[]
  2. `GET /api/products/<id>/readiness` (ผ่าน devtools/curl พร้อม JWT) → ได้ checklist 8 ข้อ
  3. `/purchase-orders` → รับเข้าตรง 1 เครื่องโดย**ไม่กรอกราคาขาย** → เปิดสินค้าที่ได้ → ถ้ามีตารางราคากลางตรงรุ่นต้องมีราคาและ `priceAutofilledAt` ไม่ null
  4. `/quality-control` (หรือหน้าตรวจ QC) → complete inspection → เครื่องได้ `conditionGrade`
  5. web-shop (`cd apps/web-shop && npm run dev` → :5174) → หน้ารายการต้องไม่มีเครื่องที่ไม่มีราคา/ไม่มีรูป/ชื่อขึ้นต้น `[DEMO]`
  6. หน้ารายละเอียดเครื่องที่ขายแล้ว → `/products/:id` ต้องยังเปิดได้ (ไม่ 404). **เตรียมเครื่องให้ถูก**: ต้องเป็นเครื่องที่ผ่าน readiness ทุกข้อ**ยกเว้นสถานะ** (Apple + PHONE_NEW/USED + `cash_price > 0` + `gallery` ≥ 1 + `is_online_visible` + ชื่อไม่ขึ้นต้น `[DEMO]`) แล้วค่อย `UPDATE products SET status='SOLD_CASH' WHERE id=…` — ถ้าเครื่องไม่มีรูป/ไม่มีราคาอยู่แล้วจะได้ 404 เพราะ**ข้ออื่น** ไม่ใช่เพราะสถานะ (เทสต์จะไม่พิสูจน์อะไร)
  7. จองเครื่องที่ขายแล้ว/ไม่มีราคา (`POST /api/shop/reservations`) → ต้องได้ **404** `'สินค้านี้ไม่พร้อมจำหน่ายบนเว็บ'` (เดิมเป็น 409) — ยืนยันว่า Task 11 มีผล
- [ ] **Step 5:** บันทึกผล QA 7 ข้อลงใน PR description (ไม่ต้องสร้างไฟล์รายงาน)
- [ ] **Step 6:** เปิด PR: title `feat(b0): ราคาเดียว + เกรด + เงื่อนไขขึ้นเว็บ (product-answering readiness)` — body ต้องมี: ลิงก์ spec §2, ตาราง 14 tasks, ผล QA 7 ข้อ, รายการ **behavior change ที่ผู้ใช้เห็น** (จอง 409→404, `markReadyForSale` เลิกใช้ label `'ราคาขายต่อ (Refurbished)'`, PO receive เลิกสร้าง label `'ราคาขาย'`, สวิตช์ "แสดงบนเว็บ" กดเปิดได้แม้ข้อมูลไม่ครบ), และ **Deployment section ด้านล่างคัดลอกมาทั้งก้อน**

---

## Deployment & Verification

### ลำดับ deploy (ห้ามสลับ)

> ⚠️ **ข้อเท็จจริงของ pipeline ที่ต้องยอมรับก่อน (ตรวจ `deploy-gcp.yml` แล้ว):** job `migrate-db` (:229-270, Cloud Run Job `bestchoice-migrate` + `--wait`) จบแล้ว job `deploy-api` (:279) **วิ่งต่อทันทีโดยอัตโนมัติ ไม่มีจุดให้คนเบรก** → **ไม่มีทาง** แทรก backfill ระหว่างกลางแบบที่แผนเวอร์ชันแรกเขียนไว้. ต้องเลือก 1 ใน 2:
>
> - **ทางที่ใช้จริง (แนะนำ):** ยอมรับหน้าต่างสั้นๆ ที่ readiness filter มีผลแต่ backfill ยังไม่รัน → หน้าเว็บลูกค้าว่างชั่วคราวไม่กี่นาที. **blast radius วันนี้ ≈ 0** เพราะ prod มีแต่ [DEMO] 7 เครื่อง (spec §0) ซึ่ง filter กรองออกอยู่แล้ว และ prod = testing-phase (memory `prod-is-testing-phase-data-wiped`). ต้องนั่งเฝ้า Actions แล้วรัน backfill ทันทีที่ `migrate-db` เขียว
> - **ทางที่ปลอดภัยกว่าถ้าตอน merge prod มีของจริงแล้ว:** merge PR ที่ **มีเฉพาะ Task 2 (migration) + Task 9 (script)** ก่อน → รัน backfill ให้จบ → ค่อย merge ส่วนที่เหลือ (Task 11 = ตัวที่เปิด filter) เป็น PR ที่สอง

1. **Merge PR → main** → GitHub Actions (`deploy-gcp.yml`) job `migrate-db` รัน `prisma migrate deploy` → `20260982000000` apply (ADD COLUMN nullable ล้วน ไม่มี NOT NULL ไม่มี default → ไม่ล็อกตาราง ไม่ต้อง downtime)
2. **ทันทีที่ job `migrate-db` เขียว** (ไม่ต้องรอ `deploy-api`) รัน backfill ผ่าน cloud-sql-proxy จากเครื่อง:
   ```bash
   # ① dry-run ดูก่อนเสมอ
   DATABASE_URL=<prod> npm --prefix apps/api run backfill:product-prices
   # ② ตรวจ bySource ว่าที่มาราคาสมเหตุผล (ควรเห็น cash:isDefault:ราคาขาย เป็นก้อนใหญ่)
   # ③ เขียนจริง
   APPLY=true DATABASE_URL=<prod> npm --prefix apps/api run backfill:product-prices
   ```
   > ⚠️ **ถ้าข้ามขั้นนี้ เว็บจะว่างเปล่าทั้งกระดาน** — readiness filter บังคับ `cashPrice > 0` แต่ prod ไม่มี writer คอลัมน์นี้มาก่อน B0 เลย
   > หมายเหตุ: script รันด้วย `tsx` จากเครื่อง dev (ไม่ได้ build ลง `dist/` เพราะ `scripts/` อยู่นอก tsconfig) → **รันเป็น Cloud Run Job ไม่ได้** ต้องผ่าน proxy เท่านั้น
3. `deploy-api` deploy Cloud Run revision ใหม่ → readiness filter มีผล (เกิดขึ้นเองระหว่างข้อ 2 — ดูกรอบเตือนด้านบน)

### Verify บน prod (หลัง deploy)

```sql
-- ① backfill ทำงานจริง
SELECT count(*) FILTER (WHERE cash_price IS NOT NULL) AS with_cash,
       count(*) FILTER (WHERE cash_price IS NULL)     AS without_cash
FROM products WHERE deleted_at IS NULL;

-- ② เครื่องที่จะขึ้นเว็บจริงหลัง B0 (ต้อง > 0 ไม่งั้น rollback)
SELECT count(*) FROM products
WHERE deleted_at IS NULL AND is_online_visible AND status = 'IN_STOCK'
  AND brand = 'Apple' AND category IN ('PHONE_NEW','PHONE_USED')
  AND cash_price > 0 AND array_length(gallery, 1) >= 1
  AND name NOT LIKE '[DEMO]%'
  AND (category <> 'PHONE_USED' OR (condition_grade IS NOT NULL AND condition_grade <> ''));

-- ③ ไม่มี product ไหนมีแถว isDefault เกิน 1 (invariant ของ write-through)
SELECT product_id, count(*) FROM product_prices
WHERE is_default AND deleted_at IS NULL GROUP BY product_id HAVING count(*) > 1;
```
- `curl https://<api>/api/health` → 200
- เปิด `https://www.bestchoicephone.com` (หรือ `bestchoicephone-shop.web.app`) → หน้ารายการต้องมีสินค้า, ไม่มี `[DEMO]`
- เปิด `/products/<id ของเครื่องที่ขายแล้ว>` → ต้องยัง render (permalink)

### สิ่งที่ owner ต้องทำ (ไม่ใช่โค้ด)

1. **ตอบคำถาม `installmentBestchoicePrice` ต่อเดือน vs ราคารวม** (`docs/superpowers/plans/2026-08-04-b0-owner-questions.md`) หลังดูผล `npm run survey:pricing-templates` บน prod
   - ตอบ "ราคารวม" → ตั้ง SystemConfig: `pricing_template_installment_semantics = 'TOTAL'` (SQL อยู่ในไฟล์คำถาม) → autofill เริ่มเติมราคาผ่อนให้เอง **ไม่ต้อง deploy ใหม่**
   - ตอบ "ต่อเดือน" → ไม่ต้องทำอะไร (default = `PER_MONTH`)
2. **รีวิว log `bySource` ของ backfill** ว่าราคาที่ยกมาตรงราคาขายจริง (spec §9.4)
3. **กรอกตารางราคากลางให้ครบทุกรุ่นที่ขาย** — autofill จะเงียบทันทีถ้าไม่มีแถวตรงรุ่น
4. **ล้าง [DEMO] ก่อนเปิดจริง**: `CLEAN=1 bash scripts/seed-demo-products-prod.sh` (B0 มี filter กันไว้แล้ว แต่ยังกินที่ในหน้า admin)
5. **อัปโหลดรูปขึ้นเว็บ + ใส่เกรดมือสอง** ให้เครื่องที่อยากให้ขึ้นเว็บ — checklist ที่ `GET /products/:id/readiness` บอกทีละข้อ (UI ของ checklist มาใน B1)

### Rollback

- โค้ด: revert PR → deploy ทับ (readiness filter หายไป, คอลัมน์ราคายังอยู่ ไม่กระทบ)
- migration: **ไม่ต้อง rollback** — 3 คอลัมน์ nullable ไม่มีผู้อ่านในโค้ดเก่า
- backfill: **ไม่ reversible** โดยตรง (เขียนคอลัมน์ที่เคย null) แต่ค่าที่เขียนมาจาก `prices[]` ที่ยังอยู่ครบ → re-derive ได้เสมอ

---

## สิ่งที่ batch นี้ไม่ทำ (ตัดตาม scope ของ spec)

- **ซ่อน `costPrice` จาก SALES ฝั่ง server** → B1 (spec §3) — B0 ไม่แตะ response shape ของ `/products`
- **UI ทั้งหมด**: ช่องกรอกราคาใหม่, badge "เติมอัตโนมัติจากตารางราคากลาง", การ์ด readiness, ปุ่มคัดลอกสรุป/ลิงก์ → B1 (B0 ส่งแค่ endpoint + ฟิลด์ให้)
- **Inbox / ส่งรูป / product picker** → B2 (spec §4)
- **บอท**: `search_products` ยกเครื่อง, `attachments` ใน `SalesBotResult`, re-point `get-installment-rates.tool` มาใช้ `device-query-normalize.util`, grounding-guard fixture, น้องเบส → B3 (spec §5). B0 สร้าง util ไว้เฉยๆ ไม่แตะ tool
- **เว็บลูกค้า**: share endpoint/OG, ค้นหาไทยในหน้ารายการ, `monthlyPaymentFrom` ที่ใช้ rate จริง, รูปตามเครื่อง → B4 (spec §6). B0 แก้เฉพาะ null→0
- **จอง/จ่ายเงิน**: guard ใน `confirmOnlineOrderPayment`, รู `confirmBankTransfer`, preempt-in-tx, badge แจ้ง staff → B5 (spec §7)
- **แก้ข้อมูลย้อนหลัง / reconcile ราคาเก่า** — prod เป็น testing-phase, forward-fix only (memory `prod-is-testing-phase-data-wiped`); backfill ทำแค่ยก `prices[]` ที่มีอยู่ขึ้นคอลัมน์ ไม่แก้ตัวเลขให้ถูกต้อง
- **ลบ fallback `prices[]` ออกจาก `getDisplayPrices`** — spec §2.1 สั่งคงไว้ (ProductsPage/POSPage ยังส่ง object ที่มีแต่ `prices[]`); เก็บกวาดใน release หลัง
- **`/p/:slug`, dynamic sitemap, `ChatRoom.attachedProductId`, ตัวแปรสินค้าใน canned responses** — ตัดถาวรตาม spec §1
