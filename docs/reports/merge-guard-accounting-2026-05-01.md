# Pre-Merge Guard Report — Accounting Phase Branches
**Date**: 2026-05-01  
**Reviewer**: Pre-Merge Guard Agent  
**Branches reviewed**: 3 most recently active unmerged feature/fix branches

---

## Branch 1: `fix/accounting-phase-a1c-jebugs-v2`
**Author**: Akenarin Kongdach  
**Last commit**: 2026-04-29 19:16 +0700  
**Commits**: 2 (`fix(contracts): early payoff JE — handle discount correctly`, `fix(journal): trial balance + entry-number collision`)

### File Changes Summary
| File | Change |
|------|--------|
| `apps/api/src/modules/contracts/contract-payment.service.ts` | Refactored: per-installment JEs → single aggregated JE on early payoff |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Added `createEarlyPayoffJournal()`, fixed `generateEntryNumber()` collision via `SELECT … FOR UPDATE`, refactored trial balance `findMany` → `groupBy` |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | Added 7 tests for `createEarlyPayoffJournal`, mocked `$queryRaw` |

### Issues Found

**Critical**: None

**Warning**:
- `createEarlyPayoffJournal` does not validate that `totalPayoff >= sumPrincipal`. If called with a payoff amount lower than the remaining principal (which shouldn't happen via normal UI quote flow, but could via direct API), `nonPrincipalActual` becomes negative → negative interest/VAT credit lines in the JE. Recommend adding an assertion: `if (cashExclLateFee.lt(sumPrincipal)) throw new BadRequestException(...)`.

**Info**:
- Trial balance refactored from `findMany` (load all into memory) to `groupBy` (DB aggregation) — good performance improvement for large datasets.
- `chartOfAccount` lookup now scoped by `companyId` — prevents SHOP/FINANCE name collision on same account code (e.g., `11-1101` Cash). ✅
- `SELECT … FOR UPDATE` properly uses Prisma tagged-template (`$queryRaw\`...\``) — parameterized, SQL-injection safe. ✅
- All `companyInfo.findFirst` calls include `deletedAt: null`. ✅
- `Prisma.Decimal` used throughout — no bare `Number()` on financial fields. ✅

### Recommendation: **REVIEW**
Solid refactor. One warning (no floor guard on `totalPayoff`) should be addressed. May require ordering with other accounting branches before merge.

---

## Branch 2: `fix/accounting-phase-a3-ic-settlement`
**Author**: Akenarin Kongdach  
**Last commit**: 2026-04-29 22:52 +0700  
**Commits**: 1 (`feat(accounting): Phase A.3 (W-5) — Inter-company settlement JE`)

### File Changes Summary
| File | Change |
|------|--------|
| `apps/api/src/app.module.ts` | Imports new `IntercompanyModule` |
| `apps/api/src/modules/intercompany/intercompany.controller.ts` | New controller — `GET /accounting/intercompany/balance`, `POST /accounting/intercompany/settle` |
| `apps/api/src/modules/intercompany/intercompany.service.ts` | New service — outstanding balance calc + settlement transaction |
| `apps/api/src/modules/intercompany/intercompany.module.ts` | New module |
| `apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts` | DTO with class-validator |
| `apps/api/src/modules/intercompany/intercompany.service.spec.ts` | 6 tests |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Added `createInterCompanySettlementJournal()` |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | 4 tests for new journal method |

### Issues Found

**Critical**: None

**Warning**:
- `IntercompanyModule` coexists with existing `InterCompanyModule` (note case difference) — imported in `app.module.ts` as separate modules. This is intentional per Phase A.3 notes, but the naming similarity risks future confusion. Consider a comment referencing why both exist.
- `settle()` uses `dto.amount > balance.financeOwesToShop + 0.01` for the guard check — both operands are JavaScript `number` (after `.toNumber()`). For very large amounts, floating-point imprecision could cause false-positives. The `+ 0.01` tolerance is a workaround. Low risk given the settlement context.

**Info**:
- `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✅
- `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` on GET, `@Roles('OWNER', 'FINANCE_MANAGER')` on POST — appropriate access controls ✅
- `@UsePipes(new ValidationPipe({ whitelist: true }))` on controller ✅
- DTO has Thai-language messages ✅
- All `journalLine.aggregate` and `companyInfo.findFirst` queries include `deletedAt: null` ✅
- `Prisma.Decimal` used for all amount arithmetic in `createInterCompanySettlementJournal` ✅
- `$queryRaw` (via advisory lock) uses tagged-template — parameterized, SQL-injection safe ✅
- Paired SHOP+FINANCE JEs share `[IC-<uuid>]` prefix — IC invariant maintained ✅

### Recommendation: **APPROVE**
Well-structured module with proper guards, DTO validation, Decimal arithmetic, and good test coverage. The naming confusion with `InterCompanyModule` is cosmetic.

---

## Branch 3: `fix/accounting-w2-w4-frontend`
**Author**: Akenarin Kongdach  
**Last commit**: 2026-04-29 23:46 +0700  
**Commits**: 1 (`feat(accounting): W-2 + W-4 + frontend settlement page`)

### File Changes Summary
| File | Change |
|------|--------|
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | Added `53-1805 Sales Discount on Interest` to FINANCE chart |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | Added `53-1801 Sales Discount on Commission` to SHOP chart |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Upgraded W-2 entry-number locking to `pg_advisory_xact_lock`, refactored W-4 early payoff discount: implicit netting → explicit Sales Discount expense entries |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | Updated 3 test cases to match W-4 accounting treatment |
| `apps/api/src/modules/receipts/receipts.service.ts` | Same `pg_advisory_xact_lock` upgrade for receipt numbers |
| `apps/web/src/App.tsx` | New route `/accounting/intercompany` with `ProtectedRoute` |
| `apps/web/src/config/menu.ts` | New menu entry for ACCOUNTANT and OWNER |
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | New 287-line page |

### Issues Found

**Critical**: None

**Warning**:
- `SHOP_ACC.SALES_DISCOUNT_COMMISSION` maps to `'53-1801'` and `FINANCE_ACC.COMMISSION_EXPENSE` also maps to `'53-1801'`. These are intentionally different accounts in different entity charts, but the shared string value in adjacent constants is confusing — a future developer could easily use the wrong entity's constant. Recommend a `// SHOP chart only` / `// FINANCE chart only` annotation.
- `IntercompanySettlementPage` filters settlement history client-side: `e.description?.includes('IC-') && e.description?.includes('ชำระเงินระหว่างบริษัท')`. This is fragile — any description format change breaks the filter silently. A dedicated `GET /accounting/intercompany/history` endpoint returning pre-filtered results would be safer.
- `pg_advisory_xact_lock(${lockKey}::bigint)`: the lock key for journal entries is `parseInt(ym, 10)` (e.g., `202605`); for receipts it's `parseInt('1' + ym, 10)` (e.g., `1202605`). If `ym` grows past 6 digits (year 10000+), the numeric `YYYYMM` key could collide between the two spaces — not a real-world concern but worth documenting.

**Info**:
- `IntercompanySettlementPage`: uses `api.get()`/`api.post()` ✅, `useQuery`/`useMutation` ✅, `queryClient.invalidateQueries()` after mutation ✅, `toast.success()`/`toast.error()` ✅
- Route protected with `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` ✅
- Design tokens used throughout (no hardcoded hex/gray colors) ✅
- `leading-snug` on Thai text ✅
- W-4 accounting treatment (explicit `Dr. Sales Discount Interest` expense) is a valid alternative to implicit income netting — **requires CPA/owner sign-off** to confirm preference over Phase A.2's proportional reduction approach.
- `isLegacyFallback` condition (`sumOtherOrig.isZero() && interestActual.gt(0)`) correctly branches legacy contracts with zero breakdown.

### Recommendation: **REVIEW**
Frontend page is clean. The `pg_advisory_xact_lock` upgrade is an improvement. The W-4 accounting treatment changes are significant and correct, but require business/CPA sign-off on the explicit discount expense approach vs. the previous implicit netting.

---

## Merge Order Note

These branches are interdependent:
1. **`fix/accounting-phase-a1c-jebugs-v2`** introduces `createEarlyPayoffJournal` — must merge first
2. **`fix/accounting-phase-a3-ic-settlement`** can merge independently
3. **`fix/accounting-w2-w4-frontend`** modifies `createEarlyPayoffJournal` for W-4 — merge after a1c

Recommended order: `a1c` → `a3` → `w2-w4`

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `fix/accounting-phase-a1c-jebugs-v2` | 0 | 1 | 3 | **REVIEW** |
| `fix/accounting-phase-a3-ic-settlement` | 0 | 2 | 5 | **APPROVE** |
| `fix/accounting-w2-w4-frontend` | 0 | 3 | 5 | **REVIEW** |
