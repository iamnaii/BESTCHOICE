# Pre-Merge Guard Report — Settings IA Redesign Series

**Date**: 2026-06-25  
**Reviewed by**: Pre-Merge Guard (automated)  
**Author**: iamnaii \<akenarin.ak@gmail.com\>

---

## Branches Reviewed (3 of 3)

These branches form a **stacked series** and must be merged in order:

| # | Branch | Commits | Date | Recommendation |
|---|--------|---------|------|----------------|
| P3+P4 | `feat/settings-ia-redesign-p3p4` | 9 | 2026-06-24 | ✅ APPROVE |
| P5 | `feat/settings-sidebar-driven-nav` | 5 | 2026-06-24 | ✅ APPROVE |
| P6 | `feat/settings-contacts-standalone` | 4 | 2026-06-24 | ✅ APPROVE |

**Merge order**: P3+P4 → P5 → P6 (each branch depends on the previous)

All branches are **frontend-only** (`apps/web/src/` only — zero API/backend changes).

---

## Branch 1: `feat/settings-ia-redesign-p3p4` (P3+P4)

### Summary
- Integrates `settingsRegistry` into CommandPalette with role-based filtering
- Removes dead `SystemSettings.tsx` (192-line component, card reader setup)
- Removes duplicate `/settings/document-config` route (was pointing to `ComingSoonPage`)
- Fixes rules-of-hooks violation: `useEffect` moved above early return in `CategoryPage`
- Updates `PeriodsRedirect` to use `/settings/accounting#periods` (new canonical URL)
- Adds 174-line `CommandPalette.test.tsx` (TDD-style, 9 test cases)

### Files Changed (16)
- `apps/web/src/App.tsx` — remove duplicate route, fix PeriodsRedirect URL
- `apps/web/src/components/CommandPalette.tsx` — add registry integration + dedup filter
- `apps/web/src/components/CommandPalette.test.tsx` — new test file (174 lines)
- `apps/web/src/config/menu.ts` — relabelling + collapse
- `apps/web/src/config/menu.test.ts` — test updates for P5
- `apps/web/src/pages/settings/CategoryPage.tsx` — rules-of-hooks fix + scroll-to-hash
- `apps/web/src/pages/settings/CategoryPage.test.tsx` — scroll test
- `apps/web/src/pages/SettingsPage/components/SystemSettings.tsx` — DELETED
- 4 settings migration test files — path updates
- 2 settings pages (AccountRolesPage, InterestConfigPage, PeakExportPage, PettyCashCustodianCard) — path comment updates

### Issues Found

**Critical**: None

**Warning**: None

**Info**:
- `SystemSettings.tsx` contained `const CARD_READER_DOWNLOAD_URL = 'https://github.com/iamnaii/BESTCHOICE/releases/latest/download/...'` — a hardcoded external URL. File is deleted in this PR so no action needed; flagged for awareness.
- Removing `/settings/document-config` route is safe: the route pointed to a `ComingSoonPage` stub and has no production users.

### Rules-of-Hooks Fix (Notable)
`CategoryPage.tsx` had a `useEffect` placed AFTER an early return — a React rules-of-hooks violation that would cause a crash when `categoryId` is unknown. This PR moves the effect above the guard. **Correct fix.**

### CommandPalette Dedup Logic (Notable)
```ts
.filter((e) => !pages.some((p) => p.path === e.path));
```
Prevents duplicate entries when a registry item (e.g. `company.branches → /branches`) already exists as a base page entry. Correct approach.

**Recommendation: APPROVE** — Clean refactoring, removes dead code, fixes a rules-of-hooks bug.

---

## Branch 2: `feat/settings-sidebar-driven-nav` (P5)

### Summary
- Settings zone sidebar becomes fully registry-driven (replaces static `owner-settings` / `owner-settings-extra` sections)
- Settings panel drops desktop left sub-nav (sidebar drives categories instead)
- `CategoryPage` composite group key fix (was using `group` name as key → duplicates on non-contiguous groups)
- FM/ACC mobile bottomNav contacts path fixed from stale `#contacts` to `/settings/company`

### Files Changed (13)
- `apps/web/src/config/menu.ts` — replace static sections with `buildSettingsZoneSections()`
- `apps/web/src/config/menu.test.ts` — 144 lines changed (section key assertions updated for P5)
- `apps/web/src/pages/settings/CategoryPage.tsx` — drop desktop sub-nav
- `apps/web/src/pages/settings/SettingsLayout.tsx` — 31-line reduction
- 7 migration test files — path assertion updates
- `docs/plans/2026-06-24-settings-sidebar-driven-nav.md` — 166-line plan doc

