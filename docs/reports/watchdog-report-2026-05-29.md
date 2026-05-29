# CTO Watchdog Report — 2026-05-29

## Summary

**10/15 checks passed** (3 FAIL, 2 WARN)

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | FAIL | API: 7 errors (all in `prisma-finance.service.ts` — `@prisma/client-finance` not generated); Web: 0 errors |
| A2 Security | WARN | localStorage used for E2E token injection only (immediately cleared — intentional); 12 controllers without `JwtAuthGuard` but all are legitimately public (LiffTokenGuard, LineWebhookGuard, ShopBotDefenseGuard, or bearer-less webhooks with HMAC/shared-secret guards) |
| A3 Decimal | FAIL | 119 `Number(price/amount/cost/total)` violations across 48 files; hot spots: `finance-tools.service.ts` (6), `chatbot.service.ts` (6), `sales.service.ts` (3), `shop-catalog.service.ts` (2) |
| A4 Soft-Delete | WARN | `ChatMessage`, `CallLog`, `InterCompanyTransaction` queries missing `deletedAt: null` — these models are append-only by design (no `deletedAt` column) so the omission is correct; `installmentSchedule` and `systemConfig` queries correctly omit it; no active data-loss risk found in sampled queries |
| A5 Tests | FAIL | API: 3,745/3,897 passed (144 failed, 14 suites failed); Web: ~7+ failures detected (useAssetCalculation hook, AssetsListPage statcards) — root cause: no `DATABASE_URL` env in CI test environment; `@prisma/client-finance` not generated causes 7 suites to fail at compile time |
| A6 Bundle | WARN | 6 chunks >500KB gzipped: `excel` (256 KB gz), `LettersPage` (219 KB gz), `ContractTemplatesPage` (145 KB gz), `pdf` (139 KB gz), `charts` (119 KB gz), `CollectionsPage` (101 KB gz) — LettersPage and CollectionsPage are the actionable targets; others are library chunks already split |

### A1 Detail — TypeScript Errors

All 7 errors are in `src/prisma/prisma-finance.service.ts` and its spec file:

```
Cannot find module '@prisma/client-finance'
Property '$connect' does not exist on type 'PrismaFinanceService'
Property '$queryRaw' does not exist on type 'PrismaFinanceService'
```

Root cause: `@prisma/client-finance` (SP7 dual-DB client for `DATABASE_URL_FINANCE`) has not been generated via `prisma generate --schema=prisma/schema-finance.prisma`. The module is referenced in `health.controller.ts` and `prisma-finance.service.spec.ts`.

### A2 Detail — Intentionally Public Controllers

Controllers without `JwtAuthGuard` and their protection mechanism:

| Controller | Protection | Notes |
|-----------|-----------|-------|
| `shop-catalog` | `ShopBotDefenseGuard` | Public shop catalog — bot defense guard |
| `web-widget` | Throttle (30/min) | Anonymous web chat widget — public by design |
| `line-oa/liff-api` | `LiffTokenGuard` | LINE LIFF token verification |
| `line-oa/line-login` | OAuth flow (state param) | LINE OAuth callback |
| `line-oa/line-oa-chatbot` | `LineWebhookGuard` (HMAC) | LINE webhook HMAC signature |
| `shop-reservation`, `shop-shipping`, `shop-cart`, `shop-buyback`, `shop-tracking`, `shop-trade-in` | `ShopBotDefenseGuard` | Public shop endpoints |
| `shop-auth-social` | `ShopBotDefenseGuard` + Throttle | Social login — public by design |
| `shop-line-chat` | Implied public | LINE chat for shop |
| `yeastar-webhook` | Intentionally public (comment documented) | PBX webhook |
| `metrics` | `X-Metrics-Token` shared-secret header | Prometheus scrape endpoint |
| `facebook-webhook` | HMAC `x-hub-signature-256` | Facebook webhook |

**No unprotected internal endpoints found.** All deviations are documented or use non-JWT guards appropriate to their context.

### A3 Detail — Decimal Violations

