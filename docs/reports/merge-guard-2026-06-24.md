# Pre-Merge Guard Report — 2026-06-24

**Agent:** Pre-Merge Guard (automated)  
**Run date:** 2026-06-24  
**Branches reviewed:** 3 most recently active unmerged feature branches  

---

## Branches Reviewed

| Branch | Author | Last commit | BEHIND main | AHEAD main |
|--------|--------|-------------|-------------|------------|
| `feat/users-page-consolidation` | iamnaii | 2026-06-23 16:05 | 9 commits | 9 commits |
| `feat/settings-ia-redesign-p2a` | iamnaii | 2026-06-23 22:40 | 2 commits | 3 commits |
| `feat/settings-ia-redesign-p2b` | iamnaii | 2026-06-23 23:53 | 1 commit | 7 commits |

---

## Summary of File Changes

### `feat/users-page-consolidation` (unique commits: 9)

Frontend-only. Consolidates the old `UsersTab` into `InternalControlTab` in the tab-based `SettingsPage`.

**Unique commits (not on main):**
- `9541a9d4` feat: remove UsersTab, alias `#users` → `internal-control`
- `bacaade5` feat: expand InternalControlTab (4 authority control cards grouped)
- `0c091481` test: pin FM `#users` alias fallback to first visible tab
- `de4d5c31` test(e2e): update settings TAB_IDS after `#users` consolidation
- `bf0f7445` docs: update `#users` references
- `927b4edb` test(e2e): drop stale '5-tab'/users wording

**Net change if merged to current main:** 79 files changed, +517 / −7020 lines  
→ **Would delete** 7020 lines from main, including `shop-finance-settlement.*`, `shop-account-resolver.*`, `contract-workflow.service.ts`, `sale-writer.service.ts`, and the entire new `settings/` architecture.

---

### `feat/settings-ia-redesign-p2a` (unique commits: 3)

Frontend-only. Adds `SettingsCategoryRoute` + `SettingsItemRoute` components; migrates the Finance settings category to the new panel.

**Unique commits (not on main):**
- `147d7549` docs: P2a plan
- `78619f4d` feat: Outlet foundation + migrate finance category to `/settings/finance/*`
- `213ff692` test: cover gfin + payment-methods redirects in finance migration

**Net change if merged to current main:** 12 files changed, +203 / −653 lines  
→ **Would delete** 5 migration test files from main (already merged as squash commit `b280aa41`).

---

### `feat/settings-ia-redesign-p2b` (unique commits: 7)

Frontend-only. Migrates 20 more config pages into the settings panel; adds 20 legacy-URL redirect routes.

**Unique commits (not on main):**
- `b3f4384a` docs: P2b plan
- `debd0d3c` feat: migrate accounting category to `/settings/accounting/*`
- `03a49915` feat: migrate comms category to `/settings/comms/*`
- `83d76c9a` feat: migrate AI category to `/settings/ai/*`
- `991f7c51` feat: migrate products category to `/settings/products/*`
- `8801a23d` feat: migrate company/access/system items
- `5761488f` test: add in-panel render test for `system/mdm` (only commit unique to branch tip)

**Net change if merged to current main:** 12 files changed, +203 / −653 lines  
→ **Would delete** 5 migration test files from main (same as P2a — all P2b work was squash-merged as `4c3ff6fe`).

---

## Issues Found

### Critical (must fix before merge)

**None found.**

No new backend controllers, no new API endpoints, no DTO changes, no money arithmetic, no direct DB queries. All changes are purely frontend routing/UI reorganisation.

Specific checks:
- `@UseGuards(JwtAuthGuard)` — no new controllers added ✅
- `Number()` on financial fields — none ✅
- `deletedAt: null` in queries — no new queries ✅
- Hardcoded secrets/API keys — none ✅
- `@Roles()` on controller methods — no new methods ✅
- SQL injection — no `$queryRaw` ✅

---

### Warning (should fix before or during merge)

**[W1] ALL THREE BRANCHES ARE STALE — merging would cause regressions**

This is the primary issue. All three branches diverged from `main` before significant work was squash-merged in. If any branch is merged as-is:

