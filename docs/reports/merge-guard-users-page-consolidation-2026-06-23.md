# Merge Guard Report — feat/users-page-consolidation

**Date**: 2026-06-23  
**Branch**: `feat/users-page-consolidation`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits ahead of main**: 9  
**Note**: Fully contained in `feat/settings-ia-redesign` — see that report.

---

## File Changes Summary

| Category | Files | +Lines | -Lines |
|----------|-------|--------|--------|
| Modified SettingsPage/index.tsx | 1 | +15 | -4 |
| Modified InternalControlTab.tsx | 1 | +22 | 0 |
| Deleted UsersTab.tsx | 1 | — | -48 |
| New InternalControlTab test | 1 | +38 | — |
| Updated SettingsPage test | 1 | +23 | 0 |
| Updated E2E spec | 1 | +3 | -3 |
| Docs | 2 | +554 | — |

**Total**: 10 files, 661 insertions, 66 deletions (net: +595)

---

## What This PR Does

- Removes the redundant "ผู้ใช้งาน" (#users) settings tab
- Merges its 4 control cards (MakerCheckerToggle, ReversePermissionCard, PettyCashCustodianCard, TestModeToggle) into the existing "ระบบควบคุม & สิทธิ์" (#internal-control) tab
- Adds a backward-compat `TAB_ALIASES` map: visiting `/settings#users` silently redirects to `#internal-control`
- Frontend-only change, no backend modifications

---

## Issues Found

### Critical

None.

### Warning

None.

### Info

**I1 — Superseded by `feat/settings-ia-redesign`**
- All 9 commits from this branch are already included in `feat/settings-ia-redesign` (merge base = tip of this branch)
- If `settings-ia-redesign` is merged, do NOT also merge this branch — it would be a no-op but could confuse the history

---

## Recommendation

**APPROVE** — No issues. However, merge via `feat/settings-ia-redesign` instead (that branch is the superset). Merging this branch standalone is only relevant if `settings-ia-redesign` is blocked.
