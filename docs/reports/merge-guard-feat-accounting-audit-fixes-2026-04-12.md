# Merge Guard Report — feat/accounting-audit-fixes
**Date**: 2026-04-12  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Reviewed commits** (top 5, unique to branch):
- `9aba503` fix(test): relax getContractPayments assertion
- `973342e` fix(test): update payment test mocks for R-012
- `d785a10` feat(accounting): Thai accounting standards audit fixes (7 critical, 14 warnings, 15 recommendations)
- `bf32a3c` feat: inter-company accounting (BESTCHOICE SHOP ↔ BESTCHOICE FINANCE)
- `68529a9` fix: address 5 critical issues from code review

## File Changes Summary (recent commits)
| Commit | Files | +Lines | -Lines |
|--------|-------|--------|--------|
| d785a10 (accounting audit fixes) | 21 | +2,294 | -349 |
| bf32a3c (inter-company accounting) | 12 | +1,017 | -2 |
| 68529a9 (critical fixes) | 8 | +147 | -118 |

**Key files changed:**
- `apps/api/src/modules/accounting/accounting.controller.ts` — new endpoints
- `apps/api/src/modules/accounting/accounting.service.ts` — major expansion (+421 lines)
- `apps/api/src/modules/accounting/bad-debt.service.ts` — new file (+248 lines)
- `apps/api/src/modules/inter-company/inter-company.controller.ts` — new module
- `apps/api/src/modules/inter-company/inter-company.service.ts` — new module (+264 lines)
- `apps/api/src/modules/reports/reports.service.ts` — balance sheet + cash flow (+134 lines)
- `apps/api/prisma/schema.prisma` — schema changes (WHT fields, BadDebtProvision model)

---

## Issues by Severity

### Critical (must fix before merge): 0

No critical issues found:
- All new controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✅
- All controller methods have `@Roles(...)` decorators ✅
- No hardcoded secrets or API keys ✅
- No unparameterized `$queryRaw` ✅
- `findAll()` in inter-company service correctly initializes `where: { deletedAt: null }` ✅

---

### Warning (should fix before merge): 3

**W-1: `Number()` on Prisma Decimal sum fields — reports.service.ts & inter-company.service.ts**

`Number()` is used on `_sum.*` Prisma Decimal fields in the new balance sheet, cash flow, and profit summary methods. This introduces floating-point imprecision on financial data, violating the project's Decimal policy.

Affected lines in `d785a10` commit — `apps/api/src/modules/reports/reports.service.ts`:
```typescript
// Cash flow statement (new additions):
Number(paymentsReceived._sum.amountPaid || 0) +
Number(cashSalesTotal._sum.netAmount || 0) +
Number(downPaymentsTotal._sum.downPaymentAmount || 0)
// Balance sheet:
const grossReceivables = Number(hpReceivables._sum.amountDue || 0);
const inventoryValue = Number(inventory._sum.costPrice || 0);
```

Affected lines in `apps/api/src/modules/inter-company/inter-company.service.ts`:
```typescript
const shopProfit = Number(t.shopProfit);
const commission = Number(t.commission);
const principal = Number(t.principal);
```

And in `apps/api/src/modules/accounting/bad-debt.service.ts`:
```typescript
const remaining = Number(p.amountDue) - Number(p.amountPaid);
```

**Fix**: Replace `Number(x)` with `new Prisma.Decimal(x || 0)` for all money field conversions. Use `.toNumber()` only at the serialization boundary (final return object).

---

**W-2: `bundleProducts` query missing `deletedAt: null` — reports.service.ts**

In `d785a10`, the new COGS bundle cost calculation queries `Product.findMany` without a soft-delete filter:

```typescript
// apps/api/src/modules/reports/reports.service.ts (from d785a10)
const bundleProducts = await this.prisma.product.findMany({
  where: { id: { in: allBundleIds } },   // ← missing deletedAt: null
  select: { costPrice: true },
});
```

Soft-deleted products could be included in the COGS calculation, inflating cost of goods sold.

**Fix**: Add `deletedAt: null` to the where clause.

---

**W-3: Missing Thai validation messages on inter-company DTOs — inter-company.dto.ts**

The new `CreateInterCompanyTransactionDto` in `apps/api/src/modules/inter-company/dto/inter-company.dto.ts` uses class-validator decorators but omits Thai-language error messages (project convention requires `{ message: 'กรุณา...' }` on all validators).

**Fix**: Add `{ message: 'กรุณาระบุ...' }` to `@IsString()`, `@IsNumber()`, `@IsEnum()` decorators on all new DTOs.

---

### Info

**I-1: `bad-debt.service.ts` is a large file (+248 lines) — consider splitting provisioning vs write-off logic**  
Not blocking, but the service handles both aging bucket calculation and write-off workflows. A future split into `bad-debt-provision.service.ts` and `bad-debt-writeoff.service.ts` would improve testability.

**I-2: `inter-company.service.ts` profit summary uses `any` type for `where` object**  
```typescript
const where: Record<string, unknown> = { deletedAt: null };
```
Consider using a typed Prisma `InterCompanyTransactionWhereInput` instead of `Record<string, unknown>` to get type-safety on filter fields.

---

## Recommendation: **REVIEW**

The branch introduces important Thai accounting standards compliance (balance sheet, cash flow, bad debt provisioning, WHT fields, inter-company module). The controller security posture is good — all guards and roles are correctly applied.

However, **3 warnings must be addressed before merge**:
1. **W-1** (Decimal precision) is the most impactful — financial reports with floating-point errors would produce incorrect balance sheets.
2. **W-2** (missing soft-delete) could silently include deleted products in COGS.
3. **W-3** (missing Thai messages) breaks the project convention, but is low risk.

Recommend fixing W-1 and W-2 before merging. W-3 can be addressed in a follow-up.
