# Pre-Merge Guard Report — `feat/other-income-cards`

**Date**: 2026-05-12  
**Branch**: `feat/other-income-cards`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Recommendation**: ✅ APPROVE (with notes)

---

## File Changes Summary

| File | +Lines | -Lines | Type |
|------|--------|--------|------|
| `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` | +897 | -443 | Frontend page redesign |
| `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` | +86 | -69 | Frontend list page |
| `apps/web/src/pages/other-income/components/ItemsTable.tsx` | partial | partial | UI component |
| `apps/web/src/pages/other-income/components/AutoJournalPreview.tsx` | +4 | -2 | Minor icon update |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | +3 | -2 | Minor icon update |

**No backend changes.** All changes are purely frontend (React/TypeScript).

---

## Critical Issues (Must fix before merge)

**None found.**

- No new controllers — no guard checks needed
- No `Number()` on Prisma/DB money writes — all `Number()` calls are in UI `useMemo` hooks for display arithmetic only (form string → display number)
- No `$queryRaw` usage
- No hardcoded secrets or API keys
- No raw `fetch()` — API calls use `api.get()` / `api.post()` from `@/lib/api`
- No `localStorage`/`sessionStorage` usage

---

## Warning Issues (Should fix)

### W-1: Section 7 shows recorder = approver (Segregation of Duties)

**File**: `OtherIncomeEntryPage.tsx` — Section 7 "ผู้บันทึก & ผู้อนุมัติ"

Both "ผู้บันทึก" and "ผู้อนุมัติ" display `{userDisplayName}` (the currently logged-in user), meaning the same person records and approves. For an accounting document with journal entries, this may violate segregation of duties.

```tsx
// Lines ~747-760 — both show userDisplayName
<span>ผู้บันทึก: <b>{userDisplayName}</b></span>
<span>ผู้อนุมัติ: <b>{userDisplayName}</b></span>
```

**Impact**: Business/accounting concern. If the POST action already enforces server-side role-based approval, this is UI-only cosmetic. But if approver is supposed to be a separate user, this is incomplete.

**Suggestion**: Either add an approver picker (like `ApproverSection` used in expense forms) or add a comment explaining that approval is implicit for roles with POST permission.

---

### W-2: Three extra API calls for status counts on list page load

**File**: `OtherIncomeListPage.tsx`

Three `useQuery` calls are added to fetch DRAFT/POSTED/REVERSED counts separately:

```tsx
const draftCountQuery = useQuery({ queryFn: () => otherIncomeApi.list({ status: 'DRAFT', page: 1, limit: 1 }) ... });
const postedCountQuery = useQuery({ queryFn: () => otherIncomeApi.list({ status: 'POSTED', page: 1, limit: 1 }) ... });
const reversedCountQuery = useQuery({ queryFn: () => otherIncomeApi.list({ status: 'REVERSED', page: 1, limit: 1 }) ... });
```

Each fetches `total` from a `limit=1` paginated query. This works but fires 3 additional API requests on page load. All have `staleTime: 60_000`, which limits refetch frequency.

**Impact**: Acceptable for now. Consider adding a `/other-income/counts` aggregate endpoint later.

---

## Info Issues

### I-1: OtherIncomeEntryPage.tsx is large (~1000+ lines after change)

The file grew significantly with the UI redesign. Consider extracting `SummaryTile`, `SectionHeader`, and the validation summary section into separate component files in a future refactor.

### I-2: `SummaryTile` defined at bottom of file

`SummaryTile` is a local component defined after the main export. This is valid React but inconsistent with extracting helper components above the main component (as done with `SectionHeader`).

---

## Positive Notes

- ✅ Uses design tokens throughout (`bg-primary/10`, `text-muted-foreground`, `bg-card`) — no hardcoded hex or gray classes
- ✅ Thai text uses `leading-snug` where applicable
- ✅ `todayBangkok()` utility correctly handles BKK timezone for accounting document dates
- ✅ `handleFileSelect` centralizes file validation (MIME type + size check) before upload
- ✅ Drag-and-drop file upload with proper `dragLeave` child-element guard
- ✅ All mutations use `toast.success()`/`toast.error()` from sonner
- ✅ `queryClient.invalidateQueries()` present on upload mutation `onSuccess`
- ✅ `canPost` guard properly blocks POST when validation errors exist or attachment required
