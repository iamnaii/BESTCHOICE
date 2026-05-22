# Merge Guard Report — fix/search-products-stock-and-price

**Date**: 2026-05-22  
**Branch**: `fix/search-products-stock-and-price`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`

---

## File Changes Summary

| File | +/- | Type |
|------|-----|------|
| `apps/api/src/modules/sales-bot/sales-bot.service.ts` | +63 added | Backend service |
| `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` | +97 added | Tests |
| `apps/api/src/modules/sales-bot/tools/search-products.tool.ts` | +57 / -22 | Backend tool |
| `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts` | +14 / -1 | Backend tool |

**Total**: 4 files changed, 221 insertions, 22 deletions

---

## Changes Overview

**Root cause fixed**: Gemini 2.5 was replying "iPhone 15 7,000 บาท" when the tool returned iPhone 13/16 at 14,691/17,000. Two underlying bugs:

1. **`search-products.tool.ts`** — was using `costPrice` (wholesale) instead of `ProductPrice` (selling price), and was not filtering by `status: 'IN_STOCK'`, so sold/holding units leaked into results with wrong prices.
2. **`calculate-installment.tool.ts`** — same root cause: `costPrice` used as selling-price proxy.

**Fixes applied**:
- Both tools now query the `prices` relation with `{ isDefault: true, deletedAt: null }`.
- `search-products` adds `status: 'IN_STOCK'` to the product filter.
- `SalesBotService` gains a `guardGrounding()` programmatic backstop: any THB price in the final reply must be within ±5% of a price the model actually received via a tool result. Hallucinated prices force handoff to staff.

**Tests added**: 3 regression cases covering hallucinated price (blocked), rounded-price within tolerance (passes), and no-price reply (passes).

---

## Issues

### Critical
_None_

### Warning

**W1 — `Number()` on Prisma `Decimal` money fields (2 sites)**

| File | Line | Expression |
|------|------|-----------|
| `search-products.tool.ts` | `return { ...base, priceThb: Number(price) }` | `price = r.prices[0]?.amount` (Decimal) |
| `calculate-installment.tool.ts` | `const price = Number(sellingPrice)` | `sellingPrice = product.prices[0]?.amount` (Decimal) |

Both violate the project's Decimal money policy (v4 hardening removed all `Number()` wrapping of money fields). **Practical precision risk is negligible** for THB prices (5–6 digit integers), and JSON serialisation for LLM tool results inherently requires a plain number. However, the same pattern was flagged in v4. Prefer `.toNumber()` with an explicit comment, or document the LLM-serialisation exception in `.claude/rules/accounting.md`.

**W2 — `maxPriceThb` filter moved from DB to JS**

Previously filtered as `costPrice: { lte: input.maxPriceThb }` at the Prisma query level. Now done in JS after fetching up to 10 rows. For current inventory sizes this is harmless, but if the product catalog grows large it wastes a round-trip. Consider restoring a DB-level filter on `ProductPrice.amount` via a subquery (or add a TODO comment to revisit when catalog > 1k products).

### Info

**I1 — `guardGrounding` blocks any price mention when `grounded.size === 0`**

If no tool was called but the persona prompt contains example prices (e.g. "บาท" in a prompt template), the guard will block the reply. Low risk with current prompt design, but worth noting for future prompt engineers.

**I2 — `maxPriceThb` filter in `search-products` uses non-null assertion (`input.maxPriceThb!`)**

The undefined check already guards it (`if (input.maxPriceThb !== undefined)`), so the assertion is correct but the style is slightly inconsistent with the codebase norm of using the checked variable directly.

---

## Security & Pattern Checks

| Check | Result |
|-------|--------|
| New controllers missing `@UseGuards(JwtAuthGuard)` | ✅ No new controllers |
| Money fields using `Number()` | ⚠️ 2 sites (W1) |
| `deletedAt: null` on all new queries | ✅ All new `findFirst`/`findMany` include `deletedAt: null`; `prices` sub-queries also include it |
| Hardcoded secrets | ✅ None |
| Missing `@Roles()` | ✅ No new controller methods |
| SQL injection via `$queryRaw` | ✅ None |
| Raw `fetch()` in React component | ✅ N/A (backend only) |
| Missing `queryClient.invalidateQueries()` | ✅ N/A (backend only) |

---

## Recommendation

**REVIEW** ⚠️

Two Warnings (W1 money Decimal policy, W2 in-memory price filter) and two low-risk Info items. The core logic is correct and the hallucination fix is a meaningful safety improvement. Merge is not blocked, but W1 should be addressed before or alongside merging to keep the Decimal discipline introduced in v4.

Suggested action: add `.toNumber()` with a `// LLM serialisation — JSON requires Number; THB range is precision-safe` comment at both sites, then APPROVE.
