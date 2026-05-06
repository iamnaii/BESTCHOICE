# Merge Guard Report — fix/payment-single-screen

**Date:** 2026-05-06  
**Branch:** `fix/payment-single-screen`  
**Author:** Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commit:** e30bdb07 — fix(wizard): collapse 4-step wizard to single screen for fast cashier workflow

---

## File Changes Summary

| File | Changed |
|------|---------|
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | 303 additions, 564 deletions (net −261 lines) |

**Scope:** Frontend only. No backend, no Prisma schema, no API changes.

---

## What This Branch Does

Collapses the 4-step `WizardStepper` dialog into a single-screen layout:

- Removes `WizardStepper`, `AmountStep`, `MethodStep`, `JournalReviewStep` sub-components
- Consolidates all fields (amount, late fee, cash account, payment method, slip upload, memo) into one 2-column dialog
- `JePreviewPanel` is always visible (right column)
- Replaces `canAdvance()` step validation with a single `canSubmit()` gate
- Submit is gated on: `receivedNum > 0 && depositAccountCode && detectedCase !== 'OUT_OF_RANGE' && requiresRef→referenceNumber && requiresSlip→slipUrl && preview.isBalanced`

---

## Issues

### Critical
_None found._

### Warning
_None found._

### Info

1. **`fetch()` used inside `useSlipUpload` for S3 PUT** (line ~220 of original file, unchanged)  
   Raw `fetch()` is used to PUT the file to the S3 presigned URL. This is intentional — presigned URLs are external (S3/GCS), and cannot be routed through the internal `api` axios client. This was already present in `main` and is correct practice.

2. **`canSubmit()` returns `false` when `preview` is `undefined`**  
   The guard `if (!preview?.isBalanced) return false` blocks submission while the JE preview is still loading. This means the cashier sees a disabled button until the debounced preview resolves (~300ms after entering an amount). Minor UX friction, but safe — prevents submitting without a balanced journal entry. Equivalent to the previous Step 4 behavior.

3. **Design tokens**: All Tailwind classes use semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`). No hardcoded hex or `gray-*` colors introduced. ✓

4. **Decimal arithmetic**: All monetary calculations use `decimal.js` `Decimal` — no `Number()` on money fields. ✓

---

## Recommendation: ✅ APPROVE

Clean, well-scoped refactor. Reduces component complexity by ~40%, improves cashier speed by eliminating multi-step navigation. No security, money precision, or auth regressions found.
