# Pre-Merge Guard Report — 2026-05-09

**Reviewed by**: Pre-Merge Guard agent  
**Date**: 2026-05-09  
**Branches reviewed**: 3 (most recently active unmerged branches)

---

## Summary

| Branch | Files Changed | Insertions | Recommendation |
|--------|--------------|------------|----------------|
| `fix/2a-cron-auto-consume-advance` | 13 | +2,489 | **REVIEW** |
| `feat/accounting-expense-fixes` | 165 | +36,439 | **REVIEW** |
| `feat/ecl-stage-reverse` | 10 | +543 | **APPROVE** |

---

## Branch 1: `fix/2a-cron-auto-consume-advance`

**Author**: Akenarin Kongdach  
**Commits**: 3  
**Purpose**: 2A cron auto-consumes advance balance on accrual; expense-module hardening (atomicity, WHT split, 2-step AP clearance, VOID reverse JE)

### File Changes Summary
- `accounting.controller.ts` — new `/accrue` endpoint, `markPaid` body refactored
- `accounting.service.ts` — `recordExpenseAccrual`, `markExpensePaid`, `voidExpense` atomic refactors
- `expense-clearance.template.ts` / `expense-reverse.template.ts` — new JE templates
- `installment-accrual-2a.template.ts` — advance-consume-on-accrual logic added
- `journal.module.ts` — registers new templates
- `accounting.service.spec.ts` — updated tests for atomic refactor

### Issues

#### Warning
**W-1 — Inline @Body object without class-validator** (`accounting.controller.ts`)

```typescript
// Line ~163 in accounting.controller.ts
@Post(':id/pay')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
markPaid(
  @Param('id') id: string,
  @Body() body: { paymentDate?: string; depositAccountCode?: string } = {},
)
```

`depositAccountCode` is passed directly to journal templates and must be one of the 6 valid cash account codes (`11-1101`..`11-1203`). Without a proper DTO class using `@Matches(/^11-(1101|1102|1103|1201|1202|1203)$/)`, an invalid account code will cause a JE post failure that bubbles up as a 500 instead of a 400 with a meaningful Thai error message.

**Fix**: Create `MarkExpensePaidDto` with:
```typescript
@IsOptional() @IsDateString() paymentDate?: string;
@IsOptional() @Matches(/^11-(1101|1102|1103|1201|1202|1203)$/, { message: 'รหัสบัญชีเงินสดไม่ถูกต้อง' }) depositAccountCode?: string;
```

**W-2 — `Number(voided.totalAmount)` in structured logger** (`accounting.service.ts`, line ~573)

Pre-existing issue preserved in the refactor. Decimal-to-Number conversion in logger loses precision for amounts > 9 trillion (unlikely but inconsistent with project convention). Use `.toFixed(2)` for log output consistency.

### Info
- **I-1** — `accounting.service.ts` is 1,771 lines. Consider splitting expense lifecycle methods into `expense.service.ts` to keep file size manageable.

### Positive Observations
- All new endpoints have `@UseGuards` at class level + `@Roles()` per method ✓
- New `recordExpenseAccrual` and `voidExpense` both use `$transaction` — atomicity is correct ✓
- All new queries include `deletedAt: null` ✓
- New templates use `Prisma.Decimal` throughout — no precision loss ✓
- Advance-consume logic correctly uses `Decimal.min(advanceBalance, installmentTotal)` ✓

### Recommendation: **REVIEW**
Fix W-1 before merge. W-2 is low risk but worth a one-line fix while in the area.

---

## Branch 2: `feat/accounting-expense-fixes`

**Author**: Akenarin Kongdach  
**Commits**: 14  
**Purpose**: Full asset module (Phases 1–3), depreciation module, EIR calculator, ECL stage reverse wiring, expense template hardening (superset of branch 1 above)

### File Changes Summary
- **New modules**: `asset/`, `depreciation/` — full NestJS modules with controllers, services, DTOs
- **New frontend pages**: `pages/assets/` (9 pages), `pages/depreciation/`, `pages/transfers/`
- **New JE templates**: `asset-purchase`, `asset-disposal`, `depreciation`, `expense-clearance`, `expense-reverse`, and their reversal variants
- **Schema**: `20260808100000_asset_phase1` migration — `FixedAsset`, `DepreciationEntry` models
- **Tests**: 9 new spec files, 10 E2E specs

### Issues

#### Warning
**W-1 — Same inline @Body DTO as Branch 1** (inherited from shared accounting.service.ts changes)
Same as W-1 above. Applies here since this branch includes the same `accounting.controller.ts` change.

**W-2 — `.toNumber()` in bad-debt report aggregation** (`bad-debt.service.ts`)

