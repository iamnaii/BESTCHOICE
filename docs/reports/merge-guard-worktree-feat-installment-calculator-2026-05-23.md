# Merge Guard Report — worktree-feat-installment-calculator

**Date**: 2026-05-23  
**Branch**: `origin/worktree-feat-installment-calculator`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main`

---

## File Changes Summary

- **64 files changed** — 8,681 insertions, 49 deletions
- New NestJS module: `gfin-config` (CRUD for GFIN max prices, overprice rules, rate factors)
- New shared package: `packages/shared/installment-calc.ts` (BC + GFIN calculation utilities)
- New API utility: `get-rate-for-months.util.ts`, `installment-calc.util.ts`
- Updated: `contracts.service.ts`, `interest-config.service.ts`, `sales.service.ts`
- Frontend: `GfinConfigPage` (4 tabs), `ContractCreatePage` pre-fill, `InstallmentCalculatorCard` (web-shop)
- Backfill scripts: `backfill-product-prices.ts`, `seed-gfin-tables.ts`, `seed-interest-config-rates.ts`
- Tests: `gfin-config.service.spec.ts` (+317 lines), updated contract/sales mocks

---

## Issues

### 🔴 Critical (must fix before merge)

#### C1 — `Number()` on Decimal financial fields in `contracts.service.ts`

**Files**: `apps/api/src/modules/contracts/contracts.service.ts` (diff lines 22, 46)

```ts
// Both createContract and updateContract:
const ratePct = interestConfig
  ? Number(await getRateForMonths(this.prisma, interestConfig.id, dto.totalMonths))
  : params.interestRate * dto.totalMonths;
const principal = roundBaht(dto.sellingPrice - dto.downPayment);
const resolvedInterestTotal = roundBaht(principal * ratePct);
```

`getRateForMonths` returns `Prisma.Decimal`. Wrapping it in `Number()` then multiplying with `principal` (a plain number from `roundBaht`) creates IEEE 754 floating-point precision loss on a money calculation. This is exactly the pattern fixed in **v2/v4 hardening** (53 `Number()` → `Prisma.Decimal`).

**Fix**: Use `d(principal).mul(ratePct).toDecimalPlaces(2)` — or pass the Decimal directly to `calculateInstallmentWithInterest` and update that utility to accept `Decimal | number`.

---

#### C2 — `Number()` on Decimal financial fields in `interest-config.service.ts`

**File**: `apps/api/src/modules/interest-config/interest-config.service.ts` (diff lines 33, 42, 47–49, 59–61)

```ts
ratePctByMonths[r.months] = Number(r.ratePct);       // Decimal → float
const rate = Number(cfg.interestRate);               // Decimal → float
minDownPct: Number(cfg.minDownPaymentPct),           // Decimal → float
commissionPct: Number(cfg.storeCommissionPct),       // Decimal → float
vatPct: Number(cfg.vatPct),                          // Decimal → float
```

Five separate Decimal-to-Number conversions on percentage fields that feed into downstream installment calculations. While these are percentages rather than absolute amounts, the project convention (and v4 hardening) treats all Prisma `Decimal` fields as requiring `Prisma.Decimal` arithmetic — `Number()` is explicitly banned on financial fields.

**Fix**: Change the return type of `getInstallmentConfigForBranch` to carry `Decimal` values, or call `.toNumber()` only at the final presentation/serialization layer, not mid-calculation.

---

### 🟡 Warning (should fix)

#### W1 — Raw `fetch()` in customer-facing web-shop component

**File**: `apps/web-shop/src/components/InstallmentCalculatorCard.tsx` (diff lines 53, 56)

```ts
fetch(`/api/shop/installment-preview?${params.toString()}&provider=BC`)
fetch(`/api/shop/installment-preview?${params.toString()}&provider=GFIN`)
```

`apps/web-shop` is a separate app from `apps/web`, but if it shares auth requirements, raw `fetch()` bypasses token refresh interceptors and CSRF headers. If web-shop is intentionally public (no JWT), add a comment documenting that. Otherwise use the appropriate API client.

---

#### W2 — New `/shop/installment-preview` endpoint not in documented public-endpoint allowlist

**File**: `apps/api/src/modules/shop-catalog/shop-catalog.controller.ts`

The new `GET /shop/installment-preview` uses only `@UseGuards(ShopBotDefenseGuard)` (no `JwtAuthGuard`). The existing `/shop/products` routes follow the same pattern and this appears intentional, but `shop-catalog` is **not** listed in `.claude/rules/security.md` under "Intentionally Public Endpoints".

**Fix**: Either add `shop-catalog` to the public endpoints documentation, or confirm the endpoint is truly public and add a comment in the controller class explaining why.

---

#### W3 — Missing Thai validation messages on new GfinConfig DTOs

**Files**: `apps/api/src/modules/gfin-config/dto/max-price.dto.ts`, `overprice-rule.dto.ts`, `rate-factor.dto.ts`

All DTOs use `@IsString()`, `@IsNumber()`, `@IsEnum()` without custom `{ message: 'กรุณา...' }`. Project convention (backend rules) requires Thai-language error messages on all DTOs.

**Example fix**:
```ts
@IsString({ message: 'กรุณาระบุ GFIN Series' })
gfinSeries!: string;
```

---

### 🔵 Info

#### I1 — `shop/installment-preview` endpoint missing input validation

**File**: `apps/api/src/modules/shop-catalog/shop-catalog.controller.ts`

`@Query() dto: InstallmentPreviewDto` — please verify that `InstallmentPreviewDto` has `@IsString`/`@IsNumber`/`@IsOptional` decorators and `ValidationPipe` is applied (global or controller-level).

#### I2 — `InterestConfigRate` monthly schedule is O(n×m) computation path

`seed-interest-config-rates.ts` is fine as a one-time seed. Ensure `getRateForMonths` queries by `(configId, months)` with an index — flag for DB review if the index is missing from the migration.

---

## Recommendation

> **🚫 BLOCK**

Two Critical `Number()` regression issues in financial calculation paths (`contracts.service.ts` and `interest-config.service.ts`). These directly violate the v2/v4 hardening guarantee (Decimal precision for all money math) and could produce floating-point errors in contract installment amounts. Fix C1 and C2 before merge. W1–W3 should be addressed in the same PR.
