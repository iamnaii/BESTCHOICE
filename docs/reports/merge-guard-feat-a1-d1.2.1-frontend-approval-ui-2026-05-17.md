# Merge Guard Report — feat/a1-d1.2.1-frontend-approval-ui

**Date:** 2026-05-17  
**Branch:** `feat/a1-d1.2.1-frontend-approval-ui`  
**Author:** Akenarin Kongdach  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/web/src/hooks/useApprovalActions.ts` | New — approval mutations + helper fns | +123 |
| `apps/web/src/hooks/__tests__/useApprovalActions.test.tsx` | New — 195-line test suite | +195 |
| `apps/web/src/hooks/useUiFlags.ts` | Add `approvalThreshold`, `approversList`, `approvalRequiredDocTypes`, `settingsAccessRole` | +30 |
| `apps/web/src/pages/ExpensesPage.tsx` | Add PENDING_APPROVAL/APPROVED status handling + approval action buttons | +123/-15 |
| `apps/api/src/modules/settings/settings.service.ts` | Expose `approvalThreshold`, `approversList`, `approvalRequiredDocTypes` | +35 |

6 files changed, 505 insertions(+), 15 deletions(-)

---

## Issues Found

### Critical — 0 issues

All critical security checks pass:
- `useApprovalActions.ts` uses `api.post()` from `@/lib/api` — not raw `fetch()` ✅
- `queryClient.invalidateQueries()` called after both `submitForApproval` and `approve` mutations ✅
- No hardcoded secrets ✅
- No `Number()` on financial fields (only `parseFloat(e.totalAmount)` for UI threshold comparison — not accounting math) ✅
- No raw SQL ✅

### Warning — 0 issues

None.

### Info

- **`text-warning` / `text-info` tokens verified present.** `getStatusBadge` uses `bg-warning/10 text-warning` and `bg-info/10 text-info`. Both `--warning` and `--info` CSS variables are defined in `apps/web/src/index.css` (lines 284–287 light mode, 340–343 dark mode). Safe. ✓
- **`isOwner` is pre-existing** in `ExpensesPage.tsx` at line 127 (`const isOwner = currentUser?.role === 'OWNER'`). The new `{e.status === 'APPROVED' && isOwner && (...)}` block correctly reuses it. ✓
- **`canApprove` edge case on null `userRole`:** If `userRole` is `null` or `undefined`, `userRole === 'OWNER'` is `false` and the function falls to `approversList.includes(userId)`. If `userId` is non-null and somehow in the approvers list, the button would show. In practice `currentUser.role` is always a string from the JWT — acceptable defensive behavior.
- **`getApprovalReason` with `approvalThreshold = 0`:** The function returns the "ทุกเอกสารต้องผ่านการอนุมัติ" message when threshold is 0 and no doc-type rule matches. This branch is only reached inside `{uiFlags.approvalEnabled && (...)}` in the page, so the zero-threshold case is only visible when approval is enabled — correct. ✓
- **`approvers_list` / `approval_required_doc_types` JSON parsing in `settings.service.ts`:** Both `catch` blocks silently fall back to defaults without logging. This is consistent with the codebase's existing `getKey()`/`readBoolean()` error-suppression pattern. A misconfigured JSON value in SystemConfig would not surface in Sentry — a minor operational concern shared by other flags.
- **`settingsAccessRole` added to `UiFlags` defaults in this branch.** The field was introduced by D1.3.2.2 but the `DEFAULT_UI_FLAGS` entry was missed; this branch adds it. Backfills a gap rather than introducing one.

---

## Detailed Findings

### Frontend Security
- Both mutations (`submitForApproval`, `approve`) use `api.post()` from the project's central Axios client. The client handles JWT refresh via interceptors — no token management in the hook. ✅
- `onError` callbacks use `getErrorMessage(err)` to surface the API's Thai error body rather than raw stack traces. ✅
- `invalidate()` fires on `onSuccess` — React Query cache stays consistent. ✅

### Backend (settings.service.ts additions)
- `approvalThreshold`: parsed via `readNumber()` + clamp to `>= 0`. Safe. ✅
- `approversList`: JSON parsed inside try/catch with type guard `(v): v is string`. Non-string array elements are filtered. ✅
- `approvalRequiredDocTypes`: same pattern + minimum length check (`filtered.length > 0`) so an empty array in SystemConfig doesn't override the default `['PAYROLL']`. ✅

### UI Logic
- `getApprovalReason` is pure and tested with 5 cases (no-trigger, threshold-only, doctype-only, both, zero-threshold). ✅
- `canApprove` is pure and tested with 4 cases (OWNER, non-OWNER in list, non-OWNER not in list, null userId). ✅
- The "ส่งขออนุมัติ" and "อนุมัติเอกสาร" buttons are correctly gated:
  - Submit: only when `uiFlags.approvalEnabled && e.status === 'DRAFT'`
  - Approve: only when `e.status === 'PENDING_APPROVAL' && isApprover`
  - Legacy POST: only when `!uiFlags.approvalEnabled && e.status === 'DRAFT'`
  - Manual post of APPROVED: only when `e.status === 'APPROVED' && isOwner`
- Server re-validates all permissions — frontend gating is UX-only. ✅

### Tests
- 195-line test file covers `useApprovalActions` (4 mutation tests), `getApprovalReason` (5 edge cases), and `canApprove` (4 cases). ✅
- Mocks `sonner` and `@/lib/api` correctly; `QueryClientProvider` wrapper pattern is consistent with other hook tests in the project. ✅

---

## Recommendation: APPROVE ✅

Clean frontend approval-workflow scaffolding. No critical issues, no warning-level issues. The helpers (`getApprovalReason`, `canApprove`) are well-tested pure functions. The hook correctly delegates to `api.post()`, invalidates cache, and uses Thai sonner messages. `warning`/`info` CSS tokens verified present. Safe to merge.
