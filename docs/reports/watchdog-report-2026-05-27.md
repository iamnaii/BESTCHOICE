# CTO Watchdog Report — 2026-05-27

## Summary
**5/15 PASS · 7/15 WARN · 3/15 FAIL**
Primary blockers: `@prisma/client-finance` not generated (cascades A1 + A5); one CRITICAL `Number()` on Decimal in customer-facing LINE chat (A3). No security breaches found.

> Baseline note: CLAUDE.md baselines (577 API tests, 129 web tests) are now stale — actual counts are **3,894 API** and **553 web** after v4–v6 additions. Baselines should be updated.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors — API | **FAIL** | 7 errors, all from `@prisma/client-finance` not generated. Affects `prisma-finance.service.ts`, `health.controller.ts`, and 2 spec files. Fix: run `prisma generate` for the finance schema. |
| A1 TS Errors — Web | **PASS** | 0 errors |
| A2 Security | **WARN** | Raw SQL: PASS. localStorage tokens: PASS (E2E bridge, safe). Secrets: PASS. **2 undocumented public controllers** (see below). |
| A3 Decimal | **FAIL** | **CRITICAL**: `staff-chat/services/chat-commerce.service.ts:132-134` — `Number(amountDue/lateFee/amountPaid)` before arithmetic; result shown to customer in LINE chat. **WARNING**: `shop-catalog.service.ts:95` — `Number(costPrice)` fed into installment calc (display only). Other `Number()`/`.toNumber()` uses are at serialization boundary (acceptable). |
| A4 Soft-Delete | **WARN** | **2 services missing `deletedAt: null`**: `branch-receiving.service.ts` (findMany + findUnique) and `pricing-templates.service.ts` (findUnique). `shop-reservation.service.ts` Product lookup also missing but partially mitigated upstream. |
| A5 Tests | **FAIL** | API: **3,742 pass / 144 fail** across 14 suites — root cause is missing `@prisma/client-finance` (same as A1). Web: **553 pass / 7 fail** — `useAssetCalculation.test.ts` missing `QueryClientProvider` wrapper; `CannedResponseAdminPage.test.tsx` hangs on test 3 (`waitFor` not resolving). |
| A6 Bundle | **PASS** | No chunk exceeds 500 KB gzip. Largest: `excel` 256 KB, `LettersPage` 220 KB, `ContractTemplatesPage` 145 KB. Bundle splits from v3 are working correctly. |

### A2 Security Detail

| Finding | Severity | File | Notes |
|---------|----------|------|-------|
| No guard at all | WARN | `staff-chat/web-widget.controller.ts` | Exposes `POST /widget/init` + `GET /widget/messages/:roomId`. Comment says "anonymous visitors" — not in `security.md` allowed-public list. Add documentation or ShopBotDefenseGuard. |
| ShopBotDefenseGuard only | WARN | `shop-auth-social/shop-auth-social.controller.ts` | Social login callbacks (`/shop/auth/line/callback`, `/shop/auth/facebook/callback`, `/shop/auth/bind-phone`). Legitimate public, not documented. |
| Missing ShopBotDefenseGuard | INFO | `shop-public-config/shop-public-config.controller.ts` | Is in `security.md` allowed-public list but unlike peer shop controllers has no `ShopBotDefenseGuard`. Inconsistent. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | No Float money fields (PASS). All Decimal annotated `@db.Decimal(12,2)` (PASS). All enums correct (PASS). IDs all UUID (PASS). **35 models missing timestamps** without documented justification — critical models: `PromiseSlot` (no deletedAt), `ExpenseLine` (no deletedAt), `AccountingPeriod` (no deletedAt), `SettlementLine` (no deletedAt), `LegalCaseDocument` (no createdAt/updatedAt), `PaymentLink` (no updatedAt). |
| B2 Migrations | **WARN** | 268 migrations. Latest two are safe (ADD VALUE IF NOT EXISTS, new table). Historical: `DROP COLUMN unearned_commission/unearned_interest` (phase A4 migration) lacks `IF EXISTS` guard — requires the documented wipe+migrate sequence from `accounting.md`. No other dangerous unguarded drops. |
| B3 Indexes | **WARN** | ~141 FK fields potentially lack explicit `@@index`. **High-impact gaps**: `Contract.productId`, `Contract.interestConfigId`, `SalesCommission.commissionRuleId`, `SalesCommission.approvedById`, `ExpenseDocument.createdById`, `ExpenseDocument.approvedById`, `FixedAsset.approverId`. `*ById` audit fields are lower priority (rarely used in filters). |
| B4 Drift | **PASS** | Latest 2 migrations match schema exactly. `CannedResponseBubble` new columns and `CannedResponseQuickReply` table consistent. No drift detected. |

