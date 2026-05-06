# Pre-Merge Guard Report: fix/payment-prefill-no-late-fee

**Date**: 2026-05-06  
**Branch**: `fix/payment-prefill-no-late-fee`  
**Author**: Akenarin Kongdach  
**Recommendation**: ✅ **APPROVE** — No blocking issues; one minor style note

---

## File Changes Summary

1 file changed, 21 insertions, 4 deletions

**Modified**: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`

---

## Change Description

UX fix: the payment wizard previously pre-filled **amountReceived = amountDue + lateFee**, which caused a spurious "ห่างเกิน 1฿" warning on first render because the `lateFeeStr` input showed `0.00` while the backend-computed `payment.lateFee` was already baked into the default amount.

The fix:
- `defaultAmount` now equals `amountDue − amountPaid` (no lateFee)
- `lateFeeStr` starts at `'0.00'`
- A `useEffect` auto-syncs `amountReceived = amountDue + lateFee − amountPaid` whenever `lateFeeStr` changes, **but only while the user hasn't manually edited the amount field** (`amountManuallyEdited` flag)

---

## Issues

### 🔴 Critical

None.

---

### ⚠️ Warning

#### W1 — `useEffect` for derived-state sync (style concern, not a rule violation)

The frontend rule prohibits `useEffect + fetch` for data fetching — this `useEffect` does state synchronization, not fetching, so it does not violate the rule. However, because `amountReceived` is already in state and the sync logic depends on two pieces of state (`lateFeeStr` + `amountManuallyEdited`), a `useMemo` computed value would be cleaner if the input were lifted to a controlled pattern. Acceptable as-is given the complexity of the existing wizard.

---

### ℹ️ Info

- No new API calls, no new controller, no Prisma changes.
- Decimal arithmetic (`amountDueDecimal.plus(lf).sub(amountPaidDecimal)`) is correct.
- `parseFloat(lateFeeStr)` used for the `useEffect` guard is fine (user-entered string, not a Prisma Decimal).

---

## Verdict

Clean fix with clear rationale. Safe to merge.
