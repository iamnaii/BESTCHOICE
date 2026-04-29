# Pre-Merge Guard Report

**Branch**: `chore/audit-quick-wins`
**Author**: Akenarin Kongdach
**Date reviewed**: 2026-04-29
**Commits**:
- `b42b7bb9` perf(audit): dashboard staff metrics groupBy + 3 compound indexes (2026-04-26)
- `b00d5ac5` fix(security): throttle public endpoints + file upload validators (2026-04-26)

---

## File Changes Summary

| File | +Lines | -Lines | Category |
|------|--------|--------|----------|
| `apps/api/prisma/migrations/20260426131551_add_audit_compound_indexes/migration.sql` | +15 | 0 | DB |
| `apps/api/prisma/schema.prisma` | +7 | 0 | DB |
| `apps/api/src/modules/customers/customers.controller.ts` | +8 | -3 | API |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | +86 | -25 | API |
| `apps/api/src/modules/journal/journal.controller.ts` | +1 | -1 | API |
| `apps/api/src/modules/line-oa/broadcast.controller.ts` | +11 | -1 | API |
| `apps/api/src/modules/line-oa/line-oa.controller.ts` | +19 | -4 | API |
| `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` | +13 | -1 | API |
| `apps/api/src/modules/shop-installment-apply/shop-installment-apply.controller.ts` | +4 | 0 | API |
| `apps/api/src/modules/shop-me/shop-me.controller.ts` | +10 | -2 | API |
| `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts` | +5 | -1 | API |
| `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts` | +5 | -1 | API |
| `apps/api/src/modules/staff-chat/web-widget.controller.ts` | +15 | -2 | API |

**Total**: 13 files changed, +209 / −44

---

## Issues by Severity

### Critical — Must fix before merge

**None found.**

All new controllers and endpoints reviewed:
- Existing authenticated controllers (`line-oa`, `broadcast`, `journal`) retain `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)`.
- Public shop endpoints (`shop-auth`, `shop-installment-apply`, `shop-reservation`, `shop-tracking`, `web-widget`) are intentionally unauthenticated (customer-facing) and now correctly have `ShopBotDefenseGuard` + `@Throttle` added.
- No unparameterized `$queryRaw` found.
- No hardcoded secrets or API keys detected.
- No `deletedAt` queries added or modified; existing queries unchanged.

---

### Warning — Should fix

**W-001: Direct PrismaService access in `shop-me.controller.ts`**
- File: `apps/api/src/modules/shop-me/shop-me.controller.ts:17`
- The PR's change to `addAddress` (adding `MAX_SHIPPING_ADDRESSES` limit + `ShippingAddressDto` typing) is correct, but the controller continues to inject `PrismaService` directly and call `this.prisma.*` — violating the `controller → service → PrismaService` rule.
- Pre-existing pattern, but the PR touches this code, making it a fair moment to fix.
- **Suggested fix**: Extract `addAddress` logic into `ShopMeService`.

**W-002: `.toNumber()` on financial `_sum` field in `dashboard.service.ts`**
- File: `apps/api/src/modules/dashboard/dashboard.service.ts:680–702`
- `_sum.sellingPrice` is `Decimal | null`. The code wraps it in `new Prisma.Decimal(...)` for arithmetic (correct), but then calls `.toNumber()` to store in the `totalSales` response field. For very large contract values this will lose precision in the JSON response.
- This is a pre-existing `toNumber()` pattern that the PR preserves (old code used `new Prisma.Decimal(c.sellingPrice ?? 0).toNumber()`). Dashboard is read-only display — not stored — so risk is low. Still worth noting.
- **Suggested fix**: Return `totalSales` as `string` (Decimal serialized) and format on the frontend, or document that amounts are display-only.

---

### Info — Aware, no action required

**I-001: `InitWidgetDto` defined inline in controller file**
- File: `apps/api/src/modules/staff-chat/web-widget.controller.ts:12–19`
- New `InitWidgetDto` class is declared at the top of the controller file instead of in a `dto/` subdirectory (project convention).
- Low impact — the class is small, validation decorators are correct (`@IsOptional`, `@IsString`, `@MaxLength(64)`).
- **Suggested fix**: Move to `apps/api/src/modules/staff-chat/dto/init-widget.dto.ts`.

**I-002: `dashboard.service.ts` is 1,074 lines**
- File: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Well over the informal 500-line guidance. Not introduced by this PR; the PR adds ~60 net lines.
- **Suggested future work**: Split into `DashboardKpiService`, `DashboardStaffService`, `DashboardActivityService`.

**I-003: `shop-auth-social.controller.ts` uses raw `fetch()` for external HTTP calls**
- File: `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts:41–76`
- Pre-existing pattern. The PR adds `AbortSignal.timeout(10_000)` — good improvement. However, the calls remain inside the controller rather than a service, and use raw `fetch()` instead of `HttpModule`.
- Low risk for this PR scope.

---

## What the PR Does Well

- **Rate limiting on public shop endpoints** — `ShopBotDefenseGuard` + `@Throttle` added to `shop-auth`, `shop-installment-apply`, `shop-reservation`, `shop-tracking`, `web-widget` controllers. Closes an obvious DoS surface.
- **File upload validators** — `ParseFilePipe` + `MaxFileSizeValidator` + `FileTypeValidator` on `broadcast.controller.ts` (10MB limit, image/* types) and `line-oa.controller.ts` (1MB limit, jpeg/png only). Prevents oversized or malicious file uploads.
- **Pagination cap** — `Math.min(..., 100)` added to `customers.controller.ts` (referral stats, watch list, upsell candidates) and `journal.controller.ts`. Prevents unbounded result sets.
- **Shipping address cap** — `MAX_SHIPPING_ADDRESSES = 20` guard in `shop-me.controller.ts`. Prevents unbounded JSON growth in `shippingAddresses` column.
- **Dashboard N+1 → groupBy** — `dashboard.service.ts` replaces `findMany` + full monthly contract set with two `groupBy` queries + two batched lookup queries. Significant perf improvement at scale.
- **3 compound DB indexes** — `notification_logs`, `contracts`, `chat_rooms`. Targets hot cron paths. Migration uses `IF NOT EXISTS` (idempotent, safe).
- **AbortSignal.timeout(10_000)** on all three `fetch()` calls in `shop-auth-social.controller.ts`. Prevents hanging requests.

---

## Recommendation

**APPROVE**

This branch is a clean security + performance hardening PR with no critical issues. Two warnings exist (W-001, W-002) but both are pre-existing patterns that the PR does not worsen — W-001 is noted for a follow-up refactor and W-002 is acceptable for display-only data. The positive changes (throttling, file validation, pagination caps, compound indexes, N+1 fix) substantially outweigh the minor style issues.

Merge when CI is green.
