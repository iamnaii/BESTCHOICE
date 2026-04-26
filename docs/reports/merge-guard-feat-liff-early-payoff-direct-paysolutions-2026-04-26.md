# Merge Guard Report — feat/liff-early-payoff-direct-paysolutions

**Date**: 2026-04-26  
**Branch**: `feat/liff-early-payoff-direct-paysolutions`  
**Author**: Akenarin Kongdach  
**Latest commit**: 2026-04-24  
**Commits on branch**: 1  

---

## File Changes Summary

1 file changed, 19 insertions(+), 3 deletions(-)

| File | Change |
|------|--------|
| `apps/web/src/pages/liff/LiffEarlyPayoff.tsx` | Replace two-hop payoff flow with direct PaySolutions intent call |

---

## Changes Description

The branch removes the intermediate `/line-oa/liff/early-payoff` hop (which created a `PaymentLink` shell and redirected to `/pay/{token}`). Instead, `LiffEarlyPayoff` now calls `POST /paysolutions/create-intent` directly, passing `contractId`, `amount`, `description`, and `lineId`. On success, the user is redirected to `result.paymentUrl` (the PaySolutions hosted QR page).

---

## Issues by Severity

### Critical
None found.

### Warning

**[W-1] `Number(quote.totalPayoff)` — `totalPayoff` is a Decimal money field**  
```typescript
amount: Number(quote.totalPayoff),
```
`quote.totalPayoff` comes from the backend as a JSON-serialized Decimal string. Converting it to a JS `Number` before sending to the API introduces theoretical floating-point imprecision, though for Thai Baht amounts under 10M the result will be exact to 2 decimal places. The backend endpoint (`/paysolutions/create-intent`) validates and re-reads amount from its own `CreatePaymentIntentDto`, so no financial error propagates to the gateway without server-side confirmation. Low risk but violates the project rule.  
_Suggested fix_: pass `String(quote.totalPayoff)` and let the backend's DTO parse it as Decimal, or confirm the DTO already accepts `number` type.

**[W-2] Validation bypass comment may confuse future reviewers**  
```typescript
// installmentNo is intentionally omitted so backend skips per-installment
// amount validation (the payoff amount intentionally exceeds any single installment).
```
The comment is correct but frames itself as "skipping validation" — this may alarm future reviewers. The backend enforces amount via `LiffTokenGuard` + DTO + PaySolutions server-side confirmation. Consider rephrasing to clarify why omitting `installmentNo` is correct for a full payoff (not a bypass, but a different code path).

### Info

**[I-1] Old `/line-oa/liff/early-payoff` POST endpoint**  
If this branch ships, the old backend endpoint (`POST /line-oa/liff/early-payoff`) is no longer called from the frontend. It is not removed. If no other clients call it, consider deprecating it in a follow-up to reduce surface area. No action required for this PR.

---

## Security Assessment

- `POST /paysolutions/create-intent` is protected by `@UseGuards(LiffTokenGuard)` + `@Throttle({ short: { ttl: 10000, limit: 5 } })` — appropriate for LIFF context.
- No hardcoded secrets, no JWT stored in localStorage, no raw SQL.
- LIFF token verification (`LiffTokenGuard`) ensures the caller is a valid LINE session.
- Amount is re-validated server-side by `CreatePaymentIntentDto` and PaySolutions gateway; frontend numeric conversion does not bypass server controls.

---

## Recommendation

**REVIEW**

[W-1] is a minor rule violation with negligible real-world risk given server-side validation. [W-2] is a documentation smell only. Both can be fixed with 1-2 line changes. If the team agrees the risk is acceptable, this can merge as-is with a follow-up note to deprecate the unused endpoint.
