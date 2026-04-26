# Merge Guard Report — feat/liff-early-payoff-direct-paysolutions

**Date**: 2026-04-26  
**Branch**: `feat/liff-early-payoff-direct-paysolutions`  
**Author**: Akenarin Kongdach / iamnaii  
**Latest commit**: `37e37ea4` — feat(liff-early-payoff): skip /pay/{token} landing, jump to PaySolutions  
**Commits ahead of main**: 176  
**Recommendation**: 🟡 **REVIEW** — 1 warning (unvalidated payment amount) before merge

---

## File Changes Summary

1 file changed — 19 insertions / 3 deletions

Changed file: `apps/web/src/pages/liff/LiffEarlyPayoff.tsx`

**What changed**: The early payoff LIFF flow previously called `POST /line-oa/liff/early-payoff` which minted an intermediate `PaymentLink` shell and redirected to `/pay/{token}`. This PR skips that hop and calls `POST /paysolutions/create-intent` directly, immediately redirecting the customer to the PaySolutions QR page.

---

## Security Checks

| Check | Result |
|-------|--------|
| Uses `liffApi` (LIFF-scoped axios), not raw `fetch()` | ✅ Pass |
| Target endpoint `POST /paysolutions/create-intent` has `@UseGuards(LiffTokenGuard)` — appropriate for LIFF context | ✅ Pass |
| Backend validates `contract.customer.lineId === lineId` — user can only pay their own contracts | ✅ Pass |
| Backend validates contract exists and is not deleted | ✅ Pass |
| No hardcoded secrets | ✅ Pass |
| Mutation uses `useMutation` from react-query, not raw `fetch()` | ✅ Pass |

---

## Issues

### Warning

**W-001 — Amount not validated against expected payoff on the backend**  
File: `apps/web/src/pages/liff/LiffEarlyPayoff.tsx:79`

```typescript
const { data: intent } = await liffApi.post('/paysolutions/create-intent', {
  contractId,
  amount: Number(quote.totalPayoff),   // client-supplied amount
  description: `ปิดยอดก่อนกำหนด สัญญา ${quote.contractNumber}`,
  lineId,
  // installmentNo intentionally omitted — skips per-installment validation
});
```

The PR comment explicitly states that `installmentNo` is omitted to bypass per-installment amount validation. Looking at `paysolutions.service.ts:130`, when `installmentNo` is absent the backend only validates:
1. Contract exists
2. `contract.customer.lineId === lineId` (identity check)

It does **not** validate that `amount` matches the actual early payoff quote from the server. A customer who intercepts the LIFF request (e.g., via devtools) could send a manipulated `amount: 1` and receive a valid PaySolutions QR for 1 THB instead of the full payoff balance.

**Recommended fix**: Add a dedicated validation path in `paysolutions.service.ts` for early-payoff (no `installmentNo`) — compute the expected `totalOutstanding` from the contract and throw if `amount < expectedPayoff * 0.99` (allow small rounding tolerance). Alternatively, create a dedicated `POST /paysolutions/create-early-payoff-intent` endpoint that computes the amount server-side.

---

### Info

**I-001 — `Number(quote.totalPayoff)` is a no-op**  
`LiffEarlyPayoffQuote.totalPayoff` is already typed as `number` in `packages/shared/src/liff-types.ts`. The `Number()` cast is redundant but harmless. Can be simplified to just `quote.totalPayoff`.

**I-002 — Bypassed validation is undocumented in tests**  
The PR comment says "installmentNo intentionally omitted so backend skips per-installment amount validation". There is no unit test or E2E test that verifies a tampered amount is caught. When W-001 is fixed, add a test: `describe('early payoff without installmentNo — should validate against totalOutstanding')`.

---

## Overall Assessment

Small, focused change with clear intent. The LIFF authentication chain is intact (LINE token guard → lineId ownership check). The main concern is that skipping the intermediate landing page also skips amount validation, creating a window where a technically savvy customer could underpay. The fix is a targeted backend-side amount guard.

**Recommendation**: 🟡 **REVIEW** — fix W-001 (add backend amount validation for payoff intents) before merge.
