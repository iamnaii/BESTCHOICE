# Merge Guard Report — Config Cleanup Stack (2026-06-28 run 2)

**Run date**: 2026-06-28  
**Branches reviewed**: 3  
**Reviewer**: Pre-Merge Guard (automated)

---

## Summary

| Branch | Author | Changed Files | Recommendation |
|--------|--------|--------------|----------------|
| `chore/local-config-sync` | iamnaii | `.vscode/settings.json`, `package-lock.json` | ✅ APPROVE |
| `chore/owner-mobile-settings-bar` | iamnaii | `menu.ts`, `menu.test.ts` | ✅ APPROVE |
| `chore/doc-config-single-source` | iamnaii | `menu.ts`, `menu.test.ts` | ✅ APPROVE |

No critical issues found across all three branches.

---

## Branch 1: `chore/local-config-sync`

**Commit**: `chore: pin Prisma VSCode extension to v6 + sync package-lock`  
**Files changed**: 2 (+2 / -26 lines)

### Changes
- `.vscode/settings.json` — adds `"prisma.pinToPrisma6": true` (prevents VSCode Prisma extension from auto-upgrading to v7, which breaks schema formatting with Prisma 6 projects)
- `package-lock.json` — removes `"peer": true` from 25 entries (cosmetic npm lockfile regeneration, no version changes)

### Issues Found
- Critical: none
- Warning: none
- Info: none

### Recommendation: ✅ APPROVE

---

## Branch 2: `chore/owner-mobile-settings-bar`

**Commit**: `refactor(menu): dedupe OWNER mobile settings bottom-bar (align with FM/ACC)`  
**Files changed**: 2 (+14 / -5 lines)

### Changes
- `menu.ts` — replaces 4 duplicate mobile bottom-bar shortcuts for OWNER settings zone (ผู้ใช้/บริษัท/สาขา/ตั้งค่า) with 2 items: `/contacts` + เพิ่มเติม. This aligns OWNER with the FM/ACC pattern where full settings access is via the drawer, not duplicated in the bottom bar.
- `menu.test.ts` — adds test asserting the 4 removed paths are no longer in OWNER `bottomNav.settings` and `/contacts` is present.

### Security Check
- No new controllers → guard check N/A
- No money fields → `Decimal` check N/A
- No backend changes → `deletedAt` check N/A
- No API calls → raw `fetch()` check N/A
- No mutations → `invalidateQueries` check N/A

### Issues Found
- Critical: none
- Warning: none
- Info: `menu.ts` is 953 lines (pre-existing — same size as main; not introduced by this PR)

### Recommendation: ✅ APPROVE

---

## Branch 3: `chore/doc-config-single-source`

**Commit**: `refactor(menu): remove ตั้งค่าเอกสาร from fin zone — single source in settings`  
**Files changed**: 2 (+9 / -53 lines)

### Changes
- `menu.ts` — removes `owner-doc-config` section from OWNER fin-zone (33-line block with nested document-type children that duplicated `/settings/document-config`). Removes `acc-doc-config` section from ACCOUNTANT fin-zone (the page itself already enforced OWNER-only via `ProtectedRoute`, so ACCs landed on a 403 view). Both are now single-sourced in settings.
- `menu.test.ts` — updates 2 tests: `owner-doc-config` now asserted absent (was present), `acc-doc-config` now asserted absent (was present).

### Security Check
- No new controllers, no backend changes, no money fields, no API calls.
- The removal of the ACC `doc-config` link is a security improvement: ACC users no longer see a menu item they couldn't access, reducing confusion. Page-level guard remains unchanged.

### Issues Found
- Critical: none
- Warning: none
- Info: `menu.ts` is 954 lines (pre-existing — main is already 953 lines; this branch is net -44 lines on main, not an increase)

### Recommendation: ✅ APPROVE

---

## Notes for Reviewer

These three branches form part of the settings navigation cleanup series (P6). Today's earlier guard run already approved the first three branches in the stack (`settings-contacts-standalone`, `contacts-into-settings-submenu`, `integrations-own-category`). This run covers the next three layers of the same stack.

Merge order recommendation (dependencies flow bottom-up):
1. `chore/doc-config-single-source` (removes stale fin-zone duplication)
2. `chore/owner-mobile-settings-bar` (aligns OWNER mobile nav)
3. `chore/local-config-sync` (tooling only, can merge any time)
