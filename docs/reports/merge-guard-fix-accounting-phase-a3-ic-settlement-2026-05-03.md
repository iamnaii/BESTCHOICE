# Merge Guard Report — `fix/accounting-phase-a3-ic-settlement`

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a3-ic-settlement`  
**Authors**: iamnaii, Akenarin Kongdach  
**Recommendation**: ⚠️ REVIEW

---

## Summary

Phase A.3 (W-5) — Inter-company settlement JE. Introduces a new `IntercompanyModule` with controller, service, DTO, and 124 unit tests. Posts paired SHOP+FINANCE journal entries when FINANCE physically pays SHOP to settle the accumulated `Due-to-SHOP` balance.

**Note**: This branch is stacked on `fix/accounting-w2-w4-frontend`. It contains all W-2/W-4 changes plus the A.3 additions. Merge order: **W-2/W-4 → A.3 → A.2**.

---

## File Changes (8 files, +474 new)

| File | Type | Change |
|---|---|---|
| `apps/api/src/app.module.ts` | Backend | +3 — import + register `IntercompanyModule` |
| `apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts` | Backend | +20 new DTO |
| `apps/api/src/modules/intercompany/intercompany.controller.ts` | Backend | +29 new controller |
| `apps/api/src/modules/intercompany/intercompany.module.ts` | Backend | +12 new module |
| `apps/api/src/modules/intercompany/intercompany.service.spec.ts` | Tests | +124 new spec |
| `apps/api/src/modules/intercompany/intercompany.service.ts` | Backend | +103 new service |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | Tests | +92 new JE tests |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Backend | +91 — `createInterCompanySettlementJournal` method |

---

## Issues

### ⚠️ Warning

**W-1. Float comparison on money amount** (`intercompany.service.ts:75`)

```ts
if (dto.amount > balance.financeOwesToShop + 0.01) {
  throw new BadRequestException(...)
}
```

`dto.amount` is a JS `number` (float) from the DTO. `balance.financeOwesToShop` is a `Decimal` value that has been `.toNumber()`'d. The `+0.01` tolerance mitigates most float precision issues, but the comparison is semantically incorrect for financial logic. Fix: use `new Prisma.Decimal(dto.amount).gt(new Prisma.Decimal(balance.financeOwesToShop).add('0.01'))`, or compare after both have been `toDecimalPlaces(2)`.

**W-2. Float arithmetic in `remainingBalance` response** (`intercompany.service.ts:88`)

```ts
remainingBalance: Math.round((balance.financeOwesToShop - dto.amount) * 100) / 100,
```

Not persisted to DB, but inconsistent with the Decimal-everywhere convention in this codebase. Replace with:
```ts
remainingBalance: new Prisma.Decimal(balance.financeOwesToShop).sub(dto.amount).toDecimalPlaces(2).toNumber(),
```

**W-3. `SettleIntercompanyDto.amount` typed as `number` (JS float)** (`settle-intercompany.dto.ts:4`)

```ts
@IsNumber({ maxDecimalPlaces: 2 }, { message: 'จำนวนเงินไม่ถูกต้อง' })
@IsPositive({ message: 'จำนวนเงินต้องมากกว่า 0' })
amount!: number;
```

The `@IsNumber({ maxDecimalPlaces: 2 })` decorator checks for at most 2 decimal places on the JS number, which helps but doesn't eliminate float precision edge cases (e.g., a client sending `5000.001` passes the check if JS rounds the float representation). The service correctly wraps it in `new Prisma.Decimal(params.amount)` before any JE posting. Consider accepting `amount` as a string with `@IsDecimalString()` pattern to avoid float precision entering the system at all — consistent with how `Prisma.Decimal` is used elsewhere.

### ℹ️ Info

**I-1. Four sequential DB round-trips in `getOutstandingBalance()`** (`intercompany.service.ts:28-65`)

The method issues `Promise.all` for 2 company lookups, waits for those to resolve, then issues another `Promise.all` for 2 aggregate queries — 2 parallel batches of 2. Could be reduced to a single parallel batch of 4 if `shopCompanyId`/`financeCompanyId` are cached or passed in as parameters. Not a correctness issue.

**I-2. Settlement amount overpayment guard has ±0.01 tolerance**

The service allows settling up to `financeOwesToShop + 0.01` to handle floating-point drift between the balance query and the JE amount. This is intentional (matches the frontend's same guard), but means a user could technically post a settlement 1 satang over the balance. The JE will still balance — just results in a small `Dr > Cr` on `21-1102`. Acceptable, but worth documenting in the business rules.

---

## Security Checklist

| Check | Result |
|---|---|
| `@UseGuards(JwtAuthGuard, RolesGuard)` at class level | ✅ |
| `@Roles()` on every method | ✅ — GET: OWNER/FINANCE_MANAGER/ACCOUNTANT; POST: OWNER/FINANCE_MANAGER |
| `ValidationPipe({ whitelist: true })` | ✅ |
| All DTO fields have class-validator decorators | ✅ |
| Thai validation messages | ✅ |
| `deletedAt: null` in all queries | ✅ |
| No unparameterized `$queryRaw` | ✅ |
| No hardcoded secrets / API keys | ✅ |
| Module registered in `app.module.ts` | ✅ |
| Tested: guards, roles, balance endpoint, settle endpoint | ✅ — 124 service unit tests + 4 JE integration tests |

---

## Recommendation

**⚠️ REVIEW** — No critical security blockers. The three warnings are all variations of float-vs-Decimal inconsistency on the settlement amount. W-1 is the most important since it's a guard condition. Fix W-1 and W-2 before merge; W-3 is lower priority but should be tracked.