### B1 Timestamp Gaps Detail (critical models)

| Model | Missing | Risk |
|-------|---------|------|
| `PromiseSlot` | `deletedAt` | V5 promise lifecycle — cancellation can't be soft-tracked |
| `ExpenseLine` | `deletedAt` | Legal evidence — accounting line items |
| `AccountingPeriod` | `deletedAt` | Periods shouldn't be hard-deletable |
| `SettlementLine` | `deletedAt` | Vendor settlement line — legal evidence |
| `LegalCaseDocument` | `createdAt`, `updatedAt` | Legal doc has no audit timestamps at all |
| `OtherIncomeAttachment` | `updatedAt`, `deletedAt` | Accounting attachments unprotected |
| `PayrollLine` | `deletedAt` | Payroll lines shouldn't be hard-deletable |
| `AccountRoleMap` | `deletedAt` | Role revocations are hard-deletes |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **PASS** | Model: `claude-sonnet-4-6` (current). MAX_TOOL_ITERATIONS=5 with Sentry warning on exhaustion. Per-request timeout 30s. Prompt cache with 5-min TTL. **INFO**: `maxTokens=1024` — may truncate verbose multi-tool responses (e.g. long payment schedules); consider bumping to 2048. Dead `buildMessages()` method (lines 307-339) should be removed. |
| C2 Prompt | **WARN** | Bank account, phone, business hours, late fee all consistent across `system-prompt.ts` and `finance-rules.ts` (PASS). **WARN**: Line 37 "ห้ามพิมพ์เบอร์โทรเต็ม" is ambiguous — could be misread as prohibiting the company phone number. Rephrase to "เบอร์โทรของลูกค้า". Prompt is ~675 tokens (well within budget). |
| C3 Tools | **PASS** | 7 tools defined. All have Thai descriptions. Input schemas properly defined with length/range caps. `tool-executor.ts` handles all 7 — exact 1:1 match. PII keys redacted before Sentry logging. `customerId` excluded from tool inputs (injected by orchestrator — Claude cannot override). |
| C4 Auto-Trigger | **WARN** | Idempotency: `ChatAutoTrigger` unique constraint on `(customerId, referenceKey)` — safe for multi-instance Cloud Run (PASS). All 6 reminder types covered: T-5, T-3, T-1, T+0, T+1, T+3 (PASS). Sentry capture on cron errors (PASS). **WARN**: `auto-trigger.service.ts:169` — `Number(payment.amountDue) - Number(payment.amountPaid)` violates v4 Decimal mandate. Low practical risk at these amounts but inconsistent. |
| C5 Security | **PASS** | LIFF controller: `LiffTokenGuard` (correct). Admin controller: `JwtAuthGuard + RolesGuard` (correct). Webhook: HMAC-SHA256 with `timingSafeEqual` (timing-safe). Dedup: DB unique constraint on `eventId`, 7-day retention cron. Customer isolation: `customerId` from verified LINE session, not from tool input. OTP rate-limited 5/min. Input capped at 2000 chars. |

---

## Action Items

