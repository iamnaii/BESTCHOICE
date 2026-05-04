# Merge Guard Report — phase-a4-cpa-chart-adoption

**Date**: 2026-05-04  
**Branch**: `phase-a4-cpa-chart-adoption`  
**Author**: Akenarin Kongdach (`iamnaii@MacBook-Pro-khxng-Akenarin.local`)  
**Commits ahead of main**: 20  
**Files changed**: 88 files — 9,677 insertions / 4,640 deletions  

---

## Commit Summary

| Hash | Subject |
|------|---------|
| 71cb337 | feat(accounting): wipe CLI + rewrite accounting.md for Phase A.4 (T18) |
| a80c5bf | refactor(accounting): re-map TB/P&L/BS reports for FINANCE chart structure (T17) |
| a4dc726 | feat(payments): tolerance approval gate + audit log + dialog (T16) |
| 4c2b899 | feat(payments+users): cash account dimension UI + per-user default (T15) |
| 10fff2c | feat(journal): Feature I VAT 60-day mandatory + reversal + cron (T14) |
| 7b2c773 | feat(journal): Template vendor payable clearance (T13) |
| 14af6ca | feat(journal+installments): Template case 6 reschedule (6a/6b) + RescheduleService (T12) |
| 743ab8f | feat(journal): Template case 5 repossession w/ loss/gain branch (T11) |
| 3729ae0 | feat(journal): Template case 4 early payoff w/ 52-1106 discount (T10) |
| b243b0b | feat(journal): Template 2B-split partial payments (case 3) (T9) |
| cd84a52 | feat(journal): Template 2B payment receipt + tolerance enforcement (T8) |
| 3cd0a27 | feat(journal): Template 2A accrual + daily cron (T7) |
| 6e6e6e6 | feat(journal): Template 1A contract activation matches CPA CSV (T6) |
| 28a8b08 | test(journal): STANDARD_17K_12M fixture + JE block formatter (T5) |
| 3b5716f | feat(prisma): seed FINANCE CoA from CPA CSV (99 accounts) (T4) |
| 566f4db | refactor(accounting): purge Phase A.0-A.3 dead code (T3) |
| 321ee94 | feat(prisma): Phase A.4 schema — drop A.2 fields, add cash dimension + reschedule (T2) |
| 1ae675e | test(journal): add CPA CSV fixture loader + golden-diff matcher (T1) |
| 8812501 | docs(plan): Phase A.4 CPA chart adoption — 18 tasks |
| c08e5f8 | docs(spec): Phase A.4 CPA chart adoption design |

---

## File Changes (Key Areas)

| Area | Files |
|------|-------|
| NestJS controllers | `accounting.controller.ts`, `chart-of-accounts.controller.ts`, `payments.controller.ts`, `users.controller.ts` |
| NestJS services | `accounting.service.ts`, `chart-of-accounts.service.ts`, `payments.service.ts`, `users.service.ts`, `reschedule.service.ts`, `intercompany.service.ts` |
| Journal templates (new) | 7 CPA templates: `contract-activation-1a`, `installment-accrual-2a`, `payment-receipt-2b`, `payment-receipt-2b-split`, `early-payoff-jp4`, `repossession-jp5`, `reschedule-jp6`, `vat-60day-mandatory`, `vat-60day-reversal`, `vendor-clearance` |
| Crons (new) | `vat-60day.cron.ts`, `installment-accrual.cron.ts` |
| Prisma schema | Phase A.4 schema migration — `chart_of_accounts` restructured, `InstallmentSchedule` added, `Payment` + `User` get cash dimension fields |
| Migrations | 2 new migration files |
| CLI tool (new) | `apps/api/src/cli/wipe-accounting.cli.ts` — destructive one-shot reseed |
| React components (new) | `CashAccountSelect.tsx`, `ToleranceApprovalDialog.tsx` |
| React pages | `PaymentsPage/index.tsx` (+71 lines), `UserProfilePage.tsx` (+59 lines) |
| DTOs | `payment.dto.ts` (+23), `update-user.dto.ts` (+6), `chart-of-account.dto.ts` |
| Tests | 8 new spec files, CSV fixtures for 6 CPA journal cases |

