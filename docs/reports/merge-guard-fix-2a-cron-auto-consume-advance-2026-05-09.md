# Pre-Merge Guard Report

| Field | Value |
|-------|-------|
| **Branch** | `fix/2a-cron-auto-consume-advance` |
| **Author** | Akenarin Kongdach |
| **Date** | 2026-05-09 17:17 +0700 |
| **Reviewed** | 2026-05-09 |
| **Recommendation** | ✅ APPROVE |

## File Changes Summary

13 files changed · 2,489 insertions · 114 deletions

| Path | Change |
|------|--------|
| `apps/api/src/modules/accounting/accounting.controller.ts` | New `POST :id/accrue` endpoint |
| `apps/api/src/modules/accounting/accounting.service.ts` | Expense lifecycle: `recordExpenseAccrual`, 2-step `markExpensePaid`, atomic `voidExpense` |
| `apps/api/src/modules/accounting/accounting.service.spec.ts` | Updated test for atomic void (non-blocking → blocking) |
| `apps/api/src/modules/journal/cpa-templates/expense.template.ts` | WHT split on cash payment path; accrual path Cr to `21-1104` |
| `apps/api/src/modules/journal/cpa-templates/expense-clearance.template.ts` | **New** — AP clearance JE (Dr 21-1104 / Cr cash ± WHT) |
| `apps/api/src/modules/journal/cpa-templates/expense-reverse.template.ts` | **New** — Reversal template for void path |
| `apps/api/src/modules/journal/cpa-templates/expense-clearance.template.spec.ts` | Integration tests (4 scenarios) |
| `apps/api/src/modules/journal/cpa-templates/expense-reverse.template.spec.ts` | Integration tests |
| `apps/api/src/modules/journal/cpa-templates/expense.template.spec.ts` | Integration tests |
| `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts` | CPA Policy A: auto-consume `advanceBalance` on 2A accrual |
| `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.spec.ts` | 4 new advance-consume scenarios |
| `apps/api/src/modules/journal/journal.module.ts` | Register `ExpenseReverseTemplate`, `ExpenseClearanceTemplate` |
| `docs/accounting/journey-expense-module.html` | Journey doc |

## Issues

### Critical — Must Fix Before Merge

None found.

### Warning — Should Fix

| # | File | Line | Issue |
|---|------|------|-------|
| W-1 | `apps/api/src/modules/accounting/accounting.service.ts` | void block | `Number(voided.totalAmount)` in `structuredLogger.log` call. Logging-only (not stored back to DB), but violates the "no `Number()` on money fields" convention. Replace with `voided.totalAmount.toString()`. |

### Info

- New `POST :id/accrue` endpoint correctly decorated with `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` — no guard gap.
- Expense `voidExpense` refactored from non-atomic to `$transaction` — solid improvement.
- `markExpensePaid` atomicity fix (Phase A.5a) is correct: JE failure now rolls back status update (previous non-blocking pattern was a data-integrity risk).
- 2-step clearance path (`accrual + clearance`) correctly reverses both JEs on void.
- `InstallmentAccrual2ATemplate` advance-consume block is well-guarded: runs inside the same outer `tx` as the accrual JE — if JE post fails, advance decrement rolls back cleanly.
- `depreciationEntry` queries without `deletedAt: null` in the accrual cron are intentional — that model has no `deletedAt` field (append-only design, uses `reversedAt` instead).

## Verification Checklist

- [x] No missing `@UseGuards` on new controller endpoints
- [x] No `Number()` on stored money values
- [x] All new queries include `deletedAt: null` where applicable
- [x] No hardcoded secrets
- [x] No unparameterized `$queryRaw`
- [x] New templates registered in `JournalModule`
- [x] Tests cover critical paths (advance full-cover, partial-cover, no-advance, payment flip to PAID)
