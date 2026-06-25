# Merge Guard Report — chore/doc-config-single-source

**Date**: 2026-06-25  
**Branch**: `chore/doc-config-single-source`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commit**: `5154ee90 refactor(menu): remove ตั้งค่าเอกสาร from fin zone — single source in settings`

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/config/menu.ts` | -53 / +4 lines: removes `owner-doc-config` and `acc-doc-config` menu sections |
| `apps/web/src/config/menu.test.ts` | -6 / +6 lines: updates test assertions to match new menu shape |

**Total**: 2 files changed, 9 insertions, 53 deletions — net 44 lines removed. Frontend config only.

---

## Issues by Severity

### Critical
_None found._

### Warning
_None found._

### Info

- **Previously broken UX fixed**: `acc-doc-config` section gave ACCOUNTANT a menu link to `/settings/document-config` — a page enforced as OWNER-only. ACC users clicking it would see "ไม่มีสิทธิ์เข้าถึง". The old comment in the source acknowledged this (`security is enforced page-side`). Removing the dead link is strictly better UX and cleaner security posture.

- **Large removal (53 lines)**: The `owner-doc-config` section had 8 sub-items with nested children (deposit_receipt, receipt, credit_note, purchase_order, expense_doc, credit_note_received, payment_summary, asset_purchase). These were duplicating the tabs that already exist on `/settings/document-config` within the settings panel. Single source now lives at `settings › บัญชี & ภาษี › เลขที่/รูปแบบเอกสาร`.

---

## Analysis

Both removals are net-positive:

1. **owner-doc-config** (fin zone) → removed because the settings registry already surfaces this page as a first-class item. Duplicate navigation in the fin zone sidebar created maintenance burden (any new doc tab required two updates).

2. **acc-doc-config** (fin zone, ACCOUNTANT) → removed because the page itself is OWNER-only. ACCOUNTANT was seeing a visible menu item that immediately 403'd. Removing eliminates a confusing dead end.

Test assertions updated correctly: `toContain` → `not.toContain` for the removed keys. No new test gap introduced.

No backend, auth guard, or API code changed. No security surface affected.

---

## Recommendation: ✅ APPROVE

Safe to merge. Removes duplicate + broken menu entries; tightens UX for both OWNER and ACCOUNTANT roles. Test suite updated to match.
