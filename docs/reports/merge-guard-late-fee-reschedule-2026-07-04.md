# Merge Guard Report — fix/late-fee-split-reschedule-collect-first

**Date**: 2026-07-04  
**Branch**: `fix/late-fee-split-reschedule-collect-first`  
**Author**: akenarin.ak@gmail.com  
**Commits**: 1 (large feature commit)  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

33 files changed, 2244 insertions(+), 273 deletions(-)

| Area | Files |
|------|-------|
| API (new service) | `reschedule-collect.service.ts` (424 lines) |
| API (controllers) | `payments.controller.ts` (+2 new routes) |
| API (services) | `reschedule.service.ts`, `payments.service.ts`, `payment-journal-preview.service.ts` |
| API (paysolutions) | `paysolutions.service.ts`, `paysolutions-confirmation.service.ts`, `paysolutions-intent.service.ts` |
| API (journal) | `payment-receipt.template.ts`, `reconstruct-prior.ts`, `split-receipt.ts` |
| API (LINE) | `reschedule-qr.flex.ts` |
| API (util) | `reschedule-quote.util.ts` |
| Prisma | `schema.prisma` (+2 fields on PartialPaymentLink), migration |
| Web | `RescheduleOverlay.tsx` (546 lines on branch vs 292 at merge-base) |
| Tests | 304-line spec for RescheduleCollectService, +91 controller tests, +104 util tests |

Key features:
- **Reschedule collect-first flow**: customer pays ค่าธรรมเนียม (reschedule fee) via QR before due-date shift executes — atomicity via `PartialPaymentLink.purpose='RESCHEDULE'` + PaySolutions webhook
- **`RescheduleCollectService`**: server-authoritative quote, frozen in QR metadata, executed on webhook confirmation
- **`reschedule-quote.util.ts`**: shared fee calculation between controller (quote endpoint) and service (execution), ensuring they agree
- Removes the write-only `installmentSchedule.amountDue` reduction (review C1 fix)
- QR flow for reschedule via `POST /payments/:id/reschedule-qr`

---

## Issues Found

### Critical — None

### Warning

**W1 — `Number(link.amount)` → `d(input.amount)` precision round-trip**

File: `apps/api/src/modules/paysolutions/services/paysolutions-confirmation.service.ts:49`

```ts
amount: Number(link.amount),  // link.amount is Prisma.Decimal
```

This converts a `Prisma.Decimal` → `number` → passed to `RescheduleCollectInput.amount: number` → wrapped back as `d(input.amount)` inside the service. For `@db.Decimal(12,2)` values, float64 is sufficient precision (no loss at 2dp), but the round-trip obscures intent. The amount is validated inside the service via `d(input.amount).minus(q.collectAmount).abs() <= tolerance`, so a mismatch would surface — but it would be a runtime error rather than a compile-time guarantee.

**Recommendation**: Change `RescheduleCollectInput.amount` to `Prisma.Decimal` and pass `link.amount` directly. The `executeWithCollect` function already works with `d()` internally, so the signature change is mechanical.

---

**W2 — `paysolutions-confirmation.service.ts` Sentry extra uses `Number(link.amount)`**

File: `apps/api/src/modules/paysolutions/services/paysolutions-confirmation.service.ts:70`

```ts
extra: { ..., amount: Number(link.amount) }
```

Minor: Sentry logging should use `link.amount.toString()` for precision consistency (as done on line 18 of the same file).

---

### Info

- **No integration test for the full webhook→reschedule-execute path** — the `RescheduleCollectService` has 304 lines of unit tests and the paysolutions callbacks have 67 new lines, but there is no E2E or integration test that fires a real PaySolutions webhook mock and verifies the reschedule executes end-to-end. Acceptable for a fix branch, but flag for backlog.
- **`RescheduleOverlay.tsx` grew from 292→546 lines** — within acceptable range but worth tracking.

---

## Security Checks

| Check | Result |
|-------|--------|
| New endpoints have `@Roles()` | ✅ Pass — `GET /payments/reschedule-quote` and `POST /payments/:id/reschedule-qr` both decorated |
| `JwtAuthGuard` class-level | ✅ Pass — inherits from existing class guard on PaymentsController |
| `Number()` on money in calculations | ⚠️ W1 — `Number(link.amount)` on confirmation path (precision safe at 2dp but fragile) |
| Missing `deletedAt: null` | ✅ Pass — all new queries include it |
| Raw `fetch()` in frontend | ✅ Pass — uses `api.get()` / `api.post()` |
| `invalidateQueries` after mutations | ✅ Pass — existing helpers invoked |
| Hardcoded secrets | ✅ Pass — none found |
| `$queryRaw` (SQL injection) | ✅ Pass — only in test mocks |
| Prisma migration safe for prod | ✅ Pass — `ADD COLUMN IF NOT EXISTS`, both columns nullable/defaulted; no data migration needed |
| Thai validation messages on new DTOs | ✅ Pass — `CreateRescheduleQrDto` has Thai messages |
| Atomicity of reschedule execution | ✅ Pass — `RescheduleCollectService.executeWithCollect` wraps JE + advance + reschedule in `$transaction`; webhook path uses same service |