### P0 — BLOCKER (fix before next deploy)

| # | Item | File | Impact |
|---|------|------|--------|
| 1 | **Generate `@prisma/client-finance`** | `apps/api/prisma/` | Unblocks A1 (7 TS errors) + A5 (14 suites, 144 test failures). Run `npx prisma generate` for finance schema. |
| 2 | **Fix Decimal arithmetic in chat-commerce** | `staff-chat/services/chat-commerce.service.ts:132-134` | CRITICAL: customer sees wrong payment amount in LINE chat. Replace `Number(amountDue/lateFee/amountPaid)` with `Prisma.Decimal` arithmetic. |

### P1 — HIGH (fix this sprint)

| # | Item | File | Impact |
|---|------|------|--------|
| 3 | **Add `deletedAt: null` to branch-receiving** | `inventory/branch-receiving.service.ts` | Soft-deleted records surface in stock lists |
| 4 | **Add `deletedAt: null` to pricing-templates** | `pricing-templates/pricing-templates.service.ts` | Deleted templates can still be fetched |
| 5 | **Document `web-widget.controller.ts` in security.md** | `staff-chat/web-widget.controller.ts` | Public endpoint not in allowed list — potential security gap |
| 6 | **Document `shop-auth-social.controller.ts` in security.md** | `shop-auth-social/shop-auth-social.controller.ts` | Same issue — social login callbacks need documentation |
| 7 | **Fix `useAssetCalculation.test.ts`** | `apps/web/src/pages/assets/hooks/` | 7 failing tests — add `QueryClientProvider` wrapper |
| 8 | **Fix hanging `CannedResponseAdminPage.test.tsx`** | `apps/web/src/pages/` | Test hangs — add `act()` or cleanup async handles |

### P2 — MEDIUM (next sprint)

| # | Item | File | Impact |
|---|------|------|--------|
| 9 | **Fix `Number(costPrice)` in shop-catalog** | `shop-catalog/shop-catalog.service.ts:95` | Decimal rule violation; affects installment preview display |
| 10 | **Fix `Number(amountDue)` in auto-trigger** | `chatbot-finance/services/auto-trigger.service.ts:169` | Decimal rule violation; customer-facing reminder amounts |
| 11 | **Add FK indexes** — `Contract.productId`, `Contract.interestConfigId`, `SalesCommission.commissionRuleId` | `prisma/schema.prisma` | Query performance on core entities |
| 12 | **Add `deletedAt` to `PromiseSlot`, `ExpenseLine`, `AccountingPeriod`, `SettlementLine`** | `prisma/schema.prisma` | Legal evidence + v5 promise lifecycle correctness |
| 13 | **Update baselines in CLAUDE.md** | `.claude/CLAUDE.md` | API: 3,894 tests; Web: 553 tests (v4–v6 added significantly) |

### P3 — LOW (tech debt)

| # | Item |
|---|------|
| 14 | Rephrase `system-prompt.ts:37` — "ห้ามพิมพ์เบอร์โทรของลูกค้า" (not "เบอร์โทรเต็ม") |
| 15 | Increase `maxTokens` from 1024 → 2048 in `finance-ai.service.ts` |
| 16 | Remove dead `buildMessages()` method from `finance-ai.service.ts:307-339` |
| 17 | Add `ShopBotDefenseGuard` to `shop-public-config.controller.ts` for consistency |
| 18 | Replace `FALLBACK_BANK_BLOCK` hardcoded string in `reminder-templates.ts` with import from `finance-rules.ts` constants |
| 19 | Add `/// Intentionally public — ...` doc comment to `web-widget` and `shop-auth-social` controllers once documented |
| 20 | Audit `LegalCaseDocument` — add `createdAt`/`updatedAt` timestamps (legal evidence) |

---

*Report generated by CTO Watchdog — 5 agents, 15 checks, 2026-05-27*
*Run: `git log --oneline -1` to confirm commit.*
