# Product Detail Installment Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a side-by-side installment calculator preview on the Product Detail page (internal `apps/web` + customer `apps/web-shop`) for BESTCHOICE in-house finance and GFIN external finance, backed by a single shared calc utility so the preview equals the actual contract math.

**Architecture:** All math lives in `packages/shared/src/installment-calc.ts` using `decimal.js`. The existing `useContractCalculation` React hook becomes a thin wrapper. Backend services that previously used `calculateInstallment(sellingPrice, downPayment, interestRate, totalMonths, ...)` are refactored to call the new utility with `(installmentPrice, downAmount, ratePctByMonths, months, ...)`. GFIN configuration lives in three new tables (real schema, soft-delete + audit log per memory convention — NOT SystemConfig JSON). Customer-facing preview calls the math server-side and returns only the results, never leaking rate tables.

**Tech Stack:** NestJS, Prisma + PostgreSQL, React 18 + Vite + TypeScript, Tailwind + shadcn/ui, decimal.js, Jest (API), Vitest (web/web-shop), Playwright (E2E).

**Source spec:** `docs/superpowers/specs/2026-05-22-product-detail-installment-calculator-design.md`

---

## File Structure (created or modified)

### New files

```
packages/shared/src/installment-calc.ts                                  (calc utility)
packages/shared/src/installment-calc.types.ts                            (shared types)
packages/shared/src/installment-calc.test.ts                             (utility unit tests)
packages/shared/src/installment-calc.bc.test.ts                          (BC scenarios)
packages/shared/src/installment-calc.gfin.test.ts                        (GFIN scenarios)

apps/api/src/modules/gfin-config/gfin-config.module.ts
apps/api/src/modules/gfin-config/gfin-config.controller.ts
apps/api/src/modules/gfin-config/gfin-config.service.ts
apps/api/src/modules/gfin-config/gfin-config.service.spec.ts
apps/api/src/modules/gfin-config/gfin-config.controller.spec.ts
apps/api/src/modules/gfin-config/dto/max-price.dto.ts
apps/api/src/modules/gfin-config/dto/overprice-rule.dto.ts
apps/api/src/modules/gfin-config/dto/rate-factor.dto.ts

apps/api/src/utils/get-rate-for-months.util.ts                           (BC rate helper)
apps/api/src/utils/get-rate-for-months.util.spec.ts

apps/api/src/modules/shop-catalog/dto/installment-preview.dto.ts
apps/api/src/modules/shop-catalog/installment-preview.service.ts
apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts

apps/api/scripts/backfill-product-prices.ts                              (one-off PR 3 script)
apps/api/scripts/seed-interest-config-rates.ts                           (one-off PR 3 script)
apps/api/scripts/seed-gfin-tables.ts                                     (one-off PR 3 script)
apps/api/prisma/fixtures/gfin-2026-05-22.json                            (initial GFIN snapshot)

apps/web/src/pages/GfinConfigPage/index.tsx
apps/web/src/pages/GfinConfigPage/MaxPricesTab.tsx
apps/web/src/pages/GfinConfigPage/OverpriceRulesTab.tsx
apps/web/src/pages/GfinConfigPage/RateFactorsTab.tsx
apps/web/src/pages/GfinConfigPage/MatchPreviewPanel.tsx
apps/web/src/pages/GfinConfigPage/__tests__/MaxPricesTab.test.tsx

apps/web/src/pages/ProductDetailPage/components/InstallmentCalculatorCard.tsx
apps/web/src/pages/ProductDetailPage/components/BcCalculatorCard.tsx
apps/web/src/pages/ProductDetailPage/components/GfinCalculatorCard.tsx
apps/web/src/pages/ProductDetailPage/components/__tests__/InstallmentCalculatorCard.test.tsx

apps/web/src/utils/getDisplayPrices.ts                                   (web helper)
apps/web/src/utils/getDisplayPrices.test.ts

apps/web-shop/src/components/InstallmentCalculatorCard.tsx               (customer-mode card)
apps/web-shop/src/components/__tests__/InstallmentCalculatorCard.test.tsx

apps/web/e2e/product-detail-calc.spec.ts
apps/web-shop/e2e/installment-preview.spec.ts

apps/api/prisma/migrations/<timestamp>_installment_calc_phase_a/migration.sql
apps/api/prisma/migrations/<timestamp>_drop_interest_rate_column/migration.sql
```

### Modified files

```
apps/api/prisma/schema.prisma                                            (Product fields + 4 new tables)
apps/api/src/app.module.ts                                               (register GfinConfigModule)
apps/api/src/utils/installment.util.ts                                   (PR 4 — bridge to shared)
apps/api/src/modules/contracts/contracts.service.ts                       (PR 4)
apps/api/src/modules/sales/sales.service.ts                               (PR 4)
apps/api/src/utils/config.util.ts                                         (PR 4)
apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts        (PR 4)
apps/api/src/modules/migration/migration.service.ts                       (PR 4)
apps/api/src/modules/reports/reports.service.ts                           (PR 4)
apps/api/src/modules/defect-exchange/defect-exchange.service.ts           (PR 4)
apps/api/src/modules/staff-chat/services/product-detect.service.ts        (PR 4)
apps/api/src/modules/contracts/documents.service.ts                       (PR 4)

apps/web/src/pages/POSPage/index.tsx                                      (PR 5)
apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts     (PR 5 — wrap shared)
apps/web/src/pages/ContractCreatePage/components/ProductSelectStep.tsx    (PR 5)
apps/web/src/pages/StockPage/ProductsPage.tsx                             (PR 5)
apps/web/src/pages/ProductDetailPage/index.tsx                            (PR 5 + PR 7)
apps/web/src/pages/ProductDetailPage/components/ProductInfo.tsx           (PR 5)
apps/web/src/App.tsx                                                      (route /settings/gfin-rates)

apps/api/src/modules/shop-catalog/shop-catalog.controller.ts              (PR 8 — public endpoint)
apps/api/src/modules/shop-catalog/shop-catalog.service.ts                 (PR 8 — extend response)
apps/web-shop/src/pages/ProductDetailPage.tsx                             (PR 8)
```

---

## Phase A — Schema (PR 1)

### Task 1: Update Prisma schema with new tables + fields

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Locate the Product model in schema.prisma**

Run: `grep -n "^model Product " apps/api/prisma/schema.prisma`
Expected output: `1456:model Product {`

- [ ] **Step 2: Add `cashPrice` and `installmentPrice` to Product**

Inside `model Product { ... }`, after the existing pricing-related fields (e.g. near `costPrice`), add:

```prisma
  cashPrice         Decimal? @db.Decimal(12, 2) @map("cash_price")
  installmentPrice  Decimal? @db.Decimal(12, 2) @map("installment_price")
```

- [ ] **Step 3: Add GfinCondition enum and three GFIN tables**

At the end of `schema.prisma` (after the last existing model), append:

```prisma
enum GfinCondition {
  HAND_1
  HAND_2

  @@map("gfin_condition")
}

model GfinModelMapping {
  id                String        @id @default(uuid())
  gfinSeries        String        @map("gfin_series")
  gfinVariant       String?       @map("gfin_variant")
  storage           String
  condition         GfinCondition
  maxPrice          Decimal       @db.Decimal(12, 2) @map("max_price")
  modelMatchPattern String        @map("model_match_pattern")
  isActive          Boolean       @default(true) @map("is_active")
  createdAt         DateTime      @default(now()) @map("created_at")
  updatedAt         DateTime      @updatedAt @map("updated_at")
  deletedAt         DateTime?     @map("deleted_at")

  @@unique([gfinSeries, gfinVariant, storage, condition])
  @@index([modelMatchPattern])
  @@map("gfin_model_mappings")
}

model GfinOverpriceRule {
  id            String        @id @default(uuid())
  label         String
  seriesPattern String        @map("series_pattern")
  condition     GfinCondition
  allowance     Decimal       @db.Decimal(12, 2)
  isActive      Boolean       @default(true) @map("is_active")
  createdAt     DateTime      @default(now()) @map("created_at")
  updatedAt     DateTime      @updatedAt @map("updated_at")
  deletedAt     DateTime?     @map("deleted_at")

  @@index([condition, isActive])
  @@map("gfin_overprice_rules")
}

model GfinRateFactor {
  id                String   @id @default(uuid())
  months            Int      @unique
  factor            Decimal  @db.Decimal(8, 6)
  feePerInstallment Decimal  @db.Decimal(12, 2) @default(100) @map("fee_per_installment")
  isActive          Boolean  @default(true) @map("is_active")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")
  deletedAt         DateTime? @map("deleted_at")

  @@map("gfin_rate_factors")
}
```

- [ ] **Step 4: Add InterestConfigRate table (BC rate refactor — additive, keep `interestRate` column for now)**

Find `model InterestConfig {` (around line 2561) and add a relation field:

```prisma
  rates             InterestConfigRate[]
```

Then append a new model below it:

```prisma
model InterestConfigRate {
  id        String          @id @default(uuid())
  configId  String          @map("config_id")
  config    InterestConfig  @relation(fields: [configId], references: [id], onDelete: Cascade)
  months    Int
  ratePct   Decimal         @db.Decimal(5, 4) @map("rate_pct")
  createdAt DateTime        @default(now()) @map("created_at")
  updatedAt DateTime        @updatedAt @map("updated_at")
  deletedAt DateTime?       @map("deleted_at")

  @@unique([configId, months])
  @@map("interest_config_rates")
}
```

- [ ] **Step 5: Generate migration**

Run from repo root:
```bash
cd apps/api && npx prisma migrate dev --name installment_calc_phase_a --create-only
```
Expected: new migration directory under `apps/api/prisma/migrations/<timestamp>_installment_calc_phase_a/` containing `migration.sql`.

- [ ] **Step 6: Inspect migration.sql, confirm no DROP statements**

Open the generated SQL. It should contain only `ALTER TABLE ... ADD COLUMN`, `CREATE TABLE`, `CREATE UNIQUE INDEX`, `CREATE INDEX`. **Reject** any `DROP COLUMN` / `DROP TABLE` — abort and inspect what went wrong.

- [ ] **Step 7: Apply migration locally + regenerate Prisma client**

Run: `cd apps/api && npx prisma migrate deploy && npx prisma generate`
Expected: "All migrations have been successfully applied." + Prisma Client regenerated.

- [ ] **Step 8: Run TypeScript check**

Run from repo root: `./tools/check-types.sh api`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(schema): add product price fields + GFIN tables + InterestConfigRate

Phase A of installment calculator preview feature. Additive nullable
fields only — no breaking changes. New tables: GfinModelMapping,
GfinOverpriceRule, GfinRateFactor, InterestConfigRate.

Spec: docs/superpowers/specs/2026-05-22-product-detail-installment-calculator-design.md"
```

---

## Phase B — Calc Utility (PR 2)

### Task 2: Create installment-calc types

**Files:**
- Create: `packages/shared/src/installment-calc.types.ts`

- [ ] **Step 1: Verify decimal.js is in the shared package**

Run: `grep '"decimal.js"' packages/shared/package.json`
If absent, add it:
```bash
cd packages/shared && npm install decimal.js
```

- [ ] **Step 2: Write the types file**

Create `packages/shared/src/installment-calc.types.ts`:

```typescript
import Decimal from 'decimal.js';

export interface BcConfig {
  minDownPct: Decimal;
  commissionPct: Decimal;
  vatPct: Decimal;
  /** Map of months → total-contract interest pct. e.g. { 12: 0.50 } */
  ratePctByMonths: Map<number, Decimal>;
  allowedMonths: number[];
}

export interface BcCalcInput {
  installmentPrice: Decimal;
  months: number;
  /** Override down payment as percentage. Mutually exclusive with customDownAmount. */
  downPct?: Decimal;
  /** Override down payment as amount. Mutually exclusive with downPct. */
  customDownAmount?: Decimal;
  config: BcConfig;
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
  isValid: boolean;
  errors: string[];
}

export type GfinCondition = 'HAND_1' | 'HAND_2';
export type ProductCategoryForGfin = 'PHONE_NEW' | 'PHONE_USED';

export interface GfinModelMappingRow {
  id: string;
  gfinSeries: string;
  gfinVariant: string | null;
  storage: string;
  condition: GfinCondition;
  maxPrice: Decimal;
  modelMatchPattern: string;
  isActive: boolean;
}

export interface GfinOverpriceRuleRow {
  id: string;
  label: string;
  seriesPattern: string;
  condition: GfinCondition;
  allowance: Decimal;
  isActive: boolean;
}

export interface GfinRateFactorRow {
  months: number;
  factor: Decimal;
  feePerInstallment: Decimal;
  isActive: boolean;
}

export interface ProductForGfin {
  brand: string;
  model: string;
  storage: string;
  category: ProductCategoryForGfin;
}

export interface GfinCalcInput {
  installmentPrice: Decimal;
  product: ProductForGfin;
  months: number;
  downPct?: Decimal;
  mapping: GfinModelMappingRow;
  overpriceRule: GfinOverpriceRuleRow | null;
  rateFactor: GfinRateFactorRow;
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
  feePerInstallment: Decimal;
  isValid: boolean;
  errors: string[];
}
```

- [ ] **Step 3: Type-check the file**

Run: `cd packages/shared && npx tsc --noEmit src/installment-calc.types.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/installment-calc.types.ts packages/shared/package.json packages/shared/package-lock.json
git commit -m "feat(shared): installment-calc types"
```

### Task 3: Implement BC calc with failing tests first

**Files:**
- Create: `packages/shared/src/installment-calc.bc.test.ts`
- Create: `packages/shared/src/installment-calc.ts`

- [ ] **Step 1: Write the canonical worked-example test (failing)**

Create `packages/shared/src/installment-calc.bc.test.ts`:

```typescript
import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import { calcBcInstallment } from './installment-calc';
import type { BcConfig } from './installment-calc.types';

