# Merge Guard Report — worktree-feat-installment-calculator (PR #1071)

**Date:** 2026-05-22  
**Branch:** `worktree-feat-installment-calculator`  
**PR:** [#1071](https://github.com/iamnaii/BESTCHOICE/pull/1071)  
**Author:** iamnaii  
**Recommendation:** 🔶 **REVIEW** (no Critical blockers — 1 Warning, 3 Info)

---

## Summary

Large feature PR (64 files, 8,681 insertions, 49 deletions) adding a side-by-side installment calculator preview on ProductDetail pages for both BESTCHOICE in-house finance (BC) and GFIN external finance. Includes a new `packages/shared/src/installment-calc.ts` utility, a new `gfin-config` NestJS module, a public `/shop/installment-preview` endpoint, and frontend components for both the internal admin app (`apps/web`) and the customer web shop (`apps/web-shop`).

## File Changes (highlights)

| Area | Files | Notes |
|------|-------|-------|
| New NestJS module | `apps/api/src/modules/gfin-config/` (controller, service, DTOs, spec) | GFIN rate admin CRUD |
| Shared calc utility | `packages/shared/src/installment-calc.ts` + types + 2 test files | 33 tests |
| contracts.service | `apps/api/src/modules/contracts/contracts.service.ts` | Feature-flagged rate lookup refactor |
| interest-config.service | `apps/api/src/modules/interest-config/interest-config.service.ts` | New `getForCalculation()` method |
| Public endpoint | `apps/api/src/modules/shop-catalog/shop-catalog.controller.ts` + installment-preview service | `/shop/installment-preview` |
| Internal UI | `apps/web/src/pages/GfinConfigPage/` (4 tabs + match preview) | GFIN admin page |
| Internal UI | `apps/web/src/pages/ProductDetailPage/components/` (BcCalculatorCard, GfinCalculatorCard) | Internal calc cards |
| Customer web-shop | `apps/web-shop/src/components/InstallmentCalculatorCard.tsx` | Public customer calc card |
| Backfill scripts | `apps/api/scripts/` (3 scripts) | One-off data migration |

---

## Issues

### Critical
_None found._

---

### Warning

**W1 — `apps/web-shop/src/components/InstallmentCalculatorCard.tsx`: `fetch()` does not handle HTTP error responses**

The component uses raw `fetch()` with a `try/catch` that only catches network failures. HTTP 4xx/5xx responses are not re-thrown by `fetch()`, so a server error would silently be parsed as a JSON response and set as state:

```ts
const [bc, gfin] = await Promise.all([
  fetch(`/api/shop/installment-preview?${params}&provider=BC`).then((r) => r.json()),
  fetch(`/api/shop/installment-preview?${params}&provider=GFIN`).then((r) => r.json()),
]);
```

If the server returns a 400/500 with a JSON error body `{ message: '...' }`, it would be set as `bcResult` — the component would then check `bcResult.available` (which would be `undefined`) and behave unpredictably.

**Note:** Raw `fetch()` is acceptable here because this is `apps/web-shop/` (the public customer-facing app), which has no access to the JWT-aware `apps/web/src/lib/api.ts` axios client. The rule against raw `fetch()` applies to the internal admin app.

**Fix:** Add an `ok` check after each `fetch()` call:
```ts
fetch(...).then((r) => {
  if (!r.ok) return { available: false };
  return r.json();
})
```

---

### Info

**I1 — `/shop/installment-preview` not listed in security.md's intentionally-public endpoints**

The endpoint is intentionally public (customer web shop use case) and is correctly placed on `ShopCatalogController` which uses `ShopBotDefenseGuard` (the existing pattern for all `/shop/*` public endpoints). Throttle is applied (`60 req/min`). However, `security.md` only lists 5 intentionally-public controllers and doesn't include `shop-catalog`.

Suggested update: add a line to the security.md list: `shop-catalog` — product listing, product detail, and installment preview for the public customer web shop.

**I2 — `Number()` conversions on Decimal rate percentages in `interest-config.service.ts`**

The new `getForCalculation()` method converts `ratePct`, `minDownPaymentPct`, `storeCommissionPct`, `vatPct` from `Prisma.Decimal` to `number` using `Number()`. These are PERCENTAGE values (e.g., `0.15` for 15% down), not monetary amounts, and they feed into the existing `calculateInstallment()` / `calculateInstallmentWithInterest()` utilities which already use `number` arithmetic + `roundBaht()` for intermediate rounding.

This is **consistent with the existing codebase pattern** — the existing `calculateInstallment()` has always taken `number` parameters. The rule against `Number()` targets monetary stored values (like `Payment.amount`), not rate configuration multipliers.

No action required; documented for awareness.

**I3 — PR author flagged: shared package import resolution risk**

From the PR description: `gfin-config.service.ts` imports `installment-calc` via relative path (`../../../../../packages/shared/src/installment-calc`) because npm workspace symlinks don't resolve cleanly in the API bundle. The PR author recommends verifying this resolves correctly in the prod Docker build (Dockerfile copies `packages/`). This is a build-time risk, not a code quality issue.

**Action:** Owner should verify `docker build` resolves the import before marking the PR green for production.

---

## Security Checklist

| Check | Status |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ `GfinConfigController` has both guards at class level |
| Every controller method has `@Roles(...)` | ✅ All 10 methods on `GfinConfigController` have `@Roles()` |
| Public endpoints intentional + throttled | ✅ `/shop/installment-preview` uses `ShopBotDefenseGuard` + `@Throttle` 60/min |
| `Number()` on stored monetary Prisma fields | ✅ None found — `Number()` only on rate percentages (not money) |
| `deletedAt: null` in new queries | ✅ All new `findMany`/`findUnique` calls include `where: { deletedAt: null }` |
| Hardcoded secrets / API keys | ✅ None found |
| Raw `$queryRaw` without parameterization | ✅ None found |
| New DTOs have class-validator decorators | ✅ All DTOs validated (`@IsString`, `@IsNumber`, `@IsEnum`, `@Min`/`@Max`) |
| Frontend uses `api.get()`/`api.post()` | ⚠️ `apps/web-shop/` uses raw `fetch()` (acceptable for public app, see W1) |
| `queryClient.invalidateQueries()` after mutations | ✅ All mutations in `GfinConfigPage` tabs call `qc.invalidateQueries()` |
| Thai validation messages on DTOs | ℹ️ DTOs use English messages — acceptable for admin-only GFIN config |

---

## Recommendation

**REVIEW** — No Critical blockers. PR is structurally sound with proper guards, roles, soft-delete patterns, and Decimal handling on stored money fields.

Before merge:
1. **Fix W1** — add `if (!r.ok) return { available: false }` guards on the two `fetch()` calls in `apps/web-shop/src/components/InstallmentCalculatorCard.tsx`
2. **Verify I3** — confirm prod Docker build resolves the relative path import from `gfin-config.service.ts` → `packages/shared/src/installment-calc`
3. **Owner action** — verify GFIN fixture data (105 rows) matches current GFIN price list after deploy (as called out in PR description)

After fixing W1, this PR can be merged.
