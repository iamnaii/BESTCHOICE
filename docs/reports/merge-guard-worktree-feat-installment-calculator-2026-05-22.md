# Pre-Merge Guard Report

**Branch**: `worktree-feat-installment-calculator`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Date**: 2026-05-22
**Recommendation**: 🔴 **BLOCK** — fix Critical issues before merging

---

## File Changes Summary

64 files changed, 8,681 insertions(+), 49 deletions(-)

### Key areas changed
- `apps/api/src/modules/gfin-config/` — new GFIN config module (controller, service, spec, DTOs)
- `apps/api/src/modules/interest-config/interest-config.service.ts` — new `resolveConfig()` method
- `apps/api/src/modules/shop-catalog/installment-preview.service.ts` — new public preview endpoint
- `apps/api/src/utils/installment-calc.util.ts` — core calculator using `decimal.js`
- `apps/web/src/pages/GfinConfigPage/` — 4 new admin pages (MaxPrices, OverpriceRules, RateFactors, MatchPreview)
- `apps/web/src/pages/ProductDetailPage/` — 2 new calculator cards (BC + GFIN)
- `apps/web-shop/src/components/InstallmentCalculatorCard.tsx` — customer-facing calculator
- `packages/shared/src/installment-calc.ts` — shared calc logic with full Decimal precision
- `apps/api/prisma/schema.prisma` — 3 new models (GfinModelMapping, GfinOverpriceRule, GfinRateFactor)
- Migration: `20260960000000_installment_calc_phase_a`

---

## Issues by Severity

### 🔴 Critical (must fix before merge)

#### C1 — `Number()` on Decimal financial rate fields in `interest-config.service.ts`

**File**: `apps/api/src/modules/interest-config/interest-config.service.ts`  
**Lines added** (in `resolveConfig()`):

```ts
ratePctByMonths[r.months] = Number(r.ratePct);      // ratePct is Decimal in DB
const rate = Number(cfg.interestRate);               // interestRate is Decimal
minDownPct: Number(cfg.minDownPaymentPct),           // Decimal → number
commissionPct: Number(cfg.storeCommissionPct),       // Decimal → number
vatPct: Number(cfg.vatPct),                          // Decimal → number
```

**Rule violated**: "ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน — ใช้ Decimal" (database.md, coding-standards.md). v4 hardening sprint specifically fixed this pattern (53 `Number()` → `Prisma.Decimal` across 12 services).

**Impact**: These percentage values feed into the installment calculator. Although `installment-calc.util.ts` uses `decimal.js` internally, the input config object uses JS `number`, meaning precision is silently lost before the Decimal-safe arithmetic begins. On a 12-month flat-rate at 0.625% per month this could introduce sub-satang rounding drift that compounds across the schedule.

**Fix**: Change the `resolveConfig()` return type to use `Decimal` fields:
```ts
import { Prisma } from '@prisma/client';
ratePctByMonths[r.months] = new Prisma.Decimal(r.ratePct);
// and pass Decimal values through to InstallmentConfig
```

---

#### C2 — `Number(form.maxPrice)` in `MaxPricesTab.tsx` mutation payload

**File**: `apps/web/src/pages/GfinConfigPage/MaxPricesTab.tsx` (line ~213)

```ts
const payload = {
  ...form,
  maxPrice: Number(form.maxPrice),   // ← converts string/Decimal to Number
};
```

**Rule violated**: Frontend should not coerce money values to `Number` — the API DTO and Prisma schema store `maxPrice` as `Decimal`. Sending a JS `number` from the client is a serialisation concern (JSON has no Decimal type), but the coercion here is unnecessary — the string value from the `<Input>` can be sent directly as a string for the DTO's `@IsNumber()` validator to accept via `transform: true`.

**Fix**: Remove `Number(form.maxPrice)` and ensure the DTO uses `@Transform(({ value }) => new Decimal(value))` or relies on NestJS global ValidationPipe `transformOptions`.

---

### 🟡 Warning (should fix before merge)

#### W1 — Missing Thai validation messages on all new DTOs

