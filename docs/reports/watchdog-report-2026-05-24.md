# CTO Watchdog Report — 2026-05-24

## Summary
10/15 checks passed — 3 critical issues found (TS errors causing test failures, test regression below baseline, two large bundle chunks above 500 KB gzipped). Chatbot and database health are mostly solid.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | FAIL | API: 7 errors (all in `prisma-finance.service.ts` + `health.controller.ts`), Web: 0 errors |
| A2 Security | PASS | No controllers missing JwtAuthGuard (all public endpoints are intentional). All raw SQL uses parameterized tagged template literals (no string interpolation). No token in localStorage/sessionStorage. No hardcoded secrets (one comment-only reference in `shop-ai-bench.cli.ts`). |
| A3 Decimal | WARN | ~30 `Number(amount/price/cost)` hits across 8 modules. Worst offenders: `finance-tools.service.ts` (6 hits on `amountDue`/`amountPaid`), `sales.service.ts` (2 hits on `costPrice`), `customers.service.ts` (2 hits on `_sum.amountDue`), `chatbot/auto-trigger.service.ts` (2 hits), `line-oa/chatbot.service.ts` (5+ hits). These are read-path display conversions, not write-path arithmetic — low precision risk but violates Decimal convention. |
| A4 Soft-Delete | WARN | 3 service files with queries but zero `deletedAt` filters (audit is exempted intentionally): `branch-receiving.service.ts` (4 queries, model HAS deletedAt column — missing filter), `pricing-templates.service.ts` (4 queries, needs verification), `two-factor.service.ts` + `auth/two-factor.service.ts` (6 queries each — tokens are use-once by design, likely exempt). |
| A5 Tests | FAIL | API: 3636/3788 passed (144 failed, 14 suites failing). Web: 522/530 passed (8 failed, 2 suites failing). API baseline was 577 — test count grew to 3788 total but 144 failures exist. Root causes: (1) `@prisma/client-finance` package not generated — `prisma-finance.service.ts` TS errors cascade into 5+ test suites. (2) Asset/OtherIncome/Depreciation tests fail with `DATABASE_URL not found` — these need integration DB. (3) Web failures: `useAssetCalculation.test.ts` (logic error) + `ECONNREFUSED 127.0.0.1:3000` (integration tests need running API). |
| A6 Bundle | WARN | 2 chunks exceed 500 KB gzipped: `excel-twjWnwRh.js` 256 KB gzip (929 KB raw), `ContractTemplatesPage-BQnEbIKH.js` 148 KB gzip (496 KB raw). Also notable: `thai-address-data` 69 KB gzip (871 KB raw — data-only, hard to split). `pdf-B37lo3bv.js` 139 KB gzip. Vite build warning triggered. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | PASS | All 175 models use `@default(uuid())`. No `autoincrement()`. No `Float` on money fields (only GPS coordinates and ML confidence scores use Float — correct). All enums PascalCase with SCREAMING_SNAKE_CASE values. Some models legitimately omit `deletedAt` (AuditLog, Tokens, etc.) — 12 non-exempt models found missing `deletedAt` (ExpenseLine, AccountRoleMap, PayrollCustomIncome, PayrollCustomDeduction, SettlementLine, ChatKbSuggestion, CustomerScore, ProductReservation, KnownDevice, AiSettings, PartialPaymentLink, ExpenseAdjustment). |
| B2 Migrations | PASS | 265 migrations total (minus `migration_lock.toml` = 264). Last 5: `20260957000000_*`, `20260958000000_customer_acquisition_source`, `20260959000000_customer_acquisition_source_constraint`, `20260960000000_installment_calc_phase_a`, `20260961000000_add_contract_exchange_request`. No `DROP TABLE`, `DROP COLUMN`, or `ALTER TYPE ... USING` in last 5 migrations. Latest migration is additive only (new table + ALTER TABLE ADD COLUMN). |
| B3 Indexes | WARN | Top 3 missing index candidates: (1) `Contract.productId` — not indexed, high-cardinality FK, frequent join target. (2) `Contract.reviewedById` + `Contract.interestConfigId` — minor but missing. (3) `DailyAssignment.contractId` — no standalone index (only composite `[collectorId, date]` + `[date, status]`); `contractId` lookups for a given contract hit full table scan. Also flagged: `User.lineId`, `User.nationalId` (search fields), `InstallmentSchedule.accrualJournalEntryId`, `Refund.rejectedById`. |
| B4 Drift | PASS | Latest migration (`20260961000000_add_contract_exchange_request`) correctly references `contracts` (existing), creates `contract_exchange_requests` (new), and schema.prisma has matching `ContractExchangeRequest` model with all corresponding fields and relations. No drift detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | PASS | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5`. `maxTokens = 1024`. `Sentry.captureException` present in catch block. Per-iteration 30s timeout with `AbortController`. All green. |
| C2 Prompt | PASS | 67-line file, ~1200 tokens estimated (well under 8000 limit). Contains correct Thai business context (iPhone/iPad shop, installment payments, LINE payment). Bank account info present (KBank 203-1-16520-5). No contradictions found. Decision rules and forbidden words defined. |
| C3 Tools | PASS | 7 tools defined (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`). All have Thai descriptions. Input schemas defined via `tool-input-schemas.ts`. Tool executor handles all 7 tool names in switch-case. No unhandled tool names. |
| C4 Auto-Trigger | PASS | 6 trigger types: T-5, T-3, T-1, T-day (reminders) + T+1, T+3 (escalations). Idempotency via unique constraint on `(paymentId, triggerType)` — P2002 catch = already sent. Error handling with `Sentry.captureException` at both the daily-run and per-send level. SENT/FAILED status tracking. |
| C5 Security | PASS | LIFF controller uses `LiffTokenGuard` (server-side LINE token verification, not raw lineId). Admin controller uses `JwtAuthGuard + RolesGuard`. Webhook uses `LineFinanceWebhookGuard`. Tool executor enforces `customerId` scope injected by orchestrator — Claude cannot override it. Webhook dedup via DB unique constraint on `eventId` with 7-day retention cron. |

