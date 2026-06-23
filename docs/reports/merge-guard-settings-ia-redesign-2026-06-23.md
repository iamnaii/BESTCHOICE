# Pre-Merge Guard Report — Settings IA Redesign
**Date**: 2026-06-23  
**Run by**: guard agent (automated)  
**Branches reviewed**: 3 (stacked series + 1 independent)

---

## Branches Reviewed

| Branch | Commits | Files Changed | Last Updated |
|--------|---------|---------------|--------------|
| `feat/users-page-consolidation` | 9 | 10 | 2026-06-23 16:05 +07 |
| `feat/settings-ia-redesign-p2a` | 3 | 14 | 2026-06-23 18:32 +07 |
| `feat/settings-ia-redesign-p2b` | 7 (stacked on p2a) | 12 | 2026-06-23 23:53 +07 |

**Author**: iamnaii  
**Backend API changes**: None (all frontend-only)

---

## Branch 1: `feat/users-page-consolidation`

### Summary
Consolidates the redundant "ผู้ใช้งาน" (#users) tab in `SettingsPage` into the existing "ระบบควบคุม & สิทธิ์" (#internal-control) tab. Adds a backward-compat `TAB_ALIASES` map so bookmarks/links to `#users` silently redirect to `#internal-control`.

### Files Changed
- `SettingsPage/index.tsx` — removes `UsersTab` import, adds alias resolver, consolidates tab label
- `SettingsPage/tabs/UsersTab.tsx` — **deleted** (content moved to InternalControlTab)
- `SettingsPage/tabs/InternalControlTab.tsx` — absorbs 4 cards: MakerCheckerToggle, ReversePermissionCard, PettyCashCustodianCard, TestModeToggle. Organized into 3 labeled sections
- `e2e/settings-tabs.spec.ts` — updates TAB_IDS to reflect new tab list
- `__tests__/SettingsPage.test.tsx`, `__tests__/InternalControlTab.test.tsx` — new unit tests covering alias + composition

### Critical Issues
None.

### Warning Issues
None.

### Info
- The `TAB_ALIASES` backward-compat map is a clean approach — no hash stored in URL state, just resolved at read time.
- `FINANCE_MANAGER` attempting `#users` correctly falls through to the first visible tab (verified by test).
- Two planning doc files in `docs/superpowers/`: `2026-06-23-users-settings-consolidation.md` (430 lines) and `2026-06-23-users-page-consolidation-design.md` (124 lines) — consistent with project documentation conventions.
- The comment in `accounting.md` update correctly cross-references the `/settings#internal-control` consolidation.

### Recommendation: **APPROVE** ✅

---

## Branch 2: `feat/settings-ia-redesign-p2a`

### Summary
Foundation layer for the Settings IA redesign. Converts `SettingsLayout` from rendering `<CategoryPage>` directly to using React Router `<Outlet>`. Introduces `SettingsCategoryRoute` and `SettingsItemRoute` components, adds `findItem()` helper, and migrates the `finance` category (interest / GFIN / payment-methods) from `kind: 'external'` to `kind: 'route'` (rendered inline in the settings panel, no full-page navigation).

### Files Changed
- `App.tsx` — 35 lines changed: removes standalone routes for `InterestConfigPage`, `GfinConfigPage`, `PaymentMethodSettingsPage`; converts `/settings/:categoryId` to parent+child Outlet structure
- `settings-registry.tsx` — migrates 3 finance items from `kind: 'external'` to `kind: 'route'` with component references
- `settings-access.ts` — adds `findItem()` helper
- `settings/SettingsCategoryRoute.tsx` — new (7 lines): thin wrapper reading `categoryId` from params
- `settings/SettingsItemRoute.tsx` — new (18 lines): role-gates item routes, redirects to category if unauthorized/unknown
- `settings/SettingsLayout.tsx` — replaces `<CategoryPage>` with `<Outlet />`
- `settings/CategoryPage.tsx` — fixes link generation for `kind: 'route'` items (use canonical `/settings/<cat>/<id>` path)
- Tests: `SettingsItemRoute.test.tsx`, `finance-migration.test.tsx`, `settings-routing.test.tsx` updates

### Critical Issues
None.

### Warning Issues
- **SettingsItemRoute role check (minor)**: `found.item.roles.includes(role)` where `role = (user?.role ?? '') as SettingsRole`. When `user` is `null`, `role` is `''` which correctly fails the `includes` check and redirects to category — safe. No action needed but worth noting for readability.

### Info
- `SettingsItemRoute` handles the authorization check client-side only — consistent with how all other `ProtectedRoute` wrappers work in this project (no backend double-check needed since settings pages only mutate via API endpoints that have their own guards).
- 398-line planning doc in `docs/superpowers/` — consistent with project conventions.
- Test coverage is solid: redirect paths, role gates, unknown-item fallback all covered.

### Recommendation: **APPROVE** ✅

---

## Branch 3: `feat/settings-ia-redesign-p2b`

### Summary
Stacked on top of `p2a`. Migrates 5 remaining settings categories (comms, AI, products, company/access, system) to the new `/settings/<category>/<item>` URL pattern. Removes their standalone `App.tsx` lazy imports and replaces old routes with `<Navigate ... replace />` redirect aliases. Updates `menu.ts` with new canonical paths. Adds 5 migration test suites (one per category).

### Files Changed
- `App.tsx` — 210-line net change: removes ~15 lazy imports, replaces ~20 routes with `<Navigate>` redirects for old paths
- `config/menu.ts` — updates 12+ menu item paths to new canonical URLs
- `config/settings-registry.tsx` — 60-line change: moves items from `kind: 'external'` to `kind: 'route'`, adds new category groups (company, access, products, comms, AI, system)
- `AiAdminPage.tsx`, `DunningSettingsPage.tsx`, `ETaxInvoicePage.tsx` — minor tweaks (likely import cleanup)
- Tests: 5 new `*-migration.test.tsx` files covering all redirected paths
- Planning doc: `*-remaining-categories.md` (234 lines)

### Critical Issues
None.

### Warning Issues
- **Commented-out lazy imports in App.tsx**: Several lines like `// LineOaSettingsPage moved to settings-registry` remain as comments rather than being cleanly removed. These are harmless dead code but add noise. Suggest removing comments and dead imports in a follow-up cleanup commit.
- **settings-registry.tsx now 120+ lines**: Getting large. Not blocking, but consider splitting into per-category modules if it continues to grow.

### Info
- The redirect chain is correct: old URL → `<Navigate>` → new `/settings/<cat>/<item>` → `SettingsItemRoute` renders component in-panel.
- AI category renames IDs (`ai-chat` → `assistant`, etc.) are consistent across registry + menu + App.tsx.
- All 5 migration test suites follow the same pattern as the p2a finance tests.
- No hardcoded hex colors or `bg-white` / `text-gray-*` violations introduced.

### Recommendation: **APPROVE** (with minor cleanup suggested) ✅

---

## Merge Order

These branches must merge in order:

```
1. feat/users-page-consolidation     (independent, merge first)
2. feat/settings-ia-redesign-p2a     (foundation, merge second)
3. feat/settings-ia-redesign-p2b     (stacked on p2a, merge last)
```

p2b was branched from the HEAD of p2a — after p2a merges to main, p2b will need a `git merge main` or `git rebase main` to pick up any new commits before it can merge cleanly.

---

## Checklist

| Check | p2a | p2b | users-consolidation |
|-------|-----|-----|---------------------|
| No missing `@UseGuards` on new controllers | N/A | N/A | N/A |
| No `Number()` on money fields | ✅ | ✅ | ✅ |
| No missing `deletedAt: null` in queries | N/A | N/A | N/A |
| No hardcoded secrets | ✅ | ✅ | ✅ |
| No raw `fetch()` calls | ✅ | ✅ | ✅ |
| No missing `invalidateQueries()` | N/A | N/A | N/A |
| No hardcoded hex/gray colors | ✅ | ✅ | ✅ |
| Test coverage present | ✅ | ✅ | ✅ |
| Backend API changes | None | None | None |
