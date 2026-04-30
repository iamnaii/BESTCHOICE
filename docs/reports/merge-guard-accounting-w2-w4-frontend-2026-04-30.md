# Merge Guard Report — fix/accounting-w2-w4-frontend

**Date**: 2026-04-30
**Branch**: `fix/accounting-w2-w4-frontend`
**Author**: Akenarin Kongdach \<iamnaii@MacBook-Pro-khxng-Akenarin.local\>
**Commits**: 1 (`feat(accounting): W-2 + W-4 + frontend settlement page`)

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `prisma/seeds/chart-of-accounts-finance.ts` | +1 | Adds 53-1805 (Sales Discount on Interest) to FINANCE chart |
| `prisma/seeds/chart-of-accounts.ts` | +7 | Adds 53-1801 (Sales Discount on Commission) to SHOP chart |
| `modules/journal/journal-auto.service.ts` | +99 / -37 | W-2: pg_advisory_xact_lock; W-4: explicit discount expense on early payoff |
| `modules/receipts/receipts.service.ts` | +16 / -7 | W-2: pg_advisory_xact_lock for receipt number generation |
| `apps/web/src/App.tsx` | +9 | Adds `/accounting/intercompany` route |
| `apps/web/src/config/menu.ts` | +2 | Adds menu item (ACCOUNTANT + OWNER configs) |
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | +287 | New page — balance display + settlement dialog |
| `journal-auto.service.spec.ts` | +21 / -1 | Updated W-4 early-payoff test cases |

---

## Issues by Severity

### Critical — None

Security controls on new frontend route and existing backend controller verified:
- `/accounting/intercompany` route wrapped in `<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>` ✓ (matches controller's `@Roles`)
- Frontend uses `api.get()` / `api.post()` (not raw `fetch`) ✓
- `queryClient.invalidateQueries()` called on both `intercompany-balance` and `intercompany-history` after settlement ✓
- No hardcoded secrets ✓

### Warning

**W1 — W-4: Legacy-fallback HP Receivable drain differs from non-legacy path**
- **File**: `modules/journal/journal-auto.service.ts:219-231` (isLegacyFallback branch)
- In the legacy-fallback case (`sumOtherOrig.isZero() && interestActual.gt(0)`), HP Receivable is credited by `sumRemainingDue` (amountDue − amountPaidBefore summed across installments). In the normal path, it's credited by `sumOwedExclLateFee` (= `sumPrincipal + sumOtherOrig`). When breakdown is truly zero, both paths compute the same value, but the logic is derived differently. A future change to one path could silently diverge from the other.
- **Fix**: Add an assertion: `if (isLegacyFallback) expect(sumRemainingDue ≈ cashExclLateFee)` or unify the HP drain variable.

**W2 — Settlement history filtered client-side via description string match**
- **File**: `apps/web/src/pages/IntercompanySettlementPage.tsx:462-464`
- ```ts
  const settlementHistory = (historyQ.data?.data ?? []).filter(
    (e) => e.description?.includes('IC-') && e.description?.includes('ชำระเงินระหว่างบริษัท'),
  );
  ```
  This relies on the Thai string and IC-prefix being stable across future description format changes. The history API also fetches all `IC_SETTLEMENT` journal entries (limit 50), then filters to show only the SHOP-side visible ones, potentially missing FINANCE-side entries with the same amount.
- **Fix**: Add a dedicated `GET /accounting/intercompany/history` endpoint that returns IC settlement JEs directly from `referenceType = 'IC_SETTLEMENT'`, avoiding fragile string matching.

**W3 — W-2 advisory lock key for journal entries is raw YYYYMM integer**
- **File**: `modules/journal/journal-auto.service.ts:124-126`
- `SELECT pg_advisory_xact_lock(${lockKey}::bigint)` where `lockKey = parseInt('202604', 10)` = 202604. This key is a small integer and won't collide with receipt numbers (which use `1YYYYMM` prefix per comment). However, any other code that happens to use the same integer lock key (e.g. a cron job using the same month) would deadlock. The namespace is implicit (comment-only).
- **Fix**: Use a stable named offset constant, e.g. `const JOURNAL_LOCK_OFFSET = 1_000_000n` and key = `JOURNAL_LOCK_OFFSET + BigInt(ym)`. Ensures clear separation from other advisory locks.

### Info

**I1 — W-4 discount treatment needs CPA sign-off note in code**
- **File**: `modules/journal/journal-auto.service.ts:172-194`
- Phase W-4 changes early-payoff from implicit discount (asymmetric Unearned drain) to explicit P&L discount expense (`Dr. 53-1805 Sales Discount Interest`). This is a material accounting policy change — interest income is now credited at full Unearned amount, not discounted-actual. The PR description is clear, but the service code should reference the CPA approval date/ticket number (or the same `/// CR-001`-style tag) so auditors can trace it.

**I2 — `IntercompanySettlementPage.tsx` is 287 lines — approaching large-file threshold**
- Under the 500-line guideline but would benefit from extracting `SettlementDialog` into a separate component if the page grows with history filtering controls.

---

## Recommendation: **APPROVE**

No critical issues. W-2 (pg_advisory_xact_lock) correctly fixes the first-JE-of-month race condition that SELECT FOR UPDATE could not solve. W-4 discount expense visibility is a legitimate accounting improvement (explicit rather than hidden). The `IntercompanySettlementPage` follows all frontend conventions: lazy import, ProtectedRoute, `api.*`, `useQuery`/`useMutation`, toast notifications, design tokens, and Thai UI text. Address W2 (history endpoint) as a follow-up before the page goes to production use — the string-match filter is fragile.
