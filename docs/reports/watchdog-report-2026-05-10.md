# CTO Watchdog Report — 2026-05-10

## Summary

7 PASS · 7 WARN · 1 FAIL out of 15 checks. Critical action: fix ~102 Decimal/Number() violations in newer modules (A3). Urgent: 119 API tests failing due to missing DB mock in new test suites (A5). Chatbot has two monitoring gaps (C2, C4).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in apps/api and apps/web |
| A2 Security | **WARN** | `web-widget.controller.ts` not in security.md exempt list (appears intentional — anonymous chat widget — but undocumented). All other 15 unguarded controllers are legitimately public. No raw SQL injection, no localStorage token leaks, no hardcoded secrets. |
| A3 Decimal | **FAIL** | ~102 `Number()` wrapping violations on Decimal money fields across newer modules: `line-oa/chatbot.service.ts` (8), `chatbot-finance/finance-tools.service.ts` (8), `notifications/scheduler.service.ts` (6), `receipts/receipts.service.ts` (5), `staff-chat/*` (9), `sales/sales.service.ts` (2), `shop-catalog` (2), `customers` (2), others. Risk: floating-point precision loss on financial arithmetic. |
| A4 Soft-Delete | **WARN** | ~40 genuine `findMany`/`findFirst`/`findUnique` calls on soft-deletable business models missing `deletedAt: null`. Key offenders: `purchase-orders.service.ts` (8 occurrences), `shop-catalog.service.ts` (3), `staff-chat/*` (8+), `compliance.service.ts` (1), `line-oa.service.ts` (6+), `stickers.service.ts` (4), `inter-company.service.ts` (6). Legitimately exempt models (AuditLog, ChatMessage, tokens, webhook records) were excluded from count. |
| A5 Tests | **WARN** | API: 2420 tests total (2301 pass / 119 fail across 8 suites). All 119 failures share one root cause: PrismaService cannot connect to DB (no test DB in env) in newly added suites — `asset` (4 suites), `depreciation` (1), `other-income` (2), `collections-foundation` (1). Pre-existing 200 suites all pass. Web: 222 tests total (221 pass / 1 fail): `useCollectionsKeyboard` — G→Q chord combo does not trigger `onSwitchTab('today')`. Both counts significantly exceed v4 baselines (API 577→2420, web 129→222), reflecting A.5 additions. |
| A6 Bundle | **PASS** | All chunks within limits. Largest gzipped: `excel` 256 KB, `ContractTemplatesPage` 148 KB, `pdf` 139 KB, `index` (vendor) 128 KB, `charts` 120 KB. No chunk exceeds 300 KB gzipped. Bundle split from v3 hardening is effective. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | (1) `PaymentLink` missing `updatedAt` — not documented as intentional exception (status field changes, needs audit trail). (2) `SavingPlanPayment` missing `updatedAt`/`deletedAt` — no `///` doc comment explaining omission. (3) INFO: `ChartOfAccount` timestamp columns are camelCase without `@map` — functional but inconsistent (Phase A.4 migration artifact). All money fields correctly use `@db.Decimal(12,2)`. All enum names PascalCase, values SCREAMING_SNAKE_CASE. No Float on money fields. |
| B2 Migrations | **PASS** | 210 migrations total. Last 4 migrations use descriptive names. Recent operations are safe: `ALTER TYPE … RENAME VALUE` (atomic rename, Postgres 10+), `DROP INDEX IF EXISTS` (safe, covered by compound index), additive nullable column adds. No data-loss `DROP TABLE` or `DROP COLUMN` in recent history. |
| B3 Indexes | **WARN** | `Repossession.appraisedById` FK has no `@@index` — inconsistent with `TradeIn.appraisedById` which does. All other heavy-query models (Contract, Payment, Customer, Sale, JournalEntry) have comprehensive indexes including compound patterns. `CompanyInfo` has no indexes beyond `@unique` but is a 2-row table (acceptable). |
| B4 Drift | **PASS** | Last 3 migrations verified against schema.prisma: `whtFormType` column mapping matches, depreciation `reversedAt`/`reversedById` match, `ContractStatus.TERMINATED` rename matches. No drift detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **PASS** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` with Sentry warning on breach. Try/catch with `Sentry.captureException`. Minor: `maxTokens = 1024` is borderline for complex multi-tool responses (consider raising to 2048). Anthropic client is cached after first init — key rotation requires restart. |
| C2 Prompt | **WARN** | Bank account, phone, business hours, late fee in `system-prompt.ts` all match `finance-rules.ts` constants. However, the static fallback prompt hardcodes bank account info independently — if the bank account changes, `finance-rules.ts` and the DB-backed prompt override are two separate places to update. Prompt length ~1595 tokens (acceptable). No contradictions found in decision tree. |
| C3 Tools | **PASS** | 7 tools defined (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`). All have Thai descriptions. All input schemas properly defined with `required` arrays. `tool-executor.ts` handles all 7 names plus a `default` error case. PII redacted in Sentry logs before tool execution. Customer data isolation: `customerId` injected by orchestrator, not from Claude's tool input. |
| C4 Auto-Trigger | **WARN** | Idempotency via `ChatAutoTrigger` DB unique constraint on `type:paymentId`. All 6 reminder/escalation types covered (T-5, T-3, T-1, T-0, T+1, T+3). Sentry captures on cron-level exceptions. Gap: no `Sentry.captureException` on individual LINE push failures in `sendReminder` — a mass LINE API outage would accumulate `failed++` silently without triggering any Sentry alert (outer try/catch succeeds). |
| C5 Security | **PASS** | LIFF controller uses `LiffTokenGuard` + `@SkipCsrf()` + per-endpoint rate limits. Admin controller uses `JwtAuthGuard + RolesGuard` at class level. Webhook controller uses `LineFinanceWebhookGuard` (LINE signature). Test/push endpoints restricted to `OWNER`. Webhook dedup via DB unique constraint on `eventId` (7-day retention cron). Customer isolation: `customerId` from orchestrator context, never from tool input. |

