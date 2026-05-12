# Pre-Merge Guard Report — Expense Form V4 Hotfixes

**Date**: 2026-05-12
**Author**: Akenarin Kongdach
**Base**: `origin/main`
**Reviewer:** Pre-Merge Guard (automated)

---

## Branch 1: `hotfix/expense-form-v4-modal-scroll`

**Recommendation**: APPROVE

### File Changes

| File | +Lines | -Lines | Type |
|------|--------|--------|------|
| `apps/web/src/components/expense-form-v4/ApproverSection.tsx` | +10 | -1 | Bug fix |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | +6 | -6 | Layout fix |

### Summary

Two independent fixes bundled together:

**Fix 1 — Modal scroll (`ExpenseFormV4.tsx`)**: Converts the modal from a `pt-8 pb-8 overflow-y-auto` scroll-on-overlay pattern to a proper `flex-col max-h-[95vh]` pattern where the inner content div has `overflow-y-auto`. Header and footer are `flex-none`. This prevents the common issue of sticky header/footer not working when the outer div scrolls.

**Fix 2 — Approver data shape (`ApproverSection.tsx`)**: Fixes a runtime bug where `/users?roles=OWNER,...` returned paginated `{ data, total, page, limit }` but the query expected a bare `UserRow[]`. The fix adds proper shape handling:

```tsx
const list: UserRow[] = res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
return list.filter((u) => APPROVER_ROLES.includes(u.role));
```

Note: The original `?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT` query param was silently ignored by the backend. The new approach calls `/users?limit=200` and filters client-side.

### Critical Issues

None.

### Warning Issues

**W-1**: `GET /users` has `@Roles('OWNER')` at the backend. Non-OWNER users (FINANCE_MANAGER, ACCOUNTANT) who open the expense form will receive a 403 and the approver dropdown will be empty — same behavior as before the fix (the crash was the new symptom, empty list was pre-existing). The fix resolves the crash; the empty-list problem for non-OWNER users requires a separate backend change.

**Suggested follow-up:** Add `GET /users/approvers` with `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` that returns only approver-eligible users.

**W-2**: Client-side role filtering fetches up to 200 users. Acceptable for current scale, but server-side filtering would reduce payload. Track as technical debt.

---

## Branch 2: `hotfix/expense-form-v4-approvers-shape`

**Recommendation**: APPROVE (superseded by modal-scroll)

### File Changes

| File | +Lines | -Lines | Type |
|------|--------|--------|------|
| `apps/web/src/components/expense-form-v4/ApproverSection.tsx` | +9 | -1 | Bug fix |

### Summary

Identical to the `ApproverSection.tsx` fix in `hotfix/expense-form-v4-modal-scroll`. This branch contains only the approver data shape fix without the modal scroll change.

> **Note**: Both hotfix branches contain the same `ApproverSection.tsx` change. Merging both to `main` will cause a conflict. Only one should be merged, or the branches should be reconciled before merging.

### Critical Issues

None.

### Warning Issues

Same as W-1 above.

---

## Merge Order Recommendation

Since both hotfixes touch `ApproverSection.tsx` identically:

1. Merge `hotfix/expense-form-v4-modal-scroll` first (it contains both fixes)
2. Close `hotfix/expense-form-v4-approvers-shape` as superseded — its change is already included
3. Create follow-up ticket for `GET /users/approvers` backend endpoint
