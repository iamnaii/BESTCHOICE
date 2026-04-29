# Pre-Merge Guard Report: feat/ai-cost-tracking-budget
**Date**: 2026-04-29  
**Reviewer**: Pre-Merge Guard Agent  
**Recommendation**: 🔴 BLOCK

---

## Branch Summary

| Field | Value |
|-------|-------|
| Branch | `feat/ai-cost-tracking-budget` |
| Unique commits ahead of main | 57 commits ahead, 57 commits behind |
| Files changed (TS/TSX) | 979 |
| New modules | `exchange/`, `overdue/crons/broken-promise.cron.ts`, `CreditChecksPage/` |

### Top commits
- `feat(ai-usage)`: per-call cost tracking + daily budget alert (Sprint 5b)
- `feat(webhook-security)`: centralized webhook anomaly log + spike cron (Sprint 5a)
- `feat(broadcast)`: two-person approval + SoD (Sprint 4b)
- `feat(settings)`: audit trail + secret redaction in SystemConfig (Sprint 4a)
- `feat(trade-in)`: enforce ±15% price ceiling vs valuation table (Sprint 3c)

> **Important context**: This branch diverged from `main` 57 commits ago. Many "removals" in the diff are features that exist in `main` but are absent from this branch — these are regressions, not intentional deletions.

---

## Critical Issues (must fix before merge)

### C-1 · Broadcast SoD approval gate removed (regression vs main)

`broadcast.service.ts` and `broadcast.controller.ts` are missing the two-person approval gate that exists in `main`. In `main`, broadcasts to >1,000 recipients or containing legal trigger words (ยึด/ฟ้อง/คดี/ทวง/ดำเนินคดี/ศาล) require a second OWNER to approve before sending. This branch would allow a single OWNER to blast 5,000 customers with legally sensitive debt-collection language without a second authorization.

**Fix**: Rebase onto `main` to restore the SoD broadcast approval logic, or cherry-pick the relevant commit.

---

### C-2 · Webhook anomaly logging removed (regression vs main)

`FacebookWebhookController` in this branch drops `WebhookAnomalyService` injection. In `main`, HMAC failures and missing `rawBody` events are recorded to the anomaly log and Sentry. The branch replaces the `rawBody`-missing 500 escalation path with a plain 400, removing all security telemetry for webhook tampering.

**Fix**: Rebase onto `main` to restore `WebhookAnomalyService` injection and the anomaly recording path.

---

### C-3 · `Number()` on Decimal money fields in `ExchangeService` DB writes

`exchange.service.ts` (new file) converts `Prisma.Decimal` values to JS `number` for financial calculations and DB writes:
- `const sellingPrice = Number(newPrice.amount)` — stored in contract record
- `const outstandingBalance = Number(outstandingDecimal)` — passed into installment calculator
- `amountDue: amount` (JS number) → `Payment.amountDue` (`@db.Decimal(12,2)`)

Intermediate arithmetic (`financedAmount - monthlyPayment * (totalMonths - 1)`) runs as JS float on currency values. Project rule: use `Prisma.Decimal` for all money fields.

**Fix**: Replace all `Number()` casts in `exchange.service.ts` with `Prisma.Decimal` arithmetic. Use `.toNumber()` only at the final JSON serialization boundary.

---

### C-4 · `AiUsageController` and admin read endpoints removed (regression vs main)

Despite the branch commit message claiming "per-call cost tracking + daily budget alert," the branch strips `AiUsageService.getSummary()`, `getBreakdown()`, `getDailyTrend()`, `getLogs()`, and the entire `AiUsageController`. The branch has only a stripped `record()` method with no admin visibility endpoints. Finance managers and owners lose the ability to review AI usage costs.

**Fix**: Rebase onto `main` to restore the `AiUsageController` OWNER-guarded read endpoints.

---

## Warning Issues (should fix before merge)

### W-1 · `overrideReason` minimum length weakened in credit-check DTO

`OverrideCreditCheckDto.overrideReason` uses `@MinLength(10)` in this branch vs `@MinLength(20)` in `main`. The test suite was updated to pass shorter strings that would fail under main's rule. This weakens the audit trail quality for credit-check overrides.

**Fix**: Restore `@MinLength(20)` on `overrideReason`.

---

### W-2 · Trade-in PII role-masking removed

`trade-in.controller.ts` drops `applyRoleMask` helper and `PiiAuditService` injection. In `main`, `BRANCH_MANAGER` and `SALES` users see bank account numbers (`transferAccountNumber`) masked. This branch would expose full account numbers to those roles.

**Fix**: Restore `applyRoleMask` and `PiiAuditService` in the trade-in controller.

---

### W-3 · Credit-check idempotency tests removed

The `createForCustomer — idempotency` test suite (30-second dedup protection) is removed from `credit-check.service.spec.ts`. The underlying service logic may also have been removed — this needs verification.

**Fix**: Confirm idempotency logic is present in the service and restore test coverage.

---

### W-4 · Overdue controller endpoints slimmed significantly

~60 lines of injection and endpoints (queue, KPI, MDM, timeline, bulk, analytics, snooze, auto-balance) are absent from the branch's `OverdueController`. These endpoints are active in `main` and likely in use.

**Fix**: Rebase to restore the missing endpoints.

---

### W-5 · `ai-settings` controller absent (regression vs main)

The `ai-settings.controller.ts` (with OWNER-guarded read/write for AI model configuration) is absent from this branch. AI settings management is inaccessible if this branch is merged.

---

## Info

| # | Note |
|---|------|
| I-1 | `broken-promise.cron.ts` is well-implemented: correct `deletedAt: null`, idempotency via `brokenAt: null` guard, Sentry capture, batch limit 500, Asia/Bangkok timezone |
| I-2 | `exchange.controller.ts` has correct `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and `@Roles` on all methods |
| I-3 | Frontend mutations (`CreditChecksPage`, `ExchangePage`) use `useQueryClient` with `invalidateQueries` in `onSuccess` |
| I-4 | No hardcoded secrets found |
| I-5 | No unparameterized `$queryRaw` found |

---

## Recommendation: 🔴 BLOCK

**Primary reason**: This branch is 57 commits behind `main` and merging it would revert multiple deliberately-built security controls:
- Broadcast SoD approval (C-1)
- Webhook anomaly telemetry (C-2)
- PII masking on trade-in (W-2)
- AI cost admin visibility (C-4)

**Additionally**: `Number()` on Decimal money fields (C-3) violates an explicit v4 hardening rule.

**Recommended path**: Do not attempt to forward-merge `main` into this branch — the conflict surface is too large. Instead:
1. Identify which Sprint 3a–5b features are not yet in `main`
2. Cherry-pick those specific commits onto a fresh branch from `main`
3. Fix `Number()` Decimal violations in `exchange.service.ts`
4. Re-review
