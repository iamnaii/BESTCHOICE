# Merge Guard Report — fix/liff-skip-root-rewrite

**Date**: 2026-04-24  
**Branch**: `fix/liff-skip-root-rewrite`  
**Open PR**: [#667](https://github.com/iamnaii/BESTCHOICE/pull/667) — fix(liff): skip liff.state rewrite when state is "/"  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Insertions | Deletions |
|------|-----------|-----------|
| `apps/web/src/main.tsx` | +4 | -4 |

**Total**: 1 file, 8 lines changed (comment rewording + 1 logic fix)

---

## Change Description

Fixes a regression introduced in PR #665 where the LIFF `liff.state` rewrite handler would
redirect bare rich-menu URIs (`https://liff.line.me/<id>` without sub-path) down to `/`, causing
ProtectedRoute to show the admin login page instead of the intended LIFF page.

**Core fix** — `apps/web/src/main.tsx` line ~97:
```diff
-if (liffState) {
+if (liffState && liffState !== '/') {
```

When LINE sends `?liff.state=/` (bare rich-menu URI), the handler now skips the rewrite and
leaves the current endpoint pathname intact.

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info
_None_

---

## Analysis

The change is minimal, well-scoped, and directly addresses the documented regression. No new
controllers, DTOs, queries, or financial calculations. No security surface introduced.

The updated code comments accurately describe the new behavior (skip rewrite for empty/bare
`liff.state`).

---

## Recommendation

**✅ APPROVE**

Safe to merge. Single guard condition change with no side effects. PR description documents
the root cause, fix, and manual test plan clearly.
