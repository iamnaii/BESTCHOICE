# Merge Guard Report — feat/accounting-expense-fixes

**Date**: 2026-05-10  
**Branch**: `feat/accounting-expense-fixes`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Recommendation**: 🟡 REVIEW

---

## File Changes Summary

| Metric | Value |
|--------|-------|
| Files changed | 165 |
| Insertions | +36,439 |
| Deletions | −1,416 |
| Commits | ~20 |

**Key areas touched:**
- Full `asset` module: `AssetController`, `AssetJournalController`, `AssetReportsController`, `AssetTransferController`, `DepreciationController` (new)
- `asset.service.ts` (1,186 lines) — Phase A.5 PPE implementation
- `DepreciationModule` registered in `app.module.ts`
- `ExpenseReverseTemplate` + `ExpenseClearanceTemplate` for old `Expense` model void
- Void atomicity fix for legacy `accounting.service.ts`
- `wipe-assets.cli.ts` — destructive CLI with guards
- Bad debt / ECL provision improvements
- 3 new Prisma migrations

---

## Issues

### ⚠️ Warning

#### 1. `Number(voided.totalAmount)` and `Number(receipt.amount)` in immutable audit log entries

**File**: `apps/api/src/modules/accounting/accounting.service.ts`

```ts
this.structuredLogger.log('expense.voided', {
  ...
  totalAmount: Number(voided.totalAmount),   // Decimal → JS number
  ...
});

oldValue: {
  amount: Number(receipt.amount),  // stored in AuditLog.oldValue JSON
  ...
}
```

The audit log `oldValue` is a `Json` column intended to be an immutable forensic record. Using `Number()` on a `Prisma.Decimal` field can silently lose sub-cent precision for very large amounts (>15 significant digits). While unlikely at current data volumes, the pattern is inconsistent with the project rule (`Prisma.Decimal` not `Number()`), and especially problematic in an immutable evidence trail.

**Required fix**: Use `.toString()` or keep as `Prisma.Decimal` before serialising:
```ts
totalAmount: voided.totalAmount.toString(),
amount: receipt.amount.toString(),
```

#### 2. `AssetJournalController` and `AssetReportsController` missing `BranchGuard`

**Files**: `apps/api/src/modules/asset/asset-journal.controller.ts`, `apps/api/src/modules/asset/asset-reports.controller.ts`

```ts
@Controller('assets/journal')
@UseGuards(JwtAuthGuard, RolesGuard)   // ← no BranchGuard
export class AssetJournalController { ... }

@Controller('reports/asset-summary')
@UseGuards(JwtAuthGuard, RolesGuard)   // ← no BranchGuard
export class AssetReportsController { ... }
```

`AssetController` itself uses `BranchGuard`. The journal and reports controllers return journal entries and asset summaries scoped to all assets with no branch filter. A `BRANCH_MANAGER` of branch A can read PPE journal entries from branch B.

This may be intentional (FINANCE-level PPE is company-wide, not branch-scoped), but needs explicit confirmation. If intentional, add a `///` comment explaining the exemption so the next reviewer doesn't flag it again. If not intentional, add `BranchGuard` and pass `branchId` from `@CurrentUser()` into the service.

#### 3. `rate: Number(p.provisionRate)` in ECL reporting response

**File**: `apps/api/src/modules/accounting/accounting.service.ts`

`provisionRate` is a percentage (0.02 to 1.00). The conversion is safe at current precision requirements, but is inconsistent with the Decimal-everywhere rule.

---

### ℹ️ Info

#### 4. `asset.service.ts` at 1,186 lines

**File**: `apps/api/src/modules/asset/asset.service.ts`

Covers asset creation, depreciation, disposal, reversal, transfer, and copy. Consider splitting disposal/reversal logic into a dedicated `AssetDisposalService` in a follow-up PR.

#### 5. `wipe-assets.cli.ts` missing `EXPECTED_DB_NAME` guard

**File**: `apps/api/src/cli/wipe-assets.cli.ts`

The wipe-accounting CLI (`wipe-accounting.cli.ts`) added a `EXPECTED_DB_NAME` check in v3 hardening to prevent wrong-DB runs. `wipe-assets.cli.ts` has a `CONFIRM_WIPE` guard and NODE_ENV check but does not validate `current_database()` against an expected DB name. Recommend parity with the accounting wipe CLI.

---

## Recommendation

**🟡 REVIEW** — The branch delivers the Phase A.5 PPE module with solid Decimal usage throughout. Issues #1 and #2 are easy fixes. The `BranchGuard` question (#2) needs a deliberate decision with a comment. None of the issues are blocking from a correctness standpoint, but the audit-log precision (#1) should be fixed before merge given the 7-year immutable retention policy.
