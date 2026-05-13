# Merge Guard Report — `hotfix/expense-form-v4-modal-scroll`

**Date:** 2026-05-13  
**Author:** Akenarin Kongdach  
**Last commit:** 2026-05-11  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

| File | +Lines | −Lines | Notes |
|------|--------|--------|-------|
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | +6 | −6 | Modal layout: flex-col + max-h to fix sticky header/footer |
| `apps/web/src/components/expense-form-v4/ApproverSection.tsx` | +9 | −1 | Handles paginated `/users` response shape |

**Total:** +15 / −7 lines, 2 files

---

## Issues Found

### Critical
_None._

### Warning
_None._

### Info

**I-01** — `ExpenseFormV4.tsx`: Modal changed from `pt-8 pb-8 overflow-y-auto` on the outer container to `max-h-[95vh] flex flex-col` with `flex-1 overflow-y-auto` on the body and `flex-none` on header/footer. This correctly implements sticky header+footer within a flex column — the correct pattern per design token rules.

**I-02** — `ApproverSection.tsx`: The previous call `api.get('/users?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT')` assumed the backend accepted a `roles` filter parameter (it does not — `/users` returns paginated `{ data, total, page, limit }` with no role filter). Fix correctly reads `res.data?.data` from the paginated response shape and applies a client-side filter on `APPROVER_ROLES`. The `?limit=200` is acceptable for an internal approver list.

**I-03** — No raw `fetch()` — uses `api.get()` throughout. Correct per `rules/frontend.md`.

**I-04** — No `queryClient.invalidateQueries()` needed — this is a read-only `useQuery`, not a mutation.

---

## No Action Required

This hotfix is clean. Includes the fix from `hotfix/expense-form-v4-approvers-shape` which was merged into this branch.
