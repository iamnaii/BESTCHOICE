# Merge Guard Report — chore/audit-quick-wins

**Date**: 2026-04-27  
**Branch**: `chore/audit-quick-wins`  
**Author**: Akenarin Kongdach  
**Commits vs main**: 2  
**Recommendation**: ⚠️ REVIEW (fix warnings before merge)

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/src/modules/customers/customers.controller.ts` | +9/-3 | Cap unbounded `limit` query params at 100 |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | +101/-40 | Rewrite `getSalesMetrics` using `groupBy` (N+1 fix) |
| `apps/api/src/modules/journal/journal.controller.ts` | +1/-1 | Cap `limit` at 100 |
| `apps/api/src/modules/line-oa/broadcast.controller.ts` | +13/-2 | File upload: size + MIME validation |
| `apps/api/src/modules/line-oa/line-oa.controller.ts` | +19/-2 | File upload: size + MIME validation on 2 endpoints |
| `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` | +9/-1 | `ShopBotDefenseGuard` + rate limits + `AbortSignal.timeout(10s)` |
| `apps/api/src/modules/shop-installment-apply/shop-installment-apply.controller.ts` | +4/-0 | `ShopBotDefenseGuard` + rate limit on `POST /submit` |
| `apps/api/src/modules/shop-me/shop-me.controller.ts` | +11/-2 | DTO validation + 20-address cap |
| `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts` | +5/-1 | `ShopBotDefenseGuard` + rate limit |
| `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts` | +5/-1 | `ShopBotDefenseGuard` + rate limit |
| `apps/api/src/modules/staff-chat/web-widget.controller.ts` | +13/-2 | Inline `InitWidgetDto` + rate limits |
| `apps/api/prisma/schema.prisma` | +7/-0 | (migration-related schema change) |

**Total**: 13 files, +209 insertions, -44 deletions

---

## Issues Found

### 🔴 Critical — 0

No critical issues. All new endpoints retain existing guards. Public-facing shop controllers use `ShopBotDefenseGuard` (appropriate — no JWT for customer-facing endpoints).

---

### 🟡 Warning — 3

**W1 — `dashboard.service.ts:672` — Floating-point precision loss in `totalSales` accumulation**

`totalSales` in the `Bucket` type is declared as `number`. Each iteration converts `Prisma.Decimal → number` via `.toNumber()` before re-wrapping as `Prisma.Decimal` for the next addition:

```typescript
existing.totalSales = new Prisma.Decimal(existing.totalSales)   // number → Decimal
  .add(new Prisma.Decimal(a._sum.sellingPrice ?? 0))
  .toNumber();                                                   // back to number
```

Every `.toNumber()` round-trip can lose sub-satang precision. For a dashboard display this is low risk, but it contradicts the project rule to keep financial arithmetic in `Prisma.Decimal` end-to-end. The type should be `Decimal` and only converted at the final sort/map step.

**W2 — `line-oa.controller.ts:576` — Type unsafety on optional file upload (`createWithImage`)**

`ParseFilePipe` is configured with `fileIsRequired: false`, making `file` nullable at runtime, but the TypeScript parameter type remains `Express.Multer.File` (non-nullable). If no file is uploaded, NestJS passes `undefined` and any downstream code accessing `file.buffer` or `file.originalname` will throw at runtime rather than fail at compile time.

Fix: change parameter type to `Express.Multer.File | undefined` and add a guard before use.

**W3 — `line-oa.controller.ts:554` — Dead null-check after ParseFilePipe on required upload**

`uploadRichMenuImage` adds `ParseFilePipe` without `fileIsRequired: false`, meaning NestJS will reject the request before the handler runs if no file is provided. The existing `if (!file) throw new BadRequestException(...)` inside the handler body is now unreachable dead code. Low risk, but it obscures intent and should be removed.

---

### 🔵 Info — 1

**I1 — `shop-me.controller.ts:17` — Cross-module DTO import**

`ShippingAddressDto` is imported from `../shop-checkout/dto/place-order.dto`. This creates a hidden coupling between `shop-me` and `shop-checkout` modules. If `place-order.dto` is refactored (fields renamed, moved), `shop-me` will break silently. Preferred pattern: extract `ShippingAddressDto` to a shared DTO file or define it locally in `shop-me`.

---

## Positive Notes

- `getSalesMetrics` refactor correctly eliminates a full `findMany` + deep `include` (which loaded every monthly contract row with salesperson + branch sub-objects). The new `groupBy` path returns O(salespeople × branches) rows — a significant DB load reduction.
- Rate limits on public shop endpoints (`5/min` on auth callbacks, `30/min` on tracking/reservation) are appropriately conservative.
- `AbortSignal.timeout(10_000)` added to all three external fetch calls in `shop-auth-social` — prevents hung requests.
- File type validation uses regex (`/^image\/(jpeg|png|gif|webp)$/`) to match MIME type reported by multipart parser — correct approach.
- `MAX_SHIPPING_ADDRESSES = 20` prevents unbounded JSON blob growth in the `shippingAddresses` jsonb column.

---

## Recommendation: ⚠️ REVIEW

Fix W1 (Decimal precision) and W2 (type safety on optional file) before merge. W3 and I1 can be addressed in a follow-up commit. No blockers that affect correctness for Critical paths, but W1 could affect financial totals in edge cases if `totalSales` grows very large (>Number.MAX_SAFE_INTEGER / 100).
