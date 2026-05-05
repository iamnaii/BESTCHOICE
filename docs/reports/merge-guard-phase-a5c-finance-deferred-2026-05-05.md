# Merge Guard Report — `phase-a5c-finance-deferred`

**Date:** 2026-05-05  
**Author:** Akenarin Kongdach  
**Branch:** `origin/phase-a5c-finance-deferred`  
**Target:** `main`  
**Diff:** 19 files changed, +1773 / -39

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Modified — `FixedAsset` new fields: `taxDisallowed`, `disallowedReason`, `assetCategory`, `usefulLifeMonths`, `salvageValue`, `accumulatedDepre`, `disposalDate`, `disposalProceeds` |
| `apps/api/prisma/migrations/…` | 2 new migrations |
| `apps/api/src/modules/accounting/dto/expense.dto.ts` | Modified — new `taxDisallowed` / `disallowedReason` fields |
| `apps/api/src/modules/asset/asset.module.ts` | Modified — imports `JournalModule` |
| `apps/api/src/modules/asset/asset.service.ts` | Modified — wires depreciation/disposal templates |
| `apps/api/src/modules/asset/dto/asset.dto.ts` | Modified — new disposal fields |
| `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts` | NEW |
| `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.spec.ts` | NEW — 224 lines |
| `apps/api/src/modules/journal/cpa-templates/depreciation.template.ts` | NEW |
| `apps/api/src/modules/journal/cpa-templates/depreciation.template.spec.ts` | NEW — 216 lines |
| `apps/api/src/modules/journal/cpa-templates/expense.template.spec.ts` | Extended — 103 additional lines |
| `apps/api/src/modules/journal/cpa-templates/expense.template.ts` | Extended — 82 additional lines |
| `apps/api/src/modules/journal/cpa-templates/wht-accrual.template.ts` | NEW |
| `apps/api/src/modules/journal/cpa-templates/wht-accrual.template.spec.ts` | NEW — 185 lines |
| `apps/api/src/modules/journal/cpa-templates/wht-remittance.template.ts` | NEW |
| `apps/api/src/modules/journal/cpa-templates/wht-remittance.template.spec.ts` | NEW — 124 lines |
| `apps/api/src/modules/journal/cron/depreciation.cron.ts` | NEW — 76 lines |
| `apps/api/src/modules/journal/journal.module.ts` | Modified — exports new templates + cron |

---

## Critical Issues

**None.**

No new controllers. No `$queryRaw`. No hardcoded secrets. New templates use `Prisma.Decimal` throughout.

---

## Warning Issues

### W-1 — Missing `deletedAt: null` on `findFirst` inside `disposeAsset` return

**File:** `apps/api/src/modules/asset/asset.service.ts`

```typescript
return {
  ...(await this.prisma.fixedAsset.findFirst({
    where: { id },          // ← missing deletedAt: null
    include: { branch: true },
  })),
  journalEntryNo: result.entryNo,
};
```

The `FixedAsset` model has `deletedAt`. Every `findFirst`/`findMany` must include `where: { deletedAt: null }` per database rules.

**Fix:**

```typescript
where: { id, deletedAt: null },
```

---

### W-2 — Missing null guard for `whtPayableCode` in both WHT templates

**Files:**
- `apps/api/src/modules/journal/cpa-templates/wht-accrual.template.ts`
- `apps/api/src/modules/journal/cpa-templates/wht-remittance.template.ts`

```typescript
const whtPayableCode = WHT_PAYABLE_CODE[whtCategory];
// no guard — whtPayableCode could be undefined if enum expands
lines.push({ accountCode: whtPayableCode, ... });
```

TypeScript's compile-time union type prevents most misuse, but if `whtCategory` arrives via a dynamic path (e.g., future enum expansion, service migration), an `undefined` code would silently corrupt the JE line.

**Fix (both templates):**

