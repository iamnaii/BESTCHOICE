# Merge Guard Report — `fix/accounting-phase-a3-ic-settlement`

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a3-ic-settlement`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Last commit**: 2026-04-29 22:52:07 +0700  
**Recommendation**: ⚠️ REVIEW (money arithmetic warnings, non-blocking)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/src/app.module.ts` | +3 | 0 | Registers new `IntercompanyModule` |
| `apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts` | +20 | 0 | New DTO |
| `apps/api/src/modules/intercompany/intercompany.controller.ts` | +29 | 0 | New controller |
| `apps/api/src/modules/intercompany/intercompany.module.ts` | +12 | 0 | New module |
| `apps/api/src/modules/intercompany/intercompany.service.spec.ts` | +124 | 0 | Tests |
| `apps/api/src/modules/intercompany/intercompany.service.ts` | +103 | 0 | New service |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +92 | 0 | Tests for settlement JE |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +91 | 0 | New `createInterCompanySettlementJournal` |

---

## Issues

### Critical
*None found.*

### Warning

**W-1: Raw JS number arithmetic on money in `IntercompanyService.settle()`**
- **File**: `apps/api/src/modules/intercompany/intercompany.service.ts:80`
- **Code**: `if (dto.amount > balance.financeOwesToShop + 0.01)`
- **Issue**: Floating-point comparison on money values. Per project rules, money must use `Prisma.Decimal`. A value like `10600.005` could behave unexpectedly with JS float precision.
- **Fix**: 
  ```ts
  const dtoDecimal = new Prisma.Decimal(dto.amount);
  const balanceDecimal = new Prisma.Decimal(balance.financeOwesToShop);
  if (dtoDecimal.gt(balanceDecimal)) { ... }
  ```

**W-2: Raw JS number arithmetic for `remainingBalance` return value**
- **File**: `apps/api/src/modules/intercompany/intercompany.service.ts:100`
- **Code**: `remainingBalance: Math.round((balance.financeOwesToShop - dto.amount) * 100) / 100`
- **Issue**: JS number subtraction on money. Should use `Prisma.Decimal`.
- **Fix**:
  ```ts
  remainingBalance: new Prisma.Decimal(balance.financeOwesToShop).sub(dto.amount).toDecimalPlaces(2).toNumber()
  ```

**W-3: Raw JS number arithmetic for `drift` in `getOutstandingBalance()`**
- **File**: `apps/api/src/modules/intercompany/intercompany.service.ts:63`
- **Code**: `const drift = Math.round((shopReceivableFromFinance - financeOwesToShop) * 100) / 100`
- **Issue**: JS float arithmetic on money. The values already come from `Prisma.Decimal.toNumber()` so precision is capped at 2dp — the risk is low in practice, but inconsistent with the codebase convention.
- **Fix**:
  ```ts
  const drift = new Prisma.Decimal(shopReceivableFromFinance).sub(financeOwesToShop).toDecimalPlaces(2).toNumber();
  ```

### Info

**I-1: DTO `amount` field is `number` type**
- **File**: `apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts`
- `amount!: number` — boundary input from HTTP body. Class-validator accepts numeric JSON values. The journal service correctly wraps it in `new Prisma.Decimal(params.amount)` before DB operations. Acceptable at the DTO boundary.

---

## Positive Observations

- `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓
- `@Roles()` on every controller method ✓
- `POST /settle` restricted to `OWNER` and `FINANCE_MANAGER` only ✓
- All queries include `deletedAt: null` ✓
- `createInterCompanySettlementJournal` uses `new Prisma.Decimal(params.amount)` correctly ✓
- Paired FINANCE + SHOP journal entries maintain IC invariant (Due-to-SHOP Dr = Due-from-FINANCE Cr) ✓
- Linked via `[IC-<uuid>]` description prefix ✓
- Pre-flight guard: rejects settlement exceeding outstanding balance ✓
- 4 service tests + 4 journal tests covering balance, settlement, IC prefix, zero/missing company cases ✓

---

## Merge Order Note

Depends on `fix/accounting-phase-a2-deferred-income` (the `journal-auto.service.ts` index diff confirms sequential lineage). Merge A2 first, then this branch.
