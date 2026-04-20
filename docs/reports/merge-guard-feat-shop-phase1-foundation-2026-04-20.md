# Merge Guard Report — feat/shop-phase1-foundation

**Date**: 2026-04-20
**Branch**: `feat/shop-phase1-foundation`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Compared against**: `origin/main`

---

## File Changes Summary

| Area | Files | +/- |
|------|-------|-----|
| Prisma schema + migration | 2 | +325 |
| Backend: shop-catalog module (4 files) | 4 | +304 |
| Backend: shop-auth-social module (5 files) | 5 | +275 |
| Backend: shop-bot-defense module (4 files) | 4 | +252 |
| Backend: shop-reservation module (5 files) | 5 | +228 |
| Backend: shop-tracking module (5 files) | 5 | +243 |
| Backend: shop-line-chat module (3 files) | 3 | +101 |
| Backend: app.module.ts + main.ts | 2 | +26 |
| Frontend: `apps/web-shop` (new Vite SPA) | 25+ | +800 |
| Config: `.env.example`, `vite.config.ts`, etc. | ~10 | +180 |
| `package-lock.json` | 1 | large |
| **Total** | **63** | **+46,137 / -16,753** |

> Note: ~60k lines of the diff are `package-lock.json` noise from adding the new `apps/web-shop` workspace.

---

## Issues

### Critical (2)

**C1 — `ShopReservationController` has NO guards (DoS vector)**
- File: `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts`
- Both `@Post()` (create reservation) and `@Delete(':id')` (cancel reservation) have zero guard protection.
- A unit reservation holds a product for 15 minutes, preventing real customers from purchasing. Any anonymous actor can flood `POST /api/shop/reservations` with fabricated `sessionId` values to lock out all available inventory at no cost.
- The cancel endpoint authenticates by matching `sessionId` in the request body against the DB record — but since `sessionId` is a `crypto.randomUUID()` stored in `localStorage` (client-generated, never server-verified), an attacker who knows their own reservation's ID can also probe cancel requests.
- **Required fix**: Apply `@UseGuards(ShopBotDefenseGuard)` to the controller. Additionally, add a per-IP + per-sessionId rate limit in `ShopBotDefenseService` specifically for reservation creation, and impose a per-session cap (e.g. max 3 active reservations per sessionId).

**C2 — `Number()` on Decimal money fields in `shop-catalog.service.ts`**
- File: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts`
- `const minPrice = Number(g._min?.costPrice ?? 0)` — `costPrice` is `Decimal @db.Decimal(12,2)`.
- `const price = Number(u.costPrice)` — same field.
- These values are fed into `calculateMonthlyPayment()` to compute installment amounts shown to customers. Floating-point arithmetic errors (e.g. 999.9999999999999 instead of 1000.00) will surface in customer-facing payment previews and break trust.
- Rule: database.md — "ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน".
- **Required fix**: Replace with `new Prisma.Decimal(g._min?.costPrice ?? 0)` and implement `calculateMonthlyPayment` using `Prisma.Decimal` arithmetic. The return type of `minPrice`/`price` in `ProductGroup`/`ProductUnit` should be `string` (call `.toFixed(2)`) for JSON serialization.

---

### Warning (3)

**W1 — `ShopTrackingController` has no guards**
- File: `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts`
- `POST /api/shop/track` is fully open with no bot protection. While analytics spam is lower-risk than reservation abuse, a coordinated flood of fake page-view events will inflate the `ShopVisit` table and pollute UTM attribution data.
- Recommended fix: Apply `@UseGuards(ShopBotDefenseGuard)`.

**W2 — Hardcoded production URL in `apps/web-shop/src/lib/api.ts`**
- `baseURL: import.meta.env.PROD ? 'https://bestchoicephone.app' : ''`
- Hardcoded domain couples the build to a specific production hostname. If the domain changes or a staging environment is needed, this must be remembered and updated.
- Recommended fix: Use `import.meta.env.VITE_API_BASE_URL` (already used in `apps/web/`) with a fallback to `''`.

**W3 — `ShopAuthSocialController` — no fetch timeout for LINE/Facebook API calls**
- File: `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts`
- `exchangeLineCode()` makes two sequential `fetch()` calls (token exchange + profile) without an `AbortController` timeout. If LINE's API hangs, the NestJS request thread is blocked indefinitely.
- Recommended fix: Use `fetch(..., { signal: AbortSignal.timeout(10_000) })` on both calls (consistent with the 15s PaySolutions timeout pattern from v3).

---

### Info (3)

**I1 — `apps/web-shop/src/pages/ProductDetailPage.tsx` is a stub (1 line)**
- The file exists but contains only a placeholder. The route is wired in `App.tsx` but renders nothing meaningful. This is presumably intentional for Phase 1 (catalog only), but should be noted in the PR description.

**I2 — `localStorage` for session ID is acceptable**
- `apps/web-shop/src/lib/session.ts` stores an analytics session UUID in `localStorage`. This is NOT a JWT token, so it does not violate the security rule ("Access token เก็บใน JS variable"). No issue.

**I3 — `apps/web-shop` access token is stored in-memory correctly**
- `apps/web-shop/src/lib/api.ts` uses a module-level `let accessToken: string | null = null` pattern, matching the main `apps/web` pattern. The 401 interceptor clears it on expiry. Correct.

---

## Recommendation

**BLOCK** 🚫

Two Critical issues must be resolved before merge:

1. **C1**: Add `@UseGuards(ShopBotDefenseGuard)` to `ShopReservationController` and enforce per-session reservation caps to prevent inventory lockout abuse.
2. **C2**: Replace `Number(costPrice)` with `Prisma.Decimal` in `shop-catalog.service.ts` to prevent floating-point errors in customer-facing payment calculations.

Fix W1 (tracking endpoint bot protection) and W3 (fetch timeouts) as well — they are low-effort and prevent real operational issues.
