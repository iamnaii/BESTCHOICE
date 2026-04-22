# Merge Guard Report — feat/customer-tier-phase1

**Date**: 2026-04-22  
**Branch**: `feat/customer-tier-phase1`  
**Base**: `origin/main`  
**Commits unique to branch**: 10 (025c548a…ca54434d)  
**Files changed**: 17 files (+2,021 lines)  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| API — service | `customer-tier.service.ts` (+199) | Pure tier computation + DB fetch |
| API — controller | `customers.controller.ts` (+11) | New `GET /:id/tier` endpoint |
| API — service | `customers.service.ts` (+24) | Tier computation added to `findAll` |
| API — DTO | `dto/tier.dto.ts` (+24) | Response shape types (interfaces, no class-validator) |
| Frontend | `CustomerTierBadge.tsx` (+45), `CustomerDetailPage.tsx`, `CustomersPage.tsx` | Badge + tier column + filter UI |
| Migration | `20260529000000_add_customer_tier_status` | Adds `CustomerCreditCheckStatus` enum + `credit_check_status` col, `CreditCheckType` enum + `check_type` col |
| E2E | `customer-tier.spec.ts` (+31) | Smoke test |
| Tests | `customer-tier.service.spec.ts` (+85), `customers.controller.spec.ts` (+24) | Unit tests |
| Docs | `plans/2026-04-20-customer-tier-phase1.md` (1132 lines) | Implementation plan (not production code) |

---

## Issues by Severity

### CRITICAL — None found

No missing guards, no `Number()` on stored money fields, no missing `deletedAt: null`, no hard-coded secrets. The new `/customers/:id/tier` endpoint correctly uses the existing `JwtAuthGuard` + `RolesGuard` from the controller class, and the `@Roles()` decorator is present.

---

### WARNING — Should fix

#### W-1: N+1 query pattern in `findAll` — up to 100+ DB queries per page request

`customers.service.ts` now runs `tierService.getCustomerTier(c.id)` for **every customer on the page** via `Promise.all`. Each `getCustomerTier` call issues at minimum 2 queries (contracts + repossession count), plus iterates all payments in memory.

For a default page of 50 customers, this is **≥100 sequential-ish DB round-trips** on every list request (including the dashboard summary).

```ts
// customers.service.ts ~141 — WARNING: N+1
const withTier = await Promise.all(
  enriched.map(async (c) => {
    const t = await this.tierService.getCustomerTier(c.id);  // 2+ queries each
    return { ...c, tier: t.tier };
  }),
);
```

The code comment acknowledges this (`// in-memory — valid for small shops`), but there is no guard or feature flag to prevent this from running on larger datasets as the customer base grows.

**Recommended fix (short-term)**: Add a cached/stored `tier` field on the `Customer` model, populated by a background job, so `findAll` can filter directly in SQL. Alternatively, skip tier computation in the list view and only compute on the detail page.

#### W-2: Tier filter applied post-pagination — pagination counts are wrong

The tier filter is applied **after** fetching a page of customers from the DB, but `total` reflects the full unfiltered count:

```ts
// customers.service.ts ~155
const filtered = tier ? withTier.filter((c) => c.tier === tier) : withTier;
const totalCustomers = await this.prisma.customer.count({ where: { deletedAt: null } }); // unfiltered total
return { ...paginatedResponse(filtered, total, page, limit), summary };
// ^ filtered items (may be < limit) but wrong total → broken pagination
```

When filtering by tier, the returned page may have fewer than `limit` items AND the `total` field is wrong — the frontend pagination UI will calculate wrong page counts.

**Fix**: Either store tier in DB (enables correct SQL-level filtering with accurate counts), or make clear in the API that tier filtering is client-side and disable server-side pagination when a tier filter is active.

#### W-3: `currentOutstanding` precision loss in service response

`CustomerTierService` correctly accumulates `currentOutstanding` as `Prisma.Decimal`, but then converts it to `number` when building the response:

```ts
currentOutstanding: currentOutstanding.toDecimalPlaces(2).toNumber(), // float in response DTO
```

The `tier.dto.ts` `CustomerTierResponse.history.currentOutstanding` is typed `number`. For display-only purposes this is acceptable (the value is never written back to DB), but the response type loses the precision guarantee. Consider typing it as `string` (serialised Decimal) or keeping a note in the DTO.

---

### INFO

#### I-1: Migration timestamp is future-dated

`20260529000000_add_customer_tier_status` — the timestamp `20260529` (2026-05-29) is ~5 weeks in the future. This will cause ordering issues if any other migration is created between now and that date.

**Fix**: Rename to use today's date: `20260422000000_add_customer_tier_status`.

#### I-2: `tier.dto.ts` uses TypeScript interfaces, not class-validator

The DTO file contains only `interface` and `type` declarations. This is fine for response shapes (no need to validate outbound data), but means the `@Query('tier') tier?: string` parameter in the controller has no validation — any string is accepted as a tier filter value, including invalid ones.

**Fix (optional)**: Add a `@IsIn(['GOLD','GOOD','NEW','RISKY','BLACKLIST'])` decorator on the query parameter.

---

## Recommendation: **REVIEW**

No critical security or data integrity issues. The core tier computation logic is clean, well-tested, and uses `Prisma.Decimal` correctly.

The two warnings (W-1, W-2) represent a correctness and performance concern that is explicitly acknowledged in the code as a known limitation for small shops. Before merge, the team should confirm:

1. The N+1 query load is acceptable at current customer counts (and a plan exists to add a stored `tier` field when scale requires it).
2. The broken pagination count on tier-filtered views is acceptable (or the UI hides the total count when a tier filter is active).
3. Migration timestamp should be corrected (I-1) before merge to avoid future migration ordering conflicts.