const DEFAULT_CONFIG: BcConfig = {
  minDownPct: new Decimal('0.15'),
  commissionPct: new Decimal('0.10'),
  vatPct: new Decimal('0.07'),
  ratePctByMonths: new Map<number, Decimal>([
    [5, new Decimal('0.40')],
    [6, new Decimal('0.40')],
    [7, new Decimal('0.50')],
    [8, new Decimal('0.50')],
    [10, new Decimal('0.50')],
    [12, new Decimal('0.50')],
  ]),
  allowedMonths: [5, 6, 7, 8, 10, 12],
};

describe('calcBcInstallment — canonical worked example (iPhone 14 Pro 128GB, 19,900, 12 mo, 15% down)', () => {
  const out = calcBcInstallment({
    installmentPrice: new Decimal('19900'),
    months: 12,
    config: DEFAULT_CONFIG,
  });

  it('isValid true with no errors', () => {
    expect(out.isValid).toBe(true);
    expect(out.errors).toEqual([]);
  });

  it('downAmount = 2,985', () => {
    expect(out.downAmount.toFixed(2)).toBe('2985.00');
  });

  it('financedAmount = 16,915', () => {
    expect(out.financedAmount.toFixed(2)).toBe('16915.00');
  });

  it('interestAmount = 8,457.50', () => {
    expect(out.interestAmount.toFixed(2)).toBe('8457.50');
  });

  it('commissionAmount = 1,691.50', () => {
    expect(out.commissionAmount.toFixed(2)).toBe('1691.50');
  });

  it('subtotal = 27,064.00', () => {
    expect(out.subtotal.toFixed(2)).toBe('27064.00');
  });

  it('vatAmount = 1,894.48', () => {
    expect(out.vatAmount.toFixed(2)).toBe('1894.48');
  });

  it('totalWithVat = 28,958.48', () => {
    expect(out.totalWithVat.toFixed(2)).toBe('28958.48');
  });

  it('monthlyPayment = 2,413.21', () => {
    expect(out.monthlyPayment.toFixed(2)).toBe('2413.21');
  });

  it('financeToShop = 18,606.50', () => {
    expect(out.financeToShop.toFixed(2)).toBe('18606.50');
  });
});
```

- [ ] **Step 2: Run the test — verify it fails (function not defined)**

Run: `cd packages/shared && npx vitest run src/installment-calc.bc.test.ts`
Expected: FAIL with "Failed to resolve import './installment-calc'" or "calcBcInstallment is not a function".

- [ ] **Step 3: Implement `calcBcInstallment` in `installment-calc.ts`**

Create `packages/shared/src/installment-calc.ts`:

```typescript
import Decimal from 'decimal.js';
import type {
  BcCalcInput,
  BcCalcOutput,
  GfinCalcInput,
  GfinCalcOutput,
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  ProductForGfin,
} from './installment-calc.types';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2);
}

export function calcBcInstallment(input: BcCalcInput): BcCalcOutput {
  const { installmentPrice, months, downPct, customDownAmount, config } = input;
  const errors: string[] = [];

  // Resolve down
  const resolvedDownPct =
    customDownAmount !== undefined && installmentPrice.gt(0)
      ? customDownAmount.div(installmentPrice)
      : downPct ?? config.minDownPct;

  const downAmount =
    customDownAmount !== undefined
      ? round2(customDownAmount)
      : round2(installmentPrice.mul(resolvedDownPct));

  if (!config.allowedMonths.includes(months)) {
    errors.push(`จำนวนงวด ${months} ไม่อยู่ในตารางอัตราดอกเบี้ย`);
  }
  if (resolvedDownPct.lt(config.minDownPct)) {
    errors.push(`เงินดาวน์ต่ำกว่าขั้นต่ำ ${config.minDownPct.mul(100).toFixed(0)}%`);
  }
  if (downAmount.gte(installmentPrice)) {
    errors.push('เงินดาวน์ต้องน้อยกว่าราคาขาย');
  }

  const ratePct = config.ratePctByMonths.get(months) ?? new Decimal(0);
  const financedAmount = round2(installmentPrice.sub(downAmount));
  const interestAmount = round2(financedAmount.mul(ratePct));
  const commissionAmount = round2(financedAmount.mul(config.commissionPct));
  const subtotal = round2(financedAmount.add(interestAmount).add(commissionAmount));
  const vatAmount = round2(subtotal.mul(config.vatPct));
  const totalWithVat = round2(subtotal.add(vatAmount));
  const monthlyPayment = months > 0 ? round2(totalWithVat.div(months)) : new Decimal(0);
  const financeToShop = round2(financedAmount.add(commissionAmount));

  return {
    sellingPrice: installmentPrice,
    downPct: resolvedDownPct,
    downAmount,
    financedAmount,
    interestPct: ratePct,
    interestAmount,
    commissionPct: config.commissionPct,
    commissionAmount,
    subtotal,
    vatAmount,
    totalWithVat,
    monthlyPayment,
    financeToShop,
    isValid: errors.length === 0,
    errors,
  };
}

// GFIN implementation added in Task 5
export function calcGfinInstallment(_input: GfinCalcInput): GfinCalcOutput {
  throw new Error('Not yet implemented');
}

export function findGfinMapping(
  product: ProductForGfin,
  mappings: GfinModelMappingRow[],
): GfinModelMappingRow | null {
  const normStorage = product.storage.replace(/\s+/g, '').toUpperCase();
  const condition = product.category === 'PHONE_NEW' ? 'HAND_1' : 'HAND_2';

  for (const m of mappings) {
    if (!m.isActive) continue;
    if (m.condition !== condition) continue;
    if (m.storage.replace(/\s+/g, '').toUpperCase() !== normStorage) continue;
    const modelLower = product.model.toLowerCase();
    const patternLower = m.modelMatchPattern.toLowerCase();
    if (!modelLower.includes(patternLower)) continue;
    return m;
  }
  return null;
}

export function findGfinOverpriceRule(
  mapping: GfinModelMappingRow,
  rules: GfinOverpriceRuleRow[],
): GfinOverpriceRuleRow | null {
  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (rule.condition !== mapping.condition) continue;
    const seriesList = rule.seriesPattern.split('|').map(s => s.trim());
    if (!seriesList.includes(mapping.gfinSeries)) continue;
    return rule;
  }
  return null;
}
```

- [ ] **Step 4: Re-run the BC test — verify all assertions pass**

Run: `cd packages/shared && npx vitest run src/installment-calc.bc.test.ts`
Expected: 10 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/installment-calc.ts packages/shared/src/installment-calc.bc.test.ts
git commit -m "feat(shared): calcBcInstallment with canonical worked-example test"
```

### Task 4: Expand BC tests — edge cases

**Files:**
- Modify: `packages/shared/src/installment-calc.bc.test.ts`

- [ ] **Step 1: Add edge-case tests (failing first if behavior not implemented)**

Append to `installment-calc.bc.test.ts`:

```typescript
describe('calcBcInstallment — edge cases', () => {
  it('returns error when months not in allowed list', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 9,                                  // not in 5,6,7,8,10,12
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(false);
    expect(out.errors.some(e => e.includes('9'))).toBe(true);
  });

  it('returns error when down < minDown', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 12,
      downPct: new Decimal('0.10'),
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(false);
    expect(out.errors.some(e => e.includes('ต่ำกว่าขั้นต่ำ'))).toBe(true);
  });

  it('returns error when down >= price', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 12,
      customDownAmount: new Decimal('20000'),
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(false);
    expect(out.errors.some(e => e.includes('ต้องน้อยกว่าราคาขาย'))).toBe(true);
  });

  it('accepts custom down higher than min (50% down at 12 mo)', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 12,
      downPct: new Decimal('0.50'),
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(true);
    expect(out.downAmount.toFixed(2)).toBe('9950.00');
    expect(out.financedAmount.toFixed(2)).toBe('9950.00');
  });

  it('handles 5-mo with 40% rate', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 5,
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(true);
    expect(out.interestPct.toFixed(2)).toBe('0.40');
    // financed = 16915, interest = 16915 × 0.40 = 6766, commission = 1691.50
    expect(out.interestAmount.toFixed(2)).toBe('6766.00');
  });

  it('handles 7-mo with 50% rate (transition boundary)', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 7,
      config: DEFAULT_CONFIG,
    });
    expect(out.isValid).toBe(true);
    expect(out.interestPct.toFixed(2)).toBe('0.50');
  });

  it('customDownAmount overrides downPct correctly', () => {
    const out = calcBcInstallment({
      installmentPrice: new Decimal('19900'),
      months: 12,
      customDownAmount: new Decimal('5000'),
      config: DEFAULT_CONFIG,
    });
    expect(out.downAmount.toFixed(2)).toBe('5000.00');
    expect(out.financedAmount.toFixed(2)).toBe('14900.00');
  });
});
```

- [ ] **Step 2: Run all BC tests**

Run: `cd packages/shared && npx vitest run src/installment-calc.bc.test.ts`
Expected: 17 tests passed.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/installment-calc.bc.test.ts
git commit -m "test(shared): BC calc edge cases — invalid months, down bounds, custom down"
```

### Task 5: Implement GFIN calc with canonical test

**Files:**
- Modify: `packages/shared/src/installment-calc.ts`
- Create: `packages/shared/src/installment-calc.gfin.test.ts`

- [ ] **Step 1: Write the canonical GFIN test (failing)**

Create `packages/shared/src/installment-calc.gfin.test.ts`:

```typescript
import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import { calcGfinInstallment, findGfinMapping, findGfinOverpriceRule } from './installment-calc';
import type {
  GfinModelMappingRow,
  GfinOverpriceRuleRow,
  GfinRateFactorRow,
  ProductForGfin,
} from './installment-calc.types';

const mapping14Pro128: GfinModelMappingRow = {
  id: 'm1',
  gfinSeries: 'iPhone 14',
  gfinVariant: 'Pro',
  storage: '128GB',
  condition: 'HAND_2',
  maxPrice: new Decimal('21500'),
  modelMatchPattern: 'iPhone 14 Pro',
  isActive: true,
};

const overpriceIphone14Hand2: GfinOverpriceRuleRow = {
  id: 'r1',
  label: 'iPhone 14 มือ 2',
  seriesPattern: 'iPhone 14|iPhone 15',
  condition: 'HAND_2',
  allowance: new Decimal('1000'),
  isActive: true,
};

const factor12: GfinRateFactorRow = {
  months: 12,
  factor: new Decimal('0.179238'),
  feePerInstallment: new Decimal('100'),
  isActive: true,
};

const productIphone14Pro128Used: ProductForGfin = {
  brand: 'Apple',
  model: 'iPhone 14 Pro',
  storage: '128GB',
  category: 'PHONE_USED',
};

describe('calcGfinInstallment — canonical worked example', () => {
  const out = calcGfinInstallment({
    installmentPrice: new Decimal('19900'),
    product: productIphone14Pro128Used,
    months: 12,
    mapping: mapping14Pro128,
    overpriceRule: overpriceIphone14Hand2,
    rateFactor: factor12,
  });

  it('gfinSubmitPrice = 22,500', () => {
    expect(out.gfinSubmitPrice.toFixed(2)).toBe('22500.00');
  });

  it('downDiscount = 2,600', () => {
    expect(out.downDiscount.toFixed(2)).toBe('2600.00');
  });

  it('downAmountByFormula = 6,750', () => {
    expect(out.downAmountByFormula.toFixed(2)).toBe('6750.00');
  });

  it('downAmountActual = 4,150', () => {
    expect(out.downAmountActual.toFixed(2)).toBe('4150.00');
  });

  it('financedAmount = 15,750', () => {
    expect(out.financedAmount.toFixed(2)).toBe('15750.00');
  });

  it('monthlyPayment = 2,923.00', () => {
    expect(out.monthlyPayment.toFixed(2)).toBe('2923.00');
  });

  it('totalPayback = 35,076.00', () => {
    expect(out.totalPayback.toFixed(2)).toBe('35076.00');
  });
});

describe('findGfinMapping', () => {
  const allMappings: GfinModelMappingRow[] = [
    mapping14Pro128,
    { ...mapping14Pro128, id: 'm2', modelMatchPattern: 'iPhone 14 Pro Max', maxPrice: new Decimal('23500') },
    { ...mapping14Pro128, id: 'm3', storage: '256GB', maxPrice: new Decimal('22500') },
  ];

  it('matches iPhone 14 Pro vs iPhone 14 Pro Max correctly', () => {
    const proMax: ProductForGfin = { ...productIphone14Pro128Used, model: 'iPhone 14 Pro Max' };
    const matched = findGfinMapping(proMax, allMappings);
    expect(matched?.id).toBe('m2');
  });

  it('matches storage exactly', () => {
    const used256: ProductForGfin = { ...productIphone14Pro128Used, storage: '256GB' };
    const matched = findGfinMapping(used256, allMappings);
    expect(matched?.id).toBe('m3');
  });

  it('normalizes storage whitespace', () => {
    const padded: ProductForGfin = { ...productIphone14Pro128Used, storage: '128 GB' };
    const matched = findGfinMapping(padded, allMappings);
    expect(matched?.id).toBe('m1');
  });

  it('returns null when no row matches', () => {
    const samsung: ProductForGfin = { brand: 'Samsung', model: 'Galaxy S24', storage: '256GB', category: 'PHONE_USED' };
    expect(findGfinMapping(samsung, allMappings)).toBeNull();
  });

  it('returns null for inactive mapping', () => {
    const inactive = [{ ...mapping14Pro128, isActive: false }];
    expect(findGfinMapping(productIphone14Pro128Used, inactive)).toBeNull();
  });
});

