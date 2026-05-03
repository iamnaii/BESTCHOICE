# Merge Guard Report — fix/accounting-phase-a1c-jebugs-v2

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a1c-jebugs-v2`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Base**: `origin/main`  
**Recommendation**: ⚠️ REVIEW — 2 warnings to address before merge

---

## Summary

Phase A.1c bug-fix branch. Replaces per-installment JEs on early payoff with a single aggregated
`createEarlyPayoffJournal`. Also fixes a `count()`-based race condition in `generateEntryNumber`
and optimises trial-balance to use DB-level `groupBy` instead of loading all lines into memory.

**Files changed**: 3 (376 insertions, 54 deletions)

| File | Change |
|------|--------|
| `apps/api/src/modules/contracts/contract-payment.service.ts` | Use snapshot + single aggregated JE for early payoff |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Add `createEarlyPayoffJournal`, fix `generateEntryNumber`, fix trial-balance groupBy |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | 142 lines of new tests covering payoff scenarios |

---

## Issues

### ⚠️ Warning

**W-1: Zero-value journal lines always written to ledger (createEarlyPayoffJournal)**

File: `apps/api/src/modules/journal/journal-auto.service.ts` (~L530–L568)

The FINANCE-side `lines` array always includes `FA.DUE_TO_SHOP` and `FA.LATE_FEE_INCOME` entries
even when their amounts are zero (no commission / no late fees). These produce 0-debit / 0-credit
rows in `journal_lines` which pollute the ledger with noise.

```typescript
// Always emitted even when commissionActual = 0 or sumLateFee = 0
{ accountCode: FA.LATE_FEE_INCOME,  debit: 0, credit: sumLateFee.toNumber() },
{ accountCode: FA.DUE_TO_SHOP,      debit: 0, credit: commissionActual.toNumber() },
```

**Fix**: Guard each line with a value check (same pattern as the A.2 branch which already does
`financeLines.push(...)` conditionally). Example:

```typescript
if (sumLateFee.gt(0)) {
  lines.push({ accountCode: FA.LATE_FEE_INCOME, ... credit: sumLateFee.toNumber() });
}
```

---

**W-2: generateEntryNumber raw SQL missing `deleted_at IS NULL`**

File: `apps/api/src/modules/journal/journal-auto.service.ts` (~L71–L95)

The new `$queryRaw FOR UPDATE` query fetches the last entry number without filtering deleted rows:

```sql
SELECT entry_number AS "entryNumber" FROM journal_entries
WHERE entry_number LIKE ${prefix + '%'}
ORDER BY entry_number DESC
LIMIT 1
FOR UPDATE
```

If a journal entry were ever soft-deleted, the last sequence would be correctly incremented (no
actual gap risk), but the filtered-out entry could occupy a gap in the sequence. Low risk since
journal entries are immutable financial records and should never be soft-deleted in practice.
Note: parameterization is correct (Prisma tagged template — no SQL injection risk).

**Fix**: Add `AND deleted_at IS NULL` for defensiveness:
```sql
WHERE entry_number LIKE ${prefix + '%'}
  AND deleted_at IS NULL
```

---

### ℹ️ Info

**I-1: journal-auto.service.ts approaching large-file threshold**

The service now handles entry-number generation, trial balance, contract activation, payment JE,
credit allocation JE, early payoff JE, repossession JE, bad-debt JE, and inter-company JE.
Combined with Phase A.2 additions in the next branch, this file will exceed 1 300 lines.
Consider extracting `generateEntryNumber` + `createAndPost` into `journal-entry.service.ts`
in a future refactor sprint. No action required for this PR.

---

## Security Checks

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on new controllers | N/A (no new controllers) |
| `@Roles()` on new endpoint methods | N/A |
| `Number()` on money/Decimal fields | ✅ None found (`new Prisma.Decimal()` used throughout) |
| `deletedAt: null` in new Prisma queries | ✅ Present on all new queries in service |
| Hardcoded secrets / API keys | ✅ None |
| `$queryRaw` parameterized | ✅ Tagged template literals, no raw string concatenation |

---

## Context

This branch is **step 1 of a 3-step chain** (A.1c → A.2 → A.3). Both W-1 and W-2 are low-risk
and may already be addressed in the A.2 branch (W-1 is confirmed fixed there). If merging in
order, the A.2 branch can address W-1. W-2 remains relevant to both.
