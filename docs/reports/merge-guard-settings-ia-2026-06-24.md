# Merge Guard Report — Settings IA Redesign (P3–P6)
**Date**: 2026-06-24  
**Reviewed by**: Pre-Merge Guard (automated)  
**Author**: akenarin.ak@gmail.com  
**Branches reviewed** (sequential — must merge in this order):

| Order | Branch | Phase | Commits |
|-------|--------|-------|---------|
| 1 | `feat/settings-ia-redesign-p3p4` | P3+P4 | 5 |
| 2 | `feat/settings-sidebar-driven-nav` | P5 | 5 |
| 3 | `feat/settings-contacts-standalone` | P6 | 4 |

> **Important**: These branches build on each other. They cannot be merged out of order. No open GitHub PRs were found — all branches exist only on remote.

---

## Branch 1: `feat/settings-ia-redesign-p3p4`

### Summary
Settings IA redesign (P3 sidebar collapse + P4 dead-code removal):
- Collapses OWNER settings sidebar — removes deep-link shortcuts (`/settings/ai/admin`, `/settings/finance/gfin`, etc.) and the `owner-ai` section; keeps only panel entry + operational links
- Integrates `settingsRegistry` into `CommandPalette` (role-filtered, deduped by path)
- Fixes React hooks-order violation in `CategoryPage` — moves `useEffect` above early return
- Deletes dead `SystemSettings.tsx` (192 lines, CardReaderSetup + ExternalLinks components with no remaining callers)
- Removes duplicate `/settings/document-config` route stub
- Updates ~6 stale path references (`/settings#peak-mapping` → `/settings/accounting#peak-mapping`, etc.)

### File Changes (16 files, +492 / −251)
- `App.tsx` — removes dead `/settings/document-config` route; updates `PeriodsRedirect` target
- `CommandPalette.tsx` / `CommandPalette.test.tsx` — registry integration (+174 test lines)
- `menu.ts` — removes `owner-ai` section, collapses `owner-settings` items list
- `SystemSettings.tsx` — **DELETED** (confirmed 0 remaining callers)
- `CategoryPage.tsx` — hooks-order fix + `useEffect` for hash scroll
- Stale comment/JSDoc updates in 4 pages

### Critical Issues
_None._

### Warnings
_None._

### Info
- `CategoryPage.tsx` hooks-order fix is correct per React rules. The `useEffect` body guards on `!hash` and missing `element`, so it's safely a no-op when the category doesn't exist.
- `SystemSettings.tsx` deletion verified: `grep -r "SystemSettings" apps/web/src` returns 0 results in the working tree.
- CommandPalette dedup logic (`.filter(e => !pages.some(p => p.path === e.path))`) correctly prevents `/branches` and `/users` from appearing twice.
- 174 new test lines provide solid coverage for role-filtering and dedup behavior.

### Recommendation: ✅ APPROVE

---

## Branch 2: `feat/settings-sidebar-driven-nav`

### Summary
P5 refactor — settings zone sidebar becomes fully registry-driven:
- Replaces static per-role sections (`owner-settings`, `owner-settings-extra`, `owner-fin-master`, `fm-fin-master`, `acc-fin-master`) with a single `buildSettingsZoneSections(role)` function that calls `visibleCategories()` from the registry
- `SettingsLayout.tsx` drops the desktop left sub-nav panel (categories are now driven by the main sidebar, not an inline sub-nav)
- Adds `resolveZoneForPath` guard for `/settings/*` paths
- Fixes FM/ACC bottomNav stale hash: `/settings#contacts` → `/settings/company`
- Fixes duplicate React key warning in `CategoryPage` (composite key `${name}-${index}`)
- Adds category `h2` heading to `CategoryPage` for orientation

### File Changes (13 files, +339 / −167)
- `menu.ts` — removes ~45 lines of static section objects; adds `buildSettingsZoneSections()` + `resolveZoneForPath` guard
- `SettingsLayout.tsx` — removes desktop left sub-nav (~31 lines); removes unused `Link` import
- `CategoryPage.tsx` — composite key fix, category heading
- 7 migration test files updated for new path expectations

