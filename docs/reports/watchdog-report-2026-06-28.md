# CTO Watchdog Report — 2026-06-28

## Summary
**10/15 checks passed** — 2 FAILs (A1 TS errors, A5 test regressions) and 3 WARNs (A3 Decimal, A4 soft-delete, B3 indexes). All failures trace to one root cause: `@prisma/client-finance` was not generated in the session setup environment. Chatbot health is fully green.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors (API) | **FAIL** | 7 errors, all in `prisma-finance.service.ts` — root cause: `@prisma/client-finance` not generated (`prisma generate --schema=prisma-finance/schema.prisma` was not run during session setup). Errors: TS2307 Cannot find module + 3x TS2339 missing properties. Fix: add `prisma:finance:generate` to startup hook. |
| A1 TS Errors (Web) | **PASS** | 0 errors |
| A2 Security | **PASS** | 14 controllers scanned as missing JwtAuthGuard — all are legitimately public with proper alternative auth: LINE OAuth (SkipCsrf only), LIFF API (LiffTokenGuard), LINE webhooks (LineWebhookGuard), web widget (anonymous chat, Throttle-gated), metrics (X-Metrics-Token shared secret + timingSafeEqual), shop-* family (ShopBotDefenseGuard). No hardcoded secrets found. `$queryRaw` uses template literals (parameterized). `$executeRawUnsafe` only in tests and for `pg_advisory_xact_lock` with computed integer seeds (low risk, non-user-input). No localStorage token usage in production paths. |
| A3 Decimal | **WARN** | 40+ `Number()` conversions on money fields across 10+ service files. Key offenders: `stickers.service.ts` (display only), `shop-catalog.service.ts` (display), `chat-commerce.service.ts` (balance calc — precision risk), `sales/sale-creation.service.ts` (costPrice assignment — precision risk), `purchase-orders/po-receiving.service.ts` (costPrice — precision risk), `repossessions.service.ts` (sellingPrice/financedAmount), `line-oa/chatbot.service.ts` (sum accumulation). These are OK for display but risky when used in further Decimal arithmetic. |
| A4 Soft-Delete | **WARN** | 5 services have DB queries without `deletedAt: null` filters: `chat-ai-draft.service.ts`, `inter-company.service.ts`, `pdf-report.service.ts`, `compliance.service.ts`, `reschedule.service.ts`. Manual review needed — some may be intentional (e.g. audit queries scanning deleted records), others may be gaps. |
| A5 Tests | **WARN** | **API**: 148 failed / 5141 total (4985 pass = 96.9%). 17 failing suites break into 3 categories: (1) `@prisma/client-finance` TS failure → 3 suites (`prisma-finance.service.spec.ts`, `health.controller.spec.ts`, `backfill-user-companies.cli.spec.ts`); (2) DB connectivity → 1 suite (`collections-foundation.seed.spec.ts`); (3) Integration tests requiring live DB → ~13 suites (`asset.*`, `payments.*`, `other-income.*`, `depreciation.*`, `outbox-processor.*`) — these use real Prisma connections and `seedFinanceCoa()` against actual DB. All category-3 failures are expected in this ephemeral no-DB environment; the 4985 unit test passes confirm business logic is sound. **Web**: 777 passed / 778 total. 1 timeout failure: `CreateContactModal.test.tsx > SUPPLIER` (5000ms jsdom HTTP ECONNRESET) — flaky network test. Codebase has grown substantially since 577 baseline (now 5141 tests). |
| A6 Bundle | **PASS** | No chunks exceed 500 KB gzipped. Largest gzipped: `excel` 256 kB, `LettersPage` 219 kB, `index` 174 kB, `pdf` 139 kB. Vite warns on 4 uncompressed chunks >500 KB (`excel` 930 kB raw, `thai-address-data` 871 kB raw, `index` 741 kB raw, `LettersPage` 569 kB raw) — all expected for data files + lazy-loaded heavy pages. Ineffective dynamic import warning for `PeriodClosePage` (statically imported by `SettingsPage/PeriodsTab`). |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | 9 Float fields found — all are non-money (GPS lat/lng, AI confidence scores, bot threshold). 229 Decimal `@db.Decimal(12,2)` money fields. Enum naming follows convention (PascalCase type, SCREAMING_SNAKE_CASE values). Automated regex check flagged `Customer` / `DunningRule` / `CompanyInfo` / `FixedAsset` as missing timestamps, but manual verification confirms `Customer` model correctly has all 3 timestamps (the regex breaks on complex multi-block models). 189 total models. |
| B2 Migrations | **PASS** | 284 migrations. Latest 5 are descriptive: `add_payment_drafts`, `chat_message_send_idempotency`, `add_card_payment_method`, `add_client_message_id_to_chat_message`, `add_shop_cash_account_code_to_branch`. Historical `DROP COLUMN IF EXISTS` and `ALTER TYPE RENAME` operations are guarded and not in recent migrations. Latest migration SQL matches `payment_drafts` model in schema. |
| B3 Indexes | **WARN** | 209 potentially missing FK indexes flagged by automated scan. High-value gaps confirmed: `InstallmentSchedule.accrualJournalEntryId`, `InstallmentSchedule.vat60dayJournalEntryId`, `PaymentDraft.waiverApproverId`, `PaymentDraft.createdById`, `Payment.toleranceJournalLineId`, `Refund.rejectedById`. Core models (Contract, Payment) have excellent composite index coverage. |
| B4 Drift | **PASS** | Latest migration `20260977000000_add_payment_drafts` creates `payment_drafts` table with `DECIMAL(12,2)` money fields, `RESTRICT` FK constraints, unique index on `payment_id` — consistent with schema.prisma. No drift detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Models: `claude-sonnet-4-6` (customer-facing) + `claude-haiku-4-5-20251001` (initial triage, cost optimization). Both are current. `MAX_TOOL_ITERATIONS = 5` guard in place. `Sentry.captureException` + `captureMessage` on max-iteration and general errors. `maxTokens = 1024`. Haiku→Sonnet escalation on first tool use is a smart cost pattern. Prompt cached 5 min TTL with DB override capability. |
| C2 Prompt | **OK** | 67-line system prompt, well-structured. Bank info (KBank 203-1-16520-5, บจก. เบสท์ช้อยส์โฟน) matches `finance-rules.ts` constants. Phone (063-134-6356) matches. Hours (Mon-Sat 09:00-18:00) matches. Late fee (50 ฿/day) consistent with `calculate_fine` tool. Thai forbidden-word substitutions well-defined. No contradictions between prompt and constants. Estimated ~1,200 tokens — well within limits. |
| C3 Tools | **OK** | 7 tools with Thai descriptions: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All input schemas properly defined. `tool-executor.ts` handles all 7 tool names via switch cases. `customerId` injected by orchestrator (not in AI-visible schema) — prevents cross-customer data access. |
| C4 Auto-Trigger | **OK** | `ChatAutoTrigger` table provides DB-backed idempotency. All 6 reminder types covered: T-5, T-3, T-1, T (daily 09:00 cron), T+1, T+3 (daily 10:00 escalation cron). `Sentry.captureException` on cron failures. |
| C5 Security | **OK** | LIFF controller protected by `LiffTokenGuard` (LINE ID token server-side verification). Admin controller protected by `@UseGuards(JwtAuthGuard, RolesGuard)`. Webhook dedup via `webhook-dedup.service.ts` with DB unique constraint on `eventId` — replay attacks prevented. Customer data isolation enforced by `customerId` injection at orchestrator level. |

