# Merge Guard Report — fix/sp2-deferred-blockers
**Date**: 2026-05-29  
**Branch**: `fix/sp2-deferred-blockers`  
**Author**: Akenarin Kongdach  
**Commits**: 3  
**Recommendation**: 🚫 BLOCK

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/modules/journal/cpa-templates/shop-exchange-return.template.ts` | +95 (new) |
| `apps/api/src/modules/journal/__tests__/shop-exchange-return.template.spec.ts` | +103 (new) |
| `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` | large diff |
| `apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts` | large diff |
| `apps/api/src/modules/contract-exchange/contract-exchange.module.ts` | +3 |
| `apps/api/prisma/schema.prisma` | +3 |
| `apps/api/prisma/migrations/*/migration.sql` | +7 |

**7 files changed — ~675 insertions, 36 deletions**

---

## ⚠️ BLOCK REASON — Already Incorporated Into a Later Branch

**`fix/sp2-deferred-blockers` has been squash-merged into `feat/sp2-exchange-sign-flow`** as commit `1320e97b`:

```
1320e97b fix(sp2): deferred blockers — JE aggregation + EXCH doc# + SHOP re-intake (#1086) (#1088)
```

The `feat/sp2-exchange-sign-flow` branch then FURTHER redesigns `ContractExchangeService.approve()` to a sign-then-activate flow — `approve()` no longer posts JEs, it only creates a DRAFT contract. The JE chain was extracted into `finalizeAfterActivation()`, called at contract activation.

**Merging `fix/sp2-deferred-blockers` independently WILL cause a conflict** with `feat/sp2-exchange-sign-flow` on `contract-exchange.service.ts` because the two branches have divergent `approve()` implementations.

**Correct merge order**: Merge only `feat/sp2-exchange-sign-flow` — it supersedes this branch entirely.

---

## What This Branch Does (for record)

Three issue fixes from PR #1085 review (#1086):

1. **Item 3** — `computeOldOutstanding` now aggregates from `journal_lines` instead of straight-line proration. Accounts queried: `11-2101`, `11-2105`, `11-2106`, `21-2102`. Captures reschedules, VAT 60-day, tolerance, and early-payoff adjustments that proration missed.

2. **Item 4** — Exchange contract number changed from `EX-${Date.now()}` to `EXCH-YYYYMMDD-NNNN` format with advisory lock for collision-safe sequence. Avoids grep confusion with `ExpenseDocument`'s `EX-` prefix.

3. **Item 6** — New `ShopExchangeReturnTemplate` (`Dr S11-2002 / Cr S50-1102`) books the SHOP re-intake of the returned device on exchange approval. `Product.ownedByCompanyId` flipped to SHOP. Audit log `EXCHANGE_DEVICE_RETURNED_TO_SHOP` added.

---

## Code Quality Notes (for reference only — not blocking)

- Prisma migration for `je4Id` on `ContractExchangeRequest` is present ✓  
- `deletedAt: null` in all new queries ✓  
- `Prisma.Decimal` used for all money ✓  
- Template idempotency key (`oldProductId:oldContractId`) enforced by partial unique index ✓  
- `data: { ..., ownedByCompanyId: shopCompanyId } as any` — TypeScript cast needed because Prisma's generated `ProductUpdateInput` doesn't expose `ownedByCompanyId` directly on the transaction client type. Acceptable workaround; the field exists in schema.

---

## Verdict

**DO NOT MERGE INDEPENDENTLY.** The content is correct and already incorporated into `feat/sp2-exchange-sign-flow`. Review and merge that branch instead.
