# Merge Guard Report — feat/customer-tier-phase1

**Date**: 2026-04-21  
**Branch**: `feat/customer-tier-phase1`  
**Author**: Akenarin Kongdach  
**Recommendation**: ⚠️ REVIEW — fix warnings before merge

---

## File Changes Summary

17 files changed, 2021 insertions, 7 deletions

| Area | Files |
|------|-------|
| API — new service | `customers/customer-tier.service.ts` (199 lines) |
| API — new spec | `customers/customer-tier.service.spec.ts` (85 lines) |
| API — modified | `customers.controller.ts`, `customers.service.ts`, `customers.module.ts` |
| API — new DTO | `customers/dto/tier.dto.ts` |
| Web — new component | `components/customer/CustomerTierBadge.tsx` + test |
| Web — modified | `pages/CustomerDetailPage.tsx`, `pages/CustomersPage.tsx` |
| Web — new types | `types/customer-tier.ts` |
| Docs | Plans/design docs (1132-line plan file) |
| DB | Prisma schema + migration (new `customerTier` field) |

---

## Issues

### ⚠️ Warning — N+1 Query in `customers.service.ts` findAll

**File**: `apps/api/src/modules/customers/customers.service.ts` ~L141–160

```ts
const withTier = await Promise.all(
  enriched.map(async (c) => {
    try {
      const t = await this.tierService.getCustomerTier(c.id);
```

`getCustomerTier` runs multiple DB queries per customer (contracts, payments, repossession count). For a default page of 50 customers this becomes 100–150+ sequential-parallel DB queries per request. This will degrade under load.

**Fix**: Batch the contract/payment/repossession aggregation into a single query or add a computed/cached `tier` field on the `Customer` model that is updated by a cron or on payment events.

---

### ⚠️ Warning — Pagination Total Mismatch When Tier Filter Is Active

**File**: `apps/api/src/modules/customers/customers.service.ts` ~L164–168

```ts
const filtered = tier ? withTier.filter((c) => c.tier === tier) : withTier;
// ...
return { ...paginatedResponse(filtered, total, page, limit), summary };
```

`total` is the pre-filter count from the DB (`customer.count({ where: { deletedAt: null } })`). After filtering by tier in-memory, `filtered.length < total`, but the response still reports the unfiltered `total`. The frontend will calculate incorrect page counts.

**Fix**: When `tier` filter is applied, replace `total` with `filtered.length` (or implement server-side filtering in the DB query once tier is persisted).

---

### ⚠️ Warning — `.toNumber()` on Decimal Money Field

**File**: `apps/api/src/modules/customers/customer-tier.service.ts` ~L190, L196

```ts
currentOutstanding: currentOutstanding.toDecimalPlaces(2).toNumber(),
```

Project rules require `Prisma.Decimal` for all money values. Converting to `number` for the response DTO is display-only here, but it violates the convention and can silently lose precision for large outstanding balances. Consider keeping it as a string representation (`toFixed(2)`) or serialising as `Prisma.Decimal` until the DTO boundary.

---

### ℹ️ Info — GOLD Tier Badge Uses Tailwind Named Colors

**File**: `apps/web/src/components/customer/CustomerTierBadge.tsx` L12

```ts
GOLD: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
```

Other tiers use CSS variable tokens (`text-success`, `text-destructive`, `bg-muted`). GOLD uses hardcoded Tailwind amber scale. While not a hex literal, this bypasses the design token system and will not respect theme overrides. Consider defining `--color-gold` as a CSS variable in `index.css` and using `text-[var(--color-gold)]`.

---

### ℹ️ Info — Large Plan Document Committed to Source

**File**: `plans/2026-04-20-customer-tier-phase1.md` (1132 lines)

Planning documents committed to the feature branch will persist in git history after merge. Not a blocker, but consider keeping design docs in `docs/specs/` or removing before merge to keep the diff clean.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard)` on new endpoints | ✅ Inherited from `CustomersController` class-level guard |
| `@Roles()` on new `GET :id/tier` endpoint | ✅ Present — all non-OWNER roles included |
| `deletedAt: null` in new queries | ✅ `customer-tier.service.ts` filters correctly |
| `Number()` on stored financial fields | ✅ Decimal arithmetic uses `Prisma.Decimal`, conversion only at DTO boundary |
| Hardcoded secrets / API keys | ✅ None found |
| Unparameterized `$queryRaw` | ✅ None |

---

## Recommendation

**⚠️ REVIEW** — not blocked, but the N+1 query and pagination total bug are functional correctness issues that will show up in production. Fix before merge.

1. Batch tier aggregation queries in `getCustomerTier` (or cache tier on the Customer record)
2. Use `filtered.length` as the total when a tier filter is active
3. Return `currentOutstanding` as a string or keep as `Prisma.Decimal`
