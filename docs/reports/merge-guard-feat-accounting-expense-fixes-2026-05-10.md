# Pre-Merge Guard Report

**Branch**: `feat/accounting-expense-fixes`
**Author**: Akenarin Kongdach
**Date**: 2026-05-10
**Reviewer**: Pre-Merge Guard (automated)
**Base**: `feat/ecl-stage-reverse` (stacked)

---

## Summary

107 commits unique vs `main` (includes receipt-rt + ecl-stage-reverse layers). This report covers the additional commits unique to this branch — primarily Asset Module Phase 1-3 and 4 expense-module gap fixes.

Key unique commits:

| Hash | Message |
|------|-------|
| `858eeca5` | feat(accounting): close 4 expense-module gaps — WHT, atomicity, VOID reverse, AP clearance |
| `d01f1b34` | Merge: Asset Module Phase 3 — Reports |
| `6945800c` | fix(asset): DISPOSED status filter predicate (was inverted) |
| `fd1cb868` | Merge: Phase 3 review fixes (2 Critical + 8 Important) |

Total diff vs `main`: **165 files, +36,439 / -1,416 lines**. Large branch — full Asset Module + bad-debt provision cron + depreciation service.

## Files Changed (Highlights)

| File | Lines | Notes |
|------|-------|------|
| `apps/api/src/modules/asset/asset.service.ts` | 1,186 total | Core asset CRUD + journal, split into sub-services |
| `apps/api/src/modules/asset/asset-journal.controller.ts` | +36 | New controller |
| `apps/api/src/modules/asset/asset-reports.controller.ts` | +26 | New controller |
| `apps/api/src/modules/asset/asset-transfer.controller.ts` | +53 | New controller |
| `apps/api/src/modules/depreciation/depreciation.service.ts` | 394 | New service |
| `apps/api/src/modules/accounting/bad-debt-provision.cron.ts` | +97 | New auto-provision cron |
| `apps/web/src/pages/assets/` | 11 new pages | Full Asset UI |
| `apps/api/prisma/schema.prisma` | +177/-? | `FixedAsset`, `AssetTransferHistory`, `DepreciationRun` models |
| `apps/api/prisma/migrations/20260808100000_asset_phase1/` | +220 | 3 migrations |

---

## Issues Found

### Critical — None

All 4 new controllers are properly guarded:

| Controller | Guards |
|-----------|------|
| `asset-journal.controller.ts` (`assets/journal`) | `@UseGuards(JwtAuthGuard, RolesGuard)` ✓ |
| `asset-reports.controller.ts` (`reports/asset-summary`) | `@UseGuards(JwtAuthGuard, RolesGuard)` ✓ |
| `asset-transfer.controller.ts` (`asset-transfers`) | `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` ✓ |
| `depreciation.controller.ts` (`depreciation`) | `@UseGuards(JwtAuthGuard, RolesGuard)` ✓ |

All controller methods have `@Roles(...)` decorators. No unguarded public endpoints added.

- Money handling: `Decimal` used throughout; `toNumber()` appears once only on `remainingMonths` (integer count — acceptable)
- No raw `$queryRaw` with string concatenation; existing template-literal advisory lock reused
- No hardcoded secrets or API keys
- All Prisma queries include `deletedAt: null` filter where applicable (JournalEntry lookups, asset queries in production paths)

### Warning — 2 items

**W1 — `asset.service.ts` is 1,186 lines (exceeds 500-line guideline)**

The service was deliberately split into `asset-journal.service.ts`, `asset-reports.service.ts`, and `asset-transfer.service.ts`, which is good architecture. However `asset.service.ts` itself remains large. This is a maintainability concern, not a correctness issue. Recommend tracking a follow-up refactor.

**W2 — `as any` casts in JSON `metadata` queries (service code, not tests)**

Six usages like `{ metadata: { path: ['flow'], equals: 'expense' } as any }` in `accounting.service.ts`. This is a Prisma limitation for JSON path filtering — there's no typed alternative without a raw query. Acceptable workaround, but should be documented with a comment explaining why (currently no comment).

### Info

1. **`bad-debt-provision.cron.ts`**: correctly wrapped in try/catch with Sentry capture — consistent with v3 cron hardening pattern. Sentry `captureMessage` on success (info level) + `captureException` on failure. ✓

2. **All new frontend pages use `React.lazy()` + `ProtectedRoute`**: 11 new asset routes all follow lazy-load pattern and are wrapped with correct role guards. ✓

3. **DTOs**: `CreateAssetDto` and `DisposeAssetDto` have comprehensive class-validator decorators with Thai messages on required fields. `UpdateAssetDto extends PartialType(CreateAssetDto)` — all fields optional by inheritance. ✓

4. **`wipe-assets.cli.ts` added**: destructive CLI (+106 lines). Guards present: `CONFIRM_WIPE=YES_I_AM_SURE` + `NODE_ENV=production` → `ALLOW_PROD_WIPE` check, matching the accounting wipe pattern. ✓

5. **Expense WHT fix (P0)**: `expense.template.ts` now correctly posts `Cr 21-3102/03` for WHT and credits only the net amount to cash. Previously cash was over-credited by `whtAmount` on every WHT expense. Critical business correctness fix.

6. **`markExpensePaid` atomicity fix**: JE post now runs inside the same `$transaction` as the status update. Eliminates orphan `status=PAID` + no JE state.

---

## Recommendation: **REVIEW**

The branch is architecturally sound and passes all critical checks. The **REVIEW** (not BLOCK) rating is for W1 and W2:

- **W1** (large service file) should be acknowledged in the PR — the split approach is the right direction but the core file still needs future work.
- **W2** (`as any` in JSON path queries) should have a short comment explaining the Prisma limitation to prevent future confusion.

Neither issue blocks merge, but both should be noted in the PR description or as follow-up issues. The expense WHT fix (P0) and atomicity fix make this branch high-priority to merge.
