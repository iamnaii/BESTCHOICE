# Merge Guard Report — feat/customer-tier-phase1

**Date**: 2026-04-21  
**Branch**: `feat/customer-tier-phase1`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Recommendation**: ⚠️ REVIEW — fix Warnings before merge

---

## File Changes Summary

| File | Type | Lines |
|------|------|-------|
| `apps/api/src/modules/customers/customer-tier.service.ts` | New | +199 |
| `apps/api/src/modules/customers/customer-tier.service.spec.ts` | New | +85 |
| `apps/api/src/modules/customers/dto/tier.dto.ts` | New | +24 |
| `apps/api/src/modules/customers/customers.controller.ts` | Modified | +12 |
| `apps/api/src/modules/customers/customers.service.ts` | Modified | +21 |
| `apps/api/src/modules/customers/customers.module.ts` | Modified | +3 |
| `apps/web/src/components/customer/CustomerTierBadge.tsx` | New | +45 |
| `apps/web/src/components/customer/CustomerTierBadge.test.tsx` | New | +36 |
| `apps/web/src/pages/CustomerDetailPage.tsx` | Modified | +12 |
| `apps/web/src/pages/CustomersPage.tsx` | Modified | +32 |
| `apps/web/src/types/customer-tier.ts` | New | +32 |
| `apps/web/e2e/customer-tier.spec.ts` | New | +31 |

**Total**: 17 files, +2,021 insertions, -7 deletions

---

## Issues

### Critical

_No Critical issues found._

---

### Warning

**W-001 · N+1 Query — `customers.service.ts:459`**  
`findAll()` calls `this.tierService.getCustomerTier(c.id)` for every customer on the page via `Promise.all`. With a default page size of 50, this runs up to 50 parallel DB queries per list request. Each `getCustomerTier()` call itself executes 2 queries (customer lookup + contracts fetch) plus a repossession count. Under load, this is 150 concurrent DB round-trips per page view.

```ts
// apps/api/src/modules/customers/customers.service.ts
const withTier = await Promise.all(
  enriched.map(async (c) => {
    try {
      const t = await this.tierService.getCustomerTier(c.id);  // ← N+1
```

**Suggested fix**: batch-compute tiers in a single query using the contracts already loaded in `enriched`, or add a `tier` column to the `Customer` model and update it via a background job.

---

**W-002 · Pagination total wrong when tier filter active — `customers.service.ts:473`**  
The in-memory tier filter is applied to the enriched page, but `total` is still computed as `count({ where: { deletedAt: null } })` — all customers, not just tier-filtered ones. Pagination UI will show the wrong record count when a tier filter is selected.

```ts
// apps/api/src/modules/customers/customers.service.ts
const filtered = tier ? withTier.filter((c) => c.tier === tier) : withTier;

const totalCustomers = await this.prisma.customer.count({ where: { deletedAt: null } });
// ↑ total ignores tier filter — paginatedResponse(filtered, total, page, limit) is misleading
```

---

**W-003 · Hardcoded Tailwind color utility in `CustomerTierBadge.tsx:612`**  
GOLD tier uses `bg-amber-500/15 text-amber-600` — hardcoded Tailwind color classes that bypass the design token system. The frontend rule explicitly forbids this.

```tsx
// apps/web/src/components/customer/CustomerTierBadge.tsx
GOLD: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
```

Use CSS variable tokens instead (e.g., `bg-warning/10 text-warning` for the closest semantic equivalent, or define a `--color-gold` CSS variable in `index.css`).

---

### Info

**I-001 · Duplicated type definitions**  
`CustomerTier`, `TierReason`, and `CustomerTierResponse` are defined identically in both `apps/api/src/modules/customers/dto/tier.dto.ts` and `apps/web/src/types/customer-tier.ts`. Consider moving to `packages/shared/` to keep a single source of truth.

**I-002 · Test tightly coupled to implementation detail**  
`CustomerTierBadge.test.tsx` asserts `el.className` contains `'amber'` — a brittle test that breaks if the design token for GOLD changes. Prefer `screen.getByRole('status')` or a `data-tier="GOLD"` attribute assertion.

---

## Verdict

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 3 |
| Info | 2 |

**⚠️ REVIEW** — The feature logic and security posture are correct. W-001 (N+1 queries) and W-002 (broken pagination total) are functional bugs that will cause noticeable UX problems in any shop with more than a few customers. Both should be fixed before merge. W-003 (design token violation) should also be corrected.
