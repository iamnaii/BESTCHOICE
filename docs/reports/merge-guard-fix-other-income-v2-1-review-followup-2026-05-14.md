# Merge Guard Report — fix/other-income-v2-1-review-followup

**Date**: 2026-05-14  
**Branch**: `fix/other-income-v2-1-review-followup`  
**Author**: Akenarin Kongdach  
**Last Commit**: 2026-05-12 15:27 +07:00  
**Commits Ahead of main**: 24  

---

## File Changes Summary

| Metric | Value |
|--------|-------|
| Files changed | 5 |
| Insertions | +89 |
| Deletions | -31 |

**Key areas touched**:
- `other-income.controller.ts` — added `@Roles` decorators to 7 existing endpoints that were missing them
- `other-income.service.ts` — `approve()` and `reject()` methods upgraded with CAS locking pattern
- `maker-checker.spec.ts` — extended with concurrent approval scenarios
- `OtherIncomeTemplatesPage.tsx` / `TemplatePickerCombobox.tsx` — minor frontend fixes

---

## Issues Found

### Critical

None found.

### Warning

None found.

### Info

None found.

---

## Positive Observations

- **Security fix**: Added `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` to 7 controller methods that previously lacked the decorator. These methods were accessible to any authenticated user — this is now correctly restricted.
- **CAS race protection**: `approve()` uses `updateMany({ where: { id, status: READY } })` inside `$transaction`. If two OWNER users attempt to approve simultaneously, only one succeeds; the second gets a `ConflictException` with a Thai message. `reject()` follows the same pattern.
- **No Number() on money fields**.
- **No raw SQL**.
- **No new unguarded endpoints**.
- **Small focused change** (89 insertions / 31 deletions across 5 files) — easy to review.

---

## Recommendation

**APPROVE** — This is a straightforward security hardening and race-condition fix. The CAS pattern is correct, all endpoints now have proper role guards, and the change is well-scoped. No concerns.