---

## Action Items

### P0 — Fix before next release

1. **[A5] Fix 8 failing API test suites** — Add `PrismaService` mock or test database setup to `asset`, `depreciation`, `other-income`, and `collections-foundation` test suites. Root cause: `LibraryEngine` init fails (no DB connection) at `jest.config.ts` level — likely missing `DATABASE_URL` in test env or missing `jest.mock('@/prisma')` in new suites. Pattern: follow existing passing suites (e.g., `bad-debt.service.spec.ts`) which use `jest.fn()` mocks instead of live Prisma.

2. **[A5] Fix web keyboard test** — `useCollectionsKeyboard` G→Q chord in `useCollectionsKeyboard.test.tsx`. The `onSwitchTab` callback is never invoked — likely a key sequence timing issue in the test (key-down events not dispatched in correct order, or state not flushed between G and Q).

### P1 — Fix this sprint

3. **[A3] Decimal compliance sweep** — Replace `Number(decimal_field)` with `new Prisma.Decimal(value)` arithmetic or `.toFixed(2)` for display in the top offenders: `line-oa/chatbot.service.ts`, `chatbot-finance/finance-tools.service.ts`, `notifications/scheduler.service.ts`, `receipts/receipts.service.ts`. Add ESLint rule to ban `Number(` near Prisma Decimal fields.

4. **[C4] Add Sentry on individual LINE push failures** — In `auto-trigger.service.ts` `sendReminder` catch block, add `Sentry.captureException(err, { extra: { paymentId, type } })`. Additionally, after each batch completes, if `failed > 0` call `Sentry.captureMessage('LINE push failures in reminder batch', { extra: { failed, total } })`.

5. **[C2] Fix dual-maintenance bank account info** — Generate the static fallback system prompt from `finance-rules.ts` constants rather than hardcoding. The `FINANCE_BOT_SYSTEM_PROMPT` string should import `FINANCE_BANK_ACCOUNT`, `FINANCE_CONTACT_PHONE`, `BUSINESS_HOURS` from constants.

### P2 — Address this month

6. **[A4] Soft-delete audit sweep** — Add `deletedAt: null` filter to `findMany`/`findFirst`/`findUnique` calls in `purchase-orders.service.ts`, `staff-chat/*`, `compliance.service.ts`, `line-oa.service.ts`, `stickers.service.ts`. Priority: purchase-orders (8 occurrences) and line-oa (6+ occurrences) as they deal with customer-facing data.

7. **[A2] Document `web-widget.controller.ts` in security.md** — Add to the "Intentionally Public Endpoints" list with rationale (anonymous website chat widget, `roomId` acts as capability token, rate-limited via ThrottlerGuard).

8. **[B1] Fix undocumented schema exceptions** — Add `updatedAt DateTime @updatedAt` to `PaymentLink` (its status changes and needs an update trail). Add `/// Append-only payment record — updatedAt/deletedAt intentionally omitted` comment to `SavingPlanPayment` if the omission is intentional.

9. **[B3] Add missing FK index** — Add `@@index([appraisedById])` to `Repossession` model (consistent with `TradeIn`).

10. **[C1] Raise `maxTokens` to 2048** — Provides headroom for complex multi-tool responses (full payment schedules + early payoff calculations) without risk of truncation.
