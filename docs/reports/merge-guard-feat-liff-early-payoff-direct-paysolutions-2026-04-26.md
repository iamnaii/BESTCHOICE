# Pre-Merge Guard Report

**Branch**: `feat/liff-early-payoff-direct-paysolutions`
**Author**: Akenarin Kongdach
**Date**: 2026-04-26
**Commit**: 37e37ea4
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Lines Added | Lines Removed |
|------|------------|--------------|
| `apps/web/src/pages/liff/LiffEarlyPayoff.tsx` | +19 | 3 |

**Total**: 1 file modified, 22 lines net change

---

## Issues by Severity

### Critical
_None found._

### Warning

**`LiffEarlyPayoff.tsx` line ~73 — `Number()` on financial Decimal field**
```typescript
amount: Number(quote.totalPayoff),
```
`quote.totalPayoff` is a Decimal returned from the API (likely serialised as a string). Passing it through `Number()` is safe for typical Thai baht amounts (< 2^53) but loses the invariant that financial values are handled as strings end-to-end. Prefer:
```typescript
amount: String(quote.totalPayoff),
```
...and ensure the backend `/paysolutions/create-intent` endpoint accepts `amount` as a string (it likely already does since the previous early-payoff flow sent amounts as Decimal-stringified values). Mitigated by the fact this is a LIFF customer-facing page where amounts are bounded (< ฿100,000).

**`LiffEarlyPayoff.tsx` — installmentNo intentionally omitted**
```typescript
// installmentNo is intentionally omitted so backend skips
// per-installment amount validation (the payoff amount
// intentionally exceeds any single installment).
```
This is correct logic for early payoff, but the bypass relies on a backend convention that may not be explicitly documented in the `/paysolutions/create-intent` endpoint spec. Recommend adding a test case or comment in the backend controller to document that `installmentNo: undefined` triggers the "full payoff" code path.

### Info

- Change is narrow (22 lines) and the intent is clear: skip the intermediate `/pay/{token}` redirect and call `/paysolutions/create-intent` directly, same endpoint already used by the regular payment page.
- The `onError` handler at line ~88 correctly passes `err.message` to `toast.error()` — no information leakage.
- Guard `if (!quote) throw new Error(...)` before the API call prevents undefined access.

---

## Recommendation

**REVIEW**

The `Number()` conversion on `totalPayoff` is a minor precision concern worth addressing before merge. The installmentNo bypass is intentional but needs backend-side documentation. Neither issue is a blocker in isolation, but both should be confirmed by the author before merging.