describe('findGfinOverpriceRule', () => {
  const rules: GfinOverpriceRuleRow[] = [
    overpriceIphone14Hand2,
    { ...overpriceIphone14Hand2, id: 'r2', seriesPattern: 'iPhone 15|iPhone 16|iPhone 17', condition: 'HAND_1', allowance: new Decimal('2000') },
  ];

  it('matches series + condition correctly', () => {
    const rule = findGfinOverpriceRule(mapping14Pro128, rules);
    expect(rule?.id).toBe('r1');
  });

  it('returns null when no rule matches series', () => {
    const samsungMapping: GfinModelMappingRow = { ...mapping14Pro128, gfinSeries: 'iPhone 12' };
    expect(findGfinOverpriceRule(samsungMapping, rules)).toBeNull();
  });
});

describe('calcGfinInstallment — no overprice rule', () => {
  const out = calcGfinInstallment({
    installmentPrice: new Decimal('20500'),       // same as max — no discount
    product: productIphone14Pro128Used,
    months: 12,
    mapping: mapping14Pro128,
    overpriceRule: null,                          // not eligible for overprice
    rateFactor: factor12,
  });

  it('gfinSubmitPrice = maxPrice (no overprice added)', () => {
    expect(out.gfinSubmitPrice.toFixed(2)).toBe('21500.00');
  });

  it('downDiscount = 21500 - 20500 = 1,000', () => {
    expect(out.downDiscount.toFixed(2)).toBe('1000.00');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd packages/shared && npx vitest run src/installment-calc.gfin.test.ts`
Expected: FAIL with "Not yet implemented".

- [ ] **Step 3: Implement `calcGfinInstallment`**

In `packages/shared/src/installment-calc.ts`, replace the placeholder `calcGfinInstallment` with:

```typescript
export function calcGfinInstallment(input: GfinCalcInput): GfinCalcOutput {
  const { installmentPrice, months, downPct, mapping, overpriceRule, rateFactor } = input;
  const errors: string[] = [];

  const allowance = overpriceRule?.allowance ?? new Decimal(0);
  const gfinSubmitPrice = round2(mapping.maxPrice.add(allowance));
  const downDiscount = round2(Decimal.max(gfinSubmitPrice.sub(installmentPrice), 0));

  const resolvedDownPct = downPct ?? new Decimal('0.30');
  const downAmountByFormula = round2(gfinSubmitPrice.mul(resolvedDownPct));
  const downAmountActual = round2(Decimal.max(downAmountByFormula.sub(downDiscount), 0));
  const financedAmount = round2(gfinSubmitPrice.sub(downAmountByFormula));

  if (rateFactor.months !== months) {
    errors.push(`ตารางอัตราสำหรับ ${months} งวด ไม่ตรงกับ rate factor ที่ส่งเข้ามา`);
  }
  if (!rateFactor.isActive) {
    errors.push('อัตราดอกเบี้ย GFIN ปิดใช้งาน');
  }

  const interestPart = round2(rateFactor.factor.mul(financedAmount));
  const monthlyPayment = round2(interestPart.add(rateFactor.feePerInstallment));
  const totalPayback = months > 0 ? round2(monthlyPayment.mul(months)) : new Decimal(0);

  return {
    gfinSubmitPrice,
    downDiscount,
    downPct: resolvedDownPct,
    downAmountByFormula,
    downAmountActual,
    financedAmount,
    monthlyPayment,
    totalPayback,
    feePerInstallment: rateFactor.feePerInstallment,
    isValid: errors.length === 0,
    errors,
  };
}
```

- [ ] **Step 4: Re-run GFIN tests**

Run: `cd packages/shared && npx vitest run src/installment-calc.gfin.test.ts`
Expected: all tests passing.

- [ ] **Step 5: Run full shared test suite**

Run: `cd packages/shared && npx vitest run`
Expected: all calc tests passing.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/installment-calc.ts packages/shared/src/installment-calc.gfin.test.ts
git commit -m "feat(shared): calcGfinInstallment + mapping/overprice lookup helpers"
```

### Task 6: Export from packages/shared barrel

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add exports**

Open `packages/shared/src/index.ts` and append:

```typescript
export {
  calcBcInstallment,
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
} from './installment-calc';
export type * from './installment-calc.types';
```

- [ ] **Step 2: Build shared package**

Run: `cd packages/shared && npm run build`
Expected: 0 errors. `dist/` updated.

- [ ] **Step 3: Verify import path from API + web**

Run: `grep -rn "@bestchoice/shared\|packages/shared" apps/api/tsconfig.json apps/web/tsconfig.json apps/web-shop/tsconfig.json`
Confirm path aliases resolve to `packages/shared/src` or built `dist/`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "chore(shared): export installment-calc utilities"
```

---

## Phase C — Backfill + Seed (PR 3)

### Task 7: Backfill Product cashPrice/installmentPrice from existing ProductPrice labels

**Files:**
- Create: `apps/api/scripts/backfill-product-prices.ts`

- [ ] **Step 1: Write the backfill script**

Create `apps/api/scripts/backfill-product-prices.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const startedAt = Date.now();

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: { prices: { where: { deletedAt: null } } },
  });

  let updated = 0;
  let bothNull = 0;

  for (const p of products) {
    const prices = p.prices;
    const installmentPrice =
      prices.find(x => x.label === 'ราคาผ่อน BESTCHOICE')?.amount ??
      prices.find(x => x.label.startsWith('ราคาผ่อน'))?.amount ??
      null;

    const cashPrice =
      prices.find(x => x.label === 'ราคาเงินสด')?.amount ??
      prices.find(x => x.label.startsWith('ราคาเงินสด'))?.amount ??
      null;

    if (installmentPrice === null && cashPrice === null) {
      bothNull++;
      continue;
    }

    await prisma.product.update({
      where: { id: p.id },
      data: { installmentPrice, cashPrice },
    });
    updated++;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    JSON.stringify({
      scanned: products.length,
      updated,
      bothNull,
      elapsedMs,
    }, null, 2),
  );
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry run against local dev DB**

Run: `cd apps/api && npx ts-node scripts/backfill-product-prices.ts`
Expected: JSON summary printed (e.g. `{"scanned": N, "updated": M, "bothNull": K, ...}`). Sanity-check the numbers against your local product count.

- [ ] **Step 3: Add idempotency check — run again to verify no-op**

Run the script again. Expected: same `updated` count (since installmentPrice/cashPrice now non-null, the update is idempotent — Prisma allows setting to same value). No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/backfill-product-prices.ts
git commit -m "feat(scripts): backfill Product cashPrice/installmentPrice from labels"
```

### Task 8: Seed InterestConfigRate from existing InterestConfig

**Files:**
- Create: `apps/api/scripts/seed-interest-config-rates.ts`

- [ ] **Step 1: Write the seed script**

Create `apps/api/scripts/seed-interest-config-rates.ts`:

```typescript
import { PrismaClient, Prisma } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  const configs = await prisma.interestConfig.findMany({
    where: { deletedAt: null },
    include: { rates: true },
  });

  let inserted = 0;
  let skipped = 0;

  for (const cfg of configs) {
    for (let m = cfg.minInstallmentMonths; m <= cfg.maxInstallmentMonths; m++) {
      const exists = cfg.rates.some(r => r.months === m && !r.deletedAt);
      if (exists) {
        skipped++;
        continue;
      }
      const ratePct = new Prisma.Decimal(cfg.interestRate).mul(m).toDecimalPlaces(4);
      await prisma.interestConfigRate.create({
        data: { configId: cfg.id, months: m, ratePct },
      });
      inserted++;
    }
  }

  console.log(JSON.stringify({ configs: configs.length, inserted, skipped }, null, 2));
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run script + verify rates exist**

Run: `cd apps/api && npx ts-node scripts/seed-interest-config-rates.ts`
Expected: JSON summary with non-zero `inserted` (assuming dev DB has at least one `InterestConfig`).

- [ ] **Step 3: Spot-check via Prisma Studio or query**

Run:
```bash
cd apps/api && npx prisma studio
```
Open `InterestConfigRate` table — verify rows exist per (configId, months) where `ratePct = old interestRate × months`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/seed-interest-config-rates.ts
git commit -m "feat(scripts): seed InterestConfigRate from existing InterestConfig.interestRate × months"
```

### Task 9: Seed GFIN tables from initial fixture

**Files:**
- Create: `apps/api/prisma/fixtures/gfin-2026-05-22.json`
- Create: `apps/api/scripts/seed-gfin-tables.ts`

- [ ] **Step 1: Create the fixture file**

Create `apps/api/prisma/fixtures/gfin-2026-05-22.json` with the snapshot from the spec (truncated example — fill ALL ~70 mappings from the GFIN price image dated 5/3/2569):

```json
{
  "snapshotDate": "2026-05-22",
  "maxPrices": [
    { "gfinSeries": "iPhone 12", "gfinVariant": null, "storage": "64GB", "condition": "HAND_2", "maxPrice": 8000, "modelMatchPattern": "iPhone 12" },
    { "gfinSeries": "iPhone 12", "gfinVariant": null, "storage": "128GB", "condition": "HAND_2", "maxPrice": 9000, "modelMatchPattern": "iPhone 12" },
    { "gfinSeries": "iPhone 14", "gfinVariant": "Pro", "storage": "128GB", "condition": "HAND_2", "maxPrice": 21500, "modelMatchPattern": "iPhone 14 Pro" },
    { "gfinSeries": "iPhone 15", "gfinVariant": "Pro Max", "storage": "256GB", "condition": "HAND_1", "maxPrice": 34900, "modelMatchPattern": "iPhone 15 Pro Max" }
  ],
  "overpriceRules": [
    { "label": "iPhone Series 15-17 มือ 1", "seriesPattern": "iPhone 15|iPhone 16|iPhone 17", "condition": "HAND_1", "allowance": 2000 },
    { "label": "iPhone 14, 15 มือ 2", "seriesPattern": "iPhone 14|iPhone 15", "condition": "HAND_2", "allowance": 1000 },
    { "label": "iPhone 16, 17 มือ 2", "seriesPattern": "iPhone 16|iPhone 17", "condition": "HAND_2", "allowance": 2000 }
  ],
  "rateFactors": [
    { "months": 3, "factor": 0.508700, "feePerInstallment": 100 },
    { "months": 4, "factor": 0.397428, "feePerInstallment": 100 },
    { "months": 5, "factor": 0.331174, "feePerInstallment": 100 },
    { "months": 6, "factor": 0.288476, "feePerInstallment": 100 },
    { "months": 7, "factor": 0.257214, "feePerInstallment": 100 },
    { "months": 8, "factor": 0.233809, "feePerInstallment": 100 },
    { "months": 9, "factor": 0.215555, "feePerInstallment": 100 },
    { "months": 10, "factor": 0.200952, "feePerInstallment": 100 },
    { "months": 11, "factor": 0.189064, "feePerInstallment": 100 },
    { "months": 12, "factor": 0.179238, "feePerInstallment": 100 }
  ]
}
```

**Important:** before running the seed in production, **owner must verify all 70 max-price rows and the actual factor values** (the factors above are calibrated from the iPhone 14 Pro example only; owner provides authoritative numbers).

- [ ] **Step 2: Write the seed script**

Create `apps/api/scripts/seed-gfin-tables.ts`:

```typescript
import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

interface Fixture {
  snapshotDate: string;
  maxPrices: Array<{
    gfinSeries: string;
    gfinVariant: string | null;
    storage: string;
    condition: 'HAND_1' | 'HAND_2';
    maxPrice: number;
    modelMatchPattern: string;
  }>;
  overpriceRules: Array<{
    label: string;
    seriesPattern: string;
    condition: 'HAND_1' | 'HAND_2';
    allowance: number;
  }>;
  rateFactors: Array<{ months: number; factor: number; feePerInstallment: number }>;
}

async function main() {
  const prisma = new PrismaClient();
  const fixturePath = path.join(__dirname, '..', 'prisma', 'fixtures', 'gfin-2026-05-22.json');
  const data = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as Fixture;

  for (const mp of data.maxPrices) {
    await prisma.gfinModelMapping.upsert({
      where: {
        gfinSeries_gfinVariant_storage_condition: {
          gfinSeries: mp.gfinSeries,
          gfinVariant: mp.gfinVariant,
          storage: mp.storage,
          condition: mp.condition,
        },
      },
      create: { ...mp, maxPrice: new Prisma.Decimal(mp.maxPrice) },
      update: { maxPrice: new Prisma.Decimal(mp.maxPrice), modelMatchPattern: mp.modelMatchPattern },
    });
  }

  for (const rule of data.overpriceRules) {
    const existing = await prisma.gfinOverpriceRule.findFirst({
      where: { label: rule.label, deletedAt: null },
    });
    if (existing) {
      await prisma.gfinOverpriceRule.update({
        where: { id: existing.id },
        data: { allowance: new Prisma.Decimal(rule.allowance), seriesPattern: rule.seriesPattern, condition: rule.condition },
      });
    } else {
      await prisma.gfinOverpriceRule.create({
        data: { ...rule, allowance: new Prisma.Decimal(rule.allowance) },
      });
    }
  }

  for (const rf of data.rateFactors) {
    await prisma.gfinRateFactor.upsert({
      where: { months: rf.months },
      create: {
        months: rf.months,
        factor: new Prisma.Decimal(rf.factor),
        feePerInstallment: new Prisma.Decimal(rf.feePerInstallment),
      },
      update: {
        factor: new Prisma.Decimal(rf.factor),
        feePerInstallment: new Prisma.Decimal(rf.feePerInstallment),
      },
    });
  }

  console.log(JSON.stringify({
    snapshotDate: data.snapshotDate,
    maxPrices: data.maxPrices.length,
    overpriceRules: data.overpriceRules.length,
    rateFactors: data.rateFactors.length,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Run seed against local dev DB**

Run: `cd apps/api && npx ts-node scripts/seed-gfin-tables.ts`
Expected: summary JSON with counts matching the fixture file.

- [ ] **Step 4: Re-run seed (idempotency check)**

Run again. Expected: same output, no duplicate rows in DB. Verify via:
```bash
psql -d bestchoice -c "SELECT COUNT(*) FROM gfin_model_mappings;"
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/seed-gfin-tables.ts apps/api/prisma/fixtures/gfin-2026-05-22.json
git commit -m "feat(scripts): seed GFIN tables from 2026-05-22 fixture snapshot"
```

---

## Phase D — Refactor InterestConfig consumers behind feature flag (PR 4)

### Task 10: Add `getRateForMonths` helper + feature flag

**Files:**
- Create: `apps/api/src/utils/get-rate-for-months.util.ts`
- Create: `apps/api/src/utils/get-rate-for-months.util.spec.ts`
- Modify: `apps/api/src/utils/config.util.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/utils/get-rate-for-months.util.spec.ts`:

```typescript
import { Prisma, PrismaClient } from '@prisma/client';
import { getRateForMonths } from './get-rate-for-months.util';

const mockPrisma = {
  interestConfigRate: {
    findUnique: jest.fn(),
  },
  interestConfig: {
    findUnique: jest.fn(),
  },
} as unknown as PrismaClient;

describe('getRateForMonths', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns ratePct from InterestConfigRate when feature flag ON and row exists', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'true';
    (mockPrisma.interestConfigRate.findUnique as jest.Mock).mockResolvedValue({
      ratePct: new Prisma.Decimal('0.50'),
    });
    const rate = await getRateForMonths(mockPrisma, 'config-1', 12);
    expect(rate.toString()).toBe('0.5');
  });

  it('falls back to interestRate × months when feature flag OFF', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'false';
    (mockPrisma.interestConfig.findUnique as jest.Mock).mockResolvedValue({
      interestRate: new Prisma.Decimal('0.04166667'),
    });
    const rate = await getRateForMonths(mockPrisma, 'config-1', 12);
    expect(rate.toFixed(4)).toBe('0.5000');
  });

  it('throws when row missing and flag ON', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'true';
    (mockPrisma.interestConfigRate.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(getRateForMonths(mockPrisma, 'config-1', 9)).rejects.toThrow(/ไม่พบอัตรา/);
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `cd apps/api && npx jest get-rate-for-months.util.spec.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/utils/get-rate-for-months.util.ts`:

```typescript
import { NotFoundException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

export async function getRateForMonths(
  prisma: PrismaClient,
  configId: string,
  months: number,
): Promise<Prisma.Decimal> {
  const useNewLookup = process.env.USE_NEW_RATE_LOOKUP === 'true';

  if (useNewLookup) {
    const row = await prisma.interestConfigRate.findUnique({
      where: { configId_months: { configId, months } },
    });
    if (!row || row.deletedAt) {
      throw new NotFoundException(
        `ไม่พบอัตราดอกเบี้ยสำหรับ ${months} งวด (configId=${configId})`,
      );
    }
    return new Prisma.Decimal(row.ratePct);
  }

  // Legacy path: rate × months
  const config = await prisma.interestConfig.findUnique({ where: { id: configId } });
  if (!config || config.deletedAt) {
    throw new NotFoundException(`ไม่พบ InterestConfig (configId=${configId})`);
  }
  return new Prisma.Decimal(config.interestRate).mul(months);
}
```

- [ ] **Step 4: Run test — verify passing**

Run: `cd apps/api && npx jest get-rate-for-months.util.spec.ts`
Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/get-rate-for-months.util.ts apps/api/src/utils/get-rate-for-months.util.spec.ts
git commit -m "feat(api): getRateForMonths helper with USE_NEW_RATE_LOOKUP feature flag

Returns total-contract rate per (configId, months). When flag off,
falls back to legacy interestRate × months to preserve current math
during gradual rollout."
```

### Task 11: Refactor `installment.util.ts` to accept resolved rate

**Files:**
- Modify: `apps/api/src/utils/installment.util.ts`

- [ ] **Step 1: Add a new function that accepts pre-resolved interest amount**

In `apps/api/src/utils/installment.util.ts`, **add** (do not replace) a new export below the existing `calculateInstallment`:

```typescript
/**
 * Same math as calculateInstallment, but interest is passed as TOTAL amount
 * already resolved by caller (via getRateForMonths). Used during refactor
 * to bridge legacy callers and new rate-lookup pattern.
 */
export function calculateInstallmentWithInterest(
  sellingPrice: number,
  downPayment: number,
  interestTotal: number,
  totalMonths: number,
  storeCommissionPct: number = 0,
  vatPct: number = 0,
): InstallmentCalculation {
  if (sellingPrice <= 0) throw new BadRequestException('ราคาขายต้องมากกว่า 0');
  if (downPayment < 0) throw new BadRequestException('เงินดาวน์ต้องไม่ติดลบ');
  if (downPayment >= sellingPrice) throw new BadRequestException('เงินดาวน์ต้องน้อยกว่าราคาขาย');
  if (totalMonths <= 0) throw new BadRequestException('จำนวนงวดต้องมากกว่า 0');
  if (interestTotal < 0) throw new BadRequestException('ยอดดอกเบี้ยต้องไม่ติดลบ');

  const principal = roundBaht(sellingPrice - downPayment);
  const storeCommission = roundBaht(principal * storeCommissionPct);
  const interestRounded = roundBaht(interestTotal);
  const vatAmount = roundBaht((principal + storeCommission + interestRounded) * vatPct);
  const financedAmount = roundBaht(principal + storeCommission + interestRounded + vatAmount);
  const monthlyPayment = roundBaht(financedAmount / totalMonths);

  return {
    principal,
    interestTotal: interestRounded,
    storeCommission,
    vatAmount,
    financedAmount,
    monthlyPayment,
  };
}
```

- [ ] **Step 2: Verify type-check**

Run: `./tools/check-types.sh api`
Expected: 0 errors.

- [ ] **Step 3: Add a unit test ensuring the two functions produce identical output when interest is precomputed as rate × months**

Append to `apps/api/src/utils/installment.util.spec.ts` (create file if missing — copy patterns from any existing util test):

```typescript
import { calculateInstallment, calculateInstallmentWithInterest } from './installment.util';

describe('calculateInstallment ↔ calculateInstallmentWithInterest equivalence', () => {
  it('produces identical output for the same (rate × months) interest', () => {
    const sellingPrice = 19900;
    const downPayment = 2985;
    const rate = 0.04166667;          // 4.17% per month
    const months = 12;
    const commissionPct = 0.10;
    const vatPct = 0.07;

    const legacy = calculateInstallment(sellingPrice, downPayment, rate, months, commissionPct, vatPct);
    const refactor = calculateInstallmentWithInterest(
      sellingPrice,
      downPayment,
      rate * (sellingPrice - downPayment) * months,
      months,
      commissionPct,
      vatPct,
    );

    expect(refactor.principal).toBe(legacy.principal);
    expect(refactor.interestTotal).toBeCloseTo(legacy.interestTotal, 2);
    expect(refactor.storeCommission).toBe(legacy.storeCommission);
    expect(refactor.vatAmount).toBeCloseTo(legacy.vatAmount, 2);
    expect(refactor.financedAmount).toBeCloseTo(legacy.financedAmount, 2);
    expect(refactor.monthlyPayment).toBeCloseTo(legacy.monthlyPayment, 2);
  });
});
```

- [ ] **Step 4: Run test**

Run: `cd apps/api && npx jest installment.util.spec.ts`
Expected: passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/installment.util.ts apps/api/src/utils/installment.util.spec.ts
git commit -m "feat(api): add calculateInstallmentWithInterest bridge for new rate lookup"
```

### Task 12: Refactor contracts.service.ts to use new rate lookup

**Files:**
- Modify: `apps/api/src/modules/contracts/contracts.service.ts:298, 324, 387, 521, 545-546`

- [ ] **Step 1: Locate each `interestRate × months` usage**

Run: `grep -n "interestRate" apps/api/src/modules/contracts/contracts.service.ts`

- [ ] **Step 2: For each callsite, replace direct `interestRate × months` with `getRateForMonths(prisma, configId, months)` + `calculateInstallmentWithInterest`**

Pattern (apply at each of the 5 listed lines, adapting variable names to local context):

**Before:**
```typescript
const interestRate = Number(interestConfig.interestRate);
const calc = calculateInstallment(
  sellingPrice,
  downPayment,
  interestRate,
  totalMonths,
  storeCommPct,
  vatPct,
);
```

**After:**
```typescript
const ratePct = Number(await getRateForMonths(this.prisma, interestConfig.id, totalMonths));
const principal = roundBaht(sellingPrice - downPayment);
const interestTotal = roundBaht(principal * ratePct);    // total-contract rate × principal
const calc = calculateInstallmentWithInterest(
  sellingPrice,
  downPayment,
  interestTotal,
  totalMonths,
  storeCommPct,
  vatPct,
);
```

Import the helper:
```typescript
import { getRateForMonths } from '@/utils/get-rate-for-months.util';
import { calculateInstallmentWithInterest, roundBaht } from '@/utils/installment.util';
```

- [ ] **Step 3: Type-check**

Run: `./tools/check-types.sh api`
Expected: 0 errors. If errors, fix import paths or variable names.

- [ ] **Step 4: Run contracts module tests**

Run: `cd apps/api && npx jest src/modules/contracts/`
Expected: all existing tests still pass. The feature flag is OFF by default in tests → falls back to legacy math → byte-identical output.

- [ ] **Step 5: Add an explicit regression test pinning current behavior**

In `apps/api/src/modules/contracts/__tests__/contracts.service.spec.ts` (or nearest existing spec), add:

```typescript
describe('Contract rate lookup — feature flag OFF (legacy math preserved)', () => {
  beforeAll(() => { process.env.USE_NEW_RATE_LOOKUP = 'false'; });
  afterAll(() => { delete process.env.USE_NEW_RATE_LOOKUP; });

  it('produces same monthlyPayment as pre-refactor for 12-mo flat-rate contract', async () => {
    // Use a fixture from existing tests — adapt to local style.
    // The point: this test must pass identically before and after Task 12.
    const result = await service.createContract({ /* fixture */ });
    expect(result.monthlyPayment).toBe(/* expected value pinned from current code */);
  });
});
```

(Engineer: read 2-3 existing contracts.service.spec test cases and adapt one to nail down the math.)

- [ ] **Step 6: Run regression test**

Run: `cd apps/api && npx jest contracts.service.spec`
Expected: passing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/contracts/contracts.service.ts apps/api/src/modules/contracts/__tests__/
git commit -m "refactor(contracts): use getRateForMonths + calculateInstallmentWithInterest

Behind USE_NEW_RATE_LOOKUP flag. With flag off (default), output is
byte-identical to pre-refactor. Regression test pins current math."
```

### Task 13: Refactor remaining 8 InterestConfig consumers

**Files:** (apply same pattern as Task 12 to each)
- Modify: `apps/api/src/modules/sales/sales.service.ts:486, 499, 523`
- Modify: `apps/api/src/utils/config.util.ts:221, 238, 246`
- Modify: `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts:77`
- Modify: `apps/api/src/modules/migration/migration.service.ts:162`
- Modify: `apps/api/src/modules/reports/reports.service.ts:514`
- Modify: `apps/api/src/modules/defect-exchange/defect-exchange.service.ts:250`
- Modify: `apps/api/src/modules/staff-chat/services/product-detect.service.ts:131`
- Modify: `apps/api/src/modules/contracts/documents.service.ts:1001`

**For each file:**

- [ ] **Step 1: Locate the `interestRate` access**

Run: `grep -n "interestRate" <file>`

- [ ] **Step 2: Replace with the rate-lookup pattern**

For services that compute `principal × interestRate × months` for math: use the Task 12 pattern.

For display-only usage (PDF / sales-bot / report formatting where it just renders the percentage), replace:
```typescript
(Number(contract.interestRate) * 100).toFixed(1)
```
with:
```typescript
// Display the resolved per-contract rate for the given months
const ratePct = Number(await getRateForMonths(this.prisma, configId, months));
(ratePct * 100).toFixed(1)
```

- [ ] **Step 3: Type-check after each file**

Run: `./tools/check-types.sh api`
Expected: 0 errors.

- [ ] **Step 4: Run module tests after each refactor**

Run: `cd apps/api && npx jest src/modules/<module-name>/`
Expected: existing tests pass (flag OFF preserves legacy math).

- [ ] **Step 5: Commit each refactor separately for easy revert**

```bash
git add apps/api/src/modules/<module>/
git commit -m "refactor(<module>): use getRateForMonths behind USE_NEW_RATE_LOOKUP"
```

### Task 14: Run full API test suite + lint

- [ ] **Step 1: Full test pass**

Run: `cd apps/api && npm test`
Expected: 577 tests (current baseline) + 3 new helper tests + 1 regression test = 581+ passing.

- [ ] **Step 2: Lint**

Run: `cd apps/api && npm run lint`
Expected: 0 errors. Fix any introduced lint warnings inline.

- [ ] **Step 3: Type check (all)**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 4: Commit any final lint/format fixes**

```bash
git add -A apps/api/
git commit -m "chore(api): lint cleanup after rate-lookup refactor"
```

---

## Phase E — Refactor ProductPrice consumers (PR 5)

### Task 15: Add `getDisplayPrices` helper (web)

**Files:**
- Create: `apps/web/src/utils/getDisplayPrices.ts`
- Create: `apps/web/src/utils/getDisplayPrices.test.ts`

- [ ] **Step 1: Write the test**

Create `apps/web/src/utils/getDisplayPrices.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getDisplayPrices } from './getDisplayPrices';

describe('getDisplayPrices', () => {
  it('prefers product.cashPrice/installmentPrice when set', () => {
    const out = getDisplayPrices({
      cashPrice: '20900',
      installmentPrice: '19900',
      prices: [],
    });
    expect(out.cash).toBe(20900);
    expect(out.installment).toBe(19900);
  });

  it('falls back to ProductPrice array by label when fields null', () => {
    const out = getDisplayPrices({
      cashPrice: null,
      installmentPrice: null,
      prices: [
        { label: 'ราคาเงินสด', amount: '20900', isDefault: false },
        { label: 'ราคาผ่อน BESTCHOICE', amount: '19900', isDefault: true },
      ],
    });
    expect(out.cash).toBe(20900);
    expect(out.installment).toBe(19900);
  });

  it('returns null cash/installment when neither field nor matching label present', () => {
    const out = getDisplayPrices({
      cashPrice: null,
      installmentPrice: null,
      prices: [{ label: 'DEFAULT', amount: '17000', isDefault: true }],
    });
    expect(out.cash).toBeNull();
    expect(out.installment).toBeNull();
  });

  it('falls back to prefix match on label', () => {
    const out = getDisplayPrices({
      cashPrice: null,
      installmentPrice: null,
      prices: [{ label: 'ราคาผ่อน BC ลด 200', amount: '19700', isDefault: false }],
    });
    expect(out.installment).toBe(19700);
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `cd apps/web && npx vitest run src/utils/getDisplayPrices.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/web/src/utils/getDisplayPrices.ts`:

```typescript
export interface ProductPriceRow {
  label: string;
  amount: string | number;
  isDefault: boolean;
}

export interface ProductForDisplay {
  cashPrice: string | number | null;
  installmentPrice: string | number | null;
  prices: ProductPriceRow[];
}

export interface DisplayPrices {
  cash: number | null;
  installment: number | null;
}

function pickFromPrices(prices: ProductPriceRow[], exactLabel: string, prefix: string): number | null {
  const exact = prices.find(p => p.label === exactLabel);
  if (exact) return Number(exact.amount);
  const prefixMatch = prices.find(p => p.label.startsWith(prefix));
  if (prefixMatch) return Number(prefixMatch.amount);
  return null;
}

export function getDisplayPrices(product: ProductForDisplay): DisplayPrices {
  const cash =
    product.cashPrice != null
      ? Number(product.cashPrice)
      : pickFromPrices(product.prices, 'ราคาเงินสด', 'ราคาเงินสด');

  const installment =
    product.installmentPrice != null
      ? Number(product.installmentPrice)
      : pickFromPrices(product.prices, 'ราคาผ่อน BESTCHOICE', 'ราคาผ่อน');

  return { cash, installment };
}
```

- [ ] **Step 4: Run test — verify passing**

Run: `cd apps/web && npx vitest run src/utils/getDisplayPrices.test.ts`
Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/getDisplayPrices.ts apps/web/src/utils/getDisplayPrices.test.ts
git commit -m "feat(web): getDisplayPrices helper — prefer new Product fields, fallback to labels"
```

### Task 16: Refactor 5 ProductPrice consumers to use the helper

**Files:**
- Modify: `apps/web/src/pages/POSPage/index.tsx:130-139`
- Modify: `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts:35-38`
- Modify: `apps/web/src/pages/ContractCreatePage/components/ProductSelectStep.tsx:48`
- Modify: `apps/web/src/pages/StockPage/ProductsPage.tsx:185`
- Modify: `apps/web/src/pages/ProductDetailPage/components/ProductInfo.tsx:164-173`

**For each file:**

- [ ] **Step 1: Read existing logic, replace inline lookup with `getDisplayPrices(product)`**

Example for POSPage (line 130-139 was finding default price):

**Before:**
```typescript
const defaultPrice = product.prices.find(p => p.isDefault);
const sellingPrice = defaultPrice?.amount ?? product.prices[0]?.amount ?? 0;
```

**After:**
```typescript
import { getDisplayPrices } from '@/utils/getDisplayPrices';
const { installment, cash } = getDisplayPrices(product);
const sellingPrice = installment ?? cash ?? 0;
```

- [ ] **Step 2: Type-check after each edit**

Run: `./tools/check-types.sh web`
Expected: 0 errors.

- [ ] **Step 3: Run vitest for the touched module**

Run: `cd apps/web && npx vitest run <test path>`
Expected: existing tests passing.

- [ ] **Step 4: Commit each refactor**

```bash
git add apps/web/src/pages/<module>/
git commit -m "refactor(<module>): use getDisplayPrices helper"
```

### Task 17: Refactor `useContractCalculation` to wrap `calcBcInstallment`

**Files:**
- Modify: `apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts`

- [ ] **Step 1: Read the existing hook + 16 tests**

```bash
cat apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts
cat apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.test.ts
```

- [ ] **Step 2: Replace the math with `calcBcInstallment`**

Inside the hook, where it currently computes `dPrincipal`, `dStoreCommission`, etc., replace with:

```typescript
import { calcBcInstallment } from '@bestchoice/shared';
import Decimal from 'decimal.js';

// inside the hook body, where `calculation` is computed:
const ratePctByMonths = new Map<number, Decimal>(
  interestConfig.rates.map(r => [r.months, new Decimal(r.ratePct)]),
);

const out = calcBcInstallment({
  installmentPrice: new Decimal(sellingPrice),
  months: totalMonths,
  downPct: new Decimal(downPct),
  config: {
    minDownPct: new Decimal(interestConfig.minDownPaymentPct),
    commissionPct: new Decimal(interestConfig.storeCommissionPct),
    vatPct: new Decimal(interestConfig.vatPct),
    ratePctByMonths,
    allowedMonths: Array.from(ratePctByMonths.keys()),
  },
});

const calculation = {
  sellingPrice: out.sellingPrice.toNumber(),
  principal: out.financedAmount.toNumber(),
  interestTotal: out.interestAmount.toNumber(),
  storeCommission: out.commissionAmount.toNumber(),
  vatAmount: out.vatAmount.toNumber(),
  monthlyPayment: out.monthlyPayment.toNumber(),
  minMonths: interestConfig.minInstallmentMonths,
  maxMonths: interestConfig.maxInstallmentMonths,
  // ... other fields kept identical to current hook return shape
};
```

(Engineer: preserve the existing return shape exactly — callers depend on the field names. Only the internal math changes.)

- [ ] **Step 3: Run the existing 16 hook tests**

Run: `cd apps/web && npx vitest run useContractCalculation.test.ts`
Expected: all 16 tests passing. If any fail because numbers differ at the 0.01 level due to Decimal vs satang rounding, **investigate** — possible causes:
- `installment-calc.ts` uses `ROUND_HALF_UP` while old hook used `Math.round`. Both should produce same result for our cases.
- If real divergence, prefer the calc utility's output (more correct) and update the test expectation with a comment explaining why.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts
git commit -m "refactor(web): useContractCalculation wraps calcBcInstallment from shared"
```

---

## Phase F — GFIN admin module + UI (PR 6)

### Task 18: Create GfinConfigModule (backend)

**Files:**
- Create: `apps/api/src/modules/gfin-config/gfin-config.module.ts`
- Create: `apps/api/src/modules/gfin-config/gfin-config.service.ts`
- Create: `apps/api/src/modules/gfin-config/gfin-config.controller.ts`
- Create: `apps/api/src/modules/gfin-config/dto/max-price.dto.ts`
- Create: `apps/api/src/modules/gfin-config/dto/overprice-rule.dto.ts`
- Create: `apps/api/src/modules/gfin-config/dto/rate-factor.dto.ts`

- [ ] **Step 1: Scaffold the module**

Run: `./tools/generate-module.sh gfin-config`
Expected: creates `gfin-config.module.ts`, `gfin-config.controller.ts`, `gfin-config.service.ts` with NestJS boilerplate.

- [ ] **Step 2: Write `max-price.dto.ts`**

```typescript
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { GfinCondition } from '@prisma/client';

export class CreateMaxPriceDto {
  @IsString() @MaxLength(80) gfinSeries!: string;
  @IsOptional() @IsString() @MaxLength(40) gfinVariant?: string | null;
  @IsString() @MaxLength(20) storage!: string;
  @IsEnum(GfinCondition) condition!: GfinCondition;
  @IsNumber({ maxDecimalPlaces: 2 }) maxPrice!: number;
  @IsString() @MaxLength(120) modelMatchPattern!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateMaxPriceDto {
  @IsOptional() @IsString() @MaxLength(80) gfinSeries?: string;
  @IsOptional() @IsString() @MaxLength(40) gfinVariant?: string | null;
  @IsOptional() @IsString() @MaxLength(20) storage?: string;
  @IsOptional() @IsEnum(GfinCondition) condition?: GfinCondition;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) maxPrice?: number;
  @IsOptional() @IsString() @MaxLength(120) modelMatchPattern?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
```

- [ ] **Step 3: Write `overprice-rule.dto.ts` and `rate-factor.dto.ts`**

Same shape as max-price — `Create*` (all required except `isActive`) and `Update*` (all optional).

For overprice-rule:
```typescript
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { GfinCondition } from '@prisma/client';

export class CreateOverpriceRuleDto {
  @IsString() @MaxLength(80) label!: string;
  @IsString() @MaxLength(200) seriesPattern!: string;
  @IsEnum(GfinCondition) condition!: GfinCondition;
  @IsNumber({ maxDecimalPlaces: 2 }) allowance!: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateOverpriceRuleDto {
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsOptional() @IsString() @MaxLength(200) seriesPattern?: string;
  @IsOptional() @IsEnum(GfinCondition) condition?: GfinCondition;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) allowance?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
```

For rate-factor:
```typescript
import { IsBoolean, IsInt, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class CreateRateFactorDto {
  @IsInt() @Min(1) @Max(36) months!: number;
  @IsNumber({ maxDecimalPlaces: 6 }) factor!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) feePerInstallment?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateRateFactorDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) factor?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) feePerInstallment?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
```

- [ ] **Step 4: Implement `gfin-config.service.ts`**

Service methods: `listMaxPrices`, `createMaxPrice`, `updateMaxPrice`, `softDeleteMaxPrice`, and parallel sets for overprice + rate-factor + a `findMatchingMapping(productId)` helper for the admin "Match Preview" tool.

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { findGfinMapping } from '@bestchoice/shared';
import {
  CreateMaxPriceDto, UpdateMaxPriceDto,
  CreateOverpriceRuleDto, UpdateOverpriceRuleDto,
  CreateRateFactorDto, UpdateRateFactorDto,
} from './dto';

@Injectable()
export class GfinConfigService {
  constructor(private prisma: PrismaService) {}

  listMaxPrices() {
    return this.prisma.gfinModelMapping.findMany({
      where: { deletedAt: null },
      orderBy: [{ gfinSeries: 'asc' }, { gfinVariant: 'asc' }, { storage: 'asc' }, { condition: 'asc' }],
    });
  }

  createMaxPrice(dto: CreateMaxPriceDto) {
    return this.prisma.gfinModelMapping.create({
      data: { ...dto, maxPrice: new Prisma.Decimal(dto.maxPrice) },
    });
  }

  async updateMaxPrice(id: string, dto: UpdateMaxPriceDto) {
    const row = await this.prisma.gfinModelMapping.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw new NotFoundException('ไม่พบ row นี้');
    const data: any = { ...dto };
    if (dto.maxPrice !== undefined) data.maxPrice = new Prisma.Decimal(dto.maxPrice);
    return this.prisma.gfinModelMapping.update({ where: { id }, data });
  }

  async softDeleteMaxPrice(id: string) {
    return this.prisma.gfinModelMapping.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ... (parallel for overprice-rule + rate-factor)

  async matchPreview(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');
    const mappings = await this.prisma.gfinModelMapping.findMany({ where: { deletedAt: null } });
    const match = findGfinMapping(
      {
        brand: product.brand ?? '',
        model: product.model ?? '',
        storage: product.storage ?? '',
        category: (product.category === 'PHONE_NEW' ? 'PHONE_NEW' : 'PHONE_USED') as any,
      },
      mappings.map(m => ({
        ...m,
        maxPrice: new Prisma.Decimal(m.maxPrice) as any,
      })) as any,
    );
    return { product: { id: product.id, name: product.name }, match };
  }
}
```

- [ ] **Step 5: Implement `gfin-config.controller.ts` with proper guards + audit**

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { GfinConfigService } from './gfin-config.service';
import {
  CreateMaxPriceDto, UpdateMaxPriceDto,
  CreateOverpriceRuleDto, UpdateOverpriceRuleDto,
  CreateRateFactorDto, UpdateRateFactorDto,
} from './dto';

@Controller('gfin-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GfinConfigController {
  constructor(private service: GfinConfigService) {}

  // ===== Max Prices =====
  @Get('max-prices')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  listMaxPrices() { return this.service.listMaxPrices(); }

  @Post('max-prices')
  @Roles('OWNER')
  createMaxPrice(@Body() dto: CreateMaxPriceDto) { return this.service.createMaxPrice(dto); }

  @Patch('max-prices/:id')
  @Roles('OWNER')
  updateMaxPrice(@Param('id') id: string, @Body() dto: UpdateMaxPriceDto) {
    return this.service.updateMaxPrice(id, dto);
  }

  @Delete('max-prices/:id')
  @Roles('OWNER')
  deleteMaxPrice(@Param('id') id: string) { return this.service.softDeleteMaxPrice(id); }

  // ===== Overprice Rules — parallel endpoints =====
  // ===== Rate Factors — parallel endpoints =====

  @Get('match-preview')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  matchPreview(@Query('productId') productId: string) {
    return this.service.matchPreview(productId);
  }
}
```

- [ ] **Step 6: Register `GfinConfigModule` in `app.module.ts`**

Add to imports:
```typescript
import { GfinConfigModule } from './modules/gfin-config/gfin-config.module';

@Module({
  imports: [/* existing */, GfinConfigModule],
  // ...
})
```

- [ ] **Step 7: Audit logs in service mutations**

Wrap create/update/delete in `this.prisma.$transaction(...)` and emit `AuditLog` rows with action strings: `GFIN_MAX_PRICE_CREATED`, `_UPDATED`, `_DELETED` (and parallel for overprice + rate-factor). Follow the pattern in `apps/api/src/modules/peak-mapping/` (per memory PEAK_MAPPING_UPDATED).

- [ ] **Step 8: Type-check + run module tests**

```bash
./tools/check-types.sh api
cd apps/api && npx jest src/modules/gfin-config/
```
Expected: 0 errors. Tests for service + controller (basic CRUD + audit log emission) created.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/gfin-config/ apps/api/src/app.module.ts
git commit -m "feat(gfin-config): admin module with CRUD + audit logs

3 entities (GfinModelMapping, GfinOverpriceRule, GfinRateFactor).
OWNER-only writes, broader read access for calc preview. Match-preview
endpoint helps owner validate product-to-mapping resolution."
```

### Task 19: GfinConfigPage UI (frontend)

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/index.tsx`
- Create: `apps/web/src/pages/GfinConfigPage/MaxPricesTab.tsx`
- Create: `apps/web/src/pages/GfinConfigPage/OverpriceRulesTab.tsx`
- Create: `apps/web/src/pages/GfinConfigPage/RateFactorsTab.tsx`
- Create: `apps/web/src/pages/GfinConfigPage/MatchPreviewPanel.tsx`
- Modify: `apps/web/src/App.tsx` (add lazy route + OWNER guard)
- Modify: `apps/web/src/constants/menu.ts` (add menu entry under Settings)

- [ ] **Step 1: Skeleton page with Tabs**

Create `apps/web/src/pages/GfinConfigPage/index.tsx`:

```typescript
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MaxPricesTab } from './MaxPricesTab';
import { OverpriceRulesTab } from './OverpriceRulesTab';
import { RateFactorsTab } from './RateFactorsTab';
import { MatchPreviewPanel } from './MatchPreviewPanel';

export default function GfinConfigPage() {
  const [tab, setTab] = useState('max-prices');
  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <PageHeader
        title="ตั้งค่า GFIN"
        breadcrumb={[{ label: 'หน้าหลัก', href: '/' }, { label: 'ตั้งค่า', href: '/settings' }, { label: 'GFIN' }]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="max-prices">ราคาสูงสุด</TabsTrigger>
          <TabsTrigger value="overprice">Over Price</TabsTrigger>
          <TabsTrigger value="rate-factors">ตารางค่างวด</TabsTrigger>
          <TabsTrigger value="match-preview">ทดสอบ Match</TabsTrigger>
        </TabsList>
        <TabsContent value="max-prices"><MaxPricesTab /></TabsContent>
        <TabsContent value="overprice"><OverpriceRulesTab /></TabsContent>
        <TabsContent value="rate-factors"><RateFactorsTab /></TabsContent>
        <TabsContent value="match-preview"><MatchPreviewPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Implement MaxPricesTab with TanStack Query**

Create `apps/web/src/pages/GfinConfigPage/MaxPricesTab.tsx`:

```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';

interface MaxPrice {
  id: string;
  gfinSeries: string;
  gfinVariant: string | null;
  storage: string;
  condition: 'HAND_1' | 'HAND_2';
  maxPrice: number;
  modelMatchPattern: string;
  isActive: boolean;
  updatedAt: string;
}

export function MaxPricesTab() {
  const [search, setSearch] = useState('');
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['gfin-max-prices'],
    queryFn: () => api.get<MaxPrice[]>('/gfin-config/max-prices').then(r => r.data),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/gfin-config/max-prices/${id}`, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gfin-max-prices'] });
      toast.success('บันทึกแล้ว');
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });

  // QueryBoundary handles loading + error states (use existing project pattern)
  if (isLoading) return <div>กำลังโหลด...</div>;
  if (error) return <div>เกิดข้อผิดพลาด</div>;

  const filtered = (data ?? []).filter(r =>
    r.gfinSeries.toLowerCase().includes(search.toLowerCase()) ||
    r.modelMatchPattern.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input placeholder="ค้นหา series หรือ pattern..." value={search} onChange={e => setSearch(e.target.value)} />
        <Button variant="default">+ เพิ่ม</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Series</TableHead>
            <TableHead>Variant</TableHead>
            <TableHead>Storage</TableHead>
            <TableHead>สภาพ</TableHead>
            <TableHead className="text-right">ราคาสูงสุด</TableHead>
            <TableHead>Match Pattern</TableHead>
            <TableHead>ใช้งาน</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map(row => (
            <TableRow key={row.id}>
              <TableCell>{row.gfinSeries}</TableCell>
              <TableCell>{row.gfinVariant ?? '—'}</TableCell>
              <TableCell>{row.storage}</TableCell>
              <TableCell>{row.condition === 'HAND_1' ? 'มือ 1' : 'มือ 2'}</TableCell>
              <TableCell className="text-right">{Number(row.maxPrice).toLocaleString()}</TableCell>
              <TableCell>{row.modelMatchPattern}</TableCell>
              <TableCell>
                <Switch
                  checked={row.isActive}
                  onCheckedChange={v => toggleActive.mutate({ id: row.id, isActive: v })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

(Engineer: add edit + create modal forms following the patterns in existing OWNER admin pages like `/settings/peak-mapping`. Reference: `apps/web/src/pages/SettingsPage/PeakMappingTab.tsx` if present.)

- [ ] **Step 3: Implement OverpriceRulesTab and RateFactorsTab in same pattern**

(Engineer: follow MaxPricesTab structure. Each tab: TanStack Query, table, toggle isActive, add/edit modal.)

- [ ] **Step 4: Implement MatchPreviewPanel**

Create `apps/web/src/pages/GfinConfigPage/MatchPreviewPanel.tsx`:

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function MatchPreviewPanel() {
  const [productId, setProductId] = useState('');
  const { data, refetch } = useQuery({
    queryKey: ['gfin-match-preview', productId],
    queryFn: () => api.get(`/gfin-config/match-preview?productId=${productId}`).then(r => r.data),
    enabled: false,
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input placeholder="Product ID" value={productId} onChange={e => setProductId(e.target.value)} />
        <Button onClick={() => refetch()}>ทดสอบ Match</Button>
      </div>
      {data && (
        <pre className="bg-muted p-4 rounded">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add lazy route + menu entry**

In `apps/web/src/App.tsx`:

```typescript
const GfinConfigPage = lazy(() => import('@/pages/GfinConfigPage'));

// inside <Routes>:
<Route path="/settings/gfin-rates" element={
  <ProtectedRoute roles={['OWNER']}>
    <MainLayout><GfinConfigPage /></MainLayout>
  </ProtectedRoute>
} />
```

In `apps/web/src/constants/menu.ts` (or wherever the OWNER settings menu is defined), add:
```typescript
{ label: 'ตั้งค่า GFIN', icon: Calculator, href: '/settings/gfin-rates', roles: ['OWNER'] }
```

- [ ] **Step 6: Type-check + manual smoke**

```bash
./tools/check-types.sh web
cd apps/web && npm run dev   # start dev server
```
Open `http://localhost:5173/settings/gfin-rates` as OWNER. Verify all 4 tabs render + table data appears.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage/ apps/web/src/App.tsx apps/web/src/constants/menu.ts
git commit -m "feat(web): GfinConfigPage — 4 tabs for OWNER-managed GFIN rate tables"
```

---

## Phase G — Internal Preview UI (PR 7)

### Task 20: BcCalculatorCard component

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/components/BcCalculatorCard.tsx`

- [ ] **Step 1: Skeleton component**

Create the file:

```typescript
import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { calcBcInstallment } from '@bestchoice/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { formatTHB } from '@/utils/format';

interface Props {
  productId: string;
  installmentPrice: number;
  hideCommission?: boolean;     // SALES role
  config: {
    minDownPct: number;
    commissionPct: number;
    vatPct: number;
    ratePctByMonths: Record<number, number>;
    allowedMonths: number[];
  };
}

export function BcCalculatorCard({ productId, installmentPrice, hideCommission, config }: Props) {
  const navigate = useNavigate();
  const [months, setMonths] = useState(12);
  const [downAmount, setDownAmount] = useState(Math.round(installmentPrice * config.minDownPct));

  const ratePctByMonths = useMemo(
    () => new Map(Object.entries(config.ratePctByMonths).map(([k, v]) => [Number(k), new Decimal(v)])),
    [config.ratePctByMonths],
  );

  const result = useMemo(
    () =>
      calcBcInstallment({
        installmentPrice: new Decimal(installmentPrice),
        months,
        customDownAmount: new Decimal(downAmount),
        config: {
          minDownPct: new Decimal(config.minDownPct),
          commissionPct: new Decimal(config.commissionPct),
          vatPct: new Decimal(config.vatPct),
          ratePctByMonths,
          allowedMonths: config.allowedMonths,
        },
      }),
    [installmentPrice, months, downAmount, config, ratePctByMonths],
  );

  const handleUseInContract = () => {
    navigate(`/contracts/create?productId=${productId}&downAmount=${downAmount}&months=${months}`);
  };

  return (
    <Card className="border-emerald-200">
      <CardHeader>
        <CardTitle className="text-emerald-700">BESTCHOICE</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">เงินดาวน์ (฿)</label>
          <Input
            type="number"
            value={downAmount}
            onChange={e => setDownAmount(Number(e.target.value))}
            className="text-right"
          />
          <label className="text-sm">งวด</label>
          <Select value={String(months)} onValueChange={v => setMonths(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {config.allowedMonths.map(m => <SelectItem key={m} value={String(m)}>{m} งวด</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <hr />
        {!result.isValid && (
          <ul className="text-red-600 text-sm">
            {result.errors.map(e => <li key={e}>• {e}</li>)}
          </ul>
        )}
        <Row label="ดาวน์" value={result.downAmount.toNumber()} />
        <Row label="ยอดจัด" value={result.financedAmount.toNumber()} />
        <Row label={`ดอกเบี้ย (${result.interestPct.mul(100).toFixed(0)}%)`} value={result.interestAmount.toNumber()} />
        {!hideCommission && (
          <Row label={`คอม (${result.commissionPct.mul(100).toFixed(0)}%)`} value={result.commissionAmount.toNumber()} />
        )}
        <Row label="VAT 7%" value={result.vatAmount.toNumber()} />
        <div className="border-t pt-2 text-lg font-semibold flex justify-between">
          <span>ค่างวด</span>
          <span className="text-emerald-700">{formatTHB(result.monthlyPayment.toNumber())} / เดือน</span>
        </div>
        <Button
          className="w-full"
          disabled={!result.isValid}
          onClick={handleUseInContract}
        >
          ใช้ราคานี้ทำสัญญา
        </Button>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{formatTHB(value)}</span>
    </div>
  );
}
```

- [ ] **Step 2: Component test**

Create `apps/web/src/pages/ProductDetailPage/components/__tests__/BcCalculatorCard.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { BcCalculatorCard } from '../BcCalculatorCard';

const config = {
  minDownPct: 0.15,
  commissionPct: 0.10,
  vatPct: 0.07,
  ratePctByMonths: { 5: 0.40, 6: 0.40, 7: 0.50, 8: 0.50, 10: 0.50, 12: 0.50 },
  allowedMonths: [5, 6, 7, 8, 10, 12],
};

describe('BcCalculatorCard', () => {
  it('renders canonical worked example monthly payment', () => {
    render(
      <BrowserRouter>
        <BcCalculatorCard productId="p1" installmentPrice={19900} config={config} />
      </BrowserRouter>,
    );
    expect(screen.getByText(/2,413\.21/)).toBeInTheDocument();
  });

  it('hides commission when hideCommission=true (SALES role)', () => {
    render(
      <BrowserRouter>
        <BcCalculatorCard productId="p1" installmentPrice={19900} hideCommission config={config} />
      </BrowserRouter>,
    );
    expect(screen.queryByText(/คอม/)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test**

Run: `cd apps/web && npx vitest run BcCalculatorCard.test.tsx`
Expected: 2 tests passing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ProductDetailPage/components/BcCalculatorCard.tsx apps/web/src/pages/ProductDetailPage/components/__tests__/BcCalculatorCard.test.tsx
git commit -m "feat(web): BcCalculatorCard for product detail page"
```

### Task 21: GfinCalculatorCard component

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/components/GfinCalculatorCard.tsx`

- [ ] **Step 1: Implement component (mirror BC structure, GFIN math + disabled state when mapping missing)**

```typescript
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import { api } from '@/lib/api';
import {
  calcGfinInstallment, findGfinMapping, findGfinOverpriceRule,
} from '@bestchoice/shared';
import type { GfinModelMappingRow, GfinOverpriceRuleRow, GfinRateFactorRow } from '@bestchoice/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { formatTHB } from '@/utils/format';

interface Props {
  productId: string;
  installmentPrice: number;
  product: { brand: string; model: string; storage: string; category: 'PHONE_NEW' | 'PHONE_USED' };
}

export function GfinCalculatorCard({ productId, installmentPrice, product }: Props) {
  const [months, setMonths] = useState(12);
  const [downPct, setDownPct] = useState(0.30);

  const { data: mappings } = useQuery({
    queryKey: ['gfin-max-prices'],
    queryFn: () => api.get<GfinModelMappingRow[]>('/gfin-config/max-prices').then(r => r.data),
  });
  const { data: rules } = useQuery({
    queryKey: ['gfin-overprice-rules'],
    queryFn: () => api.get<GfinOverpriceRuleRow[]>('/gfin-config/overprice-rules').then(r => r.data),
  });
  const { data: factors } = useQuery({
    queryKey: ['gfin-rate-factors'],
    queryFn: () => api.get<GfinRateFactorRow[]>('/gfin-config/rate-factors').then(r => r.data),
  });

  const mapping = useMemo(() => {
    if (!mappings) return null;
    return findGfinMapping(product, mappings.map(m => ({ ...m, maxPrice: new Decimal(m.maxPrice) })));
  }, [mappings, product]);

  const result = useMemo(() => {
    if (!mapping || !factors) return null;
    const factor = factors.find(f => f.months === months && f.isActive);
    if (!factor) return null;
    const rule = findGfinOverpriceRule(mapping, rules ?? []);
    return calcGfinInstallment({
      installmentPrice: new Decimal(installmentPrice),
      product,
      months,
      downPct: new Decimal(downPct),
      mapping,
      overpriceRule: rule,
      rateFactor: { ...factor, factor: new Decimal(factor.factor), feePerInstallment: new Decimal(factor.feePerInstallment) },
    });
  }, [mapping, factors, rules, months, downPct, installmentPrice, product]);

  if (!mappings || !factors) return <Card><CardContent>กำลังโหลด...</CardContent></Card>;

  if (!mapping) {
    return (
      <Card className="border-muted">
        <CardHeader><CardTitle className="text-muted-foreground">GFIN</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            รุ่นนี้ไม่อยู่ในตาราง GFIN — ติดต่อ OWNER เพื่อเพิ่มข้อมูลในตั้งค่า GFIN
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;

  return (
    <Card className="border-blue-200">
      <CardHeader>
        <CardTitle className="text-blue-700">GFIN</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">% ดาวน์</label>
          <Input
            type="number"
            value={downPct * 100}
            min={30}
            onChange={e => setDownPct(Number(e.target.value) / 100)}
            className="text-right"
          />
          <label className="text-sm">งวด</label>
          <Select value={String(months)} onValueChange={v => setMonths(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(factors ?? []).filter(f => f.isActive).map(f => (
                <SelectItem key={f.months} value={String(f.months)}>{f.months} งวด</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <hr />
        <Row label="ราคาส่ง GFIN" value={result.gfinSubmitPrice.toNumber()} />
        <Row label="ส่วนลดดาวน์" value={result.downDiscount.toNumber()} />
        <Row label="ดาวน์ตามสูตร" value={result.downAmountByFormula.toNumber()} />
        <Row label="ดาวน์จริง (ลูกค้าจ่าย)" value={result.downAmountActual.toNumber()} highlight />
        <Row label="ยอดจัด" value={result.financedAmount.toNumber()} />
        <Row label="ค่าธรรมเนียม/งวด" value={result.feePerInstallment.toNumber()} />
        <div className="border-t pt-2 text-lg font-semibold flex justify-between">
          <span>ค่างวด</span>
          <span className="text-blue-700">{formatTHB(result.monthlyPayment.toNumber())} / เดือน</span>
        </div>
        <p className="text-xs text-muted-foreground">ส่งให้ไฟแนนซ์ภายนอก (GFIN) — ไม่ใช่สัญญาของเรา</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${highlight ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{formatTHB(value)}</span>
    </div>
  );
}
```

- [ ] **Step 2: Component test (mapping found + missing scenarios)**

Add a vitest test file `__tests__/GfinCalculatorCard.test.tsx` with mocked react-query for the 3 endpoints; assert that:
- Card renders monthly payment when mapping found
- Card shows "ไม่อยู่ในตาราง" when mapping is null

- [ ] **Step 3: Run test**

Run: `cd apps/web && npx vitest run GfinCalculatorCard.test.tsx`
Expected: passing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ProductDetailPage/components/GfinCalculatorCard.tsx apps/web/src/pages/ProductDetailPage/components/__tests__/GfinCalculatorCard.test.tsx
git commit -m "feat(web): GfinCalculatorCard with mapping resolution + disabled fallback"
```

### Task 22: InstallmentCalculatorCard wrapper + integrate into ProductDetailPage

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/components/InstallmentCalculatorCard.tsx`
- Modify: `apps/web/src/pages/ProductDetailPage/index.tsx`

- [ ] **Step 1: Wrapper component**

```typescript
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { BcCalculatorCard } from './BcCalculatorCard';
import { GfinCalculatorCard } from './GfinCalculatorCard';
import { getDisplayPrices } from '@/utils/getDisplayPrices';

interface Props {
  product: any;     // Product shape used elsewhere on the page — keep loose-typed
}

export function InstallmentCalculatorCard({ product }: Props) {
  const { user } = useAuth();
  const { installment } = getDisplayPrices(product);
  const { data: bcConfig } = useQuery({
    queryKey: ['interest-config', product.category, 'bc'],
    queryFn: () => api.get(`/interest-configs/resolved?category=${product.category}`).then(r => r.data),
  });

  if (!installment) {
    return (
      <div className="rounded-md bg-amber-50 border border-amber-200 p-4 text-sm">
        ยังไม่ได้กำหนดราคาเงินผ่อน
        <a href={`/products/${product.id}/edit`} className="ml-2 underline text-amber-700">ไปแก้ราคา</a>
      </div>
    );
  }

  if (!bcConfig) return <div>กำลังโหลด...</div>;

  const hideCommission = user?.role === 'SALES';

  return (
    <section className="space-y-2">
      <h3 className="text-lg font-semibold">เครื่องคำนวณค่างวด</h3>
      <div className="grid md:grid-cols-2 gap-4">
        <BcCalculatorCard
          productId={product.id}
          installmentPrice={Number(installment)}
          hideCommission={hideCommission}
          config={bcConfig}
        />
        <GfinCalculatorCard
          productId={product.id}
          installmentPrice={Number(installment)}
          product={{
            brand: product.brand,
            model: product.model,
            storage: product.storage,
            category: product.category === 'PHONE_NEW' ? 'PHONE_NEW' : 'PHONE_USED',
          }}
        />
      </div>
    </section>
  );
}
```

(Engineer: the `/interest-configs/resolved` endpoint may need to be created as part of this task. Existing `config.util.ts` `resolveInstallmentParams` returns the config — wrap it in a controller endpoint that returns the JSON shape Bc expects. Alternatively, fetch `/interest-configs?category=...` and shape on client.)

- [ ] **Step 2: Embed in ProductDetailPage**

In `apps/web/src/pages/ProductDetailPage/index.tsx`, below the existing ProductInfo block:

```typescript
import { InstallmentCalculatorCard } from './components/InstallmentCalculatorCard';

// in the "info" tab content:
<InstallmentCalculatorCard product={product} />
```

- [ ] **Step 3: Smoke test in dev**

```bash
cd apps/web && npm run dev
```
Open `http://localhost:5173/products/<some-id>` as OWNER. Verify:
- Both cards render side-by-side
- BC card shows worked example numbers when installmentPrice=19,900 and months=12
- GFIN card shows "ไม่อยู่ในตาราง" if no mapping, or correct calc if mapping present
- "ใช้ราคานี้ทำสัญญา" button navigates to `/contracts/create?...` with query params

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ProductDetailPage/components/InstallmentCalculatorCard.tsx apps/web/src/pages/ProductDetailPage/index.tsx
git commit -m "feat(web): integrate InstallmentCalculatorCard on ProductDetailPage"
```

### Task 23: ContractCreatePage accepts pre-fill from query params

**Files:**
- Modify: `apps/web/src/pages/ContractCreatePage/` (the entry component)

- [ ] **Step 1: Parse URL search params on mount**

In ContractCreatePage entry (likely `index.tsx`), add:

```typescript
import { useSearchParams } from 'react-router-dom';

const [searchParams] = useSearchParams();
const prefillProductId = searchParams.get('productId');
const prefillDownAmount = searchParams.get('downAmount');
const prefillMonths = searchParams.get('months');

// on mount, dispatch into form state (Zustand store or local state):
useEffect(() => {
  if (prefillProductId) {
    // existing handler that selects the product by id
    selectProduct(prefillProductId);
  }
  if (prefillDownAmount) setDownPayment(Number(prefillDownAmount));
  if (prefillMonths) setMonths(Number(prefillMonths));
}, [prefillProductId, prefillDownAmount, prefillMonths]);
```

- [ ] **Step 2: E2E test (Playwright)**

Create `apps/web/e2e/product-detail-calc.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Product Detail → ContractCreate pre-fill', () => {
  test('navigates with productId/downAmount/months in URL', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@bestchoice.com');
    await page.fill('input[type="password"]', 'admin1234');
    await page.click('button:has-text("เข้าสู่ระบบ")');

    // Pick a product (use a known seed product id from dev DB)
    await page.goto('/products/<KNOWN_PRODUCT_ID>');
    await expect(page.locator('text=BESTCHOICE')).toBeVisible();

    // Adjust input
    await page.fill('input[type=number]:right-of(:text("เงินดาวน์"))', '3000');

    // Click "use this in contract"
    await page.click('button:has-text("ใช้ราคานี้ทำสัญญา")');

    await page.waitForURL(/\/contracts\/create\?productId=.*downAmount=3000.*months=12/);
  });
});
```

(Engineer: replace `<KNOWN_PRODUCT_ID>` with a seed product id available in dev DB after running `tools/db-reset.sh`.)

- [ ] **Step 3: Run E2E**

```bash
cd apps/web && npx playwright test product-detail-calc.spec.ts --headed
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ContractCreatePage/ apps/web/e2e/product-detail-calc.spec.ts
git commit -m "feat(web): ContractCreatePage pre-fills from query params + E2E coverage"
```

---

## Phase H — Customer Preview UI + Public Endpoint (PR 8)

### Task 24: Public `/shop/installment-preview` endpoint

**Files:**
- Create: `apps/api/src/modules/shop-catalog/dto/installment-preview.dto.ts`
- Create: `apps/api/src/modules/shop-catalog/installment-preview.service.ts`
- Create: `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts`
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.controller.ts`

- [ ] **Step 1: DTO**

```typescript
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class InstallmentPreviewDto {
  @IsString() productId!: string;
  @IsEnum(['BC', 'GFIN']) provider!: 'BC' | 'GFIN';
  @Type(() => Number) @IsInt() @Min(1) @Max(36) months!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) downPct?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) customDownAmount?: number;
}
```

- [ ] **Step 2: Service test (failing first)**

Create `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts`:

```typescript
// Test stub — fill in mocking patterns matching project's existing service specs.
// Key cases:
// 1. BC provider returns expected monthly payment for canonical example
// 2. GFIN provider returns expected monthly payment when mapping found
// 3. Returns { available: false } when product not found
// 4. Returns { available: false } when GFIN provider but no mapping
// 5. Response NEVER contains maxPrice or factor or seriesPattern
```

- [ ] **Step 3: Implement the service**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '@/prisma/prisma.service';
import { getRateForMonths } from '@/utils/get-rate-for-months.util';
import {
  calcBcInstallment, calcGfinInstallment, findGfinMapping, findGfinOverpriceRule,
} from '@bestchoice/shared';
import { InstallmentPreviewDto } from './dto/installment-preview.dto';

@Injectable()
export class InstallmentPreviewService {
  constructor(private prisma: PrismaService) {}

  async preview(dto: InstallmentPreviewDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { prices: { where: { deletedAt: null } } },
    });
    if (!product || product.deletedAt) {
      return { available: false, reason: 'product_not_found' };
    }

    const installmentPrice =
      product.installmentPrice ??
      product.prices.find(p => p.label === 'ราคาผ่อน BESTCHOICE')?.amount ??
      product.prices.find(p => p.label.startsWith('ราคาผ่อน'))?.amount ??
      null;

    if (!installmentPrice) return { available: false, reason: 'no_installment_price' };

    if (dto.provider === 'BC') {
      return this.previewBc(product, new Decimal(installmentPrice), dto);
    }
    return this.previewGfin(product, new Decimal(installmentPrice), dto);
  }

  private async previewBc(product: any, installmentPrice: Decimal, dto: InstallmentPreviewDto) {
    const config = await this.prisma.interestConfig.findFirst({
      where: {
        productCategories: { has: product.category },
        deletedAt: null,
        isActive: true,
      },
      include: { rates: { where: { deletedAt: null } } },
    });
    if (!config) return { available: false, reason: 'no_interest_config' };

    const ratePctByMonths = new Map<number, Decimal>(
      config.rates.map(r => [r.months, new Decimal(r.ratePct)]),
    );

    const result = calcBcInstallment({
      installmentPrice,
      months: dto.months,
      downPct: dto.downPct !== undefined ? new Decimal(dto.downPct) : undefined,
      customDownAmount: dto.customDownAmount !== undefined ? new Decimal(dto.customDownAmount) : undefined,
      config: {
        minDownPct: new Decimal(config.minDownPaymentPct),
        commissionPct: new Decimal(config.storeCommissionPct),
        vatPct: new Decimal(config.vatPct),
        ratePctByMonths,
        allowedMonths: Array.from(ratePctByMonths.keys()),
      },
    });

    if (!result.isValid) return { available: false, reason: 'invalid', errors: result.errors };

    return {
      available: true,
      provider: 'BC',
      monthlyPayment: result.monthlyPayment.toNumber(),
      downAmount: result.downAmount.toNumber(),
      totalWithVat: result.totalWithVat.toNumber(),
      financedAmount: result.financedAmount.toNumber(),
      months: dto.months,
    };
  }

  private async previewGfin(product: any, installmentPrice: Decimal, dto: InstallmentPreviewDto) {
    const mappings = await this.prisma.gfinModelMapping.findMany({ where: { deletedAt: null, isActive: true } });
    const rules = await this.prisma.gfinOverpriceRule.findMany({ where: { deletedAt: null, isActive: true } });
    const factor = await this.prisma.gfinRateFactor.findFirst({
      where: { months: dto.months, deletedAt: null, isActive: true },
    });
    if (!factor) return { available: false, reason: 'no_rate_factor' };

    const mapping = findGfinMapping(
      {
        brand: product.brand,
        model: product.model,
        storage: product.storage,
        category: product.category === 'PHONE_NEW' ? 'PHONE_NEW' : 'PHONE_USED',
      },
      mappings.map(m => ({ ...m, maxPrice: new Decimal(m.maxPrice) })),
    );
    if (!mapping) return { available: false, reason: 'no_gfin_mapping' };

    const rule = findGfinOverpriceRule(mapping, rules.map(r => ({ ...r, allowance: new Decimal(r.allowance) })));

    const result = calcGfinInstallment({
      installmentPrice,
      product: {
        brand: product.brand,
        model: product.model,
        storage: product.storage,
        category: product.category === 'PHONE_NEW' ? 'PHONE_NEW' : 'PHONE_USED',
      },
      months: dto.months,
      downPct: dto.downPct !== undefined ? new Decimal(dto.downPct) : undefined,
      mapping,
      overpriceRule: rule,
      rateFactor: {
        ...factor,
        factor: new Decimal(factor.factor),
        feePerInstallment: new Decimal(factor.feePerInstallment),
      },
    });

    if (!result.isValid) return { available: false, reason: 'invalid', errors: result.errors };

    return {
      available: true,
      provider: 'GFIN',
      monthlyPayment: result.monthlyPayment.toNumber(),
      downAmount: result.downAmountActual.toNumber(),
      financedAmount: result.financedAmount.toNumber(),
      months: dto.months,
      gfinSubmitPrice: result.gfinSubmitPrice.toNumber(),
      downDiscount: result.downDiscount.toNumber(),
    };
  }
}
```

- [ ] **Step 4: Wire to controller**

In `apps/api/src/modules/shop-catalog/shop-catalog.controller.ts`:

```typescript
import { Throttle } from '@nestjs/throttler';
import { InstallmentPreviewService } from './installment-preview.service';
import { InstallmentPreviewDto } from './dto/installment-preview.dto';

// constructor: add `private previewSvc: InstallmentPreviewService,`

@Get('installment-preview')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
getInstallmentPreview(@Query() dto: InstallmentPreviewDto) {
  return this.previewSvc.preview(dto);
}
```

Add to module providers/imports.

- [ ] **Step 5: Add response field tests**

Add to service spec test: assert that the returned object contains NO `maxPrice`, NO `factor`, NO `seriesPattern`, NO `feePerInstallment`. This is the security guard.

- [ ] **Step 6: Run tests**

```bash
cd apps/api && npx jest installment-preview.service.spec
./tools/check-types.sh api
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/shop-catalog/
git commit -m "feat(shop-catalog): public /installment-preview endpoint

Server-side calc returns results only — never leaks rate tables.
60 req/min per IP throttle. Behind ShopBotDefenseGuard via module."
```

### Task 25: web-shop InstallmentCalculatorCard (customer mode)

**Files:**
- Create: `apps/web-shop/src/components/InstallmentCalculatorCard.tsx`
- Modify: `apps/web-shop/src/pages/ProductDetailPage.tsx`

- [ ] **Step 1: Component**

```typescript
import { useState, useEffect } from 'react';

interface Props {
  productId: string;
  cashPrice: number | null;
  installmentPrice: number | null;
}

export function InstallmentCalculatorCard({ productId, cashPrice, installmentPrice }: Props) {
  const [months, setMonths] = useState(12);
  const [downPct, setDownPct] = useState(15);
  const [bcResult, setBcResult] = useState<any>(null);
  const [gfinResult, setGfinResult] = useState<any>(null);

  useEffect(() => {
    if (!installmentPrice) return;
    const fetchBoth = async () => {
      const params = new URLSearchParams({ productId, months: String(months), downPct: String(downPct / 100) });
      const [bc, gfin] = await Promise.all([
        fetch(`/api/shop/installment-preview?${params}&provider=BC`).then(r => r.json()),
        fetch(`/api/shop/installment-preview?${params}&provider=GFIN`).then(r => r.json()),
      ]);
      setBcResult(bc);
      setGfinResult(gfin);
    };
    fetchBoth();
  }, [productId, months, downPct, installmentPrice]);

  if (!installmentPrice) return null;

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">เลือกการผ่อน</h3>
      <div className="flex gap-3">
        <label className="text-sm">งวด:</label>
        <select value={months} onChange={e => setMonths(Number(e.target.value))}>
          {[3, 4, 5, 6, 7, 8, 10, 12].map(m => <option key={m} value={m}>{m} งวด</option>)}
        </select>
        <label className="text-sm">% ดาวน์:</label>
        <input type="number" value={downPct} min={15} onChange={e => setDownPct(Number(e.target.value))} />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {bcResult?.available && (
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">BESTCHOICE</div>
            <div className="text-2xl font-semibold">{bcResult.monthlyPayment.toLocaleString()} / เดือน</div>
            <div className="text-xs">ดาวน์: {bcResult.downAmount.toLocaleString()} ฿</div>
          </div>
        )}
        {gfinResult?.available && (
          <div className="border rounded p-3">
            <div className="text-sm text-muted-foreground">GFIN</div>
            <div className="text-2xl font-semibold">{gfinResult.monthlyPayment.toLocaleString()} / เดือน</div>
            <div className="text-xs">ดาวน์: {gfinResult.downAmount.toLocaleString()} ฿</div>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        ค่างวดข้างต้นเป็นการประมาณการ — ราคาจริงเป็นไปตามสัญญาที่ลงนาม
      </p>
      <a href="/shop/installment-apply" className="inline-block bg-emerald-600 text-white px-4 py-2 rounded">
        สมัครผ่อนออนไลน์ →
      </a>
    </section>
  );
}
```

- [ ] **Step 2: Insert into web-shop ProductDetailPage**

In `apps/web-shop/src/pages/ProductDetailPage.tsx`:

```typescript
import { InstallmentCalculatorCard } from '@/components/InstallmentCalculatorCard';

// inside the page render, below product info:
<InstallmentCalculatorCard
  productId={product.id}
  cashPrice={product.cashPrice}
  installmentPrice={product.installmentPrice}
/>
```

- [ ] **Step 3: Extend shop-catalog response shape**

In `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`, the `getProductById` (or similar) method — ensure response includes `cashPrice`, `installmentPrice`. If not already, add to the Prisma select.

- [ ] **Step 4: E2E test**

Create `apps/web-shop/e2e/installment-preview.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('customer sees installment options without internal data', async ({ page }) => {
  await page.goto('http://localhost:5174/products/<KNOWN_PRODUCT_ID>');
  await expect(page.locator('text=เลือกการผ่อน')).toBeVisible();
  await expect(page.locator('text=BESTCHOICE')).toBeVisible();
  // No internal labels
  await expect(page.locator('text=คอม')).toHaveCount(0);
  await expect(page.locator('text=VAT 7%')).toHaveCount(0);
  await expect(page.locator('text=ราคาทุน')).toHaveCount(0);
});
```

- [ ] **Step 5: Run E2E**

```bash
cd apps/web-shop && npx playwright test installment-preview.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/web-shop/src/components/InstallmentCalculatorCard.tsx apps/web-shop/src/pages/ProductDetailPage.tsx apps/api/src/modules/shop-catalog/ apps/web-shop/e2e/installment-preview.spec.ts
git commit -m "feat(web-shop): customer-facing installment calculator

Two cards (BC + GFIN), server-side calc, no internal data leakage,
real-time recalc, deep link to existing /shop/installment-apply flow."
```

---

## Phase I — Cleanup (PR 9, run AFTER PR 4 stable in prod ≥ 2 weeks)

### Task 26: Drop `InterestConfig.interestRate` column

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/utils/get-rate-for-months.util.ts` (remove fallback path)

- [ ] **Step 1: Verify prod telemetry shows no fallback hits**

`getRateForMonths` should be logging when it takes the legacy fallback path. Verify logs show only the new-lookup path being used for the past 2 weeks. If fallback still firing, **do not proceed.**

- [ ] **Step 2: Remove `interestRate` from `InterestConfig` model in schema.prisma**

```prisma
model InterestConfig {
  // ... existing fields
  // interestRate Decimal  @db.Decimal(5,4) @map("interest_rate")    <-- DELETE THIS LINE
  rates             InterestConfigRate[]
}
```

- [ ] **Step 3: Generate + apply migration**

```bash
cd apps/api && npx prisma migrate dev --name drop_interest_rate_column
```
Inspect SQL: must contain `ALTER TABLE interest_configs DROP COLUMN interest_rate;` and nothing else destructive.

- [ ] **Step 4: Remove fallback path from `getRateForMonths`**

Edit `apps/api/src/utils/get-rate-for-months.util.ts`:

```typescript
export async function getRateForMonths(
  prisma: PrismaClient,
  configId: string,
  months: number,
): Promise<Prisma.Decimal> {
  const row = await prisma.interestConfigRate.findUnique({
    where: { configId_months: { configId, months } },
  });
  if (!row || row.deletedAt) {
    throw new NotFoundException(`ไม่พบอัตราดอกเบี้ยสำหรับ ${months} งวด (configId=${configId})`);
  }
  return new Prisma.Decimal(row.ratePct);
}
```

Remove `USE_NEW_RATE_LOOKUP` from `.env.example` and any docs that mention it.

- [ ] **Step 5: Update tests — remove the "flag off" branch**

In `get-rate-for-months.util.spec.ts`, delete the legacy-fallback test case.

- [ ] **Step 6: Run full suite**

```bash
./tools/check-types.sh all
cd apps/api && npm test
cd apps/web && npx vitest run
```
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/ apps/api/src/utils/get-rate-for-months.util.ts apps/api/src/utils/get-rate-for-months.util.spec.ts
git commit -m "feat(schema): drop InterestConfig.interestRate column

PR 4 stable for 2+ weeks. Feature flag USE_NEW_RATE_LOOKUP removed.
getRateForMonths now reads InterestConfigRate exclusively.

Closes the installment calculator feature."
```

---

## Self-Review Checklist (run before handoff)

- [ ] All 9 PRs have at least one commit per major step
- [ ] Every spec section (Schema, Calc, GFIN admin, Internal UI, Customer UI, Refactor) maps to at least one task
- [ ] Worked examples from spec (BC 2,413.21/mo, GFIN 2,923/mo) are in test fixtures
- [ ] Feature flag `USE_NEW_RATE_LOOKUP` is referenced consistently across helper + tests
- [ ] All public endpoints have throttle/guard (`/shop/installment-preview` 60/min)
- [ ] Audit logs spec'd for all GFIN admin mutations
- [ ] No "TODO" / "TBD" / "fill in details" in step bodies — every step has an action or code
- [ ] Permissions: OWNER for all writes, OWNER/BM/FM/ACC/SALES for reads
- [ ] Backfill scripts are idempotent (verified by re-run check in each task)
- [ ] PR 9 cleanup gated on "PR 4 stable 2+ weeks" telemetry check
