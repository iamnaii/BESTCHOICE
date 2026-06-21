# CTO Watchdog Report — 2026-06-21

## Summary
7/15 checks PASS · 6 WARN · 2 FAIL — **Critical blocker: `@prisma/client-finance` not generated (SP7 regression); causes 7 TS errors + cascading test failures.**

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors (all from `@prisma/client-finance` missing — `PrismaFinanceService` extends `PrismaClient` from package that was never generated). Web: 0 errors ✅ |
| A2 Security | WARN | 16 controllers lack `@UseGuards(JwtAuthGuard)`. All are intentionally public, but 9 newer shop-\* modules (`shop-cart`, `shop-checkout`, `shop-shipping`, `shop-reservation`, `shop-tracking`, `shop-auth-social`, `shop-line-chat`, `shop-buyback`, `staff-chat/web-widget`) are **absent from `security.md` allowlist** — allowlist needs updating. `metrics` uses `@Public()` + `METRICS_SCRAPE_TOKEN` (safe). `line-oa-chatbot` uses `LineWebhookGuard` (safe). No unguarded sensitive endpoints found. Raw `$queryRaw` found in 12 services — all use template literals (parameterized, safe). `localStorage` touched only in E2E test helper path in `api.ts` (non-production branch, safe). No hardcoded secrets detected. |
| A3 Decimal | WARN | 30+ `Number()` calls near money fields across 8+ services: `stickers.service`, `shop-catalog.service`, `line-oa/chatbot.service`, `sales/sale-writer.service`, `sales/sale-creation.service`, `staff-chat/chat-commerce.service`, `purchase-orders/po-receiving.service`, `repossessions.service`, `crm/customer-scoring.service`. None are in journal/payment core (v4 cleaned that up) but precision loss risk on display/calculation paths. |
| A4 Soft-Delete | WARN | 20 services have `findMany`/`findFirst`/`findUnique` calls with no `deletedAt: null` filter (filtered for non-audit/log/analytics files). Key services: `shop-cart.service`, `shop-checkout.service`, `trade-in/voucher.service`, `chatbot-finance.service`, `credit-check-ai-analysis.service`, `credit-check-override.service`. Could return soft-deleted records to the UI. |
| A5 Tests | **FAIL** | **API**: 145 failed / 4867 passed (5020 total), 14 suites failed. Root causes: (1) `@prisma/client-finance` TS error cascades through `backfill-user-companies.cli.spec.ts` and any module importing `PrismaFinanceService`; (2) DB-connection failures in integration/seed tests against an unprovisioned `DATABASE_URL_FINANCE`. **Web Vitest**: 1 failed / 661 passed (662 total) — same `@prisma/client-finance` root cause. Baseline was 577 API / 129 web; counts have grown (469 API spec files, 98 web) but failures are a regression. |
| A6 Bundle | WARN | 5 chunks exceed 500KB raw. Gzip sizes: `excel` 256 KB, `LettersPage` **220 KB** (largest concern — no obvious split point), `pdf` 139 KB, `ContractTemplatesPage` 145 KB, `thai-address-data` 69 KB (data file — can lazy-load). Vite warns on `excel`, `LettersPage`, `thai-address-data`, `pdf`, `ContractTemplatesPage`. `index.es` (recharts/radix, 49 KB gzip) and `vendor` (70 KB gzip) are within acceptable range. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | WARN | **7 models missing UUID `@default(uuid())`**: `ExpenseDetail`, `CreditNoteDetail`, `PayrollDetail`, `VendorSettlementDetail`, `UserExpenseTemplate`, `IpRateLimit`, `AiSettings` — likely using composite PKs or autoincrement. **10 models missing `updatedAt`**: `Customer`, `DunningRule`, `SavingPlanPayment`, `CompanyInfo`, `FixedAsset`, `AssetTransferHistory`, `DepreciationEntry`, `PaymentLink`, `SlipFingerprint`, `FeeWaiverApproval`. **10 models missing `deletedAt`**: same set minus `SavingPlanPayment`, plus `JournalPostAuditLog`. Float is only used for `gpsLatitude`, `gpsLongitude`, `confidence`, `quality` — appropriate (no Float on money fields). 188 models total. |
| B2 Migrations | PASS | 279 migrations. Latest 5 have descriptive names. `20260971000000_remove_2fa` contains documented `DROP COLUMN IF EXISTS` (removing 2FA columns — planned, non-data-destructive). `20260972000000_journal_line_restrict_and_index` drops and recreates FK as RESTRICT (documented safety upgrade). No undocumented destructive DDL. |
| B3 Indexes | WARN | 20+ FK fields missing `@@index` on high-traffic models: `Contract` (`productId`, `reviewedById`, `interestConfigId`, `exchangedFromContractId`), `Payment` (`toleranceJournalLineId`), `InstallmentSchedule` (`accrualJournalEntryId`, `vat60dayJournalEntryId`), `Repossession` (`contractId`, `productId`, `appraisedById`), `Product` (`poId`, `inspectionId`), `PurchaseOrder` (`createdById`, `approvedById`), `GoodsReceivingItem` (`productId`), `Customer` (`nationalId`). Missing indexes on FK fields cause full table scans on common join queries. |
| B4 Drift | PASS | Latest migration `20260972000000_journal_line_restrict_and_index` matches schema intent: `JournalLine.journalEntry` FK changed to `onDelete: Restrict` with compound index `(journal_entry_id, deleted_at)` — consistent with schema.prisma definition. No mismatches detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | OK | Model: `claude-sonnet-4-6` (current ✅). `MAX_TOOL_ITERATIONS = 5` guard present ✅. 30s per-iteration AbortController present. `maxTokens = 1024` (reasonable). `Sentry.captureException` on error path + `Sentry.captureMessage` on iteration cap. API key loaded from `IntegrationConfig` (not hardcoded). All good. |
| C2 Prompt | OK | System prompt consistent with `finance-rules.ts` constants: bank `203-1-16520-5` ✅, phone `063-134-6356` ✅, hours `09:00–18:00 จันทร์-เสาร์` ✅, late fee `50 บาท/วัน` ✅. Prompt is ~2KB (estimated ~500 tokens) — not excessively long. No contradictions detected. Prompt note says to update `KB doc` when changing — dual-source maintenance risk but low immediate concern. |
| C3 Tools | OK | 6 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All 6 have clear Thai `description` fields. All 6 handled in `tool-executor.ts` `switch` cases — no unhandled tool names. Input schemas defined via `tool-input-schemas.ts`. |
| C4 Auto-Trigger | OK | Two cron jobs cover all 6 reminder types: 09:00 cron → T-5, T-3, T-1, T; 10:00 cron → T+1, T+3. Idempotency via `ChatAutoTrigger` table marker (DB-based, multi-instance safe). `Sentry.captureException` on both inner and outer error paths. All types covered ✅. |
| C5 Security | OK | LIFF controller: `@UseGuards(LiffTokenGuard)` (LINE ID token verified server-side) ✅. Admin controller: `@UseGuards(JwtAuthGuard, RolesGuard)` ✅. Webhook dedup: `ProcessedWebhookEvent` with unique constraint — prevents replay. Customer data in tool executor is scoped by `customerId` resolved from verified `liffUserId` binding. |

