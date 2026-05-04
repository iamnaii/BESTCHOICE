# Merge Guard Report — fix/accounting-phase-a3-ic-settlement

**Date**: 2026-05-04  
**Branch**: `fix/accounting-phase-a3-ic-settlement`  
**Last commit**: `feat(accounting): Phase A.3 (W-5) — Inter-company settlement JE`  
**Recommendation**: **REVIEW** (no blockers — one security-adjacent warning)

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/src/app.module.ts` | +3 | Import new `IntercompanyModule` |
| `apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts` | +20 | SettleIntercompanyDto with class-validator |
| `apps/api/src/modules/intercompany/intercompany.controller.ts` | +29 | GET balance + POST settle endpoints |
| `apps/api/src/modules/intercompany/intercompany.module.ts` | +12 | NestJS module |
| `apps/api/src/modules/intercompany/intercompany.service.spec.ts` | +124 | Unit tests (balance, settle, error cases) |
| `apps/api/src/modules/intercompany/intercompany.service.ts` | +103 | Balance query + settle logic |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +92 | Tests for createInterCompanySettlementJournal |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +91 | createInterCompanySettlementJournal method |

**Total**: +474 insertions across 8 files

---

## Issues

### Warning

**W1 — Missing `@IsNotEmpty()` on DTO `reference` field**  
`apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts:9`
```typescript
@IsString({ message: 'กรุณาระบุเลขที่อ้างอิง' })
@MaxLength(50)
reference!: string;
```
`@IsString()` passes an empty string `""`. The endpoint `POST /accounting/intercompany/settle` would accept a blank reference and create a JE with no bank reference. Add `@IsNotEmpty({ message: 'กรุณาระบุเลขที่อ้างอิง' })` before `@IsString()`.  
_Severity_: Warning — the frontend validates this too, but server-side is the authoritative guard.

**W2 — Float arithmetic in balance guard**  
`apps/api/src/modules/intercompany/intercompany.service.ts:85`
```typescript
if (dto.amount > balance.financeOwesToShop + 0.01) {
```
`dto.amount` is a JS `number` (from DTO), `balance.financeOwesToShop` is also `number` (returned from service as `.toNumber()`). The `+0.01` tolerance is intentional but float subtraction can drift. Low risk since this is a guard check only (the actual JE uses `new Prisma.Decimal(params.amount)`), but consistency with the Decimal pattern would be cleaner.  
_Severity_: Warning — no production impact, defensive code improvement only.

---

### Info

**I1 — `remainingBalance` uses float arithmetic**  
```typescript
remainingBalance: Math.round((balance.financeOwesToShop - dto.amount) * 100) / 100
```
This is a display-only response field (not stored in DB). Acceptable.

**I2 — Duplicate module naming**  
`InterCompanyModule` (existing, in `inter-company/`) and new `IntercompanyModule` (in `intercompany/`) both exist in the app. The naming inconsistency (`inter-company` vs `intercompany`) could cause confusion. Consider consolidating in a follow-up.

---

## Security Checks

| Check | Status |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` at class level | ✓ PASS |
| `@Roles()` on all methods | ✓ PASS — GET: OWNER/FINANCE_MANAGER/ACCOUNTANT; POST: OWNER/FINANCE_MANAGER |
| `Number()` on money fields | ✓ PASS — `new Prisma.Decimal(params.amount)` in JournalAutoService |
| `deletedAt: null` in queries | ✓ PASS — both `companyInfo` lookups and `journalLine` aggregates |
| Hardcoded secrets | ✓ PASS — none |
| SQL injection | ✓ PASS — parameterized queries only |
| Missing `@IsNotEmpty` on required DTO field | ⚠ WARNING — `reference` accepts empty string |

---

## Recommendation: REVIEW

One actionable warning before merge:
1. Add `@IsNotEmpty({ message: 'กรุณาระบุเลขที่อ้างอิง' })` to `reference` in `SettleIntercompanyDto`

The core accounting logic (IC invariant, paired JEs, balance guard) is correct and well-tested with 10 new unit tests covering balance drift detection, over-settlement rejection, and company misconfiguration.
