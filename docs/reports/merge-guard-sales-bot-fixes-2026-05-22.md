# Pre-Merge Guard Report — Sales-Bot Fix Branches
**Date**: 2026-05-22  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: 3 most-recently-committed non-guard/watchdog branches

---

## Summary Table

| Branch | Last Commit | Files Changed vs Main | Recommendation |
|--------|-------------|----------------------|----------------|
| `fix/soften-price-missing` | 2026-05-21 23:21 | 0 (fully stale) | ✅ CLOSE — stale |
| `fix/search-products-stock-and-price` | 2026-05-21 23:15 | 1 (would revert UX fix) | 🚫 BLOCK |
| `fix/grounding-guard` | 2026-05-21 22:57 | 2 (would revert critical fixes) | 🚫 BLOCK |

---

## Branch 1: `fix/soften-price-missing`

**Author**: Akenarin Kongdach  
**Merge-base with main**: `c54628fb`  
**Commits ahead of main**: 1 (`29dcae9f`)

### File changes vs main (two-dot)
`git diff origin/main..origin/fix/soften-price-missing --stat` → **0 files changed**

### Finding
This branch is **fully stale**. All content from commit `29dcae9f` has already been incorporated into `main` via a squash/cherry-pick workflow. `main` already contains the `priceMissing: true` behaviour in `search-products.tool.ts`.

### Issues
None — branch is a no-op against current main.

### Recommendation: ✅ CLOSE (stale, safe to delete)

---

## Branch 2: `fix/search-products-stock-and-price`

**Author**: Akenarin Kongdach  
**Merge-base with main**: `77f9b018`  
**Commits ahead of main**: 2 (`faeba2d9`, `663e7bdd`)

### File changes vs main (two-dot)
```
apps/api/src/modules/sales-bot/tools/search-products.tool.ts  |  49 +++++++++-------------
1 file changed, 19 insertions(+), 30 deletions(-)
```

### Finding — **CRITICAL: Merge would revert UX fix**

The branch contains an **intermediate version** of `search-products.tool.ts` where products without a configured `ProductPrice` are **silently dropped** from results (`if (price == null) return null`).

`main` already has the improved `priceMissing: true` behaviour (from `fix/soften-price-missing`) which keeps unprice products in results with a flag so the persona's "no-data → handoff" rule triggers instead of the bot quoting nothing. The comment in `main` explicitly documents why the silent-skip approach was too aggressive:

> *"Earlier draft of this fix dropped them silently — too aggressive when owner hasn't backfilled ProductPrice rows yet, would have nuked all bot quotes."*

Merging this branch would **revert** `main` back to the silent-drop behaviour.

Additionally, the grounding-guard service logic and tests (commits `faeba2d9`) are already in `main` — so the service-level content is also stale.

### Issues

| Severity | Location | Issue |
|----------|----------|-------|
| **Critical** | `search-products.tool.ts:56-72` | Merge would revert `priceMissing: true` to silent-drop, removing the persona's no-data handoff path |

### Recommendation: 🚫 BLOCK — do not merge; would regress UX fix already in main

---

## Branch 3: `fix/grounding-guard`

**Author**: Akenarin Kongdach  
**Merge-base with main**: `77f9b018`  
**Commits ahead of main**: 1 (`faeba2d9`)

### File changes vs main (two-dot)
```
apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts  | 14 ++----
apps/api/src/modules/sales-bot/tools/search-products.tool.ts         | 58 ++++++----------------
2 files changed, 17 insertions(+), 55 deletions(-)
```

### Finding — **CRITICAL: Merge would reinstate "Nai 7,000 bug"**

This branch diverged from main at `77f9b018` — an older commit before the `costPrice → ProductPrice` migration landed. The branch only added the grounding guard service logic; it did **not** update the tool files.

Merging this branch would **overwrite** two tool files with their old `costPrice`-based implementations:

1. **`search-products.tool.ts`** — Branch version uses `costPrice` as the selling-price proxy. `main` uses `ProductPrice.amount` (the actual customer-facing price). The branch version is exactly what caused the documented "Nai 7,000 hallucination" incident on 2026-05-21: `costPrice` (wholesale) was being served as `priceThb` (asking price), so the bot quoted 7,000฿ for an iPhone 15 whose wholesale cost was 7,000฿ but whose selling price is higher. Additionally, the branch version does not filter `status: 'IN_STOCK'` — out-of-stock units would appear in results again.

2. **`calculate-installment.tool.ts`** — Branch version uses `costPrice` for installment calculation. `main` correctly uses `ProductPrice.amount`. Reverting this would make installment quotes based on wholesale cost again.

Note: the grounding guard logic added in this branch (`guardGrounding` / `collectGroundedPrices` in `sales-bot.service.ts`) **is** already in `main`, so those additions would be a no-op — but the destructive overwrites to the two tool files make this a definite block.

### Issues

| Severity | Location | Issue |
|----------|----------|-------|
| **Critical** | `search-products.tool.ts` | Merge reverts to `costPrice` proxy — reinstates wholesale-as-asking-price bug |
| **Critical** | `search-products.tool.ts` | Removes `status: 'IN_STOCK'` filter — out-of-stock units reappear in bot results |
| **Critical** | `search-products.tool.ts` | Removes `priceMissing: true` UX fix — reverts persona handoff path |
| **Critical** | `calculate-installment.tool.ts` | Merge reverts to `costPrice`-based installment calculation |

### Recommendation: 🚫 BLOCK — do not merge; would reinstate the 2026-05-21 price hallucination bug across two tool files

---

## Context: Branch Relationship

These three branches were created in sequence during the 2026-05-21 "Nai 7,000" incident response:

1. `fix/grounding-guard` — added the programmatic grounding guard (service + tests only)
2. `fix/search-products-stock-and-price` — built on top; also fixed the tool files (costPrice → ProductPrice, added IN_STOCK filter)  
3. `fix/soften-price-missing` — follow-up on top of #2; changed silent-drop to `priceMissing: true`

All content was incorporated into `main` via squash-merge/cherry-pick. The branches remain listed as "not merged" because their commit SHAs are not in `main`'s ancestry. They are safe to delete.

---

## Action Required

| Branch | Action |
|--------|--------|
| `fix/soften-price-missing` | Delete (stale, fully in main) |
| `fix/search-products-stock-and-price` | Delete (stale + would partially revert if merged) |
| `fix/grounding-guard` | Delete (stale + would revert critical tool fixes if merged) |

**No changes required to `main`** — it already contains the correct, most-advanced version of all affected files.
