# Merge Guard Report — chore/audit-quick-wins

**Date**: 2026-04-27  
**Branch**: `chore/audit-quick-wins`  
**Author**: Akenarin Kongdach  
**Commits**: 2  
**Diff**: 13 files changed, +209 / -44  
**Recommendation**: ✅ APPROVE

---

## Summary

Two security/performance hardening commits:

1. `perf(audit): dashboard staff metrics groupBy + 3 compound indexes` — replaces N+1
   `findMany` + JS reduce with Postgres `groupBy`, batched name lookups, and two parallel
   aggregate queries. Adds 3 compound DB indexes for dashboard.
2. `fix(security): throttle public endpoints + file upload validators` — adds
   `ShopBotDefenseGuard`, `@Throttle()`, `ParseFilePipe` with `MaxFileSizeValidator` /
   `FileTypeValidator`, shipping address cap (20), `AbortSignal.timeout(10_000)` on
   external OAuth fetches, and `limit` capping (`Math.min(..., 100)`) on 4 list endpoints.

---

## File Changes

| File | +/- | Notes |
|------|-----|-------|
| `customers.controller.ts` | +9/-3 | limit capped at 100 on 3 endpoints |
| `dashboard.service.ts` | +101/-40 | groupBy refactor + Decimal arithmetic preserved |
| `journal.controller.ts` | +1/-1 | limit capped at 100 |
| `broadcast.controller.ts` | +15/-0 | ParseFilePipe: 10 MB, image/* only |
| `line-oa.controller.ts` | +24/-0 | ParseFilePipe: 1 MB, jpeg/png only |
| `shop-auth-social.controller.ts` | +11/-0 | ShopBotDefenseGuard + Throttle + AbortSignal |
| `shop-installment-apply.controller.ts` | +4/-0 | ShopBotDefenseGuard + Throttle |
| `shop-me.controller.ts` | +15/-0 | address cap + ShippingAddressDto |
| `shop-reservation.controller.ts` | +6/-0 | ShopBotDefenseGuard + Throttle |
| `shop-tracking.controller.ts` | +6/-0 | ShopBotDefenseGuard + Throttle |
| `web-widget.controller.ts` | +13/-0 | InitWidgetDto @MaxLength(64) + Throttle |
| `schema.prisma` | +7/-0 | 3 new compound indexes |
| `migration.sql` | +15/-0 | corresponding index migration |

---

## Issues by Severity

### Critical
_None_

### Warning
_None_

### Info
- `dashboard.service.ts`: Aggregate sums converted via `Prisma.Decimal(...).toNumber()` at the
  final map step — correct usage (Decimal arithmetic preserved throughout, `.toNumber()` only
  at serialization boundary for the JSON response).

---

## Checklist

- [x] `@UseGuards(JwtAuthGuard, RolesGuard)` present on all modified controllers
- [x] `@Roles()` decorator on all modified endpoints
- [x] No `Number()` on Prisma `_sum` financial fields (uses `Prisma.Decimal` throughout)
- [x] No hardcoded secrets
- [x] No unparameterized `$queryRaw`
- [x] Soft-delete (`deletedAt: null`) unaffected — no new `findMany` without filter
- [x] DTOs have class-validator decorators (new `InitWidgetDto`, `ShippingAddressDto` reuse)
- [x] File upload validators added (not absent)
- [x] Migration provided for schema changes
