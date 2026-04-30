# CTO Watchdog Report — 2026-04-30

## Summary
8/15 checks PASS, 7 WARN, 0 FAIL. Critical items: Decimal non-compliance (37+ Number() casts on money fields across 12 services), 1 DB-dependent unit test failing due to missing DATABASE_URL, and two controllers (web-widget, line-login) not listed in the approved public endpoint registry in security.md.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | API: 0 errors, Web: 0 errors |
| A2 Security | **WARN** | 3 findings (see below) |
| A3 Decimal | **WARN** | 37+ `Number()` casts on money fields across 12 services |
| A4 Soft-Delete | **WARN** | ~30 `findMany`/`findFirst` without `deletedAt: null` (mostly on no-soft-delete models — low risk) |
| A5 Tests | **WARN** | API: 2284/2285 (1 fail — DATABASE_URL missing in test env); Web: 222/222 |
| A6 Bundle | **PASS** | All chunks ≤256 KB gzip. Raw warnings: `excel` 929 KB, `thai-address-data` 870 KB (gzip 256/69 KB) |

### A2 Security Detail

**Finding 1 — Undocumented public controllers (MEDIUM)**
`web-widget.controller.ts` and `line-oa/line-login.controller.ts` have no `JwtAuthGuard` and are not listed in the approved public endpoint registry in `.claude/rules/security.md`. Both appear intentionally public (comments document rationale), but the registry is the source of truth and should be updated.

```
apps/api/src/modules/staff-chat/web-widget.controller.ts    — @Controller('widget'), no guard
apps/api/src/modules/line-oa/line-login.controller.ts       — @Controller('line-oa/line-login'), OAuth flow
```

**Finding 2 — E2E localStorage (LOW)**
`apps/web/src/lib/api.ts` reads `localStorage.getItem('access_token')` in a clearly-documented E2E-test-only branch (guarded behind `import.meta.env.VITE_E2E`). Low risk — not reachable in production — but worth noting.

**Finding 3 — $executeRaw parameterized (INFO)**
`chatbot-finance/services/feedback.service.ts:146` uses `$executeRaw` tagged template literal with `${kbEntry.id}` — Prisma treats this as a safe parameterized query. No injection risk.

### A3 Decimal Detail (top offenders)

| File | Instances |
|------|-----------|
| `repossessions/repossessions.service.ts` | 6 |
| `line-oa/chatbot.service.ts` | 6 |
| `notifications/notifications.service.ts` | 2 |
| `sales/sales.service.ts` | 2 |
| `purchase-orders/purchase-orders.service.ts` | 4 |
| `staff-chat/services/chat-commerce.service.ts` | 3 |
| `shop-catalog/shop-catalog.service.ts` | 2 |
| `crm/services/customer-scoring.service.ts` | 1 |
| `finance-receivable/finance-receivable.service.ts` | 1 |
| `asset/asset.service.ts` | 3 |
| `chatbot-finance/services/auto-trigger.service.ts` | 2 |
| `customers/customers.service.ts` | 2 |

All should use `new Prisma.Decimal(x)` or `.toNumber()` only at serialization boundary.

### A5 Failing Test Detail

```
FAIL src/modules/overdue/__tests__/collections-foundation.seed.spec.ts
  ● seedCollectionsFoundation › is idempotent — running twice yields same counts
  PrismaClientInitializationError: Environment variable not found: DATABASE_URL
```

This test requires a live DB. It should be excluded from unit-test runs via jest config or moved to the `e2e/` suite. Not a code bug.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | 90/140 models have `deletedAt`; 50 without are all legitimate exceptions (audit logs, tokens, event tables, config singletons) |
| B2 Migrations | **PASS** | 193 migrations; latest: `20260702000001_seed_notification_templates` (descriptive, idempotent seed). No `DROP`/`ALTER TYPE` in last 3 |
| B3 Indexes | **WARN** | Script identified potential FK fields without `@@index` in 73 models (see below) |
| B4 Drift | **PASS** | Latest migration is data-only (seed). No schema drift detected |

### B1 Model Exceptions (no `deletedAt` — intentional)

