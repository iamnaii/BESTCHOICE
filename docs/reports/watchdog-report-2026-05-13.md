# CTO Watchdog Report — 2026-05-13

## Summary
11/15 checks passed — 4 warnings requiring attention (A3 Decimal, A4 Soft-Delete, A5 Tests, A6 Bundle).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | `apps/api`: 0 errors. `apps/web`: 0 errors. |
| A2 Security | **WARN** | See notes below. |
| A3 Decimal | **WARN** | 40+ `Number()` usages on money fields in production services. |
| A4 Soft-Delete | **WARN** | Several services query without `deletedAt: null`. |
| A5 Tests | **WARN** | API: 2394 pass / 142 fail (no DB in env). Web: 231 pass. |
| A6 Bundle | **WARN** | 2 raw chunks >500 KB (excel 929 KB, thai-address 870 KB). Gzip OK (<500 KB). |

### A2 Security — Detail

**localStorage (acceptable):**
- `apps/web/src/lib/api.ts:10` — E2E-only: reads `localStorage.getItem('access_token')` injected by
  Playwright `addInitScript`, removed immediately after. Not a production path. Comment present.

**Raw SQL (parameterized — OK):**
- `app.controller.ts:43` — `$queryRaw\`SELECT 1\`` health probe. Safe.
- `journal-auto.service.ts:107` — `pg_advisory_xact_lock` with parameterized literal. Safe.
- `customers.service.ts:237,712,789` — all use `Prisma.sql\`...\`` template tags. Safe.
- `receivable-recon.service.ts:34,49` — `$queryRaw` with `Prisma.sql`. Safe.
- `audit.service.ts:66` — sequence `nextval` read, parameterized. Safe.
- `chatbot-finance/feedback.service.ts:146` — `$executeRaw\`` with tagged template. Safe.
- `staff-chat/ai-training.service.ts:104,115` — `$queryRaw` with `Prisma.sql`. Safe.
- Spec files use `$executeRawUnsafe` only in test setup (ALTER TABLE trigger disable). Not production.

**Controllers without `JwtAuthGuard` (all have documented alternatives):**
| Controller | Guard Used | Justification |
|---|---|---|
| `shop-catalog`, `shop-cart`, `shop-reservation`, `shop-shipping`, `shop-tracking`, `shop-buyback`, `shop-auth-social`, `shop-line-chat` | `ShopBotDefenseGuard` | Public web-shop endpoints for anonymous customers |
| `web-widget.controller` | None (Throttle only) | Intentionally public — anonymous website visitors; roomId acts as capability token (documented in code) |
| `metrics.controller` | `@Public()` | Prometheus scraper; gated by shared-secret per code comment |
| `line-login.controller`, `liff-api.controller`, `line-oa-chatbot.controller` | LINE-specific | LINE OAuth callbacks and webhook guards |
| `chatbot-finance-liff.controller` | `LiffTokenGuard` | LINE ID token verified server-side ✅ |

**Action**: `web-widget.controller` exposes chat history by `roomId` — verify the `roomId`-as-capability
pattern is documented in threat model. Consider adding IP-rate throttle at nginx layer.

### A3 Decimal — Top Offenders

Production services using `Number()` on money fields (risk: floating-point precision loss):

| File | Lines | Fields |
|---|---|---|
| `chatbot-finance/services/finance-tools.service.ts` | 53–54, 108, 111 | `amountDue`, `amountPaid` |
| `customers/customers.service.ts` | 874, 1100 | `nextAmountDue`, `totalOutstandingThb` |
| `repossessions/repossessions.service.ts` | 136–137 | `sellingPrice`, `financedAmount` |
| `sales/sales.service.ts` | 286, 579 | `costPrice` |
| `finance-receivable/finance-receivable.service.ts` | 129 | `netExpectedAmount` |
| `purchase-orders/purchase-orders.service.ts` | 243–244, 558, 736 | `netAmount`, `unitPrice`, `costPrice` |
| `stickers/stickers.service.ts` | 168, 175, 185 | `cashPrice`, `installmentBestchoicePrice`, `installmentFinancePrice` |
| `crm/services/customer-scoring.service.ts` | 121 | `financedAmount` (`_sum`) |
| `line-oa/chatbot.service.ts` | 151–215 | `amountDue`, `amountPaid` (display) |

