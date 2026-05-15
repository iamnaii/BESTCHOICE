# CTO Watchdog Report — 2026-05-15

## Summary
**11/15 checks passed** (2 FAIL · 7 WARN · 6 PASS/OK). Critical action items: A3 Decimal violations (30+ money fields coerced through `Number()`) and A5 API test failures (158 tests, environment root-cause suspected).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in both `apps/api` and `apps/web` (`npx tsc --noEmit`) |
| A2 Security | **WARN** | See details below |
| A3 Decimal | **FAIL** | 30+ `Number()` calls on money fields across 12 services |
| A4 Soft-Delete | **WARN** | Automated scan flagged 25+ service files; some are real, some are immutable models |
| A5 Tests | **FAIL** | API: 2481 pass / 158 fail (11 suites); Web: 305/305 pass |
| A6 Bundle | **WARN** | `excel` chunk 929 KB raw / 256 KB gzip (largest); no chunk exceeds 500 KB gzip limit |

### A2 Security — Details

**Raw SQL (`$queryRaw` / `$executeRaw`):** 30 usages found across 10 files. All are parameterized template literals (no string concatenation). ✅ Safe.

Affected files (reference only): `app.controller.ts`, `journal-auto.service.ts`, `receipts.service.ts`, `customers.service.ts`, `data-audit.service.ts`, `audit.service.ts`, `chatbot-finance/admin-analytics.service.ts`, `chatbot-finance/feedback.service.ts`, `staff-chat/ai-training.service.ts`, `receivable-recon.service.ts`.

**localStorage / sessionStorage:** `apps/web/src/lib/api.ts:10–13` reads `access_token` from localStorage for E2E Playwright support only (guarded). `useLiffInit.ts:62` is a comment. Both are intentional and documented. ✅

**Hardcoded secrets:** `line-oa.controller.ts:141` contains `line_channel_secret: 'LINE Channel Secret'` — this is a placeholder label string in a DTO example, not a real secret. ✅

**Missing JwtAuthGuard:** Grep returned no controllers missing the guard outside of documented public exceptions (chatbot-finance-liff uses `LiffTokenGuard`). ✅

### A3 Decimal — Violations (FAIL)

Files with `Number()` around money fields that should use `Prisma.Decimal`:

| File | Fields coerced |
|------|---------------|
| `chatbot-finance/services/finance-tools.service.ts` | `amountDue`, `amountPaid`, `totalAmount` (5 hits) |
| `line-oa/chatbot.service.ts` | `amountDue`, `amountPaid` (6 hits) |
| `notifications.service.ts` | `amountDue`, `lateFee` (4 hits — display formatters) |
| `staff-chat/services/chat-commerce.service.ts` | `amountDue`, `amountPaid`, `amount` (4 hits) |
| `chatbot-finance/services/auto-trigger.service.ts` | `amountDue`, `amountPaid` |
| `chatbot-finance/services/slip-processing.service.ts` | `amountDue` |
| `sales/sales.service.ts` | `costPrice` (2 hits) |
| `shop-catalog/shop-catalog.service.ts` | `costPrice` (2 hits) |
| `shop-installment-apply/shop-installment-apply.service.ts` | `costPrice` |
| `shop-orders/online-order-sale.adapter.ts` | `totalAmount` |
| `shop-cart/shop-cart.service.ts` | `costPrice` |
| `customers.service.ts` | `totalOutstandingThb` (_sum aggregate) |

**Priority:** Arithmetic usages (finance-tools, chatbot, auto-trigger) are P1 — precision loss affects customer-facing balances. Display-only usages (`toLocaleString`) are P2.

### A5 Tests — Failing Suites

11 suites / 158 tests failing. Root cause: integration tests require a live PostgreSQL connection; the remote container has no DB running (`ECONNREFUSED 127.0.0.1:5432`). Code quality is not the issue.

Affected suites:
- `asset/__tests__/asset.service.spec.ts`
- `asset/__tests__/asset-transfer.service.spec.ts`
- `asset/__tests__/asset-reports.service.spec.ts`
- `asset/__tests__/asset-journal.service.spec.ts`
- `other-income/__tests__/other-income.service.spec.ts`
- `other-income/__tests__/maker-checker.spec.ts`
- `other-income/__tests__/doc-number.service.spec.ts`
- `other-income/__tests__/template.service.spec.ts`
- `depreciation/__tests__/depreciation.service.spec.ts`
- `overdue/__tests__/collections-foundation.seed.spec.ts`
- `chatbot-finance/services/chatbot-finance.service.spec.ts`

