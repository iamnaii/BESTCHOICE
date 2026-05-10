# Merge Guard Report — fix/2a-cron-auto-consume-advance

**Date**: 2026-05-10  
**Author**: Akenarin Kongdach  
**Recommendation**: ✅ APPROVE (with minor note)

---

## Branch Summary

Closes 4 expense-module accounting gaps introduced in Phase A.5a:

1. **Atomicity** — `markExpensePaid` and `voidExpense` now wrap JE creation inside `$transaction`, so a JE failure rolls back the status update (previously non-blocking / fire-and-forget).
2. **2-step accrual path** — new `recordExpenseAccrual` endpoint + `ExpenseClearanceTemplate` allow APPROVED → accrue (Cr 21-1104) → pay (Dr 21-1104 / Cr cash).
3. **VOID reverse JE** — `voidExpense` auto-posts reversal via new `ExpenseReverseTemplate`; handles both 1-step (full-payment JE) and 2-step (accrual + clearance JEs) paths.
4. **WHT split** — clearance template correctly splits net cash vs. WHT payable (21-3102 / 21-3103).

## File Changes (13 files, +2,489 / -114)

| File | Type |
|------|------|
| `accounting.controller.ts` | New `POST :id/accrue` endpoint |
| `accounting.service.ts` | Atomic transactions + clearance/reverse routing |
| `accounting.service.spec.ts` | Tests updated for atomic behavior |
| `expense-clearance.template.ts` | New AP clearance JE template |
| `expense-reverse.template.ts` | New reversal JE template |
| `expense.template.ts` | Now accepts `outerTx` param (atomic integration) |
| `installment-accrual-2a.template.ts` | 2A advance-consume logic |
| `journal.module.ts` | Registers new templates |
| `*.spec.ts` (4 files) | Unit + integration tests for all new paths |

---

## Issues Found

### Critical
_None._

### Warning

**W1 — `Number()` on Decimal field in structured log**  
File: `apps/api/src/modules/accounting/accounting.service.ts`

```typescript
this.structuredLogger.log('expense.voided', {
  totalAmount: Number(voided.totalAmount),   // ← loses precision
```

`voided.totalAmount` is `Prisma.Decimal`. Using `Number()` here will silently truncate values above `Number.MAX_SAFE_INTEGER` (unlikely in practice for expense amounts, but violates the project-wide "never `Number()` on money fields" rule). Should use `.toFixed(2)` or `.toString()`.

### Info
_None._

---

## Security Checks

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on all new endpoints | ✅ Inherited from class-level guard on `AccountingController` |
| `@Roles()` on new `POST :id/accrue` | ✅ `OWNER, FINANCE_MANAGER, ACCOUNTANT` |
| `deletedAt: null` in all new queries | ✅ |
| No hardcoded secrets | ✅ |
| No raw unparameterized `$queryRaw` | ✅ (no raw SQL added) |
| No `fetch()` in frontend | ✅ (no frontend changes) |

---

## Recommendation

**APPROVE** — no blocking issues. One Warning (W1) should be fixed before merge but does not affect financial correctness (only log output precision). All financial computations use `Prisma.Decimal` throughout.
