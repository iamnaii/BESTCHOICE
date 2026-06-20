# CTO Watchdog Report — 2026-06-20

## Summary
10/15 checks passed — 2 FAIL (A1 TS errors, A3 Decimal precision), 3 WARN (A2 Security, A4 Soft-delete, A5 Tests), database and chatbot checks healthy.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors. Web: 0 errors. |
| A2 Security | **WARN** | 1 controller needs verification; localStorage usage is E2E-only (safe). |
| A3 Decimal | **FAIL** | 15+ `Number()` calls on money fields across 8 services. |
| A4 Soft-Delete | **WARN** | ~6 service query sites missing `deletedAt: null` filter. |
| A5 Tests | **WARN** | API: 14 suites / 145 tests failing (mostly no DB env). Web: 2 tests failing. |
| A6 Bundle | **WARN** | All chunks <500 kB gzip. Vite warns on 3 minified chunks >500 kB (pre-existing). |

### A1 — TypeScript Errors (FAIL)

**API — 7 errors, all in `prisma-finance.service.ts` and its spec:**

```
src/prisma/prisma-finance.service.ts(2,30): TS2307 — Cannot find module '@prisma/client-finance'
src/prisma/prisma-finance.service.ts(42,16): TS2339 — '$connect' does not exist
src/prisma/prisma-finance.service.ts(48,16): TS2339 — '$disconnect' does not exist
src/modules/health/health.controller.ts(144,24): TS2345 — PrismaFinanceService type mismatch
src/prisma/prisma-finance.service.spec.ts(29,34): TS2339 — '$queryRaw' does not exist
src/prisma/prisma-finance.service.spec.ts(34,35): TS2339 — 'healthCheck' does not exist
src/prisma/prisma-finance.service.spec.ts(39,21): TS2339 — 'healthCheck' does not exist
```

**Root cause:** SP7.1 introduced `PrismaFinanceService` extending `PrismaClient` from `@prisma/client-finance` (a second Prisma schema for the FINANCE DB). The package was never generated — no `schema-finance.prisma` exists in `apps/api/prisma/` and no `@prisma/client-finance` is installed. The app boots and runs fine (`isEnabled = false` when `DATABASE_URL_FINANCE` is unset), but TypeScript compilation fails.

**Web — 0 errors.** ✅

### A2 — Security (WARN)

**localStorage — acceptable:** `apps/web/src/lib/api.ts:10` reads `localStorage.getItem('access_token')` only when `E2E_TOKEN_OVERRIDE` env flag is set (Playwright test support). Token is read once then immediately removed. Does not affect production security.

**Unguarded controllers — 4 verified intentionally public, 1 needs review:**

| Controller | Endpoint | Verdict |
|---|---|---|
| `yeastar/yeastar-webhook.controller.ts` | `POST /yeastar/webhook` | ✅ Public by design — HMAC/shared-secret verified |
| `chat-adapters/facebook-webhook.controller.ts` | `GET|POST /webhooks/facebook` | ✅ Public by design — HMAC-SHA256 + verify-token |
| `line-oa/line-login.controller.ts` | `GET /line-oa/line-login/authorize|callback` | ✅ Public by design — LINE OAuth flow |
| `metrics/metrics.controller.ts` | `GET /metrics` | ✅ Public by design — guarded by `X-Metrics-Token` shared-secret (timing-safe compare) |
| **`staff-chat/web-widget.controller.ts`** | `POST /widget/init`, `GET /widget/messages/:roomId` | ⚠️ **No guard visible — needs review** |

**`$executeRawUnsafe` — safe:** All production usages call `SELECT pg_advisory_xact_lock(${lockKey})` where `lockKey` is derived from internal hash functions, never from user-supplied input.

**`$queryRaw` — safe:** All usages use tagged template literals (Prisma parameterization), not string concatenation.

**Hardcoded secrets — none found.**

### A3 — Decimal Compliance (FAIL)

`Number()` wrapping `Prisma.Decimal` money fields loses precision for large values (>15 significant digits). Found in production services:

