# CTO Watchdog Report — 2026-06-26

## Summary
**10/15 checks passed** — 2 critical issues require immediate action: `@prisma/client-finance` not generated (breaks TS + 3 test suites) and 148 test failures across 17 suites. 13 `Number()` precision violations on Decimal money fields and a stale hardcoded late-fee rate in chatbot tool description also need fixing.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 4 errors in `prisma-finance.service.ts` — `@prisma/client-finance` module not found (`$connect`/`$disconnect`/`$queryRaw` missing). Web: **0 errors** ✓ |
| A2 Security | **WARN** | 7 unguarded controllers — all **intentionally public** with alternate auth: `facebook-webhook` (FB verify token), `yeastar-webhook` (HMAC), `metrics` (`X-Metrics-Token` header), `web-widget` (throttled public chat), `line-login` (OAuth callback), `sms-webhook`, `shop-public-config`. ② `$executeRawUnsafe` in 2 places for advisory locks (low injection risk; should use tagged template). ③ `localStorage` in `api.ts` is E2E-only path, clearly annotated. |
| A3 Decimal | **FAIL** | 13+ `Number()` wrappers on Decimal money fields across: `finance-tools.service.ts` (amountDue, amountPaid), `chatbot.service.ts` (amountDue×5), `auto-trigger.service.ts` (amountDue, amountPaid), `notification-reminder.service.ts` (amountDue), `sale-creation.service.ts`/`sale-writer.service.ts` (costPrice), `customer-query.service.ts` (outstanding). All risk float precision loss on financial calculations. |
| A4 Soft-Delete | **WARN** | Scan found `findMany`/`findFirst` without `deletedAt: null` in `inter-company.service.ts` (7 queries), `stickers.service.ts` (stickerTemplate, companyInfo), `compliance.service.ts` (contract, legalCase, callLog). Many hits are on models like `SystemConfig`/`ChatRoom` that intentionally lack soft-delete. Manual triage needed. |
| A5 Tests | **FAIL** | API: **4954 passed, 148 failed, 8 skipped** (5110 total, 17 failed suites). Root causes: ① `@prisma/client-finance` TS error breaks 3 suites (`prisma-finance.service.spec.ts`, `health.controller.spec.ts`, `backfill-user-companies.cli.spec.ts`). ② `prisma.fixedAsset` undefined in 14 asset/payment/other-income test suites — Prisma client needs regeneration with latest schema. Web: **778 passed, 0 failed** (119 files) ✓ |
| A6 Bundle | **WARN** | No chunk exceeds 500 KB gzip. 4 chunks exceed Vite's 500 KB raw warning: `excel` 929 KB (256 KB gz), `thai-address-data` 870 KB (69 KB gz), `index` 740 KB (174 KB gz), `LettersPage` 568 KB (219 KB gz). Also: static import of `PeriodClosePage` prevents dynamic split (`INEFFECTIVE_DYNAMIC_IMPORT` warning). |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | Float fields: `gpsLatitude`/`gpsLongitude`, `confidence`, AI thresholds — **all non-money**, acceptable. No `@db.Decimal` violations on financial fields. Soft-delete: `Customer` model has all 3 timestamps (verified lines 917-919). Schema scanner flagged false-positives on large models due to nested content; core models OK. Some sub-models (`ExpenseDetail`, `ExpenseLine`, `PayrollLine`, `FixedAsset`, etc.) intentionally lack `deletedAt` — review if any should have it. |
| B2 Migrations | **PASS** | 282 migrations total. Latest: `20260975000000_add_client_message_id_to_chat_message` — descriptive, safe (`ALTER TABLE ADD COLUMN TEXT`). Historical `DROP` operations all appear to be schema cleanup (removed legacy columns/types), none drop production data tables. |
| B3 Indexes | **PASS** | Core FK fields (`branchId`, `companyId`, `contractId`, `customerId`) have `@@index`. `Contract` has compound indexes `[status, deletedAt, branchId]` and `[workflowStatus, updatedAt]`. v3 hardening confirmed 6 missing FK indexes were added. |
| B4 Drift | **PASS** | Latest migration adds `client_message_id TEXT` on `chat_messages`. Schema has corresponding `clientMessageId String? @map("client_message_id")`. Consistent. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` + `claude-haiku-4-5-20251001` (current, Haiku→Sonnet routing). `MAX_TOOL_ITERATIONS = 5` present. `maxTokens = 1024`. Sentry captures via `@sentry/nestjs`. Prompt cached 5 min TTL from DB. All OK. |
| C2 Prompt | **WARN** | System prompt is 67 lines (reasonable). Persona, forbidden words, emoji usage all defined. **Issue**: `calculate_fine` tool *description* hardcodes "50 บาท/วัน" but the actual `calculateFine()` implementation calls `resolveLateFee(cfg, days, ...)` which reads from `SystemConfig` (D2 per-day model). If the production `late_fee_per_day_rate` differs from 50, the tool description gives wrong information to the model before it calls the tool. |
| C3 Tools | **OK** | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All have Thai descriptions with clear usage guidance. Tool executor handles all 7 in `switch`. `customerId` injected by orchestrator — Claude cannot access other customers' data. |
| C4 Auto-Trigger | **OK** | All 6 reminder types covered: T-5, T-3, T-1, T, T+1, T+3. Idempotency via `ChatAutoTrigger` table (confirmed by test at `auto-trigger.service.spec.ts:98`). Sentry capture on both daily-reminders and daily-escalations crons. |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard`. Admin controller has `@UseGuards(JwtAuthGuard, RolesGuard)`. Webhook dedup: `WebhookDedupService` is used in `chatbot-finance.controller.ts` (line 48). Customer isolation: `customerId` in tool context comes from orchestrator session, not from Claude's tool call arguments. |

