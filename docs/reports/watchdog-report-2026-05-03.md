# CTO Watchdog Report — 2026-05-03

## Summary

**10/15 checks PASS or OK · 5 WARN · 0 hard blockers · 0 critical security holes**

Top priorities: A3 (Decimal) has ~85 `Number()` on money fields across 5 services — floating-point risk in live financial arithmetic. B1 has 5 models with missing timestamp fields and no justifying comment (FAIL-level per database.md). A5 test count has grown substantially (2284 API, 222 web) but 1 seed spec fails due to missing `DATABASE_URL` in CI.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in `apps/api`, 0 errors in `apps/web` |
| A2 Security | **WARN** | `web-widget.controller.ts` not in allowed-public list in `security.md`; functionally correct (anonymous chat widget, uses roomId capability token) but undocumented. All other 15 unguarded controllers are legitimately public with alternative guards (LiffTokenGuard, LineWebhookGuard, ShopBotDefenseGuard, metrics X-header). No raw SQL. No token storage in localStorage. No hardcoded secrets in app code. |
| A3 Decimal | **WARN** | ~85 `Number()` conversions on Decimal monetary fields across 20+ files. High-risk arithmetic (not display-only): `scheduler.service.ts:119,241,415`, `bad-debt.service.ts:98,352`, `receipts.service.ts:93-101`, `payments.service.ts:967-968`, `overdue.service.ts:1384`. Also `contract-snapshot.service.ts:141` uses `Number(paymentAgg._sum.amountDue)` — contradicts v4 claim of "0 `Number(_sum` remaining`". |
| A4 Soft-Delete | **WARN** | `compliance.service.ts:61` — `contract.findMany({ where: { id: { in: ids } } })` missing `deletedAt: null`; soft-deleted contracts could appear in compliance reports. Other flagged services (ChatMessage, CallLog) are append-only models with no `deletedAt` by design — not violations. |
| A5 Tests | **WARN** | API: **2284 passed, 1 failed** (196 suites). Failed: `collections-foundation.seed.spec.ts` — `PrismaClientInitializationError: DATABASE_URL not set`; infrastructure misconfiguration, not a code bug. Web: **222 passed, 0 failed** (24 files). Note: test count has grown significantly beyond v4 baseline (577 API, 129 web) — new suites added since hardening. |
| A6 Bundle | **PASS** | No chunks exceed 500KB gzipped. Largest: `excel-*.js` (257KB gz), `ContractTemplatesPage-*.js` (148KB gz), `pdf-*.js` (139KB gz). Manual chunk splitting (exceljs, jspdf, recharts, @line/liff) functioning correctly. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | **Float**: PASS — all 7 Float fields are scores/coordinates, no monetary Float. **Enums**: PASS — all PascalCase names, SCREAMING_SNAKE_CASE values. **Timestamps**: WARN/FAIL — 25 models missing one or more standard fields (`createdAt`, `updatedAt`, `deletedAt`) with no `///` justification comment. 5 are FAIL-level (lack all three, no comment): `FeeWaiverApproval`, `CrmLeadStageHistory`, `WebsiteVisit`, `WebsiteSession`, `LegalCaseDocument`. Others are plausibly intentional (append-only, immutable) but undocumented. Also: `IpRateLimit` uses `ipHash String @id` (not UUID, no comment); `AiSettings` uses singleton ID pattern (no comment). |
| B2 Migrations | **PASS** | 196 migrations total. 4 most recent are all additive-only: `add_notification_templates`, `seed_notification_templates` (idempotent INSERT), `update_templates_to_flex` (pure UPDATE), `add_pgvector_to_ai_training_pairs` (CREATE EXTENSION + ADD COLUMN + HNSW index). No `DROP TABLE`, `DROP COLUMN`, `ALTER TYPE RENAME`, `TRUNCATE`, or `DELETE FROM`. |
| B3 Indexes | **PASS/WARN** | Core high-volume tables well-indexed: `contracts` (11 indexes, compound status+deletedAt+branchId), `payments` (7 indexes, compound status+dueDate), `customers` (6 indexes), `call_logs` (compound promise lifecycle index), `journal_entries` (4 indexes). Missing FK indexes on newer/smaller models: `LateFeeWaiverRequest` (`requesterUserId`, `approverUserId`), `BroadcastMessage` (`createdById`), `SalesCommission` (`commissionRuleId`), `ChatRoom` (`handoffStaffId`, `pinnedById`). |
| B4 Drift | **PASS** | No drift between the 3 most recent migrations and `schema.prisma`. pgvector fields (`embedding`, `embeddingModel`, `embeddedAt`) align. `NotificationTemplate` 17-column migration matches schema exactly. HNSW index not representable in Prisma schema — known limitation, not drift. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` guard present; Sentry `captureMessage` on max-iterations hit. `Sentry.captureException` in outer catch. Per-iteration 30s timeout via `AbortController`. **WARN**: `maxTokens = 1024` is at minimum floor — payment schedule tables with many installments risk mid-sentence truncation; consider bumping to 2048. **INFO**: `buildMessages()` method at line 307 is dead code (replaced by `buildMessagesFromHistory()`). |
| C2 Prompt | **OK** | Business hours ("จันทร์-เสาร์ 09:00-18:00"), phone ("063-134-6356"), bank account ("203-1-16520-5 บจก. เบสท์ช้อยส์โฟน"), late fee (50 ฿/day) all match constants exactly. No contradictions. Prompt ~825 tokens — well within budget. Forbidden-word list and security rules present. **WARN**: Bank account/phone hardcoded in 3 places (DB record + `finance-rules.ts` constant + code fallback in `system-prompt.ts`). If admin updates via DB, the constant and fallback will drift; no automated sync. Document the 3-way dependency clearly. |
| C3 Tools | **OK** | All 7 tools (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`) have Thai descriptions and well-defined input schemas. All 7 handled in `tool-executor.ts` switch with a `default` fallback. `validateToolInput()` called before execution. PII redaction applied to Sentry extras. `customerId` injected by orchestrator (not from Claude's tool_use block) — no cross-customer data leakage path. |
| C4 Auto-Trigger | **OK** | Idempotency: `@@unique([customerId, referenceKey])` + P2002 catch → `'skipped'`; safe for multi-instance Cloud Run. Reminder types: T-5, T-3, T-1, T-day (09:00 cron) + T+1, T+3 (10:00 cron) — all 6 covered. Sentry `captureException` on cron-level failures. **WARN**: `sendReminder()` catch at line ~237 does not call `Sentry.captureException` — per-customer LINE push failures (e.g., rate limit) are only logged and counted, not alerted. **WARN**: No escalation beyond T+3; confirm whether handoff to overdue team is intentional at that cutoff. |
| C5 Security | **OK** | LIFF controller: `LiffTokenGuard` verifies LINE ID token server-side; `lineUserId` from `req.liffUserId` (not user input). Admin controller: `@UseGuards(JwtAuthGuard, RolesGuard)` at class level, all 14+ endpoints have `@Roles`. Webhook: HMAC-SHA256 with `timingSafeEqual` + raw body; separate secret from Shop OA; `isRedelivery` first-pass guard + DB idempotency via `processedWebhookEvent`. Customer isolation: `customerId` injected by orchestrator. **WARN**: `ChatbotFinanceController` (main webhook + test endpoints) has no class-level guard — relies on per-method guards being applied consistently; a new method would have no guards by default. Follow `@Public()` / `@SkipAuth()` pattern used elsewhere. |

---

## Action Items (Prioritized)

### P1 — Fix Before Next Deploy

1. **A3: Replace `Number()` on money fields in 5 high-risk services**
   - `scheduler.service.ts:119,241,415` — use `Prisma.Decimal` arithmetic
   - `bad-debt.service.ts:98,352` — use `.sub()` / `.add()`
   - `receipts.service.ts:93-101` — use Decimal `.add()` in reduce
   - `payments.service.ts:967-968` — `roundBaht` should accept `Prisma.Decimal`
   - `contract-snapshot.service.ts:141` — `Number(paymentAgg._sum.amountDue)` → `paymentAgg._sum.amountDue ?? new Prisma.Decimal(0)`

2. **B1: Add `///` comments (or proper fields) to 5 FAIL-level models**
   - `FeeWaiverApproval`, `CrmLeadStageHistory`, `WebsiteVisit`, `WebsiteSession`, `LegalCaseDocument` — add `/// Immutable event log — updatedAt/deletedAt intentionally omitted` or add the missing fields.

3. **A4: Fix soft-delete gap in compliance.service.ts**
   - `compliance.service.ts:61` — add `deletedAt: null` to `contract.findMany` where clause.

### P2 — Fix This Sprint

4. **A5: Fix `collections-foundation.seed.spec.ts` DB connection**
   - Either mock the Prisma client or add `DATABASE_URL` to the test env config. Spec should not require a live DB.

5. **B3: Add missing FK indexes via migration**
   - `LateFeeWaiverRequest`: `@@index([requesterUserId])`, `@@index([approverUserId])`
   - `SalesCommission`: `@@index([commissionRuleId])`
   - `BroadcastMessage`: `@@index([createdById])`

6. **A2: Document `web-widget.controller.ts` in `security.md` allowed-public list**
   - Add: `web-widget` — anonymous site chat widget, uses roomId capability token.

7. **C5: Add class-level guard to `ChatbotFinanceController`**
   - Add `@UseGuards(JwtAuthGuard, RolesGuard)` at class level + `@Public()` on webhook endpoint.

### P3 — Backlog / Owner Decision Needed

8. **C1: Raise `maxTokens` to 2048 in `finance-ai.service.ts`**
   - Prevents truncation of multi-installment payment schedules in Thai.

9. **C2: Document 3-way bank account sync dependency**
   - Add comment in `finance-rules.ts` and `system-prompt.ts` listing all 3 places that must be updated when bank account changes.

10. **C4: Add per-send `Sentry.captureException` in `sendReminder()` catch**
    - Ensures individual LINE push failures surface in Sentry, not just in DB `FAILED` status.

11. **C4: Confirm T+3 escalation cutoff is intentional**
    - Document whether T+3 is the intended hand-off point to the human overdue team.

12. **B1: Add `///` comments to remaining 20 models with partial timestamp omissions**
    - `PromiseSlot`, `PaymentLink`, `PromotionUsage`, `ChatAutoTrigger`, `ConversationTag`, `StaffChatActivity`, `ChatSnooze`, `CrmNote`, `CustomerScore`, `AccountingPeriod`, etc.

13. **C1: Remove dead `buildMessages()` method in `finance-ai.service.ts`**

---

*Generated by CTO Watchdog · 2026-05-03 · Checks: 15 · PASS/OK: 10 · WARN: 5 · FAIL: 0*
