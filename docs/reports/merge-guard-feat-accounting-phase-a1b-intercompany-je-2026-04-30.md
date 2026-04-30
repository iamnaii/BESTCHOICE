# Merge Guard Report — feat/accounting-phase-a1b-intercompany-je

**Date**: 2026-04-30  
**Branch**: `feat/accounting-phase-a1b-intercompany-je`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last Commit**: 2026-04-29 18:10:48 +0700  
**Commit**: `fa27da7d` — fix(accounting): post-review fixes — SHOP 42-1105 + repo idempotency + loss constant  
**Recommendation**: ✅ **REVIEW** (no blockers, one Warning to address)

---

## File Changes Summary

```
23 files changed, +3835 / -181 lines

New files (TypeScript):
  apps/api/src/modules/journal/inter-company-link.util.ts
  apps/api/src/modules/journal/inter-company-link.util.spec.ts
  apps/web/e2e/accounting-inter-company-flow.spec.ts

Modified production files:
  apps/api/src/modules/journal/journal-auto.service.ts
  apps/api/src/modules/accounting/bad-debt.service.ts
  apps/api/src/modules/contracts/contract-payment.service.ts
  apps/api/src/modules/contracts/contract-workflow.service.ts
  apps/api/src/modules/payments/payments.service.ts
  apps/api/src/modules/paysolutions/paysolutions.service.ts
  apps/api/src/modules/repossessions/repossessions.service.ts
  apps/api/src/modules/repossessions/repossessions.controller.ts
  apps/api/prisma/seeds/chart-of-accounts.ts
  apps/api/prisma/seeds/chart-of-accounts-finance.ts
```

---

## Issues

### Critical — Must fix before merge

_None found._

### Warning — Should fix

**W1: `.toNumber()` on Decimal journal line amounts in production service**

- **File**: `apps/api/src/modules/journal/journal-auto.service.ts`
- **Pattern**: Journal entry line arrays use `.toNumber()` to convert `Prisma.Decimal` → JS `number` for `debit`/`credit` fields

```typescript
// Examples:
{ accountCode: FA.CASH, debit: amountPaid.toNumber(), credit: 0 }
{ accountCode: FA.HP_RECEIVABLE, debit: 0, credit: hpReceivableCredit.toNumber() }
{ accountCode: SA.DUE_FROM_FINANCE, debit: commission.toNumber(), credit: 0 }
// ... ~20 similar occurrences
```

- **Risk**: Low — Prisma converts JS numbers back to Decimal before storage, and Thai baht amounts have at most 7 significant digits (well within IEEE 754 float precision of 15–16). However this violates the project rule `ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน` and sets a bad precedent.
- **Fix**: Define the intermediate line object type with `debit: Prisma.Decimal | number` or pass `Prisma.Decimal` directly without `.toNumber()`.

### Info

- **I1**: New file `inter-company-link.util.ts` is well-structured with proper type annotations.
- **I2**: All new `companyInfo.findFirst()` calls include `where: { deletedAt: null }` — clean.
- **I3**: New E2E spec `accounting-inter-company-flow.spec.ts` covers both SHOP and FINANCE journal sides.
- **I4**: No new controllers added — no guard surface to review.
- **I5**: No `$queryRaw` SQL injection vectors introduced.
- **I6**: New chart-of-account entry `53-1804 ขาดทุนจากการขายสินค้ายึดคืน` is correctly placed in FINANCE chart.

---

## Checklist

| Check | Result |
|---|---|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ N/A (no new controllers) |
| `@Roles()` on all new endpoints | ✅ N/A |
| Money fields use `Prisma.Decimal` (not `Number`) | ⚠️ See W1 |
| All queries have `deletedAt: null` | ✅ Clean |
| No hardcoded secrets or API keys | ✅ Clean |
| No unparameterized `$queryRaw` | ✅ Clean |
| New DTOs use class-validator | ✅ N/A (no new DTOs) |
| React components use `api.get()`/`api.post()` | ✅ N/A |
| `queryClient.invalidateQueries()` after mutations | ✅ N/A |

---

## Recommendation

**✅ REVIEW** — W1 (`.toNumber()` on journal line amounts) is a style/convention violation with low actual risk. The branch can merge once W1 is addressed, or with explicit owner sign-off that `.toNumber()` is acceptable for intermediate journal line objects in this context.
