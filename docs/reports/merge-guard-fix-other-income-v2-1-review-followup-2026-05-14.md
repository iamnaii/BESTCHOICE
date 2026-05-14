# Merge Guard Report — fix/other-income-v2-1-review-followup

**Date**: 2026-05-14  
**Branch**: `fix/other-income-v2-1-review-followup`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-12  
**Base**: `origin/main`

---

## File Changes Summary

5 files changed, 89 insertions(+), 31 deletions(−)

- `other-income.controller.ts` — role tightening on 6 template endpoints + `request-approval`
- `other-income.service.ts` — CAS (compare-and-swap) concurrency guard on `approve()` and `reject()`; Thai error messages
- `OtherIncomeTemplatesPage.tsx` — rename `useMutation_` → `applyTemplateMutation`
- `TemplatePickerCombobox.tsx` — rename `useMutation_` → `applyTemplateMutation`
- `maker-checker.spec.ts` — `afterEach` safety restore + new concurrent-approval regression test

---

## Issues Found

### Critical
_None found._

### Warning

**W1 — SALES role removed from template endpoints (breaking change for existing SALES users)**

Before this PR, 6 template endpoints allowed `SALES`:
```ts
// BEFORE
@Roles('OWNER', 'ACCOUNTANT', 'SALES', 'FINANCE_MANAGER')
listTemplates(...)
createTemplate(...)
saveAsTemplate(...)
updateTemplate(...)
deleteTemplate(...)
useTemplate(...)

// AFTER (in this PR)
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
```

Similarly, `request-approval` changed from `('OWNER', 'ACCOUNTANT', 'SALES')` to `('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')`.

**Impact**: Any `SALES` user who currently uses Other Income templates or submits documents for approval will receive a 403 after this lands. This appears intentional (Other Income is a FINANCE function, not a SALES function), but the business owner should explicitly confirm this access restriction before merge.

### Info

**I1 — `reject()` now returns `findOneOrFail(id)` after CAS instead of including `{ items, adjustments }`**

The old `reject()` returned the full document with `include: { items: true, adjustments: true }`. The new version does a `findOneOrFail(id)` which should return the same shape, but if `findOneOrFail` doesn't include relations, the API response shape may differ from what the frontend expects. Worth verifying the `findOneOrFail` implementation includes the same relations.

---

## Guard Checks

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ Unchanged class-level guards |
| All endpoints have `@Roles(...)` | ✅ Roles present on all modified endpoints |
| `Number()` on money/Decimal fields | ✅ None added |
| `deletedAt: null` in new queries | ✅ No new queries added |
| Hardcoded secrets / API keys | ✅ None |
| CAS atomicity of approve/reject | ✅ `updateMany` with status filter — only one wins |
| Concurrent test coverage | ✅ `Promise.allSettled([approve, approve])` regression test added |
| Thai error messages | ✅ All 3 `'Maker-Checker disabled'` strings now Thai |
| Raw `fetch()` in frontend | ✅ No changes to data fetching |

---

## Recommendation: **REVIEW**

The CAS fix for concurrent approval is correct and well-tested. The main concern is **W1** — SALES role removal is a meaningful access change that needs explicit business sign-off before merge. The technical implementation is clean.

Action required: Confirm with owner/finance manager that SALES users should no longer be able to access Other Income templates or submit documents for approval.
