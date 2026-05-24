# Merge Guard Report — feat/sp2-exchange-sign-flow

**Date**: 2026-05-24  
**Branch**: `feat/sp2-exchange-sign-flow`  
**Author**: Akenarin Kongdach (iamnaii)  
**Reviewed by**: Pre-Merge Guard Agent

---

## File Changes Summary

| File | +Lines | −Lines | Notes |
|------|--------|--------|-------|
| `contract-exchange.service.ts` | ~120 | ~30 | New `finalizeAfterActivation`, refactored `approve()` |
| `contract-workflow.service.ts` | ~70 | ~15 | Branch to `finalizeAfterActivation` in `activate()` |
| `contracts.module.ts` | +12 | +1 | Import `ContractExchangeModule` |
| `ExchangeRequestsPage.tsx` | +14 | −3 | Navigate to new contract after approve |
| `ExchangeRequestForm.tsx` | +7 | −1 | Minor UI copy |
| `contract-workflow.service.spec.ts` | ~150 | ~80 | Test coverage for branching |
| `contract-exchange.service.spec.ts` | ~90 | ~10 | New `finalizeAfterActivation` tests |
| `fix-sp1-used-exchange-uuid.sql` | +5 | 0 | One-time backfill SQL |

**Total**: 685 insertions / 261 deletions across 10 files

---

## Issues Found

### Critical — None

No critical issues found:
- No new controllers without `@UseGuards(JwtAuthGuard, RolesGuard)`
- No `Number()` on money/financial fields — all money uses `new Decimal()`
- All new Prisma queries include `deletedAt: null` where applicable
- No hardcoded secrets or API keys
- No unparameterized `$queryRaw`
- No `@Roles()` missing (no new controller methods)
- No raw SQL injection risk

### Warning — 2 issues

**W1: Missing `deletedAt: null` on `contract.findFirst` in `nextExchangeContractNumber`**

`fix/sp2-deferred-blockers` (which this branch leads to) introduces:
```ts
const last = await tx.contract.findFirst({
  where: { contractNumber: { startsWith: `EXCH-${yyyymmdd}-` } },
  orderBy: { contractNumber: 'desc' },
  select: { contractNumber: true },
});
```
This is intentional — sequence numbering must not reuse numbers from soft-deleted contracts. The absence of `deletedAt: null` is correct here. Document explicitly to prevent future automated linters from flagging it.

**W2: `finalizeAfterActivation` catch path — no explicit Sentry capture**

In `ContractWorkflowService.activate()`, the exchange branch calls `finalizeAfterActivation` inside a `$transaction`. If the JE chain throws after the new contract is ACTIVE, the `$transaction` rolls back automatically. However, the error bubbles to the caller without an explicit Sentry tag distinguishing "exchange finalization failure" from "standard activation failure". Recommend adding:
```ts
Sentry.captureException(err, { tags: { module: 'exchange', phase: 'finalize-after-activation' } });
```
This is a warning, not a blocker — the `$transaction` atomicity already prevents data corruption.

### Info — 2 items

**I1: Circular dependency note in comments is correct**  
The comment in `contracts.module.ts` correctly explains why there's no circular dep (`ContractExchangeModule` depends only on Prisma + Audit + Journal). Good.

**I2: SQL fix-up script `fix-sp1-used-exchange-uuid.sql` is a one-time backfill**  
The SQL file converts legacy string IDs to UUIDs. Ensure this is tracked in the deploy runbook and executed before migration deploy, not after.

---

## Security Assessment

- **Guards**: No new controller endpoints added. Existing `ContractExchangeController` methods unchanged.
- **Branch scoping**: The `finalizeAfterActivation` receives `userId` from the controller; the caller (`ContractWorkflowService.activate`) already validates the user has `OWNER/BRANCH_MANAGER/FINANCE_MANAGER` role via `@Roles` decorator.
- **Frontend**: `useMutation` + `api.post()` + `queryClient.invalidateQueries()` — all correct patterns. `onError` handler present.
- **Money arithmetic**: `new Decimal(0)` for `advanceBalance` on new exchange contract — correct.

---

## Recommendation: ✅ APPROVE (with W2 noted)

The sign-then-activate architecture is sound: deferring JE chain to `activate()` prevents unsigned obligations from hitting the ledger. The `$transaction` wrapping ensures atomicity. The W2 Sentry gap is low-risk given the existing transaction rollback. Ship as-is; add Sentry tag in a follow-up.
