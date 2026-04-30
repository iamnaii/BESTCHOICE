# Merge Guard Report — fix/accounting-phase-a3-ic-settlement

**Date**: 2026-04-30  
**Branch**: `fix/accounting-phase-a3-ic-settlement`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commits**: 1  
**Recommendation**: ⚠️ **REVIEW** — 2 Warnings require fixes before merge

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/src/app.module.ts` | +3 | Registers new `IntercompanyModule` |
| `apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts` | +20 | DTO for settlement request |
| `apps/api/src/modules/intercompany/intercompany.controller.ts` | +29 | GET balance + POST settle endpoints |
| `apps/api/src/modules/intercompany/intercompany.module.ts` | +12 | NestJS module wiring |
| `apps/api/src/modules/intercompany/intercompany.service.spec.ts` | +124 | Unit tests |
| `apps/api/src/modules/intercompany/intercompany.service.ts` | +103 | Balance query + settle logic |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +91 | `createInterCompanySettlementJournal` method |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +92 | JE tests for IC settlement |

**Total**: 8 files, +474 insertions

---

## Issues Found

### Critical — None

Controller is properly guarded:
```typescript
@Controller('accounting/intercompany')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntercompanyController { ... }

@Get('balance')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')

@Post('settle')
@Roles('OWNER', 'FINANCE_MANAGER')
```
`JwtAuthGuard` + `RolesGuard` at class level ✅. `@Roles()` on every method ✅.

### Warning

**W1 — `SettleIntercompanyDto.amount` is `number` (float), not Decimal — float comparison for money**  
`apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts:4-6`  
`apps/api/src/modules/intercompany/intercompany.service.ts:75`

```typescript
// DTO
amount!: number;  // ← JS float

// Service
if (dto.amount > balance.financeOwesToShop + 0.01) { ... }  // float arithmetic
```

Both `dto.amount` and `balance.financeOwesToShop` are JS `number` (float). The `+ 0.01` tolerance attempts to handle float imprecision but using `>` between two floats for money comparison can still mis-compare in edge cases.

**Fix**: Accept the amount as a string in the DTO and convert to `Prisma.Decimal` in the service, or change the comparison to use `Prisma.Decimal`:
```typescript
// service
const dtoAmount = new Prisma.Decimal(dto.amount);
if (dtoAmount.gt(new Prisma.Decimal(balance.financeOwesToShop).add('0.01'))) { ... }
```

**W2 — TOCTOU race condition: balance checked OUTSIDE the `$transaction`**  
`apps/api/src/modules/intercompany/intercompany.service.ts:68-85`

```typescript
async settle(dto: SettleIntercompanyDto, userId: string) {
  // balance check here (outside tx)
  const balance = await this.getOutstandingBalance();
  if (dto.amount > balance.financeOwesToShop + 0.01) {
    throw new BadRequestException(...);
  }

  // JE posted here (inside tx)
  const result = await this.prisma.$transaction(async (tx) => {
    return this.journalAuto.createInterCompanySettlementJournal(tx, { ... });
  });
}
```

Two concurrent settle requests (e.g., double-click on the UI, or two simultaneous API calls) can both read the same outstanding balance, both pass the `>` check, and both proceed to post JEs — resulting in an over-settlement.

**Fix**: Move the balance check INSIDE the `$transaction` using a row lock (or `pg_advisory_xact_lock`) to serialise concurrent settlements:
```typescript
const result = await this.prisma.$transaction(async (tx) => {
  // lock + re-check balance inside tx
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SETTLE_LOCK_KEY}::bigint)`;
  const balance = await this.getOutstandingBalanceTx(tx);
  if (dtoAmount.gt(new Prisma.Decimal(balance.financeOwesToShop).add('0.01'))) {
    throw new BadRequestException(...);
  }
  return this.journalAuto.createInterCompanySettlementJournal(tx, { ... });
});
```

This is a financial settlement endpoint — over-settlement would require a reversal JE and could create reconciliation issues.

### Info

**I1 — Module naming confusion: `InterCompanyModule` vs `IntercompanyModule`**  
`apps/api/src/app.module.ts:63`

Both modules are registered side-by-side:
```typescript
InterCompanyModule,    // apps/api/src/modules/inter-company/
IntercompanyModule,    // apps/api/src/modules/intercompany/  ← new
```

The existing `InterCompanyModule` handles legacy inter-company transaction records. The new `IntercompanyModule` handles settlement JEs. Consider renaming the new one to `IcSettlementModule` to avoid confusion in future searches.

---

## Positive Observations

- ✅ Both `deletedAt: null` guards on `companyInfo` and `journalLine` queries
- ✅ `Prisma.Decimal` used correctly inside `createInterCompanySettlementJournal` for all JE arithmetic
- ✅ `ValidationPipe({ whitelist: true })` on controller — strips unknown fields
- ✅ IC-invariant cross-check exposed in `getOutstandingBalance` response (`balanced`, `drift` fields)
- ✅ JE description linking via `[IC-<uuid>]` prefix links paired SHOP + FINANCE entries
- ✅ `amount must be > 0` guard in `createInterCompanySettlementJournal` prevents zero-value JEs
- ✅ 124 unit tests + 4 JE spec tests cover happy path, drift detection, over-settlement rejection, missing company config

---

## Required Before Merge

1. Fix W1: convert `amount` to `Prisma.Decimal` for money comparison in service
2. Fix W2: move balance pre-flight check inside `$transaction` with advisory lock

**Merge ordering**: Requires `fix/accounting-phase-a2-deferred-income` to be merged first (depends on `UNEARNED_INTEREST`, `UNEARNED_COMMISSION`, `VAT_OUTPUT_PENDING` account constants + `JournalAutoService.SHOP_ACC`/`FINANCE_ACC` constants added in A2).
