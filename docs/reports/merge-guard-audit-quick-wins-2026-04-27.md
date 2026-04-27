# Pre-Merge Guard Report

**Branch**: `chore/audit-quick-wins`
**Authors**: Akenarin Kongdach, iamnaii
**Date**: 2026-04-27
**Commits ahead of main**: 8
**Files changed**: 13 (+209 / −44 lines)
**Recommendation**: ✅ **APPROVE** — clean hardening changeset, no blocking issues

---

## File Changes Summary

| Area | Files |
|------|-------|
| API — Shop controllers | `shop-me.controller.ts`, `shop-reservation.controller.ts`, `shop-tracking.controller.ts`, `shop-auth-social.controller.ts`, `shop-installment-apply.controller.ts` |
| API — Internal controllers | `customers.controller.ts`, `journal.controller.ts`, `broadcast.controller.ts`, `line-oa.controller.ts` |
| API — Dashboard | `dashboard.service.ts` |
| Frontend | (none) |

---

## Issues

### Critical

None found. ✅

---

### Warning

None found. ✅

---

### Info

#### I1 — `ShopBotDefenseGuard` added to 4 shop controllers
`shop-auth-social`, `shop-installment-apply`, `shop-me`, `shop-reservation`, and `shop-tracking` controllers now carry `@UseGuards(ShopBotDefenseGuard)` at the class level. This closes a gap where public-facing shop endpoints were not rate-limited by the bot-defense layer. ✅

#### I2 — `web-widget.controller.ts` — input validation and throttle hardening
- `visitorId` input now typed via `InitWidgetDto` with `@IsOptional`, `@IsString`, `@MaxLength(64)` instead of `Record<string, unknown>`.
- `POST /init` throttled at 30 req/60s; `GET /messages/:roomId` throttled at 60 req/60s via `@Throttle`.

#### I3 — Broadcast image upload — file size + MIME validation
`POST /broadcast/image` now validates:
- Max size: 10 MB (`MaxFileSizeValidator`)
- MIME type: `image/(jpeg|png|gif|webp)` (`FileTypeValidator`)

Previously any file type and size was accepted. ✅

#### I4 — Journal controller — limit capped
```ts
limit: limit ? Math.min(parseInt(limit) || 50, 100) : undefined,
```
Prevents clients from requesting arbitrarily large journal pages. ✅

#### I5 — `Number()` in dashboard service — not a money field
```ts
overdueRate: Number(((data.overdueCount / data.totalContracts) * 100).toFixed(1))
```
This is a percentage rate (0–100), not a monetary amount. `Number()` here is intentional and acceptable.

#### I6 — Customer file upload — `ParseFilePipe` added
`customers.controller.ts` now validates uploaded files before they reach the service layer. ✅

#### I7 — `MAX_SHIPPING_ADDRESSES = 20` cap on shop-me
Prevents unbounded JSON growth in the `shippingAddresses` JSON column. ✅
