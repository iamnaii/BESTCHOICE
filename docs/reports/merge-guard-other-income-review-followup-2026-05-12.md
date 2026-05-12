# Pre-Merge Guard Report

**Branch:** `fix/other-income-v2-1-review-followup`
**Author:** Akenarin Kongdach
**Date:** 2026-05-12
**Reviewer:** Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/src/modules/other-income/__tests__/maker-checker.spec.ts` | +58 | -3 | Test hardening + new concurrency test |
| `apps/api/src/modules/other-income/other-income.controller.ts` | +6 | -6 | Role tightening on 6 template endpoints + approval |
| `apps/api/src/modules/other-income/other-income.service.ts` | +47 | -21 | CAS guard on approve/reject, Thai error messages |
| `apps/web/src/pages/other-income/OtherIncomeTemplatesPage.tsx` | +1 | -1 | Rename `useMutation_` → `applyTemplateMutation` |
| `apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx` | +1 | -1 | Same rename |

**Total:** 5 files, +113 / -32

---

## Issues Found

### Critical
None.

### Warning
None.

### Info

**[I-1] Role change: SALES removed from template + approval operations**
- `GET/POST/PATCH/DELETE /other-income/templates` — SALES was removed from allowed roles
- `POST /other-income/:id/request-approval` — SALES removed, `FINANCE_MANAGER` added
- This is intentional (financial document templates are accounting-only, not sales ops). Verify with business owner that no SALES workflow currently relies on template management.

**[I-2] Positional rename only (`useMutation_` → `applyTemplateMutation`)**
- `OtherIncomeTemplatesPage.tsx` and `TemplatePickerCombobox.tsx`
- Pure rename, no logic change. Improves readability.

---

## Notable Quality Improvements

- **CAS (Compare-And-Swap) on `approve()`**: `updateMany({ where: { id, status: READY } })` atomically gates concurrent approvals. If two OWNERs hit the endpoint simultaneously, only one wins — the loser gets `ConflictException`. Correct use of optimistic locking without explicit DB-level locks.
- **CAS on `reject()`**: Same pattern applied consistently.
- **`afterEach` safety net in test**: Restores `OTHER_INCOME_MAKER_CHECKER_ENABLED` flag after every test. Previously a mid-test assertion failure could corrupt state for subsequent tests.
- **New concurrency regression test**: `approve() concurrent CAS-claim` verifies exactly one of two simultaneous approvals wins, with `Promise.allSettled`. Covers the TOCTOU bug that was reported in code review.
- **Thai error messages**: `'Maker-Checker disabled'` → `'Maker-Checker ปิดอยู่'`, consistent with project conventions.

---

## Recommendation

**APPROVE**

No critical or warning issues. The CAS fix is correct and the concurrency test provides solid regression coverage. Role change is tightening access (not expanding), which is the safe direction.
