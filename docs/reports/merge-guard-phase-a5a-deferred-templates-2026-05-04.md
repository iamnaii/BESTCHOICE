# Merge Guard Report — `phase-a5a-deferred-templates`

**Date**: 2026-05-04  
**Branch**: `phase-a5a-deferred-templates`  
**Author**: Akenarin Kongdach  
**Recommendation**: 🟡 **REVIEW** — no critical blockers, one warning before merge

---

## File Changes Summary

15 files changed, 1 482 insertions(+), 40 deletions(-)

### New production files
| File | Lines |
|------|-------|
| `apps/api/src/modules/journal/cpa-templates/expense.template.ts` | 151 |
| `apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.ts` | 158 |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.ts` | 145 |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.ts` | 96 |
| `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts` | 116 |
| `apps/api/src/modules/accounting/accounting.service.ts` (modified) | — |
| `apps/api/src/modules/receipts/receipts.service.ts` (modified) | — |

---

## Issues Found

### 🔴 Critical

None found.

- No new controllers → guard check N/A
- No `Number()` on financial fields in production templates (all use `Decimal` from `@prisma/client/runtime/library`)
- No raw `$queryRawUnsafe` or unparameterized SQL
- No hardcoded secrets or API keys
- No raw `fetch()` in frontend files

---

### ⚠️ Warning

#### W1 — Hardcoded `depositAccountCode: '11-1101'` in production service + template

**Files**:  
- `apps/api/src/modules/accounting/accounting.service.ts` (~line 403)  
- `apps/api/src/modules/journal/cpa-templates/expense.template.ts` (default parameter)

```ts
// accounting.service.ts
await this.expenseTemplate.execute({
  expenseId: updated.id,
  depositAccountCode: '11-1101', // Default cash account; caller can pass custom in future
  isPaid: true,
});

// expense.template.ts
const { expenseId, depositAccountCode = '11-1101', isPaid = true } = input;
```

`11-1101` is the cash account for one specific person ("สุทธินีย์ คงเดช"). Expenses paid via bank transfer or a different cash holder will be posted to the wrong ledger account silently.

**Fix**: Propagate the `paymentAccountCode` from the `Expense` record (or the `UpdateExpenseDto`) through to the template call. The template default of `'11-1101'` is fine as a fallback, but the service should not override it without reading from the expense's actual payment method.

---

### ℹ️ Info

#### I1 — `prisma as any` in test spec files

Pervasive in the new spec files (`bad-debt-provision.template.spec.ts`, `bad-debt-writeoff.template.spec.ts`, `receipt-void-reversal.template.spec.ts`, `expense.template.spec.ts`) where classes are instantiated directly without NestJS DI. Acceptable for test isolation, no production impact.

#### I2 — Non-blocking JE error handling pattern is consistent ✅

Both `accounting.service.ts` and `receipts.service.ts` wrap the new template calls in `try/catch` with `logger.error` so JE failures don't roll back status updates. This matches the established Phase A.5a non-blocking pattern.

#### I3 — No new controllers or endpoints ✅

This branch only wires existing Phase A.5a template calls into service methods — no new routes, so guard/role review is N/A.

#### I4 — Missing `Sentry.captureException` in non-blocking template catch blocks

**Files**: `accounting.service.ts`, `receipts.service.ts`

The `catch` blocks log via `logger.error` but do not call `Sentry.captureException`. Silent JE failures would not trigger on-call alerts. Not a hard blocker, but inconsistent with the v2/v3 hardening pattern where Sentry is used in every service catch for financial flows.

---

## Recommendation

**🟡 REVIEW**

No critical issues. W1 (hardcoded account code) is a correctness risk for multi-account setups and should be resolved before the template is used in production. I4 (missing Sentry on JE catch) is a monitoring gap worth adding alongside W1. Safe to merge after addressing W1.
