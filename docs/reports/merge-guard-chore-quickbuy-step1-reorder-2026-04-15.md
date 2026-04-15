# Merge Guard Report — chore/quickbuy-step1-reorder

**Date**: 2026-04-15  
**Branch**: `chore/quickbuy-step1-reorder`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Last commit**: 2026-04-08  
**Reviewed against**: `origin/main` (7750d1b8)  
**Recommendation**: 🔴 BLOCK

---

## Context

This branch predates multiple force-pushes to main and is **significantly behind** current main.
It contains 4 commits unique to the branch, but the underlying codebase diverged from an older
snapshot of the repo. Direct merge would be destructive.

**Scale of divergence**: 559 TypeScript/TSX files differ between this branch and main
(15K insertions vs 57K deletions) — merging would delete ~42K lines of code that exist in main.

---

## File Changes Summary

**Unique commits** (4):
- `58871078` — ui(trade-in): reorder Step 1 fields (2026-04-08)
- `5f6468cf` — refactor(trade-in): quickBuy orchestrator + rebrand modal as primary flow
- `d5fdd241` — feat(trade-in): Quick Buy wizard + seller history + working search (#418)
- `d693daec` — feat: chatbot-finance + trade-in voucher with anti-stolen-goods (#417)

The last 3 commits have their content already in main (via squash/rebase). Only `58871078`
represents a change NOT yet reflected in main.

---

## Issues

### 🔴 Critical (1)

**C-001** — REGRESSION: `apps/web/src/components/trade-in/QuickBuyModal.tsx`  
The most recent unique commit (`58871078`) applies a UI reorder on top of an **older version**
of `QuickBuyModal.tsx` that lacks features main has:

| Feature | Branch (old base) | Main (current) |
|---------|-------------------|----------------|
| Smart card reader (`readSmartCard`) | ❌ Removed | ✅ Present |
| Structured address picker (`AddressForm`) | ❌ Removed (plain textarea) | ✅ Present |
| `composeAddress()` for normalized storage | ❌ Removed | ✅ Present |

If merged, the trade-in Quick Buy flow would lose:
- Thai national ID card reader integration
- Structured province/district/sub-district address autocomplete
- Normalized address storage format

The branch replaces the structured address with a plain text `sellerAddress` string field,
which is a regression from the structured `AddressForm` implementation in main.

```diff
// Branch — older, less featured
+ sellerAddress: '',  // plain string

// Main — current, more featured
  [address, setAddress] = useState<AddressData>({ ...emptyAddress });  // AddressForm state
  sellerAddress: composeAddress(address) || undefined,  // normalized output
```

---

### ℹ️ Info (2)

**I-001** — The UI reorder change in `58871078` IS a valid UX improvement:
  - 2-column grid → single-column flow: ชื่อ → เลขบัตร → เบอร์ → ที่อยู่ → รูปบัตร
  - Matches reading order of other customer forms in the system
  - ID card upload expanded to full-row h-12 with clearer label

  This improvement should be **cherry-picked onto main** (applied to main's
  `QuickBuyModal.tsx`), not merged wholesale from this branch.

**I-002** — No security issues found in the unique `58871078` commit itself (UI-only change,
no new API calls, no new guards needed, no money field changes).

---

## Recommendation: 🔴 BLOCK

Do **not** merge this branch. It would cause a regression in the trade-in Quick Buy flow
by removing smart card reader and structured address picker functionality.

**Correct action**: Cherry-pick the UX improvements from `58871078` onto a branch based
on current main:

```bash
git checkout -b chore/quickbuy-step1-reorder-v2 origin/main
git cherry-pick 58871078
# Manually resolve any conflicts to preserve AddressForm + readSmartCard
```

Verify that the reorder changes (field order, ID card upload height) apply cleanly on top
of main's `QuickBuyModal.tsx` without losing existing features.
