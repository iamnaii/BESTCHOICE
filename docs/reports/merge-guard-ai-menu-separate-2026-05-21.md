# Merge Guard Report — feat/ai-menu-separate

**Date**: 2026-05-21  
**Branch**: `feat/ai-menu-separate`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: 9100b931 (2026-05-20 11:45 BKK)  
**Recommendation**: ✅ APPROVE

---

## Summary

Minimal frontend-only change. Splits the AI menu group out of the "ตั้งค่า" section into its own top-level group in the Gear (`settings`) zone of `OWNER_CONFIG`. No backend changes.

## Files Changed

| File | Change |
|------|--------|
| `apps/web/src/config/menu.ts` | Move AI submenu from nested child of "ตั้งค่า" → standalone section `key: 'owner-ai'` |
| `apps/web/package.json` | Minor dependency bump (unrelated to logic change) |

**2 files changed, 17 insertions(+), 13 deletions(-)**

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info
_None_ — Change is a clean structural refactor of the menu config. The new `owner-ai` section correctly sets `zone: 'settings'` and retains all 5 AI menu items (Admin, Persona, Assistant, Training, Performance) with their original paths and icons.

---

## Verification Points

- [x] No new controllers or API endpoints
- [x] No Prisma/DB changes
- [x] No raw `fetch()` calls
- [x] No hardcoded colors or design token violations
- [x] `ProtectedRoute` roles unchanged (route definitions not modified)
- [x] Menu config correctly uses `zone: 'settings'` on the new group

---

## Recommendation: ✅ APPROVE

Safe to merge. Pure UI reorganization, zero risk.
