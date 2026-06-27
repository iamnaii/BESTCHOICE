# Merge Guard Report — feat/contacts-into-settings-submenu

**Date:** 2026-06-27
**Branch:** `feat/contacts-into-settings-submenu`
**Author:** iamnaii <akenarin.ak@gmail.com>
**Commits:** 1

## File Changes Summary

9 files changed, 68 insertions(+), 71 deletions(-)

| File | Change |
|------|--------|
| `apps/web/src/config/menu.ts` | Remove separate `master-data` section; inline `/contacts` as first item inside the `settings` section in `buildSettingsZoneSections()` |
| `apps/web/src/config/menu.test.ts` | Update 10+ tests: `['master-data','settings']` → `['settings']`, assert `/contacts` is `paths[0]` |
| `apps/web/src/components/CommandPalette.tsx` | Rename label `'สมุดผู้ติดต่อ'` → `'รายชื่อผู้ติดต่อ'`; add old term to `keywords` for backward search |
| `apps/web/src/components/CommandPalette.test.tsx` | Update 3 test strings to match new label |
| `apps/web/src/components/contacts/ContactCombobox.tsx` | Rename `CommandGroup heading` `'สมุดผู้ติดต่อ'` → `'รายชื่อผู้ติดต่อ'` |
| `apps/web/src/components/trade-in/QuickBuyModal.tsx` | Update toast error message to use new term |
| `apps/web/src/pages/ContactsPage.tsx` | Update document title |
| `apps/web/src/pages/SettingsPage/tabs/ContactsTab.tsx` | Update `<h1>` heading |

## Issues

### Critical
_None_

### Warning
_None_

### Info

**[INFO-1] Term rename: สมุดผู้ติดต่อ → รายชื่อผู้ติดต่อ**

A cosmetic rename of the contacts feature label across all user-facing strings. The old Thai term is retained in CommandPalette `keywords` so users searching the old term still find the page. All affected files were updated consistently.

**[INFO-2] Navigation consolidation: one section instead of two**
`apps/web/src/config/menu.ts`

The `buildSettingsZoneSections()` function now returns a single `[settings]` section (containing `/contacts` as the first item, followed by registry categories) instead of `[master-data, settings]`. The `master-data` section object has been deleted. This simplifies the sidebar structure with no functional loss — `/contacts` is still the first visible item in the gear zone.

## Security Check

| Check | Result |
|-------|--------|
| Missing `@UseGuards` on new controllers | N/A — frontend only |
| `Number()` on money fields | None found |
| Missing `deletedAt: null` in queries | N/A — no DB queries |
| Hardcoded secrets | None |
| Missing `@Roles()` | N/A — frontend only |
| Raw `fetch()` instead of `api.*` | None found |
| Missing `queryClient.invalidateQueries()` | N/A — no mutations |
| TypeScript `any` | None found |

## Recommendation

**APPROVE**

Straightforward label rename + navigation consolidation. Tests updated. Old term preserved in search keywords. No security, money precision, or data integrity concerns.
