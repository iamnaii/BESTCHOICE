# Pre-Merge Guard Report — 2026-06-27 (run 3)

**Run date**: 2026-06-27  
**Base branch**: `origin/main` (28cb3e86, 2026-06-27)  
**Open PRs on GitHub**: 0  
**Unmerged branches**: 468 total — reviewed top 3 by recency not yet covered by runs 1 & 2  
**Previously reviewed today**: feat/employee-master, feat/settings-sidebar-driven-nav, feat/integrations-own-category, feat/settings-ia-redesign-p3p4, feat/settings-contacts-standalone, feat/users-page-consolidation

---

## Branch 1: `chore/local-config-sync`

**Author**: iamnaii <akenarin.ak@gmail.com>  
**Latest commit**: 9c920bda — "chore: pin Prisma VSCode extension to v6 + sync package-lock"  
**Date**: 2026-06-24  
**Type**: Dev tooling — no application code changes

### Files changed
```
.vscode/settings.json   |  3 ++-
package-lock.json       | 25 -------------------------
2 files changed, 2 insertions(+), 26 deletions(-)
```

### Summary
- Adds `"prisma.pinToPrisma6": true` to `.vscode/settings.json` to prevent the Prisma VS Code extension from auto-upgrading to v7 (project uses Prisma v6)
- Fixes a missing trailing comma in the JSON (valid JSON fix)
- Removes 17 stale `"peer": true` entries from `package-lock.json` (lockfile normalization from npm install artifact)

### Issues Found

#### Critical
_None_

#### Warning
_None_

#### Info
_None_

### Recommendation: **APPROVE** ✅

---

## Branch 2: `chore/owner-mobile-settings-bar`

**Author**: iamnaii <akenarin.ak@gmail.com>  
**Latest commit**: 9b79b49c — "refactor(menu): dedupe OWNER mobile settings bottom-bar (align with FM/ACC)"  
**Date**: 2026-06-24  
**Type**: Frontend refactor — navigation deduplication

### Files changed
```
apps/web/src/config/menu.test.ts | 10 ++++++++++
apps/web/src/config/menu.ts      |  9 ++++-----
2 files changed, 14 insertions(+), 5 deletions(-)
```

### Summary
Removes 4 duplicate entries from the OWNER settings-zone mobile bottom-bar that were
redundant after the P5/P6 settings IA redesign:
- `/users` (removed — accessible via ตั้งค่าระบบ submenu → `/settings/access`)
- `/settings/company/entities` (removed — accessible via `/settings/company`)
- `/branches` (removed — accessible via `/settings/company`)
- `/settings` (bare root removed — redundant with `/contacts` + settings drawer)

Keeps `/contacts` as the only quick-access shortcut in the bottom-bar settings zone,
aligning OWNER behavior with FINANCE_MANAGER / ACCOUNTANT (who already had this simpler layout).

New test added: `OWNER bottomNav settings zone dropped config dups (aligned with FM/ACC)`.

### Issues Found

#### Critical
_None_

#### Warning
_None_

#### Info
- Navigation paths removed from the bottom-bar remain accessible via the settings panel submenu — no functionality lost. Confirm with owner that `/users` quick-access from mobile is no longer needed (it's now 2 taps: เพิ่มเติม → ตั้งค่าระบบ → access).

### Recommendation: **APPROVE** ✅

---

## Branch 3: `feat/contacts-into-settings-submenu`

**Author**: iamnaii <akenarin.ak@gmail.com>  
**Latest commit**: a327b8ee — "feat(contacts): move contacts into the ตั้งค่าระบบ submenu + rename to "รายชื่อผู้ติดต่อ""  
**Date**: 2026-06-24  
**Type**: Frontend refactor — navigation + label standardization

### Files changed
```
apps/web/src/components/CommandPalette.test.tsx    | 12 +--
apps/web/src/components/CommandPalette.tsx         |  2 +-
apps/web/src/components/contacts/ContactCombobox.tsx |  2 +-
apps/web/src/components/trade-in/QuickBuyModal.tsx |  2 +-
apps/web/src/config/menu.test.ts                   | 95 +++++++++++-----------
apps/web/src/config/menu.ts                        | 18 ++--
apps/web/src/pages/ContactsPage.tsx                |  2 +-
apps/web/src/pages/SettingsPage/tabs/ContactsTab.tsx |  4 +-
.claude/rules/accounting.md                        |  2 +-
9 files changed, 68 insertions(+), 71 deletions(-)
```

### Summary
Two changes in one commit:

**1. Label standardization**: Renames "สมุดผู้ติดต่อ" → "รายชื่อผู้ติดต่อ" consistently across:
   - `menu.ts` (CommandPalette entry + keywords — old label kept as keyword for backward search compat)
   - `CommandPalette.tsx` group heading
   - `ContactsPage.tsx` page title
   - `ContactsTab.tsx` card header
   - `QuickBuyModal.tsx` error toast message

**2. Navigation restructure**: Collapses the separate "master-data" sidebar section (P6) that held
   only `/contacts` back into the single "settings" section with `/contacts` as the first item.
   Net result: one fewer section in the gear-zone drawer, contacts still prominent (first item).

All `menu.test.ts` tests updated to reflect the new single-section structure. Tests verify:
- `/contacts` is still the first path in the settings section
- All `/settings/<cat>` paths remain present
- No `/users`, `/branches`, or bare `/settings` root in the list

### Issues Found

#### Critical
_None_

#### Warning
_None_

#### Info
- `menu.test.ts` line count unchanged (95 lines modified but same total) — good sign that tests were refactored, not just deleted.
- `accounting.md` change appears to be a routine docs update (changing a link format from P6 era). Low risk.

### Recommendation: **APPROVE** ✅

---

## Summary Table

| Branch | Files | Insertions | Deletions | Critical | Warning | Info | Decision |
|--------|-------|-----------|----------|----------|---------|------|----------|
| chore/local-config-sync | 2 | 2 | 26 | 0 | 0 | 0 | **APPROVE** |
| chore/owner-mobile-settings-bar | 2 | 14 | 5 | 0 | 0 | 1 | **APPROVE** |
| feat/contacts-into-settings-submenu | 9 | 68 | 71 | 0 | 0 | 1 | **APPROVE** |

## Overall: 0 blockers — all 3 branches safe to merge

**Note**: All 3 are frontend-only (no backend/Prisma changes). No money arithmetic, no controller
guard changes, no new fetch() calls. The settings IA redesign series (feat/settings-ia-redesign,
users-page-consolidation, contacts-standalone, contacts-into-submenu, owner-mobile-settings-bar)
represents a coherent multi-step frontend refactor that is consistently clean across all branches.