```typescript
// In summary report output
outstanding: entry.outstanding.toNumber(),
provision: entry.provision.toNumber(),
totalOutstanding: totalOutstandingDec.toNumber(),
totalProvision: totalProvisionDec.toNumber(),
```

Values are serialized to JSON response as JS `number`. For amounts up to ₿999,999,999,999.99 (DB precision is 12,2) this is safe within `Number.MAX_SAFE_INTEGER`, but inconsistent with project convention of using `Decimal` or `.toFixed()` in API responses. Use `.toFixed(2)` so client receives a string and avoids JS float rounding display artifacts.

**W-3 — `findUnique({ where: { id } })` without `deletedAt` filter** (`asset.service.ts`, line 1055)

```typescript
const afterTemplate = await tx.fixedAsset.findUnique({ where: { id } });
```

This is a read-after-write pattern (checking state after JE post). `findUnique` in Prisma does not support compound unique-with-nullable filters, so adding `deletedAt` would require switching to `findFirst`. Since the asset was just successfully updated in the same transaction this is low risk, but any read-after-write that can return a soft-deleted record is technically non-compliant with the project soft-delete convention.

**Fix**: Change to `tx.fixedAsset.findFirst({ where: { id, deletedAt: null } })`.

### Info
- **I-1** — Large files: `asset.service.ts` (1,211 lines), `accounting.service.ts` (1,771 lines), `asset.service.spec.ts` (1,258 lines). Consider splitting at logical boundaries in follow-up.
- **I-2** — `DepreciationEntry` queries use `reversedAt: null` (not `deletedAt`). Correct per schema — `DepreciationEntry` has no `deletedAt` and uses `reversedAt` for reversal tracking. This is intentional ✓.
- **I-3** — `let prisma: any` in spec files is acceptable test scaffolding.

### Positive Observations
- All 3 new controllers (`asset.controller.ts`, `asset-journal.controller.ts`, `asset-reports.controller.ts`, `asset-transfer.controller.ts`, `depreciation.controller.ts`) have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓
- Every controller method has a `@Roles()` decorator with appropriate role set ✓
- Frontend pages use `api.get()/api.post()` from `@/lib/api` — no raw `fetch()` ✓
- `queryClient.invalidateQueries()` called correctly after all mutations ✓
- DTOs have Thai validation messages throughout ✓
- No hardcoded secrets or API keys ✓
- No unparameterized `$queryRaw` ✓
- `QueryBoundary` wired on all new listing pages ✓
- Depreciation `ROUND_DOWN`/`ROUND_HALF_UP` rounding modes match CPA CSV spec ✓
- No hardcoded hex colors or `text-gray-*` tokens in new frontend components ✓

### Recommendation: **REVIEW**
Fix W-1 (shared with branch 1) and W-3 before merge. W-2 is low-risk cosmetic.

---

## Branch 3: `feat/ecl-stage-reverse`

**Author**: Akenarin Kongdach  
**Commits**: 4  
**Purpose**: ECL stage-reverse JE template (CPA Policy A §3.6) + post-payment trigger in `PaymentsService`

### File Changes Summary
- `ecl-stage-reverse.template.ts` — new JE template (103 lines)
- `ecl-stage-reverse.template.spec.ts` — 144-line unit tests
- `bad-debt.service.ts` + `bad-debt.service.spec.ts` — `reverseStageOnPayment()` method + 142 new tests
- `payments.service.ts` — wires ECL reverse into receipt flow
- `payments.module.ts` — registers `BadDebtModule`
- `journal.module.ts` — registers new template

### Issues

None found.

### Positive Observations
- No new controllers → no guard surface ✓
- `BadDebtService` injected as **required** (not `@Optional`) — correct for regulatory path ✓
- ECL reverse failure rethrows after Sentry capture — aligns with v2/v3 hardening pattern ✓
- New template uses `Prisma.Decimal` throughout ✓
- All service queries include `deletedAt: null` ✓
- 142 new tests cover staging buckets and reversal scenarios ✓

### Recommendation: **APPROVE**

---

## Cross-Branch Notes

1. Branches 1 and 2 share the same `accounting.service.ts` / `accounting.controller.ts` changes. If both are targeting merge, merging one first will reduce the diff of the other. Recommended merge order: **Branch 3 first** (clean), then **Branch 1** (smaller), then **Branch 2** (largest, after branch 1 conflicts resolved).

2. The `feat/accounting-expense-fixes` branch appears to be a superset — it includes all changes from `fix/2a-cron-auto-consume-advance`. Verify whether branch 1 is a standalone hotfix or was already cherry-picked into branch 2 before merging both to avoid double-applying the expense template changes.
