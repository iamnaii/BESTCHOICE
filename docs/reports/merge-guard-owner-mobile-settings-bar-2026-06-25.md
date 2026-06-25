# Merge Guard Report — chore/owner-mobile-settings-bar

**Date**: 2026-06-25  
**Branch**: `chore/owner-mobile-settings-bar`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commit**: `9b79b49c refactor(menu): dedupe OWNER mobile settings bottom-bar (align with FM/ACC)`

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/config/menu.ts` | -5 / +4 lines in `ZONE_CONFIG['OWNER'].settings` bottom-bar |
| `apps/web/src/config/menu.test.ts` | +10 lines: new test case verifying the dedup |

**Total**: 2 files changed, 14 insertions, 5 deletions — frontend config only.

---

## Issues by Severity

### Critical
_None found._

### Warning
_None found._

### Info
- `UserCog` icon import removed from `menu.ts` — correctly cleaned up since no remaining usage. No dead import left behind.

---

## Analysis

**Before**: OWNER's mobile settings bottom-bar had 4 shortcuts (`/users`, `/settings/company/entities`, `/branches`, `/settings`) that all duplicated destinations already reachable via the settings submenu drawer ("เพิ่มเติม").

**After**: Aligned with FM/ACC pattern — two items only:
- `/contacts` (รายชื่อผู้ติดต่อ) — quick-access shortcut to the standalone contacts page
- `#more` drawer (เพิ่มเติม) — full settings nav via sidebar

**Test coverage**: A new test asserts the removed paths are absent and `/contacts` is present. The test is specific and will catch regression if any of those paths re-appear.

No backend, auth, or data-fetching code changed. Pure UI navigation config.

---

## Recommendation: ✅ APPROVE

Safe to merge. Good deduplication with test coverage. Reduces mobile nav clutter for OWNER role without losing any access path (all removed shortcuts are still reachable via the drawer).
