# Merge Guard Report — feat/other-income-v2-1-combined

**Date**: 2026-05-14  
**Branch**: `feat/other-income-v2-1-combined`  
**Author**: Akenarin Kongdach  
**Commits**: 5 (PR-1 bug fixes B1–B6 → PR-2 maker-checker → PR-3 templates + CI fixes)  
**Diff size**: 33 files changed, 2,499 insertions(+), 50 deletions(−)

---

## File Changes Summary

Full-stack feature spanning backend service/controller and new frontend pages:

| Area | Files | Nature |
|------|-------|--------|
| Backend controller | `other-income.controller.ts` | 10 new endpoints (templates CRUD, maker-checker, approval flow) |
| Backend services | `other-income.service.ts`, `template.service.ts`, `template-vars.util.ts`, `validation.service.ts` | Template management, maker-checker, request/approve/reject |
| Frontend pages | `OtherIncomeEntryPage.tsx`, `OtherIncomeListPage.tsx`, `OtherIncomePendingApprovalPage.tsx`, `OtherIncomeTemplatesPage.tsx`, `OtherIncomeViewPage.tsx` | Approval workflow UI, template picker, pending queue |
| Frontend components | `ItemsTable.tsx`, `RejectModal.tsx`, `RenameTemplateModal.tsx`, `SaveAsTemplateModal.tsx`, `TemplatePickerCombobox.tsx` | New UI components |
| Routing | `App.tsx` | New routes for templates + pending approval pages |
| API client | `apps/web/src/lib/otherIncome.ts` | Template API methods |

---

## Guard Checks

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ Class-level guard confirmed on `OtherIncomeController` |
| All new endpoints have `@Roles(...)` | ✅ All 10 new endpoints have `@Roles(...)` |
| `Number()` on money/Decimal fields | ⚠️ See W-2 below |
| `deletedAt: null` in new queries | ⚠️ See W-1 below — missing on `findMany` in `template.service.ts` |
| Hardcoded secrets / API keys | ✅ None |
| Raw `fetch()` in frontend | ✅ All calls use `otherIncomeApi.*` / `api.*` |
| `queryClient.invalidateQueries()` after mutations | ✅ Present after all stateful mutations |
| DTO validation decorators (Thai messages) | ✅ Present on new DTOs |
| SQL injection (`$queryRaw` unparameterized) | ✅ None found |

---

## Issues Found

### Critical
_None._

### Warning

**W-1 — Missing `deletedAt: null` in `template.service.ts` `list()` query**

```ts
// apps/api/src/modules/other-income/services/template.service.ts
const where: Prisma.OtherIncomeTemplateWhereInput = {};  // ← missing deletedAt: null
if (query.favoritesOnly) where.isFavorite = true;
if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

return this.prisma.otherIncomeTemplate.findMany({ where, ... });
```

Soft-deleted templates will appear in search results. All other `findFirst` calls in the same file correctly filter `{ id, deletedAt: null }`, making this inconsistent.

**One-line fix**:
```ts
const where: Prisma.OtherIncomeTemplateWhereInput = { deletedAt: null };
```

---

**W-2 — `Number()` on money fields in JSONB template storage**

```ts
// template.service.ts — createFromDoc()
const itemsJson: TemplateItem[] = doc.items.map((it) => ({
  quantity:       Number(it.quantity),
  unitAmount:     Number(it.unitAmount),    // ← money field
  discountAmount: Number(it.discountAmount), // ← money field
  vatPct:         Number(it.vatPct),
  whtPct:         Number(it.whtPct),
}));
```

`unitAmount` and `discountAmount` are `@db.Decimal(12,2)` fields. Converting to JS `Number` before JSONB storage can introduce floating-point drift (e.g., `1234.565` → `1234.5649999...`). Templates are user-editable before posting, so no direct journal impact at save time — but downstream rounding could silently produce wrong values.

**Recommended fix**: store as string (`String(it.unitAmount)`) and parse back with `new Prisma.Decimal(item.unitAmount)` when applying the template.

---

### Info

| # | File | Issue |
|---|------|-------|
| I-1 | `OtherIncomeTemplatesPage.tsx`, `TemplatePickerCombobox.tsx` | Uses `useMutation_` as a variable name (applies template → navigate). Functional but reduces readability; `applyTemplateMutation` or similar would be clearer. |
| I-2 | `other-income.controller.ts` | File now has inline comments marking route ordering constraints (`// CRITICAL: must stay before any :id route`). These are correct and valuable; worth preserving. |

---

## Recommendation: **REVIEW**

Two warnings block clean approval:

1. **W-1** — One-line fix. Blocks merge because soft-deleted templates surface in search.  
2. **W-2** — Low risk (templates are drafts), but violates the project's money-field Decimal rule. Fix or document as accepted risk with a code comment explaining why `Number()` is intentional here.
