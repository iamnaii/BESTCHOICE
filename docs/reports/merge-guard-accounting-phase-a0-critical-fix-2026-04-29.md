# Pre-Merge Guard Report
**Branch**: `feat/accounting-phase-a0-critical-fix`
**Author**: Akenarin Kongdach
**Date**: 2026-04-29
**Commits ahead of main**: 23
**Files changed**: 31 (+4,143 / −165 lines)

---

## Summary of Changes

- **`monthly-close.service.ts`** — F-6-003: hard-block `closePeriod` when `auditIssues.hasIssues=true`, OWNER-only `forceCloseReason` override with `PERIOD_FORCE_CLOSE` AuditLog. F-6-004: `reopenPeriod` now requires a new `ReopenPeriodDto` (boardResolutionId + reason ≥20 chars) and writes `PERIOD_REOPEN` AuditLog.
- **`accounting.service.ts`** — F-3-027 / F-1-016: `markExpensePaid` now includes branch's `companyId` in journal entry and removes the try/catch that silently swallowed JE failures (transaction now rolls back atomically).
- **`contract-payment.service.ts`** — F-3-027 follow-up: `resolveFinanceCompanyId()` helper ensures early-payoff JEs post under FINANCE, called before the transaction.
- **`contract-workflow.service.ts`** — F-1-002/F-2-003 fix: removed try/catch around `createContractActivationJournal` so activation rolls back if JE fails.
- **`journal-auto.service.ts`** — accepts explicit `companyId` param in `createPaymentJournal`, `createExpenseJournal`, `createContractActivationJournal`.
- **`paysolutions.service.ts`** — additional hardening around webhook processing.
- **E2E specs** — 3 new spec files: `accounting-contract-activation.spec.ts`, `accounting-paysolutions-webhook.spec.ts`, `accounting-period-close.spec.ts`.

---

## Issues Found

### Critical
_None._

### Warning

**W-1 — `Number()` on Decimal fields in E2E assertion code**
- Files: `apps/web/e2e/accounting-contract-activation.spec.ts` (×2), `accounting-paysolutions-webhook.spec.ts` (×2), `accounting-period-close.spec.ts` (×2)
- Pattern: `entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0)` — used to sum debit/credit amounts from API JSON response to verify balance.
- **Context**: This is test/E2E assertion code, not production financial calculation. The API serialises Decimal as strings; `Number()` here is for comparison arithmetic only — no ledger amounts are stored via this code path.
- **Verdict**: Acceptable in test context. No ledger precision risk. Zero production impact.
- **Recommendation**: Optionally replace with `parseFloat()` for clarity, but not blocking.

### Info

**I-1 — `closePeriod` role check is service-layer only (not controller-layer)**
- File: `apps/api/src/modules/accounting/monthly-close.service.ts:652`
- The `forceCloseReason` OWNER-only restriction is enforced inside the service via `if (forceCloseReason && userRole !== 'OWNER') throw ForbiddenException`. The controller passes `req.user.role` down. This is correct but slightly unusual — the controller allows `FINANCE_MANAGER` (via `@Roles`), and the service then restricts the override path. The design is intentional (force-close is a subset of close, gated at service level) and is tested.
- **Verdict**: Acceptable. Tests cover the non-OWNER rejection (see `monthly-close.service.spec.ts` line 440–471).

**I-2 — Large report file added to repo**
- File: `docs/plans/2026-04-29-accounting-phase-a0-critical-fix.md` (1,794 lines), `...-design.md` (284 lines)
- These are design/implementation docs. No code impact, but adds ~2k lines of markdown to the repo.

---

## Positive Highlights

- **Atomicity restored**: `markExpensePaid` JE failure now rolls back the expense status change (F-1-016 fix — previously silent try/catch left DB in diverged state).
- **Audit trail**: `PERIOD_FORCE_CLOSE` and `PERIOD_REOPEN` AuditLog entries written inside `$transaction` — if the transaction fails, no orphaned audit record is created.
- **OWNER-only override properly tested**: 3 test cases cover block/allow/non-OWNER-rejection for F-6-003.
- **`deletedAt: null`** present on all new production queries (confirmed).
- **`companyInfo.findFirst`** includes `deletedAt: null` (confirmed).
- Test additions: ~600 lines of new spec coverage.

---

## Recommendation

**✅ APPROVE**

No critical issues. Warning is test-only and has zero production impact. The accounting hardening fixes real audit findings (F-1-016, F-2-003, F-3-027, F-6-003, F-6-004) with appropriate atomicity and audit logging. Safe to merge.
