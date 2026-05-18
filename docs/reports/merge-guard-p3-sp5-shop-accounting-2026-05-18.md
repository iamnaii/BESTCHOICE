# Merge Guard Report — feat/p3-sp5-shop-accounting
**Date**: 2026-05-18  
**Branch**: `feat/p3-sp5-shop-accounting`  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Category | Files | Lines |
|----------|-------|-------|
| New API services / templates | 8 | +1,473 |
| New test specs | 9 | +1,254 |
| Modified accounting service + controller | 2 | +461 |
| New frontend page + routing + menu | 3 | +447 |
| Prisma migration + seeders | 3 | +111 |
| CLI / docs / misc | 5 | +230 |
| Deletions | — | -28 |
| **Total** | **37** | **+4,234 / -28** |

### New files of note
- `apps/api/src/modules/journal/company-resolver.service.ts` — single source of truth for `companyCode → companyId`
- `apps/api/src/modules/journal/paired-journal.service.ts` — atomic dual-entity JE posting
- `apps/api/src/modules/journal/cpa-templates/shop-*.template.ts` (6 templates)
- `apps/web/src/pages/ShopAccountingPage.tsx` — SHOP Trial Balance + P&L frontend

---

## Issues Found

### Critical
_None._

---

### Warning

#### W-001 — `ProtectedRoute` at `/shop/accounting` incorrectly includes `BRANCH_MANAGER`
**File**: `apps/web/src/App.tsx:748`  
**Severity**: Warning

```tsx
<ProtectedRoute
  roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}
>
  <ShopAccountingPage />
</ProtectedRoute>
```

The API endpoints (`GET /expenses/ledger/shop/trial-balance` and `GET /expenses/ledger/shop/profit-loss`) are decorated with `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` — `BRANCH_MANAGER` is intentionally excluded per documented **W5 policy** (cross-branch aggregate; BM is not in `CROSS_BRANCH_ROLES`).

The menu configs (`BRANCH_MANAGER_CONFIG` in `menu.ts`) correctly have no entry for this route, and a comment explicitly notes "BM excluded per W5". The `ProtectedRoute` guard is the only place `BRANCH_MANAGER` appears.

**Impact**: A BRANCH_MANAGER who navigates to `/shop/accounting` directly will pass the frontend route guard and reach the page, but both API calls will 403. The page will render in a permanent error state via `QueryBoundary`. This is a UX bug, not a security breach (the API is still protected).

**Fix**:
```tsx
// App.tsx ~line 746
<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
  <ShopAccountingPage />
</ProtectedRoute>
```

---

### Info

#### I-001 — `Number()` for sign check on Decimal in `ShopAccountingPage.tsx`
**File**: `apps/web/src/pages/ShopAccountingPage.tsx:336`

```tsx
Number(query.data.netIncome) >= 0 ? 'text-success' : 'text-destructive'
```

`netIncome` arrives from the API as a JSON number or string (Prisma Decimal serialised). `Number()` is used only for a sign comparison to choose a CSS class — not for financial arithmetic. This is technically acceptable. For consistency with the codebase convention, consider:
```tsx
parseFloat(String(query.data.netIncome)) >= 0 ? ...
```
or keeping it as-is. Not a bug.

#### I-002 — `Number(query.data.netIncome)` same pattern
Same as I-001. The `fmtMoney()` helper used for actual display correctly uses `parseFloat` with an `isNaN` guard. No financial miscalculation risk here.

#### I-003 — `ShopAccountingPage.tsx` is 410 lines
Above the 500-line soft limit it is fine, but the Trial Balance table rendering (lines 200–300) and P&L rendering (300–400) are similar enough that a shared `<SectionTable>` component could reduce this in a follow-up.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ Accounting controller already guarded at class level; new methods all have `@Roles()` |
| No `Number()` on financial calculations (backend) | ✅ All Decimal arithmetic uses `Prisma.Decimal` throughout templates + service |
| `deletedAt: null` in all new queries | ✅ Found in company-resolver, accounting service, all templates |
| No hardcoded secrets or API keys | ✅ |
| No unparameterized `$queryRaw` | ✅ |
| Frontend uses `api.get()` not raw `fetch()` | ✅ `ShopAccountingPage` imports `api` from `@/lib/api` |
| New page is lazy-loaded | ✅ `lazy(() => import('@/pages/ShopAccountingPage'))` |
| `queryClient.invalidateQueries()` after mutations | ✅ (read-only page — no mutations) |
| Design tokens used (no hardcoded grays/whites) | ✅ Uses `bg-muted`, `text-foreground`, `text-muted-foreground`, semantic classes only |
| Thai text uses `leading-snug` | ✅ Found at line 333 |

---

## Architecture Notes (positive)

- **`CompanyResolverService`** correctly injects as singleton — eliminates the stale-id bug that per-instance caching would cause across test seed cycles (W3 fix applied).
- **`PairedJournalService`** balance-checks both halves up front before posting either — correct fail-fast pattern.
- **`ShopInventoryTransferTemplate`** asserts `financedAmount + downAmount === salePrice` invariant with `BadRequestException` — prevents silent unbalanced JEs.
- **Idempotency** via `metadata.flow + metadata.idempotencyKey` on all 6 SHOP templates — consistent with existing FINANCE templates.
- **Test coverage**: 9 spec files covering all 6 templates, `PairedJournalService`, multi-scope accounting, and `ShopAccountingPage` React component.

---

## Recommendation: ⚠️ REVIEW

**Block reason**: One warning (W-001) — `BRANCH_MANAGER` in `ProtectedRoute` contradicts the documented W5 policy and creates a confusing error-state UX for BM users who access the URL directly.

**Fix is trivial** (remove `'BRANCH_MANAGER'` from `roles` array in `App.tsx`). Once fixed, no other blockers remain.

All backend templates, services, and accounting logic are clean. Security posture is solid.

### Action required before merge
1. Remove `'BRANCH_MANAGER'` from `ProtectedRoute` roles at `apps/web/src/App.tsx:748`.

### Optional (non-blocking)
2. Remove debug comments `// hotfix 2026-05-18` / `// hotfix trigger 2` from `customer-pii.module.ts` (from the PDPA hotfix branch, not this one).
