# Merge Guard Report — feat/integrations-own-category

**Date:** 2026-06-27
**Branch:** `feat/integrations-own-category`
**Author:** iamnaii <akenarin.ak@gmail.com>
**Commits:** 1

## File Changes Summary

9 files changed, 59 insertions(+), 30 deletions(-)

| File | Change |
|------|--------|
| `apps/web/src/config/settings-registry.tsx` | Extract `integrations` + `mdm` items from `system` into a new `integrations` category; `system` roles narrowed from `['OWNER','ACCOUNTANT']` → `['OWNER']` |
| `apps/web/src/config/menu.ts` | Update OWNER fin-zone quick-link path: `/settings/system/integrations` → `/settings/integrations/hub` |
| `apps/web/src/App.tsx` | Replace old redirect `(/settings/integrations → /settings/system/integrations)` with new redirects: `/settings/system/integrations` → `/settings/integrations/hub`; `/settings/system/mdm` → `/settings/integrations/mdm` |
| `apps/web/src/config/__tests__/settings-registry.test.ts` | 8 categories → 9 |
| `apps/web/src/config/__tests__/settings-access.test.ts` | Add assertions: ACCOUNTANT sees `integrations` but not `system`; FM does not see `integrations` |
| `apps/web/src/config/menu.test.ts` | Update settings-zone path list to include `/settings/integrations` |
| `apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx` | Update test description for system category (groups now contiguous) |
| `apps/web/src/pages/settings/__tests__/company-access-system-migration.test.tsx` | Rewrite redirect chain tests for new URLs |

## Issues

### Critical
_None_

### Warning
_None_

### Info

**[INFO-1] ACCOUNTANT role change for `system` category**
`apps/web/src/config/settings-registry.tsx`

The `system` category roles changed from `['OWNER', 'ACCOUNTANT']` → `['OWNER']`. This means ACCOUNTANTs no longer see the "ระบบ & ความปลอดภัย" category in the panel. Instead, they still see `integrations` (hub item has `['OWNER','ACCOUNTANT']` roles). This is an intentional tightening — the remaining `system` items (test-mode, pdpa, backup, audit-log, system-status) are all OWNER-only anyway, so the category label was unreachable for ACCOUNTANTs before this change. No functional loss.

**[INFO-2] Old `/settings/integrations` path behaviour change**
`apps/web/src/App.tsx`

Previously: `/settings/integrations` redirected to `/settings/system/integrations`.
Now: `/settings/integrations` matches the dynamic `:categoryId` route and renders CategoryPage(`integrations`), showing a list of items in the new "เชื่อมต่อ" category. The old redirect is removed; the path now works as a category landing page. Users with old bookmarks to `/settings/integrations` will land correctly on the integrations category.

**[INFO-3] Redirect chain: `/settings/system/integrations` → `/settings/integrations/hub`**
`apps/web/src/App.tsx`

Old URL (`/settings/system/integrations`) now redirects to the canonical new path. Correct backward-compatibility. Similarly for `/settings/system/mdm` → `/settings/integrations/mdm`.

## Security Check

| Check | Result |
|-------|--------|
| Missing `@UseGuards` on new controllers | N/A — frontend only |
| `Number()` on money fields | None found |
| Missing `deletedAt: null` in queries | N/A — no DB queries |
| Hardcoded secrets | None |
| Missing `@Roles()` | N/A — frontend only |
| Raw `fetch()` instead of `api.*` | None found |
| Missing `queryClient.invalidateQueries()` | N/A — no mutations |
| TypeScript `any` | None found |

## Recommendation

**APPROVE**

Clean settings-registry refactor. Adds a new category (9 total), tightens ACCOUNTANT access to `system` (items were already OWNER-only), and properly chains backward-compat redirects. Tests updated for all changed paths. No security, money precision, or data integrity concerns.
