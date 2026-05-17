# CTO Watchdog Report — 2026-05-17

## Summary
12/15 checks passed — codebase is broadly healthy. TypeScript is clean (0 errors). Critical findings: 159 API tests failing (all integration tests requiring a live DATABASE_URL connection, not logic regressions); 8 web tests failing due to missing QueryClientProvider wrapper in asset hook tests. Three Decimal precision warnings in non-financial display contexts. One chatbot DI wiring bug (ConfigService not provided in test module).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | PASS | API: 0 errors, Web: 0 errors |
| A2 Security | PASS | No missing guards, no token leaks, no hardcoded secrets, $queryRaw uses all use parameterized tagged templates |
| A3 Decimal | WARN | 30 hits — most are `.toNumber()` for display/serialization (inter-company totals, stickers, shop-catalog) or `Number()` for formatting; 1 arithmetic hit in auto-trigger (line 169) |
| A4 Soft-Delete | WARN | ~1100 findMany/findFirst without deletedAt; ~167 are on exempt models (ChatMessage, CallLog, AuditLog, SystemConfig etc.); remaining ~20 genuine gaps in shop-catalog, stickers, compliance.service, canned-response-variable |
| A5 Tests | WARN | API: 2580/2741 passing (159 failures — all DB integration, no DATABASE_URL in env); Web: 314/322 passing (8 failures — missing QueryClientProvider in asset hook tests) |
| A6 Bundle | PASS | Largest chunks: excel 256 KB gzip, ContractTemplatesPage 148 KB, pdf 139 KB, charts 120 KB — all within 500 KB threshold |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | PASS | All models use `@id @default(uuid())` or documented FK-as-PK exceptions (ExpenseDetail, CreditNoteDetail, PayrollDetail, VendorSettlementDetail). Money fields all `@db.Decimal(12, 2)`. Float used only for GPS coords and ML confidence scores. Enums PascalCase/SCREAMING_SNAKE_CASE. |
| B2 Migrations | PASS | Count: 233, Latest: `20260930000000_credit_note_2mode`. Dangerous ops found in 5 migrations (DROP COLUMN, ALTER TYPE) — all appear intentional (commission clawback, dispatch fields, tax compliance, condition grade removal, promise event trigger). |
| B3 Indexes | WARN | `Repossession.appraisedById` FK has no index (only `@@index([status, createdAt])`). `ContractTemplate` has no FK fields so no index needed. `EDocument` and `Signature` both have `@@index([contractId])`. Major models (Contract, Payment, Customer) are well-indexed. |
| B4 Drift | PASS | Latest migration `20260930000000_credit_note_2mode` adds `CreditNoteMode` enum + `mode` column with `DEFAULT 'LINKED'` + makes `original_document_id` nullable — all three match schema.prisma (lines 3743–3745). |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | OK | Model: `claude-sonnet-4-6` (current). MAX_TOOL_ITERATIONS: Yes (const = 5, line 23). Per-iteration 30 s timeout via AbortController. Sentry capture on error and on max-iterations. maxTokens: 1024 (adequate). |
| C2 Prompt | OK | System prompt references correct bank account (203-1-16520-5 KBank, matches finance-rules.ts), phone 063-134-6356, hours Mon-Sat 09:00-18:00. No contradictions found. Est. tokens: ~250 (193 words × 1.3). |
| C3 Tools | OK | 7 tools defined (get_current_balance, get_payment_schedule, calculate_fine, list_recent_receipts, get_bank_info, search_knowledge_base, handoff_to_human). All have Thai descriptions and input schemas. tool-executor.ts handles all 7 names in switch statement + default `unknown tool` case. Input validated via `validateToolInput` before execution. |
| C4 Auto-Trigger | OK | Idempotency: Yes — atomic `chatAutoTrigger.create` with `@@unique([customerId, referenceKey])`, P2002 = skip. Types covered: T-5, T-3, T-1, T (09:00 cron), T+1, T+3 (10:00 cron). Sentry capture on both cron error paths. |
| C5 Security | OK | LIFF controller uses `LiffTokenGuard` (LINE ID token verified server-side) — no JWT, intentionally public. Admin controller uses `@UseGuards(JwtAuthGuard, RolesGuard)`. Webhook controller uses `LineFinanceWebhookGuard` + dedup via `WebhookDedupService` (DB unique constraint on eventId). Tool executor injects customerId from orchestrator context — Claude cannot override to access another customer's data. |

