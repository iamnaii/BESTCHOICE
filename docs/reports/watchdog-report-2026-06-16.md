# CTO Watchdog Report — 2026-06-16

## Summary
11/15 checks passed. **Critical: `@prisma/client-finance` not generated** (SP7.1 second-DB feature) → 4 test suites fail and TypeScript errors masked by `skipLibCheck: true`. Secondary: 145 API integration tests fail without `DATABASE_URL`; Decimal compliance gaps in chatbot services; missing FK indexes on Contract/Payment/Repossession.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | `tsc --noEmit` exits 0 on both `apps/api` and `apps/web`. **Hidden risk**: `skipLibCheck: true` + `noImplicitAny: false` in API tsconfig masks `Cannot find module '@prisma/client-finance'` — ts-jest reveals 3 TS errors at test time (see A5). |
| A2 Security | **WARN** | 2 undocumented public controllers: `staff-chat/web-widget.controller.ts` (intentionally public for anonymous widget — needs adding to security.md whitelist) and `line-oa/line-login.controller.ts` (LINE OAuth flow — needs whitelist). `metrics.controller.ts` is guarded via `METRICS_SCRAPE_TOKEN` shared secret + `@Public()`. All `$queryRaw`/`$executeRaw` calls use Prisma tagged template literals (auto-parameterized). `$executeRawUnsafe` used only for `pg_advisory_xact_lock(${lockKey})` where lockKey is an integer derived from internal strings — safe. No tokens in localStorage (E2E test support removed on read). No hardcoded secrets. |
| A3 Decimal | **WARN** | 40+ `Number()` conversions on money fields across 9 services. High-risk locations: `chatbot-finance/services/finance-tools.service.ts` (amountDue, amountPaid, totalAmount — used in display/chatbot text, not accounting JEs); `sales/services/sale-writer.service.ts` (costPrice, commissionRate — used in sale record creation); `customers/services/customer-query.service.ts` (totalOutstandingThb `_sum` aggregation); `line-oa/chatbot.service.ts` (6 conversions); `notifications/services/notification-reminder.service.ts` (display formatting only). Accounting-critical services (journal, payments, contracts) appear clean. |
| A4 Soft-Delete | **WARN** | Static analysis found queries missing `deletedAt: null` in: `chat-ai-draft.service.ts`, `inter-company.service.ts`, `stickers.service.ts`, `shop-catalog.service.ts`, `staff-chat` services (session-ops, lead-scoring, chat-commerce, ai-suggest). Many are likely false positives from short `findUnique` calls inside larger where-blocks. Manual review recommended for `inter-company.service.ts` and `stickers.service.ts`. |
| A5 Tests | **FAIL** | **API Jest**: 4,867/5,020 tests pass; 145 fail across 14 suites. Root cause 1 (4 suites): `@prisma/client-finance` package not generated — affects `prisma-finance.service.spec.ts`, `health.controller.spec.ts`, `outbox-processor.service.spec.ts`, `backfill-user-companies.cli.spec.ts`. Fix: `npm run prisma:finance:generate`. Root cause 2 (10 suites, ~141 tests): Integration tests (asset, other-income, depreciation, collections) require live `DATABASE_URL` — expected to fail in this containerized environment without a connected database. **Web Vitest**: 660/662 pass; `CreateContactModal.test.tsx` shows 2 flaky failures in parallel run but passes when run alone — timing/async race in test environment. |
| A6 Bundle | **WARN** | Vite reports chunks >500KB (raw). Gzip sizes (threshold) are all under 500KB gzipped but several are large: `excel-*.js` 929KB raw / 256KB gzip ⚠️; `ContractTemplatesPage` 489KB / 145KB gzip ⚠️; `LettersPage` 569KB / 219KB gzip ⚠️; `charts` 417KB / 119KB gzip; `pdf` 430KB / 139KB gzip. `thai-address-data` 870KB raw but only 69KB gzip (data file, acceptable). `CollectionsPage` 386KB / 101KB. LettersPage and excel are the highest priority candidates for further code-splitting. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | Money fields: all use `@db.Decimal(12, 2)` — no Float money fields (Float only on GPS lat/long, AI confidence scores, threshold configs — correct). UUID IDs: all main models have `@default(uuid())`. Timestamp gaps on non-main models (some legitimate by documented exceptions): `CompanyInfo` missing `deletedAt` (static config — may be intentional); `FixedAsset` missing `deletedAt` (status-tracked asset — needs verification); `ExpenseDetail`/`CreditNoteDetail`/`PayrollDetail`/`VendorSettlementDetail` missing UUID id + timestamps (embedded line-item rows — possible design intent). `PromiseSlot` missing `deletedAt` (append-only slots may be intentional). Enums use correct PascalCase names / SCREAMING_SNAKE_CASE values throughout. |
| B2 Migrations | **PASS** | 279 migrations. Latest (`20260972000000_journal_line_restrict_and_index`) is descriptive and safe: changes FK from Cascade→Restrict (protects legal evidence) and adds compound index. `DROP COLUMN` used in historical migrations with `IF EXISTS` guard — appropriate. No destructive `ALTER TYPE` found. |
| B3 Indexes | **WARN** | FK fields missing indexes detected on high-traffic models: `Contract` (productId, reviewedById, interestConfigId, exchangedFromContractId); `Payment` (toleranceJournalLineId); `Repossession` (contractId, productId); `CallLog` (yeastarCallId); `Sale` (contractId, onlineOrderId); `OnlineOrder` (productId, paymentLinkId). These could cause sequential scans on frequently-filtered queries. Priority: Contract.productId, Repossession.contractId/productId. |
| B4 Drift | **PASS** | Latest migration SQL aligns with schema.prisma — `journal_lines` FK constraint and index match the schema model definition. No evidence of schema/migration mismatch. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **PASS** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` guard present. Per-iteration 30s timeout via `{ timeout: 30_000 }` on API call. Sentry captures: `captureMessage` on max-iterations exceeded; `captureException` on outer catch. History window: 10 messages / 20k char budget. Prompt caching via `cache_control: ephemeral` on system prompt. |
| C2 Prompt | **PASS** | Bank account `203-1-16520-5` (KBank) correct. Phone `063-134-6356` present. Hours `Mon-Sat 09:00-18:00` correct. Correct prohibited-word replacements ("หนี้"→"ยอดรอชำระ" etc.). No contradictions detected with `finance-rules.ts`. Prompt is reasonable length (~4KB). |
| C3 Tools | **PASS** | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All 7 have matching `case` handlers in `tool-executor.ts`. Input schemas properly typed with Thai descriptions. `customerId` injected by orchestrator (not in tool schema) — prevents cross-customer data access. |
| C4 Auto-Trigger | **PASS** | Idempotency via `ChatAutoTrigger` table (check before send, mark SENT after). All 6 reminder types covered: T-5, T-3, T-1, T (09:00 cron), T+1, T+3 (10:00 cron). `Sentry.captureException` on both cron error paths. |
| C5 Security | **PASS** | `chatbot-finance-liff.controller.ts` protected by `LiffTokenGuard` (verifies LINE ID token server-side). `chatbot-finance-admin.controller.ts` has `@UseGuards(JwtAuthGuard, RolesGuard)`. Webhook dedup via `ProcessedWebhookEvent` unique constraint (DB-level, multi-instance safe). Customer isolation enforced by orchestrator injecting `customerId` from verified context into every tool call. |

---

## Action Items (Prioritized)

### P0 — Fix Now
1. **Generate `@prisma/client-finance`**: Run `npm run prisma:finance:generate` in `apps/api`. Without this, 4 test suites fail with TS errors and the health check endpoint has a type error. The second-schema Prisma client for SP7.1 finance DB must be generated as part of setup. Add to SessionStart hook / CI pipeline.

### P1 — High Priority
2. **Document public controllers in security.md**: Add `staff-chat/web-widget.controller.ts` (anonymous widget — has `@Throttle` + `@SkipCsrf` guards) and `line-oa/line-login.controller.ts` (LINE OAuth redirect flow — public by design) to the "Intentionally Public Endpoints" list. Without this, a future security audit will flag them as bugs.

3. **Decimal precision in `sale-writer.service.ts`**: `Number(product.costPrice)` and `Number(rule.rate)` convert Decimal to float before use in sale record creation. Replace with `new Prisma.Decimal(product.costPrice)` and use Decimal arithmetic throughout. Files: `apps/api/src/modules/sales/services/sale-writer.service.ts:95,156,205,296,347`.

4. **Add FK indexes on Contract and Repossession**: At minimum add `@@index([productId])` on `Contract` and `@@index([contractId])`, `@@index([productId])` on `Repossession`. These are high-traffic models queried in list/filter operations.

### P2 — Medium Priority
5. **Fix flaky `CreateContactModal` test**: The 2 failures in parallel run (pass when run alone) indicate a shared state or timer leak between test files. Investigate `apiPostMock` setup in `src/components/contacts/CreateContactModal.test.tsx` — may need `vi.resetAllMocks()` in `beforeEach`.

6. **Decimal compliance in `chatbot-finance/services/finance-tools.service.ts`**: `Number(nextPayment.amountDue)` etc. used in chatbot text formatting. While display-only conversions are low risk, use `Prisma.Decimal.toNumber()` with explicit acknowledgment, or format with `new Intl.NumberFormat()` directly from Decimal string representation.

7. **LettersPage bundle size**: `LettersPage-*.js` at 569KB raw / 219KB gzip is the largest page bundle. Consider lazy-loading sub-components or splitting the heavy imports (likely PDF rendering + jsPDF dependency).

8. **Verify `FixedAsset` and `CompanyInfo` soft-delete**: Confirm `FixedAsset` and `CompanyInfo` omit `deletedAt` intentionally. If FixedAsset can be deleted (not just disposed/written-off), add `deletedAt DateTime?` and corresponding Prisma migration.

### P3 — Monitor
9. **Integration tests in CI**: The 141 test failures due to missing `DATABASE_URL` are expected in this environment but should be tracked. CI should provide a test PostgreSQL instance for integration tests. Consider separating unit vs integration test suites in jest config via `--testPathIgnorePatterns`.

10. **`inter-company.service.ts` soft-delete**: Lines 182, 282, 387 show `findMany` calls that may lack `deletedAt: null`. Manual review needed to confirm inter-company transaction queries properly exclude soft-deleted records.
