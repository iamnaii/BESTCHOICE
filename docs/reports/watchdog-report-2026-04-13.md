# CTO Watchdog Report — 2026-04-13

## Summary
10/15 checks passed — 5 warnings (no failures). Key issues: Decimal Number() leaks in 8 services, model version stale (sonnet-4-5 → upgrade to 4-6), 2 public controllers undocumented in security.md whitelist.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in apps/api, 0 errors in apps/web |
| A2 Security | **WARN** | 2 controllers not in security.md whitelist (see below) |
| A3 Decimal | **WARN** | 30+ `Number()` casts on money fields across 8 services |
| A4 Soft-Delete | **WARN** | ~15 `findMany`/`findFirst` missing `deletedAt: null` |
| A5 Tests | **PASS** | API: 751 (↑ from 577 baseline), Web: 143 (↑ from 129 baseline) |
| A6 Bundle | **PASS** | All chunks ≤ 256 KB gzip (excel: 256 KB, ReceiptModal: 226 KB, pdf: 139 KB) |

### A2 Security Details

**Raw SQL (`$queryRaw`/`$executeRaw`)** — 35 usages found, all use Prisma template literals (parameterized by default). **Safe.**

**localStorage token** — `apps/web/src/lib/api.ts:10` reads from localStorage **only** when `access_token` key is present (E2E Playwright injection, removed immediately after read). **Safe, documented.**

**Hardcoded secrets** — None found. All secrets via `ConfigService`/`process.env`.

**Controllers missing `@UseGuards(JwtAuthGuard)` that are NOT in security.md whitelist:**

| Controller | Auth Used | Risk |
|------------|-----------|------|
| `line-oa/line-oa-chatbot.controller.ts` | `@UseGuards(LineWebhookGuard)` on each method | Low — webhook verified by LINE signature |
| `line-oa/liff-api.controller.ts` | `@UseGuards(LiffTokenGuard)` at class level | Low — LIFF token verified |
| `line-oa/line-login.controller.ts` | None (OAuth redirect flow) | Low — read-only OAuth state exchange |
| `staff-chat/web-widget.controller.ts` | None (anonymous chat widget) | Medium — no visitor auth; visitorId is UUID-only |

**Action**: Update `security.md` whitelist to document these 4 intentionally-public endpoints. The `web-widget` endpoint may warrant rate-limiting review.

### A3 Decimal Details

`Number()` casts on money fields found in production code (not display-only):

| File | Lines | Issue |
|------|-------|-------|
| `accounting/bad-debt.service.ts` | 91, 245 | `Number(p.amountDue) - Number(p.amountPaid)` in aging calc |
| `contracts/contract-payment.service.ts` | 62, 139, 148 | Payment balance calculations |
| `chatbot-finance/auto-trigger.service.ts` | 169 | Reminder amount calculation |
| `chatbot-finance/finance-tools.service.ts` | 53–54, 108, 111, 127, 173 | Balance/schedule display to customer |
| `exchange/exchange.service.ts` | 66, 76, 81, 82, 137 | Trade-in difference calculation |
| `asset/asset.service.ts` | 173, 214, 340 | Depreciation calculations |

Display-only `Number().toLocaleString()` in `documents.service.ts:782,1096` — acceptable for template rendering.

### A4 Soft-Delete Details

Services with high-risk `findMany`/`findFirst` missing `deletedAt: null`:

| Service | Concern |
|---------|---------|
| `accounting/accounting.service.ts:107` | `prisma.branch.findMany` — no deletedAt filter |
| `accounting/accounting.service.ts:418,452` | `expense.findMany` — no deletedAt filter |
| `asset/asset.service.ts:86` | `fixedAsset.findMany` — no deletedAt filter |
| `accounting/bad-debt.service.ts:67` | `payment.findMany` — no deletedAt (has contract join) |

Note: `auth.service.ts` queries on `RefreshToken`/`PasswordResetToken` are fine (those models have no `deletedAt` by design).

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | Timestamp gaps on 28 models; deletedAt missing on 20 models |
| B2 Migrations | **PASS** | 100 migrations, latest name descriptive; no DROP TABLE |
| B3 Indexes | **PASS** | 287 indexes; Payment/Contract/Product FKs + status fields covered |
| B4 Drift | **PASS** | Latest migration (`add_data_audit_log`) matches `DataAuditLog` model in schema |

