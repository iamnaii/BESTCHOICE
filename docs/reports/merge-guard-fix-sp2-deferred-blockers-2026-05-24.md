# Merge Guard Report — fix/sp2-deferred-blockers

**Date**: 2026-05-24  
**Branch**: `fix/sp2-deferred-blockers`  
**Author**: Akenarin Kongdach (iamnaii)  
**Reviewed by**: Pre-Merge Guard Agent  
**Closes**: Issue #1086 items 3, 4, 6

---

## File Changes Summary

| File | +Lines | −Lines | Notes |
|------|--------|--------|-------|
| `contract-exchange.module.ts` | +6 | 0 | Register `ShopExchangeReturnTemplate` |
| `contract-exchange.service.ts` | +220 | −30 | `computeOldOutstanding`, `nextExchangeContractNumber`, SHOP re-intake |
| `contract-exchange.service.spec.ts` | +290 | −1 | Test coverage for items 3, 4, 6 |
| `shop-exchange-return.template.ts` | +95 | 0 | New SHOP-side JE template (A.4) |
| `shop-exchange-return.template.spec.ts` | +103 | 0 | Template tests |

**Total**: 675 insertions / 36 deletions across 7 files (including 2 new files)

---

## Issues Found

### Critical — None

All money arithmetic uses `new Decimal()` / `Prisma.Decimal`. Specific checks:

- `computeOldOutstanding`: `entry.dr.plus(new Decimal(line.debit.toString()))` — correct
- `ShopExchangeReturnTemplate.execute`: `new Decimal(input.cost.toString())` — correct
- `cost > 0` guard prevents zero-cost re-intake — correct
- No `Number()`, `parseFloat`, or `parseInt` on any monetary field

No new controllers without guards. No hardcoded secrets. No unparameterized user-input SQL.

### Warning — 2 items

**W1: `$executeRawUnsafe` in `nextExchangeContractNumber` for advisory lock**

```ts
await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
```

`lockKey` is derived from `this.hashLockKey('exch:' + yyyymmdd)` — a pure hash of a server-computed date string with no user input. The value is always an integer. The pattern is identical to `DocNumberService` (established precedent). Not a SQL injection risk, but `$executeRawUnsafe` requires ongoing vigilance if this pattern is extended. Add a code comment citing the existing `DocNumberService` usage as the canonical reference.

**W2: `computeOldOutstanding` JSON `metadata` path query may include rescheduled entries from unrelated contracts**

The ledger aggregation filters by `referenceId = oldContractId OR metadata.contractId = oldContractId`. If a future cron job (e.g. VAT 60-day) posts a JE where `referenceId` is a Payment ID rather than a contract ID, those entries won't be captured. The current filter logic relies on both `referenceId` and `metadata.contractId` being consistently stamped by all templates. Confirm this is true for `Vat60dayMandatoryTemplate` and `RescheduleJP6Template` before merge.

This is a Warning (not Critical) because:
1. The `computeOldOutstanding` function is the _replacement_ for a simpler proration that was already wrong
2. The existing test suite validates the aggregation against fixture data
3. A miss would produce a slightly over/under closing JE — the error surfaces immediately on the Trial Balance

### Info — 1 item

**I1: `nextExchangeContractNumber` intentionally omits `deletedAt: null`**

The `contract.findFirst` for sequence generation searches all contracts (including soft-deleted) to avoid number reuse. This is correct. Add an inline comment to prevent automated lint false-positives:
```ts
// Intentionally includes soft-deleted — sequence must not reuse numbers.
```

---

## Accounting Correctness Assessment

### Item 3: `computeOldOutstanding` (ledger-based vs proration)

**Before**: Outstanding = straight-line proration of original schedule (`remainingMonths × installmentAmount`). This was wrong for any contract that had reschedules, partial payments, tolerance offsets, or VAT 60-day entries.

**After**: Sum of `journal_lines` where `accountCode IN ('11-2101', '11-2105', '11-2106', '21-2102')` for the old contract. Sign convention:
- 11-2101 (HP Receivable Gross): `Dr − Cr` → net receivable outstanding
- 11-2106 (Unearned Interest — contra): `Cr − Dr` → net unearned
- 11-2105 (VAT Receivable accrual): `Dr − Cr`
- 21-2102 (Deferred VAT Output): `Cr − Dr`

This matches the TFRS for NPAEs accrual model and is consistent with `getTrialBalance()` computation logic. **Correct**.

### Item 4: `EXCH-YYYYMMDD-NNNN` contract number format

**Before**: `EX-${Date.now()}` — timestamp-based, not grep-safe (collides with `EX-*` ExpenseDocument prefix). **After**: `EXCH-YYYYMMDD-NNNN` with BKK timezone and advisory lock for sequence safety. Matches the document number convention in `accounting.md`.

### Item 6: SHOP re-intake JE (A.4)

```
Dr  S11-2002 (used inventory)    [costPrice]
  Cr S50-1102 (used COGS reversal) [costPrice]
```

This is the accounting mirror of `ShopInventoryTransferTemplate`'s COGS leg. Posting at original `costPrice` (not market value) is correct — the round-trip COGS nets to zero for the same device. `ownedByCompanyId` flip to SHOP is done in the same `$transaction`. **Correct**.

---

## Security Assessment

No new endpoints. No new guard changes. The `ShopExchangeReturnTemplate` is a pure accounting template (no HTTP surface). The advisory lock uses a server-computed integer hash with no user input flowing into the raw SQL.

---

## Recommendation: ✅ APPROVE (with W2 verification recommended)

This branch closes the three remaining accounting correctness gaps from issue #1086. The ledger-based outstanding computation is materially more correct than the previous proration. The SHOP re-intake JE (A.4) completes the double-entry symmetry for the exchange round-trip.

**Recommended merge order**: `fix/sp2-blockers` → `fix/sp2-deferred-blockers` → `feat/sp2-exchange-sign-flow`.

Before merge, verify W2: confirm that `Vat60dayMandatoryTemplate` and `RescheduleJP6Template` stamp `metadata.contractId` consistently so `computeOldOutstanding` captures all relevant lines.
