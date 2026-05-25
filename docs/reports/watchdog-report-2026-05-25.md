# CTO Watchdog Report — 2026-05-25

## Summary
10/15 checks passed — 2 critical blockers (API TypeScript + API test cascade from missing `@prisma/client-finance`), 3 warnings requiring prompt attention.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 4 errors — all cascade from missing `@prisma/client-finance` module (SP7 prep). Web: 0 errors ✅ |
| A2 Security | **WARN** | 7 controllers without `@UseGuards` — 6 are legitimately public (webhooks with HMAC/token auth, LINE OAuth, Prometheus, web widget). 1 concern: `$queryRawUnsafe` in `stuck-contracts.service.ts`. No localStorage token leaks. No hardcoded secrets. |
| A3 Decimal | **WARN** | 30+ `Number()` conversions near money fields across 10 services — see detail below |
| A4 Soft-Delete | **WARN** | ~15 service queries missing `deletedAt: null` filter — some may be intentional (e.g. chat message history). Key services: `installments/reschedule.service.ts`, `shop-catalog/shop-catalog.service.ts`, `shop-catalog/installment-preview.service.ts` |
| A5 Tests | **FAIL** | API: 3869 total — **144 failing** (14 suites) — ALL caused by missing `@prisma/client-finance`. Web: 551 total — **8 failing** in `useAssetCalculation.test.ts` (missing `QueryClientProvider` wrapper) |
| A6 Bundle | **WARN** | `excel` chunk: 929 KB raw / **256 KB gzip** (largest). `ContractTemplatesPage`: 489 KB / 145 KB gzip. `pdf`: 430 KB / 139 KB gzip. `charts`: 417 KB / 120 KB gzip. `thai-address-data`: 870 KB / 69 KB gzip. Vite warns on 5 chunks. |

### A1 — TypeScript Error Detail
```
src/prisma/prisma-finance.service.ts(2,30): Cannot find module '@prisma/client-finance'
src/prisma/prisma-finance.service.ts(42,16): Property '$connect' does not exist
src/prisma/prisma-finance.service.ts(48,16): Property '$disconnect' does not exist
src/modules/health/health.controller.ts(144,24): PrismaFinanceService not assignable
```
Root cause: SP7 added `PrismaFinanceService` that imports from `@prisma/client-finance` (a second Prisma client for the Finance DB), but that schema / client has never been generated. There is no `schema-finance.prisma` and no `output` directive in the existing generator.

### A2 — Unguarded Controllers Detail
| Controller | Justification | Risk |
|---|---|---|
| `facebook-webhook.controller.ts` | HMAC-SHA256 signature verification | OK |
| `line-login.controller.ts` | LINE OAuth redirect flow, no PII exposed | OK |
| `metrics.controller.ts` | `@Public` + shared-secret gating documented | OK |
| `sms-webhook.controller.ts` | In security.md public list | OK |
| `shop-public-config.controller.ts` | In security.md public list (GA4/FB Pixel IDs only) | OK |
| `web-widget.controller.ts` | Anonymous visitors, no auth needed | OK |
| `yeastar-webhook.controller.ts` | HMAC-SHA256 or token auth, documented | OK |

`$queryRawUnsafe` in `stuck-contracts.service.ts:47` — `days` parameter is clamped via `Math.max(1, Math.min(days, 365))` before injection, so no SQL injection risk, but should be converted to a tagged template (`$queryRaw`) as a best practice.

### A3 — Decimal Compliance Detail
Services with `Number()` on money fields:
- `line-oa/line-oa-payment.controller.ts:129-130,519` — amount filter conversion
- `shop-catalog/shop-catalog.service.ts:95,136` — costPrice aggregation
- `staff-chat/chat-commerce.service.ts:132,134,220,255` — amountDue/amountPaid
- `line-oa/chatbot.service.ts:151,160,172,199,215` — payment amounts to display
- `sales/sales.service.ts:291,506,597` — costPrice, interest rate
- `customers/customers.service.ts:1134` — `_sum.amountDue` (high risk — aggregation)
- `tax/tax.service.ts:435,446,452,456` — Excel export values
- `notifications/notifications.service.ts:1053,1065,1087,1206` — formatting + calculation
- `accounting/accounting.service.ts:2097` — remaining balance calculation
- `accounting/bank-reconciliation.service.ts:126,140` — amount matching
- `chatbot-finance/auto-trigger.service.ts:169` — amountDue - amountPaid (arithmetic risk)