---

## Issues by Severity

### Critical — NONE

All critical checks passed:

- **Guards**: All new controller endpoints (`@Get ledger/trial-balance`, `@Get ledger/profit-loss`, `@Get ledger/balance-sheet`, `@Get by-codes`, `@Patch me/cash-account`) inherit `@UseGuards(JwtAuthGuard, RolesGuard)` from their class-level decorator. Each method has a `@Roles()` decorator. ✓
- **Money as Decimal**: All financial computations use `new Decimal(...)` / `Prisma.Decimal`. No `Number()` calls on money fields in production services. ✓
- **`deletedAt: null`**: All new `findMany` / `findFirst` queries include `deletedAt: null` in the where clause. ✓
- **Hardcoded secrets**: None. Test fixtures use placeholder password `'x'` — appropriate for spec files. ✓
- **Raw SQL injection**: `$executeRawUnsafe` appears only in `wipe-accounting.cli.ts` (one-shot CLI, hardcoded table names, not user-controlled input) and in test teardown blocks. No parameterized-query violations. ✓
- **Intentionally public endpoints**: No new unguarded controllers that are not in the approved whitelist. ✓

---

### Warning — 3 issues

#### W-1: `as any` type casts in production journal template files

**Severity**: Warning  
**Files**:
- `apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.ts`
- `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b-split.template.ts`
- `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts`

**Details**: 17 production-code `as any` casts were found in these files. The pattern is:

```typescript
(c as any).storeCommission != null ? new Decimal((c as any).storeCommission.toString()) : ...
const interest = new Decimal((c as any).interestTotal.toString());
(c as any).vatAmount != null ? new Decimal((c as any).vatAmount.toString()) : ...
```

These bypass TypeScript's type checker on Prisma `Contract` select fields. The `as any` for JSONB `metadata` path filters (`{ metadata: { path: [...], equals: ... } } as any`) is an acceptable Prisma workaround.

**Risk**: Runtime crashes if the Contract select does not include these fields. The Decimal wrapping (`new Decimal(...)`) provides safe money handling, but the guard `!= null` is bypassed by `as any` if the field name were misspelled.

**Recommended fix**: Add `storeCommission`, `interestTotal`, `vatAmount` to the explicit Prisma `select` clause and type them properly with `Prisma.Decimal | null` instead of casting the entire object.

---

#### W-2: `wipe-accounting.cli.ts` — destructive CLI not gated by test environment check

**Severity**: Warning  
**File**: `apps/api/src/cli/wipe-accounting.cli.ts`

**Details**: The CLI has a correct `CONFIRM_WIPE=YES_I_AM_SURE` consent gate and clearly documents its destructive nature. However, it does not check that `NODE_ENV !== 'production'` or validate the `DATABASE_URL` domain before running. A mistaken production run could wipe contracts, payments, and journal data.

**Recommended enhancement**:
```typescript
if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PROD_WIPE) {
  console.error('ERROR: Refusing to wipe a production database. Set ALLOW_PROD_WIPE=1 to override.');
  process.exit(1);
}
```

Or at minimum, print the `DATABASE_URL` host clearly and require a 5-second countdown before executing. The runbook/CLAUDE.md should explicitly state this CLI must only run once after the Phase A.4 migration is confirmed.

---

#### W-3: `installmentSchedule` query uses `as any` on where clause

**Severity**: Warning  
**File**: `apps/api/src/modules/installments/reschedule.service.ts`

**Details**:
```typescript
const installments = await this.prisma.installmentSchedule.findMany({
  where: {
    contractId: input.contractId,
    installmentNo: { gte: input.fromInstallmentNo },
    deletedAt: null,
  } as any,
```