### B1 Schema Details

**No UUID violations** — all models use `@id @default(uuid())`. ✅  
**No Float money fields** — 100% `@db.Decimal(12,2)`. ✅

**Missing `updatedAt`** (28 occurrences across newer models):

> Customer, CustomerAccessToken, DocumentAuditLog, PaymentLink, Promotion, PromotionUsage, Todo, CustomerLineLink, ChatMessage, ChatAutoTrigger, ChatbotOtpRequest, WebhookDelivery, ProcessedWebhookEvent, ConversationTag, StaffChatActivity, ChatSnooze, ChatSideMessage, AdsAttribution, CrmNote, CustomerScore, DataAuditLog *(+ 7 more)*

**Missing `deletedAt`** (20 models):

> AuditLog *(intentional — immutability W-011)*, PasswordResetToken, InviteToken, CustomerAccessToken, DocumentAuditLog, Promotion, Todo, ChatAutoTrigger, ChatbotOtpRequest, ChatKbSuggestion, WebhookDelivery, ProcessedWebhookEvent, ConversationTag, StaffChatActivity, ChatSnooze, AdsAttribution, CrmNote, CustomerScore, DataAuditLog

Most of these are event/log tables (expected), but `Promotion`, `Todo`, `CustomerScore`, and `CrmNote` are business entities that should have `deletedAt`.

### B2 Migration Details

- Total: **100 migrations**
- Latest: `20260416000000_add_data_audit_log` — creates `data_audit_logs` table with proper indexes
- `ALTER TYPE … ADD VALUE` (safe additive enums): PaymentMethod, UserRole, ChatChannel
- `DROP COLUMN IF EXISTS` (safe): `wht_income_type` in 20260407 (obsolete field)
- `DROP updated_at` on `audit_logs` (20260415): documented deliberate W-011 immutability decision
- No `DROP TABLE`, no destructive `ALTER TYPE … RENAME`

### B3 Index Coverage

287 total indexes. All high-traffic FK columns covered:

- `Payment`: `contractId`, `status`, `dueDate`, `(status, dueDate)` ✅
- `Contract`: `customerId`, `branchId`, `status`, `(status, deletedAt, branchId)` ✅
- `Product`: `branchId`, `status`, `(branchId, status)` ✅
- `ChatSession`: `status`, `(status, channel)`, `(status, nextRetryAt)` ✅
- `NotificationLog`: `(status, channel)` ✅

No missing critical indexes detected.

### B4 Schema Drift

Latest migration SQL creates `data_audit_logs` table with columns matching `DataAuditLog` model in `schema.prisma`. No drift detected.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **WARN** | Model `claude-sonnet-4-5-20250514` is stale — upgrade to `claude-sonnet-4-6` |
| C2 Prompt | **PASS** | Bank acct, phone, hours correct; ~1,200 tokens; no contradictions |
| C3 Tools | **PASS** | 7 tools defined, all 7 handled in tool-executor; Thai descriptions present |
| C4 Auto-Trigger | **PASS** | Idempotency via unique constraint + P2002 catch; T-5/T-3/T-1/T/T+1/T+3 covered; Sentry on cron errors |
| C5 Security | **PASS** | LIFF: rate-limited (30/min); Admin: JwtAuthGuard+RolesGuard; webhook dedup: DB-based ProcessedWebhookEvent; customerId injected by orchestrator (AI cannot spoof) |

### C1 AI Service Details

```
Current:  claude-sonnet-4-5-20250514
Expected: claude-sonnet-4-6  (released after knowledge cutoff — latest Sonnet)
```

- `MAX_TOOL_ITERATIONS = 5` guard present ✅
- Sentry capture on `captureMessage` (max iterations) + `captureException` (errors) ✅
- `maxTokens = 1024` — reasonable for short customer replies ✅
- `historyLimit = 20` — prevents context explosion ✅

### C2 Prompt Details

