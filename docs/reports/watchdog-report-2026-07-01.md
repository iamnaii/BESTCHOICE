# CTO Watchdog Report — 2026-07-01

## Summary
10/15 checks passed — 2 FAIL (A1, A5), 3 WARN (A2, A3, A6), 10 OK/PASS.
**Top blocker**: `@prisma/client-finance` not generated → cascades into 7 TS errors + 148 failing API tests across 17 suites.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors in `prisma-finance.service.ts` + `health.controller.ts` + spec — root cause: `@prisma/client-finance` module not generated (SP7.1 separate Finance DB). Web: 0 errors ✅ |
| A2 Security | **WARN** | `staff-chat/web-widget.controller.ts` completely unguarded (no JwtAuthGuard, no ShopBotDefenseGuard, no @Public). Other flagged controllers are intentional public/guard variants (ShopBotDefenseGuard, LiffTokenGuard, OAuth, metrics @Public). No hardcoded secrets found. localStorage usage in `api.ts` is E2E-test-only path, documented in comment. `$executeRawUnsafe` used only for `pg_advisory_xact_lock` with an integer hash (safe). |
| A3 Decimal | **WARN** | `Number()` on Decimal money fields in 6+ files: `chatbot-finance/services/finance-tools.service.ts` (5 instances: amountDue, amountPaid, lateFee, totalAmount), `customers/services/customer-analytics.service.ts` (Number on `_sum.amountDue`), `sales/services/sale-creation.service.ts` + `sale-writer.service.ts` (costPrice), `shop-catalog/shop-catalog.service.ts` (costPrice/price). |
| A4 Soft-Delete | **WARN** | 520 `findMany({` calls in services without explicit `deletedAt: null`. Many are on models without soft-delete (audit logs, append-only tables). Worst offenders: `inter-company.service.ts`, `compliance.service.ts`, `chat-ai-draft.service.ts`. Requires per-file triage to confirm true violations. |
| A5 Tests | **FAIL** | API: **148 failed / 5161 total** (17 failed suites). Root cause: `Cannot find module '@prisma/client-finance'` propagates into every test suite that imports any service touching the Finance DB. Web (Vitest): **823 passed / 128 files — all green** ✅ (up from baseline 129). |
| A6 Bundle | **WARN** | 4 chunks >500KB raw (minified): `excel.js` 929 KB / 256 KB gzip, `thai-address-data.js` 870 KB / 69 KB gzip, `index.js` 742 KB / 175 KB gzip, `LettersPage.js` 568 KB / 220 KB gzip. No single chunk exceeds 500 KB gzip. `PeriodClosePage` static-import from `SettingsPage` also negates dynamic splitting for that route. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | Float fields: only GPS coordinates and AI confidence scores — no money fields use Float ✅. All checked models (Customer, Contract, Payment, etc.) have uuid id + createdAt/updatedAt/deletedAt. Known exemptions (AuditLog, ChatMessage, PasswordResetToken, etc.) correctly omit updatedAt/deletedAt per documented exceptions. |
| B2 Migrations | **PASS** | 286 migrations. Latest (`20260978000000_purchasing_v2_foundation`): additive only — ADD VALUE to enum, CREATE TYPE DefectReason, ADD COLUMN (ordered_at, is_direct_receive, defect_reason, gr_number), 2-step NOT NULL migration with backfill ✅. Historical DROPs in older migrations are column replacements/refactoring (all IF EXISTS, no data loss risk). Migration `20260402030000_clear_seed_data_v2` contains `DELETE FROM` for seed data cleanup — intentional, not a risk in prod. |
| B3 Indexes | **WARN** | Script found 204 FK fields without explicit `@@index` declarations. High-priority gaps: `Contract.productId`, `Contract.reviewedById`, `DailyAssignment.contractId`, `DailyAssignment.paymentId`. Note: some FK fields covered by compound indexes not caught by the simple grep. Manual review recommended for high-query-volume FKs. |
| B4 Drift | **PASS** | Latest migration SQL matches schema.prisma additions: `DefectReason` enum, `goods_receivings.gr_number`, `purchase_orders.is_direct_receive/ordered_at`, `goods_receiving_items.defect_reason`. No obvious mismatches. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (customer synthesis) + `claude-haiku-4-5-20251001` (initial routing) ✅. MAX_TOOL_ITERATIONS = 5 ✅. Sentry.captureException present ✅. maxTokens = 1024 ✅. Prompt cache with 5-min TTL ✅. |
| C2 Prompt | **WARN** | Phone/bank/hours correct (063-134-6356, KBank 203-1-16520-5, Mon-Sat 09-18) ✅. **Contradiction**: system prompt hardcodes `"ค่าปรับล่าช้า: 50 บาท/วัน"` (flat) but: (1) `config.util.ts` default is 20 บาท/day, (2) reminder-templates hardcodes BRACKET `"50 บาท (1-2 วัน) หรือ 100 บาท (3+ วัน)"`, (3) CLAUDE.md states production seeds BRACKET mode. Bot tells customers wrong late-fee formula. `calculate_fine` tool description also says `(50 บาท/วัน)`. |
| C3 Tools | **OK** | 7 tools defined with Thai descriptions ✅. Input schemas valid ✅. All tool names handled in `tool-executor.ts` (get_current_balance, get_payment_schedule, calculate_fine, list_recent_receipts, get_bank_info, search_knowledge_base, handoff_to_human) ✅. customerId injected from auth context — AI cannot request data for other customers ✅. |
| C4 Auto-Trigger | **OK** | Idempotency via ChatAutoTrigger marker table before each send ✅. All 6 types covered: T-5, T-3, T-1, T-day (09:00 cron) + T+1, T+3 (10:00 cron) ✅. Both cron methods wrapped in try/catch with `Sentry.captureException` ✅. |
| C5 Security | **OK** | LIFF controller: `LiffTokenGuard` ✅. Admin controller: `JwtAuthGuard + RolesGuard` ✅. LINE webhook: `LineFinanceWebhookGuard` ✅. Tool executor uses `ctx.customerId` (server-injected) — no cross-customer data leak vector ✅. |

