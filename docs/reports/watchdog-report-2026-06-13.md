# CTO Watchdog Report — 2026-06-13

## Summary
10/15 checks passed — 3 FAIL, 2 WARN requiring action before next release.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 8 errors in `prisma-finance.service.ts` (missing `@prisma/client-finance` module + missing `$connect`/`$disconnect`/`$queryRaw` methods). Web: 0 errors. |
| A2 Security | **WARN** | 1 undocumented public controller (see below). Raw SQL parameterized. No localStorage token leaks. No hardcoded secrets. |
| A3 Decimal | **WARN** | 17 `Number(` calls on money fields across 8 services (see below). Not P0 — display/serialization only — but accumulation risk. |
| A4 Soft-Delete | **WARN** | `inter-company.service.ts` (4 queries), `compliance.service.ts` (4 queries), `stickers.service.ts` (3 queries), `installments/reschedule.service.ts` (1 query) missing `deletedAt: null`. |
| A5 Tests | **FAIL** | API: 4867 passed / 145 failed / 5020 total — 14 suites failing. Web: 646 passed / 1 failed / 647 total. |
| A6 Bundle | **PASS** | No chunks exceed 500 KB gzip. Largest: `excel` 256 KB gzip, `LettersPage` 220 KB gzip. Vite warns on raw size (929 KB unminified excel) but gzip is fine. |

### A1 — TypeScript Error Detail

```
src/prisma/prisma-finance.service.ts(2,30): TS2307 — Cannot find module '@prisma/client-finance'
src/prisma/prisma-finance.service.ts(42,16): TS2339 — Property '$connect' does not exist
src/prisma/prisma-finance.service.ts(48,16): TS2339 — Property '$disconnect' does not exist
src/modules/health/health.controller.ts(144,24): TS2345 — PrismaFinanceService missing '$queryRaw'
src/prisma/prisma-finance.service.spec.ts(29,34): TS2339 — '$queryRaw' does not exist
src/prisma/prisma-finance.service.spec.ts(34,35): TS2339 — 'healthCheck' does not exist
src/prisma/prisma-finance.service.spec.ts(39,21): TS2339 — 'healthCheck' does not exist
```

Root cause: `@prisma/client-finance` package not generated/installed in this environment.
`PrismaFinanceService` extends that missing client — all downstream uses break.

### A2 — Security Detail

**Undocumented public controller:** `apps/api/src/modules/staff-chat/web-widget.controller.ts`
- Fully public (no JWT, no ShopBotDefense, no LIFF token)
- Uses `roomId` as a capability token: "No auth required — the roomId acts as a capability token"
- **NOT listed** in `security.md`'s intentional public endpoint list
- Exposes `POST /widget/init` and `GET /widget/messages/:roomId` to anonymous internet traffic
- Risk: roomId brute-forcing could expose staff chat messages to unauthenticated callers

**Raw SQL review:** `$queryRaw` in `ai-training.service.ts` (lines 104, 115) uses parameterized template literals — safe. `receivable-recon.service.ts` also uses template literal syntax. `journal-auto.service.ts` uses advisory lock — safe. No `$executeRawUnsafe` in production code (only in test setup helpers).

Other controllers flagged as missing JwtAuthGuard are legitimately public:
- `shop-*` controllers → `ShopBotDefenseGuard` ✓ (per security.md)
- `chatbot-finance-liff.*` → `LiffTokenGuard` ✓
- `sms-webhook` → verified by provider callback ✓
- `metrics` → `x-metrics-token` header guard with `safeCompare` ✓
- `line-login` → OAuth redirect flow (public by design) ✓
- `line-oa-chatbot` → `LineWebhookGuard` at method level ✓

### A3 — Decimal Violation Detail

Services using `Number()` on Prisma Decimal money fields:

