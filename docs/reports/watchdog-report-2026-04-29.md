# CTO Watchdog Report — 2026-04-29

## Summary
9/15 checks PASS, 6 WARN, 0 FAIL — system is healthy with minor tech-debt items to address.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | PASS | 0 errors in `apps/api`, 0 errors in `apps/web` |
| A2 Security | WARN | See notes below |
| A3 Decimal | WARN | 7 `Number()` usages in arithmetic on money fields |
| A4 Soft-Delete | PASS | No `findMany`/`findFirst` without `deletedAt: null` found |
| A5 Tests | WARN | API: 2148 passed, 1 failed (DB connection); Web: 222 passed |
| A6 Bundle | WARN | No chunk >500 KB gzip, but Vite warns on 5 raw chunks >500 KB |

### A2 Security Details

**PASS items:**
- No controllers missing `@UseGuards(JwtAuthGuard)` — all 106 modules checked clean.
- No raw `$queryRaw`/`$executeRaw` found.
- No hardcoded secrets detected.

**WARN — localStorage (E2E test path):**
```
apps/web/src/lib/api.ts:10  localStorage.getItem('access_token')
apps/web/src/lib/api.ts:13  localStorage.removeItem('access_token')
```
This is an intentional Playwright test-support path gated by the presence of the key. The code comment documents it, the token is removed immediately after reading, and production builds don't inject it. Low risk but worth reviewing if the E2E scaffolding ever runs in a non-test context.

### A3 Decimal Details

Confirmed `Number()` calls on Decimal money fields in arithmetic (not just serialization):

| File | Lines | Risk |
|------|-------|------|
| `staff-chat/services/chat-commerce.service.ts` | 106–108 | `Number(amountDue) + Number(lateFee) - Number(amountPaid)` — float arithmetic |
| `sales/sales.service.ts` | 286, 579 | `costPrice = Number(product.costPrice)` — used in downstream calc |
| `sales/sales.service.ts` | 452, 628 | `Number(rule.rate)` — rate multiplication |
| `line-oa/chatbot.service.ts` | 150, 214 | `reduce` sum via `Number()` — display only, lower risk |
| `stickers/stickers.service.ts` | 67–68 | Label display only |

`.toNumber()` on already-computed `Prisma.Decimal` accumulators (inter-company, sales aggregates) is acceptable for JSON serialization. The four `sales.service.ts` / `chat-commerce.service.ts` cases should be migrated to `Prisma.Decimal` arithmetic.

### A5 Tests Details

- API: **2148 passed, 1 failed** (↑ from v4 baseline of 577 — significant growth post-v5)
  - Failing: `collections-foundation.seed.spec.ts` — `ECONNREFUSED 127.0.0.1:5432` (PostgreSQL not running in watchdog environment; not a code defect)
- Web Vitest: **222 passed** (↑ from v4 baseline of 129; 24 suites)

### A6 Bundle Details

No chunk exceeds **500 KB gzip** (the hard threshold). Vite warns on raw sizes:

| Chunk | Raw | Gzip |
|-------|-----|------|
| `excel-CEk_snjn.js` | 929 KB | **256 KB** |
| `thai-address-data-Di1pvpTU.js` | 870 KB | 69 KB |
| `ContractTemplatesPage-Bc3URzYX.js` | 495 KB | 148 KB |
| `pdf-CUoUUNcu.js` | 430 KB | 139 KB |
| `charts-VDTR8gCM.js` | 417 KB | 119 KB |

Excel chunk (256 KB gzip) is the only one worth monitoring. ContractTemplatesPage (148 KB gzip, 495 KB raw) may benefit from further code-splitting.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | WARN | Some models missing `createdAt`/`deletedAt`; Float only for GPS/AI confidence |
| B2 Migrations | PASS | 185 migrations; latest descriptive; `ALTER TYPE` adds values only |
| B3 Indexes | WARN | 5 large models missing `@@index` including `Customer` |
| B4 Drift | PASS | Latest migration aligns with schema; Decimal(12,2) correct for money fields |

### B1 Schema Details

**Money fields**: All financial Decimal fields correctly use `@db.Decimal(12, 2)`. `Float` appears only for GPS coordinates (`gpsLatitude`, `gpsLongitude`), AI confidence scores, and bot threshold settings — all acceptable.

**Models with missing `createdAt`** (flagged by checker, likely legitimately documented exceptions):
- `ProcessedWebhookEvent`, `BroadcastMessage`, `BroadcastApproval`, `WebhookDelivery` — append-only / immutable; OK per database rules
- `AiSettings`, `SmsTemplate` — config tables, should have `createdAt`; investigate
- `Customer` — parser false-positive (model body spans more lines than regex captured; confirmed Customer has `createdAt` via schema review)

**Models with missing `deletedAt`** (53 flagged):
- Legitimate exceptions (AuditLog, PasswordResetToken, ChatbotOtpRequest, ProcessedWebhookEvent, etc.) — covered by database rules
- `PromiseSlot`, `SavingPlanPayment`, `CrmNote`, `TodoComment` — new models, may need `deletedAt` review
- `FeeWaiverApproval` — approval record, investigate whether soft-delete is needed

### B2 Migration Details

- Total: **185 migrations** (including `migration_lock.toml`)
- Latest: `20260612000000_add_promise_lifecycle` — descriptive ✓
- `ALTER TYPE` usage: all are `ADD VALUE IF NOT EXISTS` (safe, additive)
- One `DROP COLUMN` in `20260415000000_fix_remaining_schema_drift_d785a10`: drops `updated_at` from `audit_logs` — intentional (immutable audit log pattern)

### B3 Index Details

