# Merge Guard Report — `phase-a5c-finance-deferred`

**Date**: 2026-05-04  
**Branch**: `phase-a5c-finance-deferred`  
**Author**: Akenarin Kongdach  
**Recommendation**: 🔴 **BLOCK** — fix Critical issues before merge

---

## File Changes Summary

31 files changed, 3 239 insertions(+), 63 deletions(-)

### New production files
| File | Lines |
|------|-------|
| `apps/api/src/modules/journal/cpa-templates/expense.template.ts` | 205 |
| `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts` | 192 |
| `apps/api/src/modules/journal/cpa-templates/depreciation.template.ts` | 182 |
| `apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.ts` | 158 |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.ts` | 145 |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.ts` | 96 |
| `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts` | 116 |
| `apps/api/src/modules/journal/cpa-templates/wht-accrual.template.ts` | 120 |
| `apps/api/src/modules/journal/cpa-templates/wht-remittance.template.ts` | 84 |
| `apps/api/src/modules/journal/cron/depreciation.cron.ts` | 76 |
| `apps/api/src/modules/asset/asset.service.ts` (modified) | — |

---

## Issues Found

### 🔴 Critical

#### C1 — `Number()` on money fields in `asset.service.ts`

**File**: `apps/api/src/modules/asset/asset.service.ts`  
**Lines**: ~195–198, ~235–236, ~362–363

`calculateMonthlyDepreciation()` and the depreciation rundown loop use `Number()` to cast `Decimal` DB fields:

```ts
// Lines ~195-198
const cost     = Number(asset.costValue);       // ❌ must be Decimal
const salvage  = Number(asset.salvageValue);    // ❌
const remaining = maxDepre - Number(asset.accumulatedDepre); // ❌

// Lines ~235-236
const newAccumulated = Number(asset.accumulatedDepre) + monthlyDepre; // ❌
const maxDepre = Number(asset.costValue) - Number(asset.salvageValue); // ❌

// Lines ~362-363
const cost        = Number(asset.costValue);    // ❌
const accumulated = Number(asset.accumulatedDepre); // ❌
```

The `monthlyDepre` result feeds directly into journal entry amounts and the `accumulatedDepre` field written back to DB. Floating-point drift will corrupt ledger balances over time.

**Fix**: Replace with `Decimal` arithmetic using `d()`, `dSub()`, `dAdd()`, `dDiv()` from `decimal.util`.

---

#### C2 — `fixedAsset.findFirst` missing `deletedAt: null` (disposal return)

**File**: `apps/api/src/modules/asset/asset.service.ts`  
**Lines**: ~178–182

```ts
return {
  ...(await this.prisma.fixedAsset.findFirst({
    where: { id },          // ❌ missing deletedAt: null
    include: { branch: true },
  })),
  journalEntryNo: result.entryNo,
};
```

Although the asset was just updated (so it exists), all queries must include `deletedAt: null` per the database rules. A race-condition soft-delete between the update and this read could return a stale spread object.

**Fix**: Add `deletedAt: null` to the where clause.

---

### ⚠️ Warning

#### W1 — Hardcoded `depositAccountCode: '11-1101'` in production service

**File**: `apps/api/src/modules/accounting/accounting.service.ts`  
**Lines**: ~403

```ts
await this.expenseTemplate.execute({
  expenseId: updated.id,
  depositAccountCode: '11-1101', // Default cash account; caller can pass custom in future
  isPaid: true,
});
```

`11-1101` is the cash account for one specific person ("สุทธินีย์ คงเดช"). An expense could be paid from KBank (11-1201), SCB (11-1202), or a different cash holder. Hardcoding silently posts all expense JEs to the wrong account when another payment method is used.

**Fix**: Surface `depositAccountCode` from the `Expense` record or the DTO, rather than defaulting to a hardcoded string in the service. Consider adding a `paymentAccountCode` field to `CreateExpenseDto` with a default of `'11-1101'`.

#### W2 — Depreciation cron schedule fires on days 28–31 only

**File**: `apps/api/src/modules/journal/cron/depreciation.cron.ts`  
**Line**: 31

```ts
@Cron('0 1 28-31 * *', { timeZone: 'Asia/Bangkok' })
```

The "last day of month" guard is correct (checks that tomorrow is in a different month). However, in February the last day is 28 or 29; the cron fires only from day 28 onward, so February-end will be caught. **No bug** — noted for reviewers' awareness.

---

### ℹ️ Info

#### I1 — `as any` casts in test spec files

`prisma as any`, `status: ... as any` appear extensively in spec files. Acceptable in tests that directly instantiate classes without the NestJS DI container, but worth tracking if it hides real type mismatches.

#### I2 — WHT account codes verified ✅

`11-4101`, `21-3101`, `21-3102`, `21-3103`, `21-3202` are all present in `finance-coa.csv`. No account-code mismatches.

#### I3 — All new controller methods have `@Roles` decorators ✅

New `ledger/trial-balance`, `ledger/profit-loss`, `ledger/balance-sheet` endpoints are under the existing class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` and each has a `@Roles(...)` decorator.

#### I4 — Depreciation cron has Sentry capture + deletedAt filter ✅

`DepreciationCron.tick()` properly uses `where: { status: 'ACTIVE', deletedAt: null }` and captures exceptions per-asset via `Sentry.captureException`.

---

## Recommendation

**🔴 BLOCK**

Fix **C1** (Number() → Decimal on money) and **C2** (missing deletedAt) before merging. These are P0 issues per project rules. W1 (hardcoded account code) should also be addressed before this template goes to production as it will silently mispost expenses paid via bank transfer.
