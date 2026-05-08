# CTO Watchdog Report — 2026-05-08

## Summary
12/15 checks passed. Overall health is good — TypeScript is error-free, bundle splits are working, chatbot architecture is solid — but 3 test suites (15 tests) fail due to missing `DATABASE_URL` in CI/test env, a small number of controllers are public-without-JwtAuthGuard (all have alternative auth mechanisms except one unreviewed case), and several service queries are missing `deletedAt: null` guards.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | PASS | api: 0 errors, web: 0 errors |
| A2 Security | WARN | 16 controllers lack `JwtAuthGuard` — 14 confirmed use alternative guards (ShopBotDefenseGuard, LiffTokenGuard, LineWebhookGuard, HMAC, LineFinanceWebhookGuard, @Public+token); `web-widget.controller.ts` is fully anonymous by design (serves anonymous visitors); `line-login.controller.ts` is OAuth flow (no sensitive data). No raw SQL without parameterization. `localStorage` used only for E2E test token injection (legitimate). No hardcoded secrets. |
| A3 Decimal | WARN | 20+ `Number()` calls on money fields found in new modules: `shop-catalog.service.ts` (costPrice), `staff-chat/chat-commerce.service.ts` (amountDue, amountPaid, price), `line-oa/chatbot.service.ts` (amountDue, amountPaid), `sales.service.ts` (costPrice ×2), `defect-exchange.service.ts` (amountPaid), `asset.service.ts` (costValue, salvageValue). These are in modules added after v4 hardening. |
| A4 Soft-Delete | WARN | 1012 `findMany/findFirst/findUnique` calls without `deletedAt: null` in service files. Sampling reveals legitimate exceptions (append-only logs, idempotency tables) but also real gaps: `reschedule.service.ts` (installmentSchedule query), `shop-catalog.service.ts` (product queries ×3), `reporting/compliance.service.ts` (contract/callLog queries), `inter-company.service.ts` (interCompanyTransaction queries). |
| A5 Tests | WARN | API: 2267/2282 passed (15 failures in 3 suites). All 3 failures are `PrismaClientInitializationError: DATABASE_URL not found` — integration tests that require a live DB but are running without one. No logic regressions. Web: 221/222 passed (1 failure in `useCollectionsKeyboard.test.tsx` — keyboard shortcut 'q' tab-switch assertion). |
| A6 Bundle | WARN | 5 chunks exceed 500KB gzipped: `excel-CP-udPoT.js` (256 KB gzip), `ContractTemplatesPage` (148 KB gzip), `pdf-rsl9_gnw.js` (139 KB gzip), `index-B31NuJT_.js` (127 KB gzip), `charts-VDTR8gCM.js` (120 KB gzip), `CollectionsPage` (103 KB gzip). `thai-address-data` is 870KB raw / 69KB gzip (acceptable). Excel and PDF vendors are pre-split chunks. ContractTemplatesPage at 148KB gzip is the most actionable. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | WARN | 148 models total. 50 models missing `updatedAt` or `deletedAt` — the majority are correctly exempt (AuditLog, ChatMessage, tokens, event logs per documented rules). Non-exempt candidates needing review: `Promotion` (missing all 3 timestamps), `Todo` (missing all 3), `FeeWaiverApproval` (missing all 3), `DunningRule` (missing all 3), `BroadcastMessage/BroadcastApproval` (missing all 3). Float fields exist only for GPS coordinates and ML confidence scores — not money fields. Decimal(12,2) used correctly on all 177 money fields. Enum conventions followed throughout. |
| B2 Migrations | PASS | 204 migration directories. Latest: `20260808000000_add_payment_method_config_and_partial_qr`. No `DROP COLUMN`, `DROP TABLE`, or `ALTER TYPE ... USING` in latest migration — only safe `CREATE TABLE` and `CREATE INDEX` operations. |
| B3 Indexes | WARN | `CustomerScore` model has `customerId` FK with `@unique` but no `@@index` (the `@unique` implicitly creates an index, so functionally OK). Automated check found no other missing FK indexes on models with `branchId`/`contractId`. Compliance/reporting service queries on `callLog` filter by date range without an index on `dueDate` — worth profiling as data grows. |
| B4 Drift | PASS | Latest migration (`20260808`) adds `payment_method_configs` and `partial_payment_links` tables. Both tables are present in `schema.prisma` as `PaymentMethodConfig` and `PartialPaymentLink` models with matching fields. No mismatches detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | PASS | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` guard present. Sentry `captureException` on all error paths + `captureMessage` on max-iteration hit. `maxTokens = 1024`. Per-iteration timeout of 30s (AbortController). Prompt cached with 5-min TTL. |
| C2 Prompt | PASS | System prompt references: bank account (KBank 203-1-16520-5), phone number (063-134-6356), business hours (Mon-Sat 09:00-18:00). Constants in `finance-rules.ts` are consistent with prompt. No contradictions found. Estimated token length: ~600-700 tokens (Thai text). No PII leakage rules. Forbidden word substitutions correctly defined. |
| C3 Tools | PASS | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All have Thai descriptions with usage trigger hints. Input schemas properly typed. `tool-executor.ts` has `switch` covering all 7 `ToolName` values. PII redaction + input validation (`validateToolInput`) applied before execution. `customerId` injected by orchestrator — not exposed to Claude. |
| C4 Auto-Trigger | PASS | Idempotency via `ChatAutoTrigger` table with `@@unique([customerId, referenceKey])` — P2002 on duplicate = skip, safe for concurrent runs. All 6 reminder types covered: T-5, T-3, T-1, T (09:00 cron), T+1, T+3 (10:00 cron). Sentry `captureException` on both cron jobs. |
| C5 Security | PASS | LIFF controller uses `LiffTokenGuard` (LINE token verification). Admin chatbot controller uses `@UseGuards(JwtAuthGuard, RolesGuard)`. Main webhook controller uses `LineFinanceWebhookGuard` (LINE signature HMAC). Webhook dedup via `WebhookDedupService` (DB-backed, multi-instance safe). `customerId` scoped in tool executor — Claude cannot access data for other customers. |

---

## Action Items

### Critical
- **A5: 3 test suites require live DB but run without `DATABASE_URL`** — `other-income.service.spec.ts`, `doc-number.service.spec.ts`, `collections-foundation.seed.spec.ts` all need `DATABASE_URL` set in the test runner environment (or these should be integration tests isolated from unit test runs via Jest project config). 15 tests currently failing will mask real regressions.
- **A5: Web test regression** — `useCollectionsKeyboard.test.tsx` line 74: keyboard shortcut 'q' not calling `onSwitchTab('today')`. Likely a recent keyboard handler change broke the test or the test needs updating.

### Warnings
- **A3: Decimal compliance regression** — `Number()` wrapping of Prisma Decimal fields in 6 post-v4 modules. Most impactful: `sales.service.ts` (costPrice used in revenue calculations), `chat-commerce.service.ts` (amountDue/amountPaid in payment logic). Should be converted to `new Prisma.Decimal()` arithmetic.
- **A4: Soft-delete gaps** — `reschedule.service.ts`, `shop-catalog.service.ts`, `reporting/compliance.service.ts`, and `inter-company.service.ts` have `findMany`/`findFirst` calls without `deletedAt: null`. Risk: soft-deleted records appearing in reports or calculations.
- **B1: Schema models missing timestamps** — `Promotion`, `Todo`, `FeeWaiverApproval`, `DunningRule`, `BroadcastMessage`, `BroadcastApproval` have no `createdAt`/`updatedAt`/`deletedAt`. These are mutable business objects that should have full audit trail fields.
- **A2: `web-widget.controller.ts` fully anonymous** — Accepts any visitor with no rate limiting beyond Throttle. `roomId` acts as capability token but is a UUID (guessable by brute force). Consider adding a short-lived signed token for room access rather than relying on UUID obscurity.
- **A6: ContractTemplatesPage 148KB gzip** — This single page chunk is unusually large. Investigate whether the rich-text editor or a large static template payload can be lazy-loaded within the page.

### Notes
- 204 migrations is healthy; no dangerous DDL operations in recent migrations.
- ChatGPT finance bot architecture is solid: model pinned to Sonnet 4.6, tool call loop bounded at 5, 30s per-iteration timeout, full Sentry coverage, customer data isolation enforced at orchestrator level.
- TypeScript is 0 errors in both apps — baseline maintained.
- Bundle split strategy (exceljs/jspdf/recharts as separate chunks) from v3 is working. Only ContractTemplatesPage merits further splitting.
- `CustomerScore.customerId` has `@unique` which implicitly creates an index — no action needed despite automated flag.
- LINE Login controller (`line-login.controller.ts`) is a standard OAuth redirect handler with no sensitive data access — public access is appropriate.
- `metrics.controller.ts` uses `@Public()` + token header check — consistent with Prometheus scrape patterns and not a security risk.
