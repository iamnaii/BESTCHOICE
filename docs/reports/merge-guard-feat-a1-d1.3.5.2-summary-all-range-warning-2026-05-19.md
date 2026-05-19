# Merge Guard Report — feat/a1-d1.3.5.2-summary-all-range-warning

**Date:** 2026-05-19  
**Branch:** `feat/a1-d1.3.5.2-summary-all-range-warning`  
**Author:** iamnaii (akenarin.ak@gmail.com)  
**Last commit:** `a29b6fdf` feat(a1): D1.3.5.3 — summary_pagination_size for ExpenseDailySummaryPage docs table (#920)  
**Base:** `origin/main`

---

## File Changes Summary

**545 files changed, 1,912 insertions(+), 81,174 deletions(-)**

This is a large compound branch. It includes the targeted feature work (D1.3.5.1/D1.3.5.2/D1.3.5.3) as well as a **major rollback of SP7.1 dual-Prisma scaffolding** — removing EntityScopeGuard, EntityScopeMiddleware, MaintenanceModeMiddleware, dual-Prisma CLI scripts, and associated e2e specs that were pre-staged on this branch before SP7.1 was formally split out.

Key categories of change:

| Category | Scale |
|----------|-------|
| D1.3.5.1–3 feature (actual branch goal) | ~100 lines net |
| SP7.1 rollback (guards, middleware, CLIs, e2e specs) | ~1,500 lines removed |
| Docs/plan cleanup (superpowers plans deleted) | ~70,000 lines removed |
| Service refactoring (settings, accounting, expense-documents) | ~3,000 lines net |
| New pages (TaxReportsPage, CrmPipelinePage) | ~400 lines |

---

## Issues Found

### Critical
_None_

### Warning

**[WARN-1]** `apps/web/src/pages/TaxReportsPage.tsx` — Two new `useMutation` blocks (`generateMutation` for PP30 and for generic report types) both call `toast.success()` on success but **neither calls `queryClient.invalidateQueries()`**. If any query caches a list of generated reports (e.g. a "Generated Reports" tab), those lists will show stale data after the user generates a new report.

```tsx
// Current — missing invalidation
onSuccess: () => {
  toast.success('สร้างรายงาน ภ.พ.30 สำเร็จ');
},
```

If the mutation only triggers a server-side job (no cached list to refresh), this is acceptable and should be documented with a comment. Otherwise add:
```tsx
onSuccess: () => {
  toast.success('สร้างรายงาน ภ.พ.30 สำเร็จ');
  queryClient.invalidateQueries({ queryKey: ['tax', 'reports'] });
},
```

**[WARN-2]** `apps/api/src/modules/settings/settings.service.ts` is refactored with 1,629 line change. The diff removes significant service logic — manual review of the service's final state is recommended to confirm no business logic was inadvertently dropped during the cleanup/consolidation.

### Info

**[INFO-1]** `apps/web/src/pages/CrmPipelinePage.tsx` — Uses `any` type for API response and lead array items:
```tsx
api.get('/crm/leads', ...).then((r: any) => r.data)
leads.map((lead: any) => { ... })
```
Should be typed with a proper `Lead` interface. Low impact as CRM pipeline is not a financial/legal module, but `any` bypasses TypeScript's type safety net.

**[INFO-2]** `apps/api/e2e/approval-workflow.e2e-spec.ts` and `sp7-1-dual-prisma.e2e-spec.ts` are deleted. These were SP7.1 pre-staged e2e specs. The deletion is intentional (SP7.1 is being managed separately), but worth confirming these tests were not covering production-shipped functionality that now lacks coverage.

**[INFO-3]** `apps/api/src/guards/entity-scope.guard.ts`, `apps/api/src/middleware/entity-scope.middleware.ts`, and `apps/api/src/middleware/maintenance-mode.middleware.ts` are all deleted. Verify these were SP7.1-only scaffolding and not yet wired into production guards before confirming safe to remove.

**[INFO-4]** Branch scope is very large (545 files). The actual D1.3.5.2/D1.3.5.3 feature is approximately 100 lines across `ExpenseDailySummaryPage.tsx` and `useUiFlags.ts`. Consider splitting the SP7.1 rollback and service refactoring into separate PRs for cleaner review history.

---

## Security Check

- No new unguarded controllers detected. Modified controllers retain `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`.
- `payments.findMany` in the refactored tax report service includes `deletedAt: null` — confirmed safe.
- No hardcoded secrets.
- No unparameterized `$queryRaw` calls (only `$queryRaw\`SELECT 1\`` health check, parameterized as template literal).
- No raw `fetch()` in new frontend code.

---

## D1.3.5.1/D1.3.5.2/D1.3.5.3 Feature Quality

The targeted feature (`ExpenseDailySummaryPage`) is clean:
- `?range=all` URL param opt-in with warning banner — non-breaking, additive.
- Banner uses semantic tokens (`border-warning/40`, `bg-warning/10`, `text-warning`) — correct.
- `role="alert"` on the warning banner — a11y correct.
- `summaryPaginationSize * (1 + extraPages)` pagination math is straightforward and correct.
- `summaryAllRangeWarning` flag read from `useUiFlags()` — owner-configurable via SystemConfig.

---

## Recommendation: **REVIEW**

The D1.3.5.2/D1.3.5.3 feature itself is clean and approvable. However, the branch carries a substantial SP7.1 rollback and service-layer refactoring that warrants human review before merge:

1. **Resolve WARN-1** — add `invalidateQueries` to `TaxReportsPage.tsx` mutations or document why it is intentionally absent.
2. **Confirm WARN-2** — verify `settings.service.ts` refactor did not drop live business logic.
3. **Confirm INFO-2/INFO-3** — the deleted e2e specs and SP7.1 guards were not protecting production-shipped features.
4. Consider splitting into a focused D1.3.5.x PR + a separate SP7.1 cleanup PR for cleaner history.
