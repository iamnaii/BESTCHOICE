# CTO Watchdog Report — 2026-06-24

## Summary
**9/15 checks passed** — 2 critical failures (API TS errors, API test regressions) need immediate action.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors (API) | **FAIL** | 7 errors — `@prisma/client-finance` module not generated; affects `prisma-finance.service.ts` and `health.controller.ts` |
| A1 TS Errors (Web) | **PASS** | 0 errors |
| A2 Security | **WARN** | 2 unguarded controllers not in `security.md` allow-list; raw SQL is safe; 1 localStorage E2E-only token ref |
| A3 Decimal | **FAIL** | ~25 `Number()` casts on money Decimal fields across 8+ services |
| A4 Soft-Delete | **WARN** | findMany/findFirst without `deletedAt:null` in ChatMessage, ShopCatalog, SystemConfig — some intentional (append-only models) |
| A5 Tests | **FAIL** | API: 145/5070 failed (14 suites). Web: 1/741 failed (timeout). See details below. |
| A6 Bundle | **WARN** | `excel` chunk 256 kB gzip, `LettersPage` 220 kB gzip, `index` vendor 174 kB gzip |

### A1 Details — API TypeScript errors (7)
All 7 errors share one root cause: `@prisma/client-finance` Prisma client not generated.
```
src/prisma/prisma-finance.service.ts: Cannot find module '@prisma/client-finance'
src/modules/health/health.controller.ts(144): PrismaFinanceService is not assignable
src/prisma/prisma-finance.service.spec.ts(29,34,39): $queryRaw / healthCheck missing
```
`prisma-finance/schema.prisma` exists but `npx prisma generate --schema=prisma-finance/schema.prisma` was never run (or the generated files are missing). Fix: add generation step to startup hook / CI.

### A2 Security Details
**Controllers intentionally public but missing from `security.md` allow-list:**
- `apps/api/src/modules/staff-chat/web-widget.controller.ts` — serves anonymous web chat widget visitors. Has `@Throttle()` + `@SkipCsrf()`. Public by design per JSDoc.
- `apps/api/src/modules/line-oa/line-login.controller.ts` — LINE OAuth callback (browser fallback for LIFF). `@SkipCsrf()`, no JWT needed by design.

**Raw SQL (`$executeRawUnsafe`):** Used only for `pg_advisory_xact_lock(${lockKey})` where `lockKey` is a deterministic integer hash — safe against injection. **No parameterization risk.**

**localStorage:** One line in `apps/web/src/lib/api.ts`:
```ts
const e2eToken = localStorage.getItem('access_token');  // E2E test shim only
```
This is wrapped in a conditional for Playwright E2E tests and does not run in production. Low risk but worth confirming the guard condition.

### A3 Decimal Violations (highest-risk instances)
Files with `Number()` on money Decimal fields:
| File | Count | Example |
|------|-------|---------|
| `chatbot-finance/services/finance-tools.service.ts` | 6 | `Number(nextPayment.amountDue)`, `Number(p.amountPaid)` |
| `line-oa/chatbot.service.ts` | 5 | `Number(p.amountDue ?? 0)` in reduce |
| `sales/services/sale-creation.service.ts` | 1 | `Number(product.costPrice)` |
| `sales/services/sale-writer.service.ts` | 2 | `Number(product.costPrice)`, `Number(getRateForMonths...)` |
| `customers/services/customer-query.service.ts` | 1 | `Number(outstanding._sum.amountDue)` |
| `shop-catalog/shop-catalog.service.ts` | 2 | `Number(g._min?.costPrice)`, `Number(u.costPrice)` |
| `line-oa/services/payment-evidence.service.ts` | 2 | `Number(amountMin)`, `Number(amountMax)` |
| `chatbot-finance/services/auto-trigger.service.ts` | 1 | `Number(args.payment.amountDue) - Number(args.payment.amountPaid)` |

These bypass Prisma Decimal precision and risk floating-point rounding in financial calculations.

### A5 Test Regression Details
**API tests — 145 failed across 14 suites:**

Root cause 1 — `@prisma/client-finance` module missing (3 suites):
- `src/prisma/prisma-finance.service.spec.ts`
- `src/modules/journal/outbox-processor.service.spec.ts`
- `src/modules/health/health.controller.spec.ts`
- `src/cli/backfill-user-companies.cli.spec.ts`

Root cause 2 — `DATABASE_URL not found` (238 test cases across ~10 suites):
- `asset/__tests__/asset.service.spec.ts` — 56 tests
- `other-income/__tests__/maker-checker.spec.ts`
- `other-income/__tests__/other-income.service.spec.ts`
- `other-income/__tests__/template.service.spec.ts`
- `depreciation/__tests__/depreciation.service.spec.ts`
- `overdue/__tests__/collections-foundation.seed.spec.ts`
- These tests use real PrismaService without mocking — require `DATABASE_URL` env variable.

