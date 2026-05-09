# Pre-Merge Guard Report — fix/2a-cron-auto-consume-advance

**Date**: 2026-05-09  
**Branch**: `fix/2a-cron-auto-consume-advance`  
**Author**: Akenarin Kongdach  
**Recommendation**: ⚠️ REVIEW

---

## Summary

Closes 4 accounting gaps in the expense module and adds automatic advance-balance consumption to the 2A installment accrual cron. Key additions:

- `InstallmentAccrual2ATemplate` — new JE template that auto-consumes any customer advance balance before posting the accrual entry
- `ExpenseClearanceTemplate` — clears accrued AP (21-1104 → cash), handles WHT split
- `ExpenseReverseTemplate` — reverses JE on expense VOID (atomic with status update)
- `markExpensePaid` refactored to be atomic (JE failure now rolls back status)
- `voidExpense` refactored into `$transaction` block — reverse JE created on VOID of PAID expense

## File Changes (13 files, +2489 / −114)

| Area | Files |
|------|-------|
| JE Templates (new) | expense-clearance.template.ts, expense-reverse.template.ts |
| JE Templates (modified) | expense.template.ts, installment-accrual-2a.template.ts (new) |
| Service | accounting.service.ts |
| Controller | accounting.controller.ts |
| Tests | expense-clearance.template.spec.ts, expense-reverse.template.spec.ts, expense.template.spec.ts, installment-accrual-2a.template.spec.ts, accounting.service.spec.ts |
| Module | journal.module.ts |
| Docs | docs/accounting/journey-expense-module.html |

## Issues Found

### Critical
_None._

### Warning

1. **`Number()` on Decimal money field in structured log** — `accounting.service.ts`  
   In `voidExpense`, the structured log call uses:
   ```ts
   totalAmount: Number(voided.totalAmount),
   ```
   `voided.totalAmount` is a `Prisma.Decimal`. `Number()` on a Decimal can lose precision for amounts ≥ 2^53 (edge case in practice) and violates the project rule against `Number()` on financial fields. Should be:
   ```ts
   totalAmount: voided.totalAmount.toString(),
   ```

### Info

1. **New `@Post(':id/accrue')` endpoint — missing DTO body validation**  
   The `accrue()` controller method (`accounting.controller.ts`) takes no body, which is correct. Confirmed safe.

2. **`ExpenseClearanceTemplate` and `ExpenseReverseTemplate` are `@Injectable()` and properly DI-wired** via `journal.module.ts` update. ✓

3. **All new queries include `deletedAt: null`** — no unfiltered soft-delete exposure. ✓

4. **Atomicity improvement**: `markExpensePaid` and `voidExpense` both now run inside `$transaction`. JE failure rolls back the status update. This is a correctness improvement over Phase A.5a's non-blocking pattern. ✓

5. **Test coverage**: 4 new spec files with integration tests against a real Prisma client; idempotency paths tested. ✓

## Recommendation

**REVIEW** — one warning to address before merge:

- Fix `Number(voided.totalAmount)` → `voided.totalAmount.toString()` in `accounting.service.ts` (`voidExpense` structured log call).

Otherwise the branch is well-structured, properly guarded, and atomicity improvements are a net positive.
