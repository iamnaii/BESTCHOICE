# Merge Guard Report — feat/shop-phase1-foundation

**Date**: 2026-04-20  
**Branch**: `feat/shop-phase1-foundation`  
**Author**: Akenarin Kongdach  
**Latest commit**: `4bf212b` — fix(merge): resolve schema.prisma conflict — combine Phase 1 + KnownDevice models  
**Recommendation**: 🚫 BLOCK — Critical issues must be fixed before merge

---

## File Changes Summary

63 files changed (+46,137 / -16,753) — majority is `package-lock.json` from new `apps/web-shop` workspace.

Key new files:
| Module | File | Purpose |
|--------|------|---------|
| `shop-catalog` | `shop-catalog.controller.ts` | Public product listing + detail |
| `shop-catalog` | `shop-catalog.service.ts` | Grouped product queries |
| `shop-auth-social` | `shop-auth-social.controller.ts` | LINE + Facebook OAuth login |
| `shop-auth-social` | `shop-auth-social.service.ts` | OAuth token exchange + phone binding |
| `shop-reservation` | `shop-reservation.controller.ts` | 15-min product reservation |
| `shop-reservation` | `shop-reservation.service.ts` | Reserve/cancel logic |
| `shop-tracking` | `shop-tracking.controller.ts` | Visitor analytics |
| `shop-line-chat` | `shop-line-chat.controller.ts` | Contact form → LINE notification |
| `apps/web-shop/` | New Vite SPA | Online shop frontend |
| `apps/api/src/main.ts` | CORS additions | Allow shop.bestchoicephone.app |

---

## Issues by Severity

### 🚨 Critical (must fix before merge)

**C-001 — Internal cost price exposed to anonymous public users**  
File: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`  

The `ShopCatalogService` uses `costPrice` (the inventory purchase price the shop paid) as the public-facing product price:

```ts
// In listGroupedByModel:
_min: { costPrice: true },
...
const minPrice = Number(g._min?.costPrice ?? 0);

// In getProductDetail — ProductUnit interface:
export interface ProductUnit {
  costPrice: number;  // ← returned to unauthenticated shop visitors
}
...
const price = Number(u.costPrice);
```

The `Product` model has only `costPrice` — there is no `sellingPrice` field on `Product`. The shop should not display the internal purchase cost to customers. This exposes confidential procurement costs to the public.

**Fix**: Add a `sellingPrice` field to the `Product` model (or a separate `onlinePrice` field). Use that for the shop catalog. This requires a Prisma migration before this branch can merge. Alternatively, derive the display price from a pricing template or formula — never expose `costPrice` directly.

---

**C-002 — `Number()` on Decimal money fields**  
File: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`, lines 84 and 119  

```ts
const minPrice = Number(g._min?.costPrice ?? 0);  // line 84
const price = Number(u.costPrice);                 // line 119
```

`costPrice` is `Decimal @db.Decimal(12, 2)` in the schema. Converting with `Number()` at the **service layer** (not just at the JSON boundary) violates the Decimal money rule. Subsequent arithmetic (e.g., `calculateMonthlyPayment(minPrice, ...)`) operates on a potentially imprecise float.

**Fix**: Use `Prisma.Decimal` throughout. Convert to number only at the response serialization step:
```ts
import { Prisma } from '@prisma/client';
const minPrice = new Prisma.Decimal(g._min?.costPrice ?? 0);
const monthly = this.calculateMonthlyPayment(minPrice, DEFAULT_MONTHS, DEFAULT_DOWN_PCT);
// Return as number only in the response object:
return { ..., minPrice: minPrice.toNumber(), monthlyPaymentFrom: monthly.toNumber() };
```
Update `calculateMonthlyPayment` to accept and return `Prisma.Decimal`.

---

**C-003 — `ShopReservationController` has no guard and no rate limiting**  
File: `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts`

```ts
@Controller('shop/reservations')
export class ShopReservationController {
  @Post()
  async create(@Body() dto: CreateReservationDto) { ... }
  @Delete(':id')
  async cancel(@Param('id') id: string, @Body('sessionId') sessionId: string) { ... }
}
```

Anyone can POST to `/api/shop/reservations` with arbitrary `productId` values to lock every product in the catalog for 15 minutes, effectively performing an inventory DoS attack. There is no rate limiting beyond the global 200 req/sec ThrottlerGuard.

**Fix**: Apply `ShopBotDefenseGuard` (already used by `ShopCatalogController` and `ShopLineChatController`) to this controller. Also add per-session reservation limits in the service (e.g., max 3 active reservations per `sessionId`).

---