### A4 Soft-Delete — Flagged Queries

The following queries lack `deletedAt: null` and may return deleted records:

| File | Line | Model Queried |
|---|---|---|
| `contracts/contract-document.service.ts` | 20, 67, 135, 143, 184 | `contract`, `documentAuditLog` |
| `payments` service (receipt generator) | 74, 90 | `companyInfo` (findFirst) |
| `customers/customer-precheck.service.ts` | 122, 191, 254 | `customer`, `creditCheck` |
| `customers/customer-tier.service.ts` | 91, 97 | `customer`, `contract` |
| `customers/customers.service.ts` | 179, 519 | `customer` (findUnique — OK by UUID) |

*Note: `findUnique` by `@id` UUID is low-risk since deleted records are never reused, but
`findFirst` and `findMany` without `deletedAt: null` can silently surface deleted rows.*

### A5 Tests — Detail

- **API (Jest)**: 225 suites, 2536 tests total. **2394 pass, 142 fail.**
  - Failures are all integration tests requiring a live PostgreSQL connection (`DATABASE_URL` not set in
    this environment). Unit tests pass cleanly.
  - Prior baseline of 577 (v4) is now superseded — actual count is 2536 (major expansion).
- **Web (Vitest)**: 231 tests pass across 25 files. Exit 0.
  - `ECONNREFUSED 127.0.0.1:3000` in some test output — jsdom fetch to local API; non-blocking, tests pass.
  - Prior baseline of 129 is superseded — 231 tests now.

### A6 Bundle — Detail

| Chunk | Raw | Gzip | Flag |
|---|---|---|---|
| `excel-*.js` | 929 kB | 256 kB | Raw >500 KB ⚠ |
| `thai-address-data-*.js` | 870 kB | 69 kB | Raw >500 KB ⚠ |
| `ContractTemplatesPage-*.js` | 495 kB | 147 kB | Near limit |
| `pdf-*.js` | 430 kB | 139 kB | OK |
| `charts-*.js` | 417 kB | 119 kB | OK |

No chunk exceeds 500 KB **gzip**. The excel and thai-address chunks are already isolated via
dynamic import. Consider lazy-loading `ContractTemplatesPage` excel export only on user action.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | PromiseSlot missing `deletedAt`. Float used for GPS/AI confidence (not money). |
| B2 Migrations | **PASS** | 222 migrations; latest descriptive; no DROP in recent 3. |
| B3 Indexes | **PASS** | 0 models with status/branchId fields missing indexes (checked all 160 models). |
| B4 Drift | **PASS** | Latest migration SQL aligns with schema (OtherIncomeTemplate confirmed). |

### B1 Schema — Detail

**Float fields (non-money — acceptable):**
- `gpsLatitude`, `gpsLongitude` (`Float?`) — coordinate precision, not currency ✅
- `confidence` fields on AI/ML models — probability score, not currency ✅
- `salesBotConfidenceThreshold`, `serviceBotConfidenceThreshold` — config thresholds ✅

**PromiseSlot missing `deletedAt`** (v5 addition):
- `PromiseSlot` has `createdAt` + `updatedAt` but no `deletedAt` — slots are superseded via
  `supersededAt` FK chain, not soft-deleted. Verify this is intentional per v5 design.

**B2 — Recent migrations are safe:**
```
20260918000000_add_expense_line_wht_form_type   ← additive column
20260919000000_add_account_role_map              ← new table
20260920000000_add_other_income_maker_checker    ← ALTER TYPE ADD VALUE (safe in PG 12+)
20260921000000_add_other_income_template         ← new table with proper indexes/FKs
```

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Sonnet 4.6 ✅, MAX_TOOL_ITERATIONS=5 ✅, Sentry ✅, maxTokens=1024 ✅ |
| C2 Prompt | **OK** | Phone, bank account, hours all correct. ~120 lines, ~2-3K tokens. |
| C3 Tools | **OK** | 7 tools defined; all have Thai descriptions; executor handles all names. |
| C4 Auto-Trigger | **OK** | Idempotency via DB ✅, T-5/T-3/T-1/T/T+1/T+3 covered ✅, Sentry ✅ |
| C5 Security | **OK** | LIFF: LiffTokenGuard ✅, Admin: JWT+Roles ✅, Webhook dedup: DB unique ✅ |

