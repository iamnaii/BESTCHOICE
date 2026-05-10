# Pre-Merge Guard Report

**Branch**: `feat/ecl-stage-reverse`
**Author**: Akenarin Kongdach
**Date**: 2026-05-10
**Reviewer**: Pre-Merge Guard (automated)
**Base**: `feat/receipt-rt-format-and-partial` (stacked on receipt-rt branch)

---

## Summary

4 commits unique to this branch beyond `feat/receipt-rt-format-and-partial`:

| Hash | Message |
|------|-------|
| `4760df86` | test(payments): add BadDebtService mock to 3 PaymentsService specs |
| `2480b58b` | fix(accounting): drop @Optional + Decimal compare + concurrency test (review #787) |
| `06304867` | feat(payments): wire ECL stage reverse + tests (CPA Policy A §3.6) |
| `df41d09c` | feat(accounting): ECL stage reverse template + post-payment trigger (CPA Policy A §3.6) |

Total diff vs `main`: 10 files, +543 lines.

## Files Changed

| File | Change |
|------|------|
| `apps/api/src/modules/accounting/bad-debt.service.ts` | Core ECL reverse logic + Decimal helper |
| `apps/api/src/modules/accounting/bad-debt.service.spec.ts` | +142 lines — 8 new tests for `reverseStageOnPayment` |
| `apps/api/src/modules/journal/cpa-templates/ecl-stage-reverse.template.ts` | New JE template |
| `apps/api/src/modules/journal/cpa-templates/ecl-stage-reverse.template.spec.ts` | Template unit tests |
| `apps/api/src/modules/payments/payments.service.ts` | Hook into `reverseStageOnPayment` post-payment |
| `apps/api/src/modules/payments/payments.service.spec.ts` | BadDebtService mock added |
| `apps/api/src/modules/payments/payments.module.ts` | BadDebtModule import added |

---

## Issues Found

### Critical — None

- No new controllers — no guard check needed
- Money arithmetic uses `Prisma.Decimal` throughout; `const D = (n) => new Prisma.Decimal(n)` helper in spec follows v4 mandate
- All queries include `deletedAt: null` — provision lookup: `where: { contractId, status: 'ACTIVE', deletedAt: null }`
- No hardcoded secrets or API keys
- No unparameterized `$queryRaw`

### Warning — None

- `reverseStageOnPayment` is called non-blocking (`Promise.resolve().then(...)`) from `PaymentsService` — consistent with existing `checkPromiseAfterPayment` pattern; fire-and-forget with internal catch + Sentry, so payment commit is not held
- ECL template wired into `BadDebtModule` properly; `payments.module.ts` imports `BadDebtModule` to resolve dependency

### Info

1. **`badDebtProvision.findFirst` + `.update` added** but `findMany` path unchanged — the reverse only touches the *most recent active* provision row for a contract. If a contract somehow has two `ACTIVE` rows (shouldn't happen under normal flow), only the first is reversed. Low risk given idempotency guards.

2. **Non-blocking post-payment hook**: ECL reversal errors are Sentry-captured but don't surface to the caller. This is intentional (payment must not fail due to provisioning side-effects) but means a bad ECL run is invisible to the operator until they check Sentry.

---

## Recommendation: **APPROVE**

Implementation follows the CPA Policy A §3.6 spec cleanly. Decimal precision is maintained, test coverage is comprehensive (8 unit + template spec), and the fire-and-forget pattern is consistent with existing hooks. No blocking issues.