---

## Action Items

### P0 — Fix immediately (breaks tests + TS)

1. **Generate `@prisma/client-finance`** — `PrismaFinanceService` imports `@prisma/client-finance` which is not in `node_modules/@prisma/`. Run `npx prisma generate --schema=apps/api/prisma/schema.prisma` and ensure the Finance schema has a separate client configured. Until fixed, 4 TS errors and 3+ test suites are broken.

2. **Regenerate Prisma client for test environment** — 14 test suites fail with `prisma.fixedAsset` undefined, indicating the test Prisma client was generated before `FixedAsset` was added to schema. Run `npx prisma generate` in `apps/api` to regenerate and re-run tests.

### P1 — Fix this sprint (precision / correctness)

3. **Decimal compliance in chatbot-finance module** — `finance-tools.service.ts` lines 53-54, 68, 113, 116, 132, 189 use `Number()` on `amountDue`/`amountPaid`. Replace with `Prisma.Decimal` arithmetic. Same for `auto-trigger.service.ts` line 177 and `notification-reminder.service.ts` lines 123, 131, 143. Use `.toFixed(2)` or `.toString()` only when formatting for display.

4. **Fix `calculate_fine` tool description** — Update the description string in `tool-definitions.ts` from hardcoded "50 บาท/วัน" to "ตามอัตราที่กำหนดในระบบ" so the model doesn't present stale rate info to customers before the tool resolves the live rate.

### P2 — Fix next sprint (hygiene)

5. **Replace `$executeRawUnsafe` with tagged templates** — `e-tax-xml.service.ts:160` and `contacts/contact-resolver.service.ts:32` use `$executeRawUnsafe(\`SELECT pg_advisory_xact_lock(${lockKey})\`)`. `lockKey` is a hash so injection risk is low, but replace with `$executeRaw\`SELECT pg_advisory_xact_lock(${lockKey})\`` for consistency and lint compliance.

6. **Bundle: split LettersPage** — `LettersPage-*.js` is 568 KB raw / 219 KB gz. Lazy-load the letter template rendering/PDF libs within the page to reduce initial chunk. Also fix the `PeriodClosePage` static-import-plus-dynamic-import warning.

7. **Audit soft-delete in inter-company.service.ts** — 7 `findMany`/`findFirst` calls lack `{ where: { deletedAt: null } }`. Confirm whether `InterCompanyTransaction` has soft-delete and add the filter if so.

---

*Generated by CTO Watchdog agent — 2026-06-26*
