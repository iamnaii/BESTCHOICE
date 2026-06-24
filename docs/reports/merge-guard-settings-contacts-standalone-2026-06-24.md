# Merge Guard Report — feat/settings-contacts-standalone

**Date**: 2026-06-24  
**Branch**: `feat/settings-contacts-standalone`  
**Author**: iamnaii  
**Commits ahead of main**: 4  

---

## Summary

Settings P6 — moves "สมุดผู้ติดต่อ" (contacts) out of the settings registry `company` category and into its own gear-zone sidebar group. Restores the `ProtectedRoute` guard on `/contacts` routes. Adds contacts to CommandPalette and redirects the old `#contacts` hash-link to `/contacts`.

## File Changes (11 files, +263 / -62)

| File | Change |
|------|--------|
| `apps/web/src/App.tsx` | **Restores** `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` on `/contacts` + `/contacts/:id` |
| `apps/web/src/components/CommandPalette.tsx` | Adds `สมุดผู้ติดต่อ → /contacts` entry (OWNER/FM/ACC only) |
| `apps/web/src/components/CommandPalette.test.tsx` | Tests: palette shows /contacts for OWNER + FM |
| `apps/web/src/config/settings-registry.tsx` | Removes `contacts` item from company category |
| `apps/web/src/config/settings-access.test.ts` | Updates: FM no longer sees `company` category (contacts removed) |
| `apps/web/src/config/settings-registry.test.ts` | Asserts contacts not in company items |
| `apps/web/src/config/menu.ts` + `menu.test.ts` | Adds master-data group `{ key: 'master-data' }` prepended to settings zone sidebar; FM/ACC bottomNav → `/contacts` |
| `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` | `firstVisibleCategoryId` now skips `company` for FM (FM's first is `accounting`) |

---

## Issues

### 🔴 Critical

None.

---

### ⚠️ Warning

- **W1** — This branch depends on stacked predecessors (`feat/settings-ia-redesign-p3p4` → `feat/settings-sidebar-driven-nav`). If merged without them, many test assertions will fail (registry-driven sidebar shape expected by tests). Treat as the final step in a 3-branch bundle merge.

---

### ℹ️ Info

- **I1** — Security fix: `/contacts` ProtectedRoute restored. This corrects the regression introduced in P3+P4 (also present in P5). Net security state: same as `origin/main`.
- **I2** — API contacts controller allows BRANCH_MANAGER + SALES via `@Roles(...)` but the restored frontend ProtectedRoute restricts to OWNER/FM/ACC. The deliberate asymmetry (API more permissive) is preserved as intended.
- **I3** — `firstVisibleCategoryId('FINANCE_MANAGER')` now returns `'accounting'` instead of `'company'` — correct, because contacts (the only all-role item in company) was removed. SettingsIndexRedirect test updated accordingly.
- **I4** — All test files updated and consistent with the new shape.

---

## Recommendation

**✅ APPROVE** — with dependency note

This branch is safe to merge **as the last step** in the P3+P4 → P5 → P6 sequence. It contains a net security improvement (restoring the route guard) and no new issues.

**Dependency**: Must be merged after `feat/settings-ia-redesign-p3p4` and `feat/settings-sidebar-driven-nav`. Merging out of order will produce test failures and broken routing.