### Issues Found

**Critical**: None

**Warning**: None

**Info**:
- `CategoryPage` key fix (`group + item.id` composite) prevents React duplicate-key console warnings on pages where items from the same group appear non-contiguously.
- Settings panel is now navigated via sidebar only (no in-panel left nav on desktop). UX change; no security impact.

**Recommendation: APPROVE** — Structural cleanup, reduces sidebar redundancy, bug fix.

---

## Branch 3: `feat/settings-contacts-standalone` (P6)

### Summary
- Promotes `/contacts` and `/contacts/:id` to role-guarded standalone routes
- Removes `contacts` item from settings registry (company category)
- Adds contacts as a `master-data` section in the settings gear-zone sidebar (above the registry categories)
- Adds CommandPalette entry for `สมุดผู้ติดต่อ` (role-filtered)
- Redirects old `#contacts` hash to `/contacts`

### Files Changed (11)
- `apps/web/src/App.tsx` — adds `ProtectedRoute` to `/contacts` and `/contacts/:id`
- `apps/web/src/config/menu.ts` — `buildSettingsZoneSections()` adds `master-data` section
- `apps/web/src/config/menu.test.ts` — 108-line delta, all P6 assertions
- `apps/web/src/config/settings-registry.tsx` — removes contacts from company items
- `apps/web/src/components/CommandPalette.tsx` — adds `สมุดผู้ติดต่อ` entry with roles
- `apps/web/src/components/CommandPalette.test.tsx` — 2 new role-filter tests
- `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` — `#contacts` → `/contacts` redirect
- 2 test files for SettingsIndexRedirect and settings-access

### Issues Found

**Critical**: None

### Security Improvement Found (Positive)

**⚠️ On `main`, `/contacts` and `/contacts/:id` have NO `ProtectedRoute` role guard:**
```tsx
// main (before this PR)
<Route path="/contacts" element={<ContactsPage />} />
<Route path="/contacts/:id" element={<ContactDetailPage />} />
```
This means all authenticated roles — including `SALES` and `BRANCH_MANAGER` — could access the party master (contacts) page. This is a **missing access control** that this branch correctly fixes:
```tsx
// after this PR
<Route path="/contacts" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}><ContactsPage /></ProtectedRoute>} />
<Route path="/contacts/:id" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}><ContactDetailPage /></ProtectedRoute>} />
```
Intentional exclusion of `BRANCH_MANAGER` and `SALES` consistent with W5 policy and `CROSS_BRANCH_ROLES` source of truth in `branch-access.util.ts`.

**Warning**: None

**Info**:
- `FM/ACC bottomNav` contacts shortcut now points to `/contacts` (was `/settings/company` which is now OWNER-only since contacts removed).
- `FINANCE_MANAGER` settings sidebar no longer shows `/settings/company` category (correct — company-info and entities are OWNER-only; contacts is now in master-data group).

**Recommendation: APPROVE** — Merging this closes a missing route guard on `/contacts`. Do not leave this on main unfixed.

---

## Cross-Branch Summary

### Critical Issues: 0
### Warnings: 0
### Security Improvements: 1 (P6 adds missing ProtectedRoute to /contacts)

### Patterns — All Clear
| Check | P3+P4 | P5 | P6 |
|-------|-------|----|----|
| No backend changes | ✅ | ✅ | ✅ |
| No `Number()` on money fields | ✅ | ✅ | ✅ |
| No hardcoded secrets | ✅ | ✅ | ✅ |
| No raw `fetch()` calls | ✅ | ✅ | ✅ |
| No missing `queryClient.invalidateQueries()` | ✅ | ✅ | ✅ |
| Route guards correct | ✅ | ✅ | ✅ (fixes P0 on /contacts) |
| Tests included | ✅ | ✅ | ✅ |

---

## Action Required

**Merge in order — do not skip or reorder:**
1. `feat/settings-ia-redesign-p3p4` → APPROVE & merge
2. `feat/settings-sidebar-driven-nav` → APPROVE & merge
3. `feat/settings-contacts-standalone` → APPROVE & merge (priority: closes missing `/contacts` guard)

The missing route guard on `/contacts` currently on `main` (SALES + BRANCH_MANAGER can access party master) should be treated as a medium-priority security fix. Accelerate merging P6.
