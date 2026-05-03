# Merge Guard Report — fix/accounting-phase-a2-deferred-income

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a2-deferred-income`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/prisma/migrations/.../migration.sql` | +25 | 0 | Adds `unearnedInterest`, `unearnedCommission` fields to Contract |
| `apps/api/prisma/schema.prisma` | +7 | 0 | New Decimal fields on Contract model |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +10 | -1 | Adds SHOP account 21-2201 (Unearned Commission) |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | +13 | -3 | Seeds unearned fields on activation |
| `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` | +4 | -4 | Test updated for activation assertion |
| `apps/api/src/modules/data-audit/data-audit.service.ts` | +1 | 0 | Adds `contract.id` to audit context |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +213 | -96 | Major: deferred interest/VAT at activation, unearned drain at payment |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +266 | -37 | Tests updated for Phase A.2 behavior |
| `apps/api/src/modules/payments/payments.service.ts` | +6 | -3 | Passes `contract.id` to JE params |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | +3 | -1 | Same: passes `contract.id` |

**Total**: 10 files, +452 insertions / -96 deletions

---

## Issues by Severity

### Critical
_None found._

### Warning

**W1 — Mixed types: `Decimal? ?? 0` produces `Decimal | 0`**  
File: `apps/api/src/modules/contracts/contract-workflow.service.ts`

```typescript
// Current code
unearnedCommission: contract.storeCommission ?? 0,
```

`contract.storeCommission` is typed as `Decimal?` in Prisma. The `?? 0` null-coalescing produces a value of type `Decimal | number`. Prisma will accept this at runtime, but the static type is imprecise and could cause issues if this value is later used in arithmetic without explicit coercion. Prefer:

```typescript
unearnedCommission: contract.storeCommission ?? new Prisma.Decimal(0),
```

**W2 — `unearnedInterest` sourced directly from `contract.interestTotal` without checking for null**  
File: `apps/api/src/modules/contracts/contract-workflow.service.ts`

```typescript
unearnedInterest: contract.interestTotal,
```

If `interestTotal` is `null` or `undefined` on a contract (e.g., cash-sale contract that somehow reaches this path), seeding `null` into the `unearnedInterest` Decimal field will throw a Prisma validation error inside the transaction. Consider `contract.interestTotal ?? new Prisma.Decimal(0)` for safety.

### Info

**I1 — Large, dense accounting logic change**  
`journal-auto.service.ts` is +213/-96 lines in a single commit. The change introduces deferred recognition across three JE types (contract activation, regular payment, early payoff). While tests cover the new behavior extensively, the service is already a large file and the Phase A.2 entry-point comments (e.g., `// Phase A.2: HP Receivable credited for full installment`) are the only inline guidance. Acceptable for now.

**I2 — `contract.id` additive propagation**  
The pattern of adding `contract.id` to JE param objects across `payments.service.ts` and `paysolutions.service.ts` is purely additive and low risk. The `journal-auto.service.ts` parameter type was extended to `contract: { id?: string; contractNumber: string; branchId?: string | null }` (optional `id`) so backward compatibility is maintained.

---

## Security Checks

| Check | Result |
|-------|--------|
| New controllers with missing `@UseGuards` | ✅ No new controllers |
| `Number()` on financial fields | ✅ None found — all new arithmetic uses `Prisma.Decimal` |
| Missing `deletedAt: null` in queries | ✅ Not applicable (service-layer only) |
| Hardcoded secrets / API keys | ✅ None |
| Missing `@Roles()` on endpoints | ✅ No new endpoints |
| SQL injection (`$queryRaw` unparameterized) | ✅ No `$queryRaw` in changed files |

---

## Recommendation: ⚠️ REVIEW

Fix **W1** (Decimal type coercion) and **W2** (null-guard on `interestTotal`) before merge. Both are 1-line changes. No blocking security issues. Accounting logic is sound and extensively tested.

**Merge order dependency**: This branch must be merged **before** `fix/accounting-phase-a3-ic-settlement` and `fix/accounting-w2-w4-frontend`, which both build on top of it.
