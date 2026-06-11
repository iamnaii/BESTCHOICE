# CTO Watchdog Report — 2026-06-11

## Summary
**12/15 checks passed.** 3 issues require action: A1 (API TS errors — `@prisma/client-finance` not generated), A5 (145 test failures — same root cause), and B1/B3 (schema timestamp drift on 55 models).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors — API | **FAIL** | 6 errors in `prisma-finance.service.ts` + `health.controller.ts` + spec: `@prisma/client-finance` package not generated. No second schema/generator found — `PrismaFinanceService extends PrismaClient` from a non-existent output. Web: **0 errors**. |
| A2 Security | **WARN** | 5 controllers without `@UseGuards`: `web-widget.controller` (intentionally public — anonymous chat widget), `metrics.controller` (protected by `X-Metrics-Token` HMAC), `yeastar-webhook.controller` (HMAC-SHA256 verified), `facebook-webhook.controller` (Hub signature + HMAC-SHA256 verified), `sms-webhook.controller` (expected public). `line-login.controller` has no guard — requires review. One `$executeRawUnsafe` in `expense-document-create.service.ts` (lines 308, 699) uses string interpolation with an `id` — verify `id` is always a UUID from DB, not user-supplied string. No localStorage token storage (E2E test scaffolding uses `localStorage` for test injection only, cleared immediately). No hardcoded secrets found. |
| A3 Decimal | **WARN** | 15+ `Number()` casts on Decimal money fields in live code paths: `finance-tools.service.ts` (L55, 56, 125, 128, 144, 213), `auto-trigger.service.ts` (L169), `chatbot.service.ts` (L151, 160, 172, 199, 215), `sale-creation.service.ts` (L95), `sale-writer.service.ts` (L156, 205, 296, 347), `customer-query.service.ts` (L341), `shop-catalog.service.ts` (L95, 136), `staff-chat/chat-commerce.service.ts` (L132, 134, 220, 255). Most are for display/comparison — those in financial calculations (sale-writer, finance-tools) are higher risk for precision loss. |
| A4 Soft-Delete | **WARN** | 1,313 `findMany/findFirst/findUnique` calls without `deletedAt: null` in service files. Many are against immutable models (AuditLog, CallLog, etc.) which correctly omit `deletedAt`. High-risk candidates: `installments/reschedule.service.ts`, `reporting/compliance.service.ts`, `inter-company.service.ts`. A targeted audit of business-critical models is recommended. |
| A5 Tests | **FAIL** | **API: 4,861/5,014 passed** (145 failed, 14 suites). Root cause: `@prisma/client-finance` not generated → `prisma-finance.service.ts` fails to compile → cascades to 14 suites. Same fix as A1. **Web: 627/627 passed** (96 files, 0 failures). ECONNREFUSED in web test output is expected (no API server running in test env). |
| A6 Bundle | **WARN** | 7 chunks exceed 500 KB gzipped: `excel` (256 KB gzip), `LettersPage` (219 KB gzip), `ContractTemplatesPage` (145 KB gzip), `pdf` (139 KB gzip), `charts` (119 KB gzip), `CollectionsPage` (101 KB gzip), `thai-address-data` (69 KB gzip). `thai-address-data` at 870 KB raw / 69 KB gzip is the most anomalous (static data loaded eagerly). No regression from v4 baseline — existing split for exceljs/jspdf/recharts is in place. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 188 models scanned. **55 models** deviate from the 3-timestamp rule. Notable: `ExpenseDetail`, `CreditNoteDetail`, `PayrollDetail`, `VendorSettlementDetail` missing `uuid-id` + all timestamps (likely join/detail tables using composite PKs — acceptable if intentional). `FeeWaiverApproval` missing `createdAt/updatedAt/deletedAt`. `PromiseSlot` missing `deletedAt`. `SavingPlanPayment`, `AssetTransferHistory`, `DepreciationEntry`, `SlipFingerprint` missing `updatedAt/deletedAt`. No `Float` money fields found — all financial Decimals use `@db.Decimal(12, 2)`. Enums: correct PascalCase/SCREAMING_SNAKE_CASE throughout. |
| B2 Migrations | **PASS** | 277 migration files. Latest: `20260971000000_remove_2fa` (descriptive name). The 2FA removal migration uses `DROP COLUMN IF EXISTS` and `DROP TABLE IF EXISTS` — safe idempotent pattern. Several older migrations use `ALTER TYPE ... ADD VALUE` without `IF NOT EXISTS` (e.g., `20260307200000`, `20260954000000`) — would fail on re-run but not on first apply. No unsafe `ALTER TYPE ... RENAME` that could corrupt running data. |
| B3 Indexes | **WARN** | `Payment` model: well-indexed (contractId, dueDate, status, paidDate, status+dueDate). `Contract`: well-indexed (customerId, branchId, status, salespersonId, workflowStatus). Key concern: `CallLog`, `PromiseSlot`, `ChatAutoTrigger` — not spot-checked for FK index coverage. `FinanceReceivable` has `(status, branchId)` compound index from v2. No glaring missing indexes on the highest-traffic models. |
| B4 Drift | **PASS** | Latest migration (`remove_2fa`) drops 2FA columns/table matching code removal. `PrismaFinanceService` references `@prisma/client-finance` which requires a second Prisma schema with `output = "@prisma/client-finance"` — that generator does not exist in `schema.prisma`. This is a configuration gap, not a schema drift. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` guard present. Sentry capture on both max-iterations and exceptions. `maxTokens = 1024` (appropriate for payment chat). 30s per-iteration timeout via SDK `{ timeout: 30_000 }`. Prompt cache with 5-min TTL. AiUsageService recording on success + error paths. |
| C2 Prompt Quality | **OK** | Bank account `203-1-16520-5` matches `finance-rules.ts` constant. Phone `063-134-6356` matches constant. Business hours `09:00-18:00` จันทร์-เสาร์ matches constants. No contradictions between prompt and constants found. Prompt is ~68 lines / ~1,200 tokens — well within budget. Prompt is DB-backed with admin-editable override (Phase E). |
| C3 Tools | **OK** | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All 7 have Thai descriptions and proper JSON Schema input definitions. `tool-executor.ts` handles all 7 with matching `case` statements. `customerId` is orchestrator-injected (not in tool schema) — AI cannot cross-customer query. |
| C4 Auto-Trigger | **OK** | Idempotency via atomic `ChatAutoTrigger.create` with `@@unique([customerId, referenceKey])` — P2002 on duplicate → `'skipped'` return. All 6 types covered: T-5, T-3, T-1, T-day (cron 09:00), T+1, T+3 (cron 10:00). Sentry capture on cron-level failure for both `runDailyReminders` and `runDailyEscalations`. Note: individual `sendReminder` failures are logged but not Sentry-captured when LINE send fails — minor observability gap. |
| C5 Security | **OK** | LIFF controller (`chatbot-finance-liff.controller.ts`) uses `@UseGuards(LiffTokenGuard)` — LINE ID token verified server-side. Admin controller uses `@UseGuards(JwtAuthGuard, RolesGuard)`. Webhook dedup via `WebhookDedupService.isDuplicate(webhookEventId)` — replay attacks prevented. Customer data isolation: `customerId` injected by orchestrator at `FinanceToolExecutor.execute()`, not from Claude tool input. |

---

## Action Items (Prioritized)

### P0 — Fix Immediately

1. **`@prisma/client-finance` not generated** (`apps/api/src/prisma/prisma-finance.service.ts`):
   - Add a second Prisma schema (`schema-finance.prisma`) with `generator client { output = "@prisma/client-finance" }` **OR** change `PrismaFinanceService` to not extend `PrismaClient` directly (use a factory/wrapper pattern with the main `@prisma/client`).
   - This is the single root cause of **6 TypeScript errors** and **145 test failures** (14 suites).
   - Fix first — all other test counts are meaningless until this resolves.

### P1 — Fix This Sprint

2. **`Number()` in financial calculations** (`sale-writer.service.ts:205`, `sale-creation.service.ts:95`):
   - `costPrice = Number(product.costPrice)` loses Decimal precision for amounts > 2^53 — unlikely but non-compliant with coding standards. Replace with `new Prisma.Decimal(product.costPrice)`.
   - `finance-tools.service.ts` L55-56, 125, 128: chatbot display only — lower priority but still worth fixing.

3. **`line-login.controller.ts` has no guard** — requires review to confirm it's intentionally public or document it in `security.md` allowed-list.

4. **`$executeRawUnsafe` with interpolated `id`** (`expense-document-create.service.ts:308, 699`) — verify `id` is always a DB-sourced UUID, never user-controlled string. If so, document; otherwise switch to parameterized `$executeRaw`.

### P2 — Next Sprint

5. **Schema timestamp drift** — 55 models deviate from timestamp rules. Priority: `FeeWaiverApproval` (missing all 3 timestamps), `PromiseSlot` (missing `deletedAt`). Detail/join tables (`ExpenseDetail`, `CreditNoteDetail`, etc.) should have `/// Intentionally omitted — join table` comment per database.md exception pattern.

6. **Individual `sendReminder` Sentry capture** — `auto-trigger.service.ts` logs LINE send failures but doesn't capture to Sentry. Add `Sentry.captureException` inside the `catch (err)` for `sendReminder` to match the pattern used on cron-level failures.

7. **`thai-address-data` bundle** (870 KB raw) — consider lazy-loading address data only when the address form is rendered rather than including in main chunk.

8. **Soft-delete audit** — run a targeted grep on `contracts.service.ts`, `payments.service.ts`, `customers.service.ts` specifically for `findMany` without `deletedAt: null`. The 1,313 raw count includes many safe cases (immutable models), but a focused review is warranted.

### P3 — Backlog

9. **ALTER TYPE without IF NOT EXISTS** — 3 older migrations (`20260307200000`, `20260954000000`, `20260942000000`) use `ADD VALUE` without `IF NOT EXISTS`. Add to migration checklist for future migrations.

10. **Chatbot `search_knowledge_base` tool** — prompt says "handoff if unsure" but the tool exists as an alternative. Verify the decision tree in prod matches the intent (tool first → handoff if no KB match).
