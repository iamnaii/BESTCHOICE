# Pre-Merge Guard Report

**Branch:** `feat/sp2-same-price-exchange`
**Author:** Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Reviewed:** 2026-05-24
**Commits:** 15 (full feature — schema → service → controller → frontend → E2E)
**Recommendation:** 🔴 **BLOCK — 2 Critical issues must fix before merge**

---

## File Changes Summary

| File | Lines Added | Notes |
|------|------------|-------|
| `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` | +291 | New service — main business logic |
| `apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts` | +270 | Unit tests |
| `apps/web/src/pages/insurance/ExchangeRequestsPage.tsx` | +293 | Approval queue page |
| `apps/web/src/pages/insurance/ExchangeRequestForm.tsx` | +218 | Submit form page |
| `apps/api/src/modules/journal/cpa-templates/exchange-close-old-21-1106.template.ts` | +131 | JE template |
| `apps/api/src/modules/journal/cpa-templates/exchange-new-contract-1a.template.ts` | +106 | JE template |
| `apps/api/prisma/migrations/20260961000000_add_contract_exchange_request/migration.sql` | +99 | DB migration |
| `apps/api/prisma/schema.prisma` | +79 | ContractExchangeRequest model + ExchangeRequestStatus enum |
| `apps/api/src/modules/contract-exchange/contract-exchange.controller.ts` | new | 4 endpoints |
| 14 other files (DTOs, module, e2e, menu, routes, template specs) | | |

---

## Issues

### 🔴 Critical

#### C1 — Missing `deletedAt: null` on product queries + no post-fetch check
**File:** `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` — `submit()` method

Both `product.findUnique` calls omit `where: { deletedAt: null }` and the service does not check `oldProduct.deletedAt` / `newProduct.deletedAt` after fetching:

```ts
// Current — WRONG
const [oldRaw, newRaw] = await Promise.all([
  this.prisma.product.findUnique({ where: { id: dto.oldProductId } }),
  this.prisma.product.findUnique({ where: { id: dto.newProductId } }),
]);
if (!oldRaw) throw new NotFoundException('ไม่พบเครื่องเดิม');
if (!newRaw) throw new NotFoundException('ไม่พบเครื่องใหม่');
// ← missing: if (oldRaw.deletedAt || newRaw.deletedAt) throw NotFoundException
```

The contract query *does* correctly guard `deletedAt` (`if (!oldContract || oldContract.deletedAt)`), but both product queries silently allow soft-deleted products through. A SALES user could submit an exchange request referencing a deleted product, which would cause the downstream `approve()` → JE chain to reference a product no longer in the system.

**Fix:** Add `deletedAt: null` to both `where` clauses, or add a post-fetch check mirroring the contract pattern.

---

#### C2 — `BranchGuard` missing from controller — cross-branch data access
**File:** `apps/api/src/modules/contract-exchange/contract-exchange.controller.ts`

The `submit` endpoint allows `SALES` and `BRANCH_MANAGER` roles but has no `BranchGuard`. A SALES user at branch A can submit an exchange request referencing a contract that belongs to branch B. Compare to every other controller that handles branch-scoped data:

```ts
// customers.controller.ts, contracts.controller.ts, etc.
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)

// contract-exchange.controller.ts — MISSING BranchGuard
@UseGuards(JwtAuthGuard, RolesGuard)
```

The `listPending` and `approve`/`reject` endpoints are `OWNER`-only (cross-branch access is intentional for the approval queue), so `BranchGuard` should exempt those. The standard pattern is to add `BranchGuard` at class level and let it enforce on non-OWNER roles.

**Fix:** Add `BranchGuard` to the class-level `@UseGuards(...)` and ensure the `submit` DTO or service validates that `oldContractId` belongs to a branch the requesting user has access to.

---

### ⚠️ Warning