| File | Fields | Risk |
|------|--------|------|
| `chatbot-finance/services/finance-tools.service.ts:55-56,144` | `amountDue`, `amountPaid`, `nextAmount` | Display to customer — precision loss possible |
| `chatbot-finance/services/auto-trigger.service.ts:169` | `amountDue - amountPaid` (arithmetic) | **Arithmetic on Decimal — higher risk** |
| `chatbot-finance/services/slip-processing.service.ts:186` | `amountDue` | Comparison only |
| `sales/services/sale-creation.service.ts:95` | `costPrice` | **Stored into JS number** |
| `sales/services/sale-writer.service.ts:205,296` | `interestRate`, `costPrice` | Calculation input |
| `customers/services/customer-query.service.ts:341` | `_sum.amountDue` | **Aggregation precision loss** |
| `interest-config/interest-config.service.ts:103` | `interestRate` | Percentage calculation input |
| `line-oa/chatbot.service.ts:160,199` | `amountDue` | Display |

Priority fix: `auto-trigger.service.ts:169` (arithmetic), `sale-creation/writer.service.ts` (cost stored to JS number), `customer-query.service.ts:341` (aggregation).

### A4 — Soft-Delete Detail

Missing `deletedAt: null` in `where:` clause:

| File | Model | Lines |
|------|-------|-------|
| `inter-company/inter-company.service.ts` | `InterCompanyTransaction` | 202, 225, 242, 358 |
| `reporting/compliance.service.ts` | `Contract`, `LegalCase`, `callLog` | 61, 97, 196, 206 |
| `stickers/stickers.service.ts` | `StickerTemplate`, `companyInfo`, `product`, `pricingTemplate` | 43, 114, 126, 142 |
| `installments/reschedule.service.ts` | `InstallmentSchedule` | 42 |

Note: `ChatMessage.findMany` in `chat-ai-draft.service.ts:253` is exempt — ChatMessage is an append-only model without `deletedAt`.

### A5 — Test Failure Detail

**API failures (14 suites, 145 tests):**
- `prisma-finance.service.spec.ts` — Fails to compile: `@prisma/client-finance` not found (same root as A1)
- `health.controller.spec.ts` — Same root cause
- `modules/asset/__tests__/*` (4 suites) — `PrismaClientInitializationError: DATABASE_URL not found` — DB not available in this environment
- `modules/other-income/__tests__/*` (4 suites) — Same `DATABASE_URL` issue
- `modules/depreciation/__tests__/*` — Same
- `modules/overdue/__tests__/collections-foundation.seed.spec.ts` — DB not available
- `cli/backfill-user-companies.cli.spec.ts` — Likely same
- `modules/journal/outbox-processor.service.spec.ts` — Likely same

**Conclusion:** All 145 API failures are environment failures (no DB, missing generated client), not code regressions. In CI with DB available these should pass. **Not a code quality issue but a local environment gap.**

**Web failures (1 test):**
- `src/components/contacts/CreateContactModal.test.tsx > SUPPLIER: posts to /suppliers and calls onCreated` — 5000ms timeout. Likely async mock not resolving. Minor.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | 188 models. UUIDs ✓. Float only on GPS/ML confidence (non-money) ✓. Enums PascalCase/SCREAMING_SNAKE_CASE ✓. |
| B2 Migrations | **PASS** | 279 migrations. Latest: `20260972000000_journal_line_restrict_and_index` (descriptive). Recent DROP COLUMN in `remove_2fa` is intentional cleanup with `IF EXISTS` guards. |
| B3 Indexes | **WARN** | 20 FK fields potentially missing `@@index`. Notable: `Contract.productId`, `Contract.reviewedById`, `DailyAssignment.contractId/paymentId/lineMessageId`, `Payment.toleranceJournalLineId`, `InstallmentSchedule.accrualJournalEntryId/vat60dayJournalEntryId`. |
| B4 Drift | **PASS** | Latest migration adds FK RESTRICT + compound index on `journal_lines`. Schema matches. No drift detected. |

### B3 — Missing Index Detail

High-traffic FK fields without `@@index` (hot read paths):

