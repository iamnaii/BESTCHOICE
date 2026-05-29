# Merge Guard Report — feat/sp2-exchange-sign-flow
**Date**: 2026-05-29  
**Branch**: `feat/sp2-exchange-sign-flow`  
**Author**: Akenarin Kongdach  
**Commits**: 8 total (squash of 3 deferred-blocker fixes + 5 sign-then-activate commits)  
**Recommendation**: 🔶 REVIEW

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` | +287/-261 (major refactor) |
| `apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts` | +392/-168 |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +92/-37 |
| `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` | +82 |
| `apps/api/src/modules/contracts/contracts.module.ts` | +15 |
| `apps/api/src/modules/contracts/contract-hash.spec.ts` | +2 |
| `apps/api/src/modules/contracts/contract-signing-workflow.spec.ts` | +2 |
| `apps/web/src/pages/insurance/ExchangeRequestsPage.tsx` | +19/-1 |
| `apps/web/src/pages/insurance/ExchangeRequestForm.tsx` | +7/-1 |
| `apps/api/src/cli/fix-sp1-used-exchange-uuid.sql` | +48 (new) |

**10 files changed — 685 insertions, 261 deletions**

---

## What This Branch Does

Redesigns the exchange approval flow to "sign-then-activate":

**Before** (`fix/sp2-deferred-blockers` approach):  
`approve()` → create new contract + post JE chain (A.1→A.2→A.3→A.4) + flip old contract/product  

**After** (this branch):  
`approve()` → create DRAFT new contract + reserve new product + set `workflowStatus=APPROVED` (no JEs, no old-side flips)  
`ContractWorkflowService.activate()` → calls `finalizeAfterActivation()` when `exchangedFromContractId` is set → JE chain (A.1→A.2→A.3→A.4) + old contract EXCHANGED + old product REFURBISHED+SHOP

This ensures customer signature collection happens between approval and accounting entry, complying with the legal requirement that contracts be signed before FINANCE takes ownership.

---

## Issues Found

### Critical
_None_

### Warning

**W-1 — `as any` cast on `contract-workflow.service.ts` line (`exchangedFromContractId` access)**  
```ts
const isExchangeContract = !!(contract as any).exchangedFromContractId;
```  
And in the service:
```ts
data: { status: 'REFURBISHED', ownedByCompanyId: shopCompanyId } as any,
```  
Both casts work around Prisma transaction client type limitations — the fields exist in the schema (`workflowStatus`, `exchangedFromContractId` confirmed in `main` schema at lines 956, 1109). The runtime behavior is correct, but TypeScript type safety is bypassed. Consider adding a typed intermediate variable or a typed Prisma select to avoid silent type drift in future refactors.

**W-2 — `fix-sp1-used-exchange-uuid.sql` is not auto-applied**  
The file `apps/api/src/cli/fix-sp1-used-exchange-uuid.sql` is a manual one-time fix converting SP1 seed data string IDs (`sp1-ctr-used`) to proper UUIDs. It contains a URL comment pointing to localhost and explicit psql instructions. This must be run manually on any environment that has SP1 seed data (dev, staging) before the exchange flow works end-to-end. Ensure this is documented in the deployment checklist — it is NOT a Prisma migration and will not auto-apply.

### Info

**I-1 — Circular dependency comment is correct but worth verifying CI**  
`ContractsModule` now imports `ContractExchangeModule`. The comment states "No circular dep because ContractExchangeModule only depends on Prisma + Audit + Journal." Confirmed: `ContractExchangeModule` does NOT import `ContractsModule`. However, if `JournalModule` transitively imports `ContractsModule` this would create a cycle. Recommend `nest-cli` circular dep detection runs clean in CI before merge.

**I-2 — PDPA consent carry-forward covered**  
Test confirms `pdpaConsentId` from old contract is copied to new DRAFT contract. Correct behavior for PDPA compliance — customer consent transfers across exchange.

**I-3 — `finalizeAfterActivation` throws ISE when costPrice is null before A.4**  
`InternalServerErrorException` is thrown after A.1→A.2→A.3 have already executed. At the unit level this is described as "the caller's `$tx` job" to roll back. Confirmed: the call is inside `prisma.$transaction()` in `contract-workflow.service.ts`, so the rollback does happen. No data integrity risk.

**I-4 — Outstanding aggregation (Issue #1086 item 3) correctly uses `OR` filter**  
`computeOldOutstanding` queries journal lines via `{ OR: [{ referenceId: contractId }, { metadata: { path: ['contractId'], equals: contractId } }] }` — captures both old-style and new-style JE tagging conventions. Tests confirm zeroes when no lines exist.

---

## Security Check

| Check | Result |
|-------|--------|
| No new unguarded controllers | ✅ No new controllers in this diff |
| `deletedAt: null` in new queries | ✅ Present (`computeOldOutstanding`, `findFirst` for exchange request) |
| Money fields use `Prisma.Decimal` | ✅ `new Decimal(...)` throughout |
| No raw `fetch()` in React components | ✅ Uses `api.post()` + `useNavigate` |
| `queryClient.invalidateQueries` after mutations | ✅ Called in `onSuccess` |
| No hardcoded secrets | ✅ Clean |

---

## Pre-Merge Actions Required

1. **Do not merge `fix/sp2-deferred-blockers`** — its content is already incorporated here as commit `1320e97b`.  
2. Confirm CI passes with `./tools/check-types.sh all`.  
3. Run `fix-sp1-used-exchange-uuid.sql` on any staging env with SP1 seed data.  
4. Verify NestJS circular dep detection (jest `--detectOpenHandles` or nest build) stays clean after adding `ContractExchangeModule` to `ContractsModule`.  
5. Consider replacing `as any` casts with typed Prisma select objects (non-blocking, can be a follow-up).

---

## Verdict

Architecturally sound. The sign-then-activate design correctly defers financial accounting to the activation event, aligning with Thai civil code requirements for executed contracts. The `as any` casts are the only non-trivial quality concern and can be addressed as a follow-up. No security regressions, no missing soft-delete guards, no float money.
