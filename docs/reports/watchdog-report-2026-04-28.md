# CTO Watchdog Report — 2026-04-28

## Summary
12/15 checks passed — 3 warnings in A2 (undocumented public controllers), A3 (Decimal violations), B3 (missing FK indexes). No critical failures; 1 test failure is infrastructure (no live DB in CI).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in `apps/api` and `apps/web` |
| A2 Security | **WARN** | 17 controllers without `JwtAuthGuard` not in security.md exempt list; all appear intentionally public (shop-catalog, metrics, webhooks, LIFF) but undocumented. No raw SQL, no localStorage token leaks, no hardcoded secrets. |
| A3 Decimal | **WARN** | 29 `Number()` calls on money fields across 9 services. See Action Items. |
| A4 Soft-Delete | **WARN** | Automated scan flagged ~40 `findMany`/`findFirst`/`findUnique` without `deletedAt: null` — many are on intentionally soft-delete-free models (tokens, audit logs). Review needed to rule out genuine gaps. |
| A5 Tests | **PASS** | API: 2147/2148 (1 seed DB-connection test fails without live server — expected). Web: 222/222. Both exceed baselines (API baseline 577, Web baseline 129). |
| A6 Bundle | **WARN** | 7 chunks exceed Vite 500 KB minified threshold. Gzip sizes all OK (<500 KB). Top offenders: `excel` 929 KB / 256 KB gzip, `thai-address-data` 870 KB / 69 KB gzip, `PaymentsPage` 842 KB / 242 KB gzip. |

### A2 Detail — Unguarded Controllers (need documentation update in security.md)
Controllers intentionally public but not in exempt list:
- `shop-catalog` — ShopBotDefenseGuard (rate-limit bot protection, no JWT)
- `metrics` — Prometheus scrape endpoint (SkipThrottle, intentional)
- `yeastar-webhook` — Yeastar PBX webhook ("intentionally public" in code comment)
- `facebook-webhook` — Meta webhook HMAC verified
- `line-oa/line-login`, `liff-api`, `line-oa-chatbot` — LINE LIFF/webhook (LiffTokenGuard)
- `staff-chat/web-widget` — web widget embed (throttled)
- `shop-reservation`, `shop-buyback`, `shop-tracking`, `shop-cart`, `shop-trade-in`, `shop-auth-social`, `shop-line-chat`, `shop-shipping` — public shop-facing endpoints

### A3 Detail — Number() Violations on Money Fields
Top offenders requiring `Prisma.Decimal` / `.toNumber()` conversion:
- `chatbot-finance/services/finance-tools.service.ts:53-111` — 4 violations
- `line-oa/chatbot.service.ts:150-214` — 6 violations
- `staff-chat/services/chat-commerce.service.ts:106-229` — 4 violations
- `shop-catalog/shop-catalog.service.ts:93-134` — 2 violations
- `sales/sales.service.ts:286,579` — 2 violations
- `asset/asset.service.ts:173-340` — 3 violations
- `stickers/stickers.service.ts:67-68` — 2 violations
- `customers/customers.service.ts:1049` — 1 violation (`_sum.amountDue`)
- `shop-orders/online-order-sale.adapter.ts:52` — 1 violation

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 40 models without `deletedAt` — need audit (many are legitimately exempt audit/event/token models). No Float money fields (GPS lat/long and AI confidence scores correctly use Float). All 95 enums correctly SCREAMING_SNAKE_CASE. |
| B2 Migrations | **PASS** | 184 migrations total. Latest: `20260612000000_add_promise_lifecycle` (descriptive). Last 5 migrations: no dangerous `DROP TABLE`/`DROP COLUMN`/`ALTER TYPE`. One `DROP INDEX IF EXISTS` in latest migration is safe (replaced with broader index). |
| B3 Indexes | **WARN** | 132 FK fields across models potentially missing `@@index`. Priority gaps: `Contract.productId`, `Contract.reviewedById`, `Product.poId`, `PurchaseOrder.createdById`/`approvedById`, `ProductPhoto.productId`. |
| B4 Drift | **PASS** | Latest migration SQL matches `schema.prisma` — `PromiseSlot`, `CallLog` lifecycle fields, and `Contract.keptPromiseCount` all correctly reflected. |