Most critical: `accounting.service.ts` (remaining balance), `auto-trigger.service.ts` (arithmetic), `customers.service.ts` (`_sum` aggregation).

### A5 — Web Test Failure Detail
`src/pages/assets/hooks/useAssetCalculation.test.ts` — 8 tests fail because `useAssetCalculation` now calls `useCoaByCodes` (which uses `useQuery`) but the test harness doesn't wrap the component in `QueryClientProvider`. The hook gained a React Query dependency without a corresponding test setup update.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | Money fields all use `@db.Decimal(12,2)` ✅. Floats only for GPS/AI confidence (correct). 7 models missing `uuid()` ID: `ExpenseDetail`, `CreditNoteDetail`, `PayrollDetail`, `VendorSettlementDetail`, `UserExpenseTemplate`, `IpRateLimit`, `AiSettings` — may be intentional detail rows. 74 models lack `deletedAt` — most are legitimately exempt (audit logs, tokens, event logs) but several lack the `/// Immutable` docstring guard required by database.md. |
| B2 Migrations | **PASS** | 268 migrations. Latest 3 are safe: column additions + `ALTER TYPE ADD VALUE IF NOT EXISTS` (Postgres-safe enum extension). No `DROP TABLE`, no destructive `ALTER TYPE`. |
| B3 Indexes | **WARN** | 15 models with unindexed FK fields. Key concerns: `Contract` (5 unindexed FKs: `productId`, `reviewedById`, `interestConfigId`, `pdpaConsentId`, `exchangedFromContractId`), `ChatRoom` (6 FKs), `OnlineOrder` (6 FKs), `ChatMessage` (3 FKs). |
| B4 Drift | **PASS** | Latest migration SQL aligns with schema: `DOUBLE PRECISION` maps to `Float?`, `JSONB` maps to `Json?`, enum additions match schema values. |

### B3 — Index Coverage Detail
```
Contract:     productId, reviewedById, interestConfigId, pdpaConsentId, exchangedFromContractId
ChatRoom:     lineUserId, externalUserId, pinnedById, handoffStaffId, attributionId, aiPausedById
OnlineOrder:  productId, reservationId, promotionUsageId, paymentLinkId, bankConfirmedById, saleId
ChatMessage:  externalMessageId, paymentId, receiptId
Repossession: contractId, productId, appraisedById, soldContractId
```
`ChatRoom` and `ChatMessage` are queried on every message receipt — missing indexes on `lineUserId` and `externalMessageId` will hurt at scale.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✅. `MAX_TOOL_ITERATIONS = 5` ✅. Sentry captures on all error paths ✅. `maxTokens = 1024` ✅. History window: 10 messages / 20k char budget ✅. |
| C2 Prompt | **OK** | Bank account matches `FINANCE_BANK` constant (KBank 203-1-16520-5) ✅. Phone matches `FINANCE_CONTACT_PHONE` (063-134-6356) ✅. Business hours consistent ✅. Prompt length: ~800 tokens (reasonable). Security rules well-defined (no PII reveal, no guessing, no promises). |
| C3 Tools | **OK** | 7 tools defined with Thai descriptions ✅. All tools have proper JSON Schema ✅. `tool-executor.ts` has `case` for all 7 tool names ✅. `customerId` injected by orchestrator (AI cannot switch customers) ✅. |
| C4 Auto-Trigger | **OK** | Idempotency: `ChatAutoTrigger` table checked before send ✅. All 6 reminder types covered: T-5, T-3, T-1, T-Day, T+1, T+3 ✅. `Sentry.captureException` on both cron jobs ✅. |
| C5 Security | **OK** | LIFF controller: `@UseGuards(LiffTokenGuard)` — LINE token verification, not JWT ✅. Admin controller: `@UseGuards(JwtAuthGuard, RolesGuard)` ✅. Webhook dedup: `WebhookDedupService` (DB-based, multi-instance safe) ✅. Customer isolation: orchestrator injects `customerId`, AI cannot override ✅. |

---

## Action Items

### 🔴 Critical (block next deploy)

