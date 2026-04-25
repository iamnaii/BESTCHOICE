# Merge Guard Report — redesign/liff-pay-scan-only

**Date**: 2026-04-25  
**Branch**: `redesign/liff-pay-scan-only`  
**Author**: Akenarin Kongdach  
**Commit**: `bc83ef20`  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +Lines | -Lines | Description |
|------|--------|--------|-------------|
| `apps/web/src/pages/liff/LiffPayment.tsx` | ~420 | ~570 | Full UI redesign; remove slip-upload flow |
| `apps/web/e2e/liff-payment.spec.ts` | ~26 | ~36 | Update E2E tests to match new UI |

**Total**: 2 files changed, 446 insertions(+), 604 deletions(-)

---

## What Changed

### Business logic
- **Removed** manual-transfer / slip-upload flow entirely (the "โอนเอง" tab and `slipMutation`)
- Payment flow is now scan-to-pay (PaySolutions QR) only
- Added `isMultiInstallment` heuristic: when payment amount exceeds `amountDue + lateFee` by more than 0.5 baht, hide the "งวดที่ N" row in the success screen (avoids misleading display for early-payoff links)
- Added `useLiffInit()` to restore LINE auth token from session cache before firing the `useQuery`; query is now `enabled: !!token && !authLoading` to prevent 401 flash

### UI
- Replaced `Card/Tabs` layout with `Shell` + `TopBar` + `Row` local primitives
- Consistent with design language of `LiffEarlyPayoff.tsx`

### Tests
- Removed tests for slip-upload and "โอนเอง" tab (now removed feature)
- Updated text selectors to match new copy (`'ชำระเงิน'` not `'ชำระเงินค่างวด'`)

---

## Issues by Severity

### Critical
_None_

### Warning

**W-001 — Hardcoded hex/rgb colors in `Shell` and `TopBar` (design-token rule violation)**

```tsx
// Shell component
style={{ backgroundColor: '#fafaf7' }}
style={{ backgroundColor: 'rgb(250 250 247 / 0.85)' }}

// Gradient decorations
background: 'radial-gradient(600px 400px at 10% -5%, rgb(16 185 129 / 0.10), transparent 60%),...'
background: 'linear-gradient(135deg, rgb(52 211 153) 0%, rgb(16 185 129) 60%, rgb(5 150 105) 100%)'
```

`.claude/rules/frontend.md` forbids hardcoded hex/gray colors — `bg-background`, `bg-card`, CSS tokens must be used instead. The `#fafaf7` and `rgb(250 250 247)` values are off-white tints that don't map to an existing token, making them invisible to the theme system (dark-mode/contrast issues, future rebranding).

The gradient overlays are decorative, so a reasonable approach is either:
1. Add a `--liff-shell-bg` CSS variable in `index.css` and reference it here
2. Use `bg-background` with a `data-[off-white]` variant, or
3. Accept as a one-off if LIFF pages are intentionally outside the main theme scope (document the exception)

Note: `LiffEarlyPayoff.tsx` uses the same `Shell`/`TopBar` primitives (the comment "shared DNA with LiffEarlyPayoff" confirms it). These components appear to be copy-pasted from that file rather than imported. Consider extracting them to a shared `apps/web/src/pages/liff/components/` location to avoid future drift.

**W-002 — New `Number()` on Decimal financial fields in `isMultiInstallment`**

```tsx
const isMultiInstallment =
  !!payment &&
  amount > Number(payment.amountDue) + Number(payment.lateFee ?? 0) + 0.5;
```

`payment.amountDue` and `payment.lateFee` are Decimal-typed API fields. This is a UI-only comparison (decides whether to show/hide the installment number row) so floating-point precision error at ±0.01 baht won't cause a financial error — but it violates the codebase convention and could silently break for extreme amounts. Consider `new Decimal(payment.amountDue).plus(payment.lateFee ?? 0).plus(0.5).lessThan(amount)` using the existing `Decimal` import, or simply accept the `0.5` buffer makes precision error irrelevant here and document it.

Note: `const amount = data ? Number(data.amount) : 0` and `amount: Number(data.amount)` were pre-existing on main and are **not** new violations introduced by this branch.

### Info

**I-001 — `Shell` and `TopBar` are duplicated from `LiffEarlyPayoff.tsx`**

Both files define identical `Shell`, `TopBar`, and `Row` components. If these diverge independently, LIFF pages will look inconsistent. Suggest extracting to `apps/web/src/pages/liff/liff-shell.tsx` (or similar) before the next LIFF page is added.

**I-002 — E2E test coverage for removed slip-upload is adequate**

The slip-upload tests were removed alongside the feature. The remaining E2E tests cover the happy path (scan-to-pay), expiry, and used-link error states. No gaps introduced.

**I-003 — `useLiffInit()` dependency prevents race condition correctly**

Gating `useQuery` on `!authLoading` is the right pattern. No issues.

---

## Recommendation

**⚠️ REVIEW**

Two Warnings:
- **W-001** (hardcoded colors) should be resolved before merge, or an explicit exception documented in the LIFF section of `frontend.md`.
- **W-002** (Number on Decimal) is low-risk but should be acknowledged.

The business logic change (removing slip-upload) and the auth/polling improvements are correct. The UI redesign is visually consistent with `LiffEarlyPayoff`. Address the design-token violations, then merge.
