# Pre-Merge Guard Report — 2026-06-26 (run 2)

**Reviewed by**: Pre-Merge Guard (automated, scheduled run)
**Date**: 2026-06-26
**Branches reviewed**: 3 (P5/P6 settings navigation redesign sequence — 2026-06-24 commits)

> **Note**: The earlier 2026-06-26 run already covered `feat/settings-ia-redesign`,
> `feat/integrations-own-category`, and `feat/users-page-consolidation`. This run covers
> the subsequent P5/P6 navigation branches.

---

## Summary

| Branch | Author | Files Changed | Recommendation |
|--------|--------|---------------|----------------|
| `feat/settings-sidebar-driven-nav` | iamnaii | 13 | **APPROVE** |
| `feat/settings-contacts-standalone` | iamnaii | 11 | **APPROVE** |
| `feat/contacts-into-settings-submenu` | iamnaii | 9 | **APPROVE** |

**No Critical issues found.** All three branches are frontend-only; no backend API changes.

**⚠️ Merge order is critical** — these branches depend on each other in sequence. See §Merge Order below.

---

## Branch 1: `feat/settings-sidebar-driven-nav`

**Commit date**: 2026-06-24
**Author**: iamnaii
**Files changed**: 13 (all `apps/web/src/` — menu.ts/test, CategoryPage, SettingsLayout, 6 migration tests, 1 plan doc)

### What it does
P5: removes the desktop left-panel category nav (`SettingsLayout.tsx`) and makes the main sidebar
drive category selection instead. `buildSettingsZoneSections()` in `menu.ts` now generates
registry-driven sidebar items (`/settings/<catId>`) rather than static hardcoded links.
Also fixes:
- Stale `/settings#contacts` bottom-nav links for FM/ACC → `/settings/company`
- Duplicate React key on `CategoryPage` groups (was `g.name ?? gi`, now `${g.name ?? ''}-${gi}`)
- `resolveZoneForPath` shortcut so any `/settings/*` path maps to settings zone without
  scanning every sidebar item

### Issues Found

None.

### Checks Passed
- No `Number()` on money/financial fields
- No `fetch()` calls — no data fetching in changed files
- No hardcoded secrets
- No new controllers or DTOs — fully frontend
- Duplicate key fix is correct: composite `${name}-${index}` eliminates the non-contiguous group collision
- `resolveZoneForPath` shortcut is guarded by `showSettingsGear` check — SALES/BM not affected
- 9 migration tests updated to match new behavior (desktop left-nav removed); tests
  still assert `Outlet` content renders correctly

---

## Branch 2: `feat/settings-contacts-standalone`

**Commit date**: 2026-06-24
**Author**: iamnaii
**Depends on**: `feat/settings-sidebar-driven-nav` (its tests reference P5 state)
**Files changed**: 11 (App.tsx, CommandPalette, settings-access/registry tests, menu.ts/test, settings-registry.tsx, SettingsIndexRedirect test, plan doc)

### What it does
P6 part 1: moves `/contacts` out of the `company` settings category into a dedicated sidebar
item. Key changes:
- **Wraps `/contacts` and `/contacts/:id` with `ProtectedRoute roles=['OWNER','FINANCE_MANAGER','ACCOUNTANT']`** — previously these routes were unwrapped
- Removes `ContactsTab` import from `settings-registry.tsx` (contacts no longer inside settings panel)
- `company` category becomes OWNER-only (all items were already OWNER-only)
- FM/ACC first-visible-category shifts from `company` → `accounting`
- `buildSettingsZoneSections()` in `menu.ts` now emits a separate `master-data` section
  (with `/contacts`) before the `settings` registry section
- Adds "สมุดผู้ติดต่อ" to `CommandPalette` with `roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']`

### Issues Found

#### ℹ️ Info: Security improvement worth noting (not a problem)

Adding `ProtectedRoute` to `/contacts` and `/contacts/:id` is a security improvement.
Previously these routes had no `ProtectedRoute` wrapper, meaning SALES and BRANCH_MANAGER
roles could navigate there (the backend API guards protect data, but frontend-side role
gating was absent). The change correctly restricts to OWNER/FM/ACC.

