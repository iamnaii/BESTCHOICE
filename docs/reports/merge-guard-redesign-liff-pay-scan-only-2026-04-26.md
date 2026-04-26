# Pre-Merge Guard Report

**Branch**: `redesign/liff-pay-scan-only`
**Author**: Akenarin Kongdach
**Date**: 2026-04-26
**Commit**: bc83ef20
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Lines Added | Lines Removed |
|------|------------|--------------|
| `apps/web/src/pages/liff/LiffPayment.tsx` | +463 | -604 |
| `apps/web/e2e/liff-payment.spec.ts` | +34 | -34 |

**Total**: 2 files modified, net −141 lines (simplification/redesign)

---

## Issues by Severity

### Critical
_None found._

### Warning

**`LiffPayment.tsx` — Multiple hardcoded hex/RGB colors (violates `frontend.md` design token rule)**

Several inline styles use hardcoded color values instead of CSS variable tokens:

```typescript
// Shell component
style={{ backgroundColor: '#fafaf7' }}

// Shell background gradient
background: 'radial-gradient(600px 400px at 10% -5%, rgb(16 185 129 / 0.10), ...'

// Hero orb
background: 'radial-gradient(circle, rgb(16 185 129), transparent 70%)'

// Scan-to-pay CTA button
background: 'linear-gradient(135deg, rgb(16 185 129) 0%, rgb(5 150 105) 45%, rgb(6 95 70) 100%)'
boxShadow: '0 18px 40px -12px rgb(5 150 105 / 0.55)'

// TopBar header
style={{ backgroundColor: 'rgb(250 250 247 / 0.85)' }}

// TopBar avatar gradient
background: 'linear-gradient(135deg, rgb(52 211 153) 0%, rgb(16 185 129) 60%, rgb(5 150 105) 100%)'

// Success icon
background: 'radial-gradient(circle, rgb(16 185 129 / 0.18) 0%, ...)'
```

Per `frontend.md`: "ห้ามใช้ hardcoded hex colors (`#1e3a5f`, `#059669`) — ใช้ CSS variable tokens เท่านั้น". These should use `var(--color-emerald-500)` or equivalent tokens from `index.css`. The `LiffEarlyPayoff.tsx` page on the same branch already established this pattern — if these tokens aren't defined yet, they should be added to `index.css` alongside the rollout.

**Mitigation**: These are LIFF pages (customer-facing mobile) where theme overrides are intentional fintech styling. The `Shell` component is file-local and cannot be changed from an admin panel — hardcoding here has low operational risk. However, it sets a precedent that will be hard to refactor when the design system evolves.

---

**`LiffPayment.tsx` line ~338 — `Number()` on Decimal fields in new business logic**

```typescript
const isMultiInstallment =
  !!payment &&
  amount > Number(payment.amountDue) + Number(payment.lateFee ?? 0) + 0.5;
```

`payment.amountDue` and `payment.lateFee` are Decimal fields from the API. Using `Number()` for comparison is fine for typical baht amounts but loses Decimal precision. Additionally, `amount` itself (`data ? Number(data.amount) : 0`) was a pre-existing use of `Number()` in this file. The `+ 0.5` epsilon guard is pragmatic but non-obvious — the comment on lines above explains the intent (early-payoff heuristic), which is acceptable. Flag for consistency rather than correctness risk.

---

### Info

**Feature removal: slip upload (manual transfer) path removed**
The "โอนเอง" tab and slip upload flow have been intentionally removed. The E2E tests have been updated to reflect this. Confirm this change has been communicated to operations staff who previously relied on manual transfer review — the `/slip-review` admin page may now receive zero new entries from this channel.

**`LiffPayment.tsx` file size**
The file went from ~1,016 lines to ~663 lines after this redesign — a significant net reduction. Still above 500 lines (info threshold) but down from the previous baseline.

**E2E tests correctly updated**
Tests removed: `shows payment method tabs (gateway + transfer)` and `shows slip upload in transfer tab`. New test: `shows scan-to-pay CTA with Pay Solutions trust badge`. Coverage for the happy path (gateway payment success) is maintained.

**`useLiffInit` hook added correctly**
The hook is used to restore `liffIdToken` from session cache so the `create-intent` call carries the `X-Liff-Id-Token` header. This fixes a known 401-on-reload issue — the comment in the code explains the reasoning.

---

## Recommendation

**REVIEW**

The hardcoded color values in `Shell` and `TopBar` violate the project's design token rules. This is the second file in this LIFF redesign series that uses this pattern — if it's an intentional exception (LIFF pages are outside the main design system), add a comment to `frontend.md` or `index.css` documenting that LIFF pages may use inline styles for fintech branding. Otherwise, extract the colors to CSS tokens first.

The `Number()` usage on Decimal fields is a low-severity precision concern consistent with the pre-existing pattern in the file.

Neither issue is a production-safety blocker, but the hardcoded color exception should be explicitly acknowledged by the team before merge.
