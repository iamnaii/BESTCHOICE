# Merge Guard Report — feat/sp2-exchange-sign-flow

**Date**: 2026-05-24  
**Branch**: `feat/sp2-exchange-sign-flow`  
**Author**: Akenarin Kongdach  
**Commits**: 3 commits (ab07b17d, 2625ecff, ff1b5df1)  
**Files Changed**: 10 files, +685 / −261 lines

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` | Major refactor: `approve()` now only creates DRAFT contract + reserves product; new `finalizeAfterActivation()` carries the full A.1–A.4 JE chain + old-side flips |
| `apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts` | Full test suite rewrite for the new two-phase flow; 7 new cases for `finalizeAfterActivation()` |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | `activate()` branches on `exchangedFromContractId` — exchange contracts call `finalizeAfterActivation()` and skip the standard 1A JE + Sale row |
| `apps/api/src/modules/contracts/contracts.module.ts` | Imports `ContractExchangeModule` for DI resolution |
| `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` | New `describe` block: 5 tests for the `isExchangeContract` branch in `activate()` |
| `apps/api/src/modules/contracts/contract-hash.spec.ts` | Added `ContractExchangeService` mock provider |
| `apps/api/src/modules/contracts/contract-signing-workflow.spec.ts` | Same mock provider addition |
| `apps/web/src/pages/insurance/ExchangeRequestsPage.tsx` | `approveMutation.onSuccess` reads `newContractId` from response and navigates to new contract sign page |
| `apps/web/src/pages/insurance/ExchangeRequestForm.tsx` | Updated success toast text |

---

## Critical Issues

**None found.**

- No new controller or endpoint — all changes are in service layer ✓  
- `Prisma.Decimal` used for all financial arithmetic in `finalizeAfterActivation()` ✓  
- `finalizeAfterActivation()` queries `contractExchangeRequest.findFirst` with `deletedAt: null` ✓  
- `advanceBalance` field is confirmed in `schema.prisma` line 947 ✓  
- `exchangedFromContractId` is a scalar field on `Contract` (schema line 1109); it is present in the `activate()` result since `findUnique` uses `include:` (not `select:`), so all scalar fields are returned — the `(contract as any)` cast is a TypeScript typing workaround, not a runtime gap ✓  
- No hardcoded secrets ✓  
- No raw `$queryRaw` ✓  

---

## Warning Issues

### W1 — `finalizeAfterActivation()` audit logs are missing `userId`
`apps/api/src/modules/contract-exchange/contract-exchange.service.ts`, lines ~400–425.

The two `audit.log()` calls inside `finalizeAfterActivation()` — `EXCHANGE_FINALIZED` and `EXCHANGE_DEVICE_RETURNED_TO_SHOP` — do not include a `userId` field. Every other `audit.log()` call in this service (e.g. `EXCHANGE_REQUEST_APPROVED` at line ~263) passes `userId`. These are legally significant events: ownership transfer + JE posting. The operator who clicked "เปิดใช้สัญญา" is not captured.

The root cause is that `finalizeAfterActivation()` accepts `(newContract, tx)` but not a `userId` parameter. The call site in `contract-workflow.service.ts` knows the `userId` (from the activation request) but doesn't thread it through.

**Fix**: Add `userId: string` to `ExchangeContractForFinalize` interface (or as a 3rd parameter) and pass it from `ContractWorkflowService.activate()`.

### W2 — `(contract as any).exchangedFromContractId` — TypeScript `any` cast
`apps/api/src/modules/contracts/contract-workflow.service.ts`, `activate()` method.

The cast is needed because the TypeScript inferred return type of `findUnique` with `include:` does not surface `exchangedFromContractId` as a known property (Prisma generates a union type that may omit scalar fields when relations are included, depending on the Prisma version). The field exists at runtime but the `any` cast bypasses compile-time safety and could silently break if the field is renamed.

**Fix**: Add `exchangedFromContractId: true` to a `select:` within the `include:` block, or use a dedicated lightweight `findUnique` at the start of `activate()` to fetch just this discriminator field. This eliminates the `any` cast and makes the type safe.

### W3 — Frontend: no fallback if `newContractId` is absent from approve response
`apps/web/src/pages/insurance/ExchangeRequestsPage.tsx`, `approveMutation.onSuccess`.

If the API returns 200 but `response.data?.newContractId` is falsy (stale client, unexpected shape), `navigate()` is silently skipped. The success toast still fires so the operator sees "approved" but has no link to the new contract and no indication that navigation failed.

**Fix**: Add a fallback:
```ts
if (newContractId) {
  navigate(`/contracts/${newContractId}/sign`);
} else {
  toast.warning('อนุมัติสำเร็จ — ไม่พบรหัสสัญญาใหม่ กรุณาตรวจสอบในรายการแลกเปลี่ยน');
}
```

---

## Info Issues

### I1 — `finalizeAfterActivation()` is a public method with no runtime transaction guard
The method is designed to be called only from inside a `$transaction` but there is no runtime assertion confirming that `tx` is a real transaction client (not the global Prisma instance). A JSDoc comment makes the intent explicit, which is helpful. The risk is low since the only call site is already inside `$transaction`, but worth noting for maintainability.

### I2 — Test spec comment accuracy
In `contract-exchange.service.spec.ts`, one test comment states "A.1-A.3 already ran" when only A.1 runs before the null-`costPrice` guard throws (A.2 and A.3 come after the `findUniqueOrThrow` + null check). Low risk since the `$transaction` wrapping rolls all of it back, but the comment could mislead future readers.

### I3 — `contract-workflow.service.ts` is large (>500 lines)
The file has grown significantly with the new exchange branch. Not a blocker, but worth tracking for eventual extraction of the exchange-specific activation logic into `ContractExchangeService.finalizeAfterActivation()` (which this PR already does — the migration is in progress).

---

## Recommendation

**REVIEW** — The architectural refactor (deferred JE posting to sign-then-activate) is correct and well-tested with 12+ new test cases. No critical issues. The missing `userId` in the `EXCHANGE_FINALIZED` audit log (W1) is the most important fix before merge — it creates a forensic gap for a legally significant ownership-transfer event. W2 (`any` cast) is a maintainability risk that should be addressed in a follow-up or same PR. W3 is a UX polish fix.
