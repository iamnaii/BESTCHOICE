# Pre-Merge Guard Report

**Branch**: `fix/ci-pre-existing-test-failures`
**Date**: 2026-06-12
**Author**: Akenarin Kongdach <akenarin.ak@gmail.com>
**Base**: `origin/main` @ c215e303 (PR #1169)
**Commits ahead**: 7

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/e2e/approval-workflow.e2e-spec.ts` | Added exclusion comment; test now lives in `testPathIgnorePatterns` |
| `apps/api/e2e/jest-e2e.json` | Added `testPathIgnorePatterns` to exclude incomplete approval-workflow harness (#1192) |
| `apps/api/src/modules/accounting/accounting.module.ts` | Removed `BankReconciliationService` from providers + exports |
| `apps/api/src/modules/accounting/bank-reconciliation.service.spec.ts` | **Deleted** (dead test for deleted service) |
| `apps/api/src/modules/accounting/bank-reconciliation.service.ts` | **Deleted** (unwired service — confirmed dead by #1173) |
| `apps/api/src/modules/analytics/analytics.service.spec.ts` | New: 231-line characterization spec for revenue forecast + cohort retention |
| `apps/api/src/modules/chatbot-finance/services/finance-tools.service.spec.ts` | New: 92-line tests covering capped late-fee quote fix |
| `apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts` | Fix: `calculateFine` made async; late-fee now reads SystemConfig + applies cap |
| `apps/api/src/modules/chatbot-finance/tools/tool-executor.ts` | Fix: added missing `await` on now-async `calculateFine` |
| `apps/api/src/modules/contracts/contract-payment.service.early-payoff-exec.spec.ts` | New: 432-line golden spec for early payoff execution |
| `apps/api/src/modules/contracts/contract-signing-workflow.spec.ts` | Minor fix: 7 lines |
| `apps/api/src/modules/credit-check/credit-check.risk-score.spec.ts` | New: 473-line golden spec for risk scoring |
| `apps/api/src/modules/finance-receivable/dto/finance-receivable.dto.ts` | Fix: added `@Max(1)` to `commissionRate` |
| `apps/api/src/modules/finance-receivable/dto/finance-receivable.dto.spec.ts` | New: 32-line DTO validation tests |
| `apps/api/src/modules/mdm/mdm-auto.service.spec.ts` | New: 447-line golden spec for MDM auto-lock/unlock |
| `apps/api/src/modules/payment-method-config/payment-method-config.service.spec.ts` | New: 386-line characterization spec |
| `apps/api/src/modules/paysolutions/paysolutions.callbacks.spec.ts` | New: 530-line golden spec for webhook callbacks |
| `apps/api/src/modules/pdpa/pdpa.service.spec.ts` | New: 626-line spec for PDPA service |
| `apps/api/src/modules/purchase-orders/purchase-orders.create.spec.ts` | New: 309-line spec for PO creation |
| `apps/api/src/modules/reports/reports.service.portfolio.spec.ts` | New: 523-line golden spec for portfolio reports |
| `apps/api/src/utils/env-validation.spec.ts` | Updated: 19 lines |
| `apps/api/src/utils/late-fee.util.spec.ts` | New: 48-line spec for capped late-fee utility |
| `apps/api/src/utils/late-fee.util.ts` | **New**: canonical `computeCappedLateFee` utility using `Prisma.Decimal` |

**Total**: 23 files, +4,247 / -393 lines

---

## Issues

### Critical
_None_

### Warning

**W-1 — `Number()` on monetary config values in chatbot path**
- Files: `apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts` (lines `getLateFeeConfig`)
- `Number(perDayCfg.value)` and `Number(capCfg.value)` convert SystemConfig string values to JS `number` before passing to `computeCappedLateFee`.
- **Mitigating factors**:
  1. `computeCappedLateFee` internally wraps inputs via `new Prisma.Decimal(input.toString())` — precision is recovered inside the utility.
  2. These values are chatbot display/quote output (LINE LIFF), **not** journal-entry inputs. The actual payment recording path (`payments.service.recordPayment`) is independent.
  3. Typical values (15฿/day rate, 1500฿ cap) are safe from JS float precision loss.
- **Recommendation**: Not a blocker, but consider returning `Prisma.Decimal` from `getLateFeeConfig` for consistency with the rest of the codebase. The final `Number(computeCappedLateFee({...}))` wrapping for the chatbot JSON response is acceptable (display purpose).

### Info

**I-1 — `BankReconciliationService` deletion: verify no other callers**
- The service is removed from the `AccountingModule` providers/exports list and both files deleted.
- Confirmed no other module imports it (chore PR #1173 called this out explicitly).
- The deleted `BankLine.amount` field used bare `number` type — this is harmless since it's deleted.

**I-2 — `approval-workflow.e2e-spec.ts` excluded from test run**
- Tracked in #1192. The comment documents the reason (missing providers) and the conditions for re-enabling. Acceptable short-term skip with clear follow-up.

**I-3 — `computeCappedLateFee` uses `Prisma.Decimal.min(...caps)` spread**
- `Prisma.Decimal.min()` accepts rest args; behavior verified correct by accompanying tests. No issue.

---

## Security Checklist

| Check | Result |
|-------|--------|
| No new controllers | ✅ — Only service/util/test changes |
| Missing `@UseGuards` | ✅ — N/A (no new routes) |
| Missing `deletedAt: null` in new queries | ✅ — New `prisma.systemConfig.findUnique` query; `systemConfig` has no soft-delete field (by design — it's a key-value config table) |
| No raw `fetch()` | ✅ — N/A (backend only) |
| No hardcoded secrets | ✅ |
| `commissionRate @Max(1)` data guard | ✅ **Positive finding** — prevents negative `netExpectedAmount` from bad input |
| Missing `@Roles` | ✅ — N/A (no new endpoints) |
| SQL injection via `$queryRaw` | ✅ — No new raw queries; existing `$queryRaw` in `analytics.service` uses `Prisma.sql` template tag (parameterized) |

---

## Recommendation: ✅ APPROVE

Solid CI-repair branch: deletes unwired dead code, adds ~1,600 lines of characterization/golden tests across 10 modules, fixes an accounting data integrity gap (`@Max(1)` on commissionRate), and corrects a chatbot late-fee quote that was over-stating fines to customers. The single Warning (W-1) is a style concern only — chatbot display path, not accounting path — and does not block merge.
