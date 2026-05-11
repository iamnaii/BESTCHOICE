# Pre-Merge Guard Report — 2026-05-11 (v2)

**Generated:** 2026-05-11  
**Guard branch:** `guard/review-2026-05-11-v2`  
**Branches reviewed:** 3 (most recently updated non-meta branches)

---

## Branch 1: `feat/other-income-cards`

**Author:** Akenarin Kongdach  
**Commit:** `a15c5375` — feat(other-income): redesign list cards + entry form to prototype  
**Scope:** Frontend only — 5 files changed, +897 insertions / −443 deletions

### File Changes Summary

| File | +Lines | −Lines | Note |
|------|--------|--------|------|
| `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` | ~700 | ~400 | Major UI redesign |
| `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` | ~90 | ~65 | Card redesign |
| `apps/web/src/pages/other-income/components/ItemsTable.tsx` | ~100 | ~65 | Form redesign |
| `apps/web/src/pages/other-income/components/AutoJournalPreview.tsx` | 4 | 2 | Icon swap only |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | 3 | 2 | Minor icon tweak (shared with hotfix branch) |

### Issues

#### ⚠️ Warning

**W1 — `Number()` used in client-side financial display calculations**  
`OtherIncomeEntryPage.tsx` uses `Number(item.quantity)`, `Number(item.unitAmount)`, `Number(item.discountAmount)` etc. in two `useMemo` blocks (`incomeTotals`, `validationMessages`) for UI display:

```tsx
// Lines ~170-203 (incomeTotals useMemo)
const qty = Number(item.quantity) || 0;
const unit = Number(item.unitAmount) || 0;
```

These values are display-only and do not bypass server-side Prisma.Decimal validation. The actual persisted amounts go through the zod schema and server service. However, IEEE 754 float drift on large values or high precision could show incorrect totals in the UI before submission. Recommend using a consistent `toFixed(2)` pattern throughout (already partially done: `+beforeVat.toFixed(2)` etc.) or a small `toBaht(n)` helper that rounds to 2dp before accumulation.

**W2 — Section 7 "ผู้บันทึก & ผู้อนุมัติ" shows the same user for both roles**  
```tsx
// Section 7 — Recorder & Approver
<span>ผู้บันทึก: {userDisplayName}</span>   // current user
<span>ผู้อนุมัติ: {userDisplayName}</span>  // SAME current user
```
This appears to be a UI stub — in the actual `other-income` service, the approver is the `approvedById` field (separate from `createdById`). The UI is misleading: it implies the same person both records and approves, which violates segregation of duties. If this section is display-only (non-functional), add a comment clarifying that. If it needs to show the actual approver, wire up `loadQuery.data?.approvedBy?.name`.

**W3 — 3 separate count queries on page load**  
`OtherIncomeListPage.tsx` fires 3 parallel `useQuery` calls (`draftCountQuery`, `postedCountQuery`, `reversedCountQuery`) each hitting `/other-income?status=X&page=1&limit=1`. This works but adds 3 round-trips on mount. Consider adding a single `GET /other-income/stats` endpoint or combining counts in the existing list endpoint response.

#### ℹ️ Info

**I1 — `OtherIncomeEntryPage.tsx` is ~937 lines**  
Exceeds the 500-line Info threshold. Could be split into `OtherIncomeEntryForm.tsx` (the form sections) and `OtherIncomeEntryPage.tsx` (the page shell + action bar).

**I2 — Three `as any` eslint-disable casts**  
```tsx
// eslint-disable-next-line @typescript-eslint/no-explicit-any
control={form.control as any}
```
Present in 2 places (`OtherIncomeEntryPage.tsx`, `ItemsTable.tsx`). These pre-existed in the original code — not new regressions — but worth tracking for eventual cleanup.

**I3 — `SummaryTile` and `SectionHeader` are page-local components at the bottom of the file**  
Minor organizational note: these small helpers (< 20 lines each) could live in `components/` if reused elsewhere. For now, bottom-of-file co-location is acceptable.

### Checklist

| Check | Result |
|-------|--------|
| New controllers with missing `@UseGuards` | N/A — no backend changes |
| `Number()` on persisted money fields | ✅ No (display-only useMemo) |
| Missing `deletedAt: null` in new queries | N/A — no new Prisma queries |
| Hardcoded secrets / API keys | ✅ None |
| Raw `fetch()` in React components | ✅ None — uses `api.get()` / `otherIncomeApi.*` |
| `queryClient.invalidateQueries()` after mutations | ✅ Present (line 144 in list page) |
| Thai validation messages | ✅ Present |
| `useQuery` / `useMutation` pattern | ✅ Correct |
| Design tokens (no hardcoded hex) | ✅ Uses `bg-primary/10`, `text-muted-foreground` etc. |

### Recommendation: ✅ REVIEW

No critical blockers. Two warnings worth addressing before merge:
- W2 (approver stub) is a UX/SOD concern that should be clarified or fixed.
- W1 (display Number() precision) is low risk but worth a note.

---

