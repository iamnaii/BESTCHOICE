# CTO Watchdog Report — 2026-05-21

## Summary
9/15 checks clean (PASS/OK) · 2 FAIL (TS errors, test regressions) · 4 WARN (security docs, Decimal, soft-delete, bundle)

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors — `@prisma/client-finance` module missing; `PrismaFinanceService.$connect`, `.$disconnect`, `.$queryRaw`, `.healthCheck` not resolving. Affects `health.controller.ts` and `prisma-finance.service.spec.ts`. Web: 0 errors. |
| A2 Security | **WARN** | 5 controllers lack `@UseGuards` but are NOT on the `security.md` allowed-public list. All have alternative security (HMAC or shared-secret), but documentation gap creates confusion: `staff-chat/web-widget.controller.ts` (anonymous visitors), `line-oa/line-login.controller.ts` (LINE OAuth redirect), `metrics/metrics.controller.ts` (`@Public` + `X-Metrics-Token` secret header), `yeastar/yeastar-webhook.controller.ts` (HMAC-SHA256), `chat-adapters/facebook-webhook.controller.ts` (HMAC-SHA256). No JWT tokens found in `localStorage`/`sessionStorage`. No hardcoded secrets found. No raw SQL without parameterization found. |
| A3 Decimal | **WARN** | 156 `Number(` casts on money fields across service files. Key offenders: `sales.service.ts:286,579` (costPrice), `repossessions.service.ts:136–137` (sellingPrice, financedAmount), `purchase-orders.service.ts:248–249,563,741` (netAmount, unitPrice), `finance-receivable.service.ts:129` (netExpectedAmount), `line-oa/chatbot.service.ts:151–215` (amountDue, amountPaid). `Number()` round-trips silently truncate Decimal precision on large amounts. |
| A4 Soft-Delete | **WARN** | Queries missing `deletedAt: null` found in: `contracts/contract-document.service.ts:67,143` (`contract.findMany`), `contracts/contracts.service.ts:256,1060,1091` (contract/payment findMany), `contracts/documents.service.ts:31,421,534` (contractTemplate findMany), `staff-chat/services/staff-message.service.ts:29,40` (chatNote, cannedResponse findMany), `inter-company/inter-company.service.ts:181,281,386` (interCompanyTransaction findMany), `reporting/compliance.service.ts:61,97` (contract, legalCase findMany). Several may be intentional (audit/reporting queries). |
| A5 Tests | **FAIL** | API: 3,517 passed / **144 failed** / 3,669 total (14 failing suites). Root causes: (1) `prisma-finance.service.spec.ts` — `@prisma/client-finance` module missing (same as A1); (2) `asset/__tests__/asset.service.spec.ts` and related asset/other-income/depreciation suites — DB not available in test env (`prisma.fixedAsset` undefined at setup); (3) `overdue/__tests__/collections-foundation.seed.spec.ts` — DB connectivity. These are integration test failures, not unit test failures. Web: 516 passed / **8 failed** / 524 total (2 files). Root causes: `useAssetCalculation.test.ts` — `QueryClientProvider` not wrapped in test setup; `AssetsListPage.statcards.test.tsx` — related. |
| A6 Bundle | **WARN** | Build succeeds. No chunks exceed 500 kB gzip. Two chunks exceed 500 kB raw (Vite warning): `excel-Kg_E4bP1.js` 929.91 kB raw / **256.44 kB gzip**, `thai-address-data-D748eHHh.js` 870.87 kB raw / **69.29 kB gzip** (data file, compresses well). `ContractTemplatesPage` 495.95 kB raw / 147.76 kB gzip approaching threshold. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | 182 models, 181 with `deletedAt` (1 exception documented as immutable audit log). All IDs are UUID. `Float` used only for non-money fields (GPS lat/lng, ML confidence scores, bot thresholds) — correct. Enums follow PascalCase/SCREAMING_SNAKE_CASE convention. 480 indexes across 182 models. |
| B2 Migrations | **PASS** | 263 migrations total. Latest 5: `customer_national_id_nullable`, `ai_auto_reply_logs_add_metadata`, `customer_acquisition_source`, `customer_acquisition_source_constraint` — all descriptive, safe ALTER/CREATE INDEX only. No destructive `DROP TABLE` or `ALTER TYPE` in recent migrations. |
| B3 Indexes | **PASS** | 480 indexes / 182 models = ~2.6 indexes per model. FK fields and status fields on high-traffic models (Contract, Payment, Customer) appear well covered. No obvious missing indexes on the key query paths. |
| B4 Drift | **PASS** | Latest migration (`20260959`) adds partial index `customers_acquisition_source_active_idx WHERE acquisition_source IS NOT NULL` — consistent with schema pattern for low-cardinality partial indexes. No drift detected between migration SQL and schema.prisma. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` guard present. `maxTokens = 1024`. `Sentry.captureException` on Claude errors and `Sentry.captureMessage` on iteration limit. History window: last 10 messages, 20k char budget. Prompt caching: 5-minute in-memory cache with DB fallback. |
| C2 Prompt | **OK** | `finance-rules.ts` is single source of truth for bank account (`203-1-16520-5`, กสิกรไทย, บจก.เบสท์ช้อยส์โฟน), phone (`063-134-6356`), business hours (Mon–Sat 09:00–18:00). No contradictions between constants and prompt. Prompt loaded dynamically from DB with 5-min cache — owner can update without redeploy. |
| C3 Tools | **OK** | 7 tools defined with Thai descriptions: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All handled in `tool-executor.ts` switch. Customer data isolation: `customerId` injected by orchestrator, not exposed to Claude input schema — Claude cannot access another customer's data. |
| C4 Auto-Trigger | **OK** | All 6 types covered: T-5, T-3, T-1, T (`runDailyReminders` 09:00), T+1, T+3 (`runDailyEscalations` 10:00). Idempotency: `ChatAutoTrigger` table with PENDING/SENT marker checked before send. `Sentry.captureException` on both crons. `deletedAt: null` filter on payment/contract queries. |
| C5 Security | **OK** | LIFF controller: `@UseGuards(LiffTokenGuard)` (not raw JWT — correct for LIFF). Admin controller: `@UseGuards(JwtAuthGuard, RolesGuard)`. Webhook dedup: DB-based unique constraint on `eventId` — replay-safe across Cloud Run instances. Customer isolation: orchestrator injects `customerId`, Claude cannot override. |

---

## Action Items

### CRITICAL

1. **[A1] Fix `@prisma/client-finance` module** — `PrismaFinanceService` fails to compile because `@prisma/client-finance` is missing. Check if a second Prisma client was intended and the `prisma generate` step for it was not run, or if the service should extend the main `PrismaClient`. Blocks health endpoint and causes 7 TS errors.
   - File: `apps/api/src/prisma/prisma-finance.service.ts`

2. **[A5] Fix web test missing QueryClientProvider wrapper** — `useAssetCalculation.test.ts` calls `useQuery` without a `QueryClientProvider`. Add `createWrapper()` helper with `QueryClient` in the test file's `renderHook` call (same pattern used elsewhere in the codebase).
   - Files: `apps/web/src/pages/assets/hooks/useAssetCalculation.test.ts`, `apps/web/src/pages/assets/__tests__/AssetsListPage.statcards.test.tsx`

### HIGH

3. **[A3] Eliminate `Number()` casts on Decimal money fields** — 156 violations. Priority targets where arithmetic follows the cast (risk of precision loss): `sales.service.ts` (costPrice arithmetic), `repossessions.service.ts` (preview calculation), `purchase-orders.service.ts` (paidAmount guard), `finance-receivable.service.ts`. Presentation-only casts (`.toLocaleString`) are lower risk but should use `new Prisma.Decimal(x).toFixed(2)` pattern.

4. **[A2] Add 5 controllers to security.md allowed-public list** — `web-widget`, `line-login`, `metrics`, `yeastar-webhook`, `facebook-webhook` all have legitimate alternative security but are undocumented. Update `apps/api/.claude/rules/security.md` section "Intentionally Public Endpoints" to avoid false-positive security alerts in future audits.

### MEDIUM

5. **[A4] Audit soft-delete gaps in contracts and reporting services** — Verify that `contract-document.service.ts:67`, `contracts.service.ts:256` (active-contracts query), and `compliance.service.ts:61` either intentionally include soft-deleted records (add comment) or add `deletedAt: null` filters. The `inter-company` and `staff-chat` service gaps are lower risk but should be reviewed.

6. **[A5] Fix API integration test infrastructure** — 12 of 14 failing suites are asset/other-income/depreciation integration tests that require a live DB. In CI these should run against a test DB. Confirm `DATABASE_URL` is set in the test environment, or add `@skip` decorators for integration suites and separate them from unit tests.

7. **[A6] Split `excel` chunk further** — `excel-Kg_E4bP1.js` at 930 kB raw (256 kB gzip) is the heaviest chunk. Consider dynamic `import()` on the export handler path so the chunk only loads when the user triggers an Excel download, not on page load.

### LOW

8. **[A6] Investigate ContractTemplatesPage size** — At 496 kB raw it is approaching the 500 kB warning threshold. Likely includes a rich-text editor (TipTap/QuillJS). Pre-emptively lazy-load the editor component.
