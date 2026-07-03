# CTO Watchdog Report — 2026-07-03

## Summary
11/15 checks passed. 1 FAIL (API TypeScript errors), 4 WARN (security, decimal, soft-delete, tests). No critical security or data-loss issues. Immediate action needed on PrismaFinanceService compilation errors and one unsafe raw SQL call.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors all in `prisma-finance.service.ts` — missing `@prisma/client-finance` module. Web: 0 errors. |
| A2 Security | **WARN** | 1 `$executeRawUnsafe` with string interpolation (`e-tax-xml.service.ts:160`). All flagged controllers have appropriate alternative guards (LiffTokenGuard, LineWebhookGuard, ShopBotDefenseGuard). localStorage used only in E2E Playwright test path. |
| A3 Decimal | **WARN** | ~35+ `Number()` wrapping Decimal money fields across: `collections-notifier.service.ts` (6×), `notification-reminder.service.ts` (6×), `line-oa/chatbot.service.ts` (7×), `finance-tools.service.ts` (2×), `sale-writer.service.ts` (3×), `auto-trigger.service.ts` (2×). Mostly display/notification contexts but precision risk remains. |
| A4 Soft-Delete | **WARN** | `inter-company.service.ts` (7 findMany/findFirst without `deletedAt: null`), `reporting/compliance.service.ts` (3×), `installments/reschedule.service.ts` (2×). Other flagged queries are on intentionally append-only models (ChatMessage, SystemConfig, etc.). |
| A5 Tests | **WARN** | API: 5122/5275 passed; 145 failed across 10 suites. **All failures are `PrismaClientInitializationError: DATABASE_URL not found`** — integration tests need a live DB, not a code regression. Web: 907/907 passed (140 test files). Baseline was 577 API / 129 web — web has grown to 907, API total grew to 5275. |
| A6 Bundle | **PASS** | No chunk exceeds 500 kB gzip. Largest: `excel` 256 kB gz, `LettersPage` 220 kB gz, `index` 177 kB gz. Vite warns about uncompressed sizes (excel 930 kB, thai-address-data 871 kB) — already split chunks. One static+dynamic import conflict on `PeriodClosePage` (imported both statically by `PeriodsTab.tsx` and dynamically by `App.tsx` — dynamic import is no-op). |

### A1 Detail — TypeScript Errors (API)

All 7 errors are in two files related to an incomplete `PrismaFinanceService` split:

```
src/prisma/prisma-finance.service.ts(2,30): TS2307 — Cannot find module '@prisma/client-finance'
src/prisma/prisma-finance.service.ts(42,16): TS2339 — '$connect' does not exist
src/prisma/prisma-finance.service.ts(48,16): TS2339 — '$disconnect' does not exist
src/modules/health/health.controller.ts(144,24): TS2345 — PrismaFinanceService not assignable to health-probe type
src/prisma/prisma-finance.service.spec.ts(29,34): TS2339 — '$queryRaw' does not exist
src/prisma/prisma-finance.service.spec.ts(34,35): TS2339 — 'healthCheck' does not exist
src/prisma/prisma-finance.service.spec.ts(39,21): TS2339 — 'healthCheck' does not exist
```

Root cause: `@prisma/client-finance` package was never generated (single-DB setup). The service and its spec assume a second Prisma client that doesn't exist.

### A2 Detail — Security

**`$executeRawUnsafe` in `e-tax-xml.service.ts:160`:**
```ts
await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
```
`lockKey` is a computed integer hash (not user input), so actual SQL injection risk is low. However, `$executeRaw` template literal form is the safe pattern and should be used instead (as done in `journal-auto.service.ts:133`).

