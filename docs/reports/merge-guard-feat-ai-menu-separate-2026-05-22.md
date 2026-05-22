# Merge Guard Report — feat/ai-menu-separate (PR #1070)

**Date:** 2026-05-22  
**Branch:** `feat/ai-menu-separate`  
**PR:** [#1070](https://github.com/iamnaii/BESTCHOICE/pull/1070)  
**Author:** iamnaii  
**Recommendation:** ✅ **APPROVE**

---

## Summary

Small, focused fix (3 files, 12 lines added) that resolves a bogus access-denied toast shown to OWNER when landing on `/`.

## File Changes

| File | Change |
|------|--------|
| `apps/web/src/components/layout/MainLayout.tsx` | +10 lines — adds `COMMON_PATHS` whitelist + guard short-circuit |
| `apps/web/src/config/menu.ts` | +1 line — adds `{ Dashboard, '/' }` to `owner-overview` items |
| `apps/web/package.json` | Version bump 26.5.14 → 26.5.16 |

## Issues

### Critical
_None._

### Warning
_None._

### Info
_None._

## Analysis

**Root cause fix:** `owner-overview` section omitted `/` from its items list, causing the auto-zone resolver in `MainLayout` to classify `/` as "in another role's sidebar but not in OWNER's" → bogus access-denied toast + no-op redirect.

**Two-layer fix is correct:**
1. **menu.ts** — adds `{ label: 'Dashboard', path: '/', icon: Home }` to OWNER's overview items (proper fix at source)
2. **COMMON_PATHS** in `MainLayout.tsx` — adds defense-in-depth for any future recurrence of this pattern (universally accessible paths bypass the access-denied branch regardless of menu config). Uses a `Set<string>` for O(1) lookups. Comment explains the "why" clearly.

No guards, API calls, or data fetching involved — pure client-side routing logic.

TypeScript check: PR description confirms `./tools/check-types.sh web` → 0 errors and `menu.test.ts` 24/24 passing.
