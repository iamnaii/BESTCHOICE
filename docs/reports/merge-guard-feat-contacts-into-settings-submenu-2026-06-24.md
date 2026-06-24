# Merge Guard Report — feat/contacts-into-settings-submenu

**Date**: 2026-06-24  
**Branch**: `feat/contacts-into-settings-submenu`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 1  
**Committed**: ~15 hours ago  
**Scope**: Frontend-only (0 API files changed)

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/web/src/components/CommandPalette.test.tsx` | +6/-6 | Tests: label rename |
| `apps/web/src/components/CommandPalette.tsx` | +1/-1 | Rename label + add keyword |
| `apps/web/src/components/contacts/ContactCombobox.tsx` | +1/-1 | Rename group heading |
| `apps/web/src/components/trade-in/QuickBuyModal.tsx` | +1/-1 | Rename toast error message |
| `apps/web/src/config/menu.test.ts` | +26/-28 | Tests: single-section sidebar structure |
| `apps/web/src/config/menu.ts` | *(implied)* | `/contacts` moved inside settings submenu |

**Total**: ~6 files

---

## What the Branch Does

Two changes bundled in one commit:

1. **Label rename**: "สมุดผู้ติดต่อ" → "รายชื่อผู้ติดต่อ" across CommandPalette, ContactCombobox group heading, and QuickBuyModal toast. Old keyword "สมุดผู้ติดต่อ" preserved in CommandPalette keywords array for backward search compat.

2. **Navigation restructure**: The `/contacts` link moves from a standalone `master-data` sidebar section into the settings-zone `ตั้งค่าระบบ` submenu as the first item. Result: OWNER/FM/ACC settings zone is now a single section (`key: 'settings'`) instead of `['master-data', 'settings']`. `/contacts` remains accessible — just surfaced via the settings gear, not as a separate top-level nav group.

---

## Security Checks

| Check | Result |
|-------|--------|
| JwtAuthGuard on new controllers | N/A — frontend only |
| Number() on money fields | None found |
| deletedAt: null in queries | N/A — frontend only |
| Hardcoded secrets/API keys | None found |
| Raw `fetch()` instead of `api.*()` | None found |
| Hardcoded hex colors | None found |
| `bg-gray-*` / `text-gray-*` forbidden classes | None found |
| `leading-none` on Thai text | None found |
| Explicit `any` types | None found |
| Missing `queryClient.invalidateQueries()` | N/A — no mutations added |

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**I-1**: FM/ACC can still reach `/contacts` via the settings submenu — `visibleCategories('FINANCE_MANAGER')` still returns sections containing `/contacts`. The test confirms `fmPaths` includes `/contacts` but not `/settings/company`. This is intentional (contacts is all-roles-accessible, company is OWNER-only per registry).

**I-2**: Users who bookmarked `/contacts` directly are unaffected — the route itself does not change, only how it appears in the sidebar nav. No redirect needed.

---

## Recommendation

**APPROVE**

Straightforward label rename + sidebar restructuring. No backend, no security, no logic changes. Tests updated to match new structure. All security checks pass.
