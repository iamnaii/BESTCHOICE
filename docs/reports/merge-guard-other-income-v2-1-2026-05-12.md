# Pre-Merge Guard Report — Other Income v2.1 Branches
**Date**: 2026-05-12  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed** (3 most recently active):

| Branch | Latest commit | Author |
|--------|--------------|--------|
| `feat/other-income-v2-1-combined` | test(other-income): TemplateService mock CI fix | Akenarin Kongdach |
| `feat/other-income-v2-1-pr3-templates` | fix(other-income): import formatThaiDateShort + click-outside-close | Akenarin Kongdach |
| `feat/other-income-v2-1-pr2-maker-checker` | fix(other-income): replace window.prompt with RejectModal | Akenarin Kongdach |

---

## Branch 1: `feat/other-income-v2-1-combined`
**33 files changed, +2,499 / -50 lines**  
Combines PR-2 (Maker-Checker) + PR-3 (Templates) into one integration branch.

### File Changes Summary
- New backend: `other-income.controller.ts` (+112), `other-income.service.ts` (+213), `template.service.ts` (+143), `validation.service.ts`, `template-vars.util.ts`
- New DTOs: `approve-other-income.dto.ts`, `reject-other-income.dto.ts`, `request-approval.dto.ts`, `create-template.dto.ts`, `update-template.dto.ts`
- New frontend pages: `OtherIncomeTemplatesPage.tsx` (188 lines), `OtherIncomePendingApprovalPage.tsx` (81 lines)
- Modified: `OtherIncomeViewPage.tsx` (now 725 lines), `OtherIncomeEntryPage.tsx`
- Tests: `maker-checker.spec.ts` (369 lines), `template.service.spec.ts` (209 lines), `other-income.service.spec.ts` (203 lines)

### Issues

#### ⚠️ WARNING — `Number()` on Decimal financial fields (template.service.ts:71-75)

`createFromDoc()` serialises `OtherIncomeItem` Decimal fields to JSON using `Number()`:

```ts
// apps/api/src/modules/other-income/services/template.service.ts:71-75
quantity: Number(it.quantity),
unitAmount: Number(it.unitAmount),
discountAmount: Number(it.discountAmount),
vatPct: Number(it.vatPct),
whtPct: Number(it.whtPct),
```

`unitAmount` and `discountAmount` are `@db.Decimal(15, 2)` money columns. Conversion to `Number` is safe at 2 d.p. but violates the project rule ("ห้ามใช้ `Number()` สำหรับจำนวนเงิน — ใช้ `Prisma.Decimal`"). Prefer `.toFixed(2)` or `it.unitAmount.toString()` when writing to the `itemsJson` JSON column.

**Fix**: replace `Number(it.X)` with `parseFloat(it.X.toFixed(2))` or keep as strings and parse when reading back.

#### ⚠️ WARNING — Missing FK indexes on new `approverId` / `rejectedById` columns

`OtherIncome` schema adds two FK columns (`approverId`, `rejectedById`) with no `@@index`. The pending approval page filters `WHERE status = 'READY'`; if approvers also query by `approverId`, those scans will be sequential on the full table.

**Fix**: Add to `OtherIncome` model in schema + migration:
```prisma
@@index([approverId])
@@index([rejectedById])
```

#### ⚠️ WARNING — `any` type in template list `where` clause

`template.service.ts#list()` uses `const where: any = …`. Prefer `Prisma.OtherIncomeTemplateWhereInput` for type-safe filtering.

#### ℹ️ INFO — `service.ts` at 1 146 lines

`other-income.service.ts` is 1 146 lines. Consider extracting maker-checker logic into a dedicated `MakerCheckerService` (alongside the already-extracted `TemplateService` and `ValidationService`).

#### ℹ️ INFO — `sessionStorage` for template prefill

`OtherIncomeTemplatesPage` writes the selected template payload to `sessionStorage('oi-template-prefill')` and redirects. This bypasses React Query and could stale if the user opens two tabs. Low-risk for the current use case; document this as an intentional shortcut.

