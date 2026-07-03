# Merge Guard Report — fix/late-fee-split-reschedule-collect-first

**Date**: 2026-07-03  
**Branch**: `fix/late-fee-split-reschedule-collect-first`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 1 (`893c2a89 fix(payments): fee-first late-fee split + reschedule collect-first (ปรับดิว)`)  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

33 files changed, 2244 insertions(+), 273 deletions(-)

Key files modified:
- `apps/api/src/modules/journal/reconstruct-prior.ts` *(new — extracted from PaymentReceiptTemplate)*
- `apps/api/src/modules/journal/split-receipt.ts` — fee-first allocation order change
- `apps/api/src/modules/installments/reschedule.service.ts` — `outerTx` injection + removed write to `amountDue`
- `apps/api/src/modules/payments/services/reschedule-collect.service.ts` *(new)*
- `apps/api/src/modules/payments/payments.controller.ts` — 2 new endpoints
- `apps/api/src/modules/paysolutions/services/paysolutions-confirmation.service.ts` — RESCHEDULE QR webhook flow
- `apps/api/src/modules/line-oa/flex-messages/reschedule-qr.flex.ts` *(new)*

---

## Issues Found

### ⚠️ Warning (should fix before merge)

#### W1 — `reconstruct-prior.ts`: `journalEntry.findMany` missing `deletedAt: null`

**File**: `apps/api/src/modules/journal/reconstruct-prior.ts`  
**Line**: ~42

```typescript
const entries = await readClient.journalEntry.findMany({
  where: {
    AND: [
      { OR: [ { metadata: ... }, { metadata: ... } ] },
      { metadata: ... },
    ],
  },
  include: { lines: true },
});
```

`JournalEntry` has a `deletedAt DateTime?` field (confirmed in schema.prisma). This query does not include `where: { deletedAt: null }`. If any journal entry is ever soft-deleted (e.g. manual correction, reversal that sets `deletedAt`), those deleted entries will still be included in the prior-cleared reconstruction, potentially causing the receipt template to under-post on a subsequent partial payment.

**Impact**: Financial calculation error — `priorPrincipalCleared` could be inflated by deleted/reversed entries, causing `principalRemaining` to appear smaller than it is and silently rejecting a valid receipt.

**Fix**: Add `deletedAt: null` to the `where` clause:
```typescript
where: {
  deletedAt: null,
  AND: [ ... ],
}
```

---

#### W2 — `Number(link.amount)` on a `Decimal(12,2)` field in paysolutions service

**File**: `apps/api/src/modules/paysolutions/services/paysolutions-confirmation.service.ts`

```typescript
amount: Number(link.amount),
```

`PaymentLink.amount` is `Decimal @db.Decimal(12,2)`. Using bare `Number()` (not `.toDecimalPlaces(2).toNumber()`) is inconsistent with the project's money-handling convention. For amounts with 2 decimal places (which all Decimal(12,2) values are), precision loss is extremely unlikely in practice, but consistency is important. The `RescheduleCollectInput.amount` interface typing as `number` rather than `Prisma.Decimal` is the root cause.

**Impact**: Low risk (Decimal(12,2) amounts fit in JS float precisely). However, it's inconsistent with the rest of this file and with the codebase convention (`d(txResult.quote.collectAmount).toNumber()`).

**Fix**: Use `.toDecimalPlaces(2).toNumber()`:
```typescript
amount: new Decimal(link.amount.toString()).toDecimalPlaces(2).toNumber(),
```
Or change `RescheduleCollectInput.amount` to accept `Decimal | number` and handle both downstream.

---

### ℹ️ Info

#### I1 — `RescheduleCollectInput.amount` typed as `number` instead of `Decimal`

**File**: `apps/api/src/modules/payments/services/reschedule-collect.service.ts` line ~36

The input interface uses `amount: number` while all surrounding payment/journal code uses `Prisma.Decimal`. This forces callers to convert (W2 above) and is a minor tech-debt item.

---

## What Looks Good

- **New controller endpoints have proper guards**: `PaymentsController` has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level; both new methods (`@Get('reschedule-quote')`, `@Post(':id/reschedule-qr')`) have `@Roles(...)` decorators.
- **`installmentSchedule.findMany` includes `deletedAt: null`** in `reschedule.service.ts`.
- **`outerTx` injection for atomicity** is architecturally sound — collect JE + lateFee reset + date shift in one transaction.
- **Fee-first allocation** fix in `split-receipt.ts` is logically correct and well-tested (4 new test cases in `split-receipt.spec.ts`).
- **Removed the dead write to `InstallmentSchedule.amountDue`** (C1 fix) — well-documented rationale.
- **`reconstruct-prior.ts` extraction** (sharing the function between template and preview) is a correct deduplication.
- No hardcoded secrets, no `$queryRaw` with string interpolation, no raw `fetch()` on frontend.