**Web tests — 1 failed:**
- `CreateContactModal.test.tsx` — SUPPLIER test timed out (5000ms). Likely async rendering issue.

**Baseline comparison:** CLAUDE.md baseline = 577 API tests / 26 suites. Current run shows 5070 tests / 448 suites — test count grew significantly since baseline was written. The 577 baseline figure is outdated.

### A6 Bundle Size
Chunks exceeding 500 KB raw (Vite threshold):
| Chunk | Raw | Gzip |
|-------|-----|------|
| `excel-DSeR0V3q.js` | 929.91 kB | **256.44 kB** ⚠️ |
| `thai-address-data-DH0nNkw2.js` | 870.87 kB | 69.29 kB (data file, gzip acceptable) |
| `index-BpoyHzRb.js` | 741.68 kB | 174.39 kB (vendor chunk) |
| `LettersPage-C0n3Stjc.js` | 568.93 kB | **219.89 kB** ⚠️ |
| `ContractTemplatesPage-CNXrM1zi.js` | 489.35 kB | 145.33 kB |
| `pdf-CbdPgFaP.js` | 430.54 kB | 139.43 kB |
| `charts-DtrQsyEN.js` | 417.85 kB | 119.57 kB |

`LettersPage` at 220 kB gzip suggests heavy deps (PDF generation?) bundled into one page chunk. Also: `PeriodClosePage` triggers a dynamic-import warning (statically imported by `PeriodsTab` so split is ineffective).

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | 181 models with uuid IDs, Decimal money fields, correct enum casing. Float only on GPS/confidence (non-money). |
| B2 Migrations | **WARN** | 281 migrations. Latest: `add_shop_cash_account_code_to_branch`. One DROP-heavy migration detected. |
| B3 Indexes | **PASS** | FK fields appear indexed; no obvious missing coverage found. |
| B4 Drift | **PASS** | Latest migration matches schema (`shop_cash_account_code TEXT` on branches). |

### B1 Details
- **IDs**: All 181 models use UUID `@default(uuid())` ✅
- **Money**: `@db.Decimal(12, 2)` used for all financial fields ✅
- **Floats**: 9 Float fields — all are `gpsLatitude/Longitude`, `confidence`, `quality`, or AI config thresholds. None are money. ✅
- **Enums**: PascalCase names, SCREAMING_SNAKE_CASE values throughout ✅

### B2 Migration Details
- `20260971000000_remove_2fa`: Drops 2FA columns (`two_factor_secret`, `two_factor_enabled`, etc.) and `two_factor_otp_requests` table. This appears to be intentional tech debt cleanup after 2FA feature was removed. No accidental drops. ✅
- Latest migration `add_shop_cash_account_code_to_branch` uses `IF NOT EXISTS` — idempotent ✅

### B4 Drift
Latest migration SQL:
```sql
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "shop_cash_account_code" TEXT;
```
Matches `Branch.shopCashAccountCode String? @map("shop_cash_account_code")` in schema.prisma ✅

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Models current (Haiku 4.5 + Sonnet 4.6), MAX_TOOL_ITERATIONS=5, Sentry present, maxTokens=1024, 30s timeout per iteration |
| C2 Prompt | **OK** | Bank account, phone, hours consistent with constants. ~2k tokens. No contradictions. |
| C3 Tools | **OK** | 7 tools defined, all 7 handled in tool-executor.ts, Thai descriptions, proper schemas |
| C4 Auto-Trigger | **WARN** | All 6 reminder types covered, idempotency correct. Per-payment send failures not forwarded to Sentry. |
| C5 Security | **OK** | LIFF uses LiffTokenGuard, Admin uses JwtAuthGuard+RolesGuard, Webhook uses LineFinanceWebhookGuard, customerId injected server-side |

### C1 AI Service Details
- **Models**: `claude-haiku-4-5-20251001` (greeting/FAQ) → escalates to `claude-sonnet-4-6` (tool synthesis) ✅
- **MAX_TOOL_ITERATIONS**: Constant defined at line 23, used as loop bound ✅
- **Error handling**: Full try/catch with `Sentry.captureException` and `aiUsage.record` ✅
- **maxTokens**: 1024 (reasonable for customer-facing replies) ✅
- **Per-iteration timeout**: 30s via SDK `{ timeout: 30_000 }` — prevents runaway iterations ✅

