# CTO Watchdog Report — 2026-06-18

## Summary

**6/15 checks passed cleanly — 3 critical failures, 6 warnings.**

Critical path: The `@prisma/client-finance` module (SP7.7 entity-split WIP) is not generated, breaking the API TypeScript build (exit 1, 8 errors) and causing 145 API test failures across 14 suites. All three FAILs share this root cause or are independent regressions that need immediate attention.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 8 errors, exit 1. Root cause: `@prisma/client-finance` not generated (SP7.7 WIP). Affected: `src/prisma/prisma-finance.service.ts` (TS2307 module not found + 2 TS2339 property errors), `src/modules/health/health.controller.ts` (TS2345 type mismatch), `src/prisma/prisma-finance.service.spec.ts` (3 TS2339). Web TS: clean (exit 0). |
| A2 Security | **WARN** | 12 controllers not in `security.md` documented-exceptions list: `LineOaController`, `LineOaCampaignController` (all methods have method-level guards but no class-level guard — risky pattern), `LineOaChatbotController`, `LineOaPaymentController` (mixed: 2 public endpoints), `ChatbotFinanceController`, `CsatController`, `LineLoginController`, `FacebookWebhookController`, `MetricsController` (X-Metrics-Token gated), `WebWidgetController`, `YeastarWebhookController`, `ShopReservationController`. Also: 7 production files use `${lockKey}` direct interpolation in `$executeRawUnsafe` (advisory lock pattern — low injection risk but impure). No hardcoded secrets. localStorage `access_token` read in `api.ts:10` is safe (E2E bootstrap, immediately moved to memory and removed). |
| A3 Decimal | **FAIL** | 40+ files with `Number()` on money fields. Critical: `chatbot-finance/finance-tools.service.ts` (lines 55–213, amounts in arithmetic), `paysolutions-webhook.service.ts` (lines 661–706, payment crediting), `notifications/collections-notifier.service.ts` (lines 62–214, outstanding balance calc), `contracts/contract-lifecycle.service.ts` (lines 105–400). High: `data-audit/contract-trace.service.ts`, `accounting/receivables-report.service.ts`, `overdue/overdue-queries.service.ts`. Medium: `products/stock-overview.service.ts` (9 violations), `trade-in/*` (7 violations), `sales/sale-creation.service.ts`, `purchase-orders/po-receiving.service.ts`. Also: `parseFloat()` in `peak.service.ts` (lines 301–302, PEAK export). Previous v4 sprint cleaned `Number(_sum` — `Number(.*amount/price/cost` violations remain widespread. |
| A4 Soft-Delete | **WARN** | 30+ service files have no `deletedAt: null` guard. Most are legitimate exceptions (immutable logs, append-only events, token tables). Notable concerns: `auth.service.ts` (8 queries — suspended/locked user queries), `sale-creation.service.ts` (3 queries), `customer-access.service.ts` (4 queries), `chatbot-finance/finance-ai.service.ts` (1 query), `chatbot-finance/chat-room.service.ts` (3 queries). Many lack inline `///` comment documenting the intentional omission per `database.md` rule. |
| A5 Tests | **FAIL** | API: **145 failed / 5020 total (14 suites)** — root cause is `@prisma/client-finance` import (same as A1); all affected suites import modules that transitively depend on `PrismaFinanceService`. Web: **2 failed / 662 total** — `src/components/contacts/CreateContactModal.test.tsx` lines 113–115: `apiPostMock` not called (regression, independent of A1). Baseline (v4): 577 API / 129 web all passing. |
| A6 Bundle | **WARN** | No chunk exceeds 500KB gzipped (largest: `excel` 256KB gzip, `LettersPage` 219KB gzip). 4 chunks exceed 500KB raw: `excel-DI5aN8zZ.js` 929KB, `thai-address-data-D3RlJG_d.js` 870KB, `LettersPage-trntgqK6.js` 569KB, `ContractTemplatesPage-DuxAtTzw.js` 489KB. Vite build warns on these. Thai address data (870KB raw, 69KB gzip) compresses extremely well — not a real concern. LettersPage and ContractTemplatesPage are candidates for further code-splitting. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | No Float for money fields (all Float: GPS coords, AI confidence scores). All monetary fields use `Decimal @db.Decimal(12, 2)`. Enum naming correct throughout (PascalCase types, SCREAMING_SNAKE_CASE values). Minor: 4 models with non-uuid IDs are all legitimate (`CreditNoteDetail` uses FK-as-PK, `IpRateLimit` uses `ipHash`, `UserExpenseTemplate` uses composite PK, `AiSettings` uses `"singleton"` string). 4 models missing `deletedAt` without inline documentation: `AccountingPeriod`, `PartialPaymentLink`, `CustomerScore`, `ProductReservation`. |
| B2 Migrations | **PASS** | 279 migrations total. Latest: `20260972000000_journal_line_restrict_and_index` — descriptive, safe (FK RESTRICT + compound index). No `DROP TABLE` across all 279 migrations. Two unguarded `DROP COLUMN` in older migrations (`20260415000000`, `20260801100000`) — retroactively unfixable but low risk (migration ordering prevents failure scenario). One enum drop-and-recreate (`20260923000000`) correctly implemented with explicit transaction + lock timeout guard. |
| B3 Indexes | **WARN** | High-traffic models well-indexed: Contract (13 indexes incl. compound), Payment (8 indexes), JournalLine (3 + compound `journalEntryId+deletedAt` from latest migration), AuditLog, JournalEntry all good. Gap: `Repossession` model has only `status` and `createdAt` indexes — **missing FK indexes** on `contractId`, `productId`, `appraisedById`. The overdue workflow queries repossessions by contract frequently; sequential scans at scale. |
| B4 Drift | **PASS** | Latest migration matches `schema.prisma` exactly: `JournalLine.journalEntryId` has `onDelete: Restrict` in schema; `@@index([journalEntryId, deletedAt])` present. No drift detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` at line 23, enforced in loop. On exhaustion: `Sentry.captureMessage` with `level: 'warning'` (line 198). General catch: `Sentry.captureException` (line 208). `maxTokens: 1024`. Bonus: per-call HTTP timeout 30s via `{ timeout: 30_000 }`. |
| C2 Prompt | **WARN** | System prompt (~925 tokens, well under 4000 threshold). Business details present: bank account (`ธนาคารกสิกรไทย 203-1-16520-5`), phone (`063-134-6356`), hours (`จันทร์-เสาร์ 09:00-18:00`). No internal contradictions. **Triple source-of-truth risk**: values are hardcoded in `system-prompt.ts` AND in `finance-rules.ts` constants AND in `FinanceConfigService` (DB-backed). The `get_bank_info` tool reads from DB dynamically, but the system prompt hardcode takes precedence and will drift if owner updates via settings UI. |
| C3 Tools | **OK** | All 7 tools (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`) have Thai descriptions and proper `required[]` schemas. All 7 handled in `tool-executor.ts` switch/case (lines 67–110). `default` case returns safe error. Input validation + PII redaction on rejected inputs present. |
| C4 Auto-Trigger | **WARN** | Idempotency: DB unique constraint on `(customerId, referenceKey)` with P2002 catch — multi-instance safe. All 6 reminder types covered: T-5, T-3, T-1, T-day, T+1, T+3. Sentry at cron level (lines 62–65, 79–82). **Gap**: individual LINE push failures (line 239) log to DB as `FAILED` but do not fire `Sentry.captureException`. A LINE token expiry silently failing for one customer would not alert on-call. |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard` (LINE ID token server-side verification); `lineUserId` set by guard, not client body (IDOR-safe). Admin controller has class-level `@UseGuards(JwtAuthGuard, RolesGuard)`. Webhook dedup: `ProcessedWebhookEvent` with unique `eventId` constraint + 7-day retention cron. Customer isolation: `customerId` injected by orchestrator, absent from all tool input schemas — Claude cannot override. |

---

## Action Items

### Critical (fix before next deploy)

1. **Generate `@prisma/client-finance` OR gate the import** — `src/prisma/prisma-finance.service.ts` imports `@prisma/client-finance` which does not exist. Either run `npx prisma generate --schema=prisma/schema-finance.prisma` (if a second schema exists) or wrap the import in a feature flag / move SP7.7 work to a feature branch. This unblocks A1 (8 TS errors) and A5 (145 API test failures) simultaneously.

2. **Fix `CreateContactModal` web test regression** — `src/components/contacts/CreateContactModal.test.tsx:115` expects `apiPostMock` to be called once but it isn't. Likely a recent change to the modal's submit flow broke the test. Fix the test or the component behavior. (Independent of A1.)

### High (this sprint)

3. **Decimal compliance sweep — critical services first** — Convert `Number()` on `Prisma.Decimal` fields to `new Prisma.Decimal(x)` or `.toNumber()` only at serialization boundaries. Priority files: `chatbot-finance/finance-tools.service.ts` (payment arithmetic), `paysolutions/paysolutions-webhook.service.ts` (payment crediting), `notifications/collections-notifier.service.ts`, `contracts/contract-lifecycle.service.ts`.

4. **Add class-level guards to `LineOaController` and `LineOaCampaignController`** — Every method already has method-level `@UseGuards(JwtAuthGuard, RolesGuard)`. Adding class-level guard is a 2-line change per controller that prevents a future accidental unguarded method.

5. **Add Repossession FK indexes** — `@@index([contractId])`, `@@index([productId])`, `@@index([appraisedById])` in `schema.prisma`. Overdue workflow queries repossessions by contract ID frequently.

### Medium (next sprint)

6. **Update `security.md` public-exceptions list** — Document the 12 controllers currently missing from the list: `LineOaChatbot`, `LineOaPayment` (2 public endpoints), `ChatbotFinance` (webhook), `Csat` (submit), `LineLogin`, `FacebookWebhook`, `Metrics`, `WebWidget`, `YeastarWebhook`, `ShopReservation`. Prevents false alarms on future security scans.

7. **Add `deletedAt` to 4 business models** — `AccountingPeriod`, `PartialPaymentLink`, `CustomerScore`, `ProductReservation`. Or add `///` documentation comment explaining intentional omission per `database.md` exception pattern.

8. **Add Sentry capture for individual chatbot push failures** — In `auto-trigger.service.ts` line 239, wrap push-send failures with `Sentry.captureException` so LINE token expiry for a single customer surfaces in alerts.

### Low (backlog)

9. **Resolve chatbot triple source-of-truth** — Consider removing hardcoded bank/phone/hours from `system-prompt.ts` and always reading from `FinanceConfigService`. Prevents silent drift if owner updates via settings.

10. **Investigate `deletedAt: null` gaps in `auth.service.ts`** — 8 queries without soft-delete filter. Verify suspended/locked users can't log in via a stale query path.

11. **LettersPage bundle split** — 569KB raw / 219KB gzip. If letter generation (jspdf) is lazy, split the pdf generation into a dynamic import.

---

*Run duration: ~8 min | Tools: tsc (API+Web), jest (API), vitest (Web), vite build, grep, static analysis*
*Next scheduled run: 2026-06-19 (daily)*
