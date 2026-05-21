# Merge Guard Report — fix/soften-price-missing

**Date**: 2026-05-21  
**Branch**: `fix/soften-price-missing`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Base**: `origin/main`  
**Recommendation**: ⚠️ REVIEW

> **Stack note**: This is the tip of a 3-branch fix chain:
> `fix/grounding-guard` → `fix/search-products-stock-and-price` → **`fix/soften-price-missing`**
> 
> The diff vs `main` includes all changes from the full chain. Incremental change here is only in `search-products.tool.ts` (30 lines changed). All other files were changed in the lower branches (already reviewed separately).

---

## File Changes Summary (full diff vs main)

| File | +Lines | -Lines | Branch |
|------|--------|--------|--------|
| `apps/api/src/modules/sales-bot/sales-bot.service.ts` | +63 | 0 | fix/grounding-guard |
| `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` | +93 | 0 | fix/grounding-guard |
| `apps/api/src/modules/sales-bot/tools/search-products.tool.ts` | +49 | −19 | **this branch** (replaces prior fix) |
| `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts` | +14 | −6 | fix/search-products-stock-and-price |

**Total**: 4 files changed, 219 insertions, 25 deletions.

---

## Issues Found

### Critical — None

### Warning

**W-1 · `Number()` on Prisma Decimal in financial calculation** (calculate-installment.tool.ts — inherited from prior branch)

```ts
// calculate-installment.tool.ts:39-47
const price = Number(sellingPrice);                             // ❌ Decimal → JS float
const downAmount = Math.round(price * (downPct / 100));         // ❌ Math.round on money
const financed = price - downAmount;
const totalInterest = Math.round(financed * (ratePct / 100) * (tenureMonths / 12));
const monthly = Math.round(totalFinanced / tenureMonths);
```

Inherited from `fix/search-products-stock-and-price`. Installment amounts quoted to customers via LINE. A ฿1 discrepancy between bot quote and actual contract causes support friction. Should use integer-safe arithmetic (see W-1 in prior report for suggested fix).

**W-2 · `Number()` on Prisma Decimal in search-products tool** (search-products.tool.ts, line 73)

```ts
return { ...base, priceThb: Number(price) };  // price is Decimal
```

Lower risk than W-1 (display only, no customer-binding commitment), but violates project money rules.

**W-3 · `Number(cfg.interestRate) * 100`** (calculate-installment.tool.ts — inherited)

Same as W-3 in prior report.

### Info

**I-1 · `priceMissing: true` union type is untyped at the LLM layer**

```ts
type Hit =
  | { ...; priceThb: number }
  | { ...; priceMissing: true };
```

The `Hit` type is scoped locally to the method. The LLM receives this as a JSON tool result; whether the persona correctly handles `priceMissing: true` items (handoff vs. quoting) depends entirely on the `BOT_EXTRAS` persona rules. If the persona doesn't handle this key, the bot will see the product but silently omit price — potentially confusing. This is a business logic concern, not a code defect.

**I-2 · `Number.MAX_SAFE_INTEGER` as sort sentinel**

```ts
const aP = 'priceThb' in a ? a.priceThb : Number.MAX_SAFE_INTEGER;
```

Sentinel sorting pattern — fine for LLM tool use. Not financial computation.

---

## Detailed Assessment

### What this branch adds (over fix/search-products-stock-and-price)

Changes the behaviour for products without a default `ProductPrice` row:

| Prior fix (`fix/search-products-stock-and-price`) | This branch (`fix/soften-price-missing`) |
|---|---|
| Products without a price were **silently dropped** from results | Products without a price return with `priceMissing: true` and **no `priceThb` field** |
| With zero ProductPrice rows in the DB, the bot would return 0 results | Bot returns the product name/model so the persona can say "ราคาติดต่อสาขา" instead of "ไม่มีสินค้า" |
| `maxPriceThb` filter used `p.priceThb <= input.maxPriceThb!` (non-null assert) | Filter is `!('priceThb' in p) \|\| p.priceThb <= cap` — priceMissing items pass through |
| Sort used `a.priceThb - b.priceThb` directly | Sort uses `Number.MAX_SAFE_INTEGER` sentinel — missing-price items appear last |

**Business rationale**: If the owner hasn't backfilled `ProductPrice` rows yet (post-catalog migration), the prior fix would have nuked all bot product results. The softer approach lets the bot acknowledge the product exists while deferring the price to staff — safer for rollout.

### Security review

- No new controllers — no `@UseGuards`/`@Roles` gaps.
- All new Prisma queries correctly include `deletedAt: null` ✅.
- No `$queryRaw`.
- `take: 10` → `.slice(0, 5)` pattern retained ✅.
- No hardcoded secrets.
- Non-null assertion `input.maxPriceThb!` from the prior branch is fixed here — replaced with local `cap` variable ✅.

### Grounding guard interaction

The `priceMissing: true` items have **no `priceThb` field**, so `collectGroundedPrices` will not add any price to the grounding set for those products. If the LLM hallucinates a price for a `priceMissing` product, the grounding guard will catch it (because grounded set is empty for that product's price). This is the correct and desired behaviour.

---

## Summary

The `priceMissing` softening is a sound product decision — it prevents the bot from going dark when ProductPrice rows haven't been backfilled yet. The non-null assertion from the prior branch is fixed here. Inherited Warnings W-1/W-2/W-3 from `Number()` usage on Decimal money fields remain and should be addressed — especially W-1 (`calculate-installment.tool.ts`) where quoted installment amounts could have rounding discrepancies vs actual contracts. Recommend fixing W-1 before merge to main.

---

## Action Items Before Merge

| Priority | Item | File | Owner |
|----------|------|------|-------|
| Should fix | W-1: Replace `Number()` + `Math.round` in installment calc with Decimal arithmetic | `calculate-installment.tool.ts:39-47` | Akenarin |
| Can follow | W-2: Replace `Number(price)` in search tool with `Prisma.Decimal` toString or keep as-is with a comment | `search-products.tool.ts:73` | Akenarin |
| Can follow | W-3: Replace `Number(cfg.interestRate)` with `.toNumber()` or keep as-is | `calculate-installment.tool.ts:60` | Akenarin |