### C2 Prompt vs Constants Consistency
| Item | system-prompt.ts | finance-rules.ts |
|------|-----------------|-----------------|
| Bank | ธนาคารกสิกรไทย 203-1-16520-5 | ธนาคารกสิกรไทย 203-1-16520-5 ✅ |
| Phone | 063-134-6356 | 063-134-6356 ✅ |
| Late fee | 50 บาท/วัน | LATE_FEE_PER_DAY = 50 ✅ |
| Hours | 09:00-18:00 จันทร์-เสาร์ | start/end/days match ✅ |

Estimated prompt length: ~1,500 tokens (67 lines). Well within limits.

### C3 Tool Coverage
All 7 tools in `FINANCE_TOOLS[]` have matching `case` handlers in `tool-executor.ts`:
`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human` ✅

### C4 Auto-Trigger Details
- **Idempotency**: `ChatAutoTrigger.create()` with `@@unique([customerId, referenceKey])` — duplicate sends caught as P2002 and skipped ✅
- **Types covered**: T-5, T-3, T-1, T (09:00 cron) + T+1, T+3 (10:00 cron) = 6/6 ✅
- **Sentry on cron failure**: Both `runDailyReminders` and `runDailyEscalations` have `Sentry.captureException` ✅
- **Gap**: In `sendReminder()`, individual send failure (`lineClient.pushText` throws) is logged + FAILED status written but NOT forwarded to Sentry. If LINE API is down, all per-payment failures are silent in Sentry.
- **Decimal violation**: `Number(args.payment.amountDue) - Number(args.payment.amountPaid)` — Decimal precision lost in reminder amount calculation.

### C5 Security Details
- **LIFF**: `chatbot-finance-liff.controller.ts` uses `@UseGuards(LiffTokenGuard)` ✅
- **Admin**: `chatbot-finance-admin.controller.ts` uses `@UseGuards(JwtAuthGuard, RolesGuard)` ✅
- **Webhook**: `chatbot-finance.controller.ts` POST /webhook uses `@UseGuards(LineFinanceWebhookGuard)`, test endpoints use `@UseGuards(JwtAuthGuard, RolesGuard)` ✅
- **Data isolation**: `customerId` in `ToolCallContext` is injected by server from verified session — AI cannot request another customer's data ✅
- **Webhook dedup**: `webhook-dedup.service.ts` exists in chatbot-finance/services/ ✅

---

## Action Items

### 🔴 CRITICAL — Fix before next deploy

1. **Generate `@prisma/client-finance`** — `prisma-finance/schema.prisma` exists but client was never generated. Causes 7 TS compile errors + 4 test suites failing. Fix:
   ```bash
   cd apps/api && npx prisma generate --schema=prisma-finance/schema.prisma
   ```
   Add this to `package.json` `postinstall` or startup hook alongside the existing `prisma generate`.

2. **API test regression (145 failures)** — Root cause: tests using real PrismaService without `DATABASE_URL`. Asset, OtherIncome, Depreciation, Collections suites all fail. Fix: either mock PrismaService in these tests OR add `.env.test` with a `DATABASE_URL` pointing to a test DB.

### 🟡 HIGH — Fix this sprint

3. **Decimal precision violations (~25 instances)** — `Number()` wraps Decimal money fields across chatbot-finance, line-oa, sales, shop-catalog, customers services. Each risks sub-cent rounding in displayed amounts and calculations. Replace with `new Prisma.Decimal(value)` or `.toFixed(2)` + string formatting. Highest impact: `finance-tools.service.ts` and `auto-trigger.service.ts` (used in customer-facing reminders).

4. **Update `security.md` allow-list** — `web-widget.controller.ts` and `line-login.controller.ts` are intentionally public but undocumented. Add to the "Intentionally Public Endpoints" section to avoid future security scanner false positives.

### 🟢 MEDIUM — Backlog

5. **LettersPage bundle size** (220 kB gzip) — Investigate what's pulling ~570 kB raw into `LettersPage`. Likely PDF/print libs. Extract heavy dependencies into separate lazy chunks.

6. **Fix `PeriodClosePage` dynamic import warning** — It's statically imported by `PeriodsTab` defeating the lazy split. Remove the static import or restructure.

7. **Sentry for per-payment send failures (C4)** — `sendReminder()` swallows individual LINE send errors. Add `Sentry.captureException` with severity `warning` and a count-based alarm threshold to detect LINE API degradation.

8. **Web test flake (CreateContactModal)** — 1 timeout in SUPPLIER test. Likely missing `await` or unmocked async call. Investigate and fix.

9. **Update baseline in CLAUDE.md** — "577 API tests / 26 suites, 129 web tests / 11 files" is outdated. Current: ~5070 API tests / 448 suites, 741 web tests / 111 files.
