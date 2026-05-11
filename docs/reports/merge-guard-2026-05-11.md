# Pre-Merge Guard Report — 2026-05-11

**Generated**: 2026-05-11  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: 3 (most recently active non-guard, non-docs branches)

---

## Summary

| Branch | Files Changed | Insertions | Deletions | Recommendation |
|--------|--------------|------------|-----------|----------------|
| `feat/other-income-cards` | 5 | +897 | -443 | **REVIEW** |
| `hotfix/expense-form-v4-modal-scroll` | 2 | +15 | -7 | **REVIEW** |
| `docs/journey-other-income` | 1 (HTML) | +818 | 0 | **APPROVE** |

---

## Branch 1: `feat/other-income-cards`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-11 10:08 BKK  
**Commit**: `feat(other-income): redesign list cards + entry form to prototype`

### Files Changed
- `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` — major UI redesign (7-section layout, drag-and-drop upload, inline totals, section-numbered layout)
- `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` — status summary cards redesign  
- `apps/web/src/pages/other-income/components/ItemsTable.tsx` — card-based row redesign
- `apps/web/src/pages/other-income/components/AutoJournalPreview.tsx` — icon swap (✓/✗ → lucide)
- `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` — minor: ArrowLeft icon in cancel button

### Critical Issues
_None found._

No new backend controllers. No new DTOs. No `Number()` on DB Decimal fields. No raw `fetch()`. No hardcoded secrets. No `window.confirm()`. Design tokens used throughout (no hardcoded hex/gray).

### Warning Issues

**W1 — 3 extra HTTP round-trips for status counts (OtherIncomeListPage)**  
The new status card section fires 3 separate `useQuery` calls (DRAFT / POSTED / REVERSED), each making a full `GET /other-income?status=X&page=1&limit=1` request with `staleTime: 60s`.

```tsx
const draftCountQuery  = useQuery({ queryFn: () => otherIncomeApi.list({ status: 'DRAFT',    page: 1, limit: 1 }) });
const postedCountQuery = useQuery({ queryFn: () => otherIncomeApi.list({ status: 'POSTED',   page: 1, limit: 1 }) });
const reversedCountQuery = useQuery({ queryFn: () => otherIncomeApi.list({ status: 'REVERSED', page: 1, limit: 1 }) });
```

Each call hits the DB for a `COUNT(*)`. Consider a single `/other-income/stats` endpoint returning `{ draft, posted, reversed }` to halve the round-trips. Current approach works but adds ~3 concurrent HTTP calls on every page visit.

**W2 — `form.mode: 'onChange'` on a 9-section form**  
`useForm({ mode: 'onChange' })` triggers Zod validation on every keystroke. The form has 9 sections with dynamic item rows. On slow devices this may cause noticeable lag. `mode: 'onBlur'` or `mode: 'onTouched'` is usually sufficient for UX parity.

### Info

**I1 — `OtherIncomeEntryPage.tsx` at 937 lines**  
Exceeds the 500-line guideline. The entry page now owns: header display, 9 form sections, attachment drag-and-drop, inline totals computation, and JE preview. Consider extracting `AttachmentSection` and `PaymentChannelSection` into separate components.

**I2 — `todayBangkok()` helper duplicated in two `defaultValues` calls**  
`defaultValues` is defined statically at module level as `{ issueDate: todayBangkok(), ... }` and then also overridden in `useForm({ defaultValues: { ...defaultValues, issueDate: todayBangkok() } })`. The module-level call runs once at import time; the hook call runs on mount. If the user's browser is slow between midnight and the first render, the duplicate call ensures correct timezone date. This is intentional but worth a short comment.

---

## Branch 2: `hotfix/expense-form-v4-modal-scroll`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-11 09:13 BKK  
**Commits** (2):
1. `fix(expense-form-v4): ApproverSection paginated /users response → 'r?.map is not a function'`
2. `fix(expense-form-v4): modal sticky header/footer broken on scroll`

### Files Changed
- `apps/web/src/components/expense-form-v4/ApproverSection.tsx`
- `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx`

### Critical Issues
_None found._

### Warning Issues

**W1 — Client-side role filtering fetches up to 200 users (ApproverSection)**  
The original code passed `?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT` but the backend `UsersController.findAll` does not support a `roles` query param, causing it to be silently ignored — returning a paginated object instead of the expected array, hence the crash `r?.map is not a function`.

The fix correctly handles the paginated shape and filters client-side:

```tsx
const res = await api.get('/users?limit=200');
const list: UserRow[] = res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
return list.filter((u) => APPROVER_ROLES.includes(u.role));
```

This works but loads all 200 users on every `ExpenseFormV4` mount to show a few approver options. If the system grows to hundreds of users this will be slow. Recommended fix: add `?role=OWNER,FINANCE_MANAGER,ACCOUNTANT` filtering to `UsersService.findAll`.

**W2 — Scroll fix removes `sticky` positioning (ExpenseFormV4)**  
The modal was changed from `overflow-y-auto` on the outer wrapper (causing sticky header/footer to not work) to a proper flex layout:

```diff
- <div className="fixed inset-0 z-50 ... flex items-start justify-center pt-8 pb-8 overflow-y-auto">
-   <div className="w-full max-w-5xl bg-background rounded-xl shadow-modal min-h-[80vh]">
-     <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b ...">
+ <div className="fixed inset-0 z-50 ... flex items-center justify-center p-4">
+   <div className="w-full max-w-5xl bg-background rounded-xl shadow-modal max-h-[95vh] flex flex-col">
+     <div className="flex-none bg-background border-b ...">
```

The fix is correct. One minor note: the `95vh` cap means on very short screens (< ~600px height) the form may feel cramped. No action required unless QA flags it.

### Info

**I1 — Backend `/users` role-filter gap (tracked tech debt)**  
The comment in `ApproverSection.tsx` documents: "Backend findAll doesn't filter by role." This is a missing feature in `UsersController` / `UsersService`. Track as tech debt — adding `?role=` support server-side would allow removing the 200-user fetch.

---

## Branch 3: `docs/journey-other-income`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-11 10:56 BKK  
**Commit**: `docs(accounting): add journey-other-income.html reference`

### Files Changed
- `docs/accounting/journey-other-income.html` (+818 lines, HTML only)

### Issues
_None._ Documentation-only change with no TypeScript or backend modifications.

---

## Recommendations

| Branch | Decision | Blocker? | Action Required |
|--------|----------|----------|-----------------|
| `feat/other-income-cards` | **REVIEW** | No | Acknowledge W1 (count queries) and W2 (onChange mode); optionally split file (I1) |
| `hotfix/expense-form-v4-modal-scroll` | **REVIEW** | No | Track W1 (`/users` role-filter) as tech debt issue |
| `docs/journey-other-income` | **APPROVE** | — | None — safe to merge |

No BLOCK-level issues found in any branch. All three branches are merge-ready with the warnings above noted for follow-up.
