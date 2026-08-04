# B1 — หน้าสินค้า admin ตอบลูกค้าได้ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้แอดมิน/พนักงานขายเปิดหน้า `/products/:id` แล้ว **ตอบลูกค้าได้จบในหน้าเดียว** — ราคาเงินสด/ผ่อน (คอลัมน์จริง), ค่างวดเริ่มต้น, สภาพเครื่อง (เกรด/แบต/ประกันร้าน/อุปกรณ์/ตำหนิ), ผลตรวจ QC รายข้อ, สถานะพร้อมขึ้นเว็บ, เครื่องอื่นรุ่นเดียวกัน, โปรที่ใช้ได้ — พร้อมปุ่ม **คัดลอกสรุปส่งลูกค้า** และ **คัดลอกลิงก์** และ **ซ่อนราคาทุน/กำไรจาก SALES ที่ฝั่ง server** — spec: `docs/superpowers/specs/2026-08-04-product-answering-readiness-design.md` §3 (ข้อเท็จจริงฐาน §0, ข้อตัดสินใจ owner §1, งาน owner §9, หลักปฏิบัติ §10)

**Architecture:** ฝั่ง api แตะ 4 จุดเล็ก (strip `costPrice` ตาม role ที่ controller ตาม precedent `staff-chat.controller.ts:126-135`, ขยาย filter ของ `GET /products`, ขยาย `@Roles` ของ `GET /promotions/active`, เติมฟิลด์ที่ B1 แก้เข้า `UpdateProductDto`) — **ไม่มี migration ไม่มี endpoint ใหม่**. ฝั่ง web ยกเครื่อง `ProductDetailPage` เป็นการ์ดย่อย โดยแกนคำนวณ/ประกอบข้อความเป็น **pure function แยกไฟล์** (`buildCustomerSummary.ts`) ที่เรียก `calcBcInstallment` ตรง (BcCalculatorCard ไม่ expose state ออกมา) เพื่อให้ทดสอบได้เต็มโดยไม่ต้อง render

**Tech Stack:** NestJS + Prisma (apps/api), React 18 + React Query + Tailwind/shadcn (apps/web), `@installment/shared` (`calcBcInstallment`, decimal.js), jest (api) / vitest + Testing Library (web)

## Global Constraints

- **Branch:** `feat/pa-b1-admin-product-page` (แตกจาก `main` ที่ merge B0 แล้ว — ดู Pre-flight)
- **⚠️ B1 ต้อง deploy ติดกับ B0 (วันเดียวกัน) ห้ามทิ้งช่วงหลายวัน** — B0 ย้าย "แหล่งราคาจริง" ไปที่คอลัมน์ `Product.cashPrice`/`installmentPrice` (เว็บลูกค้า + readiness อ่านคอลัมน์) แต่ **ไม่มี UI ไหนในระบบเขียนคอลัมน์นี้ได้เลย** จนกว่า B1 จะขึ้น — ตรวจโค้ดจริงแล้ว: หน้าสินค้าเดิมแก้ได้แค่แถว `ProductPrice` (`ProductDetailPage/index.tsx` price CRUD), `ProductCreatePage` ก็ส่ง `prices[]` เป็นแถว (`index.tsx:96-111`), ส่วน `PricingTemplatesPage` เป็นตารางราคากลางคนละตัว. ผลของช่องว่างนี้คือ พนักงาน "ตั้งราคาแล้ว" ผ่านตารางเดิมแต่ **เครื่องไม่ขึ้นเว็บ** และคอลัมน์กับแถวขัดกันเงียบๆ (POS/สัญญาอ่านแถว, เว็บอ่านคอลัมน์)
  - ส่วนที่ **ปลดล็อกช่วงนี้** คือ Task 7 เฉพาะ `EditSellingPriceModal` (2 input: ราคาเงินสด/ราคาผ่อน) + mutation ที่ยิง `PATCH /products/:id` เดิม (ฟิลด์เปิดรับใน Task 4) — ไม่ต้องพึ่งการ์ด/ปุ่มอื่นของ B1 เลย
  - ถ้า owner อยากแยก deploy จริงๆ ให้ **ยกเฉพาะส่วนนั้น (Task 4 + Task 7 Step 3/4 สร้าง `SellingPriceCard`+`EditSellingPriceModal` + Step 6 เฉพาะครึ่ง "เพิ่มของใหม่" คือ state ราคา + `useMutation` PATCH + invalidate `['product', id]`) ไปเป็น task ท้ายของ B0** แล้วปล่อย B1 ที่เหลือตามหลังได้ — ห้ามปล่อย B0 ขึ้น prod โดยไม่มีทางเขียนคอลัมน์ราคา
- **ไม่มี migration ใน batch นี้** (B0 = `20260982000000`, B3 = `20260983000000`; ถ้าจำเป็นต้องมีจริงให้เช็ค max ก่อนเสมอ — B1 ไม่ควรมี)
- **Red line:** ห้ามแตะ accounting/finance JE paths ทุกกรณี; ห้ามแก้สูตรใน `packages/shared/src/installment-calc.ts` และ `apps/api/src/utils/installment-calc.util.ts` — batch นี้ **เรียกใช้อย่างเดียว**; golden ที่ pin ไว้คือ `installmentPrice=19900, months=12, minDownPct=0.15, commissionPct=0.10, vatPct=0.07, rate12=0.50` → `downAmount=2985`, `monthlyPayment=2413.21` (ตรงกับ `apps/web/src/pages/ProductDetailPage/components/__tests__/BcCalculatorCard.test.tsx`)
- **เงิน:** api ใช้ `Prisma.Decimal`; web คำนวณผ่าน `calcBcInstallment` (decimal.js) แล้วค่อย `.toNumber()` ตอนแสดงผลเท่านั้น — ห้ามคำนวณค่างวดด้วย `number` เอง
- **ฟอร์แมตเงินในข้อความคัดลอก** ใช้ `formatBaht()` ของ batch นี้ (ไม่พึ่ง `Intl`/locale ของเครื่อง) เพื่อให้เทสต์ deterministic
- **เทสต์:**
  - api = **jest** เท่านั้น → `cd apps/api && npx jest --runInBand src/modules/products/products.controller.spec.ts` (`apps/api/package.json:145-171`: rootDir `src`, testRegex `.*\.spec\.ts$`; `--runInBand` อยู่ใน npm script `test` ไม่ได้ติดมากับ `npx jest` — ใส่เองทุกครั้ง; อาร์กิวเมนต์เป็น **regex เทียบกับ path เต็ม** จึงพิมพ์ `src/...` ได้ปกติ)
  - web = **vitest** (repo นี้ apps/web ไม่มี jest ติดตั้ง — `apps/web/package.json:11` = `vitest run`, glob `src/**/*.{test,spec}.{ts,tsx}`) → `cd apps/web && npx vitest run src/pages/ProductDetailPage/utils/buildCustomerSummary.test.ts`
  - ห้ามใช้ DB-backed vitest นอก `apps/api/src/modules/journal/cpa-templates/`
- **UI copy ภาษาไทยทั้งหมด**; ห้าม hardcoded hex/`text-gray-*`/`bg-white` — ใช้ design tokens (`bg-card`, `text-muted-foreground`, `border-border`, …); ข้อความไทยใช้ `leading-snug`
- **Data fetching** ใช้ `useQuery`/`useMutation` + `api` จาก `@/lib/api` เท่านั้น; หลัง mutation ต้อง `queryClient.invalidateQueries({ queryKey: ['product', id] })`
- **Role ที่ใช้ในหน้า:** `canEditProduct = OWNER|BRANCH_MANAGER`, `canSeeCost = role !== 'SALES'`, `canCreateContract = OWNER|BRANCH_MANAGER|SALES` (ตรงกับ `App.tsx:509-515`)
- ทุกจุดที่จบ Task ต้อง `cd apps/api && npx tsc --noEmit` = 0 และ `cd apps/web && npx tsc --noEmit` = 0 (แตะแอปไหนเช็คแอปนั้น) — รันแยกคำสั่ง **ห้ามร้อยด้วย `&&` กับ eslint** เพราะจะกลืน exit code ของกันและกัน
- **Lint (คำสั่งที่ใช้ได้จริง — ยืนยันแล้ว 2026-08-04, ถ้อยคำเดียวกับ B0 Global Constraints):**
  - api: `cd apps/api && npx eslint src/<path ที่แก้>` (เฉพาะไฟล์ใน `src/`) และ gate ของ CI คือ `npm run lint --workspace=apps/api` (= `eslint "{src,test}/**/*.ts" --fix`)
    ⚠️ **ห้ามใช้ `cd apps/api && npx eslint .` เป็น gate ปิด batch** — รันจริงวันนี้ได้ **exit 1 / 34 error ที่ค้างมาก่อน B1** ล้วนเป็น `Parsing error` ของไฟล์ที่อยู่นอก `include` ของ `apps/api/tsconfig.json` (`e2e/*.e2e-spec.ts`, `scripts/*.ts`, `eslint.config.mjs`) → เกณฑ์คือ **ไม่เพิ่ม error ใหม่ (baseline 34)** ไม่ใช่ 0 สัมบูรณ์. **ห้ามไปแก้ `tsconfig.json` / `eslint.config.mjs` เพื่อไล่ 34 error นี้ — อยู่นอก scope ของ B1**
  - web: `cd apps/web && npx eslint .` → **0 error จริง** (513 warning ค้าง — ปล่อยได้) จึงใช้เป็น gate 0-error ได้เฉพาะฝั่ง web
- ทุก commit ลงท้ายด้วย:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- QA เบราว์เซอร์ทำบน **local เท่านั้น** (`admin@bestchoice.com / admin1234`, `sales1@bestchoice.com / admin1234` — prod ปฏิเสธ seed accounts)

## Pre-flight (ทำก่อน Task 1 — B1 พึ่ง B0)

- [ ] **P1:** ยืนยันว่า B0 อยู่บน main แล้ว:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git checkout main && git pull
grep -n "readiness" apps/api/src/modules/products/products.controller.ts
grep -n "priceAutofilledAt\|accessoriesIncluded\|cosmeticNotes" apps/api/prisma/schema.prisma
ls apps/api/src/modules/products/product-readiness.util.ts
```
ทั้ง 3 คำสั่งต้องเจอของ ถ้าไม่เจอ = B0 ยังไม่ merge → **หยุด** แล้วแจ้งผู้เรียก (B1 ไม่มีทางทำ readiness card / badge autofill / ฟิลด์อุปกรณ์+ตำหนิได้)
> หมายเหตุที่ verify กับ main `8a8982e4b` แล้ว: `Product.cashPrice` + `Product.installmentPrice` (schema.prisma:1640-1641) และ `Product.shopWarrantyDays` (:1651) + `Product.conditionGrade` (:1700) **มีอยู่บน main แล้ววันนี้** — ของที่ B0 เพิ่มจริงคือ `priceAutofilledAt` / `accessoriesIncluded` / `cosmeticNotes` (migration `20260982000000`) + endpoint readiness + write-through/autofill เท่านั้น
- [ ] **P2:** จด shape จริงของ `GET /products/:id/readiness` จากโค้ด B0 (controller + util) แล้วเทียบกับ contract ที่ Task 8 ใช้ — คาดว่าเป็น `{ productId, isReady, isOnlineVisible, checks[] , priceAutofilledAt, hasInstallmentPrice }` (B0 ล็อกชื่อเป็น **`isReady`** ไม่ใช่ `ready` และคืน `isOnlineVisible` มาด้วย). ถ้าชื่อ field ต่างจากนี้ ให้แก้ **ที่ `useProductReadiness.ts` จุดเดียว** (adapter) ห้ามแก้ `ReadinessCard` — และเพราะ fixture ของเทสต์ import type จาก adapter ตัวนี้ การเปลี่ยนชื่อจะทำให้ `tsc`/vitest แดงเองทันที
- [ ] **P3:** แตกกิ่ง: `git checkout -b feat/pa-b1-admin-product-page`

---

## File Structure

**apps/api (แตะ 4 ไฟล์ + 3 spec ใหม่)**
```
apps/api/src/modules/products/
  cost-visibility.util.ts            [CREATE] canSeeCost() + omitCostPrice() + redactStockSummary() — จุดเดียวที่ตัดสินว่า SALES เห็นทุนไหม
  products.controller.ts             [MODIFY] Task 1: findAll/getStock/findOne → strip costPrice ตาม role · Task 2: findAll รับ model/storage
  products.controller.spec.ts        [CREATE] jest: SALES ไม่ได้ costPrice / OWNER ได้
  products.service.ts                [MODIFY] findAll รับ model/storage/status (array หรือ comma)
  products.service.spec.ts           [MODIFY] + describe ใหม่ของ findAll filters
  dto/update-product.dto.ts          [MODIFY] เติมฟิลด์ที่ B1 แก้ (idempotent กับ B0)
  dto/update-product.dto.spec.ts     [CREATE] jest: validate 6 ฟิลด์ผ่าน/ไม่ผ่าน
apps/api/src/modules/promotions/
  promotions.controller.ts           [MODIFY] @Roles ของ findActive += FINANCE_MANAGER, ACCOUNTANT
  promotions.controller.spec.ts      [CREATE] jest: pin role metadata
```

**apps/web**
```
apps/web/src/lib/env.ts                                   [MODIFY] + SHOP_BASE_URL
apps/web/src/pages/ProductDetailPage/
  index.tsx                                               [MODIFY] wiring การ์ดใหม่ + ลบ price CRUD เดิม
  utils/buildCustomerSummary.ts                            [CREATE] formatBaht / computeDefaultBcInstallment / buildCustomerSummary / buildShopProductUrl (pure ทั้งหมด)
  utils/buildCustomerSummary.test.ts                       [CREATE] vitest — แกนของ batch
  hooks/useProductReadiness.ts                             [CREATE] adapter ครอบ GET /products/:id/readiness
  hooks/useCustomerSummary.ts                              [CREATE] รวม product + bcConfig → summaryText/shareUrl
  components/ProductInfo.tsx                               [MODIFY] canSeeCost + ฟิลด์สภาพเครื่อง + ตาราง prices read-only
  components/SellingPriceCard.tsx                          [CREATE] ราคาเงินสด/ผ่อน + badge autofill + ปุ่มแก้ราคา
  components/EditSellingPriceModal.tsx                     [CREATE] ฟอร์มเขียน cashPrice/installmentPrice
  components/ReadinessCard.tsx                             [CREATE] checklist ขึ้นเว็บ (presentational ล้วน)
  components/CustomerSummaryActions.tsx                    [CREATE] ปุ่มคัดลอกสรุป + คัดลอกลิงก์
  components/SameModelCard.tsx                             [CREATE] เครื่องอื่นรุ่นเดียวกัน
  components/ActivePromotionsCard.tsx                      [CREATE] โปรที่ใช้ได้ตอนนี้
  components/QcResultsCard.tsx                             [CREATE] ผลตรวจ QC รายข้อ
  components/EditProductModal.tsx                          [MODIFY] + เกรด/ประกันร้าน/อุปกรณ์/ตำหนิ
  components/InstallmentCalculatorCard.tsx                 [MODIFY] แก้ลิงก์ตาย → onEditPrice + ส่ง canCreateContract
  components/BcCalculatorCard.tsx                          [MODIFY] prop canCreateContract ซ่อนปุ่มทำสัญญา
  components/OnlineListingPanel.tsx                        [MODIFY] ใช้ ReadinessCard แทน missingReasons
apps/web/src/pages/StockPage/
  types.ts / hooks/useStockOverview.ts /
  components/StockHeroKpi.tsx / components/BranchSummaryCards.tsx   [MODIFY] รองรับ totalValue = null (SALES)
apps/web/src/App.tsx                                       [MODIFY] route /products/:id += FINANCE_MANAGER, ACCOUNTANT
```

---

### Task 1: API — ซ่อน `costPrice` จาก SALES ที่ฝั่ง server

**Files:**
- Create: `apps/api/src/modules/products/cost-visibility.util.ts`
- Create: `apps/api/src/modules/products/products.controller.spec.ts`
- Modify: `apps/api/src/modules/products/products.controller.ts` (findAll :33-49, getStock :51-66, findOne :143-147)

> **Task นี้ไม่แตะ `model`/`storage`** — query params ใหม่อยู่ใน Task 2 ทั้งชุด (controller + service ในคอมมิตเดียว) เพื่อไม่ให้มีช่วงที่ controller ส่งฟิลด์ที่ service ยังไม่รับ (ts-jest จะคอมไพล์ไม่ผ่านทั้งไฟล์ ทำให้ Step 5 ของ Task นี้ไม่มีทางเขียว)
> `apps/web/src/pages/StockPage/types.ts:22` (`totalValue: number` → `number | null`) ทำใน Task 6 (งาน web) — Task นี้ api ล้วน

**Interfaces:**
- Consumes: `ProductsService.findAll(filters) → PaginatedResponse<Product>` (`{ data, total, page, limit, totalPages }` จาก `common/helpers/pagination.helper.ts:5-11`), `ProductsService.findOne(id) → Product & {...productInclude}` (`products.service.ts:71-78`), `ProductsStockService.getStock(filters) → { products, total, page, limit, totalPages, summary: { branch: {id,name}, total, inStock, totalValue: number }[] }` (`services/stock-overview.service.ts:72-81`), `@CurrentUser() user: { role: string }` (decorator มี import อยู่แล้วที่ `products.controller.ts:19`)
- Produces:
```ts
export function canSeeCost(role: string | undefined | null): boolean;
export function omitCostPrice<T extends { costPrice?: unknown }>(row: T): Omit<T, 'costPrice'>;
export function redactStockSummary<T extends { totalValue: number }>(
  rows: T[],
): (Omit<T, 'totalValue'> & { totalValue: number | null })[];
```

- [ ] **Step 1:** เขียนเทสต์ที่ fail ก่อน — `apps/api/src/modules/products/products.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsPricingService } from './products-pricing.service';
import { ProductsStockService } from './products-stock.service';
import { ProductsOnlineListingService } from './products-online-listing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

