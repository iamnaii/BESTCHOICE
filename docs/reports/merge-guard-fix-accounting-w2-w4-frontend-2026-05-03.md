# Merge Guard Report — `fix/accounting-w2-w4-frontend`

**Date**: 2026-05-03  
**Branch**: `fix/accounting-w2-w4-frontend`  
**Authors**: iamnaii, Akenarin Kongdach  
**Recommendation**: ⚠️ REVIEW

---

## Summary

Phase W-2 (pg_advisory_xact_lock for race-safe sequence generation) + Phase W-4 (explicit discount expense JE for early payoff) + new `IntercompanySettlementPage` frontend page wired to `/accounting/intercompany`.

**Note**: This branch is the base layer of a stacked PR chain. Merge order: **W-2/W-4 → A.3 → A.2**.

---

## File Changes (8 files, +405 / -37)

| File | Type | Change |
|---|---|---|
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | Backend | +1 new account `53-1805` (Sales Discount on Interest) |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | Backend | +7 lines — new account `53-1801` (Sales Discount on Commission) for SHOP |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | Tests | +/−21 lines — revised W-4 test expectations |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Backend | +99 / -37 — W-2 advisory lock + W-4 discount JE logic |
| `apps/api/src/modules/receipts/receipts.service.ts` | Backend | +16 / -6 — W-2 advisory lock for receipt numbers |
| `apps/web/src/App.tsx` | Frontend | +9 — new route `/accounting/intercompany` |
| `apps/web/src/config/menu.ts` | Frontend | +2 — menu item for ACCOUNTANT + OWNER |
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | Frontend | +287 new page |

---

## Issues

### ⚠️ Warning

**W-1. Legacy fallback mutates `financeLines` array elements in-place** (`journal-auto.service.ts` ~line 668)

```ts
const hpLine = financeLines.find((l) => l.accountCode === FA.HP_RECEIVABLE)!;
hpLine.credit = sumRemainingDue.toNumber();  // direct mutation
const interestLine = financeLines.find((l) => l.accountCode === FA.INTEREST_INCOME)!;
interestLine.credit = 0;
```

The `isLegacyFallback` branch finds elements in the already-constructed `financeLines` array and mutates them directly. If `find()` returns undefined (e.g., wrong account code) it throws a runtime error — the `!` non-null assertion silences TypeScript without a guard. The tests cover this path, but the mutation style is fragile. Prefer rebuilding the array for the fallback path instead of patching it.

**W-2. History filter is coupled to description strings** (`IntercompanySettlementPage.tsx:135`)

```ts
const settlementHistory = (historyQ.data?.data ?? []).filter(
  (e) => e.description?.includes('IC-') && e.description?.includes('ชำระเงินระหว่างบริษัท'),
);
```

This filters settlement history using text matching on the JE description. If the description format changes (Thai wording, IC prefix format), the filter silently returns zero results. The API already has `referenceType: 'IC_SETTLEMENT'` — prefer a dedicated backend endpoint that filters on `referenceType` instead.

### ℹ️ Info

**I-1. FINANCE_MANAGER omitted from menu config**

`menu.ts` adds the intercompany link to `ACCOUNTANT_CONFIG` and `OWNER_CONFIG` but not `FINANCE_MANAGER_CONFIG`. The `App.tsx` `ProtectedRoute` correctly includes `FINANCE_MANAGER` in the allowed roles, so the page is accessible — it just won't appear in their sidebar menu.

**I-2. `pg_advisory_xact_lock` lock key namespacing**

Journal entries use `parseInt(ym)` (6-digit key, e.g. `202605`) and receipts use `parseInt('1' + ym)` (7-digit, e.g. `1202605`) to separate their lock spaces. Both are well within PostgreSQL's bigint range. The approach is correct, but the separate namespacing scheme is implicit — consider a named constant or comment making the separation explicit.

---

## Security Checklist

| Check | Result |
|---|---|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | N/A — no new controllers in this branch |
| New DTO fields have class-validator decorators | N/A — no new DTOs |
| No raw `$queryRaw` with unparameterized input | ✅ — advisory lock uses tagged template literals (parameterized) |
| No hardcoded secrets / API keys | ✅ |
| Frontend uses `api.get()` / `api.post()` | ✅ |
| `useQuery` / `useMutation` only | ✅ |
| `queryClient.invalidateQueries()` after mutations | ✅ |
| Semantic CSS design tokens (no hardcoded hex / `bg-gray-*`) | ✅ |
| `ProtectedRoute` with explicit roles | ✅ |
| `QueryBoundary` on data-fetching sections | ✅ |

---

## Recommendation

**⚠️ REVIEW** — No critical blockers. Address Warning W-1 (legacy fallback array mutation) before merge; W-2 (description filter) is acceptable short-term but should be tracked for follow-up. Info items are non-blocking.