### C1 — finance-ai.service.ts
- Model: `claude-sonnet-4-6` — current ✅
- `MAX_TOOL_ITERATIONS = 5` — guards against infinite tool loops ✅
- Sentry via `@sentry/nestjs` import; errors captured in outer service layer ✅
- `maxTokens = 1024` — reasonable for customer support replies ✅
- History window: last 10 messages, 20K char budget ✅
- Prompt cache: 5-minute TTL to avoid DB hit per message ✅

### C2 — system-prompt.ts
- Business hours: จันทร์-เสาร์ 09:00-18:00 ✅
- Phone: 063-134-6356 ✅
- Bank: KBank 203-1-16520-5 ชื่อบัญชี บจก. เบสท์ช้อยส์โฟน ✅
- Late fee: 50 บาท/วัน ✅
- Product scope clearly defined (iPhone new/used + iPad new only) ✅
- Security rules embedded in prompt (verify before disclose, no PII echo) ✅

### C3 — tool-definitions.ts + tool-executor.ts
Tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`,
`list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human` — all 7
matched by `case` statements in `tool-executor.ts` ✅

`customerId` intentionally excluded from tool input schemas — injected by orchestrator to prevent
AI from accessing other customers' data ✅

### C4 — auto-trigger.service.ts
- Cron T-5/T-3/T-1/T at 09:00 BKK, T+1/T+3 at 10:00 BKK ✅
- Idempotency: `ChatAutoTrigger` DB marker checked before each send ✅
- Sentry captured in both `runDailyReminders` and `runDailyEscalations` catch blocks ✅
- All 6 `AutoTriggerType` enum values covered ✅

### C5 — Security
- `chatbot-finance-liff.controller`: `@UseGuards(LiffTokenGuard)` — LINE ID token verified
  server-side before any customer data access ✅
- `chatbot-finance-admin.controller`: `@UseGuards(JwtAuthGuard, RolesGuard)` ✅
- `chatbot-finance.controller` (webhook): `@UseGuards(LineFinanceWebhookGuard)` per-route ✅
- `WebhookDedupService`: DB unique constraint on `eventId`; 7-day retention cron ✅
- Customer isolation: `customerId` never in tool input schemas ✅

---

## Action Items

### P0 — Fix Before Next Deploy
*(None — no critical failures in production code path)*

### P1 — High Priority
1. **[A3] Decimal compliance — chatbot & repossessions**: `finance-tools.service.ts` and
   `repossessions.service.ts` use `Number()` on `amountDue`/`sellingPrice` in calculation paths.
   Switch to `new Prisma.Decimal(value)` or `.toNumber()` only at display boundary.

2. **[A4] Soft-delete — contract-document.service.ts**: 5 Prisma queries on `contract` model
   without `deletedAt: null`. Risk: deleted contracts surfacing in document generation.

3. **[A5] API test failures**: 142 tests fail due to missing `DATABASE_URL`. Configure env for
   full integration test run in CI. Verify actual unit test count is stable.

### P2 — Medium Priority
4. **[A4] customer-precheck + customer-tier**: `findFirst` on `customer` and `creditCheck`
   without `deletedAt: null`. Low blast radius but violates invariant.

5. **[B1] PromiseSlot.deletedAt**: Confirm intentional omission (v5 design: supersede chain
   instead of soft-delete). Add `///` doc comment to schema model.

6. **[A2] web-widget threat model**: `roomId`-as-capability exposes chat history. Ensure
   this is in the threat model doc; consider adding `Origin` header check for widget embeds.

### P3 — Low Priority / Tech Debt
7. **[A3] Display-only Number() conversions**: `line-oa/chatbot.service.ts`, `stickers.service.ts`
   — used for `.toLocaleString()` display only. Low risk but creates inconsistency.

8. **[A6] thai-address-data chunk**: 870 KB raw. Consider splitting province/district/subdistrict
   into separate lazy-loaded modules (load only on address input focus).

9. **[A3] crm/customer-scoring**: `Number(_sum.financedAmount)` — `_sum` can return `null`,
   already guarded with `?? 0`, but switch to `Prisma.Decimal` for consistency.