```
Immutable audit logs: AuditLog, DocumentAuditLog, DataAuditLog, JournalPostAuditLog, 
                      BadDebtWriteOffAuditLog, LoginAuditLog, WarrantyAuditLog, ReceivableReconLog
One-time tokens:      PasswordResetToken, InviteToken, CustomerAccessToken, ChatbotOtpRequest,
                      TwoFactorOtpRequest
Idempotency records:  ProcessedWebhookEvent, SlipFingerprint
Append-only events:   ChatAutoTrigger, AiUsageLog, WebhookDelivery, WebhookAnomaly,
                      AiAutoReplyLog, BroadcastMessage, BroadcastApproval
Config singletons:    AiSettings, AccountingPeriod
Scoring/CRM:         CustomerScore, CrmLeadAssignment, CrmLeadStageHistory, CrmNote,
                      AdsAttribution, StaffChatActivity, ChatSnooze, ConversationTag
Other:               PromiseSlot, SavingPlanPayment, DunningRule, Promotion, Todo, TodoComment,
                      ChatKbSuggestion, FeeWaiverApproval, ContractDailySnapshot, LegalCaseDocument,
                      SmsTemplate, ProductReservation, WebsiteVisit, WebsiteSession, IpRateLimit, KnownDevice
```

**Note**: `Promotion`, `Todo`, `TodoComment`, `DunningRule`, `PromiseSlot`, `SavingPlanPayment` appear to be business entities that _should_ have `deletedAt`. Recommend review.

### B3 Index Gap (confirmed gaps only)

The following FK fields appear frequently in queries but lack `@@index`:
- `Contract.reviewedById`, `Contract.interestConfigId`
- `PurchaseOrder.approvedById`, `PurchaseOrder.createdById`
- `ProductPhoto.productId`, `ProductPhoto.uploadedById`
- `StockAdjustment.approvedById`

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | `claude-sonnet-4-6` ✓, `MAX_TOOL_ITERATIONS=5` ✓, Sentry ✓, `maxTokens=1024` ✓ |
| C2 Prompt | **OK** | Bank account, phone, hours correct; Thai-language rules clear; ~1800 tokens est. |
| C3 Tools | **OK** | 7 tools defined, all 7 handled in `tool-executor.ts`; input schemas well-formed |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` unique check ✓; T-5/T-3/T-1/T/T+1/T+3 ✓; Sentry on both crons ✓ |
| C5 Security | **WARN** | See below |

### C5 Security Detail

**LIFF controller** (`chatbot-finance-liff.controller.ts`): Protected by `LiffTokenGuard` — verifies LINE ID token server-side. `lineUserId` injected from verified token, not client input. Customer data isolation enforced in `FinanceToolExecutor` (customerId injected by orchestrator, not AI-controlled). ✓

**Admin controller** (`chatbot-finance-admin.controller.ts`): Uses `JwtAuthGuard + RolesGuard`. ✓

**Webhook dedup** (`webhook-dedup.service.ts`): DB-based unique constraint on `eventId`. Safe for multi-instance Cloud Run. Retention cron at 04:00 daily. ✓

**Gap**: `line-oa/line-login.controller.ts` (OAuth callback flow) is not in the approved public controller registry in `security.md`. The LINE OAuth callback cannot have JwtAuthGuard by design, but it should be documented as intentionally public.

---

## Action Items

### P1 — High Priority

1. **Add ~37 Decimal fixes** (A3): Replace `Number(someDecimalField)` with `new Prisma.Decimal(...)` or explicit `.toNumber()` at serialization boundary only. Top files: `repossessions.service.ts`, `line-oa/chatbot.service.ts`, `purchase-orders.service.ts`.

2. **Fix failing unit test** (A5): Either add `DATABASE_URL` to jest test environment setup, or move `collections-foundation.seed.spec.ts` to the e2e suite / add `@jest-environment-db` guard.

3. **Update security.md public registry** (A2, C5): Add `web-widget.controller.ts` (`/widget/*`, anonymous website chat) and `line-oa/line-login.controller.ts` (LINE OAuth flow) to the intentionally-public list with rationale.

### P2 — Medium Priority

4. **Review business entities without deletedAt** (B1): Confirm if `Promotion`, `Todo`, `TodoComment`, `DunningRule`, `PromiseSlot`, `SavingPlanPayment` need soft-delete. Add `deletedAt DateTime?` if yes.

5. **Add missing FK indexes** (B3): Prioritize `ProductPhoto.productId`, `PurchaseOrder.approvedById`, `Contract.reviewedById` — these appear in filtered queries.

### P3 — Low Priority

6. **Bundle raw size** (A6): `excel` chunk (930 KB raw) and `thai-address-data` (870 KB raw) exceed Vite's 500 KB warning threshold. Gzip sizes are acceptable (256 KB / 69 KB) but consider lazy-loading `thai-address-data` only on pages that use address picker.

7. **Consolidate soft-delete audit** (A4): About 30 `findMany`/`findFirst` calls lack `deletedAt: null`. Most are on no-soft-delete models (ChatMessage, ChatRoom, etc.) — but scan services for models that _do_ have `deletedAt` to ensure no gaps.
