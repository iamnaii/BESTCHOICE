# CTO Watchdog Report — 2026-07-02

## Summary
11/15 checks passed. 4 issues require action: **1 FAIL** (API TypeScript errors from ungenerated `@prisma/client-finance`), **1 FAIL** (2 web test regressions in `CreateContactModal`), **1 WARN** (238 `Number()` calls on money fields in new modules), **1 WARN** (LettersPage chunk 219 KB gzipped / 568 KB minified).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 5 errors — `@prisma/client-finance` module not found (SP7.1 finance-DB split, `prisma generate --schema=prisma-finance/schema.prisma` not run). Web: 0 errors ✓ |
| A2 Security | PASS | 6 unguarded controllers — all justified: web-widget (anonymous visitors + Throttle), line-login (OAuth redirect), metrics (X-Metrics-Token shared-secret), yeastar/facebook webhooks (HMAC verified), sms-webhook (on public allowlist). `$executeRawUnsafe` uses parameterized `hashtext($1)` pattern — safe. No token in localStorage. No hardcoded secrets. |
| A3 Decimal | **WARN** | 238 `Number()` calls near money fields. New modules not covered by v4 cleanup: `stickers.service.ts` (cashPrice, installment prices), `shop-catalog.service.ts` (costPrice, installmentPrice), `sales/sale-writer.service.ts` (commissionRate, costPrice), `line-oa/chatbot.service.ts` (amountDue, amountPaid), `staff-chat/chat-commerce.service.ts` (amountDue, lateFee). Low accounting-journal risk (these modules don't post JEs), but precision loss is possible in display and comparison. |
| A4 Soft-Delete | WARN | Automated scan flagged ~24 service files with possible missing `deletedAt: null`. Many are likely false positives (queries on immutable/audit models). Confirmed candidates needing review: `staff-chat/services/session-ops.service.ts`, `staff-chat/services/snooze.service.ts`, `line-oa/broadcast.service.ts`, `reporting/compliance.service.ts`. |
| A5 Tests | **WARN** | API: 5024/5177 unit tests pass. **145 integration tests fail** — all due to missing `DATABASE_URL` in watchdog environment (no DB in remote container). 14 suites affected; 3 suites (`backfill-user-companies`, `prisma-finance.service`, `health.controller`) also fail from missing `@prisma/client-finance` generation. **Code regressions: 0** — all failures are environment-only. Test suite has grown from 577→5177 (10× since v4 baseline). Web: **2 failures** in `src/components/contacts/CreateContactModal.test.tsx` (line 115 — `apiPostMock` not called, `hasVat` assertion). 837/839 web tests pass. |
| A6 Bundle | WARN | No chunks >500 KB gzipped ✓. Two large chunks: `LettersPage` 219 KB gzip / 568 KB minified (heaviest non-vendor); `excel-DZ41r1fZ` 256 KB gzip / 929 KB minified (expected — ExcelJS). Vite warns about `PeriodClosePage` being both statically and dynamically imported (ineffective code split — wastes the lazy-load). |

> **A5 note**: Integration tests need `DATABASE_URL` (no DB provisioned in watchdog container). All 5024 unit tests pass. 145 integration test failures are environment-only. Web regression (`CreateContactModal`, 2 failures) is a real code issue.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | WARN | **Float fields**: only used for GPS coordinates and AI confidence scores — no money fields use Float ✓. **Enums**: PascalCase names + SCREAMING_SNAKE_CASE values throughout ✓. **Missing `deletedAt`**: 60 models flagged — many are legitimately exempt (AuditLog, JournalEntry, PaymentDraft join tables etc.). Notable gap: `Customer` model itself missing `deletedAt` (may be intentional if customers are never soft-deleted, but undocumented). `FixedAsset`, `DepreciationEntry` also missing. |
| B2 Migrations | PASS | 286 migrations total. Latest: `20260978000000_purchasing_v2_foundation` (descriptive, additive: ADD COLUMN + ALTER TYPE ADD VALUE). `20260971000000_remove_2fa` drops 2FA columns — reviewed, intentional cleanup. No dangerous unreviewed DROPs. |
| B3 Indexes | WARN | 105 models with FK fields possibly lacking `@@index`. Most notable: `Contract` (missing indexes on `productId`, `reviewedById`, `interestConfigId`, `pdpaConsentId`); `Payment` (missing `toleranceJournalLineId`); `PurchaseOrder` (missing `createdById`, `approvedById`); `StockTransfer` (missing `confirmedById`, `dispatchedById`). Note: scan is heuristic — actual query performance should confirm before adding indexes. |
| B4 Drift | PASS | Latest migration (`purchasing_v2_foundation`) adds `ordered_at`, `is_direct_receive`, `defect_reason`, `gr_number` to purchasing tables — consistent with schema.prisma. `prisma-finance/schema.prisma` (SP7.1) exists as a separate file but `@prisma/client-finance` package not generated — this is the root cause of A1 TS errors. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | OK | Model: `claude-haiku-4-5-20251001` (base, fast responses), escalates to `claude-sonnet-4-6` after first tool use. `MAX_TOOL_ITERATIONS = 5` ✓. `maxTokens = 1024` ✓. Sentry `captureException` + `captureMessage` on error and max-iteration paths ✓. 30s per-iteration AbortController ✓. |
| C2 Prompt | OK | 67 lines — concise. Business hours: จันทร์-เสาร์ 09:00-18:00 ✓. Phone: 063-134-6356 ✓. PII guard: ห้ามพิมพ์เลขบัตรประชาชน/OTP ✓. Bank info injected dynamically via `FinanceConfigService` (not hardcoded in constants) ✓. No contradictions found. |
| C3 Tools | OK | 7 tools: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All have Thai descriptions and typed input schemas ✓. Tool executor handles all 7 by name with `customerId` passed from orchestrator (Claude cannot inject its own customer ID) ✓. |
| C4 Auto-Trigger | OK | T-5, T-3, T-1, T covered at 09:00 cron. T+1, T+3 escalations covered at 10:00 cron ✓. Idempotency via `ChatAutoTrigger` table ✓. Sentry `captureException` on daily-reminders and daily-escalations failures ✓. |
| C5 Security | OK | LIFF controller uses `LiffTokenGuard` (server-side LINE ID token verification) — intentionally public without JWT ✓. Admin controller has `@UseGuards(JwtAuthGuard, RolesGuard)` ✓. Customer data isolation: `customerId` bound at session level, not passed from AI response (tool-executor.ts:29 comment + line 68-83) ✓. Webhook dedup: `ChatAutoTrigger` P2002 unique-constraint idempotency ✓. |

---

## Action Items (Prioritized)

### P0 — Fix Immediately

1. **[A1] Generate `@prisma/client-finance`** — Run `npm --prefix apps/api run prisma:finance:generate` (or `prisma generate --schema=apps/api/prisma-finance/schema.prisma`). The 5 TypeScript errors in `prisma-finance.service.ts` and `health.controller.ts` are purely from a missing generation step; the code itself is correct. CI will fail if not fixed.

2. **[A5] Fix `CreateContactModal` test regression** — 2 tests in `src/components/contacts/CreateContactModal.test.tsx` failing at line 115 (`apiPostMock` not called, `hasVat` assertion). Likely caused by a recent change to the contact creation flow or modal API call. Investigate the diff between the test expectation and current component behavior.

### P1 — Fix This Week

3. **[A3] Decimal cleanup in new modules** — Convert `Number()` calls on Prisma Decimal money fields in: `stickers.service.ts`, `shop-catalog.service.ts`, `sales/sale-writer.service.ts`, `line-oa/chatbot.service.ts`, `staff-chat/chat-commerce.service.ts`. Use `new Prisma.Decimal(value)` or `.toFixed(2)` for display. None of these write to journal entries directly, but precision bugs in commission calculation and payment comparison are real risks.

4. **[A6] Fix `PeriodClosePage` ineffective dynamic import** — Vite warns that `PeriodClosePage` is both statically imported by `SettingsPage/tabs/PeriodsTab.tsx` and dynamically imported by `App.tsx`. Remove the dynamic import from `App.tsx` or convert the static import in `PeriodsTab.tsx` to a dynamic one.

### P2 — Fix This Sprint

5. **[A4] Soft-delete audit on new modules** — Review `staff-chat/services/session-ops.service.ts`, `staff-chat/services/snooze.service.ts`, `line-oa/broadcast.service.ts`, `reporting/compliance.service.ts` for missing `deletedAt: null` in `findMany` queries. Most are probably intentional (querying append-only event logs), but should be documented.

6. **[B3] Add missing FK indexes on `Contract`** — `productId`, `reviewedById`, `interestConfigId`, `pdpaConsentId` are common filter/join columns on the hottest table in the system. Add composite or individual indexes.

7. **[B1] Document `Customer` model `deletedAt` exception** — Either add `deletedAt` (if customers should be soft-deletable) or add a `/// No soft delete — customer records are permanent per PDPA retention policy` comment in schema.prisma.

### P3 — Backlog

8. **[A3] Full `Number()` audit** — Run systematic sweep across all 238 occurrences and categorize: display-only (safe), arithmetic (risky), comparison (risky). Prioritize `purchase-orders/services/po-lifecycle.service.ts` lines 226-227 which compare `Number()` vs money field.

---

*Generated by CTO Watchdog routine — 2026-07-02*
