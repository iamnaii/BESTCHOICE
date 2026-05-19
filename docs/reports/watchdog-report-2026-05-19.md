# CTO Watchdog Report — 2026-05-19

## Summary
**10/15 checks passed.** A1 (TS errors in API), A4 (soft-delete gaps), A5 (test failures — env-dependent) are the main concerns. All chatbot checks (C1–C5) pass cleanly.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors all in `prisma-finance.service.ts` (cannot find `@prisma/client-finance`, `$queryRaw` missing on PrismaFinanceService, `$connect`/`$disconnect` missing). Web: 0 errors ✓ |
| A2 Security | **WARN** | No unguarded controllers outside the allowed-public list. No raw SQL injection risk. One intentional `localStorage` read in `apps/web/src/lib/api.ts:10` for E2E Playwright token injection (guarded by env check, not a production path). No hardcoded secrets found. |
| A3 Decimal | **WARN** | 12+ `Number()` calls on money fields outside test files: `shop-catalog.service.ts:93,134`, `stickers.service.ts:168–185`, `line-oa/chatbot.service.ts:151–215`, `sales.service.ts:286,452,579,628`, `staff-chat/chat-commerce.service.ts:132–134`, `repossessions.service.ts:136`. None are in core journal/payment paths (v4 audit cleaned those) but precision risk exists in reporting/display paths. |
| A4 Soft-Delete | **WARN** | `line-oa.service.ts` queries `customer.findFirst` (×5), `contract.findUnique` (×1), `customer.findMany` (×4) without `deletedAt: null`. `shop-catalog.service.ts:89,112,118` queries `product.findFirst/findMany` without filter. `sales.service.ts:71,139` similar. Some are intentional (SystemConfig, NotificationLog have no deletedAt) but Customer/Contract/Product omissions are risky. |
| A5 Tests | **FAIL** | API: 3376 passed / **144 failed** / 8 skipped (14 failing suites). Web: 20 passed / **35 failed** (338 test files). Root cause: `PrismaClientInitializationError: DATABASE_URL not found` — asset, other-income, depreciation, and CPA template tests require a DB connection not available in this environment. Functionally env-dependent, not logic regressions. Baseline (577 API / 129 web) counts do not apply in DB-less env. |
| A6 Bundle | **PASS** | All chunks under 500 KB gzipped. Largest: `excel-B8LTOlRj.js` 256 KB gzip, `pdf-D3lkm9A2.js` 139 KB, `ContractTemplatesPage` 148 KB, `charts` 120 KB. Raw sizes trigger Vite's 500 KB pre-gzip warning but gzip targets are met. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | All core models have UUID `@id @default(uuid())`. All confirmed money fields use `@db.Decimal(12, 2)`. Float used only for non-monetary fields: GPS coordinates, ML confidence scores, AI bot thresholds — all appropriate. Enums use PascalCase names + SCREAMING_SNAKE_CASE values throughout. 476 `@@index` declarations across schema. |
| B2 Migrations | **PASS/WARN** | 256 total migrations. Latest (`20260953000000_sp7_4_external_finance`) is descriptive and correct. `ALTER TYPE … ADD VALUE IF NOT EXISTS` is safe/additive. One `ALTER TYPE … RENAME TO` (OtherIncomeStatus) is a 2-step safe rename. One `DROP COLUMN "updated_at"` on `audit_logs` in migration `20260415000000` — intentional per immutable-log exception rule. No DROP TABLE or destructive schema resets. |
| B3 Indexes | **PASS** | High-traffic models have comprehensive compound + single-column indexes. `Contract` has 10 indexes (status, deletedAt, branchId compound, workflowStatus, retentionStatus, etc.). `Customer` has phoneHash, phone, name, referredById. `Payment` well-covered. 108 FK-style fields across schema; spot-check shows key FKs are indexed. |
| B4 Drift | **PASS** | Latest migration creates `external_finance_companies` + `external_finance_commissions` with proper UUID PKs, `DECIMAL(12,2)` money columns, timestamps, and FK constraints matching the schema. No obvious schema-migration mismatch detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current) ✓. `MAX_TOOL_ITERATIONS = 5` guard in place ✓. `@sentry/nestjs` imported and used ✓. `maxTokens = 1024` ✓. History window: last 10 messages with 20K char budget ✓. API key loaded from DB (IntegrationConfig) not hardcoded ✓. |
| C2 Prompt | **OK** | System prompt references: bank account `203-1-16520-5` (KBank) ✓, contact `063-134-6356` ✓, hours Mon–Sat 09:00–18:00 ✓. Constants in `finance-rules.ts` match prompt verbatim. Prompt length ~1,400 chars (~400–500 tokens) — well within budget. No contradictions detected. |
| C3 Tools | **OK** | 7 tools defined in `tool-definitions.ts` with clear Thai descriptions and proper JSON schemas. `tool-executor.ts` handles all 7: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. No orphaned tool names. `customerId` is injected by the orchestrator — not in tool schema, so Claude cannot target other customers. |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` table (PENDING/SENT marker) checked before each send ✓. All 6 reminder types covered: T-5, T-3, T-1, T (09:00 cron) + T+1, T+3 escalations (10:00 cron) ✓. `Sentry.captureException` in both cron `catch` blocks with `kind: 'cron-job'` tags ✓. |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard` (LINE token verification, not JWT) — correct for customer-facing routes ✓. Admin controller has `@UseGuards(JwtAuthGuard, RolesGuard)` ✓. Webhook dedup is DB-backed (`WebhookDedupService`) — safe for multi-instance Cloud Run ✓. Delivery redelivery flag also checked before dedup query ✓. Customer data isolation: `customerId` injected server-side from verified session, not from AI-controlled input ✓. |

