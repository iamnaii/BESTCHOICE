# Merge Guard Report — feat/sp2-exchange-sign-flow

**Date**: 2026-06-01  
**Branch**: `feat/sp2-exchange-sign-flow`  
**Author**: Akenarin Kongdach  
**Unique commits ahead of main**: 5  
**Key files changed**: `contract-exchange.service.ts`, `contract-workflow.service.ts`, `ExchangeRequestsPage.tsx`, `ExchangeRequestForm.tsx`  
**Recommendation**: 🟡 REVIEW (one Warning, one Info — no blockers)

---

## Summary of Changes

Implements the "sign-then-activate" flow for same-price exchange contracts (SP2 v2):

1. `approve()` now creates a DRAFT contract + marks request APPROVED + reserves the new product (no JEs posted yet)
2. `ContractWorkflowService.activate()` branches: exchange contracts call `finalizeAfterActivation()` which posts the A.1–A.4 JE chain + flips old contract/product
3. UI: `ExchangeRequestsPage` navigates to the new contract's sign page after approval, setting correct user expectations
4. Bug fix: `creditBalance → advanceBalance` and removal of phantom `contractDate` field (caught at runtime via `PrismaClientValidationError`)

---

## Issues

### ⚠️ Warning — `(contract as any)` casts hide schema field from type system

**File**: `apps/api/src/modules/contracts/contract-workflow.service.ts` (activate method)

```ts
const isExchangeContract = !!(contract as any).exchangedFromContractId;
// ...
exchangedFromContractId: (contract as any).exchangedFromContractId,
```

`exchangedFromContractId` IS in `schema.prisma` and IS returned by `findOne()` (which uses `include` — not a restricted `select`). The Prisma-generated TypeScript type should expose it. The `as any` casts suggest the generated client type was not refreshed after the field was added.

**Risk**: Low at runtime (field is present), but the casts suppress type-checking on the value and could mask future regressions (e.g., the field being accidentally removed from a future `select` clause).

**Suggested fix**: Run `npx prisma generate` to confirm the type includes the field, then replace with:
```ts
const isExchangeContract = !!(contract.exchangedFromContractId);
```
If the type still doesn't expose it, add `exchangedFromContractId: true` explicitly to the `findOne` select/include.

---

### ℹ️ Info — `(this.prisma as any).contractExchangeRequest` pattern throughout service

**File**: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` (multiple calls)

All `contractExchangeRequest` queries use `(this.prisma as any).contractExchangeRequest`. This means the Prisma client does not yet expose this model in the generated TypeScript type — the migration was applied but `npx prisma generate` was not run before committing.

This is not a runtime issue (the model and table exist) but it means the entire `ContractExchangeService` operates without type-checking on its primary model's queries.

**Action**: Run `npx prisma generate` and replace all `(this.prisma as any)` with `this.prisma` for `contractExchangeRequest` queries before merge.

---

## Positive Notes

- **Decimal arithmetic**: All money fields use `new Decimal(...)` and `.toString()` conversions consistently. No `Number()` on financial fields.
- **`deletedAt: null`**: New `findFirst` on `contractExchangeRequest` includes `deletedAt: null` guard.
- **Test coverage**: 5 new tests in `contract-workflow.service.spec.ts` cover the exchange branch of `activate()` including rollback behavior.
- **Atomicity**: The entire finalization (4 JEs + old contract flip + old product flip + audit log) runs inside the outer `$transaction` passed from `activate()`. Partial failure rolls back activation completely.
- **Race safety**: `approve()` uses `updateMany` with `status: 'PENDING'` as the CAS predicate — concurrent approvals return `count === 0` and throw `ConflictException`.
- **PDPA clone**: Correctly clones the PDPA consent record (new UUID) instead of reusing the `@unique` constraint row from the old contract.

---

## Recommendation: REVIEW

Safe to merge after:
1. Run `npx prisma generate` and remove `(contract as any)` and `(this.prisma as any).contractExchangeRequest` casts
2. Verify `./tools/check-types.sh all` passes with 0 errors
3. Run `./tools/run-tests.sh` — the 5 new tests plus all existing contract-exchange tests should pass
