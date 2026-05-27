# Merge Guard Report — feat/sp2-exchange-sign-flow

**Date**: 2026-05-27  
**Branch**: `feat/sp2-exchange-sign-flow`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Against**: `origin/main`  
**Note**: Based on commit count, this branch appears **already merged** to `main` (0 unique commits vs origin/main), but `fix/exchange-pdpa-clone` branches from it. This report documents the design for historical reference and to support review of dependent branches.

---

## File Changes Summary (vs main at time of report)

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `contract-exchange.service.ts` | +287 | -176 | **Architectural redesign** — `approve()` split into two phases |
| `contract-exchange.service.spec.ts` | +392 | -261 | Tests updated and extended for new two-phase design |
| `contract-workflow.service.ts` | +92 | -37 | Exchange branch added to `activate()` |
| `contract-workflow.service.spec.ts` | +82 | 0 | New tests for exchange activation path |
| `contracts.module.ts` | +15 | -1 | `ContractExchangeModule` imported (no circular dep) |
| `ExchangeRequestsPage.tsx` | +19 | -10 | Navigate to contract after approve + updated UX copy |
| `ExchangeRequestForm.tsx` | +7 | -1 | Info text about sign-then-activate flow |
| `contract-hash.spec.ts` | +2 | 0 | Minor test fix |
| `contract-signing-workflow.spec.ts` | +2 | 0 | Minor test fix |
| `fix-sp1-used-exchange-uuid.sql` | +48 | 0 | **New file** — one-time seed fix script |

**10 files changed, 685 insertions(+), 261 deletions(-)**

---

## Architectural Change: Sign-Then-Activate (Option B)

### Before

`ContractExchangeService.approve()` was an "approve + finalize" god method:
1. Lock exchange request
2. Create new contract as **ACTIVE** 
3. Post JE chain (A.1 → A.2 → A.3 → A.4) atomically
4. Flip old contract → EXCHANGED
5. Flip old product → REFURBISHED + SHOP ownership
6. Audit

**Problem**: JEs posted for a contract the customer has not yet signed. If the debtor disputes and never signs, the ledger already reflects an obligation that doesn't legally exist.

### After (SP2 Option B)

**Phase 1 — `approve()`** (OWNER/BM/FM):
1. Lock exchange request
2. Create new contract as **DRAFT + workflowStatus=APPROVED** (sign-then-activate gate)
3. Reserve new product (`status: RESERVED`) so it can't be sold to someone else
4. Link request to new contract
5. Audit with `phase: 'awaiting-sign-then-activate'` — explicit that no money has moved

**Phase 2 — `finalizeAfterActivation(newContract, tx)`** (called from `ContractWorkflowService.activate()` when `exchangedFromContractId` is set):
1. Resolve exchange request
2. Post JE chain A.1 → A.2 → A.3 → A.4 atomically
3. Flip old contract → EXCHANGED, old product → REFURBISHED + SHOP
4. Store JE IDs on exchange request
5. Audit `EXCHANGE_FINALIZED` + `EXCHANGE_DEVICE_RETURNED_TO_SHOP`

---

## Issues Found

### 🟡 Warning

#### W1 — `as any` casts on Prisma model fields