The backend `/contacts` API endpoint should already require JwtAuthGuard+RolesGuard — this
frontend guard is defense-in-depth. **No action required.**

### Checks Passed
- No `Number()` on money/financial fields
- No new backend files, controllers, or services
- `CommandPalette` entry correctly role-filtered: `roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']`
- `firstVisibleCategoryId('FINANCE_MANAGER')` correctly returns `'accounting'` now that FM
  can no longer see `company`
- All test updates are accurate: `settings-access.test.ts` explicitly tests that FM doesn't
  see `company` category and that FM's first category is `accounting`

---

## Branch 3: `feat/contacts-into-settings-submenu`

**Commit date**: 2026-06-24
**Author**: iamnaii
**Depends on**: `feat/settings-contacts-standalone` (and transitively `feat/settings-sidebar-driven-nav`)
**Files changed**: 9 (CommandPalette.tsx/test, ContactCombobox.tsx, QuickBuyModal.tsx, menu.ts/test, ContactsPage.tsx, ContactsTab.tsx, accounting.md)

### What it does
P6 final: two changes bundled:
1. **Label rename** "สมุดผู้ติดต่อ" → "รายชื่อผู้ติดต่อ" uniformly across all surfaces
   (CommandPalette entry, ContactCombobox group heading, QuickBuyModal error toast,
   ContactsPage document title, ContactsTab `<h1>`)
2. **Navigation consolidation**: merges the separate `master-data` section (from branch 2)
   back into the single `settings` section — `/contacts` becomes the *first* item in
   `ตั้งค่าระบบ`, before the registry categories. One section instead of two.

### Issues Found

None.

### Checks Passed
- No `Number()` usage
- No `fetch()` calls
- Old term "สมุดผู้ติดต่อ" kept as a search keyword in `CommandPalette` (`keywords:
  '...สมุดผู้ติดต่อ'`) — users who type the old name still find the page. Good backward compat.
- Toast error message in `QuickBuyModal` correctly updated: `'กรุณาเลือกผู้ขายจากรายชื่อผู้ติดต่อ'`
- `accounting.md` change is a one-line doc update to reflect the new label (non-code)
- `resolveZoneForPath('/contacts', 'OWNER')` now correctly returns `'settings'` (contacts
  is inside the settings submenu) — regression test present

---

## Merge Order (REQUIRED)

These three branches form a sequential chain. The test files reference previous-branch state,
meaning merging out of order will produce failing tests:

```
1. feat/settings-sidebar-driven-nav   ← merge first (P5)
2. feat/settings-contacts-standalone  ← merge second (P6 part 1, depends on P5)
3. feat/contacts-into-settings-submenu ← merge last (P6 final, depends on both)
```

All three can be merged on the same day; they just need to follow this sequence.

---

## Cross-Branch Concern

The prior guard run (2026-06-26 run 1) flagged a `Warning` on `feat/settings-ia-redesign`:
> *CategoryPage renders empty when non-OWNER accesses OWNER-only category via direct URL*

Branch 1 (`feat/settings-sidebar-driven-nav`) **partially addresses** this: the FM/ACC sidebar
no longer links to OWNER-only categories directly. However, the fix suggested in run 1
(redirect in `SettingsLayout` when `currentCatVisible` is false) is **still not implemented**.
A FM user with a bookmarked `/settings/access` URL still sees a blank content area.

**This remains a UX Warning.** Not a security bug. Suggested fix from run 1 still applies.

---

## Recommendation

| Branch | Decision | Condition |
|--------|----------|-----------|
| `feat/settings-sidebar-driven-nav` | **APPROVE** | Merge first |
| `feat/settings-contacts-standalone` | **APPROVE** | Merge after branch 1 |
| `feat/contacts-into-settings-submenu` | **APPROVE** | Merge last |

All three are safe to merge. No Critical or Warning blockers. The blank-category UX issue
(carry-over from run 1) can be addressed in a follow-up chore PR.
