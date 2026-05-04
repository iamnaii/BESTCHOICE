# Merge Guard Report — fix/accounting-w2-w4-frontend

**Date**: 2026-05-04  
**Branch**: `fix/accounting-w2-w4-frontend`  
**Last commit**: `feat(accounting): W-2 + W-4 + frontend settlement page`  
**Recommendation**: **REVIEW** (no blockers — minor warnings)

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | +1 | Add FINANCE acc `53-1805` Sales Discount on Interest |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +7 | Add SHOP acc `53-1801` Sales Discount on Commission |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +21/-0 | Update early-payoff tests for Phase W-4 |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +99/-37 | W-2: pg_advisory_xact_lock; W-4: explicit discount expense |
| `apps/api/src/modules/receipts/receipts.service.ts` | +16/-6 | W-2: pg_advisory_xact_lock for receipt numbering |
| `apps/web/src/App.tsx` | +9 | Route `/accounting/intercompany` |
| `apps/web/src/config/menu.ts` | +2 | Menu item for intercompany settlement |
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | +287 | New page (balance display + settle dialog) |

**Total**: +405 / -37 lines across 8 files

---

## Issues

### Warning

**W1 — `parseFloat` on money input before API post**  
`apps/web/src/pages/IntercompanySettlementPage.tsx:444`
```typescript
amount: parseFloat(amount),
```
`parseFloat` can produce imprecise JS floats for decimal strings (e.g. `"10000.10"` → `10000.099999...`). The backend DTO uses `@IsNumber({ maxDecimalPlaces: 2 })` which may reject or silently truncate. Safer: `Number(parseFloat(amount).toFixed(2))` before submitting, or add a `zod` schema in the form.  
_Severity_: Warning — backend validates but float coercion is fragile.

**W2 — `isLegacyFallback` block is unreachable dead code**  
`apps/api/src/modules/journal/journal-auto.service.ts` (createEarlyPayoffJournal)
```typescript
const isLegacyFallback = sumOtherOrig.isZero() && interestActual.gt(0);
```
When `sumOtherOrig.isZero()`, `sumInterestOrig = 0`, so `interestActual = sumInterestOrig × scale = 0`. The condition `interestActual.gt(0)` can never be true. The `if (isLegacyFallback) { ... }` block and all `isLegacyFallback ? ... : ...` ternaries are dead code. The zero-breakdown case is still handled correctly (zero credit lines are emitted) but the explicit legacy path is never executed.  
_Severity_: Warning — no incorrect behavior, but dead code adds confusion.

---

### Info

**I1 — Account code `53-1801` exists in both SHOP and FINANCE charts**  
`SA.SALES_DISCOUNT_COMMISSION = '53-1801'` (SHOP) and `FA.COMMISSION_EXPENSE = '53-1801'` (FINANCE). By design: the accounting rules explicitly allow the same code to exist in both charts with different meanings. No issue — both are scoped by `companyId`.

**I2 — `journal-auto.service.ts` growing complex**  
The service handles: payment JE, activation JE, early-payoff JE (A.1c → A.2 → W-4), repossession JE, bad-debt JE, settlement JE. File is approaching 750+ lines. Consider splitting into sub-services in a future refactor sprint (no action needed for this PR).

---

## Security Checks

| Check | Status |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on new controllers | N/A — no new controllers in this branch |
| `Number()` on money fields | ✓ PASS — `Prisma.Decimal` used throughout |
| `deletedAt: null` in queries | ✓ PASS |
| Hardcoded secrets | ✓ PASS — none found |
| Raw `$queryRaw` SQL injection | ✓ PASS — `pg_advisory_xact_lock(${lockKey}::bigint)` is parameterized |
| Frontend: `api.get()/api.post()` used | ✓ PASS |
| Frontend: `queryClient.invalidateQueries()` after mutation | ✓ PASS |
| Frontend: semantic design tokens (no hardcoded hex/gray) | ✓ PASS |
| Thai validation messages on DTOs | N/A — no new DTOs |

---

## Recommendation: REVIEW

No critical blockers. Two warnings should be addressed before merge:
1. Fix `parseFloat` → `Number(parseFloat(amount).toFixed(2))` in `IntercompanySettlementPage.tsx:444`
2. Remove or comment the unreachable `isLegacyFallback` branch to avoid future confusion

Both are low-risk fixes. The W-2 (pg_advisory_xact_lock) and W-4 (explicit discount expense) core changes are correct and well-tested.
