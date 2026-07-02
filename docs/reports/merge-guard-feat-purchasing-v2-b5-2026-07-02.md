# Merge Guard Report — feat/purchasing-v2-b5

**Date:** 2026-07-02  
**Branch:** `feat/purchasing-v2-b5`  
**Author:** iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main:** 5  
**Commits behind main:** 43

---

## File Changes Summary (unique to B5)

### Backend
| File | Change |
|------|--------|
| `apps/api/src/modules/purchase-orders/services/po-query.service.ts` | `getSummary()` new method; `getQCPending()` extended with `poId` + `includePhotoPending` flags |
| `apps/api/src/modules/purchase-orders/purchase-orders.summary.spec.ts` | +41 spec lines |

### Frontend
| File | Change |
|------|--------|
| `apps/web/src/pages/PurchaseOrdersPage/summaryStrip.ts` | New: card config + filter-action type map |
| `apps/web/src/pages/PurchaseOrdersPage/components/PurchasingSummaryStrip.tsx` | New: 7-card animated KPI strip |
| `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` | Summary query + `overdueOnly` filter state |
| `apps/web/src/pages/PurchaseOrdersPage/components/POListTab.tsx` | Wire `overdueOnly` prop + filter chip |
| `apps/web/src/pages/PurchaseOrdersPage/index.tsx` | Wire summary strip + `onSummaryCardClick` handler |
| `apps/web/src/pages/PurchaseOrdersPage/components/AccountsPayableTab.tsx` | AP tab polish: progress bar, due-soon hint, row deep-link |

**5 unique commits, ~357 lines added**

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**I1 — `Number()` conversions in `AccountsPayableTab.tsx` are display-only, not financial math**

```tsx
// Display: show Decimal amounts as formatted locale string
(Number(entry.totalPaid) || 0).toLocaleString()

// Display: CSS progress bar width %
style={{ width: `${Math.min((Number(entry.totalPaid) / Number(entry.totalNet)) * 100, 100)}%` }}
```

These conversions are acceptable: the backend returns pre-computed Decimal values (summed via `dAdd` in `po-query.service.ts` using Prisma.Decimal), and the frontend converts them only for display rendering and a CSS `width` percentage. No financial calculation is performed in the frontend. The pattern matches existing usage in `AccountsPayableTab` (B0).

**I2 — Branch is 43 commits behind main**

Will need a rebase before merge. Risk is moderate given the 5 commits touch shared files (`usePurchaseOrdersData.ts`, `index.tsx`), but the scope is isolated to the purchasing page. No architectural conflicts expected.

**I3 — `onSummaryCardClick` navigates to `/purchase-orders/qc` for waitingQc card**

```tsx
if ('panel' in action) {
  navigate('/purchase-orders/qc');
  return;
}
```

This route path should be verified to exist in the router config. The B4 branch added `QcCenterPage` — confirm that branch's route is registered before this is merged.

---

## Security Checklist

- [x] `GET /purchase-orders/summary` endpoint protected: `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` + `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')`
- [x] `deletedAt: null` present in all new queries in `getSummary()` and extended `getQCPending()`
- [x] No hardcoded secrets or API keys
- [x] Frontend uses `api.get('/purchase-orders/summary')` — not raw `fetch()`
- [x] `queryClient.invalidateQueries(['purchase-orders-summary'])` called after all 7 mutations (create, approve, order, reject, cancel, receive, direct-receive, payment)
- [x] No unparameterized `$queryRaw` (all queries use Prisma ORM)
- [x] No `Number()` on stored financial values (display-only conversion confirmed)
- [x] New DTO `ApproveDraftDto` has proper `class-validator` decorators (`@IsUUID`, `@IsOptional`, `@IsString`)

---

## Recommendation

**✅ APPROVE** (after rebase onto main + confirm `/purchase-orders/qc` route exists from B4)

The feature is well-scoped: summary strip follows the existing `DashboardKPIs` pattern, security is correctly applied on the new endpoint, and cache invalidation is thorough across all mutations. No financial logic in the frontend. The only gate is the rebase to resolve the 43-commit lag.