---

## Action Items

### P0 — Fix Immediately

1. **A1: `@prisma/client-finance` module missing** — `apps/api/src/prisma/prisma-finance.service.ts` references a Prisma client that doesn't exist. This causes 7 TS compile errors and will break the build in CI. Investigate if this is a new multi-DB feature in progress: if so, add `@prisma/client-finance` to the generate step or wrap in `// @ts-expect-error WIP`; if abandoned, delete the file.

### P1 — Fix This Sprint

2. **A5: Tests failing due to `DATABASE_URL` not set** — 14 API test suites (asset, other-income, depreciation, CPA templates) fail with `PrismaClientInitializationError`. These tests need either a test DB or proper mocking. Add `jest.mock('../../../prisma/prisma.service')` or configure a test DB in CI. The CPA template specs are critical regression guards for the accounting system.

3. **A4: Soft-delete missing in `line-oa.service.ts`** — Customer queries at lines 192, 223, 231, 264, 350, 426 and Contract at line 375 lack `deletedAt: null`. Deleted customers could appear in LINE message handling, potentially sending messages to wrong/deleted accounts. Add `where: { deletedAt: null }` to all affected queries.

### P2 — Fix Next Sprint

4. **A3: Decimal precision in `sales.service.ts` and `chatbot.service.ts`** — `Number(product.costPrice)` at lines 286, 579 and `Number(rule.rate)` at lines 452, 628 convert Decimal to float, risking rounding errors in commission calculations. Convert to `new Prisma.Decimal(...)` arithmetic. Same for `chatbot.service.ts:151–215` payment amount display.

5. **A3: `stickers.service.ts` pricing conversion** — Lines 168–185 use `Number()` on all pricing fields. This is display-only but inconsistent with project policy. Convert or explicitly document as display-safe.

6. **A4: `shop-catalog.service.ts` missing soft-delete** — Product queries at lines 89, 112, 118 missing `deletedAt: null`. Deleted products could surface in the shop catalog.

### P3 — Monitor / Low Priority

7. **A6: `ContractTemplatesPage` chunk 496 KB raw** — Approaching the 500 KB raw warning threshold. Consider lazy-loading the PDF/signature components within the page to split it further.

8. **B2: `OtherIncomeStatus` enum rename migration** — The 2-step rename (`_new` suffix) in `20260923000000` is correct but fragile if partially applied. Confirm this migration was fully applied on all environments and the `_new` type is gone.