#### ✅ PASS — Security
- Controller has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level.
- All new endpoints have `@Roles(…)` decorators.
- No raw `$queryRaw`, no hardcoded secrets, no raw `fetch()` in frontend.
- `FINANCE_MANAGER` role confirmed present in `UserRole` enum.

#### ✅ PASS — DTOs
- All new DTOs have class-validator decorators with Thai messages.
- `RequestApprovalDto` intentionally empty (documented with comment).

#### ✅ PASS — Soft delete
- `deletedAt: null` present on all new `findMany` / `findFirst` queries that could return soft-deleted rows.

#### ✅ PASS — Money precision
- Financial aggregation in `validation.service.ts` uses `Prisma.Decimal` correctly.
- `where: any` in `list()` doesn’t affect money calculations.

### Recommendation: **REVIEW** (fix 2 warnings before merge)

---

## Branch 2: `feat/other-income-v2-1-pr3-templates`
**18 files changed, +1,136 / -7 lines**  
Adds template CRUD endpoints + `TemplatePickerCombobox`, `SaveAsTemplateModal`, `RenameTemplateModal` UI.

### Issues

#### ⚠️ WARNING — Same `Number()` on Decimal issue (template.service.ts:71-75)
Same as Branch 1 — `createFromDoc()` uses `Number()` on `unitAmount`, `discountAmount`, etc.

#### ✅ PASS — Guards, DTOs, soft delete, no raw fetch
All new controller methods have `@Roles`. New DTOs validated. `deletedAt: null` present on all filtered queries.

### Recommendation: **REVIEW** (same Number() fix needed)

---

## Branch 3: `feat/other-income-v2-1-pr2-maker-checker`
**16 files changed, +1,053 / -26 lines**  
Introduces `READY` / `APPROVED` lifecycle states, `requestApproval` / `approve` / `reject` endpoints, `OtherIncomePendingApprovalPage`, and `RejectModal` component.

### Issues

#### ⚠️ WARNING — Missing FK indexes on `approverId` / `rejectedById`
Schema adds both columns with no `@@index`. (Same as Branch 1.)

#### ✅ PASS — Maker-Checker business logic
- Segregation of duties enforced: `createdById === userId` → 403 on approve (V9 check).
- State machine guards: status checks before transitions.
- `window.prompt` properly replaced with `RejectModal`.

#### ✅ PASS — Guards & roles
- New endpoints (`request-approval`, `approve`, `reject`) all have `@Roles`.
- Class-level guard unchanged: `@UseGuards(JwtAuthGuard, RolesGuard)`.

#### ✅ PASS — Migration
- `20260920000000_add_other_income_maker_checker/migration.sql` adds all new columns as nullable (backward-compat).
- FK constraints added correctly.
- No `DROP COLUMN` or destructive statements.

#### ✅ PASS — Frontend
- All mutations use `api.post()` (not raw `fetch`).
- All mutations have `queryClient.invalidateQueries()` in `onSuccess`.
- No hardcoded colors or `text-gray-*` tokens.

### Recommendation: **REVIEW** (add FK indexes)

---

## Summary

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `feat/other-income-v2-1-combined` | 0 | 3 | 2 | **REVIEW** |
| `feat/other-income-v2-1-pr3-templates` | 0 | 1 | 0 | **REVIEW** |
| `feat/other-income-v2-1-pr2-maker-checker` | 0 | 1 | 0 | **REVIEW** |

**No Critical issues found.** All 3 branches are blocked only on Warning-level items:

1. **`Number()` on Decimal money fields** in `template.service.ts:71-75` (affects combined + pr3). Fix: use `.toFixed(2)` / `.toString()` for JSON serialisation.
2. **Missing `@@index([approverId])` and `@@index([rejectedById])`** on `OtherIncome` model (affects combined + pr2). Fix: add 2-line index declarations + migration.

Both fixes are straightforward. Once applied, all 3 branches can be approved for merge.
