# Merge Guard Report — hotfix/expense-form-v4-modal-scroll

**Date**: 2026-05-11  
**Branch**: `hotfix/expense-form-v4-modal-scroll`  
**Author**: Akenarin Kongdach  
**Commits**:
- `59cf6117 fix(expense-form-v4): modal sticky header/footer broken on scroll`
- `362937fb fix(expense-form-v4): ApproverSection paginated /users response → 'r?.map is not a function'`

**Base**: `origin/main`

---

## File Changes Summary

| File | +Added | -Removed |
|------|--------|----------|
| `apps/web/src/components/expense-form-v4/ApproverSection.tsx` | 9 | 1 |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | 6 | 6 |
| **Total** | **15** | **7** |

**Frontend-only, pure UI fixes. No backend changes.**

---

## Issues

### Critical — None

### Warning

#### W-1: Client-Side Role Filtering with Hard-Coded `limit=200`

**File**: `ApproverSection.tsx`

```ts
// Before (broken: backend doesn't support ?roles= filter)
queryFn: async () => (await api.get('/users?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT')).data,

// After (fix)
const res = await api.get('/users?limit=200');
const list: UserRow[] = res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
return list.filter((u) => APPROVER_ROLES.includes(u.role));
```

The hotfix is correct and the crash (`r?.map is not a function`) is properly resolved. However, fetching up to 200 users client-side and filtering is a workaround. In a branch with many users, approvers beyond position 200 would be silently invisible in the dropdown.

**Recommendation**: A proper backend fix would add `?role=OWNER,FINANCE_MANAGER,ACCOUNTANT` filter support to `UsersController`. The client-side fix is acceptable as a short-term hotfix given this is an internal admin form.

---

### Info

#### I-1: `ExpenseFormV4` Modal Layout — CSS-Only Fix

The scroll fix converts the modal from:
```
overflow-y-auto on outer container
sticky header/footer (broken when outer doesn't scroll)
```
to:
```
flex flex-col + max-h-[95vh] on outer
flex-none header/footer
flex-1 overflow-y-auto on content area
```

This is the correct CSS pattern for a modal with a sticky header and footer. No logic changes.

---

## Recommendation

**APPROVE** — Both fixes are correct and safe.

The modal scroll layout fix (I-1) is the standard Tailwind flex-column approach and resolves a genuine UX bug. The approver shape fix (W-1) is an acceptable short-term workaround. A follow-up ticket should add server-side role filtering to `/users` to remove the 200-user ceiling.
