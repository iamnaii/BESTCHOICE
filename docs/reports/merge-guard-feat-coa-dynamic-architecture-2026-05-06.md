# Merge Guard Report — feat/coa-dynamic-architecture

**Date**: 2026-05-06  
**Branch**: `feat/coa-dynamic-architecture`  
**Author**: Akenarin Kongdach  
**Commits ahead of main**: 17  
**Recommendation**: ✅ APPROVE (1 Warning to acknowledge)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `accounting.service.ts` | +103 | -80 | Phase A.6: boot validator, `resolveAccountCode`, enum→string |
| `accounting.service.spec.ts` | +29 | 0 | Boot validator tests |
| `accounting.controller.ts` | +2 | -2 | `ExpenseCategory` → `string` propagation |
| `accounting/dto/expense.dto.ts` | +4 | -4 | `@IsEnum(ExpenseCategory)` → `@IsString()` |
| `chart-of-accounts.service.ts` | +37 | 0 | New `findGrouped()` method |
| `chart-of-accounts.controller.ts` | +7 | 0 | New `GET /grouped` endpoint |
| `chart-of-accounts/dto/coa-grouped.dto.ts` | +33 | 0 | New DTO + interfaces |
| `chart-of-accounts.service.spec.ts` | +59 | 0 | Tests for `findGrouped` |
| `web/src/hooks/useCoa.ts` | +58 | 0 | New React hook (`useCoaGroups`, `useCoaByCodes`) |
| `ExpensesPage.tsx` | +50 | -90 | Dynamic CoA dropdown, removes hardcoded enum map |
| `AssetManagementPage/components/AssetForm.tsx` | +10 | -15 | Dynamic asset/depreciation account selectors |
| `prisma/schema.prisma` | +1 | -1 | Minor field tweak |
| `prisma/.../migration.sql` | +9 | 0 | Schema migration |
| `docs/superpowers/plans/*.md` | +916 | 0 | Design docs only |

**Total**: 15 files, +1290 / -145 lines

---

## Issues

### 🟡 Warning

#### W-001 — Triple `as any` cast in `accounting.service.ts`
**Files**: `apps/api/src/modules/accounting/accounting.service.ts` (lines ~209, ~228, ~239)  
**Detail**: Three `category: dto.category as any` casts are added with comment `// Phase A.6: String after migration; cast until Prisma client regenerates`. This is a deliberate migration shim, but:
- `as any` disables type checking on the `category` field for `create`, `update`, and `findMany` paths
- If Prisma client is not regenerated before deploy, the cast silences a real type error instead of surfacing it

**Recommendation**: Ensure `prisma generate` is run before CI build, or add a schema TODO comment to remove casts once client is regenerated. Consider wrapping in a typed helper instead of raw `as any`.

---

### ℹ️ Info

#### I-001 — `resolveAccountCode` silently returns `null`
**File**: `apps/api/src/modules/accounting/accounting.service.ts` (~L149-152)  
**Detail**: `resolveAccountCode(category)` returns `null` for unrecognised category strings. The callers fall back to `|| expense.accountCode` or `|| null`. No runtime warning is emitted when null is returned, so mis-typed category strings fail silently at JE-post time rather than at input time. Low risk because input is now validated as `@IsString() @IsNotEmpty()` + the boot validator catches mapping gaps, but a `this.logger.warn(...)` at the null path would improve observability.

#### I-002 — `useCoa.ts` duplicates interface types from backend DTO
**File**: `apps/web/src/hooks/useCoa.ts` (~L1-25)  
**Detail**: `CoaAccountRow`, `CoaGroup`, `CoaGroupedResponse` are re-declared in the frontend hook verbatim. Not a bug, but worth extracting to `packages/shared/` eventually.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ `ChartOfAccountsController` existing class-level guard covers new `grouped` endpoint |
| New endpoints have `@Roles(...)` | ✅ `@Roles('OWNER','BRANCH_MANAGER','FINANCE_MANAGER','ACCOUNTANT','SALES')` on `grouped` |
| Money fields use `Prisma.Decimal` (no `Number()`) | ✅ No financial calculations in this branch |
| New queries include `deletedAt: null` | ✅ `findGrouped` initialises `where` with `deletedAt: null`; `onModuleInit` uses `deletedAt: null` |
| No hardcoded secrets | ✅ |
| No raw `$queryRaw` with interpolation | ✅ |
| Frontend uses `api.get/post` (no raw `fetch`) | ✅ |

---

## Recommendation: ✅ APPROVE

The branch cleanly implements the Phase A.6 CoA dynamic architecture. Guards, roles, soft-delete filters, and test coverage are all present. The only actionable item is W-001 (triple `as any` cast) which should be resolved by regenerating the Prisma client before deploy — the comments already document this intent.
