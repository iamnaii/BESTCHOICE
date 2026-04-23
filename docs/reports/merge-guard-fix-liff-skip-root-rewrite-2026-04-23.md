# Merge Guard Report: fix/liff-skip-root-rewrite

**Date**: 2026-04-23  
**Branch**: `fix/liff-skip-root-rewrite`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last Commit**: 2026-04-23 01:03:40 +0700  
**Reviewed By**: Pre-Merge Guard Agent  

---

## File Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `apps/web/src/main.tsx` | +4 / -4 | LIFF consent redirect guard condition |

**Total**: 1 file changed, 4 insertions, 4 deletions

---

## Change Description

Modifies the LIFF consent redirect handler in `main.tsx` to skip the URL rewrite when `liff.state === '/'`.

**Before:**
```ts
if (liffState) {
  window.history.replaceState(null, '', liffState + window.location.search);
}
```

**After:**
```ts
if (liffState && liffState !== '/') {
  window.history.replaceState(null, '', liffState + window.location.search);
}
```

**Reason**: A bare rich-menu URI (e.g. `https://liff.line.me/<id>`) sets `liff.state=/`. The old code would rewrite the current valid LIFF pathname down to `/`, causing the user to hit `ProtectedRoute` instead of the intended LIFF page.

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info
_None_

---

## Assessment

This is a minimal, targeted bug fix with no security, data, or guard concerns. The change is logically correct — `liff.state=/` means "no sub-path override", so skipping the rewrite is the right behavior.

---

## Recommendation: ✅ APPROVE

Safe to merge. No blocking issues.
