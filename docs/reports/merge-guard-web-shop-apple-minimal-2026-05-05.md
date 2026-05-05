# Merge Guard Report — `feat/web-shop-apple-minimal`

**Date**: 2026-05-05  
**Branch**: `feat/web-shop-apple-minimal`  
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local  
**Commits**: 1 (Apple-minimal catalog redesign)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/web-shop/src/components/catalog/ProductCard.tsx` | +94 | -57 | Apple-style card layout, removes shadcn `Card`/`Badge`, adds grade chips |
| `apps/web-shop/src/pages/CatalogPage.tsx` | +228 | -59 | Inline brand/grade/sort pill filters, removes `CategoryHero`/`SortDropdown` |
| `apps/web-shop/src/index.css` | +19 | 0 | Font (`font-display`) and animation utility additions |

---

## Issues Found

### Info

#### I-1: Hardcoded Tailwind color classes in `ProductCard.tsx`

`bg-zinc-100`, `text-zinc-400`, `bg-amber-100/80`, `text-amber-700`, `bg-amber-500`, `bg-emerald-50`, `text-emerald-700`, `bg-emerald-500`

The admin-app rules prohibit `text-gray-*` / `bg-gray-*` in favour of semantic tokens, but the CLAUDE.md theme description for the web-shop is "Minimal Zinc + Emerald Accent." Using zinc for the product image plate and emerald/amber for stock status chips is consistent with the stated brand direction and is unlikely to break theming since `web-shop` uses its own independent `index.css`. Not a rule violation in this context, but worth aligning with a future shop-specific design token set.

#### I-2: `heroNoun` defaults to `'iPhone'` when brand filter is "ทั้งหมด"

**File**: `apps/web-shop/src/pages/CatalogPage.tsx:112`

```typescript
const heroNoun =
  activeBrand === 'Samsung' ? 'Galaxy'
  : activeBrand === 'OPPO' ? 'OPPO'
  : activeBrand === 'Xiaomi' ? 'Xiaomi'
  : 'iPhone';  // fallback when showing all brands
```

If the shop carries significant non-Apple inventory, the headline "ค้นหา iPhone ในราคาที่ใช่" appearing while browsing all brands could mislead users. If iPhone dominance is deliberate business positioning this is fine; otherwise the default could be a generic term like `'มือถือ'`.

#### I-3: `useEffect` for keyboard event listener

**File**: `apps/web-shop/src/pages/CatalogPage.tsx:82`

The `useEffect` handles an Escape key listener for the sort dropdown — not data fetching. This is correct usage of `useEffect` for side effects. No issue.

---

## Backend Security Checklist

Not applicable — this branch contains only frontend (`apps/web-shop`) changes with no API endpoints, DTOs, or backend services.

---

## Recommendation

**APPROVE** — No Critical or Warning issues.

Purely frontend visual changes. Uses React Query for data fetching, `api.get()` for API calls, `toast` for notifications, and semantic tokens for most styling. The zinc/amber/emerald colors in `ProductCard` are consistent with the web-shop brand direction and are isolated to the public shop app.
