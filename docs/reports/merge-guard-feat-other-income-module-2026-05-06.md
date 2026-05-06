# Pre-Merge Guard Report: feat/other-income-module

**Date**: 2026-05-06  
**Branch**: `feat/other-income-module`  
**Author**: Akenarin Kongdach  
**Recommendation**: 🔴 **BLOCK** — Critical issues must be fixed before merge

---

## File Changes Summary

44 files changed, 12 718 insertions, 26 deletions

**New API module** (`apps/api/src/modules/other-income/`):
- `other-income.controller.ts`, `other-income.service.ts`, `other-income.module.ts`
- `services/auto-journal.service.ts`, `services/doc-number.service.ts`, `services/validation.service.ts`
- 5 DTOs, template, Prisma migration, schema changes

**New frontend pages** (`apps/web/src/pages/other-income/`):
- `OtherIncomeListPage.tsx`, `OtherIncomeEntryPage.tsx`, `OtherIncomeViewPage.tsx`
- `OtherIncomeReceiptPage.tsx`, `OtherIncomeDailySheetPage.tsx`
- 4 sub-components, lib types/schema, routing wired into `App.tsx`

**Docs**: 2 large plan/spec markdown files (≈6 500 lines combined)

---

## Issues

### 🔴 Critical

#### C1 — `Number()` on Prisma `Decimal` money fields in service layer

**File**: `apps/api/src/modules/other-income/other-income.service.ts`

Multiple conversions from Prisma `Decimal` to JS `Number` inside the service layer will silently drop precision for large amounts and break accounting correctness:

```ts
// update draft — copy-back path
amountReceived: dto.amountReceived ?? Number(existing.amountReceived),

// copy items when duplicating/reversing
quantity:       Number(i.quantity),
unitAmount:     Number(i.unitAmount),
discountAmount: Number(i.discountAmount),
vatPct:         Number(i.vatPct),
whtPct:         Number(i.whtPct),

// copy adjustments
amount: Number(a.amount),
```

**Required fix**: Replace with `Prisma.Decimal` or keep as `string` and pass through without coercion. For arithmetic, import `Decimal` from `decimal.js` and operate on it directly. See pattern in `apps/api/src/modules/commissions/` (v2 hardening fix).

```ts
// Example correct pattern
amountReceived: dto.amountReceived ?? existing.amountReceived,   // Decimal passthrough
unitAmount: new Prisma.Decimal(i.unitAmount),                    // when constructing DTO
```

---

### ⚠️ Warning

#### W1 — Hard `deleteMany` on child rows without soft-delete in test teardown

**File**: `apps/api/src/modules/other-income/__tests__/other-income.service.spec.ts`

The test helper uses `prisma.otherIncomeItem.deleteMany` and `prisma.otherIncomeAdjustment.deleteMany` (hard delete). While acceptable in tests, confirm those child models carry `deletedAt` in schema and that production code paths never hard-delete them.

#### W2 — Frontend: `Number()` coercions for display only (non-critical but noisy)

**Files**: `apps/web/src/pages/other-income/*.tsx`, `apps/web/src/pages/other-income/components/*.tsx`

Multiple `{Number(d.amountReceived).toFixed(2)}` patterns. For display-only rendering these are safe, but prefer `parseFloat(String(v)).toFixed(2)` or `new Decimal(v).toFixed(2)` for consistency with the rest of the codebase.

#### W3 — `$queryRaw` in test fixture setup (test files only — safe)

**File**: `__tests__/other-income.service.spec.ts`

```ts
const [company] = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM company_info WHERE deleted_at IS NULL LIMIT 1`;
```

Parameterized template literal — safe. No SQL injection risk. Noted for awareness only.

---

### ℹ️ Info

#### I1 — Controller guards verified correct

`@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` at class level. All methods inherit. ✅

#### I2 — Soft delete patterns correct in service

Main queries use `deletedAt: null`. `findOneOrFail` uses `where: { id, deletedAt: null }`. `listQuery` builder sets `deletedAt: null` as default. ✅

#### I3 — `invalidateQueries` present after all mutations

All 5 mutations in frontend pages call `queryClient.invalidateQueries({ queryKey: ['other-income'] })`. ✅

#### I4 — `$queryRaw` in production code absent

No `$queryRaw` found in `other-income.service.ts` or `auto-journal.service.ts`. ✅

#### I5 — Large doc files

`docs/superpowers/plans/2026-05-06-other-income-module.md` (5 813 lines) is large. Not a code issue.

---

## Action Required

1. **Fix C1** — Replace all `Number(existingDecimalField)` with direct `Prisma.Decimal` passthrough or `decimal.js` operations in `other-income.service.ts`.
2. Address W1/W2 as best-effort before merge.
3. Re-run `./tools/check-types.sh all` after fix.
