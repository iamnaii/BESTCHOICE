# CTO Watchdog Report — 2026-07-04

## Summary
6/15 checks PASS, 8/15 WARN, 1/15 FAIL. Critical: 145 API test failures (cascading from missing `@prisma/client-finance` generated client + logic regressions in asset/other-income/depreciation modules). Decimal precision regression in `customer-query.service.ts` contradicts v4 hardening claim.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | WARN | API: 7 errors, all cascade from missing `@prisma/client-finance` generated client (`npx prisma generate` not run for finance schema). Web: 0 errors. |
| A2 Security | WARN | No injection/token/secret issues. Two intentionally-public controllers not documented in `security.md`: `line-oa/line-login.controller.ts` (LINE OAuth redirect) and `staff-chat/web-widget.controller.ts` (anonymous widget). All other unguarded controllers verified as allow-listed or using alternative guards (ShopBotDefenseGuard, LiffTokenGuard, LineWebhookGuard). |
| A3 Decimal | WARN | **Critical regression vs v4 claim**: `customers/services/customer-query.service.ts:341` — `Number(outstanding._sum.amountDue ?? 0)` (v4 stated "0 `Number(_sum` remaining"). Medium: `sale-creation.service.ts:95`, `sale-writer.service.ts:245,336`, `interest-config.service.ts:103`, `online-order-sale.adapter.ts:52` all use `Number()` on money fields in calculation paths. Low: chatbot/LINE display contexts only. |
| A4 Soft-Delete | WARN | One genuine gap: `reporting/compliance.service.ts:61` — `contract.findMany({ where: { id: { in: ids } } })` missing `deletedAt: null`. All other suspected queries verified safe by context. |
| A5 Tests | FAIL | **API: 5298 total, 5145 passed, 145 failed** (14 unique failing suites). Root causes: (1) `@prisma/client-finance` not generated — cascades into `prisma-finance.service.spec.ts`, `health.controller.spec.ts`, `backfill-user-companies.cli.spec.ts`; (2) logic failures in `asset.service.spec.ts`, `asset-journal.service.spec.ts`, `other-income.service.spec.ts`, `depreciation.service.spec.ts` and related suites; (3) DB connection error in `collections-foundation.seed.spec.ts`. **Web: 909 total, 908 passed, 1 failed** — `RescheduleOverlay.test.tsx`: BANK_TRANSFER with ref field submit button never enables within `waitFor` timeout. Note: test suite has grown significantly since CLAUDE.md baseline (API 577→5298, Web 129→909). |
| A6 Bundle | WARN | Build succeeded. No chunk exceeds 500 kB gzip. Heaviest chunks: `excel-*.js` (ExcelJS, 256 kB gz), `LettersPage-*.js` (219 kB gz), `index-*.js` main vendor (176 kB gz). Vite emitted large-chunk warning. `PeriodClosePage` has an ineffective dynamic import (statically imported by `SettingsPage`, defeating the `App.tsx` split). |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | PASS | UUID IDs on all models. All documented timestamp exceptions carry `/// Immutable` comments. Zero Float money fields — all financial fields use `@db.Decimal(12,2)` or `@db.Decimal(15,2)`. Float used only for GPS coords, ML confidence scores, AI thresholds (correct). Enum names PascalCase, values SCREAMING_SNAKE_CASE throughout. |
| B2 Migrations | PASS | 287 migrations. Latest (`20260979000000_partial_link_purpose_metadata`) is safe: `ADD COLUMN IF NOT EXISTS` with defaults. No DROP TABLE, ALTER TYPE DROP VALUE, or TRUNCATE found in recent migrations. |
| B3 Indexes | WARN | 4 un-indexed nullable FK fields on low-traffic models: `LateFeeWaiverRequest.(requesterUserId, approverUserId)`, `ExternalFinanceCommission.customerId`, `FinanceReceivableContactLog.financeCompanyContactId`. Core models (Contract, Payment, Customer, Sale) have comprehensive compound indexes. |
| B4 Drift | PASS | Latest migration `purpose`/`metadata` columns present and correctly typed in `schema.prisma` (`PartialPaymentLink` model). No drift detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | PASS | Model: `claude-sonnet-4-6` (current). Haiku→Sonnet routing on first `tool_use` — cost-efficient. `MAX_TOOL_ITERATIONS=5` with Sentry capture on breach. `maxTokens=1024`. Per-call 30s timeout (vs SDK default 600s). Sentry `captureException` in all error paths. History window: last 10 DB messages, 20k char budget. System prompt cached with 5-min TTL. |
| C2 Prompt | WARN | Late fee hardcoded as `"ค่าปรับล่าช้า: 50 บาท/วัน"` in both the system prompt and the `calculate_fine` tool description. Actual rate is driven by `SystemConfig` keys via `resolveLateFee()`. If config changes (rate flip, mode PER_DAY/BRACKET), bot will quote wrong figures to customers while charging differently. Business hours, bank account (KBank 203-1-16520-5), and phone correct. Estimated prompt size ~1,000–1,500 tokens (well within limits). |
| C3 Tools | PASS | 7 tools defined (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`). All have descriptions + typed input schemas. Executor covers all 7 + default fallback. `validateToolInput()` + `redactPii()` before Sentry on every call. Customer isolation enforced by orchestrator injection — Claude cannot supply alternate `customerId`. |
| C4 Auto-Trigger | WARN | Idempotency via `@@unique([customerId, referenceKey])` with P2002 → `'skipped'` — correct. Sentry coverage on `runDailyReminders` (09:00) and `runDailyEscalations` (10:00). All 6 reminder types (T-5, T-3, T-1, T, T+1, T+3) implemented. **Gap**: `AutoTriggerType` enum has `HOLIDAY_WARNING` and `RECEIPT_DELIVERY` values with zero cron implementation. Any records with these types will stall in PENDING indefinitely and silently. |
| C5 Security | PASS | LIFF: `LiffTokenGuard` at class level; `lineUserId` from LINE-verified `req.liffUserId` (not body). Admin: `JwtAuthGuard+RolesGuard` on all methods. Webhook: HMAC via `LineFinanceWebhookGuard`; DB-based dedup via `ProcessedWebhookEvent` (multi-instance safe); always returns HTTP 200 (correct for LINE retry semantics). All admin test-trigger endpoints guarded `OWNER`/`FINANCE_MANAGER`. |

---

## Action Items (prioritized)

### P0 — Fix before next deploy
1. **A5/A1** — Generate `@prisma/client-finance`: run `npx prisma generate` (or whatever generates the finance client) in `apps/api`. This unblocks 145 test failures and 7 TS errors in a single command.

### P1 — High priority
2. **A3** — `customers/services/customer-query.service.ts:341`: Replace `Number(outstanding._sum.amountDue ?? 0)` with `new Prisma.Decimal(outstanding._sum.amountDue ?? 0)`. Regresses the v4 hardening claim.
3. **A5** — Investigate logic failures in `asset.service.spec.ts`, `other-income.service.spec.ts`, `depreciation.service.spec.ts` — these are code regressions unrelated to the missing client.
4. **A5** — Fix `RescheduleOverlay.test.tsx` BANK_TRANSFER submit button not enabling (web regression).

### P2 — Medium priority
5. **A3** — Replace `Number()` with `Prisma.Decimal` in `sale-creation.service.ts:95`, `sale-writer.service.ts:245,336`, `interest-config.service.ts:103`, `online-order-sale.adapter.ts:52`.
6. **C2** — Make late-fee rate in system prompt and `calculate_fine` description dynamic — inject from `FinanceConfigService` at prompt-build time alongside bank info.
7. **A4** — Add `deletedAt: null` to `reporting/compliance.service.ts:61` contract query.

### P3 — Low priority
8. **A2** — Document `line-oa/line-login.controller.ts` and `staff-chat/web-widget.controller.ts` in `security.md` intentional-public exceptions list.
9. **C4** — Decide fate of `HOLIDAY_WARNING`/`RECEIPT_DELIVERY` `AutoTriggerType` enum values: implement cron handlers or remove via migration.
10. **B3** — Add `@@index` on: `LateFeeWaiverRequest.(requesterUserId, approverUserId)`, `ExternalFinanceCommission.customerId`, `FinanceReceivableContactLog.financeCompanyContactId`.
11. **A6** — Fix `PeriodClosePage` ineffective dynamic import (remove the static import from `SettingsPage` or consolidate the split point).