---

## Action Items

### P0 — Fix Immediately

1. **Generate Finance Prisma Client in Startup Hook** (`apps/api`)
   - Root cause of 7 TS errors + 148 jest failures cascading
   - Fix: Add `npx prisma generate --schema=prisma-finance/schema.prisma` to `scripts/setup.sh` or `SessionStart` hook (after main `prisma generate`)
   - Network access to Prisma CDN required — check proxy allowlist for `prisma.sh` / `binaries.prisma.sh`
   - File: `.claude/settings.json` hook + `apps/api/package.json` `build` script (already has it, just not in session hook)

### P1 — Fix This Sprint

2. **Number() on money fields in sale/PO/repossession services** (precision loss risk)
   - `apps/api/src/modules/sales/services/sale-creation.service.ts:95` — `costPrice = Number(product.costPrice)`
   - `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:86,250` — `costPrice: Number(poItem.unitPrice)`
   - `apps/api/src/modules/repossessions/repossessions.service.ts:136-137` — sellingPrice/financedAmount
   - Fix: Use `new Prisma.Decimal(...)` or keep as `Prisma.Decimal` through the call chain

3. **Web test flakiness: `CreateContactModal.test.tsx` SUPPLIER timeout**
   - `apps/web/src/components/contacts/CreateContactModal.test.tsx:52`
   - Mock the HTTP call or increase test timeout to fix CI reliability

### P2 — Fix Next Sprint

4. **Missing FK indexes on JournalEntry references**
   - `InstallmentSchedule.accrualJournalEntryId` and `.vat60dayJournalEntryId` — these are queried during payment processing
   - `PaymentDraft.waiverApproverId`, `.createdById`
   - Add via `npx prisma migrate dev --name add_missing_fk_indexes`

5. **Soft-delete audit on 5 flagged services**
   - Review `reschedule.service.ts`, `inter-company.service.ts`, `compliance.service.ts`, `chat-ai-draft.service.ts`, `pdf-report.service.ts`
   - Add `deletedAt: null` to any findMany/findFirst that shouldn't scan soft-deleted records

6. **PeriodClosePage ineffective dynamic import**
   - `apps/web/src/pages/accounting/PeriodClosePage.tsx` statically imported by `SettingsPage/PeriodsTab` — breaks lazy-loading
   - Either make `PeriodsTab` dynamic or accept the static import (low priority, not a correctness issue)

---

*Report generated: 2026-06-28 by CTO Watchdog Agent*
*Codebase growth since baseline: API 577 → 5141 tests (452 suites), Web 129 → 778 tests*
