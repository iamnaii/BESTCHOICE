# Pre-Merge Guard Report

**Branch**: `fix/other-income-v2-1-review-followup`
**Author**: Akenarin Kongdach
**Date**: 2026-05-14
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

5 files changed, 89 insertions(+), 31 deletions(-)

### Key areas touched
- `apps/api/src/modules/other-income/other-income.controller.ts` — role corrections on template + approval endpoints
- `apps/api/src/modules/other-income/other-income.service.ts` — CAS guards on `approve()` and `reject()`, Thai error messages
- `apps/api/src/modules/other-income/__tests__/maker-checker.spec.ts` — `afterEach` cleanup, concurrent CAS test
- `apps/web/src/pages/other-income/OtherIncomeTemplatesPage.tsx` — rename `useMutation_` → `applyTemplateMutation`
- `apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx` — same rename

---

## Issues Found

### Critical (0)

None.

### Warning (0)

None.

### Info (3)

**I-1 — SALES role removed from template and approval endpoints**

Previously, 6 endpoints (`GET/POST/PATCH/DELETE templates`, `POST templates/:id/use`, `POST :id/request-approval`) included `SALES` in `@Roles(...)`. This fix removes SALES from all of them, leaving `OWNER, FINANCE_MANAGER, ACCOUNTANT`. This is a **security improvement** (SALES staff should not manage accounting income templates or approve financial documents). However, if any SALES user was actively using the templates feature, they will get 403s after this ships. Since `other-income` is a FINANCE-only module, this is intentional and correct.

**I-2 — CAS race condition in `approve()` is now properly guarded**

The service now uses `updateMany({ where: { id, status: READY } })` — if `count === 0`, a `ConflictException` is thrown with a Thai message. The new concurrent test (`Promise.allSettled` calling `approve()` twice simultaneously) proves exactly one succeeds and one throws, with the loser matching `/ผู้อื่น|สถานะ/`.

**I-3 — `reject()` also gets CAS guard**

Previously `reject()` used a plain `update()` which could silently no-op if the doc was already approved. Now uses `updateMany` with `status: READY` filter + `ConflictException` on miss.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New/modified controllers have JwtAuthGuard | ✅ Class-level guard unchanged |
| @Roles tightened (SALES removed) | ✅ Improvement |
| Number() on money fields | ✅ None found |
| Missing deletedAt: null | ✅ No new queries added |
| Hardcoded secrets | ✅ None |
| Raw fetch() in frontend | ✅ None |

---

## Recommendation

**APPROVE** — Clean fix. CAS guards prevent double-approval/double-rejection race conditions. Role tightening is correct for accounting module access control. All error messages are now in Thai per conventions.
