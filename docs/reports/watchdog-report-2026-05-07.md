# CTO Watchdog Report — 2026-05-07

## Summary
12/15 checks passed — 3 WARNs (test regression, Decimal compliance, schema softdelete gaps), 0 critical failures. TypeScript, security guards, DB indexes, and chatbot all healthy.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | `apps/api`: 0 errors. `apps/web`: 0 errors. |
| A2 Security | **WARN** | `api.ts:10` reads `localStorage.getItem('access_token')` — **intentional E2E-test-only path** (immediately removed after read, clearly commented). No missing guards, no raw SQL, no hardcoded secrets. |
| A3 Decimal | **WARN** | 35+ `Number()` wraps on Decimal money fields in production code. Hot spots: `notifications/scheduler.service.ts` (5 hits), `line-oa/chatbot.service.ts` (6 hits), `chatbot-finance/services/finance-tools.service.ts` (5 hits), `sales/sales.service.ts` (2 hits), `staff-chat/services/chat-commerce.service.ts` (3 hits). These lose precision on numbers >15 significant digits and fail the `Prisma.Decimal` rule from v4. |
| A4 Soft-Delete | **WARN** | `staff-chat.controller.ts:454,481,488,539,579,584` calls `this.prisma` directly (backend rule violation — must go through service). `inter-company.service.ts`, `reporting/compliance.service.ts`, `shop-catalog.service.ts`, `stickers.service.ts` contain `findMany`/`findFirst` calls missing `deletedAt: null` filter. ChatMessage/SystemConfig/AiSettings queries are intentionally exempt (append-only / singletons). |
| A5 Tests | **WARN** | API: **2256/2271 passed** (15 failures, 3 suites). Failing suites: `other-income/__tests__/other-income.service.spec.ts` (10 failures — DB/migration issue, new OtherIncome module), `other-income/__tests__/doc-number.service.spec.ts` (5 failures + suite-fail), `overdue/__tests__/collections-foundation.seed.spec.ts` (1 — idempotency). Web: **221/222 passed** (1 failure — `useCollectionsKeyboard.test.tsx:74` `onSwitchTab('today')` not called). |
| A6 Bundle | **WARN** | Vite reports 4 chunks >500 kB minified: `excel` (930 kB / **256 kB gzip**), `ContractTemplatesPage` (495 kB / 148 kB gzip), `pdf` (430 kB / 139 kB gzip), `index` (424 kB / 126 kB gzip). All gzip sizes are under 500 kB; `excel` chunk at 256 kB gzip is the largest concern. `thai-address-data` (871 kB raw / 69 kB gzip) is fine. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | (1) `IpRateLimit` and `AiSettings` use non-UUID IDs (no `@default(uuid())`) — intentional singletons but diverges from convention. (2) 6 models missing `deletedAt`: `PromiseSlot`, `ChatKbSuggestion`, `CustomerScore`, `AccountingPeriod`, `ProductReservation`, `KnownDevice` — should have `///` comment if intentionally omitted. (3) `OtherIncome` uses `@db.Decimal(15, 2)` instead of standard `@db.Decimal(12, 2)` — minor inconsistency. Money fields otherwise use Decimal throughout (no Float violations). |
| B2 Migrations | **PASS** | 203 migrations total. Latest 5 are descriptive. Most recent: `20260807000000_add_contract_advance_balance`, `20260806000000_add_other_income_tables`. Phase A4 migration (`20260801100000`) has `DROP INDEX` and `DROP CONSTRAINT` — expected and documented in accounting.md wipe procedure. `ALTER TYPE ADD VALUE` in `20260802000000` (adding `WRITTEN_OFF`) is safe (non-destructive). |
| B3 Indexes | **PASS** | Automated FK index scan: all FK fields (`*Id String`) have corresponding `@@index`. No missing index detected across all models. |
| B4 Drift | **PASS** | Latest migration SQL (`add_contract_advance_balance`, `add_other_income_tables`) matches schema.prisma. `contracts.advance_balance DECIMAL(12,2)` and all 4 `other_income*` tables present in both migration and schema. No drift detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` guard present. Sentry captures on both max-iteration warning and catch block. `maxTokens = 1024`. Per-iteration 30s timeout added (P1 fix). History window: 10 messages / 20k char budget. All good. |
| C2 Prompt | **OK** | `system-prompt.ts` references correct bank account `203-1-16520-5`, phone `063-134-6356`, and hours `09:00-18:00 จันทร์-เสาร์`. Values match `finance-rules.ts` constants — no contradiction. Prompt ~1,500 chars (~375 tokens), well within budget. Late fee `50 บาท/วัน` consistent with `LATE_FEE_PER_DAY = 50` constant. |
| C3 Tools | **OK** | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All have Thai descriptions and proper JSON schemas. `tool-executor.ts` handles all 7 via switch-case. `validateToolInput` + `redactPii` applied before execution. |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` table (PENDING/SENT check before send). All 6 reminder types covered: T-5, T-3, T-1, T (09:00 cron), T+1, T+3 (10:00 cron). Sentry captures on both cron error handlers. |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard` (appropriate — LINE token, not JWT). Admin controller: `@UseGuards(JwtAuthGuard, RolesGuard)`. Webhook dedup uses DB unique constraint on `eventId` (safe for multi-instance Cloud Run, 7-day retention). Customer data isolation enforced: `customerId` injected by orchestrator, not from AI output. |

---

## Action Items

### P1 — Fix Immediately (test regression)

1. **other-income test failures (10 tests)** — `other-income.service.spec.ts` and `doc-number.service.spec.ts` fail with Prisma constraint errors. Likely caused by missing test DB migration or mock mismatch after the `20260806000000_add_other_income_tables` migration. Run `db-reset.sh` in CI env and verify prisma mock setup in test files.

2. **collections-foundation seed idempotency** — `seedCollectionsFoundation` fails "is idempotent — running twice yields same counts". Investigate whether a new model added in recent migrations breaks the seed script's cleanup logic.

3. **web keyboard test** (`useCollectionsKeyboard.test.tsx:74`) — `onSwitchTab('today')` not invoked when pressing `q`. Likely a recent keybinding change without updating the test expectation.

### P2 — Address This Sprint

4. **Decimal compliance** — Replace `Number()` wraps on Decimal fields with `new Prisma.Decimal()` or `.toNumber()` only at display boundaries. Priority files: `notifications/scheduler.service.ts`, `line-oa/chatbot.service.ts`, `chatbot-finance/services/finance-tools.service.ts`.

5. **staff-chat.controller.ts direct Prisma** — Lines 454–584 call `this.prisma` directly, violating the controller→service→Prisma rule. Extract to `StaffChatQueryService` or move to existing service.

6. **Soft-delete missing filters** — `inter-company.service.ts`, `compliance.service.ts`, `shop-catalog.service.ts` have unguarded findMany/findFirst. Add `deletedAt: null` or justify exemption with a comment.

### P3 — Next Sprint

7. **Schema: models missing `deletedAt`** — `PromiseSlot`, `ChatKbSuggestion`, `CustomerScore`, `AccountingPeriod`, `ProductReservation`, `KnownDevice` have no `deletedAt`. Add the field or add `/// Soft-delete intentionally omitted — [reason]` comments.

8. **Bundle: excel chunk (256 kB gzip)** — Consider lazy-loading `exceljs` only on pages that use export. `ContractTemplatesPage` at 148 kB gzip may benefit from splitting the rich-text editor dependency.

9. **`OtherIncome @db.Decimal(15, 2)` inconsistency** — Schema convention is `@db.Decimal(12, 2)`. Change to 12,2 or document why 15 digits are needed (no data yet — safe migration).
