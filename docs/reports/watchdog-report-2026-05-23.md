# CTO Watchdog Report — 2026-05-23

## Summary
9/15 checks passed outright; 4 warnings; 2 failures (TypeScript compile errors + test regressions — both share a single root cause: `@prisma/client-finance` package not generated).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors — all in `prisma-finance.service.ts` + downstream files. Root cause: `@prisma/client-finance` package not installed/generated (SP7.1 secondary-DB feature). Web: 0 errors. |
| A2 Security | **PASS** | No unauthorized unguarded controllers. All raw SQL uses Prisma parameterized templates. localStorage token is read-once at boot then purged (E2E support pattern, not a vulnerability). No hardcoded secrets found. |
| A3 Decimal | **WARN** | 15+ `Number()` wrappings of Decimal money fields in production services. **High-risk** (used in calculations): `sales.service.ts:291,597` (costPrice in discount logic), `contract-snapshot.service.ts:141,144` (balance calc), `notifications/scheduler.service.ts:415` (notification amount), `crm/customer-scoring.service.ts:121` (scoring sum). Lower-risk (display/export): `line-oa/chatbot.service.ts`, `tax.service.ts` (Excel), `staff-chat`. |
| A4 Soft-Delete | **WARN** | All spot-checked `findMany` list queries correctly filter `deletedAt: null`. Two edge cases: (1) `sales.service.ts:144` — `findMany` on `User` by role without `deletedAt: null`; (2) `products.service.ts:195` — `findUnique` without post-fetch `deletedAt` guard. |
| A5 Tests | **FAIL** | **API**: 144 failures / 3,760 total (baseline 577 — suite has grown 6×). Split: 4 suites fail to compile due to `@prisma/client-finance` not found (code issue); ~10 suites fail with `PrismaClientInitializationError` / `DATABASE_URL` not set (environment issue, not a code regression). **Web**: 8 failures / 522 total (baseline 129 — grown 4×). `useAssetCalculation.test.ts` (7): missing `QueryClientProvider` in test wrapper after hook was refactored to call `useCoaByCodes`. `AssetsListPage.statcards.test.tsx` (1): stat card count mismatch after recent changes. |
| A6 Bundle | **PASS** | No chunk exceeds 500 KB gzipped. Largest: `excel-BcGceKAJ.js` at 256 KB gzip (lazy-loaded). v3 bundle-split is effective. Build time: 3.37s. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 1 violation: `BroadcastMessage` model is missing `updatedAt DateTime @updatedAt` and `deletedAt DateTime?`. It has a multi-step lifecycle (PENDING_APPROVAL → APPROVED → SENT/FAILED/CANCELLED) so it is not an immutable record and holds no documented exemption comment. All other models have correct timestamps or carry valid exemption annotations. Money fields: all use `@db.Decimal(12,2)` — no Float misuse. Enums: PascalCase types, SCREAMING_SNAKE_CASE values. IDs: all UUID. |
| B2 Migrations | **PASS** | 264 migrations. All have descriptive names. Latest 3 are additive-only. One `DROP INDEX IF EXISTS` with proper guard. No `DROP TABLE`, `DROP COLUMN`, or destructive `ALTER TYPE`. |
| B3 Indexes | **WARN** | ~20 missing FK indexes across 12 models. **High priority**: `Contract.productId`, `Contract.reviewedById`, `Contract.interestConfigId`; `MdmLockRequest.{proposedById,approvedById,rejectedById}`; `PurchaseOrder.{createdById,approvedById}`. **Medium**: `InstallmentSchedule.{accrualJournalEntryId,vat60dayJournalEntryId}`, `Repossession.{appraisedById,soldContractId}`, `StockTransfer.{confirmedById,dispatchedById}`, `OnlineOrder.{productId,bankConfirmedById}`. |
| B4 Drift | **PASS** | Latest migration (`20260960_installment_calc_phase_a`) fully consistent with schema.prisma. All new tables, columns, and enums match exactly. No drift detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` guard present. `Sentry.captureException` on outer catch. `maxTokens: 1024`. Per-iteration 30s timeout. **Minor**: dead code — `buildMessages()` (lines 307-339) and `this.historyLimit` (line 43) are unused; superseded by `buildMessagesFromHistory`/`loadHistory`. |
| C2 Prompt | **OK** | System prompt: ~622 tokens — well under limit. Includes bank account (กสิกรไทย 203-1-16520-5), hours (Mon–Sat 09:00–18:00), contact (063-134-6356), late fee (50 THB/day). No contradictions with `finance-rules.ts`. **Info**: bank account hardcoded in system prompt; `FinanceConfigService` is the admin-editable source. If account changes, prompt falls stale until manually updated. Phase E tracks this (move to `ChatKnowledgeBase` table). |
| C3 Tools | **OK** | 7 tools defined, all with Thai descriptions and typed schemas. All 7 names handled in `tool-executor.ts` switch with `default:` catch-all. `tool-input-schemas.ts` provides second-layer validation (injection defense). PII keys redacted in Sentry audit logs. `customerId` intentionally absent from tool schemas — injected server-side, not overridable by AI. |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` unique constraint on `(customerId, referenceKey)` — atomic dedup before LINE push. All 6 types covered: T-5, T-3, T-1, T-DAY (09:00 BKK cron), T+1, T+3 (10:00 BKK cron). `Sentry.captureException` on both cron outer catches. **Minor**: per-customer `sendReminder` failures are DB-logged as FAILED but not forwarded to Sentry — silent for on-call alerts. |
| C5 Security | **OK** | LIFF controller: `@UseGuards(LiffTokenGuard)` — correct, intentionally no JWT. Admin controller: `@UseGuards(JwtAuthGuard, RolesGuard)` at class level. Webhook: `LineFinanceWebhookGuard` (HMAC-SHA256) per method; test endpoints have explicit JWT guards. Dedup: `ProcessedWebhookEvent` with unique `eventId` + `isRedelivery` pre-check + 7-day retention cron. Customer isolation: `customerId` injected from verified session, not from tool args — no cross-customer path found. |

