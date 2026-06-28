# Merge Guard Report — Settings Navigation Branches
**Date**: 2026-06-28  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: 3 most-recently-active unmerged feature branches

---

## Summary

All 3 branches are **frontend-only** changes to settings navigation structure. No backend code,
no API endpoints, no security-sensitive changes. All pass security checks. Tests are updated
in each branch to match the new behavior.

**Important**: The 3 branches form a **dependency chain** and must be merged in order.

---

## Branch 1: `feat/settings-sidebar-driven-nav`

**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: 2026-06-24  
**Files changed**: 13 (339 +ins / 167 -del)  
**Scope**: Frontend only (`apps/web/`)

### What it does
- Removes the static hardcoded settings sidebar sections from `OWNER_CONFIG`,
  `FINANCE_MANAGER_CONFIG`, and `ACCOUNTANT_CONFIG`
- Replaces them with a single registry-driven `buildSettingsZoneSections()` function that
  dynamically generates one `"settings"` sidebar section from `settingsRegistry` categories
- Removes the desktop left sub-navigation panel from `SettingsLayout.tsx` (sidebar now handles category navigation)
- Adds a category heading (`<h2>`) to `CategoryPage.tsx` for orientation
- Fixes a React duplicate-key warning in `CategoryPage.tsx`: changed `key={g.name ?? gi}` to
  `key={`${g.name ?? ''}-${gi}`}` (prevents collisions when multiple unnamed groups exist)
- Fixes stale `#contacts` hash links in FM/ACC bottomNav to `/settings/company`

### Issues Found

| Severity | Issue |
|----------|-------|
| ✅ None | No critical security issues |
| ✅ None | No warning-level issues |
| ℹ️ Info | Duplicate-key fix in CategoryPage correctly composite-keys `${g.name}-${gi}` |
| ℹ️ Info | Stale hash link fix (`/settings#contacts` → `/settings/company`) is a real bug fix |

### Recommendation: **APPROVE** ✅

---

## Branch 2: `feat/contacts-into-settings-submenu`

**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: 2026-06-24  
**Files changed**: 9 (68 +ins / 71 -del)  
**Scope**: Frontend only (`apps/web/`)  
**Depends on**: `feat/settings-sidebar-driven-nav` (must merge first)

### What it does
- Moves the "รายชื่อผู้ติดต่อ" (contacts) item from a separate `master-data` sidebar section
  **into** the registry-driven `ตั้งค่าระบบ` submenu as the first item
- Renames "สมุดผู้ติดต่อ" → "รายชื่อผู้ติดต่อ" throughout UI (CommandPalette, ContactsTab,
  ContactCombobox, QuickBuyModal, ContactsPage)
- Old `master-data` sidebar section removed; no separate group needed
- Updates all corresponding tests

### Issues Found

| Severity | Issue |
|----------|-------|
| ✅ None | No critical security issues |
| ✅ None | No warning-level issues |
| ℹ️ Info | Pure UX rename + restructure; no logic changes |

### Recommendation: **APPROVE** ✅ (after `settings-sidebar-driven-nav` merges)

---

## Branch 3: `feat/integrations-own-category`

**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: 2026-06-24  
**Files changed**: 9 (59 +ins / 30 -del)  
**Scope**: Frontend only (`apps/web/`) + `.claude/rules/accounting.md` doc update  
**Depends on**: `feat/contacts-into-settings-submenu` → `feat/settings-sidebar-driven-nav`

### What it does
- Splits "การเชื่อมต่อ" (IntegrationHubPage + MdmTestPage) out of the `system` settings
  category into its own `integrations` category
- `system` category is now OWNER-only (ACCOUNTANT was only there for the integrations items,
  which are now accessible via the new `integrations` category)
- Updates redirects in `App.tsx`: old `/settings/system/integrations` → `/settings/integrations/hub`,
  old `/settings/system/mdm` → `/settings/integrations/mdm`
- Old `/settings/integrations` path now naturally resolves to `CategoryPage('integrations')`
  via the `:categoryId` dynamic route (no explicit redirect needed since `integrations` is now
  a valid registered category ID)
- OWNER's fin zone menu path updated: `settings/system/integrations` → `settings/integrations/hub`
- Updates accounting.md docs to reflect the URL change

### Issues Found

| Severity | Issue |
|----------|-------|
| ✅ None | No critical security issues |
| ✅ None | No warning-level issues |
| ℹ️ Info | Old `/settings/integrations` path is correctly handled by dynamic `:categoryId` route (test added) |
| ℹ️ Info | System category correctly narrowed to OWNER-only after moving integrations out |

### Recommendation: **APPROVE** ✅ (after both prior branches merge)

---

## Merge Order (Required)

These branches form a stack — merge in this order to avoid conflicts:

```
1. feat/settings-sidebar-driven-nav   ← merge first
2. feat/contacts-into-settings-submenu ← then this
3. feat/integrations-own-category      ← finally this
```

---

## Security Checklist (all 3 branches)

| Check | Result |
|-------|--------|
| New controllers with missing `@UseGuards(JwtAuthGuard)` | ✅ None (no backend changes) |
| `Number()` on money/financial fields | ✅ None |
| Missing `deletedAt: null` in queries | ✅ None (no query changes) |
| Hardcoded secrets or API keys | ✅ None |
| Missing `@Roles()` decorators | ✅ None (no backend changes) |
| Raw `fetch()` in new React code | ✅ None |
| Missing `queryClient.invalidateQueries()` after mutations | ✅ None (no mutations added) |
| Hardcoded hex colors (`#xxxxxx`) | ✅ None |
| Thai validation messages missing | ✅ N/A (no new DTOs) |

---

*Generated by Pre-Merge Guard — 2026-06-28*
