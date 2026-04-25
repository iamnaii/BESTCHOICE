# Merge Guard Report — fix/hosting-header-order

**Date**: 2026-04-25  
**Branch**: `fix/hosting-header-order`  
**Author**: Akenarin Kongdach  
**Commits**:
- `816fdcd5` — fix(hosting): no-cache on SPA HTML so deploys take effect immediately (#682)
- `9292b915` — fix(hosting): reorder header rules so JS/CSS keep immutable cache  
**Base**: `origin/main`  
**Contains**: All changes from `fix/hosting-nocache-spa-html` + the ordering fix

---

## File Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `firebase.json` | +20 / -20 | Reorders HTTP header rules; no content deleted, pure reorder |

---

## Issues Found

### Info — `X-XSS-Protection: 1; mode=block` is deprecated

**File**: `firebase.json`  
The `X-XSS-Protection` header was removed from modern browsers (Chrome 78+, Firefox) and its use with `mode=block` can actually introduce vulnerabilities in legacy IE. The header does no harm on modern browsers but adds noise. Prefer relying on a proper `Content-Security-Policy` header instead. This is a pre-existing concern, not introduced by this branch.

---

## Correctness Verified

The reordering is correct. Firebase Hosting applies ALL matching header rules in document order, with later rules winning on key conflicts. The new order is:

```
Rule 1: **              → Security headers + Cache-Control: no-cache  (first/lowest priority)
Rule 2: **/*.@(js|css)  → Cache-Control: public, max-age=2592000, immutable  (overrides Rule 1 for assets)
Rule 3: **/*.@(svg|...) → Cache-Control: public, max-age=2592000, immutable  (overrides Rule 1 for images)
```

- HTML / root `index.html`: only Rule 1 matches → no-cache ✓ (new deployments take effect immediately)
- `.js` / `.css` bundles: Rule 1 then Rule 2 → immutable ✓
- Images / fonts: Rule 1 then Rule 3 → immutable ✓
- Security headers (`X-Frame-Options`, etc.) apply to all files from Rule 1 ✓

No TypeScript changes. No backend logic. No security model changes.

---

## Recommendation

**APPROVE** — Config-only change, reordering is correct, intent is sound.  
The Info item about `X-XSS-Protection` is pre-existing and can be addressed in a follow-up CSP hardening ticket.
