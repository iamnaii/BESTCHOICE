# Merge Guard Report — chore/audit-quick-wins

**Date**: 2026-04-26  
**Branch**: `chore/audit-quick-wins`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`

## File Changes Summary

13 files changed, 209 insertions(+), 44 deletions(-)

| File | Change |
|------|--------|
| `apps/api/src/modules/customers/customers.controller.ts` | `Math.min` cap on `limit` params |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | N+1 → `groupBy` refactor (staff metrics) |
| `apps/api/src/modules/journal/journal.controller.ts` | `Math.min` cap on `limit` param |
| `apps/api/src/modules/line-oa/broadcast.controller.ts` | `ParseFilePipe` + `MaxFileSizeValidator` + `FileTypeValidator` |
| `apps/api/src/modules/line-oa/line-oa.controller.ts` | Same file upload validators on 2 endpoints |
| `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` | `ShopBotDefenseGuard`, `@Throttle(5/min)`, `AbortSignal.timeout(10s)` |
| `apps/api/src/modules/shop-installment-apply/shop-installment-apply.controller.ts` | `ShopBotDefenseGuard`, `@Throttle(5/min)` |
| `apps/api/src/modules/shop-me/shop-me.controller.ts` | `ShippingAddressDto` validation + max 20 address cap |
| `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts` | `ShopBotDefenseGuard`, `@Throttle(30/min)` |
| `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts` | `ShopBotDefenseGuard`, `@Throttle(30/min)` |
| `apps/api/src/modules/staff-chat/web-widget.controller.ts` | `InitWidgetDto` + `@MaxLength(64)`, `@Throttle` |
| `apps/api/prisma/schema.prisma` | 3 compound indexes added |
| `apps/api/prisma/migrations/` | Migration for indexes |

## Issues

### Critical
_None_

### Warning
_None_

### Info

**dashboard.service.ts — Decimal `.toNumber()` in display aggregate**

In the refactored `staffMetrics` builder (line ~680), `existing.totalSales` is accumulated with:
```ts
existing.totalSales = new Prisma.Decimal(existing.totalSales)
  .add(new Prisma.Decimal(a._sum.sellingPrice ?? 0))
  .toNumber();
```
The intermediate arithmetic uses `Prisma.Decimal`, so precision is maintained during accumulation. The final `.toNumber()` is on a display-only aggregate (not persisted), which is acceptable. However, the declared type of `totalSales` in `Bucket` is `number`. This is a minor inconsistency with the project rule of always using `Prisma.Decimal` for money fields. No data loss risk here since it's read-only aggregation for UI display.

## Checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on new controllers | N/A — no new controllers, only existing ones modified |
| `@Roles()` on all methods | ✅ No new methods added |
| `Number()` on money fields | ✅ None (only Decimal arithmetic) |
| `deletedAt: null` in new queries | ✅ No new queries added |
| Hardcoded secrets | ✅ None |
| DTO validation decorators | ✅ `ShippingAddressDto` + `InitWidgetDto` have proper validators |
| Thai validation messages | ✅ `'ไฟล์มีขนาดเกิน 10MB'`, `'บันทึกที่อยู่จัดส่งได้สูงสุด 20 รายการ'` |
| File upload validation | ✅ `MaxFileSizeValidator` + `FileTypeValidator` added |
| Throttling on public endpoints | ✅ All shop-* and chat-widget endpoints now throttled |
| SQL injection | ✅ No `$queryRaw` added |

## Recommendation

**✅ APPROVE**

All changes are pure security hardening and performance improvements — no regressions detected. Safe to merge.
