# Merge Guard Report — fix/late-fee-split-reschedule-collect-first

**Date**: 2026-07-03  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits**: 1 (`fix(payments): fee-first late-fee split + reschedule collect-first (ปรับดิว)`)  
**Diff**: 33 files changed, 2244 insertions(+), 273 deletions(-)

---

## Summary of Changes

Core refactor of the installment rescheduling flow implementing two related fixes:

1. **Fee-first allocation** (`split-receipt.ts`): Late fee now books before principal on partial receipts. Adds 4 new unit tests confirming the ordering and preventing double-booking.
2. **Collect-first atomicity** (`reschedule-collect.service.ts`, new file): QR-payment + date-shift + late-fee reset now commit as a single `$transaction`. Previously these were separate operations that could leave the ledger in an inconsistent intermediate state.
3. **Refactor `reconstructPrior`** out of `PaymentReceiptTemplate` into `reconstruct-prior.ts` (shared module) — eliminates drift between the PARTIAL preview and what the template actually posts.
4. **`RescheduleService.execute` accepts `outerTx?`** — allows callers (e.g. `RescheduleCollectService`) to join an existing transaction rather than open a new one.
5. **Removed the `InstallmentSchedule.amountDue` reduction** (review C1) — that field was write-only; no billing path reads it. The CPA case-6a prepayment now flows through `Contract.advanceBalance`.

---

## Issues Found

### Critical
*None.*

### Warning

**W1 — `RescheduleCollectInput.amount` typed as `number`**  
File: `apps/api/src/modules/payments/services/reschedule-collect.service.ts:32`  
`amount` in the input interface is `number` (JS primitive), and the caller passes `Number(link.amount)`. This is acceptable **only because** the value is never written to the DB directly — it is used solely for a ±0.01 cross-validation against the server-authoritative `q.collectAmount` (`d(input.amount).minus(q.collectAmount).abs()`). All actual DB/JE writes use `q.collectAmount` which is `Prisma.Decimal`.  
**Verdict**: Low risk. Consider adding a JSDoc comment confirming the non-DB-write intent to prevent future misuse.

**W2 — `generateReceipt(...)` receives `.toNumber()`**  
File: `apps/api/src/modules/payments/services/reschedule-collect.service.ts:360`  
`d(txResult.quote.collectAmount).toNumber()` is passed to `receiptsService.generateReceipt()`. If `ReceiptsService.generateReceipt()` takes a `number` and writes it to the DB without re-wrapping in `Decimal`, precision could be lost for large amounts (>53-bit significant). The receipts service should be audited to confirm it re-wraps the `number` arg in `Prisma.Decimal` before any DB write.

### Info

**I1 — Test name updated without spec test for the removed field**  
`reschedule.service.spec.ts:38` updates a test description and assertion from the old `lastInstallmentNewAmountDue = 706.84` to `1515.84`. The removal of the `amountDue` reduction is well-commented and the test correctly reflects the new behavior.

**I2 — Large service file**  
`apps/api/src/modules/payments/services/reschedule-collect.service.ts` is ~420 lines (new file). Within acceptable range but approaching the 500-line threshold.

---

## Recommendation: **APPROVE** (resolve W2 before or after merge)

- No missing guards, no hardcoded secrets, no `Number()` on DB writes, all new queries include `deletedAt: null`.
- The transaction atomicity improvement is a correctness fix — previously a QR payment success could commit the JE but fail the date-shift, leaving the installment unpaid in the schedule.
- W2 (receipt service receiving a JS `number`) should be tracked as a follow-up audit item but does not block merge.