Models with >10 fields, FK relations, and **no `@@index`**:

| Model | Fields | Impact |
|-------|--------|--------|
| `Customer` | 25 | High — queried constantly by phone, nationalId, branchId |
| `CompanyInfo` | 29 | Medium — mostly config reads |
| `ProductPhoto` | 15 | Medium — queried by productId |
| `CustomerScore` | 12 | Low — periodic reads |
| `Todo` | 11 | Low — internal tool |

`Customer` is the highest priority — it lacks a compound index on `(branchId, deletedAt)` and `(phone)` which are used in every customer lookup.

### B4 Drift Details

Latest migration (`20260612000000_add_promise_lifecycle`) matches schema.prisma:
- `promise_slots` table: `settlement_amount DECIMAL(12,2)`, `paid_amount DECIMAL(12,2)` ✓
- `kept_promise_count` on contracts ✓
- Promise lifecycle columns on `call_logs` ✓

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | OK | claude-sonnet-4-6, MAX_TOOL_ITERATIONS=5, 30s timeout, Sentry on limit |
| C2 Prompt | OK | Correct bank/phone/hours/fee; clean rules; ~2 KB, well within token budget |
| C3 Tools | OK | 7 tools, Thai descriptions, input validation, PII redaction |
| C4 Auto-Trigger | OK | All 6 reminder types (T-5..T+3), idempotency via ChatAutoTrigger, Sentry on error |
| C5 Security | OK | LIFF uses LiffTokenGuard; admin uses JwtAuthGuard+RolesGuard; customerId injected server-side |

### C1 AI Service Details
- Model: `claude-sonnet-4-6` (current ✓)
- `MAX_TOOL_ITERATIONS = 5` guard present ✓
- Per-iteration `timeout: 30_000` ms ✓
- Sentry `captureMessage` on max iterations reached ✓
- `maxTokens: 1024` ✓
- Prompt caching with `cache_control: { type: 'ephemeral' }` ✓
- History window: 10 messages, 20K char budget ✓

### C2 Prompt Details
- Bank: ธนาคารกสิกรไทย 203-1-16520-5 ✓
- Phone: 063-134-6356 ✓
- Hours: จันทร์-เสาร์ 09:00-18:00 ✓
- Late fee: 50 บาท/วัน ✓
- Forbidden words mapped to euphemisms ✓
- Handoff rules clearly defined ✓
- Note: Phase E (DB-backed prompt editing via UI) still pending

### C3 Tool Details
All 7 tools present with valid schemas: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. Tool executor validates input via `validateToolInput` + redacts PII in Sentry logs before logging rejected inputs.

### C4 Auto-Trigger Details
- Cron 09:00 covers: T-5, T-3, T-1, T (REMINDER types) ✓
- Cron 10:00 covers: T+1, T+3 (ESCALATION types) ✓
- Idempotency: checks `ChatAutoTrigger` record before sending ✓
- Sentry `captureException` on each cron failure ✓

### C5 Security Details
- `chatbot-finance-liff.controller.ts`: `@UseGuards(LiffTokenGuard)` — LIFF token verified, not a bare public endpoint ✓
- `chatbot-finance-admin.controller.ts`: `@UseGuards(JwtAuthGuard, RolesGuard)` ✓
- `chatbot-finance.controller.ts` webhook: `@UseGuards(LineFinanceWebhookGuard)` (per-endpoint) ✓
- `customerId` injected by orchestrator from session context — Claude cannot override it ✓
- Tool input validated and PII redacted before Sentry logging ✓

---

## Action Items

### Priority 1 — Fix (within 1 sprint)

1. **[A3] Decimal arithmetic in `chat-commerce.service.ts:106-108`** — Replace `Number(amountDue) + Number(lateFee) - Number(amountPaid)` with `Prisma.Decimal` arithmetic to prevent precision drift on payment calculations.

2. **[A3] Decimal arithmetic in `sales.service.ts:286,452,579,628`** — `Number(product.costPrice)` and `Number(rule.rate)` feed into commission and cost calculations. Migrate to `new Prisma.Decimal(product.costPrice)`.

3. **[B3] Add `@@index` to `Customer` model** — Add `@@index([branchId, deletedAt])` and `@@index([phone])`. This model is queried on every page and currently has no indexes beyond the PK and `nationalId` unique constraint.

### Priority 2 — Investigate (within 2 sprints)

4. **[B1] Confirm `deletedAt` coverage for new v5 models** — `PromiseSlot`, `SavingPlanPayment`, `CrmNote`, `TodoComment`, `FeeWaiverApproval` were added without `deletedAt`. Decide whether each needs soft-delete or qualifies as an exception (document in schema with `///` comment).

5. **[B3] Add `@@index` to `ProductPhoto` and `CompanyInfo`** — Lower traffic than Customer but still worth compound indexes on FK fields.

6. **[A5] Fix `collections-foundation.seed.spec.ts`** — Either mock Prisma in this seed test or tag it as `@integration` so it's skipped when no DB is available (prevents false red in CI without a live DB).

### Priority 3 — Monitor

7. **[A6] Excel chunk size** — `excel-CEk_snjn.js` is 256 KB gzip. If user base grows on slow connections, consider lazy-loading the ExcelJS import only when export is triggered.

8. **[A2] E2E localStorage path** — The `localStorage.getItem('access_token')` in `api.ts` is low risk but should be removed when Playwright test scaffolding moves to a proper auth fixture approach.

9. **[C2] Phase E prompt migration** — Move `FINANCE_BOT_SYSTEM_PROMPT` from hardcoded `system-prompt.ts` to `ChatKnowledgeBase` table so admin can edit via UI without deploys (already planned, tracking completion).
