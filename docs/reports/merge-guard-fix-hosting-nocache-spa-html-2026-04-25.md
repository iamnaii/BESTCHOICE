# Merge Guard Report — fix/hosting-nocache-spa-html

**Date**: 2026-04-25  
**Branch**: `fix/hosting-nocache-spa-html`  
**Author**: Akenarin Kongdach  
**Commit**: `208f3bce` — fix(hosting): no-cache on SPA HTML so deploys take effect immediately  
**Base**: `origin/main`

---

## File Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `firebase.json` | +4 / -2 | Adds `Cache-Control: no-cache, no-store, must-revalidate` to the `**` catch-all header rule for both hosting sites |

---

## Issues Found

### Warning — Firebase header order breaks asset caching

**File**: `firebase.json`

In Firebase Hosting, when multiple header rules match the same URL, ALL matching rules are applied and **later rules override earlier ones** for the same header key.

This branch places the `**` catch-all rule **last** in the headers array, with both security headers and `Cache-Control: no-cache, no-store, must-revalidate`. However, `**` also matches `.js`, `.css`, and image files. Since `**` comes after the `**/*.@(js|css)` rule, its `no-cache` value overwrites the `max-age=2592000, immutable` that was set for assets:

```
Rule 1: **/*.@(js|css)    → Cache-Control: public, max-age=2592000, immutable  ← set
Rule 2: **/*.@(svg|...)   → Cache-Control: public, max-age=2592000, immutable  ← set
Rule 3: **                → Cache-Control: no-cache, no-store, must-revalidate ← overrides!
```

Effect: every page load re-fetches **all** JS and CSS bundles from the CDN, negating the immutable-cache build strategy and causing noticeable performance regression in production.

**Intent was correct** — SPA HTML (`index.html`) should not be cached so new deployments take effect immediately. Only the ordering is wrong.

**Fix**: Move the `**` security-header block **first** so that more-specific `js|css` and `svg|...` rules override its `Cache-Control` value. This is exactly what `fix/hosting-header-order` does.

---

## Recommendation

**REVIEW** — Do not merge this branch alone. The asset-caching regression is a significant performance bug.  
Prefer merging `fix/hosting-header-order` instead, which contains this commit plus the ordering fix.