---

## Action Items

### Critical (fix immediately)

1. **A1/A5 — `@prisma/client-finance` not generated**: `src/prisma/prisma-finance.service.ts` imports from `@prisma/client-finance` which doesn't exist in `node_modules`. This causes 7 TS errors and cascades to at least 5 failing test suites (`health.controller.spec.ts`, `prisma-finance.service.spec.ts`, `outbox-processor.service.spec.ts`, etc.). Run `npx prisma generate --schema=apps/api/prisma/schema-finance.prisma` (if the schema exists) or stub the client until SP7 FINANCE DB is provisioned. See `src/prisma/prisma-finance.service.ts` — the `isEnabled` guard exists at runtime but types are broken at compile time.

2. **A5 — Test suite regression (144 API failures)**: `PrismaClientInitializationError: DATABASE_URL not found` in asset, depreciation, and other-income tests suggests the CI test environment isn't providing the `.env.test` file or the test setup changed. These tests passed before (baseline 577). Verify `jest.config.js` has `testEnvironment` pointing to correct env file, and that the `@prisma/client-finance` issue above isn't blocking compile for integration tests.

### Warning (fix soon)

3. **A6 — Bundle size**: `excel-twjWnwRh.js` is 256 KB gzipped. Although ExcelJS is already in a split chunk (v3 hardening), investigate if the full ExcelJS library is being imported vs. tree-shaken. Consider dynamic import only in pages that use it. `ContractTemplatesPage` at 148 KB gzip may benefit from further splitting.

4. **A3 — Decimal compliance in chatbot and chatbot-adjacent services**: `finance-tools.service.ts`, `auto-trigger.service.ts`, `line-oa/chatbot.service.ts`, and `sales.service.ts` convert Prisma Decimal `amountDue`/`amountPaid`/`costPrice` to `Number()`. For display-only this is acceptable, but `sales.service.ts:291,597` assigns `costPrice = Number(product.costPrice)` which could then be used in arithmetic. Audit these paths — if they feed into journal entries or financial calculations, replace with `new Prisma.Decimal(...)`.

5. **B1/B3 — Models missing `deletedAt`**: `ExpenseLine`, `SettlementLine`, `PayrollCustomIncome`, `PayrollCustomDeduction` are financial sub-documents that likely benefit from soft-delete to support audit trails. Add `deletedAt DateTime?` and ensure queries filter by it.

6. **B3 — Missing indexes**: Add `@@index([productId])` and `@@index([contractId])` on `Contract` and `DailyAssignment` respectively. The `DailyAssignment.contractId` lookup (used in collection queue queries) has no standalone index — only composite indexes that may not cover `WHERE contractId = ?` alone.

### Info (nice to have)

7. **A4 — `branch-receiving.service.ts` missing soft-delete filter**: `BranchReceiving` model has `deletedAt` column but `branch-receiving.service.ts` queries don't filter on `deletedAt: null`. Low severity (branch receiving is admin-only) but inconsistent.

8. **C2 — Prompt source doc drift risk**: `system-prompt.ts` comment notes it should stay in sync with `docs/reports/KNOWLEDGE-BASE-FINANCE-BOT.md`. Consider adding a CI lint check or at minimum a last-verified date to detect stale prompts.

9. **A2 — Raw SQL audit note**: All `$executeRaw`/`$queryRaw` tagged template literals observed use proper parameterization (variables interpolated via Prisma's template tag, not string concatenation). This is safe by Prisma's design, but worth documenting for any future contributors.

10. **B1 — `KnownDevice` and `AiSettings` missing `deletedAt`**: These appear to be configuration/session models. Evaluate whether soft-delete is appropriate; if records are truly replaced (not deleted), document this as intentional with a `///` comment on the model.
