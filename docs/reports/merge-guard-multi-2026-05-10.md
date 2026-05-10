# Pre-Merge Guard Report — 2026-05-10

**Reviewer**: Pre-Merge Guard Agent  
**Date**: 2026-05-10  
**Branches reviewed**: 3 (most recently updated non-guard branches)

---

## Branch 1: `fix/contract-status-terminated`

**Author**: Akenarin Kongdach  
**Unique commits**: 2  
**Files changed**: 19 (+52 / -36)

### Summary

Pure rename: `ContractStatus.LEGAL` → `ContractStatus.TERMINATED` across services, creons, specs, and the frontend filter UI. Matches `termination_policy.docx` terminology. No logic changes — every occurrence of the old literal is mechanically replaced.

### Files changed
- `overdue/analytics-aging.service.ts` — raw SQL status filter
- `overdue/analytics-leaderboard.service.ts` — raw SQL status filter
- `overdue/auto-balance.service.ts` + spec — findMany filter + counter variable
- `overdue/contract-letter.service.ts` + spec — status transition write
- `overdue/contract-snapshot.cron.ts` — cron filter
- `overdue/queue.service.ts` + spec — groupBy filter
- `overdue/stuck-contracts.service.ts` — raw SQL filter
- `repossessions/repossessions.service.ts` + spec — status check + strict-mode config key rename (`jp5_require_legal_status` → `jp5_require_terminated_status`)
- `cli/backfill-installment-schedules.cli.ts` — CLI filter
- `journal/cron/installment-accrual.cron.ts` — notIn filter comment + value
- `web/CollectionsPage/components/FilterDrawer.tsx` — status chip label
- `web/CollectionsPage/components/LegalCaseBanner.tsx` — enabled condition
- `web/CollectionsPage/constants/systemPresets.ts` — preset filter value

### Security Checks

| Check | Result |
|-------|--------|
| New controllers without JwtAuthGuard | N/A — no new controllers |
| Missing @Roles on new endpoints | N/A — no new endpoints |
| Number() on money fields | No new money field usage |
| Missing deletedAt: null in new queries | No new queries |
| Hardcoded secrets | None |
| Raw SQL injection risk | Raw SQL uses `$1` parameterized placeholders ✓ |

### Issues

None found.

### Recommendation: ✅ APPROVE

---

## Branch 2: `fix/2a-cron-auto-consume-advance`

**Author**: Akenarin Kongdach  
**Unique commits**: 2 (`dd00ba14`, `f5bdb42d`)  
**Files changed**: 13 (+2489 / -114)

### Summary

Two new commits on top of main (post-`#792`):

1. **`dd00ba14` — close 4 expense-module gaps**: WHT atomicity, VOID reverse JE, AP clearance template, accrual workflow
2. **`f5bdb42d` — 2A auto-consumes advance balance**: InstallmentAccrual cron skips installments already covered by a prior advance payment (closes pre-due-date receipt loop)

New journal templates added:
- `expense-clearance.template.ts` — clears AP to cash when accrued expense is paid
- `expense-reverse.template.ts` — reverses a previously posted expense JE
- `installment-accrual-2a.template.ts` — advance-consume logic for 2A cron
- Updated `expense.template.ts` — full atomicity refactor (`markPaid` now rolls back on JE failure)

New controller endpoint:
- `POST accounting/:id/accrue` — triggers accrual JE (status APPROVED → ACCRUED)

### Security Checks

| Check | Result |
|-------|--------|
| New controllers without JwtAuthGuard | Controller-level `@UseGuards(JwtAuthGuard, RolesGuard)` already in place ✓ |
| Missing @Roles on new `accrue` endpoint | `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` present ✓ |
| Number() on money fields (financial calc) | `totalAmount: Number(voided.totalAmount)` — **logger only**, not for calculation (acceptable) |
| New Decimal usage in templates | All templates use `new Decimal(...)` throughout ✓ |
| Missing deletedAt: null | All new `findFirst`/`findMany` include `deletedAt: null` ✓ |
| Hardcoded secrets | None |
| Raw SQL injection | No raw SQL added |

