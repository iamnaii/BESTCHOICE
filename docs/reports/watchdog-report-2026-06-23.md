# CTO Watchdog Report — 2026-06-23

## Summary
11/15 checks passed — 1 critical code regression (`@prisma/client-finance` missing), 2 warnings (Decimal compliance, web test), 1 env-only test failure.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 3 errors. Web: 0 errors. |
| A2 Security | **WARN** | `$queryRaw` in 3 prod services; all parameterized. `localStorage` only in E2E helper. All unguarded controllers are legitimately public. |
| A3 Decimal | **WARN** | 15+ `Number()` calls near money fields across 8 services. |
| A4 Soft-Delete | **PASS** | Spot-checked Customer, Contract, Payment — all have `deletedAt: null` guards. Missing `deletedAt` models are all intentional (audit logs, tokens, event logs). |
| A5 Tests | **WARN** | API: 4876 passed / 145 failed. Web: 659 passed / 2 failed. API failures split: 144 = DATABASE_URL not set (env-only, not code regressions); 1 suite (`prisma-finance.service.spec`) = code issue tied to A1. Web: `CreateContactModal.test.tsx` — 2 UI tests timeout waiting for `apiPostMock`. |
| A6 Bundle | **PASS** | No chunk exceeds 500 kB gzipped. Largest: `excel` 256 kB gz, `LettersPage` 220 kB gz. Raw sizes trigger Vite warning (excel 930 kB, LettersPage 569 kB) but within gzip threshold. |

### A1 Detail — TypeScript Errors (API)

```
src/prisma/prisma-finance.service.ts(2,30): error TS2307:
  Cannot find module '@prisma/client-finance'
src/prisma/prisma-finance.service.ts(42,16): error TS2339:
  Property '$connect' does not exist on type 'PrismaFinanceService'
src/prisma/prisma-finance.service.ts(48,16): error TS2339:
  Property '$disconnect' does not exist on type 'PrismaFinanceService'
src/modules/health/health.controller.ts(144,24): error TS2345:
  'PrismaFinanceService' is not assignable to ... '$queryRaw' missing
src/prisma/prisma-finance.service.spec.ts — 3 type errors cascading from above
```

**Root cause**: `PrismaFinanceService` (added for SP7.1 split DB) imports `@prisma/client-finance` which has no generator configured in `schema.prisma` and is absent from `package.json`. The package must be generated with a separate `prisma generate --schema=prisma/schema-finance.prisma` step, or a stub/local output path must be added to the existing generator.

**Impact**: API TypeScript compilation fails; `health.controller.spec.ts` and `prisma-finance.service.spec.ts` fail at test time.

### A2 Detail — Security

- **`$queryRaw`** in production code:
  - `ai-training.service.ts` — cosine-distance vector search with `${intent}`, `${limit}` as tagged-template params. **Safe** (Prisma template-literal parameterization).
  - `receivable-recon.service.ts` — two static aggregation queries with no user input. **Safe**.
  - `audit.service.ts` — `pg_advisory_xact_lock` with `${lockKey}` (derived from internal enum). **Safe**.
  - `e-tax-xml.service.ts` — `pg_advisory_xact_lock` with `${lockKey}`. **Safe**.
  - `journal-auto.service.ts` — `pg_advisory_xact_lock`. **Safe**.
- **`$executeRawUnsafe`** only appears in test files (disabling Postgres triggers). Zero prod usage.
- **`localStorage`** token in `apps/web/src/lib/api.ts:10` is gated behind `process.env.VITE_E2E_MODE` (Playwright E2E injection only). Not a production risk.
- **Unguarded controllers**: all 15 flagged controllers are legitimately public —
  shop-* family uses `ShopBotDefenseGuard`, LIFF endpoints use `LiffTokenGuard`, LINE OAuth flow is a redirect-only public endpoint, web-widget is documented as anonymous.
- **No hardcoded secrets found**.

### A3 Detail — Decimal Compliance

Services with `Number()` conversions near Decimal money fields:

| Service | Count | Risk |
|---------|-------|------|
| `stickers.service.ts:168,175,185` | 3 | Display only (price labels) |
| `shop-catalog.service.ts:95,136,164,165` | 4 | Public storefront display |
| `chat-commerce.service.ts:132-134,220,255` | 5 | Balance computation + display — **precision risk** |
| `line-oa/chatbot.service.ts:151-215` | 5 | Customer-facing balance display — **precision risk** |
| `sales/sale-writer.service.ts:205,296` | 2 | `costPrice` and `interestRate` — **precision risk** |
| `customers/customer-query.service.ts:341` | 1 | `totalOutstandingThb` aggregation |
| `repossessions.service.ts:136-138` | 3 | `sellingPrice`, `financedAmount`, `storeCommission` — **precision risk** |
| `asset/asset-receipt-pdf.service.ts:324-329` | 5 | PDF rendering only — acceptable |
| `interest-config.service.ts:103-122` | 4 | Rate calculations — **precision risk** |