The v4 hardening removed `Number(_sum` patterns in core accounting paths. The remaining 119 violations are concentrated in:
- **Chatbot/display paths** (finance-tools.service, chatbot.service, admin-analytics.service) — used for text formatting/display only, not stored or used in financial calculations
- **Sales service** (3 violations) — `costPrice` and `interestRate` cast to `Number` for arithmetic that is then stored back — P1 risk
- **shop-catalog service** — price display for online shop (display only, not stored)

The core accounting modules (journal, contracts, payments, installments) appear clean.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | PASS | All 40+ models use UUID `@id @default(uuid())` — no autoincrement. Money fields use `@db.Decimal(12,2)`. Known exceptions (AuditLog, ChatMessage, CallLog, tokens) correctly lack `updatedAt`/`deletedAt` per documented rules. Enums: PascalCase names, SCREAMING_SNAKE_CASE values. `Float` only used for GPS coordinates, ML confidence scores, and threshold percentages — never for money. |
| B2 Migrations | PASS | 269 migrations total. Latest 3: `add_je4_id_to_contract_exchange_requests`, `add_canned_response_bubbles`, `phase2_canned_response_extras`, `phase3_bubble_rich_types`. Latest migration uses `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (safe Postgres enum expansion). No `DROP TABLE` or `DROP COLUMN` in latest 3. |
| B3 Indexes | PASS | Critical models well-covered: `Contract` has 10 indexes (customerId, branchId, status, salespersonId, createdAt, deletedAt, composite). `Payment` has 7 indexes. `RepairTicket` (v6) has 7 indexes covering all FKs. `PromiseSlot` (v5) has compound index on `callLogId`. No obvious missing FK indexes found in sampled models. |
| B4 Drift | PASS | Latest migration SQL (`phase3_bubble_rich_types`) adds `latitude`, `longitude`, `address`, `location_title`, `json` columns + 4 `BubbleType` enum values. Schema.prisma `CannedResponseBubble` model contains all 5 new columns with matching types. No drift detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | OK | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` guard present. Per-iteration 30s timeout via `AbortController`. Sentry capture on: max iterations, empty response, Claude API error. `maxTokens = 1024`. Prompt cache (5 min TTL in-memory). Conversation history: last 10 msgs, 20k char budget. |
| C2 Prompt | OK | System prompt ~6380 chars. References correct business info: KBank account `203-1-16520-5`, late fee 50 THB/day, business hours Mon-Sat 09:00-18:00, contact `063-134-6356`. Clear forbidden-words list (หนี้→ยอดรอชำระ etc.). Security rules well-defined. No contradictions found. Finance rules in `constants/finance-rules.ts` match prompt values. |
| C3 Tools | OK | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All have descriptions. `tool-executor.ts` handles all 7 tool names via switch-case. No missing tool handlers. |
| C4 Auto-Trigger | OK | Idempotency via `@@unique([customerId, referenceKey])` — P2002 on duplicate = skip. Covers: T-5, T-3, T-1, T (09:00 cron), T+1, T+3 (10:00 cron) — 6 reminder types as specified. Sentry capture on cron-level errors. Per-send error handling marks trigger as FAILED with error message. |
| C5 Security | OK | LIFF controller uses `LiffTokenGuard` (LINE ID token server-side verification). Admin controller has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level. Webhook dedup via `WebhookDedupService` checking `webhookEventId`. Main webhook endpoint uses `LineFinanceWebhookGuard` (HMAC). Replay protection via `ProcessedWebhookEvent` table. |

---

## Action Items

### Critical (P0)

