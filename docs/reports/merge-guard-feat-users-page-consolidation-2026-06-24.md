# Merge Guard Report — feat/users-page-consolidation

**Date**: 2026-06-24  
**Branch**: `feat/users-page-consolidation`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 9 (oldest ~2 days ago)  
**Scope**: Frontend-only (0 API files changed)

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `.claude/rules/accounting.md` | +1/-1 | Doc: update tab reference |
| `apps/web/e2e/settings-tabs.spec.ts` | +4/-4 | E2E: update TAB_IDS + describe text |
| `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx` | +22/0 | Tests: alias + tab removal |
| `apps/web/src/pages/SettingsPage/components/PettyCashCustodianCard.tsx` | +1/-1 | Doc comment update |
| `apps/web/src/pages/SettingsPage/index.tsx` | +11/-3 | Alias `#users → #internal-control`, merge tabs |
| `apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx` | +24/-2 | Absorb 4 cards from UsersTab |
| `apps/web/src/pages/SettingsPage/tabs/UsersTab.tsx` | 0/-48 | File deleted |
| `apps/web/src/pages/SettingsPage/tabs/__tests__/InternalControlTab.test.tsx` | +38/0 | New unit test |
| `docs/...` | +554/0 | Design specs + implementation docs |

**Total**: ~10 code files, +661/-66 lines (majority is docs)

---

## What the Branch Does

Consolidates the redundant `ผู้ใช้งาน` (#users) settings tab into the `ระบบควบคุม & สิทธิ์` (#internal-control) tab (Direction B of the design spec). The 4 control cards previously in UsersTab (MakerCheckerToggle, TestModeToggle, ReversePermissionCard, PettyCashCustodianCard) are moved to InternalControlTab, grouped under 3 labelled sections: "การอนุมัติ & สิทธิ์", "เงินสด", "ความปลอดภัย".

The `/users` page itself is NOT affected — it remains a standalone user management page. Only the settings tab is removed.

Backward compat: a `TAB_ALIASES` map (`users → internal-control`) in `SettingsPage/index.tsx` ensures old bookmarks/links with `#users` resolve to the internal-control tab.

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

**I-1**: `InternalControlTab` now renders `TestModeToggle` under a section labelled `text-destructive` (red heading "ความปลอดภัย"). This is a deliberate visual hierarchy choice to distinguish the high-risk toggle. No logic change — the toggle is OWNER-only, and the whole settings route is guarded at the page level.

**I-2**: The `hashchange` handler in `SettingsPage/index.tsx` now calls `resolveHash()` (which applies `TAB_ALIASES`) but the resolved alias (`internal-control`) must be in `visibleIds` to activate; otherwise falls back to `visibleIds[0]`. For OWNER, `internal-control` is visible — alias works. For FM/ACC, `internal-control` is OWNER-only, so `#users` alias falls back to the first visible tab (correct behavior per the test).

---

## Recommendation

**APPROVE**

Clean UX consolidation. No backend changes. Backward-compat alias is correctly implemented and tested. 5 new unit tests + E2E update cover the key scenarios. All security checks pass.
