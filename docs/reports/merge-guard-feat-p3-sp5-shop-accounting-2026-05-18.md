# Merge Guard Report — feat/p3-sp5-shop-accounting

**Date**: 2026-05-18  
**Branch**: `feat/p3-sp5-shop-accounting`  
**Author**: Akenarin Kongdach  
**Commits**: 9 (incl. multiple fix passes)  
**Files changed**: 37 (+4,234 / -28)  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| Backend | `accounting.service.ts`, `accounting.controller.ts` | SHOP scope on TB/PL + new SHOP endpoints |
| Backend | `paired-journal.service.ts` | Paired SHOP+FINANCE journal posting |
| Backend | 7 SHOP JE template files | `shop-cash-sale`, `shop-down-payment`, `shop-expense`, etc. |
| Backend | `monthly-close.service.ts` | SHOP-scope compat |
| Backend | `company-resolver.service.ts` | SHOP CoA resolver |
| DB | Migration `20260948` + `seed-coa-shop.ts` | SHOP chart (~50 accounts) + idempotency index |
| Frontend | `ShopAccountingPage.tsx`, `App.tsx`, `config/menu.ts` | New `/shop/accounting` page |
| Tests | 7 template specs + `paired-journal.service.spec.ts` + `accounting-multi-scope.spec.ts` | 8 spec files |

---

## Critical Issues

None found.

**Guards**: New endpoints `GET /expenses/ledger/shop/trial-balance` and `GET /expenses/ledger/shop/profit-loss` sit inside `AccountingController` which has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level. Both new endpoints have `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')`. ✅

**Soft delete**: No new queries without `deletedAt: null`. ✅

**SQL injection**: No raw `$queryRaw` in new code. ✅

**Secrets**: None hardcoded. ✅

---

## Warning Issues

### W1 — `.toNumber()` serialization at API boundary (reporting endpoints)
**File**: `apps/api/src/modules/accounting/accounting.service.ts` lines ~229–350  
**Pattern**: `Prisma.Decimal` used for all intermediate arithmetic; `.toNumber()` applied only in the final `return { ... }` object for JSON serialization.

This is the correct pattern for read-only reporting (JSON lacks a Decimal type). However, the rule from `accounting.md` is "Decimal precision: 53 `Number()` → `Prisma.Decimal`" — v4 hardening eliminated `Number()` on intermediate calculations, not response serialization. This pattern is consistent with how the existing FINANCE TB/PL methods work in the same file (line 827: `yearPL.netIncome.toNumber()` — pre-existing).

**Risk**: Floating-point error can appear in the serialized JSON for very large amounts. For display-only reporting endpoints this is acceptable, but keep it out of any persistence path. Confirm no `.toNumber()` result is ever passed back to a Prisma write.

**Action**: Confirm in code review; no immediate change required, but consider returning `string` (via `.toString()`) for amounts >1M THB in a future hardening pass.

### W2 — `Number(query.data.netIncome) >= 0` in `ShopAccountingPage.tsx`
**File**: `apps/web/src/pages/ShopAccountingPage.tsx:336`  
The API already returns a JS number (see W1 — `.toNumber()` in service), so `Number()` here is a no-op and not wrong. However the pattern is unnecessary and could mislead a future reader into thinking the API returns a string. Use `query.data.netIncome >= 0` directly.

### W3 — `accounting.service.ts` at 2,002 lines
**File**: `apps/api/src/modules/accounting/accounting.service.ts`  
This is the largest file in the codebase. The new SHOP methods add ~400 lines on top of an already large file. The SHOP-scoped `getShopProfitLoss` method (~200 lines) and the paired SHOP helper queries should eventually live in a `ShopAccountingService`. Not blocking this PR since the logic is correct, but tech debt is accumulating.

### W4 — Missing SHOP-scope guard note in `accounting.md`
The new SHOP endpoints (`/expenses/ledger/shop/*`) are documented in code comments but not in the accounting rules file. Future developers may not know these endpoints exist or which roles can use them. A one-liner in `accounting.md` under "Reports" would help.

---

## Info

### I1 — `App.tsx` at 1,433 lines
Pre-existing file size; this PR adds ~13 lines (route + lazy import). Not introduced by this PR.

### I2 — `config/menu.ts` at 895 lines
Pre-existing. The 24 new lines add SHOP Accounting sidebar entries for 4 role configs.

### I3 — SHOP CoA seeder is idempotent
`seed-coa-shop.ts` uses `upsert` — safe to re-run. ✅

### I4 — `accounting-multi-scope.spec.ts` covers SHOP + FINANCE in same test suite
Good: proves SHOP and FINANCE scopes don't bleed into each other. Confirms correct `companyId` filtering.

---

## Recommendation: ⚠️ REVIEW

**No Critical issues.** W1 and W2 are minor precision/clarity concerns in reporting code; W3 is tech debt. None of these block correctness.

Before merging, the reviewer should:
1. Confirm `.toNumber()` results (W1) are never written back to any Prisma field.
2. Optionally clean up `Number(query.data.netIncome)` → `query.data.netIncome` (W2, 1-line fix).
3. Add a note to `docs/.claude/rules/accounting.md` about the new SHOP endpoints (W4).

If reviewer confirms W1 is serialization-only, this can be APPROVED without code changes.