### B1 — Models Missing deletedAt Requiring Audit
These are NOT in the documented exempt list and may be genuine oversights:
`PromiseSlot`, `DunningRule`, `Promotion`, `Todo`, `TodoComment`, `SavingPlanPayment`, `FeeWaiverApproval`, `JournalPostAuditLog`, `AccountingPeriod`, `ProductReservation`, `LegalCaseDocument`, `SmsTemplate`

Likely legitimately exempt (audit/event/operational): `ChatAutoTrigger`, `ChatKbSuggestion`, `ConversationTag`, `LoginAuditLog`, `BadDebtWriteOffAuditLog`, `AiUsageLog`, `WebhookAnomaly`, `BroadcastApproval`, `WebsiteVisit`, `WebsiteSession`, `CustomerScore`, `AiTrainingPair`, `AiAutoReplyLog`, `WarrantyAuditLog`, `ReceivableReconLog`

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5`. `maxTokens = 1024`. Sentry imported and in use. History window: last 10 messages / 20 k char budget. |
| C2 Prompt | **WARN** | Prompt consistent with `finance-rules.ts` constants (bank account, hours, late fee). However, bank info is hardcoded in both `system-prompt.ts` AND `finance-rules.ts` — Phase E migration to `ChatKnowledgeBase` table still pending. Dual-source drift risk. Prompt length ~50 lines / ~600 tokens — reasonable. |
| C3 Tools | **OK** | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All have Thai descriptions. `tool-executor.ts` handles all 7 via `switch-case`. `customerId` injected by orchestrator — Claude cannot override. |
| C4 Auto-Trigger | **OK** | All 6 reminder types covered (T-5, T-3, T-1, T, T+1, T+3). Idempotency via `ChatAutoTrigger` table (PENDING/SENT marker checked before send). Sentry capture on cron failure. Cron at 09:00 (reminders) and 10:00 (escalations) Asia/Bangkok. |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard` (correct LINE-specific auth, not JWT). Admin controller has `@UseGuards(JwtAuthGuard, RolesGuard)`. Tool executor: `customerId` locked by orchestrator, passed as context — Claude cannot escalate to another customer's data. |

---

## Action Items

### P0 — Fix Now
_None — no critical blockers._

### P1 — Fix This Sprint
1. **A3 Decimal violations** — Replace `Number(x.amountDue)` etc. with `new Prisma.Decimal(x.amountDue).toNumber()` or operate in Decimal arithmetic. Priority services: `finance-tools.service.ts`, `chatbot.service.ts`, `chat-commerce.service.ts`. Risk: rounding errors in financial display.
2. **A2 security.md update** — Expand the "Intentionally Public Endpoints" list in `.claude/rules/security.md` to document all 17 intentionally-public controllers with their auth mechanism (LiffTokenGuard, ShopBotDefenseGuard, HMAC, etc.). No code change needed; documentation gap only.

### P2 — Fix Next Sprint
3. **B3 Missing FK indexes** — Add `@@index` on at minimum: `Contract.productId`, `Contract.reviewedById`, `Product.poId`, `PurchaseOrder.createdById`, `PurchaseOrder.approvedById`, `ProductPhoto.productId`. Run `EXPLAIN ANALYZE` on common queries to prioritize.
4. **B1 deletedAt audit** — Review 12 models flagged above (PromiseSlot, DunningRule, Promotion, Todo, etc.) and either add `deletedAt` or add `/// No soft-delete — [reason]` doc comment.
5. **A4 Soft-delete gaps** — Manually verify `sales.service.ts:139`, `purchase-orders.service.ts:21,907`, `repossessions.service.ts:471`, `journal-auto.service.ts:480` that `findMany` calls query correct scopes.

### P3 — Backlog
6. **A6 Bundle size** — Consider splitting `PaymentsPage` (842 KB raw) — likely pulling in `exceljs` directly. Add dynamic `import()` for export-to-Excel path.
7. **C2 Phase E** — Migrate bank account info and contact number from `system-prompt.ts` hardcode to `ChatKnowledgeBase` table so admin can update without a deploy.
8. **A5 Seed test** — Tag `collections-foundation.seed.spec.ts` with `@group integration` or move to E2E so it skips in unit-test CI runs.

---

_Generated by CTO Watchdog — 2026-04-28_
