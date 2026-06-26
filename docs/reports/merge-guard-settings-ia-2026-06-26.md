# Pre-Merge Guard Report — Settings IA Redesign Series
**Date**: 2026-06-26  
**Reviewer**: Pre-Merge Guard (automated)  
**Author**: iamnaii <akenarin.ak@gmail.com>

---

## Branches Reviewed

| Branch | Commits | TS Lines | Last Commit |
|--------|---------|----------|-------------|
| `feat/settings-ia-redesign` | 11 | 977 | 2026-06-23 |
| `feat/users-page-consolidation` | 9 | 296 | 2026-06-23 |
| `feat/integrations-own-category` | 1 | 224 | 2026-06-24 |

These three branches are part of a larger settings IA redesign chain (P1→P6). They are frontend-only — no backend controller or Prisma changes.

---

## Branch 1: `feat/settings-ia-redesign`

### File Changes Summary
- `apps/web/src/App.tsx` — route scope expanded from `['OWNER']` to `['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']` for `/settings` and `/settings/:categoryId`
- `apps/web/src/config/settings-registry.tsx` (new) — 127-line registry with 8 categories, per-item role filtering
- `apps/web/src/config/settings-access.ts` (new) — `visibleCategories`, `visibleItems`, `searchSettings` helpers
- `apps/web/src/pages/settings/SettingsLayout.tsx` (new) — panel layout with sub-nav + search
- `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` (new) — redirects `/settings` to first visible category
- `apps/web/src/pages/SettingsPage/index.tsx` (deleted) — old tab-based settings page removed
- `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx` (deleted) — old tests removed
- New tests: `settings-access.test.ts`, `settings-registry.test.ts`

### Issues Found

#### Warning — System Category Exposes ACCOUNTANT (will be fixed by branch 3)
**File**: `apps/web/src/config/settings-registry.tsx:289`  
In the base branch, the `system` category is declared with `roles: ['OWNER', 'ACCOUNTANT']`. This lets ACCOUNTANTs see "โหมดทดสอบ" (TestMode), PDPA, and Backup settings — items that are individually guarded as OWNER-only. The category-level role exposes ACCOUNTANT to the category page listing, though individual items won't render due to per-item role filtering.  
**Status**: Mitigated by `feat/integrations-own-category` (narrows `system` to OWNER-only). Merge order matters.

#### Warning — Old SettingsPage Tests Deleted Without Full Replacement
**File**: `SettingsPage/__tests__/SettingsPage.test.tsx` (deleted)  
The old tests covered: OWNER/FM/ACC/SALES tab visibility + hash routing + alias `#users → internal-control`. New tests in `settings-access.test.ts` cover role filtering at the data layer but do NOT cover the rendered component behavior (which hash opens which panel, fallback for unauthorized hash). This is a coverage gap.

#### Info — Test Count in Base Registry (will conflict with branch 3)
`settings-access.test.ts:50` asserts `OWNER เห็นครบ 8 หมวด`. Branch 3 changes this to 9 by adding the `integrations` category. If this branch is merged before branch 3, the test will fail when branch 3 is applied.

#### Info — `SettingsRole` Type Excludes `BRANCH_MANAGER` and `SALES`
`settings-registry.tsx:192` defines `SettingsRole = 'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT'`. This is correct per design (BM/SALES cannot access settings). The `ProtectedRoute` at route level enforces the same set. Verified consistent.

### Recommendation: **REVIEW**
Safe to merge if: (a) branch 3 is merged immediately after, (b) component-level rendering tests are added for the new `SettingsLayout`.

---

## Branch 2: `feat/users-page-consolidation`

### File Changes Summary
- `apps/web/src/pages/SettingsPage/tabs/UsersTab.tsx` (deleted, 48 lines) — removed "จัดการผู้ใช้งาน" card and link to `/users`
- `apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx` — expanded to host 5 cards (MakerChecker, ReversePermission, ReverseReasons, PettyCash, TestMode), grouped into 3 sections
- `apps/web/src/pages/SettingsPage/index.tsx` — `#users` tab removed; backward-compat alias added (`users → internal-control`)
- `apps/web/src/pages/SettingsPage/__tests__/InternalControlTab.test.tsx` (new) — 2 tests verifying 5 cards + 3 section headings render
- E2E: `settings-tabs.spec.ts` — TAB_IDS updated from `users` to `internal-control`

### Issues Found

