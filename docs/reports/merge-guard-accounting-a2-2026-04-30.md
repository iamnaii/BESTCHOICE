# Merge Guard Report — fix/accounting-phase-a2-deferred-income

**Date**: 2026-04-30
**Branch**: `fix/accounting-phase-a2-deferred-income`
**Author**: Akenarin Kongdach \<iamnaii@MacBook-Pro-khxng-Akenarin.local\>
**Commits**: 2 (`feat(accounting): Phase A.2` + `fix(accounting): post-review fixes for Phase A.2 (#726)`)

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/api/prisma/schema.prisma` | +7 | New fields: `unearnedInterest`, `unearnedCommission` on Contract |
| `prisma/migrations/*.sql` | +25 | Adds two Decimal(12,2) columns with `@default(0)` |
| `prisma/seeds/chart-of-accounts.ts` | +10 | Adds account 21-2201 (Unearned Commission) to SHOP chart |
| `modules/contracts/contract-workflow.service.ts` | +13 | Seeds unearned fields on activation |
| `modules/journal/journal-auto.service.ts` | +213 / -96 | Core deferred-recognition refactor |
| `modules/payments/payments.service.ts` | +3 / -3 | Passes `contract.id` to JE calls (3 sites) |
| `modules/paysolutions/paysolutions.service.ts` | +3 / -1 | Passes `contract.id` to JE call |
| `modules/data-audit/data-audit.service.ts` | +1 | Adds `contract.id` to audit payload |
| `journal-auto.service.spec.ts` | +266 / -3 | New lifecycle invariant tests |

---

## Issues by Severity

### Critical — None

### Warning

**W1 — Unearned balance can go negative with no DB guard**
- **File**: `apps/api/src/modules/journal/journal-auto.service.ts:373-390`, `schema.prisma`
- The new `unearnedInterest`/`unearnedCommission` fields are decremented per payment (`decrement: interest`). If a payment breakdown has rounding drift over many months (e.g. 12 installments with non-terminating Decimal division), cumulative error can push either field below zero. There is no `@Check("unearned_interest >= 0")` constraint on the DB column, and no guard in the service to clamp at zero before writing.
- **Impact**: Negative unearned balance will cause incorrect trial balance reporting and mislead the deferred recognition dashboard. Low probability per contract, high impact if it happens silently.
- **Fix**: Add a clamp: `unearnedInterest: { decrement: Prisma.Decimal.max(interest, currentUnearned) }` or add a DB `CHECK` constraint in migration.

**W2 — `storeCommission ?? 0` uses raw JS `0` as Decimal fallback**
- **File**: `apps/api/src/modules/contracts/contract-workflow.service.ts:65`
- `unearnedCommission: contract.storeCommission ?? 0` falls back to JS integer `0` (not `new Prisma.Decimal(0)`). Prisma coerces this correctly for write operations, but static analysis tools may flag it. Low practical risk.
- **Fix**: Use `contract.storeCommission ?? new Prisma.Decimal(0)`.

### Info

**I1 — `contract.id` is optional in JE call signature**
- **File**: `apps/api/src/modules/journal/journal-auto.service.ts:259`
- The param `contract: { id?: string; contractNumber: string; branchId?: string | null }` makes `id` optional. If a caller omits it, the unearned decrement is silently skipped (wrapped in `if (params.contract.id && ...)`). The three callers in `payments.service.ts` and `paysolutions.service.ts` all now pass `id`, but future callers could forget.
- **Suggestion**: Make `id` required or document the skip behavior clearly.

**I2 — `createCreditPaymentJournal` also updated but not highlighted in PR description**
- The credit payment JE (used when customer credit is applied to installment) was also updated to Phase A.2 model at lines 748-854. This is correct and consistent, but should be called out in the PR so reviewers know to test that path.

---

## Recommendation: **APPROVE**

No critical issues. The deferred-recognition accounting model is architecturally correct (TFRS NPAEs cash-basis for interest/commission/VAT). Migration uses `@default(0)` so it's safe on existing data. Test coverage is thorough: 266 new lines in spec including a full lifecycle invariant (12-payment drain to zero). Address W1 (unearned clamp) before Phase A.3/W-4 land on top.
