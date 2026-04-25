# Merge Guard Report — feat/liff-early-payoff-direct-paysolutions

**Date**: 2026-04-25  
**Branch**: `feat/liff-early-payoff-direct-paysolutions`  
**Author**: Akenarin Kongdach  
**Latest commit**: `37e37ea4` — feat(liff-early-payoff): skip /pay/{token} landing, jump to PaySolutions  
**Recommendation**: ⚠️ REVIEW (1 warning before merge)

---

## Summary of Changes

The branch is behind `origin/main` by PRs #697–#701 (collections-foundation, company taxId fix, inbox dialogs, Portal fix). The **only new code** not in main is one commit changing a single file:

| File | Lines | Change |
|------|-------|--------|
| `apps/web/src/pages/liff/LiffEarlyPayoff.tsx` | +19 / -3 | Replace old 2-step flow (liff/early-payoff → /pay/{token}) with a direct POST to `/paysolutions/create-intent` |

The old flow:
```
liffApi.post('/line-oa/liff/early-payoff') → { url, token } → window.location.href = url
```
The new flow:
```
liffApi.post('/paysolutions/create-intent', { amount, contractId, lineId, description })
  → { paymentUrl } → window.location.href = paymentUrl
```

---

## Issues by Severity

### Critical — 0 issues

### Warning — 1 issue

**W1 — `Number()` on financial amount sent to payment gateway**  
`LiffEarlyPayoff.tsx:79`:
```ts
amount: Number(quote.totalPayoff),
```
`quote.totalPayoff` comes from the API as a Prisma `Decimal` string (e.g. `"10800.00"`). Converting via `Number()` is safe for typical phone prices (no precision loss below 2^53), but the project convention is to avoid `Number()` on money fields. The backend `paysolutions/create-intent` receives this as a JSON float, which it then converts back to Decimal — any `.01` / `.99` cent amounts would survive `Number()` in practice (double has 15-16 significant digits), but the correct pattern is:
```ts
amount: quote.totalPayoff.toString(),   // or String(quote.totalPayoff)
```
and the backend should parse as `new Prisma.Decimal(amount)`. Recommend fixing before merge to stay consistent with the coding standard and prevent subtle issues if the API changes to strict-Decimal parsing.

### Info — 2 issues

**I1 — LIFF endpoint bypasses JWT — correct**  
`liffApi.post('/paysolutions/create-intent', ...)` uses the LIFF client (`liffApi`), not the staff `api`. The paysolutions controller is an intentionally-public endpoint (listed in `security.md`). No missing guard.

**I2 — Missing `result.success` check**  
`onSuccess` only checks `result.paymentUrl` truthiness. If the backend ever returns `{ success: false, paymentUrl: null }`, the existing `toast.error` fires. If it returned `{ success: false, paymentUrl: 'https://...' }` the user would be redirected despite a logical failure. The current backend contract does not appear to return that combination, so this is low risk.

---

## Required Fix Before Merge

Change `LiffEarlyPayoff.tsx:79`:
```ts
// Before
amount: Number(quote.totalPayoff),

// After
amount: String(quote.totalPayoff),
```
Confirm the `/paysolutions/create-intent` endpoint accepts `amount` as a string and parses it with `new Prisma.Decimal(amount)` (check `paysolutions.service.ts`).
