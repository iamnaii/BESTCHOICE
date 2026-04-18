# Merge Guard Report — feat/stock-list-view-detail

**Date**: 2026-04-18  
**Branch**: `feat/stock-list-view-detail`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`

---

## File Changes Summary

| File | +Lines | -Lines |
|------|--------|--------|
| `apps/web/src/pages/StockPage/index.tsx` | 15 | 1 |
| **Total** | **15** | **1** |

### Change Description
Adds a "ดูรายละเอียด" (View Detail) action button as a new column in the stock list table. The button navigates to `/products/${id}` using the pre-existing `navigateToProduct` callback (defined at line 111). Uses `e.stopPropagation()` to prevent the row's own click handler from firing when the button is clicked.

---

## Issues Found

### Critical — None

### Warning — None

### Info

**I1: Duplicate navigation path**  
- **Description**: The row already has an `onClick` handler that calls `navigateToProduct(p.id)` (line 138 of `index.tsx`). The new "ดูรายละเอียด" button duplicates that action. This is intentional UX (explicit affordance beats discover-by-click), but worth documenting so the row-click isn't accidentally removed later thinking it's dead code.

---

## Positive Observations

- **Correct semantic colors**: `text-muted-foreground`, `hover:text-primary`, `hover:bg-accent` — no hardcoded grays.
- **Correct icon usage**: `Eye` from `lucide-react`, already in the existing import list.
- **`navigateToProduct` reused**: No new navigation logic introduced, no inline `useNavigate`.
- **`e.stopPropagation()`** prevents double-navigation from row + button overlap.
- **No backend changes** — zero security surface added.

---

## Recommendation

**✅ APPROVE** — Clean, minimal change. No issues requiring action.
