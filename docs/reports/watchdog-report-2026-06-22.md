# CTO Watchdog Report — 2026-06-22

## Summary

**7/15 checks fully green.** 3 FAILs (TypeScript errors, Decimal compliance, API test regressions) and 5 WARNs requiring attention. Root cause of both A1 and A5 is the same missing `@prisma/client-finance` package — fixing it will unblock the failing test suites.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors (API) | **FAIL** | 6 errors — `@prisma/client-finance` module not found; cascades into `PrismaFinanceService` type errors (`$connect`, `$disconnect`, `$queryRaw` missing) |
| A1 TS Errors (Web) | **PASS** | 0 errors |
| A2 Security | **WARN** | No SQL injection, no token storage, no hardcoded secrets. **Critical gap**: `staff-chat/web-widget.controller.ts` is unguarded and not in `security.md` allow-list — `GET /widget/messages/:roomId` exposes full chat history to anyone with a roomId. Also 10 other `shop-*`/metrics/LIFF/LINE-webhook controllers are legitimate-public but undocumented in the allow-list. |
| A3 Decimal | **FAIL** | 25+ `Number()` conversions on Decimal money fields across 12+ services. High-risk: `contract-snapshot.service.ts:141,144`, `sale-creation.service.ts:95`, `sale-writer.service.ts:296`, `paysolutions-confirmation.service.ts:54,75,84,91,177`, `paysolutions-webhook.service.ts:661`, `notifications/notification-reminder.service.ts:256`, `notifications/collections-notifier.service.ts:62,134,214`, `accounting/receivables-report.service.ts:56`, `chatbot-finance/finance-tools.service.ts:55-56,125,128,144,213`. These may cause 1-satang rounding errors on financial calculations. |
| A4 Soft-Delete | **WARN** | 2 confirmed gaps: `stickers/stickers.service.ts:56` — `stickerTemplate.findUnique` missing `deletedAt: null` (soft-deleted template can be printed); line 114 — `companyInfo.findFirst` also missing the filter. |
| A5 Tests (API) | **FAIL** | 145 failed / 4867 passed / 5020 total. All 14 failed suites trace back to the `@prisma/client-finance` TS compile error (cascades into module load failures). One additional suite fails due to a Prisma DB connection error in seed spec. Baseline note: test count has grown from v4 baseline (577) to 5020 current — healthy growth. |
| A5 Tests (Web) | **WARN** | 1 failed / 661 passed / 662 total. `CreateContactModal.test.tsx` — SUPPLIER test times out at 5000ms (likely a flaky MSW/jsdom network error). |
| A6 Bundle | **WARN** | Build succeeded. No chunks exceed 500 KB **gzipped**. Four chunks exceed 500 KB **minified** (Vite warns): `excel-DI5aN8zZ.js` (929 KB / 256 KB gzip), `thai-address-data-D3RlJG_d.js` (870 KB / 69 KB gzip), `LettersPage-D_QL1n6d.js` (569 KB / 220 KB gzip), `ContractTemplatesPage-VaA4qasF.js` (489 KB / 145 KB gzip). The `excel` and `thai-address-data` chunks are already split per v3 hardening — further splitting would require lazy-loading address data on demand. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | No Float money fields (PASS). No enum naming violations (PASS). Three financial evidence tables missing `deletedAt`: `PromiseSlot` (dunning lifecycle), `ExpenseLine` (accounting evidence), `PayrollLine`/`PayrollCustomIncome`/`PayrollCustomDeduction` (payroll/tax evidence). Also: `Contract.productId` FK has no `@@index`. Ten+ append-only/detail models (`JournalPostAuditLog`, `DepreciationEntry`, `BroadcastApproval`, `ExpenseDetail`, etc.) lack `///` comments explaining their intentional field omissions. |
| B2 Migrations | **PASS** | 278 total. Latest 3 well-named: `journal_line_restrict_and_index`, `remove_2fa`, `add_payroll_line_user_fk`. `remove_2fa` has DROP TABLE/COLUMN statements but all guarded with `IF EXISTS` — safe and intentional. No unguarded destructive DDL. |
| B3 Indexes | **WARN** | High-traffic gaps: `Contract.productId` — no index (FK join used in contract-product queries → seq scan on a large table). `DunningAction.paymentId` / `.dunningRuleId` — no standalone indexes. `InstallmentSchedule.accrualJournalEntryId` / `.vat60dayJournalEntryId` — no indexes despite use in accrual lookups. `DailyAssignment.contractId` — covered only by unique constraint, not an explicit index. |
| B4 Drift | **PASS** | Latest 3 migrations verified against schema.prisma — zero drift. `journal_line_restrict_and_index`: `onDelete: Restrict` + `@@index([journalEntryId, deletedAt])` both match. `remove_2fa`: no 2FA columns or models remain in schema. `add_payroll_line_user_fk`: `PayrollLine.userId` field + relation + index all match. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **WARN** | Model: `claude-sonnet-4-6` ✓. `MAX_TOOL_ITERATIONS = 5` guard ✓. Sentry `captureException` on errors + `captureMessage` on iteration exhaustion ✓. `maxTokens: 1024` — flagged as low; edge cases (formal templates, error explanations) may truncate. Recommend raising to 2048. Dead method `buildMessages` at line 307 — never called, should be removed. |
| C2 Prompt | **PASS** | System prompt and constants are consistent: bank account `203-1-16520-5 / KBank` ✓, phone `063-134-6356` ✓, hours `จันทร์-เสาร์ 09:00-18:00` ✓. Minor: `LATE_FEE_PER_DAY = 50` in `finance-rules.ts` is described as "source of truth" but is actually a fallback default (SystemConfig takes precedence) — comment is misleading. Prompt length ≈ 550 tokens (safe). |
| C3 Tools | **PASS** | All 7 tools have Thai descriptions ✓. All input schemas defined ✓. `tool-executor.ts` switch handles all 7 tool names + default error case ✓. Runtime input validation layer (`TOOL_INPUT_VALIDATORS`) adds defense-in-depth ✓. Customer data isolation: `customerId` injected by orchestrator, never in Claude's input schema — architectural-level isolation ✓. |
| C4 Auto-Trigger | **WARN** | All 6 reminder types covered: T-5, T-3, T-1, T, T+1, T+3 ✓. Idempotency via `ChatAutoTrigger` DB unique constraint (multi-instance Cloud Run safe) ✓. Sentry on cron-level errors ✓. **Gap**: per-reminder LINE API send failures (lines 236-244) catch-block logs the error but does NOT call `Sentry.captureException` — individual send failures are invisible in Sentry dashboards. |
| C5 Security | **PASS** | LIFF controller: no JWT, uses `LiffTokenGuard` + channel check ✓. Admin controller: `JwtAuthGuard + RolesGuard` ✓. Webhook dedup: DB-backed unique constraint, multi-instance safe, 7-day retention cron ✓. Webhook HMAC: raw-body SHA256 with `timingSafeEqual` ✓. Anomaly recording on missing/invalid signatures ✓. |