/**
 * Owner decision 2026-08-04 §1.4: ซ่อนราคาทุน/กำไรจาก SALES ต้องบังคับที่ฝั่ง
 * server ไม่ใช่แค่ซ่อน DOM. precedent = staff-chat.controller.ts:126-135
 * (SALES → nationalId: null).
 */
describe('ProductsController — cost visibility by role', () => {
  const productRow = { id: 'p-1', name: 'iPhone 13', costPrice: '12000', cashPrice: '15900' };
  let controller: ProductsController;
  let products: { findAll: jest.Mock; findOne: jest.Mock };
  let stock: { getStock: jest.Mock };

  beforeEach(async () => {
    products = {
      findAll: jest.fn().mockResolvedValue({
        data: [{ ...productRow }],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      }),
      findOne: jest.fn().mockResolvedValue({ ...productRow }),
    };
    stock = {
      getStock: jest.fn().mockResolvedValue({
        products: [{ ...productRow }],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
        summary: [{ branch: { id: 'b-1', name: 'ลาดพร้าว' }, total: 3, inStock: 2, totalValue: 24000 }],
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: products },
        { provide: ProductsPricingService, useValue: {} },
        { provide: ProductsStockService, useValue: stock },
        { provide: ProductsOnlineListingService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ProductsController);
  });

  const sales = { role: 'SALES', branchId: 'b-1' };
  const owner = { role: 'OWNER', branchId: null };

  it('GET /products — SALES ไม่ได้ costPrice, ฟิลด์อื่นครบ', async () => {
    const res = await controller.findAll({ page: 1, limit: 50 }, sales);
    expect(res.data[0]).not.toHaveProperty('costPrice');
    expect(res.data[0].cashPrice).toBe('15900');
    expect(res.total).toBe(1);
  });

  it('GET /products — OWNER ยังได้ costPrice', async () => {
    const res = await controller.findAll({ page: 1, limit: 50 }, owner);
    expect(res.data[0]).toHaveProperty('costPrice', '12000');
  });

  it('GET /products/:id — SALES ไม่ได้ costPrice / OWNER ได้', async () => {
    expect(await controller.findOne('p-1', sales)).not.toHaveProperty('costPrice');
    expect(await controller.findOne('p-1', owner)).toHaveProperty('costPrice', '12000');
  });

  it('GET /products/stock — SALES ไม่ได้ costPrice และ summary.totalValue เป็น null', async () => {
    const res = await controller.getStock({ page: 1, limit: 50 }, sales);
    expect(res.products[0]).not.toHaveProperty('costPrice');
    expect(res.summary[0].totalValue).toBeNull();
    expect(res.summary[0].inStock).toBe(2);
  });

  it('GET /products/stock — OWNER ได้ทั้ง costPrice และ totalValue', async () => {
    const res = await controller.getStock({ page: 1, limit: 50 }, owner);
    expect(res.products[0]).toHaveProperty('costPrice', '12000');
    expect(res.summary[0].totalValue).toBe(24000);
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail (ts-jest คอมไพล์ไม่ผ่านเพราะ signature ยังไม่มี param `user`):
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest --runInBand src/modules/products/products.controller.spec.ts
```
คาดหวัง: FAIL (TS error `Expected 1 arguments, but got 2` ที่ `controller.findAll(..., sales)` / `controller.findOne('p-1', sales)`)

- [ ] **Step 3:** สร้าง `apps/api/src/modules/products/cost-visibility.util.ts`:

```ts
/**
 * จุดเดียวที่ตัดสินว่าใครเห็น "ราคาทุน" — owner decision 2026-08-04 §1.4:
 * SALES ต้องไม่เห็นราคาทุน/กำไร และต้องบังคับที่ฝั่ง server (การซ่อนใน DOM
 * อย่างเดียวเปิด response ดิบดูได้). Mirror ของ precedent per-field redaction
 * ที่ staff-chat.controller.ts:126-135 (SALES → nationalId: null).
 */
export function canSeeCost(role: string | undefined | null): boolean {
  return role !== 'SALES';
}

/** ตัดคีย์ costPrice ออกจาก row (ไม่แตะฟิลด์อื่น) */
export function omitCostPrice<T extends { costPrice?: unknown }>(row: T): Omit<T, 'costPrice'> {
  const { costPrice: _costPrice, ...rest } = row;
  return rest;
}

/**
 * summary ของ getStock มี totalValue = ผลรวม costPrice ของสาขา — เป็นข้อมูลทุน
 * เช่นกัน. คืน null (ไม่ใช่ 0) เพื่อให้ UI แยกออกระหว่าง "ไม่มีสิทธิ์ดู" กับ
 * "มูลค่าเป็นศูนย์จริง".
 */
export function redactStockSummary<T extends { totalValue: number }>(
  rows: T[],
): (Omit<T, 'totalValue'> & { totalValue: number | null })[] {
  return rows.map(({ totalValue: _totalValue, ...rest }) => ({ ...rest, totalValue: null }));
}
```

- [ ] **Step 4:** แก้ `products.controller.ts` — import util + เปลี่ยน 3 handler (คงลำดับ decorator เดิม, param ที่ required ต้องมาก่อน optional):

```ts
import { canSeeCost, omitCostPrice, redactStockSummary } from './cost-visibility.util';
```

```ts
  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async findAll(
    @Query() pagination: PaginationDto,
    @CurrentUser() user: { role: string },
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    const result = await this.productsService.findAll({
      search, branchId, status, category, brand, supplierId,
      page: pagination.page,
      limit: pagination.limit,
    });
    if (canSeeCost(user.role)) return result;
    return { ...result, data: result.data.map(omitCostPrice) };
  }

  @Get('stock')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async getStock(
    @Query() pagination: PaginationDto,
    @CurrentUser() user: { role: string },
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
  ) {
    const result = await this.productsStockService.getStock({
      search, branchId, status, category, brand,
      page: pagination.page,
      limit: pagination.limit,
    });
    if (canSeeCost(user.role)) return result;
    return {
      ...result,
      products: result.products.map(omitCostPrice),
      summary: redactStockSummary(result.summary),
    };
  }
```

```ts
  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async findOne(@Param('id') id: string, @CurrentUser() user: { role: string }) {
    const product = await this.productsService.findOne(id);
    return canSeeCost(user.role) ? product : omitCostPrice(product);
  }
```

> หมายเหตุ: 3 handler นี้เปลี่ยนจาก sync เป็น `async` (เพราะต้อง `await` ก่อน map) — ไม่กระทบ Nest (คืน Promise ได้อยู่แล้ว) และไม่มี caller ฝั่ง api ที่เรียก method เหล่านี้ตรงๆ

- [ ] **Step 5:** รันเทสต์ให้ผ่าน:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest --runInBand src/modules/products/products.controller.spec.ts
```
คาดหวัง: 5 passed

- [ ] **Step 6:** `cd apps/api && npx tsc --noEmit` → 0 errors
- [ ] **Step 7:** Commit: `feat(products): ซ่อน costPrice จาก SALES ที่ฝั่ง server (findAll/findOne/stock)`

---

### Task 2: API — `GET /products` รับ `model` / `storage` / `status` ซ้ำได้

**Files:**
- Modify: `apps/api/src/modules/products/products.service.ts` (`findAll` :27-69 — signature :27-36, where builder :37-43)
- Modify: `apps/api/src/modules/products/products.controller.ts` (`findAll` — เพิ่ม `@Query('model')` / `@Query('storage')` + เปลี่ยน type ของ `status` เป็น `string | string[]`; ทำ **ในคอมมิตเดียวกับ service** เพื่อไม่ให้มีสถานะกลางที่ tsc พัง)
- Modify: `apps/api/src/modules/products/products.service.spec.ts` (เพิ่ม describe ใหม่ท้ายไฟล์ — ไฟล์นี้ import `Test, TestingModule, ProductsService, PrismaService` ไว้แล้วที่ :1-4 ไม่ต้องเพิ่ม import)

**Interfaces:**
- Consumes: `prisma.product.findMany/count`
- Produces:
```ts
findAll(filters: {
  search?: string; branchId?: string;
  status?: string | string[];   // 'IN_STOCK' | ['IN_STOCK','RESERVED'] | 'IN_STOCK,RESERVED'
  category?: string; brand?: string; supplierId?: string;
  model?: string; storage?: string;
  page?: number; limit?: number;
}): Promise<PaginatedResponse<Product>>
```
- พฤติกรรม: 1 ค่า → `where.status = 'IN_STOCK'` (เท่าเดิม, backward compatible); หลายค่า → `where.status = { in: [...] }`; `model`/`storage` = exact match; ค่าว่าง/`''` ถูกทิ้ง

- [ ] **Step 1:** เขียนเทสต์ที่ fail — ต่อท้าย `products.service.spec.ts`:

```ts
describe('ProductsService.findAll — filters สำหรับการ์ด "เครื่องอื่นรุ่นเดียวกัน" (B1)', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
  });

  const whereOf = () => prisma.product.findMany.mock.calls[0][0].where;

  it('กรอง model + storage แบบ exact', async () => {
    await service.findAll({ model: 'iPhone 13', storage: '128GB' });
    expect(whereOf()).toMatchObject({ deletedAt: null, model: 'iPhone 13', storage: '128GB' });
  });

  it('status เดี่ยว = ค่าเดิม (ไม่ใช่ { in: [...] })', async () => {
    await service.findAll({ status: 'IN_STOCK' });
    expect(whereOf().status).toBe('IN_STOCK');
  });

  it('status เป็น array → { in: [...] }', async () => {
    await service.findAll({ status: ['IN_STOCK', 'RESERVED'] });
    expect(whereOf().status).toEqual({ in: ['IN_STOCK', 'RESERVED'] });
  });

  it('status เป็น comma string → { in: [...] } (กัน query serializer ต่างกัน)', async () => {
    await service.findAll({ status: 'IN_STOCK,RESERVED' });
    expect(whereOf().status).toEqual({ in: ['IN_STOCK', 'RESERVED'] });
  });

  it('ค่าว่างถูกทิ้ง — ไม่โผล่ใน where', async () => {
    await service.findAll({ model: '', storage: '', status: '' });
    const where = whereOf();
    expect(where).not.toHaveProperty('model');
    expect(where).not.toHaveProperty('storage');
    expect(where).not.toHaveProperty('status');
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest --runInBand src/modules/products/products.service.spec.ts
```
คาดหวัง: **FAIL ทั้งไฟล์ที่ระดับ ts-jest** — `service.findAll({ model: 'iPhone 13', storage: '128GB' })` เป็น object literal ที่มี property เกินจาก signature ปัจจุบัน (`products.service.ts:27-36` ไม่มี `model`/`storage`) → TS2353. (ถ้าปิด diagnostics แล้วรันได้จริง จะ fail 3 เคส: model+storage, status array, status comma — ส่วน "status เดี่ยว" กับ "ค่าว่างถูกทิ้ง" ผ่านอยู่แล้วกับโค้ดเดิม `if (filters.status) where.status = filters.status`)

- [ ] **Step 3:** แก้ `products.service.ts` — signature + where builder:

```ts
  async findAll(filters: {
    search?: string;
    branchId?: string;
    status?: string | string[];
    category?: string;
    brand?: string;
    model?: string;
    storage?: string;
    supplierId?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.branchId) where.branchId = filters.branchId;
    // status รับได้ทั้ง ?status=A, ?status=A&status=B (array) และ ?status=A,B
    // — FE ของ B1 ส่งแบบ comma เพื่อไม่ต้องพึ่ง query serializer ของ axios
    const statuses = (Array.isArray(filters.status) ? filters.status : [filters.status ?? ''])
      .flatMap((s) => String(s).split(','))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (statuses.length === 1) where.status = statuses[0];
    else if (statuses.length > 1) where.status = { in: statuses };
    if (filters.category) where.category = filters.category;
    if (filters.brand) where.brand = filters.brand;
    if (filters.model) where.model = filters.model;
    if (filters.storage) where.storage = filters.storage;
    if (filters.supplierId) where.supplierId = filters.supplierId;
```
(ที่เหลือของเมธอด — search :45-52 / page-limit :54-55 / findMany+count :57-68 — คงเดิมทุกบรรทัด)

- [ ] **Step 4:** แก้ `products.controller.ts` `findAll` (ที่ Task 1 เพิ่ม `@CurrentUser()` ไว้แล้ว) ให้ส่งฟิลด์ใหม่ต่อ — เปลี่ยนแค่ 3 บรรทัด:

```ts
    @Query('status') status?: string | string[],
```
```ts
    @Query('model') model?: string,
    @Query('storage') storage?: string,
```
```ts
    const result = await this.productsService.findAll({
      search, branchId, status, category, brand, supplierId, model, storage,
      page: pagination.page,
      limit: pagination.limit,
    });
```
(param ที่ required — `pagination`, `user` — ต้องอยู่ก่อน optional เสมอ; `model`/`storage` ต่อท้ายสุด)

- [ ] **Step 5:** รันเทสต์ทั้งไฟล์ + ไฟล์ controller ให้ผ่าน:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest --runInBand src/modules/products
```
คาดหวัง: describe เดิม (transferOwnership 5 เคส) + describe ใหม่ 5 เคส + controller spec 5 เคส + `products-online-listing.service.spec.ts` เดิม — เขียวทั้งหมด

- [ ] **Step 6:** `cd apps/api && npx tsc --noEmit` → 0 errors
- [ ] **Step 7:** Commit: `feat(products): findAll รับ model/storage/status หลายค่า (การ์ดเครื่องรุ่นเดียวกัน B1)`

---

### Task 3: API — เปิด `GET /promotions/active` ให้ FINANCE_MANAGER + ACCOUNTANT

**Files:**
- Modify: `apps/api/src/modules/promotions/promotions.controller.ts:40-44` (`findActive` — ปัจจุบัน `@Roles('OWNER','BRANCH_MANAGER','SALES')`)
- Create: `apps/api/src/modules/promotions/promotions.controller.spec.ts`

**Interfaces:**
- Consumes: `PromotionsService.findActivePromotions() → Promotion[]` (`promotions.service.ts:54-68` — คืน row เต็มของ `Promotion` รวม `name`/`description`/`endDate` ตาม schema.prisma:4765-4787)
- Produces: `@Roles('OWNER','BRANCH_MANAGER','FINANCE_MANAGER','ACCOUNTANT','SALES')` บน `findActive`
- เหตุผล: B1 เปิด route `/products/:id` ให้ FM/ACCOUNTANT (Task 12) — ถ้าไม่ขยาย role การ์ดโปรจะยิง 403 ทันทีที่ FM/ACC เปิดหน้า

- [ ] **Step 1:** เขียนเทสต์ที่ fail — `apps/api/src/modules/promotions/promotions.controller.spec.ts` (อ่าน metadata ตรงจาก prototype ไม่ต้อง compile Nest module — `ROLES_KEY = 'roles'` ที่ `auth/decorators/roles.decorator.ts:3`):

```ts
import { Reflector } from '@nestjs/core';
import { PromotionsController } from './promotions.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

/**
 * B1 เปิดหน้า /products/:id ให้ FINANCE_MANAGER + ACCOUNTANT — การ์ด
 * "โปรที่ใช้ได้ตอนนี้" กิน GET /promotions/active จึงต้องเปิด role ให้ตรงกัน
 * ไม่งั้นหน้าโหลดมาแล้วการ์ดเดียว 403. เทสต์นี้ pin metadata กันหดกลับ.
 */
describe('PromotionsController — role metadata ของ GET /promotions/active', () => {
  const reflector = new Reflector();

  const rolesOn = (methodName: string): string[] | undefined => {
    const handler = (PromotionsController.prototype as unknown as Record<string, unknown>)[
      methodName
    ];
    if (typeof handler !== 'function') return undefined;
    return reflector.get<string[]>(ROLES_KEY, handler);
  };

  it('findActive เปิดให้ 5 role ที่เข้าหน้าสินค้าได้', () => {
    const roles = rolesOn('findActive');
    expect(roles).toBeDefined();
    expect(roles).toEqual(
      expect.arrayContaining([
        'OWNER',
        'BRANCH_MANAGER',
        'FINANCE_MANAGER',
        'ACCOUNTANT',
        'SALES',
      ]),
    );
  });

  it('การสร้าง/แก้/ลบ โปรยังเป็น OWNER เท่านั้น (ไม่ถูกเผลอขยายตาม)', () => {
    expect(rolesOn('create')).toEqual(['OWNER']);
    expect(rolesOn('update')).toEqual(['OWNER']);
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest --runInBand src/modules/promotions/promotions.controller.spec.ts
```
คาดหวัง: 1 fail (`findActive` ปัจจุบัน `['OWNER','BRANCH_MANAGER','SALES']`) + 1 pass (create/update = `['OWNER']` อยู่แล้วที่ :52-62)

- [ ] **Step 3:** แก้ `promotions.controller.ts:40-44`:

```ts
  @Get('active')
  // B1: FM/ACCOUNTANT เปิดหน้าสินค้าได้แล้ว → ต้องอ่านโปรที่ใช้ได้เหมือนกัน
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findActive() {
    return this.promotionsService.findActivePromotions();
  }
```

- [ ] **Step 4:** รันให้ผ่าน (คำสั่งเดิม) — คาดหวัง 2 passed
- [ ] **Step 5:** Commit: `feat(promotions): เปิด GET /promotions/active ให้ FM/ACCOUNTANT (การ์ดโปรในหน้าสินค้า)`

---

### Task 4: API — `UpdateProductDto` รับฟิลด์ที่หน้าสินค้า B1 แก้ได้

**Files:**
- Modify: `apps/api/src/modules/products/dto/update-product.dto.ts` (ท้ายคลาส หลัง `accessoryBrand` :72-78; import ปัจจุบันมีแค่ `IsString, IsOptional, IsNumber, IsArray, IsBoolean` ที่ :1)
- Create: `apps/api/src/modules/products/dto/update-product.dto.spec.ts`

**Interfaces:**
- Produces (ฟิลด์ที่ต้อง validate ผ่านหลัง Task นี้): `cashPrice?: number`, `installmentPrice?: number`, `conditionGrade?: string`, `shopWarrantyDays?: number`, `accessoriesIncluded?: string[]`, `cosmeticNotes?: string (≤500)`
- **สำคัญ — idempotent กับ B0:** เปิดไฟล์อ่านก่อนเสมอ แล้ว **เพิ่มเฉพาะฟิลด์ที่ยังไม่มี** (B0 §2.1/§2.2 อาจใส่ `cashPrice`/`installmentPrice`/`conditionGrade`/`shopWarrantyDays` ไปแล้ว) — ห้ามประกาศซ้ำ; เทสต์ Step 1 ผ่านได้เหมือนกันไม่ว่าใครเป็นคนเพิ่ม

- [ ] **Step 1:** เขียนเทสต์ที่ fail — `apps/api/src/modules/products/dto/update-product.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProductDto } from './update-product.dto';

/**
 * หน้าสินค้า B1 เขียน 6 ฟิลด์นี้ผ่าน PATCH /products/:id — ถ้า DTO ไม่รับ
 * (whitelist ตัดทิ้งเงียบ) ผู้ใช้จะกดบันทึกแล้วค่าไม่เปลี่ยนโดยไม่มี error.
 */
describe('UpdateProductDto — ฟิลด์ที่หน้าสินค้า B1 แก้', () => {
  it('รับ cashPrice/installmentPrice/conditionGrade/shopWarrantyDays/accessoriesIncluded/cosmeticNotes', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      cashPrice: 15900,
      installmentPrice: 17900,
      conditionGrade: 'A',
      shopWarrantyDays: 30,
      accessoriesIncluded: ['สายชาร์จ', 'กล่อง'],
      cosmeticNotes: 'รอยขีดข่วนมุมล่างซ้าย',
    });
    const errors = await validate(dto);
    expect(errors).toEqual([]);
    expect(dto.cashPrice).toBe(15900);
    expect(dto.accessoriesIncluded).toEqual(['สายชาร์จ', 'กล่อง']);
  });

  it('ปฏิเสธ cashPrice ที่ไม่ใช่ตัวเลข', async () => {
    const dto = plainToInstance(UpdateProductDto, { cashPrice: 'ถูกมาก' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('cashPrice');
  });

  it('ปฏิเสธ cosmeticNotes ยาวเกิน 500 ตัวอักษร', async () => {
    const dto = plainToInstance(UpdateProductDto, { cosmeticNotes: 'ก'.repeat(501) });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('cosmeticNotes');
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest --runInBand src/modules/products/dto/update-product.dto.spec.ts
```
คาดหวัง: **FAIL ที่ ts-jest** — `dto.cashPrice` / `dto.accessoriesIncluded` ยังไม่มีใน `UpdateProductDto` → TS2339. (ถ้าปิด diagnostics: เคส 2 และ 3 fail เพราะไม่มี decorator → `validate()` คืน `[]`; เคส 1 ผ่านอยู่แล้วเพราะ `plainToInstance` คัดลอก property ที่ไม่ประกาศมาให้ด้วย — นี่คือเหตุผลที่ต้องมีเคส 2/3 ไม่ใช่แค่เคส 1)

- [ ] **Step 3:** อ่าน `update-product.dto.ts` แล้วเพิ่ม **เฉพาะฟิลด์ที่ยังไม่มี** — พร้อมเติม import ที่ยังขาดใน `import { ... } from 'class-validator'` บรรทัด 1: `IsInt`, `IsIn`, `MaxLength` (`IsString`/`IsNumber`/`IsArray`/`IsOptional` มีแล้ว):

```ts
  /** ราคาขายเงินสด — single source ตาม owner decision §1.1 (B0 write-through ไป prices[]) */
  @IsNumber()
  @IsOptional()
  cashPrice?: number;

  /** ราคาตั้งต้นสำหรับผ่อน (ฐานของ calcBcInstallment) */
  @IsNumber()
  @IsOptional()
  installmentPrice?: number;

  @IsIn(['A', 'B', 'C', 'D'], { message: 'เกรดเครื่องต้องเป็น A, B, C หรือ D' })
  @IsOptional()
  conditionGrade?: string;

  @IsInt()
  @IsOptional()
  shopWarrantyDays?: number;

  /** อุปกรณ์ในกล่องที่แถมไปกับเครื่อง เช่น ['สายชาร์จ','กล่อง'] */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  accessoriesIncluded?: string[];

  @IsString()
  @MaxLength(500, { message: 'บันทึกตำหนิต้องไม่เกิน 500 ตัวอักษร' })
  @IsOptional()
  cosmeticNotes?: string;
```

- [ ] **Step 4:** ตรวจว่า `ProductsService.update` เขียนฟิลด์ใหม่ลง DB จริง — `products.service.ts:108-120` ทำ `const { costPrice, warrantyExpireDate, ...data } = dto;` แล้ว spread `...data` เข้า `prisma.product.update` (cast `as Prisma.ProductUncheckedUpdateInput`) จึงผ่านอัตโนมัติทั้ง 6 ฟิลด์; ถ้า B0 เพิ่ม write-through ของ `cashPrice/installmentPrice` แล้วห้ามแตะ logic นั้น
  > ⚠️ เพราะเป็น cast ไม่ใช่ type จริง TS จะ **ไม่** เตือนถ้าคอลัมน์ (`accessoriesIncluded`/`cosmeticNotes`) ยังไม่มีใน schema — จะพังตอน runtime เป็น `PrismaClientValidationError` แทน. Pre-flight P1 คือกันเคสนี้
- [ ] **Step 5:** รันเทสต์ให้ผ่าน (คำสั่งเดิม) → 3 passed; แล้ว `npx jest --runInBand src/modules/products` ทั้งโฟลเดอร์ต้องเขียว
- [ ] **Step 6:** `cd apps/api && npx tsc --noEmit` → 0; Commit: `feat(products): UpdateProductDto รับเกรด/ประกันร้าน/อุปกรณ์/ตำหนิ + ราคา (B1)`

---

### Task 5: Web — pure utils: `formatBaht` / `computeDefaultBcInstallment` / `buildCustomerSummary` / `buildShopProductUrl`

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/utils/buildCustomerSummary.ts`
- Create: `apps/web/src/pages/ProductDetailPage/utils/buildCustomerSummary.test.ts`
- Modify: `apps/web/src/lib/env.ts` (ต่อท้ายบรรทัด `export const LIFF_ID = ...` :23)

**Interfaces:**
- Consumes: `calcBcInstallment` จาก `@installment/shared` (`packages/shared/src/installment-calc.ts:18`) + type `BcCalcInput/BcCalcOutput` (`installment-calc.types.ts`), `Decimal` จาก `decimal.js`
- Produces:
```ts
export function formatBaht(value: number): string;
export interface BcConfigJson { minDownPct: number; commissionPct: number; vatPct: number; ratePctByMonths: Record<number, number>; allowedMonths: number[] }
export interface DefaultInstallment { months: number; downAmount: number; monthlyPayment: number }
export function computeDefaultBcInstallment(installmentPrice: number | null | undefined, config: BcConfigJson | null | undefined): DefaultInstallment | null;
export interface CustomerSummaryInput { /* ดูโค้ด Step 3 */ }
export function buildCustomerSummary(input: CustomerSummaryInput): string;
export function buildShopProductUrl(productId: string, base?: string): string;
```
- `BcConfigJson` = shape ของ `GET /interest-configs/resolved?category=<PHONE_NEW|PHONE_USED>` (ตรงกับ `BcConfigResponse` ใน `InstallmentCalculatorCard.tsx:14-20`; endpoint เปิดครบ 5 role แล้วที่ `interest-config.controller.ts:38-43`)
- ค่าตั้งต้นของค่างวดต้อง **ตรงกับ BcCalculatorCard เป๊ะ** (`BcCalculatorCard.tsx:29-31`): `months = allowedMonths.includes(12) ? 12 : allowedMonths[0]`, `downAmount = Math.round(installmentPrice * minDownPct)`
- **เบี่ยงจากถ้อยคำใน spec §3 อย่างตั้งใจ**: spec เขียนว่า "ทุกฟิลด์ null-safe ('-')" — แต่ข้อความนี้ถูก **คัดลอกไปส่งลูกค้า** การโชว์ `'-'` ให้ลูกค้าอ่านคือ noise. กติกาที่ใช้จริงคือ *บรรทัดหลัก* (ชื่อรุ่น + ราคาเงินสด) แสดงเสมอ (ชื่อรุ่นว่าง → `'-'`, ราคาว่าง → "สอบถามแอดมิน") ส่วน *บรรทัดรอง* ที่ไม่มีข้อมูล **ตัดทิ้งทั้งบรรทัด** — เจตนาเดียวกับ spec (ไม่พังเมื่อ null) แต่ output อ่านรู้เรื่องกว่า; ล็อกไว้ด้วยเทสต์ "null ทุกฟิลด์ก็ไม่พัง" ใน Step 1

- [ ] **Step 1:** เขียนเทสต์ที่ fail — `apps/web/src/pages/ProductDetailPage/utils/buildCustomerSummary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  formatBaht,
  computeDefaultBcInstallment,
  buildCustomerSummary,
  buildShopProductUrl,
} from './buildCustomerSummary';

const config = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 5: 0.4, 6: 0.4, 7: 0.5, 8: 0.5, 10: 0.5, 12: 0.5 },
  allowedMonths: [5, 6, 7, 8, 10, 12],
};

describe('formatBaht', () => {
  it('ตัด .00 ทิ้งและใส่ตัวคั่นหลักพัน', () => {
    expect(formatBaht(15900)).toBe('15,900');
    expect(formatBaht(0)).toBe('0');
    expect(formatBaht(1234567)).toBe('1,234,567');
  });

  it('เก็บทศนิยม 2 ตำแหน่งเมื่อมีเศษ', () => {
    expect(formatBaht(2413.21)).toBe('2,413.21');
    expect(formatBaht(99.5)).toBe('99.50');
  });
});

describe('computeDefaultBcInstallment — golden 19,900 (ตรงกับ BcCalculatorCard)', () => {
  it('คืน 12 งวด ดาวน์ 2,985 งวดละ 2,413.21', () => {
    expect(computeDefaultBcInstallment(19900, config)).toEqual({
      months: 12,
      downAmount: 2985,
      monthlyPayment: 2413.21,
    });
  });

  it('ไม่มี 12 งวดในตาราง → ใช้งวดแรกที่อนุญาต', () => {
    const out = computeDefaultBcInstallment(19900, { ...config, allowedMonths: [6, 10] });
    expect(out?.months).toBe(6);
  });

  it('ไม่มีราคาผ่อน / ไม่มี config → null', () => {
    expect(computeDefaultBcInstallment(null, config)).toBeNull();
    expect(computeDefaultBcInstallment(0, config)).toBeNull();
    expect(computeDefaultBcInstallment(19900, null)).toBeNull();
    expect(computeDefaultBcInstallment(19900, { ...config, allowedMonths: [] })).toBeNull();
  });
});

describe('buildCustomerSummary', () => {
  it('ประกอบข้อความครบทุกส่วนเมื่อข้อมูลครบ', () => {
    const text = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      storage: '128GB',
      color: 'ดำ',
      category: 'PHONE_USED',
      conditionGrade: 'A',
      batteryHealth: 89,
      shopWarrantyDays: 30,
      accessoriesIncluded: ['สายชาร์จ', 'กล่อง'],
      cosmeticNotes: 'รอยขีดข่วนมุมล่างซ้าย',
      cashPrice: '15900',
      installmentPrice: '19900',
      installment: { months: 12, downAmount: 2985, monthlyPayment: 2413.21 },
      branchName: 'ลาดพร้าว',
      imeiSerial: '356789012341234',
      link: 'https://www.bestchoicephone.com/products/p-1',
    });

    expect(text).toBe(
      [
        'Apple iPhone 13 128GB สีดำ (เครื่องมือสอง เกรด A)',
        'ราคาเงินสด 15,900 บาท',
        'ผ่อน 12 งวด ดาวน์ 2,985 บาท งวดละ 2,413.21 บาท',
        'แบต 89% | ประกันร้าน 30 วัน | อุปกรณ์: สายชาร์จ, กล่อง',
        'ตำหนิ: รอยขีดข่วนมุมล่างซ้าย',
        'สาขา ลาดพร้าว | เลขเครื่อง 4 ตัวท้าย 1234',
        'ดูรายละเอียด: https://www.bestchoicephone.com/products/p-1',
      ].join('\n'),
    );
  });

  it('ข้ามบรรทัดผ่อนเมื่อไม่มีราคาผ่อน', () => {
    const text = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      category: 'PHONE_NEW',
      cashPrice: 20900,
      installmentPrice: null,
      installment: null,
    });
    expect(text).toBe(['Apple iPhone 13 (เครื่องใหม่)', 'ราคาเงินสด 20,900 บาท'].join('\n'));
    expect(text).not.toContain('ผ่อน');
  });

  it('ไม่มีราคาเงินสด → บอกให้สอบถามแทนที่จะโชว์ 0', () => {
    const text = buildCustomerSummary({ brand: 'Apple', model: 'iPhone 13', cashPrice: null });
    expect(text).toContain('ราคาเงินสด สอบถามแอดมิน');
    expect(text).not.toContain('0 บาท');
  });

  it('null ทุกฟิลด์ก็ไม่พัง — ได้อย่างน้อย 2 บรรทัด', () => {
    const text = buildCustomerSummary({
      brand: null,
      model: null,
      storage: null,
      color: null,
      category: null,
      conditionGrade: null,
      batteryHealth: null,
      shopWarrantyDays: null,
      accessoriesIncluded: null,
      cosmeticNotes: null,
      cashPrice: null,
      installmentPrice: null,
      installment: null,
      branchName: null,
      imeiSerial: null,
      link: null,
    });
    expect(text.split('\n')).toEqual(['-', 'ราคาเงินสด สอบถามแอดมิน']);
  });

  it('IMEI สั้นกว่า 4 ตัว ไม่ทำให้บรรทัดท้ายเพี้ยน', () => {
    const text = buildCustomerSummary({ brand: 'Apple', model: 'iPhone 13', imeiSerial: '12' });
    expect(text).not.toContain('เลขเครื่อง');
  });
});

describe('buildShopProductUrl', () => {
  it('ต่อ path จาก base ที่ส่งเข้ามา', () => {
    expect(buildShopProductUrl('p-1', 'https://www.bestchoicephone.com')).toBe(
      'https://www.bestchoicephone.com/products/p-1',
    );
  });

  it('ตัด / ท้าย base ซ้ำซ้อนออก', () => {
    expect(buildShopProductUrl('p-1', 'https://www.bestchoicephone.com/')).toBe(
      'https://www.bestchoicephone.com/products/p-1',
    );
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/ProductDetailPage/utils/buildCustomerSummary.test.ts
```
คาดหวัง: FAIL — `Failed to resolve import "./buildCustomerSummary"`

- [ ] **Step 3:** เพิ่ม `SHOP_BASE_URL` ใน `apps/web/src/lib/env.ts` (ต่อท้ายบรรทัด 23):

```ts
/**
 * โดเมนหน้าร้านลูกค้า — ใช้ประกอบลิงก์ที่แอดมินคัดลอกส่งลูกค้า.
 * ค่า canonical ตรงกับ apps/web-shop/src/hooks/usePageMeta.ts:4
 * (B4 จะเปลี่ยนปลายทางเป็น /api/shop/share/:id — แก้ที่ buildShopProductUrl จุดเดียว)
 */
export const SHOP_BASE_URL = (
  import.meta.env.VITE_SHOP_URL || 'https://www.bestchoicephone.com'
).replace(/\/+$/, '');
```

- [ ] **Step 4:** สร้าง `apps/web/src/pages/ProductDetailPage/utils/buildCustomerSummary.ts`:

```ts
import Decimal from 'decimal.js';
import { calcBcInstallment } from '@installment/shared';
import { SHOP_BASE_URL } from '@/lib/env';

/** shape ของ GET /interest-configs/resolved?category=... */
export interface BcConfigJson {
  minDownPct: number;
  commissionPct: number;
  vatPct: number;
  ratePctByMonths: Record<number, number>;
  allowedMonths: number[];
}

export interface DefaultInstallment {
  months: number;
  downAmount: number;
  monthlyPayment: number;
}

/**
 * ฟอร์แมตเงินแบบ deterministic (ไม่พึ่ง Intl/locale ของเครื่อง) เพราะข้อความนี้
 * ถูกคัดลอกไปส่งลูกค้าและถูก assert แบบตรงตัวในเทสต์
 */
export function formatBaht(value: number): string {
  const fixed = Math.abs(value).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = value < 0 ? '-' : '';
  return decPart === '00' ? `${sign}${withSep}` : `${sign}${withSep}.${decPart}`;
}

/**
 * ค่างวด "เริ่มต้น" ของหน้าสินค้า — คำนวณด้วย calcBcInstallment ตรง เพราะ
 * BcCalculatorCard เก็บ state ไว้ภายในและไม่ expose ผลลัพธ์ออกมา (spec §3).
 * ค่า default ต้องตรงกับ BcCalculatorCard.tsx:29-31 เป๊ะ ไม่งั้นข้อความที่
 * คัดลอกจะไม่ตรงกับตัวเลขที่พนักงานเห็นบนจอ.
 */
export function computeDefaultBcInstallment(
  installmentPrice: number | null | undefined,
  config: BcConfigJson | null | undefined,
): DefaultInstallment | null {
  if (installmentPrice == null || !(installmentPrice > 0)) return null;
  if (!config || !config.allowedMonths || config.allowedMonths.length === 0) return null;

  const months = config.allowedMonths.includes(12) ? 12 : config.allowedMonths[0];
  const downAmount = Math.round(installmentPrice * config.minDownPct);

  const result = calcBcInstallment({
    installmentPrice: new Decimal(installmentPrice),
    months,
    customDownAmount: new Decimal(downAmount),
    config: {
      minDownPct: new Decimal(config.minDownPct),
      commissionPct: new Decimal(config.commissionPct),
      vatPct: new Decimal(config.vatPct),
      ratePctByMonths: new Map(
        Object.entries(config.ratePctByMonths).map(([k, v]) => [Number(k), new Decimal(v)]),
      ),
      allowedMonths: config.allowedMonths,
    },
  });

  if (!result.isValid) return null;
  return {
    months,
    downAmount: result.downAmount.toNumber(),
    monthlyPayment: result.monthlyPayment.toNumber(),
  };
}

export interface CustomerSummaryInput {
  brand?: string | null;
  model?: string | null;
  storage?: string | null;
  color?: string | null;
  category?: string | null;
  conditionGrade?: string | null;
  batteryHealth?: number | null;
  shopWarrantyDays?: number | null;
  accessoriesIncluded?: string[] | null;
  cosmeticNotes?: string | null;
  cashPrice?: string | number | null;
  installmentPrice?: string | number | null;
  installment?: DefaultInstallment | null;
  branchName?: string | null;
  imeiSerial?: string | null;
  link?: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  PHONE_NEW: 'เครื่องใหม่',
  PHONE_USED: 'เครื่องมือสอง',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').toString().trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * ข้อความสรุปสำหรับส่งลูกค้าทางแชท — pure function ทั้งก้อน (ไม่แตะ DOM/network)
 * เพื่อให้เป็นแกนที่ทดสอบได้เต็ม. กติกา null-safe: บรรทัดหลัก (ชื่อรุ่น + เงินสด)
 * แสดงเสมอ, บรรทัดรองที่ไม่มีข้อมูล **ตัดทิ้งทั้งบรรทัด** ไม่โชว์ '-' ให้ลูกค้าอ่าน
 */
export function buildCustomerSummary(input: CustomerSummaryInput): string {
  const lines: string[] = [];

  const head = [
    nonEmpty(input.brand),
    nonEmpty(input.model),
    nonEmpty(input.storage),
    nonEmpty(input.color) ? `สี${nonEmpty(input.color)}` : null,
  ]
    .filter((p): p is string => p !== null)
    .join(' ');

  const condition = [
    input.category ? (CATEGORY_LABEL[input.category] ?? null) : null,
    nonEmpty(input.conditionGrade) ? `เกรด ${nonEmpty(input.conditionGrade)}` : null,
  ].filter((p): p is string => p !== null);

  lines.push(condition.length > 0 ? `${head || '-'} (${condition.join(' ')})` : head || '-');

  const cash = toNumber(input.cashPrice);
  lines.push(
    cash != null && cash > 0 ? `ราคาเงินสด ${formatBaht(cash)} บาท` : 'ราคาเงินสด สอบถามแอดมิน',
  );

  const instPrice = toNumber(input.installmentPrice);
  if (input.installment && instPrice != null && instPrice > 0) {
    const { months, downAmount, monthlyPayment } = input.installment;
    lines.push(
      `ผ่อน ${months} งวด ดาวน์ ${formatBaht(downAmount)} บาท งวดละ ${formatBaht(monthlyPayment)} บาท`,
    );
  }

  const specs = [
    input.batteryHealth != null ? `แบต ${input.batteryHealth}%` : null,
    input.shopWarrantyDays != null && input.shopWarrantyDays > 0
      ? `ประกันร้าน ${input.shopWarrantyDays} วัน`
      : null,
    input.accessoriesIncluded && input.accessoriesIncluded.length > 0
      ? `อุปกรณ์: ${input.accessoriesIncluded.join(', ')}`
      : null,
  ].filter((s): s is string => s !== null);
  if (specs.length > 0) lines.push(specs.join(' | '));

  const notes = nonEmpty(input.cosmeticNotes);
  if (notes) lines.push(`ตำหนิ: ${notes}`);

  const imei = nonEmpty(input.imeiSerial);
  const tail = [
    nonEmpty(input.branchName) ? `สาขา ${nonEmpty(input.branchName)}` : null,
    imei && imei.length >= 4 ? `เลขเครื่อง 4 ตัวท้าย ${imei.slice(-4)}` : null,
  ].filter((s): s is string => s !== null);
  if (tail.length > 0) lines.push(tail.join(' | '));

  const link = nonEmpty(input.link);
  if (link) lines.push(`ดูรายละเอียด: ${link}`);

  return lines.join('\n');
}

/**
 * ลิงก์หน้าสินค้าฝั่งลูกค้า. B4 จะเปลี่ยนปลายทางเป็น share endpoint
 * (`/api/shop/share/:id`) — แก้ที่ฟังก์ชันนี้จุดเดียว ผู้เรียกไม่ต้องแก้
 */
export function buildShopProductUrl(productId: string, base: string = SHOP_BASE_URL): string {
  return `${base.replace(/\/+$/, '')}/products/${productId}`;
}
```

- [ ] **Step 5:** รันให้ผ่าน (คำสั่งเดิม) — คาดหวัง **12 passed** (formatBaht 2 + computeDefaultBcInstallment 3 + buildCustomerSummary 5 + buildShopProductUrl 2)
- [ ] **Step 6:** `cd apps/web && npx tsc --noEmit` → 0; Commit: `feat(product-page): pure utils สรุปสินค้าส่งลูกค้า + ค่างวดเริ่มต้นจาก calcBcInstallment`

---

### Task 6: Web — ซ่อนราคาทุน/กำไรจาก SALES (UI) + รองรับ `totalValue = null` ที่หน้าสต็อก

**Files:**
- Modify: `apps/web/src/pages/ProductDetailPage/components/ProductInfo.tsx` (interface props :41-49, price summary grid :121-159)
- Modify: `apps/web/src/pages/ProductDetailPage/index.tsx` (ส่ง prop ใหม่ :390-404)
- Modify: `apps/web/src/pages/StockPage/types.ts:22`
- Modify: `apps/web/src/pages/StockPage/hooks/useStockOverview.ts:42`
- Modify: `apps/web/src/pages/StockPage/components/StockHeroKpi.tsx:7,31,57-60`
- Modify: `apps/web/src/pages/StockPage/components/BranchSummaryCards.tsx:48-52`
- Create: `apps/web/src/pages/ProductDetailPage/components/__tests__/ProductInfo.cost.test.tsx`

> **จงใจไม่แก้ `StockProduct.costPrice: string` (`StockPage/types.ts:8`) ให้เป็น optional** ถึงแม้ server จะ strip ทิ้งสำหรับ SALES — ตรวจผู้อ่านครบทุกจุดแล้วว่า runtime ปลอดภัย: `ProductsPage.tsx:188` `parseFloat(undefined)` → `NaN` แล้วถูกกิน `isManager && costValue > 0` (:196), `useStockProducts.ts:272` ใช้ `Number(p.costPrice || 0)`, `PriceManagementModal.tsx:45,98,99` เปิดได้เฉพาะ `isManager`. เปลี่ยนเป็น `string | undefined` จะลาม 5 จุดโดยไม่ได้พฤติกรรมเพิ่ม — ถ้าอยากทำ ให้แยกเป็น follow-up

**Interfaces:**
- Consumes: `useAuth().user.role` (`AuthContext.tsx:13-17` — `role: string`)
- Produces: `ProductInfoProps` เพิ่ม `canSeeCost: boolean` (แทนการอาศัย `isManager` ซึ่ง = OWNER|BM เท่านั้น — FM/ACCOUNTANT ต้องเห็นทุนเพราะเป็น role บัญชี); `BranchSummary.totalValue: number | null`; `StockHeroKpiProps.totalValue: number | null`

- [ ] **Step 1:** เขียนเทสต์ที่ fail — `apps/web/src/pages/ProductDetailPage/components/__tests__/ProductInfo.cost.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ProductInfo from '../ProductInfo';

const product = {
  id: 'p-1',
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  color: 'ดำ',
  storage: '128GB',
  imeiSerial: '356789012341234',
  serialNumber: null,
  category: 'PHONE_USED',
  costPrice: '12000',
  status: 'IN_STOCK',
  batteryHealth: 89,
  warrantyExpired: true,
  warrantyExpireDate: null,
  hasBox: true,
  accessoryType: null,
  accessoryBrand: null,
  photos: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  branch: { id: 'b-1', name: 'ลาดพร้าว' },
  supplier: null,
  po: null,
  inspection: null,
  prices: [{ id: 'pr-1', label: 'ราคาเงินสด', amount: '15900', isDefault: true }],
};

describe('ProductInfo — การ์ดทุน/กำไร', () => {
  it('ซ่อนทุนและกำไรเมื่อ canSeeCost=false (SALES)', () => {
    render(<ProductInfo product={product} isManager={false} canSeeCost={false} profit={3900} />);
    expect(screen.queryByText('ราคาทุน')).toBeNull();
    expect(screen.queryByText('กำไร')).toBeNull();
    expect(screen.queryByText(/12,000/)).toBeNull();
    // ข้อมูลอื่นยังอยู่
    expect(screen.getByText('ลาดพร้าว')).toBeInTheDocument();
  });

  it('แสดงทุนและกำไรเมื่อ canSeeCost=true', () => {
    render(<ProductInfo product={product} isManager canSeeCost profit={3900} />);
    expect(screen.getByText('ราคาทุน')).toBeInTheDocument();
    expect(screen.getByText('กำไร')).toBeInTheDocument();
    expect(screen.getByText(/12,000/)).toBeInTheDocument();
  });

  it('costPrice ที่ถูก strip ฝั่ง server (undefined) ต้องไม่ทำให้พัง', () => {
    const { costPrice: _dropped, ...stripped } = product;
    render(<ProductInfo product={stripped} isManager={false} canSeeCost={false} profit={null} />);
    expect(screen.getByText('ลาดพร้าว')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/ProductDetailPage/components/__tests__/ProductInfo.cost.test.tsx
```
คาดหวัง: FAIL (prop `canSeeCost` ยังไม่มี + ยัง render 'ราคาทุน' เสมอ)

- [ ] **Step 3:** แก้ `ProductInfo.tsx` 3 จุด — บรรทัด 24, interface :41-49, destructuring :51-59:

**(ก) บรรทัด 24** `costPrice: string;` → 
```ts
  costPrice?: string;     // optional — server strip ทิ้งเมื่อ role = SALES (Task 1)
```
(ฟิลด์อื่นทั้ง 25 ฟิลด์ใน `interface Product` :14-39 คงเดิมทุกบรรทัด)

**(ข) แทน `interface ProductInfoProps` :41-49 ทั้งก้อน**:
```ts
interface ProductInfoProps {
  product: Product;
  isManager: boolean;
  /** FM/ACCOUNTANT เห็นทุนได้ แต่ SALES ไม่ได้ (server ก็ strip แล้ว) */
  canSeeCost: boolean;
  profit: number | null;
  // 4 ตัวล่างเป็นซากของ price CRUD เดิม — ถูกถอดทิ้งจริงใน Task 7 Step 5
  // ทำเป็น optional ชั่วคราวเพื่อให้เทสต์ Step 1 (ไม่ส่งมา) คอมไพล์ผ่าน
  defaultPrice?: Price;
  onAddPrice?: () => void;
  onEditPrice?: (price: Price) => void;
  onDeletePrice?: (priceId: string) => void;
}
```

**(ค) destructuring :51-59** → 
```tsx
export default function ProductInfo({
  product,
  isManager,
  canSeeCost,
  profit,
  onAddPrice,
  onEditPrice,
  onDeletePrice,
}: ProductInfoProps) {
```
แล้วแก้ 3 call site ในตาราง prices ให้เป็น optional call: `onClick={() => onAddPrice?.()}` (:166), `onClick={() => onEditPrice?.(price)}` (:188), `onClick={() => onDeletePrice?.(price.id)}` (:194) — ทั้งตารางนี้จะถูกแทนที่ด้วย `<details>` read-only ใน Task 7 Step 5 อยู่แล้ว

- [ ] **Step 4:** แทนที่บล็อก Price Summary ทั้งก้อน (บรรทัด 120-159) ด้วยเวอร์ชันที่ **ครอบทั้งบล็อกด้วย `{canSeeCost && (...)}`** — ทั้งบล็อกเหลือแค่ 2 การ์ด เพราะการ์ด "ราคาขาย (default)" ถูกแทนที่ด้วย `SellingPriceCard` ใน Task 7 (และ `defaultPrice` เลิกใช้ในนี้แล้ว):

```tsx
      {/* Price Summary — ทุน/กำไรเป็นข้อมูลต้นทุน: ซ่อนทั้งบล็อกจาก SALES
          (server ก็ strip costPrice ให้แล้วที่ products.controller.ts) */}
      {canSeeCost && (
        <div className="grid grid-cols-2 gap-5 lg:gap-7.5 mb-5 lg:mb-7.5">
          <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-warning" />
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ราคาทุน</div>
              <div className="text-lg font-semibold text-foreground tabular-nums font-mono">
                {product.costPrice != null ? `${parseFloat(product.costPrice).toLocaleString()} ฿` : '-'}
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-success" />
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">กำไร</div>
              <div
                className={`text-lg font-semibold tabular-nums font-mono ${
                  profit === null
                    ? 'text-muted-foreground'
                    : profit > 0
                    ? 'text-success'
                    : profit === 0
                    ? 'text-muted-foreground'
                    : 'text-destructive'
                }`}
              >
                {profit !== null ? `${profit.toLocaleString()} ฿` : '-'}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
```
> `defaultPrice` prop จึงไม่ถูกใช้ตั้งแต่ Task นี้ (ยังประกาศเป็น optional ค้างไว้ ถอดทิ้งจริงใน Task 7 Step 5) — `apps/web/tsconfig` ตั้ง `noUnusedLocals: false`/`noUnusedParameters: false` จึงไม่ทำให้ `tsc` แดงระหว่างทาง; eslint ตรวจตอนปิด batch (Task 12 Step 8) ซึ่งตอนนั้นถอดออกแล้ว

- [ ] **Step 5:** `index.tsx` — คำนวณ `canSeeCost` และส่งลงไป (แก้ :85 และ :390-404):

```tsx
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';
  const canSeeCost = user?.role !== 'SALES';
```
```tsx
          <ProductInfo
            product={product}
            isManager={isManager}
            canSeeCost={canSeeCost}
            profit={profit}
          />
```
และแก้ `useMemo` ที่คำนวณ profit (:128-140) ให้ null-safe เมื่อ costPrice ถูก strip:

```tsx
  const { defaultPrice, profit } = useMemo(() => {
    if (!product) return { defaultPrice: undefined, profit: null };
    const dp = product.prices.find((p) => p.isDefault);
    const { installment, cash } = getDisplayPrices(product);
    const displayPrice = installment ?? cash;
    // costPrice ถูก strip ฝั่ง server เมื่อ role = SALES → ไม่มีทางคำนวณกำไร
    const cost = product.costPrice != null ? parseFloat(product.costPrice) : null;
    return {
      defaultPrice: dp,
      profit: displayPrice != null && cost != null ? displayPrice - cost : null,
    };
  }, [product]);
```
พร้อมแก้ interface `Product` ใน `index.tsx:38` เป็น `costPrice?: string;`

- [ ] **Step 6:** รองรับ `totalValue = null` ที่หน้าสต็อก (SALES):
  - `StockPage/types.ts:22` → `totalValue: number | null;`
  - `StockPage/hooks/useStockOverview.ts:42` →
```ts
  // SALES ไม่ได้รับ totalValue (server redact) → คืน null ทั้งก้อนแทนที่จะรวมเป็น 0
  const totalValue = summary.some((s) => s.totalValue == null)
    ? null
    : summary.reduce((sum, s) => sum + (s.totalValue ?? 0), 0);
```
  - `StockHeroKpi.tsx:7` → `totalValue: number | null;` และ :57-60 →
```tsx
          {totalValue != null && (
            <div className="text-xs text-muted-foreground mt-1 tabular-nums">
              {totalValue.toLocaleString()} ฿
            </div>
          )}
```
  - `BranchSummaryCards.tsx:48-52` →
```tsx
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1.5">
                <span className="tabular-nums">
                  {s.totalValue != null ? `${s.totalValue.toLocaleString()} ฿` : ''}
                </span>
                <span className="tabular-nums">{sharePct.toFixed(0)}%</span>
              </div>
```

- [ ] **Step 7:** รันเทสต์ให้ผ่าน + tsc:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/ProductDetailPage && npx tsc --noEmit
```
คาดหวัง: ProductInfo.cost 3 passed, BcCalculatorCard เดิม 2 passed, tsc 0 errors

- [ ] **Step 8:** Commit: `feat(product-page): ซ่อนทุน/กำไรจาก SALES ใน UI + รองรับ totalValue ที่ถูก redact`

---

### Task 7: Web — การ์ดราคาใหม่ (เงินสด/ผ่อน + badge autofill) และตาราง `prices[]` เป็น read-only

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/components/SellingPriceCard.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/EditSellingPriceModal.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/__tests__/SellingPriceCard.test.tsx`
- Modify: `apps/web/src/pages/ProductDetailPage/components/ProductInfo.tsx` (ตาราง prices :162-209 → `<details>` read-only)
- Modify: `apps/web/src/pages/ProductDetailPage/index.tsx` (ลบ price CRUD เดิม: state :90-92, mutations :143-171, handlers :255-274, modal :413-468 + `ConfirmDialog` ที่ตายตาม: import :8, state :106-108, JSX :535-541)

**Interfaces:**
- Consumes: `product.cashPrice`, `product.installmentPrice`, `product.priceAutofilledAt` (คอลัมน์จาก B0), `PATCH /products/:id` body `{ cashPrice?: number; installmentPrice?: number }` (Task 4)
- Produces:
```tsx
export default function SellingPriceCard(props: {
  cashPrice: string | number | null;
  installmentPrice: string | number | null;
  priceAutofilledAt: string | null;
  canEdit: boolean;              // OWNER | BRANCH_MANAGER
  onEdit: () => void;
}): JSX.Element;

export default function EditSellingPriceModal(props: {
  isOpen: boolean;
  onClose: () => void;
  cashPrice: string;
  installmentPrice: string;
  onChange: (next: { cashPrice: string; installmentPrice: string }) => void;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
}): JSX.Element;
```

- [ ] **Step 1:** เขียนเทสต์ที่ fail — `apps/web/src/pages/ProductDetailPage/components/__tests__/SellingPriceCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SellingPriceCard from '../SellingPriceCard';

describe('SellingPriceCard', () => {
  it('แสดงราคาเงินสด/ราคาผ่อน จากคอลัมน์', () => {
    render(
      <SellingPriceCard
        cashPrice="15900"
        installmentPrice="19900"
        priceAutofilledAt={null}
        canEdit
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText('15,900 ฿')).toBeInTheDocument();
    expect(screen.getByText('19,900 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'แก้ราคา' })).toBeInTheDocument();
  });

  it('แสดง badge เมื่อราคาถูกเติมอัตโนมัติจากตารางราคากลาง', () => {
    render(
      <SellingPriceCard
        cashPrice="15900"
        installmentPrice={null}
        priceAutofilledAt="2026-08-01T03:00:00.000Z"
        canEdit
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText('เติมอัตโนมัติจากตารางราคากลาง')).toBeInTheDocument();
  });

  it('ไม่มีราคา → เตือนว่ายังตอบลูกค้าไม่ได้ และซ่อนปุ่มแก้เมื่อไม่มีสิทธิ์', () => {
    render(
      <SellingPriceCard
        cashPrice={null}
        installmentPrice={null}
        priceAutofilledAt={null}
        canEdit={false}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText('ยังไม่กำหนดราคา — แจ้งผู้จัดการก่อนเสนอลูกค้า')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แก้ราคา' })).toBeNull();
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/ProductDetailPage/components/__tests__/SellingPriceCard.test.tsx
```

- [ ] **Step 3:** สร้าง `SellingPriceCard.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatBaht } from '../utils/buildCustomerSummary';

interface Props {
  cashPrice: string | number | null;
  installmentPrice: string | number | null;
  /** B0 stamp เมื่อราคาถูกเติมจาก PricingTemplate — เคลียร์เมื่อมีคนแก้ราคาด้วยมือ */
  priceAutofilledAt: string | null;
  canEdit: boolean;
  onEdit: () => void;
}

function toNum(v: string | number | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function SellingPriceCard({
  cashPrice,
  installmentPrice,
  priceAutofilledAt,
  canEdit,
  onEdit,
}: Props) {
  const cash = toNum(cashPrice);
  const installment = toNum(installmentPrice);

  return (
    <Card className="mb-5 lg:mb-7.5 rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>ราคาขาย</CardTitle>
        <div className="flex items-center gap-2">
          {priceAutofilledAt && (
            <Badge variant="warning" appearance="light" size="sm">
              เติมอัตโนมัติจากตารางราคากลาง
            </Badge>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="text-sm text-primary hover:text-primary/80 font-medium leading-snug"
            >
              แก้ราคา
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <div className="text-xs text-muted-foreground mb-0.5 leading-snug">ราคาเงินสด</div>
            <div className="text-lg font-semibold text-primary tabular-nums font-mono">
              {cash != null ? `${formatBaht(cash)} ฿` : '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5 leading-snug">ราคาผ่อน (ตั้งต้น)</div>
            <div className="text-lg font-semibold text-foreground tabular-nums font-mono">
              {installment != null ? `${formatBaht(installment)} ฿` : '-'}
            </div>
          </div>
        </div>
        {cash == null && installment == null && (
          <p className="mt-3 text-sm text-muted-foreground leading-snug">
            ยังไม่กำหนดราคา — แจ้งผู้จัดการก่อนเสนอลูกค้า
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4:** สร้าง `EditSellingPriceModal.tsx`:

```tsx
import Modal from '@/components/ui/Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  cashPrice: string;
  installmentPrice: string;
  onChange: (next: { cashPrice: string; installmentPrice: string }) => void;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
}

export default function EditSellingPriceModal({
  isOpen,
  onClose,
  cashPrice,
  installmentPrice,
  onChange,
  onSubmit,
  isPending,
}: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="แก้ราคาขาย">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1 leading-snug">
            ราคาเงินสด (บาท)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={cashPrice}
            onChange={(e) => onChange({ cashPrice: e.target.value, installmentPrice })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1 leading-snug">
            ราคาผ่อน — ราคาตั้งต้นสำหรับคำนวณค่างวด (บาท)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={installmentPrice}
            onChange={(e) => onChange({ cashPrice, installmentPrice: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          ราคานี้คือแหล่งเดียวที่เว็บลูกค้า/บอท/เครื่องคิดค่างวดใช้ — เว้นว่างได้ถ้ายังไม่ตั้งราคา
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">
            ยกเลิก
          </button>
          <button
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

- [ ] **Step 5:** `ProductInfo.tsx` — เปลี่ยนตาราง prices[] (:162-209) เป็น read-only แบบพับเก็บ และถอด props CRUD:

```tsx
      {/* ราคาในระบบเดิม (prices[]) — read-only, กำลังเลิกใช้ตาม owner decision §1.1 */}
      <details className="mb-5 lg:mb-7.5 rounded-xl border border-border/50 bg-card shadow-sm">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-muted-foreground leading-snug">
          ราคาในระบบเดิม ({product.prices.length}) — อ่านอย่างเดียว
        </summary>
        <div className="px-5 pb-4 space-y-2">
          {product.prices.map((price) => (
            <div key={price.id} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-3">
                <span className="text-sm text-foreground leading-snug">{price.label}</span>
                {price.isDefault && (
                  <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded font-medium leading-snug">
                    ค่าเริ่มต้น
                  </span>
                )}
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {parseFloat(price.amount).toLocaleString()} ฿
              </span>
            </div>
          ))}
          {product.prices.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-3 leading-snug">
              ยังไม่มีข้อมูลราคาเดิม
            </p>
          )}
        </div>
      </details>
```
แล้วลบ `defaultPrice` / `onAddPrice` / `onEditPrice` / `onDeletePrice` ออกจาก `ProductInfoProps` และ destructuring ให้หมด

- [ ] **Step 6:** `index.tsx` — ลบของเดิมและเพิ่มของใหม่:
  - ลบ: state `isPriceModalOpen/editingPrice/priceForm` (:90-92), `priceMutation` (:143-158), `deletePriceMutation` (:160-171), `openAddPrice/openEditPrice/handlePriceSubmit` (:255-274), Price Modal JSX (:413-468), และ `defaultPrice` ที่ไม่ถูกใช้แล้วใน useMemo (:128-140 → เหลือคืนแค่ `profit`)
  - **ลบ `ConfirmDialog` ที่ตายไปพร้อมกัน**: `setConfirmDialog` ถูกเรียกจุดเดียวในโค้ดทั้งไฟล์คือ `onDeletePrice` (:398) → เมื่อลบ prop นั้นแล้ว ต้องลบ state `confirmDialog` (:106-108), JSX `<ConfirmDialog .../>` (:535-541) และ import `{ ConfirmDialog }` (:8) ไม่งั้น eslint แดงตอนปิด batch
  - **คงไว้**: `Modal` import (:11) ยังใช้กับ Transfer Modal, `getDisplayPrices` (:15) ยังใช้ใน useMemo ของ profit, interface `Price` (:21-26) ยังใช้กับ `product.prices`
  - เพิ่ม state + mutation ของราคาขายใหม่:
```tsx
  const [isSellingPriceModalOpen, setIsSellingPriceModalOpen] = useState(false);
  const [sellingPriceForm, setSellingPriceForm] = useState({ cashPrice: '', installmentPrice: '' });

  const sellingPriceMutation = useMutation({
    mutationFn: async () =>
      api.patch(`/products/${id}`, {
        cashPrice: sellingPriceForm.cashPrice !== '' ? parseFloat(sellingPriceForm.cashPrice) : undefined,
        installmentPrice:
          sellingPriceForm.installmentPrice !== '' ? parseFloat(sellingPriceForm.installmentPrice) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      toast.success('บันทึกราคาขายสำเร็จ');
      setIsSellingPriceModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
  // หมายเหตุที่ตั้งใจ: ช่องว่าง = "ไม่แก้ค่านี้" (ส่ง undefined → axios ตัดคีย์ทิ้ง)
  // ไม่ใช่ "ล้างราคาเป็น null" — การล้างราคาเป็น follow-up (ต้องให้ DTO รับ null ก่อน)

  const openSellingPriceModal = () => {
    if (!product) return;
    setSellingPriceForm({
      cashPrice: product.cashPrice != null ? String(product.cashPrice) : '',
      installmentPrice: product.installmentPrice != null ? String(product.installmentPrice) : '',
    });
    setIsSellingPriceModalOpen(true);
  };
```
  - เพิ่มฟิลด์ใหม่ใน interface `Product` ของ `index.tsx:28-57`:
```ts
  cashPrice: string | null;
  installmentPrice: string | null;
  priceAutofilledAt: string | null;
  shopWarrantyDays: number | null;
  accessoriesIncluded: string[] | null;
  cosmeticNotes: string | null;
```
  - render การ์ดใหม่เหนือ `<ProductInfo />` ในแท็บ info + modal ท้ายหน้า:
```tsx
          <SellingPriceCard
            cashPrice={product.cashPrice}
            installmentPrice={product.installmentPrice}
            priceAutofilledAt={product.priceAutofilledAt}
            canEdit={isManager}
            onEdit={openSellingPriceModal}
          />
```
```tsx
      <EditSellingPriceModal
        isOpen={isSellingPriceModalOpen}
        onClose={() => setIsSellingPriceModalOpen(false)}
        cashPrice={sellingPriceForm.cashPrice}
        installmentPrice={sellingPriceForm.installmentPrice}
        onChange={setSellingPriceForm}
        onSubmit={(e) => {
          e.preventDefault();
          sellingPriceMutation.mutate();
        }}
        isPending={sellingPriceMutation.isPending}
      />
```

- [ ] **Step 7:** รันเทสต์ + tsc:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/ProductDetailPage && npx tsc --noEmit
```
คาดหวัง: SellingPriceCard 3 passed, ProductInfo.cost 3 passed, tsc 0

- [ ] **Step 8:** Commit: `feat(product-page): การ์ดราคาเงินสด/ผ่อน + badge autofill, prices[] เดิมเป็น read-only`

---

### Task 8: Web — การ์ด readiness (กิน `GET /products/:id/readiness` ของ B0)

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/hooks/useProductReadiness.ts`
- Create: `apps/web/src/pages/ProductDetailPage/components/ReadinessCard.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/__tests__/ReadinessCard.test.tsx`
- Modify: `apps/web/src/pages/ProductDetailPage/components/OnlineListingPanel.tsx` (ลบ `missingReasons` :139-144, แทนบล็อก Switch :313-332; `useMemo` ยังถูกใช้ที่ :133 และ :151 จึงไม่ต้องแตะ import)

**Interfaces:**
- Consumes (contract จาก B0 §2.3 — ยืนยันแล้วใน Pre-flight P2):
```ts
// GET /products/:id/readiness
interface ProductReadinessCheck {
  key: string;      // 'IN_STOCK' | 'PHOTO' | 'CASH_PRICE' | 'GRADE' | 'SHOP_GATE' | 'NOT_DEMO' | ...
  label: string;    // ข้อความไทยพร้อมแสดง
  ok: boolean;
  hint?: string;    // คำแนะนำเมื่อ ok=false
}
interface ProductReadinessResponse {
  productId: string;
  isReady: boolean;
  isOnlineVisible: boolean;
  checks: ProductReadinessCheck[];
}
```
- Produces:
```ts
export function useProductReadiness(productId: string | undefined): UseQueryResult<ProductReadinessResponse>;
```
```tsx
export default function ReadinessCard(props: {
  isLoading: boolean;
  isError: boolean;
  data: ProductReadinessResponse | undefined;
}): JSX.Element;
```
- **ชื่อฟิลด์ที่ล็อกไว้แล้ว:** B0 คืน **`isReady`** (ไม่ใช่ `ready`) และคืน **`isOnlineVisible`** มาด้วย — ตรงกับที่เขียนไว้ข้างบนแล้ว **ห้ามเปลี่ยนกลับเป็น `ready`**. response ของ B0 ยังมี `priceAutofilledAt` / `hasInstallmentPrice` ติดมาด้วย แต่ B1 ไม่ใช้ผ่านทางนี้ (การ์ดราคาใน Task 7 อ่าน `product.priceAutofilledAt` จาก `GET /products/:id` ตรงๆ) — adapter จึงตัดทิ้งได้
- **กติกา:** `ReadinessCard` ต้อง render จาก `checks[]` แบบ generic (ห้าม hardcode ชื่อ key) — ถ้า B0 เปลี่ยนชื่อ check ให้แก้แค่ adapter ใน `useProductReadiness.ts`; และ fixture ในเทสต์ต้อง **annotate ด้วย `ProductReadinessResponse` ที่ import จาก adapter** เพื่อให้การเปลี่ยนชื่อฟิลด์ทำให้ `tsc` แดงแทนที่จะเงียบ

- [ ] **Step 1:** เขียนเทสต์ที่ fail — `apps/web/src/pages/ProductDetailPage/components/__tests__/ReadinessCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ReadinessCard from '../ReadinessCard';
import type { ProductReadinessResponse } from '../../hooks/useProductReadiness';

/**
 * fixture ต้อง **ผูก type กับ adapter** (`ProductReadinessResponse` จาก
 * useProductReadiness.ts) ห้ามพิมพ์ shape ด้วยมือ — ถ้าวันหลัง B0 เปลี่ยนชื่อฟิลด์
 * (เช่น isReady → ready) แล้ว adapter ถูกแก้ตาม เทสต์นี้ต้อง **tsc แดงทันที**
 * ไม่ใช่ผ่านเงียบๆ ด้วย object literal ที่ไม่มีใครตรวจ
 */
const ready: ProductReadinessResponse = {
  productId: 'p-1',
  isReady: true,
  isOnlineVisible: true,
  checks: [
    { key: 'IN_STOCK', label: 'อยู่ในสต็อก', ok: true },
    { key: 'PHOTO', label: 'มีรูปขึ้นเว็บอย่างน้อย 1 รูป', ok: true },
    { key: 'CASH_PRICE', label: 'มีราคาเงินสด', ok: true },
  ],
};

describe('ReadinessCard', () => {
  it('พร้อมขึ้นเว็บ → หัวข้อบอกว่าพร้อม + ไล่ข้อครบ', () => {
    render(<ReadinessCard isLoading={false} isError={false} data={ready} />);
    expect(screen.getByText('พร้อมขึ้นเว็บ')).toBeInTheDocument();
    expect(screen.getByText('มีราคาเงินสด')).toBeInTheDocument();
  });

  it('ยังไม่พร้อม → แสดงข้อที่ยังขาด + คำแนะนำ', () => {
    render(
      <ReadinessCard
        isLoading={false}
        isError={false}
        data={{
          ...ready,
          isReady: false,
          checks: [
            { key: 'IN_STOCK', label: 'อยู่ในสต็อก', ok: true },
            { key: 'CASH_PRICE', label: 'มีราคาเงินสด', ok: false, hint: 'กรอกราคาเงินสดที่การ์ดราคาขาย' },
          ],
        }}
      />,
    );
    expect(screen.getByText('ยังขึ้นเว็บไม่ได้')).toBeInTheDocument();
    expect(screen.getByText('กรอกราคาเงินสดที่การ์ดราคาขาย')).toBeInTheDocument();
  });

  it('โหลดอยู่ / โหลดพลาด ก็ไม่พัง', () => {
    const { rerender } = render(<ReadinessCard isLoading isError={false} data={undefined} />);
    expect(screen.getByText('กำลังตรวจสถานะขึ้นเว็บ...')).toBeInTheDocument();
    rerender(<ReadinessCard isLoading={false} isError data={undefined} />);
    expect(screen.getByText('ตรวจสถานะขึ้นเว็บไม่สำเร็จ')).toBeInTheDocument();
  });

  it('checks ว่าง → ไม่ล้ม', () => {
    render(<ReadinessCard isLoading={false} isError={false} data={{ ...ready, checks: [] }} />);
    expect(screen.getByText('พร้อมขึ้นเว็บ')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail (resolve ไม่เจอทั้ง `../ReadinessCard` และ `../../hooks/useProductReadiness` — ทั้งคู่ยังไม่ถูกสร้างจนถึง Step 3/4):
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/ProductDetailPage/components/__tests__/ReadinessCard.test.tsx
```

- [ ] **Step 3:** สร้าง `hooks/useProductReadiness.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface ProductReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  hint?: string;
}

export interface ProductReadinessResponse {
  productId: string;
  isReady: boolean;
  isOnlineVisible: boolean;
  checks: ProductReadinessCheck[];
}

/**
 * Adapter จุดเดียวที่ผูกกับ shape ของ GET /products/:id/readiness (B0 §2.3).
 * ถ้า B0 เปลี่ยนชื่อ field ให้แก้ที่นี่เท่านั้น — ReadinessCard render จาก
 * checks[] แบบ generic อยู่แล้ว
 */
export function useProductReadiness(productId: string | undefined) {
  return useQuery<ProductReadinessResponse>({
    queryKey: ['product-readiness', productId],
    queryFn: async () => {
      const { data } = await api.get(`/products/${productId}/readiness`);
      return {
        productId: data.productId ?? productId ?? '',
        isReady: Boolean(data.isReady),
        isOnlineVisible: Boolean(data.isOnlineVisible),
        checks: Array.isArray(data.checks) ? data.checks : [],
      };
    },
    enabled: !!productId,
    retry: false,
  });
}
```

- [ ] **Step 4:** สร้าง `components/ReadinessCard.tsx`:

```tsx
import { Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ProductReadinessResponse } from '../hooks/useProductReadiness';

interface Props {
  isLoading: boolean;
  isError: boolean;
  data: ProductReadinessResponse | undefined;
}

export default function ReadinessCard({ isLoading, isError, data }: Props) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-4 text-sm text-muted-foreground leading-snug">
        กำลังตรวจสถานะขึ้นเว็บ...
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="bg-card rounded-lg border p-4 text-sm text-muted-foreground leading-snug">
        ตรวจสถานะขึ้นเว็บไม่สำเร็จ
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-sm font-semibold text-foreground leading-snug">สถานะขึ้นเว็บ</h2>
        <Badge variant={data.isReady ? 'success' : 'warning'} appearance="light" size="sm">
          {data.isReady ? 'พร้อมขึ้นเว็บ' : 'ยังขึ้นเว็บไม่ได้'}
        </Badge>
      </div>
      <ul className="space-y-1.5">
        {data.checks.map((check) => (
          <li key={check.key} className="flex items-start gap-2 text-sm leading-snug">
            {check.ok ? (
              <Check className="size-4 mt-0.5 shrink-0 text-success" aria-label="ผ่าน" />
            ) : (
              <X className="size-4 mt-0.5 shrink-0 text-destructive" aria-label="ยังไม่ผ่าน" />
            )}
            <span className={check.ok ? 'text-foreground' : 'text-muted-foreground'}>
              {check.label}
              {!check.ok && check.hint && (
                <span className="block text-xs text-muted-foreground">{check.hint}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5:** แก้ `OnlineListingPanel.tsx` — ลบ `missingReasons` (:139-144) และแทนที่ block Switch (:313-332):

```tsx
        <div>
          <div className="flex items-center gap-3">
            <Switch
              id="online-visible"
              checked={product.isOnlineVisible}
              disabled={!canEdit || toggleMutation.isPending}
              onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            />
            <Label htmlFor="online-visible" className="text-sm leading-snug">
              แสดงบนเว็บ shop
            </Label>
          </div>
          <p className="ml-6 mt-1 text-xs text-muted-foreground leading-snug">
            ปิดสวิตช์นี้เพื่อซ่อนเครื่องนี้จากเว็บลูกค้า — เงื่อนไข "ข้อมูลครบ" ดูที่การ์ดสถานะขึ้นเว็บ
          </p>
        </div>
```
> ปลด `disabled` ตาม B0 §2.3 (invariant ย้ายไปอยู่ที่ readiness filter แล้ว). ถ้า B0 ยังคง invariant ไว้ API จะตอบ 400 พร้อมข้อความไทยและ `toast.error` แสดงผลตามปกติ — ไม่พัง

- [ ] **Step 6:** วางการ์ดไว้บนสุดของแท็บ "ขึ้นเว็บ" ใน `OnlineListingPanel` (บนสุดของ `<div className="space-y-4">` :184):
```tsx
      <ReadinessCard isLoading={readiness.isLoading} isError={readiness.isError} data={readiness.data} />
```
โดยเรียก `const readiness = useProductReadiness(product.id);` ที่หัวคอมโพเนนต์

- [ ] **Step 7:** รันเทสต์ + tsc:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/ProductDetailPage && npx tsc --noEmit
```
คาดหวัง: ReadinessCard 4 passed, SellingPriceCard 3 passed, ProductInfo.cost 3 passed, BcCalculatorCard เดิม 2 passed, tsc 0
- [ ] **Step 8:** Commit: `feat(product-page): การ์ดสถานะขึ้นเว็บจาก /products/:id/readiness แทน missingReasons`

---

### Task 9: Web — ปุ่ม "คัดลอกสรุปส่งลูกค้า" + "คัดลอกลิงก์"

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/hooks/useCustomerSummary.ts`
- Create: `apps/web/src/pages/ProductDetailPage/components/CustomerSummaryActions.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/__tests__/CustomerSummaryActions.test.tsx`

**Interfaces:**
- Consumes: `buildCustomerSummary` / `computeDefaultBcInstallment` / `buildShopProductUrl` (Task 5), `useProductReadiness` (Task 8), `useCopyToClipboard()` → `{ copy: (text: string) => Promise<boolean>; copied: boolean; error: Error | null }` (`apps/web/src/hooks/useCopyToClipboard.ts`), `GET /interest-configs/resolved?category=` (queryKey เดิม `['interest-config', category, 'bc']` — react-query dedupe กับ `InstallmentCalculatorCard.tsx:26-33`)
- Produces:
```ts
export function useCustomerSummary(product: {
  id: string; brand: string; model: string; storage: string | null; color: string | null;
  category: string; conditionGrade: string | null; batteryHealth: number | null;
  shopWarrantyDays: number | null; accessoriesIncluded: string[] | null; cosmeticNotes: string | null;
  cashPrice: string | null; installmentPrice: string | null; imeiSerial: string | null;
  branch: { name: string };
} | undefined): { summaryText: string; shareUrl: string };
```
```tsx
export default function CustomerSummaryActions(props: {
  summaryText: string;
  shareUrl: string;
  isReady: boolean;   // จาก readiness — ไม่ ready = ห้ามส่งลิงก์ให้ลูกค้า (เว็บยังไม่ขึ้น)
}): JSX.Element;
```

- [ ] **Step 1:** เขียนเทสต์ที่ fail — `apps/web/src/pages/ProductDetailPage/components/__tests__/CustomerSummaryActions.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CustomerSummaryActions from '../CustomerSummaryActions';

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe('CustomerSummaryActions', () => {
  it('คัดลอกสรุปตามข้อความที่ส่งเข้ามาเป๊ะ', async () => {
    render(
      <CustomerSummaryActions
        summaryText={'Apple iPhone 13\nราคาเงินสด 15,900 บาท'}
        shareUrl="https://www.bestchoicephone.com/products/p-1"
        isReady
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'คัดลอกสรุปส่งลูกค้า' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('Apple iPhone 13\nราคาเงินสด 15,900 บาท'),
    );
  });

  it('คัดลอกลิงก์ได้เมื่อพร้อมขึ้นเว็บ', async () => {
    render(
      <CustomerSummaryActions summaryText="x" shareUrl="https://www.bestchoicephone.com/products/p-1" isReady />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'คัดลอกลิงก์' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://www.bestchoicephone.com/products/p-1'),
    );
  });

  it('ปุ่มลิงก์ถูก disable เมื่อยังไม่พร้อมขึ้นเว็บ + บอกเหตุผล', async () => {
    render(<CustomerSummaryActions summaryText="x" shareUrl="https://example.com/products/p-1" isReady={false} />);
    const btn = screen.getByRole('button', { name: 'คัดลอกลิงก์' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'เครื่องนี้ยังไม่ขึ้นเว็บ — ลิงก์จะเปิดไม่เจอ');
    await userEvent.click(btn);
    expect(writeText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail (คำสั่ง vitest ที่ path เทสต์นี้)
- [ ] **Step 3:** สร้าง `components/CustomerSummaryActions.tsx`:

```tsx
import { toast } from 'sonner';
import { Copy, Link2 } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

interface Props {
  summaryText: string;
  shareUrl: string;
  isReady: boolean;
}

export default function CustomerSummaryActions({ summaryText, shareUrl, isReady }: Props) {
  const { copy } = useCopyToClipboard();

  const handleCopy = async (text: string, okMessage: string) => {
    const ok = await copy(text);
    if (ok) toast.success(okMessage);
    else toast.error('คัดลอกไม่สำเร็จ — กดค้างเพื่อคัดลอกเองได้');
  };

  return (
    <div className="flex gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => handleCopy(summaryText, 'คัดลอกสรุปแล้ว — วางในแชทได้เลย')}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 leading-snug min-h-11"
      >
        <Copy className="size-4" aria-hidden />
        คัดลอกสรุปส่งลูกค้า
      </button>
      <button
        type="button"
        disabled={!isReady}
        title={isReady ? 'คัดลอกลิงก์หน้าสินค้าฝั่งลูกค้า' : 'เครื่องนี้ยังไม่ขึ้นเว็บ — ลิงก์จะเปิดไม่เจอ'}
        onClick={() => handleCopy(shareUrl, 'คัดลอกลิงก์แล้ว')}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-primary border border-input rounded-lg hover:bg-muted/50 disabled:opacity-50 disabled:pointer-events-none leading-snug min-h-11"
      >
        <Link2 className="size-4" aria-hidden />
        คัดลอกลิงก์
      </button>
    </div>
  );
}
```

- [ ] **Step 4:** สร้าง `hooks/useCustomerSummary.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  buildCustomerSummary,
  buildShopProductUrl,
  computeDefaultBcInstallment,
  type BcConfigJson,
} from '../utils/buildCustomerSummary';

interface ProductForSummary {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  category: string;
  conditionGrade: string | null;
  batteryHealth: number | null;
  shopWarrantyDays: number | null;
  accessoriesIncluded: string[] | null;
  cosmeticNotes: string | null;
  cashPrice: string | null;
  installmentPrice: string | null;
  imeiSerial: string | null;
  branch: { name: string };
}

export function useCustomerSummary(product: ProductForSummary | undefined) {
  // queryKey เดียวกับ InstallmentCalculatorCard → react-query ยิงครั้งเดียว
  const { data: bcConfig } = useQuery<BcConfigJson>({
    queryKey: ['interest-config', product?.category, 'bc'],
    queryFn: async () => {
      const { data } = await api.get(`/interest-configs/resolved?category=${product?.category}`);
      return data;
    },
    // ยิงเฉพาะหมวดที่มีตารางดอกเบี้ยจริง — ACCESSORY/TABLET จะได้ error จาก
    // resolveConfig (interest-config.controller.ts:39-43) ซึ่งไม่ควร retry
    enabled:
      product?.installmentPrice != null &&
      (product?.category === 'PHONE_NEW' || product?.category === 'PHONE_USED'),
    retry: false,
  });

  if (!product) return { summaryText: '', shareUrl: '' };

  const installment = computeDefaultBcInstallment(
    product.installmentPrice != null ? Number(product.installmentPrice) : null,
    bcConfig ?? null,
  );
  const shareUrl = buildShopProductUrl(product.id);

  return {
    shareUrl,
    summaryText: buildCustomerSummary({
      brand: product.brand,
      model: product.model,
      storage: product.storage,
      color: product.color,
      category: product.category,
      conditionGrade: product.conditionGrade,
      batteryHealth: product.batteryHealth,
      shopWarrantyDays: product.shopWarrantyDays,
      accessoriesIncluded: product.accessoriesIncluded,
      cosmeticNotes: product.cosmeticNotes,
      cashPrice: product.cashPrice,
      installmentPrice: product.installmentPrice,
      installment,
      branchName: product.branch?.name ?? null,
      imeiSerial: product.imeiSerial,
      link: shareUrl,
    }),
  };
}
```

- [ ] **Step 5:** รันเทสต์ให้ผ่าน (3 passed) + `npx tsc --noEmit` = 0
- [ ] **Step 6:** Commit: `feat(product-page): ปุ่มคัดลอกสรุปส่งลูกค้า + คัดลอกลิงก์ (gate ตาม readiness)`

---

### Task 10: Web — การ์ด "เครื่องอื่นรุ่นเดียวกัน" + "โปรที่ใช้ได้ตอนนี้"

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/components/SameModelCard.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/ActivePromotionsCard.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/__tests__/SameModelCard.test.tsx` (ครอบทั้ง 2 การ์ด — ไฟล์เดียวเพราะ mock `@/lib/api` ตัวเดียวใช้ร่วมกันได้ และ vitest flake เมื่อ mock โมดูลเดียวกันหลายรอบต่อไฟล์)

**Interfaces:**
- Consumes:
  - `GET /products?model=<model>&storage=<storage>&status=IN_STOCK,RESERVED&limit=20` (Task 2) → `{ data: Product[], total, page, limit, totalPages }`
  - `GET /promotions/active` (Task 3) → `{ id, name, description, type, discountValue, specialInterestRate, endDate, ... }[]` (`promotions.service.ts:54-68`)
  - `getStatusBadgeProps` + `productStatusMap` จาก `@/lib/status-badges`
- Produces:
```tsx
export default function SameModelCard(props: { productId: string; model: string; storage: string | null }): JSX.Element | null;
export default function ActivePromotionsCard(): JSX.Element | null;
```
- กติกา: ตัดตัวเองออกจากผลลัพธ์ด้วย `productId`; ไม่มีเครื่องอื่น → ไม่ render การ์ด (คืน `null`)

- [ ] **Step 1:** เขียนเทสต์ที่ fail — `apps/web/src/pages/ProductDetailPage/components/__tests__/SameModelCard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SameModelCard from '../SameModelCard';
import ActivePromotionsCard from '../ActivePromotionsCard';

// `apiGet` ถูกอ้างถึงเฉพาะ "ตอนเรียก" (ข้างใน arrow) ไม่ใช่ตอน factory ทำงาน
// → ไม่ชน TDZ ของ vi.mock ที่ถูก hoist (pattern เดียวกับ
// components/accounting/__tests__/InternalControlActionBar.test.tsx:32-36)
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
  getErrorMessage: () => 'error',
}));

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

beforeEach(() => apiGet.mockReset());

describe('SameModelCard', () => {
  it('เรียก /products ด้วย model+storage+status ที่ถูกต้อง และตัดเครื่องตัวเองออก', async () => {
    apiGet.mockResolvedValue({
      data: {
        data: [
          { id: 'p-1', color: 'ดำ', storage: '128GB', status: 'IN_STOCK', cashPrice: '15900', branch: { name: 'ลาดพร้าว' } },
          { id: 'p-2', color: 'ขาว', storage: '128GB', status: 'RESERVED', cashPrice: '15500', branch: { name: 'บางแค' } },
        ],
        total: 2,
      },
    });

    render(wrap(<SameModelCard productId="p-1" model="iPhone 13" storage="128GB" />));

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls[0][0]).toBe('/products');
    expect(apiGet.mock.calls[0][1]).toEqual({
      params: { model: 'iPhone 13', storage: '128GB', status: 'IN_STOCK,RESERVED', limit: 20 },
    });
    expect(await screen.findByText('บางแค')).toBeInTheDocument();
    expect(screen.queryByText('ลาดพร้าว')).toBeNull();
  });

  it('ไม่มีเครื่องอื่น → ไม่ render การ์ด', async () => {
    apiGet.mockResolvedValue({ data: { data: [{ id: 'p-1', color: 'ดำ', status: 'IN_STOCK', branch: { name: 'ลาดพร้าว' } }], total: 1 } });
    const { container } = render(wrap(<SameModelCard productId="p-1" model="iPhone 13" storage="128GB" />));
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).not.toContain('เครื่องอื่นรุ่นเดียวกัน'));
  });
});

describe('ActivePromotionsCard', () => {
  it('แสดงโปรที่ active พร้อม label ว่ายังไม่กรองรายเครื่อง', async () => {
    apiGet.mockResolvedValue({
      data: [
        { id: 'promo-1', name: 'ลด 500 เมื่อผ่อน 12 งวด', description: 'เฉพาะเดือนนี้', endDate: '2026-08-31T00:00:00.000Z' },
      ],
    });

    render(wrap(<ActivePromotionsCard />));

    expect(await screen.findByText('ลด 500 เมื่อผ่อน 12 งวด')).toBeInTheDocument();
    expect(screen.getByText('เฉพาะเดือนนี้')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่กรองรายเครื่อง (มาใน B3)')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/promotions/active');
  });

  it('ไม่มีโปร / ยิงพลาด (เช่น 403) → ไม่ render การ์ด ไม่พังทั้งหน้า', async () => {
    apiGet.mockRejectedValue(new Error('403'));
    const { container } = render(wrap(<ActivePromotionsCard />));
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).not.toContain('โปรที่ใช้ได้ตอนนี้'));
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail
- [ ] **Step 3:** สร้าง `SameModelCard.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, productStatusMap } from '@/lib/status-badges';
import { formatBaht } from '../utils/buildCustomerSummary';

interface SameModelProduct {
  id: string;
  color: string | null;
  storage: string | null;
  status: string;
  cashPrice: string | null;
  branch: { name: string };
}

interface Props {
  productId: string;
  model: string;
  storage: string | null;
}

export default function SameModelCard({ productId, model, storage }: Props) {
  const { data } = useQuery<{ data: SameModelProduct[] }>({
    queryKey: ['products', 'same-model', model, storage],
    queryFn: async () => {
      const res = await api.get('/products', {
        params: {
          model,
          ...(storage ? { storage } : {}),
          // comma string: ไม่ต้องพึ่ง paramsSerializer ของ axios (service split ให้)
          status: 'IN_STOCK,RESERVED',
          limit: 20,
        },
      });
      return res.data;
    },
    enabled: !!model,
  });

  const others = (data?.data ?? []).filter((p) => p.id !== productId);
  if (others.length === 0) return null;

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>เครื่องอื่นรุ่นเดียวกัน ({others.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {others.map((p) => {
            const cfg = getStatusBadgeProps(p.status, productStatusMap);
            return (
              <li key={p.id}>
                <Link
                  to={`/products/${p.id}`}
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 min-h-11"
                >
                  <span className="text-sm text-foreground leading-snug">
                    {[p.color, p.storage].filter(Boolean).join(' · ') || 'ไม่ระบุสี'}
                    <span className="block text-xs text-muted-foreground">{p.branch?.name}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold tabular-nums">
                      {p.cashPrice != null ? `${formatBaht(Number(p.cashPrice))} ฿` : '-'}
                    </span>
                    <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
                      {cfg.label}
                    </Badge>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4:** สร้าง `ActivePromotionsCard.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateShort } from '@/utils/formatters';

interface ActivePromotion {
  id: string;
  name: string;
  description: string | null;
  endDate: string;
}

export default function ActivePromotionsCard() {
  const { data } = useQuery<ActivePromotion[]>({
    queryKey: ['promotions', 'active'],
    queryFn: async () => {
      const res = await api.get('/promotions/active');
      return res.data;
    },
    retry: false,
  });

  const promotions = data ?? [];
  if (promotions.length === 0) return null;

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>โปรที่ใช้ได้ตอนนี้ ({promotions.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {promotions.map((p) => (
            <li key={p.id} className="text-sm leading-snug">
              <span className="font-medium text-foreground">{p.name}</span>
              {p.description && (
                <span className="block text-xs text-muted-foreground">{p.description}</span>
              )}
              <span className="block text-xs text-muted-foreground">
                ถึง {formatDateShort(p.endDate)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground leading-snug">
          ยังไม่กรองรายเครื่อง (มาใน B3)
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5:** รันเทสต์ให้ผ่าน (**4 passed** — SameModelCard 2 + ActivePromotionsCard 2) + `npx tsc --noEmit` = 0
- [ ] **Step 6:** Commit: `feat(product-page): การ์ดเครื่องรุ่นเดียวกัน + โปรที่ใช้ได้ตอนนี้`

---

### Task 11: Web — ฟิลด์สภาพเครื่อง (เกรด/ประกันร้าน/อุปกรณ์/ตำหนิ) + ผลตรวจ QC รายข้อ

**Files:**
- Modify: `apps/web/src/pages/ProductDetailPage/components/ProductInfo.tsx` (เพิ่ม InfoField ในบล็อก PHONE_USED :96-111 และบล็อกรวม :112-115)
- Modify: `apps/web/src/pages/ProductDetailPage/components/EditProductModal.tsx` (interface EditForm :7-24, บล็อกมือสอง :173-219)
- Modify: `apps/web/src/pages/ProductDetailPage/index.tsx` (EditForm :61-78, initial state :96-101, `openEditProduct` :204-225, `handleEditSubmit` :227-253)
- Create: `apps/web/src/pages/ProductDetailPage/components/QcResultsCard.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/__tests__/QcResultsCard.test.tsx`

**Interfaces:**
- Consumes: `GET /inspections/:id` (`apps/api/src/modules/quality-control/inspections.controller.ts:85-86` — `@Get('inspections/:id')` + `@Roles` ครบ 5 role) → service `findOneInspection` (`apps/api/src/modules/quality-control/inspections.service.ts:96-108`) คืน row `Inspection` เต็ม + `results: { id, passFail: boolean|null, grade: ConditionGrade|null, notes: string|null, templateItem: { itemName, category, sortOrder, ... } }[]` (ฟิลด์ยืนยันกับ `schema.prisma:1984-2003` (InspectionResult) + `:1936-1954` (InspectionTemplateItem))
  > `results` **ไม่ถูก orderBy ที่ service** — คอมโพเนนต์ต้อง sort ตาม `templateItem.sortOrder` เอง (ทำแล้วใน Step 3)
- Produces:
```tsx
export default function QcResultsCard(props: { inspectionId: string }): JSX.Element | null;
```
  และ `EditForm` เพิ่ม 4 คีย์: `conditionGrade: string; shopWarrantyDays: string; accessoriesIncluded: string; cosmeticNotes: string` (อุปกรณ์แก้เป็น comma-separated แล้ว split ตอน submit)

- [ ] **Step 1:** เขียนเทสต์ที่ fail — `apps/web/src/pages/ProductDetailPage/components/__tests__/QcResultsCard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import QcResultsCard from '../QcResultsCard';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...args: unknown[]) => apiGet(...args) } }));

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

beforeEach(() => apiGet.mockReset());

describe('QcResultsCard', () => {
  it('แสดงผลตรวจรายข้อพร้อมผ่าน/ไม่ผ่าน', async () => {
    apiGet.mockResolvedValue({
      data: {
        id: 'i-1',
        isCompleted: true,
        results: [
          { id: 'r-1', passFail: true, grade: null, notes: null, templateItem: { itemName: 'จอภาพ', category: 'หน้าจอ', sortOrder: 1 } },
          { id: 'r-2', passFail: false, grade: null, notes: 'มีรอย', templateItem: { itemName: 'ตัวเครื่อง', category: 'ภายนอก', sortOrder: 2 } },
        ],
      },
    });

    render(wrap(<QcResultsCard inspectionId="i-1" />));

    expect(await screen.findByText('จอภาพ')).toBeInTheDocument();
    expect(screen.getByText('ตัวเครื่อง')).toBeInTheDocument();
    expect(screen.getByText('มีรอย')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/inspections/i-1');
  });

  it('ไม่มีผลตรวจรายข้อ → ไม่ render การ์ด', async () => {
    apiGet.mockResolvedValue({ data: { id: 'i-1', isCompleted: false, results: [] } });
    const { container } = render(wrap(<QcResultsCard inspectionId="i-1" />));
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).not.toContain('ผลตรวจรายข้อ'));
  });

  it('เรียงตาม sortOrder ไม่ใช่ลำดับที่ API ส่งมา (service ไม่ orderBy ให้)', async () => {
    apiGet.mockResolvedValue({
      data: {
        id: 'i-1',
        isCompleted: true,
        results: [
          { id: 'r-2', passFail: true, grade: null, notes: null, templateItem: { itemName: 'ลำโพง', category: 'เสียง', sortOrder: 9 } },
          { id: 'r-1', passFail: true, grade: null, notes: null, templateItem: { itemName: 'จอภาพ', category: 'หน้าจอ', sortOrder: 1 } },
        ],
      },
    });

    render(wrap(<QcResultsCard inspectionId="i-1" />));

    const items = await screen.findAllByRole('listitem');
    expect(items[0].textContent).toContain('จอภาพ');
    expect(items[1].textContent).toContain('ลำโพง');
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail
- [ ] **Step 3:** สร้าง `QcResultsCard.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface InspectionResultRow {
  id: string;
  passFail: boolean | null;
  grade: string | null;
  notes: string | null;
  templateItem: { itemName: string; category: string; sortOrder: number };
}

interface InspectionDetail {
  id: string;
  isCompleted: boolean;
  results: InspectionResultRow[];
}

export default function QcResultsCard({ inspectionId }: { inspectionId: string }) {
  const { data } = useQuery<InspectionDetail>({
    queryKey: ['inspection', inspectionId],
    queryFn: async () => {
      const res = await api.get(`/inspections/${inspectionId}`);
      return res.data;
    },
    enabled: !!inspectionId,
    retry: false,
  });

  const results = data?.results ?? [];
  if (results.length === 0) return null;

  const sorted = [...results].sort(
    (a, b) => (a.templateItem?.sortOrder ?? 0) - (b.templateItem?.sortOrder ?? 0),
  );

  return (
    <Card className="mb-5 lg:mb-7.5 rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>ผลตรวจรายข้อ ({sorted.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {sorted.map((r) => (
            <li key={r.id} className="flex items-start gap-2 text-sm leading-snug">
              {r.passFail === false ? (
                <X className="size-4 mt-0.5 shrink-0 text-destructive" aria-label="ไม่ผ่าน" />
              ) : (
                <Check className="size-4 mt-0.5 shrink-0 text-success" aria-label="ผ่าน" />
              )}
              <span>
                <span className="text-foreground">{r.templateItem?.itemName}</span>
                <span className="text-xs text-muted-foreground"> · {r.templateItem?.category}</span>
                {r.notes && <span className="block text-xs text-muted-foreground">{r.notes}</span>}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4:** `ProductInfo.tsx` — เพิ่มฟิลด์แสดงผล (ในบล็อก `product.category === 'PHONE_USED'` :96-111 เพิ่มเกรด, และก่อน `<InfoField label="สาขา" ...>` :112 เพิ่ม 3 ฟิลด์รวม):

```tsx
                <InfoField
                  label="เกรดเครื่อง"
                  value={product.conditionGrade ? `เกรด ${product.conditionGrade}` : null}
                />
```
```tsx
            <InfoField
              label="ประกันร้าน"
              value={product.shopWarrantyDays != null ? `${product.shopWarrantyDays} วัน` : null}
            />
            <InfoField
              label="อุปกรณ์ที่แถม"
              value={
                product.accessoriesIncluded && product.accessoriesIncluded.length > 0
                  ? product.accessoriesIncluded.join(', ')
                  : null
              }
            />
            <InfoField label="ตำหนิ" value={product.cosmeticNotes} />
```
พร้อมเพิ่มใน interface `Product` ของไฟล์นี้: `conditionGrade?: string | null; shopWarrantyDays?: number | null; accessoriesIncluded?: string[] | null; cosmeticNotes?: string | null;`

- [ ] **Step 5:** `EditProductModal.tsx` — เพิ่ม 4 คีย์ใน `EditForm` ของไฟล์นี้ (:7-24 — **เป็นสำเนาที่สองของ interface เดียวกัน อีกอันอยู่ที่ `index.tsx:61-78` ต้องเพิ่มให้ตรงกันทั้งคู่ ไม่งั้น prop `editForm` ไม่ assignable**) แล้วแทรก block ใหม่ **นอกเงื่อนไข `editForm.category === 'PHONE_USED'`** (บล็อกมือสองเดิม :173-219) วางก่อนแถวปุ่มบันทึก (:220) — ฟิลด์พวกนี้ใช้กับเครื่องใหม่ด้วย:

```tsx
        <div className="border-t pt-3 space-y-3">
          <div className="text-xs font-semibold text-muted-foreground">ข้อมูลสำหรับตอบลูกค้า</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">เกรดเครื่อง</label>
              <select
                value={editForm.conditionGrade}
                onChange={(e) => setEditForm({ ...editForm, conditionGrade: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              >
                <option value="">ไม่ระบุ</option>
                <option value="A">เกรด A</option>
                <option value="B">เกรด B</option>
                <option value="C">เกรด C</option>
                <option value="D">เกรด D</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">ประกันร้าน (วัน)</label>
              <input
                type="number"
                min="0"
                value={editForm.shopWarrantyDays}
                onChange={(e) => setEditForm({ ...editForm, shopWarrantyDays: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              อุปกรณ์ที่แถม (คั่นด้วยลูกน้ำ)
            </label>
            <input
              type="text"
              value={editForm.accessoriesIncluded}
              onChange={(e) => setEditForm({ ...editForm, accessoriesIncluded: e.target.value })}
              placeholder="สายชาร์จ, กล่อง, หัวชาร์จ"
              className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">ตำหนิ (ไม่เกิน 500 ตัวอักษร)</label>
            <textarea
              value={editForm.cosmeticNotes}
              onChange={(e) => setEditForm({ ...editForm, cosmeticNotes: e.target.value })}
              maxLength={500}
              rows={2}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug resize-none"
            />
          </div>
        </div>
```

- [ ] **Step 6:** `index.tsx` — เพิ่ม 4 คีย์ใน `EditForm` + initial state + `openEditProduct` + payload:

```tsx
      conditionGrade: product.conditionGrade || '',
      shopWarrantyDays: product.shopWarrantyDays != null ? String(product.shopWarrantyDays) : '',
      accessoriesIncluded: (product.accessoriesIncluded ?? []).join(', '),
      cosmeticNotes: product.cosmeticNotes || '',
```
```tsx
    // วางต่อท้าย payload หลัก (:229-240) — นอกบล็อก if PHONE_USED/ACCESSORY
    // ค่าว่าง → undefined = "ไม่แก้" (DTO @IsIn ปฏิเสธ '' อยู่แล้ว);
    // accessoriesIncluded ส่งเสมอ (array ว่าง = ล้างรายการอุปกรณ์ ซึ่งตั้งใจให้ทำได้)
    payload.conditionGrade = editForm.conditionGrade || undefined;
    payload.shopWarrantyDays =
      editForm.shopWarrantyDays !== '' ? Number(editForm.shopWarrantyDays) : undefined;
    payload.accessoriesIncluded = editForm.accessoriesIncluded
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    payload.cosmeticNotes = editForm.cosmeticNotes || undefined;
```
และเพิ่ม 4 คีย์ใน interface `EditForm` ของ `index.tsx:61-78` (`conditionGrade: string; shopWarrantyDays: string; accessoriesIncluded: string; cosmeticNotes: string`) + ค่าเริ่มต้น `''` ใน `useState` :96-101 ด้วย

การ์ด QC วางใน Task 12 Step 5 (ลำดับการ์ดของแท็บ info) — Task นี้แค่สร้างคอมโพเนนต์ + เทสต์

- [ ] **Step 7:** รันเทสต์ทั้งโฟลเดอร์ + tsc:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/ProductDetailPage && npx tsc --noEmit
```
- [ ] **Step 8:** Commit: `feat(product-page): แสดง+แก้เกรด/ประกันร้าน/อุปกรณ์/ตำหนิ + ผลตรวจ QC รายข้อ`

---

### Task 12: Web — แก้ลิงก์ตาย, ซ่อนปุ่มทำสัญญาจาก FM/ACC, เปิด route ให้ FM/ACC, ประกอบหน้า + ปิด batch

**Files:**
- Modify: `apps/web/src/pages/ProductDetailPage/components/InstallmentCalculatorCard.tsx` (:9-12 props, :35-47 ลิงก์ตาย, :59-64 ส่ง prop)
- Modify: `apps/web/src/pages/ProductDetailPage/components/BcCalculatorCard.tsx` (:10-21 props, :119-126 ปุ่ม)
- Modify: `apps/web/src/pages/ProductDetailPage/components/__tests__/BcCalculatorCard.test.tsx` (+2 case)
- Modify: `apps/web/src/pages/ProductDetailPage/index.tsx` (ประกอบการ์ดใหม่ + ปุ่ม action bar :303-411)
- Modify: `apps/web/src/App.tsx:473-479`

> ⚠️ **`ProductDetailPage/index.tsx` เปลี่ยนโครงใหญ่หลัง B1** (Task 7 ลบ price CRUD ทั้งชุด: state/mutations/handlers/modal + `ConfirmDialog`; Task 8-12 แทรกการ์ดใหม่หลายตัว) → **เลขบรรทัดทุกตัวในไฟล์นี้เลื่อนหมด**. batch หลังที่มาแตะไฟล์เดียวกัน (โดยเฉพาะ **B5** ที่ anchor ไว้ที่ `:119-125` = ท้าย `branches` query และ `:352` = แถบแท็บ) **ห้ามใช้เลขบรรทัดเป็น anchor — ให้ grep หา anchor ข้อความแทน** เช่น `grep -n "useQuery" ... | grep branches` หรือ grep ชื่อ state/แท็บที่ต้องการ แล้วค่อยแทรก

**Interfaces:**
- Produces:
```tsx
// BcCalculatorCard
interface Props {
  productId: string;
  installmentPrice: number;
  hideCommission?: boolean;
  /** FM/ACCOUNTANT เข้า /contracts/create ไม่ได้ (App.tsx:509-515) → ซ่อนปุ่ม */
  canCreateContract?: boolean;   // default true
  // คงเดิมทุกบรรทัด (BcCalculatorCard.tsx:14-20)
  config: {
    minDownPct: number;
    commissionPct: number;
    vatPct: number;
    ratePctByMonths: Record<number, number>;
    allowedMonths: number[];
  };
}
// InstallmentCalculatorCard
interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  product: any;
  /** เปิดตัวแก้ราคาใหม่ของ B1 — แทนลิงก์ตาย /products/:id/edit */
  onEditPrice: () => void;
  canEditPrice: boolean;         // OWNER | BRANCH_MANAGER
}
```

- [ ] **Step 1:** เขียนเทสต์ที่ fail — เพิ่มใน `__tests__/BcCalculatorCard.test.tsx`:

```tsx
  it('ซ่อนปุ่ม "ใช้ราคานี้ทำสัญญา" เมื่อ canCreateContract=false (FM/ACCOUNTANT)', () => {
    render(
      <BrowserRouter>
        <BcCalculatorCard
          productId="p1"
          installmentPrice={19900}
          canCreateContract={false}
          config={config}
        />
      </BrowserRouter>,
    );
    expect(screen.queryByRole('button', { name: 'ใช้ราคานี้ทำสัญญา' })).toBeNull();
  });

  it('ยังแสดงปุ่มเมื่อไม่ส่ง prop (ค่า default = true)', () => {
    render(
      <BrowserRouter>
        <BcCalculatorCard productId="p1" installmentPrice={19900} config={config} />
      </BrowserRouter>,
    );
    expect(screen.getByRole('button', { name: 'ใช้ราคานี้ทำสัญญา' })).toBeInTheDocument();
  });
```

- [ ] **Step 2:** รันให้เห็น fail:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/ProductDetailPage/components/__tests__/BcCalculatorCard.test.tsx
```
คาดหวัง: case แรก FAIL (ปุ่มยังโชว์)

- [ ] **Step 3:** `BcCalculatorCard.tsx` — เพิ่ม prop + ครอบปุ่ม:

```tsx
export function BcCalculatorCard({
  productId,
  installmentPrice,
  hideCommission,
  canCreateContract = true,
  config,
}: Props) {
```
```tsx
        {canCreateContract && (
          <Button
            className="w-full"
            variant="primary"
            disabled={!result.isValid}
            onClick={handleUseInContract}
          >
            ใช้ราคานี้ทำสัญญา
          </Button>
        )}
```

- [ ] **Step 4:** `InstallmentCalculatorCard.tsx` — แทนลิงก์ตาย + ส่ง prop. **ต้องลบ `import { Link } from 'react-router'` (:2)** เพราะ `Link` ถูกใช้จุดเดียวคือลิงก์ตายที่กำลังลบ:

```tsx
export function InstallmentCalculatorCard({ product, onEditPrice, canEditPrice }: Props) {
  const { user } = useAuth();
  const { installment } = getDisplayPrices(product);
  const canCreateContract =
    user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER' || user?.role === 'SALES';

  // useQuery ของ bcConfig (:26-33) คงเดิมทุกบรรทัด

  if (!installment) {
    return (
      <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 p-4 text-sm leading-snug">
        ยังไม่ได้กำหนดราคาเงินผ่อน
        {canEditPrice ? (
          <button
            type="button"
            onClick={onEditPrice}
            className="ml-2 underline text-amber-700 dark:text-amber-400"
          >
            ไปแก้ราคา
          </button>
        ) : (
          <span className="ml-2 text-amber-700 dark:text-amber-400">
            — แจ้งผู้จัดการให้กำหนดราคา
          </span>
        )}
      </div>
    );
  }
```
```tsx
        <BcCalculatorCard
          productId={product.id}
          installmentPrice={Number(installment)}
          hideCommission={hideCommission}
          canCreateContract={canCreateContract}
          config={bcConfig}
        />
```

- [ ] **Step 5:** `index.tsx` — ประกอบทุกอย่างเข้าแท็บ info + action bar:

```tsx
        action={
          <div className="flex gap-2 flex-wrap">
            <CustomerSummaryActions
              summaryText={summaryText}
              shareUrl={shareUrl}
              isReady={readiness.data?.isReady ?? false}
            />
            {isManager && (
              <button
                onClick={openEditProduct}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              >
                แก้ไขข้อมูล
              </button>
            )}
            {isManager && transferableStatuses.includes(product.status) && (
              <button
                onClick={() => {
                  setTransferForm({ toBranchId: '', notes: '' });
                  setIsTransferModalOpen(true);
                }}
                className="px-4 py-2 text-sm text-primary border border-input rounded-lg hover:bg-muted/50"
              >
                โอนสาขา
              </button>
            )}
            <button
              onClick={() => navigate('/products')}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-input rounded-lg"
            >
              กลับ
            </button>
          </div>
        }
```
(เทียบกับของเดิม `index.tsx:321-349` — เปลี่ยนแค่ `className` ของ wrapper เป็น `flex gap-2 flex-wrap` และแทรก `<CustomerSummaryActions />` เป็นตัวแรก; 3 ปุ่มเดิมคงทุกบรรทัด)
โดยประกาศเหนือ return:
```tsx
  const readiness = useProductReadiness(id);
  const { summaryText, shareUrl } = useCustomerSummary(product);
```
> `useCustomerSummary`/`useProductReadiness` ต้องถูกเรียก **ก่อน early return** ทั้งหมด (Rules of Hooks) — วางไว้ถัดจาก `useMemo` ของ profit (:140)

และในแท็บ info วางลำดับ: `ReadinessCard` (เฉพาะแท็บ online), `SellingPriceCard` → `ProductInfo` → `QcResultsCard` → `InstallmentCalculatorCard` → grid ของ `SameModelCard` + `ActivePromotionsCard`:

```tsx
      {activeTab === 'info' && (
        <>
          <SellingPriceCard
            cashPrice={product.cashPrice}
            installmentPrice={product.installmentPrice}
            priceAutofilledAt={product.priceAutofilledAt}
            canEdit={isManager}
            onEdit={openSellingPriceModal}
          />
          <ProductInfo product={product} isManager={isManager} canSeeCost={canSeeCost} profit={profit} />
          {product.inspection && <QcResultsCard inspectionId={product.inspection.id} />}
          {(product.category === 'PHONE_NEW' || product.category === 'PHONE_USED') && (
            <div className="mt-6">
              <InstallmentCalculatorCard
                product={product}
                onEditPrice={openSellingPriceModal}
                canEditPrice={isManager}
              />
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-2 mt-6">
            <SameModelCard productId={product.id} model={product.model} storage={product.storage} />
            <ActivePromotionsCard />
          </div>
        </>
      )}
```

- [ ] **Step 6:** `App.tsx:473-479` — เปิด route ให้ FM/ACCOUNTANT:

```tsx
          <Route
            path="/products/:id"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']}>
                <ProductDetailPage />
              </ProtectedRoute>
            }
          />
```
> mount-safe แล้ว (verify ทีละ endpoint กับโค้ดจริง): `GET /products/:id` (`products.controller.ts:143-144`), `GET /branches` (`branches.controller.ts:18-19`), `GET /interest-configs/resolved` (`interest-config.controller.ts:39-40`), `GET /inspections/:id` (`quality-control/inspections.controller.ts:85-86`), `GET /promotions/active` (Task 3), `GET /products` (`products.controller.ts:33-34`) — ทั้งหมด `@Roles` ครบ 5 role; `GET /products/:productId/photos` (`quality-control/product-photos.controller.ts:17-19`) **ไม่มี `@Roles` เลย** = ผ่านทุก role ที่ login แล้ว
> `BranchGuard` ก็ผ่าน: FINANCE_MANAGER + ACCOUNTANT อยู่ใน `CROSS_BRANCH_ROLES` (`auth/branch-access.util.ts:13-17`) → `canActivate` คืน true ทันที

- [ ] **Step 7:** รันเทสต์ทั้ง 2 แอป:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest --runInBand src/modules/products src/modules/promotions
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run
```
คาดหวัง: api ทุก suite ในสองโมดูลเขียว, web ทุกไฟล์เขียว (ไม่มี regression จากไฟล์เดิม)

- [ ] **Step 8:** ปิด gate — **รันทีละคำสั่ง ห้ามร้อยด้วย `&&`** (คำสั่งที่ fail จะบังคับให้คำสั่งถัดไปไม่รัน และ exit code ปนกัน):
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx tsc --noEmit
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npm run lint --workspace=apps/api
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx tsc --noEmit
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx eslint .
```
คาดหวัง:
- `tsc` ทั้ง 2 แอป = **0 error**
- api lint = **ไม่มี error ใหม่จากไฟล์ที่ B1 แก้** (ถ้าอยากดูเฉพาะของตัวเอง: `cd apps/api && npx eslint src/modules/products src/modules/promotions`). **ห้ามใช้ `npx eslint .` เป็นเกณฑ์** — มี 34 error ค้างมาก่อน B1 จากไฟล์นอก tsconfig (`e2e/`, `scripts/`, `eslint.config.mjs`) และ **ห้ามแก้ tsconfig/eslint config เพื่อไล่มัน** (นอก scope)
- web eslint = **0 error** (warning ค้าง 513 ปล่อยได้)
- ถ้า eslint จับ unused import จากของที่ลบใน Task 7 ให้เก็บกวาดตรงนี้

- [ ] **Step 9:** Commit: `feat(product-page): แก้ลิงก์ตายไปแก้ราคา, ซ่อนปุ่มทำสัญญาจาก FM/ACC, เปิดหน้าสินค้าให้ FM/ACCOUNTANT`

---

## Deployment & Verification

### ลำดับ deploy
1. **ต้อง deploy หลัง B0 เท่านั้น** — B1 พึ่งของจาก B0 3 อย่าง: endpoint `GET /products/:id/readiness`, คอลัมน์ใหม่ `priceAutofilledAt`/`accessoriesIncluded`/`cosmeticNotes` (migration `20260982000000`) และ backfill ราคา. (คอลัมน์ `cashPrice`/`installmentPrice`/`shopWarrantyDays`/`conditionGrade` มีบน main อยู่แล้ว — ไม่ได้พึ่ง B0) ถ้า B0 ยังไม่ขึ้น prod: การ์ด readiness โชว์ "ตรวจสถานะขึ้นเว็บไม่สำเร็จ", badge autofill ไม่ขึ้นเลย, และ **การกดบันทึกอุปกรณ์/ตำหนิจะ 500** (`PrismaClientValidationError` — คอลัมน์ยังไม่มี)
2. **…แต่ต้อง deploy วันเดียวกับ B0 ห้ามห่างหลายวัน** — ระหว่าง B0 ขึ้น prod ถึง B1 ขึ้น prod จะ **ไม่มี UI ไหนเขียนคอลัมน์ `cashPrice`/`installmentPrice` ได้เลย** (ของเดิมแก้ได้แค่แถว `ProductPrice`) ทั้งที่เว็บลูกค้า + readiness อ่านคอลัมน์แล้ว → พนักงานตั้งราคาผ่านตารางเดิมแล้ว "เครื่องไม่ขึ้นเว็บ" โดยไม่มีอะไรฟ้อง. ตัวปลดล็อกคือช่องราคาเงินสด/ราคาผ่อนใน `EditSellingPriceModal` (Task 7) + `UpdateProductDto` (Task 4) ที่ยิง `PATCH /products/:id` เดิม — ถ้าจำเป็นต้องแยก ยกเฉพาะสองส่วนนี้ไปท้าย B0 ได้ (ดู Global Constraints)
3. **ไม่มี migration ใน batch นี้** → deploy ปกติ (merge → GitHub Actions → Cloud Run + Firebase) ไม่ต้องรัน job ใดๆ ก่อน
4. PR เดียวต่อ batch: `feat/pa-b1-admin-product-page` → `main`; CI gate ("Lint & Test") ต้องเขียว + code-owner review 1 คน (owner กดเอง — agent ห้าม `--admin` เว้นแต่ user สั่งชัดเจนเป็นประโยค)
5. env ใหม่ (ตัวเลือก): `VITE_SHOP_URL` — **ไม่ตั้งก็ได้** ค่า default = `https://www.bestchoicephone.com` ตรงกับ canonical ของ web-shop; ตั้งเมื่ออยากให้ dev/staging ชี้โดเมนอื่นเท่านั้น (ตั้งใน GitHub Actions build step ของ apps/web)

### QA บน local (บังคับ — prod ปฏิเสธ seed accounts)
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && npm run dev     # api :3000 + web :5173
```
- [ ] ล็อกอิน `admin@bestchoice.com / admin1234` → เปิด `/stock/products` → กดเข้าเครื่องหนึ่ง
  - เห็นการ์ด **ราคาขาย** (เงินสด/ผ่อน) + ปุ่ม "แก้ราคา" → แก้แล้วบันทึก → ตัวเลขบนการ์ดเปลี่ยนทันที (invalidate ทำงาน)
  - เห็น **ราคาทุน + กำไร**, เห็น **ผลตรวจรายข้อ** (ถ้าเครื่องมี inspection), เห็น **เครื่องอื่นรุ่นเดียวกัน** และ **โปรที่ใช้ได้ตอนนี้**
  - กด **คัดลอกสรุปส่งลูกค้า** → วางในช่องข้อความ → ข้อความต้องมีบรรทัดผ่อนที่ตัวเลขตรงกับที่ BcCalculatorCard แสดง (ดาวน์/งวด/ค่างวด)
  - แท็บ **ขึ้นเว็บ** → การ์ดสถานะขึ้นเว็บไล่ทีละข้อ; ปิด/เปิดสวิตช์ "แสดงบนเว็บ shop" ได้
- [ ] ล็อกอิน `sales1@bestchoice.com / admin1234` → เปิดเครื่องเดิม
  - **ต้องไม่เห็น** การ์ดราคาทุน/กำไร; เปิด DevTools → Network → `GET /products/<id>` response **ต้องไม่มีคีย์ `costPrice`**
  - `/stock` ต้องไม่พัง (บรรทัดมูลค่าสต็อกหายไปเฉยๆ ไม่ใช่ 0 ฿ และไม่ crash)
  - ยังกด "ใช้ราคานี้ทำสัญญา" ได้
- [ ] ล็อกอิน `finance@bestchoice.com / admin1234` (FINANCE_MANAGER) และ `accountant@bestchoice.com / admin1234`
  - เปิด `/products/:id` ได้ (ไม่ขึ้น "ไม่มีสิทธิ์เข้าถึง")
  - เห็นราคาทุน/กำไร; **ไม่เห็น** ปุ่ม "ใช้ราคานี้ทำสัญญา"; การ์ดโปรโหลดสำเร็จ (ไม่มี 403 ใน console)
- [ ] เครื่องที่ยังไม่มีราคาผ่อน: ข้อความ "ยังไม่ได้กำหนดราคาเงินผ่อน" → OWNER/BM เห็นปุ่ม "ไปแก้ราคา" ที่ **เปิด modal** (ไม่ใช่ navigate ไป 404); SALES เห็น "แจ้งผู้จัดการให้กำหนดราคา"

### Verify หลัง deploy prod
- [ ] `GET https://api.bestchoicephone.app/api/health` = 200
- [ ] เปิด `admin.bestchoicephone.app/products/<id ที่มีจริง>` ด้วยบัญชี owner จริง → การ์ดครบ, กดคัดลอกสรุปได้, ลิงก์ที่คัดลอกเปิดหน้าเว็บลูกค้าได้จริง (ถ้าเครื่องนั้น ready)
- [ ] Sentry ไม่มี error ใหม่จาก `ProductDetailPage` ภายใน 30 นาทีแรก

### ผลกระทบต่อ batch ถัดไป (ต้องแจ้งก่อนเริ่ม B2-B5)
- `apps/web/src/pages/ProductDetailPage/index.tsx` **ถูกยกโครงใหม่ใน B1** (ลบ price CRUD ชุดเดิมทั้งก้อน + แทรกการ์ดใหม่ 6-7 ตัว) → **เลขบรรทัดที่แผนอื่นจดไว้ก่อนหน้าใช้ไม่ได้อีก**. ที่ต้องแก้แน่ๆ คือ **B5** ซึ่ง anchor ไว้ที่ `ProductDetailPage/index.tsx (119-125, 352)` — ตอนลงมือ B5 ให้ **grep หา anchor ข้อความ** (ท้าย `branches` query / แถบแท็บ) แทนการนับบรรทัด แล้วยืนยันกับไฟล์จริงก่อนแทรกโค้ด
- ไฟล์อื่นที่ B1 แตะแล้ว batch หลังอาจชน: `components/OnlineListingPanel.tsx` (บล็อก Switch ถูกแทนด้วย `ReadinessCard`), `components/InstallmentCalculatorCard.tsx` / `BcCalculatorCard.tsx` (prop signature เพิ่ม), `components/ProductInfo.tsx` (ตาราง `prices[]` เป็น read-only)

### งานฝั่ง owner (ไม่ใช่โค้ด)
- [ ] กรอก **ราคาเงินสด/ราคาผ่อน** ให้เครื่องที่ขายจริง (การ์ดราคาใหม่คือทางที่เร็วที่สุดตอนนี้) — ราคาที่ badge ขึ้นว่า "เติมอัตโนมัติจากตารางราคากลาง" ต้องรีวิวว่าตรงราคาขายจริง (§9.4)
- [ ] ตัดสินใจว่าจะตั้ง `VITE_SHOP_URL` แยกสำหรับ staging หรือไม่ (ไม่ตั้ง = ใช้ www.bestchoicephone.com)

---

## สิ่งที่ batch นี้ไม่ทำ (ตาม scope ที่ spec ตัด / เลื่อนไป batch อื่น)

- **ปุ่มคัดลอกลิงก์ยังชี้ `/products/:id` ตรง** — share endpoint `GET /api/shop/share/:id` (OG/JSON-LD) เป็นงาน **B4** §6; เมื่อ B4 ขึ้นให้แก้ที่ `buildShopProductUrl` จุดเดียว
- **ไม่แตะ inbox/แชท** — ปุ่ม "ส่งให้ลูกค้า" ในแชท, product picker ใน composer, การ์ดสินค้า 2 bubble, บั๊ก "รูปจาก composer ไม่ถึงลูกค้า" = **B2** §4
- **ไม่แตะบอท** — `search_products`/`calculate_installment`/grounding guard/น้องเบส = **B3** §5
- **ไม่กรองโปรรายเครื่อง** — การ์ดโปรแสดงโปรที่ active ทั้งหมดพร้อม label "ยังไม่กรองรายเครื่อง (มาใน B3)"; `list_promotions` filter จริงอยู่ใน B3 §5
- **ไม่ทำ `/p/:slug` + dynamic sitemap** — ตัดออกแล้วตาม §1 (scrutinize): `/products/:id` ทำหน้าที่ permalink ได้
- **ไม่ทำ `ChatRoom.attachedProductId` + ตัวแปรสินค้าใน canned response** — ตัดออกตาม §1
- **ไม่แก้ `GET /products/stock/dashboard`** — `marginOverview.totalCost/totalSell/avgMarginPct` ยังส่งให้ SALES ทาง wire (UI ซ่อนด้วย `isManager` อยู่แล้วที่ `StockHeroKpi.tsx:120`) — spec §3 ระบุแค่ findOne/findAll/stock; ทำต่อได้เป็น follow-up สั้นๆ ถ้า owner ต้องการปิดให้ครบ
- **ไม่ทำ autofill ราคาจาก PricingTemplate / write-through ไป `prices[]` / backfill prod** — ทั้งหมดเป็น **B0** §2.1 (B1 แค่เขียนคอลัมน์ผ่าน DTO เดิม)
- **ไม่แก้เครื่องคิดเงินสัญญา (`useContractCalculation`)** — เป็น red-line path ของ B0 ที่มี golden test ของตัวเอง; B1 ไม่แตะแม้แต่บรรทัดเดียว
- **ไม่มี e2e/Playwright ใหม่** — ปิดด้วย vitest component tests + QA มือบน local ตาม §10
