# Pre-Merge Guard Report — feat/accounting-expense-fixes

**Date**: 2026-05-09  
**Branch**: `feat/accounting-expense-fixes`  
**Author**: Akenarin Kongdach  
**Recommendation**: ⚠️ REVIEW

---

## Summary

Very large branch (165 files, +36 439 / −1 416) covering three independent deliverables:

1. **Asset Module Phase 1–3** — full fixed-asset management: CRUD, depreciation runs, asset transfers, journal integration, 5 report pages (AssetsList, AssetEntry, AssetDetail, AssetJournal, AssetSchedule, AssetRegister, AssetSummaryReport, AssetAudit, AssetTransfers)
2. **Expense module gaps** — WHT, atomicity, VOID reverse, AP clearance (`ExpenseClearanceTemplate`, `ExpenseReverseTemplate`, 2-step accrual flow) — superset of `fix/2a-cron-auto-consume-advance`
3. **Bad-debt service refactor** — Decimal precision improvements, monthly provision cron

## File Changes (165 files, +36 439 / −1 416)

| Area | Files | Notes |
|------|-------|-------|
| New controllers | asset.controller.ts, asset-journal.controller.ts, asset-reports.controller.ts, asset-transfer.controller.ts, depreciation.controller.ts | 5 new controllers |
| New services | AssetService (15+ methods), AssetTransferService, AssetJournalService, AssetReportsService, DepreciationService | Full CRUD + lifecycle |
| JE Templates | AssetPurchaseTemplate, AssetPurchaseReverseTemplate, AssetDisposalTemplate, AssetDisposalReverseTemplate, DepreciationTemplate, DepreciationReverseTemplate, ExpenseClearanceTemplate, ExpenseReverseTemplate | 8 new templates |
| Frontend pages (new) | AssetsListPage, AssetEntryPage, AssetDetailPage, AssetJournalPage, AssetSchedulePage, AssetRegisterPage, AssetSummaryReportPage, AssetAuditPage, AssetTransfersListPage, DepreciationPage | 10 pages |
| Tests (API) | 15+ new spec files | Asset + depreciation unit + integration tests |
| Tests (E2E) | 4 Playwright spec files | Asset smoke tests |

## Guard & Role Coverage (New Controllers)

| Controller | @UseGuards | @Roles |
|------------|------------|--------|
| `asset.controller.ts` | JwtAuthGuard, RolesGuard, BranchGuard | ✅ all methods |
| `asset-journal.controller.ts` | JwtAuthGuard, RolesGuard | ✅ all methods |
| `asset-reports.controller.ts` | JwtAuthGuard, RolesGuard | ✅ all methods |
| `asset-transfer.controller.ts` | JwtAuthGuard, RolesGuard, BranchGuard | ✅ all methods |
| `depreciation.controller.ts` | JwtAuthGuard, RolesGuard | ✅ all methods |

All 5 new controllers are properly guarded. ✓

## Issues Found

### Critical
_None._

### Warning

1. **`Number()` on Decimal money field — `accounting.service.ts`**  
   In `voidExpense`, the structured logger call uses:
   ```ts
   totalAmount: Number(voided.totalAmount),
   ```
   Must be changed to `voided.totalAmount.toString()`. `Number()` on `Prisma.Decimal` violates the project money rule and can lose precision.

2. **`Number(p.provisionRate)` on Decimal field — `bad-debt.service.ts`**  
   Multiple `.toNumber()` calls on `Decimal` fields are used in JSON serialization for the report response shape:
   ```ts
   rate: Number(p.provisionRate),
   outstanding: entry.outstanding.toNumber(),
   provision: entry.provision.toNumber(),
   ```
   These values are used for display/API response only (not fed back into calculations), so precision loss at normal values is acceptable — but the convention is to serialize as `string` or use `Prisma.Decimal` in the DTO. Should be `p.provisionRate.toString()`, `entry.outstanding.toString()` etc.

3. **`@Body()` inline type instead of DTO — `accounting.controller.ts`**  
   The `markPaid` endpoint uses an inline type with no validation:
   ```ts
   @Body() body: { paymentDate?: string; depositAccountCode?: string } = {}
   ```
   `depositAccountCode` accepts any string. It should be validated against the allowed cash account pattern (`/^[0-9]{2}-[0-9]{4}$/`) using a proper DTO class:
   ```ts
   class MarkPaidDto {
     @IsOptional() @IsString()
     @Matches(/^[0-9]{2}-[0-9]{4}$/, { message: 'รหัสบัญชีไม่ถูกต้อง' })
     depositAccountCode?: string;
   
     @IsOptional() @IsDateString({}, { message: 'วันที่จ่ายไม่ถูกต้อง' })
     paymentDate?: string;
   }
   ```
   Without validation, an invalid account code will fail at the JE template level with an unhelpful error instead of a 400 from the controller.

### Info

1. **Large surface area** — 139 TS/TSX files changed. The asset module spans 3 phases with 60+ commits. Reviewing as a single PR is high-risk. Consider splitting Phase 1 + Phase 2 + Phase 3 into separate merges if the branch history allows cherry-picking.

2. **Frontend data-fetching pattern is correct** — all new pages use `api.post()` / `api.get()` from `@/lib/api`, `useQuery` / `useMutation`, and `queryClient.invalidateQueries()`. No raw `fetch()` found. ✓

3. **`QueryBoundary` present on new pages** — error + retry UI wired correctly. ✓

4. **Depreciation controller missing `BranchGuard`** — `depreciation.controller.ts` uses `JwtAuthGuard + RolesGuard` but not `BranchGuard`. Depreciation runs are applied per asset (which is branch-scoped), so branch isolation at the controller level should be confirmed as intentional (e.g., FINANCE_MANAGER runs depreciation across all branches). Acceptable if intentional; document if so.

5. **`page = Number(searchParams.get('page') ?? 1)` in frontend pages** — `Number()` on a URL string is standard for pagination params, not a money field. Acceptable.

## Recommendation

**REVIEW** — three warnings to address before merge:

| # | File | Fix Required |
|---|------|-------------|
| W1 | `accounting.service.ts` | `Number(voided.totalAmount)` → `.toString()` |
| W2 | `bad-debt.service.ts` | `Number(p.provisionRate)` and `.toNumber()` on Decimal → `.toString()` |
| W3 | `accounting.controller.ts` | Replace inline `@Body()` type with a validated `MarkPaidDto` class |

Additionally, confirm (and add a comment to) whether `depreciation.controller.ts` intentionally omits `BranchGuard`.

After fixes, re-run `./tools/check-types.sh all` and `./tools/run-tests.sh` before merge.
