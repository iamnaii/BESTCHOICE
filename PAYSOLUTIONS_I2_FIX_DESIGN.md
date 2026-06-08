# PaySolutions 2B JE fix (PR-843 / I2) — implementation design

Status: **DESIGNED, NOT IMPLEMENTED.** Current buggy behaviour is locked by
`paysolutions.callback-money.spec.ts` characterization tests + the in-source
`TODO(PR-843/I2)`. This doc is the blueprint for a correct, reviewed implementation.

## The bug surface (in `paysolutions.service.ts` `handlePaymentCallback`)

`handlePaymentCallback` distributes a webhook payment FIFO across unpaid
installments, then posts a 2B JE **only** for installments it fully closes,
passing `amountReceived = snapshot.amountPaid` (the **cumulative** running total).
Four defects:

1. **Double-count on cross-path completion.** If an installment had a prior
   partial that `recordPayment` already posted to the ledger (cashier QR
   PartialPaymentLink → `recordPayment(case=PARTIAL)`, or manual UI PARTIAL),
   the completing webhook re-clears the **full** installment → 11-2103 credited
   twice for the prior partial.
2. **Unledgered partials.** When the webhook leaves an installment
   `PARTIALLY_PAID`, paysolutions posts **no** JE — cash is in the bank but the
   ledger doesn't reflect it (cash understated, 11-2103 overstated) until the
   installment later completes.
3. **Late fee mis-posting.** `owed = amountDue + lateFee − amountPaid`, so a
   late fee rides inside the cleared amount but is never booked to **42-1103**
   income (accounting.md: late fee = 42-1103, non-VAT). Today it makes
   `roundingDiff = lateFee` blow the ≤1฿ tolerance → the 2B template **throws**
   and the whole webhook rolls back (loud, but the payment fails).
4. **Over-collection dropped.** Surplus left after the FIFO loop
   (`remaining > 0`) is silently discarded — no creditBalance, no refund alert.

## Two attempts that FAILED review (do not repeat)

- **Attempt A — `priorPaid>0 ? delta : cumulative`.** Wrong: a prior partial
  left by paysolutions ITSELF was never JE-d, so using `delta` on completion
  **under-clears** 11-2103. (Caught by self-review.)
- **Attempt B — always `partialClear:true` + `delta`.** Wrong: `partialClear`
  credits 11-2103 by `amountReceived`, but **`installmentTotal ≠ monthlyPayment`**
  — the 2A accrual debited 11-2103 by `ROUND_DOWN(grossExclVat/m) +
  ROUND_HALF_UP(vat/m)` while `payThis = monthlyPayment = round2((subtotal+vat)/m)`.
  They diverge by ~0.01 on ~32% of contracts → 11-2103 mis-cleared + the rounding
  gain that should hit 53-1503 is dropped. And `partialClear` bypasses the
  tolerance/late-fee logic → the late-fee case becomes a **silent wrong posting**
  replacing the old loud throw (a regression). (Caught by adversarial review.)

## Accounting decisions (answered — forced by consistency with `recordPayment` + accounting.md)

1. **Rounding** `monthlyPayment − installmentTotal` (~0.01) → route to **53-1503**
   (overpay gain) / **52-1104** (underpay), ≤1฿ tolerance. Same as `recordPayment`'s
   non-partialClear path.
2. **Late fee** → **42-1103** income at receipt time. Same as `recordPayment` +
   accounting.md (non-VAT penalty).
3. **Ledger partials** → **yes**, each receipt posts its own JE (fixes defect 2).

## Correct algorithm — per-receipt allocation

For every receipt (the cash `payThis` this webhook applies to one installment),
split it and post a balanced JE:

```
principalRemaining = installmentTotal − priorPrincipalCleared   // 11-2103 still owed
lateFeeRemaining   = lateFee − priorLateFeeBooked

principalPortion = min(payThis, principalRemaining)
lateFeePortion   = min(payThis − principalPortion, lateFeeRemaining)
roundingPortion  = payThis − principalPortion − lateFeePortion   // ≤1฿ → 53-1503; else surplus
```

JE:
```
Dr  depositAccountCode        payThis
   Cr 11-2103                 principalPortion
   Cr 42-1103                 lateFeePortion        (if > 0)
   Cr 53-1503 / Dr 52-1104    roundingPortion       (if 0 < |x| ≤ 1฿)
```
Surplus beyond installmentTotal+lateFee across ALL installments → Point A alert
(`Sentry` `paysolutions-overpay-surplus`) or park as advance (Cr 21-1103).

