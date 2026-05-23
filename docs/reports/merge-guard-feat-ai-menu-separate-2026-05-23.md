# Merge Guard Report — `feat/ai-menu-separate`

**Date:** 2026-05-23  
**Branch:** `feat/ai-menu-separate`  
**Author:** Akenarin Kongdach  
**Commits:** 4 (incl. 1 merge from main)  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/web/src/components/layout/MainLayout.tsx` | +10 / 0 |
| `apps/web/src/config/menu.ts` | +1 / 0 |
| `apps/web/package.json` | +1 / -1 |

**Total:** 12 insertions, 1 deletion across 3 files.

---

## What This Branch Does

**Problem:** OWNER role was getting a bogus "no permission" toast when navigating to `/` (Dashboard), because the OWNER menu config's `fin` zone listed `Finance Overview` as the first item but omitted `/` from the zone's item list. The `resolveZoneForPath` walk over the config returned `null` for `/`, causing the access-denied path to fire.

**Fix:**
1. `MainLayout.tsx` — Introduces `COMMON_PATHS = new Set<string>(['/'])`. Short-circuits the `resolveZoneForPath` logic for universally-accessible routes before it reaches the `anyRoleHasIt` check. Comment explains the invariant clearly.
2. `menu.ts` — Adds `{ label: 'Dashboard', path: '/', icon: Home }` to the OWNER `fin` zone so the route also appears in the sidebar as expected.

---

## Issues by Severity

### Critical
_None._

### Warning
_None._

### Info

- **`apps/web/src/config/menu.ts` is 1031 lines.** Large config file. No immediate action required — it's a config map, not logic — but worth splitting into per-zone configs in a future refactor.

---

## Notes

- No new controllers, no new DTOs, no financial arithmetic.
- Defense-in-depth: the `COMMON_PATHS` short-circuit is client-side only (toast suppression); actual route protection is handled by `ProtectedRoute` + JWT guard on the API, which are untouched.
- The fix is minimal and surgical. Risk of regression is low.
