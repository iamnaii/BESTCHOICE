# Pre-Merge Guard Report

**Branch**: `feat/accounting-phase-a1b-intercompany-je`
**Author**: Akenarin Kongdach
**Review date**: 2026-05-06
**Recommendation**: 🔴 BLOCK

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | +1 |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +30/-18 |
| `apps/api/src/modules/accounting/bad-debt.service.spec.ts` | +62/-5 |
| `apps/api/src/modules/accounting/bad-debt.service.ts` | +48 |
| `apps/api/src/modules/contracts/contract-payment.service.ts` | +25/-0 |
| `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` | +13/-0 |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +12/-0 |
| `apps/api/src/modules/data-audit/data-audit.service.ts` | +12/-0 |
| `apps/api/src/modules/journal/inter-company-link.util.spec.ts` | +35 (new) |
| `apps/api/src/modules/journal/inter-company-link.util.ts` | +25 (new) |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +796/-0 |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +665/-181 |
| `apps/api/src/modules/payments/payments.service.ts` | +66/-0 |
| `apps/api/src/modules/repossessions/repossessions.service.ts` | +38/-0 |
| `apps/web/e2e/accounting-inter-company-flow.spec.ts` | +125 (new) |
| `docs/reports/2026-04-29-*.md` | +1959 |

**Total**: 23 files changed, 3835 insertions(+), 181 deletions(-)

---

## Issues

### 🔴 Critical

#### [C-1] `.toNumber()` on Decimal financial fields stored to DB — `journal-auto.service.ts`

**Location**: `apps/api/src/modules/journal/journal-auto.service.ts` (multiple new payment/activation JE methods)

The new inter-company journal methods build `JournalLine` objects using `.toNumber()` on `Prisma.Decimal` values for `debit` and `credit` fields:

```typescript
{ accountCode: FA.CASH, debit: amountPaid.toNumber(), credit: 0 },
{ accountCode: FA.HP_RECEIVABLE, debit: 0, credit: hpReceivableCredit.toNumber() },
{ accountCode: FA.INTEREST_INCOME, debit: 0, credit: interest.toNumber() },
{ accountCode: FA.VAT_OUTPUT, debit: 0, credit: vat.toNumber() },
{ accountCode: FA.DUE_TO_SHOP, debit: 0, credit: commission.toNumber() },
// ... and ~15 more instances
```

`JournalLine.debit` and `JournalLine.credit` are `Decimal @db.Decimal(12, 2)` in Prisma schema. Converting to JavaScript `number` before insert risks IEEE 754 floating-point precision loss (e.g., `1416.66` from 17000/12 ROUND_DOWN may become `1416.6600000000001` in float64). This pattern was explicitly fixed in v4 hardening (53 → 0 `Number(_sum` instances).

**Fix**: Pass `Prisma.Decimal` values directly — do not call `.toNumber()` on financial values going to DB.

```typescript
// Before
{ accountCode: FA.CASH, debit: amountPaid.toNumber(), credit: 0 }
// After
{ accountCode: FA.CASH, debit: amountPaid, credit: new Prisma.Decimal(0) }
```

Affects the following new methods in `journal-auto.service.ts`:
- `createPaymentJournal` (updated FINANCE + new SHOP legs)
- `createCreditAllocationJournal`
- `createContractActivationJournal` (SHOP + FINANCE legs)
- `createRepossessionResaleJournal`
- `createCustomerOverpayJournal`
- `createBadDebtProvisionJournal`

---

### ⚠️ Warning

#### [W-1] `journal-auto.service.ts` exceeds 500 lines

**Location**: `apps/api/src/modules/journal/journal-auto.service.ts`

Was 221 lines on `main`; after this PR the file is ~870+ lines. Per project style guide, files >500 lines should be considered for splitting. The inter-company helpers (`createShopCommissionJournal`, activation SHOP legs) could be extracted to a dedicated `journal-intercompany.service.ts`.

---

### ℹ️ Info

#### [I-1] Docs files committed to `docs/reports/`

Two large design doc files (`2026-04-29-accounting-phase-a1b-intercompany-je.md` at 1525 lines and the design doc at 434 lines) are part of this PR. These are fine to merge as documentation but inflate the diff significantly.

#### [I-2] `Number()` in spec files only — not flagged as Critical

Test assertions like `expect(Number(cashLine?.debit)).toBeCloseTo(3000, 2)` are in `*.spec.ts` files only and are for assertion comparison purposes. These are acceptable in test code. The Critical issue above is limited to production service code.

---

## Summary

This branch implements Phase A.1b inter-company JEs (SHOP↔FINANCE paired entries for contract activation, payments, commissions, repossession resale, and bad-debt provisions). The architectural design is sound and test coverage is comprehensive (+796 spec lines, +125 E2E lines).

However, the entire new inter-company JE implementation uses `.toNumber()` on `Prisma.Decimal` before inserting to `JournalLine.debit`/`credit` — a pattern that v4 hardening specifically eliminated. Because journal entries are legal accounting records, floating-point imprecision in a posted JE cannot be corrected without manual reversal.

**Action required before merge**: Replace all `.toNumber()` calls in the new JE methods with `Prisma.Decimal` values.