**Controllers cleared as legitimate public:**
- `web-widget.controller.ts` — public chat widget for anonymous visitors, throttled (30 req/60s), documented
- `line-oa/line-login.controller.ts` — public LINE OAuth callback
- `liff-api.controller.ts` — guarded by `LiffTokenGuard`
- `line-oa-chatbot.controller.ts` — guarded by `LineWebhookGuard`
- All `shop-*` controllers — guarded by `ShopBotDefenseGuard`

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | UUIDs: ✅ all models. Money: Float only for GPS coords and AI confidence scores, all financial amounts use `@db.Decimal(12,2)`. Enum naming: PascalCase/SCREAMING_SNAKE_CASE convention followed. `deletedAt` present on all critical business models verified (Customer, Contract, Payment, Product, etc.). |
| B2 Migrations | **PASS** | 287 migrations. Latest: `20260979000000_partial_link_purpose_metadata` (additive, safe). DROP usage limited to `DROP CONSTRAINT IF EXISTS` / `DROP INDEX IF EXISTS` / `DROP COLUMN IF EXISTS` safety guards. All `ALTER TYPE ADD VALUE` use `IF NOT EXISTS`. No destructive `ALTER TYPE … RENAME` or data-loss `DROP TABLE`. |
| B3 Indexes | **PASS** | 630 index definitions across schema. Automated FK index check reports 0 missing FK indexes. |
| B4 Drift | **PASS** | Latest migration (`20260979`) adds `purpose TEXT NOT NULL DEFAULT 'INSTALLMENT'` and `metadata JSONB` to `partial_payment_links` — matches `PartialPaymentLink` model in schema. No mismatch detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Models: `claude-sonnet-4-6` (Sonnet, tool-use path) + `claude-haiku-4-5-20251001` (Haiku, greeting/FAQ). Both current. `MAX_TOOL_ITERATIONS = 5` ✅. `maxTokens = 1024` ✅. Sentry: `captureException` on errors, `captureMessage` on max-iterations hit ✅. 30s per-iteration timeout ✅. Prompt cache TTL 5 min ✅. |
| C2 Prompt | **OK** | Business hours: จ-ส 09:00-18:00 ✅. Phone: 063-134-6356 ✅. Bank: KBank 203-1-16520-5 ✅. Forbidden-word mapping (หนี้→ยอดรอชำระ etc.) defined ✅. Prompt estimated ~350 tokens — reasonable. No contradictions found with `finance-rules.ts`. |
| C3 Tools | **OK** | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All 7 handled in `tool-executor.ts` switch statement ✅. Input schemas present in `tool-input-schemas.ts`. |
| C4 Auto-Trigger | **OK** | All 6 trigger types covered: `REMINDER_T_MINUS_5/3/1`, `REMINDER_T_DAY`, `ESCALATION_T_PLUS_1/3`. Idempotency: atomic DB unique constraint on `(customerId, referenceKey)` — P2002 = skip (safe under concurrent runs). Sentry captures on both cron job error handlers ✅. |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard` ✅. `customerId` injected by orchestrator, not extractable from tool input ✅. Webhook dedup via `referenceKey` unique constraint ✅. `web-widget.controller.ts` intentionally public (anonymous chat), throttled ✅. |

---

## Action Items

### 🔴 P1 — Fix Now

1. **A1 — `prisma-finance.service.ts` TypeScript errors** (7 errors)
   - `@prisma/client-finance` module doesn't exist — service assumes a second Prisma client that was never set up
   - Fix: Either generate the second client via `prisma generate --schema=prisma/schema-finance.prisma`, or remove the service if the multi-DB split is not yet active
   - Files: `apps/api/src/prisma/prisma-finance.service.ts`, `prisma-finance.service.spec.ts`, `modules/health/health.controller.ts`

### 🟠 P2 — Fix This Sprint

2. **A2 — Replace `$executeRawUnsafe` with parameterized form**
   - File: `apps/api/src/modules/e-tax-xml/e-tax-xml.service.ts:160`
   - Fix: `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(${lockKey})\``
   - Low actual risk (lockKey is integer hash), but violates safe-SQL convention

3. **A5 — Wire DATABASE_URL into CI/test environment**
   - 10 test suites (145 tests) fail with `PrismaClientInitializationError: DATABASE_URL not found`
   - These are integration tests (asset, other-income, depreciation, collections) that need a test DB
   - Fix: Add `DATABASE_URL` to GitHub Actions secrets + test env, or mock PrismaService in affected specs

4. **A4 — Soft-delete filters missing in 3 services**
   - `apps/api/src/modules/inter-company/inter-company.service.ts` — 7 queries missing `deletedAt: null`
   - `apps/api/src/modules/reporting/compliance.service.ts` — 3 queries
   - `apps/api/src/modules/installments/reschedule.service.ts` — 2 queries
   - Risk: deleted records appearing in reports and compliance views

### 🟡 P3 — Backlog

5. **A3 — Decimal precision in notification/chatbot services**
   - Priority files: `collections-notifier.service.ts`, `notification-reminder.service.ts`, `finance-tools.service.ts`
   - These are display/messaging contexts (not accounting JEs), but `Number(Decimal)` can silently lose sub-satang precision on large amounts
   - Fix: Use `Prisma.Decimal.toNumber()` explicitly or `.toFixed(2)` for display

6. **A6 — Static+dynamic import conflict on `PeriodClosePage`**
   - `src/App.tsx` imports dynamically; `src/pages/SettingsPage/tabs/PeriodsTab.tsx` imports statically
   - Dynamic import is no-op — bundle not split as intended
   - Fix: Remove static import from `PeriodsTab.tsx`, pass the component via props or `React.lazy`

---

## Environment Context

- **Test failures root cause**: `DATABASE_URL` not available in this watchdog execution environment — all 145 failures are infrastructure failures, NOT code regressions. Unit tests (no DB needed) pass: 5130 tests.
- **Web test growth**: Baseline was 129 tests; current run shows 907 tests in 140 files — significant test suite expansion since baseline was set.
- **API test total**: 5275 tests in 470 suites (vs baseline 577) — the baseline number appears to be suite count, not test count.
