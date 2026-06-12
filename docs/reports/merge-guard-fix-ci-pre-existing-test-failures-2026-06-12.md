# Merge Guard Report — `fix/ci-pre-existing-test-failures`

**Date**: 2026-06-12  
**Author**: Akenarin Kongdach  
**Branch**: `fix/ci-pre-existing-test-failures`  
**Unique commits vs main**: 7  

---

## File Changes Summary

23 files changed, 4247 insertions(+), 393 deletions(−)

| Category | Files |
|---|---|
| New test specs | `analytics.service.spec.ts`, `contract-payment.service.early-payoff-exec.spec.ts`, `credit-check.risk-score.spec.ts`, `finance-tools.service.spec.ts`, `mdm-auto.service.spec.ts`, `payment-method-config.service.spec.ts`, `paysolutions.callbacks.spec.ts`, `pdpa.service.spec.ts`, `purchase-orders.create.spec.ts`, `reports.service.portfolio.spec.ts`, `late-fee.util.spec.ts` |
| New source | `apps/api/src/utils/late-fee.util.ts` |
| Modified source | `finance-tools.service.ts`, `finance-receivable.dto.ts`, `tool-executor.ts`, `accounting.module.ts` |
| Modified tests | `env-validation.spec.ts`, `contract-signing-workflow.spec.ts`, `approval-workflow.e2e-spec.ts` |
| Deleted | `bank-reconciliation.service.ts` + spec |

---

## Commit Summary

1. `chore(accounting)`: remove dead, unwired `BankReconciliationService` — not wired to any endpoint; only safe housekeeping.
2. `test(api) Wave-2/3` (+105, +84): characterization test backfill for mdm-auto, payment-method-config, finance-tools, pdpa, analytics, paysolutions, purchase-orders, reports.
3. `fix(finance-receivable)`: add `@Max(1)` to `commissionRate` on `UpdateFinanceReceivableDto` — prevents commissionRate > 1 from making `netExpectedAmount` go negative (impossible receivable written to books).
4. `fix(chatbot-finance)`: cap LIFF late-fee quote via shared `computeCappedLateFee()` util — chatbot was quoting uncapped `perDay × days`, now uses the same ceiling logic as `recordPayment`.
5. `fix(ci)`: repair 3 pre-existing test failures blocking merge gate (mock drift + stale env tests post-2FA removal). Test-only changes.
6. `ci(e2e)`: exclude incomplete `approval-workflow` harness from CI.

---

## Issues

### Warning

**`finance-tools.service.ts` — `Number()` on financial display values**

Lines 55–56, 125, 128, 144, 174 (on the branch):

```ts
const amountDue = Number(nextPayment.amountDue);
const amountPaid = Number(nextPayment.amountPaid);
const totalAmount = payments.reduce((s, p) => s + Number(p.amountDue), 0);
const totalFine = Number(computeCappedLateFee({ ... }));
```

`computeCappedLateFee` correctly returns `Prisma.Decimal` throughout its implementation. The `Number()` coercions happen only at the chatbot response boundary (values are serialised into a JSON response for the LIFF chatbot — never written to the DB). Precision loss at this boundary (e.g. 1,234,567.89 → 1234567.89) is safe for display but diverges from the project-wide rule of "use `Prisma.Decimal`, never `Number()`" for money fields.

**Recommended fix**: pass `computeCappedLateFee(...).toNumber()` explicitly, or annotate with a comment explaining why the display path rounds to Number.

---

### Info

- `late-fee.util.ts` (new utility): correctly uses `Prisma.Decimal` internally for all arithmetic and returns `Prisma.Decimal`. The `Number()` coercions only occur in the calling service after the result is returned — not inside the util itself.
- `BankReconciliationService` deletion is clean: the service is not referenced in any controller or other module on main; the accounting module already excluded it.
- All new test specs include correct `deletedAt: null` guards where they mock Prisma queries.
- `@Max(1)` fix on `commissionRate` is correct and covers the attack vector (direct API call bypassing frontend submit).

---

## Recommendation: **REVIEW**

Safe to merge after resolving the `Number()` warning in `finance-tools.service.ts`.  
All other changes are test-only, tooling, or defensive fixes. No new controllers, no new guards needed, no hardcoded secrets found.
