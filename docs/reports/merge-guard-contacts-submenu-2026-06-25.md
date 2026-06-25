# Merge Guard Report — `feat/contacts-into-settings-submenu`

**Date**: 2026-06-25  
**Branch**: `feat/contacts-into-settings-submenu`  
**Author**: iamnaii  
**Commits ahead of main merge-base**: 1  
**Commits behind main (current)**: 123

---

## File Changes Summary

| File | Insertions | Deletions |
|------|-----------|----------|
| `apps/web/src/components/CommandPalette.test.tsx` | 6 | 6 |
| `apps/web/src/components/CommandPalette.tsx` | 1 | 1 |
| `apps/web/src/components/contacts/ContactCombobox.tsx` | 1 | 1 |
| `apps/web/src/components/trade-in/QuickBuyModal.tsx` | 1 | 1 |
| `apps/web/src/config/menu.test.ts` | 47 | 48 |
| `apps/web/src/config/menu.ts` | 10 | 8 |
| `apps/web/src/pages/ContactsPage.tsx` | 1 | 1 |
| `apps/web/src/pages/SettingsPage/tabs/ContactsTab.tsx` | 2 | 2 |
| **Total** | **+68** | **-71** |

**Backend changes**: None — frontend-only

---

## Issues by Severity

### Critical — NONE

No issues found:
- No new controllers without `@UseGuards`
- No `Number()` on financial fields
- No missing `deletedAt: null` in queries
- No hardcoded secrets or API keys
- No SQL injection risk

### Warning — 1 item

**W1: Branch is 123 commits behind main; content already incorporated**

This branch makes a single commit that:
1. Moves the `/contacts` item from a separate `master-data` sidebar section INTO the single `ตั้งค่าระบบ` settings submenu
2. Renames "สมุดผู้ติดต่อ" → "รายชื่อผู้ติดต่อ" across `ContactsPage`, `ContactsTab`, `CommandPalette`, `ContactCombobox`, and `QuickBuyModal`

Both changes are already present in `origin/main`. The `buildSettingsZoneSections()` in main already returns a single section with `รายชื่อผู้ติดต่อ` as the first item.

### Info — NONE

No additional observations. The single commit is clean, narrow in scope, and well-tested.

---

## Recommendation: CLOSE (STALE)

**Do not merge.** Content is already in main. The branch is 123 commits behind and would conflict. Delete as part of branch hygiene.

No blocking quality issues found in the code itself.
