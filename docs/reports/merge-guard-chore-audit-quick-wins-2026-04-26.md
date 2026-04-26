# Merge Guard Report — chore/audit-quick-wins

**Date**: 2026-04-26  
**Branch**: `chore/audit-quick-wins`  
**Author**: Akenarin Kongdach  
**Latest commit**: 2026-04-26  
**Commits on branch**: 2  

---

## File Changes Summary

13 files changed, 209 insertions(+), 44 deletions(-)

| File | Change |
|------|--------|
| `apps/api/prisma/migrations/*/migration.sql` | 3 compound indexes |
| `apps/api/prisma/schema.prisma` | 7-line index additions |
| `apps/api/src/modules/customers/customers.controller.ts` | `limit` caps on 3 endpoints |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | N+1 → `groupBy` refactor |
| `apps/api/src/modules/journal/journal.controller.ts` | `limit` cap |
| `apps/api/src/modules/line-oa/broadcast.controller.ts` | File upload validation |
| `apps/api/src/modules/line-oa/line-oa.controller.ts` | File upload validation (2 endpoints) |
| `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` | `ShopBotDefenseGuard` + throttle |
| `apps/api/src/modules/shop-installment-apply/shop-installment-apply.controller.ts` | `ShopBotDefenseGuard` + throttle |
| `apps/api/src/modules/shop-me/shop-me.controller.ts` | Address cap + DTO validation |
| `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts` | `ShopBotDefenseGuard` + throttle |
| `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts` | `ShopBotDefenseGuard` + throttle |
| `apps/api/src/modules/staff-chat/web-widget.controller.ts` | `InitWidgetDto` DTO + throttle |

---

## Issues by Severity

### Critical
None found.

### Warning
**[W-1] `totalSales` accumulated via `.toNumber()` — `sellingPrice` is `Decimal(12,2)`**  
File: `apps/api/src/modules/dashboard/dashboard.service.ts`  
The refactored staff metrics accumulate `totalSales` using `new Prisma.Decimal(...).toNumber()` on the intermediate value. Since `totalSales` is a display-only dashboard metric (never persisted or used in financial calculations) and the old code used the same pattern, precision loss is negligible in practice. However, it technically violates the "no `Number()` on money fields" rule.  
_Suggested fix_: accumulate with `Prisma.Decimal` all the way through, call `.toNumber()` only at the final `map()` step.

### Info
- The `sellingSum` variable computed in the same function is immediately overridden if the key already exists, making it a dead assignment in the `else` branch — minor code clarity issue, not a bug.
- No new `.tsx` files — frontend not touched.

---

## What This Branch Does Well

- **Limit capping**: `Math.min(parseInt(limit) || N, 100)` added to 4 endpoints — prevents DoS via large result sets.
- **File upload hardening**: `ParseFilePipe` + `MaxFileSizeValidator` + `FileTypeValidator` on 3 file upload endpoints (10MB broadcast, 1MB rich-menu × 2).
- **Bot-defense guard**: `ShopBotDefenseGuard` applied to 4 public shop endpoints that previously had no rate-limiting.
- **Throttle decorators**: `@Throttle({ short: { limit: 5, ttl: 60_000 } })` on social auth callbacks and installment submissions.
- **`AbortSignal.timeout(10_000)`**: Added to all 3 external LINE/Facebook `fetch()` calls.
- **Address unbounded write fixed**: `POST /shop/me/addresses` now rejects after 20 items + uses proper `ShippingAddressDto`.
- **Dashboard N+1 eliminated**: monthly contract list load replaced with `groupBy` + batched user/branch lookups.

---

## Recommendation

**APPROVE**

No Critical or blocking issues. The single Warning (`.toNumber()` on display accumulator) is a style violation carried over from old code and introduces no financial risk. Can be cleaned up in a follow-up.
