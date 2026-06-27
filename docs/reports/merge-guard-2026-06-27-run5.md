# Merge Guard Report — 2026-06-27 Run 5

**Generated**: 2026-06-27 (automated guard run)
**Reviewer**: Pre-Merge Guard Agent
**Branches reviewed**: 3 (most recently active non-guard non-worktree branches)

---

## Branch 1: `feat/settings-sidebar-driven-nav`

**Author**: iamnaii | **Commits**: 5 | **Date**: 2026-06-24

### File Changes Summary
- `apps/web/src/config/menu.ts` — adds `buildSettingsZoneSections()`, replaces static settings zone sections with registry-driven nav; updates `resolveZoneForPath` to recognize `/settings/*` paths
- `apps/web/src/pages/settings/SettingsLayout.tsx` — removes desktop left sub-nav (sidebar now drives category selection); removes unused `Link`, `visibleItems` imports
- `apps/web/src/pages/settings/CategoryPage.tsx` — adds category heading `<h2>`, fixes composite group key bug
- `apps/web/src/config/menu.test.ts` + 7 test files — all updated to reflect P5 navigation changes

**Backend changes**: None

### Issues Found

#### Critical
_None_

#### Warning
_None_

#### Info
- `CategoryPage.tsx`: The group key was `key={g.name ?? gi}` — multiple unnamed groups got key `"0"`, `"1"`, etc., but when `g.name` was `null` for all groups the key collided as `""`. Fixed to `key={\`${g.name ?? ''}-${gi}\`}` which is correct. ✓
- `resolveZoneForPath`: Now short-circuits to `'settings'` for any `/settings` or `/settings/*` path if the role has `showSettingsGear`. This means even unknown/future settings routes resolve correctly to the settings zone. Good defensive pattern.
- Static sidebar sections for settings zone (`owner-settings`, `owner-settings-extra`, `owner-fin-master`, `fm-fin-master`, `acc-fin-master`) are fully removed and replaced by the registry-driven `buildSettingsZoneSections()`. Test suite updated to match — all 8 expected categories present.

### Recommendation: ✅ APPROVE

Clean architectural refactor. All changes are frontend-only navigation config. Bug fix (duplicate key) is correct. Test coverage is thorough — tests were rewritten to verify P5 behavior, not just updated.

---

## Branch 2: `feat/settings-contacts-standalone`

**Author**: iamnaii | **Commits**: 4 | **Date**: 2026-06-24
**Built on top of**: `feat/settings-sidebar-driven-nav` (P6 built on P5)

### File Changes Summary
- `apps/web/src/App.tsx` — adds `ProtectedRoute roles=['OWNER','FINANCE_MANAGER','ACCOUNTANT']` to `/contacts` and `/contacts/:id`
- `apps/web/src/config/settings-registry.tsx` — removes `contacts` item from `company` category; removes `ContactsTab` import
- `apps/web/src/config/menu.ts` — `buildSettingsZoneSections()` now prepends a `master-data` group with `/contacts` before the registry categories
- `apps/web/src/config/menu.test.ts` — updated for P6 two-section layout
- `apps/web/src/config/__tests__/settings-access.test.ts` — `FINANCE_MANAGER` no longer sees `company` category (contacts removed → company is OWNER-only)
- `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` — `#contacts` hash now redirects directly to `/contacts`; removed from `HASH_TO_CATEGORY` map
- `apps/web/src/components/CommandPalette.tsx` + test — adds `สมุดผู้ติดต่อ` entry with roles `['OWNER','FINANCE_MANAGER','ACCOUNTANT']`

**Backend changes**: None

### Issues Found

#### Critical
_None_

#### Warning
- **Potential merge conflict on `App.tsx`**: The branch adds `ProtectedRoute` to `/contacts` routes, but `origin/main` has already independently merged the same change. The merge-base commit (`acf666b0`) shows `/contacts` was unguarded; both main and this branch add identical `ProtectedRoute` wrappers. Git may auto-resolve cleanly (same diff applied twice), but worth verifying after rebase. **Verify with `git diff origin/main...HEAD -- apps/web/src/App.tsx` after rebasing onto main**.

#### Info
- `FINANCE_MANAGER` and `ACCOUNTANT` no longer see `/settings/company` in the settings sidebar. Previously these roles saw the company category (for contacts). After this change, contacts is surfaced via the `master-data` group → `/contacts` standalone. The settings `company` category becomes effectively OWNER-only (its remaining items — `company-info`, `entities`, `branches` — are all `roles: ['OWNER']`). This is consistent with the test update in `settings-access.test.ts` that changes `firstVisibleCategoryId('FINANCE_MANAGER')` from `'company'` to `'accounting'`.
- `BRANCH_MANAGER` and `SALES` roles: the standalone `/contacts` ProtectedRoute explicitly excludes them. This was also the case before this branch (the unguarded route still required auth context for ContactsPage). Confirm with owner whether BM/SALES ever needed contacts access.

### Recommendation: 🔍 REVIEW

Functionally clean — no security holes, no money issues, no missing guards. The **App.tsx potential conflict** warrants a quick rebase check before merging. Branch should rebase onto the current `main` (which already has the ProtectedRoute) so App.tsx resolves cleanly.

**Action**: Author should `git rebase origin/main` and verify `apps/web/src/App.tsx` has no conflict. If clean, promote to APPROVE.

---

## Branch 3: `chore/owner-mobile-settings-bar`

**Author**: iamnaii | **Commits**: 1 | **Date**: 2026-06-24

### File Changes Summary
- `apps/web/src/config/menu.ts` — replaces OWNER mobile `settings` bottomNav (was: `/users`, `/settings/company/entities`, `/branches`, `/settings`) with FM/ACC-aligned pattern (`/contacts`, `#more`)
- Removes unused `UserCog` import
- `apps/web/src/config/menu.test.ts` — adds test asserting old paths removed + `/contacts` present

**Backend changes**: None

### Issues Found

#### Critical
_None_

#### Warning
_None_

#### Info
- OWNER mobile settings bottom-bar previously had 4 items (`/users`, `/settings/company/entities`, `/branches`, `/settings`) that duplicated what's inside the settings drawer. This deduplication aligns OWNER with FM/ACC pattern (contacts shortcut + เพิ่มเติม → drawer). The operational pages (`/users`, `/branches`) are still reachable via the drawer sidebar.
- `UserCog` import removed cleanly — no other usages in menu.ts.

### Recommendation: ✅ APPROVE

Single-commit cleanup, well-tested, no issues.

---

## Summary

| Branch | Commits | Files Changed | Critical | Warning | Info | Verdict |
|--------|---------|--------------|----------|---------|------|---------|
| `feat/settings-sidebar-driven-nav` | 5 | 12 | 0 | 0 | 2 | ✅ APPROVE |
| `feat/settings-contacts-standalone` | 4 | 10 | 0 | 1 | 2 | 🔍 REVIEW |
| `chore/owner-mobile-settings-bar` | 1 | 2 | 0 | 0 | 1 | ✅ APPROVE |

**No critical issues found across any branch.** All changes are frontend-only navigation refactoring — no backend controllers, no money fields, no queries, no guards to check. Code quality is high: tests updated to match behavior, no hardcoded colors or raw fetch() calls.

**Top recommendation**: Rebase `feat/settings-contacts-standalone` onto current `main` before merge to resolve the App.tsx line that was independently changed on both sides.