#### W1 — Route/role mismatch: frontend allows BRANCH_MANAGER/SALES/FINANCE_MANAGER to see approval queue page, backend returns 403
**Files:**
- `apps/web/src/App.tsx` — `ExchangeRequestsPage` route has `roles={['OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER']}`
- `apps/api/src/modules/contract-exchange/contract-exchange.controller.ts` — `GET /insurance/exchange-requests/pending` is `@Roles('OWNER')` only

Non-OWNER roles will navigate to `/insurance/exchange-requests`, fire the API query, and receive a 403 — which will surface as an error state or empty page. This is a UX confusion issue and misleads non-OWNER users into thinking there's a bug.

**Fix:** Either (a) restrict the route to `roles={['OWNER']}` to match the backend, or (b) expand the backend to support a filtered view for BRANCH_MANAGER (showing only their branch's requests).

---

#### W2 — Excessive `as any` casts masking Prisma type safety
**File:** `apps/api/src/modules/contract-exchange/contract-exchange.service.ts`

12 occurrences of `(this.prisma as any).contractExchangeRequest` and `(tx as any).contractExchangeRequest` throughout the service. The model is properly defined in `schema.prisma` and a migration exists — the issue is the Prisma client was not regenerated after schema changes. These `as any` casts disable type checking for all ContractExchangeRequest operations, hiding potential field name typos or missing required fields.

**Fix:** Run `npx prisma generate` in `apps/api` to regenerate the client, then remove all `as any` casts.

---

#### W3 — `computeOldOutstanding` does not apply mandated rounding modes
**File:** `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` — `computeOldOutstanding()` private method

Per `accounting.md`, the rounding modes for installment calculations are:
- `grossExclVat / totalMonths` → `ROUND_DOWN`
- `vatTotal / totalMonths` → `ROUND_HALF_UP`

The current implementation uses default Decimal.js rounding (ROUND_HALF_UP for all), which will produce different per-month values than the CPA golden fixtures:

```ts
// Current — missing explicit rounding modes
const vatPerMonth = totalVat.div(old.totalMonths);
const grossExclVatPerMonth = monthly.minus(vatPerMonth);
```

This could cause JE line amounts to deviate from the CPA CSV golden test values in `__tests__/fixtures/cpa-cases/case-8-same-price.csv`.

**Fix:** Apply `.toDecimalPlaces(2, Decimal.ROUND_DOWN)` for gross and `.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)` for VAT, matching the pattern in `PaymentReceipt2BTemplate`.

---

### ℹ️ Info

#### I1 — Migration timestamp uses impossible month `61`
**File:** `apps/api/prisma/migrations/20260961000000_add_contract_exchange_request/migration.sql`

The filename encodes `2026-09-61` which is not a real date. This only affects migration ordering (Prisma sorts by filename string), not correctness. All production migrations with timestamps > this one will still apply after it. However, it is inconsistent with the convention used across the other 48+ migrations.

---

## Positive Notes
- Controller has correct `@UseGuards(JwtAuthGuard, RolesGuard)` at class level — no unguarded endpoints
- All DTOs have Thai-language class-validator decorators
- Frontend uses `api.get()`/`api.post()` (not raw `fetch`), `useQuery`/`useMutation`, and `queryClient.invalidateQueries()` after both approve/reject mutations
- Atomic `$transaction` across JE chain + contract status flip + request status update
- Race-safe approve via `updateMany({ where: { status: 'PENDING' } })` + `count === 1` check
- Full unit test coverage (270 lines) for service logic
- E2E test added for the submit → approve flow
- `Prisma.Decimal` used correctly in JE templates — no `Number()` on money fields
- `AuditLog` written for both approve and reject operations
- Soft-delete (`deletedAt`) present on `ContractExchangeRequest` model

---

## Action Required Before Merge
1. Fix C1: Add `deletedAt: null` to both product queries in `submit()`
2. Fix C2: Add `BranchGuard` to controller + validate contract-branch ownership in `submit()`
3. Fix W1: Align frontend route roles with backend `@Roles('OWNER')`
4. Fix W2: Run `prisma generate`, remove all `as any` casts on ContractExchangeRequest operations
5. Fix W3: Apply explicit rounding modes in `computeOldOutstanding()`
