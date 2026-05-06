# Merge Guard Report — feat/web-shop-apple-minimal

**Date**: 2026-05-06  
**Branch**: `feat/web-shop-apple-minimal`  
**Author**: Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`  
**Recommendation**: ✅ **APPROVE** — clean, no issues found

---

## File Changes Summary

| File | +Lines | -Lines | Type |
|------|--------|--------|------|
| `apps/web-shop/src/components/catalog/ProductCard.tsx` | +73 | -37 | UI redesign |
| `apps/web-shop/src/pages/CatalogPage.tsx` | +236 | -72 | UI redesign |
| `apps/web-shop/src/index.css` | +19 | 0 | CSS additions (font-display) |

**Total**: 3 files changed, 341 insertions(+), 91 deletions(−)

---

## Issues Found

### 🔴 Critical — None

- ✅ `apps/web-shop` is a public-facing storefront — no authentication required for the catalog page (intentionally public)
- ✅ `CatalogPage.tsx` uses `useQuery` from `@tanstack/react-query` ✓
- ✅ API calls use `api.get()` from `@/lib/api` ✓
- ✅ No backend changes — purely frontend UI refactor
- ✅ No hardcoded secrets or credentials

### 🟡 Warning — None

### 🔵 Info

**I-1: URL encoding improvement in `ProductCard.tsx`**

`to` construction now uses `encodeURIComponent(p.brand)` (was missing encoding before). This is a positive fix — brand names like `OPPO` / `Xiaomi` are safe, but Apple-style product names with spaces would have been broken before. ✓

**I-2: `heroNoun` fallback defaults to `'iPhone'`**

`CatalogPage.tsx` — when `activeBrand` is `'ทั้งหมด'` or unknown, `heroNoun` defaults to `'iPhone'`. This means all-brands view shows "iPhone. ผ่อนได้บัตรเดียว." which may be misleading when Samsung/OPPO products are shown. Consider a neutral noun like `'สมาร์ทโฟน'` or `'มือถือ'` for the all-brands view. Not a bug but a UX concern.

**I-3: Sort dropdown — custom listbox implementation**

`CatalogPage.tsx` implements a custom `role="listbox"` sort dropdown. The accessibility handling (Escape → close, focus return to trigger, overlay button for click-outside) is well implemented. The pattern correctly uses `aria-haspopup="listbox"` and `aria-expanded`. Minor note: `aria-label="ปิดเมนูเรียง"` on the overlay backdrop button is good — it gives screen readers a named control instead of an anonymous clickable area.

---

## Verification Checklist

- [x] No backend changes — frontend only ✓
- [x] Public shop page — no auth guard needed ✓
- [x] `useQuery` pattern used correctly ✓
- [x] `api.get()` used, no raw `fetch()` in data layer ✓
