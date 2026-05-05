# Merge Guard Report — feat/web-shop-apple-minimal

| Field | Value |
|-------|-------|
| Branch | `feat/web-shop-apple-minimal` (tip identical to `fix/wipe-cli-runtime-tsx`) |
| Author | Akenarin Kongdach |
| Date reviewed | 2026-05-05 |
| Base | `origin/main` |

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/web-shop/src/components/catalog/ProductCard.tsx` | +84 / -22 |
| `apps/web-shop/src/pages/CatalogPage.tsx` | +247 / -60 |
| `apps/web-shop/src/index.css` | +19 / 0 |

Single commit: `feat(web-shop): Apple-minimal catalog redesign` — redesigns the web-shop catalog with Apple-style hero, sticky pill filter toolbar, and a card layout that removes the old `Card`/`Badge` components.

---

## Issues by Severity

### Critical
_None._

### Warning

**W1 — `leading-none` on Thai-capable element (`ProductCard.tsx`)**

```tsx
// gradeChip function
className="... flex items-center justify-center leading-none"
```

Frontend rule: "ห้ามใช้ `leading-none` — ตัด สระบน ไทย." Grade chips render single ASCII letters (A/B/C) so clipping is unlikely in practice, but the prohibition is unconditional. Replace with `leading-[1]` or `leading-snug`.

---

**W2 — Hardcoded Tailwind palette colors instead of semantic design tokens (`ProductCard.tsx`)**

```tsx
<div className="... bg-zinc-100 ...">   {/* image plate */}
<div className="text-zinc-400 ...">     {/* no-image placeholder */}
```

Frontend rule: "ห้ามใช้ hardcoded... ใช้ semantic tokens เท่านั้น." Zinc is a Tailwind base-palette colour, not a CSS-variable token. Prefer:
- `bg-zinc-100` → `bg-muted`
- `text-zinc-400` → `text-muted-foreground`

---

**W3 — Hardcoded `amber-*` and `emerald-*` in stock chip (`ProductCard.tsx`)**

```tsx
? 'text-amber-700 bg-amber-100/80'
: 'text-emerald-700 bg-emerald-50',
```

Same rule as W2 — bypasses the CSS variable token system. Options:
- Extend `tokens.css` with `--color-stock-urgent` / `--color-stock-ok` and reference via `bg-[var(--color-stock-ok)]`
- Or use existing semantic tokens: `bg-destructive/10 text-destructive` for urgent, `bg-primary/10 text-primary` for available

---

### Info

**I1 — Hero noun defaults to "iPhone." for the all-brands view (`CatalogPage.tsx`)**

```tsx
const heroNoun =
  activeBrand === 'Samsung' ? 'Galaxy'
  : activeBrand === 'OPPO'   ? 'OPPO'
  : activeBrand === 'Xiaomi' ? 'Xiaomi'
  : 'iPhone';   // ← used when activeBrand === 'ทั้งหมด'
```

When no brand filter is active the hero reads "iPhone. ผ่อนได้บัตรเดียว." which implies an Apple-only catalogue. Consider a generic noun (e.g. "สมาร์ทโฟน.") for the unfiltered state.

---

**I2 — Brand list hardcoded in component (`CatalogPage.tsx`)**

```tsx
const BRANDS = ['ทั้งหมด', 'Apple', 'Samsung', 'OPPO', 'Xiaomi'] as const;
```

Adding a new brand requires a code change. Low urgency but worth noting if the catalogue expands.

---

**I3 — `CatalogPage.tsx` is 306 lines**

Approaching the 500-line soft limit; acceptable today. If the sticky toolbar or hero section grows further, consider extracting `CatalogHero` and `CatalogToolbar` sub-components.

---

**I4 — Google Fonts loaded via CSS `@import url(...)` at runtime (`index.css`)**

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:...");
```

External network call on every page load. Consider self-hosting Inter via `@fontsource/inter` (already present in the main `apps/web` bundle) to improve offline resilience and GDPR posture. Not blocking for now.

---

## Positive Findings

- ✅ Data fetching correctly uses `useQuery` + `api.get()` — no raw `fetch()`.
- ✅ No raw `useEffect` for data fetching.
- ✅ `queryClient.invalidateQueries()` not needed here (read-only query page).
- ✅ Semantic tokens used throughout — `text-foreground`, `text-muted-foreground`, `bg-background`, `border-border`, `bg-muted`, `text-primary`, `bg-primary`, `text-primary-foreground`.
- ✅ `aria-pressed` on Pill filter buttons, `aria-label` on grade chips — accessible.
- ✅ Decorative CTA button correctly marked `aria-hidden="true" tabIndex={-1}` with comment.
- ✅ Keyboard handler (Escape) on sort dropdown with focus-return to trigger.
- ✅ `leading-snug` used on Thai text elements — no `leading-none` except the one flagged above.
- ✅ Image uses `loading="lazy"` and proper `alt` text.

---

## Recommendation

**REVIEW** — Three Warning items must be addressed before merge:
1. Replace `leading-none` with `leading-[1]` in `gradeChip`.
2. Replace `bg-zinc-100` / `text-zinc-400` with `bg-muted` / `text-muted-foreground`.
3. Replace hardcoded `amber-*`/`emerald-*` stock chip colors with CSS-variable tokens.

Info items can be deferred to a follow-up.