---

## Action Items

### P0 — Fix immediately (blocking CI/type safety)

1. **Generate `@prisma/client-finance`** — `prisma-finance.service.ts` imports a Prisma client for a secondary DB (`bc_finance`) that has never been generated. This causes 7 TS compile errors (A1) and cascades into 4 failing test suites (A5). Either generate the client with `prisma generate --schema=prisma/schema-finance.prisma` or, if SP7.1 is not yet active, stub the service with `// TODO: SP7.1` and remove the broken import.

### P1 — Fix this sprint (financial correctness)

2. **Fix 4 high-risk `Number()` Decimal conversions (A3)**:
   - `sales.service.ts:291,597` — `costPrice` in discount validation
   - `contract-snapshot.service.ts:141,144` — balance aggregation (`_sum.amountDue`, `_sum.amountPaid`)
   - `notifications/scheduler.service.ts:415` — notification amount calculation
   - `crm/customer-scoring.service.ts:121` — `financedAmount` sum in scoring
   Replace with `new Prisma.Decimal(...)` or operate entirely in Decimal arithmetic.

3. **Fix 8 web test failures (A5)**:
   - `useAssetCalculation.test.ts`: wrap test in `QueryClientProvider` (7 tests broke when hook was refactored to call `useCoaByCodes`)
   - `AssetsListPage.statcards.test.tsx`: update expected count to match current stat card logic

### P2 — Fix next sprint (data integrity)

4. **Add timestamps to `BroadcastMessage` (B1)**: Add `updatedAt DateTime @updatedAt` and `deletedAt DateTime?` + migration. Soft-delete guard needed on all BroadcastMessage queries.

5. **Fix soft-delete edge cases (A4)**:
   - `sales.service.ts:144`: add `deletedAt: null` to `findMany` on `User` by role
   - `products.service.ts:195`: add post-fetch `deletedAt` guard or move filter into query

### P3 — Backlog (performance / observability)

6. **Add missing FK indexes (B3)** — priority migration: `Contract.productId`, `Contract.reviewedById`, `MdmLockRequest` (3 user FK fields), `PurchaseOrder` (2 user FK fields). Single migration covering high-priority set.

7. **Sentry on per-customer send failures in auto-trigger (C4)** — add `Sentry.captureException` inside `sendReminder`'s catch block so LINE API failures surface in alerting.

8. **Remove dead code in `finance-ai.service.ts` (C1)** — delete unused `buildMessages()` method (lines 307-339) and `this.historyLimit` property (line 43).

9. **Fix remaining low-risk `Number()` Decimal wraps (A3)** — `line-oa/chatbot.service.ts`, `tax.service.ts` (Excel export), `staff-chat` display paths. Lower urgency but creates precedent for precision issues.