---

## Action Items (Prioritized)

### P0 — Fix immediately (blocking CI and tests)

1. **`@prisma/client-finance` missing** — `apps/api/src/prisma/prisma-finance.service.ts:2` imports a non-existent package, causing 6 TS errors and 14 test suite failures (145 tests). Run `npx prisma generate --schema apps/api/prisma/schema-finance.prisma` or verify the package exists in `node_modules/@prisma/`. If the dual-schema approach was abandoned, delete `prisma-finance.service.ts` and its test spec.

### P1 — High risk (financial accuracy)

2. **Decimal compliance — 25+ violations** — Replace `Number(amount)` with `Prisma.Decimal` arithmetic in:
   - `contract-snapshot.service.ts:141,144`
   - `sale-creation.service.ts:95` and `sale-writer.service.ts:296`
   - `paysolutions-confirmation.service.ts:54,75,84,91,177`
   - `paysolutions-webhook.service.ts:661`
   - `notification-reminder.service.ts:256` and `collections-notifier.service.ts:62,134,214`
   - `receivables-report.service.ts:56`
   - `finance-tools.service.ts:55-56,125,128,144,213`

3. **`web-widget.controller.ts` unguarded** — `GET /widget/messages/:roomId` exposes full chat history to anyone with a roomId UUID. Add `ShopBotDefenseGuard` + rate-limit throttle, or add an authenticated-read endpoint and restrict the public one to write-only. Document in `security.md` allow-list.

### P2 — Medium risk (data integrity, performance)

4. **Missing `deletedAt` on financial evidence tables** — Add `deletedAt DateTime?` to `PromiseSlot`, `ExpenseLine`, `PayrollLine`, `PayrollCustomIncome`, `PayrollCustomDeduction`. Use a 2-step migration (add nullable → no backfill needed).

5. **Missing index on `Contract.productId`** — Add `@@index([productId])` to Contract model. High-traffic FK join will cause seq scans on the `contracts` table at scale.

6. **Soft-delete gaps in stickers** — `apps/api/src/modules/stickers/stickers.service.ts:56` — add `deletedAt: null` to `stickerTemplate.findUnique`; line 114 — add to `companyInfo.findFirst`.

### P3 — Low risk / observability

7. **Sentry on chatbot send failures** — `auto-trigger.service.ts:236-244` — add `Sentry.captureException(err, { extra: { customerId, triggerType } })` in the per-reminder send-failure catch block.

8. **Add missing indexes** — `DunningAction.paymentId`, `DunningAction.dunningRuleId`, `InstallmentSchedule.accrualJournalEntryId`, `InstallmentSchedule.vat60dayJournalEntryId`.

9. **Update `security.md` allow-list** — Document 10+ public controllers: `liff-api.controller.ts`, `line-login.controller.ts`, `line-oa-chatbot.controller.ts`, `metrics.controller.ts`, `shop-auth-social.controller.ts`, `shop-cart.controller.ts`, `shop-line-chat.controller.ts`, `shop-reservation.controller.ts`, `shop-shipping.controller.ts`, `shop-tracking.controller.ts`, `web-widget.controller.ts`.

10. **Chatbot `maxTokens`** — Raise from 1024 → 2048 in `finance-ai.service.ts:41`. Remove dead `buildMessages` method at line 307.

11. **Schema deviation comments** — Add `/// Immutable audit log — updatedAt/deletedAt intentionally omitted` to `JournalPostAuditLog`, `DepreciationEntry`, `BroadcastApproval`, `FeeWaiverApproval`, `LegalCaseDocument`, `SavingPlanPayment`, `OtherIncomeAttachment`, `ContractDailySnapshot`, `BookingItem`, and the detail models.

12. **Fix flaky web test** — `CreateContactModal.test.tsx` SUPPLIER case times out at 5000ms — increase timeout or fix MSW handler for `/suppliers`.
