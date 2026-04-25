# Merge Guard Report — fix/hosting-header-order

**Date**: 2026-04-25  
**Branch**: `fix/hosting-header-order`  
**Author**: Akenarin Kongdach  
**Commit**: `9292b915`  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +Lines | -Lines | Description |
|------|--------|--------|-------------|
| `firebase.json` | 20 | 20 | Reorder HTTP header rules for both hosting sites |

**Total**: 1 file changed, 20 insertions(+), 20 deletions(-)

---

## Root Cause / Intent

Firebase Hosting applies multiple matching header rules **in declaration order**, and when the same header key appears in more than one matching rule, the **last match wins**.

**Bug in original config**: The `**` (wildcard) rule — which included `Cache-Control: no-cache, no-store, must-revalidate` — was declared **last**. This caused it to silently override the `Cache-Control: public, max-age=2592000, immutable` set by the more-specific `**/*.@(js|css)` and image rules. Net effect: JS/CSS bundles and static assets were served with `no-cache` headers, defeating content-addressable immutable caching entirely.

**Fix**: Move `**` (security headers + default no-cache) to **first** position, then `**/*.@(js|css)` and `**/*.@(svg|...)` override Cache-Control for the specific file types they match. Now JS/CSS gets the correct `immutable` cache header and all responses still get the security headers.

---

## Issues by Severity

### Critical
_None_

### Warning
_None_

### Info
- The fix is applied identically to both Firebase hosting site blocks (`bestchoice-shop` and the second site), which is correct.
- `Cache-Control: no-cache, no-store, must-revalidate` on `**` also covers `index.html` (the SPA entry point), which is intentionally not cached. This is correct behaviour for an SPA.
- `X-XSS-Protection: 1; mode=block` is a legacy header (deprecated in modern browsers) but harmless; it was already present on main.

---

## Recommendation

**✅ APPROVE**

Clean, correct fix. No security regressions. Performance impact is positive — JS/CSS bundles will now be correctly cached immutably in CDN/browser as intended.
