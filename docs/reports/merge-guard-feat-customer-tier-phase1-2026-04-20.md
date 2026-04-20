# Merge Guard Report — feat/customer-tier-phase1

**Date**: 2026-04-20
**Branch**: `feat/customer-tier-phase1`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Compared against**: `origin/main`

---

## File Changes Summary

| Area | Files | +/- |
|------|-------|-----|
| Prisma schema + migration | 2 | +27 |
| Backend: customer-tier service + spec | 2 | +284 |
| Backend: customers controller + spec | 2 | +35 |
| Backend: customers module + service | 2 | +29 |
| Backend: tier DTO | 1 | +24 |
| Frontend: CustomerTierBadge component + test | 2 | +81 |
| Frontend: CustomerDetailPage, CustomersPage | 2 | +46 |
| Frontend: customer-tier types | 1 | +32 |
| E2E spec | 1 | +31 |
| Docs/plans | 2 | +1439 |
| **Total** | **17** | **+2021 / -7** |

---

## Issues

### Critical (0)

None found.

### Warning (1)

**W1 — `toNumber()` on money field in response DTO**
- File: `apps/api/src/modules/customers/customer-tier.service.ts`
- Lines: `currentOutstanding: currentOutstanding.toDecimalPlaces(2).toNumber()`
- The precision is correctly bounded with `.toDecimalPlaces(2)` before conversion, and this is only used in the response DTO (not stored to DB), but it still deviates from the project convention of keeping Decimal values in service responses. The `CustomerTierResponse` type declares `currentOutstanding: number`, making this a display-only value.
- **Recommended fix**: Change `CustomerTierResponse.currentOutstanding` to `string` and call `.toFixed(2)` instead of `.toNumber()`, to be consistent with how other financial APIs return amounts.

### Info (2)

**I1 — New endpoint inherits class-level guards (correct)**
- `@Get(':id/tier')` in `customers.controller.ts` does not repeat `@UseGuards()` because the controller already has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level. `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` is correctly specified on the method. No issue.

**I2 — Large plan documents added**
- Two markdown plan files (`2026-04-20-customer-tier-phase1.md` at 1132 lines, `customer-intake-credit-check-redesign-design.md` at 307 lines) are included in the branch. These are docs-only and carry no runtime risk, but could be stored in a docs branch rather than a feature branch.

---

## Recommendation

**APPROVE** ✅

No blocking issues. Address Warning W1 (return `string` not `number` for financial fields) before the next feature phase builds on this API to avoid inconsistency with callers.
