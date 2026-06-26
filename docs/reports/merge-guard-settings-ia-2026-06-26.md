# Pre-Merge Guard Report — 2026-06-26

**Reviewed by**: Pre-Merge Guard (automated, scheduled run)
**Date**: 2026-06-26
**Branches reviewed**: 3 (selected from 450 unmerged; top by recency + file-change count, excluding guard/watchdog branches)

---

## Summary

| Branch | Author | Files Changed | Recommendation |
|--------|--------|---------------|----------------|
| `feat/settings-ia-redesign` | iamnaii | 18 | REVIEW (1 Warning) |
| `feat/integrations-own-category` | iamnaii | 9 | APPROVE |
| `feat/users-page-consolidation` | iamnaii | 10 | APPROVE |

**No Critical issues found.** All branches are frontend-only; no backend API changes.

---

## Branch 1: `feat/settings-ia-redesign`

**Commit date**: 2026-06-23  
**Author**: iamnaii  
**Files changed**: 18 (all `apps/web/src/` — App.tsx, settings-registry, settings-access, SettingsLayout, CategoryPage, SettingsIndexRedirect, tests)

### What it does
Replaces the old hash-tab `SettingsPage` with a registry-driven panel:
- `/settings` now redirects to `/settings/:categoryId` (first visible category per role)
- 8 categories registered (company, access, accounting, finance, products, comms, ai, system)
- Route widened: `ProtectedRoute roles=['OWNER']` → `['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']` (intentional — FM/ACC see a filtered subset per the registry)
- Backward compat: old hash fragments (`#vat`, `#users`, etc.) redirect to new URL scheme

### Issues Found

#### ⚠️ Warning: `CategoryPage` renders empty when non-OWNER accesses OWNER-only category via direct URL

**File**: `apps/web/src/pages/settings/CategoryPage.tsx`

`CategoryPage` calls `categoryById(categoryId)` and `visibleItems(cat, role)` correctly — items are filtered. However, when a FINANCE_MANAGER navigates directly to `/settings/access` (an OWNER-only category), the page renders with zero visible items and no redirect. The sidebar never links to it (FM can't see `access` in the nav), but a bookmarked or manually-typed URL returns a confusing blank content area.

**Impact**: UX/defensive programming only — NOT a security bug. No data is exposed (inline components only render when included in `visibleItems`; backend guards protect API endpoints regardless).

**Suggested fix** (in `SettingsLayout.tsx`):
```tsx
const cats = visibleCategories(role);
// Add after resolving cats:
const currentCatVisible = cats.some(c => c.id === categoryId);
if (!currentCatVisible && cats.length > 0) {
  navigate(`/settings/${cats[0].id}`, { replace: true });
  return null;
}
```

#### ℹ️ Info: `settingsRegistry.test.ts` hardcodes category count (8)
The test `'มี 8 หมวด id ไม่ซ้ำ'` will need to be updated whenever a new category is added. This is expected for a snapshot test but worth noting — the count became stale between this branch and `feat/integrations-own-category` (where it needed to be updated to 9). This suggests these two branches need to be merged in order.

### Checks Passed
- No `Number()` usage on financial fields
- No `fetch()` calls (all data fetching via existing component hooks — components imported from existing tabs)
- No hardcoded secrets or API keys
- No `$queryRaw` usage
- All new `SettingsItem` definitions have `roles` arrays
- `ProtectedRoute` still enforced at the route level
- Tests added for `settings-access.ts` and `settings-registry.tsx`

### Recommendation: **REVIEW** — Address Warning before merge

---

## Branch 2: `feat/integrations-own-category`

**Commit date**: 2026-06-24  
**Author**: iamnaii  
**Files changed**: 9 (settings-registry, menu, App.tsx redirect rules, tests)

### What it does
Splits `integrations` and `mdm` items out of the `system` category into their own `integrations` category. Updates redirect chain:
- Old: `/settings/integrations` → `/settings/system/integrations`
- New: `/settings/system/integrations` → `/settings/integrations/hub`
- `system` category becomes OWNER-only (was `['OWNER', 'ACCOUNTANT']`)
- `integrations` category is `['OWNER', 'ACCOUNTANT']` (ACCOUNTANT can see hub)
- Registry count updated: 8 → 9 categories

### Issues Found

#### ℹ️ Info: Redirect chain length
`/settings/integrations` → (old P2b redirect) → `/settings/system/integrations` → (new redirect) → `/settings/integrations/hub` — two hops. The old P2b redirect for `/settings/integrations` appears to have been removed in this branch (only `/settings/system/integrations` redirect exists). This may cause a broken redirect if any code/bookmarks still use the original `/settings/integrations` path. The App.tsx diff in this branch does not include a catch for bare `/settings/integrations`. Worth verifying there's no stale bookmark.

### Checks Passed
- No security issues
- No API changes
- Tests updated for new category count and ACCOUNTANT access rules
- Proper backward-compat redirects from old paths

### Recommendation: **APPROVE** (with info note on redirect chain)

---

## Branch 3: `feat/users-page-consolidation`

**Commit date**: 2026-06-23  
**Author**: iamnaii  
**Files changed**: 10 (SettingsPage/index, InternalControlTab, UsersTab deleted, E2E spec, tests, docs)

### What it does
- Consolidates `UsersTab` into an expanded `InternalControlTab` (renamed to "ระบบควบคุม & สิทธิ์")
- Adds backward compat: `TAB_ALIASES = { users: 'internal-control' }` so `#users` hash still works
- Deletes `UsersTab.tsx` (48 lines — all 4 cards moved to `InternalControlTab`)
- Groups internal-control cards into 3 sections: การอนุมัติ & สิทธิ์ / เงินสด / ความปลอดภัย
- Updates E2E spec (`TAB_IDS` array)

### Issues Found

None.

### Checks Passed
- No new data fetching (components re-used from existing `UsersTab`)
- `#users` hash alias correctly handles FM role (falls through to first visible tab per existing `setActiveTab` logic)
- Tests added: `InternalControlTab.test.tsx` (5 cards + 3 groups), `SettingsPage.test.tsx` (alias + role gate)
- E2E spec updated
- `PettyCashCustodianCard` JSDoc comment updated to reference correct tab name

### Recommendation: **APPROVE**

---

## Merge Order Note

These three branches build on each other (settings IA redesign is the foundation; integrations splits a category from it; users-consolidation modifies the pre-IA tab system). Confirm merge order:

1. `feat/settings-ia-redesign` (after addressing Warning)
2. `feat/users-page-consolidation`
3. `feat/integrations-own-category`

---

## Scan Coverage Note

450 total unmerged branches scanned for recency. Top 30 non-guard branches checked for API backend changes — **none found**. All active development in this window is frontend-only (settings UI IA redesign series). No Prisma schema changes, no new controllers, no new API endpoints in any recent branch.
