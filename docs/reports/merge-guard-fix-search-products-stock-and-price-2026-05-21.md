# Merge Guard Report — fix/search-products-stock-and-price

**Date**: 2026-05-21  
**Branch**: `fix/search-products-stock-and-price`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Base**: `origin/main`  
**Recommendation**: ⚠️ REVIEW

> **Stack note**: This branch builds on `fix/grounding-guard` (already APPROVE-flagged). The incremental changes here are in `search-products.tool.ts` and `calculate-installment.tool.ts`. The grounding guard + tests are inherited.

---

## File Changes Summary

| File | +Lines | -Lines |
|------|--------|--------|
| `apps/api/src/modules/sales-bot/sales-bot.service.ts` | +63 | 0 |
| `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` | +93 | 0 |
| `apps/api/src/modules/sales-bot/tools/search-products.tool.ts` | +57 | −22 |
| `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts` | +14 | −6 |

**Total**: 4 files changed, 221 insertions, 28 deletions.

---

## Issues Found

### Critical — None

### Warning

**W-1 · `Number()` on Prisma Decimal in financial calculation** (calculate-installment.tool.ts)

```ts
// calculate-installment.tool.ts:39-47
const price = Number(sellingPrice);                            // ❌ Decimal → JS float
const downAmount = Math.round(price * (downPct / 100));        // ❌ Math.round on money
const financed = price - downAmount;
const totalInterest = Math.round(financed * (ratePct / 100) * (input.tenureMonths / 12));
const monthly = Math.round(totalFinanced / input.tenureMonths);
```

`sellingPrice` is `Prisma.Decimal` from `@db.Decimal(12, 2)`. Converting to `Number()` then using `Math.round()` for installment math is against the project's money-field rules (`database.md`: use `Decimal` only, never `Float`/`Number` for money). Although the result is presented to an LLM (not written to the DB), customers receive these quotes via LINE and may act on them. A floating-point rounding difference of ฿1-2 between the bot quote and the actual contract would create support friction.

**Suggested fix** — use integer math (multiply-then-divide strategy) or `Prisma.Decimal`:
```ts
import Prisma from '@prisma/client';
const price = new Prisma.Decimal(sellingPrice);
const downAmount = price.mul(downPct).div(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
```

**W-2 · `Number()` on Prisma Decimal for LLM display** (search-products.tool.ts, line 56)

```ts
return { ...base, priceThb: Number(price) };  // price is Decimal
```

For a chat-bot tool result (display to LLM, no DB write), this is lower risk. However, `Number(price)` on Decimal can lose sub-cent precision for large amounts. At THB phone prices (5,000–50,000 range, 2 dp), IEEE 754 double is exact, so no real precision loss here in practice. Still a project-rule violation — flag for consistency.

**W-3 · `Number(cfg.interestRate) * 100`** (calculate-installment.tool.ts, line 60)

```ts
return Number(cfg.interestRate) * 100;  // interestRate is Decimal
```

`interestRate` is stored as a Decimal fraction (0.15 = 15%). Multiplied by 100 and returned as `ratePct` (a display value). Same class of violation as W-2 — low practical risk for a 2dp rate field, but inconsistent with codebase rules.

### Info

**I-1 · Non-null assertion `input.maxPriceThb!`** (search-products.tool.ts, line 57)

```ts
products = products.filter((p) => p.priceThb <= input.maxPriceThb!);
```

The assertion is inside `if (input.maxPriceThb !== undefined)` so it is safe. This is eliminated in the follow-on branch (`fix/soften-price-missing`) which extracts `cap = input.maxPriceThb`. No action required here if merging only this branch.

---

## Detailed Assessment

### What this branch adds (beyond fix/grounding-guard)

**search-products.tool.ts** — two significant fixes:
1. Adds `status: 'IN_STOCK'` filter so the bot never recommends sold/holding units.
2. Replaces `costPrice` (wholesale) with `ProductPrice.amount` (selling price). Root cause of the Nai 7,000 bug: the wholesale cost of that iPhone 15 was ฿7,000 but it was being passed as the selling price.

**calculate-installment.tool.ts**:
- Replaces `costPrice` with `ProductPrice.amount` (same correctness fix).
- Adds `price_not_configured` error return when no default ProductPrice exists.
- `deletedAt: null` correctly included in the `prices` relation filter ✅.

### Security review

- No new controllers — no guard gaps.
- All new Prisma queries correctly include `deletedAt: null` ✅.
- No `$queryRaw` usage.
- `take: 10` on the product fetch with a post-filter `.slice(0, 5)` — fine for the LLM tool context; not a DoS vector.
- No hardcoded secrets.

---

## Summary

The core fix (stop quoting `costPrice` as selling price, filter to IN_STOCK) is correct and important. Three `Number()` violations on Decimal fields are flagged as Warning — W-1 carries the most real-world risk since it affects quoted installment amounts. Recommend fixing W-1 before merge; W-2 and W-3 can follow in a cleanup PR.
