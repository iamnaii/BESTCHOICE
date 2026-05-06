# Merge Guard Report — fix/payment-prefill-no-late-fee

**Date**: 2026-05-06  
**Branch**: `fix/payment-prefill-no-late-fee`  
**Author**: Akenarin Kongdach  
**Commits**: 1  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | +Added | -Removed |
|------|--------|----------|
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | +21 | -4 |

**Total**: 1 file, 25 lines changed.

---

## What This Branch Does

Fixes a UX bug in the payment recording dialog where the pre-filled amount included the server-computed `lateFee`, causing a "ห่างเกิน 1฿" tolerance warning on first render (before the user had a chance to enter a late fee).

**Changes**:
- `defaultAmount` now excludes lateFee: `amountDue - amountPaid` instead of `amountDue + lateFee - amountPaid`
- `lateFeeStr` now starts at `'0.00'` (user must explicitly enter any late fee)
- Adds `amountManuallyEdited` flag to track if the user has touched the amount field
- Adds a `useEffect` to auto-sync `amountReceived = amountDue + lateFee - amountPaid` when lateFee changes, but only while `amountManuallyEdited` is `false`

---

## Issues Found

### Critical
_None._

### Warning

**W-1 — `amountManuallyEdited` not reset on dialog close**

`handleOpenChange` resets `amountReceived`, `lateFeeStr`, `method`, etc., but does **not** reset `amountManuallyEdited`:

```tsx
// handleOpenChange — missing reset
const handleOpenChange = (isOpen: boolean) => {
  if (!isOpen) {
    onClose();
    setDepositAccountCode(defaultDepositAccountCode);
    setAmountReceived(defaultAmount.toFixed(2));
    setLateFeeStr(lateFeeDecimal.toFixed(2));  // note: lateFeeStr resets...
    setMethod('CASH');
    setReferenceNumber('');
    setSlipUrl('');
    setMemo('');
    // ← amountManuallyEdited is NOT reset here
  }
};
```

**Impact**: If a cashier opens the dialog, manually edits the amount field, then closes without saving, and reopens the dialog on the same payment — `amountManuallyEdited` is still `true`. The auto-sync `useEffect` will not fire when they enter a late fee, so the amount field will not update automatically.

**Fix**: Add `setAmountManuallyEdited(false)` to the reset block in `handleOpenChange`.

### Info
_None._

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controller guards (`@UseGuards(JwtAuthGuard)`) | N/A — frontend only |
| `Number()` on money fields | No — uses `Decimal.js` correctly |
| Missing `deletedAt: null` in queries | N/A — no new queries |
| Hardcoded secrets/API keys | None |
| Raw `fetch()` instead of `api.get/post` | No — existing code |
| Missing `queryClient.invalidateQueries` after mutation | N/A — no new mutations |

---

## Recommendation

**⚠️ REVIEW** — The logic is correct and fixes the reported UX bug. One Warning needs to be addressed before merge:

- Add `setAmountManuallyEdited(false)` to `handleOpenChange` reset block to avoid stale flag on dialog reopen.

This is a single-line fix. Once done, the branch is safe to merge.
