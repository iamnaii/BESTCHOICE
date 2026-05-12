# Merge Guard Report — feat/accounting-expense-fixes

**Date**: 2026-05-12  
**Branch**: `feat/accounting-expense-fixes`  
**Author**: Akenarin Kongdach  
**Last commit**: `858eeca5` — feat(accounting): close 4 expense-module gaps — WHT, atomicity, VOID reverse, AP clearance (2026-05-09)  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| Metric | Value |
|--------|-------|
| Files changed | 165 |
| Insertions | +36,439 |
| Deletions | −1,416 |
| Unique commits ahead of main | 107 |

**Key areas touched:**
- `apps/api/src/modules/asset/` — new Phase 3: `asset-journal.controller.ts`, `asset-reports.controller.ts`, `asset-transfer.controller.ts`, split services
- `apps/api/src/modules/accounting/accounting.service.ts` — grew from 1,136 → 1,740 lines (+604); WHT atomicity + VOID reverse
- `apps/api/src/modules/accounting/bad-debt-provision.cron.ts` — new cron
- `apps/api/prisma/schema.prisma` — 177-line diff (asset phase 1 migration + new models)
- `apps/api/src/cli/wipe-assets.cli.ts` — new CLI helper
- `apps/web/src/` — new asset pages (register, journal, reports, depreciation views)

---

## Issues Found

### Critical — None

No missing `@UseGuards`, no unparameterized `$queryRaw` in service files, no hardcoded secrets. All new controllers have guards:

| Controller | Guards |
|------------|--------|
| `AssetJournalController` | `JwtAuthGuard, RolesGuard` + `@Roles` on all methods |
| `AssetReportsController` | `JwtAuthGuard, RolesGuard` + `@Roles` on all methods |
| `AssetTransferController` | `JwtAuthGuard, RolesGuard, BranchGuard` + `@Roles` on all methods |
| `DepreciationController` | `JwtAuthGuard, RolesGuard` + `@Roles` on all methods |

`$executeRawUnsafe` appears only in `wipe-assets.cli.ts` and `*.spec.ts` test files — acceptable.

---

### Warning

**W-1 — `Number()` on Decimal in logging context** (`accounting.service.ts`, `receipts.service.ts`)

```ts
// accounting.service.ts — inside structuredLogger.log(...)
totalAmount: Number(voided.totalAmount),

// receipts.service.ts — inside auditLog.create oldValue JSON
amount: Number(receipt.amount),
```

Neither cast is in arithmetic. Both are serializing a `Prisma.Decimal` to JSON for audit/log metadata. However the project convention is to avoid `Number()` on Decimal fields due to precision loss on large amounts. Use `.toString()` instead:

```ts
totalAmount: voided.totalAmount.toString(),
amount: receipt.amount.toString(),
```

Severity: Warning (logging only — no financial calculation affected, but inconsistent with project rules established in v2/v3 hardening).

---

**W-2 — `Number(p.provisionRate)` in `bad-debt.service.ts` summary aggregation**

```ts
rate: Number(p.provisionRate),   // in bucketDec.set(bucket, {...})
```

`provisionRate` is a percentage (0–100), not a monetary amount, so precision loss is unlikely to matter here. However for consistency use `new Decimal(p.provisionRate).toNumber()` to make the intent explicit.

---

**W-3 — `copyMutation` does not invalidate assets list cache**

In the asset detail page frontend, `copyMutation.onSuccess` navigates to the new asset's edit page but does **not** call `queryClient.invalidateQueries({ queryKey: ['assets'] })`. When the user navigates back to the assets list, the copied asset may not appear until next TTL expiry.

```ts
const copyMutation = useMutation({
  mutationFn: () => assetsApi.copy(id!),
  onSuccess: (a) => {
    toast.success(`คัดลอกเป็น ${a.assetCode}`);
    navigate(`/assets/${a.id}/edit`);
    // missing: queryClient.invalidateQueries({ queryKey: ['assets'] });
  },
```

---

**W-4 — `asset.service.ts` and `accounting.service.ts` are large files**

| File | Lines |
|------|-------|
| `asset.service.ts` | 1,186 (same baseline was 1,211 — OK) |
| `accounting.service.ts` | 1,740 (+604 from this branch) |

`accounting.service.ts` now handles: expense CRUD, expense journal posting, void + reverse JE, asset disposal, bad-debt, trial balance, P&L. Consider extracting the new expense-void/reverse logic into a dedicated `expense-reverse.service.ts` in a follow-up PR.

---

### Info

**I-1 — `generateAssetCode` and `generateDocNo` query without `deletedAt: null`**

Both methods intentionally scan all `fixedAsset` rows (including soft-deleted) to find the max sequence number. This prevents reusing asset codes from deleted records. The comment in the code explains this. Not a bug.

**I-2 — `as any` on Prisma JSON path filters**

```ts
{ metadata: { path: ['flow'], equals: 'expense' } as any }
```

Standard workaround for Prisma JSON field filtering — Prisma's TypeScript types don't fully model `path`-style JSON queries. Not a real issue.

**I-3 — `$executeRawUnsafe` in CLI and test files only**

All `$executeRawUnsafe` calls are in `wipe-assets.cli.ts` (TRUNCATE with hardcoded table names — no user input) and `*.spec.ts` test teardown. Not a production risk.

---

## Recommendation: ⚠️ REVIEW

Block on: nothing (no Critical issues).

Should fix before merge:
1. **W-1**: Replace `Number(voided.totalAmount)` and `Number(receipt.amount)` with `.toString()` in logging contexts — 2 lines.
2. **W-3**: Add `queryClient.invalidateQueries({ queryKey: ['assets'] })` in `copyMutation.onSuccess`.

Nice-to-have:
- W-2: Decimal-consistent `provisionRate` cast
- W-4: Follow-up issue to split `accounting.service.ts`
