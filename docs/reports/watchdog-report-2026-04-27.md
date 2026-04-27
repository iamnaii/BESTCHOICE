# CTO Watchdog Report — 2026-04-27

## Summary
11/15 checks passed — 1 FAIL (A3 Decimal), 3 WARN (A2 Security, A4 Soft-Delete, A5 Tests)

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TypeScript | **PASS** | 0 errors in both `apps/api` and `apps/web` |
| A2 Security | **WARN** | 14 controllers without `JwtAuthGuard` beyond documented exceptions — see below |
| A3 Decimal | **FAIL** | 30+ `Number()` calls on money fields across 8 services — see below |
| A4 Soft-Delete | **WARN** | Several `findUnique`/`findFirst` missing `deletedAt: null` on soft-deletable models |
| A5 Tests | **WARN** | API: 2118 tests, 1 failed (seed/DB); Web: 218 tests, 6 failed (2 network, 4 UI) |
| A6 Bundle | **PASS** | Largest gzip: excel 256KB, PaymentsPage 243KB, pdf 139KB — all under 500KB gzip |

### A2 Security — Detail

**localStorage in `apps/web/src/lib/api.ts:10`**: Intentional E2E test bridge — token is read once and immediately removed. Safe, but worth noting in CLAUDE.md exceptions list.

**Controllers missing `JwtAuthGuard`** (beyond the 5 documented public exceptions):

| Controller | Guard Used | Verdict |
|-----------|-----------|---------|
| `line-oa/line-login.controller.ts` | None | Needs review — login flow, possibly intentionally public |
| `line-oa/line-oa-chatbot.controller.ts` | None | Webhook receiver — review if webhook-auth guard exists |
| `metrics/metrics.controller.ts` | `@Public()` decorator | OK — Prometheus scrape endpoint |
| `shop-buyback/shop-buyback.controller.ts` | `ShopBotDefenseGuard` | Bot defense only, no auth — needs review |
| `line-oa/liff-api.controller.ts` | `LiffTokenGuard` | OK — LIFF-token protected |
| `shop-auth-social/shop-auth-social.controller.ts` | None | Social login flow — likely intentionally public |
| `shop-catalog/shop-catalog.controller.ts` | None | Public product catalog — review if sensitive data is exposed |
| `shop-cart/shop-cart.controller.ts` | None | Cart operations — needs session/auth review |
| `shop-line-chat/shop-line-chat.controller.ts` | None | LINE webhook — verify HMAC validation exists |
| `shop-public-config/shop-public-config.controller.ts` | None | Documented exception (GA4/FB Pixel IDs) |
| `shop-tracking/shop-tracking.controller.ts` | None | Analytics events — review PII exposure |
| `shop-shipping/shop-shipping.controller.ts` | None | Shipping rates — review if public is intentional |
| `staff-chat/web-widget.controller.ts` | None | Widget endpoint — review customer data isolation |
| `shop-reservation/shop-reservation.controller.ts` | None | Reservations — review if unauthenticated write is safe |

**Action**: Audit each shop-* controller. Update `security.md` with any intentionally public endpoints. Add `JwtAuthGuard` to controllers that handle writes or expose PII without alternative auth.

### A3 Decimal — Detail

`Number()` wrapping Prisma `Decimal` fields loses precision for amounts >15 significant digits. Affected files:

| File | Instances | Risk |
|------|-----------|------|
| `chatbot-finance/services/finance-tools.service.ts:53,54,108` | 3 | Medium — displayed amounts |
| `line-oa/chatbot.service.ts:150,159,171,198,214` | 5 | Medium — customer-facing amounts |
| `staff-chat/services/chat-commerce.service.ts:106,108,194,229` | 4 | Medium — e-commerce pricing |
| `sales/sales.service.ts:286,579` | 2 | High — COGS calculation |
| `customers/customers.service.ts:768,870,1049` | 3 | Medium — outstanding totals |
| `asset/asset.service.ts:173,214,340` | 3 | Medium — depreciation |
| `stickers/stickers.service.ts:67,68` | 2 | Low — print labels |
| `shop-catalog/shop-catalog.service.ts:93,134` | 2 | Low — price ranges |
| `line-oa/line-oa-payment.controller.ts:125,126,507` | 3 | Medium — payment filters |
| `shop-orders/online-order-sale.adapter.ts:52` | 1 | High — order amount |
| `defect-exchange/defect-exchange.service.ts:183` | 1 | Low — status check |

**Fix pattern**: Replace `Number(x)` with `new Prisma.Decimal(x).toNumber()` for display, or keep as `Prisma.Decimal` for arithmetic.

### A4 Soft-Delete — Detail

Models with `deletedAt` field that have queries missing the filter:

| File | Query | Issue |
|------|-------|-------|
| `shop-reservation/shop-reservation.service.ts:17` | `Product.findUnique` | Missing `deletedAt: null` |
| `sales/sales.service.ts:478` | `Product.findUnique` | Missing `deletedAt: null` |
| `shop-installment-apply.service.ts:26` | `Product.findUnique` | Missing `deletedAt: null` |
| `users/users.service.ts:126` | `User.findUnique` | Missing `deletedAt: null` |
| `pdpa/pdpa.service.ts:56,135` | `Customer.findUnique` | Missing `deletedAt: null` |
| `defect-exchange/defect-exchange.service.ts:138` | `Product.findUnique` | Missing `deletedAt: null` |

