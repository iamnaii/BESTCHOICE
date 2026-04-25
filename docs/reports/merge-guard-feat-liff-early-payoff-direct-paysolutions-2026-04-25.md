# Merge Guard Report — feat/liff-early-payoff-direct-paysolutions

**Date**: 2026-04-25  
**Branch**: `feat/liff-early-payoff-direct-paysolutions`  
**Author**: Akenarin Kongdach  
**Commit**: `37e37ea4` — feat(liff-early-payoff): skip /pay/{token} landing, jump to PaySolutions  
**Base**: `origin/main`

---

## File Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `apps/web/src/pages/liff/LiffEarlyPayoff.tsx` | +19 / -3 | Changes `payoffMutation` to call `/paysolutions/create-intent` directly instead of `/line-oa/liff/early-payoff` |

---

## Issues Found

### Warning — Client-supplied `amount` not server-validated against computed payoff

**File**: `apps/web/src/pages/liff/LiffEarlyPayoff.tsx:79`  
**Backend**: `apps/api/src/modules/paysolutions/paysolutions.service.ts` — `createPaymentIntent()`

The previous flow (`/line-oa/liff/early-payoff`) computed the payoff amount entirely on the server and returned a fixed `PaymentLink`. The new flow passes `amount: Number(quote.totalPayoff)` from the frontend directly to `/paysolutions/create-intent`.

The backend `createPaymentIntent()` only validates the `amount` against the actual outstanding when `installmentNo` is provided (single-installment normal payment). When `installmentNo` is omitted — as this PR intentionally does for early payoff — **no amount validation is performed**:

```ts
// apps/api/src/modules/paysolutions/paysolutions.service.ts ~line 90
if (installmentNo) {
  // validates amount === expected outstanding for that installment
  ...
}
// ↑ early payoff path falls through with no amount check
```

This means a customer who intercepts the request can change `amount` to any value (e.g., 1 THB) and the backend will create a valid PaySolutions QR for that amount. The webhook then credits only the amount PaySolutions confirms was paid — so the contract won't be fully closed — but the customer gets a legitimate payment receipt for an arbitrary low amount applied to their balance, and operations staff would see an inconsistency between the early-payoff quote and what was actually paid.

**Risk level**: Medium. The actual financial harm is bounded (a customer can only underpay their own contract, not overpay or affect other contracts), but it produces silent partial payments that look like early-payoff attempts and can confuse reconciliation.

**Suggested fix**: The backend should verify `amount` equals the server-computed payoff amount before creating the PaySolutions intent. The simplest approach is to accept `contractId` + `lineId` from the frontend, re-compute `totalPayoff` server-side, and pass that authoritative value to PaySolutions — ignoring the client-supplied `amount` entirely.

---

### Warning — `Number()` coercion on financial amount

**File**: `apps/web/src/pages/liff/LiffEarlyPayoff.tsx:83`

```ts
amount: Number(quote.totalPayoff),
```

`quote.totalPayoff` is already typed as `number` in `packages/shared/src/liff-types.ts` so the `Number()` call is redundant. More importantly, this sets a precedent of using `Number()` on monetary values. The backend DTO (`CreatePaymentIntentDto.amount: number`) and the stored `PaymentLink.amount` are Decimal in the DB — precision is preserved because JS numbers are IEEE 754 doubles adequate for THB amounts (no cent fractions exceed 15 significant digits), but the project convention is to avoid explicit `Number()` on financial fields.

Use `quote.totalPayoff` directly.

---

### Info — Comment explains a security bypass in production code

**File**: `apps/web/src/pages/liff/LiffEarlyPayoff.tsx:76–82`

```ts
// installmentNo is intentionally omitted so backend skips per-installment
// amount validation (the payoff amount intentionally exceeds any single installment).
```

A comment that documents "we intentionally skip server-side validation" in production code should be a trigger to add that validation to the backend instead. Remove the comment once the backend validates the amount independently.

---

### Info — `qrCodeUrl` returned by controller but not by service

**Backend**: `apps/api/src/modules/paysolutions/paysolutions.controller.ts`

```ts
return { ..., qrCodeUrl: result.qrCodeUrl };  // undefined — service doesn't return it
```

`createPaymentIntent()` (service) returns `{ paymentId, paymentUrl, gatewayRef }`. The controller adds `qrCodeUrl: result.qrCodeUrl` which is `undefined`. Not a bug for this PR (frontend only reads `paymentUrl`) but creates dead API surface.

---

## Summary Table

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 0 | — |
| Warning | 2 | Missing server-side amount validation, `Number()` on financial field |
| Info | 2 | Security bypass comment, undefined `qrCodeUrl` in controller response |

---

## Recommendation

**REVIEW** — Do not merge until the backend validates the early-payoff amount server-side.

The UX improvement (skipping the intermediate landing page) is desirable and the authentication check (`contract.customer.lineId === lineId`) is solid. The blocker is that `createPaymentIntent` needs to re-compute the payoff amount on the backend when `installmentNo` is absent and an early-payoff `description` is passed, rather than trusting the client-supplied value. This keeps the flow short while closing the amount-manipulation surface.
