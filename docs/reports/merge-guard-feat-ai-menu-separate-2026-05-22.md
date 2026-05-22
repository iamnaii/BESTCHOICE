# Merge Guard Report — feat/ai-menu-separate

**Date**: 2026-05-22  
**Branch**: `feat/ai-menu-separate`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`

---

## File Changes Summary

| File | +/- | Type |
|------|-----|------|
| `apps/web/src/components/layout/MainLayout.tsx` | +10 | Frontend layout |
| `apps/web/src/config/menu.ts` | +1 | Menu config |

**Total**: 3 files changed, 12 insertions, 1 deletion

---

## Changes Overview

1. **`MainLayout.tsx`** — Adds a `COMMON_PATHS` set (`{'/'}`) used as a short-circuit guard before the `anyRoleHasIt` check. Prevents a bogus "access-denied" toast when the OWNER navigates to `/` (Dashboard) and the menu config neglects to list it under the active zone.
2. **`menu.ts`** — Adds `{ label: 'Dashboard', path: '/', icon: Home }` to `OWNER_CONFIG`'s fin-zone items so the route is explicitly registered.

---

## Issues

### Critical
_None_

### Warning
_None_

### Info
- The two code comments added in `MainLayout.tsx` are on the verbose side (explaining the same thing twice — once on the constant declaration, once at the call site). They document a non-obvious defense-in-depth pattern though, so they meet the project's "WHY is non-obvious" threshold.

---

## Recommendation

**APPROVE** ✅

Clean, minimal, frontend-only change. No security surface, no money fields, no new queries. Fixes a real UX bug (spurious toast for OWNER on `/`). Ready to merge.
