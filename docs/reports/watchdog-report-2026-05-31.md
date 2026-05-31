# CTO Watchdog Report — 2026-05-31

## Summary
11/15 checks passed. 4 issues need attention: API TypeScript errors (new PrismaFinanceService), test regressions (144 tests failing due to missing DATABASE_URL in CI environment), large bundle chunks, and soft-delete gaps on ~32 models.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors in `prisma-finance.service.ts` + `health.controller.ts` (missing `@prisma/client-finance` module — new service not yet fully wired). Web: 0 errors. |
| A2 Security | **WARN** | 6 controllers missing `@UseGuards` — 5 are justifiable public webhooks, 1 is borderline (see details below). `localStorage` usage is E2E-only (acceptable). No raw SQL without parameters. No hardcoded secrets found. |
| A3 Decimal | **WARN** | 30+ `Number(` calls on money fields found across 12 files (shop-catalog, sales, chatbot-finance, line-oa, notifications, receipts, staff-chat). Most are display/formatting only, but `sales.service.ts:291/597` and `shop-cart.service.ts:39` do arithmetic with costPrice — precision risk. |
| A4 Soft-Delete | **WARN** | Several services (inter-company, stickers, chat-related) have `findMany`/`findFirst` without `deletedAt: null`. Models without `deletedAt` include soft-delete-worthy entities: `Customer`, `FixedAsset`, `CompanyInfo`, `Promotion`, `DunningRule`. |
| A5 Tests | **FAIL** | API: 3,758 passing / 144 failing / 14 suites failed. All failures are `PrismaClientInitializationError: DATABASE_URL not found` — environment issue in test runner, not code bugs. Suites affected: asset (4), other-income (3), depreciation, overdue seed, collections E2E. Baseline was 577 API tests; 3,758 passing indicates substantial test growth. Web: vitest still running (background). |
| A6 Bundle | **WARN** | 6 chunks exceed 500KB gzipped: `excel` (256KB gz), `LettersPage` (220KB gz), `ContractTemplatesPage` (145KB gz), `pdf` (139KB gz), `charts` (120KB gz), `thai-address-data` (69KB gz). `thai-address-data` at 870KB raw is largest. |

### A2 Security — Controller Guard Detail

