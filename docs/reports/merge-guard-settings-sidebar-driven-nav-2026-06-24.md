# Merge Guard Report — feat/settings-sidebar-driven-nav

**Date**: 2026-06-24  
**Branch**: `feat/settings-sidebar-driven-nav`  
**Author**: iamnaii  
**Commits ahead of main**: 5  

---

## Summary

Settings navigation P5 — replaces static flat sidebar lists with a registry-driven sidebar (one `getSidebarForRole` section per settings category), drops the duplicate desktop sub-nav inside `SettingsLayout`, and fixes stale `/settings#contacts` hash-links in FM/ACC bottom nav.

## File Changes (13 files, +339 / -167)

| File | Change |
|------|--------|
| `apps/web/src/config/menu.ts` | Removes owner-fin-master, fm-fin-master, acc-fin-master, owner-settings, owner-settings-extra sections; builds settings zone from `visibleCategories()` |
| `apps/web/src/config/menu.test.ts` | Full test update for registry-driven sidebar |
| `apps/web/src/pages/settings/SettingsLayout.tsx` | Drops desktop left sub-nav (sidebar now drives category) |
| `apps/web/src/pages/settings/CategoryPage.tsx` | Minor: adds heading |
| All `__tests__/` migration test files (6 files) | Update assertions from "left nav visible" → "left nav absent" |
| `docs/superpowers/plans/...` | Plan document |

---

## Issues

### 🔴 Critical

**C1 — Inherits unprotected `/contacts` routes from `feat/settings-ia-redesign-p3p4`**

- This branch is stacked on top of `feat/settings-ia-redesign-p3p4` and carries the same regression: `/contacts` and `/contacts/:id` routes have no `ProtectedRoute` wrapper.
- `apps/web/src/App.tsx` shows: `<Route path="/contacts" element={<ContactsPage />} />` (no guard).
- Impact: identical to the parent branch (see C1 in merge-guard-settings-ia-p3p4 report).

---

### ⚠️ Warning

None found.

---

### ℹ️ Info

- **I1** — The old `owner-fin-master` / `fm-fin-master` / `acc-fin-master` sidebar sections (pointing to `/settings#contacts`) are removed. The contacts link is properly re-homed: FM/ACC bottom nav now points to `/settings/company` (this branch) which is subsequently fixed to `/contacts` in P6. No dead navigation — just an intermediate redirect chain.
- **I2** — `buildSettingsZoneSections` uses `visibleCategories(role)` which calls `settingsRegistry` — the same source as the CommandPalette index from P3+P4. Single source of truth maintained.
- **I3** — 9 test files updated; assertions correctly reflect that desktop left-nav is gone (sidebar handles it).

---

## Recommendation

**🚫 BLOCK**

Branch inherits C1 from `feat/settings-ia-redesign-p3p4`. The `/contacts` route guard is missing.

**Required before merge**: Same as P3+P4 — ensure `feat/settings-contacts-standalone` (P6) merges immediately after this branch, or fix C1 here directly.

Functionally the navigation change is sound and well-tested. Unblock by merging as a bundle: P3+P4 → P5 → P6 in one pipeline, not independently.
