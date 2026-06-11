# Pre-Merge Guard Report

**Branch**: `fix/ci-pre-existing-test-failures`  
**Author**: Akenarin Kongdach  
**Date**: 2026-06-11  
**Recommendation**: ✅ APPROVE

---

## Branch Summary

7 commits fixing CI failures + backfilling characterization tests. No new feature surface — primarily test additions and minor production fixes.

### File Changes (23 files, +4247 / -393)

| Category | Files |
|---|---|
| New test specs (6) | `analytics.service.spec.ts`, `finance-tools.service.spec.ts`, `contract-payment.service.early-payoff-exec.spec.ts`, `credit-check.risk-score.spec.ts`, `mdm-auto.service.spec.ts`, `payment-method-config.service.spec.ts`, `paysolutions.callbacks.spec.ts`, `pdpa.service.spec.ts`, `purchase-orders.create.spec.ts`, `reports.service.portfolio.spec.ts` |
| New utility | `apps/api/src/utils/late-fee.util.ts` |
| Modified production code (3) | `finance-tools.service.ts`, `finance-receivable.dto.ts`, `tool-executor.ts` |
| Deleted (dead code) | `bank-reconciliation.service.ts` + `.spec.ts` |
| E2E exclusion | `approval-workflow.e2e-spec.ts` (added comment + testPathIgnorePatterns entry) |
| Env validation | `env-validation.spec.ts` (extended) |

---

## Issues by Severity

### Critical — None ✅

No security regressions found:
- No new controllers without `@UseGuards(JwtAuthGuard)`.
- No `$queryRaw` with unparameterized input.
- No hardcoded secrets or API keys.
- No `Float`/`Int` used for stored money values.
- No missing `@Roles()` decorators.

### Warning — None ✅

- `@Max(1)` correctly added to `commissionRate` in `UpdateFinanceReceivableDto` to prevent negative `netExpectedAmount`.
- `BankReconciliationService` removal confirmed safe: zero references in any controller or service after grep. Removed from module providers + exports cleanly.
- E2E exclusion is correctly documented with issue reference (#1192) and a clear path to re-enable.

### Info

**1. `Number()` conversions in `finance-tools.service.ts` (intentional)**

```ts
feePerDay: perDayCfg ? Number(perDayCfg.value) : LATE_FEE_PER_DAY,
flatCap: capCfg ? Number(capCfg.value) : 1500,
const totalFine = Number(computeCappedLateFee({ ... }));
```

These are `Number()` calls on SystemConfig string values for chatbot tool responses. The service is intentionally designed to return plain JS numbers for JSON serialization to Claude (`"ตัวเลขเป็น number ไม่ใช่ Decimal — convert ก่อน return"`). The actual calculation uses `Prisma.Decimal` throughout `computeCappedLateFee`. No DB writes use these `Number()` values. **Pattern is consistent with the rest of the file and acceptable here.**

**2. `computeCappedLateFee` correctly uses `Prisma.Decimal`**

The new utility (`late-fee.util.ts`) performs all arithmetic with `Prisma.Decimal` and uses `ROUND_HALF_UP` on the final result. This is the single source of truth for the per-installment late fee ceiling — fixes a real bug where the LIFF chatbot was quoting uncapped fees (e.g. 3,000฿ quoted vs 100฿ actually charged).

**3. Pre-existing payment queries without `deletedAt: null`**

`finance-tools.service.ts` lines 39–45, 108–116, 197–205 query `Payment` without `deletedAt: null`. These are **pre-existing** (not introduced by this branch) and out of scope here.

---

## Positive Findings

- New test coverage is high-quality: golden/characterization tests for regulated money paths (early-payoff, paysolutions callbacks, credit risk scoring, MDM auto-lock).
- `computeCappedLateFee` is well-designed: `Prisma.Decimal` throughout, edge cases handled (days ≤ 0, optional percentage cap).
- Removing dead `BankReconciliationService` is a clean reduction of dead code.
- The `commissionRate @Max(1)` fix prevents a silent negative-receivable data corruption bug.

---

## Recommendation: ✅ APPROVE

All changes are either test additions, dead-code removal, or targeted production fixes with no security regressions. No Critical or Warning issues found. Safe to merge.