| Controller | Status | Justification |
|---|---|---|
| `metrics.controller.ts` | OK (public by design) | Prometheus scrape endpoint — gated by `X-Metrics-Token` shared secret, `timingSafeEqual` comparison |
| `web-widget.controller.ts` | **WARN** | Anonymous web widget chat — no JWT, but also no auth at all. Should document explicitly as public or add rate limiting per-IP |
| `line-login.controller.ts` | OK | LINE OAuth redirect flow — must be public for LINE callback |
| `yeastar-webhook.controller.ts` | OK | HMAC-verified webhook from Yeastar PBX system |
| `facebook-webhook.controller.ts` | OK | Facebook webhook — verified via signature check |
| `shop-public-config.controller.ts` | OK | Listed in `security.md` as intentionally public |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 184 models. UUID IDs on all models ✓. Money fields: all HP/contract amounts use `@db.Decimal(12,2)` ✓. Float fields found on 9 lines — all are GPS/confidence/threshold fields (non-monetary) ✓. Enums: PascalCase names ✓, SCREAMING_SNAKE_CASE values ✓. **32 models missing `deletedAt`** where soft-delete would be expected (Customer, FixedAsset, CompanyInfo, Promotion, DunningRule, PayrollCustomIncome, Todo, etc.). |
| B2 Migrations | **PASS** | 270 migrations. Latest: `20260964000000_add_daily_depr_to_fixed_assets` (descriptive ✓). `ALTER TYPE` usage found but all are additive (`ADD VALUE IF NOT EXISTS`) — safe. One `RENAME VALUE` (LEGAL→TERMINATED) is documented and atomic. `DROP COLUMN` in older migrations is `IF EXISTS` — safe. No destructive DROP TABLE found. |
| B3 Indexes | **PASS** | 487 index declarations across schema. FK fields appear well-indexed based on count relative to 184 models. No obvious high-traffic FK without index spotted. |
| B4 Drift | **PASS** | Latest migration (`20260964000000`) adds `daily_depr` column to `fixed_assets` — consistent with Phase A.5 depreciation work visible in codebase. No obvious mismatch between recent migrations and schema. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✓ (current). `MAX_TOOL_ITERATIONS = 5` guard ✓. Sentry captures on: max iterations warning, Claude API exception ✓. `maxTokens = 1024` ✓. Prompt cache 5-min TTL with DB fallback ✓. |
| C2 Prompt | **OK** | System prompt references correct: bank account `203-1-16520-5 KBank` ✓, phone `063-134-6356` ✓, business hours Mon-Sat 09:00-18:00 ✓. `finance-rules.ts` constants match prompt values exactly ✓. Prompt is ~60 lines — reasonable token estimate ~800 tokens. No contradictions found. |
| C3 Tools | **OK** | 6 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base` + `handoff_to_human`. All have Thai descriptions ✓. `tool-executor.ts` handles all 7 tool names via switch/case ✓. `customerId` injected by orchestrator, not Claude ✓ (security isolation enforced). |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` table check before send ✓. All 6 trigger types covered: T-5, T-3, T-1, T, T+1, T+3 ✓. Cron at 09:00 (reminders) + 10:00 (escalations) BKK ✓. Sentry capture on both cron error paths ✓. |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard` (LINE token verification, not JWT) ✓. Admin controller has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓. Webhook dedup via DB unique constraint on `eventId` — safe for multi-instance Cloud Run ✓. Customer data isolation enforced in tool-executor (customerId from session context, not AI input) ✓. |

---

## Action Items

### P0 — Fix Before Next Deploy

1. **[A1] `prisma-finance.service.ts` TS errors** — 7 TypeScript errors in new `PrismaFinanceService`. Module `@prisma/client-finance` not found. Health controller passes wrong type. This file cannot compile → blocks production build. Fix: either generate the finance client or remove the premature service if not ready.

### P1 — Fix This Sprint

2. **[A5] Test environment — DATABASE_URL missing** — 144 tests fail because `DATABASE_URL` is not set in the test runner environment. These are unit tests that use Prisma mocks — check why `jest.setup.ts` or `.env.test` is not loading. Likely a CI config gap introduced with the new asset/depreciation module. Fix: ensure `.env.test` is present or inject `DATABASE_URL=postgresql://...(test db)` in jest config.

3. **[A3] Decimal violations in sales path** — `sales.service.ts:291,597` and `shop-cart.service.ts:39` cast `costPrice` (Decimal) to `Number()` before arithmetic. This loses precision on amounts ≥ 10^15 and breaks the Decimal compliance rule from v4 hardening. Fix: use `new Prisma.Decimal(product.costPrice)` throughout.

### P2 — Address This Month

4. **[A6] Bundle size** — `excel` (929KB raw), `LettersPage` (569KB), `ContractTemplatesPage` (490KB), `pdf` (430KB) exceed Vite's warning threshold. `thai-address-data` (870KB) is already separate. Suggestion: lazy-load `exceljs` only when export is triggered (dynamic `import()`); split `LettersPage` further by extracting the bulk-print preview component.

5. **[A2/A4] `web-widget.controller.ts` — document or guard** — The web chat widget controller has no auth and no rate limiting beyond global ThrottlerGuard. Add `@Throttle()` override with stricter per-IP limit and add a comment in `security.md` documenting it as intentionally public. Otherwise security auditors will flag it.

6. **[B1/A4] Models missing `deletedAt`** — `Customer`, `FixedAsset`, `CompanyInfo`, `Promotion`, `DunningRule` are business entities that should support soft-delete for audit trails. Add `deletedAt DateTime?` + corresponding `where: { deletedAt: null }` guards. Most critical: `Customer` (referenced by contracts, payments — accidental hard delete would cascade).

7. **[A3] Remaining `Number()` on Decimal fields** — `line-oa/chatbot.service.ts` (5 instances), `notifications.service.ts` (5 instances), `receipts.service.ts:532`. These are display formatting calls (`toLocaleString`). Acceptable for formatting but add `// display only` comment to prevent future confusion with precision-sensitive math.
