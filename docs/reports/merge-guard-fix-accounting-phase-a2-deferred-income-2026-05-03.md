# Merge Guard Report — fix/accounting-phase-a2-deferred-income

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a2-deferred-income`  
**Diverges from**: `9d72578c` (fix: Phase A.1c JE bug fixes — on main)  
**Author**: Akenarin Kongdach  
**Reviewed by**: Pre-Merge Guard Agent  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +8 | Add `21-2201` Unearned Commission (SHOP) |
| `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` | +/-2 | Update activation test for Phase A.2 |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +10 | Seed `unearnedInterest`/`unearnedCommission` at activation |
| `apps/api/src/modules/data-audit/data-audit.service.ts` | +1 | Pass `contract.id` in audit payload |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +/-266 | Major test overhaul for Phase A.2 model |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +/-213 | Core accounting model change |
| `apps/api/src/modules/payments/payments.service.ts` | +/-6 | Pass `contract.id` to journal method |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | +/-3 | Pass `contract.id` to journal method |
| + 2 more files | | |

**Total**: 452 insertions, 96 deletions across 10 files.

---

## What This Branch Does

Phase A.2 — Deferred income recognition model. Fundamental accounting change:

**Before (Phase A.1c):**
- Contract activation: `Cr. Interest Income + Cr. VAT Output + Cr. Commission Income` (upfront recognition)
- Payment JE: `Cr. HP Receivable (principal only)`, `Cr. Due-to-SHOP (commission per payment)`

**After (Phase A.2):**
- Contract activation: `Cr. Unearned Interest (21-2202) + Cr. VAT Output Pending (21-2102) + Cr. Unearned Commission (21-2201)` (deferred)
- Payment JE: `Dr. Unearned Interest + Dr. VAT Pending` → `Cr. Interest Income + Cr. VAT Output` (recognised cash-basis per payment)
- Payment JE: `Cr. HP Receivable = amountPaid - lateFee` (full installment, not just principal)
- SHOP payment JE: `Dr. Unearned Commission` → `Cr. Commission Income` (no longer touches Due-from-FINANCE per payment)
- `Contract.unearnedInterest` / `unearnedCommission` fields kept in sync for dashboard use

New accounts added: `VAT_OUTPUT_PENDING: '21-2102'` (confirmed exists in chart seed on main), `UNEARNED_COMMISSION: '21-2201'` (new SHOP account added in this branch's seed).

New data-integrity check: when a non-zero payment breakdown is provided, its sum must equal `amountPaid` (±0.02). Drift triggers `InternalServerErrorException` + Sentry alarm.

---

## Issues Found

### Critical
None.

### Warning

**W1 — Migration concern: HP Receivable model is backward-incompatible**

The HP Receivable balance carried at contract activation changed:

| Phase | HP Receivable Dr at activation | HP Receivable Cr per payment |
|-------|-------------------------------|------------------------------|
| A.1c | principal + commission + interest + VAT | principal only |
| A.2 | principal + commission + interest + VAT | full installment (amountPaid - lateFee) |

Contracts activated under Phase A.1c (old model) have their HP Receivable loaded identically, but the payment JE now credits it by the full installment instead of just principal. For old active contracts, this will **over-drain HP Receivable** once this branch is deployed — the account may go negative if payments continue after deployment.

This is a migration concern that must be addressed before deploy:
- Either backfill all old contract JEs (complex), or
- Accept the accounting inconsistency for in-flight contracts (risky), or
- Deploy a migration script that reprocesses open contract JEs.

The branch does not include a migration script. **Confirm migration plan before merging.**

**W2 — `contract.storeCommission ?? 0` mixes Decimal and number** (`contract-workflow.service.ts:406`)
```typescript
unearnedCommission: contract.storeCommission ?? 0,
```
`contract.storeCommission` is a Prisma `Decimal` field. The `?? 0` fallback is a plain JS number `0`. Prisma coerces `0` to `Decimal(0)` when writing, so functionally correct — but violates the `Decimal` rule for money fields. Should be:
```typescript
unearnedCommission: contract.storeCommission ?? new Prisma.Decimal(0),
```

**W3 — Silent failure mode for unearned tracking** (`journal-auto.service.ts:383-393`)
```typescript
if (params.contract.id && (interest.gt(0) || commission.gt(0))) {
  await tx.contract.update({ where: { id: params.contract.id }, data: { ... } });
}
```
The `params.contract.id` is typed as `id?: string` (optional). If a caller omits `id`, the `Contract.unearnedInterest`/`unearnedCommission` fields get out of sync with the ledger — silently, with no error. The JE still posts correctly. Currently `payments.service.ts` and `paysolutions.service.ts` both pass `id` correctly. Risk is future callers forgetting to pass it. Consider making `id` required or adding a Sentry warning when it's missing.

### Info

**I1 — `createCustomerCreditPaymentJournal` also updated** for Phase A.2 (HP drain, Unearned drain, contract.id tracking). Consistent with `createPaymentJournal` model. ✅

**I2 — `UNEARNED_INTEREST: '21-2202'`** — maps to `รายได้ดอกเบี้ยรอตัดบัญชี` per CLAUDE.md `[DEFERRED W-003]`. The W-003 deferral note says "ต้อง business decision" — but this branch implements it. Confirm this is intentional and the business decision has been made.

**I3 — New `21-2201` account** (Unearned Commission SHOP) added to seed `chart-of-accounts.ts` — correct location under SHOP extra accounts. ✅

**I4 — `VAT_OUTPUT_PENDING: '21-2102'`** — confirmed to exist in `chart-of-accounts-finance.ts` on main at line 30. ✅

---

## Security Checklist

| Check | Result |
|-------|--------|
| No new controllers added | ✅ N/A |
| `Number()` on money fields | ✅ None — `Prisma.Decimal` throughout; `.toNumber()` only for JE line serialisation |
| `deletedAt: null` in queries | ✅ `tx.contract.update` by PK doesn't require it (correct) |
| Hardcoded secrets | ✅ None |
| `$queryRaw` injection | ✅ None in this branch |
| Data-integrity check on payment breakdown | ✅ Throws + Sentry on drift |

---

## Action Required Before Merge

1. **[MUST]** Provide migration plan/script for existing in-flight contracts under old A.1c model (W1) — otherwise HP Receivable will go negative on old contracts' next payments
2. **[SHOULD]** Confirm W-003 deferral decision (unearned interest) is approved by business owner (I2)
3. **[SHOULD]** Change `storeCommission ?? 0` to use `new Prisma.Decimal(0)` (W2)
4. **[SHOULD]** Add Sentry warning when `params.contract.id` is absent in `createPaymentJournal` (W3)
