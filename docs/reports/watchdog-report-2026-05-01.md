# CTO Watchdog Report — 2026-05-01

## Summary
11/15 checks passed. Critical: A3 Decimal compliance has 35+ `Number()` casts on money fields across 15 services. Warnings: A4 soft-delete gaps in chat/report services, B1 schema timestamp gaps on 10 models, A5 one flaky API test, A6 large raw bundle chunks.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in `apps/api`, 0 errors in `apps/web` |
| A2 Security | **PASS** | No raw `$queryRaw` without params; no JWT in localStorage (E2E-only, cleared on init); all secrets via `configService`/`integrationConfig`; all controllers have `JwtAuthGuard` (public exceptions correctly exempt: chatbot-finance-liff, address, paysolutions, sms-webhook) |
| A3 Decimal | **FAIL** | 35+ `Number()` casts on money fields across 15+ services (see list below) |
| A4 Soft-Delete | **WARN** | 14 service files with `findMany`/`findFirst`/`findUnique` missing `deletedAt: null` filter (see list below) |
| A5 Tests | **WARN** | API: 2285/2285 — 1 failed (`collections-foundation.seed.spec.ts` — DB connection in test env, not a code regression); Web: 222 passed (24 files, up from 129 baseline) |
| A6 Bundle | **WARN** | No chunk exceeds 500KB gzipped. Largest gzip: `excel` 256KB, `ContractTemplatesPage` 147KB, `pdf` 139KB, `charts` 119KB. Raw sizes flagged by Vite: `excel` 929KB, `thai-address-data` 870KB, `ContractTemplatesPage` 495KB |

### A3 — Decimal Violations (Priority Files)
| File | Instances | Fields |
|------|-----------|--------|
| `chatbot-finance/services/finance-tools.service.ts` | 6 | `amountDue`, `amountPaid` |
| `notifications/scheduler.service.ts` | 4 | `amountDue`, `amountPaid`, `lateFee` |
| `notifications/notifications.service.ts` | 3 | `amountDue` |
| `line-oa/chatbot.service.ts` | 6 | `amountDue`, `amountPaid` |
| `sales/sales.service.ts` | 2 | `costPrice` |
| `asset/asset.service.ts` | 3 | `costValue`, `salvageValue` |
| `customers/customers.service.ts` | 1 | `totalOutstandingThb (_sum)` |
| `stickers/stickers.service.ts` | 2 | `amount`, `costPrice` |
| `shop-catalog/shop-catalog.service.ts` | 2 | `costPrice` |
| `chatbot-finance/services/auto-trigger.service.ts` | 2 | `amountDue`, `amountPaid` |
| `chatbot-finance/services/admin-analytics.service.ts` | 1 | `cost` |
| `staff-chat/services/chat-commerce.service.ts` | 3 | `amountDue`, `amountPaid`, `amount` |
| `staff-chat/services/canned-response-variable.service.ts` | 1 | `amountDue` |
| `shop-installment-apply/shop-installment-apply.service.ts` | 1 | `costPrice` |
| `defect-exchange/defect-exchange.service.ts` | 1 | `amountPaid` |

**Fix pattern**: Replace `Number(x)` with `new Prisma.Decimal(x).toNumber()` for display/formatting, or keep as `Prisma.Decimal` for arithmetic.

### A4 — Soft-Delete Gaps (Selected)
| File | Concern |
|------|---------|
| `reporting/compliance.service.ts` | 5 queries — Contract, LegalCase, CallLog without `deletedAt` |
| `inter-company/inter-company.service.ts` | 6 queries on `InterCompanyTransaction` |
| `shop-catalog/shop-catalog.service.ts` | 3 queries on `Product` |
| `staff-chat/services/ai-suggest.service.ts` | 4 queries — ChatRoom, Promotion |
| `staff-chat/services/staff-message.service.ts` | 3 queries — ChatNote, CannedResponse |
| `chat-ai-draft/chat-ai-draft.service.ts` | 5 queries — ChatMessage (immutable, OK), Customer |
| `stickers/stickers.service.ts` | 3 queries — StickerTemplate, Product |

**Note**: `ChatMessage`, `ChatRoom`, `AiSettings` may be intentionally exempt (append-only or singleton). Verify models that have `deletedAt` field are correctly filtered.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 148 models; 138 have UUID IDs ✓; Float used only for GPS coords + ML confidence (non-money) ✓; 155 `@db.Decimal` fields ✓; **10 models missing `updatedAt`**, **10 models missing `deletedAt`** (see below) |
| B2 Migrations | **PASS** | 195 migrations total; latest `20260703000000_update_templates_to_flex` is descriptive; DROP statements found are all conditional/intentional (constraint drops, column cleanup, FK restructures with documented reasons) |
| B3 Indexes | **PASS** | No missing FK indexes detected by automated scan; existing `@@index` coverage appears adequate |
| B4 Drift | **PASS** | Latest migration is data-only UPDATE (flex template content); no structural schema drift detected |

