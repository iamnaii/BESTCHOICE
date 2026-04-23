# Merge Guard Report — fix/liff-skip-root-rewrite

**Date**: 2026-04-23  
**Branch**: `fix/liff-skip-root-rewrite`  
**Author**: Akenarin Kongdach  
**Commit**: `0ab6151d`  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/web/src/main.tsx` | +4 / -4 (1 file) |

**Total**: 1 file, 4 insertions, 4 deletions

---

## What Changed

Guards the pre-React LIFF-state URL rewrite against the case where `liff.state` is `"/"` (a bare rich-menu URI with no sub-path). Previously `if (liffState)` fired even when the value was `"/"`, which rewrote the page's pathname to `"/"` and caused `ProtectedRoute` to block the LIFF page from loading. The fix adds `&& liffState !== '/'` to skip the rewrite in this case.

---

## Issues Found

### Critical
_None._

### Warning
_None._

### Info
_None._

---

## Notes

- Pure frontend change, no backend, no schema.
- No financial fields, no guards, no DTOs involved.
- Change is minimal and targeted — exactly one added condition on an existing guard clause.
- Comment update in the same diff correctly documents the new behaviour.
