# Merge Guard Report — fix/late-fee-split-reschedule-collect-first

**Date**: 2026-07-04  
**Branch**: `fix/late-fee-split-reschedule-collect-first`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main**: 1  
**Last commit**: `893c2a89` — fix(payments): fee-first late-fee split + reschedule collect-first (ปรับดิว)

---

## File Changes Summary

33 files changed — 2,244 insertions, 273 deletions.

| Area | Key Files |
|------|-----------|
| Prisma schema + migration | `schema.prisma`, `migrations/20260979000000_partial_link_purpose_metadata/` |
| Core accounting | `split-receipt.ts`, `reconstruct-prior.ts` (extracted from `payment-receipt.template.ts`) |
| New service | `payments/services/reschedule-collect.service.ts` (+424 lines) |
| Payments controller | `payments.controller.ts` — new `GET /reschedule-quote`, `POST /:id/reschedule-qr` endpoints |
| PaySolutions | `paysolutions-confirmation.service.ts`, `paysolutions-intent.service.ts` — RESCHEDULE QR webhook path |
| LINE OA | `flex-messages/reschedule-qr.flex.ts` — new "ใบแจ้งชำระปรับดิว" flex |
| Tests | `split-receipt.spec.ts`, `reschedule-collect.service.spec.ts` (+304 lines), `payments.controller.spec.ts` |
| Frontend | `RescheduleOverlay.tsx` (major rewrite), `PaymentHistorySheet.tsx`, `MobileReceipt.tsx`, etc. |

### Key Architectural Changes
- **Fee-first allocation**: `splitReceipt()` now books `Cr 42-1103` (late fee) before `Cr 11-2103` (principal). Owner directive 2026-07-02.
- **`reconstructPriorCleared()`** extracted from `PaymentReceiptTemplate` into a shared module so preview and posting use identical logic.
- **`RescheduleCollectService`**: new atomic service combining collect JE + late-fee reset + date shift in one `$transaction`.
- **Schema**: `PartialPaymentLink` gains `purpose` (INSTALLMENT | RESCHEDULE) + `metadata` JSONB for frozen quote.
- **RescheduleService.execute()** accepts an optional `outerTx` to participate in a caller's transaction.

---

## Issues

### ⚠️ Warning — Decimal convention violated in RESCHEDULE QR webhook path

**File**: `apps/api/src/modules/paysolutions/services/paysolutions-confirmation.service.ts` (approx. line 209)

```ts
await this.paymentsService.rescheduleWithCollect({
  ...
  amount: Number(link.amount),   // ← Warning: link.amount is Prisma Decimal
```

`link.amount` is typed `Decimal @db.Decimal(12, 2)` in the schema. Converting it via `Number()` violates the project convention ("ใช้ Decimal เท่านั้น, ห้ามใช้ Float"). The same `amount` value is also echoed into the Sentry `extra` payload as `Number(link.amount)` (logging only — no financial impact).

**Why not Critical**: `RescheduleCollectInput.amount` is used only for validation (`d(input.amount).minus(q.collectAmount).abs() ≤ 0.01`) — the actual JE booking amount comes from the server-computed `q.collectAmount`, not from `input.amount`. For THB amounts at the scale of phone installments, `Number(Decimal)` precision is not compromised. However, the interface should be `amount: number` sourced from `link.amount.toNumber()` not `Number(link.amount)` — same result, but explicit intent. Or ideally change `RescheduleCollectInput.amount` to `string` and pass `link.amount.toString()`.

**Suggested fix** (`paysolutions-confirmation.service.ts`):
```ts
amount: link.amount.toNumber(),  // explicit — link.amount is Decimal @db.Decimal(12,2)
```

---

### ⚠️ Warning — RescheduleOverlay canSubmit missing `!needSlip` (TRANSFER path)

**File**: `apps/web/src/pages/PaymentsPage/components/RescheduleOverlay.tsx` (approx. line 197)

```ts
const canSubmit = days >= 1 && !isPending && !quoteLoading && !!quote && !needRef;
// ← needSlip (TRANSFER requires slip) is not included
```

The companion branch `fix/reschedule-qa-test-slip-contract` adds `!needSlip` to `canSubmit` and the slip upload UI. **These two branches must be merged in order**: late-fee branch first, then the QA test/slip branch. If the QA test branch is merged without the late-fee branch, or if the late-fee branch is cherry-picked alone to production, TRANSFER payments will not enforce the slip requirement.

**This is not a code defect in isolation** — the QA branch patches this. Ensure merge order is documented.

---

### ℹ️ Info — External QR image service in LINE flex message

**File**: `apps/api/src/modules/line-oa/flex-messages/reschedule-qr.flex.ts` (line 9)

```ts
const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?...`;
```

`api.qrserver.com` is used to generate QR images inline in the LINE flex message. This is consistent with existing flex templates in the codebase (other templates use the same service). It is a third-party dependency: if that service is unavailable, the LINE OA message will show a broken image. Not a blocking concern, but worth noting for infra resilience.

---

### ℹ️ Info — Migration timestamp anomaly

**File**: `migrations/20260979000000_partial_link_purpose_metadata/migration.sql`

The migration timestamp `20260979000000` contains `79` for month, which is physically impossible (months 01-12 only). This is a cosmetic issue — Prisma uses timestamps only for ordering and uniqueness, so the migration will apply correctly. But it will look odd in `prisma migrate status` output.

---

## Positive Notes

- `RescheduleService.execute()` outer-transaction pattern is clean — no behaviour change when `outerTx` is absent.
- The fee-first allocation change in `split-receipt.ts` has thorough test coverage (4 new cases in `split-receipt.spec.ts`).
- `reconstructPriorCleared()` is now shared between posting and preview — eliminates the drift risk that existed before.
- `paysolutions-confirmation.service.ts` correctly handles the EXPIRED link + success webhook case with a fatal Sentry alarm.
- New `@Roles` decorators on both new endpoints are correct.
- Soft-delete filters (`deletedAt: null`) are present on new queries.
- No hardcoded secrets or SQL injection risks found.
- DTO (`CreateRescheduleQrDto`) has proper class-validator decorators with Thai error messages.
- Frontend mutations call `invalidateAll()` on success (correctly abstracted).

---

## Recommendation: ⚠️ REVIEW

Fix the `Number(link.amount)` → `link.amount.toNumber()` convention before merge. Document and enforce the merge order with `fix/reschedule-qa-test-slip-contract` (TRANSFER slip validation depends on it). Everything else is sound — the financial logic, atomicity, and test coverage are high quality.