```typescript
const whtPayableCode = WHT_PAYABLE_CODE[whtCategory];
if (!whtPayableCode) {
  throw new BadRequestException(`ไม่รองรับประเภทภาษีหัก ณ ที่จ่าย: ${whtCategory}`);
}
```

---

### W-3 — Unnecessary `as any` cast on schema-typed `Expense` fields

**File:** `apps/api/src/modules/journal/cpa-templates/expense.template.ts`

```typescript
const isTaxDisallowed = (expense as any).taxDisallowed === true;
const disallowedReason = (expense as any).disallowedReason as string | null | undefined;
```

`taxDisallowed` and `disallowedReason` are declared in `schema.prisma` and available in generated Prisma types. The `as any` cast suppresses type-checking and was likely left over from when the fields were not yet in the schema.

**Fix:** Remove the casts:

```typescript
const isTaxDisallowed = expense.taxDisallowed === true;
const disallowedReason = expense.disallowedReason;
```

---

### W-4 — `DepreciationCron.tick()` lacks top-level Sentry catch (v2/v3 hardening standard)

**File:** `apps/api/src/modules/journal/cron/depreciation.cron.ts`

The cron has correct per-asset `try/catch`, but a DB-level failure on `findMany` (e.g., connection drop) propagates uncaught from `tick()`. Per the v2 hardening pattern, all cron jobs must have a top-level Sentry capture for unexpected failures.

**Fix:**

```typescript
async tick() {
  try {
    // ... existing logic ...
  } catch (e) {
    Sentry.captureException(e, { tags: { kind: 'cron-job', cron: 'monthly-depreciation-a5c' } });
    this.logger.error(`[A.5c] DepreciationCron unexpected failure: ${(e as Error).message}`);
    throw e;
  }
}
```

---

### W-5 — Gain-on-disposal mapped to `41-1102` (repossession income) — wrong account

**File:** `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts`

```typescript
// TODO: Add dedicated gain-on-disposal income account (e.g. 41-1201 ...)
const GAIN_ON_DISPOSAL_CODE = '41-1102'; // interim — see TODO above
```

`41-1102` is "รายได้จากการยึดสินค้า" (Repossession Income). Using it for asset disposal gains conflates two unrelated revenue streams in the P&L and trial balance. The comment acknowledges this but no tracking issue is referenced.

**Fix options:**
- (a) Add `41-1201` (or similar) to `finance-coa.csv` before shipping this template, OR
- (b) Get explicit accountant sign-off on using `41-1102` as interim, with a dated ticket to fix before first production disposal.

**This decision needs owner/accountant input before merge.**

---

## Info Issues

| # | File | Note |
|---|------|------|
| I-1 | `asset.service.ts` | Pre-existing `Number()` on Decimal fields in old `runMonthEndDepreciation` path (not introduced by this PR) — old endpoint and new `DepreciationCron` now coexist; old path should be deprecated |
| I-2 | `wht-accrual.template.ts` | Not idempotent when `vendorReference` is omitted — falls back to `Date.now()`, enabling duplicate JEs on retry; consider requiring `vendorReference` when wired to HTTP endpoints |
| I-3 | `asset.dto.ts` | `disposalProceeds` typed as `number` in DTO — minor inconsistency with project Decimal convention; `new Decimal(...)` wrapping in service is correct |
| I-4 | `depreciation.template.ts` | `toDecimalPlaces(2)` without explicit `ROUND_HALF_UP` argument — defaults correctly but should be made explicit per accounting rules |

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 5 |
| Info | 4 |

**Recommendation: `REVIEW`**

Branch is well-structured with correct Decimal arithmetic, strong test coverage, and proper Sentry capture on per-asset failures. **Must address before merge:**
- **W-1**: One-line fix (`deletedAt: null`)
- **W-2**: Two-line guard in each WHT template
- **W-5**: Accounting decision needed on gain account — cannot ship with `41-1102` (repossession) as the gain-on-disposal code without explicit sign-off

W-3 and W-4 are low-risk cleanups that can accompany W-1/W-2 in the same PR.