**File**: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts`  
**File**: `apps/api/src/modules/contracts/contract-workflow.service.ts`

```ts
data: { status: 'RESERVED' } as any,          // contract-exchange.service.ts
data: { status: 'EXCHANGED', exchangedAt: new Date() } as any,  // same
const isExchangeContract = !!(contract as any).exchangedFromContractId;  // contract-workflow.service.ts
await (tx as any).contractExchangeRequest.update(...)  // contract-exchange.service.ts
```

**Risk**: Bypasses Prisma type-checking. If schema evolves (e.g. `exchangedFromContractId` is renamed), these casts hide the breakage at compile time. TypeScript errors are the first line of defense.

**Recommendation**: Extend the Prisma select shapes to include `exchangedFromContractId` explicitly, and use type-safe `Prisma.ContractUpdateInput` instead of `as any`.

#### W2 — `contract.pdpaConsentId` direct copy (superseded by `fix/exchange-pdpa-clone`)

**Note**: This issue was already identified and fixed in `fix/exchange-pdpa-clone`. At the time this branch was written, the code set:
```ts
pdpaConsentId: old.pdpaConsentId ?? null,
```
...which would fail with a Prisma P2002 unique constraint violation if the old contract had a non-null `pdpaConsentId`. The follow-on fix branch (`fix/exchange-pdpa-clone`) correctly clones the consent. **Ensure `fix/exchange-pdpa-clone` is merged after this branch.**

#### W3 — SQL seed script committed to `apps/api/src/cli/`

**File**: `apps/api/src/cli/fix-sp1-used-exchange-uuid.sql`

The script contains hardcoded UUIDs and `UPDATE ... WHERE id = 'sp1-xxx'` patterns for dev seed data fix-up. It is:
- ✅ Safe to run (wrapped in `BEGIN/COMMIT`, idempotent)
- ✅ Dev-only (SP1 seed IDs only exist in dev database)
- ⚠️ Committed to `apps/api/src/cli/` alongside production CLI scripts — could confuse future devs about whether it needs to run in production

**Recommendation**: Move to `apps/api/prisma/migrations-manual/` (existing location for one-time SQL fixes, per CLAUDE.md) or add a prominent header `-- DEV SEED FIX ONLY — DO NOT RUN IN PRODUCTION`.

---

### 🔵 Info

#### I1 — `finalizeAfterActivation` is public but not exposed via API

The method is `async finalizeAfterActivation(...)` on `ContractExchangeService` — public (no `private` modifier). It is called only from `ContractWorkflowService.activate()`. Since it accepts a raw `Prisma.TransactionClient`, it cannot be called directly without the parent transaction — but a future developer might accidentally expose it via a controller. Consider marking it `/** @internal */` or extracting to a private helper.

#### I2 — Test `tx` mocks typed as `any`

In `contract-workflow.service.spec.ts` and `contract-exchange.service.spec.ts`, the new test suites use `let tx: any` for the transaction mock. This is acceptable in tests but prevents TypeScript from catching interface mismatches between the mock and the real `Prisma.TransactionClient`.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers / guards | ✅ No new endpoints; `ContractExchangeController` already has guards |
| `Number()` on money fields | ✅ All Decimal arithmetic uses `new Decimal()` — `generateSaleNumber` is a counter, not money |
| `deletedAt: null` on new queries | ✅ `contractExchangeRequest.findFirst` includes `deletedAt: null` |
| Hardcoded secrets | ✅ None |
| SQL injection / raw queries | ✅ None |
| DTO validation | ✅ No new DTOs |
| Atomic JE posting | ✅ `finalizeAfterActivation` receives and uses the parent `$transaction` client (`tx`) — rollback on failure confirmed by test |
| No orphan JEs on approve failure | ✅ `approve()` posts zero JEs — nothing to roll back if it fails mid-way |
| PDPA unique constraint | ⚠️ Fixed in `fix/exchange-pdpa-clone` (W2 above) — merge order matters |

---

## Recommendation

### ✅ APPROVE (already merged to main)

The sign-then-activate redesign is architecturally sound and correctly defers JE posting to the moment the customer actually signs + the contract is activated. The two-phase approach (`approve` = "commit to the deal, reserve the product" and `finalizeAfterActivation` = "post the money") eliminates the unsigned-obligation risk.

**Required merge order:**  
`feat/sp2-exchange-sign-flow` (already in main) → `fix/exchange-pdpa-clone` (pending)

**Follow-ups:**
1. (W1) Replace `as any` casts with proper Prisma select type augmentation for `exchangedFromContractId`.
2. (W3) Move `fix-sp1-used-exchange-uuid.sql` to `prisma/migrations-manual/` with DEV-ONLY header.
