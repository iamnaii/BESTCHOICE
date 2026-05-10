# Merge Guard Report — `feat/expense-documents-all`

**Date**: 2026-05-10  
**Branch**: `feat/expense-documents-all`  
**Author**: Akenarin Kongdach (iamnaii@gmail.com)  
**Commits ahead of main**: 60  
**Recommendation**: ✅ REVIEW (approve after confirming 2 warnings below)

---

## File Changes Summary

96 files changed, 16 624 insertions(+), 3 931 deletions(−)

Key additions:
- `apps/api/src/modules/expense-documents/` — full new NestJS module (controller, service, templates, DTOs, tests)
- `apps/api/src/modules/expense-documents/expense-templates.controller.ts` — template CRUD controller
- `apps/api/src/cli/wipe-expenses.cli.ts` — destructive CLI helper (gated by env vars)
- `apps/web/src/pages/ExpenseDocumentNewPage.tsx`, `ExpenseFavoritesPage.tsx`, `ExpenseDailySummaryPage.tsx` — new frontend pages
- `apps/web/src/components/expense-documents/CreditNoteForm.tsx`, `PayrollForm.tsx`, `SettlementForm.tsx`
- `apps/api/src/modules/accounting/accounting.service.ts` — moved expense logic to new module
- Planning docs under `docs/superpowers/plans/` (2961-line MD file)

---

## Issues

### Critical — None

All critical checks passed:

| Check | Result |
|-------|--------|
| `ExpenseDocumentsController` has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` | ✅ |
| `ExpenseTemplatesController` has `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ |
| All controller methods have `@Roles(...)` decorators | ✅ |
| Frontend uses `api.get()/api.post()` not raw `fetch()` | ✅ |
| `queryClient.invalidateQueries()` called after all mutations | ✅ |
| New pages wrapped in `ProtectedRoute` | ✅ |
| No unparameterized `$queryRaw` (CLI uses template literal — safe) | ✅ |
| No hardcoded secrets or API keys | ✅ |
| All new Prisma queries include `deletedAt: null` | ✅ |
| DTOs have class-validator decorators with Thai messages | ✅ |
| No `Number()` on financial DB fields or calculations | ✅ |

---

### Warning — 2 items

**W-1: `Number(voided.totalAmount)` in structured logger**  
File: `apps/api/src/modules/accounting/accounting.service.ts` — `voidExpense()` method  
```ts
this.structuredLogger.log('expense.voided', {
  ...
  totalAmount: Number(voided.totalAmount),   // ← Warning
  ...
});
```
`voided.totalAmount` is a Prisma `Decimal`. Converting to JS `Number` for log output is not a financial calculation, so there is no precision loss on money storage. However it violates the spirit of the team's Decimal-only rule and sets a bad precedent.  
**Fix**: Use `voided.totalAmount.toString()` instead.

**W-2: `ExpenseTemplatesController` missing `BranchGuard`**  
File: `apps/api/src/modules/expense-documents/expense-templates.controller.ts`  
The templates controller uses `@UseGuards(JwtAuthGuard, RolesGuard)` but not `BranchGuard` unlike the main `ExpenseDocumentsController`. If templates are intended to be branch-scoped (service methods scope by `user.branchId`), the guard should be added. If templates are intentionally cross-branch/global, this is acceptable — but should be documented in a `// public across branches` comment.

---

### Info — 2 items

**I-1: Large files**  
- `expense-documents.service.ts` — 897 lines (threshold: 500)  
- `ExpensesPage.tsx` — 634 lines (threshold: 500)  

No immediate action required, but consider splitting if the files grow further.

**I-2: Large planning MD committed to repo**  
- `docs/superpowers/plans/2026-05-10-expense-document-pr1.md` — 2 961 lines  
- `docs/superpowers/plans/2026-05-10-expense-document-polymorphic-redesign.md` — 671 lines  

These are implementation plans that may become stale. Acceptable in `docs/superpowers/plans/` but worth keeping an eye on over time.

---

## Security Checklist

| Concern | Status |
|---------|--------|
| New controller without guards | None found |
| Missing `@Roles` on method | None found |
| Raw `fetch()` in frontend | None found |
| `Number()` on financial calculation | None found |
| Missing `deletedAt: null` in queries | None found |
| Hardcoded secret | None found |
| Unparameterized SQL | None found |
| Missing mutation cache invalidation | None found |

---

## Recommendation

**REVIEW** — No critical security or financial-precision issues. Two warnings should be addressed before merge:
1. `Number(voided.totalAmount)` → `.toString()` in logger (W-1)
2. Clarify or add `BranchGuard` on `ExpenseTemplatesController` (W-2)

Both are low-risk and can be fixed in a follow-up commit on the branch before merge.
