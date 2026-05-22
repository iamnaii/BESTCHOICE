# Pre-Merge Guard Report

**Branch**: `fix/soften-price-missing`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Date**: 2026-05-22
**Recommendation**: 🟡 **REVIEW** — one borderline Decimal issue; logic fix itself is correct

---

## File Changes Summary

1 file changed, 30 insertions(+), 19 deletions(-)

- `apps/api/src/modules/sales-bot/tools/search-products.tool.ts`

---

## What the Change Does

The sales-bot `search_products` tool previously silently dropped products that had no `ProductPrice` row configured (returned `null` and was filtered out). This caused the bot to never mention products that the owner hadn't yet backfilled prices for — a data-gap bug that was worse than showing the product.

The fix changes behavior: products without a price now come back with `priceMissing: true` (and no `priceThb` field). The bot's persona "no-data → handoff" rule then takes over and tells the customer to ask staff for the price.

Sorting is adjusted so price-missing items appear at the end of results (after priced items, sorted by price ascending).

---

## Issues by Severity

### 🔴 Critical
None found.

### 🟡 Warning

#### W1 — `Number(price)` on Prisma Decimal field

**Line**: `return { ...base, priceThb: Number(price) };` (when `price = r.prices[0]?.amount`)

`r.prices[0]?.amount` is typed as `Prisma.Decimal` (ProductPrice.amount is `@db.Decimal(12, 2)`). Converting to `Number` is technically a rule violation (database.md: "ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน").

**Mitigating context**: This value is returned to the sales-bot's LLM response as JSON. LLMs consume JSON numbers natively and cannot use `Prisma.Decimal` objects. The conversion at this JSON serialisation boundary is the same pattern as other service response layers (e.g. `installment-preview.service.ts` uses `.toNumber()` for the same reason). The price is used only for display to the LLM (quoting to a customer) — not for financial arithmetic, tax calculation, or double-entry bookkeeping.

**Recommendation**: Acceptable as-is given the presentation context. If strictly enforcing the rule, use `.toNumber()` explicitly instead of `Number()` for clarity:
```ts
return { ...base, priceThb: price.toNumber() };
```

---

### 🔵 Info

#### I1 — `Number.MAX_SAFE_INTEGER` used as sort sentinel for price-missing items

```ts
const aP = 'priceThb' in a ? a.priceThb : Number.MAX_SAFE_INTEGER;
```

This is a readable pattern and works correctly. The sentinel value is never returned to the user — it only affects sorting order.

---

## What's Working Well

- **Logic is correct**: Including price-missing products with a clear `priceMissing: true` flag is better than silently dropping them. The bot's persona rules then handle the fallback gracefully.
- **Filter for maxPriceThb**: Correctly excludes price-missing items from the price cap filter (`!('priceThb' in p) || p.priceThb <= cap`) — price-missing products always pass through the cap filter.
- **No security issues**: No new endpoints, no auth changes, no SQL injection risk.
- **No guard changes**: Existing module auth is unchanged.
