# Pre-Merge Guard Report

**Branch**: `hotfix/expense-form-v4-approvers-shape`
**Author**: Akenarin Kongdach
**Date**: 2026-05-14
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

1 file changed, 9 insertions(+), 1 deletion(-)

### Key areas touched
- `apps/web/src/components/expense-form-v4/ApproverSection.tsx` — fix response shape mismatch when loading approver list

---

## Issues Found

### Critical (0)

None.

### Warning (1)

**W-1 — Approver list fetches `limit=200` and filters client-side by role**

The original code called `/users?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT`, but the `/users` endpoint does not support a `roles` query param — it returns a paginated `{ data, total, page, limit }` object. The fix correctly unwraps the pagination shape:

```ts
const list: UserRow[] = res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
return list.filter((u) => APPROVER_ROLES.includes(u.role));
```

The concern: `limit=200` is a hardcoded ceiling. If the company ever has more than 200 total users, approvers past position 200 will be invisible in the dropdown. For BESTCHOICE's current scale (small chain) this is safe, but it is a technical debt item.

**Proper long-term fix**: Add `roles` filter param to the backend `GET /users` endpoint (server-side filtering).

### Info (1)

**I-1 — Defensive response unwrapping**

The `res.data?.data ?? (Array.isArray(res.data) ? res.data : [])` fallback handles both the paginated shape (current) and a bare-array shape (hypothetical future or other callers). This is defensive without being over-engineered.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers / guards | ✅ Frontend-only change |
| Number() on money fields | ✅ None |
| Hardcoded secrets | ✅ None |
| Raw fetch() | ✅ Uses `api.get()` |
| Missing invalidateQueries | ✅ Read-only query, no mutation |

---

## Recommendation

**REVIEW** — The fix is correct and unblocks the approver dropdown. However, note the `limit=200` ceiling (W-1). Fine to merge as-is for the current business scale, but create a follow-up task to add server-side role filtering to `GET /users` to remove the hard limit.