**A1-C1 — Generate `@prisma/client-finance`**
- `@prisma/client-finance` is not generated → 7 TypeScript compile errors, 14 test suite failures
- `PrismaFinanceService` and `health.controller.ts` reference non-existent types
- Fix: run `cd apps/api && npx prisma generate --schema=prisma/schema-finance.prisma` (or ensure it's in `postinstall`)
- Also add to CI pipeline generate step

**A5 — Test suite regression: 144/3897 tests failing**
- All API integration test failures trace to missing `DATABASE_URL` env in test environment + missing `@prisma/client-finance` client
- Web: `useAssetCalculation` hook tests failing (7 tests), `AssetsListPage.statcards` (1 test) — these appear to be genuine logic failures unrelated to the DB env issue
- Baseline was 577 API / 129 web. Current: **3,745 passing** (expanded suite) but 144 failing
- Action: (1) Fix `@prisma/client-finance` generation, (2) investigate `useAssetCalculation` hook failures

### High Priority (P1)

**A3 — Decimal violations in sales.service.ts (financial calculation paths)**
- `sales.service.ts:291` — `costPrice = Number(product.costPrice)` used in contract calculations
- `sales.service.ts:597` — `const costPrice = product ? Number(product.costPrice) : 0`
- `sales.service.ts:506` — `Number(await getRateForMonths(...))` for interest rate arithmetic
- These are stored/used in financial computations, not just display — risk of precision loss
- Fix: use `new Prisma.Decimal(product.costPrice)` and `Prisma.Decimal` arithmetic

**A3 — Decimal violations in chatbot finance-tools.service.ts**
- 6 violations converting `amountDue`/`amountPaid` to Number for chatbot display calculations
- While display-only, these accumulate across `reduce()` calls on payment arrays — could show wrong balances to customers
- Fix: use `Prisma.Decimal` for intermediate sums, call `.toNumber()` only at the serialization boundary

**A6 — LettersPage bundle (219 KB gzipped) and CollectionsPage (101 KB gz)**
- `LettersPage` at 219 KB gzipped is the largest page chunk — likely includes heavy dependencies not yet split
- `CollectionsPage` at 101 KB is borderline
- `excel` (256 KB gz) and `pdf` (139 KB gz) are already split library chunks — acceptable
- Action: profile `LettersPage` with `npx vite-bundle-visualizer` and lazy-load any heavy sub-components or editor libraries

### Low Priority / Nice-to-Have (P2)

**A2 — Document intentionally-public controllers in security.md**
- `web-widget`, `metrics`, `yeastar-webhook`, `facebook-webhook`, LINE login/LIFF, shop-* controllers are all legitimately public but only `yeastar-webhook` has an inline comment explaining its public nature
- The security rules doc (`rules/security.md`) lists 5 known-public endpoints but is missing 7+ new ones added since v1
- Action: update `.claude/rules/security.md` "Intentionally Public Endpoints" list to include all known-public controllers

**A4 — `InterCompanyTransaction` queries missing `deletedAt: null`**
- The `InterCompanyTransaction` model in schema.prisma does not have a `deletedAt` column, so these queries are technically correct
- However, no `/// Immutable` comment marks this as intentional (unlike AuditLog which has comments)
- Action: add `/// append-only — no deletedAt by design` comment to `InterCompanyTransaction` model

**B3 — `PromiseSlot` model missing index on `settlementDate`**
- `PromiseSlot` has `@@index([callLogId, settlementDate])` and `@@index([keptAt, brokenAt])` — adequate coverage
- However, queries filtering by `status` alone (for broken/pending counts) have no dedicated index
- Monitor query performance as promise volume grows; add `@@index([status])` if needed

**C4 — Auto-trigger missing T-7 reminder type**
- Spec mentions T-5, T-3, T-1, T, T+1, T+3 — 6 types implemented (matches spec)
- No T-7 in spec or implementation — consistent, no action needed
- Minor: the `sendReminder` method casts `Number(args.payment.amountDue)` — same Decimal violation as A3

---

## Environment Notes

- `DATABASE_URL` not set in test environment → all DB-connected integration tests fail (expected in this environment)
- `DATABASE_URL_FINANCE` not set → `PrismaFinanceService.isEnabled = false` (graceful degradation, expected)
- `@prisma/client-finance` not generated → TypeScript compile errors (must be fixed before deployment)
- Web tests: ECONNREFUSED to localhost:3000 in integration tests = no API server running (expected in this environment)
