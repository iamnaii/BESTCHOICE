# Merge Guard Report — feat/expense-documents-all

**Date**: 2026-05-10  
**Branch**: `feat/expense-documents-all`  
**Author**: Akenarin Kongdach  
**Commits**: 59 commits ahead of main  
**Diff size**: 96 files changed, +16,624 / −3,931 lines

---

## Summary

Full expense-documents module (all 6 PRs consolidated): new `ExpenseDocumentsController`, `ExpenseTemplatesController`, service layer, DTOs, React pages (ExpensesPage, ExpenseFavoritesPage, ExpenseDailySummaryPage, ExpenseDocumentNewPage), and form components (CreditNoteForm, PayrollForm, SettlementForm). Also includes significant refactor/trim of `accounting.service.ts` + `accounting.service.spec.ts`, and a new `wipe-expenses.cli.ts` CLI tool.

Latest commit: `44ec8fec` — test(credit-note): split type-guard test from prefix-guard test (2026-05-10 23:42)

---

## Issues by Severity

### Critical — None found

- `ExpenseDocumentsController` — `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level, `@Roles(...)` on every method. ✓
- `ExpenseTemplatesController` — `@UseGuards(JwtAuthGuard, RolesGuard)` at class level, `@Roles(...)` on every method. ✓
- No `Number()` casts on Decimal financial fields in **production service code**. ✓
- All new Prisma queries use `where: { deletedAt: null }`. ✓
- No hardcoded secrets or API keys. ✓
- `$queryRaw` in `wipe-expenses.cli.ts` uses tagged template literals (parameterized) — safe. ✓
- All new React mutations call `queryClient.invalidateQueries()` on success. ✓

---

### Warning

**W-1: `Number(l.debit)` / `Number(l.credit)` in test spec files**

Files: `expense-documents.service.spec.ts`, `payroll.service.spec.ts`, `vendor-settlement.template.spec.ts`

```ts
// Test-only balance assertion:
const drSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
const crSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
expect(drSum).toBeCloseTo(crSum, 2);
```

Test-only context — not in production code. `toBeCloseTo(x, 2)` tolerates float imprecision so tests won't produce false positives. However, the project's "never `Number()` on money fields" standard should apply to test assertions too for consistency. Prefer Decimal accumulation in tests.

---

### Info

**I-1: Large files**

- `accounting.service.ts`: 1,740 lines (refactored from larger size — net improvement on this branch)
- `accounting.service.spec.ts`: 1,365 lines

These are pre-existing files that also received significant deletions in this PR. No action required.

**I-2: `Number(e.target.value)` in React component**

```tsx
onChange={(e) => setYear(Number(e.target.value))}
onChange={(e) => setMonth(Number(e.target.value))}
```

In `ExpenseDailySummaryPage.tsx`. These convert HTML `<select>` string values to integers for year/month pickers — correct DOM-to-state conversion, not a financial calculation.

---

## Security Checks

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on all new controllers | ✅ |
| `@Roles()` on all new controller methods | ✅ |
| `deletedAt: null` in new Prisma queries | ✅ |
| No hardcoded secrets | ✅ |
| No unparameterized `$queryRaw` | ✅ |
| No raw `fetch()` in new React components | ✅ (all use `api.get/post`) |
| `queryClient.invalidateQueries()` after mutations | ✅ |

---

## Recommendation: **APPROVE**

No critical security or data-integrity issues. Both new controllers are properly guarded. Financial calculations in service code use `Prisma.Decimal` correctly. The only actionable item is a low-severity test-code pattern (W-1) which does not block merge.

**Suggested follow-up (non-blocking)**:
- Replace `Number(l.debit/credit)` in spec reduce assertions with Decimal accumulation for consistency.
