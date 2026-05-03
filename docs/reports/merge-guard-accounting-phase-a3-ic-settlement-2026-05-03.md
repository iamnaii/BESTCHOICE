# Merge Guard Report — fix/accounting-phase-a3-ic-settlement

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a3-ic-settlement`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/src/app.module.ts` | +3 | 0 | Registers `IntercompanyModule` |
| `apps/api/src/modules/intercompany/intercompany.module.ts` | +12 | 0 | New NestJS module |
| `apps/api/src/modules/intercompany/intercompany.controller.ts` | +29 | 0 | New controller: GET balance, POST settle |
| `apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts` | +20 | 0 | New DTO with class-validator |
| `apps/api/src/modules/intercompany/intercompany.service.ts` | +103 | 0 | New service: balance query + settle |
| `apps/api/src/modules/intercompany/intercompany.service.spec.ts` | +124 | 0 | Tests: balance invariant, settle, overpay guard |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +91 | 0 | New `createInterCompanySettlementJournal` method |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +92 | 0 | Tests for settlement JE |

**Total**: 8 files, +474 insertions / 0 deletions (purely additive)

---

## Issues by Severity

### Critical
_None found._

### Warning

**W1 — Floating-point comparison for settlement guard**  
File: `apps/api/src/modules/intercompany/intercompany.service.ts`

```typescript
// Current code
if (dto.amount > balance.financeOwesToShop + 0.01) {
```

`balance.financeOwesToShop` is produced by `new Prisma.Decimal(...).toNumber()`. Both sides of the comparison are plain `number`, introducing potential IEEE 754 precision drift. For a financial over-payment guard this could in theory allow a settlement of `10600.009` when outstanding is `10600.00`. Use `Prisma.Decimal` comparison:

```typescript
if (new Prisma.Decimal(dto.amount).greaterThan(new Prisma.Decimal(balance.financeOwesToShop).add(new Prisma.Decimal('0.01')))) {
```

### Info

**I1 — Confirm `'IC_SETTLEMENT'` is a registered `JournalReferenceType` enum value**  
File: `apps/api/src/modules/journal/journal-auto.service.ts`

```typescript
referenceType: 'IC_SETTLEMENT',
```

The JE `referenceType` must match a known value in the Prisma schema (likely an enum `JournalReferenceType`). This was not visible in the diff. Confirm the migration or schema includes `IC_SETTLEMENT` before merging, or the `createAndPost` call will throw at runtime.

**I2 — `IntercompanyService.settle()` calls `getOutstandingBalance()` as a pre-flight check, then re-reads inside the transaction**  
File: `apps/api/src/modules/intercompany/intercompany.service.ts`

The balance check is performed outside the `$transaction`, so a concurrent settlement could pass both guards and double-settle. For Phase A.3 this is acceptable (low-frequency admin action), but worth noting as a TOCTOU (time-of-check/time-of-use) pattern for future review.

---

## Security Checks

| Check | Result |
|-------|--------|
| New controller `@UseGuards(JwtAuthGuard, RolesGuard)` at class level | ✅ Present |
| `getBalance` — `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` | ✅ Present |
| `settle` — `@Roles('OWNER', 'FINANCE_MANAGER')` | ✅ Present (appropriately restricted) |
| DTO validation decorators with Thai messages | ✅ Present on all fields |
| `@UsePipes(ValidationPipe({ whitelist: true }))` | ✅ Present |
| `Number()` on financial fields | ✅ None — `Prisma.Decimal` used in JE |
| Missing `deletedAt: null` in queries | ✅ All queries include `deletedAt: null` |
| Hardcoded secrets / API keys | ✅ None |
| SQL injection | ✅ No `$queryRaw` in this diff |

---

## Recommendation: ⚠️ REVIEW

Fix **W1** (Decimal comparison) before merge — it's a 2-line change. Verify **I1** (`IC_SETTLEMENT` enum) — if not yet in the schema this is a blocking runtime error. TOCTOU in I2 is acceptable for current scale.

**Merge order dependency**: Requires `fix/accounting-phase-a2-deferred-income` merged first. Must be merged before `fix/accounting-w2-w4-frontend`.
