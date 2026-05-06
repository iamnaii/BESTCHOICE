# Merge Guard Report — fix/preview-use-monthly-payment

**Date**: 2026-05-06  
**Branch**: `fix/preview-use-monthly-payment`  
**Author**: Akenarin Kongdach  
**Commits**: 3  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | +Added | -Removed | Notes |
|------|--------|----------|-------|
| `apps/api/src/modules/payments/payments.service.spec.ts` | +3 | 0 | Fixture: add `monthlyPayment` |
| `apps/api/src/modules/payments/payments.service.ts` | +14 | -15 | JE calc uses `monthlyPayment` as truth |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | +304 | -565 | 4-step wizard → single-screen |

**Total**: 3 files, 321 insertions, 580 deletions.

---

## What This Branch Does

Two distinct changes bundled together:

1. **Backend**: `payments.service.ts` — Installment JE preview now uses `contract.monthlyPayment` as the source of truth rather than re-deriving it from `financedAmount + commission + interest`. This ensures the JE breakdown matches exactly what the customer sees on their repayment schedule.

2. **Frontend**: `RecordPaymentWizard.tsx` — Collapses the 4-step wizard (info → amount → method → journal review) into a single-screen dialog with a 2-column layout (contract info left, form right) and a permanently visible JE preview panel. Removes `WizardStepper`, `AmountStep`, `MethodStep`, and `JournalReviewStep` sub-components (580 lines removed).

---

## Issues Found

### Critical
_None._

### ⚠️ Warning

**W-1 — JE preview failure silently blocks submission with no user feedback**

`canSubmit()` requires `preview?.isBalanced` to be truthy before allowing submission:

```typescript
const canSubmit = (): boolean => {
  if (receivedNum <= 0) return false;
  if (!depositAccountCode) return false;
  if (detectedCase === 'OUT_OF_RANGE') return false;
  if (requiresRef && !referenceNumber.trim()) return false;
  if (requiresSlip && !slipUrl) return false;
  if (!preview?.isBalanced) return false;   // ← blocks if preview API fails
  return true;
};
```

If the `/payments/preview-journal` API is slow or returns an error, `preview` stays `undefined` and the submit button is disabled indefinitely. There is no timeout, no error state shown to the user, and no "skip preview" escape hatch. A cashier in-store could be stuck with a disabled button.

The `previewLoading` spinner is shown inside `JePreviewPanel`, but the submit button tooltip only shows messages for `OUT_OF_RANGE` or unbalanced JE — not for preview failure:

```tsx
title={
  detectedCase === 'OUT_OF_RANGE'
    ? 'ห่างเกิน 1 ฿ — ใช้เมนูแบ่งชำระหรือปิดยอดแทน'
    : !preview?.isBalanced && isPreviewReady
    ? 'รายการบัญชีไม่สมดุล'
    : undefined    // ← no message when preview load failed
}
```

**Fix**: Add a query error state check and show a descriptive message if the preview query fails (e.g., network error). Consider a fallback — if preview API fails, allow submission but log a Sentry warning.

**W-2 — `monthlyPayment ?? 0` fallback present but `monthlyPayment` is non-nullable in schema**

```typescript
// payments.service.ts
const monthly = new Prisma.Decimal((c.monthlyPayment ?? 0).toString());
```

`Contract.monthlyPayment` is declared as `Decimal @db.Decimal(12,2)` (non-nullable) in `schema.prisma`. The `?? 0` will never trigger at runtime, but TypeScript may still infer a nullable type if the Prisma query's `select` or `include` scope doesn't include the field. This should resolve cleanly, but if a future query omits `monthlyPayment` from the select, the fallback to `0` would silently produce zero-amount JEs instead of throwing.

Low risk today, but consider using a guard: `if (!c.monthlyPayment) throw new Error(...)`.

### ℹ️ Info

**I-1 — Single-screen dialog is significantly wider (`max-w-5xl`)**

The new dialog uses `max-w-5xl` (1024px) vs. the previous `max-w-4xl` (896px). On tablets or small laptops, the 2-column layout (`grid-cols-[260px_1fr]`) may not have enough horizontal space and could overflow or wrap. Recommend QA on 1024px viewport width.

**I-2 — `slipFileName` now correctly included in dialog reset**

The new `handleOpenChange` reset block includes `setSlipFileName('')`, which was missing in the 4-step version. This is a correct incidental fix.

**I-3 — `memo` moved behind a `<details>` disclosure element**

Memo is now hidden behind a `<details>` expand toggle rather than an always-visible textarea. This reduces visual clutter but means cashiers who previously relied on the memo field may not discover it. Acceptable tradeoff for the faster cashier workflow goal.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controller guards | N/A — no new endpoints |
| `Number()` on money fields | ✅ Uses `Prisma.Decimal` throughout |
| Missing `deletedAt: null` in queries | N/A — no new queries |
| Hardcoded secrets/API keys | None |
| Raw `fetch()` instead of `api.get/post` | ⚠️ `fetch(presign.uploadUrl, ...)` used for S3 PUT — this is correct and intentional (pre-signed URL upload, not an API call) |
| Missing `queryClient.invalidateQueries` after mutation | N/A — mutation passed in as prop (`onSubmit`), invalidation is caller's responsibility |

---

## Recommendation

**⚠️ REVIEW** — The backend change is well-motivated and the math is correct. The UX refactor is significant and reduces friction for cashiers. One Warning needs attention before merge:

- **W-1**: Handle the JE preview failure state explicitly — at minimum, show an error tooltip on the disabled submit button when `previewData` query errors. Ideally allow a fallback submission path or show a retry button within the JE panel.

The `monthlyPayment` concern (W-2) is low-risk but adding a null guard would improve resilience. The UI width concern (I-1) should be verified with a browser test on a 1024px screen before shipping.
