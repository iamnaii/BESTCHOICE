# Merge Guard Report — feat/settings-ia-redesign-p3p4

**Date**: 2026-06-24  
**Branch**: `feat/settings-ia-redesign-p3p4`  
**Author**: iamnaii  
**Commits ahead of main**: 9  

---

## Summary

Settings IA redesign phase P3+P4 — sidebar collapse, CommandPalette indexing, scroll-to-hash in CategoryPage, and dead-code removal.

## File Changes (9 files, +492 / -251)

| File | Change |
|------|--------|
| `apps/web/src/App.tsx` | Removes `/settings/document-config` ComingSoon route; **drops ProtectedRoute from `/contacts`** |
| `apps/web/src/components/CommandPalette.tsx` | Indexes settings registry items into the palette |
| `apps/web/src/components/CommandPalette.test.tsx` | NEW — 174-line test file (registry integration) |
| `apps/web/src/config/menu.ts` | Collapses owner-settings/owner-ai into panel entry; removes /settings deep-links from sidebar |
| `apps/web/src/config/menu.test.ts` | Tests for collapsed sidebar state |
| `apps/web/src/pages/settings/CategoryPage.tsx` | Adds `useEffect` for scroll-to-hash on mount |
| `apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx` | New tests for scroll + hook stability |
| `apps/web/src/pages/SettingsPage/components/SystemSettings.tsx` | DELETED (confirmed dead code) |
| `apps/web/src/components/accounting/ReverseConfirmDialog.tsx` | Updates stale comment path |
| `apps/web/src/{pages/AccountRolesPage,InterestConfigPage,PeakExportPage}.tsx` | Updates stale JSDoc paths |

---

## Issues

### 🔴 Critical

**C1 — `/contacts` and `/contacts/:id` lose their `ProtectedRoute` wrapper**

- **File**: `apps/web/src/App.tsx`
- **Before** (origin/main): `<Route path="/contacts" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}><ContactsPage /></ProtectedRoute>} />`
- **After** (this branch): `<Route path="/contacts" element={<ContactsPage />} />`
- **Impact**: SALES and BRANCH_MANAGER roles — who are intentionally excluded on the frontend — can now navigate to `/contacts` and the backend API will serve them data (the contacts controller uses `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')`). The frontend restriction is the only enforcer of the "contacts = OWNER/FM/ACC only" policy.
- **Fix available**: `feat/settings-contacts-standalone` restores the guards. Merge that branch before or alongside this one.

---

### ⚠️ Warning

None found.

---

### ℹ️ Info

- **I1** — `SystemSettings.tsx` deletion verified clean: plan document confirms `grep -rn "SystemSettings" apps/web/src` found only the file itself before deletion. Safe to remove.
- **I2** — `settingsEntries` in CommandPalette: `roles: item.roles as string[]` is safe because `SettingsItem.roles` is typed as `SettingsRole[]` (never undefined in the registry). `filterByRole` handles `!item.roles` as "visible to all" which would never trigger for registry items.

---

## Recommendation

**🚫 BLOCK**

Branch introduces a security regression (C1): `/contacts` routes lose role guard, allowing SALES/BRANCH_MANAGER frontend access to the contacts UI. The API will serve them data.

**Required before merge**: Either
1. Fix C1 in this branch (re-add ProtectedRoute to `/contacts` + `/contacts/:id`), or  
2. Ensure `feat/settings-contacts-standalone` merges immediately after (no gap).

All other changes are well-structured, well-tested, and safe to merge.
