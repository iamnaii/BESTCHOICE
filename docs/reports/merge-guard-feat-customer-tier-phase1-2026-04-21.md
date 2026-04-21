# Merge Guard Report — feat/customer-tier-phase1

**Date**: 2026-04-21
**Branch**: `feat/customer-tier-phase1`
**Author**: Akenarin Kongdach
**Last commit**: 2026-04-20 — `test(customer): add E2E smoke for tier badge rendering`

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | +16 — add `CustomerCreditCheckStatus` enum, `CreditCheckType` enum, new fields on `Customer` and `CreditCheck` |
| `apps/api/prisma/migrations/20260529000000_add_customer_tier_status/migration.sql` | +11 (new) |
| `apps/api/src/modules/customers/customer-tier.service.ts` | +199 (new) |
| `apps/api/src/modules/customers/customer-tier.service.spec.ts` | +85 (new, 8 unit tests) |
| `apps/api/src/modules/customers/customers.controller.ts` | +11 — add `GET :id/tier` endpoint |
| `apps/api/src/modules/customers/customers.controller.spec.ts` | +24 — add tier endpoint test |
| `apps/api/src/modules/customers/customers.module.ts` | +5/-1 — register `CustomerTierService` |
| `apps/api/src/modules/customers/customers.service.ts` | +24/-3 — add tier computation to `findAll` |
| `apps/api/src/modules/customers/dto/tier.dto.ts` | +24 (new) |
| `apps/web/src/components/customer/CustomerTierBadge.tsx` | +45 (new) |
| `apps/web/src/components/customer/CustomerTierBadge.test.tsx` | +36 (new, 6 component tests) |
| `apps/web/src/pages/CustomersPage.tsx` | +32/-3 — tier column + filter |
| `apps/web/src/pages/CustomerDetailPage.tsx` | +14/-1 — tier badge in header |
| `apps/web/src/types/customer-tier.ts` | +32 (new) |
| `apps/web/e2e/customer-tier.spec.ts` | +31 (new E2E smoke) |

**17 files changed, 2021 insertions(+), 7 deletions(-)**
_(Note: ~1439 lines are in doc/plan markdown files, not production code)_

---

## Issues by Severity

### Critical
_None found._

### Warning

**W-1 · N+1 query pattern in `findAll` — tier computed per customer**
- File: `apps/api/src/modules/customers/customers.service.ts:146-158`
- `getCustomerTier()` is called in parallel for every customer returned by the page query (`Promise.all(enriched.map(...))`). Each `getCustomerTier` call issues at least 3 DB queries (customer existence check, `contract.findMany` with nested payments, `repossession.count`).
- For a default page of 50 customers, this is **50 × 3 = 150+ DB round-trips** per list load, on top of the 5 existing count queries.
- The code comment says `(in-memory — valid for small shops)` but for a shop with 200+ customers this will produce noticeable latency.
- **Recommendation**: Store computed tier in a `cachedTier` column on `Customer` (update via background job or on payment events), or compute tier from aggregated data already loaded in `findAll` rather than re-querying.

**W-2 · Tier filter applied in-memory after pagination — pagination counts are wrong when tier filter is active**
- File: `apps/api/src/modules/customers/customers.service.ts:157-168`
- `filtered = tier ? withTier.filter(...)` reduces the array after the DB page is fetched, but `total` (used for `paginatedResponse`) is the unfiltered DB count. The frontend will show an incorrect total (e.g., "showing 3 of 450") and the page count will be misleading.
- Also, filtering in-memory on a paginated result means tier filter only applies within the current page — a page with no GOLD customers will return 0 rows even if there are GOLD customers on page 2.
- **Recommendation**: Either store tier in the DB (allows proper SQL filtering + accurate counts) or document clearly that tier filter is approximate and limited to the current page.

**W-3 · `CustomerTierBadge` uses hardcoded Tailwind color utility `bg-amber-500/15`**
- File: `apps/web/src/components/customer/CustomerTierBadge.tsx:13`
- The project's frontend rules prohibit non-semantic color classes: `bg-gray-*`, `text-gray-*`, etc. `bg-amber-*` is similarly a hardcoded palette color without semantic meaning.
- `warning` and `success` semantic tokens are used for RISKY/GOOD, which is correct. GOLD should use a CSS variable like `--color-gold` or map to the warning token.
- **Recommendation**: Either define `--color-gold` in `index.css` or use `bg-warning/15 text-warning border-warning/30` (slightly wrong semantics but consistent) pending a proper token.

**W-4 · `CustomerTierService` is injected into `CustomersService` but also registered as a controller dependency — circular-risk if modules are restructured**
- File: `apps/api/src/modules/customers/customers.service.ts:8-14`
- `CustomersService` now depends on `CustomerTierService`, and `CustomersController` also directly injects `CustomerTierService`. Both share the same `CustomersModule`, so no circular module dependency exists today. However, if `CustomerTierService` is extracted to its own module in the future and imports `CustomersModule` for any reason, it would create a circular dependency.
- Not a bug now, but worth noting the coupling.

### Info

**I-1 · Missing `contract: { deletedAt: null }` filter on repossession count query**
- File: `apps/api/src/modules/customers/customer-tier.service.ts:208-212`
- ```typescript
  const repossessionCount = await this.prisma.repossession.count({
    where: { contract: { customerId }, deletedAt: null },
  });
  ```
- The nested `contract` relation filter only checks `customerId`, not `deletedAt: null` for the contract itself. Repossessions on soft-deleted contracts would still be counted toward `hasRepossession`.
- Low risk since contracts are soft-deleted only on deletion cascades which are restricted, but worth aligning with the codebase convention.

**I-2 · `CustomerCreditCheckStatus` enum and `creditCheckStatus` field on `Customer` are added in the migration but `customer-tier.service.ts` does not reference them**
- File: `apps/api/prisma/migrations/20260529000000_add_customer_tier_status/migration.sql`
- The migration adds `CustomerCreditCheckStatus` (NONE/PRE_CHECK_PASSED/FULL_CHECK_PASSED/REJECTED/UNDER_REVIEW) and `CreditCheckType` (PRE/FULL) — these appear to be Phase 1 schema prep for a credit-check redesign, not used by the tier service itself.
- This is intentional (schema-first approach) but reviewers should confirm these fields won't remain unused at merge time.

**I-3 · `CustomerTierResponse` type is duplicated between `apps/api/src/modules/customers/dto/tier.dto.ts` and `apps/web/src/types/customer-tier.ts`**
- Consider sharing via `packages/shared/` in a follow-up.

---

## Recommendation: **REVIEW**

The tier computation logic is clean and well-tested (8 unit tests with pure function). The API endpoint and frontend badge are correct. However, **W-1** (N+1 queries on every customer list load) and **W-2** (broken pagination when tier filter is active) should be addressed before merging to main, or explicitly accepted with a documented performance SLA for shop size.

Suggested minimal fix path:
1. Remove tier computation from `findAll` — serve `tier: null` in the list response.
2. Keep `GET /customers/:id/tier` for the detail page (already implemented).
3. Add a `cachedTier` DB column updated by a background job or on contract/payment events.