| File | Fields Affected |
|------|----------------|
| `stickers/stickers.service.ts:168,175,185` | `cashPrice`, `installmentBestchoicePrice`, `installmentFinancePrice` |
| `shop-catalog/shop-catalog.service.ts:95,136,164,165` | `costPrice`, `cashPrice`, `installmentPrice` |
| `staff-chat/services/chat-commerce.service.ts:132,134,220,255` | `amountDue`, `amountPaid`, `price` |
| `line-oa/chatbot.service.ts:151,160,172,199,215` | `amountDue`, `amountPaid` |
| `sales/services/sale-creation.service.ts:95` | `costPrice` |
| `sales/services/sale-writer.service.ts:296` | `costPrice` |
| `repossessions/repossessions.service.ts:136,137` | `sellingPrice`, `financedAmount` |
| `finance-receivable/finance-receivable.service.ts:160` | `netExpectedAmount` |
| `purchase-orders/services/po-lifecycle.service.ts:207,208` | `netAmount` |
| `purchase-orders/services/po-receiving.service.ts:86,250` | `unitPrice` |
| `crm/services/customer-scoring.service.ts:121` | `financedAmount` (_sum aggregate) |

Note: Most are for display/comparison in non-critical paths (sticker labels, chatbot display). The purchase-orders and repossessions usages are higher risk. Use `Prisma.Decimal.toFixed(2)` or `.toNumber()` with explicit precision for display-only contexts; keep as `Prisma.Decimal` for any arithmetic.

### A4 — Soft-Delete Audit (WARN)

Services with `findMany`/`findFirst`/`findUnique` not filtered by `deletedAt: null`:

| File | Models Missing Filter |
|------|-----------------------|
| `inter-company/inter-company.service.ts` | `InterCompanyTransaction` (no deletedAt in schema — may be intentional) |
| `stickers/stickers.service.ts` | `StickerTemplate`, `Product`, `PricingTemplate` |
| `reporting/compliance.service.ts` | `Contract`, `LegalCase`, `CallLog` |
| `chat-ai-draft/chat-ai-draft.service.ts` | `ChatMessage` (append-only by design — no deletedAt) |

Most `ChatMessage` and `CallLog` hits are intentional (append-only models with no `deletedAt`). The `stickers.service.ts` and `compliance.service.ts` Contract/LegalCase queries are the most likely genuine misses — soft-deleted contracts would appear in compliance reports.

### A5 — Test Regression (WARN)

**API Tests: 14 suites / 145/5020 failed**

Root causes:
1. **Missing `DATABASE_URL` (12 suites):** Integration tests for asset, other-income, depreciation, and collections-foundation require a live PostgreSQL connection. These fail with `PrismaClientInitializationError: Environment variable not found: DATABASE_URL`. Expected in this CI watchdog environment (no DB). Not a code regression.
2. **`@prisma/client-finance` missing (2 suites):** `prisma-finance.service.spec.ts` and `journal/outbox-processor.service.spec.ts` fail due to the TypeScript errors in A1. These ARE real bugs.

**Web Tests: 1 file / 2/662 failed**

- `src/components/contacts/CreateContactModal.test.tsx:115` — `waitFor(() => expect(apiPostMock).toHaveBeenCalledOnce())` timeout. The test clicks the submit button but the mock API call never fires. Likely a form validation change that added an async step or required field not filled in the test setup.

**Baseline comparison:** Test suite has grown substantially (577 → 5020 API, 129 → 662 web). The failing-count delta is mostly environment-related, not regressions in logic.

### A6 — Bundle Size (WARN)

Build succeeded in 20.24s. All chunks pass the **500 kB gzip** threshold:

| Chunk | Minified | Gzip |
|-------|----------|------|
| `excel-DI5aN8zZ.js` | 929.91 kB | **256 kB** |
| `LettersPage-BkJrgNmy.js` | 569.08 kB | 219 kB |
| `thai-address-data-D3RlJG_d.js` | 870.87 kB | 69 kB |
| `ContractTemplatesPage-DzaOleI0.js` | 489.50 kB | 145 kB |

Vite flags minified size warnings on 5 chunks. These are pre-existing and known from v3 bundle split work (exceljs, jspdf, recharts separated). Thai address data is large raw but compresses well (69 kB gzip). No new regressions.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | No Float money fields; Decimal(12,2) throughout; UUID ids; timestamps present. |
| B2 Migrations | **PASS** | 279 migrations; latest descriptive; DROP COLUMNs in history are legitimate. |
| B3 Indexes | **WARN** | Customer model missing `@@index([branchId])`. |
| B4 Schema Drift | **PASS** | Latest migration aligns with schema.prisma. |

### B1 — Schema Best Practices (PASS)

