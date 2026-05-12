# Merge Guard Report — hotfix/expense-form-v4-modal-scroll

**Date:** 2026-05-12  
**Branch:** `hotfix/expense-form-v4-modal-scroll`  
**Author:** Akenarin Kongdach  
**Recommendation:** ✅ APPROVE

---

## Summary

Two commits packaged as one hotfix: (1) `ApproverSection` crash fix — paginated `/users` response shape mismatch; (2) `ExpenseFormV4` modal layout fix — sticky header/footer broken when form content overflows.

## File Changes (2 files, +15 / -7)

| File | Changes |
|------|--------|
| `ApproverSection.tsx` | Fix paginated response shape + client-side role filter |
| `ExpenseFormV4.tsx` | Flex-column modal layout with scrollable content area |

---

## Issues

### Critical — 0 found

### Warning — 1 item

**W-1: `ApproverSection` fetches `/users?limit=200` and filters client-side**  
File: `ApproverSection.tsx`

```ts
const res = await api.get('/users?limit=200');
const list: UserRow[] = res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
return list.filter((u) => APPROVER_ROLES.includes(u.role));
```

The backend `/users` endpoint does not support `?roles=` filtering (as the code comment explains), so the fix paginates with `limit=200` and filters client-side. This works at current user counts. If users ever exceed 200, eligible approvers beyond position 200 would be invisible in the dropdown. Acceptable for now, but the backend should eventually gain a `?role[]=` filter param.

**Suggested follow-up** (not blocking merge): Add a `role[]` query parameter to `UsersController.findAll()` to allow server-side filtering by role.

### Info — 1 item

**I-1: Modal now center-aligned vertically instead of top-anchored**

Old layout:
```tsx
className="fixed inset-0 ... flex items-start justify-center pt-8 pb-8 overflow-y-auto"
```

New layout:
```tsx
className="fixed inset-0 ... flex items-center justify-center p-4"
```

`items-start` → `items-center` means the modal is now centered in the viewport rather than anchored near the top. For a large form this is the standard modal behavior and looks better on tall screens. On small screens, `max-h-[95vh]` prevents overflow. No functional concern.

---

## Positive Findings

- **Modal scroll fix is architecturally correct**: Changing from `overflow-y-auto` on the backdrop (which caused the whole overlay to scroll) to `flex-1 overflow-y-auto` on just the content region is the right pattern for a modal with a fixed header and footer.
- **Defensive response parsing**: `res.data?.data ?? (Array.isArray(res.data) ? res.data : [])` handles both the paginated `{ data, total }` shape and any legacy bare-array responses gracefully, without crashing.
- **`APPROVER_ROLES` constant**: Centralizing the role list as a module-level constant (`const APPROVER_ROLES = [...]`) is cleaner than inline string arrays in the filter callback.
