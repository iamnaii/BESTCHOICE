# Merge Guard Report — fix/accounting-phase-a3-ic-settlement

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a3-ic-settlement`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Base**: `origin/main`  
**Recommendation**: ⚠️ REVIEW — 2 warnings. No critical blockers.

---

## Summary

Phase A.3 (W-5) — Inter-company settlement. Adds a new `intercompany` module with two endpoints:
- `GET /accounting/intercompany/balance` — compute outstanding Due-to-SHOP / Due-from-FINANCE
  balance and detect IC-invariant drift.
- `POST /accounting/intercompany/settle` — record FINANCE → SHOP cash payment; posts paired JEs
  that symmetrically reduce both sides of the IC clearing pair.

Also adds `createInterCompanySettlementJournal` to `JournalAutoService`.

**Files changed**: 8 (474 insertions, 0 deletions — net-additive only)

| File | Change |
|------|--------|
| `apps/api/src/app.module.ts` | Import `IntercompanyModule` |
| `apps/api/src/modules/intercompany/intercompany.controller.ts` | New controller (2 endpoints) |
| `apps/api/src/modules/intercompany/intercompany.module.ts` | New module wiring |
| `apps/api/src/modules/intercompany/intercompany.service.ts` | Balance query + settle logic |
| `apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts` | SettleIntercompanyDto |
| `apps/api/src/modules/intercompany/intercompany.service.spec.ts` | 124 lines of tests |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Add `createInterCompanySettlementJournal` |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | 92 lines of new JE tests |

---

## Issues

### ⚠️ Warning

**W-1: Module directory naming clashes with existing `inter-company` module**

Two similar modules now live side-by-side in `apps/api/src/modules/`:

```
inter-company/   ← existing (InterCompanyModule, uses hyphens, handles SHOP↔FINANCE model records)
intercompany/    ← new      (IntercompanyModule,  no hyphens, handles settlement JEs)
```

Both are imported in `app.module.ts`. The naming is confusingly close and the two modules handle
different facets of the same business domain. A future developer may edit the wrong service.

**Action required**: Rename the new module to `intercompany-settlement/` (or `ic-settlement/`)
to clearly differentiate it, and update all imports accordingly. Alternatively, merge the new
functionality into the existing `inter-company` module (preferred if the domains should converge).

---

**W-2: Float arithmetic used for money comparison and return value in `settle`**

File: `apps/api/src/modules/intercompany/intercompany.service.ts`

```typescript
// Float comparison (balance.financeOwesToShop is number, dto.amount is number)
if (dto.amount > balance.financeOwesToShop + 0.01) { ... }

// Float subtraction for money result
remainingBalance: Math.round((balance.financeOwesToShop - dto.amount) * 100) / 100,
```

Per project rules, money must use `Prisma.Decimal`. The `+0.01` tolerance hack and `Math.round`
can silently lose precision for amounts with more than 2 decimal places. The comparison could also
behave incorrectly for amounts very close to the outstanding balance.

**Fix**:
```typescript
const outstanding = new Prisma.Decimal(balance.financeOwesToShop);
const requested = new Prisma.Decimal(dto.amount);
if (requested.gt(outstanding.add(0.01))) {
  throw new BadRequestException(...);
}
// ...
remainingBalance: outstanding.sub(requested).toDecimalPlaces(2).toNumber(),
```

---

### ℹ️ Info

**I-1: `SettleIntercompanyDto.amount` typed as `number` (acceptable for DTO layer)**

DTOs receive JSON where Decimal doesn't exist. Using `@IsNumber({ maxDecimalPlaces: 2 })` is
acceptable for input boundary validation. The service converts to `new Prisma.Decimal(params.amount)`
immediately. No change required, but note this is a deliberate exception to the Decimal rule
(boundary validation only).

**I-2: Settlement endpoints lack `@ApiOperation()` Swagger descriptions**

Minor documentation gap. The `@ApiBearerAuth('JWT')` and `@ApiTags('Inter-company')` are present.
Adding `@ApiOperation({ summary: '...' })` would improve the Swagger UI. No functional impact.

---

## Security Checks

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on controller | ✅ Class-level guard present |
| `@Roles()` on each endpoint | ✅ `GET balance`: OWNER/FINANCE_MANAGER/ACCOUNTANT; `POST settle`: OWNER/FINANCE_MANAGER |
| `Number()` on money fields in service/journal | ✅ Uses `new Prisma.Decimal()` in journal; see W-2 for DTO comparison |
| `deletedAt: null` in all new Prisma queries | ✅ Present on all `companyInfo.findFirst` + `journalLine.aggregate` calls |
| Hardcoded secrets / API keys | ✅ None |
| SQL injection / raw `$queryRaw` | ✅ No raw SQL in new module |
| Role separation: settle requires OWNER or FINANCE_MANAGER | ✅ Finance officers cannot self-approve settlement — correct SoD |
| IC invariant verification before settle | ✅ `getOutstandingBalance()` called as pre-flight; rejects if amount > outstanding |

---

## Notable Strengths

- `getOutstandingBalance` returns both sides (`financeOwesToShop` + `shopReceivableFromFinance`)
  and a `balanced: boolean` / `drift: number` — enables active monitoring of IC drift.
- `createInterCompanySettlementJournal` uses `[IC-<uuid>]` prefix on both JEs ensuring
  auditability and matchability.
- All settlement paths covered by tests including: balanced/unbalanced state, over-settlement
  rejection, exact-balance settlement, zero-amount rejection, missing company rejection.

---

## Merge Order Note

This branch builds on `fix/accounting-phase-a2-deferred-income` which builds on
`fix/accounting-phase-a1c-jebugs-v2`. The three must be merged in order:

```
A.1c → A.2 → A.3
```

Address W-1 in A.2 (migration timestamp rename) before any of the three are merged to avoid
migration-ordering confusion in CI.