---

## Action Items

### P0 — Fix Immediately

1. **`@prisma/client-finance` not generated** (`apps/api/src/prisma/prisma-finance.service.ts:2`)
   - Root cause: SP7 introduced `PrismaFinanceService extends PrismaClient from '@prisma/client-finance'` but the secondary Prisma schema and generated client don't exist yet.
   - Fix: Either (a) create `prisma/schema-finance.prisma` + run `prisma generate --schema=prisma/schema-finance.prisma` and register as workspace package, or (b) make `PrismaFinanceService` a stub that doesn't extend `PrismaClient` until the finance DB is provisioned (temporary workaround).
   - Impact: 7 TS errors, 14+ failing test suites, 145 failing tests.

### P1 — Fix This Sprint

2. **Security allowlist in `security.md` is stale** — 9 new public controllers not listed:
   `shop-cart`, `shop-checkout`, `shop-shipping`, `shop-reservation`, `shop-tracking`, `shop-auth-social`, `shop-line-chat`, `shop-buyback`, `staff-chat/web-widget`.
   Add to allowlist with justification, or add `@Public()` decorators consistently.

3. **`Number()` on money Decimals** — 30+ occurrences in `stickers`, `shop-catalog`, `line-oa/chatbot`, `sales`, `crm`, `purchase-orders`, `repossessions`.
   Convert to `new Prisma.Decimal()` / `.toNumber()` only at serialization boundary. Critical for `sale-writer.service.ts` (costPrice calc path).

4. **Soft-delete gaps** in `shop-cart.service`, `shop-checkout.service`, `trade-in/voucher.service`, `chatbot-finance.service`, `credit-check-*.service`.
   Add `deletedAt: null` to all `findMany`/`findFirst`/`findUnique` calls.

### P2 — Backlog

5. **Missing FK indexes** on `Contract`, `Payment`, `InstallmentSchedule`, `Repossession`, `Product`, `PurchaseOrder`, `GoodsReceivingItem`, `Customer.nationalId`.
   Run `EXPLAIN ANALYZE` on common queries; add `@@index` where confirmed slow.

6. **Bundle size** — `LettersPage` (220KB gzip) should be split: letter generation PDF library is the likely culprit. `excel` chunk (256KB gzip) is already split from v3 but may be improvable. `thai-address-data` (69KB gzip) can be lazy-loaded on demand.

7. **Schema models missing `deletedAt`/`updatedAt`** — `Customer`, `CompanyInfo`, `FixedAsset`, `DunningRule`, `FeeWaiverApproval` et al. Add via migration; `Customer` especially since it's the core entity.

8. **Security.md `shop-*` storefront family** — confirm `ShopBotDefenseGuard` covers all shop-facing endpoints and update allowlist documentation.
