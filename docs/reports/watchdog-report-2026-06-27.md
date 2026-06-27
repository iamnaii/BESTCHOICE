# CTO Watchdog Report — 2026-06-27

## Summary
**11/15 checks passed** — 4 warnings require attention: API TS errors (incomplete SP7 feature), test regressions (1 web timeout + 148 API failures from missing package), and 40+ `Number()` Decimal leaks.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors — API | **FAIL** | 6 errors in `src/prisma/prisma-finance.service.ts` — `@prisma/client-finance` package is missing; SP7.1 dual-DB feature scaffolded but `npx prisma generate --schema=prisma/schema-finance.prisma` never run. All errors are in one file + its spec. |
| A1 TS Errors — Web | **PASS** | 0 errors |
| A2 Security | **PASS/WARN** | No critical issues. 7 controllers lack `JwtAuthGuard` but all have legitimate alternates: `LiffTokenGuard` (liff-api, chatbot-finance-liff), `LineWebhookGuard` (line-oa-chatbot), `ShopBotDefenseGuard` (shop-cart/shipping/tracking/auth-social/line-chat/reservation), metrics secret-header gate. `web-widget.controller.ts` is documented-public for anonymous visitors. `$executeRawUnsafe` calls are all parameterized `pg_advisory_xact_lock($1)` — safe. No token in localStorage (E2E-only exception in api.ts is bounded). No hardcoded secrets. |
| A3 Decimal | **WARN** | **40+ `Number()` calls on money fields** across: `chatbot-finance/services/finance-tools.service.ts` (lines 53,54,68,113,116,132,189), `line-oa/chatbot.service.ts` (lines 151,160,172,199,215), `sales/services/sale-writer.service.ts` (245,336), `shop-catalog/shop-catalog.service.ts` (95,136), `customers/services/customer-query.service.ts` (341), `notifications/services/notification-reminder.service.ts` (131). Several are display-only (`toLocaleString`), but arithmetic on `Decimal` results via `Number()` loses precision for large sums. |
| A4 Soft-Delete | **WARN** | 15 models lack `deletedAt`: `PromiseSlot`, `ExpenseLine`, `AccountRoleMap`, `ExpenseAdjustment`, `PayrollLine`, `PayrollCustomIncome/Deduction`, `SettlementLine`, `ChatKbSuggestion`, `CustomerScore`, `AccountingPeriod`, `ProductReservation`, `KnownDevice`, `AiSettings`, `PartialPaymentLink`. Some (AiSettings, AccountingPeriod) are singletons/append-only by design, but others (PromiseSlot, ExpenseLine) are business records that should support soft-delete. Raw count of findMany/findFirst without `deletedAt` filter: 911 (many in nested relations — not all are bugs). |
| A5 Tests | **WARN** | **API: 4985 pass / 148 fail / 5141 total** (17 suites failed — root causes: `@prisma/client-finance` missing causes compile-error on `backfill-user-companies.cli.spec.ts` + DB connection timeouts in integration specs that need a live DB). **Web: 777 pass / 1 fail / 778 total** — `CreateContactModal.test.tsx > SUPPLIER` timed out in 5000ms (jsdom network error; mock is correct, likely a form-element label mismatch after a UI change). Test counts grew significantly vs v4 baseline (API: 577→5141; Web: 129→778). |
| A6 Bundle | **WARN** | **7 chunks exceed 500KB** (gzip in parens): `excel` 929KB (256KB), `thai-address-data` 870KB (69KB), `index` 740KB (174KB), `LettersPage` 568KB (219KB), `ContractTemplatesPage` 489KB (145KB), `pdf` 430KB (139KB), `charts` 417KB (119KB), `CollectionsPage` 386KB (101KB). Vite warns about static import of `PeriodClosePage` cancelling its dynamic split. The `excel`, `pdf`, and `charts` chunks were already split in v3 — no regression, but `LettersPage` (219KB gzip) and `index` (174KB gzip) are new watch items. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS/WARN** | 189 models, 7384-line schema. Money fields correctly use `@db.Decimal(12, 2)` throughout. Float fields are non-monetary only (GPS coords: `gpsLatitude/gpsLongitude`, AI confidence thresholds: `salesBotConfidenceThreshold`, `confidence`). 15 models missing `deletedAt` (see A4). Enum naming conventions correct (PascalCase type, SCREAMING_SNAKE_CASE values). |
| B2 Migrations | **PASS** | 285 migrations, all descriptively named. Latest 5: `add_expense_vendor_supplier_fk`, `add_employee_profile`, `add_payroll_line_user_fk`, `remove_2fa`, `journal_line_restrict_and_index`. The `remove_2fa` migration uses `DROP COLUMN IF EXISTS` on 7 2FA-related columns — intentional removal, safe. No DROP TABLE on business-critical tables. No ALTER TYPE (enum changes) detected in recent migrations. |
| B3 Indexes | **PASS** | 504 `@@index` directives across 189 models — solid coverage. FK fields and status/date filter fields appear indexed in key modules (contracts, payments, journal_lines). No immediate gaps flagged in heavily-queried models. |
| B4 Schema Drift | **PASS** | Latest migrations align with schema changes. `prisma-finance.service.ts` imports from a non-existent `@prisma/client-finance` — but this is a code issue (A1), not a schema drift. Main `schema.prisma` is consistent with recent migrations. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model routing: `claude-haiku-4-5-20251001` for no-tool replies → escalates to `claude-sonnet-4-6` on first tool use (quality-over-cost). `MAX_TOOL_ITERATIONS = 5` guard present. `maxTokens = 1024`. Per-iteration 30s timeout. Sentry captures on error. Anthropic client lazy-init from `IntegrationConfig` (no hardcoded key). |
| C2 Prompt | **WARN** | Bank account (`203-1-16520-5`) and phone (`063-134-6356`) in system prompt **match** `finance-rules.ts` constants. Business hours correct (Mon–Sat 09:00–18:00). **Minor inconsistency**: tool description for `calculate_fine` hardcodes "50 บาท/วัน", but `finance-tools.service.ts` uses `resolveLateFee()` from SystemConfig dynamically — if the owner changes the rate in DB, the bot's stated rate becomes stale. System prompt also says "ค่าปรับล่าช้า: 50 บาท/วัน" with the same staleness risk. Prompt length is reasonable (~3.5KB). |
| C3 Tools | **OK** | 7 tools defined (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`). All have Thai descriptions. All handled in `tool-executor.ts` (cases verified). `customerId` injected by orchestrator — not in tool schema — Claude cannot cross-reference customers. |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` DB marker (checked before every send). All 6 types covered: T-5, T-3, T-1, T, T+1, T+3. Cron schedules: 09:00 BKK (reminders) and 10:00 BKK (escalations). Sentry captures on both cron methods. `late-fee` amount computed dynamically via `loadLateFeeConfig` + `resolveLateFee` in `processOffset`. |
| C5 Security | **OK** | `chatbot-finance-liff.controller.ts` protected by `LiffTokenGuard` (LINE ID token verified server-side). `chatbot-finance-admin.controller.ts` protected by `JwtAuthGuard + RolesGuard` (`OWNER`, `FINANCE_MANAGER`). Webhook dedup via `ProcessedWebhookEvent.eventId` unique constraint (DB-level, Cloud Run safe, 7-day retention cron). Customer data isolation enforced in `tool-executor.ts` — `customerId` from session context, not from Claude output. |

---

## Action Items

### P0 — Fix Immediately

1. **Generate `@prisma/client-finance`** — run `npx prisma generate --schema=apps/api/prisma/schema-finance.prisma` (or add the schema file if missing). This fixes all 6 API TS errors and unblocks `backfill-user-companies.cli.spec.ts`. Until fixed, the SP7.1 PrismaFinanceService fails to compile.

2. **Fix `CreateContactModal` web test timeout** — `apps/web/src/components/contacts/CreateContactModal.test.tsx:52` times out. Check if a form label (`getByLabelText(/เบอร์โทร/)` or similar) was renamed or the modal structure changed. One web test file is red in CI.

### P1 — Fix This Sprint

3. **Reduce `Number()` on Decimal arithmetic** — at minimum fix the arithmetic cases (not display) in `finance-tools.service.ts` (lines 53,54,113,116) and `line-oa/chatbot.service.ts` (lines 151,160,172,199,215). Use `new Prisma.Decimal(x).plus(y)` or `.toNumber()` only as a final presentation step.

4. **Add `deletedAt` to business record models** — `PromiseSlot` and `ExpenseLine` are soft-deletable business records. Add `deletedAt DateTime?` + migration, and update queries. `AiSettings` and `AccountingPeriod` can remain exempt with a `///` comment.

5. **Chatbot late-fee prompt staleness** — update `tool-definitions.ts` `calculate_fine` description and `system-prompt.ts` to say "ค่าปรับตามอัตราที่กำหนด" instead of hardcoding "50 บาท/วัน". The actual rate comes from `SystemConfig.late_fee_per_day_rate`.

### P2 — Watch / Plan

6. **Bundle size** — `LettersPage` (219KB gzip) and `ContractTemplatesPage` (145KB gzip) are the largest page-level chunks. Investigate lazy-loading heavy dependencies (letter PDF generation, jsPDF usage). The `PeriodClosePage` Vite warning about static import cancelling dynamic split should be fixed (remove the static import from `SettingsPage/tabs/PeriodsTab.tsx`).

7. **API test infrastructure** — 148 failing tests, mostly integration tests requiring live DB. Consider splitting test suites: unit (no DB) vs integration (requires DB) so CI can gate on unit tests reliably. The `@prisma/client-finance` fix (P0 above) will resolve one suite.

8. **Security notes-to-watch** — `web-widget.controller.ts` is fully public for anonymous website visitors. Confirm it only serves display-safe data (no customer PII, no financial records). A brief code review is recommended.
