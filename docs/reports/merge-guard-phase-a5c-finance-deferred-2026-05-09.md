# Merge Guard Report — `phase-a5c-finance-deferred`

**Date**: 2026-05-09  
**Branch**: `origin/phase-a5c-finance-deferred`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Merge base**: exists (valid, rebased on recent `origin/main`)  
**Commits ahead**: 8  

## File Changes Summary

```
19 files changed, 1773 insertions(+), 39 deletions(-)
```

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Adds `taxDisallowed`, `disallowedReason` to Expense; `assetCategory`, `usefulLifeMonths` to FixedAsset |
| `apps/api/src/modules/accounting/dto/expense.dto.ts` | Adds `taxDisallowed` + `disallowedReason` fields |
| `apps/api/src/modules/asset/asset.module.ts` | Imports `JournalModule` |
| `apps/api/src/modules/asset/asset.service.ts` | Wires `AssetDisposalTemplate` into `dispose()` |
| `apps/api/src/modules/asset/dto/asset.dto.ts` | Adds `AssetCategoryDto` enum, `usefulLifeMonths`, `disposalProceeds`, `depositAccountCode` |
| `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts` | **New** — A.5c disposal JE |
| `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.spec.ts` | Tests (3 scenarios) |
| `apps/api/src/modules/journal/cpa-templates/depreciation.template.ts` | **New** — straight-line depreciation JE |
| `apps/api/src/modules/journal/cpa-templates/depreciation.template.spec.ts` | Tests |
| `apps/api/src/modules/journal/cpa-templates/expense.template.ts` | Adds tax-disallowed routing to 54-XXXX |
| `apps/api/src/modules/journal/cpa-templates/expense.template.spec.ts` | Adds tax-disallowed test cases |
| `apps/api/src/modules/journal/cpa-templates/wht-accrual.template.ts` | **New** — WHT accrual JE |
| `apps/api/src/modules/journal/cpa-templates/wht-accrual.template.spec.ts` | Tests |
| `apps/api/src/modules/journal/cpa-templates/wht-remittance.template.ts` | **New** — WHT remittance JE |
| `apps/api/src/modules/journal/cpa-templates/wht-remittance.template.spec.ts` | Tests |
| `apps/api/src/modules/journal/cron/depreciation.cron.ts` | **New** — monthly depreciation cron |
| `apps/api/src/modules/journal/journal.module.ts` | Registers 5 new providers/exports |
| `prisma/migrations/*/migration.sql` | 2 migrations (Expense + FixedAsset columns) |

---

## Issues

### Warning (should fix before merge)

#### W1 — Missing `deletedAt: null` on post-disposal `findFirst`
**File**: `apps/api/src/modules/asset/asset.service.ts`  
**Code**:
```typescript
return {
  ...(await this.prisma.fixedAsset.findFirst({
    where: { id },          // ← missing deletedAt: null
    include: { branch: true },
  })),
  journalEntryNo: result.entryNo,
};
```
**Risk**: Low in practice (asset was just updated), but violates the soft-delete rule. If a concurrent soft-delete races between the `update` and this `findFirst`, the result spread would be `undefined`.  
**Fix**: Add `deletedAt: null` to the `where` clause and handle the `null` case.

---

#### W2 — Money field `disposalProceeds` routed through JavaScript `number`
**File**: `apps/api/src/modules/asset/dto/asset.dto.ts`  
**Code**:
```typescript
@Type(() => Number)
@IsNumber({}, { message: 'รายได้จากการจำหน่ายต้องเป็นตัวเลข' })
disposalProceeds?: number = 0;
```
In `asset.service.ts`: `new Decimal(dto.disposalProceeds?.toString() ?? '0')`  
**Risk**: The value passes through a JavaScript IEEE-754 float between HTTP parsing and `Decimal` conversion. For most disposal amounts this is safe, but edge values (e.g. `1234567.89`) can lose precision in `.toString()` on some runtimes.  
**Fix**: Use `@IsString()` + `@Matches(/^\d+(\.\d{1,2})?$/)` in the DTO, then `new Decimal(dto.disposalProceeds)` directly in the service.

---

#### W3 — Unnecessary `as any` on typed Prisma `expense` result
**File**: `apps/api/src/modules/journal/cpa-templates/expense.template.ts`  
**Code**:
```typescript
const expense = await this.prisma.expense.findFirst({
  where: { id: expenseId, deletedAt: null },
  // no select — all fields returned
});

const isTaxDisallowed = (expense as any).taxDisallowed === true;  // ← as any not needed
const disallowedReason = (expense as any).disallowedReason as string | null | undefined;
```
The Prisma schema includes `taxDisallowed Boolean @default(false)` and `disallowedReason String?` on the `Expense` model. With no `select` clause, `expense` is already typed to include these fields. The `as any` casts indicate the Prisma client was not regenerated after the schema migration when this code was written.  
**Fix**: Run `npx prisma generate`, then remove the `as any` casts:
```typescript
const isTaxDisallowed = expense.taxDisallowed === true;
const disallowedReason = expense.disallowedReason;
```

---

### Info

#### I1 — `DepreciationCron` has no top-level Sentry span
**File**: `apps/api/src/modules/journal/cron/depreciation.cron.ts`  
Per-asset failures are captured via `Sentry.captureException()`, which is correct. However, the cron has no `Sentry.startSpan` / `Sentry.withScope` wrapping the overall run for cron-health tracking (e.g. catch "cron never ran" or "cron errored before processing any assets"). This is consistent with some other crons but inconsistent with the v2 hardening standard. Low priority.

#### I2 — `as any` in spec files (8 occurrences)
**Files**: `asset-disposal.template.spec.ts`, `depreciation.template.spec.ts`  
Test helper casts `prisma as any` and enum values `as any` — standard test scaffolding pattern, no production impact.

---

## Positive Notes

- `DepreciationCron` correctly handles month-length edge cases (28/29/30/31) with a last-day guard rather than hardcoding a date.
- All new templates use `Prisma.Decimal` exclusively — no `Number()` conversion on financial lines.
- `DepreciationTemplate` uses `ROUND_DOWN` for per-month amount and `ROUND_HALF_UP` for VAT, matching the CPA golden-fixture rounding modes.
- New journal entries include proper `metadata` for idempotency checks.
- All 5 new templates are registered in `journal.module.ts` providers **and** exports correctly.
- Sentry per-asset error capture in `DepreciationCron` matches v2 cron-hardening standard.
- `deletedAt: null` is present in all other `findFirst` queries in the new templates.

---

## Recommendation: **REVIEW**

No blocking issues. Fix W1 (missing `deletedAt: null`), W2 (float-before-Decimal on disposal proceeds), and W3 (remove `as any` after `prisma generate`) before merging. The accounting logic itself is solid and well-tested.
