# Merge Guard Report — feat/liff-early-payoff-direct-paysolutions

**Date**: 2026-04-25  
**Branch**: `feat/liff-early-payoff-direct-paysolutions`  
**Author**: Akenarin Kongdach  
**Commit**: `37e37ea4`  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +Lines | -Lines | Description |
|------|--------|--------|-------------|
| `apps/web/src/pages/liff/LiffEarlyPayoff.tsx` | 19 | 3 | Replace intermediate landing-page hop with direct PaySolutions intent |

**Total**: 1 file changed, 19 insertions(+), 3 deletions(-)

---

## What Changed

The old flow called `/line-oa/liff/early-payoff`, which minted a `PaymentLink` shell and returned a `/pay/{token}` URL for the customer to land on first. This branch skips that intermediate page and calls `/paysolutions/create-intent` directly — the same endpoint the regular payment page uses — then redirects immediately to the PaySolutions hosted QR.

---

## Issues by Severity

### Critical
_None_

### Warning

**W-001 — `Number()` on a Decimal financial field sent to backend**

```tsx
// apps/web/src/pages/liff/LiffEarlyPayoff.tsx
amount: Number(quote.totalPayoff),
```

`quote.totalPayoff` comes from the API as a serialised `Decimal` string (e.g. `"12500.00"`). Converting it with `Number()` can introduce IEEE 754 floating-point rounding for amounts with more than 15 significant digits, and strips trailing zeros that a strict backend comparator might distinguish. The backend `CreatePaymentIntentDto` accepts `amount` as a plain number, so this is tolerated today, but the pattern is inconsistent with the codebase rule (use `Prisma.Decimal`, avoid `Number()` on money).

**Suggested fix** (one-liner): pass the string directly.
```tsx
amount: String(quote.totalPayoff),   // or: quote.totalPayoff.toString()
```
Backend should parse with `new Prisma.Decimal(dto.amount)` and already does so.

### Info

**I-001 — Auth guard is correct but implicit**

`/paysolutions/create-intent` is guarded with `@UseGuards(LiffTokenGuard)` (verified on main at `paysolutions.controller.ts:53`). The LIFF page calls this via `liffApi` which attaches `X-Liff-Id-Token`, so auth is correct. However the inline comment in the diff says *"installmentNo is intentionally omitted so backend skips per-installment amount validation"* — this is fine but worth noting that the backend `createPaymentIntent` service should (and does) accept a free-form amount for early payoff without binding it to a specific installment's `amountDue`.

**I-002 — No `queryClient.invalidateQueries()` needed**

This is a mutation that redirects away from the page on success. No cache invalidation is required. Correct as-is.

---

## Recommendation

**⚠️ REVIEW**

One Warning (W-001). The change is logically correct and the endpoint is properly authenticated. Fix the `Number()` → `String()` before merging to stay consistent with the Decimal-safety rule.
