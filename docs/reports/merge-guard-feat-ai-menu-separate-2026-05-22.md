# Pre-Merge Guard Report

**Branch**: `feat/ai-menu-separate`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Date**: 2026-05-22
**Recommendation**: ✅ **APPROVE**

---

## File Changes Summary

3 files changed, 12 insertions(+), 1 deletion(-)

- `apps/web/src/components/layout/MainLayout.tsx` — 10 lines added
- `apps/web/src/config/menu.ts` — 1 line added
- `apps/web/package.json` — 1 line changed (dependency update)

---

## Issues by Severity

### 🔴 Critical
None found.

### 🟡 Warning
None found.

### 🔵 Info

#### I1 — `COMMON_PATHS` set introduced for future extensibility

The fix introduces a `Set<string>(['/''])` constant. If more universal paths are needed (e.g. `/profile`, `/notifications`) they can be added there. This is a clean extension point.

---

## What the Change Does

**Bug fixed**: OWNER role was missing `/` (Dashboard) from their `fin` zone menu config, causing `MainLayout.tsx`'s zone resolver to fire a bogus "access-denied" toast when navigating to `/`.

**Fix approach**:
1. Adds `{ label: 'Dashboard', path: '/', icon: Home }` to `OWNER_CONFIG`'s fin zone (root cause fix)
2. Adds `COMMON_PATHS` short-circuit guard in `MainContent` so universally-accessible routes are never treated as access-denied even if a role's menu config omits them (defense in depth)

**Analysis**: Both fixes are correct and complementary. The root cause fix ensures the menu renders the Dashboard link; the `COMMON_PATHS` guard prevents regression if any future role config accidentally omits `/` again.

No security, money/Decimal, or data access concerns in this change.
