# Refund reversal JE — `markReversed` posts the ledger reversal (design)

**Date:** 2026-06-07
**Status:** approved (brainstorm + /scrutinize) → ready for implementation plan
**Scope:** `apps/api` `RefundsService.markReversed` + `RefundsModule` wiring + a small backward-compatible param on `ReceiptVoidReversalTemplate`. Backend only — no frontend changes.

## Problem

When a refund's bank reversal is confirmed (`refunds.service.markReversed`), the code flips the refund to `PROCESSED` and locks the bank ref, but **posts no journal entry and doesn't touch the payment**. So after the bank reverses the customer's original charge, the ledger still shows the installment as received (HP-receivable cleared, cash/VAT booked) and `payment.status` stays `PAID` — the books disagree with reality.

Unlike `receipts.voidReceipt`, which reverses the original payment JE (Phase A.5a, via `ReceiptVoidReversalTemplate`). The refund module (#541, T1-C1/P2Q7=F) was deliberately built tracking-only.

**Owner intent (clarified):** a refund here represents **correcting an erroneous booking** — the payment was booked wrongly, so the system must fully **revert** it (reverse the JE *and* restore the installment to its true unpaid state).

## /scrutinize findings + resolution

- **"Mirror voidReceipt" was imprecise** — traced `voidReceipt`: it issues a credit note + reverses the JE but **never reverts `payment.status`** (leaves it `PAID`). So reverting the payment is a *new* behavior, not inherited.
  **Resolution:** the two are different scenarios and SHOULD differ. `voidReceipt` = the *receipt document* was wrong but the payment genuinely happened → payment stays `PAID`. A refund = the *payment booking* was wrong → revert the payment to its true unpaid state. The divergence is deliberate and documented.
- **Reverting `payment.status → PENDING` re-arms dunning/overdue/MDM-lock** ([dunning-engine.service.ts:306](../../../apps/api/src/modules/overdue/dunning-engine.service.ts) queries `status IN (PENDING,OVERDUE,PARTIALLY_PAID)` on `OVERDUE/DEFAULT` contracts).
  **Resolution:** for an error-correction, restoring the true unpaid state is *correct* — the installment genuinely wasn't paid, so normal overdue/dunning applies. Intended, not a harm. (Documented so the accountant is aware.)

## Goal

On a confirmed full refund, atomically: post a reversing JE for the original payment, restore the installment to unpaid, and keep the existing refund-state/bank-lock/audit behavior — reusing the proven A.5a reversal mechanism.

## Design

`markReversed` becomes a single `$transaction`. Inside it, after the existing guards (APPROVED status, approver role, write-once bank lock):

1. **Period guard** — `await validatePeriodOpen(tx, new Date())` (the reversal posts to the current period; mirror `voidReceipt` receipts.service.ts:460). Closed period → throw → rollback.
2. **Flip refund → PROCESSED** + bankReversalRef/At/Notes/LockedAt (unchanged).
3. **Post the reversing JE** — find the original payment JE:
   `tx.journalEntry.findFirst({ referenceType:'PAYMENT', referenceId: refund.paymentId, status:'POSTED', deletedAt:null })`.
   If found → `await this.receiptVoidReversalTemplate.voidReceipt(originalEntry.id, tx, { flow:'refund-reversal' })` (full mirror — refunds are always full, so no proportional/VAT math). If **not found** (legacy payment with no automated JE) → log and continue (still revert the payment + flip the refund).
4. **Revert the payment to unpaid** —
   `tx.payment.update({ where:{ id: refund.paymentId }, data:{ status:'PENDING', amountPaid: 0, paidDate: null } })`.
   The planned-schedule fields (`monthlyPrincipal`/`monthlyInterest`/`monthlyCommission`, `amountDue`) are **left as-is** — they describe the installment plan, not the (now-reverted) payment. `lateFee`/`lateFeeWaived` are left unchanged (the late-fee accrual is independent of this payment's reversal).
5. **Audit** — existing `REFUND_PROCESSED` log, plus the reversal JE entryNo in `newValue` for traceability.

### Reuse, not new template

No new JE template, no proportional math, no VAT logic — `ReceiptVoidReversalTemplate.voidReceipt` already posts the exact Dr/Cr mirror of `PaymentReceipt2B` and is idempotent.

### Small template change: optional `flow` param

`ReceiptVoidReversalTemplate.voidReceipt(originalJournalEntryId, tx?, opts?)` gains `opts?: { flow?: string }` defaulting to `'receipt-void'`. The value is used in **both** the `metadata.flow` stamp **and** the idempotency lookup, so a refund's reversal is labelled `'refund-reversal'` (correct audit trail) and dedupes against its own flow. `voidReceipt`'s existing call is unchanged (default preserves current behavior).

### Wiring

`RefundsModule` adds `imports: [JournalModule]` (which exports `ReceiptVoidReversalTemplate`, same as `ReceiptsModule`); `RefundsService` injects `private readonly receiptVoidReversalTemplate: ReceiptVoidReversalTemplate`.

## Error handling

Errors propagate → the whole `$transaction` rolls back (a refund without its ledger reversal is the exact inconsistency we're fixing). Period closed → `validatePeriodOpen` throws. Re-running a refund that's already PROCESSED is blocked by the existing `status !== 'APPROVED'` guard; the template's idempotency is a second line of defense.

## Testing (unit, mock prisma + template)

- **Happy path:** APPROVED refund → `markReversed` calls `receiptVoidReversalTemplate.voidReceipt(originalEntryId, tx, {flow:'refund-reversal'})`; payment updated to `{status:'PENDING', amountPaid:0, paidDate:null}`; refund → `PROCESSED`; all inside one `$transaction`.
- **No original JE (legacy):** template not called; payment still reverted; refund still PROCESSED; a log emitted.
- **Closed period:** `validatePeriodOpen` throws → nothing committed (refund stays APPROVED).
- **Template `flow` param:** unit test on `ReceiptVoidReversalTemplate` — passing `{flow:'refund-reversal'}` stamps `metadata.flow='refund-reversal'` and the idempotency check keys on it; default call still uses `'receipt-void'`.

## Out of scope

- **Partial refunds** — refunds are always full (owner-confirmed); proportional/VAT reversal not built.
- Other refund states (`requestRefund`/approve/reject/markFailed) — only `markReversed` posts the JE.
- Frontend.
- Suppressing dunning for reverted installments — intentionally NOT done (the installment is genuinely unpaid again).

## Risk

Low–moderate. Reuses the proven, idempotent A.5a reversal; the only shared-code change is a backward-compatible optional param. **Changes the ledger** (posts a reversal JE + reverts the payment), so **needs accountant sign-off; ends at PR — do NOT auto-merge** (merge auto-deploys to prod).