Invariant restored: `Σ(Cr 11-2103) per installment == installmentTotal`,
`Σ(Cr 42-1103) == lateFee`, regardless of how many receipts / which path.

## Two implementation options

### Option 1 — extend the 2B template + allocate in paysolutions
- Add `priorCleared?: Decimal` (default 0) to `PaymentReceiptInput`; in the
  non-partialClear branch credit `11-2103 = installmentTotal.minus(priorCleared)`
  and use that in `roundingDiff`. (Default 0 → all existing callers unchanged.)
- In paysolutions, track `priorPrincipalCleared` / `priorLateFeeBooked` per
  installment across the FIFO loop and post one template call per receipt with
  the split above. Partials and completions both go through the **non-partialClear**
  path (it already handles rounding + lateFee + 42-1103).
- Risk: duplicates the allocation logic that `recordPayment` already has.

### Option 2 (preferred) — reuse `recordPayment`
- `recordPayment` already does the correct allocation (principal/lateFee/rounding/
  tolerance/JE) — but it opens its **own** `this.prisma.$transaction(..., Serializable)`
  (payments.service.ts:221) and fires loyalty/notifications per call.
- Refactor: give `recordPayment` an optional `outerTx?: Prisma.TransactionClient`
  (mirror the 2B template's C2 outerTx refactor) so paysolutions can call it inside
  its serializable webhook tx, once per installment with `amount = payThis`,
  `paymentCase = PARTIAL` for non-completing receipts. Move the per-call
  loyalty/notification side-effects out so they fire once per webhook, not per
  installment.
- Risk: touches the most-used money path (`recordPayment`: manual UI, CSV import,
  cashier). Needs its own thorough test + adversarial review.

**Recommendation:** Option 2 — one allocation engine, no duplication — but it is a
deliberate core-payment-path refactor, not a session patch.

### ⚠️ Option 2 is NOT a clean reuse — recordPayment itself doesn't cleanly complete a prior partial

Discovered while implementing Option 2 (reading payments.service.ts + tests):

- `recordPayment` completing a prior partial passes the **delta** to the 2B
  template's **non-partialClear** path (payments.service.ts:410-420,
  `partialClear` is set ONLY when this payment leaves a shortage > 1฿, i.e. NOT
  on the completing receipt). The non-partialClear branch clears the **full**
  `installmentTotal` and checks `roundingDiff = amountReceived − installmentTotal`
  (payment-receipt-2b.template.ts:178-188). For a completion of an 800-paid /
  1000 installment, `roundingDiff = 200 − 1000 = −800` → **throws "exceeds
  tolerance"** in production. The advance.spec test (prevPaid=800, pay 200)
  passes ONLY because it **mocks the 2B template** — the real throw is hidden.
- The ONLY path that correctly clears a prior-partial completion by delta is
  `applyCreditBalance`, via a **custom JE** `Dr 21-5101 / Cr 11-2103 = delta`
  (payments.service.spec.ts:1141-1150, comment: "the prior 500฿ was already
  booked as a partial JE when it was received") — it bypasses the 2B template.

**Conclusion:** multi-receipt installment JE posting is handled INCONSISTENTLY
across `recordPayment` (would throw), `applyCreditBalance` (custom delta JE,
correct), `autoAllocatePayment`, and `paysolutions` (cumulative, double-counts).
The unit tests mock the 2B template, so these throws/mis-postings are invisible
at the unit level. A correct fix is a **payment-JE-subsystem study** — define the
single correct "post a receipt for delta X (clear 11-2103 by delta, book lateFee
to 42-1103, route ≤1฿ rounding, reconcile installmentTotal only on the final
receipt)" primitive (the applyCreditBalance pattern generalised), apply it
uniformly to all five paths, and cover it with **real-DB e2e tests** (since unit
mocks hide the template throws) + accountant validation.

This is an epic, not a patch. Three session approaches (hybrid, partialClear,
reuse-recordPayment) each hit a wall — documented above as the reason NOT to
attempt a fourth in-session.

## Test plan
- Template unit: `priorCleared` shifts the 11-2103 clear + rounding (Option 1).
- paysolutions golden: fresh full (unchanged JE), recordPayment-prior-partial
  completion (delta clear, no double-count), paysolutions-partial-then-complete
  (each receipt ledgered, Σ=installmentTotal), late-fee installment (42-1103
  booked, no throw), overpay surplus (Point A alert).
- Re-run the full payments + paysolutions + 2B suites; adversarial-review the diff
  against the `Σ(Cr 11-2103)==installmentTotal` invariant before merge.