**Action:** These tests should be run in CI where `DATABASE_URL` is configured. If the SessionStart hook can provision a test DB, add it. Web (vitest) tests all pass (305/305). ✅

### A6 Bundle — Large Chunks

| Chunk | Raw | Gzip |
|-------|-----|------|
| `excel-BNxyffEB.js` | 929 kB | 256 kB |
| `thai-address-data` | 870 kB | 69 kB |
| `ContractTemplatesPage` | 496 kB | 148 kB |
| `pdf-DoRBsI9W.js` | 430 kB | 139 kB |
| `charts-DtrQsyEN.js` | 417 kB | 119 kB |
| `CollectionsPage` | 386 kB | 101 kB |

No chunk exceeds 500 kB gzip. `excel` chunk is the only concern (256 kB gzip); already split from main bundle per v3 hardening. Vite warns on raw size > 500 kB — consider `build.chunkSizeWarningLimit` or dynamic import for ContractTemplatesPage.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | Float only on non-money fields (GPS, ML confidence); automated model-field audit unreliable (regex breaks on nested `{}`) |
| B2 Migrations | **WARN** | 227 migrations; latest drops/recreates `OtherIncomeStatus` enum (`DROP TYPE`) — intentional (W5) but requires careful prod sequence |
| B3 Indexes | **WARN** | Automated scan: 91 models with candidate missing FK/status indexes |
| B4 Drift | **PASS** | Latest migration matches schema intent (OtherIncomeStatus enum matches schema.prisma) |

### B1 Schema

`Float` fields found (none are money):
- `gpsLatitude`, `gpsLongitude` — GPS coordinates ✅
- `confidence` — AI intent confidence score ✅
- `quality` — document scan quality ✅
- `salesBotConfidenceThreshold`, `serviceBotConfidenceThreshold` — ML thresholds ✅

Decimal check on money fields: no `Float` money fields found. ✅

Model timestamp audit flagged 127 issues (automated parser). The Python regex `r'model \w+ \{([^}]+)\}'` breaks on multi-line attribute expressions with nested `{}`. Results are unreliable — `Customer` being flagged as missing `createdAt` is a false positive. Manual audit recommended for new models added after v4.

### B2 Migrations

- **Count:** 227 (up from 48 at v1 — reflects ~9 months of active development)
- **Latest:** `20260923000000_other_income_drop_approved_enum`
- **Dangerous ops:** `ALTER COLUMN ... DROP DEFAULT` → `DROP TYPE "OtherIncomeStatus"` → `CREATE TYPE "OtherIncomeStatus_new"` → rename. Documented with `-- W5:` comment. Safe if run on test DB first, but Postgres cannot add enum values back — this is a one-way migration.

### B3 Indexes

Top-priority missing indexes identified by automated scan:

| Model | Missing FK Indexes |
|-------|--------------------|
| `User` | `nationalId`, `lineId`, `employeeId` |
| `Customer` | `nationalId` |
| `Contract` | `productId`, `reviewedById`, `interestConfigId` |
| `Repossession` | `contractId`, `productId`, `appraisedById` |
| `DunningAction` | `dunningRuleId`, `paymentId` |
| `Sale` | `contractId`, `onlineOrderId` |
| `GoodsReceivingItem` | `productId` (+ status) |
| `OnlineOrder` | `productId`, `reservationId` |

Note: automated detection has false positives (fields not used in WHERE clauses may not need indexes). Triage before adding — unnecessary indexes slow writes.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | `claude-sonnet-4-6`, MAX_TOOL_ITERATIONS=5, Sentry present, maxTokens=1024 |
| C2 Prompt | **OK** | Business hours, phone, bank account correct; no contradictions; ~3 kB |
| C3 Tools | **OK** | 7 tools defined; tool-executor.ts handles all 7 in switch — perfect 1:1 match |
| C4 Auto-Trigger | **OK** | ChatAutoTrigger idempotency marker; T-5/T-3/T-1/T/T+1/T+3 all covered; Sentry on both crons |
| C5 Security | **OK** | LIFF uses LiffTokenGuard; admin uses JwtAuthGuard+RolesGuard; dedup via DB unique constraint; customerId injected by orchestrator (AI cannot cross-access) |

