# Pre-Merge Guard Report — feat/customer-tier-phase1

**Date**: 2026-04-22  
**Branch**: `feat/customer-tier-phase1`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last commit**: 2026-04-20 17:36 +0700  
**Commits ahead of main**: 11  
**Recommendation**: 🟡 **REVIEW** — no Critical issues, two Warnings need discussion before merge

---

## File Changes Summary

17 files changed, 2,021 insertions(+), 7 deletions(-)

New files:
- `apps/api/src/modules/customers/customer-tier.service.ts` — pure tier computation + DB aggregation
- `apps/api/src/modules/customers/customer-tier.service.spec.ts` — 8 unit tests
- `apps/api/src/modules/customers/dto/tier.dto.ts` — `CustomerTier`, `CustomerTierResponse` types
- `apps/web/src/components/customer/CustomerTierBadge.tsx` — tier badge component
- `apps/web/src/components/customer/CustomerTierBadge.test.tsx` — 6 component tests
- `apps/web/src/types/customer-tier.ts` — shared frontend types
- `apps/web/e2e/customer-tier.spec.ts` — 2 E2E smoke tests
- `docs/plans/2026-04-20-customer-tier-phase1.md` — 1,132-line design doc

Modified files:
- `customers.controller.ts` — new `GET /customers/:id/tier` endpoint
- `customers.service.ts` — tier computed for each customer in `findAll`
- `customers.module.ts` — `CustomerTierService` registered
- `CustomersPage.tsx` — tier column + filter added

---

## Issues

### 🔴 Critical

None.

The controller endpoint `GET /customers/:id/tier` inherits the class-level `@UseGuards(JwtAuthGuard, RolesGuard)` from the existing `CustomersController` and correctly adds `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')`. Guards are properly applied.

---

### ⚠️ Warning

#### W-1: N+1 query pattern in `findAll` — up to ~150 DB queries per page load
**File**: `apps/api/src/modules/customers/customers.service.ts` ~line 459

```ts
// For each customer on the page (default limit=50):
const withTier = await Promise.all(
  enriched.map(async (c) => {
    const t = await this.tierService.getCustomerTier(c.id);  // 3 DB queries per customer
    return { ...c, tier: t.tier };
  }),
);
```

`getCustomerTier` runs 3 queries per customer (`customer.findFirst`, `contract.findMany`, `repossession.count`). With the default page size of 50, this is **150 DB queries per `GET /customers` request**.

The inline comment acknowledges this: _"in-memory — valid for small shops."_ However:
- Even for 20 customers the page becomes noticeably slow (60 queries)
- The `Promise.all` fires all queries concurrently which may spike connection pool usage

**Suggested mitigation (before or after merge)**: Batch the underlying queries — fetch all contracts and repossessions for the full page in 2 queries, then compute tiers in JS. The `computeTierFromHistory` method is already pure and side-effect-free, making this refactor straightforward.

#### W-2: Pagination count incorrect when `tier` filter is active
**File**: `apps/api/src/modules/customers/customers.service.ts` ~line 471

```ts
const filtered = tier ? withTier.filter((c) => c.tier === tier) : withTier;

const totalCustomers = await this.prisma.customer.count({ where: { deletedAt: null } });
// ...
return { ...paginatedResponse(filtered, total, page, limit), summary };
//                                           ↑ this is the total BEFORE tier filter
```

When `tier` filter is applied, `filtered` may have fewer items than `total`. But `paginatedResponse` uses `total` (the unfiltered DB count), so:
- `total` in the response = e.g. 200 (all customers)
- `data.length` = e.g. 5 (only GOLD customers on this page)
- The frontend calculates a last page of 4, but page 2 through 4 will return 0 results

This will break the pagination UI when filtering by tier. The `total` in the paginated response should be the count of customers matching the tier filter.

---

### ℹ️ Info

#### I-1: `CustomerTierBadge` uses non-token Tailwind color classes
**File**: `apps/web/src/components/customer/CustomerTierBadge.tsx`

```tsx
// Uses: bg-amber-100, text-amber-800, bg-green-100, text-red-800, etc.
```

The frontend rules say to use semantic tokens (`bg-primary`, `text-muted-foreground`) and avoid `text-gray-*`. The `amber-*`, `green-*`, `red-*` classes are semantic color names (not hex codes), and for tier badges that need distinct visual differentiation, these are justifiable. However, they won't automatically follow dark-mode theme switches if the project ever moves to a dark theme.

Consider wrapping in CSS variables or using `data-tier` attribute with CSS if dark mode support is needed later.

#### I-2: `currentOutstanding` converted to JS number in response
**File**: `apps/api/src/modules/customers/customer-tier.service.ts` ~line 270

```ts
currentOutstanding: currentOutstanding.toDecimalPlaces(2).toNumber(),
```

This is correct — `.toDecimalPlaces(2)` ensures rounding before `.toNumber()`, so precision is preserved for display purposes. Using `Prisma.Decimal` through all internal computation and only converting to `number` at the serialization boundary is the right approach.

#### I-3: Tier filter bypasses soft-delete in count
**File**: `apps/api/src/modules/customers/customers.service.ts` ~line 473

```ts
const totalCustomers = await this.prisma.customer.count({ where: { deletedAt: null } });
```

The `total` correctly excludes soft-deleted customers. The enriched list is also built with `deletedAt: null`. This is correct.

---

## Summary Table

| # | Severity | File | Description |
|---|----------|------|-------------|
| W-1 | ⚠️ Warning | `customers.service.ts:459` | N+1 queries — 150 DB queries per page load |
| W-2 | ⚠️ Warning | `customers.service.ts:471` | Pagination `total` wrong when tier filter active |
| I-1 | ℹ️ Info | `CustomerTierBadge.tsx` | Non-token Tailwind color classes |
| I-2 | ℹ️ Info | `customer-tier.service.ts:270` | `toNumber()` at serialization boundary — correct |
| I-3 | ℹ️ Info | `customers.service.ts:473` | `deletedAt: null` correctly applied |

---

## Recommendation

**🟡 REVIEW** — no security blockers, but W-2 (pagination count) should be fixed before merge to avoid a broken UI when filtering by tier. W-1 (N+1 queries) is acceptable for phase 1 if shop size is confirmed small, but should be tracked as a follow-up ticket before the tier feature is used in production with larger datasets.

Quick fix for W-2:
```ts
const filteredTotal = tier ? filtered.length : total;
// ... but note: this only knows the count for the current page
// Correct fix: fetch total matching-tier count at DB level using a pre-computed column or a separate query
```

The simplest approach: if `tier` filter is active, use `filtered.length` as total and set `limit` to a large number to fetch all on one page — or document clearly that tier-filtered pagination is not supported in Phase 1.
