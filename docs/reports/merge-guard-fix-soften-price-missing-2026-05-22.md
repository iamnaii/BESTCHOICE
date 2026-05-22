# Merge Guard Report — fix/soften-price-missing

**Date**: 2026-05-22  
**Branch**: `fix/soften-price-missing`  
**Author**: Akenarin Kongdach  
**Base**: `origin/fix/search-products-stock-and-price` → `origin/main`

---

## File Changes Summary

| File | +/- | Type |
|------|-----|------|
| `apps/api/src/modules/sales-bot/tools/search-products.tool.ts` | +30 / -19 | Backend tool |

**Total**: 1 file changed, 30 insertions, 19 deletions

---

## Context

This branch builds on top of `fix/search-products-stock-and-price`. The combined diff from `main` shows the base fix (costPrice → ProductPrice, `IN_STOCK` filter) already in place; this commit softens the null-price handling from "silently drop" to "return `priceMissing: true`" so the AI persona's "no-data → handoff" rule can trigger instead of simply omitting the product.

---

## Issues

### Critical
_None_

### Warning

**W1 — `Number()` on Prisma `Decimal` money field**

Location: `search-products.tool.ts`, line `return { ...base, priceThb: Number(price) };`  
`price` is `r.prices[0]?.amount` — a `Prisma.Decimal` from `@db.Decimal(12, 2)`. Converting via `Number()` violates the project's Decimal money policy and was explicitly flagged in the v4 hardening sprint ("53 `Number()` → `Prisma.Decimal`").

**Practical risk here is low** (THB prices are 5–6 digit integers, no JS float precision loss), and the value is serialised to JSON for LLM consumption (JSON has no Decimal type), but the rule should be acknowledged. Options:

1. Keep `Number(price)` and add a comment: `// LLM tool result — JSON serialisation requires Number; precision safe for THB range`
2. Call `.toNumber()` (same result, but explicit about Prisma Decimal → JS number intent)

### Info
_None_

---

## Recommendation

**REVIEW** ⚠️

One Warning (W1 — `Number()` on Decimal). Either add the LLM-serialisation justification comment or switch to `.toNumber()` to make intent explicit. No blocking security issues. Logic change is correct and safe.