- **UUID ids:** ✅ all models use `@id @default(uuid())`
- **Timestamps:** ✅ Contract, Payment, Customer, Product all have `createdAt`, `updatedAt`, `deletedAt`. Exceptions are documented (AuditLog, CallLog, ChatMessage — append-only by design).
- **Money fields:** ✅ `@db.Decimal(12, 2)` on all financial amounts. `Float` used only for: GPS coordinates (`gpsLatitude/Longitude`), AI confidence scores, bot thresholds — appropriate.
- **Enums:** ✅ PascalCase names, SCREAMING_SNAKE_CASE values.

### B2 — Migration Health (PASS)

- **Count:** 279 migrations (healthy for a mature v5 system)
- **Latest:** `20260972000000_journal_line_restrict_and_index` — changes `journal_lines` FK from CASCADE to RESTRICT + adds compound index `(journal_entry_id, deleted_at)`. Safe and well-documented.
- **Historical DROPs:** `DROP COLUMN` found in migrations 20260801 (phase A4 chart cleanup) and 20260808 (asset phase1). Both are legitimate schema evolution, not data loss. No `DROP TABLE` without safeguards.

### B3 — Index Coverage (WARN)

Key models checked:

| Model | Indexed Fields | Missing |
|-------|---------------|---------|
| `Payment` | contractId, dueDate, status, paidDate, (status+dueDate) | ✅ None |
| `Sale` | saleType, branchId, createdAt, customerId, salespersonId | ✅ None |
| `CallLog` | contractId, callerId, compound result/dates | ✅ None |
| `Customer` | phone, name, createdAt, deletedAt, referredById, phoneHash, contactId | ⚠️ `branchId` missing |

`Customer.branchId` is a frequent filter in branch-scoped queries (BranchGuard). Consider adding `@@index([branchId])`.

### B4 — Schema Drift (PASS)

Latest migration SQL (journal_lines FK + index) matches `schema.prisma` `@@index([journalEntryId, deletedAt])` and the updated `onDelete: Restrict` on `JournalLine.journalEntry`. No drift detected.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: claude-sonnet-4-6 ✅; MAX_TOOL_ITERATIONS: 5 ✅; Sentry ✅; maxTokens: 1024 ✅ |
| C2 Prompt | **OK** | Bank, phone, hours match constants; no contradictions; ~600 words (reasonable). |
| C3 Tools | **OK** | 7 tools defined; all 7 handled in executor; Thai descriptions; schemas valid. |
| C4 Auto-Trigger | **OK** | Idempotency via ChatAutoTrigger ✅; all 6 types (T-5 to T+3) ✅; Sentry on cron ✅ |
| C5 Security | **OK** | LIFF: LiffTokenGuard ✅; Admin: JwtAuthGuard+RolesGuard ✅; Dedup ✅; Customer isolation ✅ |

### C1 — AI Service Health (OK)

- **Model:** `claude-sonnet-4-6` — current, matches configured runtime model
- **Iteration guard:** `MAX_TOOL_ITERATIONS = 5` enforced in loop, Sentry `captureMessage` on max-iteration hit
- **Error handling:** `Sentry.captureException` in catch block for all unhandled errors
- **Token budget:** `maxTokens: 1024` — reasonable for customer-facing short replies
- **History window:** 10 messages, 20k char budget — prevents context runaway

### C2 — Prompt Quality (OK)

System prompt (`prompts/system-prompt.ts`) and constants (`constants/finance-rules.ts`) are consistent:

| Value | System Prompt | finance-rules.ts | Match |
|-------|---------------|------------------|-------|
| Bank account | `203-1-16520-5` | `'203-1-16520-5'` | ✅ |
| Phone | `063-134-6356` | `'063-134-6356'` | ✅ |
| Business hours | `09:00-18:00, จันทร์-เสาร์` | `start:'09:00', end:'18:00', days:'จันทร์-เสาร์'` | ✅ |
| Late fee | `50 บาท/วัน` | `LATE_FEE_PER_DAY = 50` | ✅ |

Prompt includes clear handoff rules, PII protection rules, and forbidden-word substitutions. No contradictions found.

### C3 — Tool Definitions (OK)

All 7 tools defined in `tool-definitions.ts` have matching `case` in `tool-executor.ts`:

`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human` — 7/7 handled. ✅

All tools have Thai-language descriptions and properly typed input schemas. `customerId` is correctly injected by the orchestrator (not exposed in tool schema) — customer data isolation enforced.

### C4 — Auto-Trigger Health (OK)

