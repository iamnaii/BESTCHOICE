# CTO Watchdog Report — 2026-05-20

## Summary
10/15 checks passed — critical issues in API TypeScript compilation (7 errors from missing `@prisma/client-finance` package for SP7 FINANCE DB split), test regression (144 API tests failing, 8 web tests failing), and multiple `Number()` wrapping Decimal fields in newer modules. Security posture is good; chatbot is healthy.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | FAIL | api: 7 errors (all in `prisma-finance.service.ts` / `health.controller.ts` — missing `@prisma/client-finance` package, SP7 FINANCE DB split not yet provisioned); web: 0 errors |
| A2 Security | WARN | No raw SQL found. No token in localStorage (E2E test path only, acceptable). Shop/line/webhook controllers use domain-appropriate guards (ShopBotDefenseGuard, LiffTokenGuard, LineWebhookGuard, HMAC-verified). `web-widget.controller.ts` and `line-login.controller.ts` are intentionally public per code comments. Not documented in `security.md` exclusion list — WARN. |
| A3 Decimal | FAIL | 30+ `Number(.*amount`, `Number(.*price`, `Number(.*cost` hits in production code. Hot spots: `chatbot-finance/services/finance-tools.service.ts` (6 hits), `line-oa/chatbot.service.ts` (5 hits), `customers/customers.service.ts` (1 hit on `_sum`), `sales/sales.service.ts` (2 hits), `staff-chat/services/chat-commerce.service.ts` (3 hits). Most are display/serialisation contexts but some affect calculation logic. |
| A4 Soft-Delete | PASS | All 10 sampled service files include `deletedAt: null` in their `findMany`/`findFirst` queries. `branches.service.ts` uses post-fetch check (`if (!branch \|\| branch.deletedAt)`) for `findUnique` — acceptable pattern. No violations found. |
| A5 Tests | FAIL | API: 3492 passed / 3644 total (144 failed, 8 skipped). Baseline was 577. Total suite is now 3644 (significant growth since baseline). Failing suites: `asset.service.spec.ts`, `other-income` (3 files), `asset-transfer`, `asset-journal`, `asset-reports`, `depreciation.service.spec.ts`, `collections-foundation.seed.spec.ts`, `prisma-finance.service.spec.ts`, `outbox-processor.service.spec.ts`, `health.controller.spec.ts`, `backfill-user-companies.cli.spec.ts`. Root cause for most: `@prisma/client-finance` package not installed + `prisma.fixedAsset` undefined in test environment (FixedAsset model added but Prisma client not regenerated in CI). Web: 516 passed / 524 total (8 failed). Failing: `useAssetCalculation.test.ts` (7 tests — VAT extraction + WHT base routing logic), `AssetsListPage.statcards.test.tsx` (1 test — stat card sum). Baseline was 129; suite has grown to 524. |
| A6 Bundle | WARN | Chunks >500 KB gzip: `excel-Kg_E4bP1.js` (929 KB raw / **256 KB gzip**), `ContractTemplatesPage` (495 KB raw / 148 KB gzip), `pdf-D1VaGV0y.js` (430 KB raw / 139 KB gzip), `charts-DtrQsyEN.js` (417 KB raw / 120 KB gzip), `CollectionsPage` (386 KB raw / 101 KB gzip). No single chunk exceeds 500 KB gzip threshold; all within acceptable range after gzip. `thai-address-data` (870 KB raw / 69 KB gzip) benefits heavily from compression. No critical bundle bloat. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | PASS | All sampled models use UUID `@id @default(uuid())`, `createdAt`/`updatedAt`/`deletedAt` (with documented exceptions for audit logs / tokens / append-only events). Money fields use `@db.Decimal(12, 2)` throughout. `Float` only appears for GPS coordinates, confidence scores, and config thresholds — all appropriate non-financial uses. Enums use PascalCase names, SCREAMING_SNAKE_CASE values. FK fields have `@@index` coverage. |
| B2 Migrations | PASS | 260 migrations total (including `migration_lock.toml` entry). Latest 3: `20260954000000_contract_cancellation` (ADD VALUE to enum — non-destructive), `20260955000000_owner_q1q8_systemconfig_decisions` (no destructive ops), `20260956000000_customer_national_id_nullable` (ALTER COLUMN DROP NOT NULL — safe, nulls permitted on unique index per comment). No DROP TABLE or DROP COLUMN in last 3 migrations. |
| B3 Indexes | PASS | `Payment`, `Contract`, `Customer`, `InstallmentSchedule`, `Refund`, `PurchaseOrder` all have comprehensive FK and status indexes. `Contract` has compound index `(status, deletedAt, branchId)` for common query patterns. `Payment` has compound `(status, dueDate)`. No obvious missing indexes on large models sampled. |
| B4 Drift | PASS | Latest migration (`ALTER COLUMN "national_id" DROP NOT NULL`) matches schema: `Customer.nationalId String? @unique @map("national_id")` — nullable in schema, migration makes it nullable in DB. No mismatch detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | OK | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5`. `maxTokens = 1024`. Sentry captures on both max-iterations and exceptions. 30s per-iteration timeout with AbortController. History window: 10 messages / 20k char budget. All guards present. |
| C2 Prompt | OK | Bank account `203-1-16520-5` (กสิกรไทย / บจก. เบสท์ช้อยส์โฟน) matches `finance-rules.ts` constants exactly. Phone `063-134-6356` matches. Business hours Mon-Sat 09:00-18:00 consistent. Product scope (iPhone/iPad new only) clearly stated. Prompt is well-structured, ~60 lines — not excessively long. Note: system prompt is hardcoded in `system-prompt.ts`; Phase E (DB-backed with admin UI) is deferred. |
| C3 Tools | OK | 7 tools defined in `tool-definitions.ts`: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All 7 handled in `tool-executor.ts` switch cases. Input validation via `validateToolInput` + PII redaction. Input schemas clearly defined with Thai descriptions. |
| C4 Auto-Trigger | OK | Idempotency via `ChatAutoTrigger` table (PENDING/SENT marker checked before send). Reminder types covered: T-5, T-3, T-1, T-Day (09:00 cron), T+1, T+3 (10:00 cron). Sentry captures on cron failures for both `runDailyReminders` and `runDailyEscalations`. |
| C5 Security | OK | LIFF controller uses `LiffTokenGuard` (LINE ID token server-side verification). Admin controller has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level. Webhook dedup via `WebhookDedupService` (checks `webhookEventId` before processing). Customer data isolation: all tool methods receive `customerId` from orchestrator (not from Claude input) and filter `findActiveContract` by `customerId` — AI cannot access other customers' data. |

---

## Action Items

### Critical

1. **[A1/A5] `@prisma/client-finance` package missing** — `apps/api/src/prisma/prisma-finance.service.ts` imports from `@prisma/client-finance` which does not exist. This causes 7 TypeScript errors and cascades to 14 failing test suites (asset, other-income, depreciation, health, outbox, backfill). SP7 FINANCE DB split is scaffolded in code but the secondary Prisma client was never generated/published. Fix: either generate the package with a second `prisma generate` using a separate schema, or guard the import with a conditional until the DB is provisioned.

2. **[A5] Asset module tests broken** — `prisma.fixedAsset` is undefined in test environments (`FixedAsset` model likely added to schema but `@prisma/client` not regenerated in the test environment). 54 asset service tests fail. Fix: run `npx prisma generate` before tests in CI.

3. **[A5] Web asset calculation tests broken** — `useAssetCalculation.test.ts` has 7 failures in VAT extraction and WHT base routing logic. These cover Bug Report v2 items #8 and #9 which appear to have been specced but not yet implemented in `useAssetCalculation.ts`. Fix: implement the VAT extraction and WHT base routing logic per the failing test specs.

### Warnings

4. **[A2] Unregistered public controllers** — `web-widget.controller.ts` (anonymous chat widget) and `line-login.controller.ts` (LINE OAuth fallback) are intentionally public but not listed in `security.md` exclusion list. Low risk since both controllers are non-financial and appropriately scoped, but they should be documented for audit completeness.

5. **[A3] Decimal compliance in newer modules** — 30+ `Number()` wraps on Decimal fields found in `chatbot-finance/services/finance-tools.service.ts`, `line-oa/chatbot.service.ts`, `staff-chat/services/chat-commerce.service.ts`, `sales/sales.service.ts`. Most are display/serialisation but some (e.g., arithmetic in `chatbot.service.ts:151`) affect computed values. Should be migrated to `Prisma.Decimal` arithmetic per the existing hardening convention.

6. **[A6] `excel` chunk 256 KB gzip** — largest chunk after gzip is `excel-Kg_E4bP1.js` at 256 KB. This was split in v3 hardening (saving ~525 KB initial bundle). No chunks exceed 500 KB gzip. Monitor for further growth as new Excel export features are added.

7. **[C2] System prompt is hardcoded** — `FINANCE_BOT_SYSTEM_PROMPT` is a static string in `system-prompt.ts`. Phase E (admin-editable KB via `ChatKnowledgeBase` table) is deferred. Any prompt changes require a code deploy. Low operational risk currently but limits non-developer content updates.

### Notes

- Test count has grown significantly since the v4 baseline: API suite is now 3,644 tests (up from documented 577 — the 577 was an API-only subset count, full suite was always larger). Web suite is 524 (up from 129).
- The `customer_national_id_nullable` migration (latest) is correctly aligned with schema — walk-in customer support feature is safe.
- `ContractStatus.CANCELED` was added via `ADD VALUE` (non-destructive enum extension) — migration is reversible only with pg workarounds, but the value addition itself is safe.
- SHOP accounting (P3-SP5) and Year-End Closing (P3-SP1) features appear well-implemented based on schema and code review; no issues found in those modules.
- All chatbot security controls are in place and functioning correctly.
