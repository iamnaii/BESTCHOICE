# Merge Guard Report — fix/accounting-phase-a3-ic-settlement

**Date**: 2026-04-30
**Branch**: `fix/accounting-phase-a3-ic-settlement`
**Author**: Akenarin Kongdach \<iamnaii@MacBook-Pro-khxng-Akenarin.local\>
**Commits**: 1 (`feat(accounting): Phase A.3 (W-5) — Inter-company settlement JE`)

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/api/src/app.module.ts` | +3 | Registers new `IntercompanyModule` |
| `modules/intercompany/dto/settle-intercompany.dto.ts` | +20 | New file — settlement DTO |
| `modules/intercompany/intercompany.controller.ts` | +29 | New file — `GET /accounting/intercompany/balance`, `POST /accounting/intercompany/settle` |
| `modules/intercompany/intercompany.module.ts` | +12 | New file — module wiring |
| `modules/intercompany/intercompany.service.spec.ts` | +124 | New file — 7 tests |
| `modules/intercompany/intercompany.service.ts` | +103 | New file — balance query + settle service |
| `modules/journal/journal-auto.service.ts` | +91 | New method: `createInterCompanySettlementJournal` |
| `modules/journal/journal-auto.service.spec.ts` | +92 | 4 new tests for the settlement JE |

---

## Issues by Severity

### Critical — None

All security controls verified:
- `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓
- `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` on GET, `@Roles('OWNER', 'FINANCE_MANAGER')` on POST ✓
- No unparameterized `$queryRaw` (template literals only) ✓
- No hardcoded secrets ✓
- `deletedAt: null` in all queries ✓
- Decimal arithmetic used throughout (`new Prisma.Decimal(...)`) ✓

### Warning

**W1 — DTO `amount` field typed as `number`, not string/Decimal**
- **File**: `modules/intercompany/dto/settle-intercompany.dto.ts:4`
- `amount!: number` — financial values should ideally be received as `string` (JSON numbers lose precision for large Decimal values). In practice, `@IsNumber({ maxDecimalPlaces: 2 })` plus `Prisma.Decimal` coercion inside the service is safe for amounts up to ~15 significant digits (well within the 12,2 schema), but it deviates from the codebase's Decimal-first convention.
- **Fix**: Consider `@IsNumberString()` + `new Prisma.Decimal(dto.amount)` in service, or annotate with a code comment explaining the deliberate choice.

**W2 — `getOutstandingBalance` result is `number` and comparison uses JS float**
- **File**: `modules/intercompany/intercompany.service.ts:72-77`
- `financeOwesToShop` and `shopReceivableFromFinance` are returned as `number` (via `.toNumber()`). The `settle` guard `dto.amount > balance.financeOwesToShop + 0.01` uses JS float arithmetic. For the amounts in scope (12-digit Decimal), IEEE 754 double has enough precision, but the pattern breaks project convention of never mixing `number` with financial values.
- **Fix**: Keep values as `Prisma.Decimal` through the comparison, or clearly document the precision ceiling.

### Info

**I1 — Balance endpoint shows no IC drift alerting to Sentry**
- **File**: `modules/intercompany/intercompany.service.ts:62-70`
- When `!result.balanced`, the service returns `drift` in the JSON but does not call `Sentry.captureException`. Given the v3 hardening precedent (every data integrity alarm → Sentry), a drift in the IC invariant is serious enough to warrant an automatic alert.
- **Suggestion**: Add `Sentry.captureException(new Error('IC invariant drift'), { extra: { drift } })` when `Math.abs(drift) >= 0.01`.

**I2 — `createInterCompanySettlementJournal` is callable without passing companyIds**
- **File**: `modules/journal/journal-auto.service.ts:430-440`
- The method falls back to `tx.companyInfo.findFirst({ companyCode: 'SHOP'/'FINANCE' })` when companyIds are not provided. This adds 2 extra queries per settlement. `IntercompanyService.settle` already queries the balances (which resolve company IDs) — it could cache and pass the IDs through to avoid redundant lookups. Low performance impact at current volume.

---

## Recommendation: **APPROVE**

No critical issues. New controller is properly guarded and role-restricted. Settlement JE correctly posts paired SHOP+FINANCE entries that reduce both IC clearing accounts symmetrically, preserving the inter-company invariant. 7 unit tests cover the invariant, partial settlement, and error paths. W1/W2 are convention deviations rather than bugs; address in a follow-up or add explanatory comments.