Note: Many other `findUnique` calls without `deletedAt` are on non-soft-delete models (AiSettings singleton, IpRateLimit, SystemConfig, ChartOfAccount, ProcessedWebhookEvent) — these are acceptable.

### A5 Tests — Detail

**API** (run from `apps/api`):
- Test Suites: 1 failed, 179 passed, 180 total
- Tests: 1 failed, 2117 passed, 2118 total
- Failing: `overdue/__tests__/collections-foundation.seed.spec.ts` — Prisma error creating seed data (requires live DB, not a real unit test regression)
- **Baseline delta**: 577 → 2118 tests (+1541, significant expansion)

**Web** (run from root via vitest):
- Test Files: 2 failed, 22 passed (24 total)
- Tests: 6 failed, 212 passed (218 total)
- Failing:
  - `AuthContext.test.tsx` (2 tests) — `ECONNREFUSED 127.0.0.1:3000` (API not running in test env, not a code regression)
  - `CollectionsPage/ContactLogDialog.test.tsx` (4 tests) — React rendering failure, needs investigation
- **Baseline delta**: 129 → 218 tests (+89)

**Action**: Fix `ContactLogDialog.test.tsx` — 4 failing render tests need investigation.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | Float used only for non-money fields (GPS coords, ML confidence scores); 430 indexes; timestamps follow exception patterns |
| B2 Migrations | **PASS** | 183 migrations, descriptive names; DROP ops use `IF EXISTS`; ALTER TYPE is additive-only |
| B3 Indexes | **PASS** | 430 `@@index`/`@@unique` entries; FK and status fields well-covered |
| B4 Schema Drift | **PASS** | Latest 4 migrations (chat delivery status, callerid, daily_assignment) align with schema |

### B1 Schema — Notes

- **Float fields present** (non-money, acceptable):
  - `gpsLatitude`/`gpsLongitude` — location coordinates
  - `confidence`, `quality` — ML model scores
  - `salesBotConfidenceThreshold`, `serviceBotConfidenceThreshold` — config thresholds
- **Model count**: 138 models; `updatedAt` appears 116 times, `deletedAt` 142 times — delta is accounted for by documented exception models (AuditLog, tokens, ProcessedWebhookEvent, ChatMessage, etc.)

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | `claude-sonnet-4-6`, `MAX_TOOL_ITERATIONS=5`, Sentry imported, `maxTokens=1024` |
| C2 Prompt | **OK** | Bank, phone, hours match `finance-rules.ts`; no contradictions; ~850 tokens estimated |
| C3 Tools | **OK** | 7 tools defined, all have Thai descriptions, tool-executor covers all 7 cases |
| C4 Auto-Trigger | **OK** | ChatAutoTrigger idempotency guard; T-5,T-3,T-1,T,T+1,T+3 all wired; Sentry on both crons |
| C5 Security | **OK** | LIFF: `LiffTokenGuard`; Admin: `JwtAuthGuard+RolesGuard`; `customerId` injected server-side; webhook dedup via `ProcessedWebhookEvent` |

### C2 Prompt Consistency Check

`system-prompt.ts` vs `finance-rules.ts`:
- Bank: `ธนาคารกสิกรไทย 203-1-16520-5 บจก. เบสท์ช้อยส์โฟน` ✅ Match
- Late fee: `50 บาท/วัน` ✅ Match (`LATE_FEE_PER_DAY = 50`)
- Phone: `063-134-6356` ✅ Match (`FINANCE_CONTACT_PHONE`)
- Hours: `จันทร์-เสาร์ 09:00-18:00` ✅ Match (`BUSINESS_HOURS`)

Note: System prompt is hardcoded — `Phase E` comment indicates planned migration to `ChatKnowledgeBase` table for admin editing. When that migration happens, the constants in `finance-rules.ts` must remain as the single source of truth for automated services (auto-trigger templates, slip-processing).

---

## Action Items

### P0 — Fix Immediately

1. **A3: Decimal violations in financial calculations** — `sales.service.ts:286,579` and `shop-orders/online-order-sale.adapter.ts:52` handle COGS/order amounts that flow into journal entries. Replace `Number()` with `Prisma.Decimal` arithmetic to prevent rounding errors on large amounts.

### P1 — Fix This Sprint

2. **A2: Audit 14 unguarded shop-* controllers** — Specifically `shop-buyback`, `shop-cart`, `shop-line-chat`, `web-widget`, and `shop-reservation` need auth review. Controllers handling writes without any auth guard are potential security gaps. Add them to `security.md` if intentionally public, or add guards.

3. **A4: Add `deletedAt: null` to Product/Customer/User findUnique calls** — `sales.service.ts`, `shop-reservation.service.ts`, `pdpa.service.ts`, `shop-installment-apply.service.ts`, `defect-exchange.service.ts`. Soft-deleted records can be fetched and used in business logic.

4. **A5: Fix ContactLogDialog.test.tsx** — 4 failing render tests. Investigate rendering issue (likely a missing mock or component dependency change).

### P2 — Housekeeping

5. **A2: Document `api.ts` E2E localStorage pattern** in `security.md` as an acknowledged exception to prevent future confusion during security reviews.

6. **A3: Fix remaining ~25 `Number()` instances** in display/formatting services (chatbot, line-oa, stickers, asset) — lower risk but should be addressed for consistency with v4 Decimal precision work.

7. **A5: Mark `collections-foundation.seed.spec.ts`** as requiring DB or add `.skip` with comment — currently causes 1 suite failure on every CI run without DB access.
