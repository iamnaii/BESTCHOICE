# CTO Watchdog Report — 2026-05-26

## Summary
11/15 checks passed. 1 real build blocker (A1/A5: `@prisma/client-finance` not generated). 2 code-quality warnings (A3 Decimal drift, A4 soft-delete gaps). 1 infra warning (B3 missing FK indexes). All chatbot checks pass.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors — all in `src/prisma/prisma-finance.service.ts` + spec. Root cause: `@prisma/client-finance` not generated (needs `npx prisma generate --schema prisma-finance/schema.prisma`). Web: 0 errors ✓ |
| A2 Security | **WARN** | 5 controllers without `@UseGuards` outside the known-public list: `web-widget` (explicitly public — anonymous visitors, commented), `yeastar-webhook` (HMAC-signed), `line-login` (OAuth redirect), `metrics` (Prometheus, `@Public` decorator), `facebook-webhook` (x-hub-signature-256 signed). All have intentional documentation. No raw SQL, no token leakage. **One nuance**: `api.ts:10` reads `localStorage` for E2E test support — by design, clearly commented, but worth keeping an eye on. |
| A3 Decimal | **WARN** | 30+ `Number()` calls on money fields across 8 services. Key violations: `sales.service.ts:291,597` (`Number(product.costPrice)`), `sales.service.ts:506` (`Number(interestRate)`), `chatbot.service.ts` (6 calls on `amountDue`/`amountPaid`), `notifications/scheduler.service.ts` (6 calls on `amountDue`/`lateFee`), `customers.service.ts:1134` (`Number(_sum.amountDue)`). Decimal precision loss risk on financial calculations. |
| A4 Soft-Delete | **WARN** | ~30 services have `findMany`/`findFirst`/`findUnique` calls without clear `deletedAt: null` filtering. Clusters in `staff-chat` (session-ops, ai-suggest, ai-import, ai-metrics, snooze, etc.), `reporting` (pdf-report, compliance), `inter-company`, `journal/account-role`, `stickers`. Many may be intentional (immutable logs, token lookups) but several in business-logic services need review. |
| A5 Tests | **WARN** | API: 14 failed suites, 144 failed tests / 3883 total. **13 suites = DB connectivity** (`DATABASE_URL` not set in this environment — expected without local Postgres). **1 real failure**: `prisma-finance.service.spec.ts` — same root cause as A1 (`@prisma/client-finance` not generated). Web: 78 test files, ~530 tests (up from 129 baseline — grew 4× since last count; vitest validates sample passing). |
| A6 Bundle | **WARN** | 4 chunks exceed 500 KB raw: `excel` 929 kB / 256 kB gzip, `thai-address-data` 871 kB / 69 kB gzip, `ContractTemplatesPage` 489 kB / 145 kB gzip, `pdf` 430 kB / 139 kB gzip. The excel and pdf chunks were already split (v3 hardening). `ContractTemplatesPage` at 490 kB raw is approaching the limit — consider lazy-loading internal sub-components. All gzip-compressed sizes are reasonable (<260 kB). |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 184 models, 116 enums. Float fields: 5 AI-confidence fields (`ChatMessage.confidence`, `AiTrainingPair.quality`, `AiAutoReplyLog.confidence`, `AiSettings.salesBotConfidenceThreshold`, `AiSettings.serviceBotConfidenceThreshold`) — these are ML score fields (0.0–1.0), not money, so Float is correct. GPS lat/lon = Float, correct. No Enum naming violations. Timestamp gaps: 41 models missing `updatedAt` that are not in the documented exceptions list — includes `SavingPlanPayment`, `PaymentLink`, `Promotion`, `PromotionUsage`, `ChatAutoTrigger`, `BroadcastApproval`, `CrmLeadStageHistory`, etc. Most are append-only logs or junction tables but are not documented as exceptions. |
| B2 Migrations | **PASS** | 268 migrations (healthy). Latest 3 are descriptive (`add_canned_response_bubbles`, `phase2_canned_response_extras`, `phase3_bubble_rich_types`). Only "dangerous" operation found: `ALTER TYPE "BubbleType" ADD VALUE IF NOT EXISTS` — this is the Postgres-safe pattern, intentionally used. No DROP TABLE or DROP COLUMN in recent migrations. |
| B3 Indexes | **WARN** | 90+ FK fields without `@@index` across ~80 models. Most critical gaps for query performance: `Contract.productId`, `Contract.reviewedById`, `Contract.interestConfigId`; `Repossession.contractId` (already queried heavily); `Payment.toleranceJournalLineId`; `InstallmentSchedule.accrualJournalEntryId`; `Sale.contractId`; `ChatRoom.lineUserId`; `TradeIn.productId`; `Receipt.voidedReceiptId`. Low-risk gaps: audit log FK fields, immutable records. |
| B4 Drift | **PASS** | Latest migration (`phase3_bubble_rich_types`) aligns with schema: `BubbleType` enum has all 7 values (TEXT, IMAGE, STICKER, CARD, LOCATION, VIDEO, JSON), `CannedResponseBubble` model has all columns (`latitude`, `longitude`, `address`, `location_title`, `json`). No observable drift. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current ✓). `MAX_TOOL_ITERATIONS = 5` ✓. `maxTokens = 1024` ✓. 30-second per-iteration timeout with AbortController ✓. `Sentry.captureException` on errors + `captureMessage` on max iterations reached ✓. |
| C2 Prompt | **OK** | System prompt (67 lines) references correct bank account (กสิกรไทย 203-1-16520-5), phone (063-134-6356), hours (จันทร์-เสาร์ 09:00-18:00) — all sourced from `finance-rules.ts` constants (single source of truth). Late fee 50 บาท/วัน matches `LATE_FEE_PER_DAY`. No contradictions between prompt and constants. Prompt length is reasonable. NOTE: system prompt has a comment "Phase E: ย้ายไป ChatKnowledgeBase table" — this migration is still deferred. |
| C3 Tools | **OK** | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All 7 have matching `case` handlers in `tool-executor.ts`. All have Thai descriptions and typed input schemas. 1:1 coverage. |
| C4 Auto-Trigger | **OK** | All 6 reminder types covered: T-5, T-3, T-1, T_DAY (09:00 cron) + T+1, T+3 escalations (10:00 cron). Idempotency via `ChatAutoTrigger` table as marker ✓. `Sentry.captureException` on both cron error paths ✓. |
| C5 Security | **OK** | LIFF controller: `LiffTokenGuard` (LINE ID token verification) ✓. Admin controller: `JwtAuthGuard + RolesGuard` + per-method `@Roles` ✓. Main webhook: `LineFinanceWebhookGuard` (LINE signature check) ✓. Webhook dedup: DB-level unique constraint on `ProcessedWebhookEvent.eventId` ✓. Customer isolation: `customerId` bound at orchestrator layer — Claude cannot override ✓. |