**C-004 — `ShopAuthSocialController` not in the security whitelist and missing CSRF protection**  
File: `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts`

The controller has no `@UseGuards()` decorator. While social login endpoints must be public (unauthenticated users call them), this pattern bypasses all guards including `CsrfGuard`. The security rules require that any intentionally unguarded controller be explicitly listed in `security.md`.

Additionally, the LINE OAuth code exchange does not validate a `state` parameter, making it vulnerable to CSRF:
```ts
@Post('line/callback')
async lineCallback(@Body() dto: LineLoginCallbackDto) {
  const profile = await this.exchangeLineCode(dto.code);
  // No state/nonce validation
```

**Fix**:
1. Add `ShopAuthSocialController` to the intentionally public list in `.claude/rules/security.md`.
2. Implement `state` parameter validation (store nonce in Redis/session, verify on callback).
3. Apply `ShopBotDefenseGuard` to rate-limit auth attempts.

---

### ⚠️ Warning (should fix)

**W-001 — `const where: any = {` in ShopCatalogService**  
File: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`, line 62  

```ts
const where: any = {
  deletedAt: null,
  isOnlineVisible: true,
  status: 'IN_STOCK',
};
```

Using `any` loses TypeScript safety. If a field is renamed or removed from the `Product` model, this will silently break.  
**Fix**: Use `Prisma.ProductWhereInput` as the type.

**W-002 — IMEI partial digits exposed in public product detail endpoint**  
File: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`, line 121  

```ts
const imeiPartial = u.imeiSerial ? `••••••••••${u.imeiSerial.slice(-4)}` : undefined;
```

Even 4 digits of an IMEI, combined with brand/model/color, narrows the device identity significantly. The `ProductUnit.imeiPartial` is returned from an unauthenticated endpoint. Consider whether customers actually need partial IMEI before purchase — if not, omit it.

**W-003 — Missing Thai validation messages on social login DTOs**  
File: `apps/api/src/modules/shop-auth-social/dto/social-login.dto.ts`

```ts
export class LineLoginCallbackDto {
  @IsString()
  code!: string; // No message: '...' in Thai
}
```
Per `.claude/rules/backend.md`, all DTO validation messages must be in Thai. The `@IsString()` decorators have no message options.  
**Fix**: Add `{ message: 'กรุณาระบุ LINE code' }` etc.

---

### ℹ️ Info

**I-001 — `ShopTrackingController` intentionally public (no guard)**  
File: `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts`  
This is a visitor analytics endpoint analogous to an analytics pixel — intentionally unauthenticated. Should be added to the security whitelist in `security.md` for clarity.

**I-002 — CORS allowlist extended in `main.ts`**  
`https://shop.bestchoicephone.app` and `http://localhost:5174` added to CORS origins. This is correct for the new shop app. No issue.

**I-003 — `INTEREST_RATE_PER_MONTH` hardcoded in service**  
```ts
const INTEREST_RATE_PER_MONTH = 0.0099; // 0.99%/month — example, adjust per pricing config
```
The comment says "example, adjust per pricing config". This should come from the `InterestConfig` model rather than be hardcoded, otherwise the monthly payment estimate shown to customers will diverge from actual contract rates.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `ShopCatalogController` has guard | ✅ `@UseGuards(ShopBotDefenseGuard)` |
| `ShopLineChatController` has guard | ✅ `@UseGuards(ShopBotDefenseGuard)` |
| `ShopAuthSocialController` has guard | ❌ No guard — not in security whitelist |
| `ShopReservationController` has guard/rate limit | ❌ No guard — DoS risk |
| `ShopTrackingController` — intentionally public | ⚠️ Intentional but not in whitelist |
| Money fields use `Prisma.Decimal` | ❌ `Number()` used in service layer |
| `costPrice` exposed to public | ❌ Internal cost price in public API |
| `deletedAt: null` in new queries | ✅ Present in all visible queries |
| No hardcoded secrets | ✅ (env vars used) |
| LINE OAuth CSRF protection | ❌ No `state` parameter validation |

---

## Recommendation

**🚫 BLOCK** — Four critical issues must be resolved before this branch can merge:

1. **C-001** — Do not expose `costPrice` publicly. Add `onlinePrice`/`sellingPrice` to `Product` model.
2. **C-002** — Replace `Number()` with `Prisma.Decimal` in service-layer money arithmetic.
3. **C-003** — Add `ShopBotDefenseGuard` + per-session reservation cap to `ShopReservationController`.
4. **C-004** — Add OAuth `state` CSRF validation to LINE/Facebook login; add to security whitelist.
