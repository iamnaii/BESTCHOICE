# CTO Watchdog Report — 2026-06-29

## Summary
**10/15 checks passed** (3 WARN, 2 FAIL). One fix applied during run: generated `@prisma/client-finance` (resolves 7 TS errors + 4 test suites). Remaining FAIL: A3 Decimal violations (35+) and A5 API integration tests (148 failures — environment: no DATABASE_URL, not code regressions).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FIXED** | API had 7 errors (all `@prisma/client-finance` missing). Generated Finance client during run. 0 errors now. Web: 0 errors. |
| A2 Security | **WARN** | 4 controllers without `@UseGuards` not in documented public list: `web-widget` (anonymous chat widget — intentional), `line-login` (LINE OAuth — intentional), `yeastar-webhook` (HMAC-verified), `facebook-webhook` (signature-verified). Should be added to security rules. No raw unsanitized SQL, no localStorage token storage in prod (E2E-only conditional), no hardcoded secrets. |
| A3 Decimal | **FAIL** | **35+ `Number()` conversions on money fields.** Key offenders: `chatbot-finance/finance-tools.service.ts` (8 violations: `amountDue`, `amountPaid`, `lateFee`), `line-oa/chatbot.service.ts` (6 violations), `sales/sale-creation.service.ts`, `sales/sale-writer.service.ts`, `shop-catalog/shop-catalog.service.ts`, `auto-trigger.service.ts`. These lose Decimal precision on large amounts. |
| A4 Soft-Delete | **WARN** | Multiple `findMany`/`findFirst` without `deletedAt: null` in non-exempt models: `inter-company.service.ts` (6 queries on InterCompanyTransaction), `reporting/compliance.service.ts` (4 queries on Contract/LegalCase/CallLog), `installments/reschedule.service.ts` (InstallmentSchedule). ChatMessage/CallLog/SystemConfig queries are exempt. |
| A5 Tests | **WARN** | API: 5000/5158 pass. 148 failures in 13 suites — all `PrismaClientInitializationError: DATABASE_URL not found`. These are **integration tests requiring a live DB** (not regressions). Unit tests: all pass. Web (vitest): **778/778 pass** ✓. Test suite has grown from 577→5158 API and 129→778 web since last baseline. |
| A6 Bundle | **WARN** | No chunks exceed 500KB gzipped. Largest: `excel.js` 256KB gz, `LettersPage` 219KB gz, `ContractTemplatesPage` 145KB gz. Vite flags 4 chunks >500KB raw (excel.js 930KB, thai-address-data 871KB, index.js 741KB, LettersPage 569KB). `PeriodClosePage` has an ineffective dynamic import (statically imported by `PeriodsTab` — won't code-split). |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 189 models checked. **Missing uuid `id`**: 7 models (`ExpenseDetail`, `CreditNoteDetail`, `PayrollDetail`, `VendorSettlementDetail`, `UserExpenseTemplate`, `IpRateLimit`, `AiSettings` — likely use composite PKs or singleton). **Float money fields**: `ChatMessage.cost`, `AiTrainingPair.cost` (AI token cost fields — functionally acceptable but inconsistent). **Missing `createdAt`**: 23 models (some are legitimate — `ProcessedWebhookEvent`, `ChatAutoTrigger`; others like `FixedAsset`, `Promotion`, `Todo` may need audit). |
| B2 Migrations | **PASS** | 284 migrations total. Latest 5 all have descriptive names. No `DROP TABLE`, `DROP COLUMN`, or `ALTER TYPE` in last 3 migrations. Clean. |
| B3 Indexes | **WARN** | 15+ models with unindexed FK fields. High-priority gaps: `Contract` (missing index on `productId`, `reviewedById`, `interestConfigId`), `InstallmentSchedule` (`accrualJournalEntryId`, `vat60dayJournalEntryId`), `Payment` (`toleranceJournalLineId`), `PurchaseOrder` (`createdById`, `approvedById`). These are FK fields queried in joins and filters. |
| B4 Drift | **PASS** | Latest migration (`20260968_add_expense_vendor_supplier_fk`) adds `vendor_supplier_id` to `expense_documents` and `expense_lines` with correct indexes and FK constraints — matches schema. No drift. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-haiku-4-5-20251001` (primary) + `claude-sonnet-4-6` (escalation after tool calls). `MAX_TOOL_ITERATIONS = 5` guard present. `maxTokens = 1024`. Sentry captures on both max-iterations and exceptions. 30s per-iteration timeout with AbortController. |
| C2 Prompt | **WARN** | **Late fee hardcoded at 50 บาท/วัน** in system-prompt.ts, but actual system uses configurable `SystemConfig.late_fee_per_day_rate` (production seeds `BRACKET` mode, `PER_DAY` mode is pending CPA sign-off per accounting rules). If the bot quotes 50/day while the DB rate differs, customers get wrong info. Prompt otherwise correct: business hours Mon-Sat 09:00-18:00, phone 063-134-6356, KBank account 203-1-16520-5. Reasonable length (67 lines). |
| C3 Tools | **OK** | 7 tools defined and all handled by executor: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All have Thai descriptions and proper input schemas. |
| C4 Auto-Trigger | **OK** | `ChatAutoTrigger` idempotency marker present. All 6 reminder types covered (T-5, T-3, T-1, T at 09:00; T+1, T+3 at 10:00). Sentry capture on cron failure with `kind: 'cron-job'` tag. |
| C5 Security | **WARN** | LIFF controller uses `LiffTokenGuard` ✓. Admin controller uses `JwtAuthGuard + RolesGuard` ✓. **Webhook dedup (`ProcessedWebhookEvent`) not found** in chatbot LIFF controller — replay attack protection unverified. Customer data isolation in tool executor relies on `customerId` from LIFF token (correct, but not explicitly tested). |

---

## Action Items (Prioritized)

### P0 — Immediate (block next release)
1. **A3: Fix Decimal violations in `chatbot-finance/finance-tools.service.ts`** — Chatbot shows customers incorrect balances. Replace `Number(nextPayment.amountDue)` etc. with `new Prisma.Decimal(...)` arithmetic. (~8 violations in one file)
2. **A1: Add `prisma generate --schema=prisma-finance/schema.prisma` to session startup hook** — The Finance Prisma client (`@prisma/client-finance`) was not generated on container start, causing 7 TS errors and 4 test suites to fail to run. Generated manually during this watchdog run.

### P1 — High (fix this sprint)
3. **A3: Decimal violations in `line-oa/chatbot.service.ts`** — 6 `Number()` on `amountDue`/`amountPaid` in LINE OA chatbot. Same risk as C3.
4. **C2: Remove hardcoded late fee from system prompt** — Replace `ค่าปรับล่าช้า: 50 บาท/วัน` with a dynamic placeholder fetched from SystemConfig, or at minimum align the value with the active production rate.
5. **A4: Add `deletedAt: null` to `inter-company.service.ts` queries** — 6 queries on InterCompanyTransaction without soft-delete filter risk returning stale records.
6. **C5: Verify chatbot webhook dedup** — Confirm `ProcessedWebhookEvent` or equivalent dedup exists in the LIFF message ingestion path.

### P2 — Medium (next sprint)
7. **B3: Add missing indexes** — Priority: `Contract(productId)`, `InstallmentSchedule(accrualJournalEntryId, vat60dayJournalEntryId)`, `Payment(toleranceJournalLineId)`. Single migration.
8. **A2: Document undocumented public controllers** — Add `web-widget`, `line-login`, `yeastar-webhook`, `facebook-webhook` to `security.md` public endpoint allowlist with reason.
9. **A3: Remaining Decimal violations** — `sales/sale-writer.service.ts`, `sales/sale-creation.service.ts`, `shop-catalog/shop-catalog.service.ts`, `notifications/notification-reminder.service.ts` (display use — lower risk but still inconsistent).
10. **A6: Fix `PeriodClosePage` dynamic import** — Remove static import from `PeriodsTab.tsx` to allow code-splitting.

### P3 — Low (backlog)
11. **B1: Audit `FixedAsset`, `Promotion`, `Todo` for missing `createdAt`** — If these models are being written but lack timestamps, audit trail is incomplete.
12. **A4: Soft-delete audit on `reporting/compliance.service.ts`** — Add `deletedAt: null` to Contract/LegalCase queries for correctness.
13. **A5: Set up test DATABASE_URL in CI** — Enable the 148 integration tests to run in environments without a live DB (test containers or mock DB in pre-test hook).

---

## Environment Notes
- **Finance Prisma client generated** during this watchdog run (`@prisma/client-finance`). Session startup hook should run `prisma generate --schema=prisma-finance/schema.prisma` to prevent recurrence.
- No `DATABASE_URL` available in this environment — 148 integration tests cannot run. These are expected failures in a no-DB container. CI with real DB should show green.
- Web bundle build: clean (12.22s), all chunks under 500KB gzipped.
