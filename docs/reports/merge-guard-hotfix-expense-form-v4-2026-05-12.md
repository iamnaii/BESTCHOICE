# Merge Guard Report — hotfix/expense-form-v4-* (combined)

**Date**: 2026-05-12  
**Branches reviewed**:
- `hotfix/expense-form-v4-approvers-shape` — 2026-05-11 08:58 +07
- `hotfix/expense-form-v4-modal-scroll` — 2026-05-11 09:13 +07  
**Author**: Akenarin Kongdach (both)

> **Note**: `hotfix/expense-form-v4-modal-scroll` is a strict superset of `hotfix/expense-form-v4-approvers-shape` — it contains the same `ApproverSection.tsx` commit (362937fb) plus one additional `ExpenseFormV4.tsx` commit. Merged as a combined report; merge the `-modal-scroll` branch to get both fixes at once.

---

## File Changes Summary

### `hotfix/expense-form-v4-approvers-shape`
| File | +Lines | -Lines |
|------|--------|--------|
| `apps/web/src/components/expense-form-v4/ApproverSection.tsx` | 9 | 1 |

### `hotfix/expense-form-v4-modal-scroll` (superset — includes above)
| File | +Lines | -Lines |
|------|--------|--------|
| `apps/web/src/components/expense-form-v4/ApproverSection.tsx` | 9 | 1 |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | 6 | 6 |

Both are frontend-only hotfixes; no backend, schema, or auth changes.

---

## Fix Descriptions

### Fix A — ApproverSection: paginated `/users` response (`approvers-shape`)
**Problem**: `ApproverSection` called `/users?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT` and treated the response as a bare array. The `/users` endpoint returns a paginated object `{ data, total, page, limit }`, causing `r?.map is not a function` at runtime.

**Fix**: Query `/users?limit=200`, extract `res.data?.data`, filter client-side by `APPROVER_ROLES`.

### Fix B — ExpenseFormV4: modal scroll with sticky header/footer (`modal-scroll`)
**Problem**: The modal used outer `overflow-y-auto` on the container with `sticky top-0`/`sticky bottom-0` header and footer. On short viewports the sticky positioning was unreliable.

**Fix**: Convert modal to `flex flex-col max-h-[95vh]` with `flex-none` header/footer and `flex-1 overflow-y-auto` on the content body. Intentionally removes `backdrop-blur-sm` from header/footer since there is no longer content scrolling behind them.

---

## Issues

### Critical (must fix before merge)
_None found._

### Warning (should fix)

**W-1 — Client-side role filtering with hardcoded `limit=200`**  
`ApproverSection.tsx` fetches `/users?limit=200` and filters by role in the browser. If the organisation ever has >200 users, approvers beyond position 200 will be invisible in the dropdown. The backend `/users` endpoint does not support `?roles=` filtering (root cause), which is why this client-side workaround was needed.  
_Risk_: Currently negligible (typical staff count well under 200). Track as tech debt.  
_Ideal fix_: Add `roles` query-param support to `UsersController.findAll()` + `UsersService.findAll()`.

### Info

**I-1 — Redundant merge risk: both branches modify the same file**  
If both hotfix branches are merged to `main` separately, the `ApproverSection.tsx` diff will appear twice in git history (same commit SHA). Using a standard merge strategy this is harmless, but prefer merging only `hotfix/expense-form-v4-modal-scroll` since it contains both fixes.

---

## Checklist

| Check | Result |
|-------|--------|
| New controllers missing `@UseGuards` | ✅ No new controllers |
| `Number()` on backend money fields | ✅ No financial calculations |
| Missing `deletedAt: null` | ✅ No backend queries |
| Hardcoded secrets/API keys | ✅ None |
| Missing `@Roles()` decorators | ✅ N/A |
| Raw `fetch()` instead of `api.*` | ✅ Uses `api.get()` from `@/lib/api` |
| `queryClient.invalidateQueries` after mutations | ✅ N/A (queries, not mutations) |
| CSS design tokens | ✅ N/A (layout-only change) |
| Thai UI text | ✅ N/A |

---

## Recommendation

**✅ APPROVE** (`hotfix/expense-form-v4-modal-scroll`)

Both fixes are correct and safe. Merge `hotfix/expense-form-v4-modal-scroll` — it contains both fixes. `hotfix/expense-form-v4-approvers-shape` can then be deleted as redundant. W-1 (limit=200) is low-risk tech debt, not a blocker.