System prompt (`prompts/system-prompt.ts`, 67 lines ≈ 1,200 tokens):
- Bank: `ธนาคารกสิกรไทย 203-1-16520-5 บจก. เบสท์ช้อยส์โฟน` ✅
- Phone: `063-134-6356` ✅ (matches `finance-rules.ts`)
- Hours: `จันทร์-เสาร์ 09:00-18:00` ✅ (matches `finance-rules.ts`)
- Late fee: `50 บาท/วัน` ✅ (matches `LATE_FEE_PER_DAY = 50`)

No contradictions detected between prompt and constants.

### C3 Tools Details

| Tool | Executor Case | Thai Description |
|------|--------------|-----------------|
| `get_current_balance` | ✅ | ✅ |
| `get_payment_schedule` | ✅ | ✅ |
| `calculate_fine` | ✅ | ✅ |
| `list_recent_receipts` | ✅ | ✅ |
| `get_bank_info` | ✅ | ✅ |
| `search_knowledge_base` | ✅ | ✅ |
| `handoff_to_human` | ✅ | ✅ |

All 7/7 tools covered. `customerId` not exposed in tool schemas — injected by orchestrator. ✅

### C4 Auto-Trigger Details

- Idempotency: `@@unique([customerId, referenceKey])` + `P2002` catch → safe concurrent/retry ✅
- Schedule: `0 9 * * *` (T-5, T-3, T-1, T) + `0 10 * * *` (T+1, T+3) — all 6 types covered ✅
- Timezone: `Asia/Bangkok` ✅
- Sentry capture on `runDailyReminders` and `runDailyEscalations` errors ✅

### C5 Security Details

- LIFF controller: `@Throttle({ short: { ttl: 60000, limit: 30 } })` — no JwtAuthGuard (LINE trust boundary) ✅
- Admin controller: `@UseGuards(JwtAuthGuard, RolesGuard)` ✅
- Webhook replay prevention: `ProcessedWebhookEvent` DB table with TTL cleanup ✅
- Customer data isolation: `customerId` passed from orchestrator → tool executor; AI cannot override ✅

---

## Action Items

### Priority 1 — Critical (fix within sprint)

1. **[A3] Decimal Number() in calculation paths** — `bad-debt.service.ts:91,245`, `contract-payment.service.ts:62,139,148`, `exchange.service.ts:137`, `auto-trigger.service.ts:169`. Replace with `Prisma.Decimal` arithmetic or `new Decimal(x)`. Risk: floating-point rounding errors in payment amounts.

### Priority 2 — High (fix this week)

2. **[C1] Upgrade AI model** — Change `modelSonnet = 'claude-sonnet-4-5-20250514'` → `'claude-sonnet-4-6'` in `finance-ai.service.ts:36`. Better capability, newer safety training.

3. **[A2] Update security.md whitelist** — Add `line-oa-chatbot`, `liff-api`, `line-login`, `web-widget` to the intentionally-public list with justification. Prevents future confusion and security audits flagging them incorrectly.

4. **[B1] Add deletedAt to business entities** — `Promotion`, `Todo`, `CustomerScore`, `CrmNote` should support soft-delete. Add `deletedAt DateTime?` + migration.

### Priority 3 — Medium (next sprint)

5. **[A4] Fix soft-delete gaps** — Add `deletedAt: null` filter to `branch.findMany` (accounting.service.ts:107), `expense.findMany` (lines 418, 452), `fixedAsset.findMany` (asset.service.ts:86).

6. **[B1] Add missing timestamps** — `ChatMessage`, `ChatAutoTrigger`, `Promotion`, `Todo`, `CustomerLineLink`, `ProcessedWebhookEvent` missing `updatedAt`. Add via migration.

7. **[A3] Decimal in display paths (finance-tools.service.ts)** — `Number()` calls before sending amounts to customer chat. Low risk (display only) but inconsistent with Decimal policy.

### Priority 4 — Low (backlog)

8. **[A4] web-widget rate-limit review** — Anonymous web chat widget has no per-visitor rate limit beyond global ThrottlerGuard (200 req/s). Consider per-visitorId throttling for abuse prevention.

9. **[A6] Bundle watch** — `ReceiptModal` (226 KB gzip) and `excel` (256 KB gzip) are large. Monitor growth; if either exceeds 300 KB gzip consider further code-splitting.