### Critical Issues
_None._

### Warnings
- **UX removal**: The desktop left category sub-nav inside the settings panel is removed. Navigation relies entirely on the main sidebar gear-zone. This is an intentional design decision (P5 spec: "sidebar is the primary nav"), not a bug — but it should be smoke-tested visually before shipping to ensure the main sidebar correctly highlights the active category.

### Info
- `SettingsLayout.tsx` removes unused `Link` and `visibleItems` imports — clean.
- The FM/ACC bottomNav stale-hash fix here (`/settings#contacts` → `/settings/company`) is superseded by P6 which changes it to `/contacts`. These two fixes need to land together (P5 then P6).
- New `CategoryPage` key: `${g.name ?? ''}-${gi}` — safe against non-contiguous groups with the same `name`.

### Recommendation: ✅ APPROVE (merge after P3P4)

---

## Branch 3: `feat/settings-contacts-standalone`

### Summary
P6 — "สมุดผู้ติดต่อ" promoted from settings registry item to standalone page:
- `/contacts` and `/contacts/:id` routes wrapped in `ProtectedRoute` with roles `['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']` **(security improvement — was previously unguarded at routing layer)**
- Removes `contacts` item from `settingsRegistry.company.items`
- Adds `master-data` section group in `buildSettingsZoneSections()` before the registry categories
- Updates FM/ACC bottomNav: `/settings/company` → `/contacts`
- `SettingsIndexRedirect`: `#contacts` hash now redirects to `/contacts` directly (not via `HASH_TO_CATEGORY`)
- Removes `ContactsTab` import from settings-registry
- CommandPalette: adds `สมุดผู้ติดต่อ` entry with role filtering

### File Changes (11 files, +263 / −62)
- `App.tsx` — wraps `/contacts` + `/contacts/:id` in `ProtectedRoute`
- `menu.ts` — adds `master-data` section; updates FM/ACC bottomNav
- `settings-registry.tsx` — removes contacts item + `ContactsTab` import
- `SettingsIndexRedirect.tsx` — `#contacts` → dedicated redirect to `/contacts`
- `CommandPalette.tsx` — adds `BookUser` icon + contacts entry with roles

### Critical Issues
_None._

### Warnings
_None._

### Info
- **Security improvement**: `/contacts` previously relied only on API-level guards; routing layer now also enforces `['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']` via `ProtectedRoute`.
- `HASH_TO_CATEGORY['contacts']` correctly removed; the new `hash === 'contacts'` early-return in `SettingsIndexRedirect` handles the redirect cleanly.
- `firstVisibleCategoryId('FINANCE_MANAGER')` now returns `'accounting'` (not `'company'`) since `company` category has only OWNER-visible items after contacts removal — test updated accordingly.
- The `master-data` sidebar group always shows `/contacts` for all roles that `showSettingsGear` — this matches the intent (OWNER/FM/ACC all get it).

### Recommendation: ✅ APPROVE (merge after P5)

---

## Merge Order & Risk Summary

```
P3P4 (settings-ia-redesign-p3p4)   ← merge first
  ↓
P5  (settings-sidebar-driven-nav)   ← merge second
  ↓
P6  (settings-contacts-standalone)  ← merge third
```

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| P3P4 | 0 | 0 | 4 | ✅ APPROVE |
| P5 | 0 | 1 | 3 | ✅ APPROVE |
| P6 | 0 | 0 | 4 | ✅ APPROVE |

**Overall risk**: LOW. All changes are frontend-only (no API/DB changes, no new controllers, no money calculations). Main risk is the desktop settings UX shift (P5 removes sub-nav) — recommend a quick visual smoke test before shipping P5+P6 together.

**No backend security issues found.** No new API controllers introduced. No `Number()` on money fields. No missing guards.