---

## Action Items

### 🔴 Critical (fix before next deploy)

1. **Generate `@prisma/client-finance`** — Run `npx prisma generate --schema=apps/api/prisma/schema-finance.prisma` (or equivalent). Until this is generated, 7 TS errors persist and 17 test suites (148 tests) fail. Affects CI gate. File: `apps/api/src/prisma/prisma-finance.service.ts`.

2. **Guard `web-widget.controller.ts`** — `apps/api/src/modules/staff-chat/web-widget.controller.ts` has no auth guard. All routes (POST /widget/init, GET /widget/messages/:roomId) are publicly reachable. Add `@UseGuards(JwtAuthGuard, RolesGuard)` at class level or confirm it's intentionally public and add to security allowlist in `security.md`.

### 🟡 High (fix this sprint)

3. **Chatbot late-fee contradiction** — System prompt (`system-prompt.ts:51`), tool description (`tool-definitions.ts:37`), and KB seed data all hardcode "50 บาท/วัน" flat rate. Reminder template uses BRACKET (50/100). Config default is 20. Bot is telling customers the wrong amount. Fix: sync all three sources to use `SystemConfig.late_fee_*` at runtime, or align them all to the current production BRACKET rule.

4. **`Number()` on Decimal money in chatbot** — `chatbot-finance/services/finance-tools.service.ts` lines 53, 54, 68, 113, 116, 132 wrap Prisma Decimal amounts in `Number()`. These amounts are shown to customers — floating-point drift can surface wrong baht values. Replace with `new Prisma.Decimal(...)` arithmetic or `.toFixed(2)` presentation only.

### 🔵 Medium (next sprint)

5. **Fix `Number()` on aggregate sums** — `customers/services/customer-analytics.service.ts` uses `Number(outstanding._sum.amountDue ?? 0)` — the `_sum` Decimal accumulation loses precision. Use `Prisma.Decimal` accumulation.

6. **Soft-delete audit on high-traffic services** — Triage `inter-company.service.ts` (3 unguarded findMany), `compliance.service.ts` (2 contract + callLog findMany), `installments/reschedule.service.ts` (installment findMany) to confirm `deletedAt: null` filters where required.

7. **Bundle: split `LettersPage` and `index.js`** — `LettersPage.js` at 568 KB raw (220 KB gzip) and `index.js` at 742 KB raw (175 KB gzip) are the worst offenders. `PeriodClosePage` negates its dynamic import due to a static import from `SettingsPage/tabs/PeriodsTab.tsx` — remove the static import.

8. **FK index review** — Add explicit `@@index` on `Contract.productId`, `Contract.reviewedById`, `DailyAssignment.contractId` at minimum. Run EXPLAIN ANALYZE on overdue dashboard query to confirm.
