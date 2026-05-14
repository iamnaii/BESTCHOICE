# CTO Watchdog Report — 2026-05-14

## Summary
10/15 checks PASS, 5 WARN, 0 FAIL — system is healthy with minor precision and coverage gaps.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | API: 0 errors. Web: 0 errors. |
| A2 Security | **WARN** | See details below. |
| A3 Decimal | **WARN** | 30+ `Number()` wrapping Decimal money fields across 8 files. |
| A4 Soft-Delete | **WARN** | ~15 `findMany` calls missing `deletedAt: null`. |
| A5 Tests | **WARN** | API: 2406 pass / 155 fail (all DB-env). Web: 269 pass (↑ from 129 baseline). |
| A6 Bundle | **PASS** | All chunks under 500 KB gzip. Largest: `excel` 256 KB, `ContractTemplates` 148 KB, `pdf` 140 KB. |

### A2 Security — Details

**Controllers without JwtAuthGuard:**
- `metrics/metrics.controller.ts` — uses `@Public()` decorator (intentional, metrics/health endpoint)
- `shop-auth-social`, `shop-buyback`, `shop-cart`, `shop-catalog`, `shop-line-chat`, `shop-public-config`, `shop-reservation`, `shop-shipping`, `shop-tracking` — all use `ShopBotDefenseGuard` (custom bot-defense guard for public e-commerce API)
- **Gap**: Shop controllers are not listed in `security.md` as intentional public exceptions — only `shop/public-config` is documented. Should add the full list to prevent future confusion.

**Raw SQL (`$queryRaw*`):**
- `$executeRawUnsafe` in `other-income/services/doc-number.service.ts:15,40` — `SELECT pg_advisory_xact_lock(${lockKey})` where `lockKey` is a numeric hash (line 84: `private hashLockKey(key: string): number`). Safe.
- `$queryRawUnsafe` in `overdue/analytics-recovery.service.ts` and `overdue/analytics-aging.service.ts` — uses `$1`/`$2` parameterized placeholders, Date objects passed as separate args. Safe.
- All other `$queryRaw` usages use tagged template literals (safe parameterization). ✅

**localStorage token usage:**
- `apps/web/src/lib/api.ts:10,13` — reads `access_token` from localStorage only for E2E Playwright tests (`addInitScript` injection), cleared immediately after reading. Not a runtime vulnerability, but noteworthy.

**Hardcoded secrets:** None found. ✅

### A3 Decimal — Details

`Number()` wrapping Decimal money fields (risk: silent precision loss on large values):

| File | Instances | Context |
|------|-----------|---------|
| `chatbot-finance/services/finance-tools.service.ts:53,54,108,111,127,173` | 6 | amountDue / amountPaid — display in chat messages |
| `chatbot-finance/services/auto-trigger.service.ts:169` | 1 | amountDue - amountPaid for template |
| `chatbot-finance/services/admin-analytics.service.ts:177` | 1 | cost (AI usage cost display) |
| `staff-chat/services/chat-commerce.service.ts:132,134,220,255` | 4 | price / amount — cart display |
| `contracts/contract-snapshot.service.ts:141,144` | 2 | totalAmount / amountPaid — snapshot calc |
| `customers/customers.service.ts:1100` | 1 | totalOutstandingThb — dashboard KPI |
| `notifications/notifications.service.ts:998,1006,1018,1040,1159` | 5 | amountDue — SMS/notification text |
| `defect-exchange/defect-exchange.service.ts:184` | 1 | amountPaid filter comparison |

Most are display-only (`.toLocaleString()`). **Critical risk:** `contract-snapshot.service.ts:141,144` does arithmetic with `Number()` on aggregated sums — potential precision loss on large contract amounts.

### A4 Soft-Delete — Details

`findMany` without `deletedAt: null` (sample — some are for models without `deletedAt` by design):

| File | Model | Notes |
|------|-------|-------|
| `search/search.service.ts:68,91,111,126` | Contract, Customer, ContractLetter, Product | Search results may include soft-deleted records |
| `crm/services/customer-scoring.service.ts:29,101,130` | Customer, Payment, Contract | Scoring over deleted contracts |
| `product-detect.service.ts:34` | Product | Includes deleted products in detection |
| `interest-config/interest-config.service.ts:10` | InterestConfig | No deletedAt on model — acceptable |
| `chart-of-accounts/chart-of-accounts.service.ts:16,35,48` | ChartOfAccount | No deletedAt on model — acceptable |

### A5 Tests — Details

