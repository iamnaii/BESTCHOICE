# Merge Guard Report: fix/late-fee-split-reschedule-collect-first

**Date**: 2026-07-05  
**Branch**: `fix/late-fee-split-reschedule-collect-first`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 1 (2026-07-02)  
**Diff**: 33 files changed, +2,244 / -273  

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | +8 (new `purpose` + `metadata` fields on `PartialPaymentLink`) |
| `apps/api/prisma/migrations/*/migration.sql` | +7 |
| `apps/api/src/modules/installments/reschedule.service.ts` | +38 |
| `apps/api/src/modules/journal/payment-receipt.template.ts` | -88 (refactor) |
| `apps/api/src/modules/journal/reconstruct-prior.ts` | +88 (new utility) |
| `apps/api/src/modules/journal/split-receipt.ts` | +13 |
| `apps/api/src/modules/payments/payments.controller.ts` | +124 (2 new endpoints) |
| `apps/api/src/modules/payments/payments.service.ts` | +19 |
| `apps/api/src/modules/payments/services/payment-journal-preview.service.ts` | +114 |
| `apps/api/src/modules/payments/services/reschedule-collect.service.ts` | +424 (new service) |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | +18 |
| `apps/api/src/modules/paysolutions/services/paysolutions-confirmation.service.ts` | +62 |
| `apps/api/src/modules/paysolutions/services/paysolutions-intent.service.ts` | +184 |
| `apps/api/src/utils/reschedule-quote.util.ts` | +54 (new utility) |
| `apps/web/src/pages/PaymentsPage/components/RescheduleOverlay.tsx` | +362 (QR path) |
| Test files (7) | +700+ |

---

## Issues Found

### Critical
_None found._

### Warning

**W1 — `Number(link.amount)` in `paysolutions-confirmation.service.ts` (2 occurrences)**  
`link.amount` is `Decimal @db.Decimal(12, 2)` from the DB. It is cast to JS `number` before being passed to `rescheduleWithCollect()` whose `RescheduleCollectInput.amount` is typed `number`. Inside the service, `d(input.amount)` (from `decimal.util`) immediately wraps the value back into `Prisma.Decimal` for all arithmetic — so there is no loss of precision in the accounting path.

However, converting `Decimal(12,2)` → `number` → `Decimal` is a code-smell that conflicts with the project rule "use `Prisma.Decimal`, never `Number()` on money fields." Consider changing `RescheduleCollectInput.amount` to `number | Prisma.Decimal` or `string`, eliminating the `Number()` cast entirely. As coded it will not cause a mis-calculation (12,2 fits in JS float precision for realistic amounts), but it breaks the convention and will trip the future linter rule.

**W2 — Large files (several pre-existing)**

| File | Lines |
|------|-------|
| `apps/api/src/modules/paysolutions/services/paysolutions-intent.service.ts` | 808 |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | 1,691 |
| `apps/web/src/pages/PaymentsPage/components/RescheduleOverlay.tsx` | 546 |
| `apps/api/src/modules/payments/payments.service.ts` | 600 |
| `apps/api/src/modules/payments/payments.controller.ts` | 545 |

`paysolutions-intent.service.ts` is a new 808-line file. It may benefit from decomposition in a follow-up (e.g. split `createPartialQrLink` and `createRescheduleQrLink` into separate sub-services), but it is not blocking in current form.

### Info

**I1 — New `GET /payments/reschedule-quote` + `POST /payments/:id/reschedule-qr` endpoints**  
Both are on `PaymentsController` which has class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`. Both new methods carry explicit `@Roles(...)` decorators. Guards are correctly applied.

**I2 — `CreateRescheduleQrDto` validation**  
`daysToShift` has `@IsNumber()` + `@Min(1)` with Thai message. `splitMode` has `@IsString()` + `@IsIn(['SINGLE', 'SPLIT'])` with Thai message. Complete.

**I3 — Prisma schema: new fields on `PartialPaymentLink`**  
`purpose String @default("INSTALLMENT")` and `metadata Json?` are backward-compatible (both have defaults/nullable). Migration SQL applies cleanly.

**I4 — Frontend RescheduleOverlay uses `invalidateAll()` pattern**  
`queryClient.invalidateQueries` fires for `contract`, `contracts`, `pending-payments`, and `pending-summary` on both `confirmMutation.onSuccess` and `qrMutation.onSuccess`. No cache gap.

**I5 — PaySolutions RESCHEDULE webhook path**  
`handlePartialPaymentCallback` correctly guards the RESCHEDULE path (`link.purpose === 'RESCHEDULE'`) and calls `rescheduleWithCollect` atomically. Sentry `fatal` capture on failure with a manual-reconciliation note is appropriate.

---

## Recommendation: ✅ APPROVE (with follow-up note)

No blocking issues. The branch delivers the reschedule-QR flow end-to-end with correct guards, DTO validation, Decimal arithmetic (via `decimal.util`), and cache invalidation. 

**Suggested follow-up (non-blocking):** Change `RescheduleCollectInput.amount` from `number` to accept `Prisma.Decimal | string` so the two `Number(link.amount)` calls can be removed and the codebase stays consistent with the `Prisma.Decimal` money convention.
