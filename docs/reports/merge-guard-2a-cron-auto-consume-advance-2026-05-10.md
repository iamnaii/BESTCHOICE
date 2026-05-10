# Merge Guard Report — `fix/2a-cron-auto-consume-advance`

**Date**: 2026-05-10  
**Branch**: `fix/2a-cron-auto-consume-advance`  
**Author**: Akenarin Kongdach (iamnaii@gmail.com)  
**Commits ahead of main**: 14  
**Recommendation**: ✅ REVIEW (approve after confirming 1 warning below)

---

## File Changes Summary

13 files changed, 2 489 insertions(+), 114 deletions(−)

Key changes:
- `apps/api/src/modules/accounting/accounting.controller.ts` — new `POST :id/accrue` endpoint
- `apps/api/src/modules/accounting/accounting.service.ts` — `recordExpenseAccrual()`, `markExpensePaid()` expanded
- `apps/api/src/modules/journal/cpa-templates/expense-clearance.template.ts` — new JE template (Dr AP / Cr Bank)
- `apps/api/src/modules/journal/cpa-templates/expense-reverse.template.ts` — new JE template (reversal)
- `apps/api/src/modules/journal/cpa-templates/expense-clearance.template.spec.ts` — integration spec
- `apps/api/src/modules/journal/cpa-templates/expense-reverse.template.spec.ts` — integration spec
- `apps/api/src/modules/journal/journal.module.ts` — registers new templates
- `docs/accounting/journey-expense-module.html` — reference doc

---

## Issues

### Critical — None

| Check | Result |
|-------|--------|
| New `POST :id/accrue` endpoint has `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` | ✅ |
| Parent controller already has `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ |
| New templates use `new Decimal()` for all financial arithmetic | ✅ |
| No unparameterized `$queryRaw` | ✅ |
| No hardcoded secrets | ✅ |
| New service methods include `deletedAt: null` in queries | ✅ |

---

### Warning — 1 item

**W-1: `Number(voided.totalAmount)` persists in `accounting.service.ts` logger**  
File: `apps/api/src/modules/accounting/accounting.service.ts` (inside transaction callback)  
```ts
this.structuredLogger.log('expense.voided', {
  ...
  totalAmount: Number(voided.totalAmount),   // ← Warning
  ...
});
```
This line existed pre-branch and remains unchanged. Not a financial calculation — it converts a Decimal to Number only for structured log output. The fix from W-1 in `expense-documents-all` should address this at the same time: use `.toString()`.

---

### Info — 1 item

**I-1: Floating-point arithmetic in test fixture helpers**  
Files: `expense-clearance.template.spec.ts`, `expense-reverse.template.spec.ts`  
```ts
// Inside makeExpense() helper:
netPayment: new Decimal(totalAmount - (withholdingTax as number)),  // ← plain JS subtraction
```
This is test fixture code (not production), but the JS number subtraction before `new Decimal()` wrapping can introduce floating-point imprecision for unusual values. The production template service itself correctly uses chained `Decimal` arithmetic.  
Best practice: `new Decimal(totalAmount).minus(new Decimal(withholdingTax as number))`.

---

## Security Checklist

| Concern | Status |
|---------|--------|
| New endpoint without guards | None found |
| Missing `@Roles` | None found |
| Raw `fetch()` in frontend | None found |
| `Number()` on financial DB calculation | None found (logger only) |
| Missing `deletedAt: null` | None found |
| Hardcoded secret | None found |
| Unparameterized SQL | None found |

---

## Recommendation

**REVIEW** — No critical issues. One warning: `Number()` in structured logger should use `.toString()`. This is low-risk and can be fixed as part of the same clean-up commit resolving the same issue in `feat/expense-documents-all`. Approve once logger fix is applied.