### B1 — Timestamp Gaps
**Missing `updatedAt`**: `Customer`, `DunningRule`, `SavingPlanPayment`, `PaymentLink`, `SlipFingerprint`, `FeeWaiverApproval`, `JournalPostAuditLog`, `Promotion`, `PromotionUsage`, `Todo`

**Missing `deletedAt`**: `Customer`, `PromiseSlot`, `DunningRule`, `SavingPlanPayment`, `SlipFingerprint`, `FeeWaiverApproval`, `JournalPostAuditLog`, `Promotion`, `Todo`, `TodoComment`

⚠️ `Customer` missing both `updatedAt` and `deletedAt` is particularly concerning — this is a core business entity. `Promotion` and `Todo` also warrant review. `JournalPostAuditLog` and `SlipFingerprint` may be intentional (audit/immutable) but need `/// Immutable` comments if so.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✓; `MAX_TOOL_ITERATIONS = 5` ✓; Sentry captures present ✓; `maxTokens: 1024` ✓; 30s per-iteration timeout ✓; history window 10 msgs / 20k char budget ✓ |
| C2 Prompt | **OK** | Business hours: Mon–Sat 09:00–18:00 ✓; Phone: 063-134-6356 ✓; Bank: KBank 203-1-16520-5 ✓; Late fee: 50 THB/day ✓; Prohibited words list present ✓; Prompt length ~120 lines (reasonable) |
| C3 Tools | **OK** | 7 tools defined with Thai descriptions ✓; `tool-executor.ts` handles all 7 names (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`) ✓; `customerId` injected by orchestrator (not in schema — customer isolation maintained) ✓ |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` marker ✓; All 6 types covered: T−5, T−3, T−1, T, T+1, T+3 ✓; Sentry capture on both cron jobs ✓; Asia/Bangkok timezone set ✓ |
| C5 Security | **OK** | LIFF controller: uses `LiffTokenGuard` + `@SkipCsrf` (correct — LINE LIFF token auth, not JWT) ✓; Admin controller: `JwtAuthGuard + RolesGuard` with `@Roles` ✓; Webhook dedup via `ProcessedWebhookEvent` ✓; Customer isolation enforced in tool executor ✓ |

---

## Action Items

### P0 — Fix Immediately
1. **A3 Decimal — `customers.service.ts:1100`**: `totalOutstandingThb: Number(outstanding._sum.amountDue ?? 0)` — aggregate on money field loses precision. Use `new Prisma.Decimal(outstanding._sum.amountDue ?? 0)`.
2. **A3 Decimal — `notifications/scheduler.service.ts:119,241,415`**: Sum of `amountDue + lateFee - amountPaid` computed with `Number()`. Precision loss affects collection amounts displayed to customers.

### P1 — Fix This Sprint
3. **B1 Schema — `Customer` model**: Missing `updatedAt` and `deletedAt`. Core entity with no soft-delete is a data integrity risk. Add both fields with migration.
4. **A3 Decimal — `sales/sales.service.ts:286,579`**: `costPrice` cast to `Number()` before COGS calculation. Fix to `Prisma.Decimal`.
5. **A4 Soft-Delete — `reporting/compliance.service.ts`**: Legal compliance queries (Contract, LegalCase) missing `deletedAt: null`. Could surface deleted contracts in reports.
6. **A4 Soft-Delete — `shop-catalog/shop-catalog.service.ts`**: Product queries missing `deletedAt: null` — discontinued products may appear in catalog.

### P2 — Backlog
7. **A5 Tests — `collections-foundation.seed.spec.ts`**: 1 flaky test (DB connection). Add `beforeAll` DB connection guard or mark as integration test requiring live DB.
8. **A6 Bundle — `excel` 929KB raw**: Split `exceljs` further or lazy-load only on export trigger (it's already split from main, but 929KB raw is large for a lazy chunk).
9. **B1 Schema — `Promotion`, `Todo`, `DunningRule`**: Missing `deletedAt`. Add soft-delete support or add `/// No soft-delete — [reason]` comment.
10. **B1 Schema — `JournalPostAuditLog`, `SlipFingerprint`**: If intentionally immutable, add `/// Immutable audit log — updatedAt/deletedAt intentionally omitted` per `database.md` convention.
