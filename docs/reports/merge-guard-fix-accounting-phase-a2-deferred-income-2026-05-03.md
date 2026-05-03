# Merge Guard Report — `fix/accounting-phase-a2-deferred-income`

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a2-deferred-income`  
**Authors**: iamnaii, Akenarin Kongdach  
**Recommendation**: ⚠️ REVIEW

---

## Summary

Phase A.2 — Deferred income recognition (TFRS for NPAEs cash-basis). Adds `unearnedInterest` and `unearnedCommission` tracking fields to `Contract`, rewrites the payment JE to drain Unearned accounts per installment instead of recognising income at activation, and adds a comprehensive end-to-end lifecycle spec (activation + 12 payments → all deferred accounts drain to zero).

**Note**: This is the final layer in a stacked PR chain. It contains all W-2/W-4 and A.3 changes. Must be merged last. Merge order: **W-2/W-4 → A.3 → A.2**.

---

## File Changes (10 files, +452 / -96)

| File | Type | Change |
|---|---|---|
| `apps/api/prisma/migrations/20260616000000_add_unearned_income_fields/migration.sql` | Migration | +25 — adds two `DECIMAL(12,2)` columns + backfill |
| `apps/api/prisma/schema.prisma` | Schema | +7 — `unearnedInterest`, `unearnedCommission` on `Contract` |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | Seeds | +10 / -1 — `21-2201` Unearned Commission account |
| `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` | Tests | +4 / -4 — updated assertion |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | Backend | +13 / -4 — seed unearned fields at activation |
| `apps/api/src/modules/data-audit/data-audit.service.ts` | Backend | +1 — pass `id` to journal call |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | Tests | +266 / -20 — 12-payment lifecycle tests |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Backend | +213 / -84 — deferred recognition JE logic |
| `apps/api/src/modules/payments/payments.service.ts` | Backend | +6 / -3 — pass `contract.id` in 3 call sites |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | Backend | +3 / -1 — pass `contract.id` |

---

## Issues

### ⚠️ Warning

**W-1. Migration timestamp is future-dated** (`migrations/20260616000000_add_unearned_income_fields/`)

Migration directory is named `20260616000000` (June 16, 2026), but today is 2026-05-03 (May 3, 2026). Prisma migrations are applied in lexicographic order. Any new migrations created between now and this branch being merged will have an earlier timestamp (`20260503*` to `20260615*`) and will be applied before this one in deployment — which is correct. However, after merge, if another migration is created after this one has deployed (i.e., after June 16), its timestamp will sort after this one. In practice this is fine since migrations are append-only, but the future timestamp creates cognitive confusion ("why is this migration dated six weeks from now?"). Consider renaming to `20260503000000_` or the actual current date on merge.

**W-2. Backfill heuristic in migration is approximate** (`migration.sql:12-25`)

```sql
"unearned_interest" = GREATEST(0, c."interest_total" - COALESCE((
  SELECT SUM(p."monthly_interest") FROM "payments" p
  WHERE p."contract_id" = c."id" AND p."status" = 'PAID' AND p."deleted_at" IS NULL
), 0))
```

The backfill approximates "already earned" as the sum of paid `monthly_interest`. This is noted in the migration comment as intentional ("cleanest heuristic for the new per-payment recognition to take over from"). The risk: pre-Phase-A.2 payment JEs may have already credited interest income at activation (the old buggy double-count), so the unearned balance on existing contracts could be under- or over-stated by the amount of the activation JE's interest credit. The migration is correct for forward-going payments; legacy JEs on existing contracts may have minor mismatch. This is a known and accepted approximation — no action required, but worth confirming with the CPA on first monthly-close post-merge.

### ℹ️ Info

**I-1. `Number()` in test assertions is acceptable**

Several test assertions use `Number(line.credit)` / `Number(line.debit)` to convert Prisma `Decimal` mock return values for `toBeCloseTo()` comparisons. This is standard jest practice for Decimal-valued fields and is intentional — no issue.

**I-2. 12-payment lifecycle test is long but well-structured**

The end-to-end lifecycle spec in `journal-auto.service.spec.ts` simulates activation + 12 installment payments and asserts deferred accounts drain to 0. This is 100+ lines but provides high-confidence correctness coverage for the core accounting invariant. File remains within the 500-line guideline for this type of spec file.

**I-3. `paysolutions.service.ts` change is minimal but critical**

The `+3 / -1` change passes `contract.id` to `createPaymentJournal`. This is required for the new deferred income logic (which calls `contract.update()` to decrement unearned balances). All three payment call sites in `payments.service.ts` have been updated; `paysolutions.service.ts` makes it four. Verify that webhook-driven payments and manual payments both pass `contract.id` consistently.

---

## Security Checklist

| Check | Result |
|---|---|
| No new controllers / endpoints | ✅ — existing endpoints only |
| `deletedAt: null` in all new queries | ✅ |
| Migration uses safe `ALTER TABLE ADD COLUMN ... DEFAULT 0` (non-breaking) | ✅ |
| Backfill uses `WHERE deletedAt IS NULL` | ✅ |
| No raw `$queryRaw` with unparameterized input | ✅ |
| No hardcoded secrets / API keys | ✅ |
| `Prisma.Decimal` for all financial arithmetic | ✅ — `Number()` only in test assertions |
| New schema fields use `@db.Decimal(12, 2)` | ✅ |

---

## Recommendation

**⚠️ REVIEW** — No critical security blockers. W-1 (future-dated migration) is the only actionable pre-merge issue — rename the directory to today's date or the actual merge date. W-2 (backfill approximation) is an accepted known limitation that should be noted at the next monthly-close. Info items are non-blocking.