---

## Action Items

### CRITICAL
- **159 API integration tests fail without DATABASE_URL** — `apps/api/src/modules/asset/__tests__/`, `other-income/__tests__/`, `journal/journal.service.spec.ts`, `depreciation/__tests__/`, `overdue/__tests__/collections-foundation.seed.spec.ts` — These tests need a running PostgreSQL. CI/CD pipeline must set `DATABASE_URL` in the test stage or switch to jest-mock-extended / prisma-mock for unit tests. Risk: regressions in asset, journal, depreciation, and other-income modules go undetected in PR checks.

### WARNING
- **Chatbot DI wiring bug in test** — `chatbot-finance.service.spec.ts` fails with `Nest can't resolve dependencies... ConfigService at index [8]` — `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` — Add `ConfigModule.forRoot()` or `{ provide: ConfigService, useValue: mockConfigService }` to the test module providers.

- **Web asset hook tests missing QueryClientProvider** — `apps/web/src/pages/assets/hooks/useAssetCalculation.test.ts` — 7 tests fail because `useCoaByCodes` calls `useQuery` without a QueryClient in scope. Wrap test renders with `<QueryClientProvider client={queryClient}>` or mock `useCoa` in the test.

- **Decimal precision in auto-trigger amount calc** — `apps/api/src/modules/chatbot-finance/services/auto-trigger.service.ts:169` — `Number(args.payment.amountDue) - Number(args.payment.amountPaid)` loses Decimal precision for reminder messages. Use `new Prisma.Decimal(args.payment.amountDue).minus(args.payment.amountPaid).toNumber()` for display, or keep as Decimal until formatting.

- **Soft-delete gaps in shop-catalog and compliance** — `apps/api/src/modules/shop-catalog/shop-catalog.service.ts:89,112,118` and `apps/api/src/modules/reporting/compliance.service.ts:61,97` — `product.findFirst` and `contract.findMany` calls missing `deletedAt: null`. Deleted products or contracts could appear in catalog price lookups and compliance reports.

- **Soft-delete gap in stickers service** — `apps/api/src/modules/stickers/stickers.service.ts:126` — `product.findFirst` missing `deletedAt: null`. A deleted product could be used to generate a sticker.

- **Repossession.appraisedById FK missing index** — `apps/api/prisma/schema.prisma` — `appraisedById String @map("appraised_by_id")` has no `@@index` entry. Add `@@index([appraisedById])` to prevent full-table scans when filtering repossessions by appraiser.

- **Number() used for Decimal display in inter-company service** — `apps/api/src/modules/inter-company/inter-company.service.ts:337-349` — `.toNumber()` calls on accumulated Decimal sums are acceptable for serialization output but should be documented as intentional display conversion, not arithmetic.

### INFO
- API test suite has grown significantly beyond baseline: 2741 total tests (baseline was 577 from v4). The 225 passing suites cover all the critical unit test paths.
- Web test suite has also grown: 322 total (baseline was 129). 314 pass.
- Bundle is well-split: excel.js (256 KB gzip), pdf (139 KB), charts (120 KB) are separate async chunks — initial load is ~70 KB (vendor) + ~81 KB (index). No single chunk exceeds 260 KB gzip.
- System prompt is stored in DB with 5-minute in-memory cache — admin can update via `/chatbot/finance/admin` without redeployment.
- All 233 migrations are named descriptively. The 5 with DROP/ALTER ops are all intentional schema cleanups from 2026-03 to 2026-06 timeframe.
- LIFF endpoints correctly use LINE ID token verification (LiffTokenGuard) instead of JWT — this is the intended public boundary per security.md.
- ChatbotFinanceService note: it was recently extended with `ConfigService` dependency (index 8) but the test module was not updated. This is a maintenance gap, not a production issue.
