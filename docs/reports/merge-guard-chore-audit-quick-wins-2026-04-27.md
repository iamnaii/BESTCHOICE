# Pre-Merge Guard Report — chore/audit-quick-wins

**Date**: 2026-04-27  
**Branch**: `chore/audit-quick-wins`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main`

---

## File Changes Summary

```
13 files changed, 209 insertions(+), 44 deletions(-)
```

| File | Change |
|------|--------|
| `apps/api/src/modules/customers/customers.controller.ts` | Limit caps (Math.min) on 3 query-param limits |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | Replace N+1 findMany with groupBy + batched name lookups |
| `apps/api/src/modules/journal/journal.controller.ts` | Limit cap on pagination |
| `apps/api/src/modules/line-oa/broadcast.controller.ts` | ParseFilePipe validators (size + MIME) |
| `apps/api/src/modules/line-oa/line-oa.controller.ts` | ParseFilePipe validators on 2 upload endpoints |
| `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` | ShopBotDefenseGuard + @Throttle + AbortSignal timeouts |
| `apps/api/src/modules/shop-installment-apply/shop-installment-apply.controller.ts` | ShopBotDefenseGuard + @Throttle |
| `apps/api/src/modules/shop-me/shop-me.controller.ts` | Typed ShippingAddressDto body + MAX_SHIPPING_ADDRESSES cap |
| `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts` | ShopBotDefenseGuard + @Throttle |
| `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts` | ShopBotDefenseGuard + @Throttle |
| `apps/api/src/modules/staff-chat/web-widget.controller.ts` | InitWidgetDto with MaxLength + @Throttle on 2 endpoints |
| `apps/api/prisma/schema.prisma` | 3 compound performance indexes |
| `apps/api/prisma/migrations/*/migration.sql` | Migration for new indexes |

---

## Issues by Severity

### Critical
_None found._

### Warning
_None found._

### Info

- **`dashboard.service.ts`** — The refactored `getStaffMetrics` uses `Prisma.Decimal` arithmetic throughout accumulation, then calls `.toNumber()` at serialization. This is the standard acceptable pattern for presentation-only values (not persisted). No action needed, but noted.
- **Public shop controllers** (`shop-auth-social`, `shop-installment-apply`, `shop-reservation`, `shop-tracking`) — These lack `@UseGuards(JwtAuthGuard)` at the class level, which is pre-existing on `main` (not introduced by this branch). They are customer-facing endpoints. This branch correctly hardens them with `ShopBotDefenseGuard` + throttling. Consider adding these to the intentionally-public list in `.claude/rules/security.md`.

---

## Positive Findings

- All upload endpoints now validate file size and MIME type before processing (prevents upload abuse).
- Social auth and public submission endpoints now have throttle limits (5 req/min) to block credential stuffing.
- `AbortSignal.timeout(10_000)` added to all outbound LINE and Facebook API calls — prevents worker thread starvation.
- Dashboard N+1 query replaced with `groupBy` + 2 batched lookups — significantly reduces DB load on `/dashboard/staff-metrics` for large branches.
- Shipping address array now bounded at 20 entries, body now validated via typed DTO.
- Web widget `visitorId` now capped at MaxLength(64) — prevents oversized string injection.

---

## Recommendation

**✅ APPROVE**

All changes are pure hardening: throttling, input validation, file upload guards, query optimisation, and bot defense. No new controllers, no schema changes with data risk, no Decimal regressions. Safe to merge.