### C1 AI Service — Detail

```
model:          claude-sonnet-4-6  ✅ (current)
MAX_TOOL_ITERS: 5                  ✅
maxTokens:      1024               ✅
Sentry import:  present            ✅
error handling: try/catch + Sentry.captureException  ✅
history window: 10 messages / 20k char budget  ✅
```

### C2 Prompt — Key Values

| Field | Value in Prompt |
|-------|-----------------|
| Phone | 063-134-6356 |
| Bank | ธนาคารกสิกรไทย 203-1-16520-5 บจก. เบสท์ช้อยส์โฟน |
| Hours | จันทร์-เสาร์ 09:00-18:00 |
| Late fee | 50 บาท/วัน |
| Products | iPhone มือ1/มือ2 + iPad มือ1 เท่านั้น |

No contradictions with `finance-rules.ts` constants. Prompt is DB-cacheable (Phase E planned). ✅

### C3 Tools — Coverage

| Tool Name | Executor Handled |
|-----------|-----------------|
| `get_current_balance` | ✅ |
| `get_payment_schedule` | ✅ |
| `calculate_fine` | ✅ |
| `list_recent_receipts` | ✅ |
| `get_bank_info` | ✅ |
| `search_knowledge_base` | ✅ |
| `handoff_to_human` | ✅ |

### C4 Auto-Trigger — Coverage

| Type | Cron | Enum Value |
|------|------|-----------|
| T-5 | 09:00 | `REMINDER_T_MINUS_5` ✅ |
| T-3 | 09:00 | `REMINDER_T_MINUS_3` ✅ |
| T-1 | 09:00 | `REMINDER_T_MINUS_1` ✅ |
| T | 09:00 | `REMINDER_T_DAY` ✅ |
| T+1 | 10:00 | `ESCALATION_T_PLUS_1` ✅ |
| T+3 | 10:00 | `ESCALATION_T_PLUS_3` ✅ |

---

## Action Items

### P0 — Fix Immediately

1. **[A3] Decimal violations in finance-tools, auto-trigger, chatbot** — `Number(amountDue)` / `Number(amountPaid)` in arithmetic paths loses precision. Replace with `Prisma.Decimal` arithmetic or `.toNumber()` only at display boundary.
   - Files: `chatbot-finance/services/finance-tools.service.ts`, `auto-trigger.service.ts`, `line-oa/chatbot.service.ts`

### P1 — Fix This Sprint

2. **[A5] API integration tests need DB** — 158 tests fail because the remote container has no PostgreSQL. Options: (a) add DB to SessionStart hook, or (b) tag integration tests and skip in no-DB environments. CI/CD likely has DB and these pass there — confirm.
   - Verify: `npm run test:ci` in GitHub Actions passes all 11 failing suites.

3. **[A3] Decimal violations in sales, shop-catalog, notifications** — `Number(costPrice)`, `Number(amountDue)` in service logic. Lower-risk than P0 (mostly display or catalog pricing) but still imprecise.
   - Files: `sales/sales.service.ts`, `shop-catalog/shop-catalog.service.ts`, `notifications.service.ts`

### P2 — Schedule

4. **[B3] Add missing indexes** — Priority: `Customer.nationalId`, `User.nationalId` (search hot path), `Contract.productId`, `Repossession.contractId`. Run `EXPLAIN ANALYZE` first to confirm actual query plans.

5. **[B2] Migration review** — Document the enum DROP/CREATE sequence in the deploy runbook (`docs/guides/DEPLOY.md`). Add a pre-deploy step to back up `other_income` table before running this migration in production.

6. **[A6] ContractTemplatesPage chunk size** — At 496 kB raw / 148 kB gzip this page is near the warning threshold. Consider lazy-loading the PDF template editor sub-component.

### P3 — Backlog / Monitor

7. **[A4] Soft-delete audit** — The automated scan is imprecise (immutable models like `SystemConfig`, `RefreshToken`, `ChartOfAccount` correctly omit `deletedAt`). Do a targeted manual pass on newly added services from v5+ (`promise.service.ts`, shop-related services) to confirm they include `deletedAt: null` filters.

8. **[B1] Schema model-field audit** — Replace the regex-based parser with a Prisma DMMF dump (`npx prisma format && npx ts-node -e "const {PrismaClient} = require('@prisma/client'); ..."`) for accurate model introspection. Current 127-issue report is unreliable.
