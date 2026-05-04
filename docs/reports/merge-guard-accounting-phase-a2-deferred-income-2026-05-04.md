# Merge Guard Report — fix/accounting-phase-a2-deferred-income

**Date**: 2026-05-04  
**Branch**: `fix/accounting-phase-a2-deferred-income`  
**Last commit**: `fix(accounting): post-review fixes for Phase A.2 (#726)`  
**Recommendation**: **REVIEW** (no blockers — two warnings, one info)

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/prisma/migrations/20260616000000_add_unearned_income_fields/migration.sql` | +25 | ADD COLUMN unearned_interest/commission + backfill |
| `apps/api/prisma/schema.prisma` | +7 | `unearnedInterest`, `unearnedCommission` fields on Contract |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +10/-1 | Add SHOP acc `21-2201` Unearned Commission Income |
| `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` | +4/-4 | Update activation test for Phase A.2 |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +13/-4 | Seed unearned fields on contract activation |
| `apps/api/src/modules/data-audit/data-audit.service.ts` | +1 | Add `contract.id` to audit context |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +266/-3 | Extensive test updates + new lifecycle tests |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +213/-96 | Phase A.2 deferred recognition in payment + early-payoff JEs |
| `apps/api/src/modules/payments/payments.service.ts` | +3/-3 | Pass `contract.id` to payment JE |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | +3 | Pass `contract.id` to payment JE |

**Total**: +452 / -96 lines across 10 files

---

## Issues

### Warning

**W1 — Raw `0` used as fallback for Decimal field on contract activation**  
`apps/api/src/modules/contracts/contract-workflow.service.ts:65`
```typescript
unearnedCommission: contract.storeCommission ?? 0,
```
`storeCommission` is `Decimal | null` in the schema. Prisma accepts the raw `0` number and coerces it, but the explicit pattern used everywhere else is `new Prisma.Decimal(contract.storeCommission ?? 0)`. Inconsistency could confuse future readers and TypeScript strict mode may flag it depending on config.  
_Severity_: Warning — no runtime impact (Prisma coerces), but style inconsistency.

**W2 — Zero-amount deferred lines always emitted in payment JE**  
`apps/api/src/modules/journal/journal-auto.service.ts` (createPaymentJournal lines array):
```typescript
{ accountCode: FA.UNEARNED_INTEREST, description: 'ตัดดอกเบี้ยรอตัดบัญชี', debit: interest.toNumber(), credit: 0 },
{ accountCode: FA.VAT_OUTPUT_PENDING, description: 'ตัดภาษีขายรอเรียกเก็บ', debit: vat.toNumber(), credit: 0 },
```
When `interest = 0` or `vat = 0` (e.g. VAT-exempt installments), zero-amount lines are included in every JE. These create noise in the ledger that accountants must filter when reviewing entries. The existing pattern for `lateFee` and `commission` guards against zero before adding lines.  
_Severity_: Warning — no accounting error (0 debits balance), but journal quality issue.

---

### Info

**I1 — Migration timestamp is 6 weeks in the future**  
Migration name: `20260616000000_add_unearned_income_fields`  
Today is 2026-05-04. New migrations created on main between now and 2026-06-16 would have timestamps like `20260504...` to `20260615...`, which sort before this migration. Prisma applies migrations in lexicographic order, so the execution order remains deterministic. However, if another migration added to main in this window depends on `unearned_interest`/`unearned_commission` columns existing, there would be a dependency ordering conflict. Low risk since these are new columns with no dependencies, but the future timestamp is unusual and warrants a note.  
_Severity_: Info — no immediate risk; verify no other branch in flight depends on these columns.

---

## Security Checks

| Check | Status |
|-------|--------|
| New controllers / missing guards | N/A — no new controllers |
| `Number()` on money fields | ✓ PASS — `Prisma.Decimal` throughout JournalAutoService |
| `deletedAt: null` in queries | ✓ PASS — migration backfill includes `AND c.deleted_at IS NULL` |
| Hardcoded secrets | ✓ PASS — none |
| Migration safety (existing data) | ✓ PASS — `ADD COLUMN NOT NULL DEFAULT 0` is non-blocking; backfill uses `GREATEST(0, ...)` guard |
| `payments.service.ts` / `paysolutions.service.ts` changes | ✓ PASS — only add `contract.id` to existing JE call, no logic changes |

---

## Migration Safety Assessment

```sql
ALTER TABLE "contracts"
  ADD COLUMN "unearned_interest"   DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "unearned_commission" DECIMAL(12, 2) NOT NULL DEFAULT 0;
```
- `NOT NULL DEFAULT 0` — safe on large tables; PostgreSQL adds the column with a default without rewriting rows (fast DDL)
- Backfill UPDATE only touches `ACTIVE/OVERDUE/DEFAULT` contracts with `deleted_at IS NULL`
- `GREATEST(0, ...)` prevents negative unearned values from legacy data inconsistencies
- Safe for production with `prisma migrate deploy`

---

## Recommendation: REVIEW

No critical blockers. Two warnings should be addressed before merge:
1. Replace `contract.storeCommission ?? 0` with `new Prisma.Decimal(contract.storeCommission ?? 0)` in `contract-workflow.service.ts:65`
2. Add zero-guards around `UNEARNED_INTEREST` and `VAT_OUTPUT_PENDING` debit lines in `createPaymentJournal` (consistent with existing `lateFee`/`commission` guards)

The Phase A.2 deferred recognition model is architecturally sound: activation seeds Unearned balances, each payment drains them proportionally, and the lifecycle test verifies all deferred accounts reach zero after full payment.
