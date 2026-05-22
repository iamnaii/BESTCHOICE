# CTO Watchdog Report — 2026-05-22

## Summary
**8/15 checks fully passed.** 2 FAIL (A1, A5) + 5 WARN (A2, A3, A4, A6, B3) + 5 OK (C1-C5). Both FAILs share a single root cause: `@prisma/client-finance` Prisma client not generated for the SP7.1 multi-entity split (WIP feature). Fixing it unblocks both A1 and A5 immediately.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: **6 errors** in `src/prisma/prisma-finance.service.ts` + spec. Root cause: `@prisma/client-finance` package not generated (`prisma-finance/` schema exists but `npx prisma generate --schema=prisma-finance/schema.prisma` was never run). Web: **0 errors** ✓ |
| A2 Security | **WARN** | No raw SQL, no token in localStorage (E2E-only injection is documented). 13 controllers without `JwtAuthGuard` are **all intentionally public** (shop/*, web-widget, line-login, liff-api, chatbot-finance-liff) — but `security.md` allowlist only names 5 (`chatbot-finance-liff`, `sms-webhook`, `paysolutions`, `address`, `health`). **Action**: expand allowlist to avoid future false negatives. |
| A3 Decimal | **WARN** | 40+ `Number(amount/price/cost)` usages found. Highest-risk hits: `chatbot-finance/services/finance-tools.service.ts:53,54,108,111,127,173` (chatbot balance display), `customers/customers.service.ts:1134` `Number(_sum.amountDue)` (critical — same pattern fixed in v4), `sales/sales.service.ts:286,579` `Number(costPrice)`, `line-oa/chatbot.service.ts:151,160,172,199,215`. For chatbot display strings `Number()` is acceptable; `Number(_sum.amountDue)` in customers service is a precision risk. |
| A4 Soft-Delete | **WARN** | 842 `findMany`/`findFirst` calls without `deletedAt: null` after excluding known-immutable models (AuditLog, ChatMessage, etc.). Specific chatbot-finance violations: `finance-tools.service.ts:37,91,157` — `payment.findFirst/findMany` queries lack `deletedAt: null` (compensated by `status` filter but not strictly correct). `slip-processing.service.ts:92` contract query has `deletedAt: null` ✓. |
| A5 Tests | **FAIL** | API: **14 suites failed, 144 tests failed** out of 3734 total. Failing suites: `asset.service`, `other-income.service`, `maker-checker`, `doc-number.service`, `asset-journal.service`, `depreciation.service`, `asset-transfer.service`, `outbox-processor.service`, `health.controller`, `backfill-user-companies.cli`, `prisma-finance.service`, `template.service`, `asset-reports.service`, `collections-foundation.seed`. Root cause: same `@prisma/client-finance` missing as A1. Web: **2 suites failed, 8 tests failed** out of 524 total. Root cause: `useAssetCalculation.test.ts` — `useQuery<CoaByCodesRow[]>` type mismatch (unrelated to A1). |
| A6 Bundle | **WARN** | Vite warning fires for 2 chunks exceeding 500 KB raw: `excel-Kg_E4bP1.js` **929 KB raw / 256 KB gzip** and `thai-address-data-D748eHHh.js` **870 KB raw / 69 KB gzip**. No chunk exceeds 500 KB gzip. `ContractTemplatesPage` is 495 KB raw (just under threshold). Excel chunk could be further lazy-split; thai-address-data gzip is fine (69 KB). |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | All models use UUID `@id @default(uuid())` ✓. Money fields all use `@db.Decimal(12, 2)` ✓. `Float` only on non-monetary fields (GPS coords, AI confidence thresholds) ✓. Enum naming: PascalCase types, SCREAMING_SNAKE_CASE values throughout ✓. 186 models, 595 index definitions. |
| B2 Migrations | **PASS** | **263 migrations** total. Latest: `20260959000000_customer_acquisition_source_constraint` (descriptive ✓). Dangerous patterns checked: all `DROP TABLE` uses include `IF EXISTS`, all `DROP COLUMN` uses include `IF EXISTS`. Phase A4 migration drops legacy Phase A.0-A.3 columns (expected, documented). No `ALTER TYPE ... DROP` found. |
| B3 Indexes | **WARN** | 595 indexes across 186 models (avg ~3.2/model). Coverage is generally good. Notable gaps: `Payment` model (high-query frequency) has `@@index([contractId])` but missing compound `@@index([status, dueDate])` for overdue scans. `Contract` missing `@@index([status, branchId])` compound for cross-branch status queries. `CallLog` missing `@@index([contractId, createdAt])` for timeline queries. These are performance concerns, not correctness bugs. |
| B4 Drift | **PASS** | Latest migration SQL (`customer_acquisition_source_constraint`) aligns cleanly with `schema.prisma`: `acquisition_source VARCHAR(50)` + partial index `WHERE acquisition_source IS NOT NULL`. No observable mismatch between schema and migration history. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✓ (current). `MAX_TOOL_ITERATIONS = 5` ✓. `maxTokens = 1024` ✓. `historyLimit = 20`, `HISTORY_FETCH_LIMIT = 10`, `HISTORY_CHAR_BUDGET = 20_000` all reasonable. Sentry captures present on both AI call errors and tool input rejections ✓. 5-minute prompt cache TTL for DB-backed system prompt ✓. |
| C2 Prompt | **OK** | System prompt constants match `finance-rules.ts` exactly: bank account `203-1-16520-5` ✓, phone `063-134-6356` ✓, hours `09:00-18:00 จันทร์-เสาร์` ✓, late fee `50 บาท/วัน` ✓. No contradictions. Prompt estimated ~1000-1200 tokens (well within budget). Product scope (iPhone/iPad new only) clearly stated. Forbidden vocabulary list (หนี้→ยอดรอชำระ etc.) included ✓. |
| C3 Tools | **OK** | 5 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base` (6 total). All have Thai descriptions ✓. Input schemas properly typed ✓. Tool executor routes all 6 tool names with `switch` ✓. `validateToolInput` + `redactPii` guard before execution ✓. Customer data isolation: `customerId` injected by orchestrator, not controllable by AI ✓. |
| C4 Auto-Trigger | **OK** | Idempotency: `ChatAutoTrigger` table as marker before send ✓. All 6 types covered: `REMINDER_T_MINUS_5`, `T_MINUS_3`, `T_MINUS_1`, `T_DAY` (cron 09:00) + `ESCALATION_T_PLUS_1`, `T_PLUS_3` (cron 10:00) ✓. Both cron jobs wrapped in try/catch with `Sentry.captureException` ✓. `deletedAt: null` filter on payments + contracts ✓. Timezone: `Asia/Bangkok` ✓. |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard` (LINE LIFF token verification) — correctly public for LINE customer access ✓. Admin controller has `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles()` on all methods ✓. Webhook dedup via `ChatAutoTrigger` prevents replay ✓. Customer data isolation enforced at orchestrator level ✓. |

---

## Action Items (Prioritized)

### P0 — Fix immediately (blocks tests + type safety)

**[A1/A5] Generate `@prisma/client-finance`**
```bash
cd apps/api
npx prisma generate --schema=prisma-finance/schema.prisma
```
This single command unblocks 14 test suites (144 API test failures) and resolves all 6 TypeScript errors. The `prisma-finance/` schema exists and migrations are in place — only the generated client is missing. After generation, re-run `./tools/check-types.sh api` to confirm.

### P1 — Fix this sprint

**[A5 Web] Fix `useAssetCalculation.test.ts` (8 test failures)**
- File: `apps/web/src/pages/assets/hooks/useAssetCalculation.test.ts:115`
- Error: `useQuery<CoaByCodesRow[]>` type signature mismatch in hook at line 47
- Action: Align the generic type parameter with what `useQuery` expects, or adjust the test mock

**[A3] Fix `Number(_sum.amountDue)` in customers service**
- File: `apps/api/src/modules/customers/customers.service.ts:1134`
- Risk: Decimal precision loss on aggregated outstanding balance (same pattern fixed in v4 for other services)
- Fix: `new Prisma.Decimal(outstanding._sum.amountDue ?? 0)`

**[A3] Fix `Number(amountDue/amountPaid)` in finance-tools.service**
- Files: `chatbot-finance/services/finance-tools.service.ts:53,54,108,111,127,173`
- Risk: Chatbot displays wrong balances if amounts exceed JS `Number` precision (~15 sig digits)
- Fix: Use `Prisma.Decimal` arithmetic; convert to string for display only at the final template step

### P2 — Fix next sprint

**[A2] Update `security.md` allowlist**
- Add to the "Intentionally Public Endpoints" section: `shop/*` (catalog, cart, reservation, buyback, tracking, shipping, auth-social, line-chat), `web-widget` (anonymous chat widget), `line-oa/line-login` (LINE OAuth)
- Prevents future security audit false alarms

**[A4] Add `deletedAt: null` to chatbot finance payment queries**
- Files: `finance-tools.service.ts:37,91,157`
- Currently relying on `status` filter; add explicit soft-delete guard per coding standard

**[B3] Add missing compound indexes**
```prisma
// In Payment model
@@index([status, dueDate])      // overdue cron scans
// In Contract model
@@index([status, branchId])     // branch status dashboard queries
// In CallLog model
@@index([contractId, createdAt]) // timeline queries
```

**[A6] Split `ContractTemplatesPage` chunk (495 KB — approaching threshold)**
- Consider lazy-importing heavy sub-components (PDF viewer, signature pad) to keep under 500 KB

### P3 — Monitor / Low urgency

**[A4] Systematic soft-delete audit**: 842 queries on soft-deletable models without `deletedAt: null`. Many are on valid non-soft-delete models (SystemConfig singletons, ChatKbSuggestion, etc.). Recommend a focused audit pass on `customer`, `contract`, `product` queries specifically.

**[A6] Thai address data (870 KB)**: gzip is only 69 KB — acceptable for now. Could move to API-side lookup to eliminate the client bundle entirely if initial load becomes a concern.

---

*Generated by CTO Watchdog agent — 2026-05-22*