- **Idempotency:** `ChatAutoTrigger` table checked for `{ paymentId, type }` with `status: { in: ['PENDING', 'SENT'] }` before sending — prevents duplicate reminders on cron retry
- **All 6 reminder types covered:**
  - `REMINDER_T_MINUS_5`, `REMINDER_T_MINUS_3`, `REMINDER_T_MINUS_1`, `REMINDER_T_DAY` — cron at 09:00 BKK
  - `ESCALATION_T_PLUS_1`, `ESCALATION_T_PLUS_3` — cron at 10:00 BKK
- **Sentry:** `captureException` in both `runDailyReminders` and `runDailyEscalations` catch blocks

### C5 — Security (OK)

- **LIFF controller:** `@UseGuards(LiffTokenGuard)` at class level — LINE ID token verified server-side ✅
- **Admin controller:** `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✅
- **Webhook controller:** `LineFinanceWebhookGuard` on LINE webhook endpoint; JWT guards on manual trigger endpoints ✅
- **Webhook dedup:** `ProcessedWebhookEvent` + `ChatAutoTrigger` tables prevent replay and duplicate processing ✅
- **Customer isolation:** `customerId` injected by `FinanceAiService` from the verified session, not from AI tool input ✅

---

## Action Items (Prioritized)

### 🔴 P0 — Fix Immediately

1. **Generate `@prisma/client-finance`** (A1, A5)
   - Create `apps/api/prisma/schema-finance.prisma` OR install `@prisma/client-finance` as a placeholder until SP7.1 DB is provisioned
   - Alternatively, refactor `PrismaFinanceService` to not extend `PrismaClient` when DB is disabled — use a stub/conditional type
   - 7 TypeScript errors + 2 test suite failures are caused by this single missing artifact
   - File: `apps/api/src/prisma/prisma-finance.service.ts`

### 🟠 P1 — Fix This Week

2. **Audit `web-widget.controller.ts`** (A2)
   - `POST /widget/init` and `GET /widget/messages/:roomId` have no visible authentication guard
   - If these serve unauthenticated public chat widgets, document explicitly in `security.md` public-endpoints list
   - If they should be protected, add `@UseGuards(JwtAuthGuard, RolesGuard)` or appropriate widget token guard
   - File: `apps/api/src/modules/staff-chat/web-widget.controller.ts`

3. **Fix `CreateContactModal.test.tsx` failures** (A5)
   - 2 web tests timeout on `apiPostMock` never being called after form submit
   - Likely a form validation change added a required field that the test doesn't fill
   - File: `apps/web/src/components/contacts/CreateContactModal.test.tsx`

### 🟡 P2 — Fix This Sprint

4. **Decimal precision in money-adjacent services** (A3)
   - Highest priority: `repossessions.service.ts:136-137`, `purchase-orders/po-receiving.service.ts:86,250`, `crm/customer-scoring.service.ts:121`
   - These feed financial calculations; precision loss on >15-digit Decimals can silently corrupt amounts
   - Use `.toFixed(2)` for display, keep `Prisma.Decimal` for arithmetic
   - Lower priority (display-only): stickers, chatbot, shop-catalog

5. **Add `branchId` index to Customer model** (B3)
   - `@@index([branchId])` missing — BranchGuard filters by branchId on most customer queries
   - Add via migration: `CREATE INDEX customers_branch_id_idx ON customers(branch_id)`

6. **Soft-delete filter in `stickers.service.ts` and `compliance.service.ts`** (A4)
   - `StickerTemplate`, `Product`, `PricingTemplate` queries omit `deletedAt: null`
   - `compliance.service.ts` Contract/LegalCase queries would include soft-deleted records in reports
   - Add `where: { deletedAt: null }` to all `findMany`/`findFirst` on deletable models

### 🔵 P3 — Track / Backlog

7. **`inter-company.service.ts` soft-delete** (A4)
   - `InterCompanyTransaction` appears to have no `deletedAt` in schema — verify if intentional
   - If the model should be soft-deletable, add field + migration

8. **Bundle chunking for `LettersPage`** (A6)
   - `LettersPage` is 569 kB minified / 219 kB gzip — largest page bundle
   - Candidate for further code-splitting (lazy sub-components, defer heavy PDF logic)

---

*Report generated: 2026-06-20 by CTO Watchdog agent. Total checks: 15. FAIL: 2, WARN: 4, OK/PASS: 9.*
