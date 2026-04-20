# Merge Guard Report — refactor/customer-contract-detail-ui

**Date**: 2026-04-20  
**Branch**: `refactor/customer-contract-detail-ui`  
**Author**: Akenarin Kongdach  
**Tip commit**: `724a67ab` — refactor(ui): ปรับหน้า CustomerDetail + ContractDetail + PaymentTimeline ให้อ่านง่ายขึ้น (Sat Apr 18)  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary (Tip Commit Only)

| File | Change |
|------|--------|
| `components/contract/ContractPaymentSchedule.tsx` | Import renamed: `PaymentTimeline` → `PaymentProgressOverview` |
| `components/contract/PaymentTimeline.tsx` | Default export renamed; timeline detail section removed (~107 lines removed) |
| `pages/ContractDetailPage.tsx` | Header layout redesigned (+new structure) |
| `pages/CustomerDetailPage.tsx` | Added 4 summary cards + badge nav to tabs |

**Net (tip commit)**: 4 files, +137 / −163 lines. Frontend-only.

---

## Branch Staleness Warning ⚠️

This branch diverged from `main` at approximately commit `3babb58e` (fix(theme): dark mode — PR #506). Current `main` is at PR #622 — **116+ commits ahead**. The branch carries ~10 older commits (PR #504–#515 era) that overlap with the current main history.

Additionally, `main` was force-pushed since this branch was created (`+ 3babb58e...379159ee`), meaning a clean three-dot diff against current main is not possible. **Merging without a rebase will produce significant conflicts.**

---

## Issues

### Critical
None in the unique UI changes.

### Warning

1. **Branch is stale — needs rebase before merge**  
   The branch is 116+ commits behind `main`. A direct merge will conflict with the current main history, which itself was force-pushed. This branch **must be rebased onto `origin/main`** before it can safely land.

2. **`parseFloat()` removed from financial display (positive change)**  
   The old code had `parseFloat(contract.sellingPrice) - parseFloat(contract.downPayment)` in the UI. This line was **removed** in the tip commit, which is correct. No new `parseFloat`/`Number()` on financial values introduced.

### Info
- **Default export rename**: `PaymentTimeline.tsx` now exports `PaymentProgressOverview` as its default. The consumer (`ContractPaymentSchedule.tsx`) is updated correctly. Any other file importing the old name `PaymentTimeline` would break — verify no other imports exist.
- **Timeline detail removed**: The detailed per-installment timeline UI was removed from `PaymentTimeline.tsx` in favor of a simpler progress overview. If this detail view is needed elsewhere, it must be re-added or accessed via a different component.

---

## Assessment

The actual code changes in the tip commit are clean: pure UI improvements, correct token usage (design tokens, no hardcoded colors), no backend changes, no financial arithmetic, no security impact.

The blocker is **branch staleness**, not code quality. The branch cannot be merged as-is due to the history divergence from the force-pushed main.

---

## Recommendation: ⚠️ REVIEW (Rebase Required)

The code itself is approved, but the branch needs to be rebased onto current `main` before merging. After rebase, this should be a straightforward APPROVE.

**Action required**: `git rebase origin/main` on this branch, resolve any conflicts, re-run `./tools/check-types.sh all`.
