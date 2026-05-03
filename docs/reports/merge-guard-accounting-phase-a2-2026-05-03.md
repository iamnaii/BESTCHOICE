# Merge Guard Report — fix/accounting-phase-a2-deferred-income

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a2-deferred-income`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Base**: `origin/main`  
**Recommendation**: ⚠️ REVIEW — 3 warnings, 1 info. No critical blockers.

---

## Summary

Phase A.2 — Deferred income recognition per TFRS for NPAEs cash-basis policy. Replaces the old
"recognise interest + commission upfront at activation" model with a deferred-liability model:

- Activation: debit HP Receivable (full), credit Unearned Interest / Unearned Commission /
  VAT Output Pending (new accounts).
- Each payment: drain the Unearned accounts into the Income / VAT Output accounts.
- Early payoff: drain all remaining Unearned balances proportionally.

Also adds `Contract.unearnedInterest` / `unearnedCommission` as denormalized counters
(seeded at activation, decremented per payment) to avoid GroupBy queries in hot paths.

**Files changed**: 10 (452 insertions, 96 deletions)

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add `unearnedInterest`, `unearnedCommission` to Contract |
| `apps/api/prisma/migrations/20260616.../migration.sql` | DDL + backfill for ACTIVE/OVERDUE/DEFAULT contracts |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | Add SHOP account `21-2201` (Unearned Commission) |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Deferred-model JE logic across createPaymentJournal, createCreditAllocationJournal, createEarlyPayoffJournal, createContractActivationJournal |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | 266 lines: lifecycle invariant tests, updated unit tests |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | Seed `unearnedInterest`/`unearnedCommission` at activation |
| `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` | Update assertion for new activation data |
| `apps/api/src/modules/payments/payments.service.ts` | Pass `contract.id` into `createPaymentJournal` (3 sites) |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | Pass `contract.id` into payment JE (1 site) |
| `apps/api/src/modules/data-audit/data-audit.service.ts` | Pass `contract.id` into audit JE call |

---

## Issues

### ⚠️ Warning

**W-1: VAT_OUTPUT_PENDING mapped to account code `21-2102` — not present in documented FINANCE chart**

File: `apps/api/src/modules/journal/journal-auto.service.ts` (line ~513)

```typescript
VAT_OUTPUT_PENDING: '21-2102', // Phase A.2 — deferred output VAT
```

The `accounting.md` FINANCE chart lists `21-2104` as the deferred-VAT account
(`ภาษีขายดอกเบี้ยรอตัดบัญชี [DEFERRED CR-001]`) and `21-2201` as Unearned Interest.
Account `21-2102` does not appear in the documented chart. If `21-2102` was added to the
FINANCE chart CSV but not reflected in `accounting.md`, this is a documentation gap.
If it was not added to the chart seed, the `createAndPost` companyId-scoped lookup will
throw `BadRequestException: account not found in this company's chart` at runtime.

**Action required**: Verify `21-2102` exists in `docs/references/finance-chart-of-accounts.csv`
and that the FINANCE chart seed includes it. Update `accounting.md` to document it.

---

**W-2: Breakdown drift guard is a breaking change for existing payment data**

File: `apps/api/src/modules/journal/journal-auto.service.ts` (~L555–L565)

```typescript
if (hasBreakdown && breakdownSum.minus(amountPaid).abs().toNumber() > 0.02) {
  throw new InternalServerErrorException(msg); // + Sentry alarm
}
```

This correctly catches data corruption, but it is a breaking change: any existing payment record
where `monthlyPrincipal + monthlyInterest + monthlyCommission + vatAmount + lateFee ≠ amountPaid`
(beyond 0.02 tolerance) will now throw when re-processed via paysolutions retry or data-audit
playback. Legacy manually-adjusted payments are the most likely affected population.

**Action required**: Before deploying, run a one-off audit query to identify payments where
`breakdown_sum != amount_paid` beyond 0.02 tolerance and either correct the data or exclude them
from the guard (e.g., by checking `createdAt < PHASE_A2_CUTOFF`).

---

**W-3: Migration timestamp `20260616000000` is 6 weeks in the future**

File: `apps/api/prisma/migrations/20260616000000_add_unearned_income_fields/migration.sql`

Prisma applies migrations in lexicographic order. Any migration committed between now and
June 16 will run *before* this migration, which is correct. However, the naming convention
in this repo uses the actual creation date (e.g., `20260429...`). A far-future timestamp
could confuse `prisma migrate status` output and CI reports, making it look like a pending
future migration is blocking deploy.

**Action required**: Rename to `20260429000000_add_unearned_income_fields` (or the actual
date the feature was written) before merging.

---

### ℹ️ Info

**I-1: Backfill heuristic in migration is an approximation for in-flight contracts**

The migration backfill uses `SUM(monthly_interest) WHERE status = 'PAID'` to estimate
already-recognised interest. For contracts with manually adjusted payment amounts or legacy
import data (pre-Phase-A.1), the approximation may overcount already-earned interest,
leaving `unearnedInterest` slightly negative after backfill. The `GREATEST(0, ...)` guard
prevents a negative DB value, but it means the denormalized counter could drift from the
JE ledger for these contracts. Since these are historical contracts and early payoff will
zero the fields anyway, the impact is bounded and acceptable. Documented here for
awareness.

---

## Security Checks

| Check | Result |
|-------|--------|
| `@UseGuards` on new controllers | N/A (no new controllers) |
| `@Roles()` on new methods | N/A |
| `Number()` on money fields | ✅ None — all computations use `new Prisma.Decimal()` |
| `deletedAt: null` in new Prisma queries | ✅ Present (backfill SQL, service queries) |
| Hardcoded secrets / API keys | ✅ None |
| SQL injection | ✅ No raw `$queryRaw` without parameterization |
| Schema migration uses `DEFAULT 0` on `NOT NULL` columns | ✅ Safe for populated tables |
| `{ decrement: Decimal }` atomic updates on unearned fields | ✅ Correct Prisma atomic syntax |

---

## Notable Strengths

- **Lifecycle invariant test** (`'full contract: activation + 12 payments → all deferred accounts drain to 0'`)
  is a strong regression guard for the deferred model — covers both FINANCE and SHOP side.
- **Inter-company invariant test** verifies `shopDueFrom == financeDueTo` after activation.
- Zero-value journal lines are now guarded with conditional push (`financeLines.push(...)`)
  resolving W-1 from the A.1c branch.
- `data.integrity drift guard` + Sentry alarm is a valuable P0 catch.