- `feat/users-page-consolidation` would **delete** `shop-finance-settlement.*` controller/service, `shop-account-resolver.service.ts`, `contract-lifecycle.service.ts` (partial), `sale-writer.service.ts`, and the entire new `apps/web/src/pages/settings/` architecture (CategoryPage, SettingsLayout, etc.). Net loss: 7020 lines.
- `feat/settings-ia-redesign-p2a` and `feat/settings-ia-redesign-p2b` would **delete** the migration test suites (`accounting-migration.test.tsx`, `ai-migration.test.tsx`, `comms-migration.test.tsx`, `company-access-system-migration.test.tsx`, `products-migration.test.tsx`) that are currently in main.

Root cause: all three branches were created during an active multi-PR sprint. The P2a/P2b/users work was squash-merged to main (`b280aa41`, `4c3ff6fe`, `2c3fa697`, `339847ae`), but the source branches were never deleted. The branches have a mix of individual granular commits (already squash-incorporated into main) plus the diverging base.

**[W2] `DunningSettingsPage.tsx:369` uses `<a href=...>` for internal navigation (pre-existing)**

Line 369 uses `<a href="/settings/comms/sms">` instead of React Router's `<Link to=...>`. This causes a full-page reload when clicking "จัดการ SMS Template". This is a **pre-existing issue** (the line existed before these branches, only the URL changed). Should be fixed separately as: replace `<a href>` → `<Button asChild><Link to=...>`.

**[W3] `SettingsItemRoute` role-gate is frontend-only**

`apps/web/src/pages/settings/SettingsItemRoute.tsx:13` checks `!found.item.roles.includes(role)` based on the registry. This provides UI-layer access control (redirects to category page for unauthorised roles). Backend API guards must be the authoritative security boundary. Verified: no new API endpoints added; the individual settings pages rely on their own existing guards. This is the correct pattern but worth documenting.

---

### Info

**[I1] Plan docs committed to feature branches**

P2a and P2b each have a `docs/superpowers/plans/` markdown plan file committed to the feature branch (`147d7549`, `b3f4384a`). These plans are not in main (they live on the branch). No code impact; consider archiving to a docs branch or `docs/superpowers/archive/`.

**[I2] `feat/users-page-consolidation` adds back `SettingsPage/index.tsx` which no longer exists in main**

The old tab-based `/settings` page (`SettingsPage/index.tsx`) was replaced by the new `settings-ia-redesign` architecture. The users-page-consolidation branch modifies the old file. If merged, this would re-introduce the old architecture into main, which now uses `settings/SettingsLayout.tsx` with the registry-driven panel. The work in the branch is conceptually correct (consolidating authority controls into InternalControlTab) but needs to be adapted to the new architecture.

**[I3] `ALL = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']` in settings-registry is correct**

The `ChartOfAccountsPage` uses `roles: ALL` in the registry. This matches the backend controller's `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')`. ✅

---

## Merge Readiness

| Branch | Recommendation | Reason |
|--------|---------------|--------|
| `feat/users-page-consolidation` | **BLOCK** | Merging deletes 7020 lines incl. backend services and the new settings/ architecture. Must be rebased and content adapted to new architecture before re-evaluation. |
| `feat/settings-ia-redesign-p2a` | **BLOCK** | Work already squash-merged into main (`b280aa41`). Merging would delete 5 test files added after the squash. Branch should be archived/deleted. |
| `feat/settings-ia-redesign-p2b` | **BLOCK** | Work already squash-merged into main (`4c3ff6fe`). Only new content: `5761488f` (one test file). If `5761488f` is worth preserving, cherry-pick it onto main directly; do not merge the full branch. |

---

## Recommended Actions

1. **Delete or archive** `feat/settings-ia-redesign-p2a` and `feat/settings-ia-redesign-p2b` — work is already in main via squash. If `5761488f` (mdm in-panel test) is wanted, cherry-pick it: `git cherry-pick 5761488f`.

2. **Rebase and port** `feat/users-page-consolidation` — the _intent_ (tab consolidation, `#users` alias) is valid and not yet in main. Rebase onto current main, adapt to the new `SettingsPage/tabs/InternalControlTab.tsx` that `settings-ia-redesign` added, then re-submit.

3. **Fix pre-existing issue [W2]** — replace `<a href="/settings/comms/sms">` with `<Link to=...>` in `DunningSettingsPage.tsx:369` as a standalone fix.

---

*Generated by Pre-Merge Guard agent on 2026-06-24. Review the linked diffs before acting on any recommendation.*
