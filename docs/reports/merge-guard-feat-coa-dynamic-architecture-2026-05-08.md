# Merge Guard Report — feat/coa-dynamic-architecture

**Branch**: `feat/coa-dynamic-architecture`  
**Date**: 2026-05-08  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Merge base**: `9849213f` (PR #771)  
**Commits ahead of main**: 4  
**Recommendation**: 🟡 REVIEW

---

## File Changes Summary

| Area | Files | Description |
|------|-------|-------------|
| New module: `chart-of-accounts` | controller, service, 2 DTOs, spec | Dynamic CoA CRUD + grouped/by-codes endpoints |
| `accounting.service.ts` | +31 / -3 | CATEGORY_CODE_MAP fix + boot validator |
| `accounting.service.spec.ts` | +26 | Boot validator tests |
| `accounting.controller.ts` | -1 | `category` type: `ExpenseCategory` → `string` |
| `accounting/dto/expense.dto.ts` | minor | Category field type update |
| `apps/web/src/hooks/useCoa.ts` | new | `useCoaGroups` / `useCoa` React Query hooks |
| `apps/web/src/pages/ExpensesPage.tsx` | moderate | Dynamic categories from CoA |
| `apps/web/src/pages/AssetManagementPage/components/AssetForm.tsx` | moderate | Dynamic CoA dropdowns |

**Total TS/TSX**: 15 files, ~1,290 insertions, ~145 deletions

---

## What Changed

- Chart of Accounts is now queryable via `GET /chart-of-accounts` (with type/status/q filters), `GET /chart-of-accounts/by-codes`, and `GET /chart-of-accounts/grouped`
- `accounting.service.ts` introduces a `CATEGORY_CODE_MAP` boot validator: on startup it checks that every mapped account code exists in the live CoA and throws + Sentry-captures on any missing code
- `ExpensesPage` and `AssetForm` dropdowns now populated dynamically from CoA groups instead of a static enum
- `ExpenseCategory` enum removed from controller signature (categories now come from CoA `category` field)

---

## Issues Found

### Critical
_None_

Guards, roles, soft-delete, and financial precision are all correctly handled. No new money calculations introduced.

---

### Warning

**W1 — `@Query('category')` type weakened from `ExpenseCategory` enum to `string`**

`apps/api/src/modules/accounting/accounting.controller.ts`:

```typescript
// Before (on main)
@Query('category') category?: ExpenseCategory,

// After
@Query('category') category?: string,
```

The change is intentional (categories are now dynamic CoA strings, not a static enum), but it removes compile-time validation. **Verify** that `accounting.service.ts` passes `category` only as a Prisma `where` clause value (parameterized) and not into any `$queryRaw` or string-interpolated query. If it only appears in `{ where: { category } }` it is safe.

**W2 — Missing Thai validation messages on `type` and `normalBalance` in `CreateChartOfAccountDto`**

`apps/api/src/modules/chart-of-accounts/dto/chart-of-account.dto.ts`:

```typescript
@IsString()           // ← no { message: '...' }
type: string;

@IsString()           // ← no { message: '...' }
normalBalance: string;

@IsBoolean()          // ← no { message: '...' }
@IsOptional()
vatApplicable?: boolean;
```

Per `rules/coding-standards.md`: all validation messages must be in Thai. `code` and `name` have Thai messages; the remaining required fields do not.

**Fix**:
```typescript
@IsString({ message: 'กรุณาระบุประเภทบัญชี' })
type: string;

@IsString({ message: 'กรุณาระบุยอดปกติ (Dr/Cr)' })
normalBalance: string;

@IsBoolean({ message: 'กรุณาระบุสถานะ VAT' })
@IsOptional()
vatApplicable?: boolean;
```

---

### Info

**I1 — `ChartOfAccountsController` security posture is correct**

- `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✅
- `@Roles(...)` on every endpoint ✅
- `by-codes` endpoint enforces a 20-code max with `BadRequestException` to prevent bulk extraction ✅

**I2 — All CoA queries include `deletedAt: null`**

`findAll`, `findByCodes`, `findGrouped`, `findOne` all include `deletedAt: null` in their `where` clauses ✅

**I3 — `useCoa.ts` uses `api.get()` from `@/lib/api`**

No raw `fetch()` in frontend hook ✅

**I4 — No financial `Number()` on Decimal fields**

This branch introduces no money calculations ✅

**I5 — Boot validator is a good pattern**

The CATEGORY_CODE_MAP validator that throws on startup if account codes are missing is consistent with the v4 "Journal unbalanced → throw + Sentry" philosophy. Good defensive engineering.

---

## Recommendation: 🟡 REVIEW

No security or financial-precision issues. Two warnings to address before merge:

| # | Issue | Effort |
|---|-------|--------|
| W1 | Verify `category` string not used in raw query | ~5 min (code inspection) |
| W2 | Add Thai messages to 3 DTO fields | ~5 min |

After confirming W1 is safe (parameterized only) and fixing W2 messages, this branch is clear to merge.
