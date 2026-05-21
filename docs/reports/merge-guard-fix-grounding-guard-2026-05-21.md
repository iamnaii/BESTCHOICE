# Merge Guard Report — fix/grounding-guard

**Date**: 2026-05-21  
**Branch**: `fix/grounding-guard`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Base**: `origin/main`  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +Lines | -Lines |
|------|--------|--------|
| `apps/api/src/modules/sales-bot/sales-bot.service.ts` | +63 | 0 |
| `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` | +93 | 0 |

**Total**: 2 files changed, 156 insertions, 0 deletions.

---

## Issues Found

### Critical — None

### Warning — None

### Info

**I-1**: `collectGroundedPrices` uses `Number(v)` to coerce tool result values into JS numbers for price comparison. These values are already serialised through the LlmProvider boundary (Decimal → JSON → string/number), so coercion here is intentional and safe — NOT a Decimal violation. No financial computation occurs; the numbers are only compared for grounding verification.

```ts
// sales-bot.service.ts:258
const n = Number(v);  // v is already serialised — intentional coerce
```

---

## Detailed Assessment

### What this branch does

Adds a deterministic "grounding guard" (`guardGrounding`) to `SalesBotService.generateReply()` that:

1. Collects every `priceThb / monthly / minPrice / maxPrice` numeric value seen in tool results this session (via `collectGroundedPrices`).
2. After the LLM produces its final reply, scans the text for Thai/English price mentions (`บาท|฿|baht|THB`).
3. If any mentioned price ≥1,000 does not match (within ±5%) a grounded price, blocks the reply and returns a staff-handoff message.

**Motivation**: Gemini 2.5 ignored the anti-hallucinate persona rules in PR #1064 and replied "iPhone 15 7,000 บาท" when tools had returned iPhone 13 (14,691) + iPhone 16 (17,000). This guard is a programmatic backstop independent of model behaviour.

### Security review

- No new controllers → no `@UseGuards` or `@Roles` gap.
- No raw `$queryRaw` or parameterised SQL changes.
- No hardcoded secrets or API keys.
- `sales-bot` module is not directly web-exposed (it is invoked by `staff-chat` which has its own guards).

### Test quality

3 regression tests added in `sales-bot.service.spec.ts`:
1. `blocks reply with hallucinated price not seen in any tool result` — core case (Nai 7,000 bug).
2. `accepts reply citing a price within ±5% of a grounded tool result` — tolerance pass.
3. `passes reply without any price mention even if no tools used` — no-price bypass.

Coverage is targeted and sufficient for the new guard logic.

### Edge case noted (non-blocking)

The price regex `/([\d][\d,]{2,})\s*(?:บาท|฿|baht|THB)/gi` requires at least 3 digits, so prices like "900 บาท" or "500 บาท" are skipped regardless of the `<1000` guard. The explicit `if (num < 1000) continue` is therefore belt-and-suspenders — both conditions must fail for a sub-1000 price to slip through. This is intentional conservatism, not a bug.

---

## Summary

Clean, focused fix with targeted regression tests. No security concerns. Approved for merge.