- **API (Jest):** 2406 pass, 155 fail, 2 skip across 226 suites. All 155 failures = `Environment variable not found: DATABASE_URL` — integration/seed tests that require a live DB. These are not logic regressions but should be `describe.skipIf(!process.env.DATABASE_URL)` to avoid CI noise.
- **Web (Vitest):** 269 pass across 32 files. Connection errors to `localhost:3000` during setup (API not running) are swallowed gracefully and don't affect test count. Baseline was 129 — growth to 269 reflects new test files added since baseline.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | No Float money fields. Float used only for GPS coords / AI confidence scores / thresholds. 436 indexes across 168 models. Enum naming correct. |
| B2 Migrations | **PASS** | 225 migrations. Latest: `20260922020000_seed_pr3_settings_keys` (descriptive). DROP operations all use `IF EXISTS` or are intentional schema refactors. No `ALTER TYPE … RENAME VALUE`. |
| B3 Indexes | **PASS** | 436 total indexes across 168 models. Key FK + status fields have indexes. |
| B4 Drift | **PASS** | Latest migration is idempotent `INSERT … ON CONFLICT DO NOTHING` seed. No schema drift detected. |

### B1 Notes
- `loyaltyBalance Int` — loyalty points (not money), acceptable as Int.
- `totalMonths Int` — installment count, not money.
- `PromiseSlot` model has `createdAt`/`updatedAt` but no `deletedAt` — append-only calllog child, consistent with documented exception pattern.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✅. `MAX_TOOL_ITERATIONS = 5` ✅. `maxTokens = 1024` ✅. Sentry imported and used ✅. |
| C2 Prompt | **WARN** | Prompt hardcodes values (bank account, phone, hours, late fee) that also exist in `finance-rules.ts` constants — dual maintenance risk. |
| C3 Tools | **OK** | 7 tools defined + 7 handled in executor (exact match). All have Thai descriptions. `customerId` injected by orchestrator — AI cannot request data for other customers. |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` table marker ✅. 6 types covered: T-5, T-3, T-1, T, T+1, T+3 ✅. Sentry capture on both cron error paths ✅. |
| C5 Security | **OK** | Admin controller: `JwtAuthGuard + RolesGuard` ✅. LIFF controller: `LiffTokenGuard` ✅. Webhook: `LineFinanceWebhookGuard` ✅. Customer data isolation enforced at orchestrator level ✅. |

### C2 Prompt — Details

System prompt (`prompts/system-prompt.ts`) hardcodes:
- Bank account: `203-1-16520-5` ← matches `FINANCE_BANK.accountNumber`
- Phone: `063-134-6356` ← matches `FINANCE_CONTACT_PHONE`
- Hours: `09:00-18:00 จันทร์-เสาร์` ← matches `BUSINESS_HOURS`
- Late fee: `50 บาท/วัน` ← matches `LATE_FEE_PER_DAY`

Values are consistent today, but changing a constant won't update the prompt automatically. Phase E note in the prompt acknowledges this: "ย้ายไป `ChatKnowledgeBase` table เพื่อให้ admin แก้ผ่าน UI ได้".

---

## Action Items

### High Priority

1. **[A3] Fix `contract-snapshot.service.ts:141,144` Decimal precision**
   `Number(paymentAgg._sum.amountDue ?? 0)` — arithmetic on aggregated sums. Use `new Prisma.Decimal(...)` for subtraction. This is a financial calculation, not display.

2. **[A4] Add `deletedAt: null` to `search/search.service.ts` queries**
   All 4 findMany calls in the search service (Contract, Customer, ContractLetter, Product) will return soft-deleted records in search results.

3. **[A4] Add `deletedAt: null` to `crm/services/customer-scoring.service.ts`**
   Scoring algorithms run over deleted Customer/Contract/Payment records — could skew tier calculations.

### Medium Priority

4. **[A2] Document shop-* controllers in `security.md`**
   Add `shop-auth-social`, `shop-buyback`, `shop-cart`, `shop-catalog`, `shop-line-chat`, `shop-reservation`, `shop-shipping`, `shop-tracking` to the intentionally public exceptions list with a note: "public e-commerce shop API, protected by `ShopBotDefenseGuard`".

5. **[A5] Skip DB-dependent tests when `DATABASE_URL` is absent**
   11 test suites (155 tests) fail with `DATABASE_URL` not found. Add `describe.skipIf(!process.env.DATABASE_URL)(...)` or equivalent to seed/integration specs to keep CI output clean.

6. **[A3] Audit `finance-tools.service.ts` Number() for display**
   7 `Number()` conversions in chatbot finance tools — these feed chat message text. While display-only, switching to `Prisma.Decimal.toFixed(2)` is safer and keeps the pattern consistent.

### Low Priority

7. **[C2] Eliminate dual maintenance in system prompt**
   Replace hardcoded bank/phone/hours in `system-prompt.ts` with references to constants from `finance-rules.ts`, or accelerate Phase E (DB-backed prompt). Currently a change to `FINANCE_BANK.accountNumber` would not update the bot's replies.

8. **[A6] Monitor bundle growth**
   `excel` (256 KB gzip), `ContractTemplates` (148 KB gzip), `pdf` (140 KB gzip) are within threshold but growing. If `ContractTemplatesPage` reaches 500 KB gzip, consider splitting its rich-text editor dependency.

9. **[A4] Verify `product-detect.service.ts` includes deleted products intentionally**
   If product detection is used for new-sale suggestions, deleted products appearing in detection would show discontinued items to customers.
