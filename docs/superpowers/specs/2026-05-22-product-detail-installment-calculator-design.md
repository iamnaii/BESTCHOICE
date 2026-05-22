# Product Detail Installment Calculator (BC + GFIN) — Design

**Date:** 2026-05-22
**Status:** Design (awaiting plan)
**Author:** Owner + Claude (brainstorming session)
**Approach:** B — Refactor existing flows to use a single source of truth for installment math

## Problem & Goal

Owner / sales / customers cannot quickly preview installment options for a product. Today, calculation lives only inside the Contract Creation flow (`useContractCalculation.ts`), which is reachable only when actually opening a sale.

**Goal:** Show a side-by-side installment preview on the Product Detail page — for **both** BC FINANCE (in-house, VAT, owner sets rate per month-count) and GFIN (external finance, rate table per month-count, OVERPRICE trick to lower customer's down payment).

**Audience:** Both internal (owner / sales) on `apps/web/.../ProductDetailPage.tsx` AND customers on `apps/web-shop/.../ProductDetailPage.tsx`.

**Constraint:** The preview MUST equal the actual contract math. A single source of truth utility is mandatory (Approach B) — diverging values across preview vs. contract is a customer-dispute risk.

---

## Business Rules (locked in from owner)

### BC FINANCE (in-house)

| Field | Value |
|---|---|
| Max GFIN price (overprice) | None — uses `installmentPrice` directly |
| % เงินดาวน์ ขั้นต่ำ | 15% of `installmentPrice` (customer can pay more) |
| % คอมมิชชั่น | 10% of `financedAmount` |
| VAT | 7% on `(financed + interest + commission)` |
| ดอกเบี้ย | **Per total contract** (not per month) — lookup table: |
| | 5 mo → 40%, 6 mo → 40%, 7 mo → 50%, 8 mo → 50%, 10 mo → 50%, 12 mo → 50% |
| งวดที่อนุญาต | 5, 6, 7, 8, 10, 12 only (no 9, 11, >12) |
| FINANCE → SHOP transfer | `financedAmount + commission` (consistent with memory rule) |

**Formula (verified with owner's worked example, iPhone 14 Pro 128GB, installmentPrice=19,900, 12 mo):**

```
downAmount   = installmentPrice × downPct        (19,900 × 0.15 = 2,985)
financed     = installmentPrice - downAmount     (19,900 - 2,985 = 16,915)
interest     = financed × ratePct(months)         (16,915 × 0.50 = 8,457.50)
commission   = financed × 0.10                    (16,915 × 0.10 = 1,691.50)
subtotal     = financed + interest + commission   (27,064)
vat          = subtotal × 0.07                    (1,894.48)
totalWithVat = subtotal + vat                     (28,958.48)
monthlyPmt   = totalWithVat / months              (28,958.48 / 12 = 2,413.21)
financeToShop = financed + commission             (18,606.50)
```

### GFIN (external finance)

| Field | Value |
|---|---|
| GFIN max price | Per (series × variant × storage × condition) lookup table — owner-maintained monthly |
| OVERPRICE rule | Per (series pattern × condition): allowance amount (typical 1,000 / 2,000 ฿) |
| ราคาส่ง GFIN | `maxPrice + overpriceAllowance` |
| ส่วนลดดาวน์ | `gfinSubmitPrice - installmentPrice` (passed to customer) |
| % ดาวน์ | 30% (fixed) — owner confirmed same for all models |
| % คอมมิชชั่น | 15% (fixed) — same for all models |
| ดาวน์ตามสูตร | `gfinSubmitPrice × 0.30` |
| **ดาวน์จริง (ลูกค้าจ่าย)** | `ดาวน์ตามสูตร - ส่วนลดดาวน์` |
| ยอดจัด | `gfinSubmitPrice - ดาวน์ตามสูตร` |
| ค่างวด | `factor(months) × ยอดจัด + 100 ฿/งวด` (fee fixed at 100 per installment) |
| งวดที่อนุญาต | 3 - 12 (per existing GFIN table) |
| Rate factor | Per month count — same for all models, owner-maintained |

**Formula (verified with owner's worked example, iPhone 14 Pro 128GB มือ2, installmentPrice=19,900, maxPrice=21,500, allowance=1,000, 12 mo, factor(12)=0.17924):**

```
gfinSubmitPrice  = 21,500 + 1,000 = 22,500
downDiscount     = 22,500 - 19,900 = 2,600
downAmountFormula = 22,500 × 0.30 = 6,750
downAmountActual  = 6,750 - 2,600 = 4,150       ← customer pays this
financed         = 22,500 - 6,750 = 15,750
monthlyPmt       = 0.17924 × 15,750 + 100 = 2,923   (approximation; actual factor stored as Decimal(8,6))
```

**Mapping Product → GFIN row:**
- `Product.brand === "Apple"` (currently only Apple in GFIN table)
- `Product.model contains mapping.modelMatchPattern` (e.g. "iPhone 14 Pro")
- `Product.storage === mapping.storage` (string equality)
- `Product.category === PHONE_NEW → HAND_1`, `PHONE_USED → HAND_2`

If no mapping row matches → GFIN preview disabled with tooltip.

---

## Section 1 — Schema Changes

### 1.1 `Product` model (additive, nullable)

```prisma
model Product {
  // ... existing
  cashPrice         Decimal? @db.Decimal(12,2)  // ราคาเงินสด (UI standalone)
  installmentPrice  Decimal? @db.Decimal(12,2)  // ราคาเงินผ่อน (used by BC + GFIN calc)
  // prices[] relation kept for future tier use (VIP, member) — NOT used for cash/installment after migration
}
```

**Existing usable fields (no change):**
- `storage String?` — used for GFIN mapping match
- `category ProductCategory` (PHONE_NEW / PHONE_USED / ACCESSORY / ...) — used for HAND_1/HAND_2 mapping
- `conditionGrade String?` — informational
- `brand`, `model`, `name` — used for GFIN match

### 1.2 GFIN configuration tables (3 new)

```prisma
enum GfinCondition {
  HAND_1
  HAND_2
}

model GfinModelMapping {
  id                String        @id @default(uuid())
  gfinSeries        String        // "iPhone 14"
  gfinVariant       String?       // "Pro" | "Pro Max" | "Plus" | "Air" | "e" | null (base)
  storage           String        // "128GB" — must match Product.storage exactly
  condition         GfinCondition
  maxPrice          Decimal       @db.Decimal(12,2)
  modelMatchPattern String        // substring matched against Product.model (e.g. "iPhone 14 Pro")
  isActive          Boolean       @default(true)
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  deletedAt         DateTime?

  @@unique([gfinSeries, gfinVariant, storage, condition])
  @@index([modelMatchPattern])
}

model GfinOverpriceRule {
  id            String        @id @default(uuid())
  label         String        // human-readable: "iPhone Series 15-17 มือ 1"
  seriesPattern String        // pipe-separated list of exact-match values against GfinModelMapping.gfinSeries
                              // e.g. "iPhone 15|iPhone 16|iPhone 17"
  condition     GfinCondition
  allowance     Decimal       @db.Decimal(12,2)
  isActive      Boolean       @default(true)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  deletedAt     DateTime?

  @@index([condition, isActive])
}

model GfinRateFactor {
  id                String   @id @default(uuid())
  months            Int      @unique
  factor            Decimal  @db.Decimal(8,6)   // multiplier on financedAmount (per month)
  feePerInstallment Decimal  @db.Decimal(12,2) @default(100)
  isActive          Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?
}
```

**Why real tables (not SystemConfig JSON):**
- 86 rows total — small overhead
- Memory: codebase strongly favors audit logs + soft delete per row (PEAK_MAPPING_UPDATED pattern)
- Owner edits monthly via admin UI — fewer errors than editing JSON blob
- FK + unique constraints enforced at DB

### 1.3 BC rate refactor — `InterestConfigRate` (Approach B core)

```prisma
model InterestConfig {
  // existing fields kept: name, productCategories, minDownPaymentPct, storeCommissionPct,
  //                       vatPct, minInstallmentMonths, maxInstallmentMonths
  // REMOVED in PR 9: interestRate (single value column)
  rates  InterestConfigRate[]
}

model InterestConfigRate {
  id        String           @id @default(uuid())
  configId  String
  config    InterestConfig   @relation(fields: [configId], references: [id], onDelete: Cascade)
  months    Int
  ratePct   Decimal          @db.Decimal(5,4)  // 0.40 = 40% TOTAL contract (not per-month)
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt
  deletedAt DateTime?

  @@unique([configId, months])
}
```

**Semantics change:** old `interestRate Decimal(5,4)` was used as `principal × interestRate × months` (rate per month flat). New `ratePct` is used as `principal × ratePct(months)` (rate per total contract). The two are NOT interchangeable — backfill must convert.

**Backfill rule for InterestConfigRate (preserves backward compat):**
For each existing `InterestConfig`, generate one `InterestConfigRate` row per month in `[minInstallmentMonths, maxInstallmentMonths]` with `ratePct = oldInterestRate × month`. Owner then adjusts to true rates via admin UI (e.g., 12-mo row from `4.17% × 12 = 50%` becomes the explicit 50% — same value, new semantic).

---

## Section 2 — Calc Utility (Single Source of Truth)

**Location:** `packages/shared/src/installment-calc.ts` (new file in shared package — importable by API, web, web-shop).

```typescript
import Decimal from 'decimal.js';

// ===== BC =====
export interface BcCalcInput {
  installmentPrice: Decimal;
  months: number;                    // 5,6,7,8,10,12
  downPct?: Decimal;                 // override (default = config.minDownPct)
  customDownAmount?: Decimal;        // alternative: override as amount (mutually exclusive with downPct)
  config: {
    minDownPct: Decimal;             // 0.15
    commissionPct: Decimal;          // 0.10
    vatPct: Decimal;                 // 0.07
    ratePctByMonths: Map<number, Decimal>;  // { 5: 0.40, 6: 0.40, 7: 0.50, ... }
  };
}

export interface BcCalcOutput {
  sellingPrice: Decimal;
  downPct: Decimal;
  downAmount: Decimal;
  financedAmount: Decimal;
  interestPct: Decimal;
  interestAmount: Decimal;
  commissionPct: Decimal;
  commissionAmount: Decimal;
  subtotal: Decimal;
  vatAmount: Decimal;
  totalWithVat: Decimal;
  monthlyPayment: Decimal;
  financeToShop: Decimal;
  // diagnostic
  isValid: boolean;
  errors: string[];                  // e.g. "down < minDown", "months not in rate table"
}

export function calcBcInstallment(input: BcCalcInput): BcCalcOutput;

// ===== GFIN =====
export interface GfinCalcInput {
  installmentPrice: Decimal;          // BC's installmentPrice — used to compute downDiscount
  product: { brand: string; model: string; storage: string; category: 'PHONE_NEW' | 'PHONE_USED' };
  months: number;                     // 3-12
  downPct?: Decimal;                  // default 0.30
  mapping: GfinModelMapping;
  overpriceRule: GfinOverpriceRule | null;
  rateFactor: GfinRateFactor;
}

export interface GfinCalcOutput {
  gfinSubmitPrice: Decimal;
  downDiscount: Decimal;
  downPct: Decimal;
  downAmountByFormula: Decimal;
  downAmountActual: Decimal;
  financedAmount: Decimal;
  monthlyPayment: Decimal;
  totalPayback: Decimal;
  isValid: boolean;
  errors: string[];
}

export function calcGfinInstallment(input: GfinCalcInput): GfinCalcOutput;

// ===== Helpers =====
export function findGfinMapping(
  product: { brand: string; model: string; storage: string; category: string },
  mappings: GfinModelMapping[],
): GfinModelMapping | null;

export function findGfinOverpriceRule(
  mapping: GfinModelMapping,
  rules: GfinOverpriceRule[],
): GfinOverpriceRule | null;
```

**Decimal precision:** uses `decimal.js` (already in dependency tree from `useContractCalculation.ts`). All intermediate values stay Decimal until final UI render.

**`useContractCalculation` refactor:** the hook becomes a thin React wrapper around `calcBcInstallment` + state management. All math moves to `installment-calc.ts`. All 16 existing tests transfer to the utility (with thinner hook tests added).

---

## Section 3 — GFIN Admin UI

**Route:** `/settings/gfin-rates` (OWNER only — `@Roles('OWNER')`)

**Module structure:**
```
apps/api/src/modules/gfin-config/
  gfin-config.module.ts
  gfin-config.controller.ts          // 12 endpoints (3 entities × 4 ops)
  gfin-config.service.ts
  dto/
    create-max-price.dto.ts
    update-max-price.dto.ts
    create-overprice-rule.dto.ts
    update-overprice-rule.dto.ts
    create-rate-factor.dto.ts
    update-rate-factor.dto.ts
```

**Endpoints (follow PEAK_MAPPING pattern):**
```
GET    /gfin-config/max-prices         OWNER, BM, FM, ACC, SALES (read for calc preview)
POST   /gfin-config/max-prices         OWNER
PATCH  /gfin-config/max-prices/:id     OWNER
DELETE /gfin-config/max-prices/:id     OWNER (soft delete)
// + parallel sets for /overprice-rules + /rate-factors
GET    /gfin-config/match-preview?productId=X   OWNER, BM, FM, ACC, SALES (debug helper)
```

**Audit log actions (action strings, no Prisma enum — matches AuditLog convention):**
- `GFIN_MAX_PRICE_CREATED` / `_UPDATED` / `_DELETED`
- `GFIN_OVERPRICE_CREATED` / `_UPDATED` / `_DELETED`
- `GFIN_RATE_FACTOR_CREATED` / `_UPDATED` / `_DELETED`

**UI (`apps/web/src/pages/GfinConfigPage.tsx`):**
- 3 tabs: "ราคาสูงสุด" | "Over Price" | "ตารางค่างวด"
- Tab 1 (MAX Prices): table with edit-in-row (series, variant, storage, condition, maxPrice, modelMatchPattern, isActive). Search by series. CSV import (paste raw OR upload) + export.
- Tab 2 (Overprice): table (label, seriesPattern, condition, allowance, isActive)
- Tab 3 (Rate Factors): table (months, factor, feePerInstallment, isActive)
- Each tab: "อัปเดตล่าสุด: YYYY-MM-DD HH:mm โดย <name>" header
- Banner if data older than 30 days: "ตาราง GFIN อัปเดตล่าสุดเมื่อ X วันที่แล้ว — ตรวจสอบกับ GFIN ว่ายังเป็นค่าปัจจุบัน"
- "Match Preview" tool: dropdown product → shows which mapping row matched (or "no match")

---

## Section 4 — Internal Preview UI (`apps/web/.../ProductDetailPage`)

**New component:** `apps/web/src/pages/ProductDetailPage/components/InstallmentCalculatorCard.tsx`

**Inserted into:** existing `ProductDetailPage` info tab (current layout has "info" | "photos" tabs — the calculator goes inside "info" below the price section).

**Layout (Layout A — 2 INDEPENDENT cards side-by-side):**

```
┌──────────────── เครื่องคำนวณค่างวด ────────────────┐
│  ┌── BESTCHOICE ──────┐    ┌── GFIN ────────────┐  │
│  │ % ดาวน์: [ 15 ▼ ]  │    │ % ดาวน์: [ 30 ▼ ]  │  │
│  │ เงินดาวน์: [_____] │    │ เงินดาวน์: [_____] │  │
│  │ งวด: [ 12 ▼ ]      │    │ งวด: [ 12 ▼ ]      │  │
│  │ ─────────────────  │    │ ─────────────────  │  │
│  │ ดาวน์    2,985 ฿  │    │ ราคาส่ง  22,500 ฿  │  │
│  │ ยอดจัด  16,915 ฿  │    │ ส่วนลดดาวน์ 2,600  │  │
│  │ ดอก 50%   8,457    │    │ ดาวน์จริง  4,150 ฿ │  │
│  │ คอม 10%   1,691    │    │ ยอดจัด   15,750 ฿  │  │
│  │ VAT 7%    1,894    │    │ ค่าธรรมเนียม 100/งวด│ │
│  │ ── ค่างวด ──       │    │ ── ค่างวด ──        │  │
│  │  2,413 / เดือน     │    │  2,923 / เดือน      │  │
│  │ [ ใช้ราคานี้ทำสัญญา ]│  │ (ส่ง GFIN ภายนอก)   │  │
│  └────────────────────┘    └────────────────────┘  │
└────────────────────────────────────────────────────┘
```

**Constraint differences:**
- BC card: `months ∈ {5,6,7,8,10,12}`, `minDown = 15%`, show commission + VAT (internal)
- GFIN card: `months ∈ {3..12}`, `minDown = 30%`, disabled if `findGfinMapping(product) === null` with tooltip

**Controls:**
- ดาวน์ input: dual-bind (% ↔ ฿), update each other on change
- งวด: dropdown of allowed months per card
- Real-time recalc on every keystroke (pure fn — no debounce needed)

**Actions:**
- **BC card:** "ใช้ราคานี้ทำสัญญา" → navigate `/contracts/create?productId=X&downAmount=X&months=12` — ContractCreatePage pre-fills from query params
- **GFIN card:** no "use" action (external) — informational only

**Degradation:**
- `installmentPrice = null` → hide entire calculator + show banner "ยังไม่กำหนดราคาเงินผ่อน — [ไปแก้ราคา]"
- GFIN mapping not found → BC card shown, GFIN card replaced with "รุ่นนี้ไม่อยู่ในตาราง GFIN" placeholder

**Permissions:**
- OWNER / BM / FM / ACC: full breakdown
- SALES: hide `commissionPct`, `commissionAmount`, `financeToShop` rows (still see ดาวน์ + ยอดจัด + ดอก + VAT + ค่างวด)

---

## Section 5 — Customer Preview UI (`apps/web-shop/.../ProductDetailPage`)

**Existing file:** `apps/web-shop/src/pages/ProductDetailPage.tsx`

**Same `InstallmentCalculatorCard` component**, but with `mode="customer"` prop:
- Hide: cost, commission, VAT breakdown, "ใช้ราคานี้ทำสัญญา" button
- Show: ดาวน์, งวด, ค่างวด/เดือน, totalWithVat (รวมทั้งสัญญา)
- Replace CTA with: "ทักสาขา (LINE)" / "สมัครออนไลน์" → existing `/shop/installment-apply` flow
- Disclaimer below card: "ค่างวดข้างต้นเป็นการประมาณการ — ราคาจริงเป็นไปตามสัญญาที่ลงนาม"

**Degradation behavior (customer mode):**
- `installmentPrice = null` → hide entire calculator card silently (no internal-style banner — keep customer experience clean)
- GFIN mapping not found → hide GFIN card silently (no "not in table" debug message — customer doesn't need to see it)
- If both BC and GFIN unavailable → no calculator section at all on the page

**Backend public endpoint (server-side calc — prevents leaking rate tables):**
```
GET /shop/installment-preview?productId=X&provider=BC&months=12&downPct=15
→ {
    available: true,
    provider: 'BC',
    monthlyPayment: 2413.21,
    downAmount: 2985,
    totalWithVat: 28958.48,
    financedAmount: 16915,
    months: 12,
    // GFIN-only:
    gfinSubmitPrice?: 22500,
    downDiscount?: 2600,
  }
```

- Server-side `calcBcInstallment` / `calcGfinInstallment` → response holds **results only**
- Max-price table, overprice rules, factors NEVER leak in payload
- Lives in `apps/api/src/modules/shop-catalog/` (existing public module)
- `ShopBotDefenseGuard` already on module (per memory)
- Throttle: 60 req/min per IP (matches LINE webhook throttle from memory v3)
- Add to `apps/api/src/modules/shop-catalog/shop-catalog.controller.ts`:
  ```typescript
  @Public()
  @Get('installment-preview')
  @Throttle(60, 60)
  getInstallmentPreview(@Query() dto: InstallmentPreviewDto) { ... }
  ```

**web-shop product API extension:**
- `GET /shop/products/:id` response gains `cashPrice`, `installmentPrice`, `installmentAvailable: boolean`, `gfinAvailable: boolean` — so frontend knows which cards to render before calling preview endpoint

---

## Section 6 — Refactor / Migration / Rollout

### PR sequence (9 PRs, each independently shippable)

| PR | Scope | Risk | Notes |
|---|---|---|---|
| 1 | Schema migration: add nullable fields on Product + create 4 new tables | Low | Additive only |
| 2 | `packages/shared/src/installment-calc.ts` + 30+ unit tests | Low | New code, no consumers |
| 3 | Backfill scripts + seed (`InterestConfigRate` from owner table, GFIN tables from owner-provided data) | Med | Data migration |
| 4 | Refactor 10 `InterestConfig.interestRate` consumers to use `getRateForMonths(configId, months)` helper. Behind feature flag `USE_NEW_RATE_LOOKUP` (default off). | **HIGH** | Touches contracts/sales/reports/PDF/sales-bot — split into sub-PRs if diff > 800 lines |
| 5 | Refactor 5 `ProductPrice` consumers to use `getDisplayPrices(product)` helper. POS, ContractCreate, StockPage, ProductInfo, useContractCalculation read `product.cashPrice`/`installmentPrice` directly. | Med | Pure refactor |
| 6 | `gfin-config` module + admin UI (`/settings/gfin-rates`) + audit logs | Low | New feature |
| 7 | `InstallmentCalculatorCard` + integrate `ProductDetailPage` (internal, `apps/web`) | Low | New UI |
| 8 | web-shop integration + public `GET /shop/installment-preview` endpoint | Med | Public API — bot guard + throttle |
| 9 | Drop `InterestConfig.interestRate` column (cleanup after PR 4 stable in prod ≥ 2 weeks) | Low | Schema cleanup |

### Backfill specifics (PR 3)

**Product price backfill (matches existing `useContractCalculation.ts:35-38` label-priority convention):**

```typescript
// Run as one-off TS migration script — NOT raw SQL, to preserve priority logic
for (const product of await prisma.product.findMany({
  include: { prices: { where: { deletedAt: null } } },
})) {
  const prices = product.prices;

  // installmentPrice: priority 1 = exact "ราคาผ่อน BESTCHOICE", 2 = any label starting with "ราคาผ่อน"
  const installmentPrice =
    prices.find(p => p.label === 'ราคาผ่อน BESTCHOICE')?.amount ??
    prices.find(p => p.label.startsWith('ราคาผ่อน'))?.amount ??
    null;

  // cashPrice: priority 1 = exact "ราคาเงินสด", 2 = any label starting with "ราคาเงินสด"
  const cashPrice =
    prices.find(p => p.label === 'ราคาเงินสด')?.amount ??
    prices.find(p => p.label.startsWith('ราคาเงินสด'))?.amount ??
    null;

  if (installmentPrice || cashPrice) {
    await prisma.product.update({
      where: { id: product.id },
      data: { installmentPrice, cashPrice },
    });
  }
}
```

Products without matching labels → both fields stay null. Owner fills via UI. ProductDetailPage shows warning banner. Existing ProductPrice rows are NOT deleted — they remain readable and act as a safety net during the transition.

**Existing ProductPrice rows are NOT deleted** in PR 3. PR 5 may optionally clean them up after refactor — kept as escape hatch.

**InterestConfigRate seed (preserves current behavior):**
```typescript
for (const cfg of await prisma.interestConfig.findMany()) {
  const rate = Number(cfg.interestRate);  // e.g. 0.0417 for old 4.17%/month
  for (let m = cfg.minInstallmentMonths; m <= cfg.maxInstallmentMonths; m++) {
    await prisma.interestConfigRate.create({
      data: {
        configId: cfg.id,
        months: m,
        ratePct: new Decimal(rate).times(m).toDecimalPlaces(4),  // rate × months = total
      },
    });
  }
}
```

Owner then adjusts to new desired values per the table (5→40%, 6→40%, 7→50%, 8→50%, 10→50%, 12→50%) via admin UI.

**GFIN seed:** owner provides snapshot of current GFIN table (image already shared). Migration creates rows from a JSON fixture committed to repo. After deploy, owner edits monthly via admin UI.

### Tests

- **Calc utility (PR 2):** ≥30 unit tests covering:
  - BC: all 6 months × default down + 3 custom-down scenarios + edge (down ≥ price, months not in table)
  - GFIN: all 10 months × default down + edge (no mapping, no overprice, factor missing)
  - Worked examples from owner reproduced exactly (validates against the canonical numbers above)
- **Backfill (PR 3):** snapshot test (mocked data set → expected post-migration state)
- **GFIN match (PR 2):** 10+ cases — "iPhone 14 Pro" vs "iPhone 14 Pro Max" disambiguation, "iPhone 14 PRO" case-insensitive, storage normalization ("128 GB" vs "128GB"), missing condition
- **Regression (PR 4):** contracts.service.spec verifies that for the migrated `InterestConfigRate` (rate × months preserved), every existing contract math result is byte-identical to pre-refactor
- **E2E (Playwright):**
  - `apps/web/e2e/product-detail-calc.spec.ts` — interactive recalc, card disabled when mapping missing, navigate to ContractCreate pre-filled
  - `apps/web-shop/e2e/installment-preview.spec.ts` — customer-mode card hides internal fields, CTA wires to apply endpoint

### Rollout

- **Phase A (PR 1-3):** schema + backfill in production, no user-visible change
- **Phase B (PR 4):** flag `USE_NEW_RATE_LOOKUP=false`, deploy. Enable per branch / per company. Monitor contract math. Toggle off if regression. Once stable 2 weeks → make default true. Drop flag in PR 9.
- **Phase C (PR 5):** ProductPrice refactor — no flag (pure refactor, output-identical)
- **Phase D (PR 6-7):** admin UI + internal preview — release to OWNER first, then broaden to BM/FM/ACC/SALES
- **Phase E (PR 8):** web-shop customer-facing preview — gradual rollout via web-shop deploy

### Risks & Mitigation

| Risk | Mitigation |
|---|---|
| PR 4 math semantic change diverges contract values | Backfill `ratePct = oldRate × months` keeps output identical → only when owner edits via UI does behavior change |
| GFIN tables go stale | Banner on admin page + reminder in product detail when mapping > 30 days old |
| Public `/shop/installment-preview` abuse / scraping | ShopBotDefenseGuard + 60 req/min throttle + log abnormal patterns |
| Backfill leaves most products with null prices | Calculator gracefully hides + warning banner with "edit" deep link |
| Owner fat-fingers a rate in admin UI | Audit log + soft delete + Match Preview tool to validate before save |
| `useContractCalculation` hook tests break | Move tests to utility level in PR 2 (before refactor in PR 4) — utility tests are richer + stable |

### Out of scope (Phase 2)

- LIFF product detail page (`/liff/product/:id`) — not in current scope
- Multiple external finance companies (KTC, Aeon, …) — current design hard-codes "GFIN" as the only external provider
- Per-category BC rate variation — current InterestConfigRate is per (config, months); if owner needs different rates for มือ1 vs มือ2, owner creates separate InterestConfig with its own rate set (already supported by existing schema)
- Promotion overlay ("ผ่อน 0% โปรเดือนนี้") — calculator does not apply promotions
- Compare > 2 providers (e.g. BC + GFIN + KTC side-by-side) — current layout is hardcoded 2-card
- Save preview as PDF / shareable link
- Combo-offer calculator (phone + accessory bundle financing)
- Promotion calculator integration with existing `/promotions` module

---

## Verified worked examples (canonical test fixtures for PR 2)

**Example A — BC: iPhone 14 Pro 128GB, installmentPrice=19,900, 12 mo, down=15%**
```
sellingPrice    19,900
downPct         0.15
downAmount      2,985.00
financed        16,915.00
interestPct     0.50
interest        8,457.50
commissionPct   0.10
commission      1,691.50
subtotal        27,064.00
vat             1,894.48
totalWithVat    28,958.48
monthlyPayment  2,413.21          (28,958.48 / 12, rounded half-up to .01)
financeToShop   18,606.50
```

**Example B — GFIN: iPhone 14 Pro 128GB มือ2, installmentPrice=19,900, maxPrice=21,500, allowance=1,000, 12 mo, factor=0.179238 (precise), fee=100**
```
gfinSubmitPrice     22,500
downDiscount        2,600
downPct             0.30
downAmountFormula   6,750
downAmountActual    4,150
financedAmount      15,750
factor(12)          0.179238            (calibrated so payment matches owner's 2,923)
monthlyPayment      2,923.00            ((0.179238 × 15,750) + 100)
totalPayback        35,076.00           (2,923 × 12)
```

(Factor precision will be locked when owner enters real values in admin UI. The test fixture uses owner's worked example as ground truth.)

---

## Open questions resolved during brainstorming

| Q | A |
|---|---|
| BC interest semantics | Total contract % per month-count (not per-month rate × months) |
| BC available months | 5, 6, 7, 8, 10, 12 only |
| BC custom down | Customer can pay more than 15% min |
| BC commission % | Fixed 10% globally (no per-category variation in scope) |
| BC VAT | 7% on (financed + interest + commission) |
| GFIN rate | Per month-count, same for all models, fee 100 ฿/งวด on top |
| GFIN max price | Per (series, variant, storage, condition) — owner-maintained monthly |
| OVERPRICE rule | Per (series pattern, condition) — fixed allowance 1,000 or 2,000 ฿ |
| GFIN downDiscount | `gfinSubmitPrice - installmentPrice` (passed to customer as ดาวน์ลด) |
| Audience | Both internal (web) + customer (web-shop) — same calc utility |
| Price storage | New fields `cashPrice` + `installmentPrice` on Product (option B chosen over labeled-array convention) |
| GFIN config storage | Real tables (audit + soft delete) — not SystemConfig JSON |
| GFIN mapping | Separate `GfinModelMapping` table — NOT denormalized columns on Product |
