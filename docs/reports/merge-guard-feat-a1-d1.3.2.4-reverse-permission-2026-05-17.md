# Merge Guard Report — feat/a1-d1.3.2.4-reverse-permission

**Date:** 2026-05-17  
**Branch:** `feat/a1-d1.3.2.4-reverse-permission`  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/api/src/modules/expense-documents/reverse-permission.guard.ts` | New | +61 |
| `apps/api/src/modules/expense-documents/__tests__/reverse-permission.guard.spec.ts` | New | +65 |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | Modified | +11 |
| `apps/api/src/modules/expense-documents/expense-documents.module.ts` | Modified | +2 |
| `apps/api/src/modules/settings/settings.service.ts` | Modified | +13 |
| `apps/web/src/hooks/useUiFlags.ts` | Modified | +3 |

**Total:** 6 files changed, 153 insertions(+)

---

## Issues Found

### Critical — 0 issues

None.

### Warning — 0 issues

None.

### Info

- The `DEFAULT_VALUE = 'OWNER+FINANCE_MANAGER'` constant contains a `+` character. This is used as both a DB key value and a `ROLE_SETS` map key. The whitelist approach makes this safe (only `'OWNER+FINANCE_MANAGER'` and `'OWNER_ONLY'` are accepted), but a future developer scanning SystemConfig rows might find the value with `+` unusual. Minor readability note only.
- `ReversePermissionGuard` is layered on top of the existing `@Roles('OWNER', 'FINANCE_MANAGER')` static decorator. The static `@Roles` forms the superset; the guard can only narrow it. This layering pattern is consistent with `PostPermissionGuard` (D1.3.2.3). ✅

---

## Detailed Findings

### Security
- Controller class: `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` ✅  
  `void` endpoint additionally: `@UseGuards(ReversePermissionGuard)` ✅
- `@Roles('OWNER', 'FINANCE_MANAGER')` remains on the `void` method — guard can only narrow, never widen ✅
- `getAllowedRoles()` queries SystemConfig with `where: { key: 'reverse_permission', deletedAt: null }` — soft-delete filter present ✅
- No hardcoded secrets ✅
- No money/financial fields ✅
- No raw SQL ✅
- Thai error messages: `'ไม่พบข้อมูลผู้ใช้'`, `'ไม่มีสิทธิ์กลับรายการเอกสาร'` ✅

### Architecture
- Fallback to `DEFAULT_VALUE` on DB error and on unknown/malformed SystemConfig values ✅
- `ROLE_SETS` uses `ReadonlySet<string>` — immutable, no mutation risk ✅
- `ReversePermissionGuard` registered as provider in `ExpenseDocumentsModule` ✅
- `UiFlags.reversePermission` exposed to frontend for conditional button visibility ✅

### Tests
- 4 unit tests covering: default (missing row), `OWNER_ONLY` mode, malformed value fallback, and DB error fallback ✅
- Tests verify both allowed and denied role paths ✅

---

## Recommendation: APPROVE

Clean dynamic-guard implementation. No security issues, no missing guards, no missing deletedAt filters, no money field mistakes. Consistent with the established `PostPermissionGuard` pattern. Safe to merge.