## Branch 2: `hotfix/expense-form-v4-modal-scroll`

**Author:** Akenarin Kongdach  
**Commits:**
- `59cf6117` — fix(expense-form-v4): modal sticky header/footer broken on scroll
- `362937fb` — fix(expense-form-v4): ApproverSection paginated /users response → 'r?.map is not a function'

**Scope:** Frontend only — 2 files changed, +15 insertions / −7 deletions

**Note:** This branch includes ALL changes from `hotfix/expense-form-v4-approvers-shape` (Branch 3) plus one additional commit. If both are open PRs, only this branch needs to be merged.

### File Changes Summary

| File | Change | Description |
|------|--------|-------------|
| `apps/web/src/components/expense-form-v4/ApproverSection.tsx` | +9 / −1 | Handle paginated `/users` response |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | +6 / −6 | Fix modal scroll with flex container |

### Root Causes Fixed

**Bug 1 — `r?.map is not a function`**  
`/users` returns `{ data: UserRow[], total, page, limit }` but the query function previously assumed a bare array. Fix correctly extracts `res.data?.data` with fallback to `Array.isArray(res.data)`:

```tsx
// Before (broken)
queryFn: async () => (await api.get('/users?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT')).data,

// After (correct)
queryFn: async () => {
  const res = await api.get('/users?limit=200');
  const list: UserRow[] = res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
  return list.filter((u) => APPROVER_ROLES.includes(u.role));
},
```

**Bug 2 — Modal sticky header/footer scroll broken**  
Changed from `overflow-y-auto` on the outer modal backdrop (which made the whole modal scroll including the header/footer) to a proper flex layout with `max-h-[95vh]` on the panel and `flex-1 overflow-y-auto` on the body only:

```tsx
// Before: outer overflow-y-auto → header+footer scroll away
<div className="fixed inset-0 ... flex items-start justify-center pt-8 pb-8 overflow-y-auto">
  <div className="... min-h-[80vh]">
    <div className="sticky top-0 z-10 bg-background/95 ...">  {/* sticky inside scrolling parent — broken */}

// After: flex column with fixed header/footer
<div className="fixed inset-0 ... flex items-center justify-center p-4">
  <div className="... max-h-[95vh] flex flex-col">
    <div className="flex-none bg-background border-b ...">  {/* non-shrinking */}
    <div className="flex-1 overflow-y-auto ...">             {/* only body scrolls */}
    <div className="flex-none bg-background border-t ...">  {/* non-shrinking */}
```

### Issues

#### ⚠️ Warning

**W1 — Client-side role filtering with hard limit 200**  
`ApproverSection` now loads `/users?limit=200` and filters client-side for approver roles. If the org ever exceeds 200 total users, eligible approvers beyond that page won't appear. Current business scale (single company, <20 staff) makes this safe in practice. Backend ideally should expose `GET /users?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT` with proper filtering.

### Checklist

| Check | Result |
|-------|--------|
| New controllers with missing `@UseGuards` | N/A — no backend changes |
| `Number()` on persisted money fields | N/A |
| Hardcoded secrets | ✅ None |
| Raw `fetch()` | ✅ None |
| `queryClient.invalidateQueries()` | N/A — read-only fix |
| Design tokens | ✅ |

### Recommendation: ✅ APPROVE

Valid bug fix. Both issues were real runtime errors. The `limit=200` ceiling (W1) is a known acceptable trade-off at current scale.

---

## Branch 3: `hotfix/expense-form-v4-approvers-shape`

**Author:** Akenarin Kongdach  
**Commit:** `362937fb` — fix(expense-form-v4): ApproverSection paginated /users response → 'r?.map is not a function'  
**Scope:** Frontend only — 1 file changed, +9 insertions / −1 deletion

**Note:** This branch is a **strict subset** of Branch 2 (`hotfix/expense-form-v4-modal-scroll`). Branch 2 contains this commit plus the additional modal scroll fix. These two branches should not both be merged independently — prefer merging Branch 2 which supersedes this one.

### Issues

Same as Branch 2 W1.

### Recommendation: ✅ APPROVE (but superseded by Branch 2)

Prefer merging `hotfix/expense-form-v4-modal-scroll` (Branch 2) which contains this fix plus the scroll fix, rather than merging both branches separately.

---

## Summary

| Branch | Files | Critical | Warning | Info | Verdict |
|--------|-------|----------|---------|------|---------|
| `feat/other-income-cards` | 5 | 0 | 3 | 3 | **REVIEW** |
| `hotfix/expense-form-v4-modal-scroll` | 2 | 0 | 1 | 0 | **APPROVE** |
| `hotfix/expense-form-v4-approvers-shape` | 1 | 0 | 1 | 0 | **APPROVE** (superseded by branch 2) |

**Merge order recommendation:**
1. `hotfix/expense-form-v4-modal-scroll` — small bug fix, no blockers
2. ~~`hotfix/expense-form-v4-approvers-shape`~~ — skip (already included in branch 2)
3. `feat/other-income-cards` — after addressing W2 (approver stub clarification)
