# Merge Guard Report — feat/coa-dynamic-architecture

**Date**: 2026-05-06  
**Branch**: `feat/coa-dynamic-architecture`  
**Author**: Akenarin Kongdach  
**Commits**: 5  
**Recommendation**: 🚫 BLOCK

---

## File Changes Summary

| File | +Added | -Removed | Notes |
|------|--------|----------|-------|
| `apps/api/prisma/migrations/20260803000000_phase_a6_expense_category_string/migration.sql` | +9 | 0 | ALTER COLUMN TEXT |
| `apps/api/prisma/schema.prisma` | +1 | -1 | `category` type change |
| `apps/api/src/modules/accounting/accounting.controller.ts` | +1 | -1 | `category` param type |
| `apps/api/src/modules/accounting/accounting.service.spec.ts` | +29 | 0 | Boot validator tests |
| `apps/api/src/modules/accounting/accounting.service.ts` | +27 | -17 | `onModuleInit` + `resolveAccountCode` |
| `apps/api/src/modules/accounting/dto/expense.dto.ts` | +3 | -2 | `category` `@IsEnum` → `@IsString` |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.controller.ts` | +7 | 0 | New `GET /grouped` endpoint |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts` | +59 | 0 | New service tests |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts` | +37 | 0 | `findGrouped()` method |
| `apps/api/src/modules/chart-of-accounts/dto/coa-grouped.dto.ts` | +33 | 0 | New DTO + interfaces |
| `apps/web/src/hooks/useCoa.ts` | +58 | 0 | `useCoaGroups` + `useCoaByCodes` hooks |
| `apps/web/src/pages/AssetManagementPage/components/AssetForm.tsx` | +11 | -11 | Dynamic CoA dropdowns |
| `apps/web/src/pages/ExpensesPage.tsx` | +28 | -68 | Dynamic category selector |
| `docs/superpowers/plans/*.md` | +916 | 0 | Design docs |

**Total**: 14 code files, 1290 insertions, 145 deletions.

---

## What This Branch Does

Phase A.6 architectural change: converts `Expense.category` from a static Prisma enum (`ExpenseCategory`) to a free-form `String`, allowing the field to store either legacy enum keys (e.g. `ADMIN_SALARY`) or live CoA account codes (e.g. `53-1101`). The frontend dropdowns now load dynamically from the CoA via a new `GET /chart-of-accounts/grouped` endpoint.

---

## Issues Found

### 🚫 Critical

**C-1 — Frontend no longer sends `accountType` but DTO still requires it**

`CreateExpenseDto.accountType` remains a required field (no `@IsOptional()`):

```typescript
// apps/api/src/modules/accounting/dto/expense.dto.ts
export class CreateExpenseDto {
  @IsString()
  branchId: string;

  @IsEnum(ExpenseAccountType)   // ← still required, not @IsOptional()
  accountType: ExpenseAccountType;

  @IsString()
  @IsNotEmpty()
  category: string;
  // ...
}
```

But `ExpensesPage.tsx` no longer sends `accountType` in the form submission:

```typescript
// apps/web/src/pages/ExpensesPage.tsx (new emptyForm)
const emptyForm = {
  branchId: '', category: '',    // ← accountType removed
  description: '', amount: '', ...
};

// form save
saveMutation.mutate({
  data: {
    branchId: form.branchId || branches[0]?.id,
    // accountType: form.accountType  ← removed
    category: form.category, ...
  },
});
```

**Impact**: Every expense creation request from the UI will fail with a 400 Bad Request validation error. This is a complete regression of the expense create flow.

**Fix options**:
1. Add `@IsOptional()` to `accountType` in `CreateExpenseDto` and derive it from category via `CATEGORY_ACCOUNT_MAP` in `createExpense()`. OR
2. Restore the `accountType` field in the frontend form and derive it client-side from the selected CoA code group prefix. OR
3. Remove `accountType` from the DTO entirely if the service can fully derive it from `category`.

Option 1 (make it optional + server-derive) is the cleanest given the new architecture.

---

### ⚠️ Warning

**W-1 — Boot validator blocks startup if CoA not seeded**

`AccountingService.onModuleInit()` queries `chartOfAccount` on every app start and throws if any code in `CATEGORY_CODE_MAP` is missing. While this is good practice for catching misconfiguration, it means:
- A fresh deployment with an empty DB (pre-seeding) will fail to start.
- The migration `20260803000000` alters `expenses.category` to TEXT — if this migration runs before the 99-account CoA seeding, the next app restart will throw.

Ensure the deploy sequence is: `prisma migrate deploy` → CoA seed → app start.

**W-2 — `category as any` casts are not temporary tech debt tracked**

Three separate `// eslint-disable-next-line @typescript-eslint/no-explicit-any` + `category as any` casts in `accounting.service.ts` with comment "until Prisma client regenerates". The Prisma client IS regenerated in CI (`prisma generate`), so these casts will not automatically go away after the migration is applied — they're needed because the schema type changed from `ExpenseCategory` enum to `String` but the service accesses `dto.category` typed as `string` while Prisma still expects the old enum type until `generate` runs.

The casts are safe functionally but should be removed once the migration is applied and the Prisma client is regenerated. Track as post-deploy cleanup.

**W-3 — `emptyForm.category` starts as `''`, relies on async CoA load**

```typescript
const emptyForm = {
  branchId: '', category: '',   // starts empty
  ...
};

// set first CoA account once data loads (new forms only)
useEffect(() => {
  if (groups.length > 0 && !form.category && !editingExpense) {
    setForm((f) => ({ ...f, category: groups[0].accounts[0]?.code ?? '' }));
  }
}, [groups, form.category, editingExpense]);
```

If the user opens the expense form before the CoA query resolves and immediately submits, `category` will be empty string, failing the `@IsNotEmpty()` validation. The save button should be disabled while `groups.length === 0`, or a loading state should be shown.

### ℹ️ Info

**I-1 — `CoaAccountRow` interface duplicated**

`CoaAccountRow`, `CoaGroup`, and `CoaGroupedResponse` are defined in both:
- `apps/api/src/modules/chart-of-accounts/dto/coa-grouped.dto.ts` (TypeScript interfaces)
- `apps/web/src/hooks/useCoa.ts` (identical TypeScript interfaces)

These should live in `packages/shared/` and be imported from there to avoid drift.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controller guards (`@UseGuards(JwtAuthGuard)`) | ✅ Present on class |
| New endpoint `GET /grouped` has `@Roles` | ✅ `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` |
| `Number()` on money fields | ✅ No new money fields — uses `Prisma.Decimal` |
| Missing `deletedAt: null` in new queries | ✅ `findGrouped` includes `deletedAt: null` |
| Hardcoded secrets/API keys | None |
| SQL injection (`$queryRaw`) | None |
| `codePrefix` query param validated via `@Matches(/^\d{2}(-\d{0,4})?$/)` | ✅ Pattern validation present |

---

## Recommendation

**🚫 BLOCK** — The C-1 mismatch between the DTO and frontend will cause all expense creation to fail. This must be resolved before merge.

**Required fixes before merge**:
1. Make `accountType` optional in `CreateExpenseDto` (or remove it) and derive from category in `createExpense()` service method
2. Address W-3: disable the save button while CoA data is loading

**Suggested follow-up (not blocking)**:
- W-1: document deploy sequence in the deploy runbook
- W-2: schedule Prisma-cast cleanup as post-deploy task
- I-1: move shared interfaces to `packages/shared`
