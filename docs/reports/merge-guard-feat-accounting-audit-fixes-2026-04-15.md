# Merge Guard Report — `feat/accounting-audit-fixes`
**Date**: 2026-04-15  
**Reviewed by**: Pre-Merge Guard (automated)  
**Recommendation**: ⚠️ REVIEW

---

## Branch Info
| Field | Value |
|-------|-------|
| Branch | `feat/accounting-audit-fixes` |
| Author | iamnaii (akenarin.ak@gmail.com) |
| Unique commits reviewed | 3 (top of branch, all by same author) |
| Latest commit | `9aba503d` — `fix(test): relax getContractPayments assertion` |
| Key commit | `d785a107` — `feat(accounting): Thai accounting standards audit fixes (7 critical, 14 warnings, 15 recommendations)` |

---

## File Changes Summary (key commit `d785a107`)
| Module | Files Changed | Notes |
|--------|---------------|-------|
| `accounting/` | `accounting.service.ts`, `accounting.controller.ts`, `accounting.module.ts`, `bad-debt.service.ts`, `dto/expense.dto.ts` | Main feature files |
| `inter-company/` | `inter-company.controller.ts`, `inter-company.service.ts` | New endpoints added |
| `payments/` | `payments.service.ts` | R-012 idempotency fix |
| `receipts/` | `receipts.service.ts`, `receipts.controller.ts`, `dto/void-receipt.dto.ts` | Void workflow + buyer info |
| `reports/` | `reports.service.ts` | Balance Sheet + Cash Flow reports |
| `repossessions/` | `repossessions.service.ts` | Cost adjustment |
| `sales/` | `sales.service.ts` | Bundle COGS fix |
| `prisma/` | `seed.ts`, `seeds/chart-of-accounts.ts` | 76-account CoA seed |
| `audit/` | `audit.interceptor.ts` | Remove `updatedAt` (immutability) |

---

## Issues Found

### Critical
_None found._

All new endpoints (`balance-sheet`, `cash-flow`, `period-status`, `close-period`, `bad-debt/calculate`, `bad-debt/summary`, `bad-debt/write-off/:contractId`) have `@Roles()` decorators. The controller class has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level. No unguarded endpoints introduced.

No `$queryRaw` with unparameterized inputs. No hardcoded secrets or API keys.

---

### Warning

**W-001 · `Number()` on Prisma Decimal fields in financial calculations (×18 instances)**  
**Files**: `accounting.service.ts`, `bad-debt.service.ts`, `reports.service.ts`

Example instances:
```ts
// accounting.service.ts — COGS calculation
const purchaseOrderCost = productCosts.reduce((sum, s) => sum + Number(s.product.costPrice || 0), 0);
bundleCost = bundleProducts.reduce((sum, p) => sum + Number(p.costPrice || 0), 0);

// reports.service.ts — Cash Flow report
const cashFromSales = Number(cashSales._sum.netAmount || 0);
const cashFromInstallments = Number(installmentPayments._sum.amountPaid || 0);
```

**Risk**: `costPrice`, `amountPaid`, `netAmount` are `@db.Decimal(12, 2)` fields. Converting to JS `Number` introduces IEEE 754 floating-point precision loss on values > 9 quadrillion (unlikely in practice) and on rounding (e.g. `0.1 + 0.2 !== 0.3`). v4 hardening fixed 53 similar instances project-wide.

**Context**: All 18 instances are in **reporting/aggregation code** (P&L, Balance Sheet, Cash Flow, COGS summary). None of these values are written back to the database — they are returned as JSON for display. Precision risk is low but not zero for large sums.

**Recommendation**: Use `new Prisma.Decimal(value || 0)` for intermediate arithmetic, or document explicitly why `Number()` is acceptable for these read-only report calculations. The project's `accounting.md` rule says to use `Prisma.Decimal` — this is a deviation that should be intentional.

---

**W-002 · Float arithmetic on money in `bad-debt.service.ts` (line 164)**  
**File**: `apps/api/src/modules/accounting/bad-debt.service.ts`
```ts
const remaining = Number(p.amountDue) - Number(p.amountPaid);
// ...
const provisionAmount = Math.round(data.amount * rate * 100) / 100;
```

`amountDue` and `amountPaid` are `@db.Decimal(12, 2)` fields. `remaining` is computed as a JS number and then stored in a `Map<string, { amount: number }>`. The `provisionAmount` is computed via `Math.round` float arithmetic before being written to `BadDebtProvision.provisionAmount` (a `Decimal` field).

**Risk**: The `provisionAmount` is written to the database (via `prisma.badDebtProvision.createMany`). Float arithmetic before storage can cause sub-cent discrepancies in provision records, which may cause reconciliation issues.

