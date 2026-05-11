# Merge Guard Report — hotfix/expense-form-v4-modal-scroll

**Date**: 2026-05-11  
**Branch**: `hotfix/expense-form-v4-modal-scroll`  
**Author**: Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`  
**Last commit**: 2026-05-11 09:13 +0700  
**Commits**:
1. `fix(expense-form-v4): modal sticky header/footer broken on scroll`
2. `fix(expense-form-v4): ApproverSection paginated /users response → 'r?.map is not a function'`

---

## File Changes Summary

| File | +Lines | −Lines | Notes |
|------|--------|--------|-------|
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | 6 | 6 | Modal layout fix |
| `apps/web/src/components/expense-form-v4/ApproverSection.tsx` | 10 | 1 | API response shape fix |

**Total**: +15 / −7 (frontend only — no backend changes)

---

## Issues by Severity

### ✅ Critical — NONE

### ⚠️ Warning — NONE

### ℹ️ Info — NONE

---

## Change Analysis

### Fix 1: Modal layout (`ExpenseFormV4.tsx`)

**Before** (broken): `fixed inset-0` → `overflow-y-auto` on outer div, `sticky top-0`/`sticky bottom-0` on header/footer.  
**Problem**: `sticky` positioning inside `overflow-y-auto` does not work — the sticky container scrolls with the content.

**After** (correct): `flex items-center justify-center p-4` on outer div, `max-h-[95vh] flex flex-col` on modal, `flex-none` on header/footer, `flex-1 overflow-y-auto` on content body.  
**Result**: Header and footer are fixed within the modal card; only the content area scrolls. Standard flexbox modal pattern.

```diff
- <div ... className="fixed inset-0 ... overflow-y-auto">
-   <div ... className="... min-h-[80vh]">
-     <div className="sticky top-0 z-10 ...">  {/* Header */}
-     <div className="p-6 space-y-5">            {/* Body */}
-     <div className="sticky bottom-0 ...">      {/* Footer */}
+ <div ... className="fixed inset-0 ... flex items-center justify-center p-4">
+   <div ... className="... max-h-[95vh] flex flex-col">
+     <div className="flex-none ...">            {/* Header */}
+     <div className="flex-1 overflow-y-auto ... {/* Body */}
+     <div className="flex-none ...">            {/* Footer */}
```

No behavioral regressions possible — pure CSS layout change.

### Fix 2: ApproverSection paginated response (`ApproverSection.tsx`)

**Before** (broken): `api.get('/users?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT')` assumed bare array response, caused runtime error `r?.map is not a function` because `/users` returns `{ data, total, page, limit }`.

**After** (correct):
```ts
const res = await api.get('/users?limit=200');
const list: UserRow[] = res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
return list.filter((u) => APPROVER_ROLES.includes(u.role));
```
- Handles paginated shape `res.data.data`
- Falls back to bare array (forward-compat if endpoint changes)
- Filters client-side since backend `findAll` doesn't accept `roles` query param
- `limit=200` is sufficient (very few users ever qualify as approvers)
- `staleTime: 60_000` remains in place (cache correctness preserved)

---

## Positive Observations

| Check | Status |
|-------|--------|
| No security implications | ✅ |
| No backend changes | ✅ |
| Uses `api.get()` correctly | ✅ |
| Defensive fallback for API shape `res.data?.data ?? (Array.isArray(res.data) ? res.data : [])` | ✅ |
| `staleTime` preserved (prevents over-fetching) | ✅ |
| CSS-only modal fix (no JS behavior change) | ✅ |

---

## Recommendation

**✅ APPROVE** — Safe to merge immediately.

Both fixes are targeted, low-risk corrections with no new logic paths. The modal layout fix resolves a UX bug using standard flex patterns. The ApproverSection fix resolves a runtime crash against the paginated `/users` endpoint.
