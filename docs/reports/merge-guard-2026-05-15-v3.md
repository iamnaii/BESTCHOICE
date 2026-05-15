# Pre-Merge Guard Report — 2026-05-15 (Run v3)

**Date**: 2026-05-15  
**Reviewed by**: Pre-Merge Guard Agent  
**Previous run**: `guard/review-2026-05-15-v2` (cleared all branches active as of 03:11 UTC)

---

## Branches Reviewed (3 of 384 unmerged — top by recency, not yet merged to main)

| Branch | Last Commit | Author | Files | Recommendation |
|--------|-------------|--------|-------|----------------|
| `chore/other-income-v2-1-t4-renumber-validation` | 2026-05-12 | Akenarin Kongdach | 1 | ✅ APPROVE |
| `hotfix/expense-form-v4-modal-scroll` | 2026-05-11 | Akenarin Kongdach | 2 | ✅ APPROVE |
| `hotfix/expense-form-v4-approvers-shape` | 2026-05-11 | Akenarin Kongdach | 1 | ✅ APPROVE (subset of modal-scroll) |

---

## Branch 1: `chore/other-income-v2-1-t4-renumber-validation`

### Summary
Pure documentation/structural refactor of `validation.service.ts`.  
Aligns rule numbering (V3–V15) to the CPA PDF Spec v1.0  
(`docs/superpowers/specs/2026-05-12-other-income-v2-1-pdf-gap-fixes-design.md`).

**Commit**: `fc2ec9eb` — `docs(other-income): renumber validation rules to PDF Spec V1-V14 (T4)`

### File Changes

| File | +/- |
|------|-----|
| `apps/api/src/modules/other-income/services/validation.service.ts` | +68 / -41 |

### What Changed
- Added 28-line docblock mapping all V1–V15 rules to spec (N/A explanations for V1/V2/V5 handled by `AutoJournalService`)
- Reordered checks to match spec order: V3 → V4 → V6 → V7 → V8 → V9 (stub) → V11 → V10/V12 → V13/V14 → V15
- No logic changes — same conditions, same error messages, same rule labels

### Security Checks

| Check | Result |
|-------|--------|
| New controller with missing `@UseGuards` | N/A — no new controllers |
| `Number()` on money fields | `Number(it.whtPct)` at line 135 — **whtPct is a percentage (not Decimal money field)**; all monetary fields (`amountReceived`, `netReceived`, `vatPct`, `adjSum`) correctly use Prisma `.Decimal` methods |
| Missing `deletedAt: null` | N/A — no DB queries |
| Hardcoded secrets | None |
| Missing `@Roles()` | N/A |
| SQL injection | N/A |

### Issues Found

**Critical**: None  
**Warning**: None  
**Info**: None

### Recommendation: ✅ APPROVE

No logic changes. Renumbering matches the accountant PDF spec. All Decimal arithmetic is intact.

---

## Branch 2: `hotfix/expense-form-v4-modal-scroll`

### Summary
Two bug fixes in `ExpenseFormV4` — a runtime crash and a broken scroll layout.

**Commits**:
- `362937fb` — `fix(expense-form-v4): ApproverSection paginated /users response → 'r?.map is not a function'`
- `59cf6117` — `fix(expense-form-v4): modal sticky header/footer broken on scroll`

### File Changes

| File | +/- |
|------|-----|
| `apps/web/src/components/expense-form-v4/ApproverSection.tsx` | +9 / -1 |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | +6 / -6 |

### What Changed

**ApproverSection** — `/users` returns `{ data, total, page, limit }` (paginated), not a bare array.
Previous code passed the envelope directly to React-Query's typed `UserRow[]`, causing `r?.map is not a function` at runtime.
Fix: unwraps `.data.data` with safe fallback to bare array, then client-side filters by `APPROVER_ROLES`.

**ExpenseFormV4** — Modal outer wrapper changed from `overflow-y-auto` scroll on the viewport overlay to `max-h-[95vh] flex flex-col` on the inner dialog. Header and footer get `flex-none`; body gets `flex-1 overflow-y-auto`. This restores sticky header/footer within the modal regardless of content height.

### Security Checks

| Check | Result |
|-------|--------|
| Raw `fetch()` instead of `api.get()` | `api.get('/users?limit=200')` — correct |
| Missing `queryClient.invalidateQueries()` | Parent `ExpenseFormV4` has `invalidateQueries(['expenses'])` and `(['expenses-summary'])` after save mutation — correct |
| `useEffect` for data fetching | No — `useQuery` used correctly |
| New backend controller / guards | N/A — frontend only |
| Hardcoded secrets | None |

### Issues Found

**Critical**: None  
**Warning**: None  
**Info**:
- `ApproverSection` fetches `/users?limit=200` and filters client-side by role. The `/users` backend endpoint doesn't support a `roles` query param, so this is pragmatic. A `limit=200` cap is adequate for the expected org size. Comment in code explains the reason. Low priority: add `roles` filter to the backend endpoint to avoid over-fetching when headcount grows.

### Recommendation: ✅ APPROVE

Both fixes are correct. The runtime crash (`map is not a function`) is resolved. Scroll layout restored with standard flex-column modal pattern. No regressions expected.

---

## Branch 3: `hotfix/expense-form-v4-approvers-shape`

### Summary
Single commit `362937fb` — the ApproverSection fix from Branch 2. This branch is a strict **subset** of `hotfix/expense-form-v4-modal-scroll`.

**Recommendation**: Merge `hotfix/expense-form-v4-modal-scroll` instead (contains both fixes). This branch can be closed.

### Issues Found

**Critical**: None  
**Warning**: None  
**Info**: Superseded by `hotfix/expense-form-v4-modal-scroll`.

### Recommendation: ✅ APPROVE (prefer merging the superset branch)

---

## Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `chore/other-income-v2-1-t4-renumber-validation` | 0 | 0 | 0 | ✅ APPROVE |
| `hotfix/expense-form-v4-modal-scroll` | 0 | 0 | 1 | ✅ APPROVE |
| `hotfix/expense-form-v4-approvers-shape` | 0 | 0 | 1 | ✅ APPROVE |

**Nothing to block.** All three branches are safe to merge. Recommend merging `expense-form-v4-modal-scroll` before `expense-form-v4-approvers-shape` (superset covers both fixes).