**Highest risk**: `chat-commerce.service.ts:132-134` computes `amountDue + lateFee - amountPaid` via `Number()` — can misrepresent cents in customer-facing balance. Recommend `Prisma.Decimal` arithmetic.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | 188 models. Float used only for GPS coords, confidence scores, bot thresholds — never money. All enums PascalCase/SCREAMING_SNAKE_CASE. |
| B2 Migrations | **PASS** | 280 migrations total. Latest: `20260973000000_create_chat_snoozes_side_messages` (clean). Previous: `20260972000000_journal_line_restrict_and_index` — only `DROP CONSTRAINT` to redefine FK (not data loss). No unsafe `ALTER TYPE` or `DROP TABLE` in last 5 migrations. |
| B3 Indexes | **PASS** | Contract model: 13 indexes incl. compound `(status, deletedAt, branchId)`. Payment model: 8 indexes incl. compound `(status, dueDate)`. Both well-covered. |
| B4 Drift | **PASS** | Latest migration creates `chat_snoozes` + side messages tables, consistent with `ChatSnooze` model in schema. No obvious drift. |

### B1 Float Usage Detail

```
gps_latitude / gps_longitude: Float  — GPS coordinates (acceptable)
confidence: Float                    — AI model confidence scores
salesBotConfidenceThreshold: Float   — system config threshold
serviceBotConfidenceThreshold: Float — system config threshold
```

No Float on price, amount, cost, fee, rate, or tax fields. ✓

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (Haiku→Sonnet escalation routing). `MAX_TOOL_ITERATIONS=5`. `maxTokens=1024`. Sentry on exception + max-iteration soft-alert. |
| C2 Prompt | **OK** | Bank account 203-1-16520-5 KBank ✓. Phone 063-134-6356 ✓. Hours Mon-Sat 09:00-18:00 ✓. No contradictions. Length reasonable (~1.5 kB). |
| C3 Tools | **OK** | 7 tools defined; all have Thai descriptions + proper JSON schemas. `tool-executor.ts` handles all 7 cases (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`). |
| C4 Auto-Trigger | **OK** | T-5/T-3/T-1/T covered (09:00 cron). T+1/T+3 covered (10:00 cron). Idempotency via `ChatAutoTrigger` table (P2002 = duplicate skip). Sentry on all cron errors. |
| C5 Security | **OK** | LIFF controller: `LiffTokenGuard` (LINE ID token verified server-side). Admin controller: `JwtAuthGuard + RolesGuard`. Webhook dedup: `ProcessedWebhookEvent` (DB-level dedup, multi-instance safe). Customer isolation: `customerId` injected by orchestrator; AI cannot address another customer. |

---

## Action Items (Prioritized)

### P0 — Fix Now (blocks compilation + CI)

1. **A1/TS: Generate `@prisma/client-finance` or add stub**
   - File: `apps/api/src/prisma/prisma-finance.service.ts`
   - Add a `generator client_finance` block to `schema.prisma` pointing to the finance schema (SP7 path), OR add `"@prisma/client-finance": "file:./generated/client-finance"` to `package.json` and run generate.
   - Alternatively if SP7 isn't ready, type the `super()` call against a locally-generated output path.
   - Fixes 3 TS errors + 2 failing test suites.

### P1 — Fix Soon (precision risk on money)

2. **A3: Replace `Number()` with `Prisma.Decimal` in balance-critical paths**
   - `chat-commerce.service.ts:132-134` — customer balance diff
   - `line-oa/chatbot.service.ts:151-215` — outstanding balance shown to customer
   - `sales/sale-writer.service.ts:205` — `interestRate` fetch used in contract creation
   - `repossessions.service.ts:136-138` — repossession financial summary
   - `interest-config.service.ts:103-122` — rate + commission % calculations

### P2 — Fix When Possible

3. **A5: Fix `CreateContactModal.test.tsx` (web) — 2 failing tests**
   - `src/components/contacts/CreateContactModal.test.tsx:115` times out waiting for `apiPostMock` after clicking "สร้าง" button
   - Likely a test setup issue (missing `act()` wrapper or async form submission timing). Investigate and fix.

4. **A3: Remaining `Number()` display paths** (lower risk but creates inconsistency)
   - `stickers.service.ts`, `shop-catalog.service.ts` — public storefront display only; precision loss limited to 2 decimal places but should use `toFixed(2)` on Decimal rather than `Number()`.