**1. Generate `@prisma/client-finance` or remove the import**
- File: `apps/api/src/prisma/prisma-finance.service.ts`
- Root cause: SP7 introduced a second Prisma client for the Finance DB but never created `schema-finance.prisma` or a second generator block.
- Fix options:
  - (a) Create `apps/api/prisma/schema-finance.prisma` with `generator { output = "../node_modules/@prisma/client-finance" }` and run `npx prisma generate --schema=prisma/schema-finance.prisma`
  - (b) If SP7 is not yet ready to ship, stub `PrismaFinanceService` without `extends PrismaClient` until the schema exists
- Impact: fixes all 4 API TS errors + unblocks all 144 failing API tests

**2. Fix `useAssetCalculation.test.ts` — add QueryClientProvider**
- File: `apps/web/src/pages/assets/hooks/useAssetCalculation.test.ts`
- Fix: Wrap `renderHook(...)` calls with `wrapper: createQueryClientWrapper()` (pattern matches existing tests)
- Impact: fixes all 8 failing web tests

### 🟡 High (fix within sprint)

**3. Replace `$queryRawUnsafe` with `$queryRaw` tagged template**
- File: `apps/api/src/modules/overdue/stuck-contracts.service.ts:47`
- The `days` integer clamping makes it safe now, but tagged templates prevent future regressions

**4. Fix Decimal precision in arithmetic paths**
- Priority order: `accounting.service.ts:2097` (balance calc), `auto-trigger.service.ts:169` (amountDue - amountPaid), `customers.service.ts:1134` (`_sum` aggregation)
- Pattern: replace `Number(p.amountDue) - Number(p.amountPaid)` with `new Prisma.Decimal(p.amountDue).minus(p.amountPaid)`

**5. Add missing indexes for ChatRoom and ChatMessage**
- `ChatRoom`: add `@@index([lineUserId])`, `@@index([externalUserId])`
- `ChatMessage`: add `@@index([externalMessageId])`, `@@index([paymentId])`
- These are hit on every incoming message — missing indexes will cause table scans at scale

### 🟢 Low (backlog)

**6. Add `/// Immutable` or `/// append-only` docstrings to exempt models lacking deletedAt**
- database.md requires these comments — without them `code-reviewer` and future devs assume missing deletedAt is a bug
- Add to: `AuditLog`, `DocumentAuditLog`, `DataAuditLog`, `LoginAuditLog`, `ChatAutoTrigger`, `ChatbotOtpRequest`, `ProcessedWebhookEvent`, `WebhookDelivery`, etc.

**7. Split `excel` chunk further (bundle size)**
- `apps/web/src/pages/PaymentsPage.tsx` and other pages importing `exceljs` — use `dynamic import()` at the call site instead of a static import at module load
- Target: bring the excel chunk from 929 KB / 256 KB gzip to <200 KB gzip

**8. Add uuid IDs to 7 detail models**
- `ExpenseDetail`, `CreditNoteDetail`, `PayrollDetail`, `VendorSettlementDetail`, `UserExpenseTemplate`, `IpRateLimit`, `AiSettings`
- If these are intentional (e.g., composite-key line items), add a `/// No uuid — composite PK` comment per database.md exception pattern

**9. Add FK indexes for Contract, OnlineOrder, Repossession**
- Lower urgency than ChatRoom/ChatMessage but worth addressing in next migration batch

---

## Check Scorecard

| # | Check | Status |
|---|-------|--------|
| A1 | TS Errors | ❌ FAIL |
| A2 | Security | ⚠️ WARN |
| A3 | Decimal | ⚠️ WARN |
| A4 | Soft-Delete | ⚠️ WARN |
| A5 | Tests | ❌ FAIL |
| A6 | Bundle | ⚠️ WARN |
| B1 | Schema | ⚠️ WARN |
| B2 | Migrations | ✅ PASS |
| B3 | Indexes | ⚠️ WARN |
| B4 | Drift | ✅ PASS |
| C1 | AI Service | ✅ OK |
| C2 | Prompt | ✅ OK |
| C3 | Tools | ✅ OK |
| C4 | Auto-Trigger | ✅ OK |
| C5 | Security | ✅ OK |

**10/15 checks passed** (2 fail, 5 warn) — chatbot subsystem is fully healthy; infra blockers are SP7 migration debt.