### Issues Found

#### ⚠️ Warning — Missing DTO for `depositAccountCode` in `markPaid`

**File**: `apps/api/src/modules/accounting/accounting.controller.ts`  
**Lines**: `markPaid` method

```ts
// BEFORE
@Body('paymentDate') paymentDate?: string

// AFTER (new)
@Body() body: { paymentDate?: string; depositAccountCode?: string } = {}
```

The inline type `{ paymentDate?: string; depositAccountCode?: string }` is not a class-validator DTO — it will **not** be validated by NestJS's global `ValidationPipe`. Per accounting rules, `depositAccountCode` must match the regex `^11-(1101|1102|1103|1201|1202|1203)$`. Without validation, an authorized user (OWNER / FINANCE_MANAGER / ACCOUNTANT) could pass any arbitrary string, posting a journal line against a non-existent account code.

**Fix**: Create a `MarkExpensePaidDto` with a `@Matches` decorator:

```ts
// dto/mark-expense-paid.dto.ts
import { IsDateString, IsOptional, Matches } from 'class-validator';

export class MarkExpensePaidDto {
  @IsOptional()
  @IsDateString({}, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })
  paymentDate?: string;

  @IsOptional()
  @Matches(/^11-(1101|1102|1103|1201|1202|1203)$/, {
    message: 'depositAccountCode ต้องเป็นรหัสเงินสด/ธนาคารที่กำหนด (11-1101 ถึง 11-1203)',
  })
  depositAccountCode?: string;
}
```

#### ℹ️ Info — `Number(voided.totalAmount)` in structured logger

**File**: `apps/api/src/modules/accounting/accounting.service.ts`  
Minor inconsistency with project Decimal convention — used only in `structuredLogger.log`, not for any financial calculation. Low priority.

### Recommendation: 🔶 REVIEW

Fix the `MarkExpensePaidDto` issue before merge. No blocking security holes — the route already requires high-privilege roles and the journal system will reject unknown account codes at the template level — but missing input validation at the boundary violates project rules.

---

## Branch 3: `feat/accounting-expense-fixes`

**Author**: Akenarin Kongdach  
**Unique commits**: ~25+ (Asset Module Phase 1+2+3, Depreciation module, expense gap fixes)  
**Files changed**: 165 (+36,439 / -1,416)

### Summary

Large feature branch implementing the PPE (Property, Plant & Equipment) asset register system. Key additions:

**New backend modules:**
- `asset/` — full CRUD, posting, reversal, disposal, copy, transfer, write-off; journal templates for purchase + reverse + disposal + reverse-disposal
- `depreciation/` — manual run, preview, reverse run; straight-line depreciation
- `asset-journal/` controller + service — journal ledger view per asset
- `asset-reports/` controller + service — summary by category/custodian/location
- `asset-transfer/` controller + service — cross-branch transfer audit

**New Prisma models** (via migration `20260808100000_asset_phase1`):
- `FixedAsset`, `DepreciationEntry`, `AssetTransfer`

**New frontend pages** (9 new pages + components):
- `AssetsListPage`, `AssetDetailPage`, `AssetEntryPage`, `AssetDisposePage`, `AssetAuditPage`, `AssetJournalPage`, `AssetRegisterPage`, `AssetSchedulePage`, `AssetSummaryReportPage`, `DepreciationPage`, `AssetTransfersListPage`

**Expense module gaps (shared with branch 2):**
- WHT atomicity, VOID reverse JE, AP clearance template

### Security Checks