#### Warning — Architecture Conflict With Branch 1
`feat/users-page-consolidation` modifies `SettingsPage/index.tsx` (the tab-based SettingsPage). Branch 1 (`feat/settings-ia-redesign`) **deletes** this file entirely and replaces it with a registry-driven panel. These two branches cannot both be merged to main without conflicts. If merged in order (branch 2 then branch 1), branch 1 will obliterate the users-tab changes. If merged separately, one will break the other.  
**Resolution needed**: Confirm whether branch 2 targets the OLD tab-based SettingsPage (pre-redesign) or the new registry. If pre-redesign, its changes are superseded by branch 1.

#### Warning — `/users` Page Link Removed from Settings
The `UsersTab.tsx` contained a Card with a Button linking to `/users`. After this merge, `/users` is only accessible via the top navigation menu (sidebar or mobile nav). Users who bookmarked `/settings#users` now get the `internal-control` tab with no link to user management. This reduces discoverability; consider adding a note in `InternalControlTab` pointing to `/users`.

#### Info — TestMode Grouped Under "ความปลอดภัย" (Security Section)
`TestModeToggle` is now in the "ความปลอดภัย" section alongside PDPA and backup-related items. Previously it was listed first without a group header. The new grouping is cleaner but the red heading `text-destructive` for "ความปลอดภัย" is appropriate given the risk of enabling test mode in production.

#### Info — `PettyCashCustodianCard` Comment Updated
Comment on line 31 updated from `#users` to `#internal-control`. No functional change.

### Recommendation: **REVIEW**
Resolve architecture conflict with branch 1 before merging. If this branch targets the pre-redesign SettingsPage, it may be superseded and should be closed or rebased onto branch 1's output.

---

## Branch 3: `feat/integrations-own-category`

### File Changes Summary
- `apps/web/src/config/settings-registry.tsx` — new `integrations` category added (hub + MDM); `system` narrowed from `['OWNER', 'ACCOUNTANT']` to `['OWNER']`; integrations/MDM items removed from `system`
- `apps/web/src/App.tsx` — redirect chain updated: `/settings/system/integrations → /settings/integrations/hub`, `/settings/system/mdm → /settings/integrations/mdm`, `/settings/mdm-test → /settings/integrations/mdm`; old `/settings/integrations → /settings/system/integrations` redirect removed
- Tests: `settings-access.test.ts`, `settings-registry.test.ts` — counts updated 8→9; new assertions for ACCOUNTANT seeing `integrations` but not `system`
- `company-access-system-migration.test.tsx` — redirect tests updated and expanded with 2 new test cases

### Issues Found

#### Info — Old `/settings/integrations` Path Now Goes to Category Index
Previously: `/settings/integrations` → `<Navigate to="/settings/system/integrations" />` (direct to hub)  
Now: `/settings/integrations` matches dynamic `:categoryId` → `CategoryPage('integrations')` (index listing hub + MDM links)

This is a conscious UX change (one extra click). If there are any in-app links, LINE messages, or QR codes pointing to `/settings/integrations`, they now land on the category index rather than the hub page directly. The test `company-access-system-migration.test.tsx:67-71` documents this behavior explicitly.

#### Info — ACCOUNTANT Can See `integrations/hub` 
`IntegrationHubPage` is now accessible to ACCOUNTANT at `/settings/integrations/hub`. Verify that the backend endpoints for `IntegrationHubPage` enforce OWNER-only for write operations (PUT/POST). Read-only access for ACCOUNTANT is likely acceptable (e.g., viewing which integrations are connected for reconciliation).

### Recommendation: **APPROVE**
Security improvement: `system` narrowed from OWNER+ACCOUNTANT to OWNER-only. Redirects are properly chained. Test coverage is comprehensive (5 tests updated/added). Only 1 commit, minimal blast radius.

---

## Summary

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `feat/settings-ia-redesign` | 0 | 2 | 2 | **REVIEW** |
| `feat/users-page-consolidation` | 0 | 2 | 2 | **REVIEW** |
| `feat/integrations-own-category` | 0 | 0 | 2 | **APPROVE** |

## Merge Order Recommendation

If all three are to be merged:
1. `feat/settings-ia-redesign` (foundation)
2. `feat/integrations-own-category` (fixes system role + adds integrations category)
3. `feat/users-page-consolidation` (only if rebased onto the new registry architecture)

Branch 2 (`users-page-consolidation`) targets the OLD tab-based SettingsPage that branch 1 deletes — resolve this conflict before any merge.
