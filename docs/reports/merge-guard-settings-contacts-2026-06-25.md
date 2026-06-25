# Merge Guard Report — `feat/settings-contacts-standalone`

**Date**: 2026-06-25  
**Branch**: `feat/settings-contacts-standalone`  
**Author**: iamnaii  
**Commits ahead of main merge-base**: 4  
**Commits behind main (current)**: 125

---

## File Changes Summary

| File | Insertions | Deletions |
|------|-----------|----------|
| `apps/web/src/App.tsx` | 2 | 2 |
| `apps/web/src/components/CommandPalette.test.tsx` | 14 | 0 |
| `apps/web/src/components/CommandPalette.tsx` | 2 | 0 |
| `apps/web/src/config/__tests__/settings-access.test.ts` | 7 | 6 |
| `apps/web/src/config/__tests__/settings-registry.test.ts` | 6 | 0 |
| `apps/web/src/config/menu.test.ts` | 70 | 38 |
| `apps/web/src/config/menu.ts` | 18 | 10 |
| `apps/web/src/config/settings-registry.tsx` | 0 | 2 |
| `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` | 3 | 3 |
| `apps/web/src/pages/settings/__tests__/SettingsIndexRedirect.test.tsx` | 3 | 2 |
| **Total** | **+263** | **-62** |

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

**W1: Branch is 125 commits behind main; content already incorporated**

The key changes from this branch (adding `ProtectedRoute` to `/contacts` + `/contacts/:id`, extracting contacts from the settings registry `company` category, adding contacts to `CommandPalette`) are already present in `origin/main`. Main has continued 125 commits beyond this branch's merge-base. The branch content was cherry-picked / re-implemented as part of the P6 settings redesign that landed in main.

Attempting to merge this branch would create conflicts and duplicate partially-overlapping changes.

### Info — 1 item

**I1: Security improvement — `/contacts` routes now have proper ProtectedRoute wrappers**

The branch correctly adds `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` to both `/contacts` and `/contacts/:id`, which previously had no role guard on the frontend route. This security fix is already in main.

**I2: All tests updated**

The 4 commits in this branch consistently update all affected test files (`menu.test.ts`, `settings-access.test.ts`, `settings-registry.test.ts`, `CommandPalette.test.tsx`) to reflect the new routing structure.

---

## Recommendation: CLOSE (STALE)

**Do not merge.** The branch content has already been incorporated into `main` via the P6 settings redesign. The branch is 125 commits behind main and would produce significant merge conflicts. The branch should be deleted as part of branch hygiene.

No blocking quality issues found in the code itself.
