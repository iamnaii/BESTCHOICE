# Merge Guard Report — feat/settings-sidebar-driven-nav
**Date**: 2026-06-24  
**Branch**: `feat/settings-sidebar-driven-nav`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits ahead of main**: 5 (stacks on `feat/settings-ia-redesign-p3p4`)  
**Last updated**: 15 hours ago  

---

## File Changes Summary
13 files changed, 339 insertions(+), 167 deletions(−)

| File | Type | Changes |
|------|------|---------|
| `apps/web/src/config/menu.ts` | Frontend | Refactor — registry-driven settings-zone sidebar (8 categories replace flat list) |
| `apps/web/src/config/menu.test.ts` | Test | +144 lines — new assertions for registry-driven sidebar |
| `apps/web/src/pages/settings/SettingsLayout.tsx` | Frontend | −31 lines — removes desktop left sub-nav panel |
| `apps/web/src/pages/settings/CategoryPage.tsx` | Frontend | Composite group key fix (prevents React dup-key warning) |
| `apps/web/src/pages/settings/__tests__/SettingsLayout.test.tsx` | Test | Updated for nav removal |
| `apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx` | Test | Updated |
| 6× migration test files | Test | Updated assertions — no longer assert left nav link existence |
| `docs/superpowers/plans/...` | Docs | Plan document |

All changes are **frontend-only**.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers with missing `@UseGuards` | N/A |
| `Number()` on money fields | N/A — no financial code |
| Hardcoded secrets or API keys | None |
| Raw `fetch()` calls | None |
| Missing `queryClient.invalidateQueries()` | N/A |

---

## Issues Found

### Critical
_None._

### Warning
_None._

### Info

**I1 — Desktop left sub-nav correctly removed**  
`SettingsLayout` dropped the 31-line left `<nav>` that duplicated the sidebar. The sidebar (`buildSettingsZoneSections` in `menu.ts`) now drives category navigation exclusively. Mobile keeps its `<select>` dropdown. Tests verify the left nav links are absent.

**I2 — FM/ACC bottomNav contacts fix**  
Stale reference `/settings#contacts` (hash no longer exists) was fixed to `/settings/company` (the category page). Correct.

**I3 — Composite group key in CategoryPage**  
Groups rendered with `key={gi}` (index) risked React reconciliation issues on non-contiguous same-name groups. Fixed to `key={`${gi}-${g.name ?? 'ungrouped'}`}`. Correct fix.

---

## Recommendation

**APPROVE** — Clean removal of duplicate navigation with full test coverage. No regressions, no security concerns.

**Merge order note**: Must merge AFTER `feat/settings-ia-redesign-p3p4`. Branch `feat/integrations-own-category` stacks on top of this.
