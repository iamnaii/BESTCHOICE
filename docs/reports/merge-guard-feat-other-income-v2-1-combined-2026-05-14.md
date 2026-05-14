# Merge Guard Report — feat/other-income-v2-1-combined

**Date**: 2026-05-14  
**Branch**: `feat/other-income-v2-1-combined`  
**Author**: Akenarin Kongdach  
**Last Commit**: 2026-05-12 14:14 +07:00  
**Commits Ahead of main**: 59  

---

## File Changes Summary

| Metric | Value |
|--------|-------|
| Files changed | 33 |
| Insertions | +2,499 |
| Deletions | -50 |

**Key areas touched**:
- `other-income.controller.ts` — 9 new endpoints (templates CRUD, maker-checker, approve/reject)
- `other-income.service.ts` — maker-checker, templates, approval flows
- New service: `template.service.ts` — `OtherIncomeTemplateService`
- New service: `template-vars.util.ts` — template variable interpolation
- Frontend: `OtherIncomeTemplatesPage.tsx`, `OtherIncomeViewPage.tsx`, `OtherIncomeEntryPage.tsx`
- Frontend: New components — `RejectModal`, `SaveAsTemplateModal`, `RenameTemplateModal`, `TemplatePickerCombobox`
- New route: `/other-income/pending-approval` (pending approval queue)

---

## Issues Found

### Critical

None found.

### Warning

**W-1**: `Number()` on Decimal money fields in `createFromDoc` template snapshot

- **File**: `apps/api/src/modules/other-income/other-income.service.ts` (createFromDoc method)
- **Lines**: 
  ```ts
  unitAmount: Number(it.unitAmount),
  discountAmount: Number(it.discountAmount),
  ```
- **Context**: When saving a document as a template, `OtherIncomeItem` Decimal fields are serialized into a `itemsJson: Json` column via `Number()`. The values are template defaults — the user will review and modify them before posting any new document from the template. No financial arithmetic happens on these values directly.
- **Actual risk**: Low (template defaults in JSON, not used in journal calculations). However, `vatPct` and `whtPct` are also converted via `Number()`, which is correct since they are percentage integers. The `unitAmount` and `discountAmount` are money amounts.
- **Fix**: Use `.toString()` instead of `Number()` for `unitAmount` and `discountAmount` to serialize as exact decimal strings:
  ```ts
  unitAmount: it.unitAmount.toString(),
  discountAmount: it.discountAmount.toString(),
  ```
  Update `TemplateItem` type to `unitAmount: string | number` and ensure the entry form handles both.

**W-2**: `const where: any = { deletedAt: null }` in template service

- **File**: `apps/api/src/modules/other-income/services/template.service.ts` (list method)
- **Issue**: `any` type on a Prisma `where` clause bypasses type checking. Should use `Prisma.OtherIncomeTemplateWhereInput`.
- **Fix**:
  ```ts
  const where: Prisma.OtherIncomeTemplateWhereInput = { deletedAt: null };
  ```

---

### Info

**I-1**: `onSuccess: (doc: any) =>` in OtherIncomeEntryPage

- **File**: `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`
- One `useMutation` callback is untyped. Low impact but worth typing with the `OtherIncome` response shape from `@/lib/otherIncome.types.ts`.

**I-2**: `OtherIncomeEntryPage.tsx` is 1,234 lines

Entry page now handles create, edit, template loading, draft, and submit-for-approval flows. Consider splitting the "template picker" section into a hook (`useTemplateLoader`) to reduce the page component size.

---

## Positive Observations

- **Guards**: All 9 new endpoints have `@Roles(...)` with appropriate role restrictions (`OWNER`-only for approve/reject; `OWNER | FINANCE_MANAGER | ACCOUNTANT` for most reads/writes).
- **Class-level guard**: `@UseGuards(JwtAuthGuard, RolesGuard)` present at controller class level — inherited by all methods.
- **deletedAt filter**: All new `findMany`/`findFirst` queries include `{ deletedAt: null }`.
- **No raw SQL / `$queryRaw`**.
- **No hardcoded secrets**.
- **New endpoints with proper DTO validation**: `CreateTemplateDto`, `UpdateTemplateDto`, `CreateTemplateFromDocDto` — all use class-validator with Thai messages.
- **Cache invalidation**: All mutations call `queryClient.invalidateQueries()` with correct query keys.
- **Template service isolation**: `OtherIncomeTemplateService` is correctly isolated with its own `@Injectable()` and wired into `OtherIncomeModule` — clean module structure.

---

## Recommendation

**REVIEW** — One warning around `Number()` on money Decimal fields when snapshotting into a JSON template. The risk is low (template defaults only, not used in journal arithmetic), but it violates the Decimal convention and could cause subtle display drift if amounts contain >2 significant decimal places. Fix W-1 and W-2 before merge.

Note: This branch is likely a base / staging branch (59 commits, combined PRs 1+2+3). Verify that the individual PR branches (`feat/other-income-v2-1-pr1-bug-fixes`, `feat/other-income-v2-1-pr2-maker-checker`, `feat/other-income-v2-1-pr3-templates`) are the actual merge targets, not this combined branch, to avoid reviewing history twice.