| Check | Result |
|-------|--------|
| `AssetController` — `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` | ✓ class-level |
| `AssetJournalController` — `@UseGuards(JwtAuthGuard, RolesGuard)` | ✓ class-level |
| `AssetReportsController` — `@UseGuards(JwtAuthGuard, RolesGuard)` | ✓ class-level |
| `AssetTransferController` — `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` | ✓ class-level |
| `DepreciationController` — `@UseGuards(JwtAuthGuard, RolesGuard)` | ✓ class-level |
| All new methods have `@Roles(...)` | ✓ verified for all 5 controllers |
| Frontend mutations use `queryClient.invalidateQueries()` | ✓ all checked |
| Frontend uses `api.get()`/`api.post()` not raw `fetch()` | ✓ |
| `deletedAt: null` in new Prisma queries | ✓ (sequence generators intentionally omit — see Info below) |
| `DepreciationController.preview` — free-form `period` param | ✓ service validates with regex `^\d{4}-(0[1-9]|1[0-2])$` |
| `RunDepreciationDto` / `ReverseDepreciationRunDto` | ✓ class-validator `@Matches` + `@MinLength` decorators, Thai messages |
| Hardcoded secrets | None (test `password: 'x'` are mock fixtures only) |
| Raw SQL | None in new code |

### Issues Found

#### ⚠️ Warning — `Number()` cast on Prisma.Decimal in `bad-debt.service.ts`

**File**: `apps/api/src/modules/accounting/bad-debt.service.ts`  
**Line ~284**: `rate: Number(p.provisionRate)`

`provisionRate` is a `Prisma.Decimal` column. Casting with `Number()` converts it for the report response object. While precision loss is negligible for a rate field (e.g. 0.05) within float64 range, this is inconsistent with the v4 Decimal mandate and the `bad-debt.service.ts` comment that explicitly says it replaces `Number()` casts.

Additionally, `provisionAmount: provisionAmountDecimal.toNumber()` stores the computed amount as `number` in the local `provisions[]` array, then re-wraps it with `new Prisma.Decimal(p.provisionAmount)` before the DB write. The round-trip is safe for `Decimal(12,2)` but fragile — a future edit could drop the re-wrap.

**Fix**: Keep `provisionRate` as `.toString()` in the response, or just use the Decimal directly. For the local array, consider keeping `provisionAmountDecimal: Decimal` and only converting to `number` for the `byBucket` aggregation counter.

#### ℹ️ Info — Sequence generators omit `deletedAt: null` (undocumented exception)

**Files**: `asset.service.ts` — `generateAssetCode()` (line ~77) and `generateDocNo()` (line ~107)

These functions intentionally query all rows (including soft-deleted) to avoid reusing sequence numbers. Per `database.md`, exception patterns must include a `///` comment explaining the omission. Currently no such comment is present.

**Fix**: Add comment above each `findMany`:
```ts
/// Intentionally includes deletedAt rows — must not reuse asset codes of deleted records.
```

#### ℹ️ Info — Branch is very large (165 files, 36K lines)

This PR bundles Asset Phase 1+2+3 + Depreciation + expense fixes into a single branch. Difficult to review atomically. Consider splitting into:
1. `feat/asset-phase1` — Prisma schema + basic CRUD
2. `feat/asset-phase2+3` — reports + transfers + audit
3. `feat/depreciation` — depreciation module
4. `fix/expense-gaps` — WHT atomicity etc.

(This is informational — not a blocker given tests pass.)

### Recommendation: 🔶 REVIEW

No critical security issues. Fix the `bad-debt.service.ts` Decimal precision warning and add `///` comments on the sequence generator queries before merge. The large size of this PR is an Info-level concern.

---

## Overall Summary

| Branch | Files | Critical | Warning | Info | Verdict |
|--------|-------|----------|---------|------|---------|
| `fix/contract-status-terminated` | 19 | 0 | 0 | 0 | ✅ APPROVE |
| `fix/2a-cron-auto-consume-advance` | 13 | 0 | 1 | 1 | 🔶 REVIEW |
| `feat/accounting-expense-fixes` | 165 | 0 | 1 | 2 | 🔶 REVIEW |

**No BLOCK-level issues found.** Both REVIEW branches have well-guarded controllers and correct Decimal arithmetic at the DB write boundary. The warnings are about missing input validation (branch 2) and a Decimal convention inconsistency (branch 3) that are straightforward to fix.
