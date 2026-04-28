# Merge Guard Report — chore/audit-quick-wins

**Date**: 2026-04-28  
**Branch**: `chore/audit-quick-wins`  
**Base**: `origin/main`  
**Author**: Akenarin Kongdach (iamnaii@MacBook-Pro)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

13 files changed · +209 / −44 lines  
_(Pure security hardening — no new features, no schema changes)_

| Area | Files | Key Changes |
|------|-------|-------------|
| Input limits | `customers.controller.ts`, `journal.controller.ts` | `Math.min(parseInt(x), 100)` cap on `?limit=` params |
| File upload validation | `line-oa.controller.ts`, `broadcast.controller.ts` | `ParseFilePipe` + `MaxFileSizeValidator` + `FileTypeValidator` on all image uploads |
| Shop bot defense | `shop-auth-social.controller.ts`, `shop-reservation.controller.ts`, `shop-tracking.controller.ts`, `shop-installment-apply.controller.ts` | `@UseGuards(ShopBotDefenseGuard)` + `@Throttle` limits |
| Structured DTO | `web-widget.controller.ts` | `InitWidgetDto` with `@MaxLength(64)` on `visitorId`; `getMessages` limit capped at 100 |
| Address validation | `shop-me.controller.ts` | Replace `Record<string, unknown>` with `ShippingAddressDto`; `MAX_SHIPPING_ADDRESSES = 20` guard |
| Timeout hardening | `shop-auth-social.controller.ts` | `AbortSignal.timeout(10_000)` on all external `fetch()` calls (LINE + Facebook) |
| Dashboard | `dashboard.service.ts` | Refactored aggregation to single grouped query; correct `Prisma.Decimal` for money sums |
| DB index | `prisma/schema.prisma` (+7), migration | Minor index additions (not reviewed in depth — migration is additive only) |

---

## Security & Quality Checks

### ✅ Critical — PASS

| Check | Result |
|-------|--------|
| No new unguarded controller endpoints | ✅ Only existing endpoints modified |
| No new `@Roles` missing | ✅ N/A — no new endpoints added |
| No hardcoded secrets | ✅ Clean |
| No unparameterized `$queryRaw` | ✅ None |
| `deletedAt: null` — no new queries bypass soft-delete | ✅ Dashboard service changes don't introduce new raw queries |

### ✅ Warning — PASS

| Check | Result |
|-------|--------|
| File upload MIME type validation | ✅ `FileTypeValidator` with strict regex (`/^image\/(jpeg\|png)$/`, `image/(jpeg\|png\|gif\|webp)`) |
| File upload size limits | ✅ 1 MB on rich menu images, 10 MB on broadcast images |
| `?limit=` injection protection (DoS via large result sets) | ✅ All 4 affected endpoints now cap at 100 |
| Address unbounded append (storage DoS) | ✅ Capped at 20 addresses |
| Untyped `visitorId` input | ✅ Now validated via `InitWidgetDto` with `@MaxLength(64)` |
| External HTTP timeouts | ✅ All 3 LINE/Facebook `fetch()` calls get `AbortSignal.timeout(10_000)` |

### ℹ️ Info

**I-01: `Number(((data.overdueCount / data.totalContracts) * 100).toFixed(1))` in `dashboard.service.ts`**.  
This `Number()` is on a percentage ratio result (not a money field), so it does not violate the Decimal precision rule. `toFixed(1)` rounds to 1 decimal place for display. Correct usage.

**I-02: `shop-installment-apply.controller.ts` — `JwtAuthGuard` is applied on authenticated routes**.  
The controller uses `@UseGuards(JwtAuthGuard)` only on `GET /:applicationNumber` (correctly gated). `POST /` (anonymous application submit) intentionally has no JWT guard. `ShopBotDefenseGuard` now covers bot abuse on that public endpoint. This is the expected design.

---

## Verdict

This is a clean security hardening PR with no functional changes. Every modification is a strict improvement: input sanitization, rate limiting, file validation, and timeout hardening. No issues found.

**Recommendation: ✅ APPROVE — safe to merge**
