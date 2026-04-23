# Merge Guard Report — fix/liff-skip-root-rewrite

**Date**: 2026-04-23
**Branch**: `fix/liff-skip-root-rewrite`
**Author**: Akenarin Kongdach
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/web/src/main.tsx` | +4 / -4 (condition refinement only) |

**1 file changed, 4 insertions(+), 4 deletions(-)**

---

## Change Description

Adds `&& liffState !== '/'` guard to the LIFF `liff.state` rewrite block that runs before React renders.

**Before:**
```ts
if (liffState) {
  window.history.replaceState(null, '', liffState + window.location.search);
}
```

**After:**
```ts
// Skip rewrite when liff.state is empty or "/" (bare rich-menu URI) —
// otherwise we'd rewrite a valid LIFF endpoint pathname down to "/" and hit ProtectedRoute.
if (liffState && liffState !== '/') {
  window.history.replaceState(null, '', liffState + window.location.search);
}
```

**Root cause fixed**: When LINE's rich-menu URI has no sub-path (`liff.state=/`), the old code would rewrite `window.location` to `/` — effectively destroying any valid LIFF pathname already in the URL and causing a `ProtectedRoute` redirect.

---

## Issues by Severity

### Critical
_None_

### Warning
_None_

### Info
_None_

---

## Recommendation: ✅ APPROVE

This is a minimal, well-targeted frontend fix. No new controllers, DTOs, money fields, database queries, or fetch() calls. The comment accurately explains the invariant being protected. Safe to merge.
