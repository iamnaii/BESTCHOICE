# Pre-Merge Guard Report

**Branch:** `fix/2a-cron-auto-consume-advance`
**Author:** Akenarin Kongdach
**Date:** 2026-05-12
**Reviewer:** Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/src/modules/accounting/accounting.controller.ts` | +12 | -4 | New `POST :id/accrue` endpoint, `markPaid` body shape update |
| `apps/api/src/modules/accounting/accounting.service.ts` | ~+150 | ~-40 | `recordExpenseAccrual`, `markExpensePaid(depositAccountCode)`, `voidExpense` atomicity |
| `apps/api/src/modules/journal/cpa-templates/expense-clearance.template.ts` | +new | — | New JE template: AP clearance (Dr 21-1104 / Cr cash) |
| `apps/api/src/modules/journal/cpa-templates/expense-reverse.template.ts` | +new | — | New JE template: expense void reversal |
| `apps/api/src/modules/journal/cpa-templates/expense.template.ts` | ~+50 | ~-20 | Idempotency guard |
| `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts` | +92 | 0 | **New**: auto-consume advance balance on accrual |
| `apps/api/src/modules/journal/journal.module.ts` | +6 | 0 | Register new templates |
| `docs/accounting/journey-expense-module.html` | +1101 | 0 | Documentation (non-code) |
| Test files (`*.spec.ts`) | +~1200 | ~-100 | New integration tests for clearance + reverse templates |

**Total:** 13 files, ~+2489 / -114

---

## Issues Found

### Critical
None.

### Warning

**[W-1] `Number(voided.totalAmount)` in structured logger**
- Location: `accounting.service.ts`, `voidExpense()` method, inside `structuredLogger.log('expense.voided', { ... })`
- The value is logged only — no arithmetic performed on it. Not a financial calculation bug.
- However, per project convention (`rules/database.md`), `Number()` on Decimal fields is flagged as a pattern to avoid. The safe equivalent is `.toNumber()` (explicit Prisma Decimal method) or keeping it as a string `.toString()`.
- Risk: negligible (logging only, not used in JE amounts).
- **Suggested fix:** `totalAmount: voided.totalAmount.toNumber()` or `totalAmount: voided.totalAmount.toString()`

**[W-2] Test fixture arithmetic: `new Decimal(totalAmount - (withholdingTax as number))`**
- Location: test helper function creating expense fixtures in spec files.
- Performs native JS subtraction on two unknowns before wrapping in Decimal. For the specific test values used (integer amounts like 1000, 50), floating-point error is zero in practice — but the pattern is fragile and inconsistent with prod code.
- **Suggested fix:** `new Decimal(totalAmount).minus(new Decimal(withholdingTax as number))`
- Risk: test-only, no prod impact.

**[W-3] `depositAccountCode` body parameter in `markPaid` has no DTO validation**
- Location: `accounting.controller.ts`, `markPaid()` — `@Body() body: { paymentDate?: string; depositAccountCode?: string } = {}`
- Raw inline interface with no class-validator. The `depositAccountCode` is not validated against the 6-code allow-list (`11-1101..11-1203`).
- The service likely validates downstream, but controller-level validation is the project standard (per `rules/backend.md`).
- **Suggested fix:** Create `MarkExpensePaidDto` with `@IsOptional() @IsString()` fields, and add a custom validator or `@Matches(/^11-(1101|1102|1103|1201|1202|1203)$/)` for `depositAccountCode`.

### Info

**[I-1] New `POST :id/accrue` endpoint**
- Has `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` ✓
- Controller class has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level (confirmed in existing code) ✓

**[I-2] Advance-consume logic in 2A template is transaction-atomic**
- The `createAndPost()` call for the advance-consume JE and the `contract.update({ advanceBalance: { decrement: consume } })` both run inside the same outer transaction as the accrual JE.
- If journal post fails, the advance balance decrement and payment status update are rolled back. Correct.

**[I-3] Idempotency guard in `expense-clearance.template.ts`**
- Checks `reference: '${id}:clearance'` before posting. Returns early if already posted. Correct pattern matching the existing 2B template.

**[I-4] `resolveWhtAccount(vendorTaxId)`** — routes to 21-3102 (PND3) vs 21-3103 (PND53) based on `vendorTaxId` prefix. Heuristic is `startsWith('0')` → juristic (PND53). This is consistent with the per-line WHT routing rule in `rules/accounting.md`.

**[I-5] `netPayment = totalAmount.minus(withholdingTax)` in template** ✓
- Prod service code uses correct `Decimal.minus()` arithmetic.

---

## Recommendation

**REVIEW**

The core accounting logic is sound — transaction atomicity, Decimal arithmetic in service code, idempotency guards, and the advance-consume design all look correct. However, three warnings should be addressed before merge:

1. **W-1** (logging) and **W-2** (test fixture) are low-risk but trivial to fix — 2-line changes each.
2. **W-3** (missing DTO validation on `depositAccountCode`) is the most important: an invalid cash account code passed to `markPaid` could result in a JE posting to a non-existent account, breaking the trial balance. A regex validator on the DTO would prevent this at the API boundary.

Suggest fixing W-1, W-2, W-3 before merge or creating follow-up tickets if deferring.
