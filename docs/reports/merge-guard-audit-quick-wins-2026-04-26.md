# Pre-Merge Guard Report — chore/audit-quick-wins

**Date**: 2026-04-26  
**Branch**: `chore/audit-quick-wins`  
**Author**: Akenarin Kongdach  
**Commits**: 3 (perf+security audit hardening)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +/- | Type |
|------|-----|------|
| `apps/api/src/modules/customers/customers.controller.ts` | +9/-3 | `limit` cap improvements |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | +61/-40 | N+1 → groupBy refactor |
| `apps/api/src/modules/journal/journal.controller.ts` | +1/-1 | `limit` cap improvement |
| `apps/api/src/modules/line-oa/broadcast.controller.ts` | +15/-5 | File upload validation |
| `apps/api/src/modules/line-oa/line-oa.controller.ts` | +24/-0 | File upload validation |
| `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` | +11/-1 | Bot defense + throttle + timeout |
| `apps/api/src/modules/shop-installment-apply/shop-installment-apply.controller.ts` | +4/-0 | Bot defense + throttle |
| `apps/api/src/modules/shop-me/shop-me.controller.ts` | +15/-3 | DTO validation + address cap |
| `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts` | +6/-2 | Bot defense + throttle |
| `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts` | +6/-2 | Bot defense + throttle |
| `apps/api/src/modules/staff-chat/web-widget.controller.ts` | +13/-1 | DTO + throttle |
| `apps/api/prisma/schema.prisma` | +7/-0 | 3 compound indexes |
| `apps/api/prisma/migrations/…/migration.sql` | +15/-0 | Migration for indexes |

**Total**: 209 insertions, 44 deletions across 13 files

---

## Issues Found

### Critical (must fix before merge)
_None._

### Warning (should fix)
_None._

### Info
_None._

---

## Review Notes

All changes are security hardening and performance improvements with no regressions:

- **`limit` caps** (`Math.min(..., 100)`) on 4 endpoints prevent DoS via unbounded queries.
- **File upload validators** (`ParseFilePipe` + `MaxFileSizeValidator` + `FileTypeValidator`) added to 3 upload endpoints — correct MIME allowlist (`image/jpeg|png|gif|webp` for broadcast, `image/jpeg|png` for rich-menu).
- **ShopBotDefenseGuard + @Throttle** added to 5 public-facing shop controllers.
- **AbortSignal.timeout(10_000)** on all external LINE and Facebook API calls — prevents hanging requests.
- **`ShippingAddressDto` + 20-address cap** on `shop/me` — proper DTO validation and unbounded growth prevention.
- **`InitWidgetDto` with `@MaxLength(64)`** on web widget — prevents oversized visitor IDs.
- **Dashboard service groupBy refactor** correctly uses `Prisma.Decimal` for all financial arithmetic. Final `.toNumber()` conversions are for dashboard display (not ledger entries) and match prior code behavior.
- **3 compound indexes** (`workflowStatus+updatedAt`, `relatedId+subject+sentAt`, `status+firstResponseAt+createdAt`) — well-justified by comments referencing the specific crons they optimize.

No guard regressions detected. No new unguarded endpoints. No `Number()` on financial fields. No missing `deletedAt: null`.
