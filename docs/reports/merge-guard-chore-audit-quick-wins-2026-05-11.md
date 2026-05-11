# Merge Guard Report — `chore/audit-quick-wins`

**Date**: 2026-05-11  
**Branch**: `chore/audit-quick-wins`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-04-26 (`b00d5ac5`)  
**Recommendation**: ⚠️ REVIEW — fix Warnings before merge

---

## File Changes Summary

| Commit | Description |
|--------|-------------|
| `b00d5ac5` | fix(security): throttle public endpoints + file upload validators |
| `b42b7bb9` | perf(audit): dashboard staff metrics groupBy + 3 compound indexes |
| `9922aca3` | feat(collections): guided session workflow + simplifications |
| `84f6e7e7` | feat(collections): remove Customer 360 hover-snapshot popup |
| `e1cb4266` | fix(yeastar): add @Inject(EventsGateway) to resolve union-type DI token |

**TypeScript files modified (top-level commits b00d5ac5..9922aca3)**:

- `apps/api/src/modules/customers/customers.controller.ts`
- `apps/api/src/modules/journal/journal.controller.ts`
- `apps/api/src/modules/line-oa/broadcast.controller.ts`
- `apps/api/src/modules/line-oa/line-oa.controller.ts`
- `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts`
- `apps/api/src/modules/shop-installment-apply/shop-installment-apply.controller.ts`
- `apps/api/src/modules/shop-me/shop-me.controller.ts`
- `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts`
- `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts`
- `apps/api/src/modules/staff-chat/web-widget.controller.ts`
- `apps/api/src/modules/dashboard/dashboard.service.ts`
- `apps/api/src/modules/collections-session/` (new module — 9 files)

---

## Issues by Severity

### Critical
_None found._

### Warning

**W1 — `shop-me.controller.ts` calls PrismaService directly**  
File: `apps/api/src/modules/shop-me/shop-me.controller.ts`  
The controller injects and calls `PrismaService` directly (`this.prisma.customer.findUnique`, `this.prisma.customer.update`), bypassing the service layer. Backend rule: "ห้ามเรียก PrismaService จาก controller โดยตรง — ต้องผ่าน service เสมอ".  
Fix: Move address logic into a `ShopMeService` and inject that instead.

**W2 — `startSession()` missing `deletedAt: null` in `updateMany`**  
File: `apps/api/src/modules/collections-session/collections-session.service.ts`  
```typescript
async startSession(userId: string) {
  await this.prisma.dailyAssignment.updateMany({
    where: { date: today, collectorId: userId, status: 'PENDING', startedAt: null },
    // ❌ missing: deletedAt: null
    data: { startedAt: new Date() },
  });
}
```
Could accidentally update soft-deleted assignment rows. All other queries in this file correctly include `deletedAt: null`.  
Fix: Add `deletedAt: null` to the `where` clause.

**W3 — `pool.service.ts` re-read after claim missing `deletedAt: null`**  
File: `apps/api/src/modules/collections-session/pool.service.ts` (line ~62)  
After `updateMany` (which correctly filters `deletedAt: null`), the subsequent `findUnique` to return the updated row does not include `deletedAt: null`. Risk is low (row was just confirmed non-deleted), but is inconsistent with the codebase convention.  
Fix: Change to `findFirst({ where: { id: assignmentId, deletedAt: null } })`.

**W4 — `dashboard.service.ts` uses `.toNumber()` on `sellingPrice` Decimal**  
File: `apps/api/src/modules/dashboard/dashboard.service.ts`  
```typescript
const sellingSum = new Prisma.Decimal(a._sum.sellingPrice ?? 0).toNumber();
```
Converts a Decimal to JS `number` for the `totalSales` staff metric. This is display-only (not persisted to DB), but violates the "ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน" principle and can silently lose precision for large sums.  
Fix: Keep `totalSales` as `Prisma.Decimal` through the bucket accumulation, serialize to string at the response boundary.

### Info

**I1 — `line-oa.controller.ts` `createWithImage()` uses `@Body() body: any`**  
File: `apps/api/src/modules/line-oa/line-oa.controller.ts`  
Pre-existing issue (not introduced by this branch), but the surrounding code was touched. The `body` parameter lacks a typed DTO, meaning no class-validator validation runs on the rich-menu body fields.  
Action: Create a `CreateRichMenuDto` — low priority as it's OWNER-only.

---

## Positive Changes (approve in spirit)

- **Throttle hardening** on 6 public shop endpoints (`shop/applications`, `shop/auth/{line,facebook,bind-phone}/callback`, `shop/reservations`, `widget/init`, `widget/messages/:roomId`) — good DDoS/abuse mitigation.
- **File upload validators** (`MaxFileSizeValidator` + `FileTypeValidator`) on broadcast image upload (10MB, image/*) and LINE rich-menu (1MB, image/jpeg|png).
- **`parseInt(limit)` upper-bounds** (capped at 100) on 3 customer list endpoints and journal list endpoint — prevents unbounded DB scans.
- **`InitWidgetDto`** replaces raw `{ visitorId?: string }` on widget init — proper class-validator DTO.
- **New `collections-session` module** has correct `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and `@Roles()` on every method.
- **3 compound DB indexes** added idempotently (`IF NOT EXISTS`) on `NotificationLog`, `Contract`, `ChatRoom`.

---

## Recommendation

**⚠️ REVIEW** — No Critical blockers. Merge can proceed after fixing W1 (PrismaService in controller) and W2 (missing `deletedAt: null`). W3 and W4 are low-risk and can be follow-up tickets.
