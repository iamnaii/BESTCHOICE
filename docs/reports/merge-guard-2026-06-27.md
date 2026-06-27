# Pre-Merge Guard Report — 2026-06-27

**Run date**: 2026-06-27  
**Branches reviewed**: 3 (of 467 unmerged — top 3 by recency/significance not yet reviewed)  
**Author**: iamnaii  
**Scope**: Frontend-only (apps/web) — no backend API changes in any branch

---

## Branch 1: feat/settings-ia-redesign-p3p4

**Last commit**: 2026-06-24  
**Changes**: 16 files, 492 insertions / 251 deletions  
**Files**: App.tsx, CommandPalette.tsx (+test), menu.ts (+test), CategoryPage.tsx (+test), AccountRolesPage.tsx, InterestConfigPage.tsx, PeakExportPage.tsx, PettyCashCustodianCard.tsx, ReverseConfirmDialog.tsx, SystemSettings.tsx (deleted), CLAUDE.md, accounting.md

### Summary
Settings IA Phase 3-4 cleanup:
- **CommandPalette** now indexes `settingsRegistry` items with role-based filtering — settings are searchable via Ctrl+K
- **Sidebar collapse**: AI section removed from gear-zone sidebar; all settings reachable only through the settings panel
- **Dead code removal**: `SystemSettings.tsx` (192 lines) deleted
- **Stale route cleaned**: `/settings/document-config` placeholder route removed
- **URL updates**: All internal `#vat`, `#periods`, `/settings#peak-mapping` links updated to canonical `/settings/<cat>#<id>` form
- **Rules-of-hooks fix**: `useEffect` in `CategoryPage` moved above early return (correct)
- Good test coverage: CommandPalette integration tests (8 cases), menu.test.ts expansion

### Issues Found

#### Critical
_None_

#### Warning
_None_

#### Info
- `CategoryPage.tsx:40` — `scrollIntoView` in `useEffect` runs synchronously without `requestAnimationFrame` deferral; comment says "defer to next frame" but code doesn't. Benign (guards `if (el)`) but scroll-to-hash may occasionally miss if DOM isn't painted yet. Low risk, existing behavior.

### Recommendation: **APPROVE** ✅

---

## Branch 2: feat/settings-contacts-standalone

**Last commit**: 2026-06-24  
**Changes**: 11 files, 263 insertions / 62 deletions  
**Files**: App.tsx, CommandPalette.tsx (+test), settings-registry.tsx, menu.ts (+test), settings-access.test.ts, settings-registry.test.ts, SettingsIndexRedirect.tsx (+test)

### Summary
"สมุดผู้ติดต่อ" (Contacts) promoted from an inline settings tab to a standalone page:
- `/contacts` route now wrapped with `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` — **security improvement** (was previously unprotected at the frontend layer)
- Old `#contacts` hash in `/settings` now redirects to `/contacts` via `SettingsIndexRedirect`
- `contacts` entry removed from the `company` category in `settingsRegistry`
- A dedicated `master-data` section added to the gear-zone sidebar for all roles (OWNER/FM/ACC), linking to `/contacts`
- CommandPalette entry added for "สมุดผู้ติดต่อ" with role filter `['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']`
- Backend `ContactsController` has independent `@UseGuards(JwtAuthGuard, RolesGuard)` — unaffected

### Issues Found

#### Critical
_None_

#### Warning
- **Role mismatch (info-level, not a security issue)**: Backend `ContactsController.list()` and `findOne()` allow `BRANCH_MANAGER` and `SALES` roles, but the new frontend `ProtectedRoute` only grants `OWNER`, `FINANCE_MANAGER`, `ACCOUNTANT`. BM/SALES can call the API directly but cannot reach the page via normal navigation. Backend is the authoritative security boundary so this is not a vulnerability, but SALES/BM who previously had UI access lose it. Confirm intentional with business owner.

#### Info
_None_

### Recommendation: **APPROVE** ✅ (confirm BM/SALES contacts access intent with owner)

---

## Branch 3: feat/users-page-consolidation

**Last commit**: 2026-06-23  
**Changes**: 10 files, 661 insertions / 66 deletions  
**Files**: SettingsPage/index.tsx, InternalControlTab.tsx, UsersTab.tsx (deleted), SettingsPage.test.tsx, InternalControlTab.test.tsx (new), settings-tabs.spec.ts, PettyCashCustodianCard.tsx, ReverseConfirmDialog.tsx (comment update), and docs

### Summary
"ผู้ใช้งาน" tab in SettingsPage consolidated into "ระบบควบคุม & สิทธิ์" (`internal-control`):
- `UsersTab.tsx` (48 lines) deleted
- 4 cards (MakerCheckerToggle, ReversePermissionCard, PettyCashCustodianCard, TestModeToggle) moved into `InternalControlTab` with logical groupings: **การอนุมัติ & สิทธิ์ / เงินสด / ความปลอดภัย**
- Old `#users` hash aliased to `internal-control` via `TAB_ALIASES` — backward-compatible for bookmarks/links
- E2E test updated (`TAB_IDS` array)
- New unit test for `InternalControlTab` (layout + 5 cards + 3 groups)
- SettingsPage test extended with FM alias fallback case

### Issues Found

#### Critical
_None_

#### Warning
_None_

#### Info
- `SettingsPage/index.tsx:78` — `resolveHash()` resolves alias but `setActiveTab` still compares against `visibleIds`. If an alias target (`internal-control`) is not in `visibleIds` for the current user (it's always OWNER-only, so fine for now), it silently falls back to the first visible tab. Correct behavior, no bug.

### Recommendation: **APPROVE** ✅

---

## Summary Table

| Branch | Files | Insertions | Deletions | Critical | Warning | Info | Decision |
|--------|-------|-----------|----------|----------|---------|------|----------|
| feat/settings-ia-redesign-p3p4 | 16 | 492 | 251 | 0 | 0 | 1 | **APPROVE** |
| feat/settings-contacts-standalone | 11 | 263 | 62 | 0 | 1* | 0 | **APPROVE** |
| feat/users-page-consolidation | 10 | 661 | 66 | 0 | 0 | 1 | **APPROVE** |

*Warning = not a security issue; business-intent clarification needed re: BM/SALES contacts access.

## Overall: 0 blockers across 3 branches — safe to merge after owner confirms BM/SALES contacts intent.