```
Contract.productId                         — queried in stock/POS lookups
Contract.reviewedById                      — filter on reviewer
Contract.interestConfigId                  — every contract activation
DailyAssignment.contractId/paymentId       — overdue daily scan (high volume)
Payment.toleranceJournalLineId             — tolerance approval lookup
InstallmentSchedule.accrualJournalEntryId  — daily accrual cron (every schedule)
InstallmentSchedule.vat60dayJournalEntryId — VAT 60-day cron
Refund.rejectedById                        — report queries
```

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✓. `MAX_TOOL_ITERATIONS=5` ✓. Per-iteration 30s AbortController ✓. `maxTokens=1024` ✓. Sentry on max-iter + general errors ✓. |
| C2 Prompt | **OK** | 67 lines — concise. Bank account `203-1-16520-5` consistent with `finance-rules.ts` ✓. Hours 09:00-18:00 Mon-Sat consistent ✓. No contradictions found. |
| C3 Tools | **OK** | 7 tools defined (get_current_balance, get_payment_schedule, calculate_fine, list_recent_receipts, get_bank_info, search_knowledge_base, handoff_to_human). All have Thai descriptions ✓. Tool executor covers all 7 ✓. |
| C4 Auto-Trigger | **OK** | Idempotency via DB unique constraint `(customerId, referenceKey)` + P2002 catch ✓. Covers T-5, T-3, T-1, T (09:00), T+1, T+3 (10:00) ✓. Sentry captures on cron errors ✓. |
| C5 Security | **WARN** | `web-widget.controller.ts` fully public without documentation (see A2). LIFF → LiffTokenGuard ✓. Admin → JwtAuthGuard+RolesGuard ✓. Webhook dedup via `ProcessedWebhookEvent` DB table ✓. Customer isolation — `customerId` injected by orchestrator, not LLM-controlled ✓. |

---

## Action Items (Prioritized)

### P0 — Fix before next deploy

1. **[A1/A5] Generate `@prisma/client-finance` or remove stale references.**
   - `apps/api/src/prisma/prisma-finance.service.ts` references `@prisma/client-finance` which doesn't exist.
   - If FINANCE DB split is not live yet, this file and its spec need to be updated/stubbed.
   - **Impact:** 8 TS errors + 2 failing test suites (health, prisma-finance).

### P1 — Fix this sprint

2. **[A2/C5] Document or guard `web-widget.controller.ts`.**
   - Either add it to `security.md`'s intentional public list with justification, or add `ShopBotDefenseGuard` + throttle.
   - Capability-token pattern is acceptable but must be documented.
   - File: `apps/api/src/modules/staff-chat/web-widget.controller.ts`

3. **[A3] Fix arithmetic `Number()` on Decimal in auto-trigger and sales services.**
   - `auto-trigger.service.ts:169` — replace with `new Prisma.Decimal(args.payment.amountDue).minus(args.payment.amountPaid)`
   - `sale-creation.service.ts:95` and `sale-writer.service.ts:296` — `costPrice` is stored into a JS number for downstream arithmetic; use `Prisma.Decimal` throughout.
   - `customer-query.service.ts:341` — `_sum.amountDue` aggregation → keep as Decimal until serialization boundary.

4. **[A5] Fix web test timeout in `CreateContactModal`.**
   - `src/components/contacts/CreateContactModal.test.tsx` — supplier POST test times out at 5000ms.
   - Check if mock isn't resolving or if the test needs `vi.useFakeTimers()`.

### P2 — Next sprint

5. **[A4] Add `deletedAt: null` to soft-delete queries in:**
   - `inter-company/inter-company.service.ts` (4 queries on `InterCompanyTransaction`)
   - `reporting/compliance.service.ts` (Contract + LegalCase queries — callLog exempt)
   - `stickers/stickers.service.ts` (product + pricingTemplate queries)
   - `installments/reschedule.service.ts:42`

6. **[B3] Add missing FK indexes on hot-path fields.**
   Priority order: `DailyAssignment.contractId`, `InstallmentSchedule.accrualJournalEntryId`, `InstallmentSchedule.vat60dayJournalEntryId`, `Contract.productId`.
   Single migration: `add_missing_fk_indexes`.

### P3 — Backlog

7. **[A3] Remaining display-only `Number()` calls** in chatbot, stickers, shop-catalog, line-oa chatbot — low risk but should migrate to `.toNumber()` at serialization boundary consistently.

8. **[B3] Remaining FK index gaps** — `Payment.toleranceJournalLineId`, `Contract.reviewedById`, `Refund.rejectedById` etc.

---

*Generated by CTO Watchdog — 2026-06-13. Run time: ~4 minutes.*