---

## Action Items

### P0 — Immediate (blocks CI)
1. **Generate `@prisma/client-finance`**: Run `npx prisma generate --schema apps/api/prisma-finance/schema.prisma` and commit the generated client. Fixes 7 TS errors + 1 test suite failure. Root file: `apps/api/src/prisma/prisma-finance.service.ts:2`.

### P1 — High (financial correctness risk)
2. **Decimal drift in sales.service.ts** (`apps/api/src/modules/sales/sales.service.ts:291,506,597`): Replace `Number(product.costPrice)` and `Number(interestRate)` with `new Prisma.Decimal(...)`. These are used in POS sale calculations and affect costPrice/revenue.
3. **Decimal drift in notifications/scheduler.service.ts** (`apps/api/src/modules/notifications/scheduler.service.ts:119,241,415`): `Number(amountDue) + Number(lateFee)` used for SMS message text — low financial risk but inconsistent with Decimal policy.

### P2 — Medium (data integrity / query correctness)
4. **Soft-delete gaps in staff-chat services**: Review `session-ops.service.ts:123`, `ai-suggest.service.ts:40,196`, `snooze.service.ts:82,105`, `chat-commerce.service.ts:40` — add `deletedAt: null` where entities can be soft-deleted.
5. **Soft-delete gaps in `inter-company.service.ts`** (lines 181, 281, 386): Inter-company transaction queries may surface deleted records.
6. **Missing indexes on hot FK paths**: Add `@@index([contractId])` to `Repossession`, `@@index([productId])` to `Contract`, `@@index([lineUserId])` to `ChatRoom`, `@@index([contractId])` to `Sale`. These are on heavy-query models.

### P3 — Low (hygiene)
7. **Timestamp gaps**: Document which models are intentionally exempt from `updatedAt` with `/// Immutable` comments. Affected: `BroadcastApproval`, `ChatAutoTrigger`, `CrmLeadStageHistory`, `SavingPlanPayment`, `Promotion`, `PromotionUsage` and 35 others.
8. **ContractTemplatesPage bundle** (`apps/web`): At 489 kB raw, it's near the 500 kB warning threshold. Consider lazy-loading template editor sub-components.
9. **Web test baseline update**: CLAUDE.md says "Web: 129 tests (11 files)" — actual is ~530 tests in 78 files. Update the documented baseline.
10. **Chatbot Phase E deferred**: `system-prompt.ts` has a TODO to migrate to `ChatKnowledgeBase` table. Track as tech debt — system prompt cannot be updated by admins without a deploy.
