# Merge Guard Report — feat/settings-sidebar-driven-nav

**Date:** 2026-06-27
**Branch:** `feat/settings-sidebar-driven-nav`
**Author:** iamnaii <akenarin.ak@gmail.com>
**Commits:** 5

## File Changes Summary

13 files changed, 339 insertions(+), 167 deletions(-)

| File | Change |
|------|--------|
| `apps/web/src/config/menu.ts` | Remove 5 static `zone:'settings'` sections; add `buildSettingsZoneSections()` helper; update `getSidebarForRole` + `resolveZoneForPath` |
| `apps/web/src/config/menu.test.ts` | Rewrite 60+ test cases to assert registry-driven sidebar (8 categories), remove old static-key assertions |
| `apps/web/src/pages/settings/SettingsLayout.tsx` | Remove desktop left `<nav>` sub-nav (w-60 sidebar); drop unused `Link`, `visibleItems` imports |
| `apps/web/src/pages/settings/CategoryPage.tsx` | Add category `<h2>` heading; fix duplicate React key (`{g.name ?? gi}` → `${g.name ?? ''}-${gi}`) |
| `apps/web/src/pages/settings/__tests__/*.test.tsx` | Tests updated for 3 migration test files |
| `docs/superpowers/plans/2026-06-24-settings-sidebar-driven-nav.md` | New plan doc (166 lines) |

## Issues

### Critical
_None_

### Warning
_None_

### Info

**[INFO-1] Desktop left sub-nav removed from SettingsLayout**
`apps/web/src/pages/settings/SettingsLayout.tsx`

The `w-60` desktop navigation sidebar inside the settings panel has been removed. Users navigating settings on desktop now select categories via the gear-zone sidebar (left app nav), not via an in-panel sub-nav. This is a UX architecture change (accepted trade-off documented in the plan doc and confirmed by user on 2026-06-24).

Implication: users reaching `/settings` without a specific `:categoryId` will see the index route (redirect to first visible category). No content is lost — categories are accessible via the sidebar. Acceptable.

**[INFO-2] `resolveZoneForPath` early-return for `/settings/*`**
`apps/web/src/config/menu.ts:960`

An early-return was added to resolve any `/settings/*` path to the `'settings'` zone without scanning `MenuSection` items. This is correct and more reliable than the previous scan-based approach (which could miss paths not listed in static sections). No regression risk.

**[INFO-3] Composite section group key**
`apps/web/src/pages/settings/CategoryPage.tsx`

Fixed: `key={g.name ?? gi}` → `key={\`${g.name ?? ''}-${gi}\`}`. This prevents duplicate-key React warnings when two groups share the same non-contiguous name. Correct fix.

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

Clean, well-tested refactor. All 60+ test updates correctly reflect the new registry-driven model. The removed desktop sub-nav is intentional (documented + user-confirmed). No security, money precision, or data integrity concerns.