The `} as any` cast on the `where` clause is a sign that the generated Prisma types may not yet reflect the `InstallmentSchedule` model (possibly Prisma client not regenerated). This should be replaced with proper types once `prisma generate` is run.

---

### Info

#### I-1: `as any` counts are high across spec files (93 in specs + 17 in production)

Most `as any` casts in spec files pass a mock `PrismaClient` into constructors (`new JournalAutoService(prisma as any)`). This is a common test pattern, not a runtime risk. However, 110 total `as any` casts represent accumulated type debt. Consider introducing a typed test factory (`createTestJournalService(prisma: DeepMockProxy<PrismaClient>)`) to eliminate these gradually.

#### I-2: Migration `20260801100000` drops `chart_of_accounts` columns without a backfill migration for active data

The migration drops `company_id`, `account_group`, `name_th`, `name_en`, `is_active`, and `level` from `chart_of_accounts`. This is a breaking schema change. The wipe CLI is designed to handle this by truncating and reseeding the table. Confirm the deployment order: migration must run before any API traffic, and wipe CLI must run immediately after. The CLAUDE.md notes this as a one-time operation.

#### I-3: `ChartOfAccount` no longer has `companyId` scoping

Phase A.4 moves to a single flat chart, removing the per-company CoA partition from A.1a/A.2. Confirm that all remaining queries in `accounting.service.ts` and `journal-auto.service.ts` that previously filtered by `companyId` have been updated. The refactor in T3 (`purge Phase A.0-A.3 dead code`) should cover this — worth a targeted grep after merge.

#### I-4: `AuthContext.tsx` touched (2 lines)

**File**: `apps/web/src/contexts/AuthContext.tsx`  
The diff shows 2 new lines — likely adding `defaultCashAccountCode` to the auth user type. Low risk but worth confirming the type matches the API response shape.

---

## Summary of Checks

| Check | Result |
|-------|--------|
| Missing `@UseGuards` on new controllers | ✓ Pass |
| Missing `@Roles()` on new endpoints | ✓ Pass |
| `Number()` on money fields | ✓ Pass |
| Missing `deletedAt: null` in queries | ✓ Pass |
| Hardcoded secrets / API keys | ✓ Pass |
| SQL injection via `$queryRaw` | ✓ Pass |
| Raw `fetch()` in React components | ✓ Pass (all use `api.get()`) |
| Missing `queryClient.invalidateQueries()` after mutations | ✓ Pass |
| DTO validation decorators present | ✓ Pass |
| Thai validation messages on new DTOs | ✓ Pass |
| Design token compliance (no hardcoded hex/gray) | ✓ Pass |
| `as any` in production code | ⚠ 17 instances (W-1, W-3) |
| Destructive CLI consent gate | ⚠ Partial (W-2) |

---

## Recommendation

**REVIEW — Approve with fixes**

No security vulnerabilities or data integrity bugs were found. The branch can merge once:

1. **W-1** (optional but recommended): Replace `(c as any).storeCommission/interestTotal/vatAmount` with proper typed selects in the 3 template files, or at minimum add a runtime guard (`throw new Error(...)` if field is absent after the `as any` cast).
2. **W-2** (recommended): Add a `NODE_ENV === 'production'` check to `wipe-accounting.cli.ts` before executing the TRUNCATEs, or document the exact invocation procedure in a deploy runbook entry.
3. **W-3** (minor): Remove the `} as any` on the `reschedule.service.ts` where clause — run `npx prisma generate` and use the correct Prisma-generated type.

The tolerance approval gate (T16), cash account dimension (T15), VAT 60-day cron (T14), and all journal templates (T6–T13) follow the established security patterns. Crons use Sentry `captureException` with `continue-on-error`. DTOs have proper class-validator decorators with Thai messages. Frontend mutations invalidate the correct query keys.
