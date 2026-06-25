# Pre-Merge Guard Report — Settings Navigation Refactor Chain
**Date**: 2026-06-25  
**Branches reviewed**: 3  
**Author**: akenarin.ak@gmail.com  
**Guard run**: `guard/review-2026-06-25-run2`

---

## Branches Reviewed (in dependency order)

| # | Branch | Files | +/- Lines | Recommendation |
|---|--------|-------|-----------|----------------|
| 1 | `feat/settings-sidebar-driven-nav` | 13 | +339/-167 | ✅ APPROVE |
| 2 | `feat/settings-contacts-standalone` | 11 | +263/-62 | ✅ APPROVE |
| 3 | `feat/integrations-own-category` | 9 | +59/-30 | ✅ APPROVE |

> These branches form a linear chain — **merge in order 1 → 2 → 3**.

---

## Branch 1: `feat/settings-sidebar-driven-nav`

### Summary
Settings-zone sidebar is now **registry-driven** (P5). Replaces hardcoded per-role static `owner-settings`, `owner-settings-extra`, `fm-fin-master`, `acc-fin-master` sections with a single `buildSettingsZoneSections(role)` function that reads from `settings-access.visibleCategories()`. Also drops the desktop sub-nav from `SettingsLayout.tsx` (sidebar now drives category navigation), and fixes a React duplicate-key bug in `CategoryPage.tsx`.

### Changes
- `apps/web/src/config/menu.ts` — removes ~45 lines of static menu section objects; adds `buildSettingsZoneSections()` (role-filtered registry lookup); updates `resolveZoneForPath()` to map `/settings/*` to the settings zone
- `apps/web/src/pages/settings/SettingsLayout.tsx` — removes `<nav>` with category links (desktop left sub-nav gone)
- `apps/web/src/pages/settings/CategoryPage.tsx` — adds category heading `<h2>`; fixes duplicate key by using `${g.name ?? ''}-${gi}` instead of bare `g.name ?? gi`
- `apps/web/src/config/menu.test.ts` — rewrites 8 test cases to assert new registry-driven shape
- `apps/web/src/pages/settings/__tests__/SettingsLayout.test.tsx` — asserts desktop left-nav links are gone; search box still present

### Security Checks

| Check | Result |
|-------|--------|
| Missing `@UseGuards` on new controllers | N/A — frontend only |
| `Number()` on money fields | Not applicable |
| Missing `deletedAt: null` | Not applicable |
| Hardcoded secrets | None |
| Raw `fetch()` instead of `api.get()` | None |
| Missing `queryClient.invalidateQueries()` | None |
| Hardcoded hex colors | None (uses `text-foreground` tokens) |
| Missing role guards on routes | None — no new routes |

### Issues Found

**Critical**: None  
**Warning**: None  
**Info**:
- `SettingsLayout` removes the desktop left sub-nav entirely. Users navigating `/settings/accounting` see the content without a visible "you are in accounting" secondary nav. Mitigated by: (a) new `<h2>` category heading in `CategoryPage`, (b) settings-zone sidebar (main nav) shows active category.

### Recommendation: ✅ APPROVE

---

## Branch 2: `feat/settings-contacts-standalone`

### Summary
Moves "สมุดผู้ติดต่อ" (Contacts) out of the settings registry panel and into a **standalone `/contacts` route** with its own gear-zone sidebar entry (P6). Adds a `master-data` sidebar section (above registry categories) for OWNER/FM/ACC. Also:
- Adds `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` to `/contacts` and `/contacts/:id` in App.tsx (previously these routes had no role guard at all — **this is a pre-existing security gap being fixed**)
- Adds "สมุดผู้ติดต่อ" to `CommandPalette` with role filtering
- `#contacts` hash redirect now navigates directly to `/contacts` (bypasses settings panel)
- `company` category becomes OWNER-only (contacts was its only ALL-role item; FM/ACC no longer see the company category in settings)

### Changes
- `apps/web/src/App.tsx` — wraps `/contacts` and `/contacts/:id` in `ProtectedRoute`
- `apps/web/src/components/CommandPalette.tsx` — adds `สมุดผู้ติดต่อ` entry with `roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']`
- `apps/web/src/config/settings-registry.tsx` — removes `contacts` item from `company` category; imports `ContactsTab` removed
- `apps/web/src/config/menu.ts` — `buildSettingsZoneSections()` now prepends a `master-data` section with `/contacts` before the registry categories; bottomNav for FM/ACC updated to `/contacts` (was `/settings/company`)
- `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` — removes `contacts: 'company'` from `HASH_TO_CATEGORY`; adds dedicated redirect: `hash === 'contacts'` → navigate to `/contacts`

### Security Checks

