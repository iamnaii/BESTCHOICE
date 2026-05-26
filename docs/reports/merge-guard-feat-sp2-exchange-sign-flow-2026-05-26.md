# Merge Guard Report — feat/sp2-exchange-sign-flow

**Date**: 2026-05-26
**Branch**: `feat/sp2-exchange-sign-flow`
**Author**: Akenarin Kongdach (iamnaii@MacBook-Pro-khxng-Akenarin.local)
**Recommendation**: ⚠️ REVIEW

---

## Summary

Redesigns the contract-exchange approval flow from "post JEs immediately on approval" to a **sign-then-activate** pattern (SP2 option B).

- `approve()` now only creates a DRAFT new contract + reserves the new product + flips the request to APPROVED — no journal entries post yet.
- New `finalizeAfterActivation()` fires inside `ContractWorkflowService.activate()`'s `$transaction` when the contract being activated has `exchangedFromContractId` non-null. This is where JE chain A.1–A.4 posts and the old contract/product status flips happen.
- Module wiring: `ContractsModule` now imports `ContractExchangeModule` (no circular dependency per code comment — ContractExchangeModule only depends on Prisma + Audit + Journal).
- Frontend: approval success toast + redirect updated to reflect "DRAFT created, customer must sign then activate."
- Dev helper SQL: `fix-sp1-used-exchange-uuid.sql` converts seed string IDs to UUIDs for local testing.

**Files changed (10)**:
```
apps/api/src/cli/fix-sp1-used-exchange-uuid.sql         +48
apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts  +289/-193
apps/api/src/modules/contract-exchange/contract-exchange.service.ts       +162/-98
apps/api/src/modules/contracts/contract-hash.spec.ts                       +2
apps/api/src/modules/contracts/contract-signing-workflow.spec.ts           +2
apps/api/src/modules/contracts/contract-workflow.service.spec.ts          +82
apps/api/src/modules/contracts/contract-workflow.service.ts               +55/-9
apps/api/src/modules/contracts/contracts.module.ts                        +15
apps/web/src/pages/insurance/ExchangeRequestForm.tsx                       +7/-3
apps/web/src/pages/insurance/ExchangeRequestsPage.tsx                     +19/-3
```

---

## Issues

### Critical
_None found._

---

### Warning

**W1 — `as any` casts bypass TypeScript type safety (2 locations)**

`apps/api/src/modules/contracts/contract-workflow.service.ts`
```ts
const isExchangeContract = !!(contract as any).exchangedFromContractId;
// ...
exchangedFromContractId: (contract as any).exchangedFromContractId,
```
The `contract` variable comes from `prisma.contract.findUniqueOrThrow()`. The field `exchangedFromContractId` exists in the Prisma schema but may not be selected by the `activate()` query's `select` clause, which is why the cast is needed. The safer fix is to add `exchangedFromContractId: true` to the query's select clause so TypeScript knows the field is present — then the cast can be removed. If the field is omitted from the select, `contract.exchangedFromContractId` will be `undefined` at runtime even though the DB row has a value, and `isExchangeContract` will be `false` for exchange contracts, silently routing them down the wrong (standard) activation path.

**Action**: Verify the `activate()` pre-fetch query includes `exchangedFromContractId` in its select/include, and remove the `as any` casts.

---

**W2 — `(tx as any).contractExchangeRequest` in `finalizeAfterActivation`**

`apps/api/src/modules/contract-exchange/contract-exchange.service.ts`
```ts
const request = await (tx as any).contractExchangeRequest.findFirst({ ... });
```
Prisma's `TransactionClient` type does include `contractExchangeRequest` — the cast suggests a local type resolution issue (possibly the method's type signature `tx: Prisma.TransactionClient` needs the correct Prisma import). This silently disables type checking for the entire `findFirst` call, including the shape of `where` and `select`. In practice the runtime behaviour is correct, but the cast should be removed.

**Action**: Ensure `Prisma` is imported from `@prisma/client` in the service, and remove the `(tx as any)` cast.

---

**W3 — Dev SQL script in `src/cli/` could be accidentally run on production**

`apps/api/src/cli/fix-sp1-used-exchange-uuid.sql` directly `UPDATE`s `contracts`, `products`, `customers`, and `sales` rows by known string IDs (`sp1-ctr-used`, etc.). The file contains a `BEGIN; ... COMMIT;` block with no environment guard. If run against production it would UPDATE records matching those IDs (no-ops in production since those seed IDs won't exist, but the intent is ambiguous from the filename).

**Action**: Add a comment header making the dev-only intent explicit, or move to `prisma/seeds/` rather than `src/cli/` where production runbooks typically reference scripts.

---

### Info

**I1 — `approve()` return shape changed: removed `je4Id` from result**

Old: `return { id, newContractId, je4Id }` — tests + callers expected `je4Id`.
New: `return { id, newContractId }` — JE ids are not available at approval time.

This is intentional by design but callers of `approve()` that previously consumed `je4Id` (if any exist beyond the controller) should be verified. The spec updates confirm the tests are aligned.

**I2 — `pdpaConsentId` carried from old contract to new contract**

Intentional per code comment ("customer already consented; swap doesn't introduce new personal data"). This is a business decision the owner should confirm is correct under PDPA — the new contract terms may differ from the old ones.

---

## Recommendation: ⚠️ REVIEW

No Critical issues. Two Warning-level `as any` casts could silently break the exchange path if the query select clause is missing `exchangedFromContractId`. Confirm the select clause includes the field and remove the casts before merge.
