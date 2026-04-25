# Merge Guard Report — LIFF Payment Branches
**Date**: 2026-04-25  
**Reviewer**: Pre-Merge Guard Agent  
**Branches reviewed**: 3

---

## Branches Reviewed

| Branch | Author | Commit | Files Changed |
|--------|--------|--------|---------------|
| `feat/liff-early-payoff-direct-paysolutions` | iamnaii | 37e37ea | 1 (+19 -3) |
| `fix/liff-pay-skip-installmentno-early-payoff` | iamnaii | d923228 | 1 (+5 -1) |
| `redesign/liff-pay-scan-only` | iamnaii | bc83ef2 | 2 (+446 -604) |

---

## Branch 1: `feat/liff-early-payoff-direct-paysolutions`

**File**: `apps/web/src/pages/liff/LiffEarlyPayoff.tsx`

**Summary**: Removes the two-hop early-payoff flow (`/line-oa/liff/early-payoff` → `/pay/{token}`) and calls `/paysolutions/create-intent` directly from the LIFF page. Reduces latency and eliminates the intermediate PaymentLink shell.

### Issues

#### Warning — `Number()` on money field (1 instance)
```tsx
// LiffEarlyPayoff.tsx
amount: Number(quote.totalPayoff),
```
`quote.totalPayoff` is a Decimal value from the API. Converting it to `Number` before posting risks floating-point precision loss for large amounts (e.g., ฿999,999.99 could silently corrupt). The backend `/paysolutions/create-intent` should accept a string or the Decimal should be sent as-is (serialised as a string).

**Fix**: `amount: String(quote.totalPayoff)` or pass the raw string from the response without coercion.

#### Info — Intentional validation bypass documented in comment
```tsx
// installmentNo is intentionally omitted so backend skips
// per-installment amount validation (the payoff amount
// intentionally exceeds any single installment).
```
The bypass is documented and deliberate. Verify the backend `/paysolutions/create-intent` handles a missing `installmentNo` safely (no silent null-pointer paths).

#### Info — Security model (no concern)
The `/paysolutions/create-intent` endpoint is correctly accessed via `liffApi` (LINE LIFF token auth), and `paysolutions` is listed in `security.md` as an intentionally public endpoint using gateway-side verification. No JWT guard issue.

### Recommendation: **REVIEW**
Fix the `Number(quote.totalPayoff)` before merging.

---

## Branch 2: `fix/liff-pay-skip-installmentno-early-payoff`

**File**: `apps/web/src/pages/liff/LiffPayment.tsx`

**Summary**: Stops sending `installmentNo` to `create-intent` when the payment link covers multiple installments (early payoff). Prevents the backend from rejecting the full payoff amount as "ยอดไม่ตรง".

### Issues

None found. The change is minimal and correct:
- `isMultiInstallment` is already defined in the same file (confirmed present in both the branch and `origin/main`).
- Comment clearly explains the backend validation behaviour it avoids.
- Uses `liffApi.post()` — no raw `fetch()`.
- No hardcoded colours, no money-to-Number conversion, no missing guards.

### Recommendation: **APPROVE**

---

## Branch 3: `redesign/liff-pay-scan-only`

**Files**:
- `apps/web/src/pages/liff/LiffPayment.tsx` (major refactor — 1,016 → 663 lines)
- `apps/web/e2e/liff-payment.spec.ts` (updated to match new UI)

**Summary**: Full UI overhaul of the customer payment page. Removes manual transfer / slip-upload tab entirely; leaves only the Pay Solutions gateway flow. Fixes a 401 on reload by initialising `useLiffInit` to restore the cached LIFF token. New "calm fintech" visual style with ambient gradients and a single large CTA button.

### Issues

#### Warning — Multiple hardcoded colours (design token rule violation)
The `frontend.md` rule prohibits hardcoded hex/rgb values. The following new inline styles violate it:

```tsx
// Shell component
style={{ backgroundColor: '#fafaf7' }}

// TopBar component
style={{ backgroundColor: 'rgb(250 250 247 / 0.85)' }}

// Payment hero section (multiple)
style={{ background: 'radial-gradient(circle, rgb(16 185 129 / 0.18) ...' }}
style={{ background: 'linear-gradient(135deg, rgb(16 185 129) 0%, rgb(5 150 105) 45%, ...' }}
boxShadow: '0 18px 40px -12px rgb(5 150 105 / 0.55)'
// + 6 more rgb() gradient values across Shell / TopBar / hero
```

The correct pattern is either:
1. Extend `index.css` with new CSS custom properties for the bespoke values (`--liff-surface`, `--liff-gradient-primary`), or
2. Use existing Tailwind tokens (`bg-background`, `bg-card`, emerald scale) where they match close enough.

Note: `bg-white/20` (opacity modifier on a button overlay) is borderline acceptable but should be reviewed for dark-mode compatibility.

#### Warning — `Number()` on money fields used in heuristic comparison
```tsx
const isMultiInstallment =
  !!payment &&
  amount > Number(payment.amountDue) + Number(payment.lateFee ?? 0) + 0.5;
```
These `Number()` calls are frontend-only display logic (not sent to DB), so the risk is lower than a backend Decimal issue. However, if `amountDue` ever exceeds ~2^53 satangs the comparison silently corrupts. Prefer keeping them as `Decimal` objects and using the Prisma.Decimal comparison API, or keep as strings and compare with a library. For amounts in typical ฿ range the practical risk is low but it breaks the coding convention.

#### Info — Removal of slip-upload / manual transfer tab
The branch removes `slipMutation`, `validateSlipFile`, and the entire "โอนเอง" tab. This is a significant UX/business change (customers can no longer upload slips). Confirm this is an intentional product decision before merging.

#### Info — Large file
`LiffPayment.tsx` is 663 lines post-refactor. Over the 500-line soft limit. The file now owns three local helper components (`Shell`, `TopBar`, `Row`). Consider extracting them to `components/liff/` if the file grows further.

#### Info — E2E tests updated correctly
The spec file correctly removes tests for "โอนเอง" tab and slip upload, and updates selectors for the new "สแกนจ่าย" CTA. No stale selectors remain.

### Recommendation: **REVIEW**
Fix the hardcoded colour violations before merging. Confirm slip-upload removal is intentional. The `Number()` money comparisons should be addressed but are lower priority given display-only usage.

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `feat/liff-early-payoff-direct-paysolutions` | 0 | 1 | 2 | **REVIEW** |
| `fix/liff-pay-skip-installmentno-early-payoff` | 0 | 0 | 0 | **APPROVE** |
| `redesign/liff-pay-scan-only` | 0 | 2 | 3 | **REVIEW** |

### Common Theme
All three branches touch the LIFF payment flow. The `fix/` branch is a clean incremental fix. The `feat/` and `redesign/` branches are the higher-risk changes — both need targeted fixes to the `Number()` money handling and (for redesign) the hardcoded colour palette before they are merge-ready.

### Suggested Merge Order
1. Merge `fix/liff-pay-skip-installmentno-early-payoff` first (no issues, self-contained).
2. Fix `feat/liff-early-payoff-direct-paysolutions` (`Number()` → `String()`) then merge.
3. Fix `redesign/liff-pay-scan-only` (colour tokens + confirm slip removal) then merge last — it's the largest change and should land on top of the other two to avoid conflicts.
