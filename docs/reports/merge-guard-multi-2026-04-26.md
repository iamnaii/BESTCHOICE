# Pre-Merge Guard Report — 2026-04-26

**Reviewed by**: Pre-Merge Guard (automated)
**Date**: 2026-04-26
**Branches reviewed** (3 most recently updated non-guard branches):

1. `fix/hosting-nocache-spa-html`
2. `fix/hosting-header-order`
3. `feat/liff-early-payoff-direct-paysolutions`

---

## Branch 1: `fix/hosting-nocache-spa-html`

**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Commit**: `208f3bce` — fix(hosting): no-cache on SPA HTML so deploys take effect immediately

### File Changes
| File | +/- |
|------|-----|
| `firebase.json` | +4 / -2 |

### Change Summary
Adds `Cache-Control: no-cache, no-store, must-revalidate` to the global `**` header rule in `firebase.json` for both hosting sites. Ensures the SPA `index.html` is never cached by browsers or CDN, so new deploys take effect immediately.

### Issues Found

#### Info
- **Appears superseded**: Commit `816fdcd5` (PR #682) already applied an identical no-cache change to `main`. The merge-base of this branch against `main` is `aeb4a2ef` (before PR #682), while `main` already contains `816fdcd5`. Merging this branch would result in a no-op diff since main already has the same lines.

### Recommendation: **INFO — SUPERSEDED**
The change is correct and safe but was already merged via PR #682. This branch can be closed without merging.

---

## Branch 2: `fix/hosting-header-order`

**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Commit**: `9292b915` — fix(hosting): reorder header rules so JS/CSS keep immutable cache

### File Changes
| File | +/- |
|------|-----|
| `firebase.json` | +20 / -20 (reorder only, no new content) |

### Change Summary
Reorders Firebase Hosting header rules from:
```
1. **/*.@(js|css)  → Cache-Control: immutable
2. **/*.@(svg|png|…) → Cache-Control: immutable
3. **            → security headers + Cache-Control: no-cache
```
to:
```
1. **            → security headers + Cache-Control: no-cache
2. **/*.@(js|css)  → Cache-Control: immutable  (overrides no-cache for hashed assets)
3. **/*.@(svg|png|…) → Cache-Control: immutable
```

**Why this is a real bug fix**: Firebase Hosting applies headers from the array in order; for the same header key, later matching rules win. The old ordering had `**` (no-cache) LAST, meaning it overrode the `immutable` cache set by the JS/CSS rule for all JS/CSS files. This caused production to serve hashed/versioned JS bundles with `no-cache`, forcing revalidation on every page load — a significant performance regression. The new order ensures security headers are applied globally while hashed assets retain their long-lived `immutable` cache.

### Issues Found
None.

### Recommendation: **APPROVE**
Config-only change. Correct reasoning. No TypeScript/backend changes. No security regressions — security headers still apply to all files via the `**` rule that now comes first.

---

## Branch 3: `feat/liff-early-payoff-direct-paysolutions`

**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Commit**: `37e37ea4` — feat(liff-early-payoff): skip /pay/{token} landing, jump to PaySolutions

### File Changes
| File | +/- |
|------|-----|
| `apps/web/src/pages/liff/LiffEarlyPayoff.tsx` | +19 / -3 |

### Change Summary
Refactors the early payoff mutation to bypass the intermediate `/line-oa/liff/early-payoff` endpoint (which created a `PaymentLink` shell then redirected through `/pay/{token}`) and instead calls `/paysolutions/create-intent` directly, jumping straight to the PaySolutions hosted QR page. `installmentNo` is intentionally omitted.

### Backend Endpoint Validation
The called endpoint `POST /paysolutions/create-intent`:
- Uses `@UseGuards(LiffTokenGuard)` — LINE LIFF token verified. Acceptable for LIFF context (no JWT needed).
- Validates `contractId`, `amount`, `lineId` — present.
- Verifies `contract.customer.lineId === lineId` — prevents one LINE user from creating a payment for another customer's contract. Correct.
- Rate-limited: `@Throttle({ short: { ttl: 10000, limit: 5 } })`.

### Issues Found

#### Warning — Missing server-side early payoff amount validation
**File**: `apps/web/src/pages/liff/LiffEarlyPayoff.tsx:79`

```typescript
const { data: intent } = await liffApi.post('/paysolutions/create-intent', {
  contractId,
  amount: Number(quote.totalPayoff),   // ← amount from client
  ...
  // installmentNo intentionally omitted
});
```

When `installmentNo` is `null`/`undefined`, `paysolutions.service.ts:createPaymentIntent()` (line ~141) **skips amount validation entirely** — it only validates the amount against `amountDue` when `installmentNo` is present. This means the backend accepts any client-supplied amount for an early payoff intent without checking it against the actual contract outstanding balance.

**Risk**: A user who manipulates the LIFF page's JavaScript could create a payment intent for a lower amount (e.g., 1 THB) and pay only that to PaySolutions. The webhook distributes the actual paid amount FIFO across installments — so the contract would NOT be closed as `EARLY_PAYOFF` (since insufficient to cover all installments), resulting in a partial payment being applied. The customer cannot exploit this to zero their debt for free, but they CAN create an unexpected partial payment, which creates reconciliation noise and potential UX confusion.

**Recommended fix**: Add server-side validation in `createPaymentIntent` when `installmentNo` is null — compute the actual early payoff total from the DB and verify `amount` is within a ±1 THB tolerance.

#### Warning — `Number()` on financial field
**File**: `apps/web/src/pages/liff/LiffEarlyPayoff.tsx:84`

```typescript
amount: Number(quote.totalPayoff),
```

`quote.totalPayoff` comes from an API response (JSON). The `paysolutions/create-intent` service accepts `number` (not `Prisma.Decimal`), so the cast is consistent with the existing API contract. For Thai phone prices (< 100,000 THB with 2 decimal places), IEEE 754 double has sufficient precision (exact to 52 bits). Low risk in practice, but violates the project's money-as-Decimal convention.

**Recommended fix**: Ensure the quote API serializes `totalPayoff` as a string, and the service DTO accepts `string | number` parsed to `Prisma.Decimal` internally.

#### Info — Validation bypass is documented but untested
The commit comment notes: *"installmentNo is intentionally omitted so backend skips per-installment amount validation (the payoff amount intentionally exceeds any single installment)"*. This is correct reasoning but the early payoff happy-path has no E2E test coverage verifying the new flow end-to-end (direct to PaySolutions → webhook → EARLY_PAYOFF status).

### Recommendation: **REVIEW**
No critical security issues (the LIFF token guard + lineId ownership check prevent cross-customer attacks). The two warnings are business-logic gaps that could cause partial-payment edge cases and future precision issues. Should add server-side early payoff amount validation before merging to production.

---

## Summary

| Branch | Files Changed | Critical | Warning | Info | Verdict |
|--------|--------------|----------|---------|------|---------|
| `fix/hosting-nocache-spa-html` | 1 (config) | 0 | 0 | 1 | INFO — SUPERSEDED |
| `fix/hosting-header-order` | 1 (config) | 0 | 0 | 0 | **APPROVE** |
| `feat/liff-early-payoff-direct-paysolutions` | 1 (frontend) | 0 | 2 | 1 | **REVIEW** |

### Action Items
1. **`fix/hosting-nocache-spa-html`**: Close branch — change already merged to `main` via PR #682.
2. **`fix/hosting-header-order`**: Safe to merge. Fixes a real cache-header ordering bug.
3. **`feat/liff-early-payoff-direct-paysolutions`**: Add server-side early payoff amount validation in `createPaymentIntent` (when `installmentNo=null`, validate `amount` against DB-computed outstanding balance). Then re-review.
