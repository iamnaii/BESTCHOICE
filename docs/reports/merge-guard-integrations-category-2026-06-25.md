# Merge Guard Report — `feat/integrations-own-category`

**Date**: 2026-06-25  
**Branch**: `feat/integrations-own-category`  
**Author**: iamnaii  
**Commits ahead of main merge-base**: 1  
**Commits behind main (current)**: 122

---

## File Changes Summary

| File | Insertions | Deletions |
|------|-----------|----------|
| `apps/web/src/App.tsx` | 5 | 4 |
| `apps/web/src/config/__tests__/settings-access.test.ts` | 8 | 3 |
| `apps/web/src/config/__tests__/settings-registry.test.ts` | 4 | 4 |
| `apps/web/src/config/menu.test.ts` | 3 | 2 |
| `apps/web/src/config/menu.ts` | 1 | 1 |
| `apps/web/src/config/settings-registry.tsx` | 8 | 5 |
| `apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx` | 1 | 1 |
| `apps/web/src/pages/settings/__tests__/company-access-system-migration.test.tsx` | 20 | 15 |
| **Total** | **+59** | **-30** |

**Backend changes**: None — frontend-only

---

## Issues by Severity

### Critical — NONE

No issues found:
- No new controllers without `@UseGuards`
- No `Number()` on financial fields
- No missing `deletedAt: null` in queries
- No hardcoded secrets or API keys
- No SQL injection risk

### Warning — 1 item

**W1: Branch is 122 commits behind main; content already incorporated**

This branch splits the `integrations` items (hub + MDM) out of the `system` settings category into their own `เชื่อมต่อ` category in `settings-registry.tsx`. It also:
- Narrows the `system` category to OWNER-only (was `['OWNER', 'ACCOUNTANT']`)
- Updates redirect chains: `settings/system/integrations` → `settings/integrations/hub`, `settings/system/mdm` → `settings/integrations/mdm`

All of these changes are already present in `origin/main`:
- `settingsRegistry` in main already has 9 categories including the `integrations` category
- The `system` category in main is already OWNER-only
- The redirect routes in `App.tsx` are already updated

### Info — 1 item

**I1: Redirect chain correctness**

The branch correctly handles the 2-hop redirect case: `/settings/integrations` (old) is NOT explicitly redirected, but instead falls through to the dynamic `:categoryId` route → `CategoryPage('integrations')`. This is valid and tested in `company-access-system-migration.test.tsx`. No dead-end redirects found.

**I2: ACCOUNTANT access to integrations preserved**

The new `integrations` category correctly gives ACCOUNTANT role access to the `hub` item (matching the existing pattern where ACCOUNTANT can view integration settings). The `mdm` item correctly stays OWNER-only. Role matrix is consistent.

---

## Recommendation: CLOSE (STALE)

**Do not merge.** Content is already in main. The branch is 122 commits behind and would conflict. Delete as part of branch hygiene.

No blocking quality issues found in the code itself.

---

## Summary Note — Branch Hygiene

All 3 reviewed branches (`feat/settings-contacts-standalone`, `feat/contacts-into-settings-submenu`, `feat/integrations-own-category`) are sequential development steps for the P6 settings IA redesign. Their changes were incorporated into `main` through the P5/P6 settings consolidation work. These branches were never formally merged (no merge commit), but their content was re-implemented or cherry-picked into main.

**Recommended action**: Close/delete all 3 branches. With 205+ feat branches total in this repo, periodic cleanup of stale merged-content branches would improve developer ergonomics.
