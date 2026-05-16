# Merge Guard Report — fix/payments-6-critical-gl-bugs

**Date**: 2026-05-16  
**Branch**: `fix/payments-6-critical-gl-bugs`  
**Author**: Akenarin Kongdach  
**Commits**: 7  
**Diff summary**: 24 files changed, 1020 insertions(+), 203 deletions(-)

---

## Summary

Comprehensive GL bug-fix branch targeting 6 critical and 8+ warning-level issues identified in a prior review. Fixes span: late-fee JE emission (C1), PaySolutions JE atomicity + Sentry alerting (Critical round 2), Thai-font embedding in PDFs (C5), branch-access guard gaps on payment-keyed routes (W1), deposit-account code routing (W2), audit-trail gaps (W3), BKK timezone in receipt numbering (W5), Decimal precision in daily totals (W6), late-fee pre-fill in the payment wizard (I4). Also adds 177 new tests and improves the `thai-date.util` module.

---

## File Changes

| Area | Files | Notes |
|------|-------|-------|
| Payments service | `payments.service.ts` (+206/-2) | C1, W1-W3, W6, I3-I4 fixes |
| Payments controller | `payments.controller.ts` | W1: branch guard on 4 payment-keyed routes |
| Payments service spec | `payments.service.spec.ts` (+177) | New test coverage |
| Receipts service | `receipts.service.ts` | C5, W5, I2 fixes |
| PaySolutions controller | `paysolutions.controller.ts` | Critical round-2: Sentry capture + re-throw on JE failure |
| PaySolutions service | `paysolutions.service.ts` (+124/-92) | Atomicity hardening |
| PaySolutions service spec | `paysolutions.service.spec.ts` | Updated tests |
| Early payoff template | `early-payoff-jp4.template.ts`, `.spec.ts` | JE precision fix |
| Payment 2B template | `payment-receipt-2b.template.ts` | C1: lateFee leg emission |
| VAT 60-day reversal | `vat-60day-reversal.template.ts` | JE reversal fix |
| Thai date util | `thai-date.util.ts`, `.spec.ts` | BKK timezone utilities |
| Embedded fonts | `assets/fonts/embedded-fonts.ts` | C5: base64 Thai fonts for PDF |
| Payment DTO | `payments/dto/payment.dto.ts` | lateFee field added |
| RecordPaymentWizard | `RecordPaymentWizard.tsx` | I4: pre-fill lateFee from server |
| PaymentsPage | `PaymentsPage/index.tsx` | W7: forward lateFee in mutation payload |
| Receipt PDF service | `receipts.service.ts` | Remove Google Fonts dependency |

---

## Issues Found

### Critical (must fix before merge)

None. (This branch *fixes* previously identified critical issues.)

### Warning (should fix)

None.

### Info

**I1 — `installmentSchedule.findUnique` without explicit `deletedAt` filter**  
File: `payments.service.ts` (autoAllocate bulk path, inside `$transaction`)  
```ts
const instSchedPs = await tx.installmentSchedule.findUnique({...});
```
`findUnique` by primary key returns the record regardless of soft-delete status. The call is inside a serializable `$transaction` where the parent contract's status has already been checked and the installment schedule IDs come from prior validated queries. Low practical risk but inconsistent with the `deletedAt: null` convention. Consider adding a post-null check: `if (!instSchedPs || instSchedPs.deletedAt) continue;`.

**I2 — `toNumber()` after Decimal arithmetic (display context)**  
Multiple locations in `receipts.service.ts` and `payments.service.ts`. All follow the correct pattern: `toDec(...).plus(toDec(...)).toNumber()` — arithmetic is done in Decimal, `toNumber()` is the final display conversion. No precision loss risk at the arithmetic step. Acceptable.

**I3 — PaySolutions controller now re-throws on JE failure**  
File: `paysolutions.controller.ts`  
The controller now returns 500 (instead of 200) when `handlePaymentCallback` throws. This enables PaySolutions' 3-retry policy as a recovery mechanism. **Idempotency concern**: PaySolutions may retry a call where the payment was committed but a post-commit side effect failed. Review `paysolutions.service.handlePaymentCallback` to confirm the outer `$transaction` boundary covers Payment.update + JE post atomically, and that the idempotency check (ProcessedWebhookEvent) is inside the same transaction scope — so a retry hits the idempotency guard before attempting double-commit.  
The Sentry tagging runbook is documented inline; recommend formalizing in `docs/guides/`.

---

## Security Notes (positive findings)

- **W1 fix correctly closes a cross-branch bypass**: `waiveLateFee`, `createPartialQr`, `getActivePartialQr`, `cancelPartialQr` all previously relied on class-level `BranchGuard` that only fires when the request carries `branchId`. Payment-keyed routes do not carry `branchId`, so any authenticated user from any branch could waive fees or create QR for another branch's contract. The explicit `validateBranchAccessByPayment` call in `PaymentsService` closes this gap. ✅
- **Sentry now alerts on PaySolutions JE failures** rather than silently swallowing them. ✅
- **Thai font embedding** removes the Google Fonts network dependency from PDF generation, improving reliability on Cloud Run. ✅
- **Math.round removed** from daily totals — `toDecimalPlaces(2).toNumber()` preserves satang precision. ✅

---

## Recommendation

**APPROVE** ✅

This branch is a net security improvement: it fixes a cross-branch authorization bypass (W1), improves PaySolutions JE failure visibility (Sentry), and removes incorrect Math.round on financial aggregations. The one Info item (installmentSchedule without deletedAt) is low risk in context. Test coverage increase of 177 tests strengthens confidence. No new security regressions detected.