| Check | Result |
|-------|--------|
| Missing `@UseGuards` on new controllers | N/A — frontend only |
| `Number()` on money fields | Not applicable |
| Missing `deletedAt: null` | Not applicable |
| Hardcoded secrets | None |
| Raw `fetch()` instead of `api.get()` | None |
| Missing `queryClient.invalidateQueries()` | None |
| Unprotected routes | **FIXED** — `/contacts` and `/contacts/:id` now have `ProtectedRoute` (role: OWNER/FM/ACC) |

### Issues Found

**Critical**: None  
**Warning**:
- `company` settings category now has zero items visible to FM/ACC (contacts removed, remaining items are OWNER-only). `firstVisibleCategoryId('FINANCE_MANAGER')` changes from `company` to `accounting`. Any deep-link `/settings/company` for FM/ACC role will render an empty category or redirect to `accounting`. **Verify the empty-category UX in the panel** (CategoryPage should handle empty item list gracefully).
  
**Info**:
- Contacts is now accessible at two paths for OWNER: `/contacts` (direct) AND still reachable via `CommandPalette`. FM/ACC only see it via sidebar master-data section and CommandPalette — they no longer see `/settings/company` in the panel. This is the stated intent (P6 plan).
- The `ContactsTab` import is removed from `settings-registry.tsx` but `ContactsPage` / `ContactDetailPage` are imported lazily in `App.tsx` — no issue.

### Recommendation: ✅ APPROVE

---

## Branch 3: `feat/integrations-own-category`

### Summary
Splits Integration Hub + MDM settings out of the `system` category into a new **`integrations` category** (P7 cleanup). `system` category roles narrowed from `['OWNER', 'ACCOUNTANT']` to `['OWNER']` only. New `integrations` category: `['OWNER', 'ACCOUNTANT']` with `hub` (OWNER+ACC) and `mdm` (OWNER only) items.

Old redirect chain maintained:
- `/settings/integrations` → now resolves via dynamic `:categoryId` routing to `CategoryPage('integrations')` (intentional — replaces old P2b redirect that was pointing to the now-moved `/settings/system/integrations`)
- `/settings/system/integrations` → 301 to `/settings/integrations/hub`
- `/settings/system/mdm` → 301 to `/settings/integrations/mdm`
- `/settings/mdm-test` → 301 to `/settings/integrations/mdm`

### Changes
- `apps/web/src/config/settings-registry.tsx` — adds `integrations` category (9th category), removes `integrations` and `mdm` items from `system`; `system.roles` → `['OWNER']`
- `apps/web/src/App.tsx` — adds `/settings/system/integrations` and `/settings/system/mdm` redirects; removes stale P2b `/settings/integrations` redirect (now handled by dynamic category routing)
- `apps/web/src/config/menu.ts` — updates OWNER fin-zone "การเชื่อมต่อ" link from `/settings/system/integrations` to `/settings/integrations/hub`
- Tests: registry now expects 9 categories; ACCOUNTANT test verifies `integrations` visible, `system` not

### Security Checks

| Check | Result |
|-------|--------|
| Missing `@UseGuards` on new controllers | N/A — frontend only |
| `Number()` on money fields | Not applicable |
| Missing `deletedAt: null` | Not applicable |
| Hardcoded secrets | None |
| Raw `fetch()` instead of `api.get()` | None |
| Missing `queryClient.invalidateQueries()` | None |
| Role regression on integrations items | ACCOUNTANT retains access to `hub` item (same as before) |

### Issues Found

**Critical**: None  
**Warning**: None  
**Info**:
- Old `/settings/integrations` URL (a P2b redirect that pointed to `/settings/system/integrations`) is no longer a redirect — it now resolves via `/:categoryId` to `CategoryPage('integrations')`. This is slightly different behavior: users land on the integrations category page (showing hub + mdm as cards) rather than going directly into the hub. Test confirms this is intentional.
- ACCOUNTANT now explicitly excluded from `system` category. Any ACC user who had bookmarked `/settings/system` will land on `CategoryPage('system')` and see an empty or inaccessible page. The API routes themselves are OWNER-guarded so no data exposure. Consider adding an explicit 403 or redirect for non-OWNER on `/settings/system`.

### Recommendation: ✅ APPROVE

---

## Summary

All three branches are **pure frontend navigation/routing refactors**. No backend API changes, no new controllers, no database queries, no money field handling. The main security finding is **Branch 2 fixing a pre-existing gap** where `/contacts` and `/contacts/:id` lacked `ProtectedRoute` wrappers (backend API guards still applied, but frontend access control was missing).

**Merge order**: `feat/settings-sidebar-driven-nav` → `feat/settings-contacts-standalone` → `feat/integrations-own-category`

| Branch | Verdict | Blocker |
|--------|---------|---------|
| `feat/settings-sidebar-driven-nav` | ✅ APPROVE | None |
| `feat/settings-contacts-standalone` | ✅ APPROVE | None (verify empty company-category UX for FM/ACC) |
| `feat/integrations-own-category` | ✅ APPROVE | None |