**Recommendation**: Convert to `Prisma.Decimal` before the provision arithmetic:
```ts
const remaining = new Prisma.Decimal(p.amountDue).minus(new Prisma.Decimal(p.amountPaid));
// ...
const provisionAmount = remaining.mul(rate).toDecimalPlaces(2);
```

---

**W-003 · New DTOs missing Thai validation error messages**  
**Files**: `apps/api/src/modules/accounting/dto/expense.dto.ts`, `apps/api/src/modules/receipts/dto/void-receipt.dto.ts`

New optional fields added without Thai `{ message: 'กรุณา...' }`:
```ts
// expense.dto.ts
@IsOptional()
@IsNumber()    // ← no Thai message
@Min(0)
@Max(1)
whtRate?: number;

@IsOptional()
@IsString()    // ← no Thai message
whtIncomeType?: string;

// void-receipt.dto.ts
@IsOptional()
@IsString()    // ← no Thai message
approvedById?: string;
```

Per project convention (coding-standards.md): "Validation messages เป็น**ภาษาไทย**". This applies to optional fields too.

**Recommendation**: Add Thai messages: `@IsString({ message: 'กรุณาระบุประเภทเงินได้' })`.

---

**W-004 · Large files that should be split**  
| File | Lines |
|------|-------|
| `apps/api/prisma/seed.ts` | 1,348 |
| `apps/api/src/modules/accounting/accounting.service.ts` | 994 |
| `apps/api/src/modules/payments/payments.service.ts` | 735 |
| `apps/api/src/modules/reports/reports.service.ts` | 594 |
| `apps/api/src/modules/sales/sales.service.ts` | 525 |

`accounting.service.ts` at 994 lines now combines P&L, Balance Sheet, Cash Flow, Period Close, and Bad Debt logic. Consider splitting into `AccountingReportsService` (balance-sheet, cash-flow) and `AccountingPeriodService` (period-status, close-period) in a future refactor.

---

### Info

**I-001 · Production migration note**  
Commit message states: "Requires `prisma migrate dev` after merge." In production, only `prisma migrate deploy` is allowed (database.md rule). Confirm that migration files are generated via `migrate dev` in dev and committed, then deployed via `migrate deploy` in production.

**I-002 · Test fixes (commits `973342e8`, `9aba503d`)**  
Both test fix commits correctly update mock expectations to match changed service behavior (R-012 `findMany` idempotency, `getContractPayments` pagination). No logic regressions identified.

**I-003 · AuditLog `updatedAt` removal (W-011)**  
`audit.interceptor.ts` removes `updatedAt` from AuditLog for immutability. This is a schema change — verify migration includes removing the column or making it non-required without breaking existing data.

**I-004 · Segregation of duties on expense approval**  
W-008 fix enforces creator ≠ approver rule for expenses. This is a business rule enforcement — confirm with finance manager that existing auto-approved expenses (where creator == approver) won't be rejected retroactively.

---

## Verification Checklist
- [x] `@UseGuards(JwtAuthGuard, RolesGuard)` — Class-level on AccountingController, InterCompanyController ✓
- [x] All new endpoints have `@Roles()` — 8 new routes, all guarded ✓
- [⚠️] `Number()` on money fields — 18 instances in reporting code (W-001, W-002)
- [x] `deletedAt: null` in new queries — Present in all new Prisma queries ✓
- [x] Hardcoded secrets — None ✓
- [x] SQL injection (`$queryRaw`) — Not used ✓
- [⚠️] Thai validation messages on DTOs — 3 new fields missing Thai messages (W-003)
- [x] `queryClient.invalidateQueries()` — N/A (backend only for this commit)

---

## Recommendation: ⚠️ REVIEW

**No Critical blockers.** The accounting audit fixes are comprehensive and well-structured. Guards, roles, and soft-delete patterns are correctly applied throughout.

**Must-address before merge** (per project rules):
1. **W-002**: Float arithmetic writing to `BadDebtProvision.provisionAmount` Decimal DB field — risk of sub-cent precision errors in financial records. Should use `Prisma.Decimal` arithmetic.

**Should-address before merge**:
2. **W-003**: Add Thai validation messages to 3 new DTO fields.
3. **W-001**: Consider using `Prisma.Decimal` for report aggregations, or add a code comment explaining why `Number()` is acceptable for read-only display.

**Acceptable to defer**:
4. **W-004**: Large file splitting — document as tech debt.
5. **I-001**: Verify migration workflow (dev → deploy).

This branch can proceed to merge once W-002 and W-003 are addressed.
