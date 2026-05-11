# Merge Guard Report — hotfix/expense-form-v4-approvers-shape

**Date**: 2026-05-11  
**Branch**: `hotfix/expense-form-v4-approvers-shape`  
**Author**: Akenarin Kongdach  
**Commit**: `362937fb fix(expense-form-v4): ApproverSection paginated /users response → 'r?.map is not a function'`

**Base**: `origin/main`

---

## File Changes Summary

| File | +Added | -Removed |
|------|--------|----------|
| `apps/web/src/components/expense-form-v4/ApproverSection.tsx` | 9 | 1 |
| **Total** | **9** | **1** |

**Note**: This branch is a strict subset of `hotfix/expense-form-v4-modal-scroll` — it contains only the ApproverSection fix. If the modal-scroll hotfix is merged first, this branch becomes redundant (conflict-free but empty diff).

---

## Issues

### Critical — None

### Warning

#### W-1: Client-Side Approver Filtering with `limit=200` Ceiling

Same as noted in `hotfix/expense-form-v4-modal-scroll` review. The backend `/users` endpoint returns paginated results and does not support `?roles=` filtering. The fix fetches up to 200 users and filters client-side. Acceptable short-term; backend endpoint should be updated to support server-side role filtering.

---

### Info

None.

---

## Recommendation

**APPROVE** — correct, minimal fix for a runtime crash.

**Coordination note**: This branch is superseded by `hotfix/expense-form-v4-modal-scroll` which includes this commit plus the modal layout fix. Recommend merging the `-modal-scroll` branch instead and closing this one to keep history clean.
