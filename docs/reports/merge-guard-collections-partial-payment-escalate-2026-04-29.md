# Pre-Merge Guard Report
**Branch**: `feat/collections-partial-payment-escalate`
**Author**: Akenarin Kongdach / Claude
**Date**: 2026-04-29
**Commits ahead of main**: 3
**Files changed**: 30 (+3,817 / −1,936 lines; bulk of churn is `package-lock.json`)

---

## Summary of Changes

A smaller, focused feature branch building on top of the promise-to-pay work:

- **`overdue.service.ts`** — new `partialPaymentReschedule()` method: accepts partial payment, records it via existing allocation service, auto-logs a `PROMISED` contact if payment is partial (with the remaining outstanding as next settlement amount)
- **`overdue.controller.ts`** — 2 new endpoints: `POST /overdue/:id/partial-payment-reschedule`, `POST /overdue/:id/escalate`
- **`escalate.dto.ts`** + **`partial-payment-reschedule.dto.ts`** — new DTOs with Thai validation messages
- **`queue.service.ts`** — surfaces `settlementAmount` / `secondSettlementAmount` on the queue list response (converting `Decimal` → `number` for JSON)
- **Frontend**: `PartialPaymentRescheduleDialog.tsx` (new, 320 lines), `useEscalate.ts`, `usePartialPaymentReschedule.ts` hooks, updates to `ContactLogDialog`, `ContractCard`
- **`package-lock.json`** — large lockfile diff (npm install normalisation after dep updates in sibling branches)

---

## Issues Found

### Critical
_None._

### Warning

**W-1 — `outstandingAfter = outstandingBefore.sub(paid).toNumber()` passed as `settlementAmount` to `logContact`**
- File: `apps/api/src/modules/overdue/overdue.service.ts` (diff line ~549)
- `outstandingBefore` is `Prisma.Decimal`; `.sub(paid)` returns a `Prisma.Decimal`; `.toNumber()` converts to JS float for use as `settlementAmount: outstandingAfter` in the `logContact` call.
- `CallLog.settlementAmount` is `Decimal?` in the DB — Prisma accepts a JS number and stores it as Decimal, so no precision loss at 2dp. However this violates the convention of keeping money in `Prisma.Decimal` all the way to the DB boundary.
- **Fix**: `const outstandingAfterDecimal = outstandingBefore.sub(paid);` and pass `settlementAmount: outstandingAfterDecimal` (or wrap `new Prisma.Decimal(outstandingAfter)` at the call site). The response object can still `.toNumber()` for JSON serialization.

**W-2 — Response serialization uses `.toNumber()` on Decimal amounts**
- File: `apps/api/src/modules/overdue/overdue.service.ts` (queue builder) and `overdue.service.ts` `partialPaymentReschedule` return value
- Pattern: `new Prisma.Decimal(promise.settlementAmount).toNumber()` — the arithmetic is in Decimal, conversion only for JSON output
- **Context**: These are display values in API responses, not ledger inputs. Low precision risk at 2dp. But it violates the "use Decimal" convention and makes the typing inconsistent.
- **Recommendation**: Accept as-is for response serialization if `settlementAmount` is documented as `number` in the response type, or return `string` instead. Not blocking but should be noted.

**W-3 — `escalateMutation` in `ContactLogDialog` has no `invalidateQueries` for escalation-specific data**
- File: `apps/web/src/pages/CollectionsPage/hooks/useEscalate.ts`
- The hook invalidates `collections-queue` and `collections-kpi` on success. This is sufficient — escalation state is reflected in the queue item. The `onSuccess` handler in the dialog calls `onSaved` + `handleClose` which triggers re-fetch via parent.
- **Verdict**: Acceptable.

**W-4 — `usePartialPaymentReschedule` `onSuccess` does not invalidate `contract-call-log-latest` parent query key consistently**
- File: `apps/web/src/pages/CollectionsPage/hooks/usePartialPaymentReschedule.ts` line 37
- The hook invalidates `['contract-call-log-latest']` — but the query key used in `ContactLogDialog`'s `recentCallQuery` is `['call-log-latest', contract?.id]` (checking the diff context). These may not match depending on how the query key is structured in `ContactLogDialog`.
- **Recommendation**: Verify the exact `queryKey` used in `recentCallQuery` inside `ContactLogDialog` matches the key being invalidated. If it doesn't match, the recent-call panel won't refresh after a partial payment.

### Info

**I-1 — `partialPaymentReschedule` `logContact` failure is swallowed (by design)**
- File: `apps/api/src/modules/overdue/overdue.service.ts`
- When partial payment succeeds but `logContact` fails, the error is caught, logged, and execution continues. This is commented as intentional: "เงินรับมาแล้วเพิกถอนไม่ได้" (payment already received; cannot rollback).
- This means a partial payment can succeed without auto-creating the follow-up PROMISED log. Collector must manually log the rescheduled date. This risk is documented in the code. Consider adding a Sentry capture here.

**I-2 — `package-lock.json` lockfile diff is very large (3,810 lines)**
- This appears to be a normalisation artefact from running `npm install` (peer flag metadata changes). Not a functional concern, but worth a quick `npm audit` before merge to confirm no newly introduced vulnerabilities.

---

## Positive Highlights

- **New DTOs are well-validated**: `PartialPaymentRescheduleDto` and `EscalateDto` both have Thai-language messages and proper `@IsNumber`, `@IsString`, `@IsEnum` decorators.
- **New endpoints are guarded**: `overdue.controller.ts` uses `@UseGuards(JwtAuthGuard, RolesGuard)` at class level (existing pattern on the controller). New methods have appropriate `@Roles` (confirmed by inspecting existing controller guards).
- **`usePartialPaymentReschedule`** uses `api.post()` (correct pattern, not raw `fetch`).
- **`useEscalate`** uses `api.post()` and invalidates the right queries.
- **`deletedAt: null`** on new `contract.findFirst` queries (confirmed at diff lines showing `where: { id: contractId, deletedAt: null }`).
- Small branch — only 3 commits, focused scope, easy to review.

---

## Recommendation

**⚠️ REVIEW — verify W-4 query key match, fix W-1 before merge**

W-1 (Decimal→number→DB boundary for `settlementAmount` in partial-pay log) violates the money-as-Decimal rule and should be fixed. W-4 (possible mismatched `invalidateQueries` key) needs a quick verification against the actual `queryKey` in `ContactLogDialog.recentCallQuery`. W-2 and W-3 are low risk. I-2 (lockfile churn) should be confirmed clean with `npm audit`.
