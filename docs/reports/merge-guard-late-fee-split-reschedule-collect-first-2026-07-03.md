# Merge Guard Report — fix/late-fee-split-reschedule-collect-first

**Date**: 2026-07-03  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: fix(payments): fee-first late-fee split + reschedule collect-first (ปรับดิว) — 31h ago  
**Base**: origin/main (4f0ef17f)

---

## File Changes Summary

33 files changed, +2244 / -273 lines

| Area | Key Files |
|------|-----------|
| Backend service | `reschedule-collect.service.ts` (424 lines, NEW) |
| Backend controller | `payments.controller.ts` (+124 lines) |
| Backend utils | `reschedule-quote.util.ts` (NEW), `split-receipt.ts` (+) |
| Frontend component | `RescheduleOverlay.tsx` (+362 lines, now 546 total) |
| PaySolutions webhook | `paysolutions-confirmation.service.ts`, `paysolutions-intent.service.ts` (NEW) |
| Journal templates | `payment-receipt.template.ts`, `reconstruct-prior.ts` |
| Tests | 6 new spec files covering reschedule-collect, split-receipt, quote util |
| Migration | `20260979000000_partial_link_purpose_metadata` |

---

## Issues

### Critical

None found.

### Warning

**W1 — `Number(link.amount)` on Decimal money field** (2 occurrences)  
File: `apps/api/src/modules/paysolutions/services/paysolutions-confirmation.service.ts`

```ts
amount: Number(link.amount),   // link.amount is Prisma Decimal(12,2)
extra: { ..., amount: Number(link.amount) }
```

`link.amount` is typed `Decimal @db.Decimal(12,2)` in Prisma schema. Converting to JS `number` loses precision for amounts > 2^53. In this context the first usage passes the value into `rescheduleWithCollect(amount: number)` — the service input type is `number`, so Decimal arithmetic is done internally after conversion. The second usage is for Sentry `extra` metadata only (no financial calculation).

**Risk**: Low for current amounts (phones rarely exceed ฿500,000) but inconsistent with project rule `@db.Decimal` → never `Number()`. The input type on `RescheduleWithCollectInput.amount` should be changed to `Prisma.Decimal` or `string` so the caller passes a Decimal directly.

**W2 — `RescheduleOverlay.tsx` at 546 lines (>500 line threshold)**  
File: `apps/web/src/pages/PaymentsPage/components/RescheduleOverlay.tsx`

The component grew from ~185 to 546 lines in this branch. Consider extracting the QR flow (`useRescheduleQr`) and the journal preview panel into sub-components or hooks to keep it maintainable.

**W3 — Raw `fetch()` in production hook for S3 presigned URL**  
File: `apps/web/src/hooks/useSlipUpload.ts`

```ts
const putRes = await fetch(presign.uploadUrl, { method: presign.method, body: file, ... });
```

This is the correct pattern for S3 presigned PUT (the URL is external, not our API), and the test correctly spies `globalThis.fetch`. Noted as Warning only because the project rule says "ห้ามใช้ raw `fetch()`" — this exception should be documented with a comment to prevent future linting confusion.

### Info

**I1 — New `paysolutions-intent.service.ts` is 184 lines**  
New file, reasonable size, but introduces the `purpose` field and metadata pattern for PaymentLink. Ensure existing tests cover the `RESCHEDULE` webhook path (the new spec `paysolutions.callbacks.spec.ts` is included — verify it tests the failure/Sentry path too).

**I2 — `installmentSchedule.findUnique` without `deletedAt` filter**  
In `reschedule-collect.service.ts`, `findUnique` by composite key `{contractId, installmentNo}` does not filter `deletedAt: null`. However, the unique key guarantees one row — acceptable pattern if deleted rows are never reused by the same `(contractId, installmentNo)` pair. Low risk but worth confirming this invariant holds.

---

## Recommendation

**REVIEW** — no blocker, but W1 (Number() on Decimal for financial input) should be discussed before merge. The rest are clean: guards are correctly wired, DTOs have Thai validation, Decimal arithmetic is used inside the service, and test coverage is solid (6 new spec files).