**Files**:
- `apps/api/src/modules/gfin-config/dto/max-price.dto.ts`
- `apps/api/src/modules/gfin-config/dto/overprice-rule.dto.ts`
- `apps/api/src/modules/gfin-config/dto/rate-factor.dto.ts`

All `@IsString()`, `@IsNumber()`, `@MaxLength()` decorators are missing `{ message: 'กรุณา...' }` options. Project rule (backend.md): "Error messages เป็นภาษาไทย เช่น `{ message: 'กรุณาระบุชื่อ' }`".

**Fix**: Add Thai error messages to every validator:
```ts
@IsString({ message: 'กรุณาระบุ GFIN Series' })
@MaxLength(80, { message: 'Series ต้องไม่เกิน 80 ตัวอักษร' })
gfinSeries: string;
```

---

#### W2 — Raw `fetch()` in `web-shop` customer app

**File**: `apps/web-shop/src/components/InstallmentCalculatorCard.tsx` (lines 47, 50)

```ts
fetch(`/api/shop/installment-preview?${params.toString()}&provider=BC`)
fetch(`/api/shop/installment-preview?${params.toString()}&provider=GFIN`)
```

**Context**: `web-shop` is a public-facing customer app hitting a public (no-JWT) endpoint. The rule "ห้ามใช้ raw fetch()" in `frontend.md` technically targets `apps/web` (admin), but consistency is preferred.

**Note**: The `shop/installment-preview` endpoint is intentionally public and uses `ShopBotDefenseGuard` + throttling (60 req/min). The raw `fetch()` doesn't break CSRF or JWT because this is a public route. Risk is low but technically violates the project standard.

**Fix**: If `apps/web-shop` has its own API client wrapper, use that. If not, a minimal wrapper (`shopFetch`) could be added.

---

### 🔵 Info

#### I1 — `toNumber()` at JSON response boundary in `installment-preview.service.ts`

Lines 106–109, 193–198 convert `Decimal` results to JS `number` for the JSON response. This is acceptable at the presentation/serialisation boundary (JSON has no Decimal type) and follows the same pattern as other services. No action needed.

#### I2 — `gfin-config.service.spec.ts` is 317 lines

Slightly above the "consider splitting" threshold of 500 lines — not a concern yet, but if more cases are added, splitting by entity (max-prices, overprice-rules, rate-factors) would improve readability.

#### I3 — Two large plan/design docs added under `docs/superpowers/plans/`

Combined ~3800 lines of planning documentation. These are non-functional artifacts that add significant repo size. Consider moving to a GitHub wiki or Notion if the repo size is a concern.

---

## What's Working Well

- **Core calculator**: `installment-calc.util.ts` and `packages/shared/installment-calc.ts` correctly use `decimal.js` throughout with proper `ROUND_HALF_UP` / `ROUND_DOWN` modes matching the accounting.md spec.
- **Guards & roles**: All new API endpoints have `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles()` at both class and method levels. `ShopCatalogController` intentionally uses `ShopBotDefenseGuard` (pre-existing public pattern).
- **Soft delete**: All new `findMany` queries include `{ deletedAt: null }` and deletes use `update({ data: { deletedAt: new Date() } })`.
- **Mutations**: All `useMutation` hooks in admin pages call `qc.invalidateQueries()` on success (including via `onSaved()` callback in `MaxPricesTab`).
- **Admin app API calls**: `GfinCalculatorCard.tsx` and all GfinConfig tab components use `api.get()` / `api.patch()` / `api.post()` from `@/lib/api` correctly.
- **No hardcoded secrets**: No API keys, passwords, or tokens found in the diff.
- **No SQL injection**: No unparameterized `$queryRaw` calls found.

---

## Action Required

1. **Fix C1** — Convert `resolveConfig()` to return `Decimal` rate values instead of `Number`
2. **Fix C2** — Remove `Number(form.maxPrice)` in the mutation payload
3. **Fix W1** — Add Thai error messages to all three new DTO files
4. **Optional W2** — Align `web-shop` fetch pattern with project standards
